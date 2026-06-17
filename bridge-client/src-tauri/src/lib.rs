mod audio;
mod model;
mod probe;

use audio::AudioInventory;
use model::BridgeStatus;
use probe::{ProbeManager, ProbeStartRequest, ProbeStatus};

#[tauri::command]
fn list_audio_devices() -> Result<AudioInventory, String> {
    audio::list_audio_devices()
}

#[tauri::command]
fn get_bridge_status() -> BridgeStatus {
    BridgeStatus::default()
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
    tauri::Builder::default()
        .manage(ProbeManager::default())
        .invoke_handler(tauri::generate_handler![
            get_audio_probe_ports_status,
            get_bridge_status,
            list_audio_devices,
            start_audio_probe,
            stop_all_audio_probe_ports,
            stop_audio_probe_port
        ])
        .run(tauri::generate_context!())
        .expect("error while running Talk To Me Bridge");
}
