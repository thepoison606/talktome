//! GPIO surface: outputs mirror tally/talk state, inputs drive talk keys.
//! Uses the Linux GPIO character device through `gpiocdev`; a file-based mock
//! backend (`TALKTOME_MOCK_GPIO=1`) stands in during tests.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use gpiocdev::line::{Bias, EdgeDetection, EdgeKind, Offset, Value};
use gpiocdev::request::Request;
use gpiocdev::tokio::AsyncRequest;
use tokio::sync::{mpsc, watch};

use crate::config::{
    GpioConfig, GpioInputAction, GpioInputConfig, GpioTargetOutputConfig, GpioTargetWhen,
};
use crate::state::{
    Bus, Command, GpioInputView, GpioOutputView, GpioStatus, InputSource, Snapshot, TargetRef,
};
use crate::talk::TargetKey;

pub const BACKEND_ENV: &str = "TALKTOME_MOCK_GPIO";
const GPIO_VOLUME_STEP: f32 = 0.1;

/// Output names in the order they appear in `gpio.outputs`.
pub const OUTPUT_NAMES: &[&str] = &[
    "tally",
    "tally_preview",
    "talking",
    "incoming",
    "connected",
    "locked",
    "status",
];

/// How often a configured `status` light is re-evaluated.
const STATUS_TICK: Duration = Duration::from_millis(50);
/// Length of the heartbeat flash while the client runs but is not registered.
const STATUS_FLASH_MS: u64 = 100;
/// Dark time after each flash; long enough not to read as the 1 s / 1 s
/// "degraded" blink.
const STATUS_FLASH_GAP_MS: u64 = 2000;

/// `gpio.outputs.status`: a status light readable without a screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusLight {
    /// Running, not registered on the server: a short flash, then 2 s dark.
    Running,
    /// Registered, but media not connected or another error: 1 s on, 1 s off.
    Degraded,
    /// Registered with media and audio up: steady on.
    Ok,
}

impl StatusLight {
    pub fn from_snapshot(snapshot: &Snapshot) -> Self {
        if !snapshot.connection.is_online() {
            return StatusLight::Running;
        }
        let media_down = matches!(
            snapshot.media_status.as_deref(),
            Some("Media interrupted") | Some("Media failed")
        );
        if snapshot.connection.is_ready()
            && snapshot.audio_ok
            && !snapshot.server_not_responding
            && !media_down
        {
            StatusLight::Ok
        } else {
            StatusLight::Degraded
        }
    }

    /// Line level `phase_ms` milliseconds into the pattern.
    pub fn level(self, phase_ms: u64) -> bool {
        match self {
            StatusLight::Running => {
                phase_ms % (STATUS_FLASH_MS + STATUS_FLASH_GAP_MS) < STATUS_FLASH_MS
            }
            StatusLight::Degraded => phase_ms % 2000 < 1000,
            StatusLight::Ok => true,
        }
    }
}

pub fn output_states(snapshot: &Snapshot) -> HashMap<&'static str, bool> {
    let mut states = HashMap::new();
    states.insert("tally", snapshot.on_air);
    states.insert("tally_preview", snapshot.preview);
    states.insert("talking", snapshot.talking);
    states.insert("incoming", !snapshot.incoming.is_empty());
    states.insert("connected", snapshot.connection.is_ready());
    states.insert("locked", snapshot.lock_active);
    states
}

pub fn target_output_id(output: &GpioTargetOutputConfig) -> String {
    format!("{}:{}", output.when.as_str(), output.target)
}

pub fn target_output_active(snapshot: &Snapshot, output: &GpioTargetOutputConfig) -> bool {
    let Some(key) = TargetKey::parse(&output.target) else {
        return false;
    };
    let Some(target) = snapshot.targets.iter().find(|t| t.key == key) else {
        return false;
    };
    match output.when {
        GpioTargetWhen::Incoming => target.incoming,
        GpioTargetWhen::Receiving => target.receiving,
    }
}

fn desired_output_states(
    config: &GpioConfig,
    snapshot: &Snapshot,
    phase_ms: u64,
) -> HashMap<String, bool> {
    let mut named = output_states(snapshot);
    named.insert(
        "status",
        StatusLight::from_snapshot(snapshot).level(phase_ms),
    );
    let mut states = HashMap::new();
    for name in OUTPUT_NAMES {
        if config.outputs.contains_key(*name) {
            states.insert(
                (*name).to_string(),
                named.get(name).copied().unwrap_or(false),
            );
        }
    }
    for output in &config.target_outputs {
        states.insert(
            target_output_id(output),
            target_output_active(snapshot, output),
        );
    }
    states
}

fn action_name(action: GpioInputAction) -> &'static str {
    match action {
        GpioInputAction::Talk => "talk",
        GpioInputAction::Reply => "reply",
        GpioInputAction::LockToggle => "lock_toggle",
        GpioInputAction::ClearLocks => "clear_locks",
        GpioInputAction::MuteToggle => "mute_toggle",
        GpioInputAction::VolumeUp => "volume_up",
        GpioInputAction::VolumeDown => "volume_down",
    }
}

/// Initial status view for a configuration (all outputs undriven, no presses).
pub fn initial_status(config: &GpioConfig, backend: &str) -> GpioStatus {
    GpioStatus {
        backend: backend.to_string(),
        error: None,
        outputs: OUTPUT_NAMES
            .iter()
            .filter_map(|name| {
                config.outputs.get(*name).map(|output| GpioOutputView {
                    name: name.to_string(),
                    line: output.line.clone(),
                    active_low: output.active_low,
                    active: None,
                    error: None,
                })
            })
            .chain(config.target_outputs.iter().map(|output| GpioOutputView {
                name: target_output_id(output),
                line: output.line.clone(),
                active_low: output.active_low,
                active: None,
                error: None,
            }))
            .collect(),
        inputs: config
            .inputs
            .iter()
            .map(|input| GpioInputView {
                line: input.line.clone(),
                action: action_name(input.action).to_string(),
                target: input.target.clone(),
                active_low: input.active_low,
                pressed: false,
                events: 0,
                error: None,
            })
            .collect(),
    }
}

fn publish_status(bus: &Bus, status: &GpioStatus) {
    if let Ok(mut hardware) = bus.hardware.write() {
        hardware.gpio = status.clone();
    }
}

fn set_input_pressed(status: &mut GpioStatus, index: usize, pressed: bool) {
    if let Some(view) = status.inputs.get_mut(index) {
        view.pressed = pressed;
    }
}

fn record_input(status: &mut GpioStatus, index: usize, pressed: bool) {
    if let Some(view) = status.inputs.get_mut(index) {
        view.pressed = pressed;
        view.events += 1;
    }
}

fn record_output(status: &mut GpioStatus, name: &str, active: Option<bool>, error: Option<String>) {
    if let Some(view) = status.outputs.iter_mut().find(|o| o.name == name) {
        view.active = active;
        view.error = error;
    }
}

/// An input transition after debouncing: `pressed` = line became active.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InputEvent {
    pub index: usize,
    pub pressed: bool,
}

/// Turns input transitions into surface commands.
pub fn command_for_input(input: &GpioInputConfig, pressed: bool) -> Option<Command> {
    let source = InputSource::Gpio(input.line.clone());
    let target_key = input.target.as_deref().and_then(TargetKey::parse);
    match input.action {
        GpioInputAction::Talk => {
            let target = TargetRef::Key(target_key?);
            Some(if pressed {
                Command::TalkPress { source, target }
            } else {
                Command::TalkRelease { source, target }
            })
        }
        GpioInputAction::Reply => Some(if pressed {
            Command::TalkPress {
                source,
                target: TargetRef::Reply,
            }
        } else {
            Command::TalkRelease {
                source,
                target: TargetRef::Reply,
            }
        }),
        GpioInputAction::ClearLocks => pressed.then_some(Command::ClearLocks),
        GpioInputAction::LockToggle
        | GpioInputAction::MuteToggle
        | GpioInputAction::VolumeUp
        | GpioInputAction::VolumeDown => {
            if !pressed {
                return None;
            }
            let key = target_key?;
            Some(match input.action {
                GpioInputAction::LockToggle => Command::LockToggle {
                    target: TargetRef::Key(key),
                },
                GpioInputAction::MuteToggle => Command::MuteToggle(key),
                GpioInputAction::VolumeUp => Command::VolumeStep {
                    target: key,
                    delta: GPIO_VOLUME_STEP,
                },
                _ => Command::VolumeStep {
                    target: key,
                    delta: -GPIO_VOLUME_STEP,
                },
            })
        }
    }
}

/// Hold-to-talk / reply honour the line level at startup; edge-only actions do not.
pub fn initial_command_for_input(input: &GpioInputConfig, pressed: bool) -> Option<Command> {
    if !pressed {
        return None;
    }
    match input.action {
        GpioInputAction::Talk | GpioInputAction::Reply => command_for_input(input, true),
        _ => None,
    }
}

/// Software debounce on top of whatever the kernel provides.
pub struct Debouncer {
    window: Duration,
    last: HashMap<usize, (Instant, bool)>,
}

impl Debouncer {
    pub fn new(window_ms: u32) -> Self {
        Self {
            window: Duration::from_millis(window_ms as u64),
            last: HashMap::new(),
        }
    }

    /// Returns the event if it should be acted upon.
    pub fn filter(&mut self, event: InputEvent, now: Instant) -> Option<InputEvent> {
        if let Some((at, pressed)) = self.last.get(&event.index) {
            if *pressed == event.pressed {
                return None;
            }
            if now.duration_since(*at) < self.window {
                return None;
            }
        }
        self.last.insert(event.index, (now, event.pressed));
        Some(event)
    }

    pub fn seed(&mut self, index: usize, pressed: bool, now: Instant) {
        self.last.insert(index, (now, pressed));
    }
}

pub async fn run(
    config: GpioConfig,
    instance: String,
    volume_step_db: f32,
    bus: Bus,
    shutdown: watch::Receiver<bool>,
) {
    let mock = std::env::var(BACKEND_ENV)
        .map(|v| !v.is_empty() && v != "0" && v != "false")
        .unwrap_or(false);
    let mut status = initial_status(&config, if mock { "mock" } else { "gpiocdev" });
    publish_status(&bus, &status);
    let result = if mock {
        run_mock(config, volume_step_db, &bus, &mut status, shutdown).await
    } else {
        let consumer = consumer_label(&instance);
        run_real(
            config,
            &consumer,
            volume_step_db,
            &bus,
            &mut status,
            shutdown,
        )
        .await
    };
    if let Err(error) = result {
        tracing::error!(event = "gpio-failed", error = %format!("{error:#}"));
        status.backend = "error".into();
        status.error = Some(format!("{error:#}"));
        publish_status(&bus, &status);
    }
}

struct ResolvedLine {
    chip: PathBuf,
    offset: Offset,
}

fn resolve_line(config: &GpioConfig, line: &str) -> Result<ResolvedLine> {
    let line = line.trim();
    if let Ok(offset) = line.parse::<Offset>() {
        let chip = config.chip.as_deref().ok_or_else(|| {
            anyhow!("gpio.chip is required when lines are given as offsets ({line})")
        })?;
        let chip = if chip.starts_with('/') {
            PathBuf::from(chip)
        } else {
            PathBuf::from("/dev").join(chip)
        };
        return Ok(ResolvedLine { chip, offset });
    }
    if let Some(chip) = config.chip.as_deref() {
        let path = if chip.starts_with('/') {
            PathBuf::from(chip)
        } else {
            PathBuf::from("/dev").join(chip)
        };
        let chip = gpiocdev::Chip::from_path(&path)
            .with_context(|| format!("opening {}", path.display()))?;
        for info in chip.line_info_iter()? {
            let info = info?;
            if info.name == line {
                return Ok(ResolvedLine {
                    chip: path,
                    offset: info.offset,
                });
            }
        }
        bail!("line {line:?} not found on {}", path.display());
    }
    let found = gpiocdev::find_named_line(line)
        .ok_or_else(|| anyhow!("GPIO line {line:?} not found on any chip"))?;
    Ok(ResolvedLine {
        chip: found.chip,
        offset: found.info.offset,
    })
}

/// `talktome-headless@<instance>`: shown by `gpioinfo` and in our own
/// "already used by" errors, so two instances can tell their lines apart.
pub fn consumer_label(instance: &str) -> String {
    format!("talktome-headless@{instance}")
}

/// Explains a failed line request; names the holder when the line is taken.
fn line_error(line: &str, resolved: &ResolvedLine, error: gpiocdev::Error) -> anyhow::Error {
    let holder = gpiocdev::Chip::from_path(&resolved.chip)
        .and_then(|chip| chip.line_info(resolved.offset))
        .ok()
        .filter(|info| info.used);
    match holder {
        Some(info) if !info.consumer.is_empty() => {
            anyhow!("{line} is already used by {}", info.consumer)
        }
        Some(_) => anyhow!("{line} is already used by another program"),
        None => anyhow!("requesting {line}: {error}"),
    }
}

fn request_output(
    config: &GpioConfig,
    consumer: &str,
    output: &crate::config::GpioOutputConfig,
) -> Result<(Request, ResolvedLine)> {
    let resolved = resolve_line(config, &output.line)?;
    let mut builder = Request::builder();
    builder
        .on_chip(&resolved.chip)
        .with_consumer(consumer)
        .with_line(resolved.offset)
        .as_output(Value::Inactive);
    if output.active_low {
        builder.as_active_low();
    }
    match builder.request() {
        Ok(request) => Ok((request, resolved)),
        Err(error) => Err(line_error(&output.line, &resolved, error)),
    }
}

fn request_input(
    config: &GpioConfig,
    consumer: &str,
    input: &GpioInputConfig,
) -> Result<(Request, Offset)> {
    let resolved = resolve_line(config, &input.line)?;
    let build = |debounce: bool| {
        let mut builder = Request::builder();
        builder
            .on_chip(&resolved.chip)
            .with_consumer(consumer)
            .with_line(resolved.offset)
            .as_input()
            .with_edge_detection(EdgeDetection::BothEdges)
            .with_bias(if input.active_low {
                Bias::PullUp
            } else {
                Bias::PullDown
            });
        if input.active_low {
            builder.as_active_low();
        } else {
            builder.as_active_high();
        }
        if debounce && input.debounce_ms > 0 {
            builder.with_debounce_period(Duration::from_millis(input.debounce_ms as u64));
        }
        builder.request()
    };
    let result = build(true).or_else(|error| {
        if input.debounce_ms == 0 {
            return Err(error);
        }
        // Older kernels lack debounce support in the uAPI; retry without it.
        tracing::warn!(event = "gpio-input-retry", line = %input.line, error = %error);
        build(false)
    });
    match result {
        Ok(request) => Ok((request, resolved.offset)),
        Err(error) => Err(line_error(&input.line, &resolved, error)),
    }
}

struct OutputLine {
    request: Request,
    offset: Offset,
    current: Option<bool>,
}

async fn run_real(
    config: GpioConfig,
    consumer: &str,
    volume_step_db: f32,
    bus: &Bus,
    status: &mut GpioStatus,
    mut shutdown: watch::Receiver<bool>,
) -> Result<()> {
    // Every line is requested on its own: another instance may hold some
    // lines of the same chip, and a line that is taken only disables itself.
    let mut problems: Vec<String> = Vec::new();
    let mut outputs: HashMap<String, OutputLine> = HashMap::new();
    let mut named: Vec<(String, crate::config::GpioOutputConfig)> = config
        .outputs
        .iter()
        .filter(|(name, _)| OUTPUT_NAMES.contains(&name.as_str()))
        .map(|(name, output)| (name.clone(), output.clone()))
        .collect();
    for output in &config.target_outputs {
        named.push((
            target_output_id(output),
            crate::config::GpioOutputConfig {
                line: output.line.clone(),
                active_low: output.active_low,
            },
        ));
    }
    for (name, output) in &named {
        match request_output(&config, consumer, output) {
            Ok((request, resolved)) => {
                tracing::info!(event = "gpio-output", name, line = %output.line, chip = %resolved.chip.display(), offset = resolved.offset);
                outputs.insert(
                    name.clone(),
                    OutputLine {
                        request,
                        offset: resolved.offset,
                        current: None,
                    },
                );
            }
            Err(error) => {
                let error = format!("{error:#}");
                tracing::warn!(event = "gpio-line-unavailable", name, line = %output.line, error = %error);
                record_output(status, name, None, Some(error.clone()));
                problems.push(format!("{name} output: {error}"));
            }
        }
    }

    let (event_tx, mut event_rx) = mpsc::channel::<InputEvent>(64);
    let inputs = Arc::new(config.inputs.clone());
    let mut initial_levels: Vec<(usize, bool)> = Vec::new();
    for (index, input) in config.inputs.iter().enumerate() {
        let (request, offset) = match request_input(&config, consumer, input) {
            Ok(requested) => requested,
            Err(error) => {
                let error = format!("{error:#}");
                tracing::warn!(event = "gpio-line-unavailable", line = %input.line, error = %error);
                if let Some(view) = status.inputs.get_mut(index) {
                    view.error = Some(error.clone());
                }
                problems.push(format!("{} input: {error}", action_name(input.action)));
                continue;
            }
        };
        tracing::info!(event = "gpio-input", line = %input.line, offset, action = ?input.action);
        match request.value(offset) {
            Ok(value) => {
                let pressed = matches!(value, Value::Active);
                initial_levels.push((index, pressed));
                tracing::info!(
                    event = "gpio-input-initial",
                    line = %input.line,
                    pressed,
                    active_low = input.active_low
                );
            }
            Err(error) => {
                tracing::warn!(event = "gpio-input-initial-failed", line = %input.line, error = %error);
            }
        }
        let tx = event_tx.clone();
        let async_request = AsyncRequest::new(request);
        tokio::spawn(async move {
            loop {
                match async_request.read_edge_event().await {
                    Ok(event) => {
                        let pressed = matches!(event.kind, EdgeKind::Rising);
                        if tx.send(InputEvent { index, pressed }).await.is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        tracing::warn!(event = "gpio-read-failed", error = %error);
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                }
            }
        });
    }
    drop(event_tx);
    status.error = (!problems.is_empty()).then(|| problems.join("\n"));

    let mut snapshots = bus.snapshots.clone();
    let mut debouncer = Debouncer::new(
        config
            .inputs
            .iter()
            .map(|i| i.debounce_ms)
            .max()
            .unwrap_or(20),
    );
    let started = Instant::now();
    let phase = || started.elapsed().as_millis() as u64;
    let blinking = config.outputs.contains_key("status");
    let mut status_tick = tokio::time::interval(STATUS_TICK);
    apply_outputs(&config, &mut outputs, &snapshots.borrow(), phase(), status);
    let now = Instant::now();
    for (index, pressed) in initial_levels {
        set_input_pressed(status, index, pressed);
        debouncer.seed(index, pressed, now);
        if let Some(command) = initial_command_for_input(&inputs[index], pressed) {
            tracing::info!(
                event = "gpio-input",
                line = %inputs[index].line,
                pressed,
                initial = true
            );
            let _ = bus.commands.send(command).await;
        }
    }
    publish_status(bus, status);

    loop {
        tokio::select! {
            changed = snapshots.changed() => {
                if changed.is_err() { break; }
                let snapshot = snapshots.borrow().clone();
                if apply_outputs(&config, &mut outputs, &snapshot, phase(), status) {
                    publish_status(bus, status);
                }
            }
            _ = status_tick.tick(), if blinking => {
                let snapshot = snapshots.borrow().clone();
                if apply_outputs(&config, &mut outputs, &snapshot, phase(), status) {
                    publish_status(bus, status);
                }
            }
            Some(event) = event_rx.recv() => {
                if let Some(event) = debouncer.filter(event, Instant::now()) {
                    let input = &inputs[event.index];
                    tracing::info!(event = "gpio-input", line = %input.line, pressed = event.pressed);
                    record_input(status, event.index, event.pressed);
                    publish_status(bus, status);
                    let snapshot = snapshots.borrow().clone();
                    if let Some(command) = runtime_command_for_input(
                        input,
                        event.pressed,
                        volume_step_db,
                        &snapshot,
                    ) {
                        let _ = bus.commands.send(command).await;
                    }
                }
            }
            _ = shutdown.changed() => {
                if *shutdown.borrow() { break; }
            }
        }
    }
    for output in outputs.values_mut() {
        let _ = output.request.set_value(output.offset, Value::Inactive);
    }
    Ok(())
}

fn runtime_command_for_input(
    input: &GpioInputConfig,
    pressed: bool,
    volume_step_db: f32,
    snapshot: &Snapshot,
) -> Option<Command> {
    match input.action {
        GpioInputAction::VolumeUp | GpioInputAction::VolumeDown if pressed => {
            let key = TargetKey::parse(input.target.as_deref()?)?;
            let current = snapshot
                .targets
                .iter()
                .find(|t| t.key == key)
                .map(|t| t.volume)
                .unwrap_or(1.0);
            let delta = if input.action == GpioInputAction::VolumeUp {
                volume_step_db
            } else {
                -volume_step_db
            };
            Some(Command::VolumeSet {
                target: key,
                volume: crate::audio::mixer::step_volume_db(current, delta),
            })
        }
        _ => command_for_input(input, pressed),
    }
}

/// Drives changed outputs; returns true when any line state changed.
fn apply_outputs(
    config: &GpioConfig,
    outputs: &mut HashMap<String, OutputLine>,
    snapshot: &Snapshot,
    phase_ms: u64,
    status: &mut GpioStatus,
) -> bool {
    let states = desired_output_states(config, snapshot, phase_ms);
    let mut changed = false;
    for (name, output) in outputs.iter_mut() {
        let active = states.get(name).copied().unwrap_or(false);
        if output.current == Some(active) {
            continue;
        }
        let value = if active {
            Value::Active
        } else {
            Value::Inactive
        };
        match output.request.set_value(output.offset, value) {
            Ok(()) => {
                output.current = Some(active);
                record_output(status, name, Some(active), None);
                if name == "tally" || name == "tally_preview" {
                    tracing::info!(event = "tally-output", name, active);
                }
            }
            Err(error) => {
                tracing::warn!(event = "gpio-write-failed", name, error = %error);
                record_output(status, name, None, Some(error.to_string()));
            }
        }
        changed = true;
    }
    changed
}

/// Mock backend: outputs to `<dir>/gpio-outputs.json`, inputs from lines
/// `<line> press|release` appended to `<dir>/gpio-inputs`.
async fn run_mock(
    config: GpioConfig,
    volume_step_db: f32,
    bus: &Bus,
    status: &mut GpioStatus,
    mut shutdown: watch::Receiver<bool>,
) -> Result<()> {
    let dir = std::env::var_os(super::MOCK_DIR_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    std::fs::create_dir_all(&dir)?;
    let outputs_path = dir.join("gpio-outputs.json");
    let inputs_path = dir.join("gpio-inputs");
    let mut offset = std::fs::metadata(&inputs_path)
        .map(|m| m.len())
        .unwrap_or(0);
    let mut snapshots = bus.snapshots.clone();
    let mut poll = tokio::time::interval(Duration::from_millis(50));
    let mut debouncer = Debouncer::new(0);
    tracing::info!(event = "gpio-mock", dir = %dir.display());

    let started = Instant::now();
    let mut written: Option<HashMap<String, bool>> = None;
    let mut write_outputs = |snapshot: &Snapshot, status: &mut GpioStatus| {
        let states = desired_output_states(&config, snapshot, started.elapsed().as_millis() as u64);
        // The status light is re-evaluated every poll; write only changes.
        if written.as_ref() == Some(&states) {
            return;
        }
        written = Some(states.clone());
        let mut map = serde_json::Map::new();
        for (name, active) in &states {
            record_output(status, name, Some(*active), None);
            map.insert(name.clone(), serde_json::Value::Bool(*active));
        }
        let _ = std::fs::write(
            &outputs_path,
            serde_json::to_string_pretty(&map).unwrap_or_default(),
        );
        publish_status(bus, status);
    };
    write_outputs(&snapshots.borrow(), status);

    if let Ok(text) = std::fs::read_to_string(&inputs_path) {
        let now = Instant::now();
        for (index, pressed) in last_mock_input_states(&text, &config.inputs) {
            set_input_pressed(status, index, pressed);
            debouncer.seed(index, pressed, now);
            if let Some(command) = initial_command_for_input(&config.inputs[index], pressed) {
                tracing::info!(
                    event = "gpio-input",
                    line = %config.inputs[index].line,
                    pressed,
                    initial = true
                );
                let _ = bus.commands.send(command).await;
            }
        }
        publish_status(bus, status);
    }

    loop {
        tokio::select! {
            changed = snapshots.changed() => {
                if changed.is_err() { break; }
                let snapshot = snapshots.borrow().clone();
                write_outputs(&snapshot, status);
            }
            _ = poll.tick() => {
                if config.outputs.contains_key("status") {
                    let snapshot = snapshots.borrow().clone();
                    write_outputs(&snapshot, status);
                }
                let Ok(text) = std::fs::read_to_string(&inputs_path) else { continue };
                if (text.len() as u64) < offset { offset = 0; }
                let new_text = &text[offset as usize..];
                let Some(last_newline) = new_text.rfind('\n') else { continue };
                for line in new_text[..last_newline].lines() {
                    let mut parts = line.split_whitespace();
                    let (Some(name), Some(state)) = (parts.next(), parts.next()) else { continue };
                    let Some(index) = config.inputs.iter().position(|i| i.line == name) else {
                        tracing::warn!(event = "gpio-mock-unknown-line", line = name);
                        continue;
                    };
                    let pressed = matches!(state, "press" | "1" | "on" | "active");
                    if debouncer.filter(InputEvent { index, pressed }, Instant::now()).is_some() {
                        tracing::info!(event = "gpio-input", line = name, pressed);
                        record_input(status, index, pressed);
                        publish_status(bus, status);
                        let snapshot = snapshots.borrow().clone();
                        if let Some(command) = runtime_command_for_input(
                            &config.inputs[index],
                            pressed,
                            volume_step_db,
                            &snapshot,
                        ) {
                            let _ = bus.commands.send(command).await;
                        }
                    }
                }
                offset += (last_newline + 1) as u64;
            }
            _ = shutdown.changed() => {
                if *shutdown.borrow() { break; }
            }
        }
    }
    Ok(())
}

fn last_mock_input_states(text: &str, inputs: &[GpioInputConfig]) -> Vec<(usize, bool)> {
    let mut last = HashMap::new();
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let (Some(name), Some(state)) = (parts.next(), parts.next()) else {
            continue;
        };
        let Some(index) = inputs.iter().position(|input| input.line == name) else {
            continue;
        };
        last.insert(index, matches!(state, "press" | "1" | "on" | "active"));
    }
    let mut states: Vec<_> = last.into_iter().collect();
    states.sort_by_key(|(index, _)| *index);
    states
}

/// `talktome-headless list-gpio`.
pub fn list() -> Result<()> {
    let chips = gpiocdev::chip::chips().context("listing GPIO chips")?;
    if chips.is_empty() {
        println!("No GPIO chips found (/dev/gpiochip*).");
        return Ok(());
    }
    for path in chips {
        let chip = gpiocdev::Chip::from_path(&path)?;
        let info = chip.info()?;
        println!(
            "{} ({}, {} lines)",
            path.display(),
            info.label,
            info.num_lines
        );
        for line in chip.line_info_iter()? {
            let line = line?;
            let used = if line.used {
                format!(" [used by {}]", line.consumer)
            } else {
                String::new()
            };
            println!(
                "  {:>3}  {}{}",
                line.offset,
                if line.name.is_empty() {
                    "-"
                } else {
                    &line.name
                },
                used
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::GpioTargetWhen;
    use crate::state::ConnectionState;

    fn input(action: GpioInputAction, target: Option<&str>) -> GpioInputConfig {
        GpioInputConfig {
            line: "GPIO22".into(),
            action,
            target: target.map(str::to_string),
            active_low: true,
            debounce_ms: 20,
        }
    }

    #[test]
    fn runtime_volume_steps_in_db() {
        use crate::state::TargetInfo;
        let mut snapshot = Snapshot::initial("i", "u");
        snapshot.targets.push(TargetInfo {
            key: TargetKey::Feed(1),
            name: "PGM".into(),
            can_talk: false,
            online: true,
            held: false,
            locked: false,
            incoming: false,
            receiving: false,
            volume: 1.0,
            muted: false,
            members: Vec::new(),
        });
        let down = input(GpioInputAction::VolumeDown, Some("feed:1"));
        match runtime_command_for_input(&down, true, 6.0, &snapshot) {
            Some(Command::VolumeSet { volume, .. }) => {
                assert!((crate::audio::mixer::volume_to_db(volume) + 6.0).abs() < 0.05);
            }
            other => panic!("expected VolumeSet, got {other:?}"),
        }
    }

    #[test]
    fn last_mock_line_is_the_startup_level() {
        let inputs = vec![input(GpioInputAction::Talk, Some("conference:1"))];
        let states =
            last_mock_input_states("GPIO22 press\nGPIO22 release\nGPIO22 press\n", &inputs);
        assert_eq!(states, vec![(0, true)]);
    }

    #[test]
    fn maps_inputs_to_commands() {
        let talk = input(GpioInputAction::Talk, Some("conference:1"));
        assert!(matches!(
            command_for_input(&talk, true),
            Some(Command::TalkPress {
                target: TargetRef::Key(TargetKey::Conference(1)),
                ..
            })
        ));
        assert!(matches!(
            command_for_input(&talk, false),
            Some(Command::TalkRelease { .. })
        ));
        let lock = input(GpioInputAction::LockToggle, Some("user:2"));
        assert!(matches!(
            command_for_input(&lock, true),
            Some(Command::LockToggle { .. })
        ));
        assert!(command_for_input(&lock, false).is_none());
        let up = input(GpioInputAction::VolumeUp, Some("feed:1"));
        assert!(
            matches!(command_for_input(&up, true), Some(Command::VolumeStep { delta, .. }) if delta > 0.0)
        );
        let reply = input(GpioInputAction::Reply, None);
        assert!(matches!(
            command_for_input(&reply, true),
            Some(Command::TalkPress {
                target: TargetRef::Reply,
                ..
            })
        ));
    }

    #[test]
    fn output_states_follow_snapshot() {
        let mut snapshot = Snapshot::initial("i", "u");
        snapshot.on_air = true;
        snapshot.connection = ConnectionState::Ready;
        let states = output_states(&snapshot);
        assert!(states["tally"]);
        assert!(!states["tally_preview"]);
        assert!(states["connected"]);
        assert!(!states["talking"]);
        snapshot.preview = true;
        snapshot.on_air = false;
        assert!(output_states(&snapshot)["tally_preview"]);
        assert!(!output_states(&snapshot)["tally"]);
        snapshot.on_air = true;
        let both = output_states(&snapshot);
        assert!(both["tally"]);
        assert!(both["tally_preview"]);
        snapshot.connection = ConnectionState::Registered;
        assert!(!output_states(&snapshot)["connected"]);
        snapshot.connection = ConnectionState::Disconnected;
        assert!(!output_states(&snapshot)["connected"]);
    }

    #[test]
    fn status_light_follows_registration_and_media() {
        let mut snapshot = Snapshot::initial("cam1", "Cam 1");
        snapshot.connection = ConnectionState::Connecting;
        assert_eq!(StatusLight::from_snapshot(&snapshot), StatusLight::Running);
        snapshot.connection = ConnectionState::Registered;
        snapshot.audio_ok = true;
        assert_eq!(StatusLight::from_snapshot(&snapshot), StatusLight::Degraded);
        snapshot.connection = ConnectionState::Ready;
        assert_eq!(StatusLight::from_snapshot(&snapshot), StatusLight::Ok);
        snapshot.audio_ok = false;
        assert_eq!(StatusLight::from_snapshot(&snapshot), StatusLight::Degraded);
        snapshot.audio_ok = true;
        snapshot.server_not_responding = true;
        assert_eq!(StatusLight::from_snapshot(&snapshot), StatusLight::Degraded);
        snapshot.server_not_responding = false;
        snapshot.media_status = Some("Media interrupted".into());
        assert_eq!(StatusLight::from_snapshot(&snapshot), StatusLight::Degraded);
    }

    #[test]
    fn status_light_patterns() {
        // Running: a 100 ms flash, then 2 s dark (2.1 s cycle).
        assert!(StatusLight::Running.level(0));
        assert!(StatusLight::Running.level(99));
        assert!(!StatusLight::Running.level(100));
        assert!(!StatusLight::Running.level(1050));
        assert!(!StatusLight::Running.level(2099));
        assert!(StatusLight::Running.level(2100));
        assert!(StatusLight::Running.level(4250));
        let lit = (0..2100)
            .filter(|ms| StatusLight::Running.level(*ms))
            .count();
        assert_eq!(lit, 100);
        // Degraded: one second on, one second off.
        assert!(StatusLight::Degraded.level(500));
        assert!(!StatusLight::Degraded.level(1500));
        assert!(StatusLight::Degraded.level(2100));
        // Ok: steady.
        assert!((0..4000).step_by(50).all(|ms| StatusLight::Ok.level(ms)));
    }

    #[test]
    fn status_output_is_driven_only_when_configured() {
        let mut snapshot = Snapshot::initial("cam1", "Cam 1");
        snapshot.connection = ConnectionState::Ready;
        snapshot.audio_ok = true;
        let mut config = GpioConfig::default();
        assert!(!desired_output_states(&config, &snapshot, 0).contains_key("status"));
        config.outputs.insert(
            "status".into(),
            crate::config::GpioOutputConfig {
                line: "GPIO23".into(),
                active_low: false,
            },
        );
        assert!(desired_output_states(&config, &snapshot, 1500)["status"]);
    }

    #[test]
    fn initial_hold_talks_edge_actions_do_not() {
        let talk = input(GpioInputAction::Talk, Some("conference:1"));
        assert!(matches!(
            initial_command_for_input(&talk, true),
            Some(Command::TalkPress { .. })
        ));
        assert!(initial_command_for_input(&talk, false).is_none());
        let lock = input(GpioInputAction::LockToggle, Some("user:2"));
        assert!(initial_command_for_input(&lock, true).is_none());
    }

    #[test]
    fn target_output_follows_receiving_or_incoming() {
        use crate::config::GpioTargetOutputConfig;
        use crate::state::TargetInfo;
        let mut snapshot = Snapshot::initial("i", "u");
        snapshot.targets.push(TargetInfo {
            key: TargetKey::Conference(1),
            name: "News".into(),
            can_talk: true,
            online: true,
            held: false,
            locked: false,
            incoming: true,
            receiving: false,
            volume: 1.0,
            muted: false,
            members: Vec::new(),
        });
        let incoming = GpioTargetOutputConfig {
            line: "GPIO18".into(),
            target: "conference:1".into(),
            active_low: false,
            when: GpioTargetWhen::Incoming,
        };
        let receiving = GpioTargetOutputConfig {
            line: "GPIO19".into(),
            target: "conference:1".into(),
            active_low: false,
            when: GpioTargetWhen::Receiving,
        };
        assert!(target_output_active(&snapshot, &incoming));
        assert!(!target_output_active(&snapshot, &receiving));
        snapshot.targets[0].receiving = true;
        snapshot.targets[0].incoming = false;
        assert!(!target_output_active(&snapshot, &incoming));
        assert!(target_output_active(&snapshot, &receiving));
    }

    #[test]
    fn debouncer_seed_skips_the_startup_level() {
        let mut debouncer = Debouncer::new(0);
        let t0 = Instant::now();
        debouncer.seed(0, true, t0);
        assert!(debouncer
            .filter(
                InputEvent {
                    index: 0,
                    pressed: true
                },
                t0
            )
            .is_none());
        assert!(debouncer
            .filter(
                InputEvent {
                    index: 0,
                    pressed: false
                },
                t0
            )
            .is_some());
    }

    #[test]
    fn debouncer_drops_bounces_and_repeats() {
        let mut debouncer = Debouncer::new(20);
        let t0 = Instant::now();
        assert!(debouncer
            .filter(
                InputEvent {
                    index: 0,
                    pressed: true
                },
                t0
            )
            .is_some());
        assert!(debouncer
            .filter(
                InputEvent {
                    index: 0,
                    pressed: true
                },
                t0
            )
            .is_none());
        assert!(debouncer
            .filter(
                InputEvent {
                    index: 0,
                    pressed: false
                },
                t0 + Duration::from_millis(5)
            )
            .is_none());
        assert!(debouncer
            .filter(
                InputEvent {
                    index: 0,
                    pressed: false
                },
                t0 + Duration::from_millis(50)
            )
            .is_some());
    }
}
