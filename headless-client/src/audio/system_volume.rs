//! Real ALSA playback controls for the card behind the selected output PCM.
//! Never falls back to another card or to a software gain.

use alsa::mixer::{Mixer, Selem, SelemChannelId};
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
    let volume = normalize(elem.get_playback_volume(channel)?, min, max);
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
                elem.set_playback_volume_all(denormalize(volume, min, max))?;
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
