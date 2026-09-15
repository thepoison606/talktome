use libloading::Library;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::ffi::{c_char, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::ptr;
use std::sync::{
    atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering},
    mpsc::{sync_channel, SyncSender, TrySendError},
    Arc, Mutex, OnceLock,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::audio::{AudioConfigRange, AudioDeviceInfo, ChannelPair};
use crate::bridge_media::{BridgeOutputLevel, BridgeOutputMixerSource};

const NDI_INPUT_PREFIX: &str = "ndi:recv:";
const NDI_OUTPUT_PREFIX: &str = "ndi:send:";
const NDI_INPUT_MAX_CHANNELS: u16 = 32;
const NDI_OUTPUT_SLOTS: usize = 8;
const NDI_SAMPLE_RATE: i32 = 48_000;
const NDI_SEND_FRAMES: usize = 480;
const NDI_FRAME_TYPE_AUDIO: i32 = 2;
const NDI_FRAME_TYPE_ERROR: i32 = 4;
const NDI_RECV_COLOR_FORMAT_FASTEST: i32 = 100;
const NDI_RECV_BANDWIDTH_AUDIO_ONLY: i32 = 10;
const NDI_FOURCC_FLTP: i32 = i32::from_le_bytes(*b"FLTp");
const NDI_TIMECODE_SYNTHESIZE: i64 = i64::MAX;
const NDI_CAPTURE_TIMEOUT_MS: u32 = 100;
const NDI_INITIAL_DISCOVERY_WAIT: Duration = Duration::from_secs(2);
const NDI_EMPTY_DISCOVERY_GRACE: Duration = Duration::from_secs(10);
const NDI_CHANNEL_PROBE_PER_SOURCE: Duration = Duration::from_millis(350);
const NDI_CHANNEL_PROBE_TOTAL: Duration = Duration::from_millis(1_200);
#[cfg(any(windows, test))]
const WINDOWS_NDI_RUNTIME_DIRECTORIES: &[&str] = &[
    "NDI\\NDI 6 Runtime\\v6",
    "NDI\\NDI 6 Tools\\Runtime",
    "NDI\\NDI 5 Runtime\\v5",
    "NewTek\\NDI 6 Runtime\\v6",
    "NewTek\\NDI 5 Runtime\\v5",
];

static NDI_DISCOVERY_LOCK: Mutex<()> = Mutex::new(());
static NDI_SOURCE_CACHE: OnceLock<Mutex<CachedSources>> = OnceLock::new();
static NDI_CHANNEL_COUNT_CACHE: OnceLock<Mutex<HashMap<String, u16>>> = OnceLock::new();

type NdiInstance = *mut c_void;

#[repr(C)]
#[derive(Clone, Copy)]
struct NdiSource {
    ndi_name: *const c_char,
    url_address: *const c_char,
}

#[repr(C)]
struct NdiFindCreate {
    show_local_sources: bool,
    groups: *const c_char,
    extra_ips: *const c_char,
}

#[repr(C)]
struct NdiRecvCreateV3 {
    source: NdiSource,
    color_format: i32,
    bandwidth: i32,
    allow_video_fields: bool,
    receiver_name: *const c_char,
}

#[repr(C)]
struct NdiSendCreate {
    ndi_name: *const c_char,
    groups: *const c_char,
    clock_video: bool,
    clock_audio: bool,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct NdiAudioFrameV3 {
    sample_rate: i32,
    channels: i32,
    samples: i32,
    timecode: i64,
    fourcc: i32,
    data: *mut u8,
    channel_stride_bytes: i32,
    metadata: *const c_char,
    timestamp: i64,
}

type InitializeFn = unsafe extern "C" fn() -> bool;
type VersionFn = unsafe extern "C" fn() -> *const c_char;
type FindCreateFn = unsafe extern "C" fn(*const NdiFindCreate) -> NdiInstance;
type FindDestroyFn = unsafe extern "C" fn(NdiInstance);
type FindWaitFn = unsafe extern "C" fn(NdiInstance, u32) -> bool;
type FindSourcesFn = unsafe extern "C" fn(NdiInstance, *mut u32) -> *const NdiSource;
type RecvCreateFn = unsafe extern "C" fn(*const NdiRecvCreateV3) -> NdiInstance;
type RecvDestroyFn = unsafe extern "C" fn(NdiInstance);
type RecvCaptureFn =
    unsafe extern "C" fn(NdiInstance, *mut c_void, *mut NdiAudioFrameV3, *mut c_void, u32) -> i32;
type RecvFreeAudioFn = unsafe extern "C" fn(NdiInstance, *const NdiAudioFrameV3);
type SendCreateFn = unsafe extern "C" fn(*const NdiSendCreate) -> NdiInstance;
type SendDestroyFn = unsafe extern "C" fn(NdiInstance);
type SendAudioFn = unsafe extern "C" fn(NdiInstance, *const NdiAudioFrameV3);
type SendSourceNameFn = unsafe extern "C" fn(NdiInstance) -> *const NdiSource;

struct NdiApi {
    _library: Library,
    runtime_path: String,
    version: VersionFn,
    find_create: FindCreateFn,
    find_destroy: FindDestroyFn,
    find_wait: FindWaitFn,
    find_sources: FindSourcesFn,
    recv_create: RecvCreateFn,
    recv_destroy: RecvDestroyFn,
    recv_capture: RecvCaptureFn,
    recv_free_audio: RecvFreeAudioFn,
    send_create: SendCreateFn,
    send_destroy: SendDestroyFn,
    send_audio: SendAudioFn,
    send_source_name: SendSourceNameFn,
}

#[derive(Debug, Clone)]
struct DiscoveredSource {
    id: String,
    name: String,
}

#[derive(Default)]
struct CachedSources {
    sources: Vec<DiscoveredSource>,
    updated_at: Option<Instant>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NdiStatus {
    pub available: bool,
    pub version: Option<String>,
    pub runtime_path: Option<String>,
    pub source_count: usize,
    pub source_names: Vec<String>,
    pub error: Option<String>,
}

pub struct NdiInputRuntime {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

pub struct NdiOutputRuntime {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl NdiApi {
    fn load() -> Result<Self, String> {
        let (library, runtime_path) = load_runtime_library()?;
        unsafe {
            let initialize = load_symbol::<InitializeFn>(&library, b"NDIlib_initialize\0")?;
            let api = Self {
                version: load_symbol(&library, b"NDIlib_version\0")?,
                find_create: load_symbol(&library, b"NDIlib_find_create_v2\0")?,
                find_destroy: load_symbol(&library, b"NDIlib_find_destroy\0")?,
                find_wait: load_symbol(&library, b"NDIlib_find_wait_for_sources\0")?,
                find_sources: load_symbol(&library, b"NDIlib_find_get_current_sources\0")?,
                recv_create: load_symbol(&library, b"NDIlib_recv_create_v3\0")?,
                recv_destroy: load_symbol(&library, b"NDIlib_recv_destroy\0")?,
                recv_capture: load_symbol(&library, b"NDIlib_recv_capture_v3\0")?,
                recv_free_audio: load_symbol(&library, b"NDIlib_recv_free_audio_v3\0")?,
                send_create: load_symbol(&library, b"NDIlib_send_create\0")?,
                send_destroy: load_symbol(&library, b"NDIlib_send_destroy\0")?,
                send_audio: load_symbol(&library, b"NDIlib_send_send_audio_v3\0")?,
                send_source_name: load_symbol(&library, b"NDIlib_send_get_source_name\0")?,
                _library: library,
                runtime_path,
            };
            if !initialize() {
                return Err("NDI Runtime initialization failed".to_string());
            }
            Ok(api)
        }
    }

    fn version_string(&self) -> Option<String> {
        let value = unsafe { (self.version)() };
        c_string(value)
    }

    fn discover(&self, wait: Duration) -> Result<Vec<DiscoveredSource>, String> {
        let settings = NdiFindCreate {
            show_local_sources: true,
            groups: ptr::null(),
            extra_ips: ptr::null(),
        };
        let finder = unsafe { (self.find_create)(&settings) };
        if finder.is_null() {
            return Err("NDI source finder could not be created".to_string());
        }
        let finder = NdiFinderGuard { api: self, finder };
        if !wait.is_zero() {
            unsafe {
                (self.find_wait)(finder.finder, wait.as_millis().min(u32::MAX as u128) as u32);
            }
        }
        let mut count = 0_u32;
        let sources = unsafe { (self.find_sources)(finder.finder, &mut count) };
        if sources.is_null() || count == 0 {
            return Ok(Vec::new());
        }

        let mut seen = HashSet::new();
        let mut result = unsafe { std::slice::from_raw_parts(sources, count as usize) }
            .iter()
            .filter_map(|source| c_string(source.ndi_name))
            .filter(|name| !name.trim().is_empty())
            .filter_map(|name| {
                let id = input_device_id(&name);
                seen.insert(id.clone())
                    .then_some(DiscoveredSource { id, name })
            })
            .collect::<Vec<_>>();
        result.sort_by_key(|source| source.name.to_lowercase());
        Ok(result)
    }
}

struct NdiFinderGuard<'a> {
    api: &'a NdiApi,
    finder: NdiInstance,
}

impl Drop for NdiFinderGuard<'_> {
    fn drop(&mut self) {
        unsafe { (self.api.find_destroy)(self.finder) }
    }
}

unsafe fn load_symbol<T: Copy>(library: &Library, name: &[u8]) -> Result<T, String> {
    library.get::<T>(name).map(|symbol| *symbol).map_err(|err| {
        format!(
            "NDI Runtime is missing {}: {err}",
            String::from_utf8_lossy(name).trim_end_matches('\0')
        )
    })
}

fn load_runtime_library() -> Result<(Library, String), String> {
    let candidates = runtime_candidates();
    let mut errors = Vec::new();
    for candidate in candidates {
        match unsafe { Library::new(&candidate) } {
            Ok(library) => return Ok((library, candidate.display().to_string())),
            Err(error) => errors.push(format!("{}: {error}", candidate.display())),
        }
    }
    Err(format!(
        "NDI Runtime not found. Install NDI Runtime 6 or set TALKTOME_NDI_RUNTIME. Tried: {}",
        errors.join("; ")
    ))
}

fn runtime_candidates() -> Vec<PathBuf> {
    let names = runtime_library_names();
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("TALKTOME_NDI_RUNTIME") {
        push_runtime_path(&mut candidates, PathBuf::from(path), names);
    }
    for variable in [
        "NDI_RUNTIME_DIR_V6",
        "NDI_RUNTIME_DIR_V5",
        "NDI_RUNTIME_DIR_V4",
    ] {
        if let Some(path) = std::env::var_os(variable) {
            push_runtime_path(&mut candidates, PathBuf::from(path), names);
        }
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            push_runtime_directory(&mut candidates, directory, names);
            push_runtime_directory(&mut candidates, &directory.join("binaries"), names);
            if let Some(contents) = directory.parent() {
                push_runtime_directory(&mut candidates, &contents.join("Resources"), names);
            }
        }
    }

    #[cfg(target_os = "macos")]
    for directory in [
        "/usr/local/lib",
        "/Library/NDI SDK for Apple/lib/macOS",
        "/Library/Application Support/NDI",
        "/Library/Application Support/NewTek/NDI",
    ] {
        push_runtime_directory(&mut candidates, Path::new(directory), names);
    }

    #[cfg(target_os = "linux")]
    for directory in [
        "/usr/local/lib",
        "/usr/lib",
        "/usr/lib/x86_64-linux-gnu",
        "/usr/lib/aarch64-linux-gnu",
    ] {
        push_runtime_directory(&mut candidates, Path::new(directory), names);
    }

    #[cfg(windows)]
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        push_windows_runtime_directories(&mut candidates, &PathBuf::from(program_files), names);
    }

    for name in names {
        candidates.push(PathBuf::from(name));
    }
    let mut seen = HashSet::new();
    candidates.retain(|candidate| seen.insert(candidate.clone()));
    candidates
}

#[cfg(any(windows, test))]
fn push_windows_runtime_directories(
    candidates: &mut Vec<PathBuf>,
    program_files: &Path,
    names: &[&str],
) {
    for relative in WINDOWS_NDI_RUNTIME_DIRECTORIES {
        push_runtime_directory(candidates, &program_files.join(relative), names);
    }
}

fn push_runtime_path(candidates: &mut Vec<PathBuf>, path: PathBuf, names: &[&str]) {
    if path.extension().is_some() {
        candidates.push(path);
    } else {
        push_runtime_directory(candidates, &path, names);
        push_runtime_directory(candidates, &path.join("lib"), names);
    }
}

fn push_runtime_directory(candidates: &mut Vec<PathBuf>, directory: &Path, names: &[&str]) {
    for name in names {
        candidates.push(directory.join(name));
    }
}

fn runtime_library_names() -> &'static [&'static str] {
    #[cfg(target_os = "macos")]
    {
        &["libndi.dylib"]
    }
    #[cfg(target_os = "linux")]
    {
        &["libndi.so.6", "libndi.so.5", "libndi.so.4", "libndi.so"]
    }
    #[cfg(all(windows, target_pointer_width = "64"))]
    {
        &["Processing.NDI.Lib.x64.dll"]
    }
    #[cfg(all(windows, target_pointer_width = "32"))]
    {
        &["Processing.NDI.Lib.x86.dll"]
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        &[]
    }
}

fn c_string(value: *const c_char) -> Option<String> {
    if value.is_null() {
        return None;
    }
    Some(
        unsafe { CStr::from_ptr(value) }
            .to_string_lossy()
            .into_owned(),
    )
}

fn stable_hash(value: &str) -> u64 {
    value
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325_u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        })
}

fn input_device_id(name: &str) -> String {
    format!("{NDI_INPUT_PREFIX}{:016x}", stable_hash(name))
}

pub fn is_input_device(device_id: &str) -> bool {
    device_id.trim().starts_with(NDI_INPUT_PREFIX)
}

pub fn is_output_device(device_id: &str) -> bool {
    device_id.trim().starts_with(NDI_OUTPUT_PREFIX)
}

fn output_source_name(device_id: &str) -> Result<String, String> {
    let slot = device_id
        .trim()
        .strip_prefix(NDI_OUTPUT_PREFIX)
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|slot| (1..=NDI_OUTPUT_SLOTS).contains(slot))
        .ok_or_else(|| format!("invalid NDI output device: {device_id}"))?;
    Ok(format!("Talktome Bridge {slot}"))
}

fn channel_pairs(max_channels: u16) -> Vec<ChannelPair> {
    let mut pairs = (1..=max_channels)
        .map(|channel| ChannelPair {
            label: channel.to_string(),
            left_channel: channel,
            right_channel: channel,
        })
        .collect::<Vec<_>>();
    pairs.extend((0..max_channels / 2).map(|pair| {
        let left = pair * 2 + 1;
        ChannelPair {
            label: format!("{left}/{}", left + 1),
            left_channel: left,
            right_channel: left + 1,
        }
    }));
    pairs
}

fn virtual_device(id: String, name: String, direction: &str, max_channels: u16) -> AudioDeviceInfo {
    AudioDeviceInfo {
        id,
        name,
        direction: direction.to_string(),
        is_default: false,
        max_channels,
        supports_48k: true,
        supported_configs: vec![AudioConfigRange {
            channels: max_channels,
            min_sample_rate: 48_000,
            max_sample_rate: 48_000,
            sample_format: "F32 (NDI)".to_string(),
            min_buffer_size: None,
            max_buffer_size: None,
        }],
        channel_pairs: channel_pairs(max_channels),
    }
}

fn normalized_input_channel_count(channels: i32) -> Option<u16> {
    u16::try_from(channels)
        .ok()
        .filter(|channels| *channels > 0)
        .map(|channels| channels.min(NDI_INPUT_MAX_CHANNELS))
}

fn cached_input_channel_count(source_id: &str) -> Option<u16> {
    NDI_CHANNEL_COUNT_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .ok()
        .and_then(|cache| cache.get(source_id).copied())
}

fn cache_input_channel_count(source_id: &str, channels: u16) {
    if let Ok(mut cache) = NDI_CHANNEL_COUNT_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
    {
        cache.insert(source_id.to_string(), channels);
    }
}

fn probe_input_channel_count(
    api: &NdiApi,
    source: &DiscoveredSource,
    wait: Duration,
) -> Option<u16> {
    if wait.is_zero() {
        return None;
    }
    let source_name = CString::new(source.name.clone()).ok()?;
    let receiver_name = CString::new("Talktome Bridge channel probe").ok()?;
    let settings = NdiRecvCreateV3 {
        source: NdiSource {
            ndi_name: source_name.as_ptr(),
            url_address: ptr::null(),
        },
        color_format: NDI_RECV_COLOR_FORMAT_FASTEST,
        bandwidth: NDI_RECV_BANDWIDTH_AUDIO_ONLY,
        allow_video_fields: false,
        receiver_name: receiver_name.as_ptr(),
    };
    let receiver = unsafe { (api.recv_create)(&settings) };
    if receiver.is_null() {
        return None;
    }
    let _guard = NdiReceiverGuard { api, receiver };
    let deadline = Instant::now() + wait;

    while Instant::now() < deadline {
        let mut frame = NdiAudioFrameV3 {
            sample_rate: 0,
            channels: 0,
            samples: 0,
            timecode: 0,
            fourcc: 0,
            data: ptr::null_mut(),
            channel_stride_bytes: 0,
            metadata: ptr::null(),
            timestamp: 0,
        };
        let remaining = deadline.saturating_duration_since(Instant::now());
        let timeout_ms = remaining
            .min(Duration::from_millis(u64::from(NDI_CAPTURE_TIMEOUT_MS)))
            .as_millis()
            .max(1) as u32;
        let frame_type = unsafe {
            (api.recv_capture)(
                receiver,
                ptr::null_mut(),
                &mut frame,
                ptr::null_mut(),
                timeout_ms,
            )
        };
        if frame_type == NDI_FRAME_TYPE_ERROR {
            return None;
        }
        if frame_type != NDI_FRAME_TYPE_AUDIO {
            continue;
        }
        let channels = normalized_input_channel_count(frame.channels);
        unsafe { (api.recv_free_audio)(receiver, &frame) };
        return channels;
    }
    None
}

pub fn audio_devices(wait: Duration) -> Vec<AudioDeviceInfo> {
    let Ok(api) = NdiApi::load() else {
        return Vec::new();
    };
    let sources = api.discover_resilient(wait).unwrap_or_default();
    let channel_probe_started = Instant::now();
    let mut devices = sources
        .into_iter()
        .map(|source| {
            let cached_channels = cached_input_channel_count(&source.id);
            let remaining = NDI_CHANNEL_PROBE_TOTAL.saturating_sub(channel_probe_started.elapsed());
            let detected_channels = probe_input_channel_count(
                &api,
                &source,
                remaining.min(NDI_CHANNEL_PROBE_PER_SOURCE),
            );
            if let Some(channels) = detected_channels {
                cache_input_channel_count(&source.id, channels);
            }
            virtual_device(
                source.id,
                format!("NDI network input · {}", source.name),
                "input",
                detected_channels.or(cached_channels).unwrap_or(2),
            )
        })
        .collect::<Vec<_>>();
    devices.extend((1..=NDI_OUTPUT_SLOTS).map(|slot| {
        virtual_device(
            format!("{NDI_OUTPUT_PREFIX}{slot}"),
            format!("NDI network output · Talktome Bridge {slot}"),
            "output",
            2,
        )
    }));
    devices
}

pub fn status(wait: Duration) -> NdiStatus {
    match NdiApi::load() {
        Ok(api) => match api.discover_resilient(wait) {
            Ok(sources) => NdiStatus {
                available: true,
                version: api.version_string(),
                runtime_path: Some(api.runtime_path.clone()),
                source_count: sources.len(),
                source_names: sources.into_iter().map(|source| source.name).collect(),
                error: None,
            },
            Err(error) => NdiStatus {
                available: true,
                version: api.version_string(),
                runtime_path: Some(api.runtime_path.clone()),
                source_count: 0,
                source_names: Vec::new(),
                error: Some(error),
            },
        },
        Err(error) => NdiStatus {
            available: false,
            version: None,
            runtime_path: None,
            source_count: 0,
            source_names: Vec::new(),
            error: Some(error),
        },
    }
}

impl NdiApi {
    fn discover_resilient(
        &self,
        requested_wait: Duration,
    ) -> Result<Vec<DiscoveredSource>, String> {
        let _discovery = NDI_DISCOVERY_LOCK
            .lock()
            .map_err(|_| "NDI discovery lock poisoned".to_string())?;
        let cache = NDI_SOURCE_CACHE.get_or_init(|| Mutex::new(CachedSources::default()));
        let cache_is_empty = cache
            .lock()
            .map(|cache| cache.sources.is_empty())
            .unwrap_or(true);
        let wait = if cache_is_empty {
            requested_wait.max(NDI_INITIAL_DISCOVERY_WAIT)
        } else {
            requested_wait
        };
        let discovered = self.discover(wait)?;
        let mut cache = cache
            .lock()
            .map_err(|_| "NDI source cache lock poisoned".to_string())?;
        if !discovered.is_empty() {
            cache.sources = discovered;
            cache.updated_at = Some(Instant::now());
        } else if cache
            .updated_at
            .is_none_or(|updated_at| updated_at.elapsed() >= NDI_EMPTY_DISCOVERY_GRACE)
        {
            cache.sources.clear();
            cache.updated_at = Some(Instant::now());
        }
        Ok(cache.sources.clone())
    }
}

fn source_name_for_device(api: &NdiApi, device_id: &str) -> Result<String, String> {
    api.discover(Duration::from_secs(2))?
        .into_iter()
        .find(|source| source.id == device_id.trim())
        .map(|source| source.name)
        .ok_or_else(|| format!("NDI source is no longer available: {device_id}"))
}

impl NdiInputRuntime {
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        device_id: String,
        left_channel: u16,
        right_channel: u16,
        sender: SyncSender<Vec<u8>>,
        last_error: Arc<Mutex<Option<String>>>,
        level_milli_db: Arc<AtomicI32>,
        captured_frames: Arc<AtomicU64>,
        dropped_chunks: Arc<AtomicU64>,
        dropped_frames: Arc<AtomicU64>,
    ) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let (startup_tx, startup_rx) = sync_channel(1);
        let startup_error_tx = startup_tx.clone();
        let handle = thread::spawn(move || {
            let result = run_ndi_input(
                &device_id,
                left_channel,
                right_channel,
                sender,
                Arc::clone(&last_error),
                level_milli_db,
                captured_frames,
                dropped_chunks,
                dropped_frames,
                thread_stop,
                startup_tx,
            );
            if let Err(error) = result {
                let _ = startup_error_tx.try_send(Err(error.clone()));
                if let Ok(mut current) = last_error.lock() {
                    *current = Some(error);
                }
            }
        });
        match startup_rx.recv_timeout(Duration::from_secs(4)) {
            Ok(Ok(())) => Ok(Self {
                stop,
                thread: Some(handle),
            }),
            Ok(Err(error)) => {
                stop.store(true, Ordering::SeqCst);
                let _ = handle.join();
                Err(error)
            }
            Err(_) => {
                stop.store(true, Ordering::SeqCst);
                let _ = handle.join();
                Err("NDI receiver startup timed out".to_string())
            }
        }
    }
}

impl Drop for NdiInputRuntime {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn run_ndi_input(
    device_id: &str,
    left_channel: u16,
    right_channel: u16,
    sender: SyncSender<Vec<u8>>,
    last_error: Arc<Mutex<Option<String>>>,
    level_milli_db: Arc<AtomicI32>,
    captured_frames: Arc<AtomicU64>,
    dropped_chunks: Arc<AtomicU64>,
    dropped_frames: Arc<AtomicU64>,
    stop: Arc<AtomicBool>,
    startup: SyncSender<Result<(), String>>,
) -> Result<(), String> {
    let api = NdiApi::load()?;
    let source_name = source_name_for_device(&api, device_id)?;
    let source_name =
        CString::new(source_name).map_err(|_| "NDI source name contains NUL".to_string())?;
    let receiver_name = CString::new("Talktome Bridge").unwrap();
    let settings = NdiRecvCreateV3 {
        source: NdiSource {
            ndi_name: source_name.as_ptr(),
            url_address: ptr::null(),
        },
        color_format: NDI_RECV_COLOR_FORMAT_FASTEST,
        bandwidth: NDI_RECV_BANDWIDTH_AUDIO_ONLY,
        allow_video_fields: false,
        receiver_name: receiver_name.as_ptr(),
    };
    let receiver = unsafe { (api.recv_create)(&settings) };
    if receiver.is_null() {
        let error = format!(
            "failed to create NDI receiver for {}",
            source_name.to_string_lossy()
        );
        let _ = startup.send(Err(error.clone()));
        return Err(error);
    }
    let _guard = NdiReceiverGuard {
        api: &api,
        receiver,
    };
    let _ = startup.send(Ok(()));

    while !stop.load(Ordering::SeqCst) {
        let mut frame = NdiAudioFrameV3 {
            sample_rate: 0,
            channels: 0,
            samples: 0,
            timecode: 0,
            fourcc: 0,
            data: ptr::null_mut(),
            channel_stride_bytes: 0,
            metadata: ptr::null(),
            timestamp: 0,
        };
        let frame_type = unsafe {
            (api.recv_capture)(
                receiver,
                ptr::null_mut(),
                &mut frame,
                ptr::null_mut(),
                NDI_CAPTURE_TIMEOUT_MS,
            )
        };
        if frame_type == NDI_FRAME_TYPE_ERROR {
            if let Ok(mut error) = last_error.lock() {
                *error =
                    Some("NDI source connection was lost; waiting for reconnection".to_string());
            }
            continue;
        }
        if frame_type != NDI_FRAME_TYPE_AUDIO {
            continue;
        }
        let copy_result = copy_ndi_audio(
            &frame,
            left_channel,
            right_channel,
            &sender,
            &level_milli_db,
            &captured_frames,
            &dropped_chunks,
            &dropped_frames,
        );
        unsafe { (api.recv_free_audio)(receiver, &frame) };
        match copy_result {
            Ok(()) => {
                if let Ok(mut error) = last_error.lock() {
                    *error = None;
                }
            }
            Err(error) => {
                if let Ok(mut current) = last_error.lock() {
                    *current = Some(error);
                }
            }
        }
    }
    Ok(())
}

struct NdiReceiverGuard<'a> {
    api: &'a NdiApi,
    receiver: NdiInstance,
}

impl Drop for NdiReceiverGuard<'_> {
    fn drop(&mut self) {
        unsafe { (self.api.recv_destroy)(self.receiver) }
    }
}

#[allow(clippy::too_many_arguments)]
fn copy_ndi_audio(
    frame: &NdiAudioFrameV3,
    left_channel: u16,
    right_channel: u16,
    sender: &SyncSender<Vec<u8>>,
    level_milli_db: &AtomicI32,
    captured_frames: &AtomicU64,
    dropped_chunks: &AtomicU64,
    dropped_frames: &AtomicU64,
) -> Result<(), String> {
    if frame.data.is_null() || frame.channels <= 0 || frame.samples <= 0 {
        return Err("NDI delivered an invalid audio frame".to_string());
    }
    if frame.sample_rate != NDI_SAMPLE_RATE {
        return Err(format!(
            "NDI source uses {} Hz; Talktome currently requires 48000 Hz",
            frame.sample_rate
        ));
    }
    if frame.fourcc != NDI_FOURCC_FLTP {
        return Err("NDI source uses an unsupported compressed audio format".to_string());
    }
    let left_index = usize::from(left_channel.saturating_sub(1));
    let right_index = usize::from(right_channel.saturating_sub(1));
    let channels = frame.channels as usize;
    if left_index >= channels || right_index >= channels {
        return Err(format!(
            "NDI source has {channels} channel(s), selected channel is unavailable"
        ));
    }
    let samples = frame.samples as usize;
    let stride = frame.channel_stride_bytes as usize;
    if stride < samples.saturating_mul(std::mem::size_of::<f32>()) {
        return Err("NDI audio frame has an invalid channel stride".to_string());
    }
    let mut bytes = Vec::with_capacity(samples * 8);
    let mut sum_squares = 0.0_f64;
    for sample in 0..samples {
        let left = unsafe {
            (frame.data.add(left_index * stride + sample * 4) as *const f32).read_unaligned()
        };
        let right = unsafe {
            (frame.data.add(right_index * stride + sample * 4) as *const f32).read_unaligned()
        };
        sum_squares += f64::from(left * left + right * right);
        bytes.extend_from_slice(&left.to_le_bytes());
        bytes.extend_from_slice(&right.to_le_bytes());
    }
    level_milli_db.store(rms_milli_db(sum_squares, samples * 2), Ordering::Relaxed);
    captured_frames.fetch_add(samples as u64, Ordering::Relaxed);
    if let Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) = sender.try_send(bytes) {
        dropped_chunks.fetch_add(1, Ordering::Relaxed);
        dropped_frames.fetch_add(samples as u64, Ordering::Relaxed);
    }
    Ok(())
}

impl NdiOutputRuntime {
    pub fn start(
        device_id: String,
        sources: Arc<Mutex<std::collections::HashMap<String, BridgeOutputMixerSource>>>,
        last_error: Arc<Mutex<Option<String>>>,
    ) -> Result<Self, String> {
        let source_name = output_source_name(&device_id)?;
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let (startup_tx, startup_rx) = sync_channel(1);
        let startup_error_tx = startup_tx.clone();
        let handle = thread::spawn(move || {
            let result = run_ndi_output(&source_name, sources, thread_stop, startup_tx);
            if let Err(error) = result {
                let _ = startup_error_tx.try_send(Err(error.clone()));
                if let Ok(mut current) = last_error.lock() {
                    *current = Some(error);
                }
            }
        });
        match startup_rx.recv_timeout(Duration::from_secs(4)) {
            Ok(Ok(())) => Ok(Self {
                stop,
                thread: Some(handle),
            }),
            Ok(Err(error)) => {
                stop.store(true, Ordering::SeqCst);
                let _ = handle.join();
                Err(error)
            }
            Err(_) => {
                stop.store(true, Ordering::SeqCst);
                let _ = handle.join();
                Err("NDI sender startup timed out".to_string())
            }
        }
    }
}

impl Drop for NdiOutputRuntime {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

fn run_ndi_output(
    source_name: &str,
    sources: Arc<Mutex<std::collections::HashMap<String, BridgeOutputMixerSource>>>,
    stop: Arc<AtomicBool>,
    startup: SyncSender<Result<(), String>>,
) -> Result<(), String> {
    let api = NdiApi::load()?;
    let source_name =
        CString::new(source_name).map_err(|_| "NDI output name contains NUL".to_string())?;
    let settings = NdiSendCreate {
        ndi_name: source_name.as_ptr(),
        groups: ptr::null(),
        clock_video: false,
        clock_audio: true,
    };
    let sender = unsafe { (api.send_create)(&settings) };
    if sender.is_null() {
        let error = format!(
            "failed to create NDI sender {}",
            source_name.to_string_lossy()
        );
        let _ = startup.send(Err(error.clone()));
        return Err(error);
    }
    let _guard = NdiSenderGuard { api: &api, sender };
    let actual_source = unsafe { (api.send_source_name)(sender) };
    if actual_source.is_null() {
        let error = "NDI sender did not publish a source name".to_string();
        let _ = startup.send(Err(error.clone()));
        return Err(error);
    }
    eprintln!(
        "[ndi] published source {}",
        c_string(unsafe { (*actual_source).ndi_name })
            .unwrap_or_else(|| source_name.to_string_lossy().into_owned())
    );
    let _ = startup.send(Ok(()));
    while !stop.load(Ordering::SeqCst) {
        let mut planar = vec![0.0_f32; NDI_SEND_FRAMES * 2];
        let active_sources = sources
            .lock()
            .map(|sources| {
                sources
                    .values()
                    .map(|source| BridgeOutputMixerSource {
                        queue: Arc::clone(&source.queue),
                        level: Arc::clone(&source.level),
                        left_channel: source.left_channel,
                        right_channel: source.right_channel,
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for sample in 0..NDI_SEND_FRAMES {
            let mut output = [0.0_f32; 2];
            for source in &active_sources {
                let level = source
                    .level
                    .lock()
                    .map(|level| *level)
                    .unwrap_or(BridgeOutputLevel {
                        volume: 1.0,
                        muted: false,
                    });
                if level.muted || level.volume <= 0.0 {
                    continue;
                }
                if let Ok(mut queue) = source.queue.lock() {
                    if let Some(value) = queue.pop_front() {
                        let left_index = usize::from(source.left_channel.saturating_sub(1));
                        let right_index = usize::from(source.right_channel.saturating_sub(1));
                        if left_index == right_index && left_index < output.len() {
                            output[left_index] += ((value.left + value.right) * 0.5) * level.volume;
                        } else {
                            if left_index < output.len() {
                                output[left_index] += value.left * level.volume;
                            }
                            if right_index < output.len() {
                                output[right_index] += value.right * level.volume;
                            }
                        }
                    }
                }
            }
            planar[sample] = output[0].clamp(-1.0, 1.0);
            planar[NDI_SEND_FRAMES + sample] = output[1].clamp(-1.0, 1.0);
        }
        let frame = NdiAudioFrameV3 {
            sample_rate: NDI_SAMPLE_RATE,
            channels: 2,
            samples: NDI_SEND_FRAMES as i32,
            timecode: NDI_TIMECODE_SYNTHESIZE,
            fourcc: NDI_FOURCC_FLTP,
            data: planar.as_mut_ptr().cast::<u8>(),
            channel_stride_bytes: (NDI_SEND_FRAMES * 4) as i32,
            metadata: ptr::null(),
            timestamp: 0,
        };
        unsafe { (api.send_audio)(sender, &frame) };
    }
    Ok(())
}

struct NdiSenderGuard<'a> {
    api: &'a NdiApi,
    sender: NdiInstance,
}

impl Drop for NdiSenderGuard<'_> {
    fn drop(&mut self) {
        unsafe { (self.api.send_destroy)(self.sender) }
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
    ((20.0 * rms.log10()).clamp(-120.0, 0.0) * 1000.0).round() as i32
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn source_ids_are_stable_and_distinct() {
        assert_eq!(
            input_device_id("HOST (Source)"),
            input_device_id("HOST (Source)")
        );
        assert_ne!(
            input_device_id("HOST (Source)"),
            input_device_id("HOST (Other)")
        );
        assert!(is_input_device(&input_device_id("HOST (Source)")));
    }

    #[test]
    fn output_slot_names_are_validated() {
        assert_eq!(
            output_source_name("ndi:send:1").unwrap(),
            "Talktome Bridge 1"
        );
        assert!(output_source_name("ndi:send:0").is_err());
        assert!(output_source_name("ndi:send:9").is_err());
    }

    #[test]
    fn input_channel_pairs_cover_32_channels() {
        let pairs = channel_pairs(NDI_INPUT_MAX_CHANNELS);

        assert_eq!(pairs.len(), 48);
        assert!(pairs.iter().any(|pair| {
            pair.label == "32" && pair.left_channel == 32 && pair.right_channel == 32
        }));
        assert!(pairs.iter().any(|pair| {
            pair.label == "31/32" && pair.left_channel == 31 && pair.right_channel == 32
        }));
    }

    #[test]
    fn detected_input_channel_count_is_validated_and_capped() {
        assert_eq!(normalized_input_channel_count(0), None);
        assert_eq!(normalized_input_channel_count(-1), None);
        assert_eq!(normalized_input_channel_count(2), Some(2));
        assert_eq!(normalized_input_channel_count(8), Some(8));
        assert_eq!(normalized_input_channel_count(64), Some(32));
    }

    #[test]
    fn windows_runtime_fallbacks_include_ndi_tools() {
        let program_files = Path::new("Program Files");
        let library_name = "Processing.NDI.Lib.x64.dll";
        let mut candidates = Vec::new();

        push_windows_runtime_directories(&mut candidates, program_files, &[library_name]);

        assert_eq!(
            candidates[1],
            program_files
                .join("NDI\\NDI 6 Tools\\Runtime")
                .join(library_name)
        );
    }

    #[test]
    fn installed_runtime_can_be_queried_if_present() {
        let Ok(api) = NdiApi::load() else {
            return;
        };
        assert!(!api.version_string().unwrap_or_default().is_empty());
        api.discover(Duration::from_millis(20)).unwrap();
    }

    #[test]
    #[ignore = "requires an installed NDI Runtime and local NDI networking"]
    fn ndi_audio_loopback() {
        use std::collections::HashMap;

        if NdiApi::load().is_err() {
            return;
        }
        let output_sources =
            Arc::new(Mutex::new(HashMap::<String, BridgeOutputMixerSource>::new()));
        let output_error = Arc::new(Mutex::new(None));
        let output = NdiOutputRuntime::start(
            "ndi:send:8".to_string(),
            output_sources,
            Arc::clone(&output_error),
        )
        .unwrap();
        thread::sleep(Duration::from_millis(750));
        run_external_audio_probe("Talktome Bridge 8");
        drop(output);
        assert!(output_error.lock().unwrap().is_none());
    }

    #[test]
    #[ignore = "helper for the cross-process NDI audio test"]
    fn ndi_external_audio_probe() {
        use std::sync::mpsc::RecvTimeoutError;

        let Ok(expected_name) = std::env::var("TALKTOME_NDI_TEST_SOURCE") else {
            return;
        };
        let api = NdiApi::load().expect("NDI Runtime is unavailable in external probe");
        let deadline = Instant::now() + Duration::from_secs(6);
        let source = loop {
            if let Some(source) = api
                .discover(Duration::from_millis(500))
                .unwrap()
                .into_iter()
                .find(|source| source.name.contains(&expected_name))
            {
                break source;
            }
            assert!(
                Instant::now() < deadline,
                "NDI sender was not externally discoverable"
            );
        };
        let (audio_tx, audio_rx) = sync_channel(8);
        let input = NdiInputRuntime::start(
            source.id,
            1,
            2,
            audio_tx,
            Arc::new(Mutex::new(None)),
            Arc::new(AtomicI32::new(-120_000)),
            Arc::new(AtomicU64::new(0)),
            Arc::new(AtomicU64::new(0)),
            Arc::new(AtomicU64::new(0)),
        )
        .unwrap();
        match audio_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(bytes) => assert!(!bytes.is_empty()),
            Err(RecvTimeoutError::Timeout) => panic!("no NDI audio arrived during loopback"),
            Err(RecvTimeoutError::Disconnected) => panic!("NDI input stopped during loopback"),
        }
        drop(input);
    }

    pub(crate) fn run_external_audio_probe(source_name: &str) {
        let executable = std::env::current_exe().expect("resolve current NDI test executable");
        let output = std::process::Command::new(executable)
            .args([
                "--ignored",
                "--exact",
                "ndi::tests::ndi_external_audio_probe",
                "--nocapture",
            ])
            .env("TALKTOME_NDI_TEST_SOURCE", source_name)
            .output()
            .expect("start external NDI audio probe");
        assert!(
            output.status.success(),
            "external NDI audio probe failed:\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
