//! API keys and bridge tokens belong in the platform credential store, never WebView storage.
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

static ACCESS: Mutex<()> = Mutex::new(());
const SERVICE: &str = "Talktome Bridge";

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub bridge_token: String,
}

fn entry(server_url: &str) -> Result<keyring::Entry, String> {
    let server_url = super::normalize_server_url(server_url)?;
    keyring::Entry::new(SERVICE, &server_url)
        .map_err(|_| "Cannot access the operating system credential store".to_owned())
}

#[tauri::command]
pub async fn load_bridge_credentials(server_url: String) -> Result<Credentials, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = ACCESS
            .lock()
            .map_err(|_| "Credential store is unavailable")?;
        match entry(&server_url)?.get_password() {
            Ok(value) => serde_json::from_str(&value)
                .map_err(|_| "Cannot read saved Bridge credentials".to_owned()),
            Err(keyring::Error::NoEntry) => Ok(Credentials::default()),
            Err(_) => Err(
                "Cannot read the operating system credential store; unlock it and retry".to_owned(),
            ),
        }
    })
    .await
    .map_err(|_| "Credential store task failed".to_owned())?
}

#[tauri::command]
pub async fn save_bridge_credentials(
    server_url: String,
    credentials: Credentials,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = ACCESS.lock().map_err(|_| "Credential store is unavailable")?;
        let value = serde_json::to_string(&credentials)
            .map_err(|_| "Cannot encode Bridge credentials".to_owned())?;
        entry(&server_url)?.set_password(&value)
            .map_err(|_| "Cannot save Bridge credentials; unlock the operating system credential store and retry".to_owned())
    }).await.map_err(|_| "Credential store task failed".to_owned())?
}
