//! Target identities, the hold/tap/lock talk model and per-target audio state.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::state::{InputSource, TargetRef};

/// A routable Talktome target. Feeds are listen-only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum TargetKey {
    User(i64),
    Conference(i64),
    Feed(i64),
}

impl TargetKey {
    /// Parses `user:4`, `conference:1`, `feed:2` (also `conf:1`).
    pub fn parse(text: &str) -> Option<Self> {
        let (kind, id) = text.trim().split_once(':')?;
        let id: i64 = id.trim().parse().ok()?;
        match kind.trim().to_ascii_lowercase().as_str() {
            "user" => Some(TargetKey::User(id)),
            "conference" | "conf" => Some(TargetKey::Conference(id)),
            "feed" => Some(TargetKey::Feed(id)),
            _ => None,
        }
    }

    pub fn from_type_and_id(kind: &str, id: &Value) -> Option<Self> {
        let id = match id {
            Value::Number(n) => n.as_i64()?,
            Value::String(s) => s.trim().parse().ok()?,
            _ => return None,
        };
        match kind.to_ascii_lowercase().as_str() {
            "user" => Some(TargetKey::User(id)),
            "conference" => Some(TargetKey::Conference(id)),
            "feed" => Some(TargetKey::Feed(id)),
            _ => None,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            TargetKey::User(_) => "user",
            TargetKey::Conference(_) => "conference",
            TargetKey::Feed(_) => "feed",
        }
    }

    pub fn id(&self) -> i64 {
        match self {
            TargetKey::User(id) | TargetKey::Conference(id) | TargetKey::Feed(id) => *id,
        }
    }

    pub fn can_talk(&self) -> bool {
        !matches!(self, TargetKey::Feed(_))
    }

    /// The `{ type, id }` object used in `talk-targets-updated` / `ptt-state`.
    pub fn to_talk_target(self) -> Value {
        json!({ "type": self.kind(), "id": self.id() })
    }
}

impl fmt::Display for TargetKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}", self.kind(), self.id())
    }
}

/// Result of a talk-model change: what the session must tell the server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TalkChange {
    /// Targets to send in `talk-targets-updated` (empty = stop talking).
    pub targets: Vec<TargetKey>,
    pub talking: bool,
    pub lock_active: bool,
    /// The lock state toggled by this action, if any.
    pub lock_toggled: Option<(TargetKey, bool)>,
}

#[derive(Debug, Clone)]
struct HeldKey {
    since: Instant,
    /// True when pressing this key unlocked the target; a short release
    /// must then not lock it again.
    unlocked_on_press: bool,
}

/// Hold = talk while held, tap = toggle lock; reply resolves to the Main pin
/// when configured, otherwise the last incoming reply, at press time.
#[derive(Debug, Clone)]
pub struct TalkModel {
    tap_ms: u64,
    lock_multiple: bool,
    held: HashMap<(InputSource, TargetRef), (TargetKey, HeldKey)>,
    locked: BTreeSet<TargetKey>,
    reply_target: Option<TargetKey>,
    /// Configured Main / Reply pin (`talk.main_target`).
    main_target: Option<TargetKey>,
    /// Pin is in this user's assigned talk destinations. Offline is separate.
    main_available: bool,
    vox_target: Option<TargetKey>,
    vox_active: bool,
}

impl TalkModel {
    pub fn new(tap_ms: u64, lock_multiple: bool) -> Self {
        Self {
            tap_ms,
            lock_multiple,
            held: HashMap::new(),
            locked: BTreeSet::new(),
            reply_target: None,
            main_target: None,
            main_available: false,
            vox_target: None,
            vox_active: false,
        }
    }

    pub fn set_reply_target(&mut self, target: Option<TargetKey>) {
        self.reply_target = target;
    }

    pub fn set_main_target(&mut self, target: Option<TargetKey>) {
        self.main_target = target;
        if self.main_target.is_none() {
            self.main_available = false;
        }
    }

    pub fn set_main_available(&mut self, available: bool) {
        self.main_available = available && self.main_target.is_some();
    }

    pub fn main_target(&self) -> Option<TargetKey> {
        self.main_target
    }

    /// Pin is set but not in the assigned destination list (no fallback).
    pub fn main_unavailable(&self) -> bool {
        self.main_target.is_some() && !self.main_available
    }

    /// Destination Reply / Main talks to: the pin when assigned, otherwise
    /// last incoming. A missing pin returns `None` rather than another target.
    pub fn effective_reply(&self) -> Option<TargetKey> {
        match self.main_target {
            Some(key) if self.main_available => Some(key),
            Some(_) => None,
            None => self.reply_target(),
        }
    }

    /// Prefer a conference when someone is addressing us in one, matching the
    /// web client (Reply talks to the conference, not the caller).
    pub fn resolve_reply_target(
        parsed: Option<TargetKey>,
        incoming: impl IntoIterator<Item = Option<TargetKey>>,
    ) -> Option<TargetKey> {
        let conference = incoming
            .into_iter()
            .flatten()
            .find(|key| matches!(key, TargetKey::Conference(_)));
        match parsed {
            Some(TargetKey::Conference(_)) => parsed,
            _ => conference.or(parsed),
        }
    }

    pub fn reply_target(&self) -> Option<TargetKey> {
        self.reply_target
    }

    pub fn set_vox_target(&mut self, target: Option<TargetKey>) {
        self.vox_target = target;
    }

    pub fn vox_target(&self) -> Option<TargetKey> {
        self.vox_target
    }

    pub fn lock_multiple(&self) -> bool {
        self.lock_multiple
    }

    pub fn set_lock_multiple(&mut self, enabled: bool) {
        self.lock_multiple = enabled;
    }

    pub fn locked(&self) -> &BTreeSet<TargetKey> {
        &self.locked
    }

    pub fn is_locked(&self, key: TargetKey) -> bool {
        self.locked.contains(&key)
    }

    pub fn is_held(&self, key: TargetKey) -> bool {
        self.held.values().any(|(k, _)| *k == key)
    }

    pub fn is_talking(&self) -> bool {
        !self.active_targets().is_empty()
    }

    /// Union of held, locked and (when active) the VOX target.
    pub fn active_targets(&self) -> Vec<TargetKey> {
        let mut set: BTreeSet<TargetKey> = self.locked.clone();
        for (key, _) in self.held.values() {
            set.insert(*key);
        }
        if self.vox_active {
            if let Some(target) = self.vox_target {
                set.insert(target);
            }
        }
        set.into_iter().filter(|k| k.can_talk()).collect()
    }

    fn resolve(&self, target: TargetRef) -> Option<TargetKey> {
        match target {
            TargetRef::Key(key) => key.can_talk().then_some(key),
            TargetRef::Reply => self.effective_reply(),
        }
    }

    fn change(&self, lock_toggled: Option<(TargetKey, bool)>) -> TalkChange {
        let targets = self.active_targets();
        TalkChange {
            talking: !targets.is_empty(),
            targets,
            lock_active: !self.locked.is_empty(),
            lock_toggled,
        }
    }

    /// Returns `None` when the target cannot be talked to (unknown reply
    /// target, feed) so the caller can flash an error.
    pub fn press(
        &mut self,
        source: InputSource,
        target: TargetRef,
        now: Instant,
    ) -> Option<TalkChange> {
        let key = self.resolve(target)?;
        let unlocked_on_press = self.locked.remove(&key);
        self.held.insert(
            (source, target),
            (
                key,
                HeldKey {
                    since: now,
                    unlocked_on_press,
                },
            ),
        );
        Some(self.change(unlocked_on_press.then_some((key, false))))
    }

    pub fn release(
        &mut self,
        source: InputSource,
        target: TargetRef,
        now: Instant,
    ) -> Option<TalkChange> {
        let (key, held) = self.held.remove(&(source, target))?;
        let mut toggled = None;
        if now.duration_since(held.since) < Duration::from_millis(self.tap_ms)
            && !held.unlocked_on_press
        {
            self.lock(key);
            toggled = Some((key, true));
        }
        Some(self.change(toggled))
    }

    fn lock(&mut self, key: TargetKey) {
        if !self.lock_multiple {
            self.locked.clear();
        }
        self.locked.insert(key);
    }

    pub fn toggle_lock(&mut self, target: TargetRef) -> Option<TalkChange> {
        let key = self.resolve(target)?;
        let now_locked = if self.locked.remove(&key) {
            false
        } else {
            self.lock(key);
            true
        };
        Some(self.change(Some((key, now_locked))))
    }

    /// Releases every key `source` holds, without the tap-to-lock rule: the
    /// admin remote panel sends its own `lock` after a tap.
    pub fn release_source(&mut self, source: &InputSource) -> Option<TalkChange> {
        let before = self.held.len();
        self.held.retain(|(held_by, _), _| held_by != source);
        (self.held.len() != before).then(|| self.change(None))
    }

    /// Locks or unlocks a target. `None` when it is already in that state or
    /// cannot be talked to.
    pub fn set_lock(&mut self, target: TargetRef, locked: bool) -> Option<TalkChange> {
        let key = self.resolve(target)?;
        if self.locked.contains(&key) == locked {
            return None;
        }
        if locked {
            self.lock(key);
        } else {
            self.locked.remove(&key);
        }
        Some(self.change(Some((key, locked))))
    }

    /// Stops all held and locked talk; an active VOX keeps talking.
    pub fn stop(&mut self) -> TalkChange {
        self.held.clear();
        self.locked.clear();
        self.change(None)
    }

    pub fn clear_locks(&mut self) -> TalkChange {
        self.locked.clear();
        self.change(None)
    }

    /// Drops everything (used when the session is lost).
    pub fn reset(&mut self) -> TalkChange {
        self.held.clear();
        self.locked.clear();
        self.vox_active = false;
        self.change(None)
    }

    /// Drop held/locked user keys that are no longer available (offline).
    pub fn drop_unavailable(
        &mut self,
        mut available: impl FnMut(TargetKey) -> bool,
    ) -> Option<TalkChange> {
        let before = self.change(None);
        self.held.retain(|_, (key, _)| available(*key));
        self.locked.retain(|key| available(*key));
        let after = self.change(None);
        (before != after).then_some(after)
    }

    pub fn set_vox_active(&mut self, active: bool) -> Option<TalkChange> {
        if self.vox_active == active || self.vox_target.is_none() {
            return None;
        }
        self.vox_active = active;
        Some(self.change(None))
    }
}

/// Per-target volume/mute, persisted per instance.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AudioLevel {
    pub volume: f32,
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AudioStateFile {
    levels: BTreeMap<String, AudioLevel>,
    #[serde(default)]
    members: BTreeMap<String, AudioLevel>,
}

#[derive(Debug, Clone)]
pub struct AudioState {
    default_volume: f32,
    levels: BTreeMap<TargetKey, AudioLevel>,
    members: BTreeMap<(i64, i64), AudioLevel>,
    path: Option<PathBuf>,
}

fn member_state_key(conference_id: i64, user_id: i64) -> String {
    format!("conference:{conference_id}/user:{user_id}")
}

fn parse_member_state_key(text: &str) -> Option<(i64, i64)> {
    let (conference, user) = text.split_once('/')?;
    match (TargetKey::parse(conference), TargetKey::parse(user)) {
        (Some(TargetKey::Conference(conference_id)), Some(TargetKey::User(user_id))) => {
            Some((conference_id, user_id))
        }
        _ => None,
    }
}

impl AudioState {
    pub fn new(default_volume: f32) -> Self {
        Self {
            default_volume,
            levels: BTreeMap::new(),
            members: BTreeMap::new(),
            path: None,
        }
    }

    /// Loads persisted levels from `<state_dir>/audio-state.json` if present.
    pub fn load(state_dir: &Path, default_volume: f32) -> Self {
        let path = state_dir.join("audio-state.json");
        let mut state = Self::new(default_volume);
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(file) = serde_json::from_str::<AudioStateFile>(&text) {
                for (key, level) in file.levels {
                    if let Some(key) = TargetKey::parse(&key) {
                        state.levels.insert(key, level);
                    }
                }
                for (key, level) in file.members {
                    if let Some(pair) = parse_member_state_key(&key) {
                        state.members.insert(pair, level);
                    }
                }
            }
        }
        state.path = Some(path);
        state
    }

    pub fn level(&self, key: TargetKey) -> AudioLevel {
        self.levels.get(&key).cloned().unwrap_or(AudioLevel {
            volume: self.default_volume,
            muted: false,
        })
    }

    pub fn set_volume(&mut self, key: TargetKey, volume: f32) -> AudioLevel {
        let mut level = self.level(key);
        level.volume = volume.clamp(0.0, 1.0);
        self.levels.insert(key, level.clone());
        level
    }

    pub fn set_level(
        &mut self,
        key: TargetKey,
        volume: Option<f32>,
        muted: Option<bool>,
    ) -> AudioLevel {
        let mut level = self.level(key);
        if let Some(volume) = volume {
            level.volume = volume.clamp(0.0, 1.0);
        }
        if let Some(muted) = muted {
            level.muted = muted;
        }
        self.levels.insert(key, level.clone());
        level
    }

    pub fn step_volume(&mut self, key: TargetKey, delta: f32) -> AudioLevel {
        let current = self.level(key).volume;
        // Round to two decimals so repeated steps stay on clean values.
        let next = ((current + delta) * 100.0).round() / 100.0;
        self.set_volume(key, next)
    }

    pub fn toggle_mute(&mut self, key: TargetKey) -> AudioLevel {
        let mut level = self.level(key);
        level.muted = !level.muted;
        self.levels.insert(key, level.clone());
        level
    }

    pub fn member_level(&self, conference_id: i64, user_id: i64) -> AudioLevel {
        self.members
            .get(&(conference_id, user_id))
            .cloned()
            .unwrap_or(AudioLevel {
                volume: 1.0,
                muted: false,
            })
    }

    pub fn set_member_volume(
        &mut self,
        conference_id: i64,
        user_id: i64,
        volume: f32,
    ) -> AudioLevel {
        let mut level = self.member_level(conference_id, user_id);
        level.volume = volume.clamp(0.0, 1.0);
        self.members.insert((conference_id, user_id), level.clone());
        level
    }

    pub fn toggle_member_mute(&mut self, conference_id: i64, user_id: i64) -> AudioLevel {
        let mut level = self.member_level(conference_id, user_id);
        level.muted = !level.muted;
        self.members.insert((conference_id, user_id), level.clone());
        level
    }

    pub fn iter_levels(&self) -> impl Iterator<Item = (TargetKey, AudioLevel)> + '_ {
        self.levels.iter().map(|(k, v)| (*k, v.clone()))
    }

    pub fn iter_members(&self) -> impl Iterator<Item = ((i64, i64), AudioLevel)> + '_ {
        self.members.iter().map(|(k, v)| (*k, v.clone()))
    }

    /// Entries for `target-audio-state-snapshot`, restricted to known targets.
    pub fn snapshot_entries<'a, I>(&self, targets: I) -> Vec<Value>
    where
        I: IntoIterator<Item = &'a TargetKey>,
    {
        targets
            .into_iter()
            .map(|key| {
                let level = self.level(*key);
                json!({
                    "targetType": key.kind(),
                    "targetId": key.id(),
                    "volume": level.volume,
                    "muted": level.muted,
                })
            })
            .collect()
    }

    pub fn save(&self) -> std::io::Result<()> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = AudioStateFile {
            levels: self
                .levels
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
            members: self
                .members
                .iter()
                .map(|((conference_id, user_id), v)| {
                    (member_state_key(*conference_id, *user_id), v.clone())
                })
                .collect(),
        };
        let text = serde_json::to_string_pretty(&file).map_err(std::io::Error::other)?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, text)?;
        std::fs::rename(tmp, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn deck(n: u8) -> InputSource {
        InputSource::StreamDeck { device: 0, key: n }
    }

    #[test]
    fn hold_talks_and_tap_locks() {
        let mut model = TalkModel::new(250, false);
        let t0 = Instant::now();
        let conf = TargetKey::Conference(1);
        let change = model.press(deck(1), TargetRef::Key(conf), t0).unwrap();
        assert!(change.talking);
        assert_eq!(change.targets, vec![conf]);

        // Long hold: release after 600 ms stops talking.
        let change = model
            .release(
                deck(1),
                TargetRef::Key(conf),
                t0 + Duration::from_millis(600),
            )
            .unwrap();
        assert!(!change.talking);
        assert!(!change.lock_active);

        // Tap: release within 250 ms locks and keeps talking.
        model.press(deck(1), TargetRef::Key(conf), t0).unwrap();
        let change = model
            .release(
                deck(1),
                TargetRef::Key(conf),
                t0 + Duration::from_millis(100),
            )
            .unwrap();
        assert!(change.talking);
        assert!(change.lock_active);
        assert_eq!(change.lock_toggled, Some((conf, true)));
        assert!(model.is_locked(conf));

        // Tap again: unlocks on press and stays unlocked after release.
        let change = model.press(deck(1), TargetRef::Key(conf), t0).unwrap();
        assert!(change.talking, "still held");
        assert_eq!(change.lock_toggled, Some((conf, false)));
        let change = model
            .release(
                deck(1),
                TargetRef::Key(conf),
                t0 + Duration::from_millis(50),
            )
            .unwrap();
        assert!(!change.talking);
        assert!(!model.is_locked(conf));
    }

    #[test]
    fn single_lock_mode_replaces_previous_lock() {
        let mut model = TalkModel::new(250, false);
        let a = TargetKey::User(2);
        let b = TargetKey::User(3);
        model.toggle_lock(TargetRef::Key(a)).unwrap();
        let change = model.toggle_lock(TargetRef::Key(b)).unwrap();
        assert_eq!(change.targets, vec![b]);

        let mut multi = TalkModel::new(250, true);
        multi.toggle_lock(TargetRef::Key(a)).unwrap();
        let change = multi.toggle_lock(TargetRef::Key(b)).unwrap();
        assert_eq!(change.targets, vec![a, b]);
        let change = multi.clear_locks();
        assert!(!change.talking);
    }

    #[test]
    fn reply_and_feeds() {
        let mut model = TalkModel::new(250, false);
        assert!(model
            .press(deck(0), TargetRef::Reply, Instant::now())
            .is_none());
        model.set_reply_target(Some(TargetKey::User(7)));
        let change = model
            .press(deck(0), TargetRef::Reply, Instant::now())
            .unwrap();
        assert_eq!(change.targets, vec![TargetKey::User(7)]);
        assert!(model
            .press(deck(2), TargetRef::Key(TargetKey::Feed(1)), Instant::now())
            .is_none());
    }

    #[test]
    fn pinned_main_target_does_not_fall_back() {
        let mut model = TalkModel::new(250, false);
        let t0 = Instant::now();
        let incoming = TargetKey::User(3);
        let pin = TargetKey::User(7);
        model.set_reply_target(Some(incoming));
        model.set_main_target(Some(pin));
        model.set_main_available(true);
        let change = model.press(deck(0), TargetRef::Reply, t0).unwrap();
        assert_eq!(change.targets, vec![pin]);
        model
            .release(deck(0), TargetRef::Reply, t0 + Duration::from_millis(600))
            .unwrap();

        model.set_main_available(false);
        assert!(model
            .press(deck(0), TargetRef::Reply, Instant::now())
            .is_none());
        assert_eq!(model.reply_target(), Some(incoming));
        assert!(model.main_unavailable());
        assert_eq!(model.effective_reply(), None);

        model.set_main_target(None);
        let change = model
            .press(deck(0), TargetRef::Reply, Instant::now())
            .unwrap();
        assert_eq!(change.targets, vec![incoming]);
    }

    #[test]
    fn resolve_reply_prefers_conference_over_caller() {
        let conference = Some(TargetKey::Conference(1));
        let caller = Some(TargetKey::User(7));
        assert_eq!(
            TalkModel::resolve_reply_target(caller, [conference]),
            conference
        );
        assert_eq!(
            TalkModel::resolve_reply_target(conference, [caller]),
            conference
        );
        assert_eq!(TalkModel::resolve_reply_target(caller, [caller]), caller);
        assert_eq!(
            TalkModel::resolve_reply_target(None, [conference]),
            conference
        );
    }

    #[test]
    fn panel_release_never_locks_and_lock_is_explicit() {
        let mut model = TalkModel::new(250, false);
        let conf = TargetKey::Conference(1);
        let panel = InputSource::Companion("panel:a:main".into());
        let now = Instant::now();
        model
            .press(panel.clone(), TargetRef::Key(conf), now)
            .unwrap();
        // A tap: the panel releases and then sends its own lock.
        let change = model.release_source(&panel).unwrap();
        assert!(!change.talking);
        assert!(model.release_source(&panel).is_none());
        let change = model.set_lock(TargetRef::Key(conf), true).unwrap();
        assert_eq!(change.lock_toggled, Some((conf, true)));
        assert!(model.set_lock(TargetRef::Key(conf), true).is_none());
        assert!(model.is_talking());
        let change = model.stop();
        assert!(!change.talking && !change.lock_active);
    }

    #[test]
    fn sources_are_independent_and_vox_adds_target() {
        let mut model = TalkModel::new(250, true);
        let conf = TargetKey::Conference(1);
        let now = Instant::now();
        model.press(deck(1), TargetRef::Key(conf), now).unwrap();
        model
            .press(
                InputSource::Companion("k".into()),
                TargetRef::Key(conf),
                now,
            )
            .unwrap();
        let change = model
            .release(
                InputSource::Companion("k".into()),
                TargetRef::Key(conf),
                now + Duration::from_secs(1),
            )
            .unwrap();
        assert!(change.talking, "deck still holds the key");
        let change = model
            .release(deck(1), TargetRef::Key(conf), now + Duration::from_secs(2))
            .unwrap();
        assert!(!change.talking);

        model.set_vox_target(Some(TargetKey::User(5)));
        let change = model.set_vox_active(true).unwrap();
        assert_eq!(change.targets, vec![TargetKey::User(5)]);
        assert!(model.set_vox_active(true).is_none());
        let change = model.reset();
        assert!(!change.talking);
    }

    #[test]
    fn audio_state_steps_and_persists() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = AudioState::load(dir.path(), 0.9);
        let key = TargetKey::Feed(3);
        assert_eq!(state.level(key).volume, 0.9);
        assert_eq!(state.step_volume(key, -0.1).volume, 0.8);
        assert_eq!(state.step_volume(key, 0.5).volume, 1.0);
        assert!(state.toggle_mute(key).muted);
        state.save().unwrap();

        let reloaded = AudioState::load(dir.path(), 0.5);
        assert_eq!(
            reloaded.level(key),
            AudioLevel {
                volume: 1.0,
                muted: true
            }
        );
        assert_eq!(reloaded.level(TargetKey::User(1)).volume, 0.5);
        let mut members = AudioState::load(dir.path(), 0.9);
        members.set_member_volume(3, 7, 0.25);
        members.toggle_member_mute(3, 7);
        members.save().unwrap();
        let reloaded_members = AudioState::load(dir.path(), 0.9);
        assert_eq!(
            reloaded_members.member_level(3, 7),
            AudioLevel {
                volume: 0.25,
                muted: true
            }
        );
        let entries = reloaded.snapshot_entries([key].iter());
        assert_eq!(entries[0]["targetType"], "feed");
        assert_eq!(entries[0]["muted"], true);
    }

    #[test]
    fn parses_and_formats_keys() {
        assert_eq!(TargetKey::parse("user:4"), Some(TargetKey::User(4)));
        assert_eq!(TargetKey::parse("conf:1"), Some(TargetKey::Conference(1)));
        assert_eq!(TargetKey::parse("Feed: 7"), Some(TargetKey::Feed(7)));
        assert_eq!(TargetKey::parse("bogus"), None);
        assert_eq!(TargetKey::Conference(3).to_string(), "conference:3");
        assert_eq!(
            TargetKey::from_type_and_id("user", &json!("12")),
            Some(TargetKey::User(12))
        );
        assert!(!TargetKey::Feed(1).can_talk());
    }

    #[test]
    fn drop_unavailable_releases_offline_users() {
        let mut model = TalkModel::new(250, true);
        let t0 = Instant::now();
        let user = TargetKey::User(4);
        let conf = TargetKey::Conference(1);
        model.press(deck(1), TargetRef::Key(user), t0).unwrap();
        model.press(deck(2), TargetRef::Key(conf), t0).unwrap();
        let change = model
            .drop_unavailable(|key| !matches!(key, TargetKey::User(_)))
            .unwrap();
        assert_eq!(change.targets, vec![conf]);
        assert!(change.talking);
    }
}
