//! systemd notify/watchdog integration and the optional `/healthz` listener.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::watch;

use crate::state::{ConnectionState, Snapshot};

/// Sends READY, periodic WATCHDOG pings and STATUS updates to systemd when
/// running under it (no-op otherwise).
pub async fn run_sd_notify(
    mut snapshots: watch::Receiver<Arc<Snapshot>>,
    mut shutdown: watch::Receiver<bool>,
) {
    let notify_available = std::env::var_os("NOTIFY_SOCKET").is_some();
    if !notify_available {
        return;
    }
    let _ = sd_notify::notify(&[sd_notify::NotifyState::Ready]);
    let watchdog = sd_notify::watchdog_enabled()
        .map(|interval| (interval / 2).max(Duration::from_secs(1)))
        .unwrap_or(Duration::from_secs(10));
    let mut ticker = tokio::time::interval(watchdog);
    let mut last_status = String::new();
    loop {
        tokio::select! {
            _ = ticker.tick() => {
                let _ = sd_notify::notify(&[sd_notify::NotifyState::Watchdog]);
            }
            changed = snapshots.changed() => {
                if changed.is_err() { break; }
                let snapshot = snapshots.borrow().clone();
                let status = status_line(&snapshot);
                if status != last_status {
                    let _ = sd_notify::notify(&[sd_notify::NotifyState::Status(&status)]);
                    last_status = status;
                }
            }
            _ = shutdown.changed() => {
                if *shutdown.borrow() {
                    let _ = sd_notify::notify(&[sd_notify::NotifyState::Stopping]);
                    break;
                }
            }
        }
    }
}

pub fn status_line(snapshot: &Snapshot) -> String {
    let mut parts = vec![format!(
        "{} as {}",
        snapshot.connection.label(),
        snapshot.user_name
    )];
    if snapshot.talking {
        parts.push("talking".into());
    }
    if let Some(tally) = snapshot.tally_label() {
        parts.push(tally.into());
    }
    if snapshot.server_not_responding {
        parts.push("server not responding".into());
    }
    if !snapshot.audio_ok {
        parts.push("no audio device".into());
    }
    if !snapshot.detail.is_empty() {
        parts.push(snapshot.detail.clone());
    }
    parts.join(", ")
}

pub fn health_body(snapshot: &Snapshot) -> (u16, String) {
    let healthy = snapshot.connection == ConnectionState::Ready
        && snapshot.audio_ok
        && !snapshot.server_not_responding;
    let body = serde_json::json!({
        "ok": healthy,
        "instance": snapshot.instance,
        "user": snapshot.user_name,
        "connection": snapshot.connection,
        "detail": snapshot.detail,
        "server_not_responding": snapshot.server_not_responding,
        "heartbeat": snapshot.heartbeat,
        "audio_ok": snapshot.audio_ok,
        "talking": snapshot.talking,
        "on_air": snapshot.on_air,
        "preview": snapshot.preview,
        "targets": snapshot.targets.len(),
    });
    (if healthy { 200 } else { 503 }, body.to_string())
}

/// Minimal HTTP/1.1 responder for `GET /healthz`.
pub async fn run_healthz(
    bind: &str,
    port: u16,
    snapshots: watch::Receiver<Arc<Snapshot>>,
    mut shutdown: watch::Receiver<bool>,
) -> Result<()> {
    let listener = TcpListener::bind((bind, port))
        .await
        .with_context(|| format!("binding health listener on {bind}:{port}"))?;
    tracing::info!(event = "healthz-listening", bind, port);
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let Ok((mut stream, _)) = accepted else { continue };
                let snapshot = snapshots.borrow().clone();
                tokio::spawn(async move {
                    let mut buffer = [0u8; 1024];
                    let _ = tokio::time::timeout(Duration::from_secs(2), stream.read(&mut buffer)).await;
                    let (status, body) = health_body(&snapshot);
                    let reason = if status == 200 { "OK" } else { "Service Unavailable" };
                    let response = format!(
                        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                    let _ = stream.shutdown().await;
                });
            }
            _ = shutdown.changed() => {
                if *shutdown.borrow() { break; }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_reflects_readiness() {
        let mut snapshot = Snapshot::initial("cam1", "Cam 1");
        let (status, body) = health_body(&snapshot);
        assert_eq!(status, 503);
        assert!(body.contains("\"ok\":false"));
        snapshot.connection = ConnectionState::Ready;
        snapshot.audio_ok = true;
        snapshot.on_air = true;
        let (status, _) = health_body(&snapshot);
        assert_eq!(status, 200);
        assert_eq!(status_line(&snapshot), "ready as Cam 1, ON AIR");
        snapshot.on_air = false;
        snapshot.preview = true;
        assert_eq!(status_line(&snapshot), "ready as Cam 1, PREVIEW");
        snapshot.on_air = true;
        assert_eq!(status_line(&snapshot), "ready as Cam 1, ON AIR");
        snapshot.server_not_responding = true;
        snapshot.heartbeat = "missing".into();
        let (status, body) = health_body(&snapshot);
        assert_eq!(status, 503);
        assert!(body.contains("\"server_not_responding\":true"));
        assert_eq!(
            status_line(&snapshot),
            "ready as Cam 1, ON AIR, server not responding"
        );
        snapshot.server_not_responding = false;
        let (_, body) = health_body(&snapshot);
        assert!(body.contains("\"on_air\":true"));
        assert!(body.contains("\"preview\":true"));
    }
}
