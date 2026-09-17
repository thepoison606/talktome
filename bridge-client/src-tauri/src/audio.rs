use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{Device, SampleRate, SupportedBufferSize, SupportedStreamConfigRange};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use crate::network_audio;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AudioInventory {
    pub host: String,
    pub devices: Vec<AudioDeviceInfo>,
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

// Enumeration and device details have independent retained workers. Slow calls
// keep running without holding up other devices or being spawned again.
#[derive(Clone)]
struct DiscoveredDevice {
    key: String,
    index: usize,
    device: Device,
    default_name: Option<String>,
}
type Enumeration = Result<Vec<DiscoveredDevice>, String>;
static INPUT_SCAN: OnceLock<crate::discovery_task::DiscoveryTask<Enumeration>> = OnceLock::new();
static OUTPUT_SCAN: OnceLock<crate::discovery_task::DiscoveryTask<Enumeration>> = OnceLock::new();
type Details = crate::discovery_task::DiscoveryTask<Result<Option<AudioDeviceInfo>, String>>;
static DETAILS: OnceLock<Mutex<HashMap<String, Details>>> = OnceLock::new();
static ACTIVE_DETAILS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

pub fn refresh_completed_details() {
    if let Some(details) = DETAILS.get() {
        if let Ok(details) = details.lock() {
            for task in details.values() { task.refresh_completed(); }
        }
    }
}

fn enumerate(direction: &'static str) -> Enumeration {
    let host = cpal::default_host();
    let default_name = match direction {
        "input" => host.default_input_device(),
        _ => host.default_output_device(),
    }
    .map(|device| device.to_string());
    // CPAL's direction-filtered iterators may query capabilities while iterating.
    // Do that in each device worker instead of stalling the entire enumeration.
    let devices = host.devices().map_err(|error| error.to_string())?;
    Ok(devices
        .enumerate()
        .map(|(index, device)| DiscoveredDevice {
            key: device_probe_key("system", direction, index, &device),
            index,
            device,
            default_name: default_name.clone(),
        })
        .collect())
}

pub fn list_audio_devices() -> Result<AudioInventory, String> {
    let host_name = format!("{:?}", cpal::default_host().id());
    let mut devices = Vec::new();
    let mut warnings = Vec::new();
    for (direction, scan) in [("input", &INPUT_SCAN), ("output", &OUTPUT_SCAN)] {
        let (found, running) = scan
            .get_or_init(crate::discovery_task::DiscoveryTask::new)
            .poll(Duration::from_secs(5), move || {
                crate::audio_diagnostics::trace(format!("enumerate {direction}"), || {
                    enumerate(direction)
                })
            });
        if running && found.is_none() {
            warnings.push(format!("System audio {direction} discovery is still running; results will appear automatically."));
        }
        match found {
            Some(Ok(found)) => {
                let mut details = DETAILS
                    .get_or_init(|| Mutex::new(HashMap::new()))
                    .lock()
                    .unwrap();
                for entry in found {
                    let name = host_name.clone();
                    let key = entry.key.clone();
                    let label = format!("{direction} {}", entry.key);
                    let (result, pending) = details
                        .entry(key)
                        .or_insert_with(Details::new)
                        .poll_limited(Duration::MAX, Some((&ACTIVE_DETAILS, 4)), move || {
                            let supported = crate::audio_diagnostics::trace(
                                format!("capabilities {label}"),
                                || match direction {
                                    "input" => entry.device.supports_input(),
                                    _ => entry.device.supports_output(),
                                },
                            );
                            if !supported {
                                return Ok(None);
                            }
                            crate::audio_diagnostics::trace(format!("details {label}"), || {
                                describe_device(
                                    &name,
                                    direction,
                                    entry.index,
                                    entry.device,
                                    entry.default_name.as_deref(),
                                )
                            })
                            .map(Some)
                        });
                    match result {
                        Some(Ok(Some(device))) => devices.push(device),
                        Some(Ok(None)) => {}
                        Some(Err(error)) => warnings.push(error),
                        None if pending => warnings.push(format!(
                            "Audio {direction} device details are pending or queued."
                        )),
                        None => warnings.push(format!(
                            "An audio {direction} device query failed; retry pending."
                        )),
                    }
                }
            }
            Some(Err(error)) => warnings.push(format!("System audio {direction}: {error}")),
            _ => {}
        }
    }
    let network = network_audio::audio_devices(Duration::from_millis(250));
    devices.extend(network.devices);
    warnings.extend(network.warnings);
    Ok(AudioInventory {
        host: host_name,
        devices,
        warnings,
    })
}

/// Read the same retained inventory; never perform a second native scan in a poll.
pub fn list_audio_device_snapshot() -> Result<AudioDeviceSnapshot, String> {
    let inventory = list_audio_devices()?;
    Ok(AudioDeviceSnapshot {
        host: inventory.host,
        devices: inventory
            .devices
            .into_iter()
            .map(|device| AudioDeviceSnapshotEntry {
                id: device.id,
                name: device.name,
                direction: device.direction,
                is_default: device.is_default,
            })
            .collect(),
    })
}

pub fn find_audio_device(direction: &str, device_id: &str) -> Result<Device, String> {
    let host = cpal::default_host();
    let host_name = format!("{:?}", host.id());

    if direction != "input" && direction != "output" {
        return Err(format!("unknown audio device direction: {direction}"));
    }
    let devices = host
        .devices()
        .map_err(|err| format!("failed to enumerate devices: {err}"))?;
    for (index, device) in devices.enumerate() {
        if device_id_for(&host_name, direction, index, &device) == device_id {
            return Ok(device);
        }
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
    let native_name =
        crate::audio_diagnostics::trace(format!("device name {direction} #{index}"), || {
            device.to_string()
        });
    let name = display_name_for_native_device(&native_name);
    let supported_configs =
        crate::audio_diagnostics::trace(format!("formats {direction} {native_name}"), || {
            supported_configs_for(&device, direction)
        })?;
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
