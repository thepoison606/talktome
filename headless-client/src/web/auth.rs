//! Password check, in-memory sessions and login throttling for the web UI.

use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

use rand::RngCore;

use crate::config::WEB_DEFAULT_PASSWORD;

pub const SESSION_COOKIE: &str = "talktome_web";
pub const SESSION_TTL: Duration = Duration::from_secs(12 * 3600);
const MAX_FAILURES: usize = 5;
const FAILURE_WINDOW: Duration = Duration::from_secs(300);
const THROTTLE: Duration = Duration::from_secs(30);

pub struct AuthState {
    password: String,
    password_from_env: bool,
    sessions: HashMap<String, Instant>,
    failures: VecDeque<Instant>,
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

impl AuthState {
    pub fn new(password: String, password_from_env: bool) -> Self {
        Self {
            password,
            password_from_env,
            sessions: HashMap::new(),
            failures: VecDeque::new(),
        }
    }

    pub fn must_change_password(&self) -> bool {
        self.password == WEB_DEFAULT_PASSWORD
    }

    pub fn password_from_env(&self) -> bool {
        self.password_from_env
    }

    pub fn check_password(&self, candidate: &str) -> bool {
        constant_time_eq(candidate.as_bytes(), self.password.as_bytes())
    }

    pub fn set_password(&mut self, password: String) {
        self.password = password;
    }

    /// Returns how long logins stay blocked after too many failures.
    pub fn throttled(&mut self) -> Option<Duration> {
        let now = Instant::now();
        while let Some(front) = self.failures.front() {
            if now.duration_since(*front) > FAILURE_WINDOW {
                self.failures.pop_front();
            } else {
                break;
            }
        }
        if self.failures.len() >= MAX_FAILURES {
            let last = *self.failures.back()?;
            let elapsed = now.duration_since(last);
            if elapsed < THROTTLE {
                return Some(THROTTLE - elapsed);
            }
        }
        None
    }

    /// Verifies the password and creates a session token.
    pub fn login(&mut self, password: &str) -> Option<String> {
        if !self.check_password(password) {
            self.failures.push_back(Instant::now());
            return None;
        }
        self.failures.clear();
        let mut bytes = [0u8; 32];
        rand::rng().fill_bytes(&mut bytes);
        let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        self.sessions
            .insert(token.clone(), Instant::now() + SESSION_TTL);
        Some(token)
    }

    pub fn validate(&mut self, token: &str) -> bool {
        match self.sessions.get(token) {
            Some(expires) if *expires > Instant::now() => true,
            Some(_) => {
                self.sessions.remove(token);
                false
            }
            None => false,
        }
    }

    pub fn logout(&mut self, token: &str) {
        self.sessions.remove(token);
    }

    pub fn expire_sessions(&mut self) {
        let now = Instant::now();
        self.sessions.retain(|_, expires| *expires > now);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_sessions_and_throttle() {
        let mut auth = AuthState::new("admin".into(), false);
        assert!(auth.must_change_password());
        assert!(auth.login("wrong").is_none());
        let token = auth.login("admin").unwrap();
        assert_eq!(token.len(), 64);
        assert!(auth.validate(&token));
        auth.logout(&token);
        assert!(!auth.validate(&token));

        for _ in 0..MAX_FAILURES {
            assert!(auth.login("nope").is_none());
        }
        assert!(auth.throttled().is_some());
        auth.set_password("secret1".into());
        assert!(!auth.must_change_password());
        assert!(auth.check_password("secret1"));
        assert!(!auth.check_password("secret"));
    }
}
