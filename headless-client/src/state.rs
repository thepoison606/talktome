//! Shared runtime state published to surfaces and the commands they send back.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use serde::Serialize;
use tokio::sync::{mpsc, watch};

use crate::talk::TargetKey;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectionState {
    /// Not connected; `retry_in_ms` in the snapshot says when we try again.
    Disconnected,
    Connecting,
    LoggingIn,
    Registering,
    /// Another session holds the account and the conflict policy is `wait`.
    Conflict,
    /// The server closed our session in favour of another one.
    Kicked,
    /// Registered; media not yet ready.
    Registered,
    /// Registered and both transports connected.
    Ready,
}

impl ConnectionState {
    pub fn is_online(self) -> bool {
        matches!(self, ConnectionState::Registered | ConnectionState::Ready)
    }

    /// Registered and both media transports are up — GPIO `connected`.
    pub fn is_ready(self) -> bool {
        matches!(self, ConnectionState::Ready)
    }

    pub fn label(self) -> &'static str {
        match self {
            ConnectionState::Disconnected => "offline",
            ConnectionState::Connecting => "connecting",
            ConnectionState::LoggingIn => "login",
            ConnectionState::Registering => "registering",
            ConnectionState::Conflict => "conflict",
            ConnectionState::Kicked => "kicked",
            ConnectionState::Registered => "media…",
            ConnectionState::Ready => "ready",
        }
    }
}

/// One target as rendered on a key: identity plus live state.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TargetInfo {
    pub key: TargetKey,
    pub name: String,
    pub can_talk: bool,
    /// Online (users) / has members online (conferences) / producing (feeds).
    pub online: bool,
    pub held: bool,
    pub locked: bool,
    /// This target (or someone in it) is currently addressing us.
    pub incoming: bool,
    /// We currently receive audio from this target.
    pub receiving: bool,
    pub volume: f32,
    pub muted: bool,
    /// Conference members (empty for users and feeds). Each can be heard
    /// independently, like the browser client's member mix.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub members: Vec<ConferenceMemberInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ConferenceMemberInfo {
    pub user_id: i64,
    pub name: String,
    pub online: bool,
    pub receiving: bool,
    pub volume: f32,
    pub muted: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IncomingInfo {
    pub from_name: String,
    pub target: Option<TargetKey>,
}

/// Media transport details for the status page.
#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct MediaInfo {
    pub send_state: String,
    pub recv_state: String,
    pub consumers: usize,
    pub producer_id: Option<String>,
    pub ice_servers: Vec<String>,
    /// URLs announced by the Talktome server (often `turns:…?transport=tcp`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ice_servers_announced: Vec<String>,
    pub ice_transport_policy: String,
    /// Round-trip time in milliseconds (see `rtt_source`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rtt_ms: Option<u32>,
    /// `media` (RTCP on the send transport, while talking) or `signalling`
    /// (the `connection-health` heartbeat to the server).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rtt_source: Option<String>,
    /// Packet loss over both directions, percent: what mediasoup reports for
    /// our producer plus sequence gaps on the consumers we receive.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub packet_loss_pct: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub packets_lost: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub packets_received: Option<u64>,
    /// Receive-side concealment as a percent of packets + PLC frames.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recv_conceal_pct: Option<f32>,
}

/// A production this user is assigned to, for the Settings dropdown.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProductionInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Snapshot {
    pub instance: String,
    pub user_name: String,
    pub user_id: Option<i64>,
    pub server_url: String,
    pub production: Option<String>,
    /// Productions the user is assigned to (from login, kept current).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub productions: Vec<ProductionInfo>,
    pub connection: ConnectionState,
    pub detail: String,
    pub talking: bool,
    pub lock_active: bool,
    /// Program (PGM) tally — the web client's red on-air state.
    pub on_air: bool,
    /// Preview (PRV) tally — the web client's green preview state.
    pub preview: bool,
    /// Talktome server version from `GET /login/options` (`appVersion`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_version: Option<String>,
    pub audio_ok: bool,
    pub targets: Vec<TargetInfo>,
    /// Effective Reply / Main destination (pin when assigned, else last incoming).
    pub reply_target: Option<TargetKey>,
    pub reply_name: Option<String>,
    /// Configured `talk.main_target` pin, when set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_target: Option<TargetKey>,
    /// Pin is set but not in this user's assigned destinations.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub main_unavailable: bool,
    pub incoming: Vec<IncomingInfo>,
    /// Who addressed us most recently; kept after they stop talking.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_caller: Option<String>,
    /// Peak input level in dBFS for meters / VOX display.
    pub input_level_db: f32,
    pub media: Option<MediaInfo>,
    /// Unix seconds when the current registration became active.
    pub registered_since_unix: Option<u64>,
    pub reconnects: u32,
    /// v1.5.6 heartbeat: the socket is up but `connection-health` has gone stale.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub server_not_responding: bool,
    /// `ok`, `missing`, `not offered`, or an em dash while offline.
    #[serde(default)]
    pub heartbeat: String,
    /// Web-client media line (`Server not responding`, `Media interrupted`, …).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_status: Option<String>,
}

impl Snapshot {
    pub fn initial(instance: &str, user_name: &str) -> Self {
        Self {
            instance: instance.to_string(),
            user_name: user_name.to_string(),
            user_id: None,
            server_url: String::new(),
            production: None,
            productions: Vec::new(),
            connection: ConnectionState::Disconnected,
            detail: String::new(),
            talking: false,
            lock_active: false,
            on_air: false,
            preview: false,
            server_version: None,
            audio_ok: false,
            targets: Vec::new(),
            reply_target: None,
            reply_name: None,
            main_target: None,
            main_unavailable: false,
            incoming: Vec::new(),
            last_caller: None,
            input_level_db: -100.0,
            media: None,
            registered_since_unix: None,
            reconnects: 0,
            server_not_responding: false,
            heartbeat: "–".into(),
            media_status: None,
        }
    }

    /// The configured production: `user.production` may be an id or a
    /// name, matched against this user's productions.
    pub fn current_production(&self) -> Option<&ProductionInfo> {
        let wanted = self
            .production
            .as_deref()
            .map(str::trim)
            .filter(|p| !p.is_empty())?;
        self.productions
            .iter()
            .find(|p| p.id == wanted)
            .or_else(|| {
                self.productions
                    .iter()
                    .find(|p| p.name.eq_ignore_ascii_case(wanted))
            })
    }

    pub fn is_current_production(&self, production: &ProductionInfo) -> bool {
        self.current_production()
            .is_some_and(|current| current.id == production.id)
    }

    /// Display name of the configured production, or the raw value when it
    /// is not in the list.
    pub fn production_name(&self) -> Option<String> {
        let wanted = self
            .production
            .as_deref()
            .map(str::trim)
            .filter(|p| !p.is_empty())?;
        Some(
            self.current_production()
                .map_or(wanted, |p| p.name.as_str())
                .to_string(),
        )
    }

    pub fn target(&self, key: TargetKey) -> Option<&TargetInfo> {
        self.targets.iter().find(|t| t.key == key)
    }

    /// Status-key / health label. PGM wins over PRV, matching the web client.
    pub fn tally_label(&self) -> Option<&'static str> {
        if self.on_air {
            Some("ON AIR")
        } else if self.preview {
            Some("PREVIEW")
        } else {
            None
        }
    }

    /// Label for the Reply key: the conference (or target) being talked to,
    /// never the caller’s display name. Matches the web client’s reply button.
    /// A Main pin that is missing from the destination list is "Unavailable target"
    /// and does not fall back to last incoming.
    /// Incoming calls that concern Reply: a call into a listen-only
    /// conference cannot be answered there, so it is left out.
    pub fn reply_incoming(&self) -> impl Iterator<Item = &IncomingInfo> {
        self.incoming.iter().filter(|incoming| {
            !incoming.target.is_some_and(|key| {
                matches!(key, TargetKey::Conference(_))
                    && self.target(key).is_some_and(|target| !target.can_talk)
            })
        })
    }

    pub fn reply_label(&self) -> Option<String> {
        let incoming: Vec<&IncomingInfo> = self.reply_incoming().collect();
        let name_of = |key: TargetKey| self.target(key).map(|target| target.name.clone());
        if self.main_unavailable {
            return Some("Unavailable target".to_string());
        }
        if self.main_target.is_some() {
            return self.reply_target.and_then(name_of).or_else(|| {
                self.reply_name
                    .as_deref()
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .map(str::to_string)
            });
        }
        let conference_name = |key: TargetKey| match key {
            TargetKey::Conference(_) => name_of(key),
            _ => None,
        };
        if let Some(key) = self.reply_target {
            if let Some(name) = conference_name(key) {
                return Some(name);
            }
        }
        if let Some(name) = incoming
            .iter()
            .find_map(|incoming| incoming.target.and_then(conference_name))
        {
            return Some(name);
        }
        if let Some(name) = self
            .reply_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
        {
            let is_caller = incoming
                .iter()
                .any(|incoming| incoming.from_name.eq_ignore_ascii_case(name));
            let has_conference = incoming
                .iter()
                .any(|incoming| matches!(incoming.target, Some(TargetKey::Conference(_))));
            if !(is_caller && has_conference) {
                return Some(name.to_string());
            }
        }
        if let Some(key) = self.reply_target {
            if let Some(name) = name_of(key) {
                return Some(name);
            }
        }
        incoming
            .iter()
            .find_map(|incoming| incoming.target.and_then(name_of))
    }
}

#[cfg(test)]
mod tests {
    use super::{IncomingInfo, Snapshot};
    use crate::talk::TargetKey;

    #[test]
    fn tally_label_pgm_wins_over_preview() {
        let mut snapshot = Snapshot::initial("cam", "Cam");
        assert_eq!(snapshot.tally_label(), None);
        snapshot.preview = true;
        assert_eq!(snapshot.tally_label(), Some("PREVIEW"));
        snapshot.on_air = true;
        assert_eq!(snapshot.tally_label(), Some("ON AIR"));
    }

    #[test]
    fn reply_label_missing_pin_does_not_use_incoming() {
        let mut snapshot = Snapshot::initial("cam", "Cam");
        snapshot.targets.push(super::TargetInfo {
            key: TargetKey::Conference(1),
            name: "News".into(),
            can_talk: true,
            online: true,
            held: false,
            locked: false,
            incoming: true,
            receiving: false,
            volume: 0.9,
            muted: false,
            members: Vec::new(),
        });
        snapshot.incoming = vec![IncomingInfo {
            from_name: "jan".into(),
            target: Some(TargetKey::Conference(1)),
        }];
        snapshot.main_target = Some(TargetKey::User(9));
        snapshot.main_unavailable = true;
        snapshot.reply_target = None;
        snapshot.reply_name = None;
        assert_eq!(
            snapshot.reply_label().as_deref(),
            Some("Unavailable target")
        );

        snapshot.main_unavailable = false;
        snapshot.reply_target = Some(TargetKey::User(9));
        snapshot.reply_name = Some("Cam 9".into());
        snapshot.targets.push(super::TargetInfo {
            key: TargetKey::User(9),
            name: "Cam 9".into(),
            can_talk: true,
            online: true,
            held: false,
            locked: false,
            incoming: false,
            receiving: false,
            volume: 0.9,
            muted: false,
            members: Vec::new(),
        });
        assert_eq!(snapshot.reply_label().as_deref(), Some("Cam 9"));
    }
}

/// What a talk action refers to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TargetRef {
    Key(TargetKey),
    Reply,
}

/// Identifies who is pressing, so a Companion press does not release a
/// physically held key for the same target.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum InputSource {
    StreamDeck { device: u8, key: u8 },
    Gpio(String),
    Companion(String),
}

#[derive(Debug, Clone)]
pub enum Command {
    TalkPress {
        source: InputSource,
        target: TargetRef,
    },
    TalkRelease {
        source: InputSource,
        target: TargetRef,
    },
    LockToggle {
        target: TargetRef,
    },
    ClearLocks,
    MuteToggle(TargetKey),
    VolumeStep {
        target: TargetKey,
        delta: f32,
    },
    VolumeSet {
        target: TargetKey,
        volume: f32,
    },
    MemberVolumeSet {
        conference: TargetKey,
        user_id: i64,
        volume: f32,
    },
    MemberMuteToggle {
        conference: TargetKey,
        user_id: i64,
    },
    /// Switch to another assigned production (Stream Deck production page).
    SetProduction(String),
    /// Request a fresh snapshot broadcast (e.g. after a deck reconnects).
    Refresh,
    Shutdown,
}

/// Live view of a GPIO output line.
#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct GpioOutputView {
    pub name: String,
    pub line: String,
    pub active_low: bool,
    /// `None` until the line has been driven.
    pub active: Option<bool>,
    pub error: Option<String>,
}

/// Live view of a GPIO input line.
#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct GpioInputView {
    pub line: String,
    pub action: String,
    pub target: Option<String>,
    pub active_low: bool,
    pub pressed: bool,
    pub events: u64,
    /// Why the line could not be requested (e.g. used by another instance).
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct GpioStatus {
    /// `disabled`, `gpiocdev`, `mock` or `error`.
    pub backend: String,
    pub error: Option<String>,
    pub outputs: Vec<GpioOutputView>,
    pub inputs: Vec<GpioInputView>,
}

/// Live view of the local JSON-lines control socket.
#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct SocketStatus {
    pub enabled: bool,
    pub unix_path: Option<String>,
    pub tcp: Option<String>,
    pub clients: u32,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct DeckKeyView {
    pub index: u8,
    pub role: String,
    pub title: String,
    pub subtitle: String,
    /// Changes whenever the rendered image changes; used as cache key.
    /// String so the browser does not round a u64 past 2^53.
    pub hash: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct DeckDialView {
    pub index: u8,
    pub role: String,
    pub title: String,
    pub subtitle: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct DeckStatus {
    pub id: usize,
    pub enabled: bool,
    pub connected: bool,
    pub mock: bool,
    pub kind: Option<String>,
    pub serial: Option<String>,
    pub rows: u8,
    pub cols: u8,
    pub encoders: u8,
    pub touchpoints: u8,
    pub key_size: u32,
    pub page: usize,
    pub pages: usize,
    pub encoder_page: usize,
    pub encoder_pages: usize,
    pub volume_layer: bool,
    pub member_layer: bool,
    /// Open menu page (`menu`, `productions`, `info`), if any.
    pub menu: Option<String>,
    pub keys: Vec<DeckKeyView>,
    pub dials: Vec<DeckDialView>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct AudioView {
    pub capture_ok: bool,
    pub playback_ok: bool,
    pub capture_device: Option<String>,
    pub playback_device: Option<String>,
    pub last_error: Option<String>,
    #[serde(default)]
    pub auto_processing: bool,
    #[serde(default)]
    pub aec: bool,
    #[serde(default)]
    pub delay_ms: i32,
}

pub type DeckImage = (u64, Arc<Vec<u8>>);
pub type DeckImages = HashMap<(usize, u8), DeckImage>;

/// Hardware state written by the surfaces and read by the web UI.
#[derive(Debug, Default)]
pub struct Hardware {
    pub gpio: GpioStatus,
    pub socket: SocketStatus,
    pub decks: Vec<DeckStatus>,
    /// Rendered key images (PNG) keyed by (device, key) with their hash.
    pub deck_images: DeckImages,
    pub audio: AudioView,
    /// Per-device input inlets filled by the Stream Deck tasks.
    pub deck_inputs: Vec<mpsc::Sender<DeckInput>>,
}

/// Input injected into the Stream Deck surface (from the web UI).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeckInput {
    KeyDown(u8),
    KeyUp(u8),
    EncoderTwist(u8, i8),
    EncoderPress(u8),
    EncoderRelease(u8),
    TouchPoint(u8),
}

/// Publisher side of the state channel plus the command inlet, handed to
/// surfaces, the web UI and audio.
#[derive(Clone)]
pub struct Bus {
    pub commands: mpsc::Sender<Command>,
    pub snapshots: watch::Receiver<Arc<Snapshot>>,
    pub hardware: Arc<RwLock<Hardware>>,
}

pub struct Channels {
    pub commands: mpsc::Receiver<Command>,
    pub snapshots: watch::Sender<Arc<Snapshot>>,
    pub bus: Bus,
}

pub fn channels(initial: Snapshot) -> Channels {
    let (cmd_tx, cmd_rx) = mpsc::channel(256);
    let (snap_tx, snap_rx) = watch::channel(Arc::new(initial));
    let bus = Bus {
        commands: cmd_tx,
        snapshots: snap_rx,
        hardware: Arc::new(RwLock::new(Hardware::default())),
    };
    Channels {
        commands: cmd_rx,
        snapshots: snap_tx,
        bus,
    }
}
