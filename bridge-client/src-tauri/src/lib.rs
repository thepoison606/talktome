mod audio;
mod bridge_media;
mod model;
mod probe;

use audio::AudioInventory;
use bridge_media::{
    ActivateBridgeOutputRequest, BridgeMediaManager, BridgeMediaStatus, ReserveBridgeOutputRequest,
    ReservedBridgeOutput, SetBridgeOutputLevelRequest, StartBridgeInputRequest,
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
}

#[derive(Default)]
struct WindowFocusGuard {
    suppress_hide_until: Mutex<Option<Instant>>,
}

#[derive(Default)]
struct TrayToggleGuard {
    suppress_toggle_until: Mutex<Option<Instant>>,
}

#[derive(Default)]
struct TrayAutostartMenuItem {
    item: Mutex<Option<CheckMenuItem<Wry>>>,
}

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

fn handle_tray_left_click(app: &AppHandle, rect: tauri::Rect) {
    if let Some(guard) = app.try_state::<TrayToggleGuard>() {
        if !guard.accept() {
            return;
        }
    }

    toggle_main_window_from_tray(app, rect);
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
            .danger_accept_invalid_certs(true)
            .build()
            .map_err(|err| format!("failed to build bridge HTTP client: {err}"))?;
        Ok(Self { client })
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
    stream_id: String,
    server_url: String,
    api_key: String,
    path: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BridgeEventStreamMessage {
    stream_id: String,
    event: String,
    data: Option<String>,
    error: Option<String>,
}

#[tauri::command]
fn list_audio_devices() -> Result<AudioInventory, String> {
    audio::list_audio_devices()
}

#[tauri::command]
fn get_bridge_status() -> BridgeStatus {
    BridgeStatus::default()
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
    server_url: String,
    api_key: String,
    bridge_id: Option<String>,
    bridge_name: String,
    http: tauri::State<'_, BridgeHttpClient>,
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
    let inventory = audio::list_audio_devices()?;
    let payload = BridgeAnnouncePayload {
        bridge_id,
        bridge_name,
        platform: bridge_client_platform(),
        inventory: &inventory,
    };

    let response = http
        .client
        .post(format!("{server_url}/api/v1/bridge/announce"))
        .bearer_auth(api_key)
        .json(&payload)
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
        .client
        .request(method, format!("{server_url}{path}"))
        .bearer_auth(api_key);
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
fn stop_all_bridge_media(
    manager: tauri::State<'_, BridgeMediaManager>,
) -> Result<BridgeMediaStatus, String> {
    manager.stop_all()
}

#[tauri::command]
fn get_bridge_media_status(
    manager: tauri::State<'_, BridgeMediaManager>,
) -> Result<BridgeMediaStatus, String> {
    manager.status()
}

fn normalize_server_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Server URL is required".to_string());
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("https://{trimmed}"))
    }
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
    let stream_id = request.stream_id.trim().to_string();
    if stream_id.is_empty() {
        return Err("Bridge event stream id is required".to_string());
    }

    let stop_flag = streams.start(&stream_id)?;
    let client = http.client.clone();
    tauri::async_runtime::spawn(async move {
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
        .manage(ProbeManager::default())
        .manage(BridgeMediaManager::default())
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
                    #[cfg(not(target_os = "windows"))]
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
                        let should_suppress = window
                            .app_handle()
                            .try_state::<WindowFocusGuard>()
                            .is_some_and(|guard| guard.should_suppress_hide());
                        if !should_suppress {
                            let _ = window.hide();
                        }
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            activate_bridge_output,
            announce_bridge,
            bridge_api_request,
            get_audio_probe_ports_status,
            get_autostart_enabled,
            get_bridge_media_status,
            get_bridge_status,
            list_audio_devices,
            reserve_bridge_output,
            resize_main_window_to_content,
            set_bridge_output_level,
            set_autostart_enabled,
            start_audio_probe,
            start_bridge_input,
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
