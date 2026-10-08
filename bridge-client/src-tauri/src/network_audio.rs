use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering},
    mpsc::{self, SyncSender},
    Arc, Mutex,
};
use std::thread;
use std::time::{Duration, Instant};

use crate::audio::{AudioDeviceInfo, AudioDeviceSnapshotEntry};
use crate::bridge_media::BridgeOutputMixerSource;
use crate::{ndi, omt};

#[allow(dead_code)]
pub enum NetworkAudioInputRuntime {
    Ndi(ndi::NdiInputRuntime),
    Omt(omt::OmtInputRuntime),
}

#[allow(dead_code)]
pub enum NetworkAudioOutputRuntime {
    Ndi(ndi::NdiOutputRuntime),
    Omt(omt::OmtOutputRuntime),
}

pub struct InputStartRequest {
    pub device_id: String,
    pub left_channel: u16,
    pub right_channel: u16,
    pub sender: SyncSender<Vec<u8>>,
    pub last_error: Arc<Mutex<Option<String>>>,
    pub level_milli_db: Arc<AtomicI32>,
    pub captured_frames: Arc<AtomicU64>,
    pub dropped_chunks: Arc<AtomicU64>,
    pub dropped_frames: Arc<AtomicU64>,
}

pub struct NetworkAudioScan {
    pub devices: Vec<AudioDeviceInfo>,
    pub warnings: Vec<String>,
}

const BACKEND_PROBE_TIMEOUT: Duration = Duration::from_secs(4);

struct BackendState {
    busy: AtomicBool,
    devices: Mutex<Vec<AudioDeviceInfo>>,
}

impl BackendState {
    const fn new() -> Self {
        Self {
            busy: AtomicBool::new(false),
            devices: Mutex::new(Vec::new()),
        }
    }

    fn begin(&'static self) -> Option<BackendQueryGuard> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| BackendQueryGuard(self))
    }

    fn cached_devices(&self) -> Vec<AudioDeviceInfo> {
        self.devices
            .lock()
            .map(|devices| devices.clone())
            .unwrap_or_default()
    }
}

struct BackendQueryGuard(&'static BackendState);

impl Drop for BackendQueryGuard {
    fn drop(&mut self) {
        self.0.busy.store(false, Ordering::Release);
    }
}

// Never overlap a native query with an unfinished worker. A timed-out worker
// remains detached, but completion releases the backend so Refresh can recover.
static NDI_BACKEND: BackendState = BackendState::new();
static OMT_BACKEND: BackendState = BackendState::new();

pub fn audio_devices(wait: Duration) -> NetworkAudioScan {
    scan_devices(wait, false)
}

fn scan_devices(wait: Duration, snapshot: bool) -> NetworkAudioScan {
    let ndi = spawn_backend_probe("NDI", &NDI_BACKEND, move || {
        if snapshot {
            ndi::snapshot_devices(wait)
        } else {
            ndi::audio_devices(wait)
        }
    });
    let omt = spawn_backend_probe("OMT", &OMT_BACKEND, move || omt::audio_devices(wait));
    let mut devices = Vec::new();
    let mut warnings = Vec::new();

    collect_backend_probe(ndi, BACKEND_PROBE_TIMEOUT, &mut devices, &mut warnings);
    collect_backend_probe(omt, BACKEND_PROBE_TIMEOUT, &mut devices, &mut warnings);

    NetworkAudioScan { devices, warnings }
}

pub fn audio_device_snapshot(wait: Duration) -> Vec<AudioDeviceSnapshotEntry> {
    scan_devices(wait, true)
        .devices
        .into_iter()
        .map(|device| AudioDeviceSnapshotEntry {
            id: device.id,
            name: device.name,
            direction: device.direction,
            is_default: false,
        })
        .collect()
}

struct BackendProbe {
    name: &'static str,
    state: &'static BackendState,
    started_at: Instant,
    receiver: Option<mpsc::Receiver<Vec<AudioDeviceInfo>>>,
}

fn spawn_backend_probe(
    name: &'static str,
    state: &'static BackendState,
    probe: impl FnOnce() -> Vec<AudioDeviceInfo> + Send + 'static,
) -> BackendProbe {
    let Some(guard) = state.begin() else {
        return BackendProbe {
            name,
            state,
            started_at: Instant::now(),
            receiver: None,
        };
    };

    let (sender, receiver) = mpsc::sync_channel(1);
    let started_at = Instant::now();
    thread::spawn(move || {
        let devices = probe();
        if let Ok(mut cache) = state.devices.lock() {
            *cache = devices.clone();
        }
        drop(guard);
        let _ = sender.send(devices);
    });
    BackendProbe {
        name,
        state,
        started_at,
        receiver: Some(receiver),
    }
}

fn collect_backend_probe(
    probe: BackendProbe,
    timeout: Duration,
    devices: &mut Vec<AudioDeviceInfo>,
    warnings: &mut Vec<String>,
) {
    let Some(receiver) = probe.receiver else {
        warnings.push(format!(
            "Skipped {} refresh: a backend query is still running. Try Refresh again after it finishes.",
            probe.name
        ));
        devices.extend(probe.state.cached_devices());
        return;
    };
    let remaining = timeout.saturating_sub(probe.started_at.elapsed());
    match receiver.recv_timeout(remaining) {
        Ok(mut found) => devices.append(&mut found),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            devices.extend(probe.state.cached_devices());
            warnings.push(format!(
                "Skipped {} audio: its backend did not respond within {} seconds.",
                probe.name,
                timeout.as_secs()
            ));
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            devices.extend(probe.state.cached_devices());
            warnings.push(format!(
                "Skipped {} audio: its backend probe stopped unexpectedly.",
                probe.name
            ));
        }
    }
}

pub fn ndi_status(wait: Duration) -> ndi::NdiStatus {
    let Some(guard) = NDI_BACKEND.begin() else {
        return ndi::NdiStatus {
            available: false,
            version: None,
            runtime_path: None,
            source_count: 0,
            source_names: Vec::new(),
            error: Some(
                "NDI backend query is still running; try Refresh again after it finishes"
                    .to_string(),
            ),
        };
    };
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let status = ndi::status(wait);
        drop(guard);
        let _ = sender.send(status);
    });
    match receiver.recv_timeout(BACKEND_PROBE_TIMEOUT) {
        Ok(status) => status,
        Err(_) => ndi::NdiStatus {
            available: false,
            version: None,
            runtime_path: None,
            source_count: 0,
            source_names: Vec::new(),
            error: Some(
                "NDI backend query timed out; try Refresh again after it finishes".to_string(),
            ),
        },
    }
}

pub fn omt_status(wait: Duration) -> omt::OmtStatus {
    let Some(guard) = OMT_BACKEND.begin() else {
        return omt::OmtStatus {
            available: false,
            version: None,
            runtime_path: None,
            source_count: 0,
            source_names: Vec::new(),
            error: Some(
                "OMT backend query is still running; try Refresh again after it finishes"
                    .to_string(),
            ),
        };
    };
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let status = omt::status(wait);
        drop(guard);
        let _ = sender.send(status);
    });
    match receiver.recv_timeout(BACKEND_PROBE_TIMEOUT) {
        Ok(status) => status,
        Err(_) => omt::OmtStatus {
            available: false,
            version: None,
            runtime_path: None,
            source_count: 0,
            source_names: Vec::new(),
            error: Some(
                "OMT backend query timed out; try Refresh again after it finishes".to_string(),
            ),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{collect_backend_probe, spawn_backend_probe, BackendState};
    use std::sync::{atomic::Ordering, mpsc};
    use std::time::Duration;

    #[test]
    fn blocks_retries_only_until_the_timed_out_worker_finishes() {
        let state: &'static BackendState = Box::leak(Box::new(BackendState::new()));
        let (release_tx, release_rx) = mpsc::sync_channel(1);
        let probe = spawn_backend_probe("test", state, move || {
            release_rx.recv().unwrap();
            Vec::new()
        });
        let mut devices = Vec::new();
        let mut warnings = Vec::new();

        collect_backend_probe(probe, Duration::from_millis(5), &mut devices, &mut warnings);

        assert!(devices.is_empty());
        assert_eq!(warnings.len(), 1);
        assert!(state.busy.load(Ordering::Acquire));
        let overlapping = spawn_backend_probe("test", state, || panic!("must not overlap"));
        assert!(overlapping.receiver.is_none());
        release_tx.send(()).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while state.busy.load(Ordering::Acquire) {
            assert!(std::time::Instant::now() < deadline);
            std::thread::yield_now();
        }
        let retry = spawn_backend_probe("test", state, Vec::new);
        assert!(retry.receiver.is_some());
        collect_backend_probe(retry, Duration::from_secs(2), &mut devices, &mut warnings);
        assert_eq!(warnings.len(), 1);
    }

    #[test]
    fn retains_last_known_devices_while_a_query_is_busy() {
        let state: &'static BackendState = Box::leak(Box::new(BackendState::new()));
        state
            .devices
            .lock()
            .unwrap()
            .push(crate::audio::AudioDeviceInfo {
                id: "ndi:recv:test".into(),
                name: "Test source".into(),
                direction: "input".into(),
                is_default: false,
                max_channels: 2,
                supports_48k: true,
                supported_configs: Vec::new(),
                channel_pairs: Vec::new(),
            });
        let _guard = state.begin().unwrap();
        let probe = spawn_backend_probe("test", state, || panic!("must not overlap"));
        let mut devices = Vec::new();
        let mut warnings = Vec::new();
        collect_backend_probe(probe, Duration::ZERO, &mut devices, &mut warnings);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].id, "ndi:recv:test");
        assert_eq!(warnings.len(), 1);
    }
}

pub fn is_input_device(device_id: &str) -> bool {
    ndi::is_input_device(device_id) || omt::is_input_device(device_id)
}

pub fn is_output_device(device_id: &str) -> bool {
    ndi::is_output_device(device_id) || omt::is_output_device(device_id)
}

pub fn start_input(request: InputStartRequest) -> Result<NetworkAudioInputRuntime, String> {
    if ndi::is_input_device(&request.device_id) {
        return ndi::NdiInputRuntime::start(
            request.device_id,
            request.left_channel,
            request.right_channel,
            request.sender,
            request.last_error,
            request.level_milli_db,
            request.captured_frames,
            request.dropped_chunks,
            request.dropped_frames,
        )
        .map(NetworkAudioInputRuntime::Ndi);
    }
    if omt::is_input_device(&request.device_id) {
        return omt::OmtInputRuntime::start(
            request.device_id,
            request.left_channel,
            request.right_channel,
            request.sender,
            request.last_error,
            request.level_milli_db,
            request.captured_frames,
            request.dropped_chunks,
            request.dropped_frames,
        )
        .map(NetworkAudioInputRuntime::Omt);
    }
    Err(format!(
        "unknown network audio input device: {}",
        request.device_id
    ))
}

pub fn start_output(
    device_id: String,
    sources: Arc<Mutex<HashMap<String, BridgeOutputMixerSource>>>,
    last_error: Arc<Mutex<Option<String>>>,
) -> Result<NetworkAudioOutputRuntime, String> {
    if ndi::is_output_device(&device_id) {
        return ndi::NdiOutputRuntime::start(device_id, sources, last_error)
            .map(NetworkAudioOutputRuntime::Ndi);
    }
    if omt::is_output_device(&device_id) {
        return omt::OmtOutputRuntime::start(device_id, sources, last_error)
            .map(NetworkAudioOutputRuntime::Omt);
    }
    Err(format!("unknown network audio output device: {device_id}"))
}
