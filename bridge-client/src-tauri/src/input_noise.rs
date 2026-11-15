//! Optional input-only noise suppression. Each stereo channel has its own state.
use sonora::config::NoiseSuppression;
use sonora::{AudioProcessing, StreamConfig};

pub struct InputNoiseSuppression {
    rate: u32,
    frame: usize,
    engines: Option<[AudioProcessing; 2]>,
    pending: Vec<u8>,
    input: Vec<f32>,
    output: [Vec<f32>; 2],
}
impl InputNoiseSuppression {
    pub fn new(rate: u32) -> Self {
        let frame = rate as usize / 100;
        Self {
            rate,
            frame,
            engines: None,
            pending: Vec::new(),
            input: vec![0.0; frame],
            output: [vec![0.0; frame], vec![0.0; frame]],
        }
    }
    pub fn reset_filter(&mut self) {
        self.engines = None;
    }
    pub fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }
    pub fn process(&mut self, bytes: &[u8], enabled: bool) -> Result<Vec<u8>, String> {
        if !enabled {
            self.engines = None;
            let mut result = std::mem::take(&mut self.pending);
            result.extend_from_slice(bytes);
            return Ok(result);
        }
        if !(8000..=384000).contains(&self.rate) {
            return Err(format!(
                "Noise suppression does not support {} Hz",
                self.rate
            ));
        }
        if self.engines.is_none() {
            self.engines = Some(std::array::from_fn(|_| {
                AudioProcessing::builder()
                    .config(sonora::Config {
                        noise_suppression: Some(NoiseSuppression::default()),
                        ..Default::default()
                    })
                    .capture_config(StreamConfig::new(self.rate, 1))
                    .render_config(StreamConfig::new(self.rate, 1))
                    .build()
            }));
        }
        self.pending.extend_from_slice(bytes);
        let block_bytes = self.frame * 8;
        let used = self.pending.len() / block_bytes * block_bytes;
        let mut result = Vec::with_capacity(used);
        for block in self.pending[..used].chunks_exact(block_bytes) {
            for channel in 0..2 {
                for (index, frame) in block.chunks_exact(8).enumerate() {
                    let start = channel * 4;
                    let sample = f32::from_le_bytes(frame[start..start + 4].try_into().unwrap());
                    self.input[index] = if sample.is_finite() { sample } else { 0.0 };
                }
                self.engines.as_mut().unwrap()[channel]
                    .process_capture_f32(&[&self.input], &mut [&mut self.output[channel]])
                    .map_err(|e| format!("Noise suppression failed: {e}"))?;
            }
            for index in 0..self.frame {
                for channel in 0..2 {
                    result.extend_from_slice(&self.output[channel][index].to_le_bytes());
                }
            }
        }
        self.pending.drain(..used);
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pcm(samples: &[f32]) -> Vec<u8> {
        samples.iter().flat_map(|s| s.to_le_bytes()).collect()
    }
    fn noise(frames: usize) -> Vec<f32> {
        let mut seed = 12345678_u32;
        (0..frames)
            .flat_map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                [((seed as f64 / u32::MAX as f64 - 0.5) * 0.04) as f32, 0.0]
            })
            .collect()
    }
    #[test]
    fn bypass_and_live_toggles_preserve_samples_and_partial_frames() {
        let input = pcm(&noise(1234));
        let mut ns = InputNoiseSuppression::new(48000);
        assert_eq!(ns.process(&input, false).unwrap(), input);
        let first = ns.process(&input[..137 * 8], true).unwrap();
        assert!(first.is_empty());
        let rest = ns.process(&input[137 * 8..], false).unwrap();
        assert_eq!(rest, input);
        for rate in [16000, 44100, 48000, 96000] {
            let data = pcm(&noise(rate as usize / 10));
            let mut ns = InputNoiseSuppression::new(rate);
            let mut result = Vec::new();
            for chunk in data.chunks(137 * 8) {
                result.extend(ns.process(chunk, true).unwrap());
            }
            assert_eq!(result.len(), data.len());
            assert!(!ns.has_pending());
        }
    }
    #[test]
    fn suppresses_stationary_noise_without_channel_crosstalk_and_measures_delay() {
        let rate = 48000;
        let input = noise(rate * 3);
        let mut ns = InputNoiseSuppression::new(rate as u32);
        let bytes = ns.process(&pcm(&input), true).unwrap();
        let result: Vec<f32> = bytes
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
            .collect();
        assert!(result.iter().step_by(2).all(|s| s.is_finite()));
        assert!(result.iter().skip(1).step_by(2).all(|s| s.abs() < 1e-8));
        let energy = |samples: &[f32]| {
            samples
                .iter()
                .step_by(2)
                .map(|s| f64::from(*s).powi(2))
                .sum::<f64>()
        };
        let start = rate * 2 * 2;
        let attenuation = 10.0 * (energy(&result[start..]) / energy(&input[start..])).log10();
        assert!(
            attenuation < -3.0,
            "stationary noise attenuation: {attenuation} dB"
        );
        let lag = (0..960)
            .max_by(|a, b| {
                let correlation = |lag: usize| {
                    (0..4000)
                        .map(|i| {
                            f64::from(input[(rate * 2 + i) * 2])
                                * f64::from(result[(rate * 2 + i + lag) * 2])
                        })
                        .sum::<f64>()
                };
                correlation(*a).total_cmp(&correlation(*b))
            })
            .unwrap();
        eprintln!("Noise suppression: {attenuation:.1} dB noise reduction; DSP signal delay {:.2} ms plus up to 10 ms frame staging",lag as f64/48.0);
        assert!(lag <= 480, "unexpected DSP delay: {lag} samples");
    }
}
