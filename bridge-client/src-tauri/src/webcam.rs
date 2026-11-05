//! Local camera discovery/capture through the bundled LGPL FFmpeg.
//! Audio deliberately remains on the existing independently selected input.
use crate::video_media::{VideoSink, VideoSource};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
struct Camera {
    name: String,
    selector: String,
    identity: String,
}
static CAMERAS: OnceLock<Mutex<(Option<Instant>, HashMap<String, Camera>)>> = OnceLock::new();
const MAX_FRAME: usize = 1280 * 720 * 4 + 4096;

fn source_id(identity: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in identity.bytes() {
        hash = (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3);
    }
    format!("webcam:recv:{hash:016x}")
}
pub fn is_input_device(id: &str) -> bool {
    id.strip_prefix("webcam:recv:")
        .is_some_and(|s| s.len() == 16 && s.bytes().all(|b| b.is_ascii_hexdigit()))
}
fn parse_devices(text: &str, mac: bool) -> Vec<Camera> {
    let mut cameras: Vec<Camera> = Vec::new();
    let mut video = false;
    let mut pending = None;
    let mut occurrences = HashMap::<String, usize>::new();
    for line in text.lines() {
        if mac {
            if line.contains("AVFoundation video devices:") {
                video = true;
                continue;
            }
            if line.contains("AVFoundation audio devices:") {
                video = false;
            }
            if !video {
                continue;
            }
            let Some((_, entry)) = line.split_once("] [") else {
                continue;
            };
            let Some((index, name)) = entry.split_once("] ") else {
                continue;
            };
            if index.parse::<usize>().is_err() || name.starts_with("Capture screen") {
                continue;
            }
            let occurrence = occurrences.entry(name.to_owned()).or_default();
            cameras.push(Camera {
                name: name.to_owned(),
                selector: format!("{index}:none"),
                identity: format!("avfoundation:{name}:{occurrence}"),
            });
            *occurrence += 1;
        } else {
            if line.contains("(video)") {
                if let Some(name) = quoted(line) {
                    pending = Some(cameras.len());
                    cameras.push(Camera {
                        name: name.to_owned(),
                        selector: format!("video={name}"),
                        identity: format!("dshow:{name}"),
                    });
                }
            } else if line.contains("Alternative name") {
                if let (Some(index), Some(id)) = (pending.take(), quoted(line)) {
                    cameras[index].selector = format!("video={id}");
                    cameras[index].identity = format!("dshow:{id}");
                }
            } else if line.contains("(audio)") {
                pending = None;
            }
        }
    }
    cameras
}
fn quoted(text: &str) -> Option<&str> {
    text.split_once('"')?
        .1
        .rsplit_once('"')
        .map(|(value, _)| value)
}

pub fn video_sources() -> Vec<VideoSource> {
    discover(false)
}
fn discover(force: bool) -> Vec<VideoSource> {
    let cache = CAMERAS.get_or_init(|| Mutex::new((None, HashMap::new())));
    let Ok(mut state) = cache.lock() else {
        return Vec::new();
    };
    if force
        || state
            .0
            .is_none_or(|updated| updated.elapsed() >= Duration::from_secs(10))
    {
        let mut command = crate::bridge_media::ffmpeg_command();
        if cfg!(target_os = "macos") {
            command.args([
                "-hide_banner",
                "-f",
                "avfoundation",
                "-list_devices",
                "true",
                "-i",
                "",
            ]);
        } else if cfg!(windows) {
            command.args([
                "-hide_banner",
                "-f",
                "dshow",
                "-list_devices",
                "true",
                "-i",
                "dummy",
            ]);
        } else {
            return Vec::new();
        }
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        if let Ok(mut child) = command.spawn() {
            let stderr = child.stderr.take();
            let read = thread::spawn(move || {
                let mut bytes = Vec::new();
                if let Some(stderr) = stderr {
                    let _ = stderr.take(256 * 1024).read_to_end(&mut bytes);
                }
                String::from_utf8_lossy(&bytes).into_owned()
            });
            let started = Instant::now();
            while child.try_wait().ok().flatten().is_none()
                && started.elapsed() < Duration::from_secs(4)
            {
                thread::sleep(Duration::from_millis(25));
            }
            let _ = child.kill();
            let _ = child.wait();
            let devices =
                parse_devices(&read.join().unwrap_or_default(), cfg!(target_os = "macos"));
            state.1 = devices
                .into_iter()
                .map(|camera| (source_id(&camera.identity), camera))
                .collect();
        }
        state.0 = Some(Instant::now());
    }
    let mut sources: Vec<_> = state
        .1
        .iter()
        .map(|(id, camera)| VideoSource {
            id: id.clone(),
            name: format!("Webcam · {}", camera.name),
            protocol: "webcam".into(),
        })
        .collect();
    sources.sort_by(|a, b| a.name.cmp(&b.name));
    sources
}

struct CaptureProcess {
    child: Arc<Mutex<Child>>,
    done: Arc<AtomicBool>,
    watchdog: Option<JoinHandle<()>>,
    stderr: Option<JoinHandle<()>>,
}
impl Drop for CaptureProcess {
    fn drop(&mut self) {
        self.done.store(true, Ordering::Relaxed);
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(thread) = self.watchdog.take() {
            let _ = thread.join();
        }
        if let Some(thread) = self.stderr.take() {
            let _ = thread.join();
        }
    }
}
pub fn capture_video(id: &str, mut sink: VideoSink) -> Result<(), String> {
    // Device indices can change when a camera is plugged/unplugged. Resolve the
    // saved identity against a fresh list before opening any capture device.
    discover(true);
    let camera = CAMERAS
        .get()
        .and_then(|cache| cache.lock().ok()?.1.get(id).cloned())
        .ok_or("Webcam unavailable; reconnect it and refresh the video sources")?;
    let mut command = crate::bridge_media::ffmpeg_command();
    command.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-f",
        if cfg!(target_os = "macos") {
            "avfoundation"
        } else {
            "dshow"
        },
    ]);
    if cfg!(target_os = "macos") {
        command.args(["-framerate", "30"]);
    }
    command.args(["-i", &camera.selector, "-an", "-vf",
        "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
        "-c:v", "bmp", "-pix_fmt", "bgr24", "-f", "image2pipe", "pipe:1"])
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not open webcam: {e}"))?;
    let mut stdout = child.stdout.take().ok_or("Webcam pipe unavailable")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Webcam diagnostics unavailable")?;
    let error = Arc::new(Mutex::new(String::new()));
    let error_reader = Arc::clone(&error);
    let stderr = thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Ok(mut message) = error_reader.lock() {
                *message = line.chars().take(400).collect();
            }
        }
    });
    let child = Arc::new(Mutex::new(child));
    let done = Arc::new(AtomicBool::new(false));
    let last_frame = Arc::new(Mutex::new(Instant::now()));
    let (watch_child, watch_done, watch_frame, stop) = (
        Arc::clone(&child),
        Arc::clone(&done),
        Arc::clone(&last_frame),
        Arc::clone(&sink.stop),
    );
    let watchdog = thread::spawn(move || {
        while !watch_done.load(Ordering::Relaxed) {
            if stop.load(Ordering::Relaxed)
                || watch_frame
                    .lock()
                    .map(|t| t.elapsed() > Duration::from_secs(30))
                    .unwrap_or(true)
            {
                if let Ok(mut child) = watch_child.lock() {
                    let _ = child.kill();
                }
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
    });
    let _process = CaptureProcess {
        child,
        done,
        watchdog: Some(watchdog),
        stderr: Some(stderr),
    };
    sink.set_source_rate(30, 1);
    while !sink.stop.load(Ordering::Relaxed) {
        let mut header = [0u8; 14];
        if stdout.read_exact(&mut header).is_err() {
            if sink.stop.load(Ordering::Relaxed) {
                break;
            }
            return Err(format!(
                "Webcam stopped. Check camera access and whether another app is using it. {}",
                error.lock().map(|s| s.clone()).unwrap_or_default()
            ));
        }
        let size = bmp_size(&header)?;
        let mut frame = vec![0u8; size];
        frame[..14].copy_from_slice(&header);
        stdout
            .read_exact(&mut frame[14..])
            .map_err(|_| "Incomplete webcam picture")?;
        let (width, height, bgra) = decode_bmp(&frame)?;
        if let Ok(mut time) = last_frame.lock() {
            *time = Instant::now();
        }
        unsafe {
            sink.bgra(
                width as i32,
                height as i32,
                width as i32 * 4,
                bgra.as_ptr(),
                Some(bgra.len()),
            )?;
        }
    }
    Ok(())
}
fn bmp_size(header: &[u8; 14]) -> Result<usize, String> {
    let size = u32::from_le_bytes(header[2..6].try_into().unwrap()) as usize;
    if &header[..2] != b"BM" || !(54..=MAX_FRAME).contains(&size) {
        return Err("Invalid webcam picture header".into());
    }
    Ok(size)
}
fn decode_bmp(bytes: &[u8]) -> Result<(usize, usize, Vec<u8>), String> {
    if bytes.len() < 54 {
        return Err("Incomplete webcam picture header".into());
    }
    let u32_at = |offset| u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
    let width = u32_at(18) as i32;
    let signed_height = u32_at(22) as i32;
    let height = signed_height.unsigned_abs() as usize;
    let offset = u32_at(10) as usize;
    if !(2..=1280).contains(&width)
        || !(2..=720).contains(&height)
        || offset < 54
        || u32_at(14) < 40
        || bytes[26..28] != [1, 0]
        || bytes[28..30] != [24, 0]
        || u32_at(30) != 0
    {
        return Err("Unsupported webcam picture format".into());
    }
    let width = width as usize;
    let stride = (width * 3 + 3) & !3;
    if offset
        .checked_add(stride * height)
        .is_none_or(|end| end > bytes.len())
    {
        return Err("Incomplete webcam picture data".into());
    }
    let mut bgra = vec![255; width * height * 4];
    for y in 0..height {
        let source_y = if signed_height > 0 { height - 1 - y } else { y };
        for x in 0..width {
            let source = offset + source_y * stride + x * 3;
            let dest = (y * width + x) * 4;
            bgra[dest..dest + 3].copy_from_slice(&bytes[source..source + 3]);
        }
    }
    Ok((width, height, bgra))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_excludes_audio_and_screen_and_retains_stable_camera_ids() {
        let cams = parse_devices("[AVFoundation @ x] AVFoundation video devices:\n[AVFoundation @ x] [0] Camera\n[AVFoundation @ x] [1] Capture screen 0\n[AVFoundation @ x] AVFoundation audio devices:\n[AVFoundation @ x] [0] Microphone", true);
        assert_eq!(cams.len(), 1);
        assert_eq!(cams[0].selector, "0:none");
        let moved = parse_devices(
            "[AVFoundation @ x] AVFoundation video devices:\n[AVFoundation @ x] [3] Camera",
            true,
        );
        assert_eq!(source_id(&cams[0].identity), source_id(&moved[0].identity));
        assert!(is_input_device(&source_id(&cams[0].identity)));
        assert!(!is_input_device("webcam:recv:../../../camera"));
    }
    #[test]
    fn windows_uses_unique_alternative_names_and_ignores_microphones() {
        let cams = parse_devices("[dshow @ x] \"USB Camera\" (video)\n[dshow @ x] Alternative name \"@device_unique_camera\"\n[dshow @ x] \"Mic\" (audio)\n[dshow @ x] Alternative name \"@device_unique_mic\"", false);
        assert_eq!(cams.len(), 1);
        assert_eq!(cams[0].selector, "video=@device_unique_camera");
    }
    #[test]
    fn bmp_bottom_up_rows_and_padding_are_converted_without_cropping() {
        let mut bmp = vec![0u8; 70];
        bmp[..2].copy_from_slice(b"BM");
        for (offset, value) in [(2, 70u32), (10, 54), (14, 40), (18, 2), (22, 2)] {
            bmp[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        }
        bmp[26] = 1;
        bmp[28] = 24;
        bmp[54..62].copy_from_slice(&[1, 2, 3, 4, 5, 6, 0, 0]);
        bmp[62..70].copy_from_slice(&[7, 8, 9, 10, 11, 12, 0, 0]);
        let (w, h, data) = decode_bmp(&bmp).unwrap();
        assert_eq!((w, h), (2, 2));
        assert_eq!(
            data,
            vec![7, 8, 9, 255, 10, 11, 12, 255, 1, 2, 3, 255, 4, 5, 6, 255]
        );
        assert!(decode_bmp(&bmp[..69]).is_err());
        let mut header = [0; 14];
        header[..2].copy_from_slice(b"BM");
        header[2..6].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(bmp_size(&header).is_err());
    }
}
