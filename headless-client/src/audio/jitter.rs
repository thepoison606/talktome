//! Per-consumer receive buffer: sequence tracking with Opus FEC/PLC for
//! gaps, and a decoded PCM FIFO whose playout depth follows the link.
//!
//! The playout target follows the spread of packet arrival delays over the
//! last few seconds, the way a browser's jitter buffer does, so a mobile link
//! that stalls and then delivers a burst gets enough depth instead of having
//! the burst thrown away. Short underruns are filled with Opus concealment.
//! Excess depth is removed gradually (quiet stretches first, otherwise single
//! samples) rather than by cutting whole frames.

use std::collections::VecDeque;
use std::time::Instant;

use anyhow::Result;

use super::codec::{OpusDecoder, SAMPLE_RATE};

/// Lost frames reconstructed per sequence gap (FEC for the last, PLC before).
const MAX_CONCEAL_FRAMES: u16 = 5;
/// Concealment frames played while waiting for a late packet before the
/// stream goes quiet and re-primes (100 ms at 20 ms frames).
const MAX_UNDERRUN_CONCEAL_FRAMES: u32 = 5;
/// How long a delay spike keeps the playout target raised.
const DELAY_WINDOW_MS: f64 = 10_000.0;
/// A 2.5 ms stretch this quiet can be dropped without being heard.
const QUIET_CHUNK: usize = SAMPLE_RATE as usize / 400;
const QUIET_RMS: f32 = 0.01;
/// Excess depth is trimmed by skipping one sample in this many (1 %), or
/// faster (4 %) when the excess is large.
const SKIP_STRIDE: usize = 100;
const FAST_SKIP_STRIDE: usize = 25;
/// Crossfade used by the emergency trim.
const CROSSFADE: usize = SAMPLE_RATE as usize / 200;

pub struct StreamBuffer {
    decoder: OpusDecoder,
    pcm: VecDeque<f32>,
    next_seq: Option<u16>,
    /// `next_seq - 1` without wrap-around, to place packets on a timeline.
    last_ext_seq: i64,
    frame_samples: usize,
    min_samples: usize,
    /// Depth a new stream starts at and keeps for its first `DELAY_WINDOW_MS`.
    start_samples: usize,
    /// Arrival time of the first packet, to know when the start depth ends.
    first_arrival_ms: Option<f64>,
    /// Current playout depth; follows the arrival delay spread.
    target_samples: usize,
    max_samples: usize,
    primed: bool,
    /// Concealment frames played since the last packet arrived.
    concealing: u32,
    /// (arrival ms, arrival ms minus media time ms) of recent packets.
    delays: VecDeque<(f64, f64)>,
    skip_counter: usize,
    epoch: Instant,
    last_packet: Instant,
    pub stats: StreamStats,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct StreamStats {
    pub packets: u64,
    /// Sequence numbers skipped on arrival (network loss, before FEC/PLC).
    pub lost: u64,
    pub concealed: u64,
    pub dropped_late: u64,
    /// Samples removed to bring the depth back to the target.
    pub dropped_overflow: u64,
    pub underruns: u64,
}

impl StreamBuffer {
    #[cfg(test)]
    pub fn new(min_ms: u32, max_ms: u32) -> Result<Self> {
        Self::with_start(min_ms, min_ms, max_ms)
    }

    /// Like `new`, but each stream starts at `start_ms` and only drops below
    /// it once the first `DELAY_WINDOW_MS` of arrivals show a calmer link.
    pub fn with_start(min_ms: u32, start_ms: u32, max_ms: u32) -> Result<Self> {
        let per_ms = SAMPLE_RATE as usize / 1000;
        let min_samples = per_ms * min_ms.max(1) as usize;
        let max_samples = per_ms * max_ms.max(min_ms.saturating_add(20)) as usize;
        let start_samples = (per_ms * start_ms as usize).clamp(min_samples, max_samples);
        let now = Instant::now();
        Ok(Self {
            decoder: OpusDecoder::new()?,
            pcm: VecDeque::with_capacity(per_ms * (max_ms as usize + 120)),
            next_seq: None,
            last_ext_seq: 0,
            frame_samples: per_ms * 20,
            min_samples,
            start_samples,
            first_arrival_ms: None,
            target_samples: start_samples,
            max_samples,
            primed: false,
            concealing: 0,
            delays: VecDeque::new(),
            skip_counter: 0,
            epoch: now,
            last_packet: now,
            stats: StreamStats::default(),
        })
    }

    pub fn last_packet(&self) -> Instant {
        self.last_packet
    }

    #[cfg(test)]
    pub fn buffered_ms(&self) -> u32 {
        (self.pcm.len() * 1000 / SAMPLE_RATE as usize) as u32
    }

    #[cfg(test)]
    pub fn target_ms(&self) -> u32 {
        (self.target_samples * 1000 / SAMPLE_RATE as usize) as u32
    }

    /// True while audio is actually being played out from this stream.
    pub fn is_active(&self) -> bool {
        self.primed
    }

    pub fn push(&mut self, seq: u16, payload: &[u8]) -> Result<()> {
        let now_ms = self.epoch.elapsed().as_secs_f64() * 1000.0;
        self.push_at(seq, payload, now_ms)
    }

    /// `push` with an explicit arrival time (ms since the buffer was made).
    fn push_at(&mut self, seq: u16, payload: &[u8], now_ms: f64) -> Result<()> {
        self.last_packet = Instant::now();
        self.concealing = 0;
        if let Some(samples) = self.decoder.packet_samples(payload) {
            if samples > 0 {
                self.frame_samples = samples;
            }
        }

        if let Some(expected) = self.next_seq {
            let gap = seq.wrapping_sub(expected);
            if gap == 0 {
                // in order
            } else if gap < 0x8000 {
                self.stats.lost += gap as u64;
                // Lost `gap` frames: conceal all but the last, recover the
                // last one from this packet's in-band FEC data.
                let conceal = gap.min(MAX_CONCEAL_FRAMES);
                for index in 0..conceal {
                    let is_last = index + 1 == gap;
                    let pcm = if is_last {
                        self.decoder
                            .decode_fec(payload, self.frame_samples)?
                            .to_vec()
                    } else {
                        self.decoder.conceal(self.frame_samples)?.to_vec()
                    };
                    self.append(&pcm);
                    self.stats.concealed += 1;
                }
                self.last_ext_seq += gap as i64;
            } else {
                // Late or duplicate packet.
                self.stats.dropped_late += 1;
                return Ok(());
            }
            self.last_ext_seq += 1;
        }
        self.note_arrival(now_ms);
        let pcm = self.decoder.decode(payload, false)?.to_vec();
        self.append(&pcm);
        self.next_seq = Some(seq.wrapping_add(1));
        self.stats.packets += 1;
        if !self.primed && self.pcm.len() >= self.target_samples {
            self.primed = true;
        }
        Ok(())
    }

    /// Sets the target to the arrival delay spread of the last
    /// `DELAY_WINDOW_MS` plus one frame, within the configured bounds; for
    /// the first window it does not go below the start depth.
    fn note_arrival(&mut self, now_ms: f64) {
        let first = *self.first_arrival_ms.get_or_insert(now_ms);
        let floor = if now_ms - first < DELAY_WINDOW_MS {
            self.start_samples
        } else {
            self.min_samples
        };
        let frame_ms = self.frame_samples as f64 * 1000.0 / SAMPLE_RATE as f64;
        let relative = now_ms - self.last_ext_seq as f64 * frame_ms;
        self.delays.push_back((now_ms, relative));
        while self
            .delays
            .front()
            .is_some_and(|(at, _)| now_ms - at > DELAY_WINDOW_MS)
        {
            self.delays.pop_front();
        }
        let (low, high) = self
            .delays
            .iter()
            .fold((f64::MAX, f64::MIN), |(low, high), (_, d)| {
                (low.min(*d), high.max(*d))
            });
        let spread = ((high - low).max(0.0) * SAMPLE_RATE as f64 / 1000.0) as usize;
        self.target_samples = spread
            .saturating_add(self.frame_samples)
            .clamp(floor, self.max_samples);
    }

    fn append(&mut self, pcm: &[f32]) {
        self.pcm.extend(pcm.iter().copied());
        // Emergency brake only: far more than the deepest target allows.
        let limit = self.max_samples + 4 * self.frame_samples;
        if self.pcm.len() > limit {
            let drop = self.pcm.len() - self.target_samples;
            self.drop_front_crossfaded(drop);
        }
    }

    /// Drops `count` samples from the front, fading the old head into the
    /// new one so the cut does not click.
    fn drop_front_crossfaded(&mut self, count: usize) {
        let fade = CROSSFADE.min(self.pcm.len().saturating_sub(count));
        let head: Vec<f32> = self.pcm.iter().take(fade).copied().collect();
        self.pcm.drain(..count);
        for (index, old) in head.iter().enumerate() {
            let t = (index + 1) as f32 / (fade + 1) as f32;
            if let Some(sample) = self.pcm.get_mut(index) {
                *sample = *sample * t + old * (1.0 - t);
            }
        }
        self.stats.dropped_overflow += count as u64;
    }

    /// Removes quiet 2.5 ms stretches from the next `window` samples until
    /// `excess` is used up. Returns the number of samples removed.
    fn drop_quiet(&mut self, window: usize, mut excess: usize) -> usize {
        let mut removed = 0;
        let mut start = 0;
        while excess >= QUIET_CHUNK && start + QUIET_CHUNK <= window.min(self.pcm.len()) {
            let energy: f32 = self
                .pcm
                .range(start..start + QUIET_CHUNK)
                .map(|s| s * s)
                .sum();
            if (energy / QUIET_CHUNK as f32).sqrt() < QUIET_RMS {
                self.pcm.drain(start..start + QUIET_CHUNK);
                excess -= QUIET_CHUNK;
                removed += QUIET_CHUNK;
            } else {
                start += QUIET_CHUNK;
            }
        }
        self.stats.dropped_overflow += removed as u64;
        removed
    }

    /// Adds this stream's next `out.len()` samples (scaled by `gain`) into `out`.
    pub fn mix_into(&mut self, out: &mut [f32], gain: f32) {
        if !self.primed || out.is_empty() {
            return;
        }
        // A late packet: bridge the gap with concealment for a while.
        while self.pcm.len() < out.len() && self.concealing < MAX_UNDERRUN_CONCEAL_FRAMES {
            if self.concealing == 0 {
                self.stats.underruns += 1;
            }
            match self.decoder.conceal(self.frame_samples) {
                Ok(pcm) => {
                    let pcm = pcm.to_vec();
                    self.pcm.extend(pcm);
                }
                Err(_) => break,
            }
            self.concealing += 1;
            self.stats.concealed += 1;
        }

        // Too deep: shed the excess gradually, quiet stretches first.
        let excess = self
            .pcm
            .len()
            .saturating_sub(out.len() + self.target_samples + self.frame_samples / 2);
        let excess = excess - self.drop_quiet(out.len(), excess).min(excess);
        let stride = if excess > 4 * self.frame_samples {
            FAST_SKIP_STRIDE
        } else if excess > 0 {
            SKIP_STRIDE
        } else {
            0
        };

        let block = out.len();
        for sample in out.iter_mut() {
            if stride > 0 && self.pcm.len() > block {
                self.skip_counter += 1;
                if self.skip_counter >= stride {
                    self.skip_counter = 0;
                    self.pcm.pop_front();
                    self.stats.dropped_overflow += 1;
                }
            }
            match self.pcm.pop_front() {
                Some(value) => *sample += value * gain,
                None => break,
            }
        }
        // Concealment ran out without a packet: go quiet and wait until the
        // buffer holds the target again.
        if self.pcm.is_empty() && self.concealing >= MAX_UNDERRUN_CONCEAL_FRAMES {
            self.primed = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::codec::OpusEncoder;

    fn tone_packets(count: usize) -> Vec<bytes::Bytes> {
        let mut encoder = OpusEncoder::new(20, 64_000, true).unwrap();
        let mut phase = 0f32;
        (0..count)
            .map(|_| {
                let frame: Vec<f32> = (0..960)
                    .map(|_| {
                        phase += 440.0 * std::f32::consts::TAU / 48_000.0;
                        phase.sin() * 0.5
                    })
                    .collect();
                encoder.encode(&frame).unwrap()
            })
            .collect()
    }

    #[test]
    fn primes_after_minimum_and_conceals_gaps() {
        let mut buffer = StreamBuffer::new(40, 200).unwrap();
        let packets = tone_packets(12);
        buffer.push_at(1, &packets[0], 0.0).unwrap();
        assert!(!buffer.is_active(), "20 ms is below the 40 ms minimum");
        buffer.push_at(2, &packets[1], 20.0).unwrap();
        assert!(buffer.is_active());
        // Lose packet 3, deliver 4: one frame recovered via FEC, none dropped.
        buffer.push_at(4, &packets[3], 60.0).unwrap();
        assert_eq!(buffer.stats.concealed, 1);
        assert_eq!(buffer.stats.lost, 1);
        assert_eq!(buffer.buffered_ms(), 80);
        // Duplicate/late packet is dropped.
        buffer.push_at(2, &packets[1], 61.0).unwrap();
        assert_eq!(buffer.stats.dropped_late, 1);
        assert_eq!(
            buffer.stats.lost, 1,
            "late packets are not counted as lost again"
        );

        let mut out = vec![0f32; 960];
        buffer.mix_into(&mut out, 0.5);
        assert!(out.iter().any(|s| s.abs() > 0.01));
    }

    #[test]
    fn a_burst_is_kept_not_thrown_away() {
        let mut buffer = StreamBuffer::new(20, 400).unwrap();
        let packets = tone_packets(20);
        // Ten packets on time, then a 200 ms stall and ten at once.
        for index in 0..10u16 {
            buffer
                .push_at(index, &packets[index as usize], index as f64 * 20.0)
                .unwrap();
        }
        for index in 10..20u16 {
            buffer
                .push_at(index, &packets[index as usize], 400.0)
                .unwrap();
        }
        assert_eq!(buffer.stats.dropped_overflow, 0);
        assert!(buffer.target_ms() >= 200, "target {}", buffer.target_ms());
    }

    #[test]
    fn start_depth_holds_for_the_first_window_then_relaxes() {
        let mut buffer = StreamBuffer::with_start(20, 150, 600).unwrap();
        assert_eq!(buffer.target_ms(), 150);
        let packets = tone_packets(2);
        // A perfectly calm link: the start depth still holds at first.
        for seq in 0..600u16 {
            let at = seq as f64 * 20.0;
            buffer.push_at(seq, &packets[seq as usize % 2], at).unwrap();
            if at < 9_000.0 {
                assert_eq!(buffer.target_ms(), 150, "at {at} ms");
            }
            let mut out = vec![0f32; 960];
            buffer.mix_into(&mut out, 1.0);
        }
        // After the first 10 s the calm link brings it down to the minimum.
        assert_eq!(buffer.target_ms(), 20);
    }

    #[test]
    fn emergency_trim_bounds_the_delay() {
        let mut buffer = StreamBuffer::new(20, 60).unwrap();
        let packets = tone_packets(40);
        for (index, packet) in packets.iter().enumerate() {
            buffer.push_at(index as u16, packet, 0.0).unwrap();
        }
        assert!(buffer.buffered_ms() <= 60 + 80);
        assert!(buffer.stats.dropped_overflow > 0);
    }

    #[test]
    fn underrun_is_concealed_then_goes_quiet() {
        let mut buffer = StreamBuffer::new(20, 120).unwrap();
        let packets = tone_packets(8);
        buffer.push_at(0, &packets[0], 0.0).unwrap();
        assert!(buffer.is_active());
        // 40 ms asked for, 20 ms buffered: concealment covers the rest.
        let mut out = vec![0f32; 1920];
        buffer.mix_into(&mut out, 1.0);
        assert!(
            out[960..].iter().any(|s| s.abs() > 0.01),
            "PLC fills the gap"
        );
        assert_eq!(buffer.stats.underruns, 1);
        // No packet for a long time: concealment stops and the stream waits.
        let mut drain = vec![0f32; 48_000];
        buffer.mix_into(&mut drain, 1.0);
        assert!(!buffer.is_active());
        // The stall raised the target; playout resumes once it is buffered.
        buffer.push_at(1, &packets[1], 1000.0).unwrap();
        assert_eq!(buffer.target_ms(), 120);
        assert!(!buffer.is_active());
        for seq in 2..7u16 {
            buffer
                .push_at(seq, &packets[seq as usize], 1000.0 + seq as f64)
                .unwrap();
        }
        assert!(buffer.is_active(), "re-primes at the raised target");
    }

    #[test]
    fn excess_depth_is_shed_gradually() {
        let mut buffer = StreamBuffer::new(20, 300).unwrap();
        let packets = tone_packets(15);
        // On time, but nothing played yet: 300 ms queued against a 20 ms target.
        for (index, packet) in packets.iter().enumerate() {
            buffer
                .push_at(index as u16, packet, index as f64 * 20.0)
                .unwrap();
        }
        let before = buffer.buffered_ms();
        let mut out = vec![0f32; 480];
        buffer.mix_into(&mut out, 1.0);
        let shed = before - 10 - buffer.buffered_ms();
        // Quiet stretches (here the decoder's start-up) may go at once; sound
        // is only thinned out, never cut by a whole 20 ms frame.
        assert!(shed < 10, "shed {shed} ms in one 10 ms block");
        assert!(buffer.stats.dropped_overflow > 0);
    }

    /// A 30 s tone over a mobile-like link: 40-100 ms of jitter, a 250 ms
    /// stall every two seconds, 1 % loss and a sender clock 0.1 % fast.
    /// Returns the milliseconds of dropout after playout started, in total
    /// and after the first five seconds (once the target has adapted).
    fn mobile_dropout_ms() -> (u32, u32) {
        let mut encoder = OpusEncoder::new(20, 32_000, true).unwrap();
        let mut seed: u64 = 0x1234_5678;
        let mut rand = move || {
            seed = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            ((seed >> 33) as f64) / (u32::MAX >> 1) as f64
        };
        let mut phase = 0f32;
        let mut arrivals = Vec::new();
        let mut last_arrival = 0f64;
        for index in 0..1500usize {
            let frame: Vec<f32> = (0..960)
                .map(|_| {
                    phase += 440.0 * std::f32::consts::TAU / 48_000.0;
                    phase.sin() * 0.5
                })
                .collect();
            let payload = encoder.encode(&frame).unwrap();
            let sent = index as f64 * 20.0 * 0.999;
            let mut delay = 40.0 + rand() * 60.0;
            if index % 100 >= 95 {
                delay += 250.0;
            }
            if rand() < 0.01 {
                continue;
            }
            let arrival = (sent + delay).max(last_arrival);
            last_arrival = arrival;
            arrivals.push((arrival, index as u16, payload));
        }
        let mut buffer = StreamBuffer::new(20, 400).unwrap();
        let mut next = 0;
        let mut out = vec![0f32; 480];
        let (mut dropout, mut adapted_dropout, mut started) = (0u32, 0u32, false);
        let mut now = 0f64;
        while now < 30_000.0 * 0.999 + 40.0 {
            while next < arrivals.len() && arrivals[next].0 <= now {
                let (at, seq, payload) = &arrivals[next];
                buffer.push_at(*seq, payload, *at).unwrap();
                next += 1;
            }
            out.fill(0.0);
            buffer.mix_into(&mut out, 1.0);
            for ms in out.chunks(48) {
                let rms = (ms.iter().map(|s| s * s).sum::<f32>() / 48.0).sqrt();
                if rms > 0.1 {
                    started = true;
                } else if started {
                    dropout += 1;
                    if now >= 5_000.0 {
                        adapted_dropout += 1;
                    }
                }
            }
            now += 10.0;
        }
        (dropout, adapted_dropout)
    }

    #[test]
    fn mobile_link_plays_without_dropouts() {
        // The old fixed-target buffer lost about 7 s of these 30 s. Only the
        // first stall, before the target has adapted, may still be heard.
        let (dropout, adapted) = mobile_dropout_ms();
        assert!(dropout < 500, "{dropout} ms of dropout");
        assert!(adapted < 50, "{adapted} ms of dropout after adapting");
    }
}
