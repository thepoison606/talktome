use serde::Deserialize;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortAudioLevel {
    #[serde(default)]
    pub gain_db: f32,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub noise_suppression: bool,
}

impl PortAudioLevel {
    pub fn validate(self) -> Result<Self, String> {
        let (min, max) = (-40.0, 40.0);
        if !self.gain_db.is_finite() || self.gain_db < min || self.gain_db > max {
            return Err(format!("Gain must be between {min} and {max} dB"));
        }
        Ok(self)
    }
}

pub struct AudioGain {
    gain_milli_db: AtomicI32,
    muted: AtomicBool,
    pub noise_suppression: AtomicBool,
    pub rms_milli_db: AtomicI32,
    pub peak_milli_db: AtomicI32,
    pub clipped_samples: AtomicU64,
}

impl AudioGain {
    pub fn new(level: PortAudioLevel) -> Self {
        Self {
            gain_milli_db: AtomicI32::new((level.gain_db * 1000.0).round() as i32),
            muted: AtomicBool::new(level.muted),
            noise_suppression: AtomicBool::new(level.noise_suppression),
            rms_milli_db: AtomicI32::new(-120_000),
            peak_milli_db: AtomicI32::new(-120_000),
            clipped_samples: AtomicU64::new(0),
        }
    }

    pub fn set(&self, level: PortAudioLevel) {
        self.gain_milli_db
            .store((level.gain_db * 1000.0).round() as i32, Ordering::Relaxed);
        self.muted.store(level.muted, Ordering::Relaxed);
        self.noise_suppression
            .store(level.noise_suppression, Ordering::Relaxed);
    }

    pub fn linear(&self) -> f32 {
        if self.muted.load(Ordering::Relaxed) {
            0.0
        } else {
            10.0_f32.powf(self.gain_milli_db.load(Ordering::Relaxed) as f32 / 20_000.0)
        }
    }

    // Both channels share the same ramp. Run before encoding or output mixing;
    // a gain change never requires recreating an audio device or an RTP stream.
    pub fn process(
        &self,
        bytes: &mut [u8],
        previous_gain: &mut f32,
        meter_scale: f32,
        clamp: bool,
    ) {
        let target = self.linear();
        let frames = bytes.len() / 8;
        if frames == 0 {
            return;
        }
        let start = *previous_gain;
        let mut squares = 0.0_f64;
        let mut peak = 0.0_f32;
        let mut clipped = 0_u64;
        for (index, frame) in bytes.chunks_exact_mut(8).enumerate() {
            let gain = start + (target - start) * ((index + 1) as f32 / frames as f32);
            for sample in frame.chunks_exact_mut(4) {
                let raw = f32::from_le_bytes((&*sample).try_into().unwrap_or([0; 4]));
                let amplified = if raw.is_finite() { raw * gain } else { 0.0 };
                let metered = amplified * meter_scale;
                squares += f64::from(metered) * f64::from(metered);
                peak = peak.max(metered.abs());
                if metered.abs() > 1.0 {
                    clipped += 1;
                }
                sample.copy_from_slice(
                    &(if clamp {
                        amplified.clamp(-1.0, 1.0)
                    } else {
                        amplified
                    })
                    .to_le_bytes(),
                );
            }
        }
        *previous_gain = target;
        self.rms_milli_db.store(
            db((squares / (frames * 2) as f64).sqrt() as f32),
            Ordering::Relaxed,
        );
        self.peak_milli_db.store(db(peak), Ordering::Relaxed);
        self.clipped_samples.fetch_add(clipped, Ordering::Relaxed);
    }
}

fn db(linear: f32) -> i32 {
    (20_000.0 * linear.max(0.000001).log10()).round() as i32
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pcm(samples: &[f32]) -> Vec<u8> {
        samples
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect()
    }
    fn samples(bytes: &[u8]) -> Vec<f32> {
        bytes
            .chunks_exact(4)
            .map(|sample| f32::from_le_bytes(sample.try_into().unwrap()))
            .collect()
    }

    #[test]
    fn gain_and_mute_update_running_stereo_audio_and_track_clipping() {
        let gain = AudioGain::new(PortAudioLevel {
            gain_db: 6.0206,
            muted: false,
            noise_suppression: false,
        });
        let mut previous = gain.linear();
        let mut audio = pcm(&[0.25, -0.25, 0.75, -0.75]);
        gain.process(&mut audio, &mut previous, 1.0, true);
        let values = samples(&audio);
        assert!((values[0] - 0.5).abs() < 0.001);
        assert!((values[1] + 0.5).abs() < 0.001);
        assert_eq!(values[2], 1.0);
        assert_eq!(values[3], -1.0);
        assert_eq!(gain.clipped_samples.load(Ordering::Relaxed), 2);
        gain.set(PortAudioLevel {
            gain_db: 0.0,
            muted: true,
            noise_suppression: false,
        });
        gain.process(&mut audio, &mut previous, 1.0, true);
        let mut audio = pcm(&[0.8, -0.8]);
        gain.process(&mut audio, &mut previous, 1.0, true);
        assert_eq!(samples(&audio), vec![0.0, 0.0]);
    }

    #[test]
    fn output_keeps_headroom_for_target_attenuation_and_does_not_change_other_ports() {
        let gain = AudioGain::new(PortAudioLevel {
            gain_db: 12.0,
            muted: false,
            noise_suppression: false,
        });
        let neutral = AudioGain::new(PortAudioLevel::default());
        let mut previous = gain.linear();
        let mut audio = pcm(&[0.5, -0.5]);
        gain.process(&mut audio, &mut previous, 0.1, false);
        assert!(samples(&audio)[0] > 1.0);
        assert_eq!(gain.clipped_samples.load(Ordering::Relaxed), 0);
        assert_eq!(neutral.linear(), 1.0);
        assert!(PortAudioLevel {
            gain_db: 41.0,
            muted: false,
            noise_suppression: false,
        }
        .validate()
        .is_err());
        for gain_db in [-40.0, 25.0, 40.0] {
            assert!(PortAudioLevel {
                gain_db,
                muted: false,
                noise_suppression: false,
            }
            .validate()
            .is_ok());
        }
        assert!(PortAudioLevel {
            gain_db: -41.0,
            muted: false,
            noise_suppression: false,
        }
        .validate()
        .is_err());
        assert!(PortAudioLevel {
            gain_db: f32::NAN,
            muted: false,
            noise_suppression: false,
        }
        .validate()
        .is_err());
    }
}
