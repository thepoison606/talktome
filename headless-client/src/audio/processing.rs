//! Capture-side acoustic processing (AEC3, noise suppression, AGC2) via sonora.
//!
//! Frames are always 10 ms at 48 kHz (480 samples), independent of the Opus
//! profile. Playback is never delayed: the mixer output goes to the device
//! unchanged, and a copy is analysed as the AEC far-end.

use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, Ordering};
use std::sync::Arc;

use serde_json::Value;
use sonora::config::{
    AdaptiveDigital, EchoCanceller, FixedDigital, GainController2, HighPassFilter, NoiseSuppression,
};
use sonora::{AudioProcessing, StreamConfig};

use super::codec::SAMPLE_RATE;
use super::mixer::db_to_gain;
use crate::config::AudioConfig;

/// Sonora's processing chunk: 10 ms at 48 kHz.
pub const FRAME_SAMPLES: usize = 480;

const GAIN_MIN_DB: f32 = -30.0;
const GAIN_MAX_DB: f32 = 40.0;
const DELAY_MAX_MS: i32 = 500;
const DEFAULT_DELAY_MS: i32 = 20;

/// Shared flags between the session (server settings) and the audio thread.
pub struct ProcessingControl {
    auto_processing: AtomicBool,
    input_gain_bits: AtomicU32,
    aec_possible: AtomicBool,
    /// `-1` means estimate from observed capture + playback periods.
    delay_override_ms: AtomicI32,
    capture_period_ms: AtomicU32,
    playback_period_ms: AtomicU32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ProcessingSnapshot {
    pub auto_processing: bool,
    pub aec: bool,
    pub input_gain_db: f32,
    pub delay_ms: i32,
}

/// Subset of the server's `userAudioSettings` that this client honours live.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct UserAudioPatch {
    pub audio_auto_processing: Option<bool>,
    pub user_input_gain_db: Option<f32>,
    pub dim_amount_db: Option<f32>,
    pub dim_feeds_while_speaking: Option<bool>,
    pub dim_when_addressed: Option<bool>,
    pub play_connection_sounds: Option<bool>,
}

impl UserAudioPatch {
    pub fn from_json(value: &Value) -> Self {
        Self {
            audio_auto_processing: value.get("audioAutoProcessing").and_then(Value::as_bool),
            user_input_gain_db: json_f32(value.get("userInputGainDb"))
                .map(|db| (db * 2.0).round() / 2.0),
            dim_amount_db: json_f32(value.get("dimAmountDb")),
            dim_feeds_while_speaking: value.get("dimFeedsWhileSpeaking").and_then(Value::as_bool),
            dim_when_addressed: value.get("dimWhenAddressed").and_then(Value::as_bool),
            play_connection_sounds: value.get("playConnectionSounds").and_then(Value::as_bool),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.audio_auto_processing.is_none()
            && self.user_input_gain_db.is_none()
            && self.dim_amount_db.is_none()
            && self.dim_feeds_while_speaking.is_none()
            && self.dim_when_addressed.is_none()
            && self.play_connection_sounds.is_none()
    }

    pub fn has_dimming(&self) -> bool {
        self.dim_amount_db.is_some()
            || self.dim_feeds_while_speaking.is_some()
            || self.dim_when_addressed.is_some()
    }
}

fn json_f32(value: Option<&Value>) -> Option<f32> {
    value
        .and_then(Value::as_f64)
        .map(|n| n as f32)
        .filter(|n| n.is_finite())
}

impl ProcessingControl {
    pub fn from_audio(config: &AudioConfig) -> Arc<Self> {
        Arc::new(Self {
            auto_processing: AtomicBool::new(config.auto_processing),
            input_gain_bits: AtomicU32::new(config.input_gain_db.to_bits()),
            aec_possible: AtomicBool::new(false),
            delay_override_ms: AtomicI32::new(
                config
                    .stream_delay_ms
                    .map(|ms| ms.min(DELAY_MAX_MS as u32) as i32)
                    .unwrap_or(-1),
            ),
            capture_period_ms: AtomicU32::new(0),
            playback_period_ms: AtomicU32::new(0),
        })
    }

    pub fn set_auto_processing(&self, enabled: bool) {
        self.auto_processing.store(enabled, Ordering::Relaxed);
    }

    pub fn set_input_gain_db(&self, db: f32) {
        if db.is_finite() {
            self.input_gain_bits.store(
                db.clamp(GAIN_MIN_DB, GAIN_MAX_DB).to_bits(),
                Ordering::Relaxed,
            );
        }
    }

    pub fn set_aec_possible(&self, possible: bool) {
        self.aec_possible.store(possible, Ordering::Relaxed);
    }

    pub fn observe_capture_period_ms(&self, ms: u32) {
        self.capture_period_ms
            .store(ms.min(DELAY_MAX_MS as u32), Ordering::Relaxed);
    }

    pub fn observe_playback_period_ms(&self, ms: u32) {
        self.playback_period_ms
            .store(ms.min(DELAY_MAX_MS as u32), Ordering::Relaxed);
    }

    pub fn auto_processing(&self) -> bool {
        self.auto_processing.load(Ordering::Relaxed)
    }

    pub fn aec_possible(&self) -> bool {
        self.aec_possible.load(Ordering::Relaxed)
    }

    pub fn input_gain_db(&self) -> f32 {
        f32::from_bits(self.input_gain_bits.load(Ordering::Relaxed))
    }

    pub fn input_gain(&self) -> f32 {
        db_to_gain(self.input_gain_db())
    }

    pub fn delay_ms(&self) -> i32 {
        let override_ms = self.delay_override_ms.load(Ordering::Relaxed);
        if override_ms >= 0 {
            return override_ms.clamp(0, DELAY_MAX_MS);
        }
        let sum = self
            .capture_period_ms
            .load(Ordering::Relaxed)
            .saturating_add(self.playback_period_ms.load(Ordering::Relaxed));
        if sum == 0 {
            DEFAULT_DELAY_MS
        } else {
            sum.min(DELAY_MAX_MS as u32) as i32
        }
    }

    pub fn apply_capture_patch(&self, patch: &UserAudioPatch) {
        if let Some(enabled) = patch.audio_auto_processing {
            self.set_auto_processing(enabled);
        }
        if let Some(db) = patch.user_input_gain_db {
            self.set_input_gain_db(db);
        }
    }

    pub fn snapshot(&self) -> ProcessingSnapshot {
        let auto_processing = self.auto_processing();
        ProcessingSnapshot {
            auto_processing,
            aec: auto_processing && self.aec_possible(),
            input_gain_db: self.input_gain_db(),
            delay_ms: self.delay_ms(),
        }
    }
}

/// Owns the sonora engine and 10 ms staging buffers.
pub struct Processor {
    control: Arc<ProcessingControl>,
    apm: AudioProcessing,
    enabled: bool,
    aec: bool,
    last_delay_ms: i32,
    capture_pending: Vec<f32>,
    render_pending: Vec<f32>,
    capture_scratch: Vec<f32>,
    render_scratch: Vec<f32>,
}

impl Processor {
    pub fn new(control: Arc<ProcessingControl>) -> Self {
        let enabled = control.auto_processing();
        let aec = enabled && control.aec_possible();
        let apm = AudioProcessing::builder()
            .config(apm_config(enabled, aec))
            .capture_config(StreamConfig::new(SAMPLE_RATE, 1))
            .render_config(StreamConfig::new(SAMPLE_RATE, 1))
            .build();
        Self {
            control,
            apm,
            enabled,
            aec,
            last_delay_ms: i32::MIN,
            capture_pending: Vec::with_capacity(FRAME_SAMPLES * 4),
            render_pending: Vec::with_capacity(FRAME_SAMPLES * 4),
            capture_scratch: vec![0.0; FRAME_SAMPLES],
            render_scratch: vec![0.0; FRAME_SAMPLES],
        }
    }

    /// Appends processed 48 kHz mono samples to `dest`.
    pub fn process_capture(&mut self, samples: &[f32], dest: &mut Vec<f32>) {
        self.sync_config();
        if !self.enabled {
            if !self.capture_pending.is_empty() {
                let gain = self.control.input_gain();
                dest.extend(self.capture_pending.drain(..).map(|s| s * gain));
            }
            let gain = self.control.input_gain();
            dest.extend(samples.iter().map(|s| s * gain));
            return;
        }

        let delay = self.control.delay_ms();
        if delay != self.last_delay_ms {
            match self.apm.set_stream_delay_ms(delay) {
                Ok(()) | Err(sonora::Error::StreamParameterClamped) => {}
                Err(error) => tracing::debug!(event = "apm-delay-failed", error = %error),
            }
            self.last_delay_ms = delay;
        }

        self.capture_pending.extend_from_slice(samples);
        while self.capture_pending.len() >= FRAME_SAMPLES {
            let mut frame = [0f32; FRAME_SAMPLES];
            frame.copy_from_slice(&self.capture_pending[..FRAME_SAMPLES]);
            self.capture_pending.drain(..FRAME_SAMPLES);
            self.capture_scratch.fill(0.0);
            match self
                .apm
                .process_capture_f32(&[&frame], &mut [&mut self.capture_scratch])
            {
                Ok(()) => dest.extend_from_slice(&self.capture_scratch),
                Err(error) => {
                    tracing::debug!(event = "apm-capture-failed", error = %error);
                    dest.extend_from_slice(&frame);
                }
            }
        }
    }

    /// Feeds far-end (playback) audio to AEC. Does not modify `samples`.
    pub fn analyze_render(&mut self, samples: &[f32]) {
        self.sync_config();
        if !self.aec {
            return;
        }
        self.render_pending.extend_from_slice(samples);
        while self.render_pending.len() >= FRAME_SAMPLES {
            let mut frame = [0f32; FRAME_SAMPLES];
            frame.copy_from_slice(&self.render_pending[..FRAME_SAMPLES]);
            self.render_pending.drain(..FRAME_SAMPLES);
            self.render_scratch.fill(0.0);
            if let Err(error) = self
                .apm
                .process_render_f32(&[&frame], &mut [&mut self.render_scratch])
            {
                tracing::debug!(event = "apm-render-failed", error = %error);
            }
        }
    }

    fn sync_config(&mut self) {
        let enabled = self.control.auto_processing();
        let aec = enabled && self.control.aec_possible();
        if enabled == self.enabled && aec == self.aec {
            return;
        }
        self.apm.apply_config(apm_config(enabled, aec));
        if self.aec && !aec {
            self.render_pending.clear();
        }
        if enabled != self.enabled {
            tracing::info!(event = "audio-processing", enabled, aec,);
        }
        self.enabled = enabled;
        self.aec = aec;
        self.last_delay_ms = i32::MIN;
    }
}

fn apm_config(enabled: bool, aec: bool) -> sonora::Config {
    if !enabled {
        return sonora::Config::default();
    }
    sonora::Config {
        high_pass_filter: Some(HighPassFilter::default()),
        echo_canceller: aec.then(EchoCanceller::default),
        noise_suppression: Some(NoiseSuppression::default()),
        gain_controller2: Some(GainController2 {
            input_volume_controller: false,
            adaptive_digital: Some(AdaptiveDigital::default()),
            fixed_digital: FixedDigital::default(),
        }),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn control(auto: bool, gain_db: f32) -> Arc<ProcessingControl> {
        let config = AudioConfig {
            auto_processing: auto,
            input_gain_db: gain_db,
            ..AudioConfig::default()
        };
        ProcessingControl::from_audio(&config)
    }

    fn tone(len: usize, hz: f32, amplitude: f32) -> Vec<f32> {
        (0..len)
            .map(|i| (i as f32 * hz * std::f32::consts::TAU / SAMPLE_RATE as f32).sin() * amplitude)
            .collect()
    }

    #[test]
    fn disabled_applies_manual_gain() {
        let mut processor = Processor::new(control(false, -6.0));
        let input = vec![1.0f32; 960];
        let mut out = Vec::new();
        processor.process_capture(&input, &mut out);
        assert_eq!(out.len(), 960);
        let expected = db_to_gain(-6.0);
        assert!(
            (out[0] - expected).abs() < 1e-5,
            "got {} expected {expected}",
            out[0]
        );
        assert!((out[959] - expected).abs() < 1e-5);
    }

    #[test]
    fn enabled_emits_10ms_multiples() {
        let control = control(true, 0.0);
        let mut processor = Processor::new(control);
        let mut out = Vec::new();
        processor.process_capture(&vec![0.1; 960], &mut out);
        assert_eq!(out.len(), 960);
        out.clear();
        processor.process_capture(&vec![0.1; 100], &mut out);
        assert!(out.is_empty(), "partial 10 ms frame stays pending");
        processor.process_capture(&vec![0.1; 380], &mut out);
        assert_eq!(out.len(), FRAME_SAMPLES);
    }

    #[test]
    fn aec_changes_capture_when_render_leaks() {
        let control = control(true, 0.0);
        control.set_aec_possible(true);
        let mut processor = Processor::new(control);
        let render = tone(FRAME_SAMPLES, 440.0, 0.4);
        let near = tone(FRAME_SAMPLES, 880.0, 0.3);
        let capture: Vec<f32> = near
            .iter()
            .zip(&render)
            .map(|(n, r)| n + r * 0.25)
            .collect();
        let mut last = capture.clone();
        for _ in 0..8 {
            processor.analyze_render(&render);
            let mut out = Vec::new();
            processor.process_capture(&capture, &mut out);
            assert_eq!(out.len(), FRAME_SAMPLES);
            last = out;
        }
        assert_ne!(
            last, capture,
            "AEC/NS/AGC should modify a capture stream that contains the render signal"
        );
    }

    #[test]
    fn user_audio_patch_parses_camel_case() {
        let patch = UserAudioPatch::from_json(&serde_json::json!({
            "audioAutoProcessing": true,
            "userInputGainDb": 6.2,
            "dimAmountDb": -12,
            "dimFeedsWhileSpeaking": true,
            "dimWhenAddressed": false,
            "playConnectionSounds": false,
            "audioProfile": "low",
        }));
        assert_eq!(
            patch,
            UserAudioPatch {
                audio_auto_processing: Some(true),
                user_input_gain_db: Some(6.0),
                dim_amount_db: Some(-12.0),
                dim_feeds_while_speaking: Some(true),
                dim_when_addressed: Some(false),
                play_connection_sounds: Some(false),
            }
        );
        assert!(UserAudioPatch::from_json(&serde_json::json!(null)).is_empty());
    }
}
