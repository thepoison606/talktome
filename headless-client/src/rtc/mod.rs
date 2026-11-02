//! WebRTC transports on top of webrtc-rs, negotiated with mediasoup through
//! the Talktome Socket.IO events. One send peer connection carries the single
//! "talk" producer; one receive peer connection carries all consumers.

pub mod ice_addr;
pub mod ortc;
pub mod remote_sdp;
pub mod sdp;
pub mod turn_bridge;
pub mod types;

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use bytes::Bytes;
use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex};
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::{MediaEngine, MIME_TYPE_OPUS};
use webrtc::api::setting_engine::SettingEngine;
use webrtc::api::APIBuilder;
use webrtc::dtls_transport::dtls_role::DTLSRole;
use webrtc::ice::network_type::NetworkType;
use webrtc::ice_transport::ice_connection_state::RTCIceConnectionState;
use webrtc::interceptor::registry::Registry;
use webrtc::media::Sample;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::policy::ice_transport_policy::RTCIceTransportPolicy;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::rtp_transceiver::rtp_codec::{
    RTCRtpCodecCapability, RTCRtpCodecParameters, RTCRtpHeaderExtensionCapability, RTPCodecType,
};
use webrtc::rtp_transceiver::RTCPFeedback;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::track::track_local::TrackLocal;
use webrtc::track::track_remote::TrackRemote;

use crate::config::{IceConfig, IceServerConfig, TlsConfig};
use crate::signalling::socketio::SocketClient;
use remote_sdp::RecvRemoteSdp;
use types::*;

pub const SIGNAL_TIMEOUT: Duration = Duration::from_secs(10);

/// Direction tag for transport state events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Send,
    Recv,
}

/// State changes reported to the session orchestrator.
#[derive(Debug, Clone)]
pub enum RtcEvent {
    IceState {
        direction: Direction,
        state: RTCIceConnectionState,
    },
    PeerState {
        direction: Direction,
        state: RTCPeerConnectionState,
    },
    /// A remote track started delivering RTP for a consumer.
    ConsumerTrack { consumer_id: String, ssrc: u32 },
}

/// One depacketized-ready RTP packet from a consumer track.
#[derive(Debug, Clone)]
pub struct RxPacket {
    pub consumer_id: String,
    pub sequence: u16,
    pub payload: Bytes,
}

/// Per-connection tuning shared by both transports.
#[derive(Debug, Clone)]
pub struct RtcSettings {
    pub ice_override: IceConfig,
    pub tls: TlsConfig,
    pub disconnected_timeout: Duration,
    pub failed_timeout: Duration,
    pub keepalive_interval: Duration,
    /// Opus packet time in milliseconds, advertised as `ptime`. `minptime`
    /// stays 10, matching the mediasoup router and the browser offer; the
    /// encoder frame size is what actually sets the packet duration.
    pub opus_ptime_ms: u32,
    pub opus_inband_fec: bool,
}

impl Default for RtcSettings {
    fn default() -> Self {
        Self {
            ice_override: IceConfig::default(),
            tls: TlsConfig::default(),
            disconnected_timeout: Duration::from_secs(4),
            failed_timeout: Duration::from_secs(12),
            keepalive_interval: Duration::from_secs(2),
            opus_ptime_ms: 20,
            opus_inband_fec: true,
        }
    }
}

/// Opus fmtp matching the browser client: `minptime` stays 10 (router and
/// browser offer), `ptime` is the profile frame size, FEC follows the profile.
pub(crate) fn opus_fmtp_line(ptime_ms: u32, inband_fec: bool) -> String {
    format!(
        "minptime=10;useinbandfec={};ptime={ptime_ms}",
        u8::from(inband_fec)
    )
}

/// Builds peer connections configured for the router's Opus payload type.
pub struct MediaFactory {
    router: RtpCapabilities,
    payload_type: u8,
    settings: RtcSettings,
    tls: Arc<rustls::ClientConfig>,
    ice_prep: Mutex<Option<turn_bridge::IceServerPrep>>,
}

impl MediaFactory {
    pub fn new(router: RtpCapabilities, settings: RtcSettings) -> Result<Self> {
        let payload_type = router
            .opus()
            .and_then(|c| c.preferred_payload_type)
            .unwrap_or(100);
        let tls = crate::tls::build_turn_client_config(&settings.tls)?;
        Ok(Self {
            router,
            payload_type,
            settings,
            tls,
            ice_prep: Mutex::new(None),
        })
    }

    pub fn router(&self) -> &RtpCapabilities {
        &self.router
    }

    pub async fn ice_urls(&self) -> (Vec<String>, Vec<String>) {
        let slot = self.ice_prep.lock().await;
        match slot.as_ref() {
            Some(prep) => (prep.announced.clone(), prep.effective.clone()),
            None => (Vec::new(), Vec::new()),
        }
    }

    fn opus_capability(&self) -> RTCRtpCodecCapability {
        RTCRtpCodecCapability {
            mime_type: MIME_TYPE_OPUS.to_owned(),
            clock_rate: 48_000,
            channels: 2,
            sdp_fmtp_line: opus_fmtp_line(
                self.settings.opus_ptime_ms,
                self.settings.opus_inband_fec,
            ),
            rtcp_feedback: vec![RTCPFeedback {
                typ: "transport-cc".to_owned(),
                parameter: String::new(),
            }],
        }
    }

    fn ice_policy<'a>(&'a self, transport: &'a TransportInfo) -> &'a str {
        self.settings
            .ice_override
            .transport_policy
            .as_deref()
            .or(transport.ice_transport_policy.as_deref())
            .unwrap_or("all")
    }

    async fn rtc_configuration(&self, transport: &TransportInfo) -> Result<RTCConfiguration> {
        let policy = self.ice_policy(transport);
        let ice_transport_policy = if policy.eq_ignore_ascii_case("relay") {
            RTCIceTransportPolicy::Relay
        } else {
            RTCIceTransportPolicy::All
        };
        let servers = {
            let mut slot = self.ice_prep.lock().await;
            if slot.is_none() {
                let sources = match &self.settings.ice_override.servers {
                    Some(overrides) => ice_servers_from_override(overrides),
                    None => transport.ice_servers.clone(),
                };
                let prep =
                    turn_bridge::IceServerPrep::prepare(&sources, Arc::clone(&self.tls), policy)
                        .await?;
                tracing::info!(
                    event = "ice-servers",
                    announced = ?prep.announced,
                    effective = ?prep.effective,
                    policy
                );
                *slot = Some(prep);
            }
            slot.as_ref()
                .map(|prep| prep.servers.clone())
                .unwrap_or_default()
        };
        Ok(RTCConfiguration {
            ice_servers: servers,
            ice_transport_policy,
            ..Default::default()
        })
    }

    async fn new_peer_connection(
        &self,
        transport: &TransportInfo,
        direction: Direction,
        events: mpsc::Sender<RtcEvent>,
    ) -> Result<Arc<RTCPeerConnection>> {
        let mut media_engine = MediaEngine::default();
        media_engine
            .register_codec(
                RTCRtpCodecParameters {
                    capability: self.opus_capability(),
                    payload_type: self.payload_type,
                    ..Default::default()
                },
                RTPCodecType::Audio,
            )
            .context("registering opus codec")?;
        for uri in ortc::SUPPORTED_AUDIO_EXTENSIONS {
            media_engine
                .register_header_extension(
                    RTCRtpHeaderExtensionCapability {
                        uri: (*uri).to_owned(),
                    },
                    RTPCodecType::Audio,
                    None,
                )
                .with_context(|| format!("registering header extension {uri}"))?;
        }

        let registry = register_default_interceptors(Registry::new(), &mut media_engine)
            .context("registering interceptors")?;

        let mut setting_engine = SettingEngine::default();
        setting_engine.set_ice_timeouts(
            Some(self.settings.disconnected_timeout),
            Some(self.settings.failed_timeout),
            Some(self.settings.keepalive_interval),
        );
        if self.settings.ice_override.ipv6 {
            setting_engine.set_network_types(vec![NetworkType::Udp4, NetworkType::Udp6]);
        } else {
            setting_engine.set_network_types(vec![NetworkType::Udp4]);
        }
        setting_engine.set_ip_filter(Box::new(usable_ip_filter));
        // mediasoup is ICE-lite; webrtc-rs would otherwise answer an ice-lite
        // offer with `a=setup:passive`, while we tell mediasoup we are the
        // DTLS client. Both sides would then wait for a ClientHello.
        setting_engine
            .set_answering_dtls_role(DTLSRole::Client)
            .context("setting answering DTLS role")?;

        let api = APIBuilder::new()
            .with_media_engine(media_engine)
            .with_interceptor_registry(registry)
            .with_setting_engine(setting_engine)
            .build();

        let pc = Arc::new(
            api.new_peer_connection(self.rtc_configuration(transport).await?)
                .await
                .context("creating peer connection")?,
        );

        let ice_events = events.clone();
        pc.on_ice_connection_state_change(Box::new(move |state| {
            let tx = ice_events.clone();
            Box::pin(async move {
                let _ = tx.send(RtcEvent::IceState { direction, state }).await;
            })
        }));
        let pc_events = events;
        pc.on_peer_connection_state_change(Box::new(move |state| {
            let tx = pc_events.clone();
            Box::pin(async move {
                let _ = tx.send(RtcEvent::PeerState { direction, state }).await;
            })
        }));
        Ok(pc)
    }
}

fn parse_local_fingerprint(sdp_text: &str) -> Result<DtlsParameters> {
    let parsed = sdp::parse(sdp_text)?;
    let (algorithm, value) = parsed
        .fingerprint()
        .ok_or_else(|| anyhow!("local description has no DTLS fingerprint"))?;
    Ok(DtlsParameters {
        role: Some("client".into()),
        fingerprints: vec![DtlsFingerprint { algorithm, value }],
    })
}

fn ice_servers_from_override(overrides: &[IceServerConfig]) -> Vec<IceServer> {
    overrides
        .iter()
        .map(|server| IceServer {
            urls: Value::Array(
                server
                    .urls
                    .iter()
                    .map(|url| Value::String(url.clone()))
                    .collect(),
            ),
            username: server.username.clone(),
            credential: server.credential.clone(),
        })
        .collect()
}

fn usable_ip_filter(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            !v.is_unspecified() && !v.is_link_local() && !v.is_broadcast() && !v.is_multicast()
        }
        IpAddr::V6(v) => !v.is_unspecified() && !v.is_multicast() && !v.is_unicast_link_local(),
    }
}

/// The send transport with its single warm "talk" producer.
pub struct SendTransport {
    pc: Arc<RTCPeerConnection>,
    track: Arc<TrackLocalStaticSample>,
    pub transport_id: String,
    pub producer_id: String,
    /// ICE server URLs actually handed to webrtc-rs (for diagnostics).
    pub ice_servers: Vec<String>,
    /// URLs announced by the Talktome server before any local TURN bridge.
    pub ice_servers_announced: Vec<String>,
    pub ice_transport_policy: String,
    talking: AtomicBool,
    closed: AtomicBool,
}

impl SendTransport {
    pub async fn create(
        factory: &MediaFactory,
        signal: &SocketClient,
        events: mpsc::Sender<RtcEvent>,
        stream_id: &str,
    ) -> Result<Self> {
        let info: TransportInfo = serde_json::from_value(
            signal
                .request("create-send-transport", Value::Null, SIGNAL_TIMEOUT)
                .await?,
        )
        .context("parsing create-send-transport response")?;
        let info = ice_addr::resolve_transport_candidates(info).await?;
        tracing::info!(
            event = "send-ice-candidates",
            candidates = ?ice_addr::describe_candidates(&info.ice_candidates)
        );

        let pc = factory
            .new_peer_connection(&info, Direction::Send, events)
            .await?;
        let track = Arc::new(TrackLocalStaticSample::new(
            factory.opus_capability(),
            "audio".to_owned(),
            stream_id.to_owned(),
        ));
        let sender = pc
            .add_track(Arc::clone(&track) as Arc<dyn TrackLocal + Send + Sync>)
            .await
            .context("adding local track")?;
        tokio::spawn(async move {
            let mut buffer = vec![0u8; 1500];
            while let Ok((_, _)) = sender.read(&mut buffer).await {}
        });

        let offer = pc.create_offer(None).await.context("creating offer")?;
        pc.set_local_description(offer)
            .await
            .context("setting local offer")?;
        let local = pc
            .local_description()
            .await
            .ok_or_else(|| anyhow!("no local description after set_local_description"))?;
        let parsed = sdp::parse(&local.sdp)?;
        let media = parsed
            .media
            .iter()
            .find(|m| m.kind == "audio")
            .ok_or_else(|| anyhow!("local offer has no audio section"))?;
        let local_info = ortc::local_audio_info(media)?;
        let dtls = parse_local_fingerprint(&local.sdp)?;

        signal
            .request(
                "connect-send-transport",
                json!({ "dtlsParameters": dtls }),
                SIGNAL_TIMEOUT,
            )
            .await?;

        let answer = remote_sdp::build_send_answer(&local_info, &info, 2)?;
        tracing::debug!(event = "send-remote-answer", sdp = %answer);
        let desc = RTCSessionDescription::answer(answer).with_context(|| {
            format!(
                "parsing remote answer SDP (candidates: {})",
                ice_addr::describe_candidates(&info.ice_candidates).join(", ")
            )
        })?;
        pc.set_remote_description(desc).await.with_context(|| {
            format!(
                "setting remote answer (candidates: {})",
                ice_addr::describe_candidates(&info.ice_candidates).join(", ")
            )
        })?;

        let rtp_parameters = ortc::sending_rtp_parameters(&local_info, factory.router())?;
        let produced = signal
            .request(
                "produce",
                json!({
                    "kind": "audio",
                    "rtpParameters": rtp_parameters,
                    "appData": { "type": "talk" }
                }),
                SIGNAL_TIMEOUT,
            )
            .await?;
        let producer_id = produced
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("produce response has no id"))?
            .to_string();
        signal
            .request(
                "pause-producer",
                json!({ "producerId": producer_id }),
                SIGNAL_TIMEOUT,
            )
            .await?;
        tracing::info!(event = "producer-created", producer = %producer_id, transport = %info.id);

        let rtc_config = factory.rtc_configuration(&info).await?;
        let (announced, effective) = factory.ice_urls().await;
        Ok(Self {
            pc,
            track,
            transport_id: info.id,
            producer_id,
            ice_servers: if effective.is_empty() {
                rtc_config
                    .ice_servers
                    .iter()
                    .flat_map(|s| s.urls.clone())
                    .collect()
            } else {
                effective
            },
            ice_servers_announced: announced,
            ice_transport_policy: rtc_config.ice_transport_policy.to_string(),
            talking: AtomicBool::new(false),
            closed: AtomicBool::new(false),
        })
    }

    pub fn is_talking(&self) -> bool {
        self.talking.load(Ordering::Relaxed)
    }

    pub async fn stats_report(&self) -> webrtc::stats::StatsReport {
        self.pc.get_stats().await
    }

    /// Resumes or pauses the producer on the server and locally.
    pub async fn set_talking(&self, signal: &SocketClient, talking: bool) -> Result<()> {
        if self.talking.swap(talking, Ordering::Relaxed) == talking {
            return Ok(());
        }
        let event = if talking {
            "resume-producer"
        } else {
            "pause-producer"
        };
        signal
            .request(
                event,
                json!({ "producerId": self.producer_id }),
                SIGNAL_TIMEOUT,
            )
            .await?;
        Ok(())
    }

    /// Writes one encoded Opus frame; dropped while not talking.
    pub async fn write_frame(&self, opus: Bytes, duration: Duration) -> Result<()> {
        if !self.talking.load(Ordering::Relaxed) || self.closed.load(Ordering::Relaxed) {
            return Ok(());
        }
        self.track
            .write_sample(&Sample {
                data: opus,
                duration,
                ..Default::default()
            })
            .await
            .context("writing sample")
    }

    pub async fn close(&self) {
        self.closed.store(true, Ordering::Relaxed);
        let _ = self.pc.close().await;
    }
}

struct RecvConsumer {
    producer_id: String,
    ssrc: Option<u32>,
}

/// The receive transport: one peer connection, one media section per consumer.
pub struct RecvTransport {
    pc: Arc<RTCPeerConnection>,
    remote: Mutex<RecvRemoteSdp>,
    consumers: Mutex<HashMap<String, RecvConsumer>>,
    connected_signalled: AtomicBool,
    closed: AtomicBool,
    pub transport_id: String,
    negotiation: Mutex<()>,
}

impl RecvTransport {
    pub async fn create(
        factory: &MediaFactory,
        signal: &SocketClient,
        events: mpsc::Sender<RtcEvent>,
        rx_packets: mpsc::Sender<RxPacket>,
    ) -> Result<Arc<Self>> {
        let info: TransportInfo = serde_json::from_value(
            signal
                .request("create-recv-transport", Value::Null, SIGNAL_TIMEOUT)
                .await?,
        )
        .context("parsing create-recv-transport response")?;
        let info = ice_addr::resolve_transport_candidates(info).await?;
        tracing::info!(
            event = "recv-ice-candidates",
            candidates = ?ice_addr::describe_candidates(&info.ice_candidates)
        );
        let pc = factory
            .new_peer_connection(&info, Direction::Recv, events.clone())
            .await?;
        let transport = Arc::new(Self {
            pc: pc.clone(),
            remote: Mutex::new(RecvRemoteSdp::new(info.clone())),
            consumers: Mutex::new(HashMap::new()),
            connected_signalled: AtomicBool::new(false),
            closed: AtomicBool::new(false),
            transport_id: info.id.clone(),
            negotiation: Mutex::new(()),
        });

        let weak = Arc::downgrade(&transport);
        pc.on_track(Box::new(move |track: Arc<TrackRemote>, _receiver, transceiver| {
            let weak = weak.clone();
            let rx_packets = rx_packets.clone();
            let events = events.clone();
            Box::pin(async move {
                let Some(transport) = weak.upgrade() else { return };
                let ssrc = track.ssrc();
                let mid = transceiver.mid().map(|m| m.to_string());
                let consumer_id = {
                    let remote = transport.remote.lock().await;
                    remote
                        .consumer_for_ssrc(ssrc)
                        .map(str::to_string)
                        .or_else(|| {
                            // Fall back to the mid the track was received on.
                            mid.as_deref()
                                .and_then(|m| remote.consumer_for_mid(m))
                                .map(str::to_string)
                        })
                };
                let Some(consumer_id) = consumer_id else {
                    tracing::warn!(event = "unknown-track", ssrc, "RTP track without consumer");
                    return;
                };
                {
                    let mut consumers = transport.consumers.lock().await;
                    if let Some(entry) = consumers.get_mut(&consumer_id) {
                        entry.ssrc = Some(ssrc);
                    }
                }
                let _ = events
                    .send(RtcEvent::ConsumerTrack {
                        consumer_id: consumer_id.clone(),
                        ssrc,
                    })
                    .await;
                tracing::info!(event = "consumer-track", consumer = %consumer_id, ssrc);
                // webrtc-rs holds the on_track handler lock until this future
                // returns, so reading here would hold back every later track
                // (a call while a feed plays) until this one ends. Read in a
                // task of its own.
                tokio::spawn(async move {
                    loop {
                        match track.read_rtp().await {
                            Ok((packet, _)) => {
                                let out = RxPacket {
                                    consumer_id: consumer_id.clone(),
                                    sequence: packet.header.sequence_number,
                                    payload: packet.payload,
                                };
                                if rx_packets.send(out).await.is_err() {
                                    break;
                                }
                            }
                            Err(error) => {
                                tracing::debug!(event = "consumer-track-ended", consumer = %consumer_id, error = %error);
                                break;
                            }
                        }
                    }
                });
            })
        }));

        Ok(transport)
    }

    /// Media sections accumulated on the receive peer connection; closed
    /// consumers stay as inactive sections until the transport is recreated.
    pub async fn section_count(&self) -> usize {
        self.remote.lock().await.section_count()
    }

    pub async fn has_consumer_for_producer(&self, producer_id: &str) -> Option<String> {
        self.consumers
            .lock()
            .await
            .iter()
            .find(|(_, c)| c.producer_id == producer_id)
            .map(|(id, _)| id.clone())
    }

    /// Asks the server for a consumer of `producer_id`, renegotiates the
    /// receive peer connection and resumes the consumer.
    pub async fn consume(
        &self,
        signal: &SocketClient,
        factory: &MediaFactory,
        producer_id: &str,
    ) -> Result<String> {
        if self.closed.load(Ordering::Relaxed) {
            bail!("receive transport is closed");
        }
        let _guard = self.negotiation.lock().await;
        let capabilities = ortc::receiving_rtp_capabilities(factory.router())?;
        let response = signal
            .request(
                "consume",
                json!({ "producerId": producer_id, "rtpCapabilities": capabilities }),
                SIGNAL_TIMEOUT,
            )
            .await?;
        let info: ConsumerInfo =
            serde_json::from_value(response).context("parsing consume response")?;
        let consumer_id = info.id.clone();

        let offer = {
            let mut remote = self.remote.lock().await;
            remote.add_consumer(&consumer_id, info.rtp_parameters.clone());
            remote.offer_sdp()?
        };
        self.consumers.lock().await.insert(
            consumer_id.clone(),
            RecvConsumer {
                producer_id: producer_id.to_string(),
                ssrc: info.rtp_parameters.primary_ssrc(),
            },
        );
        tracing::debug!(event = "recv-remote-offer", sdp = %offer);
        if let Err(error) = self.renegotiate(signal, offer).await {
            self.remote.lock().await.close_consumer(&consumer_id);
            self.consumers.lock().await.remove(&consumer_id);
            let _ = signal
                .request(
                    "close-consumer",
                    json!({ "consumerId": consumer_id }),
                    SIGNAL_TIMEOUT,
                )
                .await;
            return Err(error);
        }
        signal
            .request(
                "resume-consumer",
                json!({ "consumerId": consumer_id }),
                SIGNAL_TIMEOUT,
            )
            .await?;
        tracing::info!(event = "consumer-created", consumer = %consumer_id, producer = %producer_id);
        Ok(consumer_id)
    }

    async fn renegotiate(&self, signal: &SocketClient, offer: String) -> Result<()> {
        self.pc
            .set_remote_description(RTCSessionDescription::offer(offer)?)
            .await
            .context("setting remote offer")?;
        let answer = self
            .pc
            .create_answer(None)
            .await
            .context("creating answer")?;
        self.pc
            .set_local_description(answer)
            .await
            .context("setting local answer")?;
        if !self.connected_signalled.load(Ordering::Relaxed) {
            let local = self
                .pc
                .local_description()
                .await
                .ok_or_else(|| anyhow!("no local answer"))?;
            let dtls = parse_local_fingerprint(&local.sdp)?;
            signal
                .request(
                    "connect-recv-transport",
                    json!({ "dtlsParameters": dtls }),
                    SIGNAL_TIMEOUT,
                )
                .await?;
            self.connected_signalled.store(true, Ordering::Relaxed);
        }
        Ok(())
    }

    /// Removes a consumer locally (after `consumer-closed`) or on request.
    pub async fn close_consumer(
        &self,
        signal: &SocketClient,
        consumer_id: &str,
        notify_server: bool,
    ) -> Result<()> {
        let _guard = self.negotiation.lock().await;
        let removed = self.consumers.lock().await.remove(consumer_id).is_some();
        if !removed {
            return Ok(());
        }
        let offer = {
            let mut remote = self.remote.lock().await;
            remote.close_consumer(consumer_id);
            remote.offer_sdp()?
        };
        if notify_server {
            let _ = signal
                .request(
                    "close-consumer",
                    json!({ "consumerId": consumer_id }),
                    SIGNAL_TIMEOUT,
                )
                .await;
        }
        if !self.closed.load(Ordering::Relaxed) {
            self.renegotiate(signal, offer).await?;
        }
        tracing::info!(event = "consumer-closed", consumer = %consumer_id);
        Ok(())
    }

    pub async fn close(&self) {
        self.closed.store(true, Ordering::Relaxed);
        self.consumers.lock().await.clear();
        let _ = self.pc.close().await;
    }
}

/// RTP stats flattened for the status page.
///
/// webrtc-rs never fills in the ICE candidate-pair round-trip time, so the
/// only media-path RTT is the one derived from mediasoup's RTCP Receiver
/// Reports for our producer. Those only arrive once we have sent RTP.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LinkStats {
    pub rtt_ms: Option<u32>,
    pub packet_loss_pct: Option<f32>,
    pub packets_lost: u64,
    pub packets_received: u64,
    /// RTCP RTT samples taken so far; grows when `rtt_ms` is refreshed.
    pub rtt_measurements: u64,
}

impl LinkStats {
    pub fn from_report(report: &webrtc::stats::StatsReport) -> Self {
        use webrtc::stats::StatsReportType;
        let mut rtts = Vec::new();
        let mut lost: u64 = 0;
        let mut received: u64 = 0;
        let mut rtt_measurements = 0;
        for item in report.reports.values() {
            if let StatsReportType::RemoteInboundRTP(remote) = item {
                lost += remote.packets_lost.max(0) as u64;
                received += remote.packets_received;
                rtt_measurements += remote.round_trip_time_measurements;
                // Already milliseconds in webrtc-rs, unlike the W3C field.
                if let Some(rtt) = remote.round_trip_time {
                    if rtt.is_finite() && rtt > 0.0 {
                        rtts.push(rtt as f32);
                    }
                }
            }
        }
        Self {
            rtt_ms: average_ms(&rtts),
            packet_loss_pct: loss_pct(lost, received),
            packets_lost: lost,
            packets_received: received,
            rtt_measurements,
        }
    }

    /// Receive-side counters taken from our own RTP sequence tracking.
    pub fn from_received(packets_received: u64, packets_lost: u64) -> Self {
        Self {
            packet_loss_pct: loss_pct(packets_lost, packets_received),
            packets_lost,
            packets_received,
            ..Self::default()
        }
    }

    pub fn merge(self, other: Self) -> Self {
        let rtts: Vec<f32> = [self.rtt_ms, other.rtt_ms]
            .into_iter()
            .flatten()
            .map(|ms| ms as f32)
            .collect();
        let packets_lost = self.packets_lost + other.packets_lost;
        let packets_received = self.packets_received + other.packets_received;
        Self {
            rtt_ms: average_ms(&rtts),
            packet_loss_pct: loss_pct(packets_lost, packets_received),
            packets_lost,
            packets_received,
            rtt_measurements: self.rtt_measurements + other.rtt_measurements,
        }
    }
}

fn average_ms(values: &[f32]) -> Option<u32> {
    if values.is_empty() {
        None
    } else {
        Some((values.iter().sum::<f32>() / values.len() as f32).round() as u32)
    }
}

fn loss_pct(lost: u64, received: u64) -> Option<f32> {
    let total = lost + received;
    if total == 0 {
        None
    } else {
        Some(((lost as f32) / (total as f32) * 1000.0).round() / 10.0)
    }
}

#[cfg(test)]
mod tests {
    use super::{opus_fmtp_line, LinkStats};
    use tokio::time::Instant;
    use webrtc::stats::{RTCStatsType, RemoteInboundRTPStats, StatsReport, StatsReportType};

    fn remote_inbound(rtt_ms: Option<f64>, received: u64, lost: i64) -> StatsReportType {
        StatsReportType::RemoteInboundRTP(RemoteInboundRTPStats {
            timestamp: Instant::now(),
            stats_type: RTCStatsType::RemoteInboundRTP,
            id: "remote".into(),
            ssrc: 1,
            kind: "audio".into(),
            packets_received: received,
            packets_lost: lost,
            local_id: "local".into(),
            round_trip_time: rtt_ms,
            total_round_trip_time: rtt_ms.unwrap_or(0.0),
            fraction_lost: 0.0,
            round_trip_time_measurements: u64::from(rtt_ms.is_some()),
        })
    }

    #[test]
    fn remote_inbound_rtt_is_already_milliseconds() {
        let mut report = StatsReport {
            reports: Default::default(),
        };
        report
            .reports
            .insert("remote".into(), remote_inbound(Some(23.4), 990, 10));
        let stats = LinkStats::from_report(&report);
        assert_eq!(stats.rtt_ms, Some(23));
        assert_eq!(stats.rtt_measurements, 1);
        assert_eq!(stats.packet_loss_pct, Some(1.0));
    }

    #[test]
    fn merge_weights_loss_by_packets_and_keeps_rtt() {
        let send = LinkStats {
            rtt_ms: Some(30),
            packet_loss_pct: Some(0.0),
            packets_lost: 0,
            packets_received: 900,
            rtt_measurements: 3,
        };
        let merged = send.merge(LinkStats::from_received(90, 10));
        assert_eq!(merged.rtt_ms, Some(30));
        assert_eq!(merged.packets_lost, 10);
        assert_eq!(merged.packets_received, 990);
        assert_eq!(merged.packet_loss_pct, Some(1.0));
        assert_eq!(LinkStats::from_received(0, 0).packet_loss_pct, None);
    }

    #[test]
    fn opus_fmtp_advertises_ptime_and_keeps_router_minptime() {
        assert_eq!(
            opus_fmtp_line(5, false),
            "minptime=10;useinbandfec=0;ptime=5"
        );
        assert_eq!(
            opus_fmtp_line(20, true),
            "minptime=10;useinbandfec=1;ptime=20"
        );
    }
}
