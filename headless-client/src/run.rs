//! Wires configuration, audio, surfaces, health and the session together.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::Result;
use tokio::sync::{mpsc, watch};

use crate::audio::io::AudioIo;
use crate::audio::mixer::Mixer;
use crate::audio::processing::ProcessingControl;
use crate::config::LoadedConfig;
use crate::signalling::session::{Session, SessionIo};
use crate::state::{self, Snapshot};

/// How the run ended: a plain shutdown or a restart requested from the web UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunOutcome {
    Shutdown,
    Restart,
}

pub async fn run(loaded: LoadedConfig) -> Result<RunOutcome> {
    let config_path = loaded.path.clone();
    let config = Arc::new(loaded.config);
    tracing::info!(event = "client-start", version = crate::VERSION, instance = %config.instance, user = %config.user.name);

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let shutdown_tx = Arc::new(shutdown_tx);
    let restart_requested = Arc::new(AtomicBool::new(false));
    spawn_signal_handler(shutdown_tx.clone());

    let mixer = Arc::new(Mutex::new(
        Mixer::new(
            config.audio.default_volume_linear(),
            config.audio.dim_db,
            config.audio.dim_feeds_while_speaking,
            config.audio.dim_when_addressed,
            config.audio.jitter_min_ms,
            config.audio.jitter_max_ms,
        )
        .with_jitter_start(config.audio.jitter_start_ms),
    ));
    let frame_samples =
        (crate::audio::codec::SAMPLE_RATE * config.audio.profile.frame_ms() / 1000) as usize;
    // Four frames is enough slack for the session loop to encode. A deeper
    // queue would send audio that is already late (64 × 20 ms was over a second).
    let (frames_tx, frames_rx) = mpsc::channel(4);
    let processing = ProcessingControl::from_audio(&config.audio);
    let audio_io = AudioIo::start(
        config.audio.clone(),
        frame_samples,
        mixer.clone(),
        frames_tx,
        processing.clone(),
    );

    let state::Channels {
        commands: cmd_rx,
        snapshots: snapshot_tx,
        bus,
    } = state::channels(Snapshot::initial(&config.instance, &config.user.name));

    let mut tasks = tokio::task::JoinSet::new();
    tasks.spawn(mirror_audio_status(
        audio_io.status.clone(),
        bus.hardware.clone(),
        shutdown_rx.clone(),
    ));
    tasks.spawn(crate::health::run_sd_notify(
        bus.snapshots.clone(),
        shutdown_rx.clone(),
    ));
    if let Some(port) = config.health.port {
        let bind = config.health.bind.clone();
        let snapshots = bus.snapshots.clone();
        let shutdown = shutdown_rx.clone();
        tasks.spawn(async move {
            if let Err(error) = crate::health::run_healthz(&bind, port, snapshots, shutdown).await {
                tracing::error!(event = "healthz-failed", error = %format!("{error:#}"));
            }
        });
    }
    crate::surfaces::spawn_all(&config, &bus, shutdown_rx.clone(), &mut tasks);
    if config.web.enabled {
        let ctx = crate::web::WebContext {
            config: config.clone(),
            config_path: config_path.clone(),
            bus: bus.clone(),
            shutdown: shutdown_tx.clone(),
            restart_requested: restart_requested.clone(),
        };
        let web = config.web.clone();
        let shutdown = shutdown_rx.clone();
        tasks.spawn(async move {
            if let Err(error) = crate::web::run(ctx, web, shutdown).await {
                tracing::error!(event = "web-failed", error = %format!("{error:#}"));
            }
        });
    }

    let session = Session::new(
        config.clone(),
        config_path.clone(),
        SessionIo {
            commands: cmd_rx,
            snapshots: snapshot_tx,
            mixer,
            frames: frames_rx,
            audio_status: audio_io.status.clone(),
            processing,
            audio_devices: audio_io.devices.clone(),
            shutdown: shutdown_rx,
        },
    )?;
    let result = session.run().await;

    let _ = shutdown_tx.send(true);
    audio_io.stop();
    tasks.shutdown().await;
    result.map(|_| {
        if restart_requested.load(Ordering::Relaxed) {
            RunOutcome::Restart
        } else {
            RunOutcome::Shutdown
        }
    })
}

/// Copies the audio thread's status into the shared hardware view.
async fn mirror_audio_status(
    mut status: watch::Receiver<crate::audio::io::AudioStatus>,
    hardware: Arc<std::sync::RwLock<state::Hardware>>,
    mut shutdown: watch::Receiver<bool>,
) {
    loop {
        {
            let current = status.borrow().clone();
            if let Ok(mut hardware) = hardware.write() {
                hardware.audio = state::AudioView {
                    capture_ok: current.capture_ok,
                    playback_ok: current.playback_ok,
                    capture_device: current.capture_device.clone(),
                    playback_device: current.playback_device.clone(),
                    last_error: current.last_error.clone(),
                    auto_processing: current.auto_processing,
                    aec: current.aec,
                    delay_ms: current.delay_ms,
                };
            }
        }
        tokio::select! {
            changed = status.changed() => { if changed.is_err() { break; } }
            _ = shutdown.changed() => { if *shutdown.borrow() { break; } }
        }
    }
}

fn spawn_signal_handler(shutdown: Arc<watch::Sender<bool>>) {
    tokio::spawn(async move {
        let mut terminate =
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
                Ok(signal) => signal,
                Err(error) => {
                    tracing::warn!(event = "signal-handler-failed", error = %error);
                    return;
                }
            };
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = terminate.recv() => {}
        }
        tracing::info!(event = "shutdown-requested");
        let _ = shutdown.send(true);
    });
}
