//! Real ALSA playback controls for the card behind the selected output PCM.
//! Never falls back to another card or to a software gain.

use alsa::mixer::{MilliBel, Mixer, Selem, SelemChannelId, SelemId};
use alsa::Round;
use anyhow::{anyhow, bail, Result};
use serde::Serialize;
use std::sync::{Arc, Condvar, Mutex};
use tokio::sync::oneshot;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemVolume {
    pub volume: f32,
    pub muted: bool,
    pub mute_supported: bool,
    pub control: String,
}

#[derive(Debug, Clone, Copy)]
pub enum Action {
    Set(f32),
    Step(f32),
    Mute(bool),
    ToggleMute,
}

type Reply = oneshot::Sender<Result<SystemVolume, String>>;
type Pending = Vec<(Action, Reply)>;

#[derive(Debug, Clone, Default)]
pub struct Control(Arc<PendingControl>);

#[derive(Debug, Default)]
struct PendingControl {
    pending: Mutex<Pending>,
    wake: Condvar,
}

impl Control {
    pub fn request(&self, action: Action) -> oneshot::Receiver<Result<SystemVolume, String>> {
        let (reply, receive) = oneshot::channel();
        if let Ok(mut pending) = self.0.pending.lock() {
            // A disconnected surface must not create an unbounded command queue.
            if pending.len() < 64 {
                pending.push((action, reply));
                self.0.wake.notify_one();
            }
        }
        receive
    }

    /// Sleep between hardware checks, but wake immediately for queued input.
    pub fn wait(&self, timeout: std::time::Duration) {
        if let Ok(pending) = self.0.pending.lock() {
            let _ = self
                .0
                .wake
                .wait_timeout_while(pending, timeout, |p| p.is_empty());
        }
    }

    pub fn poll(&self, card: Option<i32>) -> Option<SystemVolume> {
        let pending = self
            .0
            .pending
            .lock()
            .map(|mut p| std::mem::take(&mut *p))
            .unwrap_or_default();
        let mut result = read(card);
        for (action, reply) in pending {
            if reply.is_closed() {
                continue;
            }
            result = apply(card, action);
            let _ = reply.send(result.as_ref().cloned().map_err(ToString::to_string));
        }
        result.ok()
    }
}

// ALSA calls generic codec DAC controls "Playback" (WM8960) or "PCM"
// (e.g. TLV320AIC3104). Inspect capabilities rather than card/board names.
#[derive(Debug)]
struct Candidate {
    name: String,
    capture: bool,
}

fn select_control(candidates: &[Candidate]) -> Result<usize> {
    for name in ["Master", "PCM", "Playback", "DAC", "Digital"] {
        let matches: Vec<_> = candidates
            .iter()
            .enumerate()
            .filter(|(_, c)| c.name == name)
            .map(|(i, _)| i)
            .collect();
        match matches.as_slice() {
            [index] => return Ok(*index),
            [] => {}
            _ => bail!("Ambiguous hardware playback volume controls: {name}"),
        }
    }
    // Shared capture/playback controls may be microphone gain, ALC timing,
    // mixer routing or speaker boost. Never use those as a generic fallback.
    let outputs: Vec<_> = candidates
        .iter()
        .enumerate()
        .filter(|(_, c)| !c.capture)
        .map(|(i, _)| i)
        .collect();
    match outputs.as_slice() {
        [index] => Ok(*index),
        [] => bail!("No hardware playback volume control"),
        _ => bail!("Ambiguous hardware playback volume controls"),
    }
}

fn control(mixer: &Mixer) -> Result<Selem<'_>> {
    let elements: Vec<_> = mixer
        .iter()
        .filter_map(Selem::new)
        .filter(|e| {
            let (min, max) = e.get_playback_volume_range();
            e.has_playback_volume() && max > min
        })
        .collect();
    let candidates = elements
        .iter()
        .map(|e| {
            Ok(Candidate {
                name: e.get_id().get_name()?.to_string(),
                capture: e.has_capture_volume(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let index = select_control(&candidates)?;
    elements
        .into_iter()
        .nth(index)
        .ok_or_else(|| anyhow!("Playback control disappeared"))
}

fn with_control<T>(card: Option<i32>, f: impl FnOnce(Selem<'_>) -> Result<T>) -> Result<T> {
    let card = card
        .filter(|c| *c >= 0)
        .ok_or_else(|| anyhow!("System volume is unavailable for this output"))?;
    let _quiet = super::QuietAlsa::new();
    let mixer = Mixer::new(&format!("hw:{card}"), true)?;
    f(control(&mixer)?)
}

pub type OutputLevels = std::collections::BTreeMap<String, Vec<f32>>;

pub fn output_levels(card: Option<i32>) -> OutputLevels {
    let mut levels = OutputLevels::new();
    let Some(card) = card.filter(|card| *card >= 0) else {
        return levels;
    };
    let _quiet = super::QuietAlsa::new();
    let Ok(mixer) = Mixer::new(&format!("hw:{card}"), true) else {
        return levels;
    };
    for name in ["Speaker", "Headphone"] {
        let Some(elem) = mixer.find_selem(&SelemId::new(name, 0)) else {
            continue;
        };
        if !elem.has_playback_volume() {
            continue;
        }
        let (min, max) = elem.get_playback_volume_range();
        if max <= min || max - min > 4096 {
            continue;
        }
        let mut values: Vec<f32> = (min..=max)
            .filter_map(|raw| {
                elem.ask_playback_vol_db(raw)
                    .ok()
                    .map(|db| db.0)
                    .filter(|db| (-12000..=2400).contains(db))
                    .map(|db| db as f32 / 100.0)
            })
            .collect();
        values.sort_by(f32::total_cmp);
        values.dedup();
        if !values.is_empty() {
            levels.insert(name.to_string(), values);
        }
    }
    levels
}

pub fn validate_output_levels(levels: &OutputLevels, speaker: f32, headphone: f32) -> Result<()> {
    for (name, value) in [("Speaker", speaker), ("Headphone", headphone)] {
        match levels.get(name) {
            Some(values) if !values.iter().any(|db| (db - value).abs() < 0.001) => {
                bail!("{name} output level {value} dB is not supported by this sound card")
            }
            None if value != 0.0 => {
                bail!("{name} output level is unavailable; only the 0 dB default can be stored")
            }
            _ => {}
        }
    }
    Ok(())
}

/// Only configure separate, explicitly named analog outputs. Never touch
/// Playback/PCM, speaker AC/DC boost, routing, mute switches or capture gain.
pub fn configure_outputs(card: Option<i32>, speaker_db: f32, headphone_db: f32) -> Result<()> {
    validate_output_levels(&output_levels(card), speaker_db, headphone_db)?;
    let Some(card) = card.filter(|card| *card >= 0) else {
        return Ok(());
    };
    let _quiet = super::QuietAlsa::new();
    let mixer = Mixer::new(&format!("hw:{card}"), true)?;
    for (name, db) in [("Speaker", speaker_db), ("Headphone", headphone_db)] {
        let Some(elem) = mixer.find_selem(&SelemId::new(name, 0)) else {
            continue;
        };
        if !elem.has_playback_volume() {
            continue;
        }
        let (min, max) = elem.get_playback_db_range();
        // No dB metadata means there is no safe way to apply a 0 dB default.
        if min.0 >= max.0 {
            continue;
        }
        let value = MilliBel::from_db(db);
        if value.0 < min.0 || value.0 > max.0 {
            tracing::warn!(event = "output-level-out-of-range", control = name, db);
            continue;
        }
        elem.set_playback_db_all(value, Round::Floor)?;
    }
    Ok(())
}

fn snapshot(elem: &Selem<'_>) -> Result<SystemVolume> {
    let (min, max) = elem.get_playback_volume_range();
    if max <= min {
        bail!("Hardware volume has no adjustable range");
    }
    let channel = SelemChannelId::all()
        .iter()
        .copied()
        .find(|c| elem.has_playback_channel(*c))
        .ok_or_else(|| anyhow!("No playback channel"))?;
    let raw = elem.get_playback_volume(channel)?;
    let (db_min, db_max) = elem.get_playback_db_range();
    let volume = if db_min.0 < db_max.0 {
        normalize_db(elem.ask_playback_vol_db(raw)?.0, db_min.0, db_max.0)
    } else {
        normalize(raw, min, max)
    };
    let mute_supported = elem.has_playback_switch();
    Ok(SystemVolume {
        volume,
        muted: mute_supported && elem.get_playback_switch(channel)? == 0,
        mute_supported,
        control: elem.get_id().get_name()?.to_string(),
    })
}

fn read(card: Option<i32>) -> Result<SystemVolume> {
    with_control(card, |elem| snapshot(&elem))
}

fn apply(card: Option<i32>, action: Action) -> Result<SystemVolume> {
    with_control(card, |elem| {
        let current = snapshot(&elem)?;
        match action {
            Action::Set(value) | Action::Step(value) => {
                if !value.is_finite() {
                    bail!("Invalid system volume");
                }
                let volume = if matches!(action, Action::Step(_)) {
                    current.volume + value
                } else {
                    value
                };
                let (min, max) = elem.get_playback_volume_range();
                let (db_min, db_max) = elem.get_playback_db_range();
                if db_min.0 < db_max.0 {
                    elem.set_playback_db_all(
                        MilliBel(denormalize_db(volume, db_min.0, db_max.0)),
                        Round::Floor,
                    )?;
                } else {
                    elem.set_playback_volume_all(denormalize(volume, min, max))?;
                }
            }
            Action::Mute(value) => {
                if !current.mute_supported {
                    bail!("Hardware mute is unavailable");
                }
                elem.set_playback_switch_all(i32::from(!value))?;
            }
            Action::ToggleMute => {
                if !current.mute_supported {
                    bail!("Hardware mute is unavailable");
                }
                elem.set_playback_switch_all(i32::from(current.muted))?;
            }
        }
        snapshot(&elem)
    })
}

// Match alsamixer's perceptual percentage mapping (alsa-utils volume_mapping.c).
// https://github.com/alsa-project/alsa-utils/blob/master/alsamixer/volume_mapping.c
const DB_MUTE: i64 = -9_999_999;

fn normalize_db(value: i64, min: i64, max: i64) -> f32 {
    if max - min <= 2400 {
        return normalize(value, min, max);
    }
    let floor = if min == DB_MUTE {
        0.0
    } else {
        10f64.powf((min - max) as f64 / 6000.0)
    };
    ((10f64.powf((value - max) as f64 / 6000.0) - floor) / (1.0 - floor)).clamp(0.0, 1.0) as f32
}

fn denormalize_db(value: f32, min: i64, max: i64) -> i64 {
    if max - min <= 2400 {
        return denormalize(value, min, max);
    }
    let floor = if min == DB_MUTE {
        0.0
    } else {
        10f64.powf((min - max) as f64 / 6000.0)
    };
    let amplitude = value.clamp(0.0, 1.0) as f64 * (1.0 - floor) + floor;
    (max + (6000.0 * amplitude.max(1e-36).log10()).round() as i64).clamp(min, max)
}

fn normalize(value: i64, min: i64, max: i64) -> f32 {
    ((value - min) as f32 / (max - min) as f32).clamp(0.0, 1.0)
}

fn denormalize(value: f32, min: i64, max: i64) -> i64 {
    min + (value.clamp(0.0, 1.0) * (max - min) as f32).round() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_limits_reject_out_of_range_and_unsupported_steps() {
        let levels = OutputLevels::from([
            ("Speaker".into(), vec![-12.0, -6.0, 0.0, 6.0]),
            ("Headphone".into(), vec![-6.0, 0.0]),
        ]);
        assert!(validate_output_levels(&levels, 6.0, 0.0).is_ok());
        assert!(validate_output_levels(&levels, 20.0, 0.0).is_err());
        assert!(validate_output_levels(&levels, 3.0, 0.0).is_err());
        assert!(validate_output_levels(&levels, 0.0, 6.0).is_err());
        assert!(validate_output_levels(&levels, f32::NAN, 0.0).is_err());
        assert!(validate_output_levels(&OutputLevels::new(), 0.0, 0.0).is_ok());
        assert!(validate_output_levels(&OutputLevels::new(), 6.0, 0.0).is_err());
    }

    #[test]
    fn volume_input_wakes_the_supervisor_without_waiting_for_its_poll_interval() {
        use std::{sync::mpsc, time::Duration};
        let control = Control::default();
        let worker = control.clone();
        let (ready, started) = mpsc::channel();
        let (done, finished) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            ready.send(()).unwrap();
            worker.wait(Duration::from_secs(10));
            done.send(()).unwrap();
        });
        started.recv().unwrap();
        let _reply = control.request(Action::Step(0.05));
        let result = finished.recv_timeout(Duration::from_secs(1));
        thread.join().unwrap();
        result.expect("input must wake the audio supervisor immediately");
        // Input queued before entering wait must not lose its wake-up either.
        control.wait(Duration::from_secs(10));
    }

    fn candidate(name: &str, capture: bool) -> Candidate {
        Candidate {
            name: name.into(),
            capture,
        }
    }

    #[test]
    fn wm8960_uses_shared_dac_playback_not_speaker_boost_or_capture() {
        let candidates = [
            candidate("Headphone", false),
            candidate("Speaker", false),
            candidate("Speaker AC", true),
            candidate("Speaker DC", true),
            candidate("Playback", true),
            candidate("3D", true),
            candidate("ALC Max Gain", true),
            candidate("Left Input Boost Mixer LINPUT1", true),
        ];
        assert_eq!(select_control(&candidates).unwrap(), 4);
    }

    #[test]
    fn codec_and_usb_master_controls_take_priority_over_output_branches() {
        for main in ["Master", "PCM", "Playback", "DAC", "Digital"] {
            let candidates = [
                candidate("Headphone", false),
                candidate(main, false),
                candidate("Speaker", false),
                candidate("ALC Target", true),
            ];
            assert_eq!(select_control(&candidates).unwrap(), 1);
        }
        // TLV320AIC3104 (reSpeaker V2): PCM precedes HP/Line/HPCOM controls.
        assert_eq!(
            select_control(&[
                candidate("HP", false),
                candidate("Line", false),
                candidate("PCM", false),
                candidate("HPCOM", false)
            ])
            .unwrap(),
            2
        );
        assert_eq!(
            select_control(&[candidate("PCM", false), candidate("Master", false)]).unwrap(),
            1
        );
    }

    #[test]
    fn unknown_cards_require_a_single_unambiguous_output() {
        assert_eq!(
            select_control(&[candidate("ALC Target", true), candidate("Speaker", false)]).unwrap(),
            1
        );
        assert!(select_control(&[candidate("ALC Target", true)]).is_err());
        assert!(
            select_control(&[candidate("Headphone", false), candidate("Speaker", false)]).is_err()
        );
        assert!(select_control(&[candidate("PCM", false), candidate("PCM", false)]).is_err());
        assert!(select_control(&[]).is_err());
    }

    #[test]
    fn alsamixer_percentages_use_db_mapping_and_round_trip() {
        // WM8960 Playback: 0..255 hardware values, -127.5..0 dB.
        for (raw, alsa_percent) in [(245, 83.0), (235, 68.0), (225, 56.0)] {
            let db = -12750 + raw * 50;
            assert!((normalize_db(db, -12750, 0) * 100.0 - alsa_percent).abs() < 1.0);
        }
        for (min, max) in [(-12750, 0), (-1800, 600), (DB_MUTE, 0)] {
            for value in [0.0, 0.04, 0.5, 0.88, 0.92, 0.96, 1.0] {
                let actual = normalize_db(denormalize_db(value, min, max), min, max);
                assert!(
                    (actual - value).abs() < 0.001,
                    "{min}..{max}: {value} -> {actual}"
                );
            }
        }
    }

    #[test]
    fn hardware_ranges_support_offsets_and_clamp() {
        assert_eq!(normalize(0, -64, 64), 0.5);
        assert_eq!(denormalize(0.5, -64, 64), 0);
        assert_eq!(denormalize(-1.0, 10, 90), 10);
        assert_eq!(denormalize(2.0, 10, 90), 90);
    }

    #[test]
    fn missing_output_never_changes_a_default_card() {
        assert!(read(None).is_err());
        assert!(apply(None, Action::Set(0.5)).is_err());
        let control = Control::default();
        let mut reply = control.request(Action::Set(0.5));
        assert_eq!(control.poll(None), None);
        assert!(reply.try_recv().unwrap().is_err());
    }
}
