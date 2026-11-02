//! Configuration read/write through the web UI. The running configuration is
//! immutable; edits go to the TOML/JSON file and take effect after a restart.

use std::path::Path;

use anyhow::{anyhow, bail, Context, Result};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{client_error, Shared};
use crate::config::{self, REDACTED};

/// JSON pointers of secrets that the API redacts and accepts back as placeholders.
const SECRET_POINTERS: &[&str] = &["/user/password", "/web/password"];

fn format_of(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
    {
        Some(ext) if ext == "toml" => Some("toml"),
        Some(ext) if ext == "json" => Some("json"),
        _ => None,
    }
}

fn env_overrides() -> Vec<String> {
    let mut names: Vec<String> = std::env::vars()
        .map(|(name, _)| name)
        .filter(|name| name.starts_with(config::ENV_PREFIX))
        .filter(|name| {
            let lower = name
                .trim_start_matches(config::ENV_PREFIX)
                .to_ascii_lowercase();
            lower == "instance"
                || lower == "state_dir"
                || lower
                    .split_once('_')
                    .map(|(section, _)| {
                        matches!(
                            section,
                            "server"
                                | "tls"
                                | "user"
                                | "registration"
                                | "audio"
                                | "vox"
                                | "talk"
                                | "ice"
                                | "network"
                                | "streamdeck"
                                | "gpio"
                                | "socket"
                                | "health"
                                | "log"
                                | "web"
                        )
                    })
                    .unwrap_or(false)
        })
        .collect();
    names.sort();
    names
}

pub async fn get_config(State(state): State<Shared>) -> Response {
    let document = match serde_json::to_value(state.ctx.config.redacted()) {
        Ok(value) => value,
        Err(error) => return client_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    };
    let path = state.ctx.config_path.as_deref();
    let file_document = path
        .and_then(|p| config::read_document(p).ok())
        .map(|mut doc| {
            config::migrate_document(&mut doc);
            redact(&mut doc);
            doc
        });
    let editor_document = match &file_document {
        Some(file) => config::merge_file_over_running(&document, file),
        None => document.clone(),
    };
    let file_pending_restart = path
        .and_then(|p| config::read_document(p).ok())
        .map(|raw| config::file_differs_from_running(&raw, &state.ctx.config))
        .unwrap_or(false);
    Json(json!({
        "document": document,
        "file_document": file_document,
        "editor_document": editor_document,
        "file_pending_restart": file_pending_restart,
        "path": path.map(|p| p.display().to_string()),
        "format": path.and_then(format_of),
        "editable": path.is_some(),
        "env_overrides": env_overrides(),
        "secrets": SECRET_POINTERS,
        "state_dir": state.ctx.config.state_dir().display().to_string(),
    }))
    .into_response()
}

#[derive(Deserialize)]
pub struct PutConfigBody {
    document: Value,
}

pub async fn put_config(State(state): State<Shared>, Json(body): Json<PutConfigBody>) -> Response {
    let Some(path) = state.ctx.config_path.clone() else {
        return client_error(
            StatusCode::CONFLICT,
            "this instance runs from environment variables only; there is no configuration file to save to",
        );
    };
    let running = match serde_json::to_value(&*state.ctx.config) {
        Ok(value) => value,
        Err(error) => return client_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    };
    let stored = config::read_document(&path).ok();
    match save_document(&path, body.document, stored.as_ref(), &running) {
        Ok(()) => {
            tracing::info!(event = "config-saved", path = %path.display());
            Json(
                json!({ "ok": true, "restart_required": true, "path": path.display().to_string() }),
            )
            .into_response()
        }
        Err(error) => client_error(StatusCode::BAD_REQUEST, format!("{error:#}")),
    }
}

/// Validates and writes a configuration document, restoring redacted secrets
/// from the stored file (preferred) or the running configuration.
pub fn save_document(
    path: &Path,
    mut document: Value,
    stored: Option<&Value>,
    running: &Value,
) -> Result<()> {
    if !document.is_object() {
        bail!("configuration must be a JSON object");
    }
    if let Some(stored) = stored {
        document = config::merge_missing_top_level(stored, document);
    }
    for pointer in SECRET_POINTERS {
        let placeholder = document
            .pointer(pointer)
            .and_then(Value::as_str)
            .map(|s| s == REDACTED || s.is_empty())
            .unwrap_or(false);
        if placeholder {
            let replacement = stored
                .and_then(|s| s.pointer(pointer))
                .or_else(|| running.pointer(pointer))
                .cloned();
            match replacement {
                Some(value) => {
                    if let Some(slot) = document.pointer_mut(pointer) {
                        *slot = value;
                    }
                }
                None => {
                    // Absent in file and empty in the running config: drop so
                    // the default/validation decides.
                    if let Some(parent) = pointer.rsplit_once('/') {
                        if let Some(Value::Object(map)) = document.pointer_mut(parent.0) {
                            map.remove(parent.1);
                        }
                    }
                }
            }
        }
    }
    if let Some(Value::Array(servers)) = document.pointer_mut("/ice/servers") {
        for (index, server) in servers.iter_mut().enumerate() {
            let is_placeholder = server
                .get("credential")
                .and_then(Value::as_str)
                .map(|s| s == REDACTED)
                .unwrap_or(false);
            if is_placeholder {
                let previous = stored
                    .and_then(|s| s.pointer(&format!("/ice/servers/{index}/credential")))
                    .or_else(|| running.pointer(&format!("/ice/servers/{index}/credential")))
                    .cloned()
                    .unwrap_or(Value::Null);
                server["credential"] = previous;
            }
        }
    }
    config::migrate_document(&mut document);
    let config = config::from_document(document.clone())?;
    config.validate()?;
    config::write_document(path, &document)
        .with_context(|| format!("writing {}", path.display()))?;
    Ok(())
}

fn redact(document: &mut Value) {
    for pointer in SECRET_POINTERS {
        if let Some(slot) = document.pointer_mut(pointer) {
            if slot.as_str().map(|s| !s.is_empty()).unwrap_or(false) {
                *slot = Value::String(REDACTED.into());
            }
        }
    }
    if let Some(Value::Array(servers)) = document.pointer_mut("/ice/servers") {
        for server in servers {
            if server.get("credential").and_then(Value::as_str).is_some() {
                server["credential"] = Value::String(REDACTED.into());
            }
        }
    }
}

/// Writes a new `web.password` into the configuration file, keeping the rest.
pub fn update_web_password(path: &Path, password: &str) -> Result<()> {
    let mut document = config::read_document(path)?;
    let root = document
        .as_object_mut()
        .ok_or_else(|| anyhow!("configuration file is not an object"))?;
    let web = root
        .entry("web".to_string())
        .or_insert_with(|| Value::Object(Default::default()));
    if !web.is_object() {
        *web = Value::Object(Default::default());
    }
    web["password"] = Value::String(password.to_string());
    config::write_document(path, &document)
}

pub async fn audio_devices() -> Response {
    let devices = tokio::task::spawn_blocking(|| {
        let list = |input| -> Vec<Value> {
            crate::audio::alsa_pcm_devices(input)
                .into_iter()
                .map(|d| json!({ "id": d.id, "label": d.label, "card": d.card }))
                .collect()
        };
        json!({ "inputs": list(true), "outputs": list(false) })
    })
    .await;
    match devices {
        Ok(value) => Json(value).into_response(),
        Err(error) => client_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_document() -> Value {
        json!({
            "server": { "url": "https://talktome.local:8443" },
            "user": { "name": "Cam 1", "password": "real-secret" },
            "web": { "password": "web-secret", "port": 8080 }
        })
    }

    #[test]
    fn placeholders_keep_stored_secrets() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cam1.toml");
        config::write_document(&path, &base_document()).unwrap();
        let stored = config::read_document(&path).unwrap();

        let mut edited = base_document();
        edited["user"]["password"] = json!(REDACTED);
        edited["web"]["password"] = json!(REDACTED);
        edited["web"]["port"] = json!(9090);
        edited["audio"] = json!({ "profile": "low", "input_device": null });
        let running =
            serde_json::to_value(config::from_document(base_document()).unwrap()).unwrap();
        save_document(&path, edited, Some(&stored), &running).unwrap();

        let saved = config::read_document(&path).unwrap();
        assert_eq!(saved["user"]["password"], "real-secret");
        assert_eq!(saved["web"]["password"], "web-secret");
        assert_eq!(saved["web"]["port"], 9090);
        assert_eq!(saved["audio"]["profile"], "low");
        assert!(saved["audio"].get("input_device").is_none());
    }

    #[test]
    fn save_from_editor_keeps_file_user_when_changing_another_field() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cam1.toml");
        let stored_doc = json!({
            "server": { "url": "https://talktome.local:8443" },
            "user": { "name": "Studio", "password": "real-secret" },
            "audio": { "profile": "standard", "input_device": "tone" },
            "web": { "password": "web-secret", "port": 8080 }
        });
        config::write_document(&path, &stored_doc).unwrap();
        let stored = config::read_document(&path).unwrap();

        let running_source = json!({
            "server": { "url": "https://talktome.local:8443" },
            "user": { "name": "Cam 1", "password": "real-secret" },
            "web": { "password": "web-secret", "port": 8080 }
        });
        let running = serde_json::to_value(config::from_document(running_source).unwrap()).unwrap();

        let mut editor = config::merge_file_over_running(&running, &stored);
        editor["user"]["password"] = json!(REDACTED);
        editor["web"]["password"] = json!(REDACTED);
        editor["audio"]["profile"] = json!("low");
        save_document(&path, editor, Some(&stored), &running).unwrap();

        let saved = config::read_document(&path).unwrap();
        assert_eq!(saved["user"]["name"], "Studio");
        assert_eq!(saved["user"]["password"], "real-secret");
        assert_eq!(saved["audio"]["profile"], "low");
        assert_eq!(saved["audio"]["input_device"], "tone");
    }

    #[test]
    fn save_keeps_instance_when_the_form_omits_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cam1.toml");
        config::write_document(&path, &base_document()).unwrap();
        let stored = config::read_document(&path).unwrap();
        assert_eq!(stored.get("instance"), None);

        let mut with_instance = stored.clone();
        with_instance["instance"] = json!("cam1");
        config::write_document(&path, &with_instance).unwrap();
        let stored = config::read_document(&path).unwrap();

        let edited = json!({
            "server": { "url": "https://talktome.local:8443" },
            "user": { "name": "Cam 1", "password": REDACTED },
            "web": { "password": REDACTED, "port": 9090 }
        });
        let running =
            serde_json::to_value(config::from_document(base_document()).unwrap()).unwrap();
        save_document(&path, edited, Some(&stored), &running).unwrap();
        let saved = config::read_document(&path).unwrap();
        assert_eq!(saved["instance"], "cam1");
        assert_eq!(saved["web"]["port"], 9090);
        assert_eq!(saved["user"]["name"], "Cam 1");
    }

    #[test]
    fn invalid_documents_are_rejected_and_file_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cam1.json");
        config::write_document(&path, &base_document()).unwrap();
        let before = std::fs::read_to_string(&path).unwrap();
        let mut bad = base_document();
        bad["server"]["url"] = json!("not a url");
        let running =
            serde_json::to_value(config::from_document(base_document()).unwrap()).unwrap();
        assert!(save_document(&path, bad, None, &running).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
    }

    #[test]
    fn web_password_update_preserves_other_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cam1.toml");
        config::write_document(&path, &base_document()).unwrap();
        update_web_password(&path, "new-pass").unwrap();
        let saved = config::read_document(&path).unwrap();
        assert_eq!(saved["web"]["password"], "new-pass");
        assert_eq!(saved["web"]["port"], 8080);
        assert_eq!(saved["user"]["name"], "Cam 1");
        let mut doc = saved.clone();
        redact(&mut doc);
        assert_eq!(doc["web"]["password"], REDACTED);
    }
}
