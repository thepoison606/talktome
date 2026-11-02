//! Configuration schema, loading (JSON or TOML by extension) and environment
//! overrides (`TALKTOME_<SECTION>_<KEY>`).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const DEFAULT_CONFIG_DIR: &str = "/etc/talktome-headless";
pub const ENV_PREFIX: &str = "TALKTOME_";
/// Placeholder used for secrets in API output; sending it back keeps the
/// stored value.
pub const REDACTED: &str = "********";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    /// Instance name; defaults to the configuration file stem.
    pub instance: String,
    pub server: ServerConfig,
    pub tls: TlsConfig,
    pub user: UserConfig,
    pub registration: RegistrationConfig,
    pub audio: AudioConfig,
    pub vox: VoxConfig,
    pub talk: TalkConfig,
    pub ice: IceConfig,
    pub network: NetworkConfig,
    pub streamdeck: StreamDeckConfig,
    pub gpio: GpioConfig,
    /// Local JSON-lines control socket for a display, rotary encoders, or MCU.
    pub socket: SocketConfig,
    pub health: HealthConfig,
    pub log: LogConfig,
    pub web: WebConfig,
    /// Directory for persisted runtime state (audio levels). Defaults to
    /// `$STATE_DIRECTORY` under systemd or `/var/lib/talktome-headless/<instance>`.
    pub state_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ServerConfig {
    /// Base URL of the Talktome server, e.g. `https://talktome.local:8443`.
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
#[derive(Default)]
pub struct TlsConfig {
    /// PEM file with one or more additional trusted CA certificates.
    pub ca_file: Option<PathBuf>,
    /// SHA-256 fingerprint of the server's leaf certificate (`AB:CD:...` or hex).
    pub fingerprint_sha256: Option<String>,
    /// Accept any certificate. Development only.
    pub insecure: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
#[derive(Default)]
pub struct UserConfig {
    pub name: String,
    pub password: String,
    /// Production id or name; `null` lets the server pick the default.
    pub production: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConflictPolicy {
    Takeover,
    Wait,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct RegistrationConfig {
    pub conflict: ConflictPolicy,
    pub takeover_delay_ms: u64,
    pub retry_ms: u64,
    pub kicked_retry_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AudioProfile {
    /// 5 ms frames, no FEC, 48 kbit/s.
    UltraLow,
    /// 10 ms frames, no FEC, 64 kbit/s.
    Low,
    /// 20 ms frames, FEC, 64 kbit/s.
    Standard,
}

/// `audio.network`: defaults for the jitter buffer and the send profile.
/// Values set explicitly in the file always win over the preset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NetworkPreset {
    /// Wired or good Wi-Fi: lowest delay.
    #[default]
    Lan,
    /// This client sits on a mobile network: a deeper buffer from the first
    /// packet and 20 ms frames with FEC on the way out.
    Mobile,
}

impl NetworkPreset {
    /// (key, value) pairs the preset fills in when the file leaves them out.
    fn defaults(self) -> &'static [(&'static str, &'static str)] {
        match self {
            NetworkPreset::Lan => &[],
            NetworkPreset::Mobile => &[
                ("jitter_start_ms", "150"),
                ("jitter_min_ms", "60"),
                ("jitter_max_ms", "600"),
                ("profile", "standard"),
            ],
        }
    }
}

impl AudioProfile {
    pub fn frame_ms(self) -> u32 {
        match self {
            AudioProfile::UltraLow => 5,
            AudioProfile::Low => 10,
            AudioProfile::Standard => 20,
        }
    }

    pub fn fec(self) -> bool {
        matches!(self, AudioProfile::Standard)
    }

    pub fn bitrate(self) -> i32 {
        match self {
            AudioProfile::UltraLow => 48_000,
            AudioProfile::Low | AudioProfile::Standard => 64_000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AudioConfig {
    /// ALSA/cpal device name; `null` = system default. `"none"` disables capture.
    pub input_device: Option<String>,
    /// ALSA/cpal device name; `null` = system default. `"none"` disables playback.
    pub output_device: Option<String>,
    pub profile: AudioProfile,
    /// ALSA period in milliseconds. `0` keeps the driver default (often
    /// 21–85 ms). The device buffer is two periods. A size the card rejects
    /// falls back to the driver default.
    #[serde(default = "default_device_period_ms")]
    pub device_period_ms: u32,
    pub input_gain_db: f32,
    /// Echo cancellation, noise suppression and AGC (same as the browser
    /// `audioAutoProcessing` toggle). Ignored for `input_gain_db` while on.
    pub auto_processing: bool,
    /// Override AEC render/capture delay in milliseconds. `null` estimates
    /// from the observed capture and playback callback periods.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_delay_ms: Option<u32>,
    /// Feed ducking while talking / addressed. Default −15 dB; stored −14 is
    /// migrated to −15. The web client offers −6, −12, −15, −18, −24; other
    /// finite values in the file are kept.
    pub dim_db: f32,
    pub dim_feeds_while_speaking: bool,
    pub dim_when_addressed: bool,
    /// Play the disconnect and reconnect tones. Same as the web client's
    /// "Play connection sounds" switch. A live `playConnectionSounds` value
    /// in `user-audio-settings-updated` overrides this until restart.
    #[serde(default = "default_play_connection_sounds")]
    pub play_connection_sounds: bool,
    /// `lan` (default) or `mobile`; see [`NetworkPreset`].
    pub network: NetworkPreset,
    /// Playout depth each new stream starts at. It only drops toward
    /// `jitter_min_ms` once 10 s of arrivals show the link is calmer.
    pub jitter_start_ms: u32,
    pub jitter_min_ms: u32,
    pub jitter_max_ms: u32,
    pub reopen_ms: u64,
    /// Default per-target volume for targets without persisted state (0–1).
    /// Prefer `default_volume_db`; this linear value is kept for older files.
    pub default_volume: f32,
    /// Default per-target volume in dB (0 = unity). Overrides `default_volume`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_volume_db: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct VoxConfig {
    pub enabled: bool,
    /// Target key such as `conference:1` or `user:4`.
    pub target: Option<String>,
    pub threshold_db: f32,
    pub hang_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct TalkConfig {
    /// A press shorter than this toggles the talk lock instead of talking.
    pub tap_ms: u64,
    pub lock_multiple: bool,
    /// Pin Reply / Main to this destination (`user:4`, `conference:1`).
    /// Empty/`null` = last incoming reply. A pin that is not in this user's
    /// assigned targets does not fall back to another destination.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
#[derive(Default)]
pub struct IceServerConfig {
    pub urls: Vec<String>,
    pub username: Option<String>,
    pub credential: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
#[derive(Default)]
pub struct IceConfig {
    /// Overrides the servers announced by Talktome. Testing only.
    pub servers: Option<Vec<IceServerConfig>>,
    /// `all` or `relay`; overrides the server's policy. Testing only.
    pub transport_policy: Option<String>,
    /// Gather IPv6 host and server-reflexive candidates. Off by default:
    /// webrtc-ice cannot bind IPv6 link-local addresses (EINVAL) and IPv6
    /// STUN lookup fails when the only IPv6 addresses on the box are
    /// link-local. Remote IPv6 ICE candidates from the server are still used.
    pub ipv6: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct NetworkConfig {
    pub ice_disconnect_grace_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct StreamDeckConfig {
    pub enabled: bool,
    /// Serial number of the deck to use; `null` = first found. Used when
    /// `devices` is empty.
    pub serial: Option<String>,
    /// Dummy deck when no hardware is attached (`mk2`, `plus`, `xl`, `neo`,
    /// `pedal`, …). Empty = discover a real Stream Deck. The environment
    /// variable `TALKTOME_MOCK_STREAMDECK` still wins when set on the first
    /// device. Used when `devices` is empty.
    pub mock: Option<String>,
    pub brightness: u8,
    pub font_path: PathBuf,
    /// Legacy linear volume step (0–1). Ignored when `volume_step_db` is set,
    /// or when this value is ≤ 1 (treated as the old fraction and replaced by
    /// a 3 dB tick).
    pub volume_step: f32,
    /// Volume change per Stream Deck key/dial tick, in dB.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume_step_db: Option<f32>,
    pub volume_layer_timeout_s: u64,
    /// Target key for the left Stream Deck Pedal switch (`user:4`, …).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pedal_left: Option<String>,
    /// Target key for the middle Stream Deck Pedal switch.
    pub pedal_target: Option<String>,
    /// Pedal key overrides: hardware index as a string → target.
    ///
    /// Only `"0"` (left) and `"1"` (middle) are applied. They win over
    /// `pedal_left` / `pedal_target`. The right switch is always Reply.
    /// Other indexes are stored but ignored; visual decks never read this map.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub layout: BTreeMap<String, String>,
    /// Extra (or all) decks. When empty, `serial` / `mock` / pedal fields
    /// describe a single device.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub devices: Vec<StreamDeckDeviceConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
pub struct StreamDeckDeviceConfig {
    pub serial: Option<String>,
    pub mock: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pedal_left: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pedal_target: Option<String>,
    /// Same map as [`StreamDeckConfig::layout`], scoped to this device.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub layout: BTreeMap<String, String>,
}

impl StreamDeckConfig {
    /// Devices this instance should open: the `devices` list, or one device
    /// built from the legacy top-level serial/mock/pedal fields.
    pub fn resolved_devices(&self) -> Vec<StreamDeckDeviceConfig> {
        if !self.devices.is_empty() {
            return self.devices.clone();
        }
        vec![StreamDeckDeviceConfig {
            serial: self.serial.clone(),
            mock: self.mock.clone(),
            pedal_left: self.pedal_left.clone(),
            pedal_target: self.pedal_target.clone(),
            layout: self.layout.clone(),
        }]
    }
}

pub fn known_streamdeck_mock(name: &str) -> bool {
    matches!(
        name.trim()
            .to_ascii_lowercase()
            .replace(['-', '_', ' '], "")
            .as_str(),
        "original"
            | "originalv2"
            | "v2"
            | "mini"
            | "minimk2"
            | "mk2"
            | "xl"
            | "xlv2"
            | "plus"
            | "plusxl"
            | "neo"
            | "pedal"
            | ""
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
#[derive(Default)]
pub struct GpioOutputConfig {
    pub line: String,
    pub active_low: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GpioInputAction {
    Talk,
    Reply,
    LockToggle,
    ClearLocks,
    MuteToggle,
    VolumeUp,
    VolumeDown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GpioInputConfig {
    pub line: String,
    pub action: GpioInputAction,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub active_low: bool,
    #[serde(default = "default_debounce_ms")]
    pub debounce_ms: u32,
}

fn default_debounce_ms() -> u32 {
    20
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct GpioConfig {
    pub enabled: bool,
    /// GPIO chip (`gpiochip0`, `/dev/gpiochip4`); `null` = search by line name.
    pub chip: Option<String>,
    /// Named outputs: `tally` (PGM), `tally_preview` (PRV), `talking`,
    /// `incoming`, `connected`, `locked`, `status` (status light: short
    /// flash = running, 1 s blink = registered with an error, on = media ok).
    pub outputs: BTreeMap<String, GpioOutputConfig>,
    /// Extra outputs that follow one target's incoming or receiving audio.
    #[serde(default)]
    pub target_outputs: Vec<GpioTargetOutputConfig>,
    pub inputs: Vec<GpioInputConfig>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GpioTargetWhen {
    #[default]
    Receiving,
    Incoming,
}

impl GpioTargetWhen {
    pub fn as_str(self) -> &'static str {
        match self {
            GpioTargetWhen::Receiving => "receiving",
            GpioTargetWhen::Incoming => "incoming",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GpioTargetOutputConfig {
    pub line: String,
    /// `user:4`, `conference:1` or `feed:2`.
    pub target: String,
    #[serde(default)]
    pub active_low: bool,
    /// `receiving` (audio from this target) or `incoming` (this target is addressing us).
    #[serde(default)]
    pub when: GpioTargetWhen,
}

/// Local JSON-lines socket so a custom OLED, rotary board or MCU can attach
/// to the same talk / volume bus as the Stream Deck and GPIO surfaces.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SocketConfig {
    pub enabled: bool,
    /// Unix socket path. Empty/`null` = `$RUNTIME_DIRECTORY/control.sock`
    /// under systemd, otherwise `/tmp/talktome-headless-<instance>-control.sock`.
    pub path: Option<PathBuf>,
    /// Optional loopback TCP bind (`127.0.0.1:9876` or `[::1]:9876`) for
    /// development. Empty/`null` = Unix socket only. Non-loopback binds are
    /// rejected.
    pub tcp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct HealthConfig {
    /// Port for the optional `GET /healthz` listener on 127.0.0.1.
    pub port: Option<u16>,
    pub bind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct LogConfig {
    pub level: String,
    /// `auto`, `json` or `text`.
    pub format: String,
}

/// Local administration web interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct WebConfig {
    pub enabled: bool,
    pub bind: String,
    pub port: u16,
    /// Password of the fixed `admin` login. The default forces a change on
    /// first login. Can also come from `TALKTOME_WEB_PASSWORD`.
    pub password: String,
}

pub const WEB_DEFAULT_PASSWORD: &str = "admin";
pub const WEB_ADMIN_USER: &str = "admin";

impl Default for Config {
    fn default() -> Self {
        Self {
            instance: "default".into(),
            server: ServerConfig::default(),
            tls: TlsConfig::default(),
            user: UserConfig::default(),
            registration: RegistrationConfig::default(),
            audio: AudioConfig::default(),
            vox: VoxConfig::default(),
            talk: TalkConfig::default(),
            ice: IceConfig::default(),
            network: NetworkConfig::default(),
            streamdeck: StreamDeckConfig::default(),
            gpio: GpioConfig::default(),
            socket: SocketConfig::default(),
            health: HealthConfig::default(),
            log: LogConfig::default(),
            web: WebConfig::default(),
            state_dir: None,
        }
    }
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            url: "https://talktome.local:8443".into(),
        }
    }
}

impl Default for RegistrationConfig {
    fn default() -> Self {
        Self {
            conflict: ConflictPolicy::Takeover,
            takeover_delay_ms: 1500,
            retry_ms: 5000,
            kicked_retry_ms: 10_000,
        }
    }
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            input_device: None,
            output_device: None,
            profile: AudioProfile::UltraLow,
            device_period_ms: default_device_period_ms(),
            input_gain_db: 0.0,
            auto_processing: false,
            stream_delay_ms: None,
            dim_db: DEFAULT_DIM_DB,
            dim_feeds_while_speaking: false,
            dim_when_addressed: true,
            play_connection_sounds: default_play_connection_sounds(),
            network: NetworkPreset::Lan,
            jitter_start_ms: 20,
            jitter_min_ms: 20,
            jitter_max_ms: 400,
            reopen_ms: 2000,
            default_volume: 0.9,
            default_volume_db: None,
        }
    }
}

fn default_play_connection_sounds() -> bool {
    true
}

fn default_device_period_ms() -> u32 {
    10
}

impl AudioConfig {
    pub fn default_volume_linear(&self) -> f32 {
        self.default_volume_db
            .map(crate::audio::mixer::db_to_volume)
            .unwrap_or(self.default_volume.clamp(0.0, 1.0))
    }
}

impl Default for VoxConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            target: None,
            threshold_db: -32.0,
            hang_ms: 600,
        }
    }
}

impl Default for TalkConfig {
    fn default() -> Self {
        Self {
            tap_ms: 250,
            lock_multiple: false,
            main_target: None,
        }
    }
}

/// Dim amounts offered by the web client and the headless Settings select.
pub const DIM_AMOUNT_DB_OPTIONS: [f32; 5] = [-6.0, -12.0, -15.0, -18.0, -24.0];
/// Default feed ducking, matching `dimAmountDb` in the web client.
pub const DEFAULT_DIM_DB: f32 = DIM_AMOUNT_DB_OPTIONS[2];
const LEGACY_DIM_DB: f32 = -14.0;

fn json_number_as_f32(value: &Value) -> Option<f32> {
    match value {
        Value::Number(n) => n.as_f64().map(|v| v as f32),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// In-place upgrades for older configuration documents (dim −14 → −15,
/// empty `talk.main_target` → null).
pub fn migrate_document(doc: &mut Value) {
    apply_network_preset(doc);
    if let Some(audio) = doc.get_mut("audio") {
        if let Some(dim) = audio.get("dim_db") {
            if json_number_as_f32(dim).is_some_and(|value| (value - LEGACY_DIM_DB).abs() < 1e-3) {
                audio["dim_db"] = serde_json::json!(DEFAULT_DIM_DB);
            }
        }
    }
    if let Some(talk) = doc.get_mut("talk") {
        match talk.get("main_target") {
            Some(Value::String(value)) if value.trim().is_empty() => {
                talk["main_target"] = Value::Null;
            }
            _ => {}
        }
    }
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            ice_disconnect_grace_ms: 4000,
        }
    }
}

impl Default for StreamDeckConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            serial: None,
            mock: None,
            brightness: 60,
            font_path: PathBuf::from("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
            volume_step: 0.05,
            volume_step_db: None,
            volume_layer_timeout_s: 8,
            pedal_left: None,
            pedal_target: None,
            layout: BTreeMap::new(),
            devices: Vec::new(),
        }
    }
}

impl StreamDeckConfig {
    /// dB change per key/dial tick. Legacy `volume_step` values in 0–1 are
    /// the old linear fraction and become a 3 dB tick.
    pub fn volume_step_db(&self) -> f32 {
        if let Some(db) = self.volume_step_db {
            return db;
        }
        if self.volume_step > 1.0 {
            self.volume_step
        } else {
            3.0
        }
    }
}

impl Default for GpioConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            chip: None,
            outputs: BTreeMap::new(),
            target_outputs: Vec::new(),
            inputs: Vec::new(),
        }
    }
}

impl Default for SocketConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            path: None,
            tcp: None,
        }
    }
}

impl SocketConfig {
    /// Filesystem path the Unix listener binds.
    pub fn resolved_path(&self, instance: &str) -> PathBuf {
        if let Some(path) = &self.path {
            if !path.as_os_str().is_empty() {
                return path.clone();
            }
        }
        if let Ok(dir) = std::env::var("RUNTIME_DIRECTORY") {
            if let Some(first) = dir.split(':').next() {
                if !first.is_empty() {
                    return PathBuf::from(first).join("control.sock");
                }
            }
        }
        std::env::temp_dir().join(format!("talktome-headless-{instance}-control.sock"))
    }

    /// Loopback TCP bind string, if configured.
    pub fn tcp_bind(&self) -> Option<&str> {
        self.tcp.as_deref().map(str::trim).filter(|s| !s.is_empty())
    }
}

/// `socket.tcp` must be `host:port` on loopback (`127.0.0.1`, `::1`, `localhost`).
pub fn validate_socket_tcp(bind: &str) -> Result<()> {
    let bind = bind.trim();
    if bind.is_empty() {
        return Ok(());
    }
    if let Ok(addr) = bind.parse::<std::net::SocketAddr>() {
        if addr.ip().is_loopback() {
            return Ok(());
        }
        bail!("socket.tcp {bind:?} must be a loopback address (127.0.0.1 or [::1])");
    }
    let (host, port) = if let Some(rest) = bind.strip_prefix('[') {
        let (host, rest) = rest
            .split_once(']')
            .ok_or_else(|| anyhow!("socket.tcp {bind:?} is not a valid [IPv6]:port"))?;
        let port = rest
            .strip_prefix(':')
            .ok_or_else(|| anyhow!("socket.tcp {bind:?} needs a port"))?;
        (host, port)
    } else {
        bind.rsplit_once(':')
            .ok_or_else(|| anyhow!("socket.tcp {bind:?} must be host:port"))?
    };
    if port.is_empty() || port.parse::<u16>().is_err() {
        bail!("socket.tcp {bind:?} needs a valid port");
    }
    if host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1" {
        return Ok(());
    }
    bail!("socket.tcp {bind:?} must be a loopback address (127.0.0.1, [::1], or localhost)");
}

impl Default for HealthConfig {
    fn default() -> Self {
        Self {
            port: None,
            bind: "127.0.0.1".into(),
        }
    }
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            level: "info".into(),
            format: "auto".into(),
        }
    }
}

impl Default for WebConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            bind: "0.0.0.0".into(),
            port: 8080,
            password: WEB_DEFAULT_PASSWORD.into(),
        }
    }
}

/// Where a configuration came from, for diagnostics.
#[derive(Debug, Clone)]
pub struct LoadedConfig {
    pub config: Config,
    pub path: Option<PathBuf>,
}

/// Locates `<dir>/<instance>.json` or `<dir>/<instance>.toml`.
pub fn locate_instance_config(dir: &Path, instance: &str) -> Result<PathBuf> {
    let json = dir.join(format!("{instance}.json"));
    let toml = dir.join(format!("{instance}.toml"));
    match (json.is_file(), toml.is_file()) {
        (true, true) => bail!(
            "both {} and {} exist; keep only one configuration file per instance",
            json.display(),
            toml.display()
        ),
        (true, false) => Ok(json),
        (false, true) => Ok(toml),
        (false, false) => bail!(
            "no configuration for instance {instance:?}: expected {} or {}",
            json.display(),
            toml.display()
        ),
    }
}

/// Parses a configuration document into a generic JSON value based on the
/// file extension.
pub fn parse_document(path: &Path, text: &str) -> Result<Value> {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "json" => serde_json::from_str(text)
            .with_context(|| format!("invalid JSON in {}", path.display())),
        "toml" => {
            let value: toml::Value = toml::from_str(text)
                .with_context(|| format!("invalid TOML in {}", path.display()))?;
            serde_json::to_value(value).context("failed to convert TOML to JSON value")
        }
        other => bail!(
            "unsupported configuration extension {other:?} for {} (use .json or .toml)",
            path.display()
        ),
    }
}

/// Applies `TALKTOME_<SECTION>_<KEY>` overrides onto a JSON document.
///
/// The first word after the prefix selects the section (`user`, `audio`, ...)
/// and the remainder, lower-cased, is the key. Values are parsed as JSON when
/// possible (`true`, `12`, `null`, `[...]`) and used verbatim otherwise.
pub fn apply_env_overrides<I>(doc: &mut Value, vars: I) -> Vec<String>
where
    I: IntoIterator<Item = (String, String)>,
{
    let sections = [
        "server",
        "tls",
        "user",
        "registration",
        "audio",
        "vox",
        "talk",
        "ice",
        "network",
        "streamdeck",
        "gpio",
        "socket",
        "health",
        "log",
        "web",
    ];
    let mut applied = Vec::new();
    if !doc.is_object() {
        *doc = Value::Object(Default::default());
    }
    for (name, raw) in vars {
        let Some(rest) = name.strip_prefix(ENV_PREFIX) else {
            continue;
        };
        let lower = rest.to_ascii_lowercase();
        if lower == "instance" || lower == "state_dir" {
            let value = parse_env_value(&raw);
            doc[lower.as_str()] = value;
            applied.push(name);
            continue;
        }
        let Some((section, key)) = lower.split_once('_') else {
            continue;
        };
        if !sections.contains(&section) || key.is_empty() {
            continue;
        }
        let value = parse_env_value(&raw);
        let section_value = doc
            .as_object_mut()
            .expect("document is an object")
            .entry(section.to_string())
            .or_insert_with(|| Value::Object(Default::default()));
        if !section_value.is_object() {
            *section_value = Value::Object(Default::default());
        }
        section_value[key] = value;
        applied.push(name);
    }
    applied
}

fn parse_env_value(raw: &str) -> Value {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Value::Null;
    }
    match serde_json::from_str::<Value>(trimmed) {
        Ok(Value::String(s)) => Value::String(s),
        Ok(value) => value,
        Err(_) => Value::String(raw.to_string()),
    }
}

/// Loads, merges and validates the configuration for a file path.
pub fn load_from_path(path: &Path) -> Result<LoadedConfig> {
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("cannot read configuration {}", path.display()))?;
    let mut doc = parse_document(path, &text)?;
    apply_env_overrides(&mut doc, std::env::vars());
    let mut config = from_document(doc)?;
    if config.instance == "default" || config.instance.is_empty() {
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            config.instance = stem.to_string();
        }
    }
    config.validate()?;
    Ok(LoadedConfig {
        config,
        path: Some(path.to_path_buf()),
    })
}

/// Builds a configuration purely from environment variables (containers, tests).
pub fn load_from_env() -> Result<LoadedConfig> {
    let mut doc = Value::Object(Default::default());
    apply_env_overrides(&mut doc, std::env::vars());
    let config = from_document(doc)?;
    config.validate()?;
    Ok(LoadedConfig { config, path: None })
}

/// Fills the `audio.network` preset's values into keys the file leaves out.
fn apply_network_preset(doc: &mut Value) {
    let Some(audio) = doc.get_mut("audio").and_then(Value::as_object_mut) else {
        return;
    };
    let Some(preset) = audio
        .get("network")
        .cloned()
        .and_then(|value| serde_json::from_value::<NetworkPreset>(value).ok())
    else {
        return;
    };
    for (key, value) in preset.defaults() {
        if !audio.contains_key(*key) {
            let value = value
                .parse::<u64>()
                .map(Value::from)
                .unwrap_or_else(|_| Value::from(*value));
            audio.insert((*key).to_string(), value);
        }
    }
}

pub fn from_document(mut doc: Value) -> Result<Config> {
    migrate_document(&mut doc);
    serde_json::from_value(doc).map_err(|e| anyhow!("invalid configuration: {e}"))
}

/// Serializes a configuration document in the format implied by `path`.
pub fn render_document(path: &Path, doc: &Value) -> Result<String> {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "json" => Ok(format!("{}\n", serde_json::to_string_pretty(doc)?)),
        "toml" => {
            let value: toml::Value =
                serde_json::from_value(doc.clone()).context("converting configuration to TOML")?;
            toml::to_string_pretty(&value).context("serializing TOML")
        }
        other => bail!("unsupported configuration extension {other:?} (use .json or .toml)"),
    }
}

/// Maps of user entries (keyed by output name or deck key). When the file
/// has the section, its map is the whole truth: an entry removed in the file
/// must not come back from the running process, which still has it until the
/// next restart.
const FILE_OWNED_MAPS: &[(&str, &str)] = &[("gpio", "outputs"), ("streamdeck", "layout")];

/// Editor view: the saved file over the running configuration, so saved but
/// not yet applied values show, and sections missing from the file show the
/// running values.
pub fn merge_file_over_running(running: &Value, file: &Value) -> Value {
    merge_over(running, file, None)
}

fn merge_over(running: &Value, file: &Value, section: Option<&str>) -> Value {
    let (Value::Object(running_map), Value::Object(file_map)) = (running, file) else {
        return file.clone();
    };
    let mut out = running_map.clone();
    for (key, file_val) in file_map {
        let owned = section.is_some_and(|s| FILE_OWNED_MAPS.contains(&(s, key.as_str())));
        let merged = match running_map.get(key) {
            Some(running_val) if !owned && running_val.is_object() && file_val.is_object() => {
                merge_over(running_val, file_val, section.or(Some(key.as_str())))
            }
            _ => file_val.clone(),
        };
        out.insert(key.clone(), merged);
    }
    if let Some(section) = section {
        for (owner, key) in FILE_OWNED_MAPS {
            if *owner == section && !file_map.contains_key(*key) {
                out.insert((*key).to_string(), Value::Object(Default::default()));
            }
        }
    }
    Value::Object(out)
}

/// Whether the on-disk document, once parsed into a full `Config`, differs
/// from the running process. Compares through `Config` so TOML f64 vs `f32`
/// JSON and omitted-vs-default keys do not look like unsaved restarts.
pub fn file_differs_from_running(file: &Value, running: &Config) -> bool {
    let Ok(mut parsed) = from_document(file.clone()) else {
        return true;
    };
    if file.get("instance").is_none() {
        parsed.instance = running.instance.clone();
    }
    let Ok(file_json) = serde_json::to_value(parsed.redacted()) else {
        return true;
    };
    let Ok(running_json) = serde_json::to_value(running.redacted()) else {
        return true;
    };
    file_json != running_json
}

/// Copy top-level keys from `stored` that `incoming` omitted. Nested objects
/// that **are** present in `incoming` are left as sent, so an empty
/// `gpio.outputs` object can still clear outputs.
pub fn merge_missing_top_level(stored: &Value, mut incoming: Value) -> Value {
    if let (Some(stored_map), Some(incoming_map)) = (stored.as_object(), incoming.as_object_mut()) {
        for (key, stored_val) in stored_map {
            incoming_map
                .entry(key.clone())
                .or_insert_with(|| stored_val.clone());
        }
    }
    incoming
}

/// Removes `null` members recursively; TOML has no null and JSON files stay
/// tidy without them (absent keys mean "default").
pub fn strip_nulls(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.retain(|_, v| !v.is_null());
            for v in map.values_mut() {
                strip_nulls(v);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(strip_nulls),
        _ => {}
    }
}

fn config_io_error(op: &str, path: &Path, error: std::io::Error) -> anyhow::Error {
    // EROFS is 30 on Linux; match both the typed kind and the raw code so the
    // hint still appears if the kind is Uncategorized on an older std.
    let erofs =
        error.kind() == std::io::ErrorKind::ReadOnlyFilesystem || error.raw_os_error() == Some(30);
    let hint = if erofs {
        " — systemd ProtectSystem=strict remounts /etc read-only; the unit needs ReadWritePaths=/etc/talktome-headless"
    } else if error.kind() == std::io::ErrorKind::PermissionDenied {
        " — the service user talktome-headless needs write access to the configuration directory (mode 0770, group talktome-headless)"
    } else {
        ""
    };
    anyhow!("{op} {}: {error}{hint}", path.display())
}

/// Writes the document atomically (temp file + rename), keeping the file mode
/// restrictive because it contains credentials.
pub fn write_document(path: &Path, doc: &Value) -> Result<()> {
    let mut doc = doc.clone();
    strip_nulls(&mut doc);
    let text = render_document(path, &doc)?;
    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or("cfg")
    ));
    std::fs::write(&tmp, text.as_bytes())
        .map_err(|error| config_io_error("writing", &tmp, error))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(path)
            .map(|m| m.permissions().mode())
            .unwrap_or(0o640);
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(mode & 0o777));
    }
    std::fs::rename(&tmp, path).map_err(|error| config_io_error("replacing", path, error))?;
    Ok(())
}

/// Sets `section.key` values in the configuration file, keeping the rest.
/// A null value removes the key.
pub fn update_values(path: &Path, values: &[(&str, &str, Value)]) -> Result<()> {
    let mut document = read_document(path)?;
    let root = document
        .as_object_mut()
        .ok_or_else(|| anyhow!("configuration file is not an object"))?;
    for (section, key, value) in values {
        let table = root
            .entry(section.to_string())
            .or_insert_with(|| Value::Object(Default::default()));
        if !table.is_object() {
            *table = Value::Object(Default::default());
        }
        table[*key] = value.clone();
    }
    write_document(path, &document)
}

/// Reads the raw configuration document currently stored in `path` (without
/// environment overrides).
pub fn read_document(path: &Path) -> Result<Value> {
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("cannot read configuration {}", path.display()))?;
    parse_document(path, &text)
}

impl Config {
    pub fn validate(&self) -> Result<()> {
        let url = url::Url::parse(&self.server.url)
            .with_context(|| format!("server.url {:?} is not a valid URL", self.server.url))?;
        if !matches!(url.scheme(), "http" | "https") {
            bail!("server.url must use http:// or https://");
        }
        if url.host_str().is_none() {
            bail!("server.url must contain a host");
        }
        if self.user.name.trim().is_empty() {
            bail!("user.name is required");
        }
        if self.user.password.is_empty() {
            bail!("user.password is required (can be supplied via TALKTOME_USER_PASSWORD)");
        }
        if self.tls.insecure
            && (self.tls.ca_file.is_some() || self.tls.fingerprint_sha256.is_some())
        {
            bail!("tls.insecure cannot be combined with tls.ca_file or tls.fingerprint_sha256");
        }
        if let Some(fp) = &self.tls.fingerprint_sha256 {
            if crate::tls::parse_fingerprint(fp).is_none() {
                bail!(
                    "tls.fingerprint_sha256 must be 32 bytes as hex (optionally colon separated)"
                );
            }
        }
        if !(-30.0..=40.0).contains(&self.audio.input_gain_db) {
            bail!("audio.input_gain_db must be between -30 and 40");
        }
        if let Some(ms) = self.audio.stream_delay_ms {
            if ms > 500 {
                bail!("audio.stream_delay_ms must be between 0 and 500");
            }
        }
        if let Some(db) = self.audio.default_volume_db {
            if !(-60.0..=6.0).contains(&db) {
                bail!("audio.default_volume_db must be between -60 and 6");
            }
        } else if !(0.0..=1.0).contains(&self.audio.default_volume) {
            bail!("audio.default_volume must be between 0 and 1");
        }
        if self.audio.jitter_min_ms > self.audio.jitter_max_ms {
            bail!("audio.jitter_min_ms must not exceed audio.jitter_max_ms");
        }
        if !(self.audio.jitter_min_ms..=self.audio.jitter_max_ms)
            .contains(&self.audio.jitter_start_ms)
        {
            bail!(
                "audio.jitter_start_ms must be between audio.jitter_min_ms and audio.jitter_max_ms"
            );
        }
        if self.audio.device_period_ms != 0 && !(2..=40).contains(&self.audio.device_period_ms) {
            bail!("audio.device_period_ms must be 0 (driver default) or between 2 and 40");
        }
        if let Some(policy) = &self.ice.transport_policy {
            if !matches!(policy.as_str(), "all" | "relay") {
                bail!("ice.transport_policy must be \"all\" or \"relay\"");
            }
        }
        let mut mocks: Vec<(String, String)> = Vec::new();
        if let Some(mock) = &self.streamdeck.mock {
            mocks.push(("streamdeck.mock".into(), mock.clone()));
        }
        for (index, device) in self.streamdeck.devices.iter().enumerate() {
            if let Some(mock) = &device.mock {
                mocks.push((format!("streamdeck.devices[{index}].mock"), mock.clone()));
            }
        }
        for (path, mock) in mocks {
            if !known_streamdeck_mock(&mock) {
                bail!(
                    "{path} {mock:?} is not a known model (original, originalv2, mini, minimk2, mk2, xl, xlv2, plus, plusxl, neo, pedal)"
                );
            }
        }
        if self.streamdeck.brightness > 100 {
            bail!("streamdeck.brightness must be between 0 and 100");
        }
        if let Some(db) = self.streamdeck.volume_step_db {
            if !(0.25..=12.0).contains(&db) {
                bail!("streamdeck.volume_step_db must be between 0.25 and 12");
            }
        } else if !(0.01..=1.0).contains(&self.streamdeck.volume_step)
            && !(0.25..=12.0).contains(&self.streamdeck.volume_step)
        {
            bail!("streamdeck.volume_step must be a legacy 0.01–1 linear step or 0.25–12 dB");
        }
        if let Some(target) = &self.vox.target {
            crate::talk::TargetKey::parse(target).ok_or_else(|| {
                anyhow!("vox.target {target:?} must look like conference:1 or user:4")
            })?;
        }
        if self.vox.enabled && self.vox.target.is_none() {
            bail!("vox.target is required when vox.enabled is true");
        }
        if let Some(target) = &self.talk.main_target {
            let trimmed = target.trim();
            if !trimmed.is_empty() {
                let key = crate::talk::TargetKey::parse(trimmed).ok_or_else(|| {
                    anyhow!("talk.main_target {target:?} must look like conference:1 or user:4")
                })?;
                if !key.can_talk() {
                    bail!("talk.main_target {target:?} must be a user or conference");
                }
            }
        }
        for (name, output) in &self.gpio.outputs {
            if !matches!(
                name.as_str(),
                "tally"
                    | "tally_preview"
                    | "talking"
                    | "incoming"
                    | "connected"
                    | "locked"
                    | "status"
            ) {
                bail!("gpio.outputs.{name} is not a known output (tally, tally_preview, talking, incoming, connected, locked, status)");
            }
            if output.line.trim().is_empty() {
                bail!("gpio.outputs.{name}.line is required");
            }
        }
        for (index, output) in self.gpio.target_outputs.iter().enumerate() {
            if output.line.trim().is_empty() {
                bail!("gpio.target_outputs[{index}].line is required");
            }
            crate::talk::TargetKey::parse(&output.target).ok_or_else(|| {
                anyhow!(
                    "gpio.target_outputs[{index}].target {:?} must look like conference:1 or user:4",
                    output.target
                )
            })?;
        }
        for (index, input) in self.gpio.inputs.iter().enumerate() {
            if input.line.trim().is_empty() {
                bail!("gpio.inputs[{index}].line is required");
            }
            let needs_target = matches!(
                input.action,
                GpioInputAction::Talk
                    | GpioInputAction::LockToggle
                    | GpioInputAction::MuteToggle
                    | GpioInputAction::VolumeUp
                    | GpioInputAction::VolumeDown
            );
            match (&input.target, needs_target) {
                (None, true) => bail!(
                    "gpio.inputs[{index}] action {:?} requires a target",
                    input.action
                ),
                (Some(target), _) => {
                    crate::talk::TargetKey::parse(target).ok_or_else(|| {
                        anyhow!("gpio.inputs[{index}].target {target:?} must look like conference:1 or user:4")
                    })?;
                }
                _ => {}
            }
        }
        if !matches!(self.log.format.as_str(), "auto" | "json" | "text") {
            bail!("log.format must be auto, json or text");
        }
        if self.web.enabled {
            if self.web.port == 0 {
                bail!("web.port must be between 1 and 65535");
            }
            if self.web.bind.trim().is_empty() {
                bail!("web.bind is required when web.enabled is true");
            }
            if self.web.password.is_empty() {
                bail!("web.password must not be empty");
            }
        }
        if let Some(bind) = self.socket.tcp_bind() {
            validate_socket_tcp(bind)?;
        }
        Ok(())
    }

    /// The configuration with secrets removed, for `--check-config` output.
    pub fn redacted(&self) -> Config {
        let mut copy = self.clone();
        if !copy.user.password.is_empty() {
            copy.user.password = REDACTED.into();
        }
        if !copy.web.password.is_empty() {
            copy.web.password = REDACTED.into();
        }
        if let Some(servers) = copy.ice.servers.as_mut() {
            for server in servers {
                if server.credential.is_some() {
                    server.credential = Some("********".into());
                }
            }
        }
        copy
    }

    pub fn server_url(&self) -> url::Url {
        url::Url::parse(&self.server.url).expect("validated URL")
    }

    pub fn state_dir(&self) -> PathBuf {
        if let Some(dir) = &self.state_dir {
            return dir.clone();
        }
        if let Ok(dir) = std::env::var("STATE_DIRECTORY") {
            if let Some(first) = dir.split(':').next() {
                if !first.is_empty() {
                    return PathBuf::from(first);
                }
            }
        }
        PathBuf::from("/var/lib/talktome-headless").join(&self.instance)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_json() -> Value {
        serde_json::json!({
            "server": { "url": "https://talktome.local:8443" },
            "user": { "name": "Cam 1", "password": "secret" }
        })
    }

    #[test]
    fn json_and_toml_produce_the_same_config() {
        let json_text = r#"{
            "instance": "cam1",
            "server": { "url": "https://talktome.local:8443" },
            "user": { "name": "Cam 1", "password": "secret" },
            "audio": { "profile": "low", "input_device": "plughw:CARD=Headset,DEV=0" },
            "gpio": { "outputs": { "tally": { "line": "GPIO17" } },
                      "inputs": [ { "line": "GPIO22", "action": "talk", "target": "conference:1", "active_low": true } ] }
        }"#;
        let toml_text = r#"
            instance = "cam1"
            [server]
            url = "https://talktome.local:8443"
            [user]
            name = "Cam 1"
            password = "secret"
            [audio]
            profile = "low"
            input_device = "plughw:CARD=Headset,DEV=0"
            [gpio.outputs.tally]
            line = "GPIO17"
            [[gpio.inputs]]
            line = "GPIO22"
            action = "talk"
            target = "conference:1"
            active_low = true
        "#;
        let json =
            from_document(parse_document(Path::new("cam1.json"), json_text).unwrap()).unwrap();
        let toml =
            from_document(parse_document(Path::new("cam1.toml"), toml_text).unwrap()).unwrap();
        assert_eq!(
            serde_json::to_value(&json).unwrap(),
            serde_json::to_value(&toml).unwrap()
        );
        assert_eq!(json.audio.profile, AudioProfile::Low);
        assert_eq!(json.gpio.inputs[0].debounce_ms, 20);
        json.validate().unwrap();
    }

    #[test]
    fn volume_db_and_target_gpio_outputs_parse() {
        let toml_text = r#"
            instance = "cam1"
            [server]
            url = "https://talktome.local:8443"
            [user]
            name = "Cam 1"
            password = "secret"
            [audio]
            default_volume_db = -6
            auto_processing = true
            stream_delay_ms = 40
            input_gain_db = -6
            [streamdeck]
            volume_step_db = 3
            [[gpio.target_outputs]]
            line = "GPIO18"
            target = "conference:1"
            when = "receiving"
        "#;
        let config =
            from_document(parse_document(Path::new("cam1.toml"), toml_text).unwrap()).unwrap();
        config.validate().unwrap();
        assert!((config.audio.default_volume_linear() - 0.5).abs() < 0.02);
        assert!(config.audio.auto_processing);
        assert!(config.audio.play_connection_sounds);
        assert_eq!(config.audio.profile, AudioProfile::UltraLow);
        assert_eq!(config.audio.device_period_ms, 10);
        let quiet = toml_text.replace(
            "[audio]",
            "[audio]\n            play_connection_sounds = false",
        );
        let quiet = from_document(parse_document(Path::new("cam1.toml"), &quiet).unwrap()).unwrap();
        assert!(!quiet.audio.play_connection_sounds);
        assert_eq!(config.audio.stream_delay_ms, Some(40));
        assert!((config.audio.input_gain_db + 6.0).abs() < 1e-6);
        assert_eq!(config.streamdeck.volume_step_db(), 3.0);
        assert_eq!(config.gpio.target_outputs.len(), 1);
        assert_eq!(config.gpio.target_outputs[0].target, "conference:1");
        assert_eq!(
            config.gpio.target_outputs[0].when,
            GpioTargetWhen::Receiving
        );
        let legacy = StreamDeckConfig::default();
        assert_eq!(legacy.volume_step_db(), 3.0);
    }

    #[test]
    fn mobile_network_preset_fills_only_missing_values() {
        let mut doc = minimal_json();
        doc["audio"] = serde_json::json!({ "network": "mobile", "jitter_max_ms": 800 });
        let config = from_document(doc).unwrap();
        config.validate().unwrap();
        assert_eq!(config.audio.network, NetworkPreset::Mobile);
        assert_eq!(config.audio.jitter_start_ms, 150);
        assert_eq!(config.audio.jitter_min_ms, 60);
        assert_eq!(config.audio.jitter_max_ms, 800, "explicit value wins");
        assert_eq!(config.audio.profile, AudioProfile::Standard);

        let lan = from_document(minimal_json()).unwrap();
        assert_eq!(lan.audio.network, NetworkPreset::Lan);
        assert_eq!(lan.audio.jitter_start_ms, 20);
        assert_eq!(lan.audio.profile, AudioProfile::UltraLow);
    }

    #[test]
    fn jitter_start_must_sit_between_min_and_max() {
        let mut doc = minimal_json();
        doc["audio"] = serde_json::json!({ "jitter_min_ms": 40, "jitter_start_ms": 20 });
        assert!(from_document(doc).unwrap().validate().is_err());
    }

    #[test]
    fn device_period_rejects_values_the_card_cannot_use() {
        let text = minimal_json().to_string();
        let mut config =
            from_document(parse_document(Path::new("cam1.json"), &text).unwrap()).unwrap();
        config.validate().unwrap();
        config.audio.device_period_ms = 0;
        config.validate().unwrap();
        config.audio.device_period_ms = 1;
        assert!(config.validate().is_err());
        config.audio.device_period_ms = 41;
        assert!(config.validate().is_err());
        config.audio.device_period_ms = 5;
        config.validate().unwrap();
    }

    #[test]
    fn socket_tcp_must_be_loopback_and_env_overrides_work() {
        let mut doc = minimal_json();
        let applied = apply_env_overrides(
            &mut doc,
            vec![
                ("TALKTOME_SOCKET_ENABLED".to_string(), "false".to_string()),
                (
                    "TALKTOME_SOCKET_TCP".to_string(),
                    "127.0.0.1:9876".to_string(),
                ),
            ],
        );
        assert!(applied.contains(&"TALKTOME_SOCKET_ENABLED".to_string()));
        let config = from_document(doc).unwrap();
        assert!(!config.socket.enabled);
        assert_eq!(config.socket.tcp.as_deref(), Some("127.0.0.1:9876"));
        config.validate().unwrap();

        let mut config = from_document(minimal_json()).unwrap();
        assert!(config.socket.enabled);
        config.socket.tcp = Some("0.0.0.0:9876".into());
        assert!(config.validate().is_err());
        config.socket.tcp = Some("192.168.0.5:9".into());
        assert!(config.validate().is_err());
        config.socket.tcp = Some("localhost:9876".into());
        config.validate().unwrap();
        config.socket.tcp = Some("[::1]:9876".into());
        config.validate().unwrap();
        validate_socket_tcp("127.0.0.1:1").unwrap();
        assert!(validate_socket_tcp("8.8.8.8:53").is_err());
    }

    #[test]
    fn env_overrides_replace_values_and_parse_types() {
        let mut doc = minimal_json();
        let applied = apply_env_overrides(
            &mut doc,
            vec![
                ("TALKTOME_USER_PASSWORD".to_string(), "from-env".to_string()),
                (
                    "TALKTOME_AUDIO_INPUT_DEVICE".to_string(),
                    "hw:1,0".to_string(),
                ),
                (
                    "TALKTOME_STREAMDECK_ENABLED".to_string(),
                    "false".to_string(),
                ),
                ("TALKTOME_HEALTH_PORT".to_string(), "9911".to_string()),
                ("TALKTOME_INSTANCE".to_string(), "cam7".to_string()),
                ("TALKTOME_UNKNOWN_KEY".to_string(), "x".to_string()),
                ("PATH".to_string(), "/usr/bin".to_string()),
            ],
        );
        assert_eq!(applied.len(), 5);
        let config = from_document(doc).unwrap();
        assert_eq!(config.user.password, "from-env");
        assert_eq!(config.audio.input_device.as_deref(), Some("hw:1,0"));
        assert!(!config.streamdeck.enabled);
        assert_eq!(config.health.port, Some(9911));
        assert_eq!(config.instance, "cam7");
    }

    #[test]
    fn validation_rejects_missing_credentials_and_bad_targets() {
        let mut config = from_document(minimal_json()).unwrap();
        config.validate().unwrap();
        config.user.password.clear();
        assert!(config.validate().is_err());

        let mut config = from_document(minimal_json()).unwrap();
        config.vox.enabled = true;
        assert!(config.validate().is_err());
        config.vox.target = Some("bogus".into());
        assert!(config.validate().is_err());
        config.vox.target = Some("conference:3".into());
        config.validate().unwrap();

        let mut config = from_document(minimal_json()).unwrap();
        config.gpio.outputs.insert(
            "spotlight".into(),
            GpioOutputConfig {
                line: "GPIO1".into(),
                active_low: false,
            },
        );
        assert!(config.validate().is_err());
        config.gpio.outputs.clear();
        config.gpio.outputs.insert(
            "tally_preview".into(),
            GpioOutputConfig {
                line: "GPIO18".into(),
                active_low: false,
            },
        );
        config.validate().unwrap();
    }

    #[test]
    fn unknown_fields_are_rejected() {
        let doc = serde_json::json!({
            "server": { "url": "https://x", "port": 1 },
            "user": { "name": "a", "password": "b" }
        });
        assert!(from_document(doc).is_err());
    }

    #[test]
    fn redaction_hides_password() {
        let config = from_document(minimal_json()).unwrap();
        assert_eq!(config.redacted().user.password, "********");
    }

    #[test]
    fn documents_round_trip_through_both_formats() {
        let dir = tempfile::tempdir().unwrap();
        let mut doc = minimal_json();
        doc["web"] = serde_json::json!({ "port": 9090, "password": "secret" });
        doc["audio"] = serde_json::json!({ "input_device": null, "profile": "low" });
        for name in ["cam.toml", "cam.json"] {
            let path = dir.path().join(name);
            write_document(&path, &doc).unwrap();
            let loaded = read_document(&path).unwrap();
            let config = from_document(loaded.clone()).unwrap();
            assert_eq!(config.web.port, 9090);
            assert_eq!(config.audio.profile, AudioProfile::Low);
            assert!(
                loaded["audio"].get("input_device").is_none(),
                "nulls are dropped"
            );
        }
        assert!(render_document(Path::new("x.yaml"), &doc).is_err());
    }

    #[test]
    fn web_defaults_and_validation() {
        let mut config = from_document(minimal_json()).unwrap();
        assert!(config.web.enabled);
        assert_eq!(config.web.port, 8080);
        assert_eq!(config.web.password, WEB_DEFAULT_PASSWORD);
        assert_eq!(config.redacted().web.password, REDACTED);
        config.web.password.clear();
        assert!(config.validate().is_err());
        config.web.enabled = false;
        config.validate().unwrap();
    }

    #[test]
    fn streamdeck_mock_accepts_known_models() {
        let mut config = from_document(minimal_json()).unwrap();
        config.streamdeck.mock = Some("mk2".into());
        config.validate().unwrap();
        config.streamdeck.mock = Some("no-such-deck".into());
        assert!(config.validate().is_err());
        config.streamdeck.mock = Some("".into());
        config.validate().unwrap();
        config.streamdeck.devices = vec![StreamDeckDeviceConfig {
            mock: Some("neo".into()),
            ..StreamDeckDeviceConfig::default()
        }];
        config.validate().unwrap();
        config.streamdeck.devices[0].mock = Some("nope".into());
        assert!(config.validate().is_err());
    }

    #[test]
    fn file_differs_from_running_ignores_float_json_shape() {
        let running = from_document(minimal_json()).unwrap();
        let mut file = serde_json::to_value(&running).unwrap();
        file["streamdeck"]["volume_step"] = serde_json::json!(0.05);
        assert!(
            !file_differs_from_running(&file, &running),
            "0.05 in the file must match the running f32 volume_step"
        );
        file["user"]["name"] = serde_json::json!("Studio");
        assert!(file_differs_from_running(&file, &running));
    }

    #[test]
    fn merge_file_over_running_keeps_saved_user_and_running_defaults() {
        let running = serde_json::json!({
            "user": { "name": "Cam 1", "password": "********", "production": null },
            "audio": { "profile": "standard", "input_device": "tone" },
            "server": { "url": "https://talktome.local:8443" }
        });
        let file = serde_json::json!({
            "user": { "name": "Studio", "password": "********" },
            "server": { "url": "https://talktome.local:8443" }
        });
        let editor = merge_file_over_running(&running, &file);
        assert_eq!(editor["user"]["name"], "Studio");
        assert_eq!(editor["audio"]["profile"], "standard");
        assert_eq!(editor["audio"]["input_device"], "tone");
    }

    #[test]
    fn merge_file_over_running_does_not_revive_removed_gpio_outputs() {
        let running = serde_json::json!({
            "gpio": {
                "enabled": true,
                "outputs": { "tally": { "line": "GPIO17" }, "talking": { "line": "GPIO27" } }
            },
            "streamdeck": { "layout": { "0": "user:4" }, "brightness": 60 }
        });
        // Saved with tally cleared; not restarted yet.
        let file = serde_json::json!({
            "gpio": { "enabled": true, "outputs": { "talking": { "line": "GPIO27" } } },
            "streamdeck": { "brightness": 40 }
        });
        let editor = merge_file_over_running(&running, &file);
        assert!(editor["gpio"]["outputs"].get("tally").is_none());
        assert_eq!(editor["gpio"]["outputs"]["talking"]["line"], "GPIO27");
        // A map missing from a saved section means "none", not "running".
        assert_eq!(editor["streamdeck"]["layout"], serde_json::json!({}));
        assert_eq!(editor["streamdeck"]["brightness"], 40);
        // All outputs cleared: the TOML writer may drop the empty table.
        let cleared = serde_json::json!({ "gpio": { "enabled": true } });
        let editor = merge_file_over_running(&running, &cleared);
        assert_eq!(editor["gpio"]["outputs"], serde_json::json!({}));
        // A section the file does not have still shows the running values.
        let editor = merge_file_over_running(&running, &serde_json::json!({}));
        assert_eq!(editor["gpio"]["outputs"]["tally"]["line"], "GPIO17");
    }

    #[test]
    fn merge_missing_top_level_keeps_omitted_instance() {
        let stored = serde_json::json!({
            "instance": "cam1",
            "user": { "name": "Studio" },
            "audio": { "profile": "standard", "input_device": "tone" }
        });
        let incoming = serde_json::json!({
            "user": { "name": "Studio" },
            "audio": { "profile": "low" }
        });
        let merged = merge_missing_top_level(&stored, incoming);
        assert_eq!(merged["instance"], "cam1");
        assert_eq!(merged["audio"]["profile"], "low");
        assert!(merged["audio"].get("input_device").is_none());
    }

    #[test]
    fn locate_prefers_single_file() {
        let dir = tempfile::tempdir().unwrap();
        assert!(locate_instance_config(dir.path(), "cam1").is_err());
        std::fs::write(dir.path().join("cam1.toml"), "").unwrap();
        assert!(locate_instance_config(dir.path(), "cam1")
            .unwrap()
            .ends_with("cam1.toml"));
        std::fs::write(dir.path().join("cam1.json"), "{}").unwrap();
        assert!(locate_instance_config(dir.path(), "cam1").is_err());
    }

    #[test]
    fn write_errors_explain_read_only_and_permission() {
        let erofs = config_io_error(
            "writing",
            Path::new("/etc/talktome-headless/cam1.toml.tmp"),
            std::io::Error::from_raw_os_error(30),
        );
        let erofs_text = format!("{erofs:#}");
        assert!(erofs_text.contains("ReadWritePaths=/etc/talktome-headless"));
        assert!(
            erofs_text.contains("Read-only file system") || erofs_text.contains("read-only"),
            "{erofs_text}"
        );

        let denied = config_io_error(
            "writing",
            Path::new("/etc/talktome-headless/cam1.toml.tmp"),
            std::io::Error::from(std::io::ErrorKind::PermissionDenied),
        );
        assert!(format!("{denied:#}").contains("mode 0770"));
    }

    #[test]
    fn write_document_fails_on_unwritable_directory() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if std::fs::metadata("/proc/self")
                .map(|m| m.uid())
                .unwrap_or(1)
                == 0
            {
                return;
            }
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cam.toml");
        write_document(&path, &minimal_json()).unwrap();
        let original = std::fs::metadata(dir.path()).unwrap().permissions();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
        }
        let result = write_document(&path, &minimal_json());
        std::fs::set_permissions(dir.path(), original).unwrap();
        let text = format!("{:#}", result.unwrap_err());
        assert!(
            text.contains("mode 0770") || text.contains("Permission denied"),
            "{text}"
        );
    }

    #[test]
    fn dim_default_is_minus_15_and_legacy_minus_14_migrates() {
        let config = from_document(minimal_json()).unwrap();
        assert!((config.audio.dim_db - DEFAULT_DIM_DB).abs() < 1e-6);
        assert!(DIM_AMOUNT_DB_OPTIONS.contains(&DEFAULT_DIM_DB));
        assert!(!DIM_AMOUNT_DB_OPTIONS.contains(&LEGACY_DIM_DB));

        let mut doc = minimal_json();
        doc["audio"] = serde_json::json!({ "dim_db": -14 });
        let migrated = from_document(doc).unwrap();
        assert!((migrated.audio.dim_db - DEFAULT_DIM_DB).abs() < 1e-6);

        let mut custom = minimal_json();
        custom["audio"] = serde_json::json!({ "dim_db": -20 });
        let custom = from_document(custom).unwrap();
        assert!((custom.audio.dim_db + 20.0).abs() < 1e-6);

        let mut listed = minimal_json();
        listed["audio"] = serde_json::json!({ "dim_db": -18 });
        let listed = from_document(listed).unwrap();
        assert!((listed.audio.dim_db + 18.0).abs() < 1e-6);

        let running = from_document(minimal_json()).unwrap();
        let mut file = serde_json::to_value(&running).unwrap();
        file["audio"]["dim_db"] = serde_json::json!(-14);
        assert!(
            !file_differs_from_running(&file, &running),
            "legacy -14 in the file must match the running -15 default"
        );
    }

    #[test]
    fn talk_main_target_parses_and_rejects_feeds() {
        let mut doc = minimal_json();
        doc["talk"] = serde_json::json!({ "main_target": "user:4" });
        let config = from_document(doc).unwrap();
        config.validate().unwrap();
        assert_eq!(config.talk.main_target.as_deref(), Some("user:4"));

        let mut env_doc = minimal_json();
        let applied = apply_env_overrides(
            &mut env_doc,
            vec![(
                "TALKTOME_TALK_MAIN_TARGET".to_string(),
                "conference:1".to_string(),
            )],
        );
        assert!(applied.contains(&"TALKTOME_TALK_MAIN_TARGET".to_string()));
        let config = from_document(env_doc).unwrap();
        assert_eq!(config.talk.main_target.as_deref(), Some("conference:1"));
        config.validate().unwrap();

        let mut empty = minimal_json();
        empty["talk"] = serde_json::json!({ "main_target": "" });
        let empty = from_document(empty).unwrap();
        assert_eq!(empty.talk.main_target, None);
        empty.validate().unwrap();

        let mut config = from_document(minimal_json()).unwrap();
        config.talk.main_target = Some("bogus".into());
        assert!(config.validate().is_err());
        config.talk.main_target = Some("feed:2".into());
        assert!(config.validate().is_err());
        config.talk.main_target = Some("conference:3".into());
        config.validate().unwrap();
    }

    #[test]
    fn streamdeck_layout_map_parses_from_json_and_toml() {
        let json_text = r#"{
            "server": { "url": "https://talktome.local:8443" },
            "user": { "name": "Cam 1", "password": "secret" },
            "streamdeck": {
                "layout": { "0": "user:4", "1": "conference:1", "5": "feed:2" },
                "devices": [
                    { "mock": "pedal", "layout": { "0": "conf:8" } }
                ]
            }
        }"#;
        let toml_text = r#"
            instance = "cam1"
            [server]
            url = "https://talktome.local:8443"
            [user]
            name = "Cam 1"
            password = "secret"
            [streamdeck.layout]
            "0" = "user:4"
            "1" = "conference:1"
            [[streamdeck.devices]]
            mock = "pedal"
            layout = { "0" = "conf:8" }
        "#;
        let json =
            from_document(parse_document(Path::new("cam1.json"), json_text).unwrap()).unwrap();
        json.validate().unwrap();
        assert_eq!(
            json.streamdeck.layout.get("0").map(String::as_str),
            Some("user:4")
        );
        assert_eq!(
            json.streamdeck.layout.get("1").map(String::as_str),
            Some("conference:1")
        );
        assert_eq!(
            json.streamdeck.layout.get("5").map(String::as_str),
            Some("feed:2")
        );
        assert_eq!(
            json.streamdeck.devices[0]
                .layout
                .get("0")
                .map(String::as_str),
            Some("conf:8")
        );
        // A devices list does not inherit the top-level layout map.
        let resolved = json.streamdeck.resolved_devices();
        assert_eq!(resolved.len(), 1);
        assert_eq!(
            resolved[0].layout.get("0").map(String::as_str),
            Some("conf:8")
        );
        assert!(!resolved[0].layout.contains_key("1"));

        let toml =
            from_document(parse_document(Path::new("cam1.toml"), toml_text).unwrap()).unwrap();
        toml.validate().unwrap();
        assert_eq!(
            toml.streamdeck.layout.get("0").map(String::as_str),
            Some("user:4")
        );
        assert_eq!(
            toml.streamdeck.devices[0]
                .layout
                .get("0")
                .map(String::as_str),
            Some("conf:8")
        );
    }
}
