//! Control surfaces: Stream Deck, GPIO, local socket and a file-driven mock.

pub mod gpio;
pub mod local_api;
pub mod mock;
pub mod streamdeck;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use tokio::sync::{mpsc, watch};
use tokio::task::JoinSet;

use crate::config::Config;
use crate::state::{Bus, DeckInput, DeckStatus};

/// Environment variable pointing the mock surface at a directory.
pub const MOCK_DIR_ENV: &str = "TALKTOME_SURFACE_MOCK_DIR";

pub fn spawn_all(
    config: &Config,
    bus: &Bus,
    shutdown: watch::Receiver<bool>,
    tasks: &mut JoinSet<()>,
) {
    if let Some(dir) = std::env::var_os(MOCK_DIR_ENV) {
        tasks.spawn(mock::run(dir.into(), bus.clone(), shutdown.clone()));
    }
    if config.gpio.enabled
        && (!config.gpio.outputs.is_empty()
            || !config.gpio.inputs.is_empty()
            || !config.gpio.target_outputs.is_empty())
    {
        tasks.spawn(gpio::run(
            config.gpio.clone(),
            config.instance.clone(),
            config.streamdeck.volume_step_db(),
            bus.clone(),
            shutdown.clone(),
        ));
    } else if let Ok(mut hardware) = bus.hardware.write() {
        hardware.gpio.backend = "disabled".into();
    }
    if config.streamdeck.enabled {
        let devices = config.streamdeck.resolved_devices();
        let claimed = Arc::new(Mutex::new(HashSet::new()));
        let mut senders: Vec<mpsc::Sender<DeckInput>> = Vec::new();
        let mut pending = Vec::new();
        for (id, device) in devices.into_iter().enumerate() {
            let (tx, rx) = mpsc::channel(64);
            senders.push(tx);
            pending.push((id, device, rx));
        }
        if let Ok(mut hardware) = bus.hardware.write() {
            hardware.decks = pending
                .iter()
                .map(|(id, _, _)| DeckStatus {
                    id: *id,
                    enabled: true,
                    ..DeckStatus::default()
                })
                .collect();
            hardware.deck_inputs = senders;
        }
        for (id, device, rx) in pending {
            tasks.spawn(streamdeck::run(
                id,
                config.streamdeck.clone(),
                device,
                config.talk.clone(),
                bus.clone(),
                rx,
                shutdown.clone(),
                claimed.clone(),
            ));
        }
    } else if let Ok(mut hardware) = bus.hardware.write() {
        hardware.decks = vec![DeckStatus {
            enabled: false,
            ..DeckStatus::default()
        }];
    }
    if let Ok(mut hardware) = bus.hardware.write() {
        hardware.socket.enabled = config.socket.enabled;
        hardware.socket.unix_path = if config.socket.enabled {
            Some(
                config
                    .socket
                    .resolved_path(&config.instance)
                    .display()
                    .to_string(),
            )
        } else {
            None
        };
        hardware.socket.tcp = config.socket.tcp_bind().map(str::to_string);
        hardware.socket.clients = 0;
        hardware.socket.error = None;
    }
    if config.socket.enabled {
        tasks.spawn(local_api::run(
            config.socket.clone(),
            config.instance.clone(),
            config.streamdeck.volume_step_db(),
            bus.clone(),
            shutdown.clone(),
        ));
    }
}
