//! Level trigger: activates when the input exceeds a threshold and releases
//! after a hang time below it.

use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct LevelTrigger {
    threshold_db: f32,
    hang: Duration,
    active: bool,
    last_above: Option<Instant>,
}

impl LevelTrigger {
    pub fn new(threshold_db: f32, hang_ms: u64) -> Self {
        Self {
            threshold_db,
            hang: Duration::from_millis(hang_ms),
            active: false,
            last_above: None,
        }
    }

    /// Feeds one level measurement; returns the new state if it changed.
    pub fn update(&mut self, level_db: f32, now: Instant) -> Option<bool> {
        if level_db >= self.threshold_db {
            self.last_above = Some(now);
            if !self.active {
                self.active = true;
                return Some(true);
            }
            return None;
        }
        if self.active {
            let expired = self
                .last_above
                .map(|t| now.duration_since(t) >= self.hang)
                .unwrap_or(true);
            if expired {
                self.active = false;
                return Some(false);
            }
        }
        None
    }
}

/// Peak level of a frame in dBFS.
pub fn peak_db(frame: &[f32]) -> f32 {
    let peak = frame.iter().fold(0f32, |acc, s| acc.max(s.abs()));
    if peak <= 1e-6 {
        -120.0
    } else {
        20.0 * peak.log10()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn triggers_and_hangs() {
        let mut trigger = LevelTrigger::new(-30.0, 500);
        let t0 = Instant::now();
        assert_eq!(trigger.update(-40.0, t0), None);
        assert_eq!(trigger.update(-20.0, t0), Some(true));
        assert_eq!(trigger.update(-40.0, t0 + Duration::from_millis(200)), None);
        assert_eq!(
            trigger.update(-40.0, t0 + Duration::from_millis(600)),
            Some(false)
        );
        assert!((peak_db(&[0.5, -0.25]) + 6.02).abs() < 0.1);
        assert_eq!(peak_db(&[0.0; 10]), -120.0);
    }
}
