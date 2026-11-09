//! Connection-loss warning, matching the v1.5.6 web client.
//!
//! While registered, the session emits `connection-health` every 500 ms and
//! waits up to 2 s for `true`. A server that never acknowledges the event
//! (older than 1.5.6) does not raise "Server not responding".

use std::time::{Duration, Instant};

pub const PROBE_TIMEOUT: Duration = Duration::from_secs(2);
pub const MAX_PROBES: u8 = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Announcement {
    Disconnected,
    Reconnected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProbeReply {
    pub generation: u64,
    pub sent_at: Instant,
    pub ok: bool,
}

#[derive(Debug)]
pub struct ConnectionAlerts {
    generation: u64,
    running: bool,
    supported: bool,
    interrupted: bool,
    last_ok: Instant,
    outstanding: u8,
    lost: bool,
    suppress: bool,
}

impl ConnectionAlerts {
    pub fn new() -> Self {
        Self {
            generation: 0,
            running: false,
            supported: false,
            interrupted: false,
            last_ok: Instant::now(),
            outstanding: 0,
            lost: false,
            suppress: false,
        }
    }

    /// Begin a registered session. Loss that started on the previous
    /// connection is kept so the recovery tone can play once media is back.
    pub fn start(&mut self, now: Instant) {
        self.generation = self.generation.wrapping_add(1);
        self.running = true;
        self.interrupted = false;
        self.last_ok = now;
        self.outstanding = 0;
        self.suppress = false;
    }

    pub fn stop(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.running = false;
        self.interrupted = false;
        self.outstanding = 0;
    }

    /// Intentional shutdown or `session-kicked`: do not play the loss tone.
    pub fn suppress_loss(&mut self) {
        self.suppress = true;
        self.stop();
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn interrupted(&self) -> bool {
        self.interrupted
    }

    pub fn wants_probe(&self) -> bool {
        self.running && self.outstanding < MAX_PROBES
    }

    pub fn note_probe_sent(&mut self) {
        self.outstanding = self.outstanding.saturating_add(1);
    }

    /// Warn once the server has proved it speaks `connection-health` and then
    /// goes silent for [`PROBE_TIMEOUT`].
    pub fn on_tick(&mut self, now: Instant) -> Option<Announcement> {
        if !self.running || !self.supported || self.interrupted {
            return None;
        }
        if now.saturating_duration_since(self.last_ok) >= PROBE_TIMEOUT {
            self.interrupted = true;
            return self.mark_lost();
        }
        None
    }

    pub fn on_ack(
        &mut self,
        reply: ProbeReply,
        now: Instant,
        send_blocks: bool,
        recv_blocks: bool,
    ) -> Option<Announcement> {
        self.outstanding = self.outstanding.saturating_sub(1);
        if !self.running || reply.generation != self.generation {
            return None;
        }
        if !reply.ok || now.saturating_duration_since(reply.sent_at) >= PROBE_TIMEOUT {
            return None;
        }
        self.last_ok = now;
        self.supported = true;
        if self.interrupted {
            self.interrupted = false;
            return self.mark_recovered(send_blocks, recv_blocks);
        }
        None
    }

    pub fn on_socket_lost(&mut self) -> Option<Announcement> {
        self.stop();
        if self.suppress {
            return None;
        }
        self.mark_lost()
    }

    pub fn on_transport_down(&mut self) -> Option<Announcement> {
        if self.suppress {
            return None;
        }
        self.mark_lost()
    }

    pub fn on_transport_up(
        &mut self,
        send_blocks: bool,
        recv_blocks: bool,
    ) -> Option<Announcement> {
        if self.suppress || !self.running || self.interrupted {
            return None;
        }
        self.mark_recovered(send_blocks, recv_blocks)
    }

    /// `ok` / `missing` / `not offered` while online, otherwise an em dash.
    pub fn heartbeat(&self, online: bool) -> &'static str {
        if !online {
            "–"
        } else if self.interrupted {
            "missing"
        } else if !self.supported {
            "not offered"
        } else {
            "ok"
        }
    }

    fn mark_lost(&mut self) -> Option<Announcement> {
        if self.suppress || self.lost {
            return None;
        }
        self.lost = true;
        Some(Announcement::Disconnected)
    }

    fn mark_recovered(&mut self, send_blocks: bool, recv_blocks: bool) -> Option<Announcement> {
        if !self.lost || send_blocks || recv_blocks {
            return None;
        }
        self.lost = false;
        Some(Announcement::Reconnected)
    }
}

/// Web client label for the media line. `None` while transports are idle.
pub fn media_status(interrupted: bool, send: &str, recv: &str) -> Option<&'static str> {
    if send == "failed" || recv == "failed" {
        return Some("Media failed");
    }
    if interrupted {
        return Some("Server not responding");
    }
    if send == "disconnected" || recv == "disconnected" {
        return Some("Media interrupted");
    }
    if send == "connecting" || recv == "connecting" {
        return Some("Media connecting");
    }
    if send == "connected" || recv == "connected" {
        return Some("Media connected");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(start: Instant, ms: u64) -> Instant {
        start + Duration::from_millis(ms)
    }

    #[test]
    fn silent_loss_warns_after_two_seconds_once_the_server_has_answered() {
        let t0 = Instant::now();
        let mut alerts = ConnectionAlerts::new();
        alerts.start(t0);
        let generation = alerts.generation();
        alerts.note_probe_sent();
        assert_eq!(
            alerts.on_ack(
                ProbeReply {
                    generation,
                    sent_at: t0,
                    ok: true,
                },
                t0,
                false,
                false,
            ),
            None
        );
        assert_eq!(alerts.on_tick(at(t0, 1500)), None);
        assert!(!alerts.interrupted());
        assert_eq!(
            alerts.on_tick(at(t0, 2000)),
            Some(Announcement::Disconnected)
        );
        assert!(alerts.interrupted());
        assert_eq!(alerts.heartbeat(true), "missing");
        assert_eq!(
            alerts.on_tick(at(t0, 2500)),
            None,
            "the loss tone plays once"
        );

        alerts.note_probe_sent();
        assert_eq!(
            alerts.on_ack(
                ProbeReply {
                    generation,
                    sent_at: at(t0, 2600),
                    ok: true,
                },
                at(t0, 2700),
                false,
                false,
            ),
            Some(Announcement::Reconnected)
        );
        assert!(!alerts.interrupted());
        assert_eq!(alerts.heartbeat(true), "ok");
    }

    #[test]
    fn healthy_replies_never_warn() {
        let t0 = Instant::now();
        let mut alerts = ConnectionAlerts::new();
        alerts.start(t0);
        let generation = alerts.generation();
        let mut now = t0;
        for _ in 0..20 {
            alerts.note_probe_sent();
            now += Duration::from_millis(500);
            assert_eq!(
                alerts.on_ack(
                    ProbeReply {
                        generation,
                        sent_at: now,
                        ok: true,
                    },
                    now,
                    false,
                    false,
                ),
                None
            );
            assert_eq!(alerts.on_tick(now), None);
        }
        assert!(!alerts.interrupted());
    }

    #[test]
    fn expired_failed_and_stale_replies_cannot_clear_the_warning() {
        let t0 = Instant::now();
        let mut alerts = ConnectionAlerts::new();
        alerts.start(t0);
        let generation = alerts.generation();
        alerts.note_probe_sent();
        alerts.on_ack(
            ProbeReply {
                generation,
                sent_at: t0,
                ok: true,
            },
            t0,
            false,
            false,
        );
        assert!(alerts.on_tick(at(t0, 2000)).is_some());

        alerts.note_probe_sent();
        assert_eq!(
            alerts.on_ack(
                ProbeReply {
                    generation,
                    sent_at: t0,
                    ok: true,
                },
                at(t0, 2000),
                false,
                false,
            ),
            None,
            "a reply that is already 2s old does not clear the warning"
        );
        alerts.note_probe_sent();
        assert_eq!(
            alerts.on_ack(
                ProbeReply {
                    generation,
                    sent_at: at(t0, 2100),
                    ok: false,
                },
                at(t0, 2200),
                false,
                false,
            ),
            None
        );
        assert!(alerts.interrupted());

        let stale = generation;
        alerts.stop();
        alerts.start(at(t0, 3000));
        alerts.note_probe_sent();
        assert_eq!(
            alerts.on_ack(
                ProbeReply {
                    generation: stale,
                    sent_at: at(t0, 3000),
                    ok: true,
                },
                at(t0, 3100),
                false,
                false,
            ),
            None
        );
        assert!(
            !alerts.interrupted(),
            "a reply from the previous connection does not clear or refresh the timer"
        );
        assert_eq!(alerts.heartbeat(true), "ok");
        assert_eq!(
            alerts.on_tick(at(t0, 5000)),
            None,
            "the loss tone already played for this outage"
        );
        assert!(alerts.interrupted());
        assert_eq!(alerts.heartbeat(true), "missing");
    }

    #[test]
    fn a_server_that_never_answers_does_not_warn() {
        let t0 = Instant::now();
        let mut alerts = ConnectionAlerts::new();
        alerts.start(t0);
        let generation = alerts.generation();
        for step in 1..10 {
            alerts.note_probe_sent();
            assert_eq!(
                alerts.on_ack(
                    ProbeReply {
                        generation,
                        sent_at: at(t0, step * 500),
                        ok: false,
                    },
                    at(t0, step * 500 + 2000),
                    false,
                    false,
                ),
                None
            );
            assert_eq!(alerts.on_tick(at(t0, step * 500 + 2000)), None);
        }
        assert!(!alerts.interrupted());
        assert_eq!(alerts.heartbeat(true), "not offered");
        assert_eq!(alerts.heartbeat(false), "–");
    }

    #[test]
    fn tones_play_once_and_shutdown_stays_silent() {
        let t0 = Instant::now();
        let mut alerts = ConnectionAlerts::new();
        alerts.start(t0);
        assert_eq!(
            alerts.on_transport_up(false, false),
            None,
            "initial connect is silent"
        );
        assert_eq!(alerts.on_transport_down(), Some(Announcement::Disconnected));
        assert_eq!(alerts.on_socket_lost(), None, "already lost");
        alerts.start(at(t0, 1000));
        assert_eq!(
            alerts.on_transport_up(true, false),
            None,
            "connecting or failed transport blocks recovery"
        );
        assert_eq!(
            alerts.on_transport_up(false, false),
            Some(Announcement::Reconnected)
        );

        alerts.on_transport_down();
        alerts.suppress_loss();
        assert_eq!(alerts.on_socket_lost(), None);
        assert_eq!(alerts.on_transport_down(), None);
    }

    #[test]
    fn media_status_prefers_failure_then_heartbeat_then_interruption() {
        assert_eq!(
            media_status(true, "failed", "connected"),
            Some("Media failed")
        );
        assert_eq!(
            media_status(true, "connected", "connected"),
            Some("Server not responding")
        );
        assert_eq!(
            media_status(false, "disconnected", "connected"),
            Some("Media interrupted")
        );
        assert_eq!(
            media_status(false, "connecting", "new"),
            Some("Media connecting")
        );
        assert_eq!(
            media_status(false, "connected", "new"),
            Some("Media connected")
        );
        assert_eq!(media_status(false, "new", "new"), None);
    }
}
