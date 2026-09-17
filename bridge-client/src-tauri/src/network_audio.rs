use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicI32, AtomicU64},
    mpsc::SyncSender,
    Arc, Mutex,
};
use std::time::Duration;

use crate::audio::AudioDeviceInfo;
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

type NdiScan = (Vec<AudioDeviceInfo>, ndi::NdiStatus);
type OmtScan = (Vec<AudioDeviceInfo>, omt::OmtStatus);
static NDI_SCAN: std::sync::OnceLock<crate::discovery_task::DiscoveryTask<NdiScan>> =
    std::sync::OnceLock::new();
static OMT_SCAN: std::sync::OnceLock<crate::discovery_task::DiscoveryTask<OmtScan>> =
    std::sync::OnceLock::new();

fn poll_ndi(wait: Duration) -> Option<NdiScan> {
    if crate::audio_diagnostics::local_only() {
        return None;
    }
    NDI_SCAN
        .get_or_init(crate::discovery_task::DiscoveryTask::new)
        .poll(Duration::from_secs(5), move || {
            (
                crate::audio_diagnostics::trace("NDI devices", || ndi::audio_devices(wait)),
                crate::audio_diagnostics::trace("NDI status", || ndi::status(wait)),
            )
        })
        .0
}
fn poll_omt(wait: Duration) -> Option<OmtScan> {
    if crate::audio_diagnostics::local_only() {
        return None;
    }
    OMT_SCAN
        .get_or_init(crate::discovery_task::DiscoveryTask::new)
        .poll(Duration::from_secs(5), move || {
            (
                crate::audio_diagnostics::trace("OMT devices", || omt::audio_devices(wait)),
                crate::audio_diagnostics::trace("OMT status", || omt::status(wait)),
            )
        })
        .0
}

pub fn audio_devices(wait: Duration) -> NetworkAudioScan {
    if crate::audio_diagnostics::local_only() {
        return NetworkAudioScan {
            devices: Vec::new(),
            warnings: Vec::new(),
        };
    }
    let mut devices = Vec::new();
    let mut warnings = Vec::new();
    match poll_ndi(wait) {
        Some((found, _)) => devices.extend(found),
        None => warnings
            .push("NDI discovery is still running; results will appear automatically.".into()),
    }
    match poll_omt(wait) {
        Some((found, _)) => devices.extend(found),
        None => warnings
            .push("OMT discovery is still running; results will appear automatically.".into()),
    }
    NetworkAudioScan { devices, warnings }
}

pub fn ndi_status(wait: Duration) -> ndi::NdiStatus {
    poll_ndi(wait)
        .map(|(_, status)| status)
        .unwrap_or_else(|| ndi::NdiStatus {
            available: false,
            version: None,
            runtime_path: None,
            source_count: 0,
            source_names: Vec::new(),
            error: Some(
                if crate::audio_diagnostics::local_only() {
                    "Disabled: local audio only"
                } else {
                    "Discovery is still running"
                }
                .into(),
            ),
        })
}
pub fn omt_status(wait: Duration) -> omt::OmtStatus {
    poll_omt(wait)
        .map(|(_, status)| status)
        .unwrap_or_else(|| omt::OmtStatus {
            available: false,
            version: None,
            runtime_path: None,
            source_count: 0,
            source_names: Vec::new(),
            error: Some(
                if crate::audio_diagnostics::local_only() {
                    "Disabled: local audio only"
                } else {
                    "Discovery is still running"
                }
                .into(),
            ),
        })
}

pub fn is_input_device(device_id: &str) -> bool {
    ndi::is_input_device(device_id) || omt::is_input_device(device_id)
}

pub fn is_output_device(device_id: &str) -> bool {
    ndi::is_output_device(device_id) || omt::is_output_device(device_id)
}

pub fn start_input(request: InputStartRequest) -> Result<NetworkAudioInputRuntime, String> {
    if crate::audio_diagnostics::local_only() {
        return Err("Network audio disabled: local audio only".into());
    }
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
    if crate::audio_diagnostics::local_only() {
        return Err("Network audio disabled: local audio only".into());
    }
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
