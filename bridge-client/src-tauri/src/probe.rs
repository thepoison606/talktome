use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{
    Device, SampleFormat, Stream, StreamConfig, SupportedStreamConfigRange, SAMPLE_RATE_48K,
};
use serde::{Deserialize, Serialize};

use crate::audio;

const MAX_LOOPBACK_SECONDS: usize = 2;

#[derive(Default)]
pub struct ProbeManager {
    runtimes: Mutex<HashMap<String, ProbeRuntime>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProbeStartRequest {
    pub port_id: String,
    pub label: String,
    pub input_device_id: String,
    pub input_left_channel: u16,
    pub input_right_channel: u16,
    pub output_device_id: Option<String>,
    pub output_left_channel: Option<u16>,
    pub output_right_channel: Option<u16>,
    pub loopback_enabled: bool,
    pub gain: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProbeStatus {
    pub port_id: String,
    pub label: String,
    pub running: bool,
    pub loopback_enabled: bool,
    pub input_device_name: Option<String>,
    pub output_device_name: Option<String>,
    pub input_config: Option<ProbeStreamConfig>,
    pub output_config: Option<ProbeStreamConfig>,
    pub rms_left: f32,
    pub rms_right: f32,
    pub peak_left: f32,
    pub peak_right: f32,
    pub rms_left_db: f32,
    pub rms_right_db: f32,
    pub peak_left_db: f32,
    pub peak_right_db: f32,
    pub frames_seen: u64,
    pub input_callbacks: u64,
    pub output_callbacks: u64,
    pub underruns: u64,
    pub queued_frames: usize,
    pub uptime_ms: u128,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProbeStreamConfig {
    pub channels: u16,
    pub sample_rate: u32,
    pub sample_format: String,
    pub buffer_size: String,
}

struct ProbeRuntime {
    _input_stream: Stream,
    _output_stream: Option<Stream>,
    shared: Arc<ProbeShared>,
    started_at: Instant,
    request: ProbeStartRequest,
    port_id: String,
    label: String,
    input_device_name: String,
    output_device_name: Option<String>,
    input_config: ProbeStreamConfig,
    output_config: Option<ProbeStreamConfig>,
}

#[derive(Default)]
struct ProbeShared {
    metrics: Mutex<ProbeMetrics>,
    loopback_buffer: Mutex<VecDeque<StereoFrame>>,
}

#[derive(Clone, Copy)]
struct StereoFrame {
    left: f32,
    right: f32,
}

#[derive(Clone, Copy)]
struct InputCallbackConfig {
    channels: usize,
    left_index: usize,
    right_index: usize,
    loopback_enabled: bool,
    gain: f32,
    max_loopback_frames: usize,
}

#[derive(Default)]
struct ProbeMetrics {
    rms_left: f32,
    rms_right: f32,
    peak_left: f32,
    peak_right: f32,
    frames_seen: u64,
    input_callbacks: u64,
    output_callbacks: u64,
    underruns: u64,
    last_error: Option<String>,
}

impl ProbeManager {
    pub fn start(&self, request: ProbeStartRequest) -> Result<ProbeStatus, String> {
        let port_id = normalize_port_id(&request.port_id)?;
        let mut guard = self
            .runtimes
            .lock()
            .map_err(|_| "probe runtime lock poisoned".to_string())?;

        let runtime = ProbeRuntime::start(request)?;
        let status = runtime.status();
        guard.insert(port_id, runtime);
        Ok(status)
    }

    pub fn stop(&self, port_id: String) -> Result<Vec<ProbeStatus>, String> {
        let port_id = normalize_port_id(&port_id)?;
        let mut guard = self
            .runtimes
            .lock()
            .map_err(|_| "probe runtime lock poisoned".to_string())?;
        guard.remove(&port_id);
        Ok(statuses_from(&guard))
    }

    pub fn stop_all(&self) -> Result<Vec<ProbeStatus>, String> {
        let mut guard = self
            .runtimes
            .lock()
            .map_err(|_| "probe runtime lock poisoned".to_string())?;
        guard.clear();
        Ok(Vec::new())
    }

    pub fn statuses(&self) -> Result<Vec<ProbeStatus>, String> {
        let guard = self
            .runtimes
            .lock()
            .map_err(|_| "probe runtime lock poisoned".to_string())?;
        Ok(statuses_from(&guard))
    }
}

impl ProbeRuntime {
    fn start(request: ProbeStartRequest) -> Result<Self, String> {
        let port_id = normalize_port_id(&request.port_id)?;
        let label = if request.label.trim().is_empty() {
            port_id.clone()
        } else {
            request.label.trim().to_string()
        };

        validate_channel_pair(
            request.input_left_channel,
            request.input_right_channel,
            "input",
        )?;

        let gain = request.gain.clamp(0.0, 4.0);
        let input_device = audio::find_audio_device("input", &request.input_device_id)?;
        let input_device_name = input_device.to_string();
        let input_min_channels = request.input_left_channel.max(request.input_right_channel);
        let (input_config, input_probe_config) =
            choose_f32_48k_config(&input_device, "input", input_min_channels)?;

        let shared = Arc::new(ProbeShared::default());
        let max_loopback_frames =
            (input_config.sample_rate as usize * MAX_LOOPBACK_SECONDS).max(4096);

        let input_callback_config = InputCallbackConfig {
            channels: input_config.channels as usize,
            left_index: zero_based_channel(request.input_left_channel),
            right_index: zero_based_channel(request.input_right_channel),
            loopback_enabled: request.loopback_enabled,
            gain,
            max_loopback_frames,
        };
        let input_shared = Arc::clone(&shared);
        let input_error_shared = Arc::clone(&shared);

        let input_stream = input_device
            .build_input_stream::<f32, _, _>(
                input_config,
                move |data, _| {
                    handle_input(data, input_callback_config, &input_shared);
                },
                move |err| {
                    input_error_shared.set_error(format!("input stream error: {err}"));
                },
                None,
            )
            .map_err(|err| format!("failed to build input stream: {err}"))?;

        let (output_stream, output_device_name, output_probe_config) = if request.loopback_enabled {
            let output_device_id = request
                .output_device_id
                .as_deref()
                .ok_or_else(|| "loopback requires an output device".to_string())?;
            let output_left_channel = request
                .output_left_channel
                .ok_or_else(|| "loopback requires an output left channel".to_string())?;
            let output_right_channel = request
                .output_right_channel
                .ok_or_else(|| "loopback requires an output right channel".to_string())?;
            validate_channel_pair(output_left_channel, output_right_channel, "output")?;

            let output_device = audio::find_audio_device("output", output_device_id)?;
            let output_name = output_device.to_string();
            let output_min_channels = output_left_channel.max(output_right_channel);
            let (output_config, output_probe_config) =
                choose_f32_48k_config(&output_device, "output", output_min_channels)?;
            let output_channels = output_config.channels as usize;
            let output_left = zero_based_channel(output_left_channel);
            let output_right = zero_based_channel(output_right_channel);
            let output_shared = Arc::clone(&shared);
            let output_error_shared = Arc::clone(&shared);

            let output_stream = output_device
                .build_output_stream::<f32, _, _>(
                    output_config,
                    move |data, _| {
                        handle_output(
                            data,
                            output_channels,
                            output_left,
                            output_right,
                            &output_shared,
                        );
                    },
                    move |err| {
                        output_error_shared.set_error(format!("output stream error: {err}"));
                    },
                    None,
                )
                .map_err(|err| format!("failed to build output stream: {err}"))?;

            output_stream
                .play()
                .map_err(|err| format!("failed to start output stream: {err}"))?;
            (
                Some(output_stream),
                Some(output_name),
                Some(output_probe_config),
            )
        } else {
            (None, None, None)
        };

        input_stream
            .play()
            .map_err(|err| format!("failed to start input stream: {err}"))?;

        Ok(Self {
            _input_stream: input_stream,
            _output_stream: output_stream,
            shared,
            started_at: Instant::now(),
            port_id,
            label,
            request,
            input_device_name,
            output_device_name,
            input_config: input_probe_config,
            output_config: output_probe_config,
        })
    }

    fn status(&self) -> ProbeStatus {
        let metrics = self.shared.metrics();
        let queued_frames = self.shared.queued_frames();

        ProbeStatus {
            port_id: self.port_id.clone(),
            label: self.label.clone(),
            running: true,
            loopback_enabled: self.request.loopback_enabled,
            input_device_name: Some(self.input_device_name.clone()),
            output_device_name: self.output_device_name.clone(),
            input_config: Some(self.input_config.clone()),
            output_config: self.output_config.clone(),
            rms_left: metrics.rms_left,
            rms_right: metrics.rms_right,
            peak_left: metrics.peak_left,
            peak_right: metrics.peak_right,
            rms_left_db: linear_to_db(metrics.rms_left),
            rms_right_db: linear_to_db(metrics.rms_right),
            peak_left_db: linear_to_db(metrics.peak_left),
            peak_right_db: linear_to_db(metrics.peak_right),
            frames_seen: metrics.frames_seen,
            input_callbacks: metrics.input_callbacks,
            output_callbacks: metrics.output_callbacks,
            underruns: metrics.underruns,
            queued_frames,
            uptime_ms: self.started_at.elapsed().as_millis(),
            last_error: metrics.last_error,
        }
    }
}

impl ProbeShared {
    fn set_error(&self, error: String) {
        if let Ok(mut metrics) = self.metrics.lock() {
            metrics.last_error = Some(error);
        }
    }

    fn metrics(&self) -> ProbeMetrics {
        self.metrics
            .lock()
            .map(|metrics| ProbeMetrics {
                rms_left: metrics.rms_left,
                rms_right: metrics.rms_right,
                peak_left: metrics.peak_left,
                peak_right: metrics.peak_right,
                frames_seen: metrics.frames_seen,
                input_callbacks: metrics.input_callbacks,
                output_callbacks: metrics.output_callbacks,
                underruns: metrics.underruns,
                last_error: metrics.last_error.clone(),
            })
            .unwrap_or_default()
    }

    fn queued_frames(&self) -> usize {
        self.loopback_buffer
            .lock()
            .map(|buffer| buffer.len())
            .unwrap_or(0)
    }
}

fn handle_input(data: &[f32], config: InputCallbackConfig, shared: &ProbeShared) {
    if config.channels == 0
        || config.left_index >= config.channels
        || config.right_index >= config.channels
    {
        shared.set_error("input channel selection is outside the active stream config".to_string());
        return;
    }

    let frames = data.len() / config.channels;
    if frames == 0 {
        return;
    }

    let mut sum_left = 0.0_f32;
    let mut sum_right = 0.0_f32;
    let mut peak_left = 0.0_f32;
    let mut peak_right = 0.0_f32;
    let mut loopback_frames = Vec::with_capacity(if config.loopback_enabled { frames } else { 0 });

    for frame in data.chunks_exact(config.channels) {
        let left = frame[config.left_index];
        let right = frame[config.right_index];
        let abs_left = left.abs();
        let abs_right = right.abs();

        sum_left += left * left;
        sum_right += right * right;
        peak_left = peak_left.max(abs_left);
        peak_right = peak_right.max(abs_right);

        if config.loopback_enabled {
            loopback_frames.push(StereoFrame {
                left: (left * config.gain).clamp(-1.0, 1.0),
                right: (right * config.gain).clamp(-1.0, 1.0),
            });
        }
    }

    if let Ok(mut metrics) = shared.metrics.lock() {
        metrics.rms_left = (sum_left / frames as f32).sqrt();
        metrics.rms_right = (sum_right / frames as f32).sqrt();
        metrics.peak_left = peak_left;
        metrics.peak_right = peak_right;
        metrics.frames_seen = metrics.frames_seen.saturating_add(frames as u64);
        metrics.input_callbacks = metrics.input_callbacks.saturating_add(1);
    }

    if config.loopback_enabled {
        if let Ok(mut buffer) = shared.loopback_buffer.lock() {
            buffer.extend(loopback_frames);
            while buffer.len() > config.max_loopback_frames {
                buffer.pop_front();
            }
        }
    }
}

fn handle_output(
    data: &mut [f32],
    channels: usize,
    left_index: usize,
    right_index: usize,
    shared: &ProbeShared,
) {
    data.fill(0.0);

    if channels == 0 || left_index >= channels || right_index >= channels {
        shared.set_error("output channel selection is outside the active stream config".to_string());
        return;
    }

    let mut underruns = 0_u64;

    if let Ok(mut buffer) = shared.loopback_buffer.lock() {
        for frame in data.chunks_exact_mut(channels) {
            if let Some(stereo_frame) = buffer.pop_front() {
                if left_index == right_index {
                    frame[left_index] = (stereo_frame.left + stereo_frame.right) * 0.5;
                } else {
                    frame[left_index] = stereo_frame.left;
                    frame[right_index] = stereo_frame.right;
                }
            } else {
                underruns = underruns.saturating_add(1);
            }
        }
    }

    if let Ok(mut metrics) = shared.metrics.lock() {
        metrics.output_callbacks = metrics.output_callbacks.saturating_add(1);
        metrics.underruns = metrics.underruns.saturating_add(underruns);
    }
}

fn choose_f32_48k_config(
    device: &Device,
    direction: &str,
    min_channels: u16,
) -> Result<(StreamConfig, ProbeStreamConfig), String> {
    let ranges: Vec<SupportedStreamConfigRange> = match direction {
        "input" => device
            .supported_input_configs()
            .map_err(|err| format!("failed to query input stream configs: {err}"))?
            .collect(),
        "output" => device
            .supported_output_configs()
            .map_err(|err| format!("failed to query output stream configs: {err}"))?
            .collect(),
        _ => return Err(format!("unknown stream direction: {direction}")),
    };

    let selected = ranges
        .into_iter()
        .filter(|range| range.sample_format() == SampleFormat::F32)
        .filter(|range| range.channels() >= min_channels)
        .filter(|range| range.contains_rate(SAMPLE_RATE_48K))
        .min_by_key(|range| range.channels())
        .ok_or_else(|| {
            format!("no F32/48 kHz {direction} config with at least {min_channels} channels")
        })?;

    let supported = selected.with_sample_rate(SAMPLE_RATE_48K);
    let stream_config = supported.config();
    let probe_config = ProbeStreamConfig {
        channels: stream_config.channels,
        sample_rate: stream_config.sample_rate,
        sample_format: format!("{:?}", supported.sample_format()),
        buffer_size: format!("{:?}", stream_config.buffer_size),
    };

    Ok((stream_config, probe_config))
}

fn validate_channel_pair(left: u16, right: u16, label: &str) -> Result<(), String> {
    if left == 0 || right == 0 {
        return Err(format!("{label} channels are one-based and must be >= 1"));
    }

    if right != left && right != left + 1 {
        return Err(format!(
            "{label} channel selection must be one mono channel or adjacent stereo, got {left}/{right}"
        ));
    }

    Ok(())
}

fn zero_based_channel(channel: u16) -> usize {
    usize::from(channel - 1)
}

fn linear_to_db(value: f32) -> f32 {
    if value <= 0.000_001 {
        -120.0
    } else {
        20.0 * value.log10()
    }
}

fn normalize_port_id(port_id: &str) -> Result<String, String> {
    let normalized = port_id.trim();
    if normalized.is_empty() {
        return Err("port id is required".to_string());
    }
    Ok(normalized.to_string())
}

fn statuses_from(runtimes: &HashMap<String, ProbeRuntime>) -> Vec<ProbeStatus> {
    let mut statuses = runtimes
        .values()
        .map(ProbeRuntime::status)
        .collect::<Vec<_>>();
    statuses.sort_by(|left, right| left.port_id.cmp(&right.port_id));
    statuses
}
