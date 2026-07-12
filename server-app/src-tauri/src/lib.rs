use if_addrs::{get_if_addrs, IfAddr};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::env;
use std::fs;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
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

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const TRAY_AUTOSTART_ID: &str = "autostart";
const TRAY_OPEN_ADMIN_ID: &str = "open-admin";
const TRAY_QUIT_ID: &str = "quit";
const MAX_LOG_LINES: usize = 200;
const APP_DATA_DIR_NAME: &str = "talktome";
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Default)]
struct ServerManager {
    child: Option<Child>,
    starting: bool,
    logs: VecDeque<String>,
    started_at: Option<Instant>,
    last_error: Option<String>,
}

#[derive(Default)]
struct TrayAutostartMenuItem {
    item: Mutex<Option<CheckMenuItem<Wry>>>,
}

#[derive(Default)]
struct WindowFocusGuard {
    suppress_hide_until: Mutex<Option<Instant>>,
}

#[derive(Default)]
struct TrayToggleGuard {
    suppress_toggle_until: Mutex<Option<Instant>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerStatus {
    running: bool,
    starting: bool,
    configured: bool,
    config_path: String,
    config: ServerRuntimeConfig,
    pid: Option<u32>,
    uptime_seconds: Option<u64>,
    server_path: Option<String>,
    error: Option<String>,
    logs: Vec<String>,
    available_media_interfaces: Vec<MediaNetworkInterface>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaNetworkInterface {
    name: String,
    address: String,
    label: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerRuntimeConfig {
    #[serde(default = "default_https_port")]
    https_port: u16,
    #[serde(default = "default_mdns_host")]
    mdns_host: String,
    #[serde(default = "default_http_port")]
    http_port: String,
    #[serde(default = "default_rtc_port_start")]
    rtc_port_start: u16,
    #[serde(default = "default_rtc_port_count")]
    rtc_port_count: u16,
    #[serde(default = "default_media_network_mode")]
    media_network_mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    media_interface_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    media_announced_address: Option<String>,
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

impl ServerManager {
    fn push_log(&mut self, line: impl Into<String>) {
        self.logs.push_back(line.into());
        while self.logs.len() > MAX_LOG_LINES {
            self.logs.pop_front();
        }
    }

    fn refresh_child_state(&mut self) {
        if let Some(child) = self.child.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    self.push_log(format!("Server exited with status {status}."));
                    self.child = None;
                    self.starting = false;
                    self.started_at = None;
                }
                Ok(None) => {}
                Err(err) => {
                    self.last_error = Some(format!("failed to read server status: {err}"));
                    self.child = None;
                    self.starting = false;
                    self.started_at = None;
                }
            }
        }
    }
}

fn default_https_port() -> u16 {
    8443
}

fn default_mdns_host() -> String {
    "intercom.local".to_string()
}

fn default_http_port() -> String {
    "off".to_string()
}

fn default_rtc_port_start() -> u16 {
    40000
}

fn default_rtc_port_count() -> u16 {
    10000
}

fn default_media_network_mode() -> String {
    "auto".to_string()
}

impl Default for ServerRuntimeConfig {
    fn default() -> Self {
        Self {
            https_port: default_https_port(),
            mdns_host: default_mdns_host(),
            http_port: default_http_port(),
            rtc_port_start: default_rtc_port_start(),
            rtc_port_count: default_rtc_port_count(),
            media_network_mode: default_media_network_mode(),
            media_interface_name: None,
            media_announced_address: None,
        }
    }
}

fn talktome_data_dir() -> PathBuf {
    if let Ok(override_dir) = env::var("TALKTOME_DATA_DIR") {
        let trimmed = override_dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = env::var("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join(APP_DATA_DIR_NAME);
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            return PathBuf::from(local_app_data).join(APP_DATA_DIR_NAME);
        }
        if let Ok(app_data) = env::var("APPDATA") {
            return PathBuf::from(app_data).join(APP_DATA_DIR_NAME);
        }
        if let Ok(profile) = env::var("USERPROFILE") {
            return PathBuf::from(profile)
                .join("AppData")
                .join("Local")
                .join(APP_DATA_DIR_NAME);
        }
    }

    let base = env::var("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|_| env::var("HOME").map(|home| PathBuf::from(home).join(".local").join("share")))
        .unwrap_or_else(|_| PathBuf::from("."));
    base.join(APP_DATA_DIR_NAME)
}

fn runtime_config_path() -> PathBuf {
    talktome_data_dir().join("config.json")
}

fn companion_api_key_path() -> PathBuf {
    talktome_data_dir().join("companion_api_key")
}

fn load_runtime_config() -> Option<ServerRuntimeConfig> {
    let path = runtime_config_path();
    let contents = fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn normalized_runtime_config(
    mut config: ServerRuntimeConfig,
) -> Result<ServerRuntimeConfig, String> {
    if config.https_port == 0 {
        return Err("HTTPS port must be between 1 and 65535.".to_string());
    }
    if config.rtc_port_start == 0 {
        return Err("RTC start port must be between 1 and 65535.".to_string());
    }
    if config.rtc_port_count == 0 {
        return Err("RTC port count must be at least 1.".to_string());
    }
    let rtc_end = u32::from(config.rtc_port_start) + u32::from(config.rtc_port_count) - 1;
    if rtc_end > 65535 {
        return Err("RTC port range exceeds 65535.".to_string());
    }

    config.mdns_host = config.mdns_host.trim().to_string();
    if config.mdns_host.is_empty() {
        config.mdns_host = "off".to_string();
    }

    config.http_port = config.http_port.trim().to_string();
    if config.http_port.is_empty() {
        config.http_port = "off".to_string();
    } else if config.http_port != "off" {
        let parsed = config
            .http_port
            .parse::<u16>()
            .map_err(|_| "HTTP redirect port must be a port number or off.".to_string())?;
        if parsed == 0 {
            return Err("HTTP redirect port must be between 1 and 65535 or off.".to_string());
        }
        config.http_port = parsed.to_string();
    }

    config.media_network_mode = config.media_network_mode.trim().to_string();
    if config.media_network_mode.is_empty() {
        config.media_network_mode = "auto".to_string();
    }
    if !matches!(
        config.media_network_mode.as_str(),
        "auto" | "interface" | "manual"
    ) {
        return Err("Media network mode must be automatic, interface or manual.".to_string());
    }

    config.media_interface_name = config.media_interface_name.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    config.media_announced_address = config.media_announced_address.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    if config.media_network_mode == "manual" && config.media_announced_address.is_none() {
        return Err("Manual media network mode requires an announced address.".to_string());
    }
    if config.media_network_mode == "interface" && config.media_interface_name.is_none() {
        return Err("Preferred media network adapter is required.".to_string());
    }
    if config.media_network_mode != "manual" {
        config.media_announced_address = None;
    }
    if config.media_network_mode != "interface" {
        config.media_interface_name = None;
    }

    Ok(config)
}

fn get_available_media_network_interfaces() -> Vec<MediaNetworkInterface> {
    let Ok(interfaces) = get_if_addrs() else {
        return Vec::new();
    };

    interfaces
        .into_iter()
        .filter_map(|interface| {
            if interface.is_loopback() {
                return None;
            }
            let IfAddr::V4(addr) = interface.addr else {
                return None;
            };
            let address = addr.ip.to_string();
            if address == "0.0.0.0" {
                return None;
            }
            Some(MediaNetworkInterface {
                label: format!("{} - {}", interface.name, address),
                name: interface.name,
                address,
            })
        })
        .collect()
}

fn write_runtime_config(config: &ServerRuntimeConfig) -> Result<PathBuf, String> {
    let path = runtime_config_path();
    let parent = path
        .parent()
        .ok_or_else(|| "runtime config path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|err| format!("failed to create config dir: {err}"))?;
    let contents = serde_json::to_string_pretty(config)
        .map_err(|err| format!("failed to serialize config: {err}"))?;
    fs::write(&path, format!("{contents}\n"))
        .map_err(|err| format!("failed to write config: {err}"))?;
    Ok(path)
}

fn admin_url_from_config() -> String {
    let config = load_runtime_config().unwrap_or_default();
    let host = if config.mdns_host.trim().is_empty() || config.mdns_host == "off" {
        "localhost".to_string()
    } else {
        config.mdns_host
    };
    let port_suffix = if config.https_port == 443 {
        String::new()
    } else {
        format!(":{}", config.https_port)
    };
    format!("https://{host}{port_suffix}/admin")
}

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

fn target_triple() -> &'static str {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "x86_64-unknown-linux-gnu"
    } else {
        "unknown"
    }
}

fn server_binary_names() -> Vec<String> {
    let triple = target_triple();
    if cfg!(target_os = "windows") {
        vec![
            "talktome-server.exe".to_string(),
            format!("talktome-server-{triple}.exe"),
            "talktome_win64.exe".to_string(),
        ]
    } else {
        vec![
            "talktome-server".to_string(),
            format!("talktome-server-{triple}"),
            "talktome_arm64".to_string(),
            "talktome".to_string(),
        ]
    }
}

fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

fn find_named_binary_direct(base: &Path, names: &[String]) -> Option<PathBuf> {
    for name in names {
        let candidate = base.join(name);
        if is_executable_file(&candidate) {
            return Some(candidate);
        }
    }

    None
}

fn bundled_server_binary_candidates(current_exe_dir: &Path, names: &[String]) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    let resource_dirs = [
        current_exe_dir.join("../Resources"),
        current_exe_dir.join("../Resources/server"),
        current_exe_dir.join("../Resources/binaries"),
        current_exe_dir.join("../../.."),
    ];

    for dir in resource_dirs {
        for name in names {
            candidates.push(dir.join(name));
        }
    }

    candidates
}

fn resolve_server_binary(_app: &AppHandle) -> Option<PathBuf> {
    if let Ok(path) = env::var("TALKTOME_SERVER_BIN") {
        let path = PathBuf::from(path);
        if is_executable_file(&path) {
            return Some(path);
        }
    }

    let names = server_binary_names();

    if let Ok(current_exe) = env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            if let Some(path) = find_named_binary_direct(dir, &names) {
                return Some(path);
            }

            for candidate in bundled_server_binary_candidates(dir, &names) {
                if is_executable_file(&candidate) {
                    return Some(candidate);
                }
            }
        }
    }

    if let Ok(current_dir) = env::current_dir() {
        if let Some(path) = find_named_binary_direct(&current_dir, &names) {
            return Some(path);
        }

        for relative_dir in ["..", "../.."] {
            let dir = current_dir.join(relative_dir);
            if let Some(path) = find_named_binary_direct(&dir, &names) {
                return Some(path);
            }
        }
    }

    None
}

fn configure_server_command(_command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        _command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn append_log(app: &AppHandle, line: String) {
    let became_ready = line.contains("HTTPS Server running on port");
    if let Some(state) = app.try_state::<Mutex<ServerManager>>() {
        if let Ok(mut manager) = state.lock() {
            if became_ready {
                manager.starting = false;
            }
            manager.push_log(line.clone());
        }
    }
    let log_path = logs_dir().join("server.log");
    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(file, "{line}");
    }
    let _ = app.emit("server-log", line);
    if became_ready {
        let _ = app.emit("server-status-changed", ());
    }
}

fn spawn_log_reader(app: AppHandle, stream: impl std::io::Read + Send + 'static) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().map_while(Result::ok) {
            append_log(&app, line);
        }
        let _ = app.emit("server-status-changed", ());
    });
}

fn start_server_internal(app: &AppHandle) -> Result<(), String> {
    let config_path = runtime_config_path();
    if !config_path.is_file() {
        return Err(format!(
            "Server setup required. Save first-run settings before starting ({})",
            config_path.display()
        ));
    }

    let binary = resolve_server_binary(app).ok_or_else(|| {
        "Talktome server binary not found. Set TALKTOME_SERVER_BIN or prepare the bundled sidecar."
            .to_string()
    })?;

    let manager = app.state::<Mutex<ServerManager>>();
    let mut state = manager
        .lock()
        .map_err(|_| "server manager lock poisoned".to_string())?;
    state.refresh_child_state();

    if state.child.is_some() || state.starting {
        return Ok(());
    }

    state.starting = true;
    state.last_error = None;
    state.push_log("Starting Talktome server…");
    drop(state);

    let mut command = Command::new(&binary);
    command
        .env("TALKTOME_NO_WIZARD", "1")
        .env("TALKTOME_VERSION", APP_VERSION)
        .env("TALKTOME_DATA_DIR", talktome_data_dir())
        .current_dir(binary.parent().unwrap_or_else(|| Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_server_command(&mut command);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(err) => {
            let message = format!("failed to start Talktome server: {err}");
            if let Ok(mut state) = manager.lock() {
                state.starting = false;
                state.last_error = Some(message.clone());
                state.push_log(message.clone());
            }
            let _ = app.emit("server-status-changed", ());
            return Err(message);
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let pid = child.id();
    let mut state = manager
        .lock()
        .map_err(|_| "server manager lock poisoned".to_string())?;
    state.push_log(format!("Started Talktome server pid {pid}."));
    state.last_error = None;
    state.started_at = Some(Instant::now());
    state.child = Some(child);
    drop(state);

    if let Some(stdout) = stdout {
        spawn_log_reader(app.clone(), stdout);
    }
    if let Some(stderr) = stderr {
        spawn_log_reader(app.clone(), stderr);
    }

    let _ = app.emit("server-status-changed", ());
    Ok(())
}

fn stop_server_internal(app: &AppHandle) -> Result<(), String> {
    let manager = app.state::<Mutex<ServerManager>>();
    let mut state = manager
        .lock()
        .map_err(|_| "server manager lock poisoned".to_string())?;

    if let Some(mut child) = state.child.take() {
        let pid = child.id();
        let _ = child.kill();
        let _ = child.wait();
        state.push_log(format!("Stopped Talktome server pid {pid}."));
    }
    state.starting = false;
    state.started_at = None;
    drop(state);

    let _ = app.emit("server-status-changed", ());
    Ok(())
}

fn restart_server_internal(app: &AppHandle) -> Result<(), String> {
    stop_server_internal(app)?;
    start_server_internal(app)
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

fn open_url(url: &str) -> Result<(), String> {
    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg(url).status()
    } else if cfg!(target_os = "windows") {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", url]);
        configure_server_command(&mut command);
        command.status()
    } else {
        Command::new("xdg-open").arg(url).status()
    }
    .map_err(|err| format!("failed to open URL: {err}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("failed to open URL: {status}"))
    }
}

fn logs_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            return PathBuf::from(local_app_data)
                .join("Talktome Server")
                .join("Logs");
        }
        if let Ok(profile) = env::var("USERPROFILE") {
            return PathBuf::from(profile)
                .join("AppData")
                .join("Local")
                .join("Talktome Server")
                .join("Logs");
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = env::var("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Logs")
                .join("Talktome Server");
        }
    }

    let home = env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".talktome-server").join("logs")
}

#[tauri::command]
fn get_server_status(app: AppHandle) -> Result<ServerStatus, String> {
    let server_path = resolve_server_binary(&app).map(|path| path.display().to_string());
    let config_path = runtime_config_path();
    let configured = config_path.is_file();
    let config = load_runtime_config().unwrap_or_default();
    let manager = app.state::<Mutex<ServerManager>>();
    let mut state = manager
        .lock()
        .map_err(|_| "server manager lock poisoned".to_string())?;
    state.refresh_child_state();

    let running = state.child.is_some() && !state.starting;
    Ok(ServerStatus {
        running,
        starting: state.starting,
        configured,
        config_path: config_path.display().to_string(),
        config,
        pid: state.child.as_ref().map(|child| child.id()),
        uptime_seconds: state
            .started_at
            .filter(|_| running)
            .map(|started_at| started_at.elapsed().as_secs()),
        server_path,
        error: state.last_error.clone(),
        logs: state.logs.iter().cloned().collect(),
        available_media_interfaces: get_available_media_network_interfaces(),
    })
}

#[tauri::command]
fn get_companion_api_key() -> Result<String, String> {
    let path = companion_api_key_path();
    let value = match fs::read_to_string(&path) {
        Ok(value) => value,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(err) => return Err(format!("failed to read API key from {}: {err}", path.display())),
    };
    Ok(value.trim().to_string())
}

#[tauri::command]
fn save_server_config(
    app: AppHandle,
    config: ServerRuntimeConfig,
    start: bool,
) -> Result<ServerStatus, String> {
    let config = normalized_runtime_config(config)?;
    let path = write_runtime_config(&config)?;
    append_log(&app, format!("Saved server config to {}.", path.display()));

    let was_running = {
        let manager = app.state::<Mutex<ServerManager>>();
        let mut state = manager
            .lock()
            .map_err(|_| "server manager lock poisoned".to_string())?;
        state.refresh_child_state();
        state.child.is_some()
    };

    let apply_result = if !was_running && start {
        start_server_internal(&app)
    } else {
        if was_running {
            append_log(
                &app,
                "Saved server config. Restart the server to apply runtime changes.".to_string(),
            );
        }
        Ok(())
    };

    if let Err(err) = apply_result {
        if let Ok(mut manager) = app.state::<Mutex<ServerManager>>().lock() {
            manager.last_error = Some(err.clone());
            manager.push_log(err);
        }
    }

    get_server_status(app)
}

#[tauri::command]
fn start_server(app: AppHandle) -> Result<(), String> {
    start_server_internal(&app)
}

#[tauri::command]
fn stop_server(app: AppHandle) -> Result<(), String> {
    stop_server_internal(&app)
}

#[tauri::command]
fn restart_server(app: AppHandle) -> Result<(), String> {
    restart_server_internal(&app)
}

#[tauri::command]
fn open_admin() -> Result<(), String> {
    open_url(&admin_url_from_config())
}

#[tauri::command]
fn open_logs() -> Result<(), String> {
    let path = logs_dir();
    fs::create_dir_all(&path).map_err(|err| format!("failed to create logs dir: {err}"))?;
    open_url(path.to_string_lossy().as_ref())
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
    let height = height.clamp(360.0, 820.0);
    window
        .set_size(Size::Logical(LogicalSize::new(logical_size.width, height)))
        .map_err(|err| format!("failed to resize window: {err}"))
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
fn get_autostart_enabled(app: AppHandle) -> bool {
    app.try_state::<AutoLaunchManager>()
        .and_then(|manager| manager.is_enabled().ok())
        .unwrap_or(false)
}

#[tauri::command]
fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app
        .try_state::<AutoLaunchManager>()
        .ok_or_else(|| "autostart manager unavailable".to_string())?;
    if enabled {
        manager
            .enable()
            .map_err(|err| format!("failed to enable autostart: {err}"))?;
    } else {
        manager
            .disable()
            .map_err(|err| format!("failed to disable autostart: {err}"))?;
    }
    let enabled = manager.is_enabled().unwrap_or(enabled);
    set_tray_autostart_checked(&app, enabled);
    let _ = app.emit("autostart-changed", enabled);
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage(Mutex::new(ServerManager::default()))
        .manage(WindowFocusGuard::default())
        .manage(TrayToggleGuard::default())
        .manage(TrayAutostartMenuItem::default())
        .invoke_handler(tauri::generate_handler![
            get_server_status,
            get_companion_api_key,
            save_server_config,
            start_server,
            stop_server,
            restart_server,
            open_admin,
            open_logs,
            resize_main_window_to_content,
            suppress_window_focus_hide,
            get_autostart_enabled,
            set_autostart_enabled,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                prepare_macos_panel_window(&window);
                let _ = window.set_size(Size::Logical(LogicalSize::new(760.0, 620.0)));
            }

            let open_admin_item =
                MenuItem::with_id(app, TRAY_OPEN_ADMIN_ID, "Open Admin", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "Quit", true, None::<&str>)?;
            let autostart_item = CheckMenuItem::with_id(
                app,
                TRAY_AUTOSTART_ID,
                "Run at login",
                true,
                app.state::<AutoLaunchManager>()
                    .is_enabled()
                    .unwrap_or(false),
                None::<&str>,
            )?;
            if let Ok(mut item) = app.state::<TrayAutostartMenuItem>().item.lock() {
                *item = Some(autostart_item.clone());
            }

            let menu = Menu::with_items(app, &[&open_admin_item, &autostart_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .tooltip("Talktome Server")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    TRAY_OPEN_ADMIN_ID => {
                        let _ = open_url(&admin_url_from_config());
                    }
                    TRAY_AUTOSTART_ID => toggle_autostart_from_tray(app),
                    TRAY_QUIT_ID => {
                        let _ = stop_server_internal(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    #[cfg(target_os = "windows")]
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Down | MouseButtonState::Up,
                        rect,
                        ..
                    } => handle_tray_left_click(&tray.app_handle(), rect),
                    #[cfg(not(target_os = "windows"))]
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } => handle_tray_left_click(&tray.app_handle(), rect),
                    _ => {}
                });

            #[cfg(target_os = "macos")]
            {
                tray_builder = tray_builder.icon(app.default_window_icon().unwrap().clone());
            }
            #[cfg(not(target_os = "macos"))]
            {
                tray_builder = tray_builder.icon(app.default_window_icon().unwrap().clone());
            }

            let _tray = tray_builder.build(app)?;

            if runtime_config_path().is_file() {
                // Creating the packaged server process can take several seconds on
                // its first Windows launch while Defender verifies the executable.
                // Do it after setup returns so the tray event loop stays responsive.
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    if let Err(err) = start_server_internal(&app_handle) {
                        if let Ok(mut manager) =
                            app_handle.state::<Mutex<ServerManager>>().lock()
                        {
                            manager.last_error = Some(err.clone());
                            if !manager.logs.back().is_some_and(|line| line == &err) {
                                manager.push_log(err);
                            }
                        }
                    }
                });
            } else {
                if let Ok(mut manager) = app.state::<Mutex<ServerManager>>().lock() {
                    manager.push_log(format!(
                        "Server setup required. Save first-run settings to create {}.",
                        runtime_config_path().display()
                    ));
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                tauri::WindowEvent::Focused(false) => {
                    if let Some(guard) = window.app_handle().try_state::<WindowFocusGuard>() {
                        if guard.should_suppress_hide() {
                            return;
                        }
                    }
                    let _ = window.hide();
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Talktome Server app");
}
