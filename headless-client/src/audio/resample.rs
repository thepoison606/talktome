//! Thin wrappers around rubato for devices that cannot run at 48 kHz.

use anyhow::{Context, Result};
use rubato::{FftFixedIn, FftFixedOut, Resampler};

/// Converts a device-rate mono stream into 48 kHz chunks (capture side).
pub struct ToInternal {
    inner: Option<FftFixedIn<f32>>,
    pending: Vec<f32>,
    chunk: usize,
}

impl ToInternal {
    pub fn new(device_rate: u32, internal_rate: u32) -> Result<Self> {
        if device_rate == internal_rate {
            return Ok(Self {
                inner: None,
                pending: Vec::new(),
                chunk: 0,
            });
        }
        let chunk = (device_rate / 100) as usize; // 10 ms
        let inner =
            FftFixedIn::<f32>::new(device_rate as usize, internal_rate as usize, chunk, 2, 1)
                .context("creating capture resampler")?;
        Ok(Self {
            inner: Some(inner),
            pending: Vec::with_capacity(chunk * 4),
            chunk,
        })
    }

    /// Feeds device samples and appends converted samples to `out`.
    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) -> Result<()> {
        let Some(inner) = self.inner.as_mut() else {
            out.extend_from_slice(input);
            return Ok(());
        };
        self.pending.extend_from_slice(input);
        while self.pending.len() >= self.chunk {
            let frame: Vec<f32> = self.pending.drain(..self.chunk).collect();
            let result = inner.process(&[frame], None).context("capture resample")?;
            out.extend_from_slice(&result[0]);
        }
        Ok(())
    }
}

/// Produces device-rate output from a 48 kHz source (playback side).
pub struct FromInternal {
    inner: Option<FftFixedOut<f32>>,
    ready: std::collections::VecDeque<f32>,
}

impl FromInternal {
    pub fn new(internal_rate: u32, device_rate: u32) -> Result<Self> {
        if device_rate == internal_rate {
            return Ok(Self {
                inner: None,
                ready: Default::default(),
            });
        }
        let chunk = (device_rate / 100) as usize;
        let inner =
            FftFixedOut::<f32>::new(internal_rate as usize, device_rate as usize, chunk, 2, 1)
                .context("creating playback resampler")?;
        Ok(Self {
            inner: Some(inner),
            ready: Default::default(),
        })
    }

    /// Fills `out` with device-rate samples, pulling 48 kHz audio from `render`
    /// as needed.
    pub fn fill<F>(&mut self, out: &mut [f32], mut render: F) -> Result<()>
    where
        F: FnMut(&mut [f32]),
    {
        let Some(inner) = self.inner.as_mut() else {
            render(out);
            return Ok(());
        };
        while self.ready.len() < out.len() {
            let needed = inner.input_frames_next();
            let mut source = vec![0f32; needed];
            render(&mut source);
            let result = inner
                .process(&[source], None)
                .context("playback resample")?;
            self.ready.extend(result[0].iter().copied());
        }
        for sample in out.iter_mut() {
            *sample = self.ready.pop_front().unwrap_or(0.0);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_rates_in_both_directions() {
        let mut up = ToInternal::new(44_100, 48_000).unwrap();
        let input: Vec<f32> = (0..4410).map(|i| (i as f32 * 0.01).sin()).collect();
        let mut out = Vec::new();
        up.process(&input, &mut out).unwrap();
        assert!((out.len() as i64 - 4800).abs() < 500, "got {}", out.len());

        let mut down = FromInternal::new(48_000, 44_100).unwrap();
        let mut device = vec![0f32; 441 * 3];
        let mut phase = 0f32;
        down.fill(&mut device, |buf| {
            for s in buf.iter_mut() {
                phase += 0.05;
                *s = phase.sin();
            }
        })
        .unwrap();
        assert!(device.iter().any(|s| s.abs() > 0.1));

        let mut passthrough = ToInternal::new(48_000, 48_000).unwrap();
        let mut out = Vec::new();
        passthrough.process(&[1.0, 2.0], &mut out).unwrap();
        assert_eq!(out, vec![1.0, 2.0]);
    }
}
