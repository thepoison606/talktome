use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{Device, SampleRate, SupportedBufferSize, SupportedStreamConfigRange};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct AudioInventory {
    pub host: String,
    pub devices: Vec<AudioDeviceInfo>,
}

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
pub struct AudioConfigRange {
    pub channels: u16,
    pub min_sample_rate: u32,
    pub max_sample_rate: u32,
    pub sample_format: String,
    pub min_buffer_size: Option<u32>,
    pub max_buffer_size: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct ChannelPair {
    pub label: String,
    pub left_channel: u16,
    pub right_channel: u16,
}

pub fn list_audio_devices() -> Result<AudioInventory, String> {
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
                devices.push(describe_device(
                    &host_name,
                    "input",
                    index,
                    device,
                    default_input_name.as_deref(),
                )?);
            }
        }
        Err(err) => eprintln!("failed to enumerate input devices: {err}"),
    }

    match host.output_devices() {
        Ok(output_devices) => {
            for (index, device) in output_devices.enumerate() {
                devices.push(describe_device(
                    &host_name,
                    "output",
                    index,
                    device,
                    default_output_name.as_deref(),
                )?);
            }
        }
        Err(err) => eprintln!("failed to enumerate output devices: {err}"),
    }

    Ok(AudioInventory {
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
    let name = device.to_string();
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
    let is_default = default_name.is_some_and(|default| default == name);

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

fn device_id_for(host_name: &str, direction: &str, index: usize, device: &Device) -> String {
    device
        .id()
        .map(|native_id| format!("{native_id:?}"))
        .unwrap_or_else(|_| {
            stable_enough_device_id(host_name, direction, index, &device.to_string())
        })
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
