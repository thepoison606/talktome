//! File-driven surface for tests and headless debugging: publishes every
//! snapshot to `<dir>/snapshot.json` and executes commands appended to
//! `<dir>/commands` (one per line, e.g. `press conference:1`,
//! `release conference:1`, `lock user:3`, `mute feed:1`, `vol feed:1 -0.1`,
//! `reply press`, `reply release`, `clear-locks`).

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{anyhow, Result};
use tokio::sync::watch;

use crate::state::{Bus, Command, InputSource, TargetRef};
use crate::talk::TargetKey;

pub async fn run(dir: PathBuf, bus: Bus, mut shutdown: watch::Receiver<bool>) {
    if let Err(error) = std::fs::create_dir_all(&dir) {
        tracing::error!(event = "mock-surface-failed", error = %error);
        return;
    }
    let commands_path = dir.join("commands");
    let snapshot_path = dir.join("snapshot.json");
    let mut offset = std::fs::metadata(&commands_path)
        .map(|m| m.len())
        .unwrap_or(0);
    let mut snapshots = bus.snapshots.clone();
    write_snapshot(&snapshot_path, &snapshots.borrow());
    let mut poll = tokio::time::interval(Duration::from_millis(100));
    tracing::info!(event = "mock-surface", dir = %dir.display());

    loop {
        tokio::select! {
            changed = snapshots.changed() => {
                if changed.is_err() { break; }
                write_snapshot(&snapshot_path, &snapshots.borrow());
            }
            _ = poll.tick() => {
                if let Ok(text) = std::fs::read_to_string(&commands_path) {
                    let bytes = text.as_bytes();
                    if (bytes.len() as u64) < offset {
                        offset = 0;
                    }
                    let new_text = &text[offset as usize..];
                    if let Some(last_newline) = new_text.rfind('\n') {
                        for line in new_text[..last_newline].lines() {
                            match parse_command(line) {
                                Ok(Some(command)) => {
                                    tracing::info!(event = "mock-command", line);
                                    let _ = bus.commands.send(command).await;
                                }
                                Ok(None) => {}
                                Err(error) => tracing::warn!(event = "mock-command-invalid", line, error = %error),
                            }
                        }
                        offset += (last_newline + 1) as u64;
                    }
                }
            }
            _ = shutdown.changed() => {
                if *shutdown.borrow() { break; }
            }
        }
    }
}

fn write_snapshot(path: &Path, snapshot: &crate::state::Snapshot) {
    if let Ok(text) = serde_json::to_string_pretty(snapshot) {
        let tmp = path.with_extension("json.tmp");
        if std::fs::write(&tmp, text).is_ok() {
            let _ = std::fs::rename(tmp, path);
        }
    }
}

fn target_ref(text: &str) -> Result<TargetRef> {
    if text.eq_ignore_ascii_case("reply") {
        return Ok(TargetRef::Reply);
    }
    TargetKey::parse(text)
        .map(TargetRef::Key)
        .ok_or_else(|| anyhow!("bad target {text:?}"))
}

fn target_key(text: &str) -> Result<TargetKey> {
    TargetKey::parse(text).ok_or_else(|| anyhow!("bad target {text:?}"))
}

pub fn parse_command(line: &str) -> Result<Option<Command>> {
    let mut parts = line.split_whitespace();
    let Some(verb) = parts.next() else {
        return Ok(None);
    };
    if verb.starts_with('#') {
        return Ok(None);
    }
    let source = InputSource::Gpio("mock".into());
    let command = match verb {
        "press" => Command::TalkPress {
            source,
            target: target_ref(
                parts
                    .next()
                    .ok_or_else(|| anyhow!("press needs a target"))?,
            )?,
        },
        "release" => Command::TalkRelease {
            source,
            target: target_ref(
                parts
                    .next()
                    .ok_or_else(|| anyhow!("release needs a target"))?,
            )?,
        },
        "reply" => match parts.next() {
            Some("press") => Command::TalkPress {
                source,
                target: TargetRef::Reply,
            },
            Some("release") => Command::TalkRelease {
                source,
                target: TargetRef::Reply,
            },
            _ => return Err(anyhow!("reply needs press|release")),
        },
        "lock" => Command::LockToggle {
            target: target_ref(parts.next().ok_or_else(|| anyhow!("lock needs a target"))?)?,
        },
        "clear-locks" => Command::ClearLocks,
        "mute" => Command::MuteToggle(target_key(
            parts.next().ok_or_else(|| anyhow!("mute needs a target"))?,
        )?),
        "vol" => {
            let target = target_key(parts.next().ok_or_else(|| anyhow!("vol needs a target"))?)?;
            let value = parts.next().ok_or_else(|| anyhow!("vol needs a value"))?;
            if let Some(delta) = value.strip_prefix('+') {
                Command::VolumeStep {
                    target,
                    delta: delta.parse()?,
                }
            } else if value.starts_with('-') {
                Command::VolumeStep {
                    target,
                    delta: value.parse()?,
                }
            } else {
                Command::VolumeSet {
                    target,
                    volume: value.parse()?,
                }
            }
        }
        "refresh" => Command::Refresh,
        "shutdown" => Command::Shutdown,
        other => return Err(anyhow!("unknown command {other:?}")),
    };
    Ok(Some(command))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_command_lines() {
        assert!(matches!(
            parse_command("press conference:1").unwrap(),
            Some(Command::TalkPress {
                target: TargetRef::Key(TargetKey::Conference(1)),
                ..
            })
        ));
        assert!(matches!(
            parse_command("reply release").unwrap(),
            Some(Command::TalkRelease {
                target: TargetRef::Reply,
                ..
            })
        ));
        assert!(
            matches!(parse_command("vol feed:2 -0.1").unwrap(), Some(Command::VolumeStep { delta, .. }) if (delta + 0.1).abs() < 1e-6)
        );
        assert!(
            matches!(parse_command("vol feed:2 0.5").unwrap(), Some(Command::VolumeSet { volume, .. }) if (volume - 0.5).abs() < 1e-6)
        );
        assert!(matches!(
            parse_command("mute user:4").unwrap(),
            Some(Command::MuteToggle(TargetKey::User(4)))
        ));
        assert!(parse_command("# comment").unwrap().is_none());
        assert!(parse_command("").unwrap().is_none());
        assert!(parse_command("dance").is_err());
    }
}
