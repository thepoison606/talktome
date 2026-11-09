//! Owns the cpal capture and playback streams on a dedicated thread, reopens
//! devices when they fail or disappear and reports their status.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig, SupportedStreamConfig};
use tokio::sync::{mpsc, watch};

use super::codec::SAMPLE_RATE;
use super::mixer::{Mixer, MixerHealth};
use super::processing::{ProcessingControl, Processor};
use super::resample::{FromInternal, ToInternal};
use super::{device_label, device_pcm_id, find_device};
use crate::config::AudioConfig;

/// Audio with its capture time, so control-plane stalls cannot replay old speech.
#[derive(Debug)]
pub struct CapturedFrame {
    pub samples: Vec<f32>,
    pub captured: Instant,
}

impl CapturedFrame {
    pub fn new(samples: Vec<f32>) -> Self {
        Self {
            samples,
            captured: Instant::now(),
        }
    }

    pub fn newest(mut self, queued: &mut mpsc::Receiver<Self>) -> Option<Self> {
        // Preserve normal batches (e.g. two 5-ms frames from a 10-ms ALSA
        // callback). Catch up only after an actual scheduling/control stall.
        if self.captured.elapsed() >= Duration::from_millis(40) {
            while let Ok(newer) = queued.try_recv() {
                self = newer;
            }
        }
        self.is_fresh().then_some(self)
    }

    pub fn is_fresh(&self) -> bool {
        self.captured.elapsed() <= Duration::from_millis(80)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AudioStatus {
    pub system_volume: Option<super::system_volume::SystemVolume>,
    pub output_levels: super::system_volume::OutputLevels,
    pub capture_ok: bool,
    pub playback_ok: bool,
    pub capture_device: Option<String>,
    pub playback_device: Option<String>,
    pub last_error: Option<String>,
    pub auto_processing: bool,
    pub aec: bool,
    pub delay_ms: i32,
}

impl AudioStatus {
    pub fn all_ok(&self, capture_wanted: bool, playback_wanted: bool) -> bool {
        (!capture_wanted || self.capture_ok) && (!playback_wanted || self.playback_ok)
    }
}

/// Handle to the audio thread.
/// Device switch requests for the audio thread (remote panel), applied
/// without a restart. `Some(None)` means the system default device.
#[derive(Debug, Clone, Default)]
pub struct DeviceSwitch(Arc<Mutex<PendingSwitch>>);

/// Requested (capture, playback) devices not yet applied.
type PendingSwitch = (Option<Option<String>>, Option<Option<String>>);

impl DeviceSwitch {
    pub fn request_input(&self, device: Option<String>) {
        if let Ok(mut pending) = self.0.lock() {
            pending.0 = Some(device);
        }
    }

    pub fn request_output(&self, device: Option<String>) {
        if let Ok(mut pending) = self.0.lock() {
            pending.1 = Some(device);
        }
    }

    fn take(&self) -> PendingSwitch {
        self.0
            .lock()
            .map(|mut pending| std::mem::take(&mut *pending))
            .unwrap_or_default()
    }
}

/// True for `tone`, `wav:` and `none`, which run without an ALSA device and
/// cannot be switched while running.
pub fn is_virtual_device(device: &Option<String>) -> bool {
    !wanted(device) || tone_frequency(device).is_some() || wav_sink_path(device).is_some()
}

pub struct AudioIo {
    pub system_volume: super::system_volume::Control,
    stop: Arc<AtomicBool>,
    pub status: watch::Receiver<AudioStatus>,
    pub devices: DeviceSwitch,
    thread: Option<thread::JoinHandle<()>>,
}

impl AudioIo {
    /// Starts the audio thread. Captured 48 kHz mono frames of
    /// `frame_samples` are sent to `frames`; playback pulls from `mixer`.
    pub fn start(
        config: AudioConfig,
        frame_samples: usize,
        mixer: Arc<Mutex<Mixer>>,
        frames: mpsc::Sender<CapturedFrame>,
        processing: Arc<ProcessingControl>,
    ) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let snapshot = processing.snapshot();
        let (status_tx, status_rx) = watch::channel(AudioStatus {
            system_volume: None,
            output_levels: Default::default(),
            capture_ok: false,
            playback_ok: false,
            capture_device: None,
            playback_device: None,
            last_error: None,
            auto_processing: snapshot.auto_processing,
            aec: snapshot.aec,
            delay_ms: snapshot.delay_ms,
        });
        let thread_stop = stop.clone();
        let devices = DeviceSwitch::default();
        let thread_devices = devices.clone();
        let system_volume = super::system_volume::Control::default();
        let thread_system_volume = system_volume.clone();
        let thread = thread::Builder::new()
            .name("talktome-audio".into())
            .spawn(move || {
                run_supervisor(
                    config,
                    frame_samples,
                    mixer,
                    frames,
                    processing,
                    status_tx,
                    thread_stop,
                    thread_devices,
                    thread_system_volume,
                )
            })
            .expect("spawning audio thread");
        Self {
            system_volume,
            stop,
            status: status_rx,
            devices,
            thread: Some(thread),
        }
    }

    pub fn stop(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn wanted(device: &Option<String>) -> bool {
    !matches!(device.as_deref().map(str::trim), Some("none") | Some("off"))
}

/// `tone` / `tone:<hz>` generates a sine as capture input (testing, installer checks).
fn tone_frequency(device: &Option<String>) -> Option<f32> {
    let name = device.as_deref()?.trim();
    if name == "tone" {
        return Some(440.0);
    }
    name.strip_prefix("tone:")
        .and_then(|hz| hz.trim().parse().ok())
}

/// `wav:<path>` writes the mixed output to a WAV file instead of a device.
fn wav_sink_path(device: &Option<String>) -> Option<std::path::PathBuf> {
    device
        .as_deref()?
        .trim()
        .strip_prefix("wav:")
        .map(|p| std::path::PathBuf::from(p.trim()))
}

fn run_tone_generator(
    frequency: f32,
    frame_samples: usize,
    processor: Arc<Mutex<Processor>>,
    frames: mpsc::Sender<CapturedFrame>,
    stop: Arc<AtomicBool>,
) {
    let mut phase = 0f32;
    let step = frequency * std::f32::consts::TAU / SAMPLE_RATE as f32;
    let frame_duration = Duration::from_secs_f64(frame_samples as f64 / SAMPLE_RATE as f64);
    let mut next = Instant::now();
    let mut pending = Vec::with_capacity(frame_samples * 4);
    while !stop.load(Ordering::Relaxed) {
        let raw: Vec<f32> = (0..frame_samples)
            .map(|_| {
                phase += step;
                if phase > std::f32::consts::TAU {
                    phase -= std::f32::consts::TAU;
                }
                phase.sin() * 0.4
            })
            .collect();
        let mut processed = Vec::with_capacity(frame_samples);
        if let Ok(mut processor) = processor.lock() {
            processor.process_capture(&raw, &mut processed);
        } else {
            processed = raw;
        }
        pending.extend_from_slice(&processed);
        while pending.len() >= frame_samples {
            let frame: Vec<f32> = pending.drain(..frame_samples).collect();
            let _ = frames.try_send(CapturedFrame::new(frame));
        }
        next += frame_duration;
        let now = Instant::now();
        if next > now {
            thread::sleep(next - now);
        } else {
            next = now;
        }
    }
}

fn run_wav_sink(path: std::path::PathBuf, mixer: Arc<Mutex<Mixer>>, stop: Arc<AtomicBool>) {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = match hound::WavWriter::create(&path, spec) {
        Ok(writer) => writer,
        Err(error) => {
            tracing::error!(event = "wav-sink-failed", path = %path.display(), error = %error);
            return;
        }
    };
    let period = Duration::from_millis(20);
    let mut buffer = vec![0f32; (SAMPLE_RATE / 50) as usize];
    let mut next = Instant::now();
    while !stop.load(Ordering::Relaxed) {
        if let Ok(mut mixer) = mixer.lock() {
            mixer.render(&mut buffer);
        }
        for sample in &buffer {
            let _ = writer.write_sample((sample.clamp(-1.0, 1.0) * 32767.0) as i16);
        }
        next += period;
        let now = Instant::now();
        if next > now {
            thread::sleep(next - now);
        } else {
            next = now;
        }
    }
    let _ = writer.finalize();
}

#[allow(clippy::too_many_arguments)]
fn run_supervisor(
    mut config: AudioConfig,
    frame_samples: usize,
    mixer: Arc<Mutex<Mixer>>,
    frames: mpsc::Sender<CapturedFrame>,
    processing: Arc<ProcessingControl>,
    status_tx: watch::Sender<AudioStatus>,
    stop: Arc<AtomicBool>,
    devices: DeviceSwitch,
    system_volume: super::system_volume::Control,
) {
    let mut capture_wanted = wanted(&config.input_device);
    let mut playback_wanted = wanted(&config.output_device);
    let mut capture: Option<OpenStream> = None;
    let mut playback: Option<OpenStream> = None;
    let mut output_levels = super::system_volume::OutputLevels::new();
    let mut next_attempt = Instant::now();
    let reopen = Duration::from_millis(config.reopen_ms.max(250));
    let processor = Arc::new(Mutex::new(Processor::new(processing.clone())));
    let mut virtual_threads = Vec::new();
    let mut last_error = None;
    let mut health = HealthLog::new(Instant::now());

    if let Some(frequency) = tone_frequency(&config.input_device) {
        tracing::info!(event = "audio-capture-open", device = "tone", frequency);
        let (frames, stop, processor) = (frames.clone(), stop.clone(), processor.clone());
        virtual_threads.push(thread::spawn(move || {
            run_tone_generator(frequency, frame_samples, processor, frames, stop)
        }));
        capture_wanted = false;
    }
    if let Some(path) = wav_sink_path(&config.output_device) {
        tracing::info!(event = "audio-playback-open", device = "wav", path = %path.display());
        let (mixer, stop) = (mixer.clone(), stop.clone());
        virtual_threads.push(thread::spawn(move || run_wav_sink(path, mixer, stop)));
        playback_wanted = false;
    }

    while !stop.load(Ordering::Relaxed) {
        let now = Instant::now();

        // The session only sends real ALSA devices here, never tone/wav.
        let (input, output) = devices.take();
        if let Some(device) = input {
            tracing::info!(event = "audio-device-switch", direction = "capture", device = ?device);
            config.input_device = device;
            capture = None;
            capture_wanted = true;
            next_attempt = now;
        }
        if let Some(device) = output {
            tracing::info!(event = "audio-device-switch", direction = "playback", device = ?device);
            config.output_device = device;
            playback = None;
            playback_wanted = true;
            next_attempt = now;
        }

        if let Some(open) = capture.as_ref() {
            if open.failed.load(Ordering::Relaxed) {
                tracing::warn!(event = "audio-device-lost", direction = "capture", device = %open.name);
                capture = None;
                next_attempt = now + reopen;
            }
        }
        if let Some(open) = playback.as_ref() {
            if open.failed.load(Ordering::Relaxed) {
                tracing::warn!(event = "audio-device-lost", direction = "playback", device = %open.name);
                playback = None;
                next_attempt = now + reopen;
            }
        }

        // ALSA can keep a stream RUNNING without calling back and without an
        // error (seen with USB cards). Close and reopen it right away.
        if let Some(open) = capture.as_mut() {
            let (callbacks, peak) = open.poll(now);
            health.capture.add(callbacks, peak);
            if let Some(silent) = open.stalled(now) {
                tracing::warn!(event = "audio-stream-stalled", direction = "capture", device = %open.name, silent_ms = silent.as_millis() as u64);
                capture = None;
                next_attempt = now;
            }
        }
        if let Some(open) = playback.as_mut() {
            let (callbacks, peak) = open.poll(now);
            health.playback.add(callbacks, peak);
            if let Some(silent) = open.stalled(now) {
                tracing::warn!(event = "audio-stream-stalled", direction = "playback", device = %open.name, silent_ms = silent.as_millis() as u64);
                playback = None;
                next_attempt = now;
            }
        }
        if health.due(now) {
            let mixer_health = mixer.lock().map(|m| m.health()).unwrap_or_default();
            health.log(
                now,
                capture.as_ref().map(|c| c.name.as_str()),
                playback.as_ref().map(|p| p.name.as_str()),
                mixer_health,
            );
        }

        if now >= next_attempt {
            last_error = None;
            if capture_wanted && capture.is_none() {
                match open_capture(
                    &config,
                    frame_samples,
                    processor.clone(),
                    processing.clone(),
                    frames.clone(),
                ) {
                    Ok(open) => {
                        tracing::info!(event = "audio-device-restored", direction = "capture", device = %open.name);
                        capture = Some(open);
                    }
                    Err(error) => {
                        tracing::debug!(event = "audio-open-failed", direction = "capture", error = %error);
                        last_error = Some(format!("capture: {error:#}"));
                    }
                }
            }
            if playback_wanted && playback.is_none() {
                match open_playback(
                    &config,
                    mixer.clone(),
                    processor.clone(),
                    processing.clone(),
                ) {
                    Ok(open) => {
                        tracing::info!(event = "audio-device-restored", direction = "playback", device = %open.name);
                        if let Err(error) = super::system_volume::configure_outputs(
                            open.card,
                            config.speaker_level_db,
                            config.headphone_level_db,
                        ) {
                            tracing::warn!(event = "output-level-config-failed", error = %error);
                        }
                        output_levels = super::system_volume::output_levels(open.card);
                        playback = Some(open);
                    }
                    Err(error) => {
                        tracing::debug!(event = "audio-open-failed", direction = "playback", error = %error);
                        last_error = Some(match last_error {
                            Some(prev) => format!("{prev}; playback: {error:#}"),
                            None => format!("playback: {error:#}"),
                        });
                    }
                }
            }
            next_attempt = now + reopen;
        }

        processing.set_aec_possible(capture.is_some() && playback.is_some());
        let snapshot = processing.snapshot();
        let capture_device = if capture_wanted {
            capture.as_ref().map(|c| c.name.clone())
        } else {
            config.input_device.clone()
        };
        let playback_device = if playback_wanted {
            playback.as_ref().map(|p| p.name.clone())
        } else {
            config.output_device.clone()
        };
        let status = AudioStatus {
            output_levels: if playback.is_some() {
                output_levels.clone()
            } else {
                Default::default()
            },
            system_volume: system_volume.poll(playback.as_ref().and_then(|p| p.card)),
            capture_ok: !capture_wanted || capture.is_some(),
            playback_ok: !playback_wanted || playback.is_some(),
            capture_device,
            playback_device,
            last_error: last_error.clone(),
            auto_processing: snapshot.auto_processing,
            aec: snapshot.aec,
            delay_ms: snapshot.delay_ms,
        };
        if *status_tx.borrow() != status {
            let _ = status_tx.send(status);
        }
        system_volume.wait(Duration::from_millis(250));
    }
    drop(capture);
    drop(playback);
    for handle in virtual_threads {
        let _ = handle.join();
    }
}

/// A stream whose callback has not run for this long is treated as hung.
const STALL_AFTER: Duration = Duration::from_secs(2);
/// Interval of the `audio-health` log line.
const HEALTH_EVERY: Duration = Duration::from_secs(300);

/// Callback progress of one stream, written by its callback.
#[derive(Default)]
struct StreamActivity {
    callbacks: AtomicU64,
    /// Highest absolute sample since the last poll, as `f32` bits. For
    /// non-negative floats the bit pattern orders like the value.
    peak: AtomicU32,
}

impl StreamActivity {
    fn note(&self, samples: &[f32]) {
        let peak = samples.iter().fold(0f32, |peak, s| peak.max(s.abs()));
        self.callbacks.fetch_add(1, Ordering::Relaxed);
        if peak.is_finite() {
            self.peak.fetch_max(peak.to_bits(), Ordering::Relaxed);
        }
    }

    /// Takes the callback count and peak since the last call.
    fn take(&self) -> (u64, f32) {
        let callbacks = self.callbacks.swap(0, Ordering::Relaxed);
        let peak = f32::from_bits(self.peak.swap(0, Ordering::Relaxed));
        (callbacks, peak)
    }
}

struct OpenStream {
    card: Option<i32>,
    name: String,
    failed: Arc<AtomicBool>,
    activity: Arc<StreamActivity>,
    /// Last time the callback was seen running (opening counts).
    progress_at: Instant,
    _stream: Stream,
}

impl OpenStream {
    fn poll(&mut self, now: Instant) -> (u64, f32) {
        let (callbacks, peak) = self.activity.take();
        if callbacks > 0 {
            self.progress_at = now;
        }
        (callbacks, peak)
    }

    /// How long the callback has been silent, once that reaches `STALL_AFTER`.
    fn stalled(&self, now: Instant) -> Option<Duration> {
        stalled_for(self.progress_at, now)
    }
}

fn stalled_for(progress_at: Instant, now: Instant) -> Option<Duration> {
    let silent = now.saturating_duration_since(progress_at);
    (silent >= STALL_AFTER).then_some(silent)
}

#[derive(Debug, Default, Clone, Copy, PartialEq)]
struct DirectionHealth {
    callbacks: u64,
    peak: f32,
}

impl DirectionHealth {
    fn add(&mut self, callbacks: u64, peak: f32) {
        self.callbacks += callbacks;
        self.peak = self.peak.max(peak);
    }
}

/// Accumulates audio activity for the periodic `audio-health` line, so a
/// silent output can be told apart from missing input after the fact.
struct HealthLog {
    since: Instant,
    capture: DirectionHealth,
    playback: DirectionHealth,
    /// Mixer counters at the previous line, for the deltas.
    mixer: MixerHealth,
}

impl HealthLog {
    fn new(now: Instant) -> Self {
        Self {
            since: now,
            capture: DirectionHealth::default(),
            playback: DirectionHealth::default(),
            mixer: MixerHealth::default(),
        }
    }

    fn due(&self, now: Instant) -> bool {
        now.saturating_duration_since(self.since) >= HEALTH_EVERY
    }

    fn log(
        &mut self,
        now: Instant,
        capture: Option<&str>,
        playback: Option<&str>,
        mixer: MixerHealth,
    ) {
        tracing::info!(
            event = "audio-health",
            playback = playback.unwrap_or("-"),
            playback_callbacks = self.playback.callbacks,
            playback_peak_dbfs = peak_dbfs(self.playback.peak),
            capture = capture.unwrap_or("-"),
            capture_callbacks = self.capture.callbacks,
            capture_peak_dbfs = peak_dbfs(self.capture.peak),
            sources = mixer.sources,
            active_sources = mixer.active_sources,
            receive_buffered_ms = mixer.buffered_ms,
            receive_target_ms = mixer.target_ms,
            packets = mixer
                .packets_matched
                .saturating_sub(self.mixer.packets_matched),
            unmatched_packets = mixer
                .packets_unmatched
                .saturating_sub(self.mixer.packets_unmatched),
        );
        *self = Self {
            mixer,
            ..Self::new(now)
        };
    }
}

/// Peak as whole dBFS; silence reads -120.
fn peak_dbfs(peak: f32) -> i32 {
    if peak <= 1e-6 {
        -120
    } else {
        (20.0 * peak.log10()).round() as i32
    }
}

fn pick_device(
    host: &cpal::Host,
    wanted_name: &Option<String>,
    input: bool,
) -> Result<cpal::Device> {
    match wanted_name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty() && *n != "default")
    {
        Some(name) => {
            let devices: Vec<cpal::Device> = if input {
                host.input_devices()?.collect()
            } else {
                host.output_devices()?.collect()
            };
            find_device(devices.into_iter(), name)
                .ok_or_else(|| anyhow!("audio device {name:?} not found"))
        }
        None => if input {
            host.default_input_device()
        } else {
            host.default_output_device()
        }
        .ok_or_else(|| anyhow!("no default audio device")),
    }
}

/// Prefers 48 kHz at the lowest channel count that carries our mono signal.
fn choose_config(device: &cpal::Device, input: bool) -> Result<SupportedStreamConfig> {
    let ranges: Vec<cpal::SupportedStreamConfigRange> = if input {
        device.supported_input_configs()?.collect()
    } else {
        device.supported_output_configs()?.collect()
    };
    let wanted = SAMPLE_RATE;
    let mut best: Option<cpal::SupportedStreamConfigRange> = None;
    for range in ranges.iter() {
        if !matches!(range.sample_format(), SampleFormat::F32 | SampleFormat::I16) {
            continue;
        }
        if range.min_sample_rate() <= wanted && wanted <= range.max_sample_rate() {
            let better = match &best {
                None => true,
                Some(current) => {
                    range.channels() < current.channels()
                        || (range.channels() == current.channels()
                            && range.sample_format() == SampleFormat::F32)
                }
            };
            if better {
                best = Some(*range);
            }
        }
    }
    if let Some(range) = best {
        return Ok(range.with_sample_rate(wanted));
    }
    let default = if input {
        device.default_input_config()?
    } else {
        device.default_output_config()?
    };
    Ok(default)
}

fn callback_period_ms(frames: usize, rate: u32) -> u32 {
    if rate == 0 {
        0
    } else {
        ((frames as u64 * 1000) / u64::from(rate)) as u32
    }
}

/// `0` leaves the driver period alone. Otherwise request that many milliseconds
/// as `BufferSize::Fixed`; cpal uses it as the ALSA period and a two-period buffer.
fn requested_buffer_size(period_ms: u32, rate: u32) -> cpal::BufferSize {
    if period_ms == 0 || rate == 0 {
        return cpal::BufferSize::Default;
    }
    let frames = (u64::from(rate) * u64::from(period_ms) / 1_000).max(1) as u32;
    cpal::BufferSize::Fixed(frames)
}

/// Opens `build` with the requested period. A rejected size is retried once
/// with the driver default. `build` must be callable twice: a failed
/// `build_*_stream` consumes its callback.
fn open_stream_with_period(
    direction: &'static str,
    period_ms: u32,
    mut config: StreamConfig,
    mut build: impl FnMut(&StreamConfig) -> Result<Stream>,
) -> Result<Stream> {
    config.buffer_size = requested_buffer_size(period_ms, config.sample_rate);
    match build(&config) {
        Ok(stream) => Ok(stream),
        Err(error) if period_ms != 0 => {
            tracing::warn!(
                event = "audio-period-rejected",
                direction,
                period_ms,
                error = %error,
                "device rejected the requested period; using the driver default"
            );
            config.buffer_size = cpal::BufferSize::Default;
            build(&config)
        }
        Err(error) => Err(error),
    }
}

/// cpal recovers an underrun or overrun on the same stream (`prepare`, then
/// continue). Marking the stream failed would drop it for `reopen_ms` and
/// turn one missed period into a long silence.
fn note_stream_error(direction: &'static str, error: cpal::Error, failed: &AtomicBool) {
    if error.kind() == cpal::ErrorKind::Xrun {
        tracing::warn!(event = "audio-xrun", direction, error = %error);
        return;
    }
    tracing::warn!(event = "audio-stream-error", direction, error = %error);
    failed.store(true, Ordering::Relaxed);
}

#[allow(clippy::too_many_arguments)]
fn build_capture_stream(
    device: &cpal::Device,
    stream_config: &StreamConfig,
    format: SampleFormat,
    channels: usize,
    rate: u32,
    frame_samples: usize,
    processor: &Arc<Mutex<Processor>>,
    control: &Arc<ProcessingControl>,
    frames: &mpsc::Sender<CapturedFrame>,
    failed: &Arc<AtomicBool>,
    activity: &Arc<StreamActivity>,
) -> Result<Stream> {
    let processor = Arc::clone(processor);
    let control = Arc::clone(control);
    let frames = frames.clone();
    let activity = Arc::clone(activity);
    let error_flag = Arc::clone(failed);
    let err_fn = move |error: cpal::Error| {
        note_stream_error("capture", error, &error_flag);
    };

    let mut resampler = ToInternal::new(rate, SAMPLE_RATE)?;
    let mut mono: Vec<f32> = Vec::with_capacity(4096);
    let mut converted: Vec<f32> = Vec::with_capacity(4096);
    let mut processed: Vec<f32> = Vec::with_capacity(4096);
    let mut pending: Vec<f32> = Vec::with_capacity(frame_samples * 4);

    let mut handle_samples = move |samples: &[f32]| {
        let captured = Instant::now();
        control
            .observe_capture_period_ms(callback_period_ms(samples.len() / channels.max(1), rate));
        mono.clear();
        for frame in samples.chunks(channels) {
            let sum: f32 = frame.iter().sum();
            mono.push(sum / channels as f32);
        }
        activity.note(&mono);
        converted.clear();
        if resampler.process(&mono, &mut converted).is_err() {
            return;
        }
        processed.clear();
        if let Ok(mut processor) = processor.lock() {
            processor.process_capture(&converted, &mut processed);
        } else {
            processed.extend_from_slice(&converted);
        }
        pending.extend_from_slice(&processed);
        while pending.len() >= frame_samples {
            let frame: Vec<f32> = pending.drain(..frame_samples).collect();
            // Never block the audio thread; drop frames if the encoder lags.
            let _ = frames.try_send(CapturedFrame {
                samples: frame,
                captured,
            });
        }
    };

    let stream_config = *stream_config;
    match format {
        SampleFormat::F32 => device
            .build_input_stream(
                stream_config,
                move |data: &[f32], _| handle_samples(data),
                err_fn,
                None,
            )
            .context("building capture stream"),
        SampleFormat::I16 => {
            let mut scratch: Vec<f32> = Vec::new();
            device
                .build_input_stream(
                    stream_config,
                    move |data: &[i16], _| {
                        scratch.clear();
                        scratch.extend(data.iter().map(|s| *s as f32 / 32768.0));
                        handle_samples(&scratch)
                    },
                    err_fn,
                    None,
                )
                .context("building capture stream")
        }
        other => anyhow::bail!("unsupported capture sample format {other:?}"),
    }
}

#[allow(clippy::too_many_arguments)]
fn build_playback_stream(
    device: &cpal::Device,
    stream_config: &StreamConfig,
    format: SampleFormat,
    channels: usize,
    rate: u32,
    mixer: &Arc<Mutex<Mixer>>,
    processor: &Arc<Mutex<Processor>>,
    control: &Arc<ProcessingControl>,
    failed: &Arc<AtomicBool>,
    activity: &Arc<StreamActivity>,
) -> Result<Stream> {
    let mixer = Arc::clone(mixer);
    let activity = Arc::clone(activity);
    let processor = Arc::clone(processor);
    let control = Arc::clone(control);
    let error_flag = Arc::clone(failed);
    let err_fn = move |error: cpal::Error| {
        note_stream_error("playback", error, &error_flag);
    };

    let mut resampler = FromInternal::new(SAMPLE_RATE, rate)?;
    let mut mono: Vec<f32> = Vec::new();
    let mut far_end: Vec<f32> = Vec::new();
    let mut render_mono = move |out: &mut [f32]| {
        let frames = out.len() / channels.max(1);
        control.observe_playback_period_ms(callback_period_ms(frames, rate));
        mono.resize(frames, 0.0);
        far_end.clear();
        let render_result = resampler.fill(&mut mono, |buf| {
            if let Ok(mut mixer) = mixer.lock() {
                mixer.render(buf);
            } else {
                buf.fill(0.0);
            }
            far_end.extend_from_slice(buf);
        });
        if render_result.is_err() {
            mono.fill(0.0);
            far_end.clear();
        }
        if !far_end.is_empty() {
            if let Ok(mut processor) = processor.lock() {
                processor.analyze_render(&far_end);
            }
        }
        activity.note(&mono);
        for (index, frame) in out.chunks_mut(channels.max(1)).enumerate() {
            let sample = mono.get(index).copied().unwrap_or(0.0);
            for slot in frame.iter_mut() {
                *slot = sample;
            }
        }
    };

    let stream_config = *stream_config;
    match format {
        SampleFormat::F32 => device
            .build_output_stream(
                stream_config,
                move |data: &mut [f32], _| render_mono(data),
                err_fn,
                None,
            )
            .context("building playback stream"),
        SampleFormat::I16 => {
            let mut scratch: Vec<f32> = Vec::new();
            device
                .build_output_stream(
                    stream_config,
                    move |data: &mut [i16], _| {
                        scratch.resize(data.len(), 0.0);
                        render_mono(&mut scratch);
                        for (dst, src) in data.iter_mut().zip(scratch.iter()) {
                            *dst = (src.clamp(-1.0, 1.0) * 32767.0) as i16;
                        }
                    },
                    err_fn,
                    None,
                )
                .context("building playback stream")
        }
        other => anyhow::bail!("unsupported playback sample format {other:?}"),
    }
}

fn open_capture(
    config: &AudioConfig,
    frame_samples: usize,
    processor: Arc<Mutex<Processor>>,
    control: Arc<ProcessingControl>,
    frames: mpsc::Sender<CapturedFrame>,
) -> Result<OpenStream> {
    let host = cpal::default_host();
    let device = pick_device(&host, &config.input_device, true)?;
    let name = format!("{} ({})", device_label(&device), device_pcm_id(&device));
    let supported = choose_config(&device, true).context("no usable capture configuration")?;
    let channels = supported.channels() as usize;
    let rate = supported.sample_rate();
    let format = supported.sample_format();
    let stream_config: StreamConfig = supported.into();
    let failed = Arc::new(AtomicBool::new(false));
    let activity = Arc::new(StreamActivity::default());
    let period_ms = config.device_period_ms;
    let stream = open_stream_with_period("capture", period_ms, stream_config, |stream_config| {
        build_capture_stream(
            &device,
            stream_config,
            format,
            channels,
            rate,
            frame_samples,
            &processor,
            &control,
            &frames,
            &failed,
            &activity,
        )
    })?;
    stream.play().context("starting capture stream")?;
    tracing::info!(
        event = "audio-capture-open",
        device = %name,
        rate,
        channels,
        format = ?format,
        period_ms
    );
    Ok(OpenStream {
        card: None,
        name,
        failed,
        activity,
        progress_at: Instant::now(),
        _stream: stream,
    })
}

fn open_playback(
    config: &AudioConfig,
    mixer: Arc<Mutex<Mixer>>,
    processor: Arc<Mutex<Processor>>,
    control: Arc<ProcessingControl>,
) -> Result<OpenStream> {
    let host = cpal::default_host();
    let device = pick_device(&host, &config.output_device, false)?;
    // Resolve through ALSA's actual PCM route, including dmix/asound aliases.
    // An unresolved route exposes no control rather than using the default card.
    let card = alsa::PCM::new(&device_pcm_id(&device), alsa::Direction::Playback, true)
        .and_then(|pcm| pcm.info())
        .ok()
        .map(|info| info.get_card())
        .filter(|c| *c >= 0);
    let name = format!("{} ({})", device_label(&device), device_pcm_id(&device));
    let supported = choose_config(&device, false).context("no usable playback configuration")?;
    let channels = supported.channels() as usize;
    let rate = supported.sample_rate();
    let format = supported.sample_format();
    let stream_config: StreamConfig = supported.into();
    let failed = Arc::new(AtomicBool::new(false));
    let activity = Arc::new(StreamActivity::default());
    let period_ms = config.device_period_ms;
    let stream = open_stream_with_period("playback", period_ms, stream_config, |stream_config| {
        build_playback_stream(
            &device,
            stream_config,
            format,
            channels,
            rate,
            &mixer,
            &processor,
            &control,
            &failed,
            &activity,
        )
    })?;
    stream.play().context("starting playback stream")?;
    tracing::info!(
        event = "audio-playback-open",
        device = %name,
        rate,
        channels,
        format = ?format,
        period_ms
    );
    Ok(OpenStream {
        card,
        name,
        failed,
        activity,
        progress_at: Instant::now(),
        _stream: stream,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    use std::time::{Duration, Instant};

    use super::{
        note_stream_error, peak_dbfs, requested_buffer_size, stalled_for, tone_frequency,
        wav_sink_path, StreamActivity,
    };

    #[test]
    fn capture_backlog_keeps_only_the_newest_fresh_frame() {
        use super::CapturedFrame;
        let (tx, mut rx) = tokio::sync::mpsc::channel(4);
        let stale = CapturedFrame {
            samples: vec![1.0],
            captured: std::time::Instant::now() - std::time::Duration::from_millis(500),
        };
        tx.try_send(CapturedFrame::new(vec![2.0])).unwrap();
        tx.try_send(CapturedFrame::new(vec![3.0])).unwrap();
        assert_eq!(stale.newest(&mut rx).unwrap().samples, vec![3.0]);
        assert!(rx.try_recv().is_err());
        tx.try_send(CapturedFrame::new(vec![5.0])).unwrap();
        let normal = CapturedFrame::new(vec![4.0]);
        assert_eq!(normal.newest(&mut rx).unwrap().samples, vec![4.0]);
        assert_eq!(rx.try_recv().unwrap().samples, vec![5.0]);
        let stale = CapturedFrame {
            samples: vec![1.0],
            captured: std::time::Instant::now() - std::time::Duration::from_millis(500),
        };
        assert!(stale.newest(&mut rx).is_none());
    }

    #[test]
    fn stale_microphone_audio_is_never_fresh_after_a_control_stall() {
        let frame = super::CapturedFrame {
            samples: vec![0.0; 240],
            captured: std::time::Instant::now() - std::time::Duration::from_millis(500),
        };
        assert!(!frame.is_fresh());
        assert!(super::CapturedFrame::new(vec![0.0; 240]).is_fresh());
    }

    #[test]
    fn a_stream_without_callbacks_counts_as_stalled_after_two_seconds() {
        let opened = Instant::now();
        assert_eq!(
            stalled_for(opened, opened + Duration::from_millis(1_900)),
            None
        );
        assert_eq!(
            stalled_for(opened, opened + Duration::from_millis(2_250)),
            Some(Duration::from_millis(2_250))
        );
    }

    #[test]
    fn activity_reports_callbacks_and_peak_once() {
        let activity = StreamActivity::default();
        activity.note(&[0.1, -0.5, 0.2]);
        activity.note(&[0.25]);
        assert_eq!(activity.take(), (2, 0.5));
        assert_eq!(activity.take(), (0, 0.0));
    }

    #[test]
    fn peak_reads_as_dbfs() {
        assert_eq!(peak_dbfs(0.0), -120);
        assert_eq!(peak_dbfs(1.0), 0);
        assert_eq!(peak_dbfs(0.1), -20);
    }

    #[test]
    fn xrun_stays_open_and_other_errors_reopen() {
        let failed = AtomicBool::new(false);
        note_stream_error("playback", cpal::ErrorKind::Xrun.into(), &failed);
        assert!(
            !failed.load(Ordering::Relaxed),
            "an underrun must not drop the stream"
        );
        note_stream_error(
            "playback",
            cpal::ErrorKind::DeviceNotAvailable.into(),
            &failed,
        );
        assert!(failed.load(Ordering::Relaxed));
    }

    #[test]
    fn period_frames_follow_the_requested_milliseconds() {
        assert_eq!(requested_buffer_size(0, 48_000), cpal::BufferSize::Default);
        assert_eq!(requested_buffer_size(10, 0), cpal::BufferSize::Default);
        assert_eq!(
            requested_buffer_size(10, 48_000),
            cpal::BufferSize::Fixed(480)
        );
        assert_eq!(
            requested_buffer_size(5, 48_000),
            cpal::BufferSize::Fixed(240)
        );
    }

    #[test]
    fn tone_device_defaults_to_440hz() {
        assert_eq!(tone_frequency(&Some("tone".into())), Some(440.0));
        assert_eq!(tone_frequency(&Some("tone:1000".into())), Some(1000.0));
        assert_eq!(tone_frequency(&Some(" tone:440 ".into())), Some(440.0));
        assert_eq!(
            tone_frequency(&Some("plughw:CARD=Headset,DEV=0".into())),
            None
        );
        assert_eq!(tone_frequency(&None), None);
    }

    #[test]
    fn wav_sink_parses_path() {
        assert_eq!(
            wav_sink_path(&Some("wav:/tmp/heard.wav".into())).as_deref(),
            Some(std::path::Path::new("/tmp/heard.wav"))
        );
        assert_eq!(wav_sink_path(&Some("tone".into())), None);
    }
}
