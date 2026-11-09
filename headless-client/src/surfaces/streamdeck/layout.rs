//! Pure key-layout logic for every Stream Deck geometry: which key does what
//! and how it should look, given the current snapshot and deck-local state.

use std::time::{Duration, Instant};

use crate::audio::mixer::format_volume_db;
use crate::state::{ConferenceMemberInfo, ConnectionState, ProductionInfo, Snapshot, TargetInfo};
use crate::talk::TargetKey;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Geometry {
    pub keys: u8,
    pub rows: u8,
    pub cols: u8,
    pub encoders: u8,
    pub touchpoints: u8,
    pub visual: bool,
}

impl Geometry {
    /// Stream Deck +: dials sit under the bottom row of keys, one per column.
    pub fn encoders_follow_bottom_row(&self) -> bool {
        self.encoders > 0 && self.encoders == self.cols && self.rows >= 2
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb(pub u8, pub u8, pub u8);

/// Key colours, taken from the web client (Tailwind slate scheme). Each
/// colour is a role: the renderer picks the key style (card, control,
/// tinted state, solid tally) from it, see `render::style`.
pub mod palette {
    use super::Rgb;
    /// Page background (`#0b1120`): empty keys and the gap around cards.
    pub const GROUND: Rgb = Rgb(11, 17, 32);
    /// Target card (`#1f2937`).
    pub const IDLE: Rgb = Rgb(31, 41, 55);
    /// Status key at rest (`#1e293b`).
    pub const STATUS_OK: Rgb = Rgb(30, 41, 59);
    /// Function keys (status, VOL, MEMBERS, NEXT, MUTE, − / +, CLEAR):
    /// hollow, nearly page-dark (`#0f172a`) with a light outline. The rule
    /// on the deck: an outline marks a function, a filled card is intercom.
    pub const CONTROL: Rgb = Rgb(15, 23, 42);
    /// Outline of function keys (`#64748b`).
    pub const OUTLINE: Rgb = Rgb(100, 116, 139);
    /// Offline intercom key (`.is-offline`): a dimmed card, no outline, so
    /// it does not read as a function key.
    pub const OFFLINE: Rgb = Rgb(20, 27, 42);
    pub const IDLE_TEXT: Rgb = Rgb(226, 232, 240);
    /// Secondary text (`#94a3b8`).
    pub const SUBTEXT: Rgb = Rgb(148, 163, 184);
    pub const OFFLINE_TEXT: Rgb = Rgb(100, 116, 139);
    /// Web client `.talking-to` (`#8b5cf6`).
    pub const TALKING: Rgb = Rgb(139, 92, 246);
    /// Talk lock: darker violet (`#6d28d9`) plus the lock badge.
    pub const LOCKED: Rgb = Rgb(109, 40, 217);
    /// Web client `.speaking` / incoming audio (`#22c55e`).
    pub const INCOMING: Rgb = Rgb(34, 197, 94);
    pub const RECEIVING: Rgb = INCOMING;
    /// Web client muted icon (`#ef4444`).
    pub const MUTED: Rgb = Rgb(239, 68, 68);
    /// Menu navigation: MENU / back, menu entries, current choice
    /// (`#06b6d4`). No other key uses cyan, so an open menu is obvious.
    pub const MENU: Rgb = Rgb(6, 182, 212);
    /// Entries listed inside the menu: dark key with a cyan outline.
    pub const MENU_ITEM: Rgb = Rgb(18, 36, 50);
    pub const MENU_OUTLINE: Rgb = Rgb(14, 116, 144);
    /// Reply: the web client's reply button blue two steps darker
    /// (`#1e40af`), drawn solid, so it does not outshine state keys.
    pub const REPLY: Rgb = Rgb(30, 64, 175);
    /// Selection and active layer (`#3b82f6`).
    pub const SELECTED: Rgb = Rgb(59, 130, 246);
    /// Persistent server failure (`#ef4444`).
    pub const SERVER_UNAVAILABLE: Rgb = Rgb(239, 68, 68);
    /// Other connection/media warnings (`#f59e0b`).
    pub const STATUS_BAD: Rgb = Rgb(245, 158, 11);
    /// Web client program tally (`#e00000`).
    pub const ON_AIR: Rgb = Rgb(224, 0, 0);
    /// Reply key while the microphone is live; a deeper red than ON AIR so
    /// the two do not read as the same signal.
    pub const MIC_ON: Rgb = Rgb(185, 28, 28);
    /// Web client preview tally (`#00875a`).
    pub const PREVIEW: Rgb = Rgb(0, 135, 90);
    pub const WHITE: Rgb = Rgb(255, 255, 255);
    /// Volume bar fill (`#60a5fa`) and track (`#334155`).
    pub const BAR: Rgb = Rgb(96, 165, 250);
    pub const BAR_TRACK: Rgb = Rgb(51, 65, 85);
    /// Target type dots, like the web client's round target icons:
    /// user `#446cc2`, conference `#4f9b8b`, feed (slate, a step lighter
    /// than the web `#475569` so it reads on a card).
    pub const USER_DOT: Rgb = Rgb(68, 108, 194);
    pub const CONFERENCE_DOT: Rgb = Rgb(79, 155, 139);
    pub const FEED_DOT: Rgb = Rgb(100, 116, 139);
    /// Listen-only conference: the admin UI's listen-only orange (`#f97316`)
    /// toned down to sit with the other dots.
    pub const LISTEN_ONLY_DOT: Rgb = Rgb(194, 96, 46);
    /// Lock badge (`#fbbf24`).
    pub const LOCK: Rgb = Rgb(251, 191, 36);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Badge {
    Lock,
    Muted,
    OnAir,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Appearance {
    pub title: String,
    pub subtitle: String,
    pub background: Rgb,
    pub foreground: Rgb,
    /// 0..1 bar along the bottom (volume) when present.
    pub bar: Option<f32>,
    pub badge: Option<Badge>,
    /// Blinks between background and this colour when set.
    pub blink: Option<Rgb>,
    /// Target type dot at the start of the status row.
    pub marker: Option<Rgb>,
    /// Small label in the status row (MENU, back, close).
    pub footer: String,
    /// Subtitle sits at the bottom, right above the status row.
    pub subtitle_low: bool,
}

impl Appearance {
    fn simple(title: &str, background: Rgb) -> Self {
        Self {
            title: title.to_string(),
            subtitle: String::new(),
            background,
            foreground: palette::IDLE_TEXT,
            bar: None,
            badge: None,
            blink: None,
            marker: None,
            footer: String::new(),
            subtitle_low: false,
        }
    }

    pub fn blank() -> Self {
        Self::simple("", palette::GROUND)
    }

    /// Dark grey like an offline user: no state colour, bar or badge.
    fn go_offline(&mut self) {
        self.background = palette::OFFLINE;
        self.foreground = palette::OFFLINE_TEXT;
        self.blink = None;
        self.badge = None;
        self.bar = None;
        if self.marker.is_some() {
            self.marker = Some(palette::OFFLINE_TEXT);
        }
    }
}

/// No usable server connection: every key but the status key goes grey.
pub fn connection_lost(snapshot: &Snapshot) -> bool {
    snapshot.connection != ConnectionState::Ready || snapshot.server_not_responding
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Status,
    Reply,
    Target(TargetKey),
    Member {
        conference: TargetKey,
        user_id: i64,
    },
    NextPage,
    NextEncoderPage,
    VolumeToggle,
    MembersToggle,
    VolumeUp,
    VolumeDown,
    MuteSelected,
    SystemVolume,
    /// Index into `Snapshot::productions` on the production page.
    Production(usize),
    ClearLocks,
    Restart,
    /// A menu entry that opens one of the menu's sub-pages.
    Menu(MenuPage),
    /// Index into `info_lines` on the info page (read-only).
    Info(usize),
    Empty,
}

/// Pages of the menu opened from the status key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuPage {
    /// Entries: Production, Clear locks, Info.
    Root,
    Productions,
    Info,
}

/// Root menu entries, in key order; they sit together on the target keys.
/// A 3-column deck keeps NEXT in its command row, so VOLUME moves in here.
fn menu_entries(geometry: &Geometry) -> Vec<Role> {
    let mut entries = Vec::with_capacity(4);
    if volume_in_menu(geometry) {
        entries.push(Role::VolumeToggle);
    }
    entries.extend([
        Role::Menu(MenuPage::Productions),
        Role::ClearLocks,
        Role::Menu(MenuPage::Info),
        Role::Restart,
    ]);
    entries
}

/// Stream Deck Mini: three command keys hold status, NEXT and Reply, so VOL
/// lives in the menu and the volume layer shows − / + / NEXT.
pub fn volume_in_menu(geometry: &Geometry) -> bool {
    geometry.visual && geometry.cols < 4
}

/// What a Stream Deck + / + XL encoder currently controls.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EncoderBinding<'a> {
    SystemVolume(&'a crate::audio::system_volume::SystemVolume),
    Target(&'a TargetInfo),
    Member {
        conference: TargetKey,
        member: &'a ConferenceMemberInfo,
    },
}

/// Stream Deck + and + XL: the dials sit under an LCD touch strip.
fn has_touch_strip(geometry: &Geometry) -> bool {
    geometry.encoders > 0
}

/// Decks whose command row still has a spare cell after Status, VOL, Reply
/// and any paging keys (MK.2 / Original / XL / Plus XL).
pub fn has_members_command_key(geometry: &Geometry) -> bool {
    geometry.visual && geometry.cols >= 5
}

/// Neo / Mini / Plus have no MEMBERS key; VOL long-press opens the member layer.
pub fn volume_toggle_defers_to_release(geometry: &Geometry) -> bool {
    geometry.visual && !has_members_command_key(geometry)
}

#[derive(Debug, Clone, PartialEq)]
pub struct KeySpec {
    pub role: Role,
    pub appearance: Appearance,
}

/// Deck-local interaction state (not part of the shared snapshot).
#[derive(Debug, Clone)]
pub struct DeckState {
    pub system_volume_selected: bool,
    pub page: usize,
    pub encoder_page: usize,
    pub volume_layer: bool,
    pub volume_layer_touched: Instant,
    pub member_layer: bool,
    pub member_layer_touched: Instant,
    pub member_conference: Option<TargetKey>,
    pub member_selected: Option<i64>,
    pub member_page: usize,
    /// Menu opened from the status key; `None` while the targets show.
    pub menu: Option<MenuPage>,
    pub menu_touched: Instant,
    pub menu_page: usize,
    /// Local address towards the server, looked up when the info page opens.
    pub local_ip: Option<String>,
    pub selected: Option<TargetKey>,
    pub blink_phase: bool,
    /// Listen-only conference that was pressed; its key reads LISTEN ONLY
    /// until `LISTEN_ONLY_NOTICE` has passed.
    pub listen_only_notice: Option<(TargetKey, Instant)>,
}

/// How long a pressed listen-only conference shows LISTEN ONLY.
pub const LISTEN_ONLY_NOTICE: Duration = Duration::from_secs(4);

impl Default for DeckState {
    fn default() -> Self {
        Self {
            system_volume_selected: false,
            page: 0,
            encoder_page: 0,
            volume_layer: false,
            volume_layer_touched: Instant::now(),
            member_layer: false,
            member_layer_touched: Instant::now(),
            member_conference: None,
            member_selected: None,
            member_page: 0,
            menu: None,
            menu_touched: Instant::now(),
            menu_page: 0,
            local_ip: None,
            selected: None,
            blink_phase: false,
            listen_only_notice: None,
        }
    }
}

impl DeckState {
    pub fn touch_volume_layer(&mut self) {
        self.volume_layer_touched = Instant::now();
    }

    pub fn touch_member_layer(&mut self) {
        self.member_layer_touched = Instant::now();
    }

    pub fn close_volume_layer(&mut self) {
        self.volume_layer = false;
    }

    pub fn close_member_layer(&mut self) {
        self.member_layer = false;
    }

    pub fn show_listen_only(&mut self, target: TargetKey) {
        self.listen_only_notice = Some((target, Instant::now()));
    }

    pub fn expire_listen_only(&mut self, after: Duration) -> bool {
        if self
            .listen_only_notice
            .is_some_and(|(_, since)| since.elapsed() >= after)
        {
            self.listen_only_notice = None;
            return true;
        }
        false
    }

    pub fn expire_volume_layer(&mut self, timeout: Duration) -> bool {
        if self.volume_layer && self.volume_layer_touched.elapsed() >= timeout {
            self.close_volume_layer();
            return true;
        }
        false
    }

    pub fn expire_member_layer(&mut self, timeout: Duration) -> bool {
        if self.member_layer && self.member_layer_touched.elapsed() >= timeout {
            self.close_member_layer();
            return true;
        }
        false
    }

    /// Opens a menu page on its first key page; the other layers close.
    pub fn open_menu(&mut self, page: MenuPage) {
        self.close_volume_layer();
        self.close_member_layer();
        self.menu = Some(page);
        self.menu_page = 0;
        self.menu_touched = Instant::now();
    }

    pub fn close_menu(&mut self) {
        self.menu = None;
    }

    /// Status tap inside the menu: a sub-page goes back to the root, the root closes.
    pub fn menu_back(&mut self) {
        match self.menu {
            Some(MenuPage::Root) | None => self.close_menu(),
            Some(_) => self.open_menu(MenuPage::Root),
        }
    }

    pub fn expire_menu(&mut self, timeout: Duration) -> bool {
        if self.menu.is_some() && self.menu_touched.elapsed() >= timeout {
            self.close_menu();
            return true;
        }
        false
    }

    /// Key page of whatever the target keys currently show.
    pub fn key_page(&self) -> usize {
        if self.menu.is_some() {
            self.menu_page
        } else if self.member_layer {
            self.member_page
        } else {
            self.page
        }
    }

    pub fn key_page_mut(&mut self) -> &mut usize {
        if self.menu.is_some() {
            &mut self.menu_page
        } else if self.member_layer {
            &mut self.member_page
        } else {
            &mut self.page
        }
    }

    /// Keeps an open menu, member or volume layer from timing out.
    pub fn touch_layer(&mut self) {
        if self.menu.is_some() {
            self.menu_touched = Instant::now();
        } else if self.member_layer {
            self.touch_member_layer();
        } else if self.volume_layer {
            self.touch_volume_layer();
        }
    }

    pub fn toggle_volume_layer(&mut self, snapshot: &Snapshot) {
        if self.volume_layer {
            self.close_volume_layer();
            return;
        }
        self.close_member_layer();
        self.close_menu();
        self.volume_layer = true;
        self.system_volume_selected = snapshot.system_volume.is_some();
        self.touch_volume_layer();
        if self.selected.is_none() {
            self.selected = snapshot.targets.first().map(|t| t.key);
        }
    }

    /// Opens or closes the member layer. Returns whether the layout changed.
    pub fn toggle_member_layer(
        &mut self,
        snapshot: &Snapshot,
        preferred: Option<TargetKey>,
    ) -> bool {
        if self.member_layer {
            self.close_member_layer();
            return true;
        }
        self.open_member_layer(snapshot, preferred)
    }

    /// Enters the member layer for `preferred` or a default conference.
    pub fn open_member_layer(&mut self, snapshot: &Snapshot, preferred: Option<TargetKey>) -> bool {
        let Some(conference) =
            default_member_conference(snapshot, preferred.or(self.member_conference))
        else {
            return false;
        };
        let members = conference_members(snapshot, conference);
        let keep_selection = self.member_conference == Some(conference)
            && self
                .member_selected
                .is_some_and(|id| members.iter().any(|member| member.user_id == id));
        self.close_volume_layer();
        self.close_menu();
        self.member_layer = true;
        self.member_conference = Some(conference);
        if !keep_selection {
            self.member_selected = members.first().map(|member| member.user_id);
            self.member_page = 0;
        }
        self.encoder_page = 0;
        self.touch_member_layer();
        true
    }

    pub fn clamp_pages(&mut self, geometry: &Geometry, snapshot: &Snapshot) {
        if snapshot.system_volume.is_none() {
            self.system_volume_selected = false;
        }
        let target_count = volume_roles(snapshot, self).len();
        let pages = page_count(geometry, target_count);
        self.page = self.page.min(pages.saturating_sub(1));
        let member_count = self
            .member_conference
            .and_then(|key| snapshot.target(key))
            .map(|target| target.members.len())
            .unwrap_or(0);
        let member_pages = page_count(geometry, member_count);
        self.member_page = self.member_page.min(member_pages.saturating_sub(1));
        let encoder_count = if self.member_layer {
            member_count
        } else {
            target_count
        };
        let encoder_pages = encoder_page_count(geometry, encoder_count);
        self.encoder_page = self.encoder_page.min(encoder_pages.saturating_sub(1));
        if let Some(menu) = self.menu {
            let menu_pages = page_count(geometry, menu_item_count(geometry, snapshot, menu));
            self.menu_page = self.menu_page.min(menu_pages.saturating_sub(1));
        }
    }
}

/// Conference whose members the layer should show when none is named.
pub fn default_member_conference(
    snapshot: &Snapshot,
    preferred: Option<TargetKey>,
) -> Option<TargetKey> {
    let is_conference = |key: TargetKey| matches!(key, TargetKey::Conference(_));
    if let Some(key) = preferred.filter(|key| is_conference(*key)) {
        if snapshot.target(key).is_some() {
            return Some(key);
        }
    }
    snapshot
        .targets
        .iter()
        .find(|target| is_conference(target.key) && (target.held || target.locked))
        .map(|target| target.key)
        .or_else(|| snapshot.reply_target.filter(|key| is_conference(*key)))
        .or_else(|| {
            snapshot
                .targets
                .iter()
                .find(|target| is_conference(target.key) && !target.members.is_empty())
                .map(|target| target.key)
        })
        .or_else(|| {
            snapshot
                .targets
                .iter()
                .find(|target| is_conference(target.key))
                .map(|target| target.key)
        })
}

pub fn conference_members(snapshot: &Snapshot, conference: TargetKey) -> &[ConferenceMemberInfo] {
    snapshot
        .target(conference)
        .map(|target| target.members.as_slice())
        .unwrap_or(&[])
}

/// Pedal assignments from configuration (`layout` JSON `"0"` / `"1"`, or the
/// `pedal_left` / `pedal_target` fields). Visual decks ignore this.
#[derive(Debug, Clone, Default)]
pub struct LayoutOptions {
    pub pedal_left: Option<TargetKey>,
    pub pedal_middle: Option<TargetKey>,
}

/// Target key indices in reading order: left to right, top to bottom, never the
/// command row. Length is the page capacity.
pub fn target_slots(geometry: &Geometry) -> Vec<u8> {
    if !geometry.visual || geometry.rows <= 1 || geometry.cols == 0 {
        return Vec::new();
    }
    let cols = geometry.cols as usize;
    let rows = geometry.rows as usize;
    let mut slots = Vec::with_capacity((rows - 1) * cols);
    for row in 1..rows {
        for col in 0..cols {
            let index = row * cols + col;
            if index < geometry.keys as usize {
                slots.push(index as u8);
            }
        }
    }
    slots
}

/// Place `item_count` items left to right, then top to bottom, starting on
/// the row under the command row; unused keys stay at the bottom.
pub fn occupied_target_slots(geometry: &Geometry, item_count: usize) -> Vec<u8> {
    target_slots(geometry)
        .into_iter()
        .take(item_count)
        .collect()
}

/// Items sitting on the physical bottom key row, one per encoder (Stream Deck +).
fn bottom_row_items<T: Copy>(geometry: &Geometry, shown: &[T]) -> Vec<Option<T>> {
    let slots = occupied_target_slots(geometry, shown.len());
    let cols = geometry.cols as usize;
    let bottom_start = (geometry.rows.saturating_sub(1) as usize) * cols;
    (0..geometry.encoders as usize)
        .map(|index| {
            let key = (bottom_start + index) as u8;
            slots
                .iter()
                .position(|&slot| slot == key)
                .and_then(|pos| shown.get(pos).copied())
        })
        .collect()
}

pub fn page_count(geometry: &Geometry, target_count: usize) -> usize {
    let slots = target_slots(geometry).len();
    if slots == 0 {
        return 1;
    }
    target_count.div_ceil(slots).max(1)
}

/// Separate dial pages on models whose encoders are not in line with a key row.
pub fn encoder_page_count(geometry: &Geometry, target_count: usize) -> usize {
    if geometry.encoders == 0 || geometry.encoders_follow_bottom_row() {
        return 1;
    }
    target_count.div_ceil(geometry.encoders as usize).max(1)
}

/// Targets shown on the current key page, in admin order (assigned LTR/TTB
/// onto bottom-justified rows).
pub fn page_targets<'a>(
    geometry: &Geometry,
    state: &DeckState,
    targets: &'a [TargetInfo],
) -> Vec<&'a TargetInfo> {
    let slots = target_slots(geometry);
    let per_page = slots.len().max(1);
    let pages = page_count(geometry, targets.len());
    let page = state.page.min(pages.saturating_sub(1));
    targets
        .iter()
        .skip(page * per_page)
        .take(per_page)
        .collect()
}

/// Conference members shown on the current member page, in list order.
pub fn page_members<'a>(
    geometry: &Geometry,
    state: &DeckState,
    members: &'a [ConferenceMemberInfo],
) -> Vec<&'a ConferenceMemberInfo> {
    let slots = target_slots(geometry);
    let per_page = slots.len().max(1);
    let pages = page_count(geometry, members.len());
    let page = state.member_page.min(pages.saturating_sub(1));
    members
        .iter()
        .skip(page * per_page)
        .take(per_page)
        .collect()
}

/// Number of keys a menu page lists.
pub fn menu_item_count(geometry: &Geometry, snapshot: &Snapshot, menu: MenuPage) -> usize {
    match menu {
        MenuPage::Root => menu_entries(geometry).len(),
        MenuPage::Productions => snapshot.productions.len(),
        MenuPage::Info => info_lines(snapshot, None).len(),
    }
}

/// One read-only key on the info page.
#[derive(Debug, Clone, PartialEq)]
pub struct InfoLine {
    pub title: &'static str,
    pub value: String,
    pub ok: bool,
}

/// Info page rows, most useful first so a small deck shows them on page 1.
pub fn info_lines(snapshot: &Snapshot, local_ip: Option<&str>) -> Vec<InfoLine> {
    let line = |title, value: String, ok| InfoLine { title, value, ok };
    let media = snapshot.media.as_ref();
    let rtt = media.and_then(|media| media.rtt_ms);
    let loss = media.and_then(|media| media.packet_loss_pct);
    let host = snapshot
        .server_url
        .split("://")
        .last()
        .unwrap_or_default()
        .trim_end_matches('/')
        .to_string();
    vec![
        line(
            "RTT",
            rtt.map(|ms| format!("{ms} ms"))
                .unwrap_or_else(|| "–".into()),
            rtt.is_none_or(|ms| ms < 250),
        ),
        line(
            "LOSS",
            loss.map(|pct| format!("{pct:.1} %"))
                .unwrap_or_else(|| "–".into()),
            loss.is_none_or(|pct| pct < 2.0),
        ),
        line(
            "SERVER",
            if host.is_empty() { "–".into() } else { host },
            true,
        ),
        line(
            "VERSION",
            format!(
                "{} / {}",
                crate::VERSION,
                snapshot.server_version.as_deref().unwrap_or("–")
            ),
            true,
        ),
        line("IP", local_ip.unwrap_or("–").to_string(), true),
    ]
}

/// Items shown on the current menu page as (index, item).
fn page_items<'a, T>(
    geometry: &Geometry,
    state: &DeckState,
    items: &'a [T],
) -> Vec<(usize, &'a T)> {
    let per_page = target_slots(geometry).len().max(1);
    let pages = page_count(geometry, items.len());
    let page = state.menu_page.min(pages.saturating_sub(1));
    items
        .iter()
        .enumerate()
        .skip(page * per_page)
        .take(per_page)
        .collect()
}

/// Productions shown on the current production page.
pub fn page_productions<'a>(
    geometry: &Geometry,
    state: &DeckState,
    productions: &'a [ProductionInfo],
) -> Vec<(usize, &'a ProductionInfo)> {
    page_items(geometry, state, productions)
}

fn layer_page_counts(
    geometry: &Geometry,
    snapshot: &Snapshot,
    state: &DeckState,
) -> (usize, usize) {
    if let Some(menu) = state.menu {
        (
            page_count(geometry, menu_item_count(geometry, snapshot, menu)),
            1,
        )
    } else if state.member_layer {
        let count = state
            .member_conference
            .map(|key| conference_members(snapshot, key).len())
            .unwrap_or(0);
        (
            page_count(geometry, count),
            encoder_page_count(geometry, count),
        )
    } else {
        (
            page_count(geometry, volume_roles(snapshot, state).len()),
            encoder_page_count(geometry, volume_roles(snapshot, state).len()),
        )
    }
}

/// Command-row roles for the current layer. Targets never appear here.
fn command_roles(
    geometry: &Geometry,
    state: &DeckState,
    key_pages: usize,
    encoder_pages: usize,
) -> Vec<(u8, Role)> {
    if !geometry.visual || geometry.cols == 0 {
        return Vec::new();
    }
    let cols = geometry.cols as usize;
    let mut row: Vec<Option<Role>> = vec![None; cols];

    let idle_pagers = |row: &mut [Option<Role>]| {
        row[0] = Some(Role::Status);
        row[cols - 1] = Some(Role::Reply);
        if volume_in_menu(geometry) {
            // Mini: status, NEXT, Reply; VOL is a menu entry.
            if key_pages > 1 && cols > 2 {
                row[1] = Some(Role::NextPage);
            }
            return;
        }
        if cols > 1 {
            row[1] = Some(Role::VolumeToggle);
        }
        let mut cursor = cols.saturating_sub(2);
        if key_pages > 1 && cursor > 1 {
            row[cursor] = Some(Role::NextPage);
            cursor = cursor.saturating_sub(1);
        }
        // Decks with dials have a touch strip: a swipe pages the dials, so a
        // DIALS key would only take a command cell.
        let dial_key = encoder_pages > 1 && !has_touch_strip(geometry);
        if dial_key && cursor > 1 {
            row[cursor] = Some(Role::NextEncoderPage);
        }
        if has_members_command_key(geometry) {
            if let Some(index) = row.iter().position(|cell| cell.is_none()) {
                row[index] = Some(Role::MembersToggle);
            }
        }
    };

    let overlay = |row: &mut [Option<Role>], toggle: Role| {
        // Mini: − / + / NEXT. The layer closes on its timeout or when the
        // selected target or member is tapped again; holding one mutes it.
        if volume_in_menu(geometry) {
            row[0] = Some(Role::VolumeDown);
            if cols > 1 {
                row[1] = Some(Role::VolumeUp);
            }
            if key_pages > 1 && cols > 2 {
                row[2] = Some(Role::NextPage);
            }
            return;
        }
        let controls = [toggle, Role::MuteSelected, Role::VolumeDown, Role::VolumeUp];
        for (index, role) in controls.iter().enumerate() {
            if index < cols {
                row[index] = Some(*role);
            }
        }
        if cols > 4 {
            let mut idle = vec![None; cols];
            idle_pagers(&mut idle);
            for (index, role) in idle.into_iter().enumerate().skip(4) {
                if row[index].is_none() {
                    row[index] = role;
                }
            }
        }
        // The controls cover the NEXT slot of the idle row on 4-5 column
        // decks. Reply gives way where there is one; on 4 columns MUTE does
        // (holding a target or member still mutes it).
        if key_pages > 1 && !row.contains(&Some(Role::NextPage)) {
            let slot = if cols > 4 { cols - 1 } else { 1 };
            row[slot] = Some(Role::NextPage);
        }
    };

    if state.menu.is_some() {
        // Menu pages are pages of their own: status = back, paging; nothing else.
        row[0] = Some(Role::Status);
        if key_pages > 1 && cols > 1 {
            row[cols - 1] = Some(Role::NextPage);
        }
    } else if state.member_layer {
        overlay(&mut row, Role::MembersToggle);
    } else if state.volume_layer {
        overlay(&mut row, Role::VolumeToggle);
    } else {
        idle_pagers(&mut row);
    }

    row.into_iter()
        .enumerate()
        .filter_map(|(index, role)| role.map(|role| (index as u8, role)))
        .collect()
}

fn member_appearance(member: &ConferenceMemberInfo, state: &DeckState) -> Appearance {
    let mut appearance = Appearance::simple(&member.name, palette::IDLE);
    appearance.subtitle = format_volume_db(member.volume);
    appearance.bar = Some(member.volume);
    if state.member_selected == Some(member.user_id) {
        appearance.background = palette::SELECTED;
    }
    if !member.online {
        appearance.foreground = palette::OFFLINE_TEXT;
        if state.member_selected != Some(member.user_id) {
            appearance.background = palette::OFFLINE;
        }
    }
    if member.receiving {
        appearance.background = palette::RECEIVING;
        if state.member_selected == Some(member.user_id) {
            appearance.background = palette::SELECTED;
        }
    }
    if member.muted {
        appearance.badge = Some(Badge::Muted);
        if state.member_selected != Some(member.user_id) {
            appearance.background = palette::MUTED;
        }
    }
    appearance
}

fn target_appearance(target: &TargetInfo, state: &DeckState, snapshot: &Snapshot) -> Appearance {
    let volume_label = format_volume_db(target.volume);
    let mut appearance = Appearance::simple(&target.name, palette::IDLE);
    if state.volume_layer {
        appearance.background =
            if !state.system_volume_selected && state.selected == Some(target.key) {
                palette::SELECTED
            } else {
                palette::IDLE
            };
        appearance.subtitle = volume_label;
        appearance.bar = Some(target.volume);
        if target.muted {
            appearance.badge = Some(Badge::Muted);
        }
        return appearance;
    }
    if !target.online {
        appearance.background = palette::OFFLINE;
        appearance.foreground = palette::OFFLINE_TEXT;
    }
    apply_talk_and_listen(
        &mut appearance,
        target.held,
        target.locked,
        target.incoming,
        target.receiving,
        palette::IDLE,
    );
    // Listen-only keys (feeds and listen-only conferences) show their level
    // as a bar; the dB readout only appears on the volume layer.
    let listen_only_conference = !target.can_talk && matches!(target.key, TargetKey::Conference(_));
    if !target.can_talk && !listen_only_conference {
        appearance.bar = Some(target.volume);
    }
    if state
        .listen_only_notice
        .is_some_and(|(key, _)| key == target.key)
    {
        appearance.subtitle = "LISTEN ONLY".into();
    }
    // Muted reads the same on every target. Talk keys still show talking
    // and incoming over it; a listen-only key has nothing else to show.
    if target.muted {
        appearance.badge = Some(Badge::Muted);
        if appearance.background == palette::IDLE || !target.can_talk {
            appearance.background = palette::MUTED;
            appearance.blink = None;
        }
    }
    appearance.marker = Some(if listen_only_conference {
        palette::LISTEN_ONLY_DOT
    } else {
        type_marker(target.key)
    });
    // Who is talking into a conference, next to its dot (instead of the bar).
    if !target.muted {
        let speakers = conference_speakers(target, snapshot);
        if !speakers.is_empty() {
            appearance.footer = speakers.join(", ");
        }
    }
    appearance
}

/// Names of the people talking into a conference right now: those
/// addressing it and members we receive audio from.
fn conference_speakers(target: &TargetInfo, snapshot: &Snapshot) -> Vec<String> {
    if !matches!(target.key, TargetKey::Conference(_)) {
        return Vec::new();
    }
    let mut names: Vec<String> = snapshot
        .incoming
        .iter()
        .filter(|incoming| incoming.target == Some(target.key))
        .map(|incoming| incoming.from_name.clone())
        .collect();
    for member in target.members.iter().filter(|member| member.receiving) {
        if !names.contains(&member.name) {
            names.push(member.name.clone());
        }
    }
    names
}

fn type_marker(key: TargetKey) -> Rgb {
    match key {
        TargetKey::User(_) => palette::USER_DOT,
        TargetKey::Conference(_) => palette::CONFERENCE_DOT,
        TargetKey::Feed(_) => palette::FEED_DOT,
    }
}

fn production_appearance(production: &ProductionInfo, snapshot: &Snapshot) -> Appearance {
    let mut appearance = Appearance::simple(&production.name, palette::MENU_ITEM);
    if snapshot.is_current_production(production) {
        appearance.background = palette::MENU;
        appearance.subtitle = "current".into();
    }
    appearance
}

fn status_appearance(snapshot: &Snapshot, state: &DeckState) -> Appearance {
    let unavailable =
        snapshot.server_not_responding || snapshot.connection == ConnectionState::Disconnected;
    if unavailable && state.menu.is_none() {
        let mut appearance = Appearance::simple("Server unavailable", palette::SERVER_UNAVAILABLE);
        appearance.subtitle = state
            .local_ip
            .clone()
            .unwrap_or_else(|| snapshot.user_name.clone());
        appearance.footer = "MENU".into();
        return appearance;
    }
    if let Some(menu) = state.menu {
        let (title, subtitle) = match menu {
            MenuPage::Root => ("MENU", "close"),
            MenuPage::Productions => ("PRODUCTION", "back"),
            MenuPage::Info => ("INFO", "back"),
        };
        let mut appearance = Appearance::simple(title, palette::MENU);
        appearance.footer = subtitle.into();
        if unavailable {
            appearance.subtitle = "Server unavailable".into();
            appearance.background = palette::SERVER_UNAVAILABLE;
        }
        return appearance;
    }
    let mut appearance = Appearance::simple(
        &snapshot.user_name,
        if snapshot.connection == ConnectionState::Ready
            && snapshot.audio_ok
            && !snapshot.server_not_responding
        {
            palette::CONTROL
        } else {
            palette::STATUS_BAD
        },
    );
    appearance.subtitle = if state.member_layer {
        "MEMBERS".to_string()
    } else if state.volume_layer {
        "VOLUME".to_string()
    } else if snapshot.server_not_responding {
        "no server".to_string()
    } else if matches!(
        snapshot.media_status.as_deref(),
        Some("Media interrupted") | Some("Media failed")
    ) {
        "media down".to_string()
    } else if snapshot.connection != ConnectionState::Ready {
        snapshot.connection.label().to_string()
    } else if !snapshot.audio_ok {
        "no audio".to_string()
    } else if let Some(production) = snapshot.production_name() {
        production
    } else {
        "ready".to_string()
    };
    if connection_lost(snapshot) {
        // Offline the address of this box is what people need to reach it:
        // it takes the place of the production, under the panel name.
        appearance.subtitle = state.local_ip.clone().unwrap_or_else(|| "no IP".into());
    }
    if snapshot.on_air {
        appearance.background = palette::ON_AIR;
        appearance.subtitle = "ON AIR".to_string();
        appearance.badge = Some(Badge::OnAir);
    } else if snapshot.preview {
        appearance.background = palette::PREVIEW;
        appearance.subtitle = "PREVIEW".to_string();
    }
    if snapshot.lock_active {
        appearance.badge = Some(Badge::Lock);
    }
    appearance.footer = "MENU".into();
    appearance
}

fn reply_conference_name(snapshot: &Snapshot) -> Option<String> {
    snapshot.reply_label()
}

/// Web client reply button: solid blue, purple while talking. Incoming
/// calls flash it blue / dark instead of green so it keeps its colour.
fn reply_appearance(snapshot: &Snapshot) -> Appearance {
    let mut appearance = Appearance::simple("REPLY", palette::REPLY);
    match reply_conference_name(snapshot) {
        Some(name) => {
            appearance.subtitle = name;
            if snapshot.main_unavailable {
                appearance.background = palette::OFFLINE;
                appearance.foreground = palette::OFFLINE_TEXT;
            }
        }
        None => {
            appearance.background = palette::OFFLINE;
            appearance.foreground = palette::OFFLINE_TEXT;
        }
    }
    // Conference name right above the caller.
    appearance.subtitle_low = true;
    appearance.footer = snapshot
        .reply_incoming()
        .next()
        .map(|incoming| incoming.from_name.clone())
        .or_else(|| snapshot.last_caller.clone())
        .unwrap_or_default();
    let reply_held = snapshot
        .reply_target
        .map(|key| snapshot.target(key).map(|t| t.held).unwrap_or(false))
        .unwrap_or(false);
    if reply_held {
        appearance.background = palette::TALKING;
    } else if snapshot.reply_incoming().next().is_some() && appearance.background == palette::REPLY
    {
        // Reply is an intercom key: it blinks to a plain card, not a function key.
        appearance.blink = Some(palette::IDLE);
    }
    if snapshot.talking {
        mic_on_appearance(&mut appearance, snapshot);
    }
    appearance
}

/// The microphone is live, whatever opened it (a key, GPIO, VOX, a lock or
/// the remote panel): Reply turns red, says MIC ON and names the targets.
fn mic_on_appearance(appearance: &mut Appearance, snapshot: &Snapshot) {
    let talking_to: Vec<&str> = snapshot
        .targets
        .iter()
        .filter(|target| target.held || target.locked)
        .map(|target| target.name.as_str())
        .collect();
    appearance.title = "MIC ON".into();
    appearance.subtitle = match talking_to.as_slice() {
        [] => String::new(),
        [name] => (*name).to_string(),
        many => format!("{} targets", many.len()),
    };
    appearance.footer = String::new();
    appearance.background = palette::MIC_ON;
    appearance.foreground = palette::WHITE;
    appearance.blink = None;
}

/// Web client colours: purple while we talk, green for incoming audio.
/// When both apply, the key blinks between them (`talkingSpeakingSwap`).
fn apply_talk_and_listen(
    appearance: &mut Appearance,
    held: bool,
    locked: bool,
    incoming: bool,
    receiving: bool,
    listen_rest: Rgb,
) {
    let listen = incoming || receiving;
    if listen {
        appearance.background = palette::INCOMING;
        appearance.blink = if incoming { Some(listen_rest) } else { None };
    }
    if locked {
        appearance.background = palette::LOCKED;
        appearance.badge = Some(Badge::Lock);
        appearance.blink = None;
    }
    if held {
        appearance.background = palette::TALKING;
        appearance.blink = None;
    }
    if (held || locked) && listen {
        appearance.blink = Some(palette::INCOMING);
    }
}

fn appearance_for_role(
    role: Role,
    snapshot: &Snapshot,
    state: &DeckState,
    key_pages: usize,
    encoder_pages: usize,
) -> Appearance {
    match role {
        Role::SystemVolume => {
            let Some(volume) = &snapshot.system_volume else {
                return Appearance::blank();
            };
            let mut a = Appearance::simple(
                "MAIN",
                if state.system_volume_selected {
                    palette::SELECTED
                } else {
                    palette::CONTROL
                },
            );
            a.subtitle = format!("{}%", (volume.volume * 100.0).round());
            a.bar = Some(volume.volume);
            if volume.muted {
                a.badge = Some(Badge::Muted);
            }
            a
        }
        Role::Status => status_appearance(snapshot, state),
        Role::Reply => reply_appearance(snapshot),
        Role::VolumeToggle => {
            let mut a = Appearance::simple(
                "VOL",
                if state.volume_layer {
                    palette::SELECTED
                } else {
                    palette::CONTROL
                },
            );
            if state.volume_layer {
                a.footer = "back".into();
            }
            a
        }
        Role::MembersToggle => {
            let mut a = Appearance::simple(
                "MEMBERS",
                if state.member_layer {
                    palette::SELECTED
                } else {
                    palette::CONTROL
                },
            );
            if state.member_layer {
                a.footer = "back".into();
            } else {
                a.subtitle = state
                    .member_conference
                    .and_then(|key| snapshot.target(key))
                    .or_else(|| {
                        default_member_conference(snapshot, None)
                            .and_then(|key| snapshot.target(key))
                    })
                    .map(|target| target.name.clone())
                    .unwrap_or_default();
            }
            a
        }
        Role::VolumeUp => Appearance::simple("+", palette::CONTROL),
        Role::VolumeDown => Appearance::simple("−", palette::CONTROL),
        Role::MuteSelected => {
            if state.volume_layer && state.system_volume_selected {
                if !snapshot
                    .system_volume
                    .as_ref()
                    .is_some_and(|v| v.mute_supported)
                {
                    let mut a = Appearance::simple("—", palette::CONTROL);
                    a.subtitle = "No hardware mute".into();
                    return a;
                }
                let muted = snapshot.system_volume.as_ref().is_some_and(|v| v.muted);
                let mut a =
                    Appearance::simple(if muted { "HEAR" } else { "MUTE" }, palette::CONTROL);
                a.subtitle = "MAIN".into();
                if muted {
                    a.badge = Some(Badge::Muted);
                }
                return a;
            }
            if state.member_layer {
                let member = state.member_conference.and_then(|conference| {
                    conference_members(snapshot, conference)
                        .iter()
                        .find(|member| Some(member.user_id) == state.member_selected)
                });
                let mut a = Appearance::simple(
                    if member.map(|m| m.muted).unwrap_or(false) {
                        "HEAR"
                    } else {
                        "MUTE"
                    },
                    palette::CONTROL,
                );
                if let Some(member) = member {
                    a.subtitle = member.name.clone();
                    if member.muted {
                        a.background = palette::MUTED;
                        a.badge = Some(Badge::Muted);
                    }
                }
                a
            } else {
                let selected = state.selected.and_then(|key| snapshot.target(key));
                let mut a = Appearance::simple("MUTE", palette::CONTROL);
                if let Some(target) = selected {
                    a.subtitle = target.name.clone();
                    if target.muted {
                        a.background = palette::MUTED;
                        a.badge = Some(Badge::Muted);
                    }
                }
                a
            }
        }
        Role::NextPage => {
            let mut a = Appearance::simple("NEXT", palette::CONTROL);
            a.footer = format!(
                "{}/{}",
                state.page.min(key_pages.saturating_sub(1)) + 1,
                key_pages
            );
            a
        }
        Role::NextEncoderPage => {
            let mut a = Appearance::simple("DIALS", palette::CONTROL);
            a.footer = format!(
                "{}/{}",
                state.encoder_page.min(encoder_pages.saturating_sub(1)) + 1,
                encoder_pages
            );
            a
        }
        Role::Target(key) => snapshot
            .target(key)
            .map(|target| target_appearance(target, state, snapshot))
            .unwrap_or_else(Appearance::blank),
        Role::Member {
            conference,
            user_id,
        } => snapshot
            .target(conference)
            .and_then(|target| {
                target
                    .members
                    .iter()
                    .find(|member| member.user_id == user_id)
            })
            .map(|member| member_appearance(member, state))
            .unwrap_or_else(Appearance::blank),
        Role::Production(index) => snapshot
            .productions
            .get(index)
            .map(|production| production_appearance(production, snapshot))
            .unwrap_or_else(Appearance::blank),
        Role::Restart => {
            let mut a = Appearance::simple("RESTART", palette::MENU);
            a.subtitle = "hold 2s".into();
            a
        }
        Role::ClearLocks => {
            // Same look as CHANGE / production; greyed while nothing is locked.
            let mut a = Appearance::simple("CLEAR", palette::MENU);
            a.subtitle = "locks".into();
            if snapshot.lock_active {
                a.badge = Some(Badge::Lock);
            } else {
                a.foreground = palette::OFFLINE_TEXT;
            }
            a
        }
        Role::Menu(page) => menu_entry_appearance(page),
        Role::Info(index) => info_lines(snapshot, state.local_ip.as_deref())
            .get(index)
            .map(info_appearance)
            .unwrap_or_else(Appearance::blank),
        Role::Empty => Appearance::blank(),
    }
}

fn menu_entry_appearance(page: MenuPage) -> Appearance {
    // Same look as the MENU / back key and CLEAR / locks: a short verb,
    // the object below it.
    let (title, subtitle) = match page {
        MenuPage::Productions => ("CHANGE", "production"),
        MenuPage::Info => ("INFO", ""),
        MenuPage::Root => ("MENU", ""),
    };
    let mut appearance = Appearance::simple(title, palette::MENU);
    appearance.subtitle = subtitle.into();
    appearance
}

fn info_appearance(line: &InfoLine) -> Appearance {
    let mut a = Appearance::simple(
        line.title,
        if line.ok {
            palette::MENU_ITEM
        } else {
            palette::STATUS_BAD
        },
    );
    a.subtitle = line.value.clone();
    a
}

/// Builds the full key map for a visual deck.
pub fn layout(
    geometry: &Geometry,
    snapshot: &Snapshot,
    state: &DeckState,
    options: &LayoutOptions,
) -> Vec<KeySpec> {
    if !geometry.visual {
        return pedal_layout(snapshot, options);
    }
    let mut keys: Vec<KeySpec> = (0..geometry.keys)
        .map(|_| KeySpec {
            role: Role::Empty,
            appearance: Appearance::blank(),
        })
        .collect();
    let (key_pages, encoder_pages) = layer_page_counts(geometry, snapshot, state);
    for (key, role) in command_roles(geometry, state, key_pages, encoder_pages) {
        let Some(slot) = keys.get_mut(key as usize) else {
            continue;
        };
        slot.role = role;
        slot.appearance = appearance_for_role(role, snapshot, state, key_pages, encoder_pages);
    }
    if state.menu == Some(MenuPage::Root) {
        let entries = menu_entries(geometry);
        let shown = page_items(geometry, state, &entries);
        let slots = occupied_target_slots(geometry, shown.len());
        for (slot, (_, role)) in slots.iter().zip(shown.iter()) {
            if let Some(key) = keys.get_mut(*slot as usize) {
                key.role = **role;
                key.appearance = if **role == Role::VolumeToggle {
                    // VOLUME as a menu entry looks like the other entries.
                    let mut a = Appearance::simple("VOLUME", palette::MENU);
                    a.subtitle = "hold: members".into();
                    a
                } else {
                    appearance_for_role(**role, snapshot, state, key_pages, encoder_pages)
                };
            }
        }
    } else if state.menu == Some(MenuPage::Info) {
        let lines = info_lines(snapshot, state.local_ip.as_deref());
        let shown = page_items(geometry, state, &lines);
        let slots = occupied_target_slots(geometry, shown.len());
        for (slot, (index, line)) in slots.iter().zip(shown.iter()) {
            if let Some(key) = keys.get_mut(*slot as usize) {
                key.role = Role::Info(*index);
                key.appearance = info_appearance(line);
            }
        }
    } else if state.menu == Some(MenuPage::Productions) {
        let shown = page_productions(geometry, state, &snapshot.productions);
        let slots = occupied_target_slots(geometry, shown.len().max(1));
        if shown.is_empty() {
            if let Some(key) = slots.first().and_then(|slot| keys.get_mut(*slot as usize)) {
                let mut a = Appearance::simple("No productions", palette::MENU_ITEM);
                a.foreground = palette::OFFLINE_TEXT;
                key.appearance = a;
            }
        }
        for (slot, (index, production)) in slots.iter().zip(shown.iter()) {
            if let Some(key) = keys.get_mut(*slot as usize) {
                key.role = Role::Production(*index);
                key.appearance = production_appearance(production, snapshot);
            }
        }
    } else if state.member_layer {
        if let Some(conference) = state.member_conference {
            let shown = page_members(geometry, state, conference_members(snapshot, conference));
            let slots = occupied_target_slots(geometry, shown.len());
            for (slot, member) in slots.iter().zip(shown.iter()) {
                if let Some(key) = keys.get_mut(*slot as usize) {
                    key.role = Role::Member {
                        conference,
                        user_id: member.user_id,
                    };
                    key.appearance = member_appearance(member, state);
                }
            }
        }
    } else if state.volume_layer && snapshot.system_volume.is_some() {
        let roles = volume_roles(snapshot, state);
        let per_page = target_slots(geometry).len().max(1);
        let page = state
            .page
            .min(page_count(geometry, roles.len()).saturating_sub(1));
        let shown: Vec<Role> = roles
            .into_iter()
            .skip(page * per_page)
            .take(per_page)
            .collect();
        for (slot, role) in occupied_target_slots(geometry, shown.len())
            .into_iter()
            .zip(shown)
        {
            keys[slot as usize].role = role;
            keys[slot as usize].appearance =
                appearance_for_role(role, snapshot, state, key_pages, encoder_pages);
        }
    } else {
        let shown = page_targets(geometry, state, &snapshot.targets);
        let slots = occupied_target_slots(geometry, shown.len());
        for (slot, target) in slots.iter().zip(shown.iter()) {
            if let Some(key) = keys.get_mut(*slot as usize) {
                key.role = Role::Target(target.key);
                key.appearance = target_appearance(target, state, snapshot);
                // Decks with dials show the level on the touch strip.
                if geometry.encoders > 0 && !state.volume_layer {
                    key.appearance.bar = None;
                }
            }
        }
    }
    // The menu still works offline (INFO helps to find out why).
    if state.menu.is_none() && connection_lost(snapshot) {
        for key in &mut keys {
            let local_volume = key.role == Role::SystemVolume
                || (state.volume_layer
                    && state.system_volume_selected
                    && matches!(
                        key.role,
                        Role::VolumeUp | Role::VolumeDown | Role::MuteSelected
                    ));
            if !local_volume && !matches!(key.role, Role::Status | Role::Empty) {
                key.appearance.go_offline();
            }
        }
    }
    keys
}

fn pedal_layout(snapshot: &Snapshot, options: &LayoutOptions) -> Vec<KeySpec> {
    let assign = |target: Option<TargetKey>| match target {
        Some(key) => KeySpec {
            role: Role::Target(key),
            appearance: snapshot
                .target(key)
                .map(|target| target_appearance(target, &DeckState::default(), snapshot))
                .unwrap_or_else(|| {
                    let mut a = Appearance::simple(&key.to_string(), palette::IDLE);
                    a.foreground = palette::OFFLINE_TEXT;
                    a
                }),
        },
        None => KeySpec {
            role: Role::Empty,
            appearance: {
                let mut a = Appearance::simple("—", palette::OFFLINE);
                a.foreground = palette::OFFLINE_TEXT;
                a
            },
        },
    };
    vec![
        assign(options.pedal_left),
        assign(options.pedal_middle),
        KeySpec {
            role: Role::Reply,
            appearance: reply_appearance(snapshot),
        },
    ]
}

/// Targets or members bound to the encoders of a Stream Deck + / + XL.
pub fn encoder_bindings<'a>(
    geometry: &Geometry,
    state: &DeckState,
    snapshot: &'a Snapshot,
) -> Vec<Option<EncoderBinding<'a>>> {
    if geometry.encoders == 0 {
        return Vec::new();
    }
    if state.menu.is_some() {
        return vec![None; geometry.encoders as usize];
    }
    if state.volume_layer && snapshot.system_volume.is_some() {
        let roles = volume_roles(snapshot, state);
        let bind = |role: Role| match role {
            Role::SystemVolume => snapshot
                .system_volume
                .as_ref()
                .map(EncoderBinding::SystemVolume),
            Role::Target(key) => snapshot.target(key).map(EncoderBinding::Target),
            _ => None,
        };
        if geometry.encoders_follow_bottom_row() {
            let per_page = target_slots(geometry).len().max(1);
            let page = state
                .page
                .min(page_count(geometry, roles.len()).saturating_sub(1));
            let shown: Vec<Role> = roles
                .into_iter()
                .skip(page * per_page)
                .take(per_page)
                .collect();
            return bottom_row_items(geometry, &shown)
                .into_iter()
                .map(|r| r.and_then(bind))
                .collect();
        }
        let per_page = geometry.encoders as usize;
        let page = state
            .encoder_page
            .min(encoder_page_count(geometry, roles.len()).saturating_sub(1));
        return (0..per_page)
            .map(|i| roles.get(page * per_page + i).copied().and_then(bind))
            .collect();
    }
    if state.member_layer {
        let Some(conference) = state.member_conference else {
            return vec![None; geometry.encoders as usize];
        };
        let members = conference_members(snapshot, conference);
        if geometry.encoders_follow_bottom_row() {
            let shown = page_members(geometry, state, members);
            return bottom_row_items(geometry, &shown)
                .into_iter()
                .map(|item| item.map(|member| EncoderBinding::Member { conference, member }))
                .collect();
        }
        let per_page = geometry.encoders.max(1) as usize;
        let pages = encoder_page_count(geometry, members.len());
        let page = state.encoder_page.min(pages.saturating_sub(1));
        return (0..geometry.encoders as usize)
            .map(|index| {
                members
                    .get(page * per_page + index)
                    .map(|member| EncoderBinding::Member { conference, member })
            })
            .collect();
    }
    if geometry.encoders_follow_bottom_row() {
        let shown = page_targets(geometry, state, &snapshot.targets);
        return bottom_row_items(geometry, &shown)
            .into_iter()
            .map(|target| target.map(EncoderBinding::Target))
            .collect();
    }
    let per_page = geometry.encoders.max(1) as usize;
    let pages = encoder_page_count(geometry, snapshot.targets.len());
    let page = state.encoder_page.min(pages.saturating_sub(1));
    (0..geometry.encoders as usize)
        .map(|index| {
            snapshot
                .targets
                .get(page * per_page + index)
                .map(EncoderBinding::Target)
        })
        .collect()
}

fn volume_roles(snapshot: &Snapshot, state: &DeckState) -> Vec<Role> {
    let mut roles = Vec::new();
    if state.volume_layer && snapshot.system_volume.is_some() {
        roles.push(Role::SystemVolume);
    }
    roles.extend(snapshot.targets.iter().map(|t| Role::Target(t.key)));
    roles
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geometry(kind: &str) -> Geometry {
        match kind {
            "mk2" => Geometry {
                keys: 15,
                rows: 3,
                cols: 5,
                encoders: 0,
                touchpoints: 0,
                visual: true,
            },
            "mini" => Geometry {
                keys: 6,
                rows: 2,
                cols: 3,
                encoders: 0,
                touchpoints: 0,
                visual: true,
            },
            "xl" => Geometry {
                keys: 32,
                rows: 4,
                cols: 8,
                encoders: 0,
                touchpoints: 0,
                visual: true,
            },
            "plus" => Geometry {
                keys: 8,
                rows: 2,
                cols: 4,
                encoders: 4,
                touchpoints: 0,
                visual: true,
            },
            "plusxl" => Geometry {
                keys: 36,
                rows: 4,
                cols: 9,
                encoders: 6,
                touchpoints: 0,
                visual: true,
            },
            "neo" => Geometry {
                keys: 8,
                rows: 2,
                cols: 4,
                encoders: 0,
                touchpoints: 2,
                visual: true,
            },
            _ => Geometry {
                keys: 3,
                rows: 1,
                cols: 3,
                encoders: 0,
                touchpoints: 0,
                visual: false,
            },
        }
    }

    fn snapshot(count: usize) -> Snapshot {
        let mut snapshot = Snapshot::initial("cam1", "Cam 1");
        snapshot.connection = ConnectionState::Ready;
        snapshot.audio_ok = true;
        snapshot.targets = (0..count)
            .map(|i| TargetInfo {
                key: if i % 3 == 2 {
                    TargetKey::Feed(i as i64)
                } else {
                    TargetKey::User(i as i64)
                },
                name: format!("T{i}"),
                can_talk: i % 3 != 2,
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
    fn listen_only_conference_looks_like_a_feed() {
        let mut snapshot = snapshot(3);
        snapshot.targets[0].key = TargetKey::Conference(7);
        snapshot.targets[0].can_talk = false;
        snapshot.targets[1].key = TargetKey::Conference(8);
        let state = DeckState::default();
        let look = |snapshot: &Snapshot, index: usize| {
            target_appearance(&snapshot.targets[index], &state, snapshot)
        };
        let listen_conference = look(&snapshot, 0);
        let talk_conference = look(&snapshot, 1);
        let feed = look(&snapshot, 2);
        // Type dot follows the web client icons; listen-only conferences
        // use the admin UI's listen-only orange.
        assert_eq!(listen_conference.marker, Some(palette::LISTEN_ONLY_DOT));
        assert_eq!(talk_conference.marker, Some(palette::CONFERENCE_DOT));
        assert_eq!(feed.marker, Some(palette::FEED_DOT));
        // Only feeds show their level; conferences show names only.
        assert_eq!(listen_conference.subtitle, feed.subtitle);
        assert!(feed.bar.is_some());
        assert!(listen_conference.bar.is_none());
        assert!(talk_conference.bar.is_none());
        // Names only in normal operation; dB on the volume layer.
        assert_eq!(feed.subtitle, "");
        let volume_layer = DeckState {
            volume_layer: true,
            ..DeckState::default()
        };
        let feed_volume = target_appearance(&snapshot.targets[2], &volume_layer, &snapshot);
        assert!(
            feed_volume.subtitle.ends_with("dB"),
            "{}",
            feed_volume.subtitle
        );

        // Muted looks the same on every kind of target.
        for target in &mut snapshot.targets {
            target.muted = true;
        }
        for index in 0..3 {
            let muted = look(&snapshot, index);
            assert_eq!(muted.background, palette::MUTED);
            assert_eq!(muted.badge, Some(Badge::Muted));
        }
        // A talk key keeps showing talk over mute.
        snapshot.targets[1].held = true;
        assert_eq!(look(&snapshot, 1).background, palette::TALKING);
    }

    #[test]
    fn decks_with_dials_leave_the_level_to_the_strip() {
        let snapshot = snapshot(3);
        let keys = layout(
            &geometry("plus"),
            &snapshot,
            &DeckState::default(),
            &options(),
        );
        let feed = keys
            .iter()
            .find(|key| key.role == Role::Target(TargetKey::Feed(2)))
            .unwrap();
        assert_eq!(feed.appearance.bar, None);
        let keys = layout(
            &geometry("mk2"),
            &snapshot,
            &DeckState::default(),
            &options(),
        );
        let feed = keys
            .iter()
            .find(|key| key.role == Role::Target(TargetKey::Feed(2)))
            .unwrap();
        assert!(feed.appearance.bar.is_some());
    }

    #[test]
    fn reply_ignores_calls_into_listen_only_conferences() {
        let mut snapshot = snapshot(1);
        snapshot.targets[0].key = TargetKey::Conference(7);
        snapshot.targets[0].name = "Regie".into();
        snapshot.targets[0].can_talk = false;
        snapshot.incoming = vec![crate::state::IncomingInfo {
            from_name: "jan".into(),
            target: Some(TargetKey::Conference(7)),
        }];
        let reply = reply_appearance(&snapshot);
        assert_eq!(reply.footer, "");
        assert_eq!(reply.blink, None);
        assert_eq!(snapshot.reply_label(), None);
        snapshot.targets[0].can_talk = true;
        let reply = reply_appearance(&snapshot);
        assert_eq!(reply.footer, "jan");
        assert_eq!(reply.subtitle, "Regie");
        assert!(reply.subtitle_low);
    }

    #[test]
    fn reply_names_the_current_or_last_caller() {
        let mut snapshot = snapshot(1);
        snapshot.incoming = vec![crate::state::IncomingInfo {
            from_name: "jan".into(),
            target: None,
        }];
        snapshot.last_caller = Some("oli".into());
        assert_eq!(reply_appearance(&snapshot).footer, "jan");
        snapshot.incoming.clear();
        assert_eq!(reply_appearance(&snapshot).footer, "oli");
        snapshot.last_caller = None;
        assert_eq!(reply_appearance(&snapshot).footer, "");
    }

    #[test]
    fn conference_key_names_who_is_talking_into_it() {
        let mut snapshot = snapshot(1);
        snapshot.targets[0].key = TargetKey::Conference(7);
        snapshot.targets[0].incoming = true;
        snapshot.incoming = vec![crate::state::IncomingInfo {
            from_name: "jan".into(),
            target: Some(TargetKey::Conference(7)),
        }];
        snapshot.targets[0].members = vec![ConferenceMemberInfo {
            user_id: 3,
            name: "oli".into(),
            online: true,
            receiving: true,
            volume: 0.8,
            muted: false,
        }];
        let state = DeckState::default();
        let appearance = target_appearance(&snapshot.targets[0], &state, &snapshot);
        assert_eq!(appearance.footer, "jan, oli");
        assert_eq!(appearance.title, "T0");
        snapshot.incoming.clear();
        snapshot.targets[0].members.clear();
        let appearance = target_appearance(&snapshot.targets[0], &state, &snapshot);
        assert_eq!(appearance.footer, "");
    }

    #[test]
    fn pressed_listen_only_conference_says_so_for_a_while() {
        let mut snapshot = snapshot(1);
        snapshot.targets[0].key = TargetKey::Conference(7);
        snapshot.targets[0].can_talk = false;
        let mut state = DeckState::default();
        let volume = target_appearance(&snapshot.targets[0], &state, &snapshot).subtitle;
        state.show_listen_only(TargetKey::Conference(7));
        let notice = target_appearance(&snapshot.targets[0], &state, &snapshot);
        assert_eq!(notice.subtitle, "LISTEN ONLY");
        assert_eq!(notice.badge, None);
        assert!(!state.expire_listen_only(LISTEN_ONLY_NOTICE));
        assert!(state.expire_listen_only(Duration::ZERO));
        assert_eq!(
            target_appearance(&snapshot.targets[0], &state, &snapshot).subtitle,
            volume
        );
    }

    fn options() -> LayoutOptions {
        LayoutOptions {
            pedal_left: Some(TargetKey::User(9)),
            pedal_middle: Some(TargetKey::Conference(1)),
        }
    }

    fn binding_target(binding: Option<EncoderBinding<'_>>) -> Option<TargetKey> {
        match binding {
            Some(EncoderBinding::Target(target)) => Some(target.key),
            _ => None,
        }
    }

    fn roles(kind: &str, count: usize, state: &DeckState) -> Vec<Role> {
        layout(&geometry(kind), &snapshot(count), state, &options())
            .into_iter()
            .map(|key| key.role)
            .collect()
    }

    #[test]
    fn neo_command_row_and_bottom_targets() {
        let keys = layout(
            &geometry("neo"),
            &snapshot(3),
            &DeckState::default(),
            &options(),
        );
        assert_eq!(keys[0].role, Role::Status);
        assert_eq!(keys[1].role, Role::VolumeToggle);
        assert_eq!(keys[2].role, Role::Empty);
        assert_eq!(keys[3].role, Role::Reply);
        assert_eq!(keys[4].role, Role::Target(TargetKey::User(0)));
        assert_eq!(keys[5].role, Role::Target(TargetKey::User(1)));
        assert_eq!(keys[6].role, Role::Target(TargetKey::Feed(2)));
        assert_eq!(keys[7].role, Role::Empty);
        assert_eq!(keys[0].appearance.subtitle, "ready");
        assert_eq!(keys[0].appearance.footer, "MENU");
    }

    #[test]
    fn lost_connection_greys_every_key_but_status() {
        let mut snapshot = snapshot(3);
        snapshot.targets[0].held = true;
        snapshot.targets[1].muted = true;
        snapshot.connection = ConnectionState::Disconnected;
        let keys = layout(
            &geometry("mk2"),
            &snapshot,
            &DeckState::default(),
            &options(),
        );
        assert_eq!(keys[0].appearance.background, palette::SERVER_UNAVAILABLE);
        for key in keys
            .iter()
            .filter(|key| !matches!(key.role, Role::Status | Role::Empty))
        {
            assert_eq!(
                key.appearance.background,
                palette::OFFLINE,
                "{:?}",
                key.role
            );
            assert_eq!(key.appearance.foreground, palette::OFFLINE_TEXT);
            assert_eq!(key.appearance.badge, None);
            assert_eq!(key.appearance.bar, None);
            if key.appearance.marker.is_some() {
                assert_eq!(key.appearance.marker, Some(palette::OFFLINE_TEXT));
            }
        }
        // The menu stays usable.
        let mut state = DeckState::default();
        state.open_menu(MenuPage::Root);
        let keys = layout(&geometry("mk2"), &snapshot, &state, &options());
        assert_eq!(keys[5].appearance.background, palette::MENU);
    }

    #[test]
    fn status_shows_server_not_responding() {
        let mut snapshot = snapshot(1);
        snapshot.server_not_responding = true;
        snapshot.heartbeat = "missing".into();
        snapshot.media_status = Some("Server not responding".into());
        let keys = layout(
            &geometry("neo"),
            &snapshot,
            &DeckState::default(),
            &options(),
        );
        // The failure is explicit; IP remains useful and stale tally cannot hide it.
        assert_eq!(keys[0].appearance.title, "Server unavailable");
        assert_eq!(keys[0].appearance.subtitle, "Cam 1");
        let state = DeckState {
            local_ip: Some("192.0.2.10".into()),
            ..DeckState::default()
        };
        let keys = layout(&geometry("neo"), &snapshot, &state, &options());
        assert_eq!(keys[0].appearance.subtitle, "192.0.2.10");
        assert_eq!(keys[0].appearance.background, palette::SERVER_UNAVAILABLE);
        snapshot.on_air = true;
        let keys = layout(
            &geometry("neo"),
            &snapshot,
            &DeckState::default(),
            &options(),
        );
        assert_eq!(keys[0].appearance.title, "Server unavailable");
    }

    #[test]
    fn server_failure_stays_visible_in_volume_and_menu_and_beats_stale_tally() {
        let mut snapshot = snapshot(1);
        snapshot.connection = ConnectionState::Disconnected;
        snapshot.on_air = true;
        snapshot.preview = true;
        for volume_layer in [false, true] {
            let state = DeckState {
                volume_layer,
                ..DeckState::default()
            };
            let appearance = status_appearance(&snapshot, &state);
            assert_eq!(appearance.title, "Server unavailable");
            assert_eq!(appearance.background, palette::SERVER_UNAVAILABLE);
        }
        let state = DeckState {
            menu: Some(MenuPage::Root),
            ..DeckState::default()
        };
        let appearance = status_appearance(&snapshot, &state);
        assert_eq!(appearance.title, "MENU");
        assert_eq!(appearance.subtitle, "Server unavailable");
        assert_eq!(appearance.background, palette::SERVER_UNAVAILABLE);
    }

    #[test]
    fn status_shows_production_when_ready() {
        let mut snapshot = snapshot(1);
        snapshot.production = Some("News Desk".into());
        let keys = layout(
            &geometry("neo"),
            &snapshot,
            &DeckState::default(),
            &options(),
        );
        assert_eq!(keys[0].appearance.title, "Cam 1");
        assert_eq!(keys[0].appearance.subtitle, "News Desk");
    }

    fn with_productions(count: usize) -> Snapshot {
        let mut snapshot = snapshot(4);
        snapshot.productions = (1..=count)
            .map(|id| crate::state::ProductionInfo {
                id: id.to_string(),
                name: format!("Prod {id}"),
            })
            .collect();
        snapshot.production = Some("2".into());
        snapshot
    }

    #[test]
    fn menu_root_lists_production_clear_info_and_guarded_restart() {
        let mut snapshot = with_productions(3);
        snapshot.connection = ConnectionState::Ready;
        snapshot.audio_ok = true;
        let mut state = DeckState::default();
        state.open_menu(MenuPage::Root);
        let keys = layout(&geometry("mk2"), &snapshot, &state, &options());
        assert_eq!(keys[0].role, Role::Status);
        assert_eq!(keys[0].appearance.title, "MENU");
        assert_eq!(keys[0].appearance.footer, "close");
        // Only status in the command row: no CLEAR, VOL, NEXT, MEMBERS or Reply.
        assert!(keys[1..5].iter().all(|key| key.role == Role::Empty));
        // All entries together on the row right under the command row.
        assert_eq!(keys[5].role, Role::Menu(MenuPage::Productions));
        assert_eq!(keys[6].role, Role::ClearLocks);
        assert_eq!(keys[7].role, Role::Menu(MenuPage::Info));
        assert_eq!(keys[8].role, Role::Restart);
        assert_eq!(keys[8].appearance.subtitle, "hold 2s");
        // Menu keys share one look: MENU colour, short title, small
        // second word (CHANGE / production, CLEAR / locks).
        assert_eq!(keys[5].appearance.title, "CHANGE");
        assert_eq!(keys[5].appearance.subtitle, "production");
        assert_eq!(keys[6].appearance.title, "CLEAR");
        assert_eq!(keys[6].appearance.subtitle, "locks");
        for key in [&keys[5], &keys[6], &keys[7]] {
            assert_eq!(key.appearance.background, keys[0].appearance.background);
            assert_eq!(key.appearance.badge, None);
        }
        assert!(!keys.iter().any(|key| matches!(key.role, Role::Target(_))));
    }

    #[test]
    fn menu_status_goes_back_one_level_then_closes() {
        let mut state = DeckState::default();
        state.open_menu(MenuPage::Root);
        state.open_menu(MenuPage::Info);
        state.menu_back();
        assert_eq!(state.menu, Some(MenuPage::Root));
        state.menu_back();
        assert_eq!(state.menu, None);
    }

    #[test]
    fn menu_fits_the_smallest_decks() {
        let snapshot = with_productions(2);
        let mut state = DeckState::default();
        state.open_menu(MenuPage::Root);
        for name in ["neo", "plus"] {
            let keys = layout(&geometry(name), &snapshot, &state, &options());
            let entries = keys
                .iter()
                .filter(|key| matches!(key.role, Role::Menu(_) | Role::ClearLocks | Role::Restart))
                .count();
            assert_eq!(entries, 4, "{name}");
            assert!(!keys.iter().any(|key| key.role == Role::NextPage), "{name}");
        }
        // Mini: VOLUME joins the menu, so five entries page with NEXT.
        let mini = geometry("mini");
        let keys = layout(&mini, &snapshot, &state, &options());
        assert_eq!(keys[2].role, Role::NextPage);
        assert_eq!(
            [keys[3].role, keys[4].role, keys[5].role],
            [
                Role::VolumeToggle,
                Role::Menu(MenuPage::Productions),
                Role::ClearLocks
            ]
        );
        assert_eq!(keys[3].appearance.title, "VOLUME");
        assert_eq!(keys[3].appearance.background, palette::MENU);
        *state.key_page_mut() = 1;
        let keys = layout(&mini, &snapshot, &state, &options());
        assert_eq!(keys[3].role, Role::Menu(MenuPage::Info));
        assert_eq!(keys[4].role, Role::Restart);
    }

    #[test]
    fn info_page_shows_rtt_loss_server_version_and_ip() {
        let mut snapshot = snapshot(2);
        snapshot.server_url = "https://intercom.example:8443/".into();
        snapshot.server_version = Some("1.5.17".into());
        snapshot.media = Some(crate::state::MediaInfo {
            rtt_ms: Some(23),
            packet_loss_pct: Some(4.5),
            ..Default::default()
        });
        let lines = info_lines(&snapshot, Some("192.168.1.20"));
        let titles: Vec<_> = lines.iter().map(|line| line.title).collect();
        assert_eq!(titles, ["RTT", "LOSS", "SERVER", "VERSION", "IP"]);
        assert_eq!(lines[0].value, "23 ms");
        assert!(!lines[1].ok, "4.5 % loss is a problem");
        assert_eq!(lines[2].value, "intercom.example:8443");
        assert!(lines[3].value.ends_with(" / 1.5.17"));
        assert_eq!(lines[4].value, "192.168.1.20");
        assert_eq!(info_lines(&snapshot, None)[4].value, "–");

        let mut state = DeckState::default();
        state.open_menu(MenuPage::Info);
        let keys = layout(&geometry("mk2"), &snapshot, &state, &options());
        assert_eq!(keys[0].appearance.title, "INFO");
        // Five lines fill the first target row.
        assert_eq!(keys[5].role, Role::Info(0));
        assert_eq!(keys[5].appearance.title, "RTT");
        assert_eq!(keys[6].appearance.background, palette::STATUS_BAD);
        assert_eq!(keys[9].appearance.title, "IP");
    }

    #[test]
    fn production_page_replaces_the_whole_deck() {
        let snapshot = with_productions(3);
        let mut state = DeckState::default();
        state.open_menu(MenuPage::Productions);
        let keys = layout(&geometry("mk2"), &snapshot, &state, &options());
        assert_eq!(keys[0].role, Role::Status);
        assert_eq!(keys[0].appearance.title, "PRODUCTION");
        assert_eq!(keys[0].appearance.footer, "back");
        // No CLEAR, VOL, NEXT, MEMBERS, Reply or targets on this page.
        assert!(keys[1..5].iter().all(|key| key.role == Role::Empty));
        assert!(!keys
            .iter()
            .any(|key| matches!(key.role, Role::Target(_) | Role::Reply)));
        // Productions start under the command row, left to right; the current one is marked.
        assert_eq!(keys[5].role, Role::Production(0));
        assert_eq!(keys[6].role, Role::Production(1));
        assert_eq!(keys[7].role, Role::Production(2));
        assert_eq!(keys[6].appearance.subtitle, "current");
        assert_eq!(keys[6].appearance.background, palette::MENU);
        assert_eq!(keys[5].appearance.background, palette::MENU_ITEM);
    }

    #[test]
    fn production_page_pages_and_closes_other_layers() {
        let snapshot = with_productions(6);
        let geometry = geometry("neo");
        let mut state = DeckState {
            volume_layer: true,
            ..Default::default()
        };
        state.open_menu(MenuPage::Productions);
        assert!(!state.volume_layer && !state.member_layer);
        let keys = layout(&geometry, &snapshot, &state, &options());
        // Neo: 4 production keys per page, NEXT at the far right of the command row.
        assert_eq!(keys[3].role, Role::NextPage);
        assert_eq!(keys[3].appearance.footer, "1/2");
        *state.key_page_mut() = 1;
        state.clamp_pages(&geometry, &snapshot);
        let keys = layout(&geometry, &snapshot, &state, &options());
        assert_eq!(keys[4].role, Role::Production(4));
        assert_eq!(keys[5].role, Role::Production(5));
        assert_eq!(state.page, 0, "target page is untouched");
    }

    #[test]
    fn production_page_without_productions_says_so() {
        let snapshot = snapshot(4);
        let mut state = DeckState::default();
        state.open_menu(MenuPage::Productions);
        let keys = layout(&geometry("mk2"), &snapshot, &state, &options());
        assert_eq!(keys[5].appearance.title, "No productions");
        assert_eq!(keys[5].role, Role::Empty);
    }

    #[test]
    fn status_shows_production_name_for_an_id() {
        let mut snapshot = snapshot(1);
        snapshot.production = Some("4".into());
        snapshot.productions = vec![crate::state::ProductionInfo {
            id: "4".into(),
            name: "Andys-Superproduktion".into(),
        }];
        let keys = layout(
            &geometry("neo"),
            &snapshot,
            &DeckState::default(),
            &options(),
        );
        assert_eq!(keys[0].appearance.subtitle, "Andys-Superproduktion");
    }

    #[test]
    fn mini_pages_with_next_left_of_reply() {
        let geometry = geometry("mini");
        let mut state = DeckState::default();
        let snapshot = snapshot(7);
        let keys = layout(&geometry, &snapshot, &state, &options());
        assert_eq!(keys[0].role, Role::Status);
        assert_eq!(keys[1].role, Role::NextPage);
        assert_eq!(keys[2].role, Role::Reply);
        assert_eq!(keys[3].role, Role::Target(TargetKey::User(0)));
        assert_eq!(keys[4].role, Role::Target(TargetKey::User(1)));
        assert_eq!(keys[5].role, Role::Target(TargetKey::Feed(2)));
        assert_eq!(page_count(&geometry, 7), 3);
        state.page = 2;
        let keys = layout(&geometry, &snapshot, &state, &options());
        assert_eq!(keys[3].role, Role::Target(TargetKey::User(6)));
        assert_eq!(keys[4].role, Role::Empty);
        assert_eq!(keys[1].appearance.footer, "3/3");
    }

    #[test]
    fn volume_layer_overlays_command_row_not_targets() {
        let geometry = geometry("neo");
        let state = DeckState {
            volume_layer: true,
            selected: Some(TargetKey::User(0)),
            ..DeckState::default()
        };
        let keys = layout(&geometry, &snapshot(4), &state, &options());
        assert_eq!(keys[0].role, Role::VolumeToggle);
        assert_eq!(keys[1].role, Role::MuteSelected);
        assert_eq!(keys[2].role, Role::VolumeDown);
        assert_eq!(keys[3].role, Role::VolumeUp);
        assert_eq!(keys[4].role, Role::Target(TargetKey::User(0)));
        assert_eq!(keys[5].role, Role::Target(TargetKey::User(1)));
        assert_eq!(keys[6].role, Role::Target(TargetKey::Feed(2)));
        assert_eq!(keys[7].role, Role::Target(TargetKey::User(3)));
        assert_eq!(keys[4].appearance.bar, Some(0.9));
        assert_eq!(keys[4].appearance.background, palette::SELECTED);
        assert_eq!(keys[1].appearance.subtitle, "T0");
    }

    #[test]
    fn occupied_slots_read_ltr_ttb_from_the_top() {
        let mk2 = geometry("mk2");
        assert_eq!(target_slots(&mk2), vec![5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
        assert_eq!(occupied_target_slots(&mk2, 3), vec![5, 6, 7]);
        assert_eq!(occupied_target_slots(&mk2, 5), vec![5, 6, 7, 8, 9]);
        assert_eq!(occupied_target_slots(&mk2, 6), vec![5, 6, 7, 8, 9, 10]);
        assert_eq!(
            occupied_target_slots(&mk2, 10),
            vec![5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
        );
        let xl = geometry("xl");
        assert_eq!(
            occupied_target_slots(&xl, 9),
            (8..17).map(|i| i as u8).collect::<Vec<_>>()
        );
    }

    #[test]
    fn xl_fills_target_rows_from_the_top() {
        let keys = roles("xl", 9, &DeckState::default());
        assert_eq!(keys[8], Role::Target(TargetKey::User(0)));
        assert_eq!(keys[15], Role::Target(TargetKey::User(7)));
        assert_eq!(keys[16], Role::Target(TargetKey::Feed(8)));
        assert_eq!(keys[17], Role::Empty);
        assert_eq!(keys[24], Role::Empty);
        assert_eq!(keys[31], Role::Empty);
    }

    #[test]
    fn mk2_fills_a_single_target_row_from_the_top() {
        let keys = roles("mk2", 5, &DeckState::default());
        assert_eq!(keys[0], Role::Status);
        assert_eq!(keys[1], Role::VolumeToggle);
        assert_eq!(keys[4], Role::Reply);
        assert_eq!(keys[2], Role::MembersToggle);
        assert_eq!(keys[5], Role::Target(TargetKey::User(0)));
        assert_eq!(keys[6], Role::Target(TargetKey::User(1)));
        assert_eq!(keys[7], Role::Target(TargetKey::Feed(2)));
        assert_eq!(keys[8], Role::Target(TargetKey::User(3)));
        assert_eq!(keys[9], Role::Target(TargetKey::User(4)));
        assert!(keys[10..15].iter().all(|role| *role == Role::Empty));
    }

    #[test]
    fn mk2_reads_targets_left_to_right_top_to_bottom() {
        let keys = roles("mk2", 10, &DeckState::default());
        assert_eq!(keys[5], Role::Target(TargetKey::User(0)));
        assert_eq!(keys[9], Role::Target(TargetKey::User(4)));
        assert_eq!(keys[10], Role::Target(TargetKey::Feed(5)));
        assert_eq!(keys[14], Role::Target(TargetKey::User(9)));
    }

    #[test]
    fn mk2_partial_second_row_starts_at_top_left_of_the_block() {
        let keys = roles("mk2", 6, &DeckState::default());
        assert_eq!(keys[5], Role::Target(TargetKey::User(0)));
        assert_eq!(keys[9], Role::Target(TargetKey::User(4)));
        assert_eq!(keys[10], Role::Target(TargetKey::Feed(5)));
        assert_eq!(keys[11], Role::Empty);
        assert_eq!(keys[14], Role::Empty);
    }

    #[test]
    fn mk2_last_page_puts_leftover_targets_at_the_top() {
        let geometry = geometry("mk2");
        let mut state = DeckState::default();
        let snapshot = snapshot(12);
        assert_eq!(page_count(&geometry, 12), 2);
        state.page = 1;
        let keys = layout(&geometry, &snapshot, &state, &options());
        assert_eq!(keys[5].role, Role::Target(TargetKey::User(10)));
        assert_eq!(keys[6].role, Role::Target(TargetKey::Feed(11)));
        assert_eq!(keys[7].role, Role::Empty);
        assert_eq!(keys[10].role, Role::Empty);
    }

    #[test]
    fn mini_moves_vol_into_the_menu() {
        // Command row: status, NEXT (only when paging is needed), Reply.
        let keys = roles("mini", 5, &DeckState::default());
        assert_eq!(&keys[..3], [Role::Status, Role::NextPage, Role::Reply]);
        assert!(!keys.contains(&Role::VolumeToggle));
        let keys = roles("mini", 3, &DeckState::default());
        assert_eq!(&keys[..3], [Role::Status, Role::Empty, Role::Reply]);
        // Volume layer: − / + / NEXT; tapping the selected target closes it.
        let volume = DeckState {
            volume_layer: true,
            selected: Some(TargetKey::User(0)),
            ..DeckState::default()
        };
        let keys = roles("mini", 5, &volume);
        assert_eq!(
            &keys[..3],
            [Role::VolumeDown, Role::VolumeUp, Role::NextPage]
        );
        let keys = roles("mini", 3, &volume);
        assert_eq!(&keys[..3], [Role::VolumeDown, Role::VolumeUp, Role::Empty]);
        // Opening the volume layer from the menu leaves the menu.
        let mut state = DeckState::default();
        state.open_menu(MenuPage::Root);
        state.toggle_volume_layer(&snapshot(5));
        assert!(state.volume_layer && state.menu.is_none());
    }

    #[test]
    fn volume_layer_can_page_through_targets() {
        let state = DeckState {
            volume_layer: true,
            selected: Some(TargetKey::User(0)),
            ..DeckState::default()
        };
        // MK.2: 12 targets on 10 keys. NEXT takes Reply's place; + stays.
        let keys = roles("mk2", 12, &state);
        assert_eq!(keys[3], Role::VolumeUp);
        assert_eq!(keys[4], Role::NextPage);
        // Neo: 6 targets on 4 keys. NEXT takes MUTE's place; - and + stay.
        let keys = roles("neo", 6, &state);
        assert_eq!(keys[0], Role::VolumeToggle);
        assert_eq!(keys[1], Role::NextPage);
        assert_eq!(keys[2], Role::VolumeDown);
        assert_eq!(keys[3], Role::VolumeUp);
        // XL already has room next to the controls.
        let keys = roles("xl", 40, &state);
        assert_eq!(
            keys.iter().filter(|role| **role == Role::NextPage).count(),
            1
        );
        assert!(keys.contains(&Role::MuteSelected) && keys.contains(&Role::Reply));
    }

    #[test]
    fn member_layer_can_page_through_members() {
        let snapshot = conference_snapshot(6);
        let state = member_state(Some(0));
        let keys = layout(&geometry("neo"), &snapshot, &state, &options());
        assert_eq!(keys[0].role, Role::MembersToggle);
        assert_eq!(keys[1].role, Role::NextPage);
    }

    #[test]
    fn mk2_volume_keeps_reply_when_there_is_room() {
        let state = DeckState {
            volume_layer: true,
            selected: Some(TargetKey::User(0)),
            ..DeckState::default()
        };
        let keys = roles("mk2", 4, &state);
        assert_eq!(keys[0], Role::VolumeToggle);
        assert_eq!(keys[1], Role::MuteSelected);
        assert_eq!(keys[2], Role::VolumeDown);
        assert_eq!(keys[3], Role::VolumeUp);
        assert_eq!(keys[4], Role::Reply);
        assert_eq!(keys[5], Role::Target(TargetKey::User(0)));
    }

    #[test]
    fn plus_bottom_row_matches_dials() {
        let geometry = geometry("plus");
        let state = DeckState::default();
        let snapshot = snapshot(3);
        let keys = layout(&geometry, &snapshot, &state, &options());
        assert_eq!(keys[0].role, Role::Status);
        assert_eq!(keys[1].role, Role::VolumeToggle);
        assert_eq!(keys[3].role, Role::Reply);
        assert_eq!(keys[4].role, Role::Target(TargetKey::User(0)));
        assert_eq!(keys[5].role, Role::Target(TargetKey::User(1)));
        assert_eq!(keys[6].role, Role::Target(TargetKey::Feed(2)));
        assert_eq!(keys[7].role, Role::Empty);
        let encoders = encoder_bindings(&geometry, &state, &snapshot);
        assert_eq!(encoders.len(), 4);
        assert_eq!(binding_target(encoders[0]), Some(TargetKey::User(0)));
        assert_eq!(binding_target(encoders[1]), Some(TargetKey::User(1)));
        assert_eq!(binding_target(encoders[2]), Some(TargetKey::Feed(2)));
        assert_eq!(encoders[3], None);
        assert_eq!(encoder_page_count(&geometry, 12), 1);
    }

    #[test]
    fn plusxl_pages_dials_independently_of_keys() {
        let geometry = geometry("plusxl");
        let mut state = DeckState::default();
        let snapshot = snapshot(20);
        let keys = layout(&geometry, &snapshot, &state, &options());
        assert_eq!(keys[0].role, Role::Status);
        assert_eq!(keys[1].role, Role::VolumeToggle);
        assert_eq!(keys[8].role, Role::Reply);
        // Dial pages exist, but the strip swipe pages them: no DIALS key.
        assert_eq!(encoder_page_count(&geometry, 20), 4);
        assert!(!keys.iter().any(|key| key.role == Role::NextEncoderPage));
        assert!(!keys.iter().any(|key| key.role == Role::NextPage));
        assert_eq!(keys[9].role, Role::Target(TargetKey::User(0)));
        assert_eq!(keys[17].role, Role::Target(TargetKey::Feed(8)));
        assert_eq!(keys[27].role, Role::Target(TargetKey::User(18)));
        let encoders = encoder_bindings(&geometry, &state, &snapshot);
        assert_eq!(encoders.len(), 6);
        assert_eq!(binding_target(encoders[0]), Some(TargetKey::User(0)));
        assert_eq!(binding_target(encoders[5]), Some(TargetKey::Feed(5)));
        state.encoder_page = 3;
        let encoders = encoder_bindings(&geometry, &state, &snapshot);
        assert_eq!(binding_target(encoders[0]), Some(TargetKey::User(18)));
        assert_eq!(binding_target(encoders[1]), Some(TargetKey::User(19)));
        assert_eq!(encoders[2], None);
        assert_eq!(encoder_page_count(&geometry, 20), 4);
    }

    #[test]
    fn function_keys_are_hollow_and_intercom_keys_are_cards() {
        let function = |role: Role| {
            matches!(
                role,
                Role::Status
                    | Role::VolumeToggle
                    | Role::MembersToggle
                    | Role::NextPage
                    | Role::NextEncoderPage
                    | Role::VolumeUp
                    | Role::VolumeDown
                    | Role::MuteSelected
            )
        };
        let mut offline = snapshot(14);
        offline.targets[3].online = false;
        let idle = DeckState::default();
        let volume = DeckState {
            volume_layer: true,
            ..DeckState::default()
        };
        for state in [&idle, &volume] {
            for key in layout(&geometry("mk2"), &offline, state, &options()) {
                let background = key.appearance.background;
                if function(key.role) {
                    assert!(
                        [palette::CONTROL, palette::SELECTED].contains(&background),
                        "{:?} should be a function key, got {background:?}",
                        key.role
                    );
                } else if matches!(key.role, Role::Target(_) | Role::Reply) {
                    assert_ne!(background, palette::CONTROL, "{:?} is intercom", key.role);
                }
            }
        }
    }

    #[test]
    fn reply_turns_red_mic_on_while_talking() {
        let mut snapshot = snapshot(3);
        let reply_key = |snapshot: &Snapshot| {
            layout(
                &geometry("mk2"),
                snapshot,
                &DeckState::default(),
                &options(),
            )
            .into_iter()
            .find(|key| key.role == Role::Reply)
            .unwrap()
            .appearance
        };
        assert_eq!(reply_key(&snapshot).title, "REPLY");

        // Talking to one target, e.g. from a GPIO button: red, MIC ON, its name.
        snapshot.talking = true;
        snapshot.targets[0].held = true;
        let reply = reply_key(&snapshot);
        assert_eq!(reply.title, "MIC ON");
        assert_eq!(reply.subtitle, "T0");
        assert_eq!(reply.background, palette::MIC_ON);
        assert_eq!(reply.blink, None);

        // A lock plus a held key: the count instead of a name.
        snapshot.targets[1].locked = true;
        assert_eq!(reply_key(&snapshot).subtitle, "2 targets");

        // Mic off again: back to REPLY.
        snapshot.talking = false;
        snapshot.targets[0].held = false;
        snapshot.targets[1].locked = false;
        let reply = reply_key(&snapshot);
        assert_eq!(reply.title, "REPLY");
        assert_ne!(reply.background, palette::MIC_ON);
    }

    #[test]
    fn reply_shows_conference_not_caller() {
        let mut snapshot = snapshot(2);
        snapshot.targets[1].key = TargetKey::Conference(1);
        snapshot.targets[1].name = "News".into();
        snapshot.reply_target = Some(TargetKey::User(0));
        snapshot.reply_name = Some("jan".into());
        snapshot.targets[0].name = "jan".into();
        snapshot.incoming = vec![crate::state::IncomingInfo {
            from_name: "jan".into(),
            target: Some(TargetKey::Conference(1)),
        }];
        let keys = layout(
            &geometry("neo"),
            &snapshot,
            &DeckState::default(),
            &options(),
        );
        assert_eq!(keys[3].role, Role::Reply);
        assert_eq!(keys[3].appearance.subtitle, "News");
        assert_ne!(keys[3].appearance.subtitle, "jan");
        assert_eq!(keys[3].appearance.background, palette::REPLY);
        assert_eq!(keys[3].appearance.blink, Some(palette::IDLE));
    }

    #[test]
    fn reply_missing_pin_does_not_show_incoming_conference() {
        let mut snapshot = snapshot(2);
        snapshot.targets[1].key = TargetKey::Conference(1);
        snapshot.targets[1].name = "News".into();
        snapshot.incoming = vec![crate::state::IncomingInfo {
            from_name: "jan".into(),
            target: Some(TargetKey::Conference(1)),
        }];
        snapshot.main_target = Some(TargetKey::User(9));
        snapshot.main_unavailable = true;
        snapshot.reply_target = None;
        let keys = layout(
            &geometry("neo"),
            &snapshot,
            &DeckState::default(),
            &options(),
        );
        assert_eq!(keys[3].role, Role::Reply);
        assert_eq!(keys[3].appearance.subtitle, "Unavailable target");
        assert_ne!(keys[3].appearance.subtitle, "News");
        assert_eq!(keys[3].appearance.foreground, palette::OFFLINE_TEXT);
    }

    #[test]
    fn states_change_appearance() {
        let geometry = geometry("xl");
        let state = DeckState::default();
        let mut snapshot = snapshot(3);
        snapshot.targets[0].incoming = true;
        snapshot.targets[1].locked = true;
        snapshot.targets[2].muted = true;
        snapshot.on_air = true;
        snapshot.lock_active = true;
        let keys = layout(&geometry, &snapshot, &state, &options());
        assert_eq!(keys[0].appearance.subtitle, "ON AIR");
        assert_eq!(keys[0].appearance.background, palette::ON_AIR);
        snapshot.on_air = false;
        snapshot.preview = true;
        let keys = layout(&geometry, &snapshot, &state, &options());
        assert_eq!(keys[0].appearance.subtitle, "PREVIEW");
        assert_eq!(keys[0].appearance.background, palette::PREVIEW);
        snapshot.on_air = true;
        let keys = layout(&geometry, &snapshot, &state, &options());
        assert_eq!(keys[0].appearance.subtitle, "ON AIR");
        assert_eq!(keys[0].appearance.background, palette::ON_AIR);
        let first = 8;
        assert_eq!(keys[first].appearance.badge, None);
        assert_eq!(keys[first].appearance.background, palette::INCOMING);
        assert!(keys[first].appearance.blink.is_some());
        assert_eq!(keys[first + 1].appearance.background, palette::LOCKED);
        assert_eq!(keys[first + 2].appearance.background, palette::MUTED);
        assert_eq!(keys[first + 2].appearance.badge, Some(Badge::Muted));
    }

    #[test]
    fn talk_is_purple_and_incoming_audio_is_green() {
        assert_eq!(palette::TALKING, Rgb(139, 92, 246));
        assert_eq!(palette::INCOMING, Rgb(34, 197, 94));
        assert_eq!(palette::RECEIVING, palette::INCOMING);

        let geometry = geometry("xl");
        let state = DeckState::default();
        let mut snapshot = snapshot(3);
        snapshot.targets[0].held = true;
        snapshot.targets[1].incoming = true;
        snapshot.targets[1].receiving = true;
        snapshot.targets[2].held = true;
        snapshot.targets[2].incoming = true;
        snapshot.targets[2].receiving = true;
        let keys = layout(&geometry, &snapshot, &state, &options());
        let first = 8;
        assert_eq!(keys[first].appearance.background, palette::TALKING);
        assert!(keys[first].appearance.blink.is_none());
        assert_eq!(keys[first + 1].appearance.background, palette::INCOMING);
        assert_eq!(keys[first + 1].appearance.badge, None);
        assert_eq!(keys[first + 2].appearance.background, palette::TALKING);
        assert_eq!(
            keys[first + 2].appearance.blink,
            Some(palette::INCOMING),
            "talking while hearing that target blinks purple/green like the web client"
        );
    }

    #[test]
    fn pedal_maps_assignable_left_middle_and_reply_right() {
        let keys = layout(
            &geometry("pedal"),
            &snapshot(2),
            &DeckState::default(),
            &options(),
        );
        assert_eq!(keys[0].role, Role::Target(TargetKey::User(9)));
        assert_eq!(keys[1].role, Role::Target(TargetKey::Conference(1)));
        assert_eq!(keys[2].role, Role::Reply);
        assert_eq!(keys[2].appearance.title, "REPLY");
    }

    #[test]
    fn volume_layer_times_out() {
        let mut state = DeckState {
            volume_layer: true,
            volume_layer_touched: Instant::now() - Duration::from_secs(10),
            ..DeckState::default()
        };
        assert!(state.expire_volume_layer(Duration::from_secs(8)));
        assert!(!state.volume_layer);
    }

    fn conference_snapshot(member_count: usize) -> Snapshot {
        let mut snapshot = snapshot(2);
        snapshot.targets.push(TargetInfo {
            key: TargetKey::Conference(1),
            name: "News".into(),
            can_talk: true,
            online: true,
            held: false,
            locked: false,
            incoming: false,
            receiving: false,
            volume: 0.8,
            muted: false,
            members: (0..member_count)
                .map(|i| crate::state::ConferenceMemberInfo {
                    user_id: i as i64,
                    name: format!("M{i}"),
                    online: i.is_multiple_of(2),
                    receiving: i == 0,
                    volume: 0.8,
                    muted: i == 1,
                })
                .collect(),
        });
        snapshot
    }

    fn member_state(selected: Option<i64>) -> DeckState {
        DeckState {
            member_layer: true,
            member_conference: Some(TargetKey::Conference(1)),
            member_selected: selected,
            ..DeckState::default()
        }
    }

    #[test]
    fn members_key_only_on_wide_command_rows() {
        assert!(has_members_command_key(&geometry("mk2")));
        assert!(has_members_command_key(&geometry("xl")));
        assert!(has_members_command_key(&geometry("plusxl")));
        assert!(!has_members_command_key(&geometry("neo")));
        assert!(!has_members_command_key(&geometry("plus")));
        assert!(!has_members_command_key(&geometry("mini")));
        assert!(!volume_toggle_defers_to_release(&geometry("mk2")));
        assert!(volume_toggle_defers_to_release(&geometry("neo")));
        assert!(volume_toggle_defers_to_release(&geometry("plus")));
        let neo = roles("neo", 3, &DeckState::default());
        assert_eq!(neo[2], Role::Empty);
        assert!(!neo.contains(&Role::MembersToggle));
        let plus = roles("plus", 3, &DeckState::default());
        assert!(!plus.contains(&Role::MembersToggle));
        let xl = roles("xl", 3, &DeckState::default());
        assert_eq!(xl[2], Role::MembersToggle);
        let plusxl = layout(
            &geometry("plusxl"),
            &snapshot(20),
            &DeckState::default(),
            &options(),
        );
        assert_eq!(plusxl[2].role, Role::MembersToggle);
        assert!(!plusxl.iter().any(|key| key.role == Role::NextEncoderPage));
    }

    #[test]
    fn member_layer_overlays_command_row_with_members() {
        let snapshot = conference_snapshot(3);
        let state = member_state(Some(0));
        let keys = layout(&geometry("neo"), &snapshot, &state, &options());
        assert_eq!(keys[0].role, Role::MembersToggle);
        assert_eq!(keys[1].role, Role::MuteSelected);
        assert_eq!(keys[2].role, Role::VolumeDown);
        assert_eq!(keys[3].role, Role::VolumeUp);
        assert_eq!(
            keys[4].role,
            Role::Member {
                conference: TargetKey::Conference(1),
                user_id: 0
            }
        );
        assert_eq!(
            keys[5].role,
            Role::Member {
                conference: TargetKey::Conference(1),
                user_id: 1
            }
        );
        assert_eq!(
            keys[6].role,
            Role::Member {
                conference: TargetKey::Conference(1),
                user_id: 2
            }
        );
        assert_eq!(keys[7].role, Role::Empty);
        assert_eq!(keys[4].appearance.background, palette::SELECTED);
        assert_eq!(keys[4].appearance.bar, Some(0.8));
        assert_eq!(keys[5].appearance.badge, Some(Badge::Muted));
        assert_eq!(keys[1].appearance.title, "MUTE");
        assert_eq!(keys[1].appearance.subtitle, "M0");
        assert_eq!(keys[0].appearance.footer, "back");
    }

    #[test]
    fn mk2_member_layer_keeps_reply() {
        let snapshot = conference_snapshot(2);
        let keys = layout(
            &geometry("mk2"),
            &snapshot,
            &member_state(Some(1)),
            &options(),
        );
        assert_eq!(keys[0].role, Role::MembersToggle);
        assert_eq!(keys[1].role, Role::MuteSelected);
        assert_eq!(keys[2].role, Role::VolumeDown);
        assert_eq!(keys[3].role, Role::VolumeUp);
        assert_eq!(keys[4].role, Role::Reply);
        assert_eq!(keys[1].appearance.title, "HEAR");
        assert_eq!(keys[1].appearance.subtitle, "M1");
        let first = 5;
        assert_eq!(
            keys[first].role,
            Role::Member {
                conference: TargetKey::Conference(1),
                user_id: 0
            }
        );
    }

    #[test]
    fn mk2_member_layer_reads_left_to_right_top_to_bottom() {
        let snapshot = conference_snapshot(6);
        let keys = layout(
            &geometry("mk2"),
            &snapshot,
            &member_state(Some(0)),
            &options(),
        );
        assert_eq!(
            keys[5].role,
            Role::Member {
                conference: TargetKey::Conference(1),
                user_id: 0
            }
        );
        assert_eq!(
            keys[9].role,
            Role::Member {
                conference: TargetKey::Conference(1),
                user_id: 4
            }
        );
        assert_eq!(
            keys[10].role,
            Role::Member {
                conference: TargetKey::Conference(1),
                user_id: 5
            }
        );
        assert_eq!(keys[11].role, Role::Empty);
    }

    #[test]
    fn member_layer_pages_members_not_destinations() {
        let geometry = geometry("neo");
        let snapshot = conference_snapshot(5);
        let mut state = member_state(Some(0));
        assert_eq!(page_count(&geometry, snapshot.targets[2].members.len()), 2);
        let keys = layout(&geometry, &snapshot, &state, &options());
        assert_eq!(
            keys[7].role,
            Role::Member {
                conference: TargetKey::Conference(1),
                user_id: 3
            }
        );
        state.member_page = 1;
        let keys = layout(&geometry, &snapshot, &state, &options());
        assert_eq!(
            keys[4].role,
            Role::Member {
                conference: TargetKey::Conference(1),
                user_id: 4
            }
        );
        assert_eq!(keys[5].role, Role::Empty);
    }

    #[test]
    fn member_and_volume_layers_are_exclusive() {
        let snapshot = conference_snapshot(2);
        let mut state = DeckState {
            volume_layer: true,
            selected: Some(TargetKey::User(0)),
            ..DeckState::default()
        };
        assert!(state.open_member_layer(&snapshot, Some(TargetKey::Conference(1))));
        assert!(state.member_layer);
        assert!(!state.volume_layer);
        assert_eq!(state.member_selected, Some(0));
        state.toggle_volume_layer(&snapshot);
        assert!(state.volume_layer);
        assert!(!state.member_layer);
        let mut expired = DeckState {
            member_layer: true,
            member_layer_touched: Instant::now() - Duration::from_secs(10),
            ..DeckState::default()
        };
        assert!(expired.expire_member_layer(Duration::from_secs(8)));
        assert!(!expired.member_layer);
    }

    #[test]
    fn default_conference_prefers_held_then_populated() {
        let mut snapshot = conference_snapshot(0);
        snapshot.targets.push(TargetInfo {
            key: TargetKey::Conference(2),
            name: "Sport".into(),
            can_talk: true,
            online: true,
            held: false,
            locked: false,
            incoming: false,
            receiving: false,
            volume: 0.5,
            muted: false,
            members: vec![crate::state::ConferenceMemberInfo {
                user_id: 9,
                name: "Jan".into(),
                online: true,
                receiving: false,
                volume: 1.0,
                muted: false,
            }],
        });
        assert_eq!(
            default_member_conference(&snapshot, None),
            Some(TargetKey::Conference(2))
        );
        snapshot.targets[2].held = true;
        assert_eq!(
            default_member_conference(&snapshot, None),
            Some(TargetKey::Conference(1))
        );
        assert_eq!(
            default_member_conference(&snapshot, Some(TargetKey::Conference(2))),
            Some(TargetKey::Conference(2))
        );
    }

    #[test]
    fn plus_member_layer_binds_dials_to_members() {
        let geometry = geometry("plus");
        let snapshot = conference_snapshot(3);
        let state = member_state(Some(0));
        let bindings = encoder_bindings(&geometry, &state, &snapshot);
        assert_eq!(bindings.len(), 4);
        match bindings[0] {
            Some(EncoderBinding::Member { conference, member }) => {
                assert_eq!(conference, TargetKey::Conference(1));
                assert_eq!(member.user_id, 0);
            }
            other => panic!("expected member binding, got {other:?}"),
        }
        assert!(matches!(
            bindings[2],
            Some(EncoderBinding::Member { member, .. }) if member.user_id == 2
        ));
        assert_eq!(bindings[3], None);
    }

    #[test]
    fn system_main_volume_is_only_in_vol_and_keeps_target_and_dial_paging_aligned() {
        let mut snapshot = snapshot(12);
        snapshot.system_volume = Some(crate::audio::system_volume::SystemVolume {
            volume: 0.42,
            muted: false,
            mute_supported: true,
            control: "Master".into(),
        });
        for model in ["mini", "mk2", "plus", "xl"] {
            let geometry = geometry(model);
            let mut state = DeckState::default();
            let options = LayoutOptions::default();
            assert!(!layout(&geometry, &snapshot, &state, &options)
                .iter()
                .any(|k| k.role == Role::SystemVolume));
            state.toggle_volume_layer(&snapshot);
            let keys = layout(&geometry, &snapshot, &state, &options);
            let main = keys.iter().find(|k| k.role == Role::SystemVolume).unwrap();
            assert_eq!(main.appearance.title, "MAIN");
            assert_eq!(main.appearance.subtitle, "42%");
            assert!(state.system_volume_selected);
            assert_eq!(main.appearance.background, palette::SELECTED);
            assert!(keys
                .iter()
                .filter(|key| matches!(key.role, Role::Target(_)))
                .all(|key| key.appearance.background != palette::SELECTED));
            // Selecting a target replaces MAIN; selecting MAIN again replaces
            // the remembered target without losing its selection for later.
            state.system_volume_selected = false;
            let target_keys = layout(&geometry, &snapshot, &state, &options);
            assert_eq!(
                target_keys
                    .iter()
                    .filter(|key| matches!(key.role, Role::Target(_))
                        && key.appearance.background == palette::SELECTED)
                    .count(),
                1
            );
            assert_ne!(
                target_keys
                    .iter()
                    .find(|key| key.role == Role::SystemVolume)
                    .unwrap()
                    .appearance
                    .background,
                palette::SELECTED
            );
            state.system_volume_selected = true;
            let main_keys = layout(&geometry, &snapshot, &state, &options);
            assert_eq!(
                main_keys
                    .iter()
                    .filter(
                        |key| matches!(key.role, Role::Target(_) | Role::SystemVolume)
                            && key.appearance.background == palette::SELECTED
                    )
                    .count(),
                1
            );
            let capacity = target_slots(&geometry).len();
            assert_eq!(
                layer_page_counts(&geometry, &snapshot, &state).0,
                13_usize.div_ceil(capacity)
            );
            if model == "plus" {
                let bindings = encoder_bindings(&geometry, &state, &snapshot);
                assert!(matches!(bindings[0], Some(EncoderBinding::SystemVolume(_))));
                assert!(
                    matches!(bindings[1], Some(EncoderBinding::Target(t)) if t.key == snapshot.targets[0].key)
                );
                state.page = 1;
                let bindings = encoder_bindings(&geometry, &state, &snapshot);
                assert!(
                    matches!(bindings[0], Some(EncoderBinding::Target(t)) if t.key == snapshot.targets[3].key)
                );
            }
        }
    }

    #[test]
    fn main_control_disappears_when_output_has_no_hardware_volume() {
        let snapshot = snapshot(2);
        let geometry = geometry("plus");
        let mut state = DeckState {
            volume_layer: true,
            system_volume_selected: true,
            ..DeckState::default()
        };
        state.clamp_pages(&geometry, &snapshot);
        assert!(!state.system_volume_selected);
        assert!(
            !layout(&geometry, &snapshot, &state, &LayoutOptions::default())
                .iter()
                .any(|k| k.role == Role::SystemVolume)
        );
    }
}
