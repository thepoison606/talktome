//! Optional network-video ingest. Audio retains its existing independent path.
use openh264::encoder::{
    BitRate, Encoder, EncoderConfig, FrameRate, IntraFramePeriod, Level, Profile,
};
use openh264::formats::{BgraSliceU8, YUVBuffer};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{ToSocketAddrs, UdpSocket};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc::{sync_channel, SyncSender, TrySendError},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_VIDEO_FPS: f64 = 30.0;
const VIDEO_BITRATE: u32 = 2_400_000;

/// Keep the source cadence (50 -> 25, 59.94 -> 29.97) instead of unevenly
/// sampling every 67 ms. A small arrival-time tolerance avoids halving 30 fps
/// sources when consecutive frames arrive just below the nominal interval.
struct FramePacer {
    interval: Duration,
    next: Option<Instant>,
}
impl Default for FramePacer {
    fn default() -> Self {
        Self {
            interval: Duration::from_secs_f64(1.0 / MAX_VIDEO_FPS),
            next: None,
        }
    }
}
impl FramePacer {
    fn set_source_rate(&mut self, numerator: i32, denominator: i32) {
        let source = if numerator > 0 && denominator > 0 {
            f64::from(numerator) / f64::from(denominator)
        } else {
            MAX_VIDEO_FPS
        };
        let source = if (1.0..=240.0).contains(&source) {
            source
        } else {
            MAX_VIDEO_FPS
        };
        let rate = source / (source / MAX_VIDEO_FPS).ceil();
        let interval = Duration::from_secs_f64(1.0 / rate);
        if self.interval != interval {
            self.interval = interval;
            self.next = None;
        }
    }
    fn accept(&mut self, now: Instant) -> bool {
        let tolerance = Duration::from_millis(2);
        if let Some(next) = self.next {
            if now + tolerance < next {
                return false;
            }
            // Preserve phase across ordinary jitter, but never catch up with a
            // burst after a stalled/disconnected source.
            self.next = Some(if now.saturating_duration_since(next) < self.interval {
                next + self.interval
            } else {
                now + self.interval
            });
        } else {
            self.next = Some(now + self.interval);
        }
        true
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSource {
    pub id: String,
    pub name: String,
    pub protocol: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartVideoRequest {
    pub stream_id: String,
    pub source_id: String,
    pub rtp_ip: String,
    pub rtp_port: u16,
    pub payload_type: u8,
    pub ssrc: u32,
    #[serde(default)]
    pub cname: String,
}
#[derive(Default)]
struct Counters {
    encoded: AtomicU64,
    dropped: AtomicU64,
    last_frame: AtomicU64,
    error: Mutex<Option<String>>,
    running: AtomicBool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoStatus {
    pub stream_id: String,
    pub running: bool,
    pub encoded_frames: u64,
    pub dropped_frames: u64,
    pub last_frame_age_ms: Option<u64>,
    pub error: Option<String>,
}
struct RawFrame {
    data: Vec<u8>,
    width: usize,
    height: usize,
    presentation_time: SystemTime,
}
pub struct VideoSink {
    sender: SyncSender<RawFrame>,
    pub stop: Arc<AtomicBool>,
    stats: Arc<Counters>,
    pacer: FramePacer,
    source_clock: Option<Arc<crate::media_timing::SourceClock>>,
    presentation_time: Option<SystemTime>,
}
impl VideoSink {
    pub fn set_source_timestamp(&mut self, timestamp: i64) {
        self.presentation_time = self
            .source_clock
            .as_ref()
            .map(|clock| clock.map(timestamp, SystemTime::now()));
    }
    pub fn set_source_rate(&mut self, numerator: i32, denominator: i32) {
        self.pacer.set_source_rate(numerator, denominator);
    }
    /// The backend owns `data` until this call returns. Validate geometry before
    /// copying and keep only one queued frame so a slow encoder cannot backlog.
    pub unsafe fn bgra(
        &mut self,
        width: i32,
        height: i32,
        stride: i32,
        data: *const u8,
        data_length: Option<usize>,
    ) -> Result<(), String> {
        let now = Instant::now();
        let (w, h) = (
            usize::try_from(width).unwrap_or(0),
            usize::try_from(height).unwrap_or(0),
        );
        if data.is_null() || w < 2 || h < 2 || w > 8192 || h > 4320 {
            return Err("Invalid network video dimensions".into());
        }
        let row = w.checked_mul(4).ok_or("Video row overflow")?;
        let step = if stride == 0 {
            row
        } else {
            usize::try_from(stride).map_err(|_| "Negative video stride is unsupported")?
        };
        let required = step
            .checked_mul(h - 1)
            .and_then(|n| n.checked_add(row))
            .ok_or("Video buffer overflow")?;
        if step < row
            || required > 144 * 1024 * 1024
            || data_length.is_some_and(|len| len < required)
        {
            return Err("Invalid network video buffer length".into());
        }
        if !self.pacer.accept(now) {
            return Ok(());
        }
        let input = unsafe { std::slice::from_raw_parts(data, required) };
        let mut bytes = vec![0; row * h];
        for y in 0..h {
            bytes[y * row..(y + 1) * row].copy_from_slice(&input[y * step..y * step + row]);
        }
        match self.sender.try_send(RawFrame {
            data: bytes,
            width: w,
            height: h,
            presentation_time: self
                .presentation_time
                .take()
                .unwrap_or_else(SystemTime::now),
        }) {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => {
                self.stats.dropped.fetch_add(1, Ordering::Relaxed);
                Ok(())
            }
            Err(TrySendError::Disconnected(_)) => Err("Video encoder stopped".into()),
        }
    }
}
struct Runtime {
    stop: Arc<AtomicBool>,
    stats: Arc<Counters>,
    threads: Vec<JoinHandle<()>>,
}
impl Drop for Runtime {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        for handle in self.threads.drain(..) {
            let _ = handle.join();
        }
    }
}
#[derive(Default)]
pub struct VideoManager {
    streams: Mutex<HashMap<String, Runtime>>,
}
impl VideoManager {
    pub fn start(&self, request: StartVideoRequest) -> Result<(), String> {
        self.start_with_capture(request, |source, sink| {
            if crate::ndi::is_input_device(&source) {
                crate::ndi::capture_video(&source, sink)
            } else {
                crate::omt::capture_video(&source, sink)
            }
        })
    }
    fn start_with_capture<F>(
        &self,
        request: StartVideoRequest,
        capture_source: F,
    ) -> Result<(), String>
    where
        F: FnOnce(String, VideoSink) -> Result<(), String> + Send + 'static,
    {
        if request.stream_id.is_empty()
            || request.stream_id.len() > 200
            || request.payload_type > 127
            || request.rtp_port == 0
            || request.ssrc == 0
        {
            return Err("Invalid video RTP request".into());
        }
        if !crate::ndi::is_input_device(&request.source_id)
            && !crate::omt::is_input_device(&request.source_id)
        {
            return Err("Choose an NDI or OMT video source".into());
        }
        let destination = (request.rtp_ip.as_str(), request.rtp_port)
            .to_socket_addrs()
            .map_err(|e| e.to_string())?
            .next()
            .ok_or("Video RTP address unavailable")?;
        let socket = UdpSocket::bind(if destination.is_ipv6() {
            "[::]:0"
        } else {
            "0.0.0.0:0"
        })
        .map_err(|e| e.to_string())?;
        socket.connect(destination).map_err(|e| e.to_string())?;
        socket
            .set_write_timeout(Some(Duration::from_millis(100)))
            .map_err(|e| e.to_string())?;
        let config = EncoderConfig::new()
            .bitrate(BitRate::from_bps(VIDEO_BITRATE))
            .max_frame_rate(FrameRate::from_hz(MAX_VIDEO_FPS as f32))
            .profile(Profile::Baseline)
            .level(Level::Level_3_1)
            .num_threads(2)
            .intra_frame_period(IntraFramePeriod::from_num_frames(MAX_VIDEO_FPS as u32));
        let mut encoder = Encoder::with_api_config(openh264::OpenH264API::from_source(), config)
            .map_err(|e| e.to_string())?;
        let stop = Arc::new(AtomicBool::new(false));
        let stats = Arc::new(Counters::default());
        stats.running.store(true, Ordering::Relaxed);
        let (sender, receiver) = sync_channel::<RawFrame>(1);
        let sink = VideoSink {
            sender,
            stop: Arc::clone(&stop),
            stats: Arc::clone(&stats),
            pacer: FramePacer::default(),
            source_clock: crate::omt::is_input_device(&request.source_id)
                .then(|| crate::media_timing::SourceClock::for_source(&request.source_id)),
            presentation_time: None,
        };
        let capture_stats = Arc::clone(&stats);
        let capture_stop = Arc::clone(&stop);
        let source = request.source_id;
        let capture = thread::spawn(move || {
            let result = capture_source(source, sink);
            if let Err(error) = result {
                if let Ok(mut current) = capture_stats.error.lock() {
                    *current = Some(error);
                }
                capture_stop.store(true, Ordering::Relaxed);
            }
        });
        let encoding_stats = Arc::clone(&stats);
        let encoding_stop = Arc::clone(&stop);
        let encode = thread::spawn(move || {
            let mut sequence = now_ms() as u16;
            let mut keyframe = Instant::now() - Duration::from_secs(2);
            let mut report = Instant::now() - Duration::from_secs(2);
            let (mut packets, mut octets) = (0u32, 0u32);
            while !encoding_stop.load(Ordering::Relaxed) {
                let frame = match receiver.recv_timeout(Duration::from_millis(100)) {
                    Ok(frame) => frame,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(_) => break,
                };
                let (pixels, width, height) = scale_bgra(&frame.data, frame.width, frame.height);
                let yuv = YUVBuffer::from_bgra8_source(BgraSliceU8::new(&pixels, (width, height)));
                if keyframe.elapsed() >= Duration::from_secs(1) {
                    encoder.force_intra_frame();
                    keyframe = Instant::now();
                }
                let result = encoder
                    .encode(&yuv)
                    .map_err(|e| e.to_string())
                    .and_then(|stream| {
                        let bytes = stream.to_vec();
                        let timestamp = frame
                            .presentation_time
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_micros()
                            .wrapping_mul(90)
                            / 1000;
                        for packet in packetize_h264(
                            &bytes,
                            &mut sequence,
                            timestamp as u32,
                            request.ssrc,
                            request.payload_type,
                        ) {
                            socket
                                .send(&packet)
                                .map_err(|e| format!("Video RTP: {e}"))?;
                            packets = packets.wrapping_add(1);
                            octets = octets.wrapping_add((packet.len() - 12) as u32);
                        }
                        if report.elapsed() >= Duration::from_secs(1) {
                            // Report the current source clock, including time spent
                            // decoding/scaling/encoding, rather than re-timestamping
                            // the picture when its encoded bytes happen to arrive.
                            let now = SystemTime::now();
                            let projected = crate::media_timing::projected_timestamp(
                                timestamp as u32,
                                frame.presentation_time,
                                now,
                                90_000,
                            );
                            let packet = sender_report(
                                request.ssrc,
                                projected,
                                packets,
                                octets,
                                now,
                                &request.cname,
                            );
                            socket
                                .send(&packet)
                                .map_err(|e| format!("Video RTCP: {e}"))?;
                            report = Instant::now();
                        }
                        Ok(())
                    });
                if let Err(error) = result {
                    if let Ok(mut current) = encoding_stats.error.lock() {
                        *current = Some(error);
                    }
                    encoding_stop.store(true, Ordering::Relaxed);
                    break;
                }
                encoding_stats.encoded.fetch_add(1, Ordering::Relaxed);
                encoding_stats.last_frame.store(now_ms(), Ordering::Relaxed);
            }
            encoding_stats.running.store(false, Ordering::Relaxed);
        });
        let runtime = Runtime {
            stop,
            stats,
            threads: vec![capture, encode],
        };
        self.streams
            .lock()
            .map_err(|_| "Video state lock poisoned")?
            .insert(request.stream_id, runtime);
        Ok(())
    }
    pub fn stop(&self, id: &str) -> Result<(), String> {
        self.streams
            .lock()
            .map_err(|_| "Video state lock poisoned")?
            .remove(id);
        Ok(())
    }
    pub fn stop_all(&self) -> Result<(), String> {
        self.streams
            .lock()
            .map_err(|_| "Video state lock poisoned")?
            .clear();
        Ok(())
    }
    pub fn status(&self) -> Result<Vec<VideoStatus>, String> {
        Ok(self
            .streams
            .lock()
            .map_err(|_| "Video state lock poisoned")?
            .iter()
            .map(|(id, runtime)| {
                let last = runtime.stats.last_frame.load(Ordering::Relaxed);
                VideoStatus {
                    stream_id: id.clone(),
                    running: runtime.stats.running.load(Ordering::Relaxed),
                    encoded_frames: runtime.stats.encoded.load(Ordering::Relaxed),
                    dropped_frames: runtime.stats.dropped.load(Ordering::Relaxed),
                    last_frame_age_ms: (last > 0).then(|| now_ms().saturating_sub(last)),
                    error: runtime
                        .stats
                        .error
                        .lock()
                        .ok()
                        .and_then(|error| error.clone()),
                }
            })
            .collect())
    }
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn scale_bgra(input: &[u8], width: usize, height: usize) -> (Vec<u8>, usize, usize) {
    let scale = (1280.0 / width as f64).min(720.0 / height as f64).min(1.0);
    let w = ((width as f64 * scale) as usize / 2 * 2).max(2);
    let h = ((height as f64 * scale) as usize / 2 * 2).max(2);
    if w == width && h == height {
        return (input.to_vec(), w, h);
    }
    let mut output = vec![0; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let source = ((y * height / h) * width + x * width / w) * 4;
            let target = (y * w + x) * 4;
            output[target..target + 4].copy_from_slice(&input[source..source + 4]);
        }
    }
    (output, w, h)
}
fn packetize_h264(
    annex_b: &[u8],
    sequence: &mut u16,
    timestamp: u32,
    ssrc: u32,
    payload_type: u8,
) -> Vec<Vec<u8>> {
    let mut starts = Vec::new();
    let mut index = 0;
    while index + 3 <= annex_b.len() {
        let length = if annex_b.get(index..index + 4) == Some(&[0, 0, 0, 1]) {
            4
        } else if annex_b.get(index..index + 3) == Some(&[0, 0, 1]) {
            3
        } else {
            index += 1;
            continue;
        };
        starts.push((index, index + length));
        index += length;
    }
    let mut payloads = Vec::new();
    for (number, (_, begin)) in starts.iter().enumerate() {
        let end = starts
            .get(number + 1)
            .map(|entry| entry.0)
            .unwrap_or(annex_b.len());
        let nal = &annex_b[*begin..end];
        if nal.is_empty() {
            continue;
        }
        if nal.len() <= 1100 {
            payloads.push(nal.to_vec());
        } else {
            let chunks = nal[1..].chunks(1098);
            let count = chunks.len();
            for (n, chunk) in chunks.enumerate() {
                let mut payload = vec![
                    (nal[0] & 0xe0) | 28,
                    (nal[0] & 0x1f)
                        | if n == 0 { 0x80 } else { 0 }
                        | if n + 1 == count { 0x40 } else { 0 },
                ];
                payload.extend_from_slice(chunk);
                payloads.push(payload);
            }
        }
    }
    let total = payloads.len();
    payloads
        .into_iter()
        .enumerate()
        .map(|(index, payload)| {
            let mut packet = vec![
                0x80,
                payload_type | if index + 1 == total { 0x80 } else { 0 },
            ];
            packet.extend_from_slice(&sequence.to_be_bytes());
            packet.extend_from_slice(&timestamp.to_be_bytes());
            packet.extend_from_slice(&ssrc.to_be_bytes());
            packet.extend_from_slice(&payload);
            *sequence = sequence.wrapping_add(1);
            packet
        })
        .collect()
}

// Compound RTCP SR + SDES (RFC 3550); muxed on the same UDP socket as RTP.
pub(crate) fn sender_report(
    ssrc: u32,
    timestamp: u32,
    packets: u32,
    octets: u32,
    time: SystemTime,
    cname: &str,
) -> Vec<u8> {
    let unix = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let seconds = (unix.as_secs() + 2_208_988_800) as u32;
    let fraction = ((u64::from(unix.subsec_nanos()) << 32) / 1_000_000_000) as u32;
    let mut packet = vec![0x80, 200, 0, 6];
    for value in [ssrc, seconds, fraction, timestamp, packets, octets] {
        packet.extend_from_slice(&value.to_be_bytes());
    }
    let name = if cname.is_empty() {
        "talktome-bridge-video"
    } else {
        cname
    };
    let name = &name.as_bytes()[..name.len().min(255)];
    let mut sdes = vec![0x81, 202, 0, 0];
    sdes.extend_from_slice(&ssrc.to_be_bytes());
    sdes.extend_from_slice(&[1, name.len() as u8]);
    sdes.extend_from_slice(name);
    sdes.push(0);
    while sdes.len() % 4 != 0 {
        sdes.push(0);
    }
    let length = (sdes.len() / 4 - 1) as u16;
    sdes[2..4].copy_from_slice(&length.to_be_bytes());
    packet.extend_from_slice(&sdes);
    packet
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use openh264::formats::YUVSource;

    #[test]
    fn frame_pacer_keeps_source_cadence_despite_arrival_jitter() {
        for (n, d, count, expected) in [
            (25, 1, 250, 250),
            (30, 1, 300, 300),
            (50, 1, 500, 250),
            (60, 1, 600, 300),
            (30000, 1001, 300, 300),
            (60000, 1001, 600, 300),
        ] {
            let mut pacer = FramePacer::default();
            let start = Instant::now();
            let mut accepted = 0;
            for frame in 0..count {
                pacer.set_source_rate(n, d);
                let jitter = if frame % 2 == 0 { 0.0007 } else { 0.0 };
                let now =
                    start + Duration::from_secs_f64(f64::from(frame * d) / f64::from(n) + jitter);
                accepted += usize::from(pacer.accept(now));
            }
            assert_eq!(accepted, expected, "source {n}/{d}");
        }
    }

    #[test]
    fn frame_pacer_resets_after_stalls_and_rate_changes_without_a_burst() {
        let mut pacer = FramePacer::default();
        let start = Instant::now();
        assert!(pacer.accept(start));
        let resumed = start + Duration::from_secs(5);
        assert!(pacer.accept(resumed));
        assert!(!pacer.accept(resumed + Duration::from_millis(5)));
        pacer.set_source_rate(50, 1);
        assert!(pacer.accept(resumed + Duration::from_millis(20)));
        assert!(!pacer.accept(resumed + Duration::from_millis(40)));
        assert!(pacer.accept(resumed + Duration::from_millis(60)));
        pacer.set_source_rate(0, 0);
        assert_eq!(pacer.interval, Duration::from_secs_f64(1.0 / 30.0));
    }

    fn depacketize(packets: &[Vec<u8>]) -> Vec<u8> {
        let mut annex = Vec::new();
        for packet in packets {
            let payload = &packet[12..];
            if payload[0] & 31 == 28 {
                if payload[1] & 0x80 != 0 {
                    annex.extend_from_slice(&[0, 0, 0, 1, (payload[0] & 0xe0) | (payload[1] & 31)]);
                }
                annex.extend_from_slice(&payload[2..]);
            } else {
                annex.extend_from_slice(&[0, 0, 0, 1]);
                annex.extend_from_slice(payload);
            }
        }
        annex
    }

    #[test]
    fn h264_packetization_round_trips_fragmented_nals_and_wraps_sequence() {
        let mut annex = vec![0, 0, 0, 1, 0x67, 0x42, 0xe0, 0x1f, 0, 0, 1, 0x65];
        annex.extend((0..4000).map(|n| (n % 251 + 1) as u8));
        let mut sequence = u16::MAX;
        let packets = packetize_h264(&annex, &mut sequence, 90000, 1234, 102);
        assert!(packets.len() >= 5);
        for (index, packet) in packets.iter().enumerate() {
            assert!(packet.len() <= 1112);
            assert_eq!(packet[1] & 127, 102);
            assert_eq!(packet[1] & 128 != 0, index + 1 == packets.len());
            assert_eq!(
                u16::from_be_bytes(packet[2..4].try_into().unwrap()),
                u16::MAX.wrapping_add(index as u16)
            );
            assert_eq!(&packet[4..8], &90000u32.to_be_bytes());
            assert_eq!(&packet[8..12], &1234u32.to_be_bytes());
        }
        // Normalize the three-byte input start code to four bytes.
        let mut normalized = annex[..8].to_vec();
        normalized.extend_from_slice(&[0, 0, 0, 1]);
        normalized.extend_from_slice(&annex[11..]);
        assert_eq!(depacketize(&packets), normalized);
    }

    #[test]
    fn real_encoder_rtp_round_trip_decodes_a_picture() {
        let (w, h) = (320, 180);
        let pixels = (0..w * h)
            .flat_map(|i| [(i % 256) as u8, ((i / w) % 256) as u8, 180, 255])
            .collect::<Vec<u8>>();
        let yuv = YUVBuffer::from_bgra8_source(BgraSliceU8::new(&pixels, (w, h)));
        let config = EncoderConfig::new()
            .profile(Profile::Baseline)
            .level(Level::Level_3_1);
        let mut encoder =
            Encoder::with_api_config(openh264::OpenH264API::from_source(), config).unwrap();
        let bytes = encoder.encode(&yuv).unwrap().to_vec();
        let packets = packetize_h264(&bytes, &mut 100, 9000, 9999, 102);
        assert!(!packets.is_empty());
        let annex = depacketize(&packets);
        let mut decoder = openh264::decoder::Decoder::new().unwrap();
        let decoded = decoder.decode(&annex).unwrap().expect("H.264 frame");
        assert_eq!(decoded.dimensions(), (w, h));
        assert!(decoded.y().iter().any(|value| *value > 50));
    }

    #[test]
    fn scales_to_even_bounded_dimensions_and_rejects_truncated_native_buffers() {
        let input = vec![127; 1920 * 1080 * 4];
        let (_, w, h) = scale_bgra(&input, 1920, 1080);
        assert_eq!((w, h), (1280, 720));
        let (tx, _rx) = sync_channel(1);
        let mut sink = VideoSink {
            sender: tx,
            stop: Arc::new(AtomicBool::new(false)),
            stats: Arc::new(Counters::default()),
            pacer: FramePacer::default(),
            source_clock: None,
            presentation_time: None,
        };
        let small = [0u8; 16];
        assert!(unsafe { sink.bgra(10, 10, 40, small.as_ptr(), Some(small.len())) }.is_err());
        assert!(unsafe { sink.bgra(2, 2, -8, small.as_ptr(), Some(small.len())) }.is_err());
    }

    #[test]
    fn rtcp_sender_report_has_wallclock_and_cname_for_sync() {
        let packet = sender_report(
            123,
            90000,
            30,
            4000,
            UNIX_EPOCH + Duration::from_millis(1500),
            "feed-1",
        );
        assert_eq!(&packet[..4], &[0x80, 200, 0, 6]);
        assert_eq!(
            u32::from_be_bytes(packet[8..12].try_into().unwrap()),
            2_208_988_801
        );
        assert_eq!(
            u32::from_be_bytes(packet[12..16].try_into().unwrap()),
            0x80000000
        );
        assert_eq!(packet[29], 202);
        assert!(packet.windows(6).any(|part| part == b"feed-1"));
        assert_eq!(packet.len() % 4, 0);
    }
    pub(crate) fn run_external_video_probe(protocol: &str, name: &str) {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "video_media::tests::network_video_probe",
                "--nocapture",
            ])
            .env("TALKTOME_VIDEO_TEST_PROTOCOL", protocol)
            .env("TALKTOME_VIDEO_TEST_NAME", name)
            .output()
            .expect("start network video probe");
        print!("{}", String::from_utf8_lossy(&output.stdout));
        assert!(
            output.status.success(),
            "video probe failed: {}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    #[ignore = "helper for cross-process NDI/OMT video loopbacks"]
    fn network_video_probe() {
        let Ok(protocol) = std::env::var("TALKTOME_VIDEO_TEST_PROTOCOL") else {
            return;
        };
        let name = std::env::var("TALKTOME_VIDEO_TEST_NAME").unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        let source = loop {
            let sources = if protocol == "ndi" {
                crate::ndi::video_sources(Duration::from_millis(300))
            } else {
                crate::omt::video_sources(Duration::from_millis(300))
            };
            if let Some(source) = sources
                .into_iter()
                .find(|source| source.name.contains(&name))
            {
                break source;
            }
            assert!(Instant::now() < deadline, "video source not discovered");
            thread::sleep(Duration::from_millis(100));
        };
        let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        socket
            .set_read_timeout(Some(Duration::from_millis(300)))
            .unwrap();
        let manager = VideoManager::default();
        let request = StartVideoRequest {
            stream_id: "test-video".into(),
            source_id: source.id,
            rtp_ip: "127.0.0.1".into(),
            rtp_port: socket.local_addr().unwrap().port(),
            payload_type: 102,
            ssrc: 1234,
            cname: "test-video".into(),
        };
        if protocol == "omt" {
            manager
                .start_with_capture(request, |_source, sink| {
                    crate::omt::capture_video_at_address("omt://127.0.0.1:6400", sink)
                })
                .unwrap();
        } else {
            manager.start(request).unwrap();
        }
        let mut decoder = openh264::decoder::Decoder::new().unwrap();
        let mut received = Vec::new();
        let mut buffer = [0u8; 2048];
        let mut decoded = 0;
        let mut first_picture = None;
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            let Ok(size) = socket.recv(&mut buffer) else {
                continue;
            };
            if size < 12 || buffer[1] & 127 != 102 {
                continue;
            }
            received.push(buffer[..size].to_vec());
            if buffer[1] & 128 != 0 {
                if let Some(picture) = decoder.decode(&depacketize(&received)).unwrap() {
                    assert_eq!(picture.dimensions(), (1280, 720));
                    assert!(picture.y().iter().any(|value| *value > 50));
                    decoded += 1;
                    let first = *first_picture.get_or_insert_with(Instant::now);
                    if first.elapsed() >= Duration::from_secs(3) {
                        let fps = (decoded - 1) as f64 / first.elapsed().as_secs_f64();
                        println!("{protocol}: decoded {decoded} 720p pictures, {fps:.1} fps");
                        assert!(
                            fps >= 24.0,
                            "network video frame rate too low: {fps:.1} fps"
                        );
                        break;
                    }
                }
                received.clear();
            }
        }
        let status = manager.status().unwrap();
        manager.stop_all().unwrap();
        assert!(
            decoded >= 73,
            "insufficient decoded network video: {decoded} pictures, {status:?}"
        );
        assert!(manager.status().unwrap().is_empty());
    }
}
