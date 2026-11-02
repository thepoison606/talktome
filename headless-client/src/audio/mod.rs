//! Local audio: Opus codec, capture/playback, jitter buffering and mixing.

pub mod codec;
pub mod cues;
pub mod io;
pub mod jitter;
pub mod mixer;
pub mod processing;
pub mod resample;
pub mod vox;

use anyhow::Result;
use cpal::traits::{DeviceTrait, HostTrait};

/// The ALSA PCM identifier (`plughw:CARD=Headset,DEV=0`) of a cpal device,
/// which is what `audio.input_device` / `audio.output_device` refer to.
pub fn device_pcm_id(device: &cpal::Device) -> String {
    device
        .id()
        .map(|id| id.id().to_string())
        .unwrap_or_else(|_| "?".into())
}

pub fn device_label(device: &cpal::Device) -> String {
    device
        .description()
        .map(|d| d.name().to_string())
        .unwrap_or_else(|_| device_pcm_id(device))
}

/// Finds a device by PCM id or human-readable name.
pub fn find_device<I>(devices: I, wanted: &str) -> Option<cpal::Device>
where
    I: Iterator<Item = cpal::Device>,
{
    let wanted = wanted.trim();
    devices.into_iter().find(|device| {
        device_pcm_id(device) == wanted
            || device_label(device) == wanted
            || device
                .id()
                .map(|id| id.to_string() == wanted)
                .unwrap_or(false)
    })
}

/// One entry of the settings device dropdown.
pub struct PcmChoice {
    pub id: String,
    pub label: String,
    /// `hw:`/`plughw:`/`dmix:`… on a sound card, as opposed to a PCM defined
    /// in asound.conf (`ravenna_shared_in`, `in_ch1`, …).
    pub card: bool,
}

/// The ALSA PCMs `aplay -L` (playback) or `arecord -L` (capture) lists,
/// including dmix/dsnoop/route devices from asound.conf. ALSA gives no
/// direction hint for those, so each one is opened non-blocking to see
/// whether it works that way round (a dmix only plays, a dsnoop only records).
/// A busy device is kept: it is usually the one this client has open.
pub fn alsa_pcm_devices(input: bool) -> Vec<PcmChoice> {
    let direction = if input {
        alsa::Direction::Capture
    } else {
        alsa::Direction::Playback
    };
    let Ok(hints) = alsa::device_name::HintIter::new_str(None, "pcm") else {
        return Vec::new();
    };
    let _quiet = QuietAlsa::new();
    hints
        .filter_map(|hint| {
            let id = hint.name?;
            if let Some(only) = hint.direction {
                if only != direction {
                    return None;
                }
            } else if let Err(error) = alsa::PCM::new(&id, direction, true) {
                let busy = std::io::Error::from_raw_os_error(error.errno().abs()).kind()
                    == std::io::ErrorKind::ResourceBusy;
                if !busy {
                    return None;
                }
            }
            let label = match hint.desc {
                Some(desc) => desc.lines().map(str::trim).collect::<Vec<_>>().join(" – "),
                None => id.clone(),
            };
            Some(PcmChoice {
                card: id.contains(':'),
                id,
                label,
            })
        })
        .collect()
}

/// Mutes ALSA's stderr messages on this thread while probing ("The dmix
/// plugin supports only playback stream" for every output device).
struct QuietAlsa(alsa_sys::snd_local_error_handler_t);

impl QuietAlsa {
    fn new() -> Self {
        unsafe extern "C" fn ignore(
            _file: *const std::ffi::c_char,
            _line: std::ffi::c_int,
            _func: *const std::ffi::c_char,
            _err: std::ffi::c_int,
            _fmt: *const std::ffi::c_char,
            _arg: *mut alsa_sys::__va_list_tag,
        ) {
        }
        // SAFETY: sets a thread-local handler; `ignore` never touches its arguments.
        Self(unsafe { alsa_sys::snd_lib_error_set_local(Some(ignore)) })
    }
}

impl Drop for QuietAlsa {
    fn drop(&mut self) {
        // SAFETY: restores the handler that was active before `new`.
        unsafe {
            alsa_sys::snd_lib_error_set_local(self.0);
        }
    }
}

/// Prints the audio devices cpal/ALSA exposes, for provisioning.
pub fn list_devices() -> Result<()> {
    let host = cpal::default_host();
    println!("Input devices (use the id in audio.input_device):");
    for device in host.input_devices()? {
        let configs: Vec<String> = device
            .supported_input_configs()
            .map(|c| {
                c.map(|cfg| {
                    format!(
                        "{}ch {}-{} Hz",
                        cfg.channels(),
                        cfg.min_sample_rate(),
                        cfg.max_sample_rate()
                    )
                })
                .collect()
            })
            .unwrap_or_default();
        println!(
            "  {}\n      {}  [{}]",
            device_pcm_id(&device),
            device_label(&device),
            configs.join(", ")
        );
    }
    println!("Output devices (use the id in audio.output_device):");
    for device in host.output_devices()? {
        let configs: Vec<String> = device
            .supported_output_configs()
            .map(|c| {
                c.map(|cfg| {
                    format!(
                        "{}ch {}-{} Hz",
                        cfg.channels(),
                        cfg.min_sample_rate(),
                        cfg.max_sample_rate()
                    )
                })
                .collect()
            })
            .unwrap_or_default();
        println!(
            "  {}\n      {}  [{}]",
            device_pcm_id(&device),
            device_label(&device),
            configs.join(", ")
        );
    }
    Ok(())
}
