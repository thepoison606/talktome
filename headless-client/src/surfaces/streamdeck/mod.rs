//! Stream Deck surface: discovers the deck (optionally by serial), renders
//! the key layout and turns key/dial/touch input into talk and audio commands.
//! A mock deck (`TALKTOME_MOCK_STREAMDECK=<model>`) renders PNGs and reads
//! input lines from a file for tests.

pub mod layout;
pub mod render;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use elgato_streamdeck::asynchronous::AsyncStreamDeck;
use elgato_streamdeck::images::{convert_image_with_format, ImageRect};
use elgato_streamdeck::info::{ImageFormat, ImageMirroring, ImageMode, ImageRotation, Kind};
use elgato_streamdeck::DeviceStateUpdate;
use image::{DynamicImage, RgbImage};
use tokio::sync::watch;

use crate::config::{StreamDeckConfig, StreamDeckDeviceConfig, TalkConfig};
use crate::state::{
    Bus, Command, ConferenceMemberInfo, DeckDialView, DeckInput, DeckKeyView, DeckStatus,
    InputSource, Snapshot, TargetInfo, TargetRef,
};
use crate::talk::TargetKey;
use layout::{
    conference_members, encoder_bindings, encoder_page_count, menu_item_count, page_count, palette,
    volume_toggle_defers_to_release, Appearance, DeckState, EncoderBinding, Geometry, KeySpec,
    LayoutOptions, MenuPage, Role, LISTEN_ONLY_NOTICE,
};
use render::{draw_strip_arrows, Renderer, StripArrows, StripSegment};
use tokio::sync::mpsc;

pub const MOCK_ENV: &str = "TALKTOME_MOCK_STREAMDECK";
/// Comma-separated names painted onto mock decks when the client has no
/// live targets yet (`adi,conference:News,feed:Virus`). Optional
/// `TALKTOME_DEMO_REPLY` sets the Reply subtitle.
pub const DEMO_TARGETS_ENV: &str = "TALKTOME_DEMO_TARGETS";
pub const DEMO_REPLY_ENV: &str = "TALKTOME_DEMO_REPLY";
const STATUS_HOLD: Duration = Duration::from_millis(2000);
const MUTE_HOLD: Duration = Duration::from_millis(600);
/// How often the local IP is looked up again while the connection is lost.
const OFFLINE_IP_REFRESH: Duration = Duration::from_secs(5);
/// Holding a conference dial this long opens its members while still held.
const MEMBER_HOLD: Duration = Duration::from_millis(1000);
const BLINK_PERIOD: Duration = Duration::from_millis(500);
const READ_POLL_HZ: f32 = 50.0;

fn geometry_for(kind: Kind) -> Geometry {
    Geometry {
        keys: kind.key_count(),
        rows: kind.row_count(),
        cols: kind.column_count(),
        encoders: kind.encoder_count(),
        touchpoints: kind.touchpoint_count(),
        visual: kind.is_visual(),
    }
}

pub fn kind_from_name(name: &str) -> Option<Kind> {
    Some(
        match name
            .to_ascii_lowercase()
            .replace(['-', '_', ' '], "")
            .as_str()
        {
            "original" => Kind::Original,
            "originalv2" | "v2" => Kind::OriginalV2,
            "mini" => Kind::Mini,
            "minimk2" => Kind::MiniMk2,
            "xl" => Kind::Xl,
            "xlv2" => Kind::XlV2,
            "mk2" => Kind::Mk2,
            "neo" => Kind::Neo,
            "pedal" => Kind::Pedal,
            "plus" => Kind::Plus,
            "plusxl" => Kind::PlusXl,
            _ => return None,
        },
    )
}

/// A connected deck, real or mock.
enum Device {
    Real(AsyncStreamDeck),
    Mock(MockDeck),
}

impl Device {
    fn kind(&self) -> Kind {
        match self {
            Device::Real(deck) => deck.kind(),
            Device::Mock(mock) => mock.kind,
        }
    }

    async fn serial(&self) -> Option<String> {
        match self {
            Device::Real(deck) => deck.serial_number().await.ok(),
            Device::Mock(_) => Some("mock".into()),
        }
    }

    fn is_mock(&self) -> bool {
        matches!(self, Device::Mock(_))
    }

    async fn set_brightness(&self, percent: u8) -> Result<()> {
        match self {
            Device::Real(deck) => deck
                .set_brightness(percent)
                .await
                .map_err(|e| anyhow!("{e}")),
            Device::Mock(_) => Ok(()),
        }
    }

    async fn set_key(&self, key: u8, image: RgbImage) -> Result<()> {
        match self {
            Device::Real(deck) => {
                let data = convert_image_with_format(
                    key_image_format(deck.kind()),
                    DynamicImage::ImageRgb8(image),
                )
                .map_err(|e| anyhow!("{e}"))?;
                deck.write_image(key, &data)
                    .await
                    .map_err(|e| anyhow!("{e}"))
            }
            Device::Mock(mock) => mock.write_key(key, &image),
        }
    }

    async fn set_lcd(&self, image: RgbImage) -> Result<()> {
        match self {
            Device::Real(deck) if matches!(deck.kind(), Kind::PlusXl) => {
                // elgato-streamdeck 0.13 sends the rotated 100×1200 size in the
                // header; the + XL wants the logical 1200×100 region with the
                // JPEG rotated 90° counter-clockwise (Elgato HID docs).
                let (w, h) = image.dimensions();
                let mut rect = ImageRect::from_image(DynamicImage::ImageRgb8(image).rotate270())
                    .map_err(|e| anyhow!("{e}"))?;
                rect.w = w as u16;
                rect.h = h as u16;
                deck.write_lcd(0, 0, &rect)
                    .await
                    .map_err(|e| anyhow!("{e}"))
            }
            Device::Real(deck) => {
                let Some(format) = deck.kind().lcd_image_format() else {
                    return Ok(());
                };
                let data = convert_image_with_format(format, DynamicImage::ImageRgb8(image))
                    .map_err(|e| anyhow!("{e}"))?;
                deck.write_lcd_fill(&data).await.map_err(|e| anyhow!("{e}"))
            }
            Device::Mock(mock) => mock.write_lcd(&image),
        }
    }

    async fn flush(&self) -> Result<()> {
        match self {
            Device::Real(deck) => deck.flush().await.map_err(|e| anyhow!("{e}")),
            Device::Mock(mock) => mock.compose(),
        }
    }

    async fn clear(&self) -> Result<()> {
        match self {
            Device::Real(deck) => {
                deck.clear_all_button_images()
                    .await
                    .map_err(|e| anyhow!("{e}"))?;
                deck.flush().await.map_err(|e| anyhow!("{e}"))
            }
            Device::Mock(_) => Ok(()),
        }
    }

    async fn read(
        &self,
        reader: &Option<Arc<elgato_streamdeck::asynchronous::AsyncDeviceStateReader>>,
    ) -> Result<Vec<DeviceStateUpdate>> {
        match self {
            Device::Real(_) => {
                let reader = reader.as_ref().ok_or_else(|| anyhow!("no reader"))?;
                reader.read(READ_POLL_HZ).await.map_err(|e| anyhow!("{e}"))
            }
            Device::Mock(mock) => mock.read().await,
        }
    }
}

/// File-driven stand-in: `<dir>/streamdeck/key-NN.png`, `<dir>/streamdeck/lcd.png`,
/// inputs from `<dir>/streamdeck-inputs` (`down 3`, `up 3`, `twist 0 -2`,
/// `encoder-down 1`, `encoder-up 1`, `touch 1`, `swipe left|right`, `tap 120 50`).
struct MockDeck {
    kind: Kind,
    dir: PathBuf,
    inputs: PathBuf,
    offset: std::sync::Mutex<u64>,
    keys: std::sync::Mutex<Vec<Option<RgbImage>>>,
}

impl MockDeck {
    fn new(kind: Kind, id: usize) -> Result<Self> {
        let base = std::env::var_os(super::MOCK_DIR_ENV)
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let dir = if id == 0 {
            base.join("streamdeck")
        } else {
            base.join(format!("streamdeck-{id}"))
        };
        std::fs::create_dir_all(&dir)?;
        let inputs = if id == 0 {
            base.join("streamdeck-inputs")
        } else {
            base.join(format!("streamdeck-{id}-inputs"))
        };
        let offset = std::fs::metadata(&inputs).map(|m| m.len()).unwrap_or(0);
        Ok(Self {
            kind,
            dir,
            inputs,
            offset: std::sync::Mutex::new(offset),
            keys: std::sync::Mutex::new(vec![None; kind.key_count() as usize]),
        })
    }

    fn write_key(&self, key: u8, image: &RgbImage) -> Result<()> {
        if let Ok(mut keys) = self.keys.lock() {
            if let Some(slot) = keys.get_mut(key as usize) {
                *slot = Some(image.clone());
            }
        }
        self.write_png(&format!("key-{key:02}.png"), image)
    }

    /// Composes all keys into `deck.png` in the device's row/column layout.
    fn compose(&self) -> Result<()> {
        let keys = self
            .keys
            .lock()
            .map_err(|_| anyhow!("mock keys poisoned"))?;
        let Some(sample) = keys.iter().flatten().next() else {
            return Ok(());
        };
        let (kw, kh) = sample.dimensions();
        let gap = 8u32;
        let cols = self.kind.column_count() as u32;
        let rows = self.kind.row_count() as u32;
        let mut canvas = RgbImage::from_pixel(
            cols * (kw + gap) + gap,
            rows * (kh + gap) + gap,
            image::Rgb([12, 12, 14]),
        );
        for (index, key) in keys.iter().enumerate() {
            let Some(key) = key else { continue };
            let col = index as u32 % cols;
            let row = index as u32 / cols;
            let x0 = gap + col * (kw + gap);
            let y0 = gap + row * (kh + gap);
            for (x, y, pixel) in key.enumerate_pixels() {
                canvas.put_pixel(x0 + x, y0 + y, *pixel);
            }
        }
        self.write_png("deck.png", &canvas)
    }

    fn write_lcd(&self, image: &RgbImage) -> Result<()> {
        self.write_png("lcd.png", image)
    }

    fn write_png(&self, name: &str, image: &RgbImage) -> Result<()> {
        let path = self.dir.join(name);
        let tmp = self.dir.join(format!(".{name}.tmp.png"));
        image.save_with_format(&tmp, image::ImageFormat::Png)?;
        std::fs::rename(tmp, path)?;
        Ok(())
    }

    async fn read(&self) -> Result<Vec<DeviceStateUpdate>> {
        tokio::time::sleep(Duration::from_millis(50)).await;
        let Ok(text) = std::fs::read_to_string(&self.inputs) else {
            return Ok(Vec::new());
        };
        let mut offset = self
            .offset
            .lock()
            .map_err(|_| anyhow!("mock offset poisoned"))?;
        if (text.len() as u64) < *offset {
            *offset = 0;
        }
        let new_text = &text[*offset as usize..];
        let Some(last_newline) = new_text.rfind('\n') else {
            return Ok(Vec::new());
        };
        let mut updates = Vec::new();
        for line in new_text[..last_newline].lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            let update = match parts.as_slice() {
                ["down", k] => k.parse().ok().map(DeviceStateUpdate::ButtonDown),
                ["up", k] => k.parse().ok().map(DeviceStateUpdate::ButtonUp),
                ["twist", e, d] => e
                    .parse()
                    .ok()
                    .zip(d.parse().ok())
                    .map(|(e, d)| DeviceStateUpdate::EncoderTwist(e, d)),
                ["encoder-down", e] => e.parse().ok().map(DeviceStateUpdate::EncoderDown),
                ["encoder-up", e] => e.parse().ok().map(DeviceStateUpdate::EncoderUp),
                ["touch", p] => p.parse().ok().map(DeviceStateUpdate::TouchPointDown),
                ["swipe", "left"] => {
                    Some(DeviceStateUpdate::TouchScreenSwipe((600, 50), (100, 50)))
                }
                ["swipe", "right"] => {
                    Some(DeviceStateUpdate::TouchScreenSwipe((100, 50), (600, 50)))
                }
                ["tap", x, y] => x
                    .parse()
                    .ok()
                    .zip(y.parse().ok())
                    .map(|(x, y)| DeviceStateUpdate::TouchScreenPress(x, y)),
                _ => None,
            };
            match update {
                Some(update) => updates.push(update),
                None => tracing::warn!(event = "streamdeck-mock-invalid", line),
            }
        }
        *offset += (last_newline + 1) as u64;
        Ok(updates)
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn run(
    id: usize,
    config: StreamDeckConfig,
    device_config: StreamDeckDeviceConfig,
    talk: TalkConfig,
    bus: Bus,
    mut deck_input: mpsc::Receiver<DeckInput>,
    mut shutdown: watch::Receiver<bool>,
    claimed: Arc<Mutex<HashSet<String>>>,
) {
    let env_mock = std::env::var(MOCK_ENV)
        .ok()
        .and_then(|name| kind_from_name(&name));
    let mock_kind = device_config
        .mock
        .as_deref()
        .filter(|name| !name.trim().is_empty())
        .and_then(kind_from_name)
        .or_else(|| {
            if id == 0 {
                env_mock.or_else(|| {
                    config
                        .mock
                        .as_deref()
                        .filter(|name| !name.trim().is_empty())
                        .and_then(kind_from_name)
                })
            } else {
                None
            }
        });
    let renderer = Renderer::load(&config.font_path);
    let mut warned = false;
    let mut bound_serial = device_config.serial.clone();
    publish_disconnected(&bus, id, None);
    loop {
        if *shutdown.borrow() {
            return;
        }
        let device = match mock_kind {
            Some(kind) => MockDeck::new(kind, id).map(Device::Mock),
            None => discover(&bound_serial, &claimed),
        };
        match device {
            Ok(device) => {
                warned = false;
                if let Some(serial) = device.serial().await {
                    bound_serial = Some(serial.clone());
                    if let Ok(mut claimed) = claimed.lock() {
                        claimed.insert(serial);
                    }
                }
                let kind = device.kind();
                tracing::info!(
                    event = "streamdeck-connected",
                    id,
                    kind = ?kind,
                    mock = mock_kind.is_some()
                );
                let outcome = run_device(
                    id,
                    device,
                    &config,
                    &device_config,
                    &talk,
                    &renderer,
                    &bus,
                    &mut deck_input,
                    &mut shutdown,
                )
                .await;
                if *shutdown.borrow() {
                    return;
                }
                let error = outcome.err().map(|e| format!("{e:#}")).unwrap_or_default();
                tracing::warn!(event = "streamdeck-disconnected", id, error = %error);
                publish_disconnected(&bus, id, Some(error));
            }
            Err(error) => {
                if !warned {
                    tracing::warn!(event = "streamdeck-not-found", id, error = %format!("{error:#}"));
                    warned = true;
                }
                publish_disconnected(&bus, id, Some(format!("{error:#}")));
            }
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(3)) => {}
            _ = shutdown.changed() => {}
        }
    }
}

fn discover(serial: &Option<String>, claimed: &Arc<Mutex<HashSet<String>>>) -> Result<Device> {
    let hid = elgato_streamdeck::new_hidapi().context("initialising hidapi")?;
    let devices = elgato_streamdeck::list_devices(&hid);
    if devices.is_empty() {
        anyhow::bail!("no Stream Deck found");
    }
    let claimed_serials = claimed.lock().ok();
    let (kind, found_serial) = match serial.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(wanted) => devices
            .into_iter()
            .find(|(_, s)| s == wanted)
            .ok_or_else(|| anyhow!("Stream Deck with serial {wanted:?} not connected"))?,
        None => devices
            .into_iter()
            .find(|(_, s)| {
                claimed_serials
                    .as_ref()
                    .map(|set| !set.contains(s))
                    .unwrap_or(true)
            })
            .ok_or_else(|| anyhow!("no unused Stream Deck connected"))?,
    };
    let deck = AsyncStreamDeck::connect(&hid, kind, &found_serial)
        .map_err(|e| anyhow!("connecting to {kind:?} {found_serial}: {e}"))?;
    Ok(Device::Real(deck))
}

/// `talktome-headless list-streamdecks`.
pub fn list() -> Result<()> {
    let hid = elgato_streamdeck::new_hidapi().context("initialising hidapi")?;
    let devices = elgato_streamdeck::list_devices(&hid);
    if devices.is_empty() {
        println!("No Stream Deck found. Check the udev rule and that the device is plugged in.");
        return Ok(());
    }
    for (kind, serial) in devices {
        println!(
            "{kind:?}  serial={serial}  keys={} encoders={} touchpoints={}",
            kind.key_count(),
            kind.encoder_count(),
            kind.touchpoint_count()
        );
    }
    Ok(())
}

struct PressedKey {
    role: Role,
    since: Instant,
    /// Mini volume / member layer: the press was on the already selected
    /// target or member, so a short tap closes the layer.
    reselect: bool,
}

fn publish_disconnected(bus: &Bus, id: usize, error: Option<String>) {
    if let Ok(mut hardware) = bus.hardware.write() {
        if hardware.decks.len() <= id {
            hardware.decks.resize(id + 1, DeckStatus::default());
        }
        hardware.decks[id] = DeckStatus {
            id,
            enabled: true,
            connected: false,
            error,
            ..DeckStatus::default()
        };
        hardware.deck_images.retain(|(device, _), _| *device != id);
    }
}

fn role_label(role: Role) -> String {
    match role {
        Role::Status => "status".into(),
        Role::Reply => "reply".into(),
        Role::Target(key) => key.to_string(),
        Role::Member {
            conference,
            user_id,
        } => format!("{conference}/user:{user_id}"),
        Role::NextPage => "next-page".into(),
        Role::NextEncoderPage => "next-dials".into(),
        Role::VolumeToggle => "volume-toggle".into(),
        Role::MembersToggle => "members-toggle".into(),
        Role::VolumeUp => "volume-up".into(),
        Role::VolumeDown => "volume-down".into(),
        Role::MuteSelected => "mute-selected".into(),
        Role::Production(index) => format!("production:{index}"),
        Role::ClearLocks => "clear-locks".into(),
        Role::Restart => "restart".into(),
        Role::Menu(page) => format!("menu:{}", menu_label(page)),
        Role::Info(index) => format!("info:{index}"),
        Role::SystemVolume => "system-volume".into(),
        Role::Empty => "empty".into(),
    }
}

/// Local address the OS uses to reach the server: a connected UDP socket
/// picks the route without sending anything. Falls back to the default route.
async fn local_ip_towards(server_url: &str) -> Option<String> {
    let server = url::Url::parse(server_url).ok().and_then(|url| {
        Some(format!(
            "{}:{}",
            url.host_str()?,
            url.port_or_known_default()?
        ))
    });
    let lookup = async {
        for target in server.into_iter().chain(["1.1.1.1:53".to_string()]) {
            for bind in ["0.0.0.0:0", "[::]:0"] {
                let Ok(socket) = tokio::net::UdpSocket::bind(bind).await else {
                    continue;
                };
                if socket.connect(&target).await.is_err() {
                    continue;
                }
                if let Ok(addr) = socket.local_addr() {
                    if !addr.ip().is_unspecified() {
                        return Some(addr.ip().to_string());
                    }
                }
            }
        }
        None
    };
    tokio::time::timeout(Duration::from_secs(2), lookup)
        .await
        .ok()
        .flatten()
}

fn menu_label(page: MenuPage) -> &'static str {
    match page {
        MenuPage::Root => "menu",
        MenuPage::Productions => "productions",
        MenuPage::Info => "info",
    }
}

fn key_item_count(geometry: &Geometry, snapshot: &Snapshot, state: &DeckState) -> usize {
    if let Some(menu) = state.menu {
        menu_item_count(geometry, snapshot, menu)
    } else if state.member_layer {
        state
            .member_conference
            .map(|key| conference_members(snapshot, key).len())
            .unwrap_or(0)
    } else {
        snapshot.targets.len() + usize::from(state.volume_layer && snapshot.system_volume.is_some())
    }
}

fn cycle_page(page: &mut usize, pages: usize, forward: bool) {
    let pages = pages.max(1);
    *page = if forward {
        (*page + 1) % pages
    } else {
        (*page + pages - 1) % pages
    };
}

fn restart_hold_confirmed(
    held: Duration,
    menu: Option<MenuPage>,
    current_role: Option<Role>,
) -> bool {
    held >= Duration::from_secs(2)
        && menu == Some(MenuPage::Root)
        && current_role == Some(Role::Restart)
}

fn restart_hold_deadline(
    pressed: &HashMap<u8, PressedKey>,
    menu: Option<MenuPage>,
    keys: &[KeySpec],
) -> Option<Instant> {
    pressed
        .iter()
        .filter(|(key, press)| {
            press.role == Role::Restart
                && restart_hold_confirmed(
                    Duration::from_secs(2),
                    menu,
                    keys.get(**key as usize).map(|spec| spec.role),
                )
        })
        .map(|(_, press)| press.since + Duration::from_secs(2))
        .min()
}

fn take_due_restart(
    pressed: &mut HashMap<u8, PressedKey>,
    menu: Option<MenuPage>,
    keys: &[KeySpec],
    now: Instant,
) -> bool {
    let due: Vec<u8> = pressed
        .iter()
        .filter(|(key, press)| {
            press.role == Role::Restart
                && restart_hold_confirmed(
                    now.saturating_duration_since(press.since),
                    menu,
                    keys.get(**key as usize).map(|spec| spec.role),
                )
        })
        .map(|(key, _)| *key)
        .collect();
    for key in &due {
        pressed.remove(key);
    }
    !due.is_empty()
}

#[derive(Clone, Copy)]
enum BoundEncoder {
    SystemVolume,
    Target(TargetKey),
    Member { conference: TargetKey, user_id: i64 },
}

/// What a dial held past `MEMBER_HOLD` does.
#[derive(Debug, PartialEq, Eq)]
enum DialHold {
    /// A conference dial opens that conference's member mix.
    OpenMembers(TargetKey),
    /// Any dial leaves the member mix again.
    CloseMembers,
    Nothing,
}

fn dial_hold_action(member_layer: bool, binding: Option<BoundEncoder>) -> DialHold {
    if member_layer {
        return DialHold::CloseMembers;
    }
    match binding {
        Some(BoundEncoder::Target(target @ TargetKey::Conference(_))) => {
            DialHold::OpenMembers(target)
        }
        _ => DialHold::Nothing,
    }
}

fn bound_encoder(
    geometry: &Geometry,
    state: &DeckState,
    snapshot: &Snapshot,
    encoder: u8,
) -> Option<BoundEncoder> {
    match encoder_bindings(geometry, state, snapshot)
        .get(encoder as usize)
        .copied()
        .flatten()
    {
        Some(EncoderBinding::SystemVolume(_)) => Some(BoundEncoder::SystemVolume),
        Some(EncoderBinding::Target(target)) => Some(BoundEncoder::Target(target.key)),
        Some(EncoderBinding::Member { conference, member }) => Some(BoundEncoder::Member {
            conference,
            user_id: member.user_id,
        }),
        None => None,
    }
}

fn image_hash(image: &RgbImage) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    image.dimensions().hash(&mut hasher);
    image.as_raw().hash(&mut hasher);
    hasher.finish()
}

fn encode_png(image: &RgbImage) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut bytes);
    image
        .write_to(&mut cursor, image::ImageFormat::Png)
        .ok()
        .map(|_| bytes)
}

/// Converts a web-injected input into the device update type.
fn injected_update(input: DeckInput) -> DeviceStateUpdate {
    match input {
        DeckInput::KeyDown(key) => DeviceStateUpdate::ButtonDown(key),
        DeckInput::KeyUp(key) => DeviceStateUpdate::ButtonUp(key),
        DeckInput::EncoderTwist(encoder, delta) => DeviceStateUpdate::EncoderTwist(encoder, delta),
        DeckInput::EncoderPress(encoder) => DeviceStateUpdate::EncoderDown(encoder),
        DeckInput::EncoderRelease(encoder) => DeviceStateUpdate::EncoderUp(encoder),
        DeckInput::TouchPoint(point) => DeviceStateUpdate::TouchPointDown(point),
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_device(
    id: usize,
    device: Device,
    config: &StreamDeckConfig,
    device_config: &StreamDeckDeviceConfig,
    talk: &TalkConfig,
    renderer: &Renderer,
    bus: &Bus,
    deck_input: &mut mpsc::Receiver<DeckInput>,
    shutdown: &mut watch::Receiver<bool>,
) -> Result<()> {
    let kind = device.kind();
    let geometry = geometry_for(kind);
    let serial = device.serial().await;
    let is_mock = device.is_mock();
    let key_size = effective_key_size(kind);
    let lcd_size = lcd_logical_size(kind);
    let options = layout_options(device_config);
    let reader = match &device {
        Device::Real(deck) => Some(deck.get_reader()),
        Device::Mock(_) => None,
    };
    let _ = talk;

    device.set_brightness(config.brightness).await?;
    let mut state = DeckState::default();
    let mut snapshots = bus.snapshots.clone();
    let mut snapshot: Arc<Snapshot> = with_demo_targets(snapshots.borrow().clone(), is_mock);
    let mut rendered: HashMap<u8, (Appearance, bool)> = HashMap::new();
    let mut images: HashMap<u8, (u64, Arc<Vec<u8>>)> = HashMap::new();
    let mut lcd_rendered: Option<(Vec<StripSegment>, StripArrows)> = None;
    let mut pressed: HashMap<u8, PressedKey> = HashMap::new();
    let mut pressed_encoders: HashMap<u8, Instant> = HashMap::new();
    let mut ip_checked: Option<Instant> = None;
    let mut keys: Vec<KeySpec> = layout::layout(&geometry, &snapshot, &state, &options);
    let mut blink = tokio::time::interval(BLINK_PERIOD);
    let volume_timeout = Duration::from_secs(config.volume_layer_timeout_s.max(1));
    let source = |key: u8| InputSource::StreamDeck {
        device: id as u8,
        key,
    };

    render_all(
        &device,
        &geometry,
        renderer,
        key_size,
        &keys,
        &state,
        &mut rendered,
        &mut images,
    )
    .await?;
    if let Some(size) = lcd_size {
        render_lcd(
            &device,
            kind,
            renderer,
            size,
            &geometry,
            &state,
            &snapshot,
            &mut lcd_rendered,
        )
        .await?;
    }
    publish_deck_view(
        bus, id, kind, &serial, is_mock, &geometry, key_size, &keys, &state, &snapshot, &images,
    );

    loop {
        let mut relayout = false;
        let mut pending_updates: Vec<DeviceStateUpdate> = Vec::new();
        // Wake for every held dial whose hold does something (open or leave
        // the member mix), decided the same way as the action below.
        let member_hold_at = pressed_encoders
            .iter()
            .filter(|(encoder, _)| {
                dial_hold_action(
                    state.member_layer,
                    bound_encoder(&geometry, &state, &snapshot, **encoder),
                ) != DialHold::Nothing
            })
            .map(|(_, since)| *since + MEMBER_HOLD)
            .min();
        let restart_at = restart_hold_deadline(&pressed, state.menu, &keys);
        tokio::select! {
            _ = async {
                match restart_at {
                    Some(at) => tokio::time::sleep_until(at.into()).await,
                    None => std::future::pending().await,
                }
            } => {
                // Consume the hold now: a later ButtonUp cannot trigger it again.
                if take_due_restart(&mut pressed, state.menu, &keys, Instant::now()) {
                    if let Some(restart) = &bus.restart {
                        tracing::warn!(event = "streamdeck-restart");
                        restart.request();
                    }
                }
            }
            _ = async {
                match member_hold_at {
                    Some(at) => tokio::time::sleep_until(at.into()).await,
                    None => std::future::pending().await,
                }
            } => {
                let now = Instant::now();
                let due: Vec<u8> = pressed_encoders
                    .iter()
                    .filter(|(_, since)| now.duration_since(**since) >= MEMBER_HOLD)
                    .map(|(encoder, _)| *encoder)
                    .collect();
                for encoder in due {
                    let binding = bound_encoder(&geometry, &state, &snapshot, encoder);
                    match dial_hold_action(state.member_layer, binding) {
                        DialHold::OpenMembers(target) => {
                            // Handled: the release that follows does nothing.
                            pressed_encoders.remove(&encoder);
                            relayout |= state.open_member_layer(&snapshot, Some(target));
                        }
                        DialHold::CloseMembers => {
                            pressed_encoders.remove(&encoder);
                            state.close_member_layer();
                            relayout = true;
                        }
                        DialHold::Nothing => {}
                    }
                }
            }
            changed = snapshots.changed() => {
                if changed.is_err() { return Ok(()); }
                snapshot = with_demo_targets(snapshots.borrow().clone(), is_mock);
                relayout = true;
            }
            _ = blink.tick() => {
                state.blink_phase = !state.blink_phase;
                if state.menu == Some(MenuPage::Root) && pressed.iter().any(|(key, press)| press.role == Role::Restart && keys.get(*key as usize).is_some_and(|spec| spec.role == Role::Restart)) {
                    state.touch_layer();
                }
                if state.expire_volume_layer(volume_timeout)
                    || state.expire_member_layer(volume_timeout)
                    || state.expire_menu(volume_timeout)
                    || state.expire_listen_only(LISTEN_ONLY_NOTICE)
                {
                    relayout = true;
                }
                if layout::connection_lost(&snapshot)
                    && ip_checked.is_none_or(|at| at.elapsed() >= OFFLINE_IP_REFRESH)
                {
                    ip_checked = Some(Instant::now());
                    let ip = local_ip_towards(&snapshot.server_url).await;
                    if ip != state.local_ip {
                        state.local_ip = ip;
                        relayout = true;
                    }
                }
            }
            injected = deck_input.recv() => {
                if let Some(input) = injected {
                    pending_updates.push(injected_update(input));
                }
            }
            updates = device.read(&reader) => {
                let updates = updates.context("reading deck input")?;
                pending_updates.extend(updates);
            }
            _ = shutdown.changed() => {
                if *shutdown.borrow() {
                    // Release anything still held so the session stops talking.
                    for (key, press) in pressed.drain() {
                        match press.role {
                            Role::Reply => { let _ = bus.commands.send(Command::TalkRelease { source: source(key), target: TargetRef::Reply }).await; }
                            Role::Target(target) if target.can_talk() => { let _ = bus.commands.send(Command::TalkRelease { source: source(key), target: TargetRef::Key(target) }).await; }
                            _ => {}
                        }
                    }
                    let _ = device.clear().await;
                    let _ = device.set_brightness(0).await;
                    return Ok(());
                }
            }
        }

        for update in pending_updates {
            let now = Instant::now();
            match update {
                DeviceStateUpdate::ButtonDown(key) => {
                    let Some(spec) = keys.get(key as usize) else {
                        continue;
                    };
                    let role = spec.role;
                    let reselect = layout::volume_in_menu(&geometry)
                        && match role {
                            Role::SystemVolume => {
                                state.volume_layer && state.system_volume_selected
                            }
                            Role::Target(target) => {
                                state.volume_layer
                                    && !state.system_volume_selected
                                    && state.selected == Some(target)
                            }
                            Role::Member { user_id, .. } => {
                                state.member_layer && state.member_selected == Some(user_id)
                            }
                            _ => false,
                        };
                    pressed.insert(
                        key,
                        PressedKey {
                            role,
                            since: now,
                            reselect,
                        },
                    );
                    match role {
                        Role::Status => {}
                        Role::Reply => {
                            let _ = bus
                                .commands
                                .send(Command::TalkPress {
                                    source: source(key),
                                    target: TargetRef::Reply,
                                })
                                .await;
                        }
                        Role::Target(target) => {
                            if state.volume_layer {
                                state.system_volume_selected = false;
                                state.selected = Some(target);
                                state.touch_volume_layer();
                                relayout = true;
                            } else if target.can_talk()
                                && snapshot
                                    .targets
                                    .iter()
                                    .find(|t| t.key == target)
                                    .is_none_or(|t| t.can_talk)
                            {
                                if matches!(target, TargetKey::User(_))
                                    && snapshot
                                        .targets
                                        .iter()
                                        .find(|t| t.key == target)
                                        .is_some_and(|t| !t.online)
                                {
                                    // Offline users stay grey; the press is ignored so
                                    // the operator sees that talk does not engage.
                                } else {
                                    let _ = bus
                                        .commands
                                        .send(Command::TalkPress {
                                            source: source(key),
                                            target: TargetRef::Key(target),
                                        })
                                        .await;
                                }
                            } else if matches!(target, TargetKey::Conference(_)) {
                                // Listen-only conference: say so instead of muting it.
                                state.show_listen_only(target);
                                relayout = true;
                            } else {
                                let _ = bus.commands.send(Command::MuteToggle(target)).await;
                            }
                        }
                        Role::Member { user_id, .. } => {
                            state.member_selected = Some(user_id);
                            state.touch_member_layer();
                            relayout = true;
                        }
                        Role::NextPage => {
                            let pages =
                                page_count(&geometry, key_item_count(&geometry, &snapshot, &state));
                            cycle_page(state.key_page_mut(), pages, true);
                            state.touch_layer();
                            relayout = true;
                        }
                        Role::NextEncoderPage => {
                            let pages = encoder_page_count(
                                &geometry,
                                key_item_count(&geometry, &snapshot, &state),
                            );
                            cycle_page(&mut state.encoder_page, pages, true);
                            if state.member_layer {
                                state.touch_member_layer();
                            }
                            relayout = true;
                        }
                        Role::VolumeToggle => {
                            if !volume_toggle_defers_to_release(&geometry) {
                                state.toggle_volume_layer(&snapshot);
                                relayout = true;
                            }
                        }
                        Role::MembersToggle => {
                            relayout = state.toggle_member_layer(&snapshot, None);
                        }
                        Role::VolumeUp | Role::VolumeDown => {
                            let delta = if role == Role::VolumeUp {
                                config.volume_step_linear()
                            } else {
                                -config.volume_step_linear()
                            };
                            if state.member_layer {
                                state.touch_member_layer();
                                if let (Some(conference), Some(user_id)) =
                                    (state.member_conference, state.member_selected)
                                {
                                    let _ = bus
                                        .commands
                                        .send(Command::MemberVolumeStep {
                                            conference,
                                            user_id,
                                            delta,
                                        })
                                        .await;
                                }
                            } else if state.system_volume_selected && state.volume_layer {
                                state.touch_volume_layer();
                                let _ = bus
                                    .commands
                                    .send(Command::SystemVolume(
                                        crate::audio::system_volume::Action::Step(delta),
                                    ))
                                    .await;
                            } else {
                                state.touch_volume_layer();
                                if let Some(target) = state.selected {
                                    let _ = bus
                                        .commands
                                        .send(Command::VolumeStep { target, delta })
                                        .await;
                                }
                            }
                        }
                        Role::MuteSelected => {
                            if state.member_layer {
                                state.touch_member_layer();
                                if let (Some(conference), Some(user_id)) =
                                    (state.member_conference, state.member_selected)
                                {
                                    let _ = bus
                                        .commands
                                        .send(Command::MemberMuteToggle {
                                            conference,
                                            user_id,
                                        })
                                        .await;
                                }
                            } else if state.system_volume_selected && state.volume_layer {
                                state.touch_volume_layer();
                                if snapshot
                                    .system_volume
                                    .as_ref()
                                    .is_some_and(|v| v.mute_supported)
                                {
                                    let _ = bus
                                        .commands
                                        .send(Command::SystemVolume(
                                            crate::audio::system_volume::Action::ToggleMute,
                                        ))
                                        .await;
                                }
                            } else {
                                state.touch_volume_layer();
                                if let Some(target) = state.selected {
                                    let _ = bus.commands.send(Command::MuteToggle(target)).await;
                                }
                            }
                        }
                        Role::Production(index) => {
                            if let Some(production) = snapshot.productions.get(index) {
                                if !snapshot.is_current_production(production) {
                                    let _ = bus
                                        .commands
                                        .send(Command::SetProduction(production.id.clone()))
                                        .await;
                                    state.page = 0;
                                }
                            }
                            state.close_menu();
                            relayout = true;
                        }
                        Role::ClearLocks => {
                            let _ = bus.commands.send(Command::ClearLocks).await;
                            state.touch_layer();
                        }
                        Role::Restart => state.touch_layer(),
                        Role::Menu(page) => {
                            if page == MenuPage::Info {
                                state.local_ip = local_ip_towards(&snapshot.server_url).await;
                            }
                            state.open_menu(page);
                            relayout = true;
                        }
                        Role::Info(_) => state.touch_layer(),
                        Role::SystemVolume => {
                            state.system_volume_selected = true;
                            state.touch_volume_layer();
                            relayout = true;
                        }
                        Role::Empty => {}
                    }
                }
                DeviceStateUpdate::ButtonUp(key) => {
                    let Some(press) = pressed.remove(&key) else {
                        continue;
                    };
                    let held = now.duration_since(press.since);
                    match press.role {
                        Role::Restart => {
                            // Fallback if ButtonUp and the deadline become
                            // ready in the same poll. The timer consumes an
                            // already-fired hold, so it cannot run twice.
                            if restart_hold_confirmed(
                                held,
                                state.menu,
                                keys.get(key as usize).map(|spec| spec.role),
                            ) {
                                if let Some(restart) = &bus.restart {
                                    tracing::warn!(event = "streamdeck-restart");
                                    restart.request();
                                }
                            }
                            state.touch_layer();
                        }
                        Role::Status => {
                            if held >= STATUS_HOLD {
                                let pages = page_count(
                                    &geometry,
                                    key_item_count(&geometry, &snapshot, &state),
                                );
                                cycle_page(state.key_page_mut(), pages, true);
                                state.touch_layer();
                            } else if state.menu.is_some() {
                                state.menu_back();
                            } else {
                                state.open_menu(MenuPage::Root);
                            }
                            relayout = true;
                        }
                        Role::Reply => {
                            let _ = bus
                                .commands
                                .send(Command::TalkRelease {
                                    source: source(key),
                                    target: TargetRef::Reply,
                                })
                                .await;
                        }
                        Role::Target(target) => {
                            if state.volume_layer {
                                if held >= MUTE_HOLD {
                                    let _ = bus.commands.send(Command::MuteToggle(target)).await;
                                } else if press.reselect {
                                    state.close_volume_layer();
                                    relayout = true;
                                }
                            } else if target.can_talk() {
                                let _ = bus
                                    .commands
                                    .send(Command::TalkRelease {
                                        source: source(key),
                                        target: TargetRef::Key(target),
                                    })
                                    .await;
                            }
                        }
                        Role::Member {
                            conference,
                            user_id,
                        } => {
                            if held >= MUTE_HOLD {
                                let _ = bus
                                    .commands
                                    .send(Command::MemberMuteToggle {
                                        conference,
                                        user_id,
                                    })
                                    .await;
                                state.touch_member_layer();
                            } else if press.reselect {
                                state.close_member_layer();
                                relayout = true;
                            }
                        }
                        Role::SystemVolume if state.volume_layer => {
                            if held >= MUTE_HOLD
                                && snapshot
                                    .system_volume
                                    .as_ref()
                                    .is_some_and(|v| v.mute_supported)
                            {
                                let _ = bus
                                    .commands
                                    .send(Command::SystemVolume(
                                        crate::audio::system_volume::Action::ToggleMute,
                                    ))
                                    .await;
                                state.touch_volume_layer();
                            } else if held < MUTE_HOLD && press.reselect {
                                state.close_volume_layer();
                                relayout = true;
                            }
                        }
                        Role::VolumeToggle if volume_toggle_defers_to_release(&geometry) => {
                            if held >= MUTE_HOLD {
                                relayout = state.open_member_layer(&snapshot, None);
                            } else {
                                state.toggle_volume_layer(&snapshot);
                                relayout = true;
                            }
                        }
                        _ => {}
                    }
                }
                DeviceStateUpdate::EncoderTwist(encoder, ticks) => {
                    let delta = config.volume_step_linear() * ticks as f32;
                    match bound_encoder(&geometry, &state, &snapshot, encoder) {
                        Some(BoundEncoder::SystemVolume) => {
                            state.touch_volume_layer();
                            let _ = bus
                                .commands
                                .send(Command::SystemVolume(
                                    crate::audio::system_volume::Action::Step(delta),
                                ))
                                .await;
                        }
                        Some(BoundEncoder::Target(target)) => {
                            let _ = bus
                                .commands
                                .send(Command::VolumeStep { target, delta })
                                .await;
                        }
                        Some(BoundEncoder::Member {
                            conference,
                            user_id,
                            ..
                        }) => {
                            if state.member_layer {
                                state.touch_member_layer();
                            }
                            let _ = bus
                                .commands
                                .send(Command::MemberVolumeStep {
                                    conference,
                                    user_id,
                                    delta,
                                })
                                .await;
                        }
                        None => {}
                    }
                }
                DeviceStateUpdate::EncoderDown(encoder) => {
                    pressed_encoders.insert(encoder, now);
                }
                DeviceStateUpdate::EncoderUp(encoder) => {
                    let Some(since) = pressed_encoders.remove(&encoder) else {
                        continue;
                    };
                    let held = now.duration_since(since);
                    match bound_encoder(&geometry, &state, &snapshot, encoder) {
                        Some(BoundEncoder::SystemVolume) => {
                            state.touch_volume_layer();
                            if snapshot
                                .system_volume
                                .as_ref()
                                .is_some_and(|v| v.mute_supported)
                            {
                                let _ = bus
                                    .commands
                                    .send(Command::SystemVolume(
                                        crate::audio::system_volume::Action::ToggleMute,
                                    ))
                                    .await;
                            }
                        }
                        Some(BoundEncoder::Member {
                            conference,
                            user_id,
                            ..
                        }) => {
                            // Like a conference dial: a release just short of
                            // the hold that leaves the mix does not mute.
                            if held < MUTE_HOLD {
                                let _ = bus
                                    .commands
                                    .send(Command::MemberMuteToggle {
                                        conference,
                                        user_id,
                                    })
                                    .await;
                            }
                            state.touch_member_layer();
                        }
                        Some(BoundEncoder::Target(target)) => {
                            // Held past MEMBER_HOLD, a conference already
                            // opened its members; let go just short of it,
                            // nothing happens rather than a surprise mute.
                            let conference = matches!(target, TargetKey::Conference(_));
                            if !conference || held < MUTE_HOLD {
                                let _ = bus.commands.send(Command::MuteToggle(target)).await;
                            }
                        }
                        None => {}
                    }
                }
                DeviceStateUpdate::TouchPointDown(point) => {
                    let pages =
                        page_count(&geometry, key_item_count(&geometry, &snapshot, &state)).max(1);
                    cycle_page(state.key_page_mut(), pages, point != 0);
                    state.touch_layer();
                    relayout = true;
                }
                DeviceStateUpdate::TouchPointUp(_) => {}
                DeviceStateUpdate::TouchScreenSwipe((x0, y0), (x1, y1)) => {
                    let forward = if lcd_size.map(|(w, h)| w >= h).unwrap_or(true) {
                        x1 < x0
                    } else {
                        y1 < y0
                    };
                    if geometry.encoders_follow_bottom_row()
                        || encoder_page_count(
                            &geometry,
                            key_item_count(&geometry, &snapshot, &state),
                        ) <= 1
                    {
                        let pages =
                            page_count(&geometry, key_item_count(&geometry, &snapshot, &state))
                                .max(1);
                        cycle_page(state.key_page_mut(), pages, forward);
                        state.touch_layer();
                    } else {
                        let pages = encoder_page_count(
                            &geometry,
                            key_item_count(&geometry, &snapshot, &state),
                        )
                        .max(1);
                        cycle_page(&mut state.encoder_page, pages, forward);
                        if state.member_layer {
                            state.touch_member_layer();
                        }
                    }
                    relayout = true;
                }
                DeviceStateUpdate::TouchScreenPress(x, y)
                | DeviceStateUpdate::TouchScreenLongPress(x, y) => {
                    if let Some((w, h)) = lcd_size {
                        let encoders = geometry.encoders.max(1) as u32;
                        let index = if w >= h {
                            x as u32 * encoders / w.max(1)
                        } else {
                            y as u32 * encoders / h.max(1)
                        };
                        match bound_encoder(&geometry, &state, &snapshot, index as u8) {
                            Some(BoundEncoder::SystemVolume) => {
                                if snapshot
                                    .system_volume
                                    .as_ref()
                                    .is_some_and(|v| v.mute_supported)
                                {
                                    let _ = bus
                                        .commands
                                        .send(Command::SystemVolume(
                                            crate::audio::system_volume::Action::ToggleMute,
                                        ))
                                        .await;
                                }
                                state.touch_volume_layer();
                            }
                            Some(BoundEncoder::Target(target)) => {
                                let _ = bus.commands.send(Command::MuteToggle(target)).await;
                            }
                            Some(BoundEncoder::Member {
                                conference,
                                user_id,
                                ..
                            }) => {
                                let _ = bus
                                    .commands
                                    .send(Command::MemberMuteToggle {
                                        conference,
                                        user_id,
                                    })
                                    .await;
                                state.touch_member_layer();
                            }
                            None => {}
                        }
                    }
                }
            }
        }

        if relayout {
            if state.member_layer {
                match state.member_conference.and_then(|key| snapshot.target(key)) {
                    None => state.close_member_layer(),
                    Some(target) => {
                        if !state.member_selected.is_some_and(|id| {
                            target.members.iter().any(|member| member.user_id == id)
                        }) {
                            state.member_selected =
                                target.members.first().map(|member| member.user_id);
                        }
                    }
                }
            }
            state.clamp_pages(&geometry, &snapshot);
            keys = layout::layout(&geometry, &snapshot, &state, &options);
            pressed.retain(|key, press| {
                press.role != Role::Restart
                    || (state.menu == Some(MenuPage::Root)
                        && keys
                            .get(*key as usize)
                            .is_some_and(|spec| spec.role == Role::Restart))
            });
        }
        let keys_changed = render_all(
            &device,
            &geometry,
            renderer,
            key_size,
            &keys,
            &state,
            &mut rendered,
            &mut images,
        )
        .await?;
        if relayout || keys_changed {
            publish_deck_view(
                bus, id, kind, &serial, is_mock, &geometry, key_size, &keys, &state, &snapshot,
                &images,
            );
        }
        if let Some(size) = lcd_size {
            render_lcd(
                &device,
                kind,
                renderer,
                size,
                &geometry,
                &state,
                &snapshot,
                &mut lcd_rendered,
            )
            .await?;
        }
    }
}

/// Key image format. elgato-streamdeck 0.13 gives the Stream Deck + XL
/// 120×120 keys; Elgato's HID docs specify 112×112 JPEG, rotated 90°
/// counter-clockwise, and a larger image comes out cropped and shifted.
fn key_image_format(kind: Kind) -> ImageFormat {
    match kind {
        Kind::PlusXl => ImageFormat {
            mode: ImageMode::JPEG,
            size: (112, 112),
            rotation: ImageRotation::Rot270,
            mirror: ImageMirroring::None,
        },
        _ => kind.key_image_format(),
    }
}

/// Size the touch strip / LCD is drawn at, before any upload rotation. The
/// library reports the + XL strip already rotated (100×1200); it is 1200×100.
fn lcd_logical_size(kind: Kind) -> Option<(u32, u32)> {
    match kind {
        Kind::PlusXl => Some((1200, 100)),
        _ => kind
            .lcd_image_format()
            .map(|format| (format.size.0 as u32, format.size.1 as u32)),
    }
}

fn effective_key_size(kind: Kind) -> (u32, u32) {
    let (w, h) = key_image_format(kind).size;
    if w == 0 || h == 0 {
        (96, 96)
    } else {
        (w as u32, h as u32)
    }
}

/// Resolves Pedal left/middle targets. `layout["0"]` / `layout["1"]` win over
/// `pedal_left` / `pedal_target`. Other layout keys are ignored.
fn layout_options(device: &StreamDeckDeviceConfig) -> LayoutOptions {
    let from_layout = |index: &str| {
        device
            .layout
            .get(index)
            .and_then(|value| TargetKey::parse(value))
    };
    LayoutOptions {
        pedal_left: from_layout("0")
            .or_else(|| device.pedal_left.as_deref().and_then(TargetKey::parse)),
        pedal_middle: from_layout("1")
            .or_else(|| device.pedal_target.as_deref().and_then(TargetKey::parse)),
    }
}

fn with_demo_targets(snapshot: Arc<Snapshot>, is_mock: bool) -> Arc<Snapshot> {
    if !is_mock {
        return snapshot;
    }
    overlay_demo_targets(snapshot)
}

pub(crate) fn overlay_demo_targets(snapshot: Arc<Snapshot>) -> Arc<Snapshot> {
    if !snapshot.targets.is_empty() {
        return snapshot;
    }
    let Ok(raw) = std::env::var(DEMO_TARGETS_ENV) else {
        return snapshot;
    };
    let targets = parse_demo_targets(&raw);
    if targets.is_empty() {
        return snapshot;
    }
    let mut snap = (*snapshot).clone();
    snap.targets = targets;
    if snap.reply_target.is_none() && !snap.main_unavailable {
        if let Ok(reply) = std::env::var(DEMO_REPLY_ENV) {
            let reply = reply.trim();
            if !reply.is_empty() {
                snap.reply_name = Some(reply.to_string());
                if let Some(target) = snap
                    .targets
                    .iter()
                    .find(|target| target.name.eq_ignore_ascii_case(reply))
                {
                    snap.reply_target = Some(target.key);
                }
            }
        }
    }
    Arc::new(snap)
}

fn parse_demo_targets(raw: &str) -> Vec<TargetInfo> {
    let mut users = 0i64;
    let mut conferences = 0i64;
    let mut feeds = 0i64;
    raw.split(',')
        .filter_map(|part| {
            let part = part.trim();
            if part.is_empty() {
                return None;
            }
            let (kind, name) = if let Some((kind, name)) = part.split_once(':') {
                let kind = kind.trim().to_ascii_lowercase();
                if matches!(kind.as_str(), "user" | "conference" | "conf" | "feed") {
                    (kind, name.trim().to_string())
                } else {
                    ("user".into(), part.to_string())
                }
            } else {
                ("user".into(), part.to_string())
            };
            let (key, can_talk) = match kind.as_str() {
                "conference" | "conf" => {
                    conferences += 1;
                    (TargetKey::Conference(conferences), true)
                }
                "feed" => {
                    feeds += 1;
                    (TargetKey::Feed(feeds), false)
                }
                _ => {
                    users += 1;
                    (TargetKey::User(users), true)
                }
            };
            Some(TargetInfo {
                key,
                name,
                can_talk,
                online: true,
                held: false,
                locked: false,
                incoming: false,
                receiving: false,
                volume: 0.8,
                muted: false,
                members: if matches!(kind.as_str(), "conference" | "conf") {
                    demo_conference_members()
                } else {
                    Vec::new()
                },
            })
        })
        .collect()
}

fn demo_conference_members() -> Vec<ConferenceMemberInfo> {
    vec![
        ConferenceMemberInfo {
            user_id: 101,
            name: "Adi".into(),
            online: true,
            receiving: true,
            volume: 0.9,
            muted: false,
        },
        ConferenceMemberInfo {
            user_id: 102,
            name: "Beni".into(),
            online: true,
            receiving: false,
            volume: 0.7,
            muted: false,
        },
        ConferenceMemberInfo {
            user_id: 103,
            name: "Jan".into(),
            online: false,
            receiving: false,
            volume: 0.5,
            muted: true,
        },
    ]
}

fn dial_views(geometry: &Geometry, state: &DeckState, snapshot: &Snapshot) -> Vec<DeckDialView> {
    encoder_bindings(geometry, state, snapshot)
        .into_iter()
        .enumerate()
        .map(|(index, binding)| match binding {
            Some(EncoderBinding::SystemVolume(volume)) => DeckDialView {
                index: index as u8,
                role: "system-volume".into(),
                title: "MAIN".into(),
                subtitle: format!("{}%", (volume.volume * 100.0).round()),
            },
            Some(EncoderBinding::Target(target)) => DeckDialView {
                index: index as u8,
                role: target.key.to_string(),
                title: target.name.clone(),
                subtitle: crate::audio::mixer::format_volume_percent(target.volume),
            },
            Some(EncoderBinding::Member { conference, member }) => DeckDialView {
                index: index as u8,
                role: format!("{conference}/user:{}", member.user_id),
                title: member.name.clone(),
                subtitle: crate::audio::mixer::format_volume_percent(member.volume),
            },
            None => DeckDialView {
                index: index as u8,
                role: String::new(),
                title: String::new(),
                subtitle: String::new(),
            },
        })
        .collect()
}

/// Re-renders keys whose appearance (or blink phase, when blinking) changed
/// and keeps PNG copies for the web UI. Returns true when anything changed.
#[allow(clippy::too_many_arguments)]
async fn render_all(
    device: &Device,
    geometry: &Geometry,
    renderer: &Renderer,
    key_size: (u32, u32),
    keys: &[KeySpec],
    state: &DeckState,
    rendered: &mut HashMap<u8, (Appearance, bool)>,
    images: &mut HashMap<u8, (u64, Arc<Vec<u8>>)>,
) -> Result<bool> {
    let write_hardware = geometry.visual || device.is_mock();
    let mut changed = false;
    for (index, spec) in keys.iter().enumerate() {
        let key = index as u8;
        let phase = spec.appearance.blink.is_some() && state.blink_phase;
        let needs = match rendered.get(&key) {
            Some((previous, previous_phase)) => {
                *previous != spec.appearance || *previous_phase != phase
            }
            None => true,
        };
        if !needs {
            continue;
        }
        let image = renderer.key(&spec.appearance, key_size, phase);
        if let Some(png) = encode_png(&image) {
            images.insert(key, (image_hash(&image), Arc::new(png)));
        }
        if write_hardware {
            device
                .set_key(key, image)
                .await
                .context("writing key image")?;
        }
        rendered.insert(key, (spec.appearance.clone(), phase));
        changed = true;
    }
    if changed && write_hardware {
        device.flush().await.context("flushing deck")?;
    }
    Ok(changed)
}

/// Publishes the deck view (geometry, key roles and image hashes) for the web UI.
#[allow(clippy::too_many_arguments)]
fn publish_deck_view(
    bus: &Bus,
    id: usize,
    kind: Kind,
    serial: &Option<String>,
    is_mock: bool,
    geometry: &Geometry,
    key_size: (u32, u32),
    keys: &[KeySpec],
    state: &DeckState,
    snapshot: &Snapshot,
    images: &HashMap<u8, (u64, Arc<Vec<u8>>)>,
) {
    let Ok(mut hardware) = bus.hardware.write() else {
        return;
    };
    if hardware.decks.len() <= id {
        hardware.decks.resize(id + 1, DeckStatus::default());
    }
    hardware.decks[id] = DeckStatus {
        id,
        enabled: true,
        connected: true,
        mock: is_mock,
        kind: Some(format!("{kind:?}")),
        serial: serial.clone(),
        rows: geometry.rows,
        cols: geometry.cols,
        encoders: geometry.encoders,
        touchpoints: geometry.touchpoints,
        key_size: key_size.0,
        page: state.key_page(),
        pages: page_count(geometry, key_item_count(geometry, snapshot, state)),
        encoder_page: state.encoder_page,
        encoder_pages: encoder_page_count(geometry, key_item_count(geometry, snapshot, state)),
        volume_layer: state.volume_layer,
        member_layer: state.member_layer,
        menu: state.menu.map(|page| menu_label(page).to_string()),
        keys: keys
            .iter()
            .enumerate()
            .map(|(index, spec)| DeckKeyView {
                index: index as u8,
                role: role_label(spec.role),
                title: spec.appearance.title.clone(),
                subtitle: spec.appearance.subtitle.clone(),
                hash: images
                    .get(&(index as u8))
                    .map(|(hash, _)| hash.to_string())
                    .unwrap_or_else(|| "0".into()),
            })
            .collect(),
        dials: dial_views(geometry, state, snapshot),
        error: None,
    };
    hardware.deck_images.retain(|(device, _), _| *device != id);
    for (key, image) in images {
        hardware.deck_images.insert((id, *key), image.clone());
    }
}

/// What a touch-strip segment shows, for [`strip_background`].
#[derive(Clone, Copy, Default)]
struct StripState {
    /// The server connection is gone: every segment greys out.
    offline: bool,
    /// This user / member is not online (same as the greyed-out key).
    away: bool,
    talking: bool,
    locked: bool,
    listening: bool,
    muted: bool,
}

/// Segment colour on the Stream Deck + touch strip. A muted target or member
/// stays grey like the rest even while audio arrives: the red bar and MUTED
/// already say it is muted, and green would claim it can be heard. Talking
/// and a lock are our own action and still show, also on someone who is not
/// online, like their key.
fn strip_background(state: StripState) -> layout::Rgb {
    if state.offline {
        palette::OFFLINE
    } else if state.talking {
        palette::TALKING
    } else if state.locked {
        palette::LOCKED
    } else if state.away {
        palette::OFFLINE
    } else if state.listening && !state.muted {
        palette::INCOMING
    } else {
        palette::IDLE
    }
}

#[allow(clippy::too_many_arguments)]
async fn render_lcd(
    device: &Device,
    kind: Kind,
    renderer: &Renderer,
    size: (u32, u32),
    geometry: &Geometry,
    state: &DeckState,
    snapshot: &Snapshot,
    rendered: &mut Option<(Vec<StripSegment>, StripArrows)>,
) -> Result<()> {
    let offline = layout::connection_lost(snapshot);
    let segments: Vec<StripSegment> = if geometry.encoders > 0 {
        encoder_bindings(geometry, state, snapshot)
            .into_iter()
            .map(|binding| match binding {
                Some(EncoderBinding::SystemVolume(volume)) => StripSegment {
                    title: "MAIN".into(),
                    volume: volume.volume,
                    muted: volume.muted,
                    background: if volume.muted {
                        palette::MUTED
                    } else {
                        palette::CONTROL
                    },
                },
                Some(EncoderBinding::Target(target)) => StripSegment {
                    title: target.name.clone(),
                    volume: target.volume,
                    muted: target.muted,
                    background: strip_background(StripState {
                        offline,
                        away: !target.online,
                        talking: target.held,
                        locked: target.locked,
                        listening: target.incoming || target.receiving,
                        muted: target.muted,
                    }),
                },
                Some(EncoderBinding::Member { member, .. }) => StripSegment {
                    volume: member.volume,
                    title: member.name.clone(),
                    muted: member.muted,
                    background: strip_background(StripState {
                        offline,
                        away: !member.online,
                        talking: false,
                        locked: false,
                        listening: member.receiving,
                        muted: member.muted,
                    }),
                },
                None => StripSegment {
                    title: String::new(),
                    volume: 0.0,
                    muted: false,
                    background: palette::GROUND,
                },
            })
            .collect()
    } else {
        // Neo: a single status segment.
        vec![StripSegment {
            title: format!(
                "{} · {}",
                snapshot.user_name,
                snapshot
                    .tally_label()
                    .unwrap_or_else(|| snapshot.connection.label())
            ),
            volume: if snapshot.talking { 1.0 } else { 0.0 },
            muted: false,
            background: if snapshot.on_air {
                palette::ON_AIR
            } else if snapshot.preview {
                palette::PREVIEW
            } else {
                palette::STATUS_OK
            },
        }]
    };
    let arrows = strip_arrows(geometry, state, snapshot);
    if rendered.as_ref() == Some(&(segments.clone(), arrows)) {
        return Ok(());
    }
    let _ = kind;
    let mut image = renderer.strip(size, &segments);
    draw_strip_arrows(&mut image, arrows);
    device.set_lcd(image).await.context("writing LCD")?;
    *rendered = Some((segments, arrows));
    Ok(())
}

/// Which way a swipe on the strip can still go, matching the swipe handler:
/// the key pages on a Stream Deck + (dials under the keys), the dial pages
/// on a + XL once there is more than one.
fn strip_arrows(geometry: &Geometry, state: &DeckState, snapshot: &Snapshot) -> StripArrows {
    if geometry.encoders == 0 {
        return StripArrows::default();
    }
    let items = key_item_count(geometry, snapshot, state);
    let dial_pages = encoder_page_count(geometry, items);
    let (page, pages) = if geometry.encoders_follow_bottom_row() || dial_pages <= 1 {
        (state.key_page(), page_count(geometry, items))
    } else {
        (state.encoder_page, dial_pages)
    };
    let page = page.min(pages.saturating_sub(1));
    StripArrows {
        prev: pages > 1 && page > 0,
        next: pages > 1 && page + 1 < pages,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn restart_fires_at_the_deadline_without_release_and_only_once() {
        use super::{
            restart_hold_deadline, take_due_restart, Appearance, KeySpec, MenuPage, PressedKey,
            Role,
        };
        use std::{
            collections::HashMap,
            time::{Duration, Instant},
        };
        let now = Instant::now();
        let keys = vec![KeySpec {
            role: Role::Restart,
            appearance: Appearance::blank(),
        }];
        let mut pressed = HashMap::from([(
            0,
            PressedKey {
                role: Role::Restart,
                since: now,
                reselect: false,
            },
        )]);
        assert_eq!(
            restart_hold_deadline(&pressed, Some(MenuPage::Root), &keys),
            Some(now + Duration::from_secs(2))
        );
        assert!(!take_due_restart(
            &mut pressed,
            Some(MenuPage::Root),
            &keys,
            now + Duration::from_millis(1999)
        ));
        assert!(take_due_restart(
            &mut pressed,
            Some(MenuPage::Root),
            &keys,
            now + Duration::from_secs(2)
        ));
        assert!(
            pressed.is_empty(),
            "release after restart must have no remaining action"
        );
        assert!(!take_due_restart(
            &mut pressed,
            Some(MenuPage::Root),
            &keys,
            now + Duration::from_secs(3)
        ));
    }

    #[test]
    fn releasing_restart_early_cancels_its_deadline() {
        use super::{
            restart_hold_deadline, take_due_restart, Appearance, KeySpec, MenuPage, PressedKey,
            Role,
        };
        use std::{
            collections::HashMap,
            time::{Duration, Instant},
        };
        let now = Instant::now();
        let keys = vec![KeySpec {
            role: Role::Restart,
            appearance: Appearance::blank(),
        }];
        let mut pressed = HashMap::from([(
            0,
            PressedKey {
                role: Role::Restart,
                since: now,
                reselect: false,
            },
        )]);
        pressed.remove(&0); // ButtonUp before the timeout.
        assert_eq!(
            restart_hold_deadline(&pressed, Some(MenuPage::Root), &keys),
            None
        );
        assert!(!take_due_restart(
            &mut pressed,
            Some(MenuPage::Root),
            &keys,
            now + Duration::from_secs(3)
        ));
    }

    #[test]
    fn restart_requires_two_seconds_and_the_same_visible_menu_key() {
        use super::{restart_hold_confirmed, MenuPage, Role};
        use std::time::Duration;
        assert!(!restart_hold_confirmed(
            Duration::from_millis(1999),
            Some(MenuPage::Root),
            Some(Role::Restart)
        ));
        assert!(restart_hold_confirmed(
            Duration::from_secs(2),
            Some(MenuPage::Root),
            Some(Role::Restart)
        ));
        assert!(!restart_hold_confirmed(
            Duration::from_secs(3),
            None,
            Some(Role::Restart)
        ));
        assert!(!restart_hold_confirmed(
            Duration::from_secs(3),
            Some(MenuPage::Root),
            Some(Role::Empty)
        ));
        assert!(!restart_hold_confirmed(
            Duration::from_secs(3),
            Some(MenuPage::Info),
            Some(Role::Restart)
        ));
    }

    use super::{
        dial_hold_action, effective_key_size, geometry_for, kind_from_name, lcd_logical_size,
        local_ip_towards, palette, strip_arrows, strip_background, BoundEncoder, DeckState,
        DialHold, Kind, Snapshot, StripArrows, StripState,
    };
    use crate::state::TargetInfo;

    fn with_targets(count: usize) -> Snapshot {
        let mut snapshot = Snapshot::initial("cam1", "Cam 1");
        snapshot.targets = (0..count)
            .map(|i| TargetInfo {
                key: TargetKey::User(i as i64),
                name: format!("T{i}"),
                can_talk: true,
                online: true,
                held: false,
                locked: false,
                incoming: false,
                receiving: false,
                volume: 0.9,
                muted: false,
                members: Vec::new(),
            })
            .collect();
        snapshot
    }

    #[test]
    fn strip_arrows_point_to_the_pages_a_swipe_reaches() {
        let both = StripArrows {
            prev: true,
            next: true,
        };
        let next = StripArrows {
            prev: false,
            next: true,
        };
        let prev = StripArrows {
            prev: true,
            next: false,
        };
        // Stream Deck +: four keys per page, the swipe pages the keys.
        let plus = geometry_for(Kind::Plus);
        let snapshot = with_targets(10);
        let mut state = DeckState::default();
        assert_eq!(strip_arrows(&plus, &state, &snapshot), next);
        state.page = 1;
        assert_eq!(strip_arrows(&plus, &state, &snapshot), both);
        state.page = 2;
        assert_eq!(strip_arrows(&plus, &state, &snapshot), prev);
        // Everything on one page: no arrow.
        let one = with_targets(3);
        assert_eq!(
            strip_arrows(&plus, &DeckState::default(), &one),
            StripArrows::default()
        );
        // Stream Deck + XL: six dials, the swipe pages the dials.
        let plus_xl = geometry_for(Kind::PlusXl);
        let mut state = DeckState::default();
        assert_eq!(strip_arrows(&plus_xl, &state, &snapshot), next);
        state.encoder_page = 1;
        assert_eq!(strip_arrows(&plus_xl, &state, &snapshot), prev);
        // Decks without a strip never get arrows.
        let mk2 = geometry_for(Kind::Mk2);
        assert_eq!(
            strip_arrows(&mk2, &DeckState::default(), &snapshot),
            StripArrows::default()
        );
    }
    use crate::talk::TargetKey;

    #[test]
    fn a_muted_strip_segment_is_grey_not_green() {
        let listening = StripState {
            listening: true,
            ..StripState::default()
        };
        assert_eq!(strip_background(listening), palette::INCOMING);
        // A muted PGM feed (or member) that still receives audio: grey.
        let muted = StripState {
            muted: true,
            ..listening
        };
        assert_eq!(strip_background(muted), palette::IDLE);
        assert_eq!(strip_background(StripState::default()), palette::IDLE);
        // Our own talk and locks still show on a muted target.
        let talking = StripState {
            talking: true,
            ..muted
        };
        assert_eq!(strip_background(talking), palette::TALKING);
        let offline = StripState {
            offline: true,
            ..talking
        };
        assert_eq!(strip_background(offline), palette::OFFLINE);
    }

    #[test]
    fn an_offline_user_greys_out_on_the_strip_like_the_key() {
        let away = StripState {
            away: true,
            listening: true,
            ..StripState::default()
        };
        assert_eq!(strip_background(away), palette::OFFLINE);
        // Holding talk to someone who is offline still shows, as on the key.
        let talking = StripState {
            talking: true,
            ..away
        };
        assert_eq!(strip_background(talking), palette::TALKING);
    }

    #[test]
    fn holding_a_dial_opens_and_leaves_the_member_mix() {
        let conference = TargetKey::Conference(2);
        assert_eq!(
            dial_hold_action(false, Some(BoundEncoder::Target(conference))),
            DialHold::OpenMembers(conference)
        );
        assert_eq!(
            dial_hold_action(false, Some(BoundEncoder::Target(TargetKey::User(3)))),
            DialHold::Nothing
        );
        assert_eq!(dial_hold_action(false, None), DialHold::Nothing);
        // In the member mix any dial, bound to a member or not, leaves it.
        let member = BoundEncoder::Member {
            conference,
            user_id: 7,
        };
        assert_eq!(dial_hold_action(true, Some(member)), DialHold::CloseMembers);
        assert_eq!(dial_hold_action(true, None), DialHold::CloseMembers);
    }

    #[tokio::test]
    async fn local_ip_uses_the_route_to_the_server() {
        assert_eq!(
            local_ip_towards("https://127.0.0.1:8443").await.as_deref(),
            Some("127.0.0.1")
        );
    }

    #[test]
    fn plus_xl_uses_elgato_sizes_not_the_library_ones() {
        assert_eq!(effective_key_size(Kind::PlusXl), (112, 112));
        assert_eq!(lcd_logical_size(Kind::PlusXl), Some((1200, 100)));
        // Other models keep the library values.
        assert_eq!(effective_key_size(Kind::Plus), (120, 120));
        assert_eq!(lcd_logical_size(Kind::Plus), Some((800, 100)));
        assert_eq!(lcd_logical_size(Kind::Mk2), None);
    }

    #[test]
    fn kind_from_name_accepts_config_models() {
        for name in [
            "original",
            "originalv2",
            "v2",
            "mini",
            "minimk2",
            "mk2",
            "xl",
            "xlv2",
            "plus",
            "plusxl",
            "neo",
            "pedal",
            "MK-2",
            "Plus XL",
        ] {
            assert!(kind_from_name(name).is_some(), "{name}");
        }
        assert!(kind_from_name("nope").is_none());
        assert!(kind_from_name("").is_none());
    }

    #[test]
    fn parse_demo_targets_names_kinds() {
        let targets = super::parse_demo_targets("adi,conference:News,feed:Virus,beni");
        assert_eq!(targets.len(), 4);
        assert_eq!(targets[0].key, crate::talk::TargetKey::User(1));
        assert_eq!(targets[0].name, "adi");
        assert_eq!(targets[1].key, crate::talk::TargetKey::Conference(1));
        assert_eq!(targets[1].name, "News");
        assert_eq!(targets[2].key, crate::talk::TargetKey::Feed(1));
        assert!(!targets[2].can_talk);
        assert_eq!(targets[3].name, "beni");
        assert_eq!(targets[1].members.len(), 3);
        assert_eq!(targets[1].members[0].name, "Adi");
        assert!(targets[0].members.is_empty());
    }

    #[test]
    fn layout_json_pins_pedal_switches_and_ignores_other_indexes() {
        use crate::config::StreamDeckDeviceConfig;
        use crate::talk::TargetKey;
        use std::collections::BTreeMap;

        let mut device = StreamDeckDeviceConfig {
            pedal_left: Some("user:9".into()),
            pedal_target: Some("feed:2".into()),
            layout: BTreeMap::from([
                ("0".into(), "user:4".into()),
                ("1".into(), "conference:1".into()),
                ("5".into(), "user:1".into()),
            ]),
            ..StreamDeckDeviceConfig::default()
        };
        let options = super::layout_options(&device);
        assert_eq!(options.pedal_left, Some(TargetKey::User(4)));
        assert_eq!(options.pedal_middle, Some(TargetKey::Conference(1)));

        device.layout.clear();
        let options = super::layout_options(&device);
        assert_eq!(options.pedal_left, Some(TargetKey::User(9)));
        assert_eq!(options.pedal_middle, Some(TargetKey::Feed(2)));

        device.layout.insert("0".into(), "not-a-target".into());
        let options = super::layout_options(&device);
        assert_eq!(options.pedal_left, Some(TargetKey::User(9)));
    }
}
