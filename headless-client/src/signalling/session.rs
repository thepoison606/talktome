//! The session orchestrator: keeps one Talktome user registered, owns the
//! WebRTC transports, applies talk/audio commands from surfaces and
//! Companion, and publishes state snapshots.

use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use rand::Rng;
use serde_json::{json, Value};
use tokio::sync::{mpsc, watch};

use super::alerts::{Announcement, ConnectionAlerts, ProbeReply};
use super::http::{LoginResponse, ServerApi, TargetEntry};
use super::panel::{self, ConfigPatch, LocalAudio, PanelSettings};
use super::socketio::{ConnectOptions, SocketClient, SocketEvent};
use crate::audio::codec::OpusEncoder;
use crate::audio::io::{is_virtual_device, AudioStatus, DeviceSwitch};
use crate::audio::mixer::Mixer;
use crate::audio::processing::{ProcessingControl, UserAudioPatch};
use crate::audio::vox::{peak_db, LevelTrigger};
use crate::config::{Config, ConflictPolicy};
use crate::rtc::types::{ProducerAnnouncement, RtpCapabilities};
use crate::rtc::{
    Direction, MediaFactory, RecvTransport, RtcEvent, RtcSettings, RxPacket, SendTransport,
    SIGNAL_TIMEOUT,
};
use crate::state::{
    Command, ConnectionState, IncomingInfo, InputSource, ProductionInfo, Snapshot, TargetInfo,
    TargetRef,
};
use crate::talk::{AudioState, TalkChange, TalkModel, TargetKey};
use webrtc::ice_transport::ice_connection_state::RTCIceConnectionState;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;

const ACTIVE_PRODUCER_SYNC: Duration = Duration::from_secs(10);
const SNAPSHOT_DEBOUNCE: Duration = Duration::from_millis(200);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
const MAX_IDLE_RECV_SECTIONS: usize = 32;
/// Matches the web client; the server treats stats older than 15 s as stale.
const NETWORK_REPORT_INTERVAL: Duration = Duration::from_secs(5);
/// RTCP RTT stays authoritative this long after the last Receiver Report.
const MEDIA_RTT_FRESH: Duration = Duration::from_secs(10);
const SIGNALLING_RTT_SMOOTHING: f32 = 0.2;
/// ALSA device list reused across remote panel reports (one every 2 s).
const PANEL_DEVICES_MAX_AGE: Duration = Duration::from_secs(30);

/// Inputs shared with the audio thread and surfaces.
pub struct SessionIo {
    pub commands: mpsc::Receiver<Command>,
    pub snapshots: watch::Sender<Arc<Snapshot>>,
    pub mixer: Arc<Mutex<Mixer>>,
    pub frames: mpsc::Receiver<Vec<f32>>,
    pub audio_status: watch::Receiver<AudioStatus>,
    pub processing: Arc<ProcessingControl>,
    pub audio_devices: DeviceSwitch,
    pub shutdown: watch::Receiver<bool>,
}

#[derive(Debug, Clone)]
struct Target {
    key: TargetKey,
    name: String,
    can_talk: bool,
    members: Vec<(i64, String)>,
}

struct Media {
    factory: MediaFactory,
    send: SendTransport,
    recv: Arc<RecvTransport>,
    send_state: RTCPeerConnectionState,
    recv_state: RTCPeerConnectionState,
    /// consumer id -> target key
    consumers: HashMap<String, TargetKey>,
    /// producer id -> consumer id
    producers: HashMap<String, String>,
    /// Transport state events for this media generation only.
    rtc_rx: mpsc::Receiver<RtcEvent>,
}

struct Connected {
    socket: SocketClient,
    events: mpsc::Receiver<SocketEvent>,
    user_id: i64,
    user_name: String,
    production_id: Option<Value>,
    media: Option<Media>,
}

enum Event {
    Socket(SocketEvent),
    Rtc(RtcEvent),
    Rx(RxPacket),
    Command(Command),
    Frame(Vec<f32>),
    AudioStatus,
    Tick,
    Shutdown,
    Probe(ProbeReply),
}

/// Why the connected loop ended.
enum Exit {
    Disconnected(String),
    Kicked,
    Shutdown,
}

pub struct Session {
    config: Arc<Config>,
    io: SessionIo,
    api: ServerApi,
    token: Option<(String, Instant)>,
    login: Option<LoginResponse>,
    encoder: OpusEncoder,
    frame_duration: Duration,
    talk: TalkModel,
    audio: AudioState,
    vox: Option<LevelTrigger>,
    targets: Vec<Target>,
    online_users: BTreeSet<i64>,
    incoming: Vec<IncomingInfo>,
    incoming_keys: BTreeSet<TargetKey>,
    last_caller: Option<String>,
    on_air: bool,
    preview: bool,
    server_version: Option<String>,
    connection: ConnectionState,
    detail: String,
    input_level_db: f32,
    rx_tx: mpsc::Sender<RxPacket>,
    rx_rx: mpsc::Receiver<RxPacket>,
    snapshot_dirty: bool,
    last_snapshot: Instant,
    audio_state_dirty: bool,
    last_audio_snapshot: Instant,
    backoff: Duration,
    healthy_since: Option<Instant>,
    /// Server-side state we cannot send while disconnected; flushed on reconnect.
    pending_talk_change: Option<TalkChange>,
    registered_since: Option<std::time::SystemTime>,
    reconnects: u32,
    /// Details of the current transports for the status page.
    media_info: Option<crate::state::MediaInfo>,
    alerts: ConnectionAlerts,
    probe_tx: mpsc::Sender<ProbeReply>,
    probe_rx: mpsc::Receiver<ProbeReply>,
    /// Smoothed `connection-health` round trip, the RTT while not talking.
    signalling_rtt_ms: Option<f32>,
    /// Last RTCP RTT and when it was measured.
    media_rtt: Option<(u32, Instant)>,
    media_rtt_measurements: u64,
    /// Disconnect / reconnect tones. Starts from config and follows a live
    /// `playConnectionSounds` admin update.
    play_connection_sounds: bool,
    /// Admin remote panel revision and stored preferences.
    panel: PanelSettings,
    /// Cached ALSA devices for panel reports and when they were listed.
    panel_devices: Option<(Vec<Value>, Instant)>,
    /// Configuration file that remote VOX / lock / profile changes are saved to.
    config_path: Option<PathBuf>,
    /// Last per-user audio settings from the server.
    server_audio: Value,
    dim_db: f32,
    dim_feeds_while_speaking: bool,
    dim_when_addressed: bool,
    vox_threshold_db: f32,
    /// Codec profile in the configuration file; the running one changes on restart.
    saved_profile: String,
    /// ALSA devices in use; the remote panel can switch them while running.
    input_device: Option<String>,
    output_device: Option<String>,
    /// Wanted production (`user.production`); the remote panel can change it.
    production: Option<String>,
    /// Production the server put this client in (its default when none is
    /// configured), for1 the status key and production page.
    active_production: Option<String>,
}

impl Session {
    pub fn new(config: Arc<Config>, config_path: Option<PathBuf>, io: SessionIo) -> Result<Self> {
        let tls = crate::tls::build_client_config(&config.tls)?;
        let api = ServerApi::new(config.server_url(), tls)?;
        let profile = config.audio.profile;
        let encoder = OpusEncoder::new(profile.frame_ms(), profile.bitrate(), profile.fec())?;
        let mut talk = TalkModel::new(config.talk.tap_ms, config.talk.lock_multiple);
        talk.set_main_target(
            config
                .talk
                .main_target
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .and_then(TargetKey::parse),
        );
        let vox = if config.vox.enabled {
            talk.set_vox_target(config.vox.target.as_deref().and_then(TargetKey::parse));
            Some(LevelTrigger::new(
                config.vox.threshold_db,
                config.vox.hang_ms,
            ))
        } else {
            None
        };
        let audio = AudioState::load(&config.state_dir(), config.audio.default_volume_linear());
        if let Ok(mut mixer) = io.mixer.lock() {
            for (key, level) in audio.iter_levels() {
                mixer.set_level(key, level);
            }
            for ((conference_id, user_id), level) in audio.iter_members() {
                mixer.set_member_level(conference_id, user_id, level);
            }
        }
        let (rx_tx, rx_rx) = mpsc::channel(1024);
        let (probe_tx, probe_rx) = mpsc::channel(32);
        let play_connection_sounds = config.audio.play_connection_sounds;
        let dim_db = config.audio.dim_db;
        let dim_feeds_while_speaking = config.audio.dim_feeds_while_speaking;
        let dim_when_addressed = config.audio.dim_when_addressed;
        let vox_threshold_db = config.vox.threshold_db;
        let production = config.user.production.clone();
        let input_device = config.audio.input_device.clone();
        let output_device = config.audio.output_device.clone();
        Ok(Self {
            frame_duration: Duration::from_millis(profile.frame_ms() as u64),
            config,
            io,
            api,
            token: None,
            login: None,
            encoder,
            talk,
            audio,
            vox,
            targets: Vec::new(),
            online_users: BTreeSet::new(),
            incoming: Vec::new(),
            incoming_keys: BTreeSet::new(),
            last_caller: None,
            on_air: false,
            preview: false,
            server_version: None,
            connection: ConnectionState::Disconnected,
            detail: String::new(),
            input_level_db: -120.0,
            rx_tx,
            rx_rx,
            snapshot_dirty: true,
            last_snapshot: Instant::now() - SNAPSHOT_DEBOUNCE,
            audio_state_dirty: false,
            last_audio_snapshot: Instant::now(),
            backoff: Duration::from_secs(1),
            healthy_since: None,
            pending_talk_change: None,
            registered_since: None,
            reconnects: 0,
            media_info: None,
            alerts: ConnectionAlerts::new(),
            probe_tx,
            probe_rx,
            signalling_rtt_ms: None,
            media_rtt: None,
            media_rtt_measurements: 0,
            play_connection_sounds,
            panel: PanelSettings::default(),
            panel_devices: None,
            config_path,
            server_audio: json!({}),
            dim_db,
            dim_feeds_while_speaking,
            dim_when_addressed,
            vox_threshold_db,
            input_device,
            output_device,
            production,
            active_production: None,
            saved_profile: serde_json::to_value(profile)
                .ok()
                .and_then(|p| p.as_str().map(str::to_string))
                .unwrap_or_else(|| "ultra-low".into()),
        })
    }

    /// Runs until shutdown is requested.
    pub async fn run(mut self) -> Result<()> {
        loop {
            if *self.io.shutdown.borrow() {
                break;
            }
            self.set_connection(ConnectionState::Connecting, "");
            self.publish(true);

            let mut shutdown = self.io.shutdown.clone();
            let attempt = tokio::select! {
                result = self.connect() => result,
                _ = wait_true(&mut shutdown) => break,
            };

            match attempt {
                Ok(connected) => {
                    self.backoff = Duration::from_secs(1);
                    self.healthy_since = Some(Instant::now());
                    if self.registered_since.is_some() {
                        self.reconnects += 1;
                    }
                    self.registered_since = Some(std::time::SystemTime::now());
                    match self.run_connected(connected).await {
                        Exit::Shutdown => break,
                        Exit::Kicked => {
                            self.set_connection(ConnectionState::Kicked, "session taken over");
                            self.publish(true);
                            let delay =
                                Duration::from_millis(self.config.registration.kicked_retry_ms);
                            if self.sleep_or_shutdown(delay).await {
                                break;
                            }
                        }
                        Exit::Disconnected(reason) => {
                            tracing::warn!(event = "socket-disconnected", reason = %reason);
                            self.set_connection(ConnectionState::Disconnected, &reason);
                            self.publish(true);
                            let healthy = self
                                .healthy_since
                                .map(|t| t.elapsed() > Duration::from_secs(60))
                                .unwrap_or(false);
                            if healthy {
                                self.backoff = Duration::from_secs(1);
                            }
                            let delay = self.next_backoff();
                            if self.sleep_or_shutdown(delay).await {
                                break;
                            }
                        }
                    }
                }
                Err(error) => {
                    tracing::warn!(event = "connect-failed", error = %format!("{error:#}"));
                    self.set_connection(ConnectionState::Disconnected, &format!("{error:#}"));
                    self.publish(true);
                    let delay = self.next_backoff();
                    if self.sleep_or_shutdown(delay).await {
                        break;
                    }
                }
            }
        }
        tracing::info!(event = "client-stop");
        self.set_connection(ConnectionState::Disconnected, "shutting down");
        self.publish(true);
        let _ = self.audio.save();
        Ok(())
    }

    fn next_backoff(&mut self) -> Duration {
        let jitter = rand::rng().random_range(0..500);
        let delay = self.backoff + Duration::from_millis(jitter);
        self.backoff = (self.backoff * 2).min(MAX_BACKOFF);
        delay
    }

    /// Sleeps while draining commands; returns true when shutdown was requested.
    async fn sleep_or_shutdown(&mut self, delay: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + delay;
        loop {
            let mut shutdown = self.io.shutdown.clone();
            tokio::select! {
                _ = tokio::time::sleep_until(deadline) => return false,
                _ = wait_true(&mut shutdown) => return true,
                Some(command) = self.io.commands.recv() => {
                    if matches!(command, Command::Shutdown) { return true; }
                    self.handle_offline_command(command);
                }
                Some(frame) = self.io.frames.recv() => {
                    self.input_level_db = peak_db(&frame);
                }
                _ = self.io.audio_status.changed() => { self.snapshot_dirty = true; }
                _ = tokio::time::sleep(SNAPSHOT_DEBOUNCE) => { self.publish(false); }
            }
        }
    }

    fn handle_offline_command(&mut self, command: Command) {
        match command {
            Command::MuteToggle(key) => {
                let level = self.audio.toggle_mute(key);
                self.apply_level(key, level);
            }
            Command::VolumeStep { target, delta } => {
                let level = self.audio.step_volume(target, delta);
                self.apply_level(target, level);
            }
            Command::VolumeSet { target, volume } => {
                let level = self.audio.set_volume(target, volume);
                self.apply_level(target, level);
            }
            Command::MemberVolumeSet {
                conference: TargetKey::Conference(conference_id),
                user_id,
                volume,
            } => {
                let level = self.audio.set_member_volume(conference_id, user_id, volume);
                self.apply_member_level(conference_id, user_id, level);
            }
            Command::MemberMuteToggle {
                conference: TargetKey::Conference(conference_id),
                user_id,
            } => {
                let level = self.audio.toggle_member_mute(conference_id, user_id);
                self.apply_member_level(conference_id, user_id, level);
            }
            Command::MemberVolumeSet { .. } | Command::MemberMuteToggle { .. } => {}
            Command::TalkPress { source, target } => {
                if !self.target_is_talkable(target) {
                    self.detail = "user offline".into();
                    self.snapshot_dirty = true;
                    return;
                }
                if let Some(change) = self.talk.press(source, target, Instant::now()) {
                    self.pending_talk_change = Some(change);
                    self.snapshot_dirty = true;
                } else {
                    self.detail = "no target".into();
                    self.snapshot_dirty = true;
                }
            }
            Command::TalkRelease { source, target } => {
                if let Some(change) = self.talk.release(source, target, Instant::now()) {
                    self.pending_talk_change = Some(change);
                    self.snapshot_dirty = true;
                }
            }
            Command::LockToggle { target } => {
                if !self.target_is_talkable(target) {
                    self.detail = "user offline".into();
                    self.snapshot_dirty = true;
                    return;
                }
                if let Some(change) = self.talk.toggle_lock(target) {
                    self.pending_talk_change = Some(change);
                    self.snapshot_dirty = true;
                }
            }
            Command::ClearLocks => {
                let change = self.talk.clear_locks();
                self.pending_talk_change = Some(change);
                self.snapshot_dirty = true;
            }
            // Used on the next registration.
            Command::SetProduction(id) => self.save_production(&id),
            Command::Refresh => self.snapshot_dirty = true,
            _ => {}
        }
    }

    // ------------------------------------------------------------------
    // Connecting
    // ------------------------------------------------------------------

    async fn ensure_token(&mut self) -> Result<String> {
        if let Some((token, expires)) = &self.token {
            if Instant::now() + Duration::from_secs(60) < *expires {
                return Ok(token.clone());
            }
        }
        self.set_connection(ConnectionState::LoggingIn, "");
        self.publish(true);
        let login = self
            .api
            .login(&self.config.user.name, &self.config.user.password)
            .await
            .map_err(|e| {
                tracing::warn!(event = "login-failed", error = %e);
                e
            })?;
        tracing::info!(event = "login", user = %login.user.name, id = login.user.id);
        let ttl = login
            .expires_in_ms
            .map(Duration::from_millis)
            .unwrap_or(Duration::from_secs(12 * 3600));
        self.token = Some((login.token.clone(), Instant::now() + ttl));
        let token = login.token.clone();
        self.login = Some(login);
        Ok(token)
    }

    fn resolve_production(&self) -> Option<Value> {
        let wanted = self.production.as_deref()?.trim();
        if wanted.is_empty() {
            return None;
        }
        let productions = self
            .login
            .as_ref()
            .map(|l| l.productions.as_slice())
            .unwrap_or(&[]);
        for production in productions {
            let Some(id_text) = production_id_text(&production.id) else {
                continue;
            };
            if id_text == wanted || production.name.eq_ignore_ascii_case(wanted) {
                return Some(production.id.clone());
            }
        }
        tracing::warn!(event = "production-not-found", production = wanted);
        wanted.parse::<i64>().ok().map(Value::from)
    }

    async fn connect(&mut self) -> Result<Connected> {
        let token = self.ensure_token().await?;
        if let Some(version) = self.api.server_app_version().await {
            if self.server_version.as_deref() != Some(version.as_str()) {
                tracing::info!(event = "server-version", version = %version);
                self.server_version = Some(version);
                self.snapshot_dirty = true;
            }
        }
        let login = self
            .login
            .clone()
            .ok_or_else(|| anyhow!("missing login state"))?;
        self.set_connection(ConnectionState::Connecting, "");
        self.publish(true);

        let tls = crate::tls::build_client_config(&self.config.tls)?;
        let (socket, mut events) = SocketClient::connect(
            &self.config.server_url(),
            ConnectOptions {
                tls,
                auth: json!({ "token": token }),
                connect_timeout: Duration::from_secs(10),
            },
        )
        .await?;

        match tokio::time::timeout(Duration::from_secs(10), events.recv()).await {
            Ok(Some(SocketEvent::Connected { sid })) => {
                tracing::info!(event = "socket-connected", sid = %sid);
            }
            Ok(Some(SocketEvent::ConnectError(error))) => {
                self.token = None;
                bail!("socket connect rejected: {error}");
            }
            Ok(Some(SocketEvent::Disconnected(reason))) => {
                bail!("socket closed during connect: {reason}")
            }
            Ok(other) => bail!("unexpected event during connect: {other:?}"),
            Err(_) => bail!("timed out waiting for socket connect"),
        }

        let production_id = self.resolve_production();
        let mut connected = Connected {
            socket,
            events,
            user_id: login.user.id,
            user_name: login.user.name.clone(),
            production_id,
            media: None,
        };

        self.register(&mut connected).await?;
        Ok(connected)
    }

    async fn register(&mut self, connected: &mut Connected) -> Result<()> {
        self.set_connection(ConnectionState::Registering, "");
        self.publish(true);
        let mut force = false;
        loop {
            let ack = connected
                .socket
                .request(
                    "register-user",
                    json!({
                        "id": connected.user_id,
                        "name": connected.user_name,
                        "kind": "user",
                        "force": force,
                        "productionId": connected.production_id,
                        "clientType": super::REGISTERED_CLIENT_TYPE,
                    }),
                    SIGNAL_TIMEOUT,
                )
                .await
                .inspect_err(|error| {
                    let text = error.to_string();
                    if text.contains("identity") || text.contains("Authenticated") {
                        self.token = None;
                    }
                    tracing::warn!(event = "registration-error", error = %text);
                })?;
            if ack.get("conflict").and_then(Value::as_bool) == Some(true) {
                let existing = ack
                    .get("existing")
                    .and_then(|e| e.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or("another session");
                tracing::warn!(event = "registration-conflict", existing, policy = ?self.config.registration.conflict);
                match self.config.registration.conflict {
                    ConflictPolicy::Takeover => {
                        if force {
                            bail!("registration conflict persists even with force");
                        }
                        self.set_connection(
                            ConnectionState::Conflict,
                            &format!("taking over from {existing}"),
                        );
                        self.publish(true);
                        tokio::time::sleep(Duration::from_millis(
                            self.config.registration.takeover_delay_ms,
                        ))
                        .await;
                        force = true;
                        continue;
                    }
                    ConflictPolicy::Wait => {
                        self.set_connection(
                            ConnectionState::Conflict,
                            &format!("account in use by {existing}"),
                        );
                        self.publish(true);
                        let retry = Duration::from_millis(self.config.registration.retry_ms);
                        // Keep the socket alive while waiting; a disconnect ends the wait.
                        tokio::select! {
                            _ = tokio::time::sleep(retry) => {}
                            event = connected.events.recv() => {
                                if let Some(SocketEvent::Disconnected(reason)) = event {
                                    bail!("socket disconnected while waiting for the account: {reason}");
                                }
                            }
                        }
                        continue;
                    }
                }
            }
            tracing::info!(event = "registered", user = %connected.user_name, id = connected.user_id);
            // Server-saved settings win for processing and dimming; VOX,
            // lock-multiple and the codec profile come from the configuration.
            let server_audio = ack.get("userAudioSettings").filter(|s| s.is_object());
            if let Some(settings) = server_audio {
                self.apply_user_audio_settings(settings, false);
            }
            if let Some(id) = ack.get("productionId").and_then(production_id_text) {
                connected.production_id = ack.get("productionId").cloned();
                self.active_production = Some(id);
            }
            self.panel = ack
                .get("panelSettings")
                .and_then(PanelSettings::from_json)
                .unwrap_or_default();
            self.set_connection(ConnectionState::Registered, "");
            self.publish(true);
            let server_audio = server_audio.cloned();
            self.push_audio_settings(connected, server_audio.as_ref())
                .await;
            return Ok(());
        }
    }

    // ------------------------------------------------------------------
    // Media
    // ------------------------------------------------------------------

    fn rtc_settings(&self) -> RtcSettings {
        let grace = Duration::from_millis(self.config.network.ice_disconnect_grace_ms.max(1000));
        RtcSettings {
            ice_override: self.config.ice.clone(),
            tls: self.config.tls.clone(),
            disconnected_timeout: grace,
            failed_timeout: grace * 3,
            keepalive_interval: Duration::from_secs(2),
            opus_ptime_ms: self.config.audio.profile.frame_ms(),
            opus_inband_fec: self.config.audio.profile.fec(),
        }
    }

    async fn setup_media(&mut self, connected: &mut Connected) -> Result<()> {
        if let Some(media) = connected.media.take() {
            media.send.close().await;
            media.recv.close().await;
        }
        if let Ok(mut mixer) = self.io.mixer.lock() {
            mixer.clear_sources();
        }
        let router: RtpCapabilities = serde_json::from_value(
            connected
                .socket
                .request_no_payload("get-router-rtp-capabilities", SIGNAL_TIMEOUT)
                .await?,
        )
        .context("parsing router capabilities")?;
        let factory = MediaFactory::new(router, self.rtc_settings())?;
        let (rtc_tx, rtc_rx) = mpsc::channel(128);
        let send = SendTransport::create(
            &factory,
            &connected.socket,
            rtc_tx.clone(),
            &format!("talktome-{}", self.config.instance),
        )
        .await?;
        let recv =
            RecvTransport::create(&factory, &connected.socket, rtc_tx, self.rx_tx.clone()).await?;
        tracing::info!(event = "transports-created", send = %send.transport_id, recv = %recv.transport_id);
        self.media_info = Some(crate::state::MediaInfo {
            send_state: "new".into(),
            recv_state: "new".into(),
            consumers: 0,
            producer_id: Some(send.producer_id.clone()),
            ice_servers: send.ice_servers.clone(),
            ice_servers_announced: send.ice_servers_announced.clone(),
            ice_transport_policy: send.ice_transport_policy.clone(),
            ..Default::default()
        });
        connected.media = Some(Media {
            factory,
            send,
            recv,
            send_state: RTCPeerConnectionState::New,
            recv_state: RTCPeerConnectionState::New,
            consumers: HashMap::new(),
            producers: HashMap::new(),
            rtc_rx,
        });
        self.sync_active_producers(connected).await;
        // Restore talk state on the new producer (locks/held keys survive recovery).
        let change = self.talk_change_now();
        if change.talking {
            self.send_talk_change(connected, &change, "media-recovered")
                .await;
        }
        Ok(())
    }

    fn talk_change_now(&self) -> TalkChange {
        let targets = self.talk.active_targets();
        TalkChange {
            talking: !targets.is_empty(),
            targets,
            lock_active: !self.talk.locked().is_empty(),
            lock_toggled: None,
        }
    }

    async fn sync_active_producers(&mut self, connected: &mut Connected) {
        let active = match connected
            .socket
            .request_no_payload("request-active-producers", SIGNAL_TIMEOUT)
            .await
        {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(event = "active-producers-failed", error = %error);
                return;
            }
        };
        let announcements: Vec<ProducerAnnouncement> =
            serde_json::from_value(active).unwrap_or_default();
        for announcement in announcements {
            self.consume_announcement(connected, &announcement).await;
        }
    }

    fn target_for_announcement(announcement: &ProducerAnnouncement) -> Option<TargetKey> {
        let kind = announcement.app_type()?;
        let id = announcement.app_data.get("id")?;
        match kind {
            "user" | "guest" => {
                // Direct talk: key by the speaking user (falls back to appData id).
                if let Some(speaker) = announcement
                    .speaker_user_id
                    .as_ref()
                    .and_then(Value::as_i64)
                {
                    Some(TargetKey::User(speaker))
                } else {
                    TargetKey::from_type_and_id("user", id)
                }
            }
            other => TargetKey::from_type_and_id(other, id),
        }
    }

    async fn consume_announcement(
        &mut self,
        connected: &mut Connected,
        announcement: &ProducerAnnouncement,
    ) {
        let Some(producer_id) = announcement.producer_id().map(str::to_string) else {
            return;
        };
        let Some(media) = connected.media.as_mut() else {
            return;
        };
        if media.producers.contains_key(&producer_id) {
            return;
        }
        let key = Self::target_for_announcement(announcement).unwrap_or(TargetKey::User(0));
        let speaker = announcement
            .speaker_user_id
            .as_ref()
            .and_then(Value::as_i64);
        match media
            .recv
            .consume(&connected.socket, &media.factory, &producer_id)
            .await
        {
            Ok(consumer_id) => {
                media.consumers.insert(consumer_id.clone(), key);
                media
                    .producers
                    .insert(producer_id.clone(), consumer_id.clone());
                if let Ok(mut mixer) = self.io.mixer.lock() {
                    if let Err(error) = mixer.add_source_from(&consumer_id, key, speaker) {
                        tracing::warn!(event = "mixer-source-failed", error = %error);
                    }
                    mixer.set_level(key, self.audio.level(key));
                }
                tracing::info!(event = "incoming-stream", target = %key, producer = %producer_id);
                if let Some(info) = self.media_info.as_mut() {
                    info.consumers = media.consumers.len();
                }
                self.snapshot_dirty = true;
            }
            Err(error) => {
                tracing::warn!(event = "consume-failed", producer = %producer_id, error = %format!("{error:#}"));
            }
        }
    }

    async fn drop_consumer(
        &mut self,
        connected: &mut Connected,
        consumer_id: &str,
        notify_server: bool,
    ) {
        let Some(media) = connected.media.as_mut() else {
            return;
        };
        if media.consumers.remove(consumer_id).is_some() {
            media.producers.retain(|_, c| c != consumer_id);
            if let Ok(mut mixer) = self.io.mixer.lock() {
                mixer.remove_source(consumer_id);
            }
            if let Err(error) = media
                .recv
                .close_consumer(&connected.socket, consumer_id, notify_server)
                .await
            {
                tracing::debug!(event = "close-consumer-failed", consumer = %consumer_id, error = %error);
            }
            self.snapshot_dirty = true;
        }
    }

    /// Closed consumers leave inactive media sections on the receive peer
    /// connection; once many have accumulated and nothing is being received,
    /// rebuild the transports to start from a clean SDP.
    async fn compact_recv_transport(&mut self, connected: &mut Connected) {
        let rebuild = match connected.media.as_ref() {
            Some(media) => {
                media.consumers.is_empty()
                    && media.recv.section_count().await >= MAX_IDLE_RECV_SECTIONS
            }
            None => false,
        };
        if rebuild {
            self.recover_media(connected, "recv transport compaction")
                .await;
        }
    }

    async fn recover_media(&mut self, connected: &mut Connected, reason: &str) {
        tracing::warn!(event = "media-recovery", reason);
        self.set_connection(ConnectionState::Registered, "recovering media");
        self.publish(true);
        if let Err(error) = self.setup_media(connected).await {
            tracing::error!(event = "media-recovery-failed", error = %format!("{error:#}"));
            self.detail = format!("media: {error:#}");
            self.snapshot_dirty = true;
        }
    }

    // ------------------------------------------------------------------
    // Connected loop
    // ------------------------------------------------------------------

    async fn run_connected(&mut self, mut connected: Connected) -> Exit {
        if let Err(error) = self.setup_media(&mut connected).await {
            tracing::error!(event = "media-setup-failed", error = %format!("{error:#}"));
            let cue = self.alerts.on_socket_lost();
            self.play_announcement(cue);
            connected.socket.close().await;
            return Exit::Disconnected(format!("media setup failed: {error:#}"));
        }
        if let Err(error) = self.reload_targets(&connected).await {
            tracing::warn!(event = "targets-failed", error = %format!("{error:#}"));
        }
        self.send_audio_snapshot(&connected, "registered").await;
        if let Some(change) = self.pending_talk_change.take() {
            self.send_talk_change(&mut connected, &change, "reconnected")
                .await;
        }
        self.snapshot_dirty = true;
        while self.probe_rx.try_recv().is_ok() {}
        self.alerts.start(Instant::now());

        let mut tick = tokio::time::interval(Duration::from_millis(500));
        let mut last_sync = Instant::now();
        let mut last_stats = Instant::now();
        let mut last_network_report = Instant::now();
        self.signalling_rtt_ms = None;
        self.media_rtt = None;
        self.media_rtt_measurements = 0;
        let mut targets_reload_due: Option<Instant> = None;
        let mut shutdown = self.io.shutdown.clone();

        loop {
            let event = tokio::select! {
                Some(event) = connected.events.recv() => Event::Socket(event),
                event = recv_media_event(&mut connected.media) => Event::Rtc(event),
                Some(packet) = self.rx_rx.recv() => Event::Rx(packet),
                Some(command) = self.io.commands.recv() => Event::Command(command),
                Some(frame) = self.io.frames.recv() => Event::Frame(frame),
                _ = self.io.audio_status.changed() => Event::AudioStatus,
                _ = wait_true(&mut shutdown) => Event::Shutdown,
                _ = tick.tick() => Event::Tick,
                Some(reply) = self.probe_rx.recv() => Event::Probe(reply),
            };

            match event {
                Event::Shutdown => {
                    self.shutdown_connected(&mut connected).await;
                    return Exit::Shutdown;
                }
                Event::Socket(SocketEvent::Disconnected(reason)) => {
                    let cue = self.alerts.on_socket_lost();
                    self.play_announcement(cue);
                    self.teardown_media(&mut connected).await;
                    return Exit::Disconnected(reason);
                }
                Event::Socket(SocketEvent::ConnectError(error)) => {
                    let cue = self.alerts.on_socket_lost();
                    self.play_announcement(cue);
                    self.teardown_media(&mut connected).await;
                    return Exit::Disconnected(format!("connect error: {error}"));
                }
                Event::Socket(SocketEvent::Connected { .. }) => {}
                Event::Socket(SocketEvent::Event { name, args, ack }) => {
                    let payload = args.into_iter().next().unwrap_or(Value::Null);
                    // A panel command is answered with its result, everything else at once.
                    let ack = match ack {
                        Some(ack) if name != "panel-command" => {
                            ack.respond(vec![]).await;
                            None
                        }
                        ack => ack,
                    };
                    match name.as_str() {
                        "panel-command" => {
                            let result = self.handle_panel_command(&mut connected, &payload).await;
                            if let Some(ack) = ack {
                                ack.respond(vec![result]).await;
                            }
                        }
                        "session-kicked" => {
                            tracing::warn!(event = "session-kicked", detail = %payload);
                            self.alerts.suppress_loss();
                            self.teardown_media(&mut connected).await;
                            connected.socket.close().await;
                            return Exit::Kicked;
                        }
                        "user-targets-updated"
                        | "conference-list"
                        | "conference-members-updated"
                        | "available-productions-updated" => {
                            targets_reload_due = Some(Instant::now() + Duration::from_millis(300));
                        }
                        "active-production-reset" => {
                            connected.production_id = payload
                                .get("productionId")
                                .cloned()
                                .filter(|v| !v.is_null());
                            self.active_production = connected
                                .production_id
                                .as_ref()
                                .and_then(production_id_text);
                            self.snapshot_dirty = true;
                            let change = self.talk.reset();
                            self.send_talk_change(&mut connected, &change, "production-reset")
                                .await;
                            targets_reload_due = Some(Instant::now());
                        }
                        _ => {
                            self.handle_socket_event(&mut connected, &name, payload)
                                .await
                        }
                    }
                }
                Event::Rtc(event) => self.handle_rtc_event(&mut connected, event).await,
                Event::Rx(packet) => {
                    if let Ok(mut mixer) = self.io.mixer.lock() {
                        if let Err(error) =
                            mixer.push_packet(&packet.consumer_id, packet.sequence, &packet.payload)
                        {
                            tracing::debug!(event = "rx-decode-failed", error = %error);
                        }
                    }
                }
                Event::Command(command) => {
                    if matches!(command, Command::Shutdown) {
                        self.shutdown_connected(&mut connected).await;
                        return Exit::Shutdown;
                    }
                    self.handle_command(&mut connected, command).await;
                }
                Event::Frame(frame) => self.handle_frame(&mut connected, frame).await,
                Event::AudioStatus => self.snapshot_dirty = true,
                Event::Tick => {
                    if let Some(due) = targets_reload_due {
                        if Instant::now() >= due {
                            targets_reload_due = None;
                            if let Err(error) = self.reload_targets(&connected).await {
                                tracing::warn!(event = "targets-failed", error = %format!("{error:#}"));
                            }
                            self.reload_productions(&connected).await;
                            self.sync_active_producers(&mut connected).await;
                        }
                    }
                    if last_sync.elapsed() >= ACTIVE_PRODUCER_SYNC {
                        last_sync = Instant::now();
                        self.sync_active_producers(&mut connected).await;
                        self.compact_recv_transport(&mut connected).await;
                    }
                    if last_stats.elapsed() >= Duration::from_secs(2) {
                        last_stats = Instant::now();
                        self.refresh_media_stats(&connected).await;
                    }
                    if last_network_report.elapsed() >= NETWORK_REPORT_INTERVAL {
                        last_network_report = Instant::now();
                        self.report_network_stats(&connected).await;
                    }
                    if self.audio_state_dirty
                        && self.last_audio_snapshot.elapsed() >= SNAPSHOT_DEBOUNCE
                    {
                        self.send_audio_snapshot(&connected, "target-audio-state")
                            .await;
                    }
                    // Receiving indicators change without any event; refresh them.
                    // This 500 ms tick is also the v1.5.6 connection-health probe.
                    let now = Instant::now();
                    let cue = self.alerts.on_tick(now);
                    self.play_announcement(cue);
                    self.spawn_health_probe(&connected.socket);
                    self.snapshot_dirty = true;
                }
                Event::Probe(reply) => {
                    self.note_probe_rtt(reply);
                    let (send_blocks, recv_blocks) = transport_blocks(connected.media.as_ref());
                    let cue = self
                        .alerts
                        .on_ack(reply, Instant::now(), send_blocks, recv_blocks);
                    self.play_announcement(cue);
                    self.snapshot_dirty = true;
                }
            }
            self.publish(false);
        }
    }

    async fn shutdown_connected(&mut self, connected: &mut Connected) {
        self.alerts.suppress_loss();
        let change = self.talk.reset();
        if change != self.talk_change_now() || !change.targets.is_empty() {
            self.send_talk_change(connected, &change, "shutdown").await;
        }
        self.teardown_media(connected).await;
        let _ = connected.socket.emit("user-logout", vec![]).await;
        connected.socket.close().await;
    }

    async fn teardown_media(&mut self, connected: &mut Connected) {
        if let Some(media) = connected.media.take() {
            media.send.close().await;
            media.recv.close().await;
        }
        self.media_info = None;
        if let Ok(mut mixer) = self.io.mixer.lock() {
            mixer.clear_sources();
        }
        // Remember what to re-send once we are back.
        let change = self.talk_change_now();
        if change.talking {
            self.pending_talk_change = Some(change);
        }
        self.snapshot_dirty = true;
    }

    async fn handle_socket_event(&mut self, connected: &mut Connected, name: &str, payload: Value) {
        match name {
            "new-producer" => {
                if let Ok(announcement) = serde_json::from_value::<ProducerAnnouncement>(payload) {
                    self.consume_announcement(connected, &announcement).await;
                }
            }
            "producer-closed" => {
                if let Ok(announcement) = serde_json::from_value::<ProducerAnnouncement>(payload) {
                    if let Some(producer_id) = announcement.producer_id() {
                        let consumer = connected
                            .media
                            .as_ref()
                            .and_then(|m| m.producers.get(producer_id).cloned());
                        if let Some(consumer_id) = consumer {
                            self.drop_consumer(connected, &consumer_id, false).await;
                        }
                    }
                }
            }
            "consumer-closed" => {
                if let Some(consumer_id) = payload
                    .get("consumerId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                {
                    self.drop_consumer(connected, &consumer_id, false).await;
                }
            }
            "incoming-talk-state" => {
                let state = payload.get("state").cloned().unwrap_or(Value::Null);
                self.apply_incoming_state(&state);
                if !self.incoming.is_empty() {
                    self.sync_active_producers(connected).await;
                }
            }
            "user-list" => {
                self.online_users = payload
                    .as_array()
                    .map(|peers| {
                        peers
                            .iter()
                            .filter(|p| p.get("kind").and_then(Value::as_str) == Some("user"))
                            .filter_map(|p| p.get("userId").and_then(Value::as_i64))
                            .collect()
                    })
                    .unwrap_or_default();
                let online = self.online_users.clone();
                if let Some(change) = self.talk.drop_unavailable(|key| match key {
                    TargetKey::User(id) => online.contains(&id),
                    TargetKey::Feed(_) => false,
                    TargetKey::Conference(_) => true,
                }) {
                    self.send_talk_change(connected, &change, "user-offline")
                        .await;
                }
                self.refresh_main_availability();
                self.snapshot_dirty = true;
            }
            "cut-camera" => {
                let (on_air, preview) = parse_cut_camera(&payload);
                if on_air != self.on_air || preview != self.preview {
                    tracing::info!(event = "tally", on_air, preview);
                    self.on_air = on_air;
                    self.preview = preview;
                    self.snapshot_dirty = true;
                }
            }
            "api-talk-command" => self.handle_api_talk_command(connected, payload).await,
            "api-target-audio-command" => self.handle_api_audio_command(connected, payload).await,
            "user-audio-settings-updated" => {
                if let Some(settings) = payload.get("settings").filter(|s| s.is_object()) {
                    self.apply_remote_audio_settings(connected, settings).await;
                }
            }
            "panel-state-request" => {
                let report = self.panel_report().await;
                let _ = connected
                    .socket
                    .emit("panel-client-state", vec![report])
                    .await;
            }
            _ => {
                tracing::trace!(event = "socket-event-ignored", name);
            }
        }
    }

    fn apply_incoming_state(&mut self, state: &Value) {
        let addressed = state
            .get("addressedNow")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        self.incoming.clear();
        self.incoming_keys.clear();
        for entry in &addressed {
            let from_name = entry
                .get("fromName")
                .and_then(Value::as_str)
                .unwrap_or("?")
                .to_string();
            let target = entry
                .get("targetType")
                .and_then(Value::as_str)
                .zip(entry.get("targetId"))
                .and_then(|(kind, id)| TargetKey::from_type_and_id(kind, id));
            if let Some(key) = target {
                self.incoming_keys.insert(key);
            }
            // Only a direct call lights the sender's user key; talking into
            // a conference or feed lights that key alone.
            let to_group = matches!(
                target,
                Some(TargetKey::Conference(_)) | Some(TargetKey::Feed(_))
            );
            if let (Some(from), false) = (entry.get("fromUserId").and_then(Value::as_i64), to_group)
            {
                self.incoming_keys.insert(TargetKey::User(from));
            }
            self.incoming.push(IncomingInfo { from_name, target });
        }
        let reply = state.get("replyTarget").and_then(|reply| {
            let kind = reply
                .get("replyTargetType")
                .or_else(|| reply.get("targetType"))
                .and_then(Value::as_str)?;
            let id = reply
                .get("replyTargetId")
                .or_else(|| reply.get("targetId"))?;
            TargetKey::from_type_and_id(kind, id)
        });
        // Calls into a listen-only conference cannot be answered there:
        // they leave Reply (and the last caller) as they were.
        let listen_only = |key: &TargetKey| {
            matches!(key, TargetKey::Conference(_))
                && self
                    .targets
                    .iter()
                    .find(|t| t.key == *key)
                    .is_some_and(|t| !t.can_talk)
        };
        let answerable: Vec<&IncomingInfo> = self
            .incoming
            .iter()
            .filter(|incoming| !incoming.target.as_ref().is_some_and(listen_only))
            .collect();
        if let Some(first) = answerable.first() {
            self.last_caller = Some(first.from_name.clone());
        }
        let only_listen_only = !self.incoming.is_empty() && answerable.is_empty();
        let reply_listen_only = reply.as_ref().is_some_and(listen_only);
        if !only_listen_only && !(reply_listen_only && answerable.is_empty()) {
            let target = crate::talk::TalkModel::resolve_reply_target(
                reply.filter(|key| !listen_only(key)),
                answerable.iter().map(|incoming| incoming.target),
            );
            self.talk.set_reply_target(target);
        }
        if let Ok(mut mixer) = self.io.mixer.lock() {
            mixer.set_dim_state(self.talk.is_talking(), !self.incoming.is_empty());
        }
        if !self.incoming.is_empty() {
            tracing::debug!(event = "incoming", from = ?self.incoming.iter().map(|i| &i.from_name).collect::<Vec<_>>());
        }
        self.snapshot_dirty = true;
    }

    async fn handle_rtc_event(&mut self, connected: &mut Connected, event: RtcEvent) {
        match event {
            RtcEvent::PeerState { direction, state } => {
                tracing::info!(event = "transport-state", direction = ?direction, state = %state);
                if let Some(media) = connected.media.as_mut() {
                    match direction {
                        Direction::Send => media.send_state = state,
                        Direction::Recv => media.recv_state = state,
                    }
                    if let Some(info) = self.media_info.as_mut() {
                        info.send_state = peer_state_label(media.send_state).to_string();
                        info.recv_state = peer_state_label(media.recv_state).to_string();
                        info.consumers = media.consumers.len();
                    }
                    self.snapshot_dirty = true;
                }
                if matches!(
                    state,
                    RTCPeerConnectionState::Disconnected | RTCPeerConnectionState::Failed
                ) {
                    let cue = self.alerts.on_transport_down();
                    self.play_announcement(cue);
                }
                if matches!(state, RTCPeerConnectionState::Failed) {
                    self.recover_media(connected, &format!("{direction:?} transport {state}"))
                        .await;
                } else if matches!(state, RTCPeerConnectionState::Connected) {
                    let (send_blocks, recv_blocks) = transport_blocks(connected.media.as_ref());
                    let cue = self.alerts.on_transport_up(send_blocks, recv_blocks);
                    self.play_announcement(cue);
                }
                self.update_ready_state(connected);
            }
            RtcEvent::IceState { direction, state } => {
                tracing::debug!(event = "ice-state", direction = ?direction, state = %state);
                if matches!(state, RTCIceConnectionState::Failed) {
                    let cue = self.alerts.on_transport_down();
                    self.play_announcement(cue);
                    self.recover_media(connected, &format!("{direction:?} ICE failed"))
                        .await;
                }
            }
            RtcEvent::ConsumerTrack { consumer_id, .. } => {
                tracing::debug!(event = "consumer-track", consumer = %consumer_id);
            }
        }
    }

    fn update_ready_state(&mut self, connected: &Connected) {
        let Some(media) = connected.media.as_ref() else {
            return;
        };
        let send_ok = matches!(media.send_state, RTCPeerConnectionState::Connected);
        let recv_ok = media.consumers.is_empty()
            || matches!(
                media.recv_state,
                RTCPeerConnectionState::Connected
                    | RTCPeerConnectionState::New
                    | RTCPeerConnectionState::Connecting
            );
        let next = if send_ok && recv_ok {
            ConnectionState::Ready
        } else {
            ConnectionState::Registered
        };
        if next != self.connection {
            let detail = if next == ConnectionState::Ready {
                String::new()
            } else {
                format!("send {} / recv {}", media.send_state, media.recv_state)
            };
            self.set_connection(next, &detail);
        }
    }

    // ------------------------------------------------------------------
    // Talk / commands
    // ------------------------------------------------------------------

    async fn handle_command(&mut self, connected: &mut Connected, command: Command) {
        let now = Instant::now();
        match command {
            Command::TalkPress { source, target } => {
                if !self.target_is_talkable(target) {
                    self.detail = "user offline".into();
                    self.snapshot_dirty = true;
                    return;
                }
                match self.talk.press(source, target, now) {
                    Some(change) => self.send_talk_change(connected, &change, "press").await,
                    None => {
                        self.detail = "no target".into();
                        self.snapshot_dirty = true;
                    }
                }
            }
            Command::TalkRelease { source, target } => {
                if let Some(change) = self.talk.release(source, target, now) {
                    self.send_talk_change(connected, &change, "release").await;
                }
            }
            Command::LockToggle { target } => {
                if !self.target_is_talkable(target) {
                    self.detail = "user offline".into();
                    self.snapshot_dirty = true;
                    return;
                }
                if let Some(change) = self.talk.toggle_lock(target) {
                    self.send_talk_change(connected, &change, "lock-toggle")
                        .await;
                }
            }
            Command::ClearLocks => {
                let change = self.talk.clear_locks();
                self.send_talk_change(connected, &change, "clear-locks")
                    .await;
            }
            Command::MuteToggle(key) => {
                let level = self.audio.toggle_mute(key);
                self.apply_level(key, level);
            }
            Command::VolumeStep { target, delta } => {
                let level = self.audio.step_volume(target, delta);
                self.apply_level(target, level);
            }
            Command::VolumeSet { target, volume } => {
                let level = self.audio.set_volume(target, volume);
                self.apply_level(target, level);
            }
            Command::MemberVolumeSet {
                conference: TargetKey::Conference(conference_id),
                user_id,
                volume,
            } => {
                let level = self.audio.set_member_volume(conference_id, user_id, volume);
                self.apply_member_level(conference_id, user_id, level);
            }
            Command::MemberMuteToggle {
                conference: TargetKey::Conference(conference_id),
                user_id,
            } => {
                let level = self.audio.toggle_member_mute(conference_id, user_id);
                self.apply_member_level(conference_id, user_id, level);
            }
            Command::MemberVolumeSet { .. } | Command::MemberMuteToggle { .. } => {}
            Command::SetProduction(id) => {
                if let Err(error) = self.change_production(connected, &id).await {
                    self.detail = error.to_string();
                    self.snapshot_dirty = true;
                }
            }
            Command::Refresh => self.snapshot_dirty = true,
            Command::Shutdown => {}
        }
    }

    fn apply_level(&mut self, key: TargetKey, level: crate::talk::AudioLevel) {
        if let Ok(mut mixer) = self.io.mixer.lock() {
            mixer.set_level(key, level);
        }
        if let Err(error) = self.audio.save() {
            tracing::warn!(event = "audio-state-save-failed", error = %error);
        }
        self.audio_state_dirty = true;
        self.snapshot_dirty = true;
    }

    fn apply_member_level(
        &mut self,
        conference_id: i64,
        user_id: i64,
        level: crate::talk::AudioLevel,
    ) {
        if let Ok(mut mixer) = self.io.mixer.lock() {
            mixer.set_member_level(conference_id, user_id, level);
        }
        if let Err(error) = self.audio.save() {
            tracing::warn!(event = "audio-state-save-failed", error = %error);
        }
        self.audio_state_dirty = true;
        self.snapshot_dirty = true;
    }

    async fn send_talk_change(
        &mut self,
        connected: &mut Connected,
        change: &TalkChange,
        reason: &str,
    ) {
        let targets: Vec<Value> = change.targets.iter().map(|t| t.to_talk_target()).collect();
        if let Some((key, locked)) = change.lock_toggled {
            tracing::info!(event = if locked { "lock-on" } else { "lock-off" }, target = %key);
        }
        let was_talking = connected
            .media
            .as_ref()
            .map(|m| m.send.is_talking())
            .unwrap_or(false);
        if change.talking {
            if !was_talking {
                tracing::info!(event = "talk-start", targets = ?change.targets.iter().map(|t| t.to_string()).collect::<Vec<_>>());
            }
            let _ = connected
                .socket
                .emit(
                    "talk-targets-updated",
                    vec![json!({ "reason": reason, "targets": targets })],
                )
                .await;
            if let Some(media) = connected.media.as_ref() {
                if let Err(error) = media.send.set_talking(&connected.socket, true).await {
                    tracing::warn!(event = "resume-producer-failed", error = %error);
                }
            }
        } else {
            if let Some(media) = connected.media.as_ref() {
                if let Err(error) = media.send.set_talking(&connected.socket, false).await {
                    tracing::warn!(event = "pause-producer-failed", error = %error);
                }
            }
            if was_talking {
                tracing::info!(event = "talk-stop");
            }
            let _ = connected
                .socket
                .emit(
                    "talk-targets-updated",
                    vec![json!({ "reason": reason, "targets": [] })],
                )
                .await;
        }
        let first = change.targets.first().map(|t| t.to_talk_target());
        let _ = connected
            .socket
            .emit(
                "ptt-state",
                vec![json!({
                    "talking": change.talking,
                    "lockActive": change.lock_active,
                    "target": first,
                    "targets": targets,
                    "reason": reason,
                })],
            )
            .await;
        if let Ok(mut mixer) = self.io.mixer.lock() {
            mixer.set_dim_state(change.talking, !self.incoming.is_empty());
        }
        self.pending_talk_change = None;
        self.snapshot_dirty = true;
    }

    async fn handle_frame(&mut self, connected: &mut Connected, frame: Vec<f32>) {
        let level = peak_db(&frame);
        self.input_level_db = level;
        if let Some(trigger) = self.vox.as_mut() {
            if let Some(active) = trigger.update(level, Instant::now()) {
                if let Some(change) = self.talk.set_vox_active(active) {
                    tracing::info!(event = if active { "vox-active" } else { "vox-inactive" });
                    self.send_talk_change(connected, &change, "vox").await;
                }
            }
        }
        let talking = connected
            .media
            .as_ref()
            .map(|m| m.send.is_talking())
            .unwrap_or(false);
        if !talking {
            return;
        }
        if frame.len() != self.encoder.frame_samples() {
            return;
        }
        match self.encoder.encode(&frame) {
            Ok(packet) => {
                if let Some(media) = connected.media.as_ref() {
                    if let Err(error) = media.send.write_frame(packet, self.frame_duration).await {
                        tracing::debug!(event = "write-frame-failed", error = %error);
                    }
                }
            }
            Err(error) => tracing::warn!(event = "encode-failed", error = %error),
        }
    }

    fn companion_target(target_type: &str, target_id: &Value) -> Option<TargetRef> {
        if target_type.eq_ignore_ascii_case("reply") {
            return Some(TargetRef::Reply);
        }
        TargetKey::from_type_and_id(target_type, target_id).map(TargetRef::Key)
    }

    fn known_target(&self, target: TargetRef) -> bool {
        match target {
            TargetRef::Reply => self.talk.effective_reply().is_some(),
            TargetRef::Key(key) => self.targets.iter().any(|t| t.key == key),
        }
    }

    fn target_is_talkable(&self, target: TargetRef) -> bool {
        let Some(key) = (match target {
            TargetRef::Key(key) => Some(key),
            TargetRef::Reply => self.talk.effective_reply(),
        }) else {
            return false;
        };
        match key {
            TargetKey::User(id) => self.online_users.contains(&id),
            // Listen-only conferences are monitor targets, like feeds.
            TargetKey::Conference(_) => self
                .targets
                .iter()
                .find(|t| t.key == key)
                .is_none_or(|t| t.can_talk),
            TargetKey::Feed(_) => false,
        }
    }

    fn refresh_main_availability(&mut self) {
        let available = self.talk.main_target().is_some_and(|key| {
            self.targets
                .iter()
                .any(|target| target.key == key && target.can_talk)
        });
        self.talk.set_main_available(available);
    }

    async fn refresh_media_stats(&mut self, connected: &Connected) {
        let Some(media) = connected.media.as_ref() else {
            return;
        };
        // The receive transport has no outbound streams, so its report holds
        // nothing we use; receive loss comes from the jitter buffers instead.
        let send = crate::rtc::LinkStats::from_report(&media.send.stats_report().await);
        let receive = self.io.mixer.lock().ok().map(|mixer| mixer.receive_stats());
        let link = send.clone().merge(crate::rtc::LinkStats::from_received(
            receive.map_or(0, |stats| stats.packets),
            receive.map_or(0, |stats| stats.lost),
        ));
        let conceal = receive.and_then(|stats| {
            let den = stats.packets + stats.concealed;
            if den == 0 {
                None
            } else {
                Some(((stats.concealed as f32) / den as f32 * 1000.0).round() / 10.0)
            }
        });

        let now = Instant::now();
        if send.rtt_measurements < self.media_rtt_measurements {
            // The send transport was recreated.
            self.media_rtt = None;
        }
        if send.rtt_measurements > self.media_rtt_measurements {
            if let Some(ms) = send.rtt_ms {
                self.media_rtt = Some((ms, now));
            }
        }
        self.media_rtt_measurements = send.rtt_measurements;
        let (rtt_ms, rtt_source) = choose_rtt(self.media_rtt, self.signalling_rtt_ms, now);

        if let Some(info) = self.media_info.as_mut() {
            info.rtt_ms = rtt_ms;
            info.rtt_source = rtt_source.map(str::to_string);
            info.packet_loss_pct = link.packet_loss_pct;
            info.packets_lost = (link.packets_lost > 0).then_some(link.packets_lost);
            info.packets_received = (link.packets_received > 0).then_some(link.packets_received);
            info.recv_conceal_pct = conceal;
        }
    }

    fn note_probe_rtt(&mut self, reply: ProbeReply) {
        if !reply.ok || reply.generation != self.alerts.generation() {
            return;
        }
        let sample = Instant::now().saturating_duration_since(reply.sent_at);
        if sample >= super::alerts::PROBE_TIMEOUT {
            return;
        }
        let sample = sample.as_secs_f32() * 1000.0;
        self.signalling_rtt_ms = Some(match self.signalling_rtt_ms {
            Some(previous) => previous + (sample - previous) * SIGNALLING_RTT_SMOOTHING,
            None => sample,
        });
    }

    /// Sends the same `media-network-stats` summary as the web client, which
    /// the server shows as RTT / packet loss on the admin status page.
    async fn report_network_stats(&self, connected: &Connected) {
        let Some(info) = self.media_info.as_ref() else {
            return;
        };
        let receive = self.io.mixer.lock().ok().map(|mixer| mixer.receive_stats());
        let payload = json!({
            "roundTripMs": info.rtt_ms,
            "packetLossPercent": info.packet_loss_pct,
            "packetsLost": info.packets_lost.unwrap_or(0),
            "packetsReceived": info.packets_received.unwrap_or(0),
            "packetsDiscarded": receive.map_or(0, |stats| stats.dropped_late),
        });
        if let Err(error) = connected
            .socket
            .emit("media-network-stats", vec![payload])
            .await
        {
            tracing::debug!(event = "network-stats-failed", error = %error);
        }
    }

    async fn handle_api_talk_command(&mut self, connected: &mut Connected, payload: Value) {
        let command_id = payload.get("commandId").cloned().unwrap_or(Value::Null);
        let action = payload
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let target_type = payload
            .get("targetType")
            .and_then(Value::as_str)
            .unwrap_or("conference")
            .to_string();
        let target_id = payload.get("targetId").cloned().unwrap_or(Value::Null);
        let input_key = payload
            .get("inputKey")
            .and_then(Value::as_str)
            .filter(|k| !k.trim().is_empty())
            .map(|k| k.trim().to_string())
            .unwrap_or_else(|| format!("companion:{target_type}:{target_id}"));
        tracing::info!(event = "companion-command", action = %action, target_type = %target_type, target_id = %target_id);

        let target = Self::companion_target(&target_type, &target_id);
        let source = InputSource::Companion(input_key);
        let now = Instant::now();
        let (ok, reason, change) = match (action.as_str(), target) {
            ("press", Some(target)) if self.known_target(target) => {
                if !self.target_is_talkable(target) {
                    (false, Some("target-not-available"), None)
                } else {
                    match self.talk.press(source, target, now) {
                        Some(change) => (true, None, Some(change)),
                        None => (false, Some("press-failed"), None),
                    }
                }
            }
            ("release", Some(target)) => {
                let change = self.talk.release(source, target, now);
                (true, None, change)
            }
            ("release", None) => (true, None, None),
            ("lock-toggle", Some(target)) if self.known_target(target) => {
                if !self.target_is_talkable(target) {
                    (false, Some("target-not-available"), None)
                } else {
                    match self.talk.toggle_lock(target) {
                        Some(change) => (true, None, Some(change)),
                        None => (false, Some("target-not-available"), None),
                    }
                }
            }
            ("press" | "lock-toggle", _) => (false, Some("target-not-available"), None),
            _ => (false, Some("unsupported-action"), None),
        };
        if let Some(change) = change.as_ref() {
            self.send_talk_change(connected, change, "companion").await;
        }
        let state = self.talk_change_now();
        let result = json!({
            "commandId": command_id,
            "ok": ok,
            "reason": reason,
            "action": action,
            "targetType": target_type,
            "targetId": target_id,
            "talking": state.talking,
            "lockActive": state.lock_active,
            "target": state.targets.first().map(|t| t.to_talk_target()),
            "targets": state.targets.iter().map(|t| t.to_talk_target()).collect::<Vec<_>>(),
        });
        let _ = connected
            .socket
            .emit("api-talk-command-result", vec![result])
            .await;
    }

    async fn handle_api_audio_command(&mut self, connected: &mut Connected, payload: Value) {
        let command_id = payload.get("commandId").cloned().unwrap_or(Value::Null);
        let action = payload
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let target_type = payload
            .get("targetType")
            .and_then(Value::as_str)
            .unwrap_or("conference")
            .to_string();
        let target_id = payload.get("targetId").cloned().unwrap_or(Value::Null);
        let step = payload
            .get("step")
            .and_then(Value::as_f64)
            .map(|s| s.clamp(0.01, 1.0) as f32)
            .unwrap_or(0.1);
        tracing::info!(event = "companion-command", action = %action, target_type = %target_type, target_id = %target_id);
        let key = TargetKey::from_type_and_id(&target_type, &target_id)
            .filter(|k| self.targets.iter().any(|t| t.key == *k));
        let (ok, reason) = match (action.as_str(), key) {
            ("volume-up", Some(key)) => {
                let level = self.audio.step_volume(key, step);
                self.apply_level(key, level);
                (true, None)
            }
            ("volume-down", Some(key)) => {
                let level = self.audio.step_volume(key, -step);
                self.apply_level(key, level);
                (true, None)
            }
            ("mute-toggle", Some(key)) => {
                let level = self.audio.toggle_mute(key);
                self.apply_level(key, level);
                (true, None)
            }
            ("volume-up" | "volume-down" | "mute-toggle", None) => {
                (false, Some("target-not-available"))
            }
            _ => (false, Some("unsupported-action")),
        };
        let result = json!({
            "commandId": command_id,
            "ok": ok,
            "reason": reason,
            "action": action,
            "targetType": target_type,
            "targetId": target_id,
        });
        let _ = connected
            .socket
            .emit("api-target-audio-command-result", vec![result])
            .await;
        self.send_audio_snapshot(connected, "companion").await;
    }

    async fn send_audio_snapshot(&mut self, connected: &Connected, reason: &str) {
        let keys: Vec<TargetKey> = self.targets.iter().map(|t| t.key).collect();
        let states = self.audio.snapshot_entries(keys.iter());
        let _ = connected
            .socket
            .emit(
                "target-audio-state-snapshot",
                vec![
                    json!({ "reason": reason, "states": states, "revision": self.panel.revision }),
                ],
            )
            .await;
        self.audio_state_dirty = false;
        self.last_audio_snapshot = Instant::now();
    }

    // ------------------------------------------------------------------
    // Admin remote panel (server v1.5.12+)
    // ------------------------------------------------------------------

    /// The `panel-client-state` payload: what the web client shows in its
    /// own window, so the admin panel can mirror it.
    async fn panel_report(&mut self) -> Value {
        let devices = self.panel_device_list().await;
        let state = self.talk_change_now();
        let (mic_level, mic_width) = panel::mic_meter(self.input_level_db);
        let input = panel::device_id(&self.input_device);
        let output = panel::device_id(&self.output_device);
        json!({
            "revision": self.panel.revision,
            "storage": panel::storage_with_devices(&self.panel.storage, &input, &output),
            "runtime": {
                "devices": devices,
                "inputDeviceId": input,
                "outputDeviceId": output,
                "outputSupported": !is_virtual_device(&self.output_device),
                "talking": state.talking,
                "lockActive": state.lock_active,
                "target": state.targets.first().map(|t| t.to_talk_target()),
                "targets": state.targets.iter().map(|t| t.to_talk_target()).collect::<Vec<_>>(),
                "lockedTargets": self.talk.locked().iter().map(|t| t.to_talk_target()).collect::<Vec<_>>(),
                "micLevel": mic_level,
                "micMeterWidth": mic_width,
            },
        })
    }

    async fn panel_device_list(&mut self) -> Vec<Value> {
        if let Some((devices, at)) = &self.panel_devices {
            if at.elapsed() < PANEL_DEVICES_MAX_AGE {
                return devices.clone();
            }
        }
        let input = panel::device_id(&self.input_device);
        let output = panel::device_id(&self.output_device);
        let devices = tokio::task::spawn_blocking(move || {
            let inputs = crate::audio::alsa_pcm_devices(true);
            let outputs = crate::audio::alsa_pcm_devices(false);
            panel::devices(&inputs, &outputs, &input, &output)
        })
        .await
        .unwrap_or_default();
        self.panel_devices = Some((devices.clone(), Instant::now()));
        devices
    }

    /// Applies one `panel-command` and returns the acknowledgement.
    async fn handle_panel_command(&mut self, connected: &mut Connected, command: &Value) -> Value {
        let kind = command.get("kind").and_then(Value::as_str).unwrap_or("");
        if kind != "talk" {
            if let Some(settings) = command
                .get("panelSettings")
                .and_then(PanelSettings::from_json)
            {
                self.panel = settings;
            }
        }
        tracing::info!(event = "panel-command", kind, action = ?command.get("action"));
        let outcome = match kind {
            "talk" => self.panel_talk(connected, command).await.map(|()| None),
            "target-audio" => self.panel_target_audio(command).map(|()| None),
            "audio-settings" => match command.get("settings").filter(|s| s.is_object()) {
                Some(settings) => {
                    let restart = self.apply_remote_audio_settings(connected, settings).await;
                    Ok(restart.then_some(
                        "Saved. The codec profile applies after the headless client restarts.",
                    ))
                }
                None => Err("Invalid audio settings"),
            },
            "preferences" => match command.get("patch") {
                Some(patch) if panel::patch_changes_devices(patch) => {
                    self.panel_switch_devices(patch).await.map(|()| None)
                }
                _ => Ok(None),
            },
            // The server announces the new order with `user-targets-updated`.
            "order" => Ok(None),
            "production" => self
                .panel_change_production(connected, command)
                .await
                .map(|()| None),
            _ => Err("Unsupported panel action"),
        };
        let report = self.panel_report().await;
        match outcome {
            Ok(message) => json!({ "ok": true, "message": message, "report": report }),
            Err(error) => {
                tracing::info!(event = "panel-command-rejected", kind, error);
                json!({ "ok": false, "error": error, "report": report })
            }
        }
    }

    async fn panel_talk(
        &mut self,
        connected: &mut Connected,
        command: &Value,
    ) -> Result<(), &'static str> {
        let action = command.get("action").and_then(Value::as_str).unwrap_or("");
        let input_key = command
            .get("inputKey")
            .and_then(Value::as_str)
            .unwrap_or("panel")
            .to_string();
        let source = InputSource::Companion(input_key);
        let target = Self::companion_target(
            command
                .get("targetType")
                .and_then(Value::as_str)
                .unwrap_or(""),
            command.get("targetId").unwrap_or(&Value::Null),
        );
        let change = match action {
            "press" | "lock" | "unlock" => {
                let target = target
                    .filter(|t| self.known_target(*t))
                    .ok_or("Talk target is not available")?;
                if action != "unlock" && !self.target_is_talkable(target) {
                    return Err("Talk target is offline");
                }
                if action == "press" {
                    Some(
                        self.talk
                            .press(source, target, Instant::now())
                            .ok_or("Talk target is not available")?,
                    )
                } else {
                    self.talk.set_lock(target, action == "lock")
                }
            }
            "release" => self.talk.release_source(&source),
            "stop" => Some(self.talk.stop()),
            _ => return Err("Invalid talk action"),
        };
        if let Some(change) = change {
            self.send_talk_change(connected, &change, "panel").await;
        }
        Ok(())
    }

    /// Switches the ALSA capture / playback device from the remote panel and
    /// saves the choice to the configuration file.
    async fn panel_switch_devices(&mut self, patch: &Value) -> Result<(), &'static str> {
        let devices = self.panel_device_list().await;
        let available = |kind: &str, id: &str| {
            id.is_empty()
                || devices
                    .iter()
                    .any(|d| d["kind"] == kind && d["deviceId"] == id)
        };
        let input = panel::patch_device(patch, "preferredAudioInputDeviceId")
            .filter(|id| *id != panel::device_id(&self.input_device));
        let output = panel::patch_device(patch, "preferredAudioOutputDeviceId")
            .filter(|id| *id != panel::device_id(&self.output_device));
        if input.is_some() && is_virtual_device(&self.input_device)
            || output.is_some() && is_virtual_device(&self.output_device)
        {
            return Err("This client uses a test device; change it in its web interface");
        }
        if input
            .as_deref()
            .is_some_and(|id| !available("audioinput", id))
            || output
                .as_deref()
                .is_some_and(|id| !available("audiooutput", id))
        {
            return Err("Audio device not available on the headless client");
        }
        let as_config = |id: String| (!id.is_empty()).then_some(id);
        let mut values = Vec::new();
        if let Some(id) = input {
            self.input_device = as_config(id);
            self.io
                .audio_devices
                .request_input(self.input_device.clone());
            values.push(("audio", "input_device", json!(self.input_device)));
        }
        if let Some(id) = output {
            self.output_device = as_config(id);
            self.io
                .audio_devices
                .request_output(self.output_device.clone());
            values.push(("audio", "output_device", json!(self.output_device)));
        }
        if values.is_empty() {
            return Ok(());
        }
        // The device in use is listed first; rebuild the list next time.
        self.panel_devices = None;
        if let Some(path) = &self.config_path {
            if let Err(error) = crate::config::update_values(path, &values) {
                tracing::warn!(event = "config-save-failed", error = %format!("{error:#}"));
            }
        }
        Ok(())
    }

    /// Moves this client to another assigned production, like the web
    /// client's production selector, and saves it as `user.production`.
    async fn panel_change_production(
        &mut self,
        connected: &mut Connected,
        command: &Value,
    ) -> Result<(), &'static str> {
        let id = command
            .get("productionId")
            .and_then(production_id_text)
            .ok_or("Invalid production")?;
        self.change_production(connected, &id).await
    }

    /// Switches the active production like the web client's selector and
    /// saves it as `user.production`.
    async fn change_production(
        &mut self,
        connected: &mut Connected,
        id: &str,
    ) -> Result<(), &'static str> {
        let id = id.trim().to_string();
        if id.is_empty() {
            return Err("Invalid production");
        }
        if connected
            .production_id
            .as_ref()
            .and_then(production_id_text)
            == Some(id.clone())
        {
            return Ok(());
        }
        let change = self.talk.stop();
        self.send_talk_change(connected, &change, "production-change")
            .await;
        let ack = connected
            .socket
            .request(
                "set-active-production",
                json!({ "productionId": id }),
                SIGNAL_TIMEOUT,
            )
            .await
            .map_err(|_| "The server did not confirm the production change")?;
        if ack.get("ok").and_then(Value::as_bool) != Some(true) {
            tracing::warn!(event = "production-change-refused", production = %id, error = %ack.get("error").cloned().unwrap_or_default());
            return Err("The server refused the production change");
        }
        connected.production_id = ack
            .get("productionId")
            .cloned()
            .filter(|v| !v.is_null())
            .or_else(|| Some(json!(id)));
        tracing::info!(event = "production-changed", production = %id);
        self.active_production = connected
            .production_id
            .as_ref()
            .and_then(production_id_text);
        self.save_production(&id);
        if let Err(error) = self.reload_targets(connected).await {
            tracing::warn!(event = "targets-failed", error = %format!("{error:#}"));
        }
        self.snapshot_dirty = true;
        Ok(())
    }

    fn save_production(&mut self, id: &str) {
        self.production = Some(id.to_string());
        self.snapshot_dirty = true;
        if let Some(path) = &self.config_path {
            if let Err(error) =
                crate::config::update_values(path, &[("user", "production", json!(id))])
            {
                tracing::warn!(event = "config-save-failed", error = %format!("{error:#}"));
            }
        }
    }

    fn panel_target_audio(&mut self, command: &Value) -> Result<(), &'static str> {
        let audio = command.get("audio").unwrap_or(&Value::Null);
        let key = audio
            .get("targetType")
            .and_then(Value::as_str)
            .zip(audio.get("targetId"))
            .and_then(|(kind, id)| TargetKey::from_type_and_id(kind, id))
            .filter(|key| self.targets.iter().any(|t| t.key == *key))
            .ok_or("Audio target not assigned")?;
        let volume = audio
            .get("volume")
            .and_then(Value::as_f64)
            .map(|v| v as f32);
        let muted = audio.get("muted").and_then(Value::as_bool);
        let level = self.audio.set_level(key, volume, muted);
        self.apply_level(key, level);
        Ok(())
    }

    // ------------------------------------------------------------------
    // Targets and snapshots
    // ------------------------------------------------------------------

    /// Keeps the Settings production list current after admin changes.
    async fn reload_productions(&mut self, connected: &Connected) {
        let Some((token, _)) = self.token.clone() else {
            return;
        };
        match self.api.productions(&token, connected.user_id).await {
            Ok(productions) => {
                if let Some(login) = self.login.as_mut() {
                    login.productions = productions;
                    self.snapshot_dirty = true;
                }
            }
            Err(error) => {
                tracing::debug!(event = "productions-failed", error = %format!("{error:#}"));
            }
        }
    }

    async fn reload_targets(&mut self, connected: &Connected) -> Result<()> {
        let token = self
            .token
            .as_ref()
            .map(|(t, _)| t.clone())
            .unwrap_or_default();
        let production = connected.production_id.as_ref().map(|p| match p {
            Value::Number(n) => n.to_string(),
            Value::String(s) => s.clone(),
            other => other.to_string(),
        });
        let entries = self
            .api
            .targets(&token, connected.user_id, production.as_deref())
            .await?;
        let mut targets = Vec::new();
        for entry in entries {
            let Some(key) = TargetKey::from_type_and_id(&entry.target_type, &entry.target_id)
            else {
                continue;
            };
            let members = parse_conference_members(&entry.members);
            targets.push(Target {
                key,
                name: entry.name.clone().unwrap_or_else(|| key.to_string()),
                can_talk: TargetEntry::can_talk(&entry) && key.can_talk(),
                members,
            });
        }
        tracing::info!(event = "targets-loaded", count = targets.len());
        self.targets = targets;
        self.refresh_main_availability();
        if let Ok(mut mixer) = self.io.mixer.lock() {
            for target in &self.targets {
                mixer.set_level(target.key, self.audio.level(target.key));
            }
        }
        self.snapshot_dirty = true;
        Ok(())
    }

    /// Applies settings an admin changed (Admin Users or the remote panel),
    /// saves the configuration-backed ones and reports back what this client
    /// really uses. Returns true when the saved codec profile now differs
    /// from the running one.
    async fn apply_remote_audio_settings(
        &mut self,
        connected: &mut Connected,
        settings: &Value,
    ) -> bool {
        if let Some(change) = self.apply_user_audio_settings(settings, true) {
            self.send_talk_change(connected, &change, "audio-settings")
                .await;
        }
        self.push_audio_settings(connected, Some(settings)).await;
        self.saved_profile != self.running_profile()
    }

    fn running_profile(&self) -> String {
        serde_json::to_value(self.config.audio.profile)
            .ok()
            .and_then(|p| p.as_str().map(str::to_string))
            .unwrap_or_default()
    }

    fn local_audio(&self) -> LocalAudio {
        LocalAudio {
            profile: self.saved_profile.clone(),
            auto_processing: self.io.processing.auto_processing(),
            input_gain_db: self.io.processing.input_gain_db(),
            dim_db: self.dim_db,
            dim_feeds_while_speaking: self.dim_feeds_while_speaking,
            dim_when_addressed: self.dim_when_addressed,
            play_connection_sounds: self.play_connection_sounds,
            lock_multiple: self.talk.lock_multiple(),
            vox_enabled: self.vox.is_some(),
            vox_target: self.talk.vox_target(),
            vox_threshold_db: self.vox_threshold_db,
        }
    }

    /// Sends this client's effective settings to the server when they differ
    /// from `known` (what the server last told us), so Admin and the remote
    /// panel show what the headless client really runs with.
    async fn push_audio_settings(&mut self, connected: &Connected, known: Option<&Value>) {
        let settings = panel::audio_settings(&self.server_audio, &self.local_audio());
        if known.is_some_and(|known| !panel::audio_settings_differ(known, &settings)) {
            return;
        }
        let result = connected
            .socket
            .request(
                "user-audio-settings-update",
                json!({ "settings": settings, "revision": self.panel.revision }),
                SIGNAL_TIMEOUT,
            )
            .await;
        match result {
            Ok(ack) if ack.get("ok").and_then(Value::as_bool) == Some(true) => {
                tracing::info!(event = "user-audio-settings-reported");
                self.server_audio = ack.get("settings").cloned().unwrap_or(settings);
            }
            Ok(ack) => {
                let error = ack.get("error").cloned().unwrap_or_default();
                tracing::warn!(event = "user-audio-settings-report-rejected", %error);
            }
            Err(error) => {
                tracing::debug!(event = "user-audio-settings-report-failed", error = %format!("{error:#}"));
            }
        }
    }

    /// `local` also applies VOX, lock-multiple and the codec profile and saves
    /// them to the configuration file. Returns a talk change to send when VOX
    /// stopped talking.
    fn apply_user_audio_settings(&mut self, settings: &Value, local: bool) -> Option<TalkChange> {
        self.server_audio = settings.clone();
        let change = if local {
            self.apply_config_patch(ConfigPatch::from_json(settings))
        } else {
            None
        };
        let patch = UserAudioPatch::from_json(settings);
        if patch.is_empty() {
            return change;
        }
        self.io.processing.apply_capture_patch(&patch);
        if let Some(db) = patch.dim_amount_db {
            self.dim_db = db;
        }
        if let Some(enabled) = patch.dim_feeds_while_speaking {
            self.dim_feeds_while_speaking = enabled;
        }
        if let Some(enabled) = patch.dim_when_addressed {
            self.dim_when_addressed = enabled;
        }
        if patch.has_dimming() {
            if let Ok(mut mixer) = self.io.mixer.lock() {
                mixer.set_dimming(
                    patch.dim_amount_db,
                    patch.dim_feeds_while_speaking,
                    patch.dim_when_addressed,
                );
            }
        }
        if let Some(enabled) = patch.play_connection_sounds {
            if self.play_connection_sounds && !enabled {
                if let Ok(mut mixer) = self.io.mixer.lock() {
                    mixer.clear_cue();
                }
            }
            self.play_connection_sounds = enabled;
        }
        tracing::info!(
            event = "user-audio-settings",
            auto_processing = ?patch.audio_auto_processing,
            input_gain_db = ?patch.user_input_gain_db,
            dim_db = ?patch.dim_amount_db,
            play_connection_sounds = self.play_connection_sounds,
        );
        self.snapshot_dirty = true;
        change
    }

    fn apply_config_patch(&mut self, patch: ConfigPatch) -> Option<TalkChange> {
        let before = self.local_audio();
        if let Some(enabled) = patch.lock_multiple {
            self.talk.set_lock_multiple(enabled);
        }
        if let Some(profile) = patch.profile {
            self.saved_profile = profile;
        }
        let enabled = patch.vox_enabled.unwrap_or(before.vox_enabled);
        let target = patch.vox_target.unwrap_or(before.vox_target);
        let threshold = patch
            .vox_threshold_db
            .map(|db| db.clamp(-60.0, -6.0))
            .unwrap_or(before.vox_threshold_db);
        let mut change = None;
        if (enabled, target, threshold)
            != (
                before.vox_enabled,
                before.vox_target,
                before.vox_threshold_db,
            )
        {
            change = self.talk.set_vox_active(false);
            self.talk.set_vox_target(target);
            self.vox_threshold_db = threshold;
            self.vox = enabled.then(|| LevelTrigger::new(threshold, self.config.vox.hang_ms));
            tracing::info!(event = "vox-settings", enabled, target = ?target, threshold_db = threshold);
        }
        let after = self.local_audio();
        if after != before {
            self.save_config_audio(&after);
        }
        change
    }

    fn save_config_audio(&self, audio: &LocalAudio) {
        let Some(path) = &self.config_path else {
            return;
        };
        let values = [
            ("audio", "profile", json!(audio.profile)),
            ("talk", "lock_multiple", json!(audio.lock_multiple)),
            ("vox", "enabled", json!(audio.vox_enabled)),
            (
                "vox",
                "target",
                audio
                    .vox_target
                    .map(|t| json!(t.to_string()))
                    .unwrap_or(Value::Null),
            ),
            ("vox", "threshold_db", json!(audio.vox_threshold_db)),
        ];
        if let Err(error) = crate::config::update_values(path, &values) {
            tracing::warn!(event = "config-save-failed", error = %format!("{error:#}"));
        }
    }

    fn set_connection(&mut self, state: ConnectionState, detail: &str) {
        if self.connection != state || self.detail != detail {
            self.connection = state;
            self.detail = detail.to_string();
            self.snapshot_dirty = true;
        }
    }

    fn build_snapshot(&self) -> Snapshot {
        let audio_status = self.io.audio_status.borrow().clone();
        let receiving: BTreeSet<TargetKey> = self
            .io
            .mixer
            .lock()
            .map(|m| m.receiving_keys().into_iter().collect())
            .unwrap_or_default();
        let targets = self
            .targets
            .iter()
            .map(|target| {
                let level = self.audio.level(target.key);
                let online = match target.key {
                    TargetKey::User(id) => self.online_users.contains(&id),
                    TargetKey::Conference(_) => target
                        .members
                        .iter()
                        .any(|(id, _)| self.online_users.contains(id)),
                    TargetKey::Feed(_) => receiving.contains(&target.key),
                };
                let receiving_speakers = match target.key {
                    TargetKey::Conference(id) => self
                        .io
                        .mixer
                        .lock()
                        .map(|m| m.receiving_speakers(id))
                        .unwrap_or_default(),
                    _ => Vec::new(),
                };
                let self_id = self.login.as_ref().map(|login| login.user.id);
                let members = match target.key {
                    TargetKey::Conference(conference_id) => target
                        .members
                        .iter()
                        .filter(|(id, _)| Some(*id) != self_id)
                        .map(|(user_id, name)| {
                            let level = self.audio.member_level(conference_id, *user_id);
                            crate::state::ConferenceMemberInfo {
                                user_id: *user_id,
                                name: if name.is_empty() {
                                    format!("user:{user_id}")
                                } else {
                                    name.clone()
                                },
                                online: self.online_users.contains(user_id),
                                receiving: receiving_speakers.contains(user_id),
                                volume: level.volume,
                                muted: level.muted,
                            }
                        })
                        .collect(),
                    _ => Vec::new(),
                };
                TargetInfo {
                    key: target.key,
                    name: target.name.clone(),
                    can_talk: target.can_talk,
                    online,
                    held: self.talk.is_held(target.key),
                    locked: self.talk.is_locked(target.key),
                    incoming: self.incoming_keys.contains(&target.key),
                    receiving: receiving.contains(&target.key),
                    volume: level.volume,
                    muted: level.muted,
                    members,
                }
            })
            .collect();
        let reply_target = self.talk.effective_reply();
        let reply_name = reply_target.and_then(|key| {
            self.targets
                .iter()
                .find(|t| t.key == key)
                .map(|t| t.name.clone())
        });
        let capture_wanted = !matches!(
            self.config.audio.input_device.as_deref(),
            Some("none") | Some("off")
        );
        let playback_wanted = !matches!(
            self.config.audio.output_device.as_deref(),
            Some("none") | Some("off")
        );
        let media = self.media_info.clone();
        Snapshot {
            instance: self.config.instance.clone(),
            user_name: self
                .login
                .as_ref()
                .map(|l| l.user.name.clone())
                .unwrap_or_else(|| self.config.user.name.clone()),
            user_id: self.login.as_ref().map(|l| l.user.id),
            server_url: self.config.server.url.clone(),
            production: self
                .active_production
                .clone()
                .or_else(|| self.production.clone()),
            productions: self
                .login
                .iter()
                .flat_map(|login| &login.productions)
                .filter_map(|production| {
                    Some(ProductionInfo {
                        id: production_id_text(&production.id)?,
                        name: production.name.clone(),
                    })
                })
                .collect(),
            connection: self.connection,
            detail: self.detail.clone(),
            talking: self.talk.is_talking(),
            lock_active: !self.talk.locked().is_empty(),
            on_air: self.on_air,
            preview: self.preview,
            server_version: self.server_version.clone(),
            audio_ok: audio_status.all_ok(capture_wanted, playback_wanted),
            targets,
            reply_target,
            reply_name,
            main_target: self.talk.main_target(),
            main_unavailable: self.talk.main_unavailable(),
            incoming: self.incoming.clone(),
            last_caller: self.last_caller.clone(),
            input_level_db: self.input_level_db,
            media,
            registered_since_unix: self
                .registered_since
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .filter(|_| self.connection.is_online()),
            reconnects: self.reconnects,
            server_not_responding: self.connection.is_online() && self.alerts.interrupted(),
            heartbeat: self
                .alerts
                .heartbeat(self.connection.is_online())
                .to_string(),
            media_status: self
                .connection
                .is_online()
                .then(|| {
                    let (send, recv) = self
                        .media_info
                        .as_ref()
                        .map(|info| (info.send_state.as_str(), info.recv_state.as_str()))
                        .unwrap_or(("", ""));
                    super::alerts::media_status(self.alerts.interrupted(), send, recv)
                        .map(str::to_string)
                })
                .flatten(),
        }
    }

    fn play_announcement(&self, announcement: Option<Announcement>) {
        let Some(announcement) = announcement else {
            return;
        };
        if !self.play_connection_sounds {
            return;
        }
        let samples = match announcement {
            Announcement::Disconnected => crate::audio::cues::disconnected(),
            Announcement::Reconnected => crate::audio::cues::reconnected(),
        };
        if let Ok(mut mixer) = self.io.mixer.lock() {
            mixer.enqueue_cue(samples);
        }
        tracing::info!(
            event = "connection-cue",
            kind = match announcement {
                Announcement::Disconnected => "disconnected",
                Announcement::Reconnected => "reconnected",
            }
        );
    }

    fn spawn_health_probe(&mut self, socket: &SocketClient) {
        if !self.alerts.wants_probe() {
            return;
        }
        let generation = self.alerts.generation();
        self.alerts.note_probe_sent();
        let socket = socket.clone();
        let tx = self.probe_tx.clone();
        let sent_at = Instant::now();
        tokio::spawn(async move {
            let ok = matches!(
                socket
                    .request_no_payload("connection-health", super::alerts::PROBE_TIMEOUT)
                    .await,
                Ok(Value::Bool(true))
            );
            let _ = tx
                .send(ProbeReply {
                    generation,
                    sent_at,
                    ok,
                })
                .await;
        });
    }

    fn publish(&mut self, force: bool) {
        if !self.snapshot_dirty && !force {
            return;
        }
        if !force && self.last_snapshot.elapsed() < SNAPSHOT_DEBOUNCE {
            return;
        }
        let snapshot = self.build_snapshot();
        self.snapshot_dirty = false;
        self.last_snapshot = Instant::now();
        if **self.io.snapshots.borrow() != snapshot {
            let _ = self.io.snapshots.send(Arc::new(snapshot));
        }
    }
}

/// Waits for the current media generation's next transport event; pends
/// forever while there is no media so `select!` can ignore it.
async fn recv_media_event(media: &mut Option<Media>) -> RtcEvent {
    match media.as_mut() {
        Some(media) => match media.rtc_rx.recv().await {
            Some(event) => event,
            None => std::future::pending().await,
        },
        None => std::future::pending().await,
    }
}

async fn wait_true(rx: &mut watch::Receiver<bool>) {
    loop {
        if *rx.borrow() {
            return;
        }
        if rx.changed().await.is_err() {
            std::future::pending::<()>().await;
        }
    }
}

fn peer_state_label(state: RTCPeerConnectionState) -> &'static str {
    match state {
        RTCPeerConnectionState::Unspecified => "unspecified",
        RTCPeerConnectionState::New => "new",
        RTCPeerConnectionState::Connecting => "connecting",
        RTCPeerConnectionState::Connected => "connected",
        RTCPeerConnectionState::Disconnected => "disconnected",
        RTCPeerConnectionState::Failed => "failed",
        RTCPeerConnectionState::Closed => "closed",
    }
}

fn transport_blocks(media: Option<&Media>) -> (bool, bool) {
    let Some(media) = media else {
        return (false, false);
    };
    let blocks = |state| {
        matches!(
            state,
            RTCPeerConnectionState::Connecting
                | RTCPeerConnectionState::Disconnected
                | RTCPeerConnectionState::Failed
        )
    };
    (blocks(media.send_state), blocks(media.recv_state))
}

/// Prefers the media-path RTT while it is fresh. webrtc-rs does not measure
/// ICE RTT, and RTCP only flows while talking, so the heartbeat fills in.
fn choose_rtt(
    media: Option<(u32, Instant)>,
    signalling_ms: Option<f32>,
    now: Instant,
) -> (Option<u32>, Option<&'static str>) {
    match media {
        Some((ms, at)) if now.saturating_duration_since(at) < MEDIA_RTT_FRESH => {
            (Some(ms), Some("media"))
        }
        _ => match signalling_ms {
            Some(ms) => (Some(ms.round() as u32), Some("signalling")),
            None => (None, None),
        },
    }
}

/// Production ids arrive as numbers from the server; config stores text.
fn production_id_text(id: &Value) -> Option<String> {
    match id {
        Value::Number(n) => Some(n.to_string()),
        Value::String(s) => Some(s.clone()),
        _ => None,
    }
}

fn parse_cut_camera(payload: &Value) -> (bool, bool) {
    if let Some(pgm) = payload.as_bool() {
        return (pgm, false);
    }
    (
        payload.get("pgm").and_then(Value::as_bool).unwrap_or(false),
        payload.get("prv").and_then(Value::as_bool).unwrap_or(false),
    )
}

fn parse_conference_members(values: &[Value]) -> Vec<(i64, String)> {
    values
        .iter()
        .filter_map(|member| {
            if let Some(id) = member.as_i64() {
                return Some((id, String::new()));
            }
            let id = member.get("userId").and_then(Value::as_i64)?;
            let name = member
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            Some((id, name))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{choose_rtt, parse_conference_members, parse_cut_camera, MEDIA_RTT_FRESH};
    use serde_json::json;
    use std::time::{Duration, Instant};

    #[test]
    fn rtt_prefers_fresh_media_then_falls_back_to_heartbeat() {
        let now = Instant::now();
        assert_eq!(
            choose_rtt(Some((18, now)), Some(41.6), now),
            (Some(18), Some("media"))
        );
        let stale = now - MEDIA_RTT_FRESH - Duration::from_secs(1);
        assert_eq!(
            choose_rtt(Some((18, stale)), Some(41.6), now),
            (Some(42), Some("signalling"))
        );
        assert_eq!(choose_rtt(None, None, now), (None, None));
    }

    #[test]
    fn parse_cut_camera_accepts_legacy_bool_and_pgm_prv_object() {
        assert_eq!(parse_cut_camera(&json!(true)), (true, false));
        assert_eq!(parse_cut_camera(&json!(false)), (false, false));
        assert_eq!(
            parse_cut_camera(&json!({ "productionId": 3, "pgm": true, "prv": false })),
            (true, false)
        );
        assert_eq!(
            parse_cut_camera(&json!({ "pgm": false, "prv": true })),
            (false, true)
        );
        assert_eq!(
            parse_cut_camera(&json!({ "pgm": true, "prv": true })),
            (true, true)
        );
        assert_eq!(parse_cut_camera(&json!(null)), (false, false));
    }

    #[test]
    fn parse_conference_members_accepts_objects_and_ids() {
        let members = parse_conference_members(&[
            json!({ "userId": 7, "name": "ueli" }),
            json!(8),
            json!({ "userId": "nope" }),
            json!({ "name": "anon" }),
        ]);
        assert_eq!(members, vec![(7, "ueli".into()), (8, String::new())]);
    }
}
