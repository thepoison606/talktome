use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{Device, SampleRate, SupportedBufferSize, SupportedStreamConfigRange};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use crate::network_audio;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AudioInventory {
    pub host: String,
    pub devices: Vec<AudioDeviceInfo>,
    #[serde(default, rename = "videoSources")]
    pub video_sources: Vec<crate::video_media::VideoSource>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub direction: String,
    pub is_default: bool,
    pub max_channels: u16,
    pub supports_48k: bool,
    pub supported_configs: Vec<AudioConfigRange>,
    pub channel_pairs: Vec<ChannelPair>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AudioConfigRange {
    pub channels: u16,
    pub min_sample_rate: u32,
    pub max_sample_rate: u32,
    pub sample_format: String,
    pub min_buffer_size: Option<u32>,
    pub max_buffer_size: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChannelPair {
    pub label: String,
    pub left_channel: u16,
    pub right_channel: u16,
}

#[derive(Debug, Serialize)]
pub struct AudioDeviceSnapshot {
    pub host: String,
    pub devices: Vec<AudioDeviceSnapshotEntry>,
}

#[derive(Debug, Serialize)]
pub struct AudioDeviceSnapshotEntry {
    pub id: String,
    pub name: String,
    pub direction: String,
    pub is_default: bool,
}

const DEVICE_DETAILS_TIMEOUT: Duration = Duration::from_secs(2);
const SYSTEM_DIRECTION_TIMEOUT: Duration = Duration::from_secs(4);
const PROBE_RETRY_COOLDOWN: Duration = Duration::from_secs(30);

// Native driver calls cannot be cancelled safely. A timed-out worker is left
// detached, so retries are delayed. The quarantine uses stable endpoint IDs and
// is cleared when the lightweight snapshot observes a topology change.
static TIMED_OUT_DEVICE_PROBES: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
static TIMED_OUT_DIRECTIONS: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
static LAST_SYSTEM_DEVICE_SNAPSHOT: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn is_probe_quarantined(quarantine: &Mutex<HashMap<String, Instant>>, key: &str) -> bool {
    let Ok(mut entries) = quarantine.lock() else {
        return false;
    };
    let Some(timed_out_at) = entries.get(key).copied() else {
        return false;
    };
    if timed_out_at.elapsed() < PROBE_RETRY_COOLDOWN {
        return true;
    }
    entries.remove(key);
    false
}

fn quarantine_probe(quarantine: &Mutex<HashMap<String, Instant>>, key: String) {
    if let Ok(mut entries) = quarantine.lock() {
        entries.insert(key, Instant::now());
    }
}

fn clear_probe_quarantines() {
    if let Some(quarantine) = TIMED_OUT_DEVICE_PROBES.get() {
        if let Ok(mut entries) = quarantine.lock() {
            entries.clear();
        }
    }
    if let Some(quarantine) = TIMED_OUT_DIRECTIONS.get() {
        if let Ok(mut entries) = quarantine.lock() {
            entries.clear();
        }
    }
}

fn update_system_device_snapshot(devices: &[AudioDeviceSnapshotEntry]) {
    let mut identities = devices
        .iter()
        .map(|device| format!("{}:{}", device.direction, device.id))
        .collect::<Vec<_>>();
    identities.sort();
    let signature = identities.join("\n");
    let snapshots = LAST_SYSTEM_DEVICE_SNAPSHOT.get_or_init(|| Mutex::new(None));
    let Ok(mut previous) = snapshots.lock() else {
        return;
    };
    if previous.as_ref() != Some(&signature) {
        clear_probe_quarantines();
        *previous = Some(signature);
    }
}

pub fn list_audio_devices() -> Result<AudioInventory, String> {
    let host = cpal::default_host();
    let host_name = format!("{:?}", host.id());
    let input_probe = spawn_system_direction_probe(host_name.clone(), "input");
    let output_probe = spawn_system_direction_probe(host_name.clone(), "output");
    let network_scan = network_audio::audio_devices(Duration::from_millis(250));
    let mut devices = Vec::new();
    let mut warnings = Vec::new();

    collect_system_direction_probe(input_probe, &mut devices, &mut warnings);
    collect_system_direction_probe(output_probe, &mut devices, &mut warnings);
    devices.extend(network_scan.devices);
    warnings.extend(network_scan.warnings);

    Ok(AudioInventory {
        host: host_name,
        video_sources: Vec::new(),
        devices,
        warnings,
    })
}

struct SystemDirectionProbe {
    direction: &'static str,
    probe_key: String,
    started_at: Instant,
    receiver: Option<mpsc::Receiver<(Vec<AudioDeviceInfo>, Vec<String>)>>,
}

fn spawn_system_direction_probe(host_name: String, direction: &'static str) -> SystemDirectionProbe {
    let probe_key = format!("{host_name}:{direction}");
    let timed_out = TIMED_OUT_DIRECTIONS.get_or_init(|| Mutex::new(HashMap::new()));
    if is_probe_quarantined(timed_out, &probe_key) {
        return SystemDirectionProbe {
            direction,
            probe_key,
            started_at: Instant::now(),
            receiver: None,
        };
    }

    let (sender, receiver) = mpsc::sync_channel(1);
    let started_at = Instant::now();
    thread::spawn(move || {
        let host = cpal::default_host();
        let default_name = match direction {
            "input" => host.default_input_device(),
            "output" => host.default_output_device(),
            _ => None,
        }
        .map(|device| device.to_string());
        let result = match direction {
            "input" => match host.input_devices() {
                Ok(devices) => describe_devices_with_timeout(
                    &host_name,
                    direction,
                    devices.enumerate(),
                    default_name.as_deref(),
                ),
                Err(error) => (Vec::new(), vec![format!(
                    "Failed to enumerate input devices: {error}"
                )]),
            },
            "output" => match host.output_devices() {
                Ok(devices) => describe_devices_with_timeout(
                    &host_name,
                    direction,
                    devices.enumerate(),
                    default_name.as_deref(),
                ),
                Err(error) => (Vec::new(), vec![format!(
                    "Failed to enumerate output devices: {error}"
                )]),
            },
            _ => (Vec::new(), vec![format!("Unknown audio direction: {direction}")]),
        };
        let _ = sender.send(result);
    });

    SystemDirectionProbe {
        direction,
        probe_key,
        started_at,
        receiver: Some(receiver),
    }
}

fn collect_system_direction_probe(
    probe: SystemDirectionProbe,
    devices: &mut Vec<AudioDeviceInfo>,
    warnings: &mut Vec<String>,
) {
    let timed_out = TIMED_OUT_DIRECTIONS.get_or_init(|| Mutex::new(HashMap::new()));
    let Some(receiver) = probe.receiver else {
        warnings.push(format!(
            "Skipped all system audio {}s: device enumeration stopped responding earlier.",
            probe.direction
        ));
        return;
    };
    let remaining = SYSTEM_DIRECTION_TIMEOUT.saturating_sub(probe.started_at.elapsed());
    match receiver.recv_timeout(remaining) {
        Ok((mut found, mut skipped)) => {
            devices.append(&mut found);
            warnings.append(&mut skipped);
        }
        Err(error) => {
            quarantine_probe(timed_out, probe.probe_key);
            let reason = match error {
                mpsc::RecvTimeoutError::Timeout => format!(
                    "device enumeration did not respond within {} seconds",
                    SYSTEM_DIRECTION_TIMEOUT.as_secs()
                ),
                mpsc::RecvTimeoutError::Disconnected => {
                    "device enumeration stopped unexpectedly".to_string()
                }
            };
            warnings.push(format!(
                "Skipped all system audio {}s: {reason}.",
                probe.direction
            ));
        }
    }
}

fn describe_devices_with_timeout(
    host_name: &str,
    direction: &str,
    devices: impl Iterator<Item = (usize, Device)>,
    default_name: Option<&str>,
) -> (Vec<AudioDeviceInfo>, Vec<String>) {
    let timed_out = TIMED_OUT_DEVICE_PROBES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut pending = Vec::new();
    let mut warnings = Vec::new();

    for (index, device) in devices {
        let probe_key = device_probe_key(host_name, direction, index, &device);
        if is_probe_quarantined(timed_out, &probe_key) {
            warnings.push(format!(
                "Skipped {direction} audio device #{index}: its driver stopped responding earlier."
            ));
            continue;
        }

        let (sender, receiver) = mpsc::sync_channel(1);
        let host_name = host_name.to_string();
        let direction = direction.to_string();
        let default_name = default_name.map(str::to_string);
        let started_at = Instant::now();
        thread::spawn(move || {
            let result = describe_device(
                &host_name,
                &direction,
                index,
                device,
                default_name.as_deref(),
            );
            let _ = sender.send(result);
        });
        pending.push((index, probe_key, started_at, receiver));
    }

    let mut found = Vec::new();
    for (index, probe_key, started_at, receiver) in pending {
        let remaining = DEVICE_DETAILS_TIMEOUT.saturating_sub(started_at.elapsed());
        match receiver.recv_timeout(remaining) {
            Ok(Ok(device)) => found.push(device),
            Ok(Err(error)) => warnings.push(format!(
                "Skipped {direction} audio device #{index}: {error}"
            )),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                quarantine_probe(timed_out, probe_key);
                warnings.push(format!(
                    "Skipped {direction} audio device #{index}: its driver did not respond within {} seconds.",
                    DEVICE_DETAILS_TIMEOUT.as_secs()
                ));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                quarantine_probe(timed_out, probe_key);
                warnings.push(format!(
                    "Skipped {direction} audio device #{index}: its driver probe stopped unexpectedly."
                ));
            }
        }
    }

    (found, warnings)
}

/// Lists endpoint identity only. In particular, this avoids supported-config
/// queries, which activate WASAPI audio clients and must not run in a poll loop.
pub fn list_audio_device_snapshot() -> Result<AudioDeviceSnapshot, String> {
    let host = cpal::default_host();
    let host_name = format!("{:?}", host.id());
    let default_input_name = host.default_input_device().map(|device| device.to_string());
    let default_output_name = host
        .default_output_device()
        .map(|device| device.to_string());
    let mut devices = Vec::new();

    match host.input_devices() {
        Ok(input_devices) => {
            for (index, device) in input_devices.enumerate() {
                devices.push(snapshot_device(
                    &host_name,
                    "input",
                    index,
                    device,
                    default_input_name.as_deref(),
                ));
            }
        }
        Err(err) => eprintln!("failed to enumerate input devices: {err}"),
    }

    match host.output_devices() {
        Ok(output_devices) => {
            for (index, device) in output_devices.enumerate() {
                devices.push(snapshot_device(
                    &host_name,
                    "output",
                    index,
                    device,
                    default_output_name.as_deref(),
                ));
            }
        }
        Err(err) => eprintln!("failed to enumerate output devices: {err}"),
    }

    update_system_device_snapshot(&devices);

    devices.extend(network_audio::audio_device_snapshot(Duration::from_millis(
        100,
    )));

    Ok(AudioDeviceSnapshot {
        host: host_name,
        devices,
    })
}

pub fn find_audio_device(direction: &str, device_id: &str) -> Result<Device, String> {
    let host = cpal::default_host();
    let host_name = format!("{:?}", host.id());

    match direction {
        "input" => {
            let devices = host
                .input_devices()
                .map_err(|err| format!("failed to enumerate input devices: {err}"))?;
            for (index, device) in devices.enumerate() {
                if device_id_for(&host_name, direction, index, &device) == device_id {
                    return Ok(device);
                }
            }
        }
        "output" => {
            let devices = host
                .output_devices()
                .map_err(|err| format!("failed to enumerate output devices: {err}"))?;
            for (index, device) in devices.enumerate() {
                if device_id_for(&host_name, direction, index, &device) == device_id {
                    return Ok(device);
                }
            }
        }
        _ => return Err(format!("unknown audio device direction: {direction}")),
    }

    Err(format!("{direction} device not found: {device_id}"))
}

fn describe_device(
    host_name: &str,
    direction: &str,
    index: usize,
    device: Device,
    default_name: Option<&str>,
) -> Result<AudioDeviceInfo, String> {
    let native_name = device.to_string();
    let name = display_name_for_native_device(&native_name);
    let supported_configs = supported_configs_for(&device, direction)?;
    let max_channels = supported_configs
        .iter()
        .map(|config| config.channels)
        .max()
        .unwrap_or(0);
    let supports_48k = supported_configs
        .iter()
        .any(|config| config.min_sample_rate <= 48_000 && config.max_sample_rate >= 48_000);
    let channel_pairs = build_channel_pairs(max_channels);
    let id = device_id_for(host_name, direction, index, &device);
    let is_default = default_name.is_some_and(|default| default == native_name);

    Ok(AudioDeviceInfo {
        id,
        name,
        direction: direction.to_string(),
        is_default,
        max_channels,
        supports_48k,
        supported_configs,
        channel_pairs,
    })
}

fn display_name_for_native_device(name: &str) -> String {
    if name.trim().to_ascii_lowercase().starts_with("ndi audio") {
        format!("System audio · {name}")
    } else {
        name.to_string()
    }
}

fn snapshot_device(
    host_name: &str,
    direction: &str,
    index: usize,
    device: Device,
    default_name: Option<&str>,
) -> AudioDeviceSnapshotEntry {
    let native_name = device.to_string();
    let name = display_name_for_native_device(&native_name);
    let id = device_id_for(host_name, direction, index, &device);
    let is_default = default_name.is_some_and(|default| default == native_name);

    AudioDeviceSnapshotEntry {
        id,
        name,
        direction: direction.to_string(),
        is_default,
    }
}

fn device_id_for(host_name: &str, direction: &str, index: usize, device: &Device) -> String {
    device
        .id()
        .map(|native_id| format!("{native_id:?}"))
        .unwrap_or_else(|_| {
            stable_enough_device_id(host_name, direction, index, &device.to_string())
        })
}

fn device_probe_key(host_name: &str, direction: &str, index: usize, device: &Device) -> String {
    device
        .id()
        .map(|native_id| format!("{host_name}:{direction}:{native_id:?}"))
        .unwrap_or_else(|_| format!("{host_name}:{direction}:fallback-index:{index}"))
}

fn supported_configs_for(
    device: &Device,
    direction: &str,
) -> Result<Vec<AudioConfigRange>, String> {
    let ranges: Vec<SupportedStreamConfigRange> = match direction {
        "input" => device
            .supported_input_configs()
            .map_err(|err| format!("failed to query input configs: {err}"))?
            .collect(),
        "output" => device
            .supported_output_configs()
            .map_err(|err| format!("failed to query output configs: {err}"))?
            .collect(),
        _ => return Ok(Vec::new()),
    };

    Ok(ranges.into_iter().map(config_range_from).collect())
}

fn config_range_from(config: SupportedStreamConfigRange) -> AudioConfigRange {
    let (min_buffer_size, max_buffer_size) = match config.buffer_size() {
        SupportedBufferSize::Range { min, max } => (Some(*min), Some(*max)),
        SupportedBufferSize::Unknown => (None, None),
    };

    AudioConfigRange {
        channels: config.channels(),
        min_sample_rate: sample_rate_to_u32(config.min_sample_rate()),
        max_sample_rate: sample_rate_to_u32(config.max_sample_rate()),
        sample_format: format!("{:?}", config.sample_format()),
        min_buffer_size,
        max_buffer_size,
    }
}

fn build_channel_pairs(max_channels: u16) -> Vec<ChannelPair> {
    let mut pairs = Vec::new();

    for channel in 1..=max_channels {
        pairs.push(ChannelPair {
            label: format!("{channel}"),
            left_channel: channel,
            right_channel: channel,
        });
    }

    let pair_count = max_channels / 2;

    for pair_index in 0..pair_count {
        let left = pair_index * 2 + 1;
        let right = left + 1;
        pairs.push(ChannelPair {
            label: format!("{left}/{right}"),
            left_channel: left,
            right_channel: right,
        });
    }

    pairs
}

fn sample_rate_to_u32(sample_rate: SampleRate) -> u32 {
    sample_rate
}

fn stable_enough_device_id(host_name: &str, direction: &str, index: usize, name: &str) -> String {
    let normalized_name = name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    format!("{host_name}:{direction}:{index}:{normalized_name}")
}
