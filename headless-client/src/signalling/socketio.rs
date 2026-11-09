//! Minimal Socket.IO v4 client (Engine.IO v4, WebSocket transport only) for
//! the default namespace: JSON events, acknowledgements in both directions,
//! server-driven ping/pong. This is all the Talktome server uses.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::{HeaderValue, USER_AGENT};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::Connector;
use url::Url;

/// Something the server sent us.
#[derive(Debug)]
pub enum SocketEvent {
    /// Namespace connected; `sid` is the Socket.IO session id.
    Connected { sid: String },
    /// The server refused the namespace connection (bad auth, ...).
    ConnectError(Value),
    /// A named event with its arguments. `ack` is present when the server
    /// expects an acknowledgement.
    Event {
        name: String,
        args: Vec<Value>,
        ack: Option<AckResponder>,
    },
    /// The connection is gone; the client must be re-created.
    Disconnected(String),
}

/// Lets an event handler answer a server-side acknowledgement request.
#[derive(Debug)]
pub struct AckResponder {
    id: u64,
    tx: mpsc::Sender<Outgoing>,
}

impl AckResponder {
    pub async fn respond(self, args: Vec<Value>) {
        let _ = self.tx.send(Outgoing::Ack { id: self.id, args }).await;
    }
}

#[derive(Debug)]
enum Outgoing {
    Event {
        name: String,
        args: Vec<Value>,
        ack: Option<(u64, oneshot::Sender<Vec<Value>>)>,
    },
    Ack {
        id: u64,
        args: Vec<Value>,
    },
    Close,
}

/// Handle used to emit events. Cloneable; the connection lives in a task.
#[derive(Clone)]
pub struct SocketClient {
    tx: mpsc::Sender<Outgoing>,
    next_ack: Arc<AtomicU64>,
}

pub struct ConnectOptions {
    pub tls: Arc<rustls::ClientConfig>,
    /// Sent as the CONNECT payload (`auth` on the server side).
    pub auth: Value,
    pub connect_timeout: Duration,
}

/// Builds the Engine.IO WebSocket URL for a Talktome base URL.
pub fn websocket_url(base: &Url) -> Result<Url> {
    let mut url = base.clone();
    let scheme = match base.scheme() {
        "https" | "wss" => "wss",
        "http" | "ws" => "ws",
        other => bail!("unsupported URL scheme {other:?}"),
    };
    url.set_scheme(scheme)
        .map_err(|_| anyhow!("cannot set URL scheme"))?;
    url.set_path("/socket.io/");
    url.set_query(Some("EIO=4&transport=websocket"));
    url.set_fragment(None);
    Ok(url)
}

impl SocketClient {
    /// Connects, performs the Engine.IO open and Socket.IO CONNECT handshake
    /// and returns the client handle plus the event stream.
    pub async fn connect(
        base: &Url,
        options: ConnectOptions,
    ) -> Result<(SocketClient, mpsc::Receiver<SocketEvent>)> {
        let ws_url = websocket_url(base)?;
        let mut request = ws_url
            .as_str()
            .into_client_request()
            .context("building WebSocket request")?;
        request
            .headers_mut()
            .insert("Origin", base.as_str().trim_end_matches('/').parse()?);
        if let Ok(agent) = HeaderValue::from_str(&format!("talktome-headless/{}", crate::VERSION)) {
            request.headers_mut().insert(USER_AGENT, agent);
        }

        let connector = Connector::Rustls(options.tls.clone());
        let (stream, _response) = tokio::time::timeout(
            options.connect_timeout,
            tokio_tungstenite::connect_async_tls_with_config(request, None, false, Some(connector)),
        )
        .await
        .map_err(|_| anyhow!("WebSocket connect timed out"))?
        .context("WebSocket connect failed")?;

        let (out_tx, out_rx) = mpsc::channel::<Outgoing>(256);
        let (event_tx, event_rx) = mpsc::channel::<SocketEvent>(256);
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Vec<Value>>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let client = SocketClient {
            tx: out_tx.clone(),
            next_ack: Arc::new(AtomicU64::new(1)),
        };

        tokio::spawn(run_connection(
            stream,
            options.auth,
            out_tx,
            out_rx,
            event_tx,
            pending,
        ));

        Ok((client, event_rx))
    }

    /// Emits an event without waiting for an acknowledgement.
    pub async fn emit(&self, name: &str, args: Vec<Value>) -> Result<()> {
        self.tx
            .send(Outgoing::Event {
                name: name.to_string(),
                args,
                ack: None,
            })
            .await
            .map_err(|_| anyhow!("socket closed"))
    }

    /// Emits an event and waits for the server's acknowledgement arguments.
    pub async fn emit_with_ack(
        &self,
        name: &str,
        args: Vec<Value>,
        timeout: Duration,
    ) -> Result<Vec<Value>> {
        let id = self.next_ack.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(Outgoing::Event {
                name: name.to_string(),
                args,
                ack: Some((id, tx)),
            })
            .await
            .map_err(|_| anyhow!("socket closed"))?;
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(args)) => Ok(args),
            Ok(Err(_)) => bail!("socket closed while waiting for ack of {name}"),
            Err(_) => bail!("{name} acknowledgement timed out after {timeout:?}"),
        }
    }

    /// Convenience: emit with ack and return the first argument (or Null).
    /// Server errors of the form `{ "error": "..." }` become `Err`.
    pub async fn request(&self, name: &str, payload: Value, timeout: Duration) -> Result<Value> {
        let mut args = self.emit_with_ack(name, vec![payload], timeout).await?;
        let first = if args.is_empty() {
            Value::Null
        } else {
            args.remove(0)
        };
        if let Some(error) = first.get("error").and_then(Value::as_str) {
            bail!("{name} failed: {error}");
        }
        Ok(first)
    }

    /// Same as [`request`] but with no payload argument (`socket.emit(name, cb)`).
    pub async fn request_no_payload(&self, name: &str, timeout: Duration) -> Result<Value> {
        let mut args = self.emit_with_ack(name, vec![], timeout).await?;
        let first = if args.is_empty() {
            Value::Null
        } else {
            args.remove(0)
        };
        if let Some(error) = first.get("error").and_then(Value::as_str) {
            bail!("{name} failed: {error}");
        }
        Ok(first)
    }

    pub async fn close(&self) {
        let _ = self.tx.send(Outgoing::Close).await;
    }
}

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn run_connection(
    stream: WsStream,
    auth: Value,
    out_tx: mpsc::Sender<Outgoing>,
    mut out_rx: mpsc::Receiver<Outgoing>,
    event_tx: mpsc::Sender<SocketEvent>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Vec<Value>>>>>,
) {
    let (mut sink, mut source) = stream.split();
    let mut ping_interval = Duration::from_millis(25_000);
    let mut ping_timeout = Duration::from_millis(20_000);
    let mut opened = false;
    let mut connected = false;
    let mut last_ping = tokio::time::Instant::now();

    let reason = loop {
        let deadline = last_ping + ping_interval + ping_timeout;
        tokio::select! {
            incoming = source.next() => {
                let message = match incoming {
                    Some(Ok(message)) => message,
                    Some(Err(error)) => break format!("websocket error: {error}"),
                    None => break "websocket closed".to_string(),
                };
                let text = match message {
                    Message::Text(text) => text.to_string(),
                    Message::Binary(_) => continue,
                    Message::Ping(payload) => {
                        let _ = sink.send(Message::Pong(payload)).await;
                        continue;
                    }
                    Message::Pong(_) | Message::Frame(_) => continue,
                    Message::Close(frame) => {
                        break format!("closed by server: {}", frame.map(|f| f.reason.to_string()).unwrap_or_default());
                    }
                };
                let Some(kind) = text.chars().next() else { continue };
                let body = &text[1..];
                match kind {
                    '0' => {
                        opened = true;
                        last_ping = tokio::time::Instant::now();
                        if let Ok(open) = serde_json::from_str::<Value>(body) {
                            if let Some(ms) = open.get("pingInterval").and_then(Value::as_u64) {
                                ping_interval = Duration::from_millis(ms);
                            }
                            if let Some(ms) = open.get("pingTimeout").and_then(Value::as_u64) {
                                ping_timeout = Duration::from_millis(ms);
                            }
                        }
                        let connect = if auth.is_null() {
                            "40".to_string()
                        } else {
                            format!("40{}", auth)
                        };
                        if sink.send(Message::Text(connect.into())).await.is_err() {
                            break "failed to send CONNECT".to_string();
                        }
                    }
                    '2' => {
                        last_ping = tokio::time::Instant::now();
                        if sink.send(Message::Text("3".into())).await.is_err() {
                            break "failed to send pong".to_string();
                        }
                    }
                    '1' => break "engine.io close".to_string(),
                    '4' => {
                        if !opened {
                            continue;
                        }
                        match parse_socketio_packet(body) {
                            Some(Packet::Connect(payload)) => {
                                connected = true;
                                let sid = payload
                                    .get("sid")
                                    .and_then(Value::as_str)
                                    .unwrap_or_default()
                                    .to_string();
                                if event_tx.send(SocketEvent::Connected { sid }).await.is_err() {
                                    break "event receiver dropped".to_string();
                                }
                            }
                            Some(Packet::ConnectError(payload)) => {
                                let _ = event_tx.send(SocketEvent::ConnectError(payload)).await;
                                break "connect error".to_string();
                            }
                            Some(Packet::Disconnect) => break "namespace disconnect".to_string(),
                            Some(Packet::Event { id, mut args }) => {
                                if args.is_empty() {
                                    continue;
                                }
                                let name = match args.remove(0) {
                                    Value::String(name) => name,
                                    _ => continue,
                                };
                                let ack = id.map(|id| AckResponder { id, tx: out_tx.clone() });
                                if event_tx.send(SocketEvent::Event { name, args, ack }).await.is_err() {
                                    break "event receiver dropped".to_string();
                                }
                            }
                            Some(Packet::Ack { id, args }) => {
                                if let Some(waiter) = pending.lock().await.remove(&id) {
                                    let _ = waiter.send(args);
                                }
                            }
                            None => {
                                tracing::debug!(event = "socketio-unparsed", packet = %body);
                            }
                        }
                    }
                    _ => {}
                }
            }
            outgoing = out_rx.recv() => {
                let Some(outgoing) = outgoing else { break "client dropped".to_string() };
                match outgoing {
                    Outgoing::Event { name, args, ack } => {
                        if !connected {
                            // Drop the ack waiter; the caller sees a closed channel.
                            continue;
                        }
                        let mut payload = vec![Value::String(name)];
                        payload.extend(args);
                        let packet = match ack {
                            Some((id, waiter)) => {
                                pending.lock().await.insert(id, waiter);
                                format!("42{}{}", id, Value::Array(payload))
                            }
                            None => format!("42{}", Value::Array(payload)),
                        };
                        if sink.send(Message::Text(packet.into())).await.is_err() {
                            break "failed to send event".to_string();
                        }
                    }
                    Outgoing::Ack { id, args } => {
                        let packet = format!("43{}{}", id, Value::Array(args));
                        if sink.send(Message::Text(packet.into())).await.is_err() {
                            break "failed to send ack".to_string();
                        }
                    }
                    Outgoing::Close => {
                        let _ = sink.send(Message::Text("41".into())).await;
                        let _ = sink.send(Message::Close(None)).await;
                        break "closed by client".to_string();
                    }
                }
            }
            _ = tokio::time::sleep_until(deadline) => {
                break "ping timeout".to_string();
            }
        }
    };

    pending.lock().await.clear();
    let _ = event_tx.send(SocketEvent::Disconnected(reason)).await;
}

#[derive(Debug, PartialEq)]
enum Packet {
    Connect(Value),
    Disconnect,
    Event { id: Option<u64>, args: Vec<Value> },
    Ack { id: u64, args: Vec<Value> },
    ConnectError(Value),
}

/// Parses a Socket.IO packet (without the leading Engine.IO `4`).
fn parse_socketio_packet(body: &str) -> Option<Packet> {
    let mut chars = body.char_indices();
    let (_, kind) = chars.next()?;
    let mut rest = &body[1..];

    // Binary packets carry an attachment count: "<n>-". Talktome never
    // sends them; skip the prefix so the rest still parses.
    if kind == '5' || kind == '6' {
        if let Some(dash) = rest.find('-') {
            rest = &rest[dash + 1..];
        }
    }
    // Optional namespace ("/nsp,").
    if rest.starts_with('/') {
        let comma = rest.find(',')?;
        rest = &rest[comma + 1..];
    }
    // Optional ack id.
    let digits_end = rest
        .char_indices()
        .find(|(_, c)| !c.is_ascii_digit())
        .map(|(i, _)| i)
        .unwrap_or(rest.len());
    let id = if digits_end > 0 {
        rest[..digits_end].parse::<u64>().ok()
    } else {
        None
    };
    let payload = &rest[digits_end..];
    let json = if payload.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str::<Value>(payload).ok()?
    };

    match kind {
        '0' => Some(Packet::Connect(json)),
        '1' => Some(Packet::Disconnect),
        '2' | '5' => Some(Packet::Event {
            id,
            args: json.as_array().cloned().unwrap_or_default(),
        }),
        '3' | '6' => Some(Packet::Ack {
            id: id?,
            args: json.as_array().cloned().unwrap_or_default(),
        }),
        '4' => Some(Packet::ConnectError(json)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_connect_event_and_ack_packets() {
        assert_eq!(
            parse_socketio_packet(r#"0{"sid":"abc"}"#),
            Some(Packet::Connect(json!({ "sid": "abc" })))
        );
        assert_eq!(
            parse_socketio_packet(r#"2["cut-camera",true]"#),
            Some(Packet::Event {
                id: None,
                args: vec![json!("cut-camera"), json!(true)]
            })
        );
        assert_eq!(
            parse_socketio_packet(r#"2["cut-camera",{"productionId":1,"pgm":true,"prv":false}]"#),
            Some(Packet::Event {
                id: None,
                args: vec![
                    json!("cut-camera"),
                    json!({ "productionId": 1, "pgm": true, "prv": false })
                ]
            })
        );
        assert_eq!(
            parse_socketio_packet(r#"217["new-producer",{"producerId":"p"}]"#),
            Some(Packet::Event {
                id: Some(17),
                args: vec![json!("new-producer"), json!({ "producerId": "p" })]
            })
        );
        assert_eq!(
            parse_socketio_packet(r#"33[{"id":"t"}]"#),
            Some(Packet::Ack {
                id: 3,
                args: vec![json!({ "id": "t" })]
            })
        );
        assert_eq!(
            parse_socketio_packet(r#"4{"message":"Invalid"}"#),
            Some(Packet::ConnectError(json!({ "message": "Invalid" })))
        );
        assert_eq!(parse_socketio_packet("1"), Some(Packet::Disconnect));
        assert_eq!(
            parse_socketio_packet(r#"2/admin,5["x"]"#),
            Some(Packet::Event {
                id: Some(5),
                args: vec![json!("x")]
            })
        );
    }

    #[test]
    fn websocket_url_maps_schemes() {
        let url = websocket_url(&Url::parse("https://talktome.local:8443/").unwrap()).unwrap();
        assert_eq!(
            url.as_str(),
            "wss://talktome.local:8443/socket.io/?EIO=4&transport=websocket"
        );
        let url = websocket_url(&Url::parse("http://127.0.0.1:8080").unwrap()).unwrap();
        assert_eq!(
            url.as_str(),
            "ws://127.0.0.1:8080/socket.io/?EIO=4&transport=websocket"
        );
    }
}
