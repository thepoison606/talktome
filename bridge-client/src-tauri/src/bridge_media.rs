use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::net::UdpSocket;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{
    atomic::{AtomicI32, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{
    SampleFormat, SampleRate, Stream, StreamConfig, SupportedStreamConfigRange, SAMPLE_RATE_48K,
};
use serde::{Deserialize, Serialize};

use crate::audio;

const OUTPUT_QUEUE_LIMIT_FRAMES: usize = 9_600;
const DECODER_STARTUP_GRACE_MS: u64 = 10;
const FFMPEG_ENV_VAR: &str = "TALKTOME_FFMPEG";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn ffmpeg_command() -> Command {
    let mut command =
        Command::new(resolve_ffmpeg_path().unwrap_or_else(|| PathBuf::from("ffmpeg")));
    configure_ffmpeg_command(&mut command);
    command
}

#[cfg(windows)]
fn configure_ffmpeg_command(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_ffmpeg_command(_command: &mut Command) {}

fn resolve_ffmpeg_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var(FFMPEG_ENV_VAR) {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }

    let executable = std::env::current_exe().ok()?;
    let executable_dir = executable.parent()?;
    let mut candidates = Vec::new();

    push_ffmpeg_candidates(&mut candidates, executable_dir);
    push_ffmpeg_candidates(&mut candidates, &executable_dir.join("binaries"));

    if let Some(contents_dir) = executable_dir.parent() {
        push_ffmpeg_candidates(&mut candidates, &contents_dir.join("Resources"));
        push_ffmpeg_candidates(
            &mut candidates,
            &contents_dir.join("Resources").join("binaries"),
        );
    }

    for ancestor in executable_dir.ancestors().take(6) {
        push_ffmpeg_candidates(&mut candidates, &ancestor.join("binaries"));
    }

    candidates.into_iter().find(|path| path.is_file())
}

fn push_ffmpeg_candidates(candidates: &mut Vec<PathBuf>, directory: &Path) {
    for name in ffmpeg_binary_names() {
        candidates.push(directory.join(name));
    }
}

fn ffmpeg_binary_names() -> &'static [&'static str] {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        &["ffmpeg-aarch64-apple-darwin", "ffmpeg"]
    }

    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        &["ffmpeg-x86_64-apple-darwin", "ffmpeg"]
    }

    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        &["ffmpeg-x86_64-pc-windows-msvc.exe", "ffmpeg.exe"]
    }

    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        &["ffmpeg-aarch64-pc-windows-msvc.exe", "ffmpeg.exe"]
    }

    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "aarch64")
    )))]
    {
        &["ffmpeg"]
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeChannelAssignment {
    pub device_id: String,
    pub left_channel: u16,
    pub right_channel: u16,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartBridgeInputRequest {
    pub stream_id: String,
    pub assignment: BridgeChannelAssignment,
    pub rtp_ip: String,
    pub rtp_port: u16,
    pub payload_type: u8,
    pub ssrc: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReserveBridgeOutputRequest {
    pub stream_id: String,
    pub assignment: BridgeChannelAssignment,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivateBridgeOutputRequest {
    pub stream_id: String,
    pub payload_type: u8,
    pub clock_rate: u32,
    pub channels: u16,
    pub fmtp: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetBridgeOutputLevelRequest {
    pub stream_id: String,
    pub volume: f32,
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReservedBridgeOutput {
    pub stream_id: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeMediaStatus {
    pub input_stream_ids: Vec<String>,
    pub output_stream_ids: Vec<String>,
    pub pending_output_stream_ids: Vec<String>,
    pub input_stream_errors: Vec<BridgeMediaStreamError>,
    pub output_stream_errors: Vec<BridgeMediaStreamError>,
    pub input_stream_stats: Vec<BridgeMediaInputStats>,
    pub output_stream_stats: Vec<BridgeMediaOutputStats>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeMediaStreamError {
    pub stream_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeMediaInputStats {
    pub stream_id: String,
    pub rms_db: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeMediaOutputStats {
    pub stream_id: String,
    pub decoded_frames: u64,
    pub decoded_bytes: u64,
}

#[derive(Default)]
pub struct BridgeMediaManager {
    inner: Mutex<BridgeMediaState>,
}

impl Drop for BridgeMediaManager {
    fn drop(&mut self) {
        if let Ok(state) = self.inner.get_mut() {
            for (_, runtime) in std::mem::take(&mut state.inputs) {
                runtime.stop();
            }
            for (_, runtime) in std::mem::take(&mut state.outputs) {
                runtime.stop();
            }
            for (_, runtime) in std::mem::take(&mut state.mixers) {
                runtime.stop();
            }
            state.pending_outputs.clear();
        }
    }
}

#[derive(Default)]
struct BridgeMediaState {
    inputs: HashMap<String, BridgeInputRuntime>,
    outputs: HashMap<String, BridgeOutputRuntime>,
    mixers: HashMap<OutputMixerKey, BridgeOutputMixerRuntime>,
    pending_outputs: HashMap<String, PendingBridgeOutput>,
}

struct PendingBridgeOutput {
    request: ReserveBridgeOutputRequest,
    port: u16,
}

struct BridgeInputRuntime {
    _stream: Stream,
    child: Arc<Mutex<Child>>,
    last_error: Arc<Mutex<Option<String>>>,
    level_milli_db: Arc<AtomicI32>,
    sender: Option<SyncSender<Vec<u8>>>,
    writer: Option<JoinHandle<()>>,
}

struct BridgeOutputRuntime {
    mixer_key: OutputMixerKey,
    child: Arc<Mutex<Child>>,
    last_error: Arc<Mutex<Option<String>>>,
    decoded_frames: Arc<AtomicU64>,
    decoded_bytes: Arc<AtomicU64>,
    reader: Option<JoinHandle<()>>,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct OutputMixerKey {
    device_id: String,
    left_channel: u16,
    right_channel: u16,
}

struct BridgeOutputMixerRuntime {
    _stream: Stream,
    sample_rate: SampleRate,
    sources: Arc<Mutex<HashMap<String, BridgeOutputMixerSource>>>,
    last_error: Arc<Mutex<Option<String>>>,
}

#[derive(Clone)]
struct BridgeOutputMixerSource {
    queue: Arc<Mutex<VecDeque<StereoFrame>>>,
    level: Arc<Mutex<BridgeOutputLevel>>,
}

#[derive(Clone, Copy)]
struct BridgeOutputLevel {
    volume: f32,
    muted: bool,
}

#[derive(Clone, Copy)]
struct StereoFrame {
    left: f32,
    right: f32,
}

impl BridgeMediaManager {
    pub fn start_input(
        &self,
        request: StartBridgeInputRequest,
    ) -> Result<BridgeMediaStatus, String> {
        validate_stream_id(&request.stream_id)?;
        validate_assignment(&request.assignment, "input")?;
        if request.rtp_ip.trim().is_empty() || request.rtp_port == 0 {
            return Err("RTP destination is required".to_string());
        }

        let runtime = BridgeInputRuntime::start(&request)?;
        let mut state = self.lock()?;
        if let Some(previous) = state.inputs.remove(&request.stream_id) {
            previous.stop();
        }
        state.inputs.insert(request.stream_id, runtime);
        Ok(status_from(&state))
    }

    pub fn stop_input(&self, stream_id: String) -> Result<BridgeMediaStatus, String> {
        let mut state = self.lock()?;
        if let Some(runtime) = state.inputs.remove(stream_id.trim()) {
            runtime.stop();
        }
        Ok(status_from(&state))
    }

    pub fn reserve_output(
        &self,
        request: ReserveBridgeOutputRequest,
    ) -> Result<ReservedBridgeOutput, String> {
        validate_stream_id(&request.stream_id)?;
        validate_assignment(&request.assignment, "output")?;
        let socket = UdpSocket::bind("0.0.0.0:0")
            .map_err(|err| format!("failed to reserve RTP receive port: {err}"))?;
        let port = socket
            .local_addr()
            .map_err(|err| format!("failed to read reserved RTP port: {err}"))?
            .port();
        drop(socket);

        let mut state = self.lock()?;
        Self::stop_output_locked(&mut state, &request.stream_id);
        state.pending_outputs.insert(
            request.stream_id.clone(),
            PendingBridgeOutput {
                request: request.clone(),
                port,
            },
        );
        Ok(ReservedBridgeOutput {
            stream_id: request.stream_id,
            port,
        })
    }

    pub fn activate_output(
        &self,
        request: ActivateBridgeOutputRequest,
    ) -> Result<BridgeMediaStatus, String> {
        let mut state = self.lock()?;
        let stream_id = request.stream_id.trim().to_string();
        let pending = state
            .pending_outputs
            .remove(&stream_id)
            .ok_or_else(|| "RTP output port was not reserved".to_string())?;
        Self::stop_output_locked(&mut state, &stream_id);

        let mixer_key = OutputMixerKey::from_assignment(&pending.request.assignment);
        if !state.mixers.contains_key(&mixer_key) {
            let mixer = BridgeOutputMixerRuntime::start(&pending.request.assignment)?;
            state.mixers.insert(mixer_key.clone(), mixer);
        }
        let mixer = state
            .mixers
            .get(&mixer_key)
            .ok_or_else(|| "bridge output mixer was not created".to_string())?;
        let output_sample_rate = mixer.sample_rate;
        let source_queue = mixer.add_source(stream_id.clone())?;
        let runtime = match BridgeOutputRuntime::start(
            &pending,
            &request,
            mixer_key.clone(),
            source_queue,
            output_sample_rate,
        ) {
            Ok(runtime) => runtime,
            Err(err) => {
                Self::remove_mixer_source_locked(&mut state, &mixer_key, &stream_id);
                return Err(err);
            }
        };
        state.outputs.insert(stream_id, runtime);
        Ok(status_from(&state))
    }

    pub fn stop_output(&self, stream_id: String) -> Result<BridgeMediaStatus, String> {
        let mut state = self.lock()?;
        state.pending_outputs.remove(stream_id.trim());
        Self::stop_output_locked(&mut state, stream_id.trim());
        Ok(status_from(&state))
    }

    pub fn set_output_level(
        &self,
        request: SetBridgeOutputLevelRequest,
    ) -> Result<BridgeMediaStatus, String> {
        validate_stream_id(&request.stream_id)?;
        let mut state = self.lock()?;
        let stream_id = request.stream_id.trim();
        let mixer_key = state
            .outputs
            .get(stream_id)
            .map(|runtime| runtime.mixer_key.clone())
            .ok_or_else(|| "Bridge output stream is not active".to_string())?;
        let mixer = state
            .mixers
            .get_mut(&mixer_key)
            .ok_or_else(|| "Bridge output mixer is not active".to_string())?;
        mixer.set_source_level(stream_id, request.volume, request.muted)?;
        Ok(status_from(&state))
    }

    pub fn stop_all(&self) -> Result<BridgeMediaStatus, String> {
        let mut state = self.lock()?;
        let inputs = std::mem::take(&mut state.inputs);
        let outputs = std::mem::take(&mut state.outputs);
        let mixers = std::mem::take(&mut state.mixers);
        state.pending_outputs.clear();
        for (_, runtime) in inputs {
            runtime.stop();
        }
        for (_, runtime) in outputs {
            runtime.stop();
        }
        for (_, runtime) in mixers {
            runtime.stop();
        }
        Ok(status_from(&state))
    }

    pub fn status(&self) -> Result<BridgeMediaStatus, String> {
        let state = self.lock()?;
        Ok(status_from(&state))
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, BridgeMediaState>, String> {
        self.inner
            .lock()
            .map_err(|_| "bridge media runtime lock poisoned".to_string())
    }

    fn stop_output_locked(state: &mut BridgeMediaState, stream_id: &str) {
        let stream_id = stream_id.trim();
        if let Some(runtime) = state.outputs.remove(stream_id) {
            let mixer_key = runtime.mixer_key.clone();
            runtime.stop();
            Self::remove_mixer_source_locked(state, &mixer_key, stream_id);
        }
    }

    fn remove_mixer_source_locked(
        state: &mut BridgeMediaState,
        mixer_key: &OutputMixerKey,
        stream_id: &str,
    ) {
        let should_remove = if let Some(mixer) = state.mixers.get(mixer_key) {
            mixer.remove_source(stream_id);
            mixer.is_empty()
        } else {
            false
        };
        if should_remove {
            if let Some(mixer) = state.mixers.remove(mixer_key) {
                mixer.stop();
            }
        }
    }
}

impl BridgeInputRuntime {
    fn start(request: &StartBridgeInputRequest) -> Result<Self, String> {
        let device = audio::find_audio_device("input", &request.assignment.device_id)?;
        let config = choose_f32_config(
            &device,
            "input",
            request
                .assignment
                .left_channel
                .max(request.assignment.right_channel),
        )?;
        let input_sample_rate = config.sample_rate.to_string();
        let channels = usize::from(config.channels);
        let left_index = usize::from(request.assignment.left_channel - 1);
        let right_index = usize::from(request.assignment.right_channel - 1);
        let destination = format!(
            "rtp://{}:{}?pkt_size=1200",
            request.rtp_ip.trim(),
            request.rtp_port
        );
        let (sender, receiver) = sync_channel::<Vec<u8>>(8);
        let callback_sender = sender.clone();
        let last_error = Arc::new(Mutex::new(None));
        let stream_error = Arc::clone(&last_error);
        let level_milli_db = Arc::new(AtomicI32::new(-120_000));
        let callback_level = Arc::clone(&level_milli_db);
        let stream = device
            .build_input_stream::<f32, _, _>(
                config,
                move |data, _| {
                    if channels == 0 || left_index >= channels || right_index >= channels {
                        return;
                    }
                    let frames = data.len() / channels;
                    let mut bytes = Vec::with_capacity(frames * 2 * std::mem::size_of::<f32>());
                    let mut sum_squares = 0.0_f64;
                    let mut sample_count = 0_usize;
                    for frame in data.chunks_exact(channels) {
                        let left = frame[left_index];
                        let right = frame[right_index];
                        sum_squares += f64::from(left * left);
                        sum_squares += f64::from(right * right);
                        sample_count += 2;
                        bytes.extend_from_slice(&left.to_le_bytes());
                        bytes.extend_from_slice(&right.to_le_bytes());
                    }
                    callback_level.store(rms_milli_db(sum_squares, sample_count), Ordering::Relaxed);
                    let _ = callback_sender.try_send(bytes);
                },
                move |err| {
                    let message = format!("bridge input stream error: {err}");
                    eprintln!("{message}");
                    if let Ok(mut last_error) = stream_error.lock() {
                        *last_error = Some(message);
                    }
                },
                None,
            )
            .map_err(|err| format!("failed to build bridge input stream: {err}"))?;
        stream
            .play()
            .map_err(|err| format!("failed to start bridge input stream: {err}"))?;

        let mut child = ffmpeg_command()
            .args([
                "-hide_banner",
                "-loglevel",
                "warning",
                "-f",
                "f32le",
                "-ar",
                &input_sample_rate,
                "-ac",
                "2",
                "-i",
                "pipe:0",
                "-ar",
                "48000",
                "-c:a",
                "libopus",
                "-application",
                "voip",
                "-frame_duration",
                "20",
                "-b:a",
                "64000",
                "-payload_type",
                &request.payload_type.to_string(),
                "-ssrc",
                &request.ssrc.to_string(),
                "-f",
                "rtp",
                &destination,
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|err| format!("failed to start ffmpeg Opus encoder: {err}"))?;
        let mut stdin = match child.stdin.take() {
            Some(stdin) => stdin,
            None => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("ffmpeg encoder stdin is unavailable".to_string());
            }
        };
        let child = Arc::new(Mutex::new(child));
        let writer = thread::spawn(move || {
            while let Ok(bytes) = receiver.recv() {
                if stdin.write_all(&bytes).is_err() {
                    break;
                }
            }
        });

        Ok(Self {
            _stream: stream,
            child,
            last_error,
            level_milli_db,
            sender: Some(sender),
            writer: Some(writer),
        })
    }

    fn stop(mut self) {
        drop(self._stream);
        self.sender.take();
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(writer) = self.writer.take() {
            let _ = writer.join();
        }
    }
}

impl OutputMixerKey {
    fn from_assignment(assignment: &BridgeChannelAssignment) -> Self {
        Self {
            device_id: assignment.device_id.trim().to_string(),
            left_channel: assignment.left_channel,
            right_channel: assignment.right_channel,
        }
    }
}

impl BridgeOutputMixerRuntime {
    fn start(assignment: &BridgeChannelAssignment) -> Result<Self, String> {
        let device = audio::find_audio_device("output", &assignment.device_id)?;
        let config = choose_f32_config(
            &device,
            "output",
            assignment.left_channel.max(assignment.right_channel),
        )?;
        let sample_rate = config.sample_rate;
        let channels = usize::from(config.channels);
        let left_index = usize::from(assignment.left_channel - 1);
        let right_index = usize::from(assignment.right_channel - 1);
        let sources = Arc::new(Mutex::new(HashMap::<String, BridgeOutputMixerSource>::new()));
        let output_sources = Arc::clone(&sources);
        let last_error = Arc::new(Mutex::new(None));
        let stream_error = Arc::clone(&last_error);
        let stream = device
            .build_output_stream::<f32, _, _>(
                config,
                move |data, _| {
                    data.fill(0.0);
                    if channels == 0 || left_index >= channels || right_index >= channels {
                        return;
                    }
                    let source_queues = output_sources
                        .lock()
                        .map(|sources| sources.values().cloned().collect::<Vec<_>>())
                        .unwrap_or_default();
                    if source_queues.is_empty() {
                        return;
                    }
                    for frame in data.chunks_exact_mut(channels) {
                        let mut left = 0.0_f32;
                        let mut right = 0.0_f32;
                        for source in &source_queues {
                            let level = source.level.lock().map(|level| *level).unwrap_or(
                                BridgeOutputLevel {
                                    volume: 1.0,
                                    muted: false,
                                },
                            );
                            if level.muted || level.volume <= 0.0 {
                                continue;
                            }
                            if let Ok(mut queue) = source.queue.lock() {
                                if let Some(stereo) = queue.pop_front() {
                                    left += stereo.left * level.volume;
                                    right += stereo.right * level.volume;
                                }
                            }
                        }
                        if left_index == right_index {
                            frame[left_index] = ((left + right) * 0.5).clamp(-1.0, 1.0);
                        } else {
                            frame[left_index] = left.clamp(-1.0, 1.0);
                            frame[right_index] = right.clamp(-1.0, 1.0);
                        }
                    }
                },
                move |err| {
                    let message = format!("bridge output stream error: {err}");
                    eprintln!("{message}");
                    if let Ok(mut last_error) = stream_error.lock() {
                        *last_error = Some(message);
                    }
                },
                None,
            )
            .map_err(|err| format!("failed to build bridge output stream: {err}"))?;
        stream
            .play()
            .map_err(|err| format!("failed to start bridge output stream: {err}"))?;
        Ok(Self {
            _stream: stream,
            sample_rate,
            sources,
            last_error,
        })
    }

    fn add_source(&self, stream_id: String) -> Result<Arc<Mutex<VecDeque<StereoFrame>>>, String> {
        let queue = Arc::new(Mutex::new(VecDeque::<StereoFrame>::new()));
        let source = BridgeOutputMixerSource {
            queue: Arc::clone(&queue),
            level: Arc::new(Mutex::new(BridgeOutputLevel {
                volume: 1.0,
                muted: false,
            })),
        };
        let mut sources = self
            .sources
            .lock()
            .map_err(|_| "bridge output mixer lock poisoned".to_string())?;
        sources.insert(stream_id, source);
        Ok(queue)
    }

    fn set_source_level(
        &mut self,
        stream_id: &str,
        volume: f32,
        muted: bool,
    ) -> Result<(), String> {
        let sources = self
            .sources
            .lock()
            .map_err(|_| "bridge output mixer lock poisoned".to_string())?;
        let source = sources
            .get(stream_id.trim())
            .ok_or_else(|| "Bridge output mixer source is not active".to_string())?;
        let mut level = source
            .level
            .lock()
            .map_err(|_| "bridge output source level lock poisoned".to_string())?;
        level.volume = volume.clamp(0.0, 1.0);
        level.muted = muted;
        Ok(())
    }

    fn remove_source(&self, stream_id: &str) {
        if let Ok(mut sources) = self.sources.lock() {
            sources.remove(stream_id.trim());
        }
    }

    fn is_empty(&self) -> bool {
        self.sources
            .lock()
            .map(|sources| sources.is_empty())
            .unwrap_or(true)
    }

    fn stop(self) {
        drop(self._stream);
    }
}

impl BridgeOutputRuntime {
    fn start(
        pending: &PendingBridgeOutput,
        request: &ActivateBridgeOutputRequest,
        mixer_key: OutputMixerKey,
        queue: Arc<Mutex<VecDeque<StereoFrame>>>,
        output_sample_rate: SampleRate,
    ) -> Result<Self, String> {
        let output_sample_rate = output_sample_rate.to_string();
        let fmtp_line = request
            .fmtp
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(|value| format!("a=fmtp:{} {}\n", request.payload_type, value.trim()))
            .unwrap_or_default();
        let sdp = format!(
            "v=0\n\
             o=- 0 0 IN IP4 127.0.0.1\n\
             s=TalkToMe Bridge\n\
             c=IN IP4 0.0.0.0\n\
             t=0 0\n\
             m=audio {} RTP/AVP {}\n\
             a=rtpmap:{} opus/{}/{}\n\
             {}\
             a=rtcp-mux\n\
             a=recvonly\n",
            pending.port,
            request.payload_type,
            request.payload_type,
            request.clock_rate,
            request.channels,
            fmtp_line,
        );
        let mut child = ffmpeg_command()
            .args([
                "-hide_banner",
                "-loglevel",
                "warning",
                "-protocol_whitelist",
                "pipe,udp,rtp",
                "-fflags",
                "nobuffer",
                "-flags",
                "low_delay",
                "-analyzeduration",
                "0",
                "-probesize",
                "32",
                "-f",
                "sdp",
                "-i",
                "pipe:0",
                "-ac",
                "2",
                "-ar",
                &output_sample_rate,
                "-c:a",
                "pcm_f32le",
                "-f",
                "f32le",
                "pipe:1",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|err| format!("failed to start ffmpeg Opus decoder: {err}"))?;
        let mut stdin = match child.stdin.take() {
            Some(stdin) => stdin,
            None => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("ffmpeg decoder stdin is unavailable".to_string());
            }
        };
        if let Err(err) = stdin.write_all(sdp.as_bytes()) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("failed to configure ffmpeg decoder: {err}"));
        }
        drop(stdin);
        thread::sleep(Duration::from_millis(DECODER_STARTUP_GRACE_MS));
        if let Some(status) = child
            .try_wait()
            .map_err(|err| format!("failed to inspect ffmpeg decoder: {err}"))?
        {
            return Err(format!(
                "ffmpeg Opus decoder exited during startup: {status}"
            ));
        }
        let mut stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("ffmpeg decoder stdout is unavailable".to_string());
            }
        };
        let child = Arc::new(Mutex::new(child));
        let reader_queue = Arc::clone(&queue);
        let last_error = Arc::new(Mutex::new(None));
        let reader_error = Arc::clone(&last_error);
        let decoded_frames = Arc::new(AtomicU64::new(0));
        let decoded_bytes = Arc::new(AtomicU64::new(0));
        let reader_decoded_frames = Arc::clone(&decoded_frames);
        let reader_decoded_bytes = Arc::clone(&decoded_bytes);
        let reader = thread::spawn(move || {
            let mut read_buffer = [0_u8; 8192];
            let mut pending_bytes = Vec::<u8>::new();
            loop {
                let read = match stdout.read(&mut read_buffer) {
                    Ok(0) => break,
                    Err(err) => {
                        if let Ok(mut last_error) = reader_error.lock() {
                            *last_error = Some(format!("ffmpeg Opus decoder read failed: {err}"));
                        }
                        break;
                    }
                    Ok(read) => read,
                };
                pending_bytes.extend_from_slice(&read_buffer[..read]);
                let complete_bytes = pending_bytes.len() - (pending_bytes.len() % 8);
                if complete_bytes == 0 {
                    continue;
                }
                reader_decoded_frames.fetch_add((complete_bytes / 8) as u64, Ordering::Relaxed);
                reader_decoded_bytes.fetch_add(complete_bytes as u64, Ordering::Relaxed);
                if let Ok(mut queue) = reader_queue.lock() {
                    for frame in pending_bytes[..complete_bytes].chunks_exact(8) {
                        queue.push_back(StereoFrame {
                            left: f32::from_le_bytes(frame[0..4].try_into().unwrap_or([0; 4])),
                            right: f32::from_le_bytes(frame[4..8].try_into().unwrap_or([0; 4])),
                        });
                    }
                    while queue.len() > OUTPUT_QUEUE_LIMIT_FRAMES {
                        queue.pop_front();
                    }
                }
                pending_bytes.drain(..complete_bytes);
            }
        });
        Ok(Self {
            mixer_key,
            child,
            last_error,
            decoded_frames,
            decoded_bytes,
            reader: Some(reader),
        })
    }

    fn stop(mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

fn choose_f32_config(
    device: &cpal::Device,
    direction: &str,
    min_channels: u16,
) -> Result<StreamConfig, String> {
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
        .min_by_key(|range| {
            (
                sample_rate_distance_from_48k(select_sample_rate(range)),
                range.channels(),
            )
        })
        .ok_or_else(|| {
            format!("no F32 {direction} config with at least {min_channels} channels")
        })?;
    Ok(selected
        .with_sample_rate(select_sample_rate(&selected))
        .config())
}

fn select_sample_rate(range: &SupportedStreamConfigRange) -> SampleRate {
    if range.contains_rate(SAMPLE_RATE_48K) {
        return SAMPLE_RATE_48K;
    }

    let min = range.min_sample_rate();
    let max = range.max_sample_rate();

    if max < SAMPLE_RATE_48K {
        max
    } else {
        min
    }
}

fn sample_rate_distance_from_48k(sample_rate: SampleRate) -> u32 {
    sample_rate.abs_diff(SAMPLE_RATE_48K)
}

fn validate_stream_id(stream_id: &str) -> Result<(), String> {
    if stream_id.trim().is_empty() {
        return Err("stream id is required".to_string());
    }
    Ok(())
}

fn validate_assignment(assignment: &BridgeChannelAssignment, label: &str) -> Result<(), String> {
    if assignment.device_id.trim().is_empty() {
        return Err(format!("{label} device is required"));
    }
    if assignment.left_channel == 0
        || (assignment.right_channel != assignment.left_channel
            && assignment.right_channel != assignment.left_channel + 1)
    {
        return Err(format!(
            "{label} channels must be one mono channel or an adjacent one-based pair"
        ));
    }
    Ok(())
}

fn status_from(state: &BridgeMediaState) -> BridgeMediaStatus {
    let mut input_stream_ids = state.inputs.keys().cloned().collect::<Vec<_>>();
    let mut output_stream_ids = state.outputs.keys().cloned().collect::<Vec<_>>();
    let mut pending_output_stream_ids = state.pending_outputs.keys().cloned().collect::<Vec<_>>();
    let mut input_stream_errors = state
        .inputs
        .iter()
        .filter_map(|(stream_id, runtime)| {
            read_last_error(&runtime.last_error).map(|message| BridgeMediaStreamError {
                stream_id: stream_id.clone(),
                message,
            })
        })
        .collect::<Vec<_>>();
    let mut output_stream_errors = state
        .outputs
        .iter()
        .filter_map(|(stream_id, runtime)| {
            let runtime_error = read_last_error(&runtime.last_error);
            let mixer_error = state
                .mixers
                .get(&runtime.mixer_key)
                .and_then(|mixer| read_last_error(&mixer.last_error));
            runtime_error
                .or(mixer_error)
                .map(|message| BridgeMediaStreamError {
                    stream_id: stream_id.clone(),
                    message,
                })
        })
        .collect::<Vec<_>>();
    let mut input_stream_stats = state
        .inputs
        .iter()
        .map(|(stream_id, runtime)| BridgeMediaInputStats {
            stream_id: stream_id.clone(),
            rms_db: runtime.level_milli_db.load(Ordering::Relaxed) as f32 / 1000.0,
        })
        .collect::<Vec<_>>();
    let mut output_stream_stats = state
        .outputs
        .iter()
        .map(|(stream_id, runtime)| BridgeMediaOutputStats {
            stream_id: stream_id.clone(),
            decoded_frames: runtime.decoded_frames.load(Ordering::Relaxed),
            decoded_bytes: runtime.decoded_bytes.load(Ordering::Relaxed),
        })
        .collect::<Vec<_>>();
    input_stream_ids.sort();
    output_stream_ids.sort();
    pending_output_stream_ids.sort();
    input_stream_errors.sort_by(|a, b| a.stream_id.cmp(&b.stream_id));
    output_stream_errors.sort_by(|a, b| a.stream_id.cmp(&b.stream_id));
    input_stream_stats.sort_by(|a, b| a.stream_id.cmp(&b.stream_id));
    output_stream_stats.sort_by(|a, b| a.stream_id.cmp(&b.stream_id));
    BridgeMediaStatus {
        input_stream_ids,
        output_stream_ids,
        pending_output_stream_ids,
        input_stream_errors,
        output_stream_errors,
        input_stream_stats,
        output_stream_stats,
    }
}

fn rms_milli_db(sum_squares: f64, sample_count: usize) -> i32 {
    if sample_count == 0 || sum_squares <= 0.0 {
        return -120_000;
    }
    let rms = (sum_squares / sample_count as f64).sqrt();
    if rms <= 0.0 {
        return -120_000;
    }
    let db = (20.0 * rms.log10()).clamp(-120.0, 0.0);
    (db * 1000.0).round() as i32
}

fn read_last_error(last_error: &Arc<Mutex<Option<String>>>) -> Option<String> {
    last_error
        .lock()
        .ok()
        .and_then(|error| error.clone())
        .filter(|message| !message.trim().is_empty())
}
