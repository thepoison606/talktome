//! Local UDP TURN façade in front of TURN-over-TCP / TURNS.
//!
//! webrtc-ice 0.17 only gathers relay candidates for `turn:` over UDP. The
//! URLs Talktome hands browsers (`turns:host:443?transport=tcp`) therefore
//! produce `Unable to handle URL in gather_candidates_relay` and never
//! allocate. This module listens on `127.0.0.1`, speaks TURN-over-UDP to
//! webrtc-rs, and forwards framed STUN/ChannelData over TCP or TLS to the
//! real server.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use rustls::ClientConfig;
use rustls_pki_types::ServerName;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpStream, UdpSocket};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tokio_rustls::TlsConnector;
use webrtc::ice::url::{ProtoType, SchemeType, Url as IceUrl};
use webrtc::ice_transport::ice_server::RTCIceServer;

use super::types::IceServer;

/// STUN/TURN-over-TCP frame length from the first 4 header bytes.
/// ChannelData (RFC 8656) is padded to 4 bytes; STUN length already is.
pub fn tcp_frame_len(header: &[u8; 4]) -> Option<usize> {
    let len = u16::from_be_bytes([header[2], header[3]]) as usize;
    match header[0] & 0xC0 {
        0x00 => Some(20 + len),
        0x40 => Some(4 + ((len + 3) & !3)),
        _ => None,
    }
}

/// Pads ChannelData so it can be written on a TCP/TLS TURN socket.
pub fn pad_for_tcp(packet: &[u8]) -> Vec<u8> {
    if packet.len() < 4 {
        return packet.to_vec();
    }
    let header: [u8; 4] = packet[..4].try_into().expect("length checked");
    match tcp_frame_len(&header) {
        Some(need) if packet.len() < need => {
            let mut out = packet.to_vec();
            out.resize(need, 0);
            out
        }
        Some(need) if packet.len() > need => packet[..need].to_vec(),
        _ => packet.to_vec(),
    }
}

const MAX_FRAME: usize = 2048;

#[derive(Debug, Clone, PartialEq, Eq)]
struct TurnTcpTarget {
    host: String,
    port: u16,
    tls: bool,
}

/// UDP listener that proxies one TURN-over-TCP/TLS server.
pub struct TurnBridge {
    pub local_url: String,
    tasks: Vec<JoinHandle<()>>,
}

impl Drop for TurnBridge {
    fn drop(&mut self) {
        for task in self.tasks.drain(..) {
            task.abort();
        }
    }
}

impl TurnBridge {
    async fn listen(target: TurnTcpTarget, tls: Option<Arc<ClientConfig>>) -> Result<Self> {
        let socket = UdpSocket::bind("127.0.0.1:0")
            .await
            .context("binding local TURN UDP façade")?;
        let port = socket.local_addr()?.port();
        let local_url = format!("turn:127.0.0.1:{port}?transport=udp");
        tracing::info!(
            event = "turn-bridge-listen",
            local = %local_url,
            remote_host = %target.host,
            remote_port = target.port,
            tls = target.tls
        );
        let task = tokio::spawn(run_bridge(socket, target, tls));
        Ok(Self {
            local_url,
            tasks: vec![task],
        })
    }
}

async fn run_bridge(socket: UdpSocket, target: TurnTcpTarget, tls: Option<Arc<ClientConfig>>) {
    let socket = Arc::new(socket);
    let sessions: Arc<Mutex<HashMap<SocketAddr, mpsc::Sender<Vec<u8>>>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let mut buf = vec![0u8; MAX_FRAME];
    loop {
        let (n, src) = match socket.recv_from(&mut buf).await {
            Ok(result) => result,
            Err(error) => {
                tracing::debug!(event = "turn-bridge-recv", error = %error);
                break;
            }
        };
        let packet = buf[..n].to_vec();
        let tx = {
            let mut map = sessions.lock().await;
            if let Some(tx) = map.get(&src) {
                if !tx.is_closed() {
                    Some(tx.clone())
                } else {
                    map.remove(&src);
                    None
                }
            } else {
                None
            }
        };
        let tx = match tx {
            Some(tx) => tx,
            None => {
                let (tx, rx) = mpsc::channel::<Vec<u8>>(32);
                sessions.lock().await.insert(src, tx.clone());
                let socket = Arc::clone(&socket);
                let target = target.clone();
                let tls = tls.clone();
                let sessions = Arc::clone(&sessions);
                tokio::spawn(async move {
                    if let Err(error) = session(src, socket, rx, target, tls).await {
                        tracing::warn!(
                            event = "turn-bridge-session-failed",
                            peer = %src,
                            error = %format!("{error:#}")
                        );
                    }
                    sessions.lock().await.remove(&src);
                });
                tx
            }
        };
        if tx.send(packet).await.is_err() {
            sessions.lock().await.remove(&src);
        }
    }
}

async fn session(
    src: SocketAddr,
    udp: Arc<UdpSocket>,
    mut rx: mpsc::Receiver<Vec<u8>>,
    target: TurnTcpTarget,
    tls: Option<Arc<ClientConfig>>,
) -> Result<()> {
    let tcp = TcpStream::connect((target.host.as_str(), target.port))
        .await
        .with_context(|| format!("connecting to TURN {}:{}", target.host, target.port))?;
    tcp.set_nodelay(true)?;
    if target.tls {
        let config = tls.ok_or_else(|| anyhow!("TURNS requested but no TLS client config"))?;
        let connector = TlsConnector::from(config);
        let server_name = ServerName::try_from(target.host.clone())
            .map_err(|error| anyhow!("TURN TLS server name {}: {error}", target.host))?;
        let stream = connector
            .connect(server_name, tcp)
            .await
            .with_context(|| format!("TLS handshake with {}:{}", target.host, target.port))?;
        pump(src, udp, stream, &mut rx).await
    } else {
        pump(src, udp, tcp, &mut rx).await
    }
}

async fn pump<S>(
    src: SocketAddr,
    udp: Arc<UdpSocket>,
    stream: S,
    rx: &mut mpsc::Receiver<Vec<u8>>,
) -> Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let (mut reader, mut writer) = tokio::io::split(stream);
    let to_tcp = async {
        while let Some(packet) = rx.recv().await {
            let framed = pad_for_tcp(&packet);
            writer.write_all(&framed).await?;
        }
        Ok::<(), anyhow::Error>(())
    };
    let to_udp = async {
        loop {
            let mut header = [0u8; 4];
            if let Err(error) = reader.read_exact(&mut header).await {
                if error.kind() == std::io::ErrorKind::UnexpectedEof {
                    break;
                }
                return Err(error.into());
            }
            let Some(len) = tcp_frame_len(&header) else {
                return bail_frame(&header);
            };
            if !(4..=MAX_FRAME).contains(&len) {
                anyhow::bail!("TURN TCP frame length {len} is outside 4..={MAX_FRAME}");
            }
            let mut packet = vec![0u8; len];
            packet[..4].copy_from_slice(&header);
            reader.read_exact(&mut packet[4..]).await?;
            udp.send_to(&packet, src).await?;
        }
        Ok(())
    };
    tokio::select! {
        result = to_tcp => result,
        result = to_udp => result,
    }
}

fn bail_frame(header: &[u8; 4]) -> Result<()> {
    anyhow::bail!(
        "TURN TCP stream is not STUN or ChannelData (header {:02x}{:02x}{:02x}{:02x})",
        header[0],
        header[1],
        header[2],
        header[3]
    )
}

fn classify_url(raw: &str) -> Result<ClassifiedUrl> {
    let parsed = IceUrl::parse_url(raw).map_err(|error| anyhow!("ICE URL {raw}: {error}"))?;
    Ok(match (parsed.scheme, parsed.proto) {
        (SchemeType::Stun, _) => ClassifiedUrl::PassThrough,
        (SchemeType::Turn, ProtoType::Udp) => ClassifiedUrl::PassThrough,
        (SchemeType::Turn, ProtoType::Tcp) => ClassifiedUrl::TurnTcp(TurnTcpTarget {
            host: parsed.host,
            port: parsed.port,
            tls: false,
        }),
        (SchemeType::Turns, _) => ClassifiedUrl::TurnTcp(TurnTcpTarget {
            host: parsed.host,
            port: parsed.port,
            tls: true,
        }),
        (SchemeType::Stuns, _) => ClassifiedUrl::Skip("stuns is not supported by webrtc-ice"),
        (SchemeType::Unknown, _) => ClassifiedUrl::Skip("unrecognised ICE URL scheme"),
        (_, ProtoType::Unknown) => ClassifiedUrl::Skip("unrecognised ICE transport"),
    })
}

enum ClassifiedUrl {
    PassThrough,
    TurnTcp(TurnTcpTarget),
    Skip(&'static str),
}

/// Rewrites `iceServers` so webrtc-rs only sees STUN and TURN-over-UDP.
pub struct IceServerPrep {
    pub servers: Vec<RTCIceServer>,
    /// Original URLs, for status / logs.
    pub announced: Vec<String>,
    /// URLs actually given to webrtc-rs.
    pub effective: Vec<String>,
    /// UDP façades; kept so the sockets stay open for the factory lifetime.
    #[allow(dead_code)]
    bridges: Vec<TurnBridge>,
}

impl IceServerPrep {
    pub async fn prepare(
        sources: &[IceServer],
        tls: Arc<ClientConfig>,
        transport_policy: &str,
    ) -> Result<Self> {
        let mut bridges: HashMap<String, TurnBridge> = HashMap::new();
        let mut servers = Vec::new();
        let mut announced = Vec::new();
        let mut effective = Vec::new();

        for source in sources {
            let original_urls = source.url_list();
            if original_urls.is_empty() {
                continue;
            }
            announced.extend(original_urls.iter().cloned());
            let mut rewritten = Vec::new();
            for raw in &original_urls {
                match classify_url(raw) {
                    Ok(ClassifiedUrl::PassThrough) => rewritten.push(raw.clone()),
                    Ok(ClassifiedUrl::TurnTcp(target)) => {
                        let key = format!("{}:{}:{}", target.host, target.port, target.tls);
                        if !bridges.contains_key(&key) {
                            let tls_config = target.tls.then(|| Arc::clone(&tls));
                            match TurnBridge::listen(target.clone(), tls_config).await {
                                Ok(bridge) => {
                                    bridges.insert(key.clone(), bridge);
                                }
                                Err(error) => {
                                    tracing::error!(
                                        event = "turn-bridge-listen-failed",
                                        url = %raw,
                                        error = %format!("{error:#}")
                                    );
                                    continue;
                                }
                            }
                        }
                        if let Some(bridge) = bridges.get(&key) {
                            tracing::info!(
                                event = "ice-url-rewritten",
                                from = %raw,
                                to = %bridge.local_url
                            );
                            rewritten.push(bridge.local_url.clone());
                        }
                    }
                    Ok(ClassifiedUrl::Skip(reason)) => {
                        tracing::warn!(event = "ice-url-skipped", url = %raw, reason);
                    }
                    Err(error) => {
                        tracing::warn!(
                            event = "ice-url-invalid",
                            url = %raw,
                            error = %format!("{error:#}")
                        );
                    }
                }
            }
            rewritten.sort();
            rewritten.dedup();
            if rewritten.is_empty() {
                continue;
            }
            effective.extend(rewritten.iter().cloned());
            servers.push(RTCIceServer {
                urls: rewritten,
                username: source.username.clone().unwrap_or_default(),
                credential: source.credential.clone().unwrap_or_default(),
            });
        }

        if transport_policy.eq_ignore_ascii_case("relay")
            && !effective.iter().any(|u| u.starts_with("turn:"))
        {
            anyhow::bail!(
                "iceTransportPolicy is relay but no usable TURN URL remains \
                 (webrtc-ice only speaks turn-over-udp; TURNS/TCP URLs are bridged locally)"
            );
        }

        Ok(Self {
            servers,
            announced,
            effective,
            bridges: bridges.into_values().collect(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    #[test]
    fn frames_stun_and_channel_data() {
        assert_eq!(tcp_frame_len(&[0x00, 0x01, 0x00, 0x00]), Some(20));
        assert_eq!(tcp_frame_len(&[0x00, 0x01, 0x00, 0x04]), Some(24));
        // ChannelData length 1 → 4 header + 4 padded payload.
        assert_eq!(tcp_frame_len(&[0x40, 0x00, 0x00, 0x01]), Some(8));
        assert_eq!(tcp_frame_len(&[0x80, 0x00, 0x00, 0x00]), None);
    }

    #[test]
    fn pads_channel_data_to_four_bytes() {
        let packet = vec![0x40, 0x00, 0x00, 0x01, 0xab];
        assert_eq!(
            pad_for_tcp(&packet),
            vec![0x40, 0x00, 0x00, 0x01, 0xab, 0, 0, 0]
        );
        let stun = vec![0u8; 20];
        assert_eq!(pad_for_tcp(&stun), stun);
    }

    #[test]
    fn classifies_turns_tcp_and_turn_udp() {
        match classify_url("turns:turn.example:443?transport=tcp").unwrap() {
            ClassifiedUrl::TurnTcp(t) => {
                assert_eq!(t.host, "turn.example");
                assert_eq!(t.port, 443);
                assert!(t.tls);
            }
            _ => panic!("expected TurnTcp, got skip/passthrough"),
        }
        match classify_url("turn:turn.example:3478?transport=udp").unwrap() {
            ClassifiedUrl::PassThrough => {}
            _ => panic!("udp turn should pass through"),
        }
        match classify_url("turn:turn.example:443?transport=tcp").unwrap() {
            ClassifiedUrl::TurnTcp(t) => assert!(!t.tls),
            _ => panic!("tcp turn should be bridged"),
        }
        match classify_url("stun:stun.example:3478").unwrap() {
            ClassifiedUrl::PassThrough => {}
            _ => panic!("stun should pass through"),
        }
    }

    #[tokio::test]
    async fn udp_facade_echoes_stun_over_tcp() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut header = [0u8; 4];
            stream.read_exact(&mut header).await.unwrap();
            let len = tcp_frame_len(&header).unwrap();
            let mut packet = vec![0u8; len];
            packet[..4].copy_from_slice(&header);
            stream.read_exact(&mut packet[4..]).await.unwrap();
            stream.write_all(&packet).await.unwrap();
        });

        let bridge = TurnBridge::listen(
            TurnTcpTarget {
                host: "127.0.0.1".into(),
                port,
                tls: false,
            },
            None,
        )
        .await
        .unwrap();
        let local_port: u16 = bridge
            .local_url
            .split(':')
            .nth(2)
            .unwrap()
            .split('?')
            .next()
            .unwrap()
            .parse()
            .unwrap();

        let client = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let mut stun = vec![0u8; 20];
        stun[1] = 0x01;
        stun[4..8].copy_from_slice(&0x2112_A442u32.to_be_bytes());
        client
            .send_to(&stun, ("127.0.0.1", local_port))
            .await
            .unwrap();
        let mut buf = vec![0u8; 64];
        let (n, _) = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            client.recv_from(&mut buf),
        )
        .await
        .expect("bridge echo")
        .unwrap();
        assert_eq!(&buf[..n], &stun);
        server.await.unwrap();
    }

    #[test]
    fn classify_turns_default_port_is_tls() {
        match classify_url("turns:turn.example").unwrap() {
            ClassifiedUrl::TurnTcp(t) => {
                assert_eq!(t.port, 5349);
                assert!(t.tls);
            }
            _ => panic!("expected TURNS"),
        }
    }
}
