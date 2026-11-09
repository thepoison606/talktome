//! Preserve the OMT presentation clock across the independent encoders.
use std::collections::{HashMap, VecDeque};
use std::net::UdpSocket;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock, Weak,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime};

static CLOCKS: OnceLock<Mutex<HashMap<String, Weak<SourceClock>>>> = OnceLock::new();

pub fn projected_timestamp(
    timestamp: u32,
    captured: SystemTime,
    now: SystemTime,
    rate: u32,
) -> u32 {
    let (duration, positive) = match now.duration_since(captured) {
        Ok(duration) => (duration, true),
        Err(error) => (error.duration(), false),
    };
    let ticks = (duration.as_nanos() * u128::from(rate) / 1_000_000_000) as u32;
    if positive {
        timestamp.wrapping_add(ticks)
    } else {
        timestamp.wrapping_sub(ticks)
    }
}

#[derive(Default)]
pub struct SourceClock(Mutex<Option<(i64, SystemTime)>>);
impl SourceClock {
    pub fn for_source(id: &str) -> Arc<Self> {
        let mut clocks = CLOCKS.get_or_init(Default::default).lock().unwrap();
        clocks.retain(|_, clock| clock.strong_count() > 0);
        if let Some(clock) = clocks.get(id).and_then(Weak::upgrade) {
            return clock;
        }
        let clock = Arc::new(Self::default());
        clocks.insert(id.to_owned(), Arc::downgrade(&clock));
        clock
    }
    pub fn map(&self, ticks: i64, received: SystemTime) -> SystemTime {
        if ticks < 0 {
            return received;
        }
        let mut anchor = self.0.lock().unwrap();
        let (base, wall) = *anchor.get_or_insert((ticks, received));
        let nanos = (i128::from(ticks) - i128::from(base)) * 100;
        let delta = Duration::from_nanos(nanos.unsigned_abs().min(u128::from(u64::MAX)) as u64);
        let mapped = if nanos >= 0 {
            wall.checked_add(delta)
        } else {
            wall.checked_sub(delta)
        };
        // A source restart may reset its clock. Do not retain an old epoch.
        if let Some(mapped) = mapped {
            if mapped.duration_since(received).unwrap_or_default() < Duration::from_secs(5)
                && received.duration_since(mapped).unwrap_or_default() < Duration::from_secs(30)
            {
                return mapped;
            }
        }
        *anchor = Some((ticks, received));
        received
    }
}

pub struct AudioTimeline {
    pub clock: Arc<SourceClock>,
    frames: u64,
    anchors: VecDeque<(u64, SystemTime)>,
}
impl AudioTimeline {
    pub fn new(source: &str) -> Self {
        Self {
            clock: SourceClock::for_source(source),
            frames: 0,
            anchors: VecDeque::new(),
        }
    }
    /// Record only chunks accepted by the bounded PCM queue. Gaps in source PTS
    /// remain gaps in the RTP-to-wall-clock mapping rather than accumulating drift.
    pub fn append(&mut self, frames: usize, ticks: i64, received: SystemTime) {
        self.anchors
            .push_back((self.frames, self.clock.map(ticks, received)));
        self.frames += frames as u64;
        while self.anchors.len() > 2048 {
            self.anchors.pop_front();
        }
    }
    fn at(&self, sample: u64) -> Option<SystemTime> {
        let (position, time) = self
            .anchors
            .iter()
            .rev()
            .find(|(position, _)| *position <= sample)?;
        time.checked_add(Duration::from_secs_f64(
            (sample - position) as f64 / 48_000.0,
        ))
    }
}

/// FFmpeg receives raw PCM and loses its source timestamps. Forward its Opus
/// packets unchanged, replacing its wall-clock SRs with the original PCM clock.
pub struct AudioRtpRelay {
    port: u16,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}
impl AudioRtpRelay {
    pub fn start(
        ip: &str,
        port: u16,
        ssrc: u32,
        cname: String,
        timeline: Arc<Mutex<AudioTimeline>>,
    ) -> Result<Self, String> {
        let input = UdpSocket::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let local_port = input.local_addr().map_err(|e| e.to_string())?.port();
        input
            .set_read_timeout(Some(Duration::from_millis(100)))
            .map_err(|e| e.to_string())?;
        let output = UdpSocket::bind(if ip.contains(':') {
            "[::]:0"
        } else {
            "0.0.0.0:0"
        })
        .map_err(|e| e.to_string())?;
        output.connect((ip, port)).map_err(|e| e.to_string())?;
        output
            .set_write_timeout(Some(Duration::from_millis(100)))
            .map_err(|e| e.to_string())?;
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = Arc::clone(&stop);
        let thread = thread::spawn(move || {
            let mut buffer = [0u8; 65536];
            let mut first = None;
            let mut samples = 0u64;
            let mut previous = 0u32;
            let (mut packets, mut octets) = (0u32, 0u32);
            let mut report = Instant::now() - Duration::from_secs(2);
            while !stopping.load(Ordering::Relaxed) {
                let Ok(size) = input.recv(&mut buffer) else {
                    continue;
                };
                if size < 12 || buffer[0] >> 6 != 2 || (192..=223).contains(&buffer[1]) {
                    continue;
                }
                if u32::from_be_bytes(buffer[8..12].try_into().unwrap()) != ssrc {
                    continue;
                }
                let timestamp = u32::from_be_bytes(buffer[4..8].try_into().unwrap());
                if first.is_none() {
                    first = Some(timestamp);
                    previous = timestamp;
                }
                let delta = timestamp.wrapping_sub(previous);
                if delta < 0x8000_0000 {
                    samples += u64::from(delta);
                    previous = timestamp;
                }
                if output.send(&buffer[..size]).is_err() {
                    break;
                }
                packets = packets.wrapping_add(1);
                octets = octets.wrapping_add((size - 12) as u32);
                if report.elapsed() >= Duration::from_secs(1) {
                    let time = timeline
                        .lock()
                        .ok()
                        .and_then(|timeline| timeline.at(samples));
                    if let Some(time) = time {
                        let now = SystemTime::now();
                        let projected = projected_timestamp(previous, time, now, 48_000);
                        let sr = crate::video_media::sender_report(
                            ssrc, projected, packets, octets, now, &cname,
                        );
                        if output.send(&sr).is_err() {
                            break;
                        }
                        report = Instant::now();
                    }
                }
            }
        });
        Ok(Self {
            port: local_port,
            stop,
            thread: Some(thread),
        })
    }
    pub fn port(&self) -> u16 {
        self.port
    }
}
impl Drop for AudioRtpRelay {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::UNIX_EPOCH;

    #[test]
    fn delayed_video_and_audio_use_one_source_clock() {
        let audio = SourceClock::for_source("sync-unit-source");
        let video = SourceClock::for_source("sync-unit-source");
        let wall = UNIX_EPOCH + Duration::from_secs(2_000_000);
        assert_eq!(audio.map(0, wall), wall);
        // Same source instant, but video decode delivers it 240 ms later.
        let expected = wall + Duration::from_secs(1);
        assert_eq!(audio.map(10_000_000, expected), expected);
        assert_eq!(
            video.map(10_000_000, expected + Duration::from_millis(240)),
            expected
        );
        let unrelated = SourceClock::for_source("different-sync-unit-source");
        assert_eq!(
            unrelated.map(10_000_000, expected + Duration::from_secs(1)),
            expected + Duration::from_secs(1)
        );
    }

    #[test]
    fn queued_pcm_gaps_do_not_become_accumulating_audio_drift() {
        let mut audio = AudioTimeline::new("pcm-gap-unit-source");
        let wall = UNIX_EPOCH + Duration::from_secs(2_000_000);
        audio.append(480, 0, wall);
        audio.append(480, 100_000, wall + Duration::from_millis(10));
        // A dropped chunk is not queued. Next packet keeps its original PTS.
        audio.append(480, 300_000, wall + Duration::from_millis(30));
        assert_eq!(audio.at(960), Some(wall + Duration::from_millis(30)));
        assert_eq!(audio.at(1200), Some(wall + Duration::from_millis(35)));
    }

    #[test]
    fn sender_reports_project_the_source_clock_through_encoder_delay_and_wrap() {
        let wall = UNIX_EPOCH + Duration::from_secs(2_000_000);
        assert_eq!(
            projected_timestamp(
                u32::MAX - 479,
                wall,
                wall + Duration::from_millis(10),
                48_000
            ),
            0
        );
        assert_eq!(
            projected_timestamp(1000, wall, wall + Duration::from_millis(200), 90_000),
            19000
        );
        assert_eq!(
            projected_timestamp(19000, wall + Duration::from_millis(200), wall, 90_000),
            1000
        );
    }

    #[test]
    fn rtp_relay_preserves_opus_and_replaces_ffmpeg_clock_and_cname() {
        let output = UdpSocket::bind("127.0.0.1:0").unwrap();
        output
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        let source_time = SystemTime::now() - Duration::from_millis(200);
        let mut timeline = AudioTimeline::new("rtp-relay-unit-source");
        timeline.append(960, 0, source_time);
        let relay = AudioRtpRelay::start(
            "127.0.0.1",
            output.local_addr().unwrap().port(),
            1234,
            "same-feed-cname".into(),
            Arc::new(Mutex::new(timeline)),
        )
        .unwrap();
        let input = UdpSocket::bind("127.0.0.1:0").unwrap();
        let mut rtp = vec![0x80, 100, 0, 1];
        rtp.extend_from_slice(&9000u32.to_be_bytes());
        rtp.extend_from_slice(&1234u32.to_be_bytes());
        rtp.extend_from_slice(&[0xf8, 0xff, 0xfe]);
        // An upstream report must not leak FFmpeg's independent clock.
        input
            .send_to(
                &[0x80, 200, 0, 6, 0, 0, 4, 210, 0, 0, 0, 0],
                ("127.0.0.1", relay.port()),
            )
            .unwrap();
        input.send_to(&rtp, ("127.0.0.1", relay.port())).unwrap();
        let mut buffer = [0u8; 1500];
        let size = output.recv(&mut buffer).unwrap();
        assert_eq!(&buffer[..size], &rtp);
        let size = output.recv(&mut buffer).unwrap();
        assert_eq!(buffer[1], 200);
        assert!(buffer[..size]
            .windows(15)
            .any(|name| name == b"same-feed-cname"));
        let reference = u32::from_be_bytes(buffer[16..20].try_into().unwrap());
        assert!(
            reference.wrapping_sub(9000) >= 9600,
            "report must retain 200 ms source age"
        );
        assert!(
            reference.wrapping_sub(9000) < 14400,
            "unexpected relay delay"
        );
    }
}
