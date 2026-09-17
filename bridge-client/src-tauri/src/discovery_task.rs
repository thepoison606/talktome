//! Retained native work: polling never waits, and a slow call is never duplicated.
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub struct DiscoveryTask<T> {
    state: Arc<Mutex<State<T>>>,
}

struct State<T> {
    value: Option<T>,
    running: bool,
    started: Option<Instant>,
}

impl<T: Clone + Send + 'static> DiscoveryTask<T> {
    pub fn refresh_completed(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if !state.running { state.started = None; }
    }
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(State {
                value: None,
                running: false,
                started: None,
            })),
        }
    }

    pub fn poll(
        &self,
        refresh: Duration,
        work: impl FnOnce() -> T + Send + 'static,
    ) -> (Option<T>, bool) {
        self.poll_limited(refresh, None, work)
    }

    pub fn poll_limited(
        &self,
        refresh: Duration,
        limit: Option<(&'static AtomicUsize, usize)>,
        work: impl FnOnce() -> T + Send + 'static,
    ) -> (Option<T>, bool) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if !state.running && state.started.is_none_or(|at| at.elapsed() >= refresh) {
            if let Some((active, max)) = limit {
                if active
                    .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
                        (count < max).then_some(count + 1)
                    })
                    .is_err()
                {
                    return (state.value.clone(), true);
                }
            }
            state.running = true;
            state.started = Some(Instant::now());
            let shared = Arc::clone(&self.state);
            std::thread::spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(work));
                let mut state = shared.lock().unwrap_or_else(|e| e.into_inner());
                if let Ok(value) = result {
                    state.value = Some(value);
                }
                state.running = false;
                if let Some((active, _)) = limit {
                    active.fetch_sub(1, Ordering::SeqCst);
                }
            });
        }
        (state.value.clone(), state.running)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn limits_native_concurrency_and_starts_queued_work_later() {
        static ACTIVE: AtomicUsize = AtomicUsize::new(0);
        let first = DiscoveryTask::new();
        let queued = DiscoveryTask::new();
        let (send, receive) = std::sync::mpsc::channel();
        first.poll_limited(Duration::MAX, Some((&ACTIVE, 1)), move || {
            receive.recv().unwrap()
        });
        assert_eq!(
            queued.poll_limited(Duration::MAX, Some((&ACTIVE, 1)), || panic!("over limit")),
            (None, true)
        );
        send.send(1).unwrap();
        assert_eq!(await_result(&first), 1);
        queued.poll_limited(Duration::MAX, Some((&ACTIVE, 1)), || 2);
        assert_eq!(await_result(&queued), 2);
    }
    fn await_result(task: &DiscoveryTask<i32>) -> i32 {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let (value, busy) = task.poll(Duration::from_secs(60), || unreachable!());
            if !busy {
                return value.unwrap();
            }
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
    }

    #[test]
    fn slow_backend_does_not_block_an_independent_backend() {
        let slow = DiscoveryTask::new();
        let fast = DiscoveryTask::new();
        let (send, receive) = std::sync::mpsc::channel();
        slow.poll(Duration::from_secs(60), move || receive.recv().unwrap());
        fast.poll(Duration::from_secs(60), || 7);
        assert_eq!(await_result(&fast), 7);
        assert_eq!(
            slow.poll(Duration::ZERO, || panic!("duplicate")),
            (None, true)
        );
        send.send(9).unwrap();
        assert_eq!(await_result(&slow), 9);
    }

    #[test]
    fn preserves_previous_devices_during_refresh() {
        let task = DiscoveryTask::new();
        task.poll(Duration::ZERO, || 1);
        assert_eq!(await_result(&task), 1);
        let (send, receive) = std::sync::mpsc::channel();
        assert_eq!(
            task.poll(Duration::ZERO, move || receive.recv().unwrap()),
            (Some(1), true)
        );
        assert_eq!(
            task.poll(Duration::ZERO, || panic!("duplicate")),
            (Some(1), true)
        );
        send.send(2).unwrap();
        assert_eq!(await_result(&task), 2);
    }
    #[test]
    fn retains_late_results_and_does_not_duplicate_running_work() {
        let task = DiscoveryTask::new();
        let (send, receive) = std::sync::mpsc::channel();
        assert_eq!(
            task.poll(Duration::ZERO, move || receive.recv().unwrap()),
            (None, true)
        );
        for _ in 0..10 {
            assert_eq!(
                task.poll(Duration::ZERO, || panic!("duplicate probe")),
                (None, true)
            );
        }
        send.send(42).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let (value, busy) = task.poll(Duration::from_secs(60), || unreachable!());
            if !busy {
                assert_eq!(value, Some(42));
                break;
            }
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
    }
}
