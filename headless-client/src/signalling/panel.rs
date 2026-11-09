//! Admin remote control panel (server v1.5.12+): the `panel-client-state`
//! report the server asks for every 2 s while an admin has the panel open.

use serde_json::{json, Value};

use crate::audio::PcmChoice;
use crate::talk::TargetKey;

/// The server keeps at most 64 devices per report, inputs and outputs together.
const MAX_DEVICES_PER_DIRECTION: usize = 32;
/// Same scale as the web client's input meter.
const METER_MIN_DB: f32 = -60.0;

/// Storage keys that carry the browser's audio device choice. A headless
/// client takes its ALSA devices from its own configuration.
const DEVICE_KEYS: [&str; 3] = [
    "preferredAudioInputDeviceId",
    "preferredAudioInputDeviceExplicit",
    "preferredAudioOutputDeviceId",
];

/// `panelSettings` from `register-user` and from each panel command.
#[derive(Debug, Clone, PartialEq)]
pub struct PanelSettings {
    /// Reports and audio snapshots with an older revision are dropped by the
    /// server, so an admin change is not overwritten by stale client state.
    pub revision: u64,
    /// Echoed back unchanged: the server stores whatever storage a report
    /// carries, and the headless client keeps none of these preferences.
    pub storage: Value,
}

impl Default for PanelSettings {
    fn default() -> Self {
        Self {
            revision: 0,
            storage: json!({}),
        }
    }
}

impl PanelSettings {
    pub fn from_json(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        Some(Self {
            revision: object.get("revision").and_then(Value::as_u64).unwrap_or(0),
            storage: object
                .get("storage")
                .filter(|storage| storage.is_object())
                .cloned()
                .unwrap_or_else(|| json!({})),
        })
    }
}

/// The configured device as the panel expects it: empty for the default.
pub fn device_id(configured: &Option<String>) -> String {
    configured
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty() && *id != "default")
        .unwrap_or_default()
        .to_string()
}

/// Device entries for the panel's (read-only) device selects. The device in
/// use comes first so it survives the server's 64-device limit.
pub fn devices(
    inputs: &[PcmChoice],
    outputs: &[PcmChoice],
    input_id: &str,
    output_id: &str,
) -> Vec<Value> {
    let mut entries = direction_entries("audioinput", inputs, input_id);
    entries.extend(direction_entries("audiooutput", outputs, output_id));
    entries
}

fn direction_entries(kind: &str, choices: &[PcmChoice], current: &str) -> Vec<Value> {
    let entry = |id: &str, label: &str| json!({ "kind": kind, "deviceId": id, "label": label });
    let mut entries = Vec::new();
    if !current.is_empty() {
        let label = choices
            .iter()
            .find(|choice| choice.id == current)
            .map(choice_label)
            .unwrap_or_else(|| current.to_string());
        entries.push(entry(current, &label));
    }
    for choice in choices.iter().filter(|choice| choice.id != current) {
        if entries.len() >= MAX_DEVICES_PER_DIRECTION {
            break;
        }
        entries.push(entry(&choice.id, &choice_label(choice)));
    }
    entries
}

fn choice_label(choice: &PcmChoice) -> String {
    if choice.label == choice.id {
        choice.id.clone()
    } else {
        format!("{} — {}", choice.id, choice.label)
    }
}

/// `micLevel` text and `micMeterWidth` (0–100) like the web client's meter.
pub fn mic_meter(level_db: f32) -> (String, f32) {
    if !level_db.is_finite() || level_db <= -100.0 {
        return ("-inf dB".into(), 0.0);
    }
    let rounded = (level_db * 10.0).round() / 10.0;
    let rounded = if rounded == 0.0 { 0.0 } else { rounded };
    let sign = if rounded >= 0.0 { "+" } else { "" };
    let clamped = level_db.clamp(METER_MIN_DB, 0.0);
    let width = (clamped - METER_MIN_DB) / -METER_MIN_DB * 100.0;
    (
        format!("{sign}{rounded:.1} dB"),
        (width * 10.0).round() / 10.0,
    )
}

/// Dim amounts the server accepts (`userAudioSettings.js`).
const DIM_OPTIONS_DB: [f32; 5] = [-6.0, -12.0, -15.0, -18.0, -24.0];

/// Audio settings this client actually runs with, in server terms.
#[derive(Debug, Clone, PartialEq)]
pub struct LocalAudio {
    /// Saved codec profile (`ultra-low`, `low`, `standard`).
    pub profile: String,
    pub auto_processing: bool,
    pub input_gain_db: f32,
    pub dim_db: f32,
    pub dim_feeds_while_speaking: bool,
    pub dim_when_addressed: bool,
    pub play_connection_sounds: bool,
    pub lock_multiple: bool,
    pub vox_enabled: bool,
    pub vox_target: Option<TargetKey>,
    pub vox_threshold_db: f32,
}

/// Settings the panel can change that live in this client's configuration
/// file rather than only on the server: VOX, lock-multiple, codec profile.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ConfigPatch {
    pub profile: Option<String>,
    pub lock_multiple: Option<bool>,
    pub vox_enabled: Option<bool>,
    /// `Some(None)` clears the target.
    pub vox_target: Option<Option<TargetKey>>,
    pub vox_threshold_db: Option<f32>,
}

impl ConfigPatch {
    pub fn from_json(settings: &Value) -> Self {
        Self {
            profile: settings
                .get("audioProfile")
                .and_then(Value::as_str)
                .filter(|p| matches!(*p, "ultra-low" | "low" | "standard"))
                .map(str::to_string),
            lock_multiple: settings.get("lockMultipleTargets").and_then(Value::as_bool),
            vox_enabled: settings.get("voiceTriggerEnabled").and_then(Value::as_bool),
            vox_target: settings
                .get("voiceTriggerTarget")
                .and_then(Value::as_str)
                .map(|t| TargetKey::parse(t.trim()).filter(TargetKey::can_talk)),
            vox_threshold_db: settings
                .get("voiceTriggerThresholdDb")
                .and_then(Value::as_f64)
                .map(|db| db as f32)
                .filter(|db| db.is_finite()),
        }
    }
}

/// The full settings object for `user-audio-settings-update`: the server's
/// values for what a headless client does not use (left-hand mode), ours for
/// everything else, kept inside the ranges the server validates.
pub fn audio_settings(server: &Value, local: &LocalAudio) -> Value {
    let mut settings = server.as_object().cloned().unwrap_or_default();
    let nearest_dim = DIM_OPTIONS_DB
        .iter()
        .copied()
        .min_by(|a, b| {
            (a - local.dim_db)
                .abs()
                .total_cmp(&(b - local.dim_db).abs())
        })
        .unwrap_or(-15.0);
    let ours = json!({
        "audioProfile": local.profile,
        "audioAutoProcessing": local.auto_processing,
        "userInputGainDb": (local.input_gain_db.clamp(-30.0, 40.0) * 2.0).round() / 2.0,
        "dimAmountDb": nearest_dim,
        "dimFeedsWhileSpeaking": local.dim_feeds_while_speaking,
        "dimWhenAddressed": local.dim_when_addressed,
        "playConnectionSounds": local.play_connection_sounds,
        "lockMultipleTargets": local.lock_multiple,
        "voiceTriggerEnabled": local.vox_enabled,
        "voiceTriggerTarget": local.vox_target.map(|t| t.to_string()).unwrap_or_default(),
        "voiceTriggerThresholdDb": local.vox_threshold_db.clamp(-60.0, -6.0).round(),
    });
    if let Value::Object(ours) = ours {
        settings.extend(ours);
    }
    Value::Object(settings)
}

/// True when `reported` (what the server holds) differs from `ours` in a
/// setting this client controls.
pub fn audio_settings_differ(reported: &Value, ours: &Value) -> bool {
    let Some(ours) = ours.as_object() else {
        return false;
    };
    ours.iter()
        .any(|(key, value)| match (reported.get(key), value) {
            (Some(Value::Number(a)), Value::Number(b)) => {
                (a.as_f64().unwrap_or(f64::NAN) - b.as_f64().unwrap_or(f64::NAN)).abs() > 1e-6
            }
            (Some(a), b) => a != b,
            (None, _) => true,
        })
}

/// The device a `preferences` patch asks for: `Some("")` for the default
/// (the key was removed), `None` when the patch does not touch it.
pub fn patch_device(patch: &Value, key: &str) -> Option<String> {
    match patch.get(key)? {
        Value::String(id) => Some(id.trim().to_string()),
        Value::Null => Some(String::new()),
        _ => None,
    }
}

/// The stored preferences with the device keys set to what this client
/// really uses. The server saves a panel device choice before the client
/// answers, and the panel shows these keys, so they must follow the client.
pub fn storage_with_devices(storage: &Value, input: &str, output: &str) -> Value {
    let mut storage = storage.as_object().cloned().unwrap_or_default();
    for key in DEVICE_KEYS {
        storage.remove(key);
    }
    if !input.is_empty() {
        storage.insert("preferredAudioInputDeviceId".into(), json!(input));
        storage.insert("preferredAudioInputDeviceExplicit".into(), json!("true"));
    }
    if !output.is_empty() {
        storage.insert("preferredAudioOutputDeviceId".into(), json!(output));
    }
    Value::Object(storage)
}

/// True when a `preferences` patch tries to change the audio devices.
pub fn patch_changes_devices(patch: &Value) -> bool {
    patch
        .as_object()
        .is_some_and(|patch| DEVICE_KEYS.iter().any(|key| patch.contains_key(*key)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn choice(id: &str, label: &str) -> PcmChoice {
        PcmChoice {
            id: id.into(),
            label: label.into(),
            card: id.contains(':'),
        }
    }

    #[test]
    fn panel_settings_keep_revision_and_storage() {
        let parsed = PanelSettings::from_json(&json!({
            "revision": 4,
            "storage": { "activeProduction:35": "2" }
        }))
        .unwrap();
        assert_eq!(parsed.revision, 4);
        assert_eq!(parsed.storage["activeProduction:35"], "2");
        let empty = PanelSettings::from_json(&json!({ "storage": [] })).unwrap();
        assert_eq!(empty, PanelSettings::default());
        assert!(PanelSettings::from_json(&Value::Null).is_none());
    }

    #[test]
    fn current_device_comes_first_and_lists_are_capped() {
        let inputs: Vec<PcmChoice> = (1..=64)
            .map(|n| choice(&format!("in_ch{n}"), &format!("in_ch{n}")))
            .collect();
        let outputs = vec![choice("hw:CARD=X,DEV=0", "X – Direct hardware device")];
        let list = devices(&inputs, &outputs, "in_ch50", "tone");
        let ins: Vec<&str> = list
            .iter()
            .filter(|d| d["kind"] == "audioinput")
            .map(|d| d["deviceId"].as_str().unwrap())
            .collect();
        assert_eq!(ins.len(), MAX_DEVICES_PER_DIRECTION);
        assert_eq!(ins[0], "in_ch50");
        assert_eq!(ins.iter().filter(|id| **id == "in_ch50").count(), 1);
        let outs: Vec<&Value> = list.iter().filter(|d| d["kind"] == "audiooutput").collect();
        assert_eq!(outs[0]["deviceId"], "tone");
        assert_eq!(
            outs[1]["label"],
            "hw:CARD=X,DEV=0 — X – Direct hardware device"
        );
    }

    #[test]
    fn default_device_is_empty() {
        assert_eq!(device_id(&None), "");
        assert_eq!(device_id(&Some(" default ".into())), "");
        assert_eq!(device_id(&Some("in_ch1".into())), "in_ch1");
    }

    #[test]
    fn mic_meter_matches_web_client_format() {
        assert_eq!(mic_meter(-120.0), ("-inf dB".to_string(), 0.0));
        assert_eq!(mic_meter(-22.44), ("-22.4 dB".to_string(), 62.6));
        assert_eq!(mic_meter(-0.01), ("+0.0 dB".to_string(), 100.0));
        assert_eq!(mic_meter(-75.0).1, 0.0);
    }

    fn local() -> LocalAudio {
        LocalAudio {
            profile: "low".into(),
            auto_processing: false,
            input_gain_db: 3.3,
            dim_db: -20.0,
            dim_feeds_while_speaking: false,
            dim_when_addressed: true,
            play_connection_sounds: false,
            lock_multiple: true,
            vox_enabled: true,
            vox_target: Some(TargetKey::Conference(1)),
            vox_threshold_db: -75.0,
        }
    }

    #[test]
    fn audio_settings_are_valid_for_the_server_and_keep_unused_fields() {
        let server =
            json!({ "leftHandMode": true, "audioProfile": "ultra-low", "dimAmountDb": -15 });
        let settings = audio_settings(&server, &local());
        assert_eq!(settings["leftHandMode"], true);
        assert_eq!(settings["audioProfile"], "low");
        assert_eq!(settings["dimAmountDb"], -18.0);
        assert_eq!(settings["userInputGainDb"], 3.5);
        assert_eq!(settings["voiceTriggerTarget"], "conference:1");
        assert_eq!(settings["voiceTriggerThresholdDb"], -60.0);
        assert!(audio_settings_differ(&server, &settings));
        let echoed = serde_json::from_str::<Value>(&settings.to_string()).unwrap();
        assert!(!audio_settings_differ(&echoed, &settings));
    }

    #[test]
    fn config_patch_reads_panel_settings() {
        let patch = ConfigPatch::from_json(&json!({
            "audioProfile": "standard",
            "lockMultipleTargets": false,
            "voiceTriggerEnabled": true,
            "voiceTriggerTarget": "",
            "voiceTriggerThresholdDb": -40
        }));
        assert_eq!(patch.profile.as_deref(), Some("standard"));
        assert_eq!(patch.lock_multiple, Some(false));
        assert_eq!(patch.vox_enabled, Some(true));
        assert_eq!(patch.vox_target, Some(None));
        assert_eq!(patch.vox_threshold_db, Some(-40.0));
        assert_eq!(ConfigPatch::from_json(&json!({})), ConfigPatch::default());
    }

    #[test]
    fn storage_follows_the_devices_in_use() {
        let stored = json!({
            "preferredAudioInputDeviceId": "in_ch6",
            "preferredAudioOutputDeviceId": "",
            "activeProduction:35": "4"
        });
        let storage = storage_with_devices(&stored, "in_ch5", "out_ch5");
        assert_eq!(storage["preferredAudioInputDeviceId"], "in_ch5");
        assert_eq!(storage["preferredAudioInputDeviceExplicit"], "true");
        assert_eq!(storage["preferredAudioOutputDeviceId"], "out_ch5");
        assert_eq!(storage["activeProduction:35"], "4");
        let default = storage_with_devices(&stored, "", "");
        assert!(default.get("preferredAudioInputDeviceId").is_none());
        assert!(default.get("preferredAudioOutputDeviceId").is_none());
    }

    #[test]
    fn patch_device_distinguishes_default_and_untouched() {
        let patch = json!({ "preferredAudioInputDeviceId": " in_ch2 ", "preferredAudioOutputDeviceId": null });
        assert_eq!(
            patch_device(&patch, "preferredAudioInputDeviceId").as_deref(),
            Some("in_ch2")
        );
        assert_eq!(
            patch_device(&patch, "preferredAudioOutputDeviceId").as_deref(),
            Some("")
        );
        assert_eq!(
            patch_device(&json!({}), "preferredAudioInputDeviceId"),
            None
        );
    }

    #[test]
    fn device_preferences_are_detected() {
        assert!(patch_changes_devices(
            &json!({ "preferredAudioInputDeviceId": "x" })
        ));
        assert!(!patch_changes_devices(
            &json!({ "mainButtonTarget:user:3:default": "x" })
        ));
    }
}
