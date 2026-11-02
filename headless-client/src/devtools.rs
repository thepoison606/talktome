//! Installer/diagnostic commands: send a test tone to a target, record what
//! this user hears to a WAV file. They exercise the full signalling and
//! WebRTC path without any audio hardware.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::audio::codec::{OpusDecoder, OpusEncoder, SAMPLE_RATE};
use crate::config::Config;
use crate::rtc::types::{ProducerAnnouncement, RtpCapabilities};
use crate::rtc::{
    MediaFactory, RecvTransport, RtcEvent, RtcSettings, RxPacket, SendTransport, SIGNAL_TIMEOUT,
};
use crate::signalling::http::ServerApi;
use crate::signalling::socketio::{ConnectOptions, SocketClient, SocketEvent};
use crate::talk::TargetKey;

pub struct Connected {
    pub socket: SocketClient,
    pub events: mpsc::Receiver<SocketEvent>,
    pub router: RtpCapabilities,
}

/// Login, connect, register (taking over any existing session) and fetch
/// the router capabilities.
pub async fn connect_and_register(config: &Config) -> Result<Connected> {
    let tls = crate::tls::build_client_config(&config.tls)?;
    let api = ServerApi::new(config.server_url(), tls.clone())?;
    let login = api.login(&config.user.name, &config.user.password).await?;
    tracing::info!(event = "login", user = %login.user.name, id = login.user.id);

    let (socket, mut events) = SocketClient::connect(
        &config.server_url(),
        ConnectOptions {
            tls,
            auth: json!({ "token": login.token }),
            connect_timeout: Duration::from_secs(10),
        },
    )
    .await?;

    match tokio::time::timeout(Duration::from_secs(10), events.recv()).await {
        Ok(Some(SocketEvent::Connected { sid })) => {
            tracing::info!(event = "socket-connected", sid = %sid);
        }
        Ok(Some(SocketEvent::ConnectError(error))) => bail!("socket connect rejected: {error}"),
        Ok(other) => bail!("unexpected socket event during connect: {other:?}"),
        Err(_) => bail!("timed out waiting for socket connect"),
    }

    let ack = socket
        .request(
            "register-user",
            json!({
                "id": login.user.id,
                "name": login.user.name,
                "kind": "user",
                "force": true,
                "productionId": config.user.production,
                "clientType": crate::signalling::REGISTERED_CLIENT_TYPE,
            }),
            SIGNAL_TIMEOUT,
        )
        .await?;
    if ack.get("conflict").and_then(Value::as_bool) == Some(true) {
        bail!("registration conflict even with force: {ack}");
    }
    tracing::info!(event = "registered", user = %login.user.name);

    let router: RtpCapabilities = serde_json::from_value(
        socket
            .request_no_payload("get-router-rtp-capabilities", SIGNAL_TIMEOUT)
            .await?,
    )
    .context("parsing router rtp capabilities")?;

    Ok(Connected {
        socket,
        events,
        router,
    })
}

fn rtc_settings(config: &Config) -> RtcSettings {
    RtcSettings {
        ice_override: config.ice.clone(),
        tls: config.tls.clone(),
        disconnected_timeout: Duration::from_millis(config.network.ice_disconnect_grace_ms),
        failed_timeout: Duration::from_millis(config.network.ice_disconnect_grace_ms * 3),
        keepalive_interval: Duration::from_secs(2),
        opus_ptime_ms: config.audio.profile.frame_ms(),
        opus_inband_fec: config.audio.profile.fec(),
    }
}

/// Sends a sine tone to `target` for `seconds`.
pub async fn send_tone(
    config: &Config,
    target: TargetKey,
    seconds: u64,
    frequency: f32,
) -> Result<()> {
    let mut connected = connect_and_register(config).await?;
    let factory = MediaFactory::new(connected.router.clone(), rtc_settings(config))?;
    let (rtc_tx, mut rtc_rx) = mpsc::channel(64);
    let send = SendTransport::create(
        &factory,
        &connected.socket,
        rtc_tx,
        &format!("talktome-{}", config.instance),
    )
    .await?;

    connected
        .socket
        .emit(
            "talk-targets-updated",
            vec![json!({ "reason": "dev-send-tone", "targets": [target.to_talk_target()] })],
        )
        .await?;
    connected
        .socket
        .emit(
            "ptt-state",
            vec![json!({
                "talking": true,
                "lockActive": false,
                "target": target.to_talk_target(),
                "targets": [target.to_talk_target()],
                "reason": "dev-send-tone"
            })],
        )
        .await?;
    send.set_talking(&connected.socket, true).await?;
    tracing::info!(event = "talk-start", target = %target, seconds);

    let frame_ms = config.audio.profile.frame_ms();
    let mut encoder = OpusEncoder::new(
        frame_ms,
        config.audio.profile.bitrate(),
        config.audio.profile.fec(),
    )?;
    let frame_samples = encoder.frame_samples();
    let mut phase = 0f32;
    let step = frequency * std::f32::consts::TAU / SAMPLE_RATE as f32;
    let mut ticker = tokio::time::interval(Duration::from_millis(frame_ms as u64));
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    let mut frames = 0u64;
    let mut pcm = vec![0f32; frame_samples];

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                if tokio::time::Instant::now() >= deadline { break; }
                for sample in pcm.iter_mut() {
                    *sample = phase.sin() * 0.4;
                    phase += step;
                    if phase > std::f32::consts::TAU { phase -= std::f32::consts::TAU; }
                }
                let packet = encoder.encode(&pcm)?;
                send.write_frame(packet, Duration::from_millis(frame_ms as u64)).await?;
                frames += 1;
            }
            Some(event) = rtc_rx.recv() => log_rtc_event(&event),
            Some(event) = connected.events.recv() => {
                if let SocketEvent::Disconnected(reason) = &event {
                    bail!("socket disconnected: {reason}");
                }
                log_socket_event(&event);
            }
        }
    }

    tracing::info!(event = "talk-stop", frames);
    send.set_talking(&connected.socket, false).await?;
    connected
        .socket
        .emit(
            "talk-targets-updated",
            vec![json!({ "reason": "dev-send-tone", "targets": [] })],
        )
        .await?;
    connected
        .socket
        .emit(
            "ptt-state",
            vec![json!({ "talking": false, "lockActive": false, "target": null, "targets": [], "reason": "dev-send-tone" })],
        )
        .await?;
    send.close().await;
    let _ = connected.socket.emit("user-logout", vec![]).await;
    connected.socket.close().await;
    Ok(())
}

/// Records everything addressed to this user into a mono 48 kHz WAV file.
pub async fn record(config: &Config, output: &Path, seconds: u64) -> Result<()> {
    let mut connected = connect_and_register(config).await?;
    let factory = MediaFactory::new(connected.router.clone(), rtc_settings(config))?;
    let (rtc_tx, mut rtc_rx) = mpsc::channel(64);
    let (rx_tx, mut rx_packets) = mpsc::channel::<RxPacket>(512);
    let recv = RecvTransport::create(&factory, &connected.socket, rtc_tx, rx_tx).await?;

    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(output, spec)
        .with_context(|| format!("creating {}", output.display()))?;
    let mut decoders: std::collections::HashMap<String, OpusDecoder> = Default::default();
    let mut packets = 0u64;
    let mut written_samples = 0u64;

    let active = connected
        .socket
        .request_no_payload("request-active-producers", SIGNAL_TIMEOUT)
        .await?;
    let announcements: Vec<ProducerAnnouncement> =
        serde_json::from_value(active).unwrap_or_default();
    for announcement in announcements {
        if let Some(producer_id) = announcement.producer_id() {
            consume_announcement(
                &recv,
                &connected.socket,
                &factory,
                producer_id,
                &announcement,
            )
            .await;
        }
    }

    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    loop {
        tokio::select! {
            _ = tokio::time::sleep_until(deadline) => break,
            Some(packet) = rx_packets.recv() => {
                let decoder = match decoders.entry(packet.consumer_id.clone()) {
                    std::collections::hash_map::Entry::Occupied(e) => e.into_mut(),
                    std::collections::hash_map::Entry::Vacant(v) => v.insert(OpusDecoder::new()?),
                };
                let pcm = decoder.decode(&packet.payload, false)?;
                for sample in pcm {
                    writer.write_sample((sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)?;
                }
                written_samples += pcm.len() as u64;
                packets += 1;
                if packets.is_multiple_of(250) {
                    tracing::info!(event = "recording", packets, seconds_recorded = written_samples as f64 / SAMPLE_RATE as f64);
                }
            }
            Some(event) = rtc_rx.recv() => log_rtc_event(&event),
            Some(event) = connected.events.recv() => {
                match &event {
                    SocketEvent::Disconnected(reason) => bail!("socket disconnected: {reason}"),
                    SocketEvent::Event { name, args, .. } if name == "new-producer" => {
                        if let Ok(announcement) = serde_json::from_value::<ProducerAnnouncement>(args.first().cloned().unwrap_or(Value::Null)) {
                            if let Some(producer_id) = announcement.producer_id() {
                                consume_announcement(&recv, &connected.socket, &factory, producer_id, &announcement).await;
                            }
                        }
                    }
                    SocketEvent::Event { name, args, .. } if name == "producer-closed" => {
                        if let Ok(announcement) = serde_json::from_value::<ProducerAnnouncement>(args.first().cloned().unwrap_or(Value::Null)) {
                            if let Some(producer_id) = announcement.producer_id() {
                                if let Some(consumer_id) = recv.has_consumer_for_producer(producer_id).await {
                                    let _ = recv.close_consumer(&connected.socket, &consumer_id, true).await;
                                }
                            }
                        }
                    }
                    SocketEvent::Event { name, args, .. } if name == "consumer-closed" => {
                        if let Some(consumer_id) = args.first().and_then(|a| a.get("consumerId")).and_then(Value::as_str) {
                            let _ = recv.close_consumer(&connected.socket, consumer_id, false).await;
                        }
                    }
                    other => log_socket_event(other),
                }
            }
        }
    }

    writer.finalize()?;
    tracing::info!(event = "recording-done", packets, seconds_recorded = written_samples as f64 / SAMPLE_RATE as f64, file = %output.display());
    recv.close().await;
    let _ = connected.socket.emit("user-logout", vec![]).await;
    connected.socket.close().await;
    if packets == 0 {
        bail!("no audio packets were received");
    }
    Ok(())
}

async fn consume_announcement(
    recv: &Arc<RecvTransport>,
    socket: &SocketClient,
    factory: &MediaFactory,
    producer_id: &str,
    announcement: &ProducerAnnouncement,
) {
    if recv.has_consumer_for_producer(producer_id).await.is_some() {
        return;
    }
    tracing::info!(
        event = "new-producer",
        producer = %producer_id,
        kind = announcement.app_type().unwrap_or("?"),
        id = announcement.app_id().unwrap_or_default(),
    );
    if let Err(error) = recv.consume(socket, factory, producer_id).await {
        tracing::warn!(event = "consume-failed", producer = %producer_id, error = %error);
    }
}

fn log_rtc_event(event: &RtcEvent) {
    match event {
        RtcEvent::IceState { direction, state } => {
            tracing::info!(event = "ice-state", direction = ?direction, state = %state)
        }
        RtcEvent::PeerState { direction, state } => {
            tracing::info!(event = "peer-state", direction = ?direction, state = %state)
        }
        RtcEvent::ConsumerTrack { consumer_id, ssrc } => {
            tracing::info!(event = "consumer-track", consumer = %consumer_id, ssrc)
        }
    }
}

fn log_socket_event(event: &SocketEvent) {
    match event {
        SocketEvent::Event { name, args, .. } => {
            let summary = args
                .first()
                .map(|a| {
                    let text = a.to_string();
                    if text.len() > 200 {
                        format!("{}…", &text[..200])
                    } else {
                        text
                    }
                })
                .unwrap_or_default();
            tracing::debug!(event = "socket-event", name = %name, payload = %summary);
        }
        other => tracing::debug!(event = "socket-event", detail = ?other),
    }
}

pub fn parse_target(text: &str) -> Result<TargetKey> {
    TargetKey::parse(text)
        .ok_or_else(|| anyhow!("target must look like user:4 or conference:1, got {text:?}"))
}
