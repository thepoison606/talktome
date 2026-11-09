mod audio;
mod bridge_media;
mod credentials;
mod media_timing;
mod model;
mod ndi;
mod network_audio;
mod omt;
mod port_audio_level;
mod probe;
mod video_media;
mod webcam;

use audio::{AudioDeviceSnapshot, AudioInventory};
use bridge_media::{
    ActivateBridgeOutputRequest, BridgeMediaManager, BridgeMediaStatus,
    EnsureBridgeOutputEndpointRequest, ReserveBridgeOutputRequest, ReservedBridgeOutput,
    SetBridgeOutputLevelRequest, SetBridgePortAudioLevelRequest, StartBridgeInputRequest,
};
use futures_util::StreamExt;
use model::BridgeStatus;
use probe::{ProbeManager, ProbeStartRequest, ProbeStatus};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Size, Wry,
};
use tauri_plugin_autostart::{AutoLaunchManager, MacosLauncher};

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSWindow, NSWindowButton};
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

const TRAY_AUTOSTART_ID: &str = "autostart";
const TRAY_QUIT_ID: &str = "quit";

#[cfg(target_os = "macos")]
fn prepare_macos_panel_window(window: &tauri::WebviewWindow<Wry>) {
    let Ok(ns_window) = window.ns_window() else {
        return;
    };

    let ns_window = unsafe { &*ns_window.cast::<NSWindow>() };
    for button in [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ] {
        if let Some(button) = ns_window.standardWindowButton(button) {
            button.setHidden(true);
        }
    }

    let _ = apply_vibrancy(
        window,
        NSVisualEffectMaterial::Popover,
        Some(NSVisualEffectState::Active),
        Some(14.0),
    );
}

fn toggle_main_window_from_tray(app: &tauri::AppHandle, rect: tauri::Rect) {
    if let Some(window) = app.get_webview_window("main") {
        if let Some(guard) = app.try_state::<WindowFocusGuard>() {
            let _ = guard.suppress_for(Duration::from_millis(500));
        }

        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            return;
        }

        if let (Ok(size), Ok(scale_factor)) = (window.outer_size(), window.scale_factor()) {
            let tray_position = rect.position.to_physical::<i32>(scale_factor);
            let tray_size = rect.size.to_physical::<u32>(scale_factor);
            let tray_center_x = tray_position.x + (tray_size.width as i32 / 2);
            let tray_center_y = tray_position.y + (tray_size.height as i32 / 2);
            let window_width = size.width as i32;
            let window_height = size.height as i32;
            let gap = 8;

            let monitor = app
                .available_monitors()
                .ok()
                .and_then(|monitors| {
                    monitors.into_iter().find(|monitor| {
                        let position = monitor.position();
                        let size = monitor.size();
                        let right = position.x + size.width as i32;
                        let bottom = position.y + size.height as i32;
                        tray_center_x >= position.x
                            && tray_center_x <= right
                            && tray_center_y >= position.y
                            && tray_center_y <= bottom
                    })
                })
                .or_else(|| window.current_monitor().ok().flatten());

            let mut x = tray_center_x - (window_width / 2);
            let mut y = tray_position.y + tray_size.height as i32 + gap;

            if let Some(monitor) = monitor {
                let work_area = monitor.work_area();
                let work_left = work_area.position.x;
                let work_top = work_area.position.y;
                let work_right = work_left + work_area.size.width as i32;
                let work_bottom = work_top + work_area.size.height as i32;
                let tray_bottom = tray_position.y + tray_size.height as i32;
                let space_above = tray_position.y - work_top;
                let space_below = work_bottom - tray_bottom;
                let work_mid_y = work_top + ((work_bottom - work_top) / 2);
                let place_above = space_below < window_height + gap
                    && (space_above >= window_height + gap || tray_center_y > work_mid_y);

                if place_above {
                    y = tray_position.y - window_height - gap;
                }

                x = x.clamp(work_left, work_right.saturating_sub(window_width));
                y = y.clamp(work_top, work_bottom.saturating_sub(window_height));
            }

            let _ = window.set_position(PhysicalPosition::new(x, y));
        }

        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeAnnouncePayload<'a> {
    bridge_id: Option<&'a str>,
    bridge_name: &'a str,
    platform: &'a str,
    client_version: String,
    inventory: &'a AudioInventory,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeAnnounceResponse {
    bridge: BridgeAnnounceBridge,
    bridge_token: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeAnnounceBridge {
    id: String,
    name: String,
    last_seen_at: String,
}

#[derive(Debug, Deserialize)]
struct BridgeAnnounceError {
    error: Option<String>,
}

struct BridgeHttpClient {
    client: reqwest::Client,
    local_insecure_client: Mutex<Option<reqwest::Client>>,
}

#[derive(Default)]
struct WindowFocusGuard {
    suppress_hide_until: Mutex<Option<Instant>>,
}

#[derive(Default)]
struct TrayToggleGuard {
    #[cfg(not(target_os = "macos"))]
    suppress_toggle_until: Mutex<Option<Instant>>,
}

#[derive(Default)]
struct TrayAutostartMenuItem {
    item: Mutex<Option<CheckMenuItem<Wry>>>,
}

const WINDOW_FOCUS_HIDE_DELAY: Duration = Duration::from_millis(150);
const BRIDGE_HTTP_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

impl WindowFocusGuard {
    fn suppress_for(&self, duration: Duration) -> Result<(), String> {
        let mut suppress_hide_until = self
            .suppress_hide_until
            .lock()
            .map_err(|_| "window focus guard lock poisoned".to_string())?;
        *suppress_hide_until = Some(Instant::now() + duration);
        Ok(())
    }

    fn should_suppress_hide(&self) -> bool {
        self.suppress_hide_until
            .lock()
            .ok()
            .and_then(|value| *value)
            .is_some_and(|until| Instant::now() < until)
    }
}

#[cfg(not(target_os = "macos"))]
impl TrayToggleGuard {
    fn accept(&self) -> bool {
        let now = Instant::now();
        let Ok(mut suppress_toggle_until) = self.suppress_toggle_until.lock() else {
            return false;
        };

        if suppress_toggle_until.is_some_and(|until| now < until) {
            return false;
        }

        *suppress_toggle_until = Some(now + Duration::from_millis(250));
        true
    }
}

#[cfg(not(target_os = "macos"))]
fn handle_tray_left_click(app: &AppHandle, rect: tauri::Rect) {
    if let Some(guard) = app.try_state::<TrayToggleGuard>() {
        if !guard.accept() {
            return;
        }
    }

    toggle_main_window_from_tray(app, rect);
}

fn hide_main_window_after_focus_check(window: tauri::Window<Wry>) {
    std::thread::spawn(move || {
        std::thread::sleep(WINDOW_FOCUS_HIDE_DELAY);
        // Serialize the final check and hide with tray events. A background
        // thread must not hide a window that a tray click has just reopened.
        let app = window.app_handle().clone();
        let _ = app.run_on_main_thread(move || {
            if window.is_focused().unwrap_or(false) {
                return;
            }
            let should_suppress = window
                .app_handle()
                .try_state::<WindowFocusGuard>()
                .is_some_and(|guard| guard.should_suppress_hide());
            if !should_suppress {
                let _ = window.hide();
            }
        });
    });
}

fn set_tray_autostart_checked(app: &AppHandle, enabled: bool) {
    if let Some(state) = app.try_state::<TrayAutostartMenuItem>() {
        if let Ok(item) = state.item.lock() {
            if let Some(item) = item.as_ref() {
                let _ = item.set_checked(enabled);
            }
        }
    }
}

fn toggle_autostart_from_tray(app: &AppHandle) {
    if let Some(manager) = app.try_state::<AutoLaunchManager>() {
        let next_enabled = !manager.is_enabled().unwrap_or(false);
        let result = if next_enabled {
            manager.enable()
        } else {
            manager.disable()
        };

        if result.is_ok() {
            let enabled = manager.is_enabled().unwrap_or(next_enabled);
            set_tray_autostart_checked(app, enabled);
            let _ = app.emit("autostart-changed", enabled);
        }
    }
}

fn bridge_client_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

impl BridgeHttpClient {
    fn new() -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .build()
            .map_err(|err| format!("failed to build bridge HTTP client: {err}"))?;
        Ok(Self {
            client,
            local_insecure_client: Mutex::new(None),
        })
    }

    fn for_server(
        &self,
        server_url: &str,
        allow_insecure_tls: bool,
    ) -> Result<reqwest::Client, String> {
        if !allow_insecure_tls {
            return Ok(self.client.clone());
        }
        if !is_local_tls_server(server_url) {
            return Err(
                "Untrusted TLS is only allowed for an explicitly selected local HTTPS server"
                    .into(),
            );
        }
        let mut cached = self
            .local_insecure_client
            .lock()
            .map_err(|_| "TLS client is unavailable")?;
        if cached.is_none() {
            *cached = Some(
                reqwest::Client::builder()
                    .danger_accept_invalid_certs(allow_insecure_tls)
                    // Never carry this local-only exception to a redirected host.
                    .redirect(reqwest::redirect::Policy::none())
                    .connect_timeout(Duration::from_secs(5))
                    .build()
                    .map_err(|err| format!("Cannot build local TLS client: {err}"))?,
            );
        }
        Ok(cached.as_ref().unwrap().clone())
    }
}

fn is_local_tls_server(value: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value) else {
        return false;
    };
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_matches(['[', ']']);
    match host.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(ip)) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
        Ok(std::net::IpAddr::V6(ip)) => {
            ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local()
        }
        Err(_) => {
            host == "localhost"
                || host.ends_with(".local")
                || host.ends_with(".localhost")
                || host.ends_with(".home.arpa")
        }
    }
}

#[derive(Default)]
struct BridgeEventStreamManager {
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl BridgeEventStreamManager {
    fn start(&self, stream_id: &str) -> Result<Arc<AtomicBool>, String> {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let mut active = self
            .active
            .lock()
            .map_err(|_| "bridge event stream manager lock poisoned".to_string())?;
        if let Some(existing) = active.insert(stream_id.to_string(), stop_flag.clone()) {
            existing.store(true, Ordering::SeqCst);
        }
        Ok(stop_flag)
    }

    fn stop(&self, stream_id: &str) -> Result<(), String> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "bridge event stream manager lock poisoned".to_string())?;
        if let Some(existing) = active.remove(stream_id) {
            existing.store(true, Ordering::SeqCst);
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeEventStreamRequest {
    #[serde(default)]
    allow_insecure_tls: bool,
    stream_id: String,
    server_url: String,
    api_key: String,
    path: String,
    input_stream_id: String,
    output_stream_prefix: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BridgeEventStreamMessage {
    stream_id: String,
    event: String,
    data: Option<String>,
    error: Option<String>,
}

#[tauri::command(async)]
fn list_audio_devices() -> Result<AudioInventory, String> {
    let mut inventory = audio::list_audio_devices()?;
    inventory.video_sources = list_video_sources();
    Ok(inventory)
}

#[tauri::command(async)]
fn get_audio_device_snapshot() -> Result<AudioDeviceSnapshot, String> {
    audio::list_audio_device_snapshot()
}

#[tauri::command(async)]
fn get_ndi_status() -> ndi::NdiStatus {
    network_audio::ndi_status(Duration::from_millis(250))
}

#[tauri::command(async)]
fn get_omt_status() -> omt::OmtStatus {
    network_audio::omt_status(Duration::from_millis(250))
}

#[tauri::command]
fn get_bridge_status() -> BridgeStatus {
    BridgeStatus::default()
}

#[tauri::command]
fn get_bridge_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn suppress_window_focus_hide(
    milliseconds: Option<u64>,
    guard: tauri::State<'_, WindowFocusGuard>,
) -> Result<(), String> {
    let milliseconds = milliseconds.unwrap_or(500).clamp(100, 5_000);
    guard.suppress_for(Duration::from_millis(milliseconds))
}

#[tauri::command]
fn get_autostart_enabled(manager: tauri::State<'_, AutoLaunchManager>) -> Result<bool, String> {
    manager
        .is_enabled()
        .map_err(|err| format!("failed to read autostart setting: {err}"))
}

#[tauri::command]
fn set_autostart_enabled(
    enabled: bool,
    app: AppHandle,
    manager: tauri::State<'_, AutoLaunchManager>,
) -> Result<bool, String> {
    if enabled {
        manager
            .enable()
            .map_err(|err| format!("failed to enable autostart: {err}"))?;
    } else {
        manager
            .disable()
            .map_err(|err| format!("failed to disable autostart: {err}"))?;
    }
    let enabled = manager
        .is_enabled()
        .map_err(|err| format!("failed to read autostart setting: {err}"))?;
    set_tray_autostart_checked(&app, enabled);
    let _ = app.emit("autostart-changed", enabled);
    Ok(enabled)
}

#[tauri::command]
fn resize_main_window_to_content(app: AppHandle, height: f64) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let scale_factor = window
        .scale_factor()
        .map_err(|err| format!("failed to read window scale factor: {err}"))?;
    let inner_size = window
        .inner_size()
        .map_err(|err| format!("failed to read window size: {err}"))?;
    let logical_size = inner_size.to_logical::<f64>(scale_factor);
    let height = height.clamp(260.0, 820.0);
    window
        .set_size(Size::Logical(LogicalSize::new(logical_size.width, height)))
        .map_err(|err| format!("failed to resize window: {err}"))
}

#[tauri::command]
async fn announce_bridge(
    app: AppHandle,
    server_url: String,
    api_key: String,
    allow_insecure_tls: Option<bool>,
    bridge_id: Option<String>,
    bridge_name: String,
    inventory: AudioInventory,
) -> Result<BridgeAnnounceResponse, String> {
    let server_url = normalize_server_url(&server_url)?;
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("API key or bridge token is required".to_string());
    }

    let bridge_id = bridge_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let bridge_name = bridge_name.trim();
    let bridge_name = if bridge_name.is_empty() {
        "Bridge"
    } else {
        bridge_name
    };
    let payload = BridgeAnnouncePayload {
        bridge_id,
        bridge_name,
        platform: bridge_client_platform(),
        client_version: app.package_info().version.to_string(),
        inventory: &inventory,
    };

    let response = app
        .state::<BridgeHttpClient>()
        .for_server(&server_url, allow_insecure_tls.unwrap_or(false))?
        .post(format!("{server_url}/api/v1/bridge/announce"))
        .bearer_auth(api_key)
        .json(&payload)
        .timeout(BRIDGE_HTTP_REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|err| format!("bridge announce request failed: {err}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("failed to read bridge announce response: {err}"))?;

    if !status.is_success() {
        let parsed_error = serde_json::from_str::<BridgeAnnounceError>(&body)
            .ok()
            .and_then(|payload| payload.error)
            .filter(|message| !message.trim().is_empty())
            .unwrap_or_else(|| format!("bridge announce failed with HTTP {status}"));
        return Err(parsed_error);
    }

    serde_json::from_str::<BridgeAnnounceResponse>(&body)
        .map_err(|err| format!("failed to parse bridge announce response: {err}"))
}

#[tauri::command]
async fn bridge_api_request(
    server_url: String,
    api_key: String,
    allow_insecure_tls: Option<bool>,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
    http: tauri::State<'_, BridgeHttpClient>,
) -> Result<serde_json::Value, String> {
    let server_url = normalize_server_url(&server_url)?;
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("API key or bridge token is required".to_string());
    }
    let path = path.trim();
    if !path.starts_with("/api/v1/bridge/") {
        return Err("Bridge API path is not allowed".to_string());
    }
    let method = reqwest::Method::from_bytes(method.trim().to_uppercase().as_bytes())
        .map_err(|_| "Invalid bridge API method".to_string())?;
    let mut request = http
        .for_server(&server_url, allow_insecure_tls.unwrap_or(false))?
        .request(method, format!("{server_url}{path}"))
        .bearer_auth(api_key)
        .timeout(BRIDGE_HTTP_REQUEST_TIMEOUT);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|err| format!("bridge API request failed: {err}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("failed to read bridge API response: {err}"))?;
    if !status.is_success() {
        let parsed_error = serde_json::from_str::<BridgeAnnounceError>(&text)
            .ok()
            .and_then(|payload| payload.error)
            .filter(|message| !message.trim().is_empty())
            .unwrap_or_else(|| format!("bridge API request failed with HTTP {status}"));
        return Err(parsed_error);
    }
    if text.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }
    serde_json::from_str(&text).map_err(|err| format!("failed to parse bridge API response: {err}"))
}

#[tauri::command(async)]
fn list_video_sources() -> Vec<video_media::VideoSource> {
    let mut sources = ndi::video_sources(Duration::from_millis(250));
    sources.extend(omt::video_sources(Duration::from_millis(250)));
    sources.extend(webcam::video_sources());
    sources
}
#[tauri::command(async)]
fn start_bridge_video(
    request: video_media::StartVideoRequest,
    manager: tauri::State<'_, video_media::VideoManager>,
) -> Result<(), String> {
    manager.start(request)
}
#[tauri::command(async)]
fn stop_bridge_video(
    stream_id: String,
    manager: tauri::State<'_, video_media::VideoManager>,
) -> Result<(), String> {
    manager.stop(&stream_id)
}
#[tauri::command(async)]
fn get_bridge_video_status(
    manager: tauri::State<'_, video_media::VideoManager>,
) -> Result<Vec<video_media::VideoStatus>, String> {
    manager.status()
}

#[tauri::command]
fn start_bridge_input(
    request: StartBridgeInputRequest,
    manager: tauri::State<'_, BridgeMediaManager>,
) -> Result<BridgeMediaStatus, String> {
    manager.start_input(request)
}

#[tauri::command]
fn stop_bridge_input(
    stream_id: String,
    manager: tauri::State<'_, BridgeMediaManager>,
) -> Result<BridgeMediaStatus, String> {
    manager.stop_input(stream_id)
}

#[tauri::command]
fn reserve_bridge_output(
    request: ReserveBridgeOutputRequest,
    manager: tauri::State<'_, BridgeMediaManager>,
) -> Result<ReservedBridgeOutput, String> {
    manager.reserve_output(request)
}

#[tauri::command]
fn ensure_bridge_output_endpoint(
    request: EnsureBridgeOutputEndpointRequest,
    manager: tauri::State<'_, BridgeMediaManager>,
) -> Result<BridgeMediaStatus, String> {
    manager.ensure_output_endpoint(request)
}

#[tauri::command]
fn release_bridge_output_endpoint(
    endpoint_id: String,
    manager: tauri::State<'_, BridgeMediaManager>,
) -> Result<BridgeMediaStatus, String> {
    manager.release_output_endpoint(endpoint_id)
}

#[tauri::command]
fn activate_bridge_output(
    request: ActivateBridgeOutputRequest,
    manager: tauri::State<'_, BridgeMediaManager>,
) -> Result<BridgeMediaStatus, String> {
    manager.activate_output(request)
}

#[tauri::command]
fn stop_bridge_output(
    stream_id: String,
    manager: tauri::State<'_, BridgeMediaManager>,
) -> Result<BridgeMediaStatus, String> {
    manager.stop_output(stream_id)
}

#[tauri::command]
fn set_bridge_output_level(
    request: SetBridgeOutputLevelRequest,
    manager: tauri::State<'_, BridgeMediaManager>,
) -> Result<BridgeMediaStatus, String> {
    manager.set_output_level(request)
}

#[tauri::command]
fn set_bridge_port_audio_level(
    request: SetBridgePortAudioLevelRequest,
    manager: tauri::State<'_, BridgeMediaManager>,
) -> Result<BridgeMediaStatus, String> {
    manager.set_port_audio_level(request)
}

#[tauri::command]
fn stop_all_bridge_media(
    video: tauri::State<'_, video_media::VideoManager>,
    manager: tauri::State<'_, BridgeMediaManager>,
) -> Result<BridgeMediaStatus, String> {
    video.stop_all()?;
    manager.stop_all()
}

#[tauri::command(async)]
fn get_bridge_media_status(
    manager: tauri::State<'_, BridgeMediaManager>,
) -> Result<BridgeMediaStatus, String> {
    manager.status()
}

fn normalize_server_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Server URL is required".to_string());
    }

    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let parsed = reqwest::Url::parse(&candidate).map_err(|_| "Server URL is invalid")?;
    if !matches!(parsed.scheme(), "https" | "http") {
        return Err("Server URL must use HTTPS or HTTP".to_string());
    }
    if parsed.host_str().is_none() || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Server URL must contain a valid host without credentials".to_string());
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("Server URL must not contain a query or fragment".to_string());
    }
    Ok(parsed.to_string().trim_end_matches('/').to_string())
}

#[tauri::command]
fn start_bridge_event_stream(
    request: BridgeEventStreamRequest,
    app: tauri::AppHandle,
    http: tauri::State<'_, BridgeHttpClient>,
    streams: tauri::State<'_, BridgeEventStreamManager>,
) -> Result<(), String> {
    let server_url = normalize_server_url(&request.server_url)?;
    let api_key = request.api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("API key or bridge token is required".to_string());
    }
    let path = request.path.trim().to_string();
    if !path.starts_with("/api/v1/bridge/") {
        return Err("Bridge event stream path is not allowed".to_string());
    }
    let heartbeat_path = bridge_event_stream_heartbeat_path(&path)?;
    let stream_id = request.stream_id.trim().to_string();
    if stream_id.is_empty() {
        return Err("Bridge event stream id is required".to_string());
    }
    let input_stream_id = request.input_stream_id.trim().to_string();
    if input_stream_id.is_empty() {
        return Err("Bridge input stream id is required".to_string());
    }
    let output_stream_prefix = request.output_stream_prefix.trim().to_string();
    if output_stream_prefix.is_empty() {
        return Err("Bridge output stream prefix is required".to_string());
    }

    let stop_flag = streams.start(&stream_id)?;
    let client = http.for_server(&server_url, request.allow_insecure_tls)?;
    tauri::async_runtime::spawn(async move {
        tauri::async_runtime::spawn(run_bridge_health_reporter(
            app.clone(),
            client.clone(),
            server_url.clone(),
            api_key.clone(),
            heartbeat_path,
            input_stream_id,
            output_stream_prefix,
            stop_flag.clone(),
        ));
        if let Err(error) = run_bridge_event_stream(
            app.clone(),
            client,
            stream_id.clone(),
            server_url,
            api_key,
            path,
            stop_flag.clone(),
        )
        .await
        {
            emit_bridge_event_stream_message(&app, &stream_id, "error", None, Some(error));
        }
        stop_flag.store(true, Ordering::SeqCst);
        emit_bridge_event_stream_message(&app, &stream_id, "closed", None, None);
    });
    Ok(())
}

#[tauri::command]
fn stop_bridge_event_stream(
    stream_id: String,
    streams: tauri::State<'_, BridgeEventStreamManager>,
) -> Result<(), String> {
    streams.stop(stream_id.trim())
}

fn bridge_event_stream_heartbeat_path(path: &str) -> Result<String, String> {
    path.strip_suffix("/events/stream")
        .map(|session_path| format!("{session_path}/heartbeat"))
        .ok_or_else(|| "Bridge event stream path must end with /events/stream".to_string())
}

fn bridge_media_diagnostics(
    status: BridgeMediaStatus,
    input_stream_id: &str,
    output_stream_prefix: &str,
) -> Option<serde_json::Value> {
    let input = status
        .input_stream_stats
        .into_iter()
        .find(|entry| entry.stream_id == input_stream_id);
    let outputs = status
        .output_stream_stats
        .into_iter()
        .filter(|entry| entry.stream_id.starts_with(output_stream_prefix))
        .collect::<Vec<_>>();
    if input.is_none() && outputs.is_empty() {
        return None;
    }
    Some(serde_json::json!({
        "input": input,
        "outputs": outputs,
    }))
}

fn bridge_health_report_payload(
    diagnostics: Option<serde_json::Value>,
    round_trip_ms: Option<u64>,
) -> serde_json::Value {
    serde_json::json!({
        "mediaDiagnostics": diagnostics,
        "networkStats": round_trip_ms.map(|value| serde_json::json!({ "roundTripMs": value })),
        "lifecycleEvents": [],
    })
}

async fn run_bridge_health_reporter(
    app: tauri::AppHandle,
    client: reqwest::Client,
    server_url: String,
    api_key: String,
    heartbeat_path: String,
    input_stream_id: String,
    output_stream_prefix: String,
    stop_flag: Arc<AtomicBool>,
) {
    let mut last_round_trip: Option<(Instant, u64)> = None;
    loop {
        tokio::time::sleep(Duration::from_secs(10)).await;
        if stop_flag.load(Ordering::SeqCst) {
            return;
        }

        let diagnostics = match app.state::<BridgeMediaManager>().status() {
            Ok(status) => bridge_media_diagnostics(status, &input_stream_id, &output_stream_prefix),
            Err(error) => {
                eprintln!(
                    "[bridge-health][{input_stream_id}] failed to read media status: {error}"
                );
                None
            }
        };
        let round_trip_ms = last_round_trip
            .filter(|(measured_at, _)| measured_at.elapsed() < Duration::from_secs(30))
            .map(|(_, value)| value);
        let started_at = Instant::now();
        let response = client
            .post(format!("{server_url}{heartbeat_path}"))
            .bearer_auth(&api_key)
            .json(&bridge_health_report_payload(diagnostics, round_trip_ms))
            .timeout(BRIDGE_HTTP_REQUEST_TIMEOUT)
            .send()
            .await;
        match response {
            Ok(response) if response.status().is_success() => match response.bytes().await {
                Ok(_) => {
                    last_round_trip =
                        Some((Instant::now(), started_at.elapsed().as_millis() as u64));
                }
                Err(error) => eprintln!(
                    "[bridge-health][{input_stream_id}] heartbeat response failed: {error}"
                ),
            },
            Ok(response) => eprintln!(
                "[bridge-health][{input_stream_id}] heartbeat failed with HTTP {}",
                response.status()
            ),
            Err(error) => {
                eprintln!("[bridge-health][{input_stream_id}] heartbeat request failed: {error}")
            }
        }
    }
}

async fn run_bridge_event_stream(
    app: tauri::AppHandle,
    client: reqwest::Client,
    stream_id: String,
    server_url: String,
    api_key: String,
    path: String,
    stop_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let response = client
        .get(format!("{server_url}{path}"))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|err| format!("bridge event stream request failed: {err}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("bridge event stream failed with HTTP {status}"));
    }

    emit_bridge_event_stream_message(&app, &stream_id, "open", None, None);

    let mut pending = String::new();
    let mut event_name = String::new();
    let mut data_lines: Vec<String> = Vec::new();
    let mut body = response.bytes_stream();
    while let Some(chunk) = body.next().await {
        if stop_flag.load(Ordering::SeqCst) {
            return Ok(());
        }
        let chunk = chunk.map_err(|err| format!("bridge event stream read failed: {err}"))?;
        pending.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(newline) = pending.find('\n') {
            let mut line = pending[..newline].to_string();
            pending = pending[newline + 1..].to_string();
            if line.ends_with('\r') {
                line.pop();
            }
            if line.is_empty() {
                if !event_name.is_empty() || !data_lines.is_empty() {
                    let data = if data_lines.is_empty() {
                        None
                    } else {
                        Some(data_lines.join("\n"))
                    };
                    let event = if event_name.is_empty() {
                        "message"
                    } else {
                        event_name.as_str()
                    };
                    emit_bridge_event_stream_message(&app, &stream_id, event, data, None);
                    event_name.clear();
                    data_lines.clear();
                }
                continue;
            }
            if line.starts_with(':') {
                continue;
            }
            if let Some(value) = line.strip_prefix("event:") {
                event_name = value.trim_start().to_string();
            } else if let Some(value) = line.strip_prefix("data:") {
                data_lines.push(value.trim_start().to_string());
            }
        }
    }
    Ok(())
}

fn emit_bridge_event_stream_message(
    app: &tauri::AppHandle,
    stream_id: &str,
    event: &str,
    data: Option<String>,
    error: Option<String>,
) {
    let _ = app.emit(
        "bridge-event-stream-message",
        BridgeEventStreamMessage {
            stream_id: stream_id.to_string(),
            event: event.to_string(),
            data,
            error,
        },
    );
}

#[tauri::command]
fn start_audio_probe(
    request: ProbeStartRequest,
    manager: tauri::State<'_, ProbeManager>,
) -> Result<ProbeStatus, String> {
    manager.start(request)
}

#[tauri::command]
fn stop_audio_probe_port(
    port_id: String,
    manager: tauri::State<'_, ProbeManager>,
) -> Result<Vec<ProbeStatus>, String> {
    manager.stop(port_id)
}

#[tauri::command]
fn stop_all_audio_probe_ports(
    manager: tauri::State<'_, ProbeManager>,
) -> Result<Vec<ProbeStatus>, String> {
    manager.stop_all()
}

#[tauri::command]
fn get_audio_probe_ports_status(
    manager: tauri::State<'_, ProbeManager>,
) -> Result<Vec<ProbeStatus>, String> {
    manager.statuses()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let http = BridgeHttpClient::new().expect("failed to initialize bridge HTTP client");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .manage(ProbeManager::default())
        .manage(BridgeMediaManager::default())
        .manage(video_media::VideoManager::default())
        .manage(BridgeEventStreamManager::default())
        .manage(WindowFocusGuard::default())
        .manage(TrayToggleGuard::default())
        .manage(TrayAutostartMenuItem::default())
        .manage(http)
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                {
                    let _ = window.set_closable(false);
                    prepare_macos_panel_window(&window);
                }
            }

            let autostart_enabled = app
                .try_state::<AutoLaunchManager>()
                .and_then(|manager| manager.is_enabled().ok())
                .unwrap_or(false);
            let autostart = CheckMenuItem::with_id(
                app,
                TRAY_AUTOSTART_ID,
                "Run at login",
                true,
                autostart_enabled,
                None::<&str>,
            )?;
            if let Some(state) = app.try_state::<TrayAutostartMenuItem>() {
                if let Ok(mut item) = state.item.lock() {
                    *item = Some(autostart.clone());
                }
            }
            let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&autostart, &quit])?;

            let mut tray = TrayIconBuilder::with_id("talktome-bridge")
                .tooltip("Talktome Bridge")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    TRAY_AUTOSTART_ID => toggle_autostart_from_tray(app),
                    TRAY_QUIT_ID => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    #[cfg(target_os = "windows")]
                    TrayIconEvent::Click {
                        rect,
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Down | MouseButtonState::Up,
                        ..
                    } => handle_tray_left_click(tray.app_handle(), rect),
                    // On macOS act on press, before the delayed focus-loss
                    // hide can run. Waiting for release can hide then reopen
                    // the window on the very same click. One press is one
                    // toggle, so no time-based debounce is needed here.
                    #[cfg(target_os = "macos")]
                    TrayIconEvent::Click {
                        rect,
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Down,
                        ..
                    } => toggle_main_window_from_tray(tray.app_handle(), rect),
                    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
                    TrayIconEvent::Click {
                        rect,
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => handle_tray_left_click(tray.app_handle(), rect),
                    _ => {}
                });

            #[cfg(target_os = "macos")]
            {
                tray = tray
                    .icon(tauri::include_image!("./icons/tray-template.png"))
                    .icon_as_template(true);
            }

            #[cfg(target_os = "windows")]
            {
                tray = tray.icon(tauri::include_image!("./icons/tray-windows.png"));
            }

            #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }

            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    tauri::WindowEvent::Focused(false) => {
                        hide_main_window_after_focus_check(window.clone());
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            credentials::load_bridge_credentials,
            credentials::save_bridge_credentials,
            activate_bridge_output,
            announce_bridge,
            bridge_api_request,
            get_audio_probe_ports_status,
            get_audio_device_snapshot,
            get_autostart_enabled,
            get_bridge_media_status,
            get_bridge_status,
            get_bridge_app_version,
            get_ndi_status,
            get_omt_status,
            ensure_bridge_output_endpoint,
            list_audio_devices,
            reserve_bridge_output,
            release_bridge_output_endpoint,
            resize_main_window_to_content,
            set_bridge_output_level,
            set_bridge_port_audio_level,
            set_autostart_enabled,
            start_audio_probe,
            start_bridge_input,
            list_video_sources,
            start_bridge_video,
            stop_bridge_video,
            get_bridge_video_status,
            start_bridge_event_stream,
            suppress_window_focus_hide,
            stop_all_audio_probe_ports,
            stop_all_bridge_media,
            stop_bridge_event_stream,
            stop_bridge_input,
            stop_bridge_output,
            stop_audio_probe_port
        ])
        .run(tauri::generate_context!())
        .expect("error while running Talktome Bridge");
}

#[cfg(test)]
mod tests {
    use super::{
        bridge_event_stream_heartbeat_path, bridge_health_report_payload, normalize_server_url,
    };

    #[test]
    fn insecure_tls_requires_an_explicit_local_https_origin() {
        for url in [
            "https://192.168.42.11:8443",
            "https://10.0.0.1",
            "https://172.16.1.2",
            "https://127.0.0.1",
            "https://[::1]",
            "https://[fd00::1]",
            "https://intercom.local",
        ] {
            assert!(super::is_local_tls_server(url), "{url}");
        }
        for url in [
            "https://example.com",
            "https://example.local.evil.com",
            "https://8.8.8.8",
            "https://172.32.0.1",
            "http://192.168.1.1",
            "https://[2001:4860:4860::8888]",
        ] {
            assert!(!super::is_local_tls_server(url), "{url}");
        }
        let client = super::BridgeHttpClient::new().unwrap();
        assert!(client.for_server("https://example.com", false).is_ok());
        assert!(client.for_server("https://example.com", true).is_err());
        assert!(client.for_server("https://192.168.1.1", true).is_ok());
    }

    #[test]
    fn native_health_reports_include_rtt_without_webview_timers() {
        let payload = bridge_health_report_payload(None, Some(24));
        assert_eq!(payload["networkStats"]["roundTripMs"], 24);
        assert!(payload["mediaDiagnostics"].is_null());

        let first_report = bridge_health_report_payload(None, None);
        assert!(first_report["networkStats"].is_null());
    }

    #[test]
    fn normalizes_supported_server_urls_without_inventing_a_port() {
        assert_eq!(
            normalize_server_url("intercom.local").unwrap(),
            "https://intercom.local"
        );
        assert_eq!(
            normalize_server_url("https://intercom.local").unwrap(),
            "https://intercom.local"
        );
        assert_eq!(
            normalize_server_url("intercom.local:8443").unwrap(),
            "https://intercom.local:8443"
        );
        assert_eq!(
            normalize_server_url("https://intercom.local:8445").unwrap(),
            "https://intercom.local:8445"
        );
    }

    #[test]
    fn preserves_explicit_and_protocol_default_ports() {
        assert_eq!(
            normalize_server_url("https://intercom.local:3").unwrap(),
            "https://intercom.local:3"
        );
        assert_eq!(
            normalize_server_url("https://intercom.local:443").unwrap(),
            "https://intercom.local"
        );
        assert_eq!(
            normalize_server_url("http://intercom.local").unwrap(),
            "http://intercom.local"
        );
    }

    #[test]
    fn supports_ipv6_and_rejects_unsafe_server_urls() {
        assert_eq!(
            normalize_server_url("https://[::1]").unwrap(),
            "https://[::1]"
        );
        assert!(normalize_server_url("ftp://intercom.local").is_err());
        assert!(normalize_server_url("https://user:secret@intercom.local").is_err());
        assert!(normalize_server_url("https://intercom.local?key=value").is_err());
    }

    #[test]
    fn derives_heartbeat_path_from_bridge_event_stream_path() {
        assert_eq!(
            bridge_event_stream_heartbeat_path("/api/v1/bridge/sessions/session-1/events/stream")
                .unwrap(),
            "/api/v1/bridge/sessions/session-1/heartbeat"
        );
        assert!(
            bridge_event_stream_heartbeat_path("/api/v1/bridge/sessions/session-1/events").is_err()
        );
    }
}
