//! Clocked stereo silence/test source. Uses the same encoder/gain path as capture.
use std::sync::{
    atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering},
    mpsc::SyncSender,
    Arc,
};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub struct VirtualInput {
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}
impl VirtualInput {
    pub fn start(
        id: &str,
        sender: SyncSender<Vec<u8>>,
        level: Arc<AtomicI32>,
        frames: Arc<AtomicU64>,
    ) -> Result<Self, String> {
        let frequency = match id {
            "bridge:none" => 0.0,
            "bridge:tone:400" => 400.0,
            "bridge:tone:1000" => 1000.0,
            _ => return Err("Unsupported virtual audio source".into()),
        };
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let worker = std::thread::spawn(move || {
            let mut offset = 0_u64;
            let mut next = Instant::now();
            while !flag.load(Ordering::Relaxed) {
                let bytes = render(frequency, offset, 480);
                if sender.try_send(bytes).is_ok() {
                    frames.fetch_add(480, Ordering::Relaxed);
                }
                level.store(
                    if frequency == 0.0 { -120000 } else { -20000 },
                    Ordering::Relaxed,
                );
                offset += 480;
                next += Duration::from_millis(10);
                let now = Instant::now();
                if next > now {
                    std::thread::sleep(next - now);
                } else {
                    next = now;
                }
            }
        });
        Ok(Self {
            stop,
            worker: Some(worker),
        })
    }
}
fn render(frequency: f64, offset: u64, frames: usize) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(frames * 8);
    for i in 0..frames {
        let sample = (std::f64::consts::TAU * frequency * ((offset + i as u64) as f64 / 48000.0))
            .sin() as f32
            * std::f32::consts::SQRT_2
            * 0.1;
        bytes.extend_from_slice(&sample.to_le_bytes());
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}
impl Drop for VirtualInput {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
#[cfg(test)]
mod tests {
    #[test]
    fn sources_are_stereo_and_calibrated() {
        for hz in [400.0, 1000.0] {
            let bytes = super::render(hz, 0, 48000);
            let samples: Vec<f32> = bytes
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
                .collect();
            assert!(samples.chunks_exact(2).all(|s| s[0] == s[1]));
            let rms = (samples.iter().map(|s| f64::from(*s).powi(2)).sum::<f64>()
                / samples.len() as f64)
                .sqrt();
            assert!((20.0 * rms.log10() + 20.0).abs() < 0.001);
        }
        assert!(super::render(0.0, 0, 480).iter().all(|b| *b == 0));
    }
}
