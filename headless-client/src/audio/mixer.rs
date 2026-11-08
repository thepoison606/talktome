//! Sums all consumer streams into one mono signal with per-target volume,
//! mute and dimming.

use std::collections::{HashMap, VecDeque};
use std::time::Duration;

use anyhow::Result;

use super::jitter::{StreamBuffer, StreamStats};
use crate::talk::{AudioLevel, TargetKey};

/// Linear amplitude 0.0 is treated as this floor in the UI and on keys.
pub const MUTE_DB: f32 = -60.0;

pub fn db_to_gain(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}

/// Convert a fader value in dB to the 0–1 linear gain stored per target.
pub fn db_to_volume(db: f32) -> f32 {
    if !db.is_finite() || db <= MUTE_DB {
        0.0
    } else {
        db_to_gain(db).clamp(0.0, 1.0)
    }
}

/// Convert stored 0–1 linear gain to dB for display and dB-sized steps.
pub fn volume_to_db(volume: f32) -> f32 {
    if !volume.is_finite() || volume <= 1e-6 {
        MUTE_DB
    } else {
        20.0 * volume.clamp(1e-6, 1.0).log10()
    }
}

pub fn format_volume_percent(volume: f32) -> String {
    let volume = if volume.is_finite() {
        volume.clamp(0.0, 1.0)
    } else {
        0.0
    };
    format!("{:.0}%", volume * 100.0)
}

pub fn step_volume_db(current: f32, delta_db: f32) -> f32 {
    db_to_volume(volume_to_db(current) + delta_db)
}

struct Source {
    key: TargetKey,
    /// Speaker inside a conference, when known from producer appData.
    speaker: Option<i64>,
    buffer: StreamBuffer,
}

pub struct Mixer {
    sources: HashMap<String, Source>,
    levels: HashMap<TargetKey, AudioLevel>,
    /// Per-member listen level inside a conference: (conference id, user id).
    member_levels: HashMap<(i64, i64), AudioLevel>,
    default_volume: f32,
    dim_gain: f32,
    dim_feeds_while_speaking: bool,
    dim_when_addressed: bool,
    talking: bool,
    addressed: bool,
    jitter_min_ms: u32,
    jitter_start_ms: u32,
    jitter_max_ms: u32,
    /// Output peak of the last render, for meters.
    pub output_peak: f32,
    /// One-shot connection cue mixed on top of the intercom bus.
    cue: VecDeque<f32>,
    /// Packets handed to a known stream, and packets for a consumer the
    /// mixer has no stream for (counted for the health log).
    packets_matched: u64,
    packets_unmatched: u64,
}

/// Counters for the periodic `audio-health` log line.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct MixerHealth {
    pub sources: usize,
    /// Sources that received a packet in the last 500 ms.
    pub active_sources: usize,
    pub packets_matched: u64,
    pub packets_unmatched: u64,
    pub buffered_ms: u32,
    pub target_ms: u32,
}

impl Mixer {
    pub fn new(
        default_volume: f32,
        dim_db: f32,
        dim_feeds_while_speaking: bool,
        dim_when_addressed: bool,
        jitter_min_ms: u32,
        jitter_max_ms: u32,
    ) -> Self {
        Self {
            sources: HashMap::new(),
            levels: HashMap::new(),
            member_levels: HashMap::new(),
            default_volume,
            dim_gain: db_to_gain(dim_db),
            dim_feeds_while_speaking,
            dim_when_addressed,
            talking: false,
            addressed: false,
            jitter_min_ms,
            jitter_start_ms: jitter_min_ms,
            jitter_max_ms,
            output_peak: 0.0,
            cue: VecDeque::new(),
            packets_matched: 0,
            packets_unmatched: 0,
        }
    }

    /// Replaces any cue still playing. The web client stops the previous tone.
    /// Depth new streams start at (see `audio.jitter_start_ms`).
    pub fn with_jitter_start(mut self, start_ms: u32) -> Self {
        self.jitter_start_ms = start_ms;
        self
    }

    pub fn enqueue_cue(&mut self, samples: &[f32]) {
        self.cue.clear();
        self.cue.extend(samples.iter().copied());
    }

    pub fn clear_cue(&mut self) {
        self.cue.clear();
    }

    pub fn add_source_from(
        &mut self,
        consumer_id: &str,
        key: TargetKey,
        speaker: Option<i64>,
    ) -> Result<()> {
        self.sources.insert(
            consumer_id.to_string(),
            Source {
                key,
                speaker,
                buffer: StreamBuffer::with_start(
                    self.jitter_min_ms,
                    self.jitter_start_ms,
                    self.jitter_max_ms,
                )?,
            },
        );
        Ok(())
    }

    pub fn remove_source(&mut self, consumer_id: &str) {
        self.sources.remove(consumer_id);
    }

    pub fn clear_sources(&mut self) {
        self.sources.clear();
    }

    pub fn set_level(&mut self, key: TargetKey, level: AudioLevel) {
        self.levels.insert(key, level);
    }

    pub fn set_dim_state(&mut self, talking: bool, addressed: bool) {
        self.talking = talking;
        self.addressed = addressed;
    }

    /// Live dimming from the user's server-side audio settings.
    pub fn set_dimming(
        &mut self,
        dim_db: Option<f32>,
        dim_feeds_while_speaking: Option<bool>,
        dim_when_addressed: Option<bool>,
    ) {
        if let Some(db) = dim_db {
            if db.is_finite() {
                self.dim_gain = db_to_gain(db);
            }
        }
        if let Some(enabled) = dim_feeds_while_speaking {
            self.dim_feeds_while_speaking = enabled;
        }
        if let Some(enabled) = dim_when_addressed {
            self.dim_when_addressed = enabled;
        }
    }

    #[cfg(test)]
    pub fn push_packet(&mut self, consumer_id: &str, seq: u16, payload: &[u8]) -> Result<bool> {
        self.push_rtp_packet(
            consumer_id,
            seq,
            u32::from(seq) * 960,
            payload,
            std::time::Instant::now(),
        )
    }

    pub fn push_rtp_packet(
        &mut self,
        consumer_id: &str,
        seq: u16,
        timestamp: u32,
        payload: &[u8],
        arrived: std::time::Instant,
    ) -> Result<bool> {
        match self.sources.get_mut(consumer_id) {
            Some(source) => {
                self.packets_matched += 1;
                source.buffer.push(seq, timestamp, payload, arrived)?;
                Ok(true)
            }
            None => {
                self.packets_unmatched += 1;
                Ok(false)
            }
        }
    }

    pub fn set_member_level(&mut self, conference_id: i64, user_id: i64, level: AudioLevel) {
        self.member_levels.insert((conference_id, user_id), level);
    }

    fn gain_for_source(&self, source: &Source) -> f32 {
        let mut gain = self.gain_for(source.key);
        if let (TargetKey::Conference(conference_id), Some(user_id)) = (source.key, source.speaker)
        {
            if let Some(member) = self.member_levels.get(&(conference_id, user_id)) {
                if member.muted {
                    return 0.0;
                }
                gain *= member.volume;
            }
        }
        gain
    }

    fn gain_for(&self, key: TargetKey) -> f32 {
        let level = self.levels.get(&key).cloned().unwrap_or(AudioLevel {
            volume: self.default_volume,
            muted: false,
        });
        if level.muted {
            return 0.0;
        }
        let mut gain = level.volume;
        if matches!(key, TargetKey::Feed(_)) {
            let dim = (self.dim_feeds_while_speaking && self.talking)
                || (self.dim_when_addressed && self.addressed);
            if dim {
                gain *= self.dim_gain;
            }
        }
        gain
    }

    /// Renders `out.len()` mono samples (overwrites `out`).
    pub fn render(&mut self, out: &mut [f32]) {
        out.fill(0.0);
        let gains: Vec<(String, f32)> = self
            .sources
            .iter()
            .map(|(id, source)| (id.clone(), self.gain_for_source(source)))
            .collect();
        for (id, gain) in gains {
            if let Some(source) = self.sources.get_mut(&id) {
                source.buffer.mix_into(out, gain);
            }
        }
        for sample in out.iter_mut() {
            if let Some(cue) = self.cue.pop_front() {
                *sample += cue;
            } else {
                break;
            }
        }
        let mut peak = 0f32;
        for sample in out.iter_mut() {
            // Soft clip to keep summed conferences from wrapping.
            if sample.abs() > 0.95 {
                *sample = sample.signum() * (0.95 + (sample.abs() - 0.95).tanh() * 0.05);
            }
            peak = peak.max(sample.abs());
        }
        self.output_peak = peak;
    }

    /// Targets from which audio is currently being played out.
    pub fn receiving_keys(&self) -> Vec<TargetKey> {
        let mut keys: Vec<TargetKey> = self
            .sources
            .values()
            .filter(|s| {
                s.buffer.is_active()
                    && s.buffer.last_packet().elapsed() < Duration::from_millis(500)
            })
            .map(|s| s.key)
            .collect();
        keys.sort();
        keys.dedup();
        keys
    }

    pub fn health(&self) -> MixerHealth {
        MixerHealth {
            sources: self.sources.len(),
            active_sources: self
                .sources
                .values()
                .filter(|s| s.buffer.last_packet().elapsed() < Duration::from_millis(500))
                .count(),
            packets_matched: self.packets_matched,
            packets_unmatched: self.packets_unmatched,
            buffered_ms: self
                .sources
                .values()
                .map(|s| s.buffer.buffered_ms())
                .max()
                .unwrap_or(0),
            target_ms: self
                .sources
                .values()
                .filter(|s| s.buffer.is_active())
                .map(|s| s.buffer.target_ms())
                .max()
                .unwrap_or(0),
        }
    }

    /// Sum of per-stream jitter/PLC counters, for the status page.
    pub fn receive_stats(&self) -> StreamStats {
        let mut total = StreamStats::default();
        for source in self.sources.values() {
            let stats = source.buffer.stats;
            total.packets += stats.packets;
            total.lost += stats.lost;
            total.concealed += stats.concealed;
            total.dropped_late += stats.dropped_late;
            total.dropped_overflow += stats.dropped_overflow;
            total.underruns += stats.underruns;
        }
        total
    }

    /// Speakers currently delivering audio inside `conference_id`.
    pub fn receiving_speakers(&self, conference_id: i64) -> Vec<i64> {
        let mut ids: Vec<i64> = self
            .sources
            .values()
            .filter(|s| {
                s.key == TargetKey::Conference(conference_id)
                    && s.buffer.is_active()
                    && s.buffer.last_packet().elapsed() < Duration::from_millis(500)
            })
            .filter_map(|s| s.speaker)
            .collect();
        ids.sort();
        ids.dedup();
        ids
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::codec::OpusEncoder;

    fn packets(count: usize, amplitude: f32) -> Vec<bytes::Bytes> {
        let mut encoder = OpusEncoder::new(20, 64_000, false).unwrap();
        (0..count)
            .map(|i| {
                let frame: Vec<f32> = (0..960)
                    .map(|n| {
                        (((i * 960 + n) as f32) * 440.0 * std::f32::consts::TAU / 48_000.0).sin()
                            * amplitude
                    })
                    .collect();
                encoder.encode(&frame).unwrap()
            })
            .collect()
    }

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
    }

    #[test]
    fn deck_percentages_match_the_linear_bar_position() {
        assert_eq!(format_volume_percent(0.5), "50%");
        assert_eq!(format_volume_percent(0.0), "0%");
        assert_eq!(format_volume_percent(1.0), "100%");
        assert_eq!(format_volume_percent(1.2), "100%");
        assert_eq!(format_volume_percent(f32::NAN), "0%");
    }

    #[test]
    fn applies_volume_mute_and_feed_dim() {
        let mut mixer = Mixer::new(1.0, -20.0, true, false, 20, 200);
        mixer
            .add_source_from("c1", TargetKey::Conference(1), None)
            .unwrap();
        mixer
            .add_source_from("f1", TargetKey::Feed(1), None)
            .unwrap();
        let conf = packets(6, 0.5);
        let feed = packets(6, 0.5);
        for (i, p) in conf.iter().enumerate() {
            mixer.push_packet("c1", i as u16, p).unwrap();
        }
        for (i, p) in feed.iter().enumerate() {
            mixer.push_packet("f1", i as u16, p).unwrap();
        }
        assert!(!mixer.push_packet("nope", 0, &conf[0]).unwrap());
        let health = mixer.health();
        assert_eq!((health.sources, health.active_sources), (2, 2));
        assert_eq!(health.packets_unmatched, 1);

        let mut out = vec![0f32; 960];
        mixer.render(&mut out);
        let both = rms(&out);
        assert!(both > 0.3, "two sources summed: {both}");

        mixer.set_level(
            TargetKey::Conference(1),
            AudioLevel {
                volume: 1.0,
                muted: true,
            },
        );
        // The jitter target keeps about two frames, so top up before each render.
        mixer.push_packet("c1", 6, &conf[0]).unwrap();
        mixer.push_packet("f1", 6, &feed[0]).unwrap();
        mixer.render(&mut out);
        let feed_only = rms(&out);
        assert!((feed_only - 0.35).abs() < 0.1, "feed alone: {feed_only}");

        mixer.set_dim_state(true, false);
        mixer.push_packet("c1", 7, &conf[1]).unwrap();
        mixer.push_packet("f1", 7, &feed[1]).unwrap();
        mixer.render(&mut out);
        let dimmed = rms(&out);
        assert!(dimmed < feed_only * 0.2, "dimmed {dimmed} vs {feed_only}");

        assert_eq!(
            mixer.receiving_keys(),
            vec![TargetKey::Conference(1), TargetKey::Feed(1)]
        );
        mixer.remove_source("f1");
        assert_eq!(mixer.receiving_keys(), vec![TargetKey::Conference(1)]);
    }

    #[test]
    fn volume_db_round_trips_and_steps() {
        assert!((db_to_volume(0.0) - 1.0).abs() < 1e-5);
        assert_eq!(db_to_volume(-60.0), 0.0);
        assert!((volume_to_db(1.0) - 0.0).abs() < 1e-5);
        assert_eq!(volume_to_db(0.0), MUTE_DB);
        let quieter = step_volume_db(1.0, -6.0);
        assert!((volume_to_db(quieter) + 6.0).abs() < 0.05);
        assert_eq!(format_volume_percent(1.0), "100%");
        assert_eq!(format_volume_percent(0.0), "0%");
    }

    #[test]
    fn conference_member_level_scales_one_speaker() {
        let mut mixer = Mixer::new(1.0, -20.0, false, false, 20, 200);
        mixer
            .add_source_from("adi", TargetKey::Conference(1), Some(2))
            .unwrap();
        mixer
            .add_source_from("beni", TargetKey::Conference(1), Some(3))
            .unwrap();
        let packets = packets(6, 0.5);
        for (i, p) in packets.iter().enumerate() {
            mixer.push_packet("adi", i as u16, p).unwrap();
            mixer.push_packet("beni", i as u16, p).unwrap();
        }
        let mut out = vec![0f32; 960];
        mixer.render(&mut out);
        let both = rms(&out);
        mixer.set_member_level(
            1,
            3,
            AudioLevel {
                volume: 1.0,
                muted: true,
            },
        );
        mixer.push_packet("adi", 6, &packets[0]).unwrap();
        mixer.push_packet("beni", 6, &packets[0]).unwrap();
        mixer.render(&mut out);
        let adi_only = rms(&out);
        assert!(
            adi_only < both * 0.75 && adi_only > both * 0.3,
            "muting one conference member: both={both} adi={adi_only}"
        );
        assert_eq!(mixer.receiving_speakers(1), vec![2, 3]);
    }

    #[test]
    fn connection_cue_mixes_then_stops_when_replaced() {
        let mut mixer = Mixer::new(1.0, -20.0, false, false, 20, 200);
        mixer.enqueue_cue(&[0.25, 0.5, 0.75, 1.0]);
        mixer.enqueue_cue(&[0.1, 0.2]);
        let mut out = vec![0f32; 4];
        mixer.render(&mut out);
        assert!((out[0] - 0.1).abs() < 1e-6);
        assert!((out[1] - 0.2).abs() < 1e-6);
        assert_eq!(out[2], 0.0);
        mixer.render(&mut out);
        assert_eq!(out, vec![0.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn clear_cue_drops_a_playing_announcement() {
        let mut mixer = Mixer::new(1.0, -20.0, false, false, 20, 200);
        mixer.enqueue_cue(&[0.4, 0.4, 0.4, 0.4]);
        mixer.clear_cue();
        let mut out = vec![0f32; 4];
        mixer.render(&mut out);
        assert_eq!(out, vec![0.0, 0.0, 0.0, 0.0]);
    }
}
