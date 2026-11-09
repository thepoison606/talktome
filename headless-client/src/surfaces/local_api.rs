//! Local JSON-lines control socket for attaching a display, rotary encoders
//! or other MCU panel to one headless instance.
//!
//! Default transport is a Unix socket (`$RUNTIME_DIRECTORY/control.sock` under
//! systemd). Optional loopback TCP is for development. Each client receives
//! `hello` then `snapshot` frames and may send talk / volume commands.

use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, UnixListener, UnixStream};
use tokio::sync::watch;

use crate::audio::mixer::{db_to_volume, step_volume_db, volume_to_db};
use crate::config::SocketConfig;
use crate::state::{Bus, Command, InputSource, Snapshot, TargetRef};
use crate::talk::TargetKey;

/// Protocol version advertised in `hello`.
pub const PROTOCOL: u32 = 1;

const MAX_LINE: usize = 64 * 1024;

#[derive(Debug, Deserialize)]
struct Incoming {
    op: String,
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    client: Option<String>,
    #[serde(default)]
    target: Option<String>,
    #[serde(default)]
    action: Option<String>,
    #[serde(default)]
    member: Option<String>,
    #[serde(default)]
    value: Option<f32>,
    #[serde(default)]
    db: Option<f32>,
    #[serde(default)]
    delta_db: Option<f32>,
}

pub async fn run(
    socket: SocketConfig,
    instance: String,
    volume_step_db: f32,
    bus: Bus,
    shutdown: watch::Receiver<bool>,
) {
    if !socket.enabled {
        return;
    }
    let path = socket.resolved_path(&instance);
    let tcp = socket.tcp_bind().map(str::to_string);
    let mut tasks = tokio::task::JoinSet::new();
    tasks.spawn(serve_unix(
        path,
        instance.clone(),
        volume_step_db,
        bus.clone(),
        shutdown.clone(),
    ));
    if let Some(bind) = tcp {
        tasks.spawn(serve_tcp(bind, instance, volume_step_db, bus, shutdown));
    }
    while tasks.join_next().await.is_some() {}
}

async fn serve_unix(
    path: PathBuf,
    instance: String,
    volume_step_db: f32,
    bus: Bus,
    mut shutdown: watch::Receiver<bool>,
) {
    if let Some(parent) = path.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            tracing::error!(event = "socket-unix-failed", path = %path.display(), error = %error);
            return;
        }
    }
    let _ = std::fs::remove_file(&path);
    let listener = match UnixListener::bind(&path) {
        Ok(listener) => listener,
        Err(error) => {
            tracing::error!(event = "socket-unix-failed", path = %path.display(), error = %error);
            patch_socket_status(&bus, |status| {
                status.error = Some(format!("unix: {error}"));
            });
            return;
        }
    };
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o660));
    patch_socket_status(&bus, |status| {
        status.enabled = true;
        status.unix_path = Some(path.display().to_string());
        if status
            .error
            .as_deref()
            .is_some_and(|e| e.starts_with("unix:"))
        {
            status.error = None;
        }
    });
    tracing::info!(event = "socket-listening", transport = "unix", path = %path.display());
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                match accepted {
                    Ok((stream, _)) => {
                        tokio::spawn(handle_unix(
                            stream,
                            path.clone(),
                            instance.clone(),
                            volume_step_db,
                            bus.clone(),
                            shutdown.clone(),
                        ));
                    }
                    Err(error) => {
                        tracing::warn!(event = "socket-accept-failed", transport = "unix", error = %error);
                    }
                }
            }
            _ = shutdown.changed() => {
                if *shutdown.borrow() {
                    break;
                }
            }
        }
    }
    drop(listener);
    let _ = std::fs::remove_file(&path);
}

async fn serve_tcp(
    bind: String,
    instance: String,
    volume_step_db: f32,
    bus: Bus,
    mut shutdown: watch::Receiver<bool>,
) {
    let listener = match TcpListener::bind(&bind).await {
        Ok(listener) => listener,
        Err(error) => {
            tracing::error!(event = "socket-tcp-failed", bind = %bind, error = %error);
            patch_socket_status(&bus, |status| {
                let message = format!("tcp: {error}");
                status.error = Some(match status.error.take() {
                    Some(existing) => format!("{existing}; {message}"),
                    None => message,
                });
            });
            return;
        }
    };
    patch_socket_status(&bus, |status| {
        status.enabled = true;
        status.tcp = Some(bind.clone());
    });
    tracing::info!(event = "socket-listening", transport = "tcp", bind = %bind);
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                match accepted {
                    Ok((stream, peer)) => {
                        tracing::info!(event = "socket-connected", transport = "tcp", peer = %peer);
                        tokio::spawn(handle_tcp(
                            stream,
                            bind.clone(),
                            instance.clone(),
                            volume_step_db,
                            bus.clone(),
                            shutdown.clone(),
                        ));
                    }
                    Err(error) => {
                        tracing::warn!(event = "socket-accept-failed", transport = "tcp", error = %error);
                    }
                }
            }
            _ = shutdown.changed() => {
                if *shutdown.borrow() {
                    break;
                }
            }
        }
    }
}

async fn handle_unix(
    stream: UnixStream,
    path: PathBuf,
    instance: String,
    volume_step_db: f32,
    bus: Bus,
    shutdown: watch::Receiver<bool>,
) {
    let (reader, writer) = stream.into_split();
    if let Err(error) = session(
        reader,
        writer,
        path.display().to_string(),
        instance,
        volume_step_db,
        bus,
        shutdown,
    )
    .await
    {
        tracing::debug!(event = "socket-client-end", transport = "unix", error = %error);
    }
}

async fn handle_tcp(
    stream: tokio::net::TcpStream,
    bind: String,
    instance: String,
    volume_step_db: f32,
    bus: Bus,
    shutdown: watch::Receiver<bool>,
) {
    let (reader, writer) = stream.into_split();
    if let Err(error) = session(
        reader,
        writer,
        bind,
        instance,
        volume_step_db,
        bus,
        shutdown,
    )
    .await
    {
        tracing::debug!(event = "socket-client-end", transport = "tcp", error = %error);
    }
}

async fn session<R, W>(
    reader: R,
    mut writer: W,
    endpoint: String,
    instance: String,
    volume_step_db: f32,
    bus: Bus,
    mut shutdown: watch::Receiver<bool>,
) -> Result<()>
where
    R: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin,
{
    let _clients = ClientGuard::new(bus.clone());
    let mut lines = BufReader::new(reader);
    let mut buf = String::new();
    let mut snapshots = bus.snapshots.clone();
    let mut client = "anonymous".to_string();
    write_json(
        &mut writer,
        json!({
            "op": "hello",
            "protocol": PROTOCOL,
            "version": crate::VERSION,
            "instance": instance,
            "endpoint": endpoint,
        }),
    )
    .await?;
    write_json(&mut writer, current_snapshot_frame(&mut snapshots)).await?;

    loop {
        buf.clear();
        tokio::select! {
            read = lines.read_line(&mut buf) => {
                let n = read?;
                if n == 0 {
                    break;
                }
                if buf.len() > MAX_LINE {
                    bail!("line too long");
                }
                let line = buf.trim();
                if line.is_empty() {
                    continue;
                }
                match handle_line(line, &mut client, volume_step_db, &bus) {
                    Ok(HandleResult::Ack(id)) => {
                        if let Some(id) = id {
                            write_json(&mut writer, json!({ "op": "ack", "id": id })).await?;
                        }
                    }
                    Ok(HandleResult::Pong(id)) => {
                        write_json(&mut writer, json!({ "op": "pong", "id": id })).await?;
                    }
                    Ok(HandleResult::Snapshot) => {
                        write_json(&mut writer, current_snapshot_frame(&mut snapshots)).await?;
                    }
                    Ok(HandleResult::Hello { id, name }) => {
                        client = name;
                        let mut body = json!({
                            "op": "hello",
                            "protocol": PROTOCOL,
                            "version": crate::VERSION,
                            "instance": instance,
                            "endpoint": endpoint,
                            "client": client,
                        });
                        if let Some(id) = id {
                            body["id"] = id;
                        }
                        write_json(&mut writer, body).await?;
                        write_json(&mut writer, current_snapshot_frame(&mut snapshots)).await?;
                    }
                    Err(error) => {
                        write_json(&mut writer, json!({ "op": "error", "error": error.to_string() })).await?;
                    }
                }
            }
            changed = snapshots.changed() => {
                if changed.is_err() {
                    break;
                }
                write_json(&mut writer, current_snapshot_frame(&mut snapshots)).await?;
            }
            _ = shutdown.changed() => {
                if *shutdown.borrow() {
                    break;
                }
            }
        }
    }
    Ok(())
}

enum HandleResult {
    Ack(Option<Value>),
    Pong(Option<Value>),
    Snapshot,
    Hello { id: Option<Value>, name: String },
}

fn handle_line(
    line: &str,
    client: &mut String,
    volume_step_db: f32,
    bus: &Bus,
) -> Result<HandleResult> {
    let incoming: Incoming = serde_json::from_str(line).context("invalid JSON")?;
    match incoming.op.as_str() {
        "hello" => {
            let name = incoming
                .client
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("anonymous")
                .to_string();
            *client = name.clone();
            Ok(HandleResult::Hello {
                id: incoming.id,
                name,
            })
        }
        "get" | "snapshot" => Ok(HandleResult::Snapshot),
        "ping" => Ok(HandleResult::Pong(incoming.id)),
        other => {
            let command = command_from_incoming(&incoming, client, volume_step_db, bus)?;
            match bus.commands.try_send(command) {
                Ok(()) => Ok(HandleResult::Ack(incoming.id)),
                Err(_) => {
                    let _ = other;
                    Err(anyhow!("session not running"))
                }
            }
        }
    }
}

fn command_from_incoming(
    incoming: &Incoming,
    client: &str,
    volume_step_db: f32,
    bus: &Bus,
) -> Result<Command> {
    let source = InputSource::Companion(format!("socket:{client}"));
    match incoming.op.as_str() {
        "press" => Ok(Command::TalkPress {
            source,
            target: required_target_ref(incoming)?,
        }),
        "release" => Ok(Command::TalkRelease {
            source,
            target: required_target_ref(incoming)?,
        }),
        "lock" => Ok(Command::LockToggle {
            target: required_target_ref(incoming)?,
        }),
        "clear-locks" => Ok(Command::ClearLocks),
        "reply" => match incoming.action.as_deref().unwrap_or("press") {
            "press" => Ok(Command::TalkPress {
                source,
                target: TargetRef::Reply,
            }),
            "release" => Ok(Command::TalkRelease {
                source,
                target: TargetRef::Reply,
            }),
            other => bail!("reply action must be press or release, not {other:?}"),
        },
        "mute" => Ok(Command::MuteToggle(required_target_key(incoming)?)),
        "volume" => Ok(Command::VolumeSet {
            target: required_target_key(incoming)?,
            volume: incoming
                .value
                .ok_or_else(|| anyhow!("volume needs value (0–1)"))?
                .clamp(0.0, 1.0),
        }),
        "volume-db" => Ok(Command::VolumeSet {
            target: required_target_key(incoming)?,
            volume: db_to_volume(incoming.db.ok_or_else(|| anyhow!("volume-db needs db"))?),
        }),
        "volume-step" => {
            let target = required_target_key(incoming)?;
            let delta = incoming.delta_db.unwrap_or(volume_step_db);
            let current = current_volume(bus, target);
            Ok(Command::VolumeSet {
                target,
                volume: step_volume_db(current, delta),
            })
        }
        "member-mute" => {
            let conference = required_target_key(incoming)?;
            Ok(Command::MemberMuteToggle {
                conference,
                user_id: required_member(incoming)?,
            })
        }
        "member-volume" => {
            let conference = required_target_key(incoming)?;
            Ok(Command::MemberVolumeSet {
                conference,
                user_id: required_member(incoming)?,
                volume: incoming
                    .value
                    .ok_or_else(|| anyhow!("member-volume needs value (0–1)"))?
                    .clamp(0.0, 1.0),
            })
        }
        "member-volume-db" => {
            let conference = required_target_key(incoming)?;
            Ok(Command::MemberVolumeSet {
                conference,
                user_id: required_member(incoming)?,
                volume: db_to_volume(
                    incoming
                        .db
                        .ok_or_else(|| anyhow!("member-volume-db needs db"))?,
                ),
            })
        }
        "member-volume-step" => {
            let conference = required_target_key(incoming)?;
            let user_id = required_member(incoming)?;
            let delta = incoming.delta_db.unwrap_or(volume_step_db);
            let current = current_member_volume(bus, conference, user_id);
            Ok(Command::MemberVolumeSet {
                conference,
                user_id,
                volume: step_volume_db(current, delta),
            })
        }
        other => bail!("unknown op {other:?}"),
    }
}

fn required_target_ref(incoming: &Incoming) -> Result<TargetRef> {
    let text = incoming
        .target
        .as_deref()
        .ok_or_else(|| anyhow!("{} needs target", incoming.op))?;
    parse_target_ref(text)
}

fn required_target_key(incoming: &Incoming) -> Result<TargetKey> {
    match required_target_ref(incoming)? {
        TargetRef::Key(key) => Ok(key),
        TargetRef::Reply => bail!(
            "{} needs user:/conference:/feed: target, not reply",
            incoming.op
        ),
    }
}

fn required_member(incoming: &Incoming) -> Result<i64> {
    let text = incoming
        .member
        .as_deref()
        .ok_or_else(|| anyhow!("{} needs member (user:<id>)", incoming.op))?;
    match TargetKey::parse(text) {
        Some(TargetKey::User(id)) => Ok(id),
        _ => text
            .parse()
            .map_err(|_| anyhow!("member must be user:<id>")),
    }
}

fn parse_target_ref(text: &str) -> Result<TargetRef> {
    let text = text.trim();
    if text.eq_ignore_ascii_case("reply") {
        return Ok(TargetRef::Reply);
    }
    TargetKey::parse(text)
        .map(TargetRef::Key)
        .ok_or_else(|| anyhow!("target must be reply, user:<id>, conference:<id> or feed:<id>"))
}

fn current_volume(bus: &Bus, key: TargetKey) -> f32 {
    bus.snapshots
        .borrow()
        .targets
        .iter()
        .find(|target| target.key == key)
        .map(|target| target.volume)
        .unwrap_or(0.9)
}

fn current_member_volume(bus: &Bus, conference: TargetKey, user_id: i64) -> f32 {
    bus.snapshots
        .borrow()
        .targets
        .iter()
        .find(|target| target.key == conference)
        .and_then(|target| {
            target
                .members
                .iter()
                .find(|member| member.user_id == user_id)
        })
        .map(|member| member.volume)
        .unwrap_or(1.0)
}

fn patch_socket_status(bus: &Bus, update: impl FnOnce(&mut crate::state::SocketStatus)) {
    if let Ok(mut hardware) = bus.hardware.write() {
        update(&mut hardware.socket);
    }
}

struct ClientGuard {
    bus: Bus,
}

impl ClientGuard {
    fn new(bus: Bus) -> Self {
        patch_socket_status(&bus, |status| {
            status.clients = status.clients.saturating_add(1);
        });
        Self { bus }
    }
}

impl Drop for ClientGuard {
    fn drop(&mut self) {
        patch_socket_status(&self.bus, |status| {
            status.clients = status.clients.saturating_sub(1);
        });
    }
}

async fn write_json<W: AsyncWriteExt + Unpin>(writer: &mut W, value: Value) -> Result<()> {
    let mut line = serde_json::to_vec(&value)?;
    line.push(b'\n');
    writer.write_all(&line).await?;
    writer.flush().await?;
    Ok(())
}

fn current_snapshot_frame(snapshots: &mut watch::Receiver<Arc<Snapshot>>) -> Value {
    snapshot_frame(snapshots.borrow_and_update().as_ref())
}

pub fn snapshot_frame(snapshot: &Snapshot) -> Value {
    let mut frame = json!({
        "op": "snapshot",
        "instance": snapshot.instance,
        "user_name": snapshot.user_name,
        "user_id": snapshot.user_id,
        "connection": snapshot.connection,
        "detail": snapshot.detail,
        "talking": snapshot.talking,
        "lock_active": snapshot.lock_active,
        "on_air": snapshot.on_air,
        "preview": snapshot.preview,
        "audio_ok": snapshot.audio_ok,
        "input_level_db": snapshot.input_level_db,
        "production": snapshot.production,
        "reply": snapshot.reply_target.map(|key| json!({
            "key": key.to_string(),
            "name": snapshot.reply_name,
        })),
        "main_target": snapshot.main_target.map(|key| key.to_string()),
        "main_unavailable": snapshot.main_unavailable,
        "targets": snapshot.targets.iter().map(|target| {
            json!({
                "key": target.key.to_string(),
                "kind": target.key.kind(),
                "name": target.name,
                "can_talk": target.can_talk,
                "online": target.online,
                "held": target.held,
                "locked": target.locked,
                "incoming": target.incoming,
                "receiving": target.receiving,
                "volume": target.volume,
                "volume_db": volume_to_db(target.volume),
                "muted": target.muted,
                "members": target.members.iter().map(|member| json!({
                    "key": format!("user:{}", member.user_id),
                    "name": member.name,
                    "online": member.online,
                    "receiving": member.receiving,
                    "volume": member.volume,
                    "volume_db": volume_to_db(member.volume),
                    "muted": member.muted,
                })).collect::<Vec<_>>(),
            })
        }).collect::<Vec<_>>(),
    });
    frame["server_not_responding"] = json!(snapshot.server_not_responding);
    frame["heartbeat"] = json!(snapshot.heartbeat);
    frame["media_status"] = json!(snapshot.media_status);
    frame
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{self, TargetInfo};
    use std::path::Path;
    use std::time::Duration;

    async fn wait_for_unix(path: &Path, timeout: Duration) -> Result<()> {
        let start = std::time::Instant::now();
        loop {
            if UnixStream::connect(path).await.is_ok() {
                return Ok(());
            }
            if start.elapsed() > timeout {
                bail!("socket {} did not come up", path.display());
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    fn incoming(line: &str) -> Incoming {
        serde_json::from_str(line).unwrap()
    }

    #[test]
    fn parses_press_volume_and_reply() {
        let press = command_from_incoming(
            &incoming(r#"{"op":"press","target":"conference:1"}"#),
            "panel",
            3.0,
            &unused_bus(),
        )
        .unwrap();
        assert!(matches!(
            press,
            Command::TalkPress {
                target: TargetRef::Key(TargetKey::Conference(1)),
                ..
            }
        ));
        let reply = command_from_incoming(
            &incoming(r#"{"op":"reply","action":"release"}"#),
            "panel",
            3.0,
            &unused_bus(),
        )
        .unwrap();
        assert!(matches!(
            reply,
            Command::TalkRelease {
                target: TargetRef::Reply,
                ..
            }
        ));
        let vol = command_from_incoming(
            &incoming(r#"{"op":"volume","target":"user:4","value":0.5}"#),
            "panel",
            3.0,
            &unused_bus(),
        )
        .unwrap();
        assert!(
            matches!(vol, Command::VolumeSet { target: TargetKey::User(4), volume } if (volume - 0.5).abs() < 1e-6)
        );
    }

    #[test]
    fn volume_step_uses_db() {
        let bus = bus_with_target(TargetInfo {
            key: TargetKey::User(1),
            name: "adi".into(),
            can_talk: true,
            online: true,
            held: false,
            locked: false,
            incoming: false,
            receiving: false,
            volume: 1.0,
            muted: false,
            members: Vec::new(),
        });
        let stepped = command_from_incoming(
            &incoming(r#"{"op":"volume-step","target":"user:1","delta_db":-6}"#),
            "knob",
            3.0,
            &bus,
        )
        .unwrap();
        match stepped {
            Command::VolumeSet { volume, .. } => {
                assert!((volume_to_db(volume) + 6.0).abs() < 0.05);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn member_volume_step_uses_db() {
        let bus = bus_with_target(TargetInfo {
            key: TargetKey::Conference(1),
            name: "News".into(),
            can_talk: true,
            online: true,
            held: false,
            locked: false,
            incoming: false,
            receiving: false,
            volume: 1.0,
            muted: false,
            members: vec![crate::state::ConferenceMemberInfo {
                user_id: 4,
                name: "adi".into(),
                online: true,
                receiving: false,
                volume: 1.0,
                muted: false,
            }],
        });
        let stepped = command_from_incoming(
            &incoming(r#"{"op":"member-volume-step","target":"conference:1","member":"user:4","delta_db":-6}"#),
            "knob",
            3.0,
            &bus,
        )
        .unwrap();
        match stepped {
            Command::MemberVolumeSet {
                conference: TargetKey::Conference(1),
                user_id: 4,
                volume,
            } => {
                assert!((volume_to_db(volume) + 6.0).abs() < 0.05);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn snapshot_uses_string_keys() {
        let mut snapshot = Snapshot::initial("cam1", "Cam 1");
        snapshot.targets.push(TargetInfo {
            key: TargetKey::Conference(2),
            name: "News".into(),
            can_talk: true,
            online: true,
            held: false,
            locked: true,
            incoming: false,
            receiving: true,
            volume: 0.5,
            muted: false,
            members: Vec::new(),
        });
        snapshot.reply_target = Some(TargetKey::Conference(2));
        snapshot.reply_name = Some("News".into());
        snapshot.main_target = Some(TargetKey::Conference(2));
        let frame = snapshot_frame(&snapshot);
        assert_eq!(frame["op"], "snapshot");
        assert_eq!(frame["targets"][0]["key"], "conference:2");
        assert_eq!(frame["targets"][0]["kind"], "conference");
        assert_eq!(frame["reply"]["key"], "conference:2");
        assert_eq!(frame["main_target"], "conference:2");
        assert_eq!(frame["main_unavailable"], false);
        assert_eq!(frame["server_not_responding"], false);
        assert_eq!(frame["heartbeat"], "–");
        assert!(frame["targets"][0]["volume_db"].as_f64().is_some());
    }

    #[test]
    fn rejects_unknown_op_and_bad_target() {
        assert!(
            command_from_incoming(&incoming(r#"{"op":"dance"}"#), "x", 3.0, &unused_bus()).is_err()
        );
        assert!(command_from_incoming(
            &incoming(r#"{"op":"press","target":"nope"}"#),
            "x",
            3.0,
            &unused_bus()
        )
        .is_err());
    }

    #[tokio::test]
    async fn unix_socket_hello_get_and_press() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("control.sock");
        let channels = state::channels(Snapshot::initial("demo", "demo"));
        let mut cmd_rx = channels.commands;
        let bus = channels.bus;
        let snap_tx = channels.snapshots;
        let mut snap = Snapshot::clone(bus.snapshots.borrow().as_ref());
        snap.targets.push(TargetInfo {
            key: TargetKey::User(1),
            name: "adi".into(),
            can_talk: true,
            online: true,
            held: false,
            locked: false,
            incoming: false,
            receiving: false,
            volume: 0.8,
            muted: false,
            members: Vec::new(),
        });
        let _ = snap_tx.send(Arc::new(snap));

        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let socket = SocketConfig {
            enabled: true,
            path: Some(path.clone()),
            tcp: None,
        };
        let bus_clone = bus.clone();
        let server = tokio::spawn(async move {
            run(socket, "demo".into(), 3.0, bus_clone, shutdown_rx).await;
        });
        wait_for_unix(&path, Duration::from_secs(2)).await.unwrap();

        let stream = UnixStream::connect(&path).await.unwrap();
        let (reader, mut writer) = stream.into_split();
        let mut lines = BufReader::new(reader);
        let hello = read_json(&mut lines).await;
        assert_eq!(hello["op"], "hello");
        assert_eq!(hello["protocol"], PROTOCOL);
        let snap = read_json(&mut lines).await;
        assert_eq!(snap["op"], "snapshot");
        assert_eq!(snap["targets"][0]["name"], "adi");

        writer
            .write_all(br#"{"op":"hello","client":"oled","id":1}"#)
            .await
            .unwrap();
        writer.write_all(b"\n").await.unwrap();
        let hello2 = read_json(&mut lines).await;
        assert_eq!(hello2["client"], "oled");
        let _ = read_json(&mut lines).await;

        writer
            .write_all(br#"{"op":"press","target":"user:1","id":2}"#)
            .await
            .unwrap();
        writer.write_all(b"\n").await.unwrap();
        let ack = read_json(&mut lines).await;
        assert_eq!(ack["op"], "ack");
        assert_eq!(ack["id"], 2);
        let command = tokio::time::timeout(Duration::from_secs(1), cmd_rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(
            command,
            Command::TalkPress {
                target: TargetRef::Key(TargetKey::User(1)),
                ..
            }
        ));

        let _ = shutdown_tx.send(true);
        let _ = server.await;
        drop(snap_tx);
    }

    async fn read_json<R: tokio::io::AsyncRead + Unpin>(lines: &mut BufReader<R>) -> Value {
        let mut buf = String::new();
        lines.read_line(&mut buf).await.unwrap();
        serde_json::from_str(buf.trim()).unwrap()
    }

    fn unused_bus() -> Bus {
        state::channels(Snapshot::initial("t", "t")).bus
    }

    fn bus_with_target(target: TargetInfo) -> Bus {
        let channels = state::channels(Snapshot::initial("t", "t"));
        let mut snap = Snapshot::clone(channels.bus.snapshots.borrow().as_ref());
        snap.targets.push(target);
        let _ = channels.snapshots.send(Arc::new(snap));
        channels.bus
    }
}
