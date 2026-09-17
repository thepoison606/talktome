use std::collections::VecDeque;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex, OnceLock,
};
use std::time::{Instant, SystemTime};

static LOCAL_ONLY: AtomicBool = AtomicBool::new(false);
static EVENTS: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();

pub fn set_local_only(value: bool) {
    LOCAL_ONLY.store(value, Ordering::Relaxed);
}
pub fn local_only() -> bool {
    LOCAL_ONLY.load(Ordering::Relaxed)
}

fn record(message: String) {
    let mut events = EVENTS
        .get_or_init(|| Mutex::new(VecDeque::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if events.len() >= 1000 {
        events.pop_front();
    }
    events.push_back(format!("{:?}: {message}", SystemTime::now()));
}
pub fn trace<T>(label: impl Into<String>, work: impl FnOnce() -> T) -> T {
    let label = label.into();
    record(format!("BEGIN {label}"));
    let start = Instant::now();
    let result = work();
    record(format!("END {label} ({} ms)", start.elapsed().as_millis()));
    result
}
pub fn report() -> String {
    let events = EVENTS
        .get_or_init(|| Mutex::new(VecDeque::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    format!("Talktome Bridge audio diagnostics\nOS: {} / {}\nLocal only: {}\nNo API keys or server credentials included.\n\n{}",
        std::env::consts::OS, std::env::consts::ARCH, local_only(), events.iter().cloned().collect::<Vec<_>>().join("\n"))
}
