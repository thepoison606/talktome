//! Local administration web interface: fixed `admin` login, status page with
//! GPIO and connection details, a Remote Control tab matching the browser
//! client talk layout, live Stream Deck view, configuration editing saved
//! back to the TOML/JSON file, and service restart.

mod auth;
mod config_api;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use axum::body::Body;
use axum::extract::{Path, Query, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::watch;

use crate::config::{Config, WebConfig, WEB_ADMIN_USER};
use crate::state::{Bus, Command, DeckInput, InputSource, TargetRef};
use crate::talk::TargetKey;
use auth::{AuthState, SESSION_COOKIE};

const INDEX_HTML: &str = include_str!("assets/index.html");
const APP_JS: &str = include_str!("assets/app.js");
const STYLE_CSS: &str = include_str!("assets/style.css");
const TALKTOME_ICON_PNG: &[u8] = include_bytes!("assets/talktome-icon.png");
const APPLE_TOUCH_ICON_PNG: &[u8] = include_bytes!("assets/apple-touch-icon.png");
const WALKIE_ICON_PNG: &[u8] = include_bytes!("assets/walkie-talkies-white.png");
const SPEAKER_ON_PNG: &[u8] = include_bytes!("assets/speaker-white.png");
const SPEAKER_MUTED_PNG: &[u8] = include_bytes!("assets/speaker-muted.png");

/// Everything the web handlers need from the running client.
pub struct WebContext {
    pub config: Arc<Config>,
    pub config_path: Option<PathBuf>,
    pub bus: Bus,
    pub shutdown: Arc<watch::Sender<bool>>,
    pub restart_requested: Arc<AtomicBool>,
}

struct AppState {
    ctx: WebContext,
    auth: Mutex<AuthState>,
    started: Instant,
}

type Shared = Arc<AppState>;

pub async fn run(
    ctx: WebContext,
    web: WebConfig,
    mut shutdown: watch::Receiver<bool>,
) -> Result<()> {
    let password_from_env = std::env::var_os("TALKTOME_WEB_PASSWORD").is_some();
    let state: Shared = Arc::new(AppState {
        auth: Mutex::new(AuthState::new(web.password.clone(), password_from_env)),
        ctx,
        started: Instant::now(),
    });

    let protected = Router::new()
        .route("/api/status", get(status))
        .route(
            "/api/config",
            get(config_api::get_config).put(config_api::put_config),
        )
        .route("/api/config/audio-devices", get(config_api::audio_devices))
        .route("/api/password", post(change_password))
        .route("/api/logout", post(logout))
        .route("/api/streamdeck", get(streamdeck))
        .route("/api/streamdeck/key/{index}", get(streamdeck_key_default))
        .route("/api/streamdeck/{device}/key/{index}", get(streamdeck_key))
        .route("/api/streamdeck/input", post(streamdeck_input))
        .route("/api/talk", post(talk))
        .route("/api/audio", post(audio))
        .route("/api/restart", post(restart))
        .layer(middleware::from_fn_with_state(state.clone(), require_auth));

    let app = Router::new()
        .route("/", get(index))
        .route("/index.html", get(index))
        .route("/app.js", get(app_js))
        .route("/style.css", get(style_css))
        .route("/talktome-icon.png", get(talktome_icon))
        .route("/apple-touch-icon.png", get(apple_touch_icon))
        .route("/favicon.ico", get(talktome_icon))
        .route("/images/walkie-talkies-white.png", get(walkie_icon))
        .route("/images/speaker-white.png", get(speaker_on_icon))
        .route("/images/speaker-muted.png", get(speaker_muted_icon))
        .route("/api/login", post(login))
        .route("/api/session", get(session))
        .merge(protected)
        .layer(middleware::from_fn(no_store_api))
        .with_state(state.clone());

    let listener = tokio::net::TcpListener::bind((web.bind.as_str(), web.port))
        .await
        .with_context(|| format!("binding web interface on {}:{}", web.bind, web.port))?;
    tracing::info!(event = "web-listening", bind = %web.bind, port = web.port);

    let cleanup_state = state.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(60));
        loop {
            tick.tick().await;
            if let Ok(mut auth) = cleanup_state.auth.lock() {
                auth.expire_sessions();
            }
        }
    });

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            loop {
                if *shutdown.borrow() {
                    return;
                }
                if shutdown.changed().await.is_err() {
                    return;
                }
            }
        })
        .await
        .context("web server")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------

async fn index() -> impl IntoResponse {
    (
        [(header::CACHE_CONTROL, "no-cache")],
        Html(INDEX_HTML.replace("__VERSION__", crate::VERSION)),
    )
}

async fn app_js() -> impl IntoResponse {
    (
        [
            (
                header::CONTENT_TYPE,
                "application/javascript; charset=utf-8",
            ),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        APP_JS,
    )
}

async fn style_css() -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, "text/css; charset=utf-8"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        STYLE_CSS,
    )
}

async fn talktome_icon() -> impl IntoResponse {
    png_asset(TALKTOME_ICON_PNG)
}

async fn apple_touch_icon() -> impl IntoResponse {
    png_asset(APPLE_TOUCH_ICON_PNG)
}

async fn walkie_icon() -> impl IntoResponse {
    png_asset(WALKIE_ICON_PNG)
}

async fn speaker_on_icon() -> impl IntoResponse {
    png_asset(SPEAKER_ON_PNG)
}

async fn speaker_muted_icon() -> impl IntoResponse {
    png_asset(SPEAKER_MUTED_PNG)
}

fn png_asset(bytes: &'static [u8]) -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, "image/png"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        bytes,
    )
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

fn client_error(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": message.into() }))).into_response()
}

fn session_token(headers: &HeaderMap) -> Option<String> {
    let cookie = headers.get(header::COOKIE)?.to_str().ok()?;
    cookie.split(';').find_map(|part| {
        let (name, value) = part.trim().split_once('=')?;
        (name == SESSION_COOKIE).then(|| value.trim().to_string())
    })
}

fn is_authenticated(state: &AppState, headers: &HeaderMap) -> bool {
    let Some(token) = session_token(headers) else {
        return false;
    };
    state
        .auth
        .lock()
        .map(|mut auth| auth.validate(&token))
        .unwrap_or(false)
}

async fn no_store_api(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    let mut response = next.run(request).await;
    if path.contains("/key/") {
        return response;
    }
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn require_auth(State(state): State<Shared>, request: Request, next: Next) -> Response {
    if !is_authenticated(&state, request.headers()) {
        return client_error(StatusCode::UNAUTHORIZED, "login required");
    }
    next.run(request).await
}

#[derive(Deserialize)]
struct LoginBody {
    #[serde(default)]
    username: Option<String>,
    password: String,
}

async fn login(State(state): State<Shared>, Json(body): Json<LoginBody>) -> Response {
    if let Some(user) = body.username.as_deref() {
        if !user.trim().is_empty() && user.trim() != WEB_ADMIN_USER {
            return client_error(StatusCode::UNAUTHORIZED, "unknown user");
        }
    }
    let Ok(mut auth) = state.auth.lock() else {
        return client_error(StatusCode::INTERNAL_SERVER_ERROR, "auth state unavailable");
    };
    if let Some(wait) = auth.throttled() {
        let mut response = client_error(
            StatusCode::TOO_MANY_REQUESTS,
            format!(
                "too many failed logins, try again in {} s",
                wait.as_secs().max(1)
            ),
        );
        if let Ok(value) = HeaderValue::from_str(&wait.as_secs().max(1).to_string()) {
            response.headers_mut().insert(header::RETRY_AFTER, value);
        }
        return response;
    }
    match auth.login(&body.password) {
        Some(token) => {
            tracing::info!(event = "web-login", user = WEB_ADMIN_USER);
            let cookie = format!(
                "{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}",
                auth::SESSION_TTL.as_secs()
            );
            let body = Json(json!({
                "ok": true,
                "user": WEB_ADMIN_USER,
                "must_change_password": auth.must_change_password(),
            }));
            let mut response = body.into_response();
            if let Ok(value) = HeaderValue::from_str(&cookie) {
                response.headers_mut().insert(header::SET_COOKIE, value);
            }
            response
        }
        None => {
            tracing::warn!(event = "web-login-failed");
            client_error(StatusCode::UNAUTHORIZED, "wrong password")
        }
    }
}

async fn logout(State(state): State<Shared>, headers: HeaderMap) -> Response {
    if let Some(token) = session_token(&headers) {
        if let Ok(mut auth) = state.auth.lock() {
            auth.logout(&token);
        }
    }
    let mut response = Json(json!({ "ok": true })).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static("talktome_web=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"),
    );
    response
}

async fn session(State(state): State<Shared>, headers: HeaderMap) -> Response {
    let authenticated = is_authenticated(&state, &headers);
    let (must_change, from_env) = state
        .auth
        .lock()
        .map(|auth| (auth.must_change_password(), auth.password_from_env()))
        .unwrap_or((false, false));
    Json(json!({
        "authenticated": authenticated,
        "user": WEB_ADMIN_USER,
        "must_change_password": authenticated && must_change,
        "password_from_env": from_env,
        "instance": state.ctx.config.instance,
        "version": crate::VERSION,
    }))
    .into_response()
}

#[derive(Deserialize)]
struct PasswordBody {
    current: String,
    new: String,
}

async fn change_password(State(state): State<Shared>, Json(body): Json<PasswordBody>) -> Response {
    let new = body.new.trim().to_string();
    if new.len() < 6 {
        return client_error(
            StatusCode::BAD_REQUEST,
            "the new password needs at least 6 characters",
        );
    }
    if new == crate::config::WEB_DEFAULT_PASSWORD {
        return client_error(
            StatusCode::BAD_REQUEST,
            "choose a password other than the default",
        );
    }
    {
        let Ok(auth) = state.auth.lock() else {
            return client_error(StatusCode::INTERNAL_SERVER_ERROR, "auth state unavailable");
        };
        if !auth.check_password(&body.current) {
            return client_error(StatusCode::UNAUTHORIZED, "current password is wrong");
        }
    }
    let saved = match &state.ctx.config_path {
        Some(path) => match config_api::update_web_password(path, &new) {
            Ok(()) => true,
            Err(error) => {
                tracing::warn!(event = "web-password-save-failed", error = %format!("{error:#}"));
                return client_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("saving the password failed: {error:#}"),
                );
            }
        },
        None => false,
    };
    let from_env = if let Ok(mut auth) = state.auth.lock() {
        auth.set_password(new);
        auth.password_from_env()
    } else {
        false
    };
    tracing::info!(event = "web-password-changed", saved_to_file = saved);
    let note = if from_env {
        Some("TALKTOME_WEB_PASSWORD is set in the environment; it overrides the file on the next start, so update it there as well.")
    } else if !saved {
        Some("No configuration file is in use; the new password applies until the next restart.")
    } else {
        None
    };
    Json(json!({ "ok": true, "saved_to_file": saved, "note": note })).into_response()
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

async fn status(State(state): State<Shared>) -> Response {
    let snapshot =
        crate::surfaces::streamdeck::overlay_demo_targets(state.ctx.bus.snapshots.borrow().clone());
    let (gpio, decks, audio, socket) = match state.ctx.bus.hardware.read() {
        Ok(hardware) => (
            hardware.gpio.clone(),
            hardware.decks.clone(),
            hardware.audio.clone(),
            hardware.socket.clone(),
        ),
        Err(_) => Default::default(),
    };
    let deck = decks.first().cloned().unwrap_or_default();
    let config = &state.ctx.config;
    Json(json!({
        "now_unix": unix_now(),
        "uptime_s": state.started.elapsed().as_secs(),
        "version": crate::VERSION,
        "systemd": running_under_systemd(),
        "config_path": state.ctx.config_path.as_ref().map(|p| p.display().to_string()),
        "restart_pending": state.ctx.restart_requested.load(Ordering::Relaxed),
        "web": { "bind": config.web.bind, "port": config.web.port },
        "health_port": config.health.port,
        "audio_config": {
            "input_device": config.audio.input_device,
            "output_device": config.audio.output_device,
            "profile": config.audio.profile,
            "device_period_ms": config.audio.device_period_ms,
            "auto_processing": config.audio.auto_processing,
            "input_gain_db": config.audio.input_gain_db,
        },
        "snapshot": *snapshot,
        "gpio": gpio,
        "socket": socket,
        "deck": deck,
        "decks": decks,
        "audio": audio,
    }))
    .into_response()
}

pub fn running_under_systemd() -> bool {
    std::env::var_os("INVOCATION_ID").is_some() || std::env::var_os("NOTIFY_SOCKET").is_some()
}

// ---------------------------------------------------------------------------
// Stream Deck
// ---------------------------------------------------------------------------

async fn streamdeck(State(state): State<Shared>) -> Response {
    match state.ctx.bus.hardware.read() {
        Ok(hardware) => Json(json!({ "decks": hardware.decks })).into_response(),
        Err(_) => client_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "hardware state unavailable",
        ),
    }
}

async fn streamdeck_key_default(
    state: State<Shared>,
    Path(index): Path<u8>,
    query: Query<HashMap<String, String>>,
) -> Response {
    streamdeck_key(state, Path((0, index)), query).await
}

async fn streamdeck_key(
    State(state): State<Shared>,
    Path((device, index)): Path<(usize, u8)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let image = state
        .ctx
        .bus
        .hardware
        .read()
        .ok()
        .and_then(|hardware| hardware.deck_images.get(&(device, index)).cloned());
    let Some((hash, png)) = image else {
        return client_error(StatusCode::NOT_FOUND, "no image for this key");
    };
    // With the hash in the URL the browser can cache the image forever.
    let cache = if query
        .get("h")
        .map(|h| h == &hash.to_string())
        .unwrap_or(false)
    {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/png")
        .header(header::CACHE_CONTROL, cache)
        .body(Body::from(png.as_ref().clone()))
        .unwrap_or_else(|_| client_error(StatusCode::INTERNAL_SERVER_ERROR, "response error"))
}

#[derive(Deserialize)]
struct DeckInputBody {
    kind: String,
    #[serde(default)]
    device: usize,
    #[serde(default)]
    index: u8,
    #[serde(default)]
    action: Option<String>,
    #[serde(default)]
    delta: Option<i8>,
}

async fn streamdeck_input(
    State(state): State<Shared>,
    Json(body): Json<DeckInputBody>,
) -> Response {
    tracing::info!(
        event = "streamdeck-web-input",
        device = body.device,
        kind = %body.kind,
        index = body.index,
        action = ?body.action
    );
    let input = match body.kind.as_str() {
        "key" => match body.action.as_deref() {
            Some("down") => DeckInput::KeyDown(body.index),
            Some("up") => DeckInput::KeyUp(body.index),
            _ => return client_error(StatusCode::BAD_REQUEST, "key input needs action down|up"),
        },
        "encoder" => DeckInput::EncoderTwist(body.index, body.delta.unwrap_or(1)),
        "encoder-press" => match body.action.as_deref() {
            Some("up") | Some("release") => DeckInput::EncoderRelease(body.index),
            _ => DeckInput::EncoderPress(body.index),
        },
        "encoder-release" | "encoder-up" => DeckInput::EncoderRelease(body.index),
        "touch" => DeckInput::TouchPoint(body.index),
        other => {
            return client_error(
                StatusCode::BAD_REQUEST,
                format!("unknown input kind {other:?}"),
            )
        }
    };
    let sender = state.ctx.bus.hardware.read().ok().and_then(|hardware| {
        hardware
            .decks
            .get(body.device)
            .and_then(|deck| deck.connected.then_some(()))?;
        hardware.deck_inputs.get(body.device).cloned()
    });
    let Some(sender) = sender else {
        return client_error(StatusCode::CONFLICT, "no Stream Deck connected");
    };
    match sender.send(input).await {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(_) => client_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Stream Deck surface not running",
        ),
    }
}

// ---------------------------------------------------------------------------
// Remote talk / audio control
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct TalkBody {
    action: String,
    #[serde(default)]
    target: Option<String>,
}

fn parse_target_ref(text: Option<&str>) -> Option<TargetRef> {
    let text = text?.trim();
    if text.eq_ignore_ascii_case("reply") {
        return Some(TargetRef::Reply);
    }
    TargetKey::parse(text).map(TargetRef::Key)
}

fn user_target_offline(snapshot: &crate::state::Snapshot, target: TargetRef) -> bool {
    let key = match target {
        TargetRef::Key(key) => key,
        TargetRef::Reply => match snapshot.reply_target {
            Some(key) => key,
            None => return false,
        },
    };
    match key {
        TargetKey::User(_) => snapshot
            .targets
            .iter()
            .find(|t| t.key == key)
            .map(|t| !t.online)
            .unwrap_or(true),
        _ => false,
    }
}

async fn talk(State(state): State<Shared>, Json(body): Json<TalkBody>) -> Response {
    let source = InputSource::Companion("web".into());
    let command = match body.action.as_str() {
        "press" | "release" | "lock" => {
            let Some(target) = parse_target_ref(body.target.as_deref()) else {
                return client_error(
                    StatusCode::BAD_REQUEST,
                    "target must be reply, user:<id> or conference:<id>",
                );
            };
            if matches!(body.action.as_str(), "press" | "lock")
                && user_target_offline(
                    &crate::surfaces::streamdeck::overlay_demo_targets(
                        state.ctx.bus.snapshots.borrow().clone(),
                    ),
                    target,
                )
            {
                return client_error(StatusCode::CONFLICT, "user is offline");
            }
            match body.action.as_str() {
                "press" => Command::TalkPress { source, target },
                "release" => Command::TalkRelease { source, target },
                _ => Command::LockToggle { target },
            }
        }
        "clear-locks" => Command::ClearLocks,
        other => {
            return client_error(
                StatusCode::BAD_REQUEST,
                format!("unknown talk action {other:?}"),
            )
        }
    };
    match state.ctx.bus.commands.send(command).await {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(_) => client_error(StatusCode::SERVICE_UNAVAILABLE, "session not running"),
    }
}

#[derive(Deserialize)]
struct AudioBody {
    action: String,
    target: String,
    #[serde(default)]
    member: Option<String>,
    #[serde(default)]
    value: Option<f32>,
}

async fn audio(State(state): State<Shared>, Json(body): Json<AudioBody>) -> Response {
    let Some(target) = TargetKey::parse(&body.target) else {
        return client_error(
            StatusCode::BAD_REQUEST,
            "target must be user:<id>, conference:<id> or feed:<id>",
        );
    };
    let command = match body.action.as_str() {
        "mute-toggle" => Command::MuteToggle(target),
        "volume-step" => Command::VolumeStep {
            target,
            delta: body.value.unwrap_or(0.05),
        },
        "volume-set" => Command::VolumeSet {
            target,
            volume: body.value.unwrap_or(0.9).clamp(0.0, 1.0),
        },
        "member-volume-set" | "member-mute-toggle" => {
            if !matches!(target, TargetKey::Conference(_)) {
                return client_error(
                    StatusCode::BAD_REQUEST,
                    "member mix only applies to conference:<id>",
                );
            }
            let Some(user_id) = body
                .member
                .as_deref()
                .and_then(TargetKey::parse)
                .and_then(|key| match key {
                    TargetKey::User(id) => Some(id),
                    _ => None,
                })
                .or_else(|| body.member.as_deref().and_then(|s| s.parse().ok()))
            else {
                return client_error(StatusCode::BAD_REQUEST, "member must be user:<id>");
            };
            if body.action == "member-mute-toggle" {
                Command::MemberMuteToggle {
                    conference: target,
                    user_id,
                }
            } else {
                Command::MemberVolumeSet {
                    conference: target,
                    user_id,
                    volume: body.value.unwrap_or(1.0).clamp(0.0, 1.0),
                }
            }
        }
        other => {
            return client_error(
                StatusCode::BAD_REQUEST,
                format!("unknown audio action {other:?}"),
            )
        }
    };
    match state.ctx.bus.commands.send(command).await {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(_) => client_error(StatusCode::SERVICE_UNAVAILABLE, "session not running"),
    }
}

// ---------------------------------------------------------------------------
// Restart
// ---------------------------------------------------------------------------

async fn restart(State(state): State<Shared>) -> Response {
    tracing::warn!(event = "web-restart", systemd = running_under_systemd());
    state.ctx.restart_requested.store(true, Ordering::Relaxed);
    let shutdown = state.ctx.shutdown.clone();
    // Give the response a moment to leave before the listener goes away.
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        let _ = shutdown.send(true);
    });
    Json(json!({
        "ok": true,
        "mode": if running_under_systemd() { "systemd" } else { "exec" },
    }))
    .into_response()
}
