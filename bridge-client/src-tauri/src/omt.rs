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

const OMT_INPUT_PREFIX: &str = "omt:recv:";
const OMT_OUTPUT_PREFIX: &str = "omt:send:";
const OMT_OUTPUT_SLOTS: usize = 8;
const OMT_SAMPLE_RATE: i32 = 48_000;
const OMT_SEND_FRAMES: usize = 480;
const OMT_FRAME_TYPE_AUDIO: i32 = 4;
const OMT_CODEC_FPA1: i32 = i32::from_le_bytes(*b"FPA1");
const OMT_RECEIVE_TIMEOUT_MS: i32 = 100;
const OMT_INITIAL_DISCOVERY_WAIT: Duration = Duration::from_secs(2);
const OMT_EMPTY_DISCOVERY_GRACE: Duration = Duration::from_secs(10);

static OMT_API: OnceLock<Arc<OmtApi>> = OnceLock::new();
static OMT_API_LOAD_LOCK: Mutex<()> = Mutex::new(());
static OMT_DISCOVERY_LOCK: Mutex<()> = Mutex::new(());
static OMT_SOURCE_CACHE: OnceLock<Mutex<CachedSources>> = OnceLock::new();

type OmtInstance = *mut c_void;

#[repr(C)]
#[derive(Clone, Copy)]
struct OmtMediaFrame {
    frame_type: i32,
    timestamp: i64,
    codec: i32,
    width: i32,
    height: i32,
    stride: i32,
    flags: i32,
    frame_rate_n: i32,
    frame_rate_d: i32,
    aspect_ratio: f32,
    color_space: i32,
    sample_rate: i32,
    channels: i32,
    samples_per_channel: i32,
    data: *mut c_void,
    data_length: i32,
    compressed_data: *mut c_void,
    compressed_length: i32,
    frame_metadata: *mut c_void,
    frame_metadata_length: i32,
}

type DiscoveryGetAddressesFn = unsafe extern "C" fn(*mut i32) -> *mut *mut c_char;
type ReceiveCreateFn = unsafe extern "C" fn(*const c_char, i32, i32, i32) -> OmtInstance;
type ReceiveDestroyFn = unsafe extern "C" fn(OmtInstance);
type ReceiveFn = unsafe extern "C" fn(OmtInstance, i32, i32) -> *mut OmtMediaFrame;
type SendCreateFn = unsafe extern "C" fn(*const c_char, i32) -> OmtInstance;
type SendDestroyFn = unsafe extern "C" fn(OmtInstance);
type SendFn = unsafe extern "C" fn(OmtInstance, *mut OmtMediaFrame) -> i32;
type SendGetAddressFn = unsafe extern "C" fn(OmtInstance, *mut c_char, i32) -> i32;
type SetLoggingFilenameFn = unsafe extern "C" fn(*const c_char);

struct OmtApi {
    _library: Library,
    runtime_path: String,
    version: Option<String>,
    discovery_get_addresses: DiscoveryGetAddressesFn,
    receive_create: ReceiveCreateFn,
    receive_destroy: ReceiveDestroyFn,
    receive: ReceiveFn,
    send_create: SendCreateFn,
    send_destroy: SendDestroyFn,
    send: SendFn,
    send_get_address: SendGetAddressFn,
}

#[derive(Debug, Clone)]
struct DiscoveredSource {
    id: String,
    address: String,
}

#[derive(Default)]
struct CachedSources {
    sources: Vec<DiscoveredSource>,
    updated_at: Option<Instant>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OmtStatus {
    pub available: bool,
    pub version: Option<String>,
    pub runtime_path: Option<String>,
    pub source_count: usize,
    pub source_names: Vec<String>,
    pub error: Option<String>,
}

pub struct OmtInputRuntime {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

pub struct OmtOutputRuntime {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl OmtApi {
    fn load() -> Result<Self, String> {
        let (library, runtime_path) = load_runtime_library()?;
        let version = runtime_manifest_version(&runtime_path);
        unsafe {
            let set_logging_filename =
                load_symbol::<SetLoggingFilenameFn>(&library, b"omt_setloggingfilename\0")?;
            set_logging_filename(ptr::null());
            Ok(Self {
                discovery_get_addresses: load_symbol(&library, b"omt_discovery_getaddresses\0")?,
                receive_create: load_symbol(&library, b"omt_receive_create\0")?,
                receive_destroy: load_symbol(&library, b"omt_receive_destroy\0")?,
                receive: load_symbol(&library, b"omt_receive\0")?,
                send_create: load_symbol(&library, b"omt_send_create\0")?,
                send_destroy: load_symbol(&library, b"omt_send_destroy\0")?,
                send: load_symbol(&library, b"omt_send\0")?,
                send_get_address: load_symbol(&library, b"omt_send_getaddress\0")?,
                _library: library,
                runtime_path,
                version,
            })
        }
    }

    fn discover_once(&self) -> Result<Vec<DiscoveredSource>, String> {
        let mut count = 0_i32;
        let addresses = unsafe { (self.discovery_get_addresses)(&mut count) };
        if addresses.is_null() || count <= 0 {
            return Ok(Vec::new());
        }
        let mut seen = HashSet::new();
        let mut sources = unsafe { std::slice::from_raw_parts(addresses, count as usize) }
            .iter()
            .filter_map(|address| c_string(*address))
            .filter(|address| !address.trim().is_empty())
            .filter_map(|address| {
                let id = input_device_id(&address);
                seen.insert(id.clone())
                    .then_some(DiscoveredSource { id, address })
            })
            .collect::<Vec<_>>();
        sources.sort_by_key(|source| source.address.to_lowercase());
        Ok(sources)
    }

    fn discover(&self, wait: Duration) -> Result<Vec<DiscoveredSource>, String> {
        let deadline = Instant::now() + wait;
        loop {
            let sources = self.discover_once()?;
            if !sources.is_empty() || wait.is_zero() || Instant::now() >= deadline {
                return Ok(sources);
            }
            thread::sleep(
                Duration::from_millis(100).min(deadline.saturating_duration_since(Instant::now())),
            );
        }
    }

    fn discover_resilient(
        &self,
        requested_wait: Duration,
    ) -> Result<Vec<DiscoveredSource>, String> {
        let _discovery = OMT_DISCOVERY_LOCK
            .lock()
            .map_err(|_| "OMT discovery lock poisoned".to_string())?;
        let cache = OMT_SOURCE_CACHE.get_or_init(|| Mutex::new(CachedSources::default()));
        let cache_is_empty = cache
            .lock()
            .map(|cache| cache.sources.is_empty())
            .unwrap_or(true);
        let wait = if cache_is_empty {
            requested_wait.max(OMT_INITIAL_DISCOVERY_WAIT)
        } else {
            requested_wait
        };
        let discovered = self.discover(wait)?;
        let mut cache = cache
            .lock()
            .map_err(|_| "OMT source cache lock poisoned".to_string())?;
        if !discovered.is_empty() {
            cache.sources = discovered;
            cache.updated_at = Some(Instant::now());
        } else if cache
            .updated_at
            .is_none_or(|updated_at| updated_at.elapsed() >= OMT_EMPTY_DISCOVERY_GRACE)
        {
            cache.sources.clear();
            cache.updated_at = Some(Instant::now());
        }
        Ok(cache.sources.clone())
    }
}

fn load_api() -> Result<Arc<OmtApi>, String> {
    if let Some(api) = OMT_API.get() {
        return Ok(Arc::clone(api));
    }
    let _load = OMT_API_LOAD_LOCK
        .lock()
        .map_err(|_| "OMT runtime load lock poisoned".to_string())?;
    if let Some(api) = OMT_API.get() {
        return Ok(Arc::clone(api));
    }
    let api = Arc::new(OmtApi::load()?);
    let _ = OMT_API.set(Arc::clone(&api));
    Ok(api)
}

unsafe fn load_symbol<T: Copy>(library: &Library, name: &[u8]) -> Result<T, String> {
    library.get::<T>(name).map(|symbol| *symbol).map_err(|err| {
        format!(
            "OMT backend is missing {}: {err}",
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
        "Bundled OMT backend not found. Reinstall the Bridge or set TALKTOME_OMT_RUNTIME. Tried: {}",
        errors.join("; ")
    ))
}

fn runtime_candidates() -> Vec<PathBuf> {
    let names = runtime_library_names();
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("TALKTOME_OMT_RUNTIME") {
        push_runtime_path(&mut candidates, PathBuf::from(path), names);
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            for candidate in [
                directory.to_path_buf(),
                directory.join("omt"),
                directory.join("resources").join("omt"),
                directory.join("binaries").join("omt"),
            ] {
                push_runtime_directory(&mut candidates, &candidate, names);
            }
            if let Some(contents) = directory.parent() {
                push_runtime_directory(
                    &mut candidates,
                    &contents.join("Resources").join("omt"),
                    names,
                );
            }
        }
    }
    if let Ok(current_dir) = std::env::current_dir() {
        push_runtime_directory(
            &mut candidates,
            &current_dir.join("resources").join("omt"),
            names,
        );
        push_runtime_directory(
            &mut candidates,
            &current_dir.join("src-tauri").join("resources").join("omt"),
            names,
        );
        push_runtime_directory(
            &mut candidates,
            &current_dir
                .join("bridge-client")
                .join("src-tauri")
                .join("resources")
                .join("omt"),
            names,
        );
    }
    for name in names {
        candidates.push(PathBuf::from(name));
    }
    let mut seen = HashSet::new();
    candidates.retain(|candidate| seen.insert(candidate.clone()));
    candidates
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
        &["libomt.dylib"]
    }
    #[cfg(target_os = "linux")]
    {
        &["libomt.so"]
    }
    #[cfg(windows)]
    {
        &["libomt.dll"]
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        &[]
    }
}

fn runtime_manifest_version(runtime_path: &str) -> Option<String> {
    let manifest_path = Path::new(runtime_path).parent()?.join("runtime.json");
    let manifest = std::fs::read_to_string(manifest_path).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&manifest).ok()?;
    value
        .get("version")
        .and_then(serde_json::Value::as_str)
        .map(|version| format!("OMT {version}"))
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

fn input_device_id(address: &str) -> String {
    format!("{OMT_INPUT_PREFIX}{:016x}", stable_hash(address))
}

pub fn is_input_device(device_id: &str) -> bool {
    device_id.trim().starts_with(OMT_INPUT_PREFIX)
}

pub fn is_output_device(device_id: &str) -> bool {
    device_id.trim().starts_with(OMT_OUTPUT_PREFIX)
}

fn output_source_name(device_id: &str) -> Result<String, String> {
    let slot = device_id
        .trim()
        .strip_prefix(OMT_OUTPUT_PREFIX)
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|slot| (1..=OMT_OUTPUT_SLOTS).contains(slot))
        .ok_or_else(|| format!("invalid OMT output device: {device_id}"))?;
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
            sample_format: "F32 planar (OMT)".to_string(),
            min_buffer_size: None,
            max_buffer_size: None,
        }],
        channel_pairs: channel_pairs(max_channels),
    }
}

pub fn audio_devices(wait: Duration) -> Vec<AudioDeviceInfo> {
    let Ok(api) = load_api() else {
        return Vec::new();
    };
    let mut devices = api
        .discover_resilient(wait)
        .unwrap_or_default()
        .into_iter()
        .map(|source| {
            virtual_device(
                source.id,
                format!("OMT network input · {}", source.address),
                "input",
                32,
            )
        })
        .collect::<Vec<_>>();
    devices.extend((1..=OMT_OUTPUT_SLOTS).map(|slot| {
        virtual_device(
            format!("{OMT_OUTPUT_PREFIX}{slot}"),
            format!("OMT network output · Talktome Bridge {slot}"),
            "output",
            2,
        )
    }));
    devices
}

pub fn status(wait: Duration) -> OmtStatus {
    match load_api() {
        Ok(api) => match api.discover_resilient(wait) {
            Ok(sources) => OmtStatus {
                available: true,
                version: api
                    .version
                    .clone()
                    .or_else(|| Some("OMT backend".to_string())),
                runtime_path: Some(api.runtime_path.clone()),
                source_count: sources.len(),
                source_names: sources.into_iter().map(|source| source.address).collect(),
                error: None,
            },
            Err(error) => OmtStatus {
                available: true,
                version: api
                    .version
                    .clone()
                    .or_else(|| Some("OMT backend".to_string())),
                runtime_path: Some(api.runtime_path.clone()),
                source_count: 0,
                source_names: Vec::new(),
                error: Some(error),
            },
        },
        Err(error) => OmtStatus {
            available: false,
            version: None,
            runtime_path: None,
            source_count: 0,
            source_names: Vec::new(),
            error: Some(error),
        },
    }
}

fn source_address_for_device(api: &OmtApi, device_id: &str) -> Result<String, String> {
    api.discover_resilient(Duration::from_secs(2))?
        .into_iter()
        .find(|source| source.id == device_id.trim())
        .map(|source| source.address)
        .ok_or_else(|| format!("OMT source is no longer available: {device_id}"))
}

impl OmtInputRuntime {
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
            let result = run_omt_input(
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
        match startup_rx.recv_timeout(Duration::from_secs(5)) {
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
                Err("OMT receiver startup timed out".to_string())
            }
        }
    }
}

impl Drop for OmtInputRuntime {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn run_omt_input(
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
    let api = load_api()?;
    let address = source_address_for_device(&api, device_id)?;
    let address =
        CString::new(address).map_err(|_| "OMT source address contains NUL".to_string())?;
    let receiver = unsafe { (api.receive_create)(address.as_ptr(), OMT_FRAME_TYPE_AUDIO, 0, 0) };
    if receiver.is_null() {
        let error = format!(
            "failed to create OMT receiver for {}",
            address.to_string_lossy()
        );
        let _ = startup.send(Err(error.clone()));
        return Err(error);
    }
    let _guard = OmtReceiverGuard {
        api: Arc::clone(&api),
        receiver,
    };
    let _ = startup.send(Ok(()));

    while !stop.load(Ordering::SeqCst) {
        let frame =
            unsafe { (api.receive)(receiver, OMT_FRAME_TYPE_AUDIO, OMT_RECEIVE_TIMEOUT_MS) };
        if frame.is_null() {
            continue;
        }
        let frame = unsafe { &*frame };
        if frame.frame_type != OMT_FRAME_TYPE_AUDIO {
            continue;
        }
        match copy_omt_audio(
            frame,
            left_channel,
            right_channel,
            &sender,
            &level_milli_db,
            &captured_frames,
            &dropped_chunks,
            &dropped_frames,
        ) {
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

struct OmtReceiverGuard {
    api: Arc<OmtApi>,
    receiver: OmtInstance,
}

impl Drop for OmtReceiverGuard {
    fn drop(&mut self) {
        unsafe { (self.api.receive_destroy)(self.receiver) }
    }
}

#[allow(clippy::too_many_arguments)]
fn copy_omt_audio(
    frame: &OmtMediaFrame,
    left_channel: u16,
    right_channel: u16,
    sender: &SyncSender<Vec<u8>>,
    level_milli_db: &AtomicI32,
    captured_frames: &AtomicU64,
    dropped_chunks: &AtomicU64,
    dropped_frames: &AtomicU64,
) -> Result<(), String> {
    if frame.data.is_null() || frame.channels <= 0 || frame.samples_per_channel <= 0 {
        return Err("OMT delivered an invalid audio frame".to_string());
    }
    if frame.sample_rate != OMT_SAMPLE_RATE {
        return Err(format!(
            "OMT source uses {} Hz; Talktome currently requires 48000 Hz",
            frame.sample_rate
        ));
    }
    if frame.codec != OMT_CODEC_FPA1 {
        return Err("OMT source uses an unsupported audio format".to_string());
    }
    let left_index = usize::from(left_channel.saturating_sub(1));
    let right_index = usize::from(right_channel.saturating_sub(1));
    let channels = frame.channels as usize;
    if left_index >= channels || right_index >= channels {
        return Err(format!(
            "OMT source has {channels} channel(s), selected channel is unavailable"
        ));
    }
    let samples = frame.samples_per_channel as usize;
    let plane_bytes = samples.saturating_mul(std::mem::size_of::<f32>());
    let required_bytes = plane_bytes.saturating_mul(channels);
    if frame.data_length < 0 || (frame.data_length as usize) < required_bytes {
        return Err("OMT audio frame has an invalid data length".to_string());
    }
    let data = frame.data.cast::<u8>();
    let mut bytes = Vec::with_capacity(samples * 8);
    let mut sum_squares = 0.0_f64;
    for sample in 0..samples {
        let left = unsafe {
            (data.add(left_index * plane_bytes + sample * 4) as *const f32).read_unaligned()
        };
        let right = unsafe {
            (data.add(right_index * plane_bytes + sample * 4) as *const f32).read_unaligned()
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

impl OmtOutputRuntime {
    pub fn start(
        device_id: String,
        sources: Arc<Mutex<HashMap<String, BridgeOutputMixerSource>>>,
        last_error: Arc<Mutex<Option<String>>>,
    ) -> Result<Self, String> {
        let source_name = output_source_name(&device_id)?;
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let (startup_tx, startup_rx) = sync_channel(1);
        let startup_error_tx = startup_tx.clone();
        let handle = thread::spawn(move || {
            let result = run_omt_output(&source_name, sources, thread_stop, startup_tx);
            if let Err(error) = result {
                let _ = startup_error_tx.try_send(Err(error.clone()));
                if let Ok(mut current) = last_error.lock() {
                    *current = Some(error);
                }
            }
        });
        match startup_rx.recv_timeout(Duration::from_secs(5)) {
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
                Err("OMT sender startup timed out".to_string())
            }
        }
    }
}

impl Drop for OmtOutputRuntime {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

fn run_omt_output(
    source_name: &str,
    sources: Arc<Mutex<HashMap<String, BridgeOutputMixerSource>>>,
    stop: Arc<AtomicBool>,
    startup: SyncSender<Result<(), String>>,
) -> Result<(), String> {
    let api = load_api()?;
    let source_name =
        CString::new(source_name).map_err(|_| "OMT output name contains NUL".to_string())?;
    let sender = unsafe { (api.send_create)(source_name.as_ptr(), 0) };
    if sender.is_null() {
        let error = format!(
            "failed to create OMT sender {}",
            source_name.to_string_lossy()
        );
        let _ = startup.send(Err(error.clone()));
        return Err(error);
    }
    let _guard = OmtSenderGuard {
        api: Arc::clone(&api),
        sender,
    };
    let mut published_address = [0_i8; 1024];
    let address_length = unsafe {
        (api.send_get_address)(
            sender,
            published_address.as_mut_ptr(),
            published_address.len() as i32,
        )
    };
    if address_length <= 0 {
        let error = "OMT sender did not publish a source address".to_string();
        let _ = startup.send(Err(error.clone()));
        return Err(error);
    }
    eprintln!(
        "[omt] published source {}",
        c_string(published_address.as_ptr())
            .unwrap_or_else(|| source_name.to_string_lossy().into_owned())
    );
    let _ = startup.send(Ok(()));

    while !stop.load(Ordering::SeqCst) {
        let mut planar = mix_output_frame(&sources, OMT_SEND_FRAMES);
        let mut frame = OmtMediaFrame {
            frame_type: OMT_FRAME_TYPE_AUDIO,
            timestamp: -1,
            codec: OMT_CODEC_FPA1,
            width: 0,
            height: 0,
            stride: 0,
            flags: 0,
            frame_rate_n: 0,
            frame_rate_d: 0,
            aspect_ratio: 0.0,
            color_space: 0,
            sample_rate: OMT_SAMPLE_RATE,
            channels: 2,
            samples_per_channel: OMT_SEND_FRAMES as i32,
            data: planar.as_mut_ptr().cast::<c_void>(),
            data_length: (planar.len() * std::mem::size_of::<f32>()) as i32,
            compressed_data: ptr::null_mut(),
            compressed_length: 0,
            frame_metadata: ptr::null_mut(),
            frame_metadata_length: 0,
        };
        let result = unsafe { (api.send)(sender, &mut frame) };
        if result < 0 {
            return Err("OMT sender rejected an audio frame".to_string());
        }
    }
    Ok(())
}

struct OmtSenderGuard {
    api: Arc<OmtApi>,
    sender: OmtInstance,
}

impl Drop for OmtSenderGuard {
    fn drop(&mut self) {
        unsafe { (self.api.send_destroy)(self.sender) }
    }
}

fn mix_output_frame(
    sources: &Arc<Mutex<HashMap<String, BridgeOutputMixerSource>>>,
    frames: usize,
) -> Vec<f32> {
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
    let mut planar = vec![0.0_f32; frames * 2];
    for sample in 0..frames {
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
        planar[frames + sample] = output[1].clamp(-1.0, 1.0);
    }
    planar
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
            output_source_name("omt:send:1").unwrap(),
            "Talktome Bridge 1"
        );
        assert!(output_source_name("omt:send:0").is_err());
        assert!(output_source_name("omt:send:9").is_err());
    }

    #[test]
    fn media_frame_matches_the_64_bit_c_abi_size() {
        assert_eq!(std::mem::size_of::<OmtMediaFrame>(), 112);
        assert_eq!(std::mem::offset_of!(OmtMediaFrame, data), 64);
        assert_eq!(std::mem::offset_of!(OmtMediaFrame, data_length), 72);
        assert_eq!(std::mem::offset_of!(OmtMediaFrame, compressed_data), 80);
        assert_eq!(std::mem::offset_of!(OmtMediaFrame, frame_metadata), 96);
    }

    #[test]
    fn bundled_runtime_can_be_queried_if_present() {
        let Ok(api) = load_api() else {
            return;
        };
        assert!(!api.runtime_path.is_empty());
        api.discover_resilient(Duration::from_millis(20)).unwrap();
    }

    #[test]
    #[ignore = "requires the bundled OMT runtime and local OMT networking"]
    fn omt_audio_loopback() {
        use std::collections::VecDeque;

        if load_api().is_err() {
            return;
        }
        let signal = (0..OMT_SAMPLE_RATE as usize * 10)
            .map(|_| crate::bridge_media::StereoFrame {
                left: 0.25,
                right: -0.25,
            })
            .collect::<VecDeque<_>>();
        let output_sources = Arc::new(Mutex::new(HashMap::from([(
            "test-signal".to_string(),
            BridgeOutputMixerSource {
                queue: Arc::new(Mutex::new(signal)),
                level: Arc::new(Mutex::new(BridgeOutputLevel {
                    volume: 1.0,
                    muted: false,
                })),
                left_channel: 1,
                right_channel: 2,
            },
        )])));
        let output_error = Arc::new(Mutex::new(None));
        let output = OmtOutputRuntime::start(
            "omt:send:8".to_string(),
            output_sources,
            Arc::clone(&output_error),
        )
        .unwrap();
        thread::sleep(Duration::from_millis(750));
        run_external_audio_probe("Talktome Bridge 8", true);
        drop(output);
        assert!(output_error.lock().unwrap().is_none());
    }

    #[test]
    #[ignore = "helper for the cross-process OMT audio test"]
    fn omt_external_audio_probe() {
        use std::sync::mpsc::RecvTimeoutError;

        let Ok(expected_name) = std::env::var("TALKTOME_OMT_TEST_SOURCE") else {
            return;
        };
        let require_signal =
            std::env::var("TALKTOME_OMT_TEST_REQUIRE_SIGNAL").is_ok_and(|value| value == "1");
        let api = load_api().expect("OMT backend is unavailable in external probe");
        let deadline = Instant::now() + Duration::from_secs(8);
        let source = loop {
            if let Some(source) = api
                .discover_resilient(Duration::from_millis(500))
                .unwrap()
                .into_iter()
                .find(|source| source.address.contains(&expected_name))
            {
                break source;
            }
            assert!(
                Instant::now() < deadline,
                "OMT sender was not externally discoverable"
            );
        };
        let (audio_tx, audio_rx) = sync_channel(8);
        let input = OmtInputRuntime::start(
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
            Ok(bytes) => {
                assert!(!bytes.is_empty());
                let samples = bytes
                    .chunks_exact(4)
                    .map(|sample| f32::from_le_bytes(sample.try_into().unwrap()))
                    .collect::<Vec<_>>();
                if require_signal {
                    assert!(samples.iter().any(|sample| sample.abs() >= 0.2));
                }
            }
            Err(RecvTimeoutError::Timeout) => panic!("no OMT audio arrived during loopback"),
            Err(RecvTimeoutError::Disconnected) => panic!("OMT input stopped during loopback"),
        }
        drop(input);
    }

    pub(crate) fn run_external_audio_probe(source_name: &str, require_signal: bool) {
        let executable = std::env::current_exe().expect("resolve current OMT test executable");
        let output = std::process::Command::new(executable)
            .args([
                "--ignored",
                "--exact",
                "omt::tests::omt_external_audio_probe",
                "--nocapture",
            ])
            .env("TALKTOME_OMT_TEST_SOURCE", source_name)
            .env(
                "TALKTOME_OMT_TEST_REQUIRE_SIGNAL",
                if require_signal { "1" } else { "0" },
            )
            .output()
            .expect("start external OMT audio probe");
        assert!(
            output.status.success(),
            "external OMT audio probe failed:\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
