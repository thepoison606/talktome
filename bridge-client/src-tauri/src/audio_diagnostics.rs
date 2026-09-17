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

/// Create a new file without overwriting an earlier diagnostic report.
pub fn save_report(directory: &std::path::Path, report: &str) -> Result<std::path::PathBuf, String> {
    use std::io::Write;
    let timestamp = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| e.to_string())?.as_nanos();
    let path = directory.join(format!("talktome-bridge-audio-diagnostics-{timestamp}.txt"));
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&path)
        .map_err(|e| format!("Could not create {}: {e}", path.display()))?;
    file.write_all(report.as_bytes()).and_then(|_| file.sync_all())
        .map_err(|e| format!("Could not save {}: {e}", path.display()))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exports_real_files_without_overwriting_previous_reports() {
        let directory = std::env::temp_dir();
        let first = save_report(&directory, "first report").unwrap();
        let second = save_report(&directory, "second report").unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read_to_string(&first).unwrap(), "first report");
        assert_eq!(std::fs::read_to_string(&second).unwrap(), "second report");
        std::fs::remove_file(first).unwrap();
        std::fs::remove_file(second).unwrap();
    }
    #[test]
    fn reports_export_errors() {
        let missing = std::env::temp_dir().join(format!("missing-talktome-{}", std::process::id())).join("downloads");
        assert!(save_report(&missing, "report").unwrap_err().contains("Could not create"));
    }
}
