//! Password check, persistent sessions and login throttling for the web UI.

use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

use rand::RngCore;

pub const SESSION_COOKIE: &str = "talktome_web";
pub const SESSION_TTL: Duration = Duration::from_secs(12 * 3600);
const MAX_FAILURES: usize = 5;
const FAILURE_WINDOW: Duration = Duration::from_secs(300);
const THROTTLE: Duration = Duration::from_secs(30);

pub struct AuthState {
    password: String,
    password_from_env: bool,
    sessions: HashMap<String, u64>,
    session_path: Option<PathBuf>,
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
            session_path: None,
            failures: VecDeque::new(),
        }
    }

    pub fn load(password: String, password_from_env: bool, state_dir: &Path) -> Self {
        let mut auth = Self::new(password, password_from_env);
        let path = state_dir.join("web-sessions.json");
        match std::fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<HashMap<String, u64>>(&bytes) {
                Ok(sessions) => auth.sessions = sessions,
                Err(error) => tracing::warn!(event = "web-sessions-load-failed", %error),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => tracing::warn!(event = "web-sessions-load-failed", %error),
        }
        auth.session_path = Some(path);
        auth.expire_sessions();
        auth
    }

    // Bind each random token to the current password without storing either
    // the token or a password verifier. Changing the configured password also
    // invalidates sessions when it happens outside this process.
    fn session_key(&self, token: &str) -> String {
        let mut hash = Sha256::new();
        hash.update(b"talktome-web-session\0");
        hash.update(self.password.as_bytes());
        hash.update(b"\0");
        hash.update(token.as_bytes());
        format!("{:x}", hash.finalize())
    }

    fn persist_sessions(&self) {
        let Some(path) = &self.session_path else {
            return;
        };
        if let Err(error) = self.write_sessions(path) {
            tracing::warn!(event = "web-sessions-save-failed", %error);
        }
    }

    fn write_sessions(&self, path: &Path) -> std::io::Result<()> {
        let parent = path.parent().expect("session file has a parent");
        std::fs::create_dir_all(parent)?;
        let temporary = parent.join(format!(".web-sessions-{:016x}.tmp", rand::random::<u64>()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let result = (|| {
            let mut file = options.open(&temporary)?;
            file.write_all(&serde_json::to_vec(&self.sessions)?)?;
            file.sync_all()?;
            std::fs::rename(&temporary, path)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result
    }

    pub fn password_from_env(&self) -> bool {
        self.password_from_env
    }

    pub fn check_password(&self, candidate: &str) -> bool {
        constant_time_eq(candidate.as_bytes(), self.password.as_bytes())
    }

    pub fn set_password(&mut self, password: String) {
        self.password = password;
        self.sessions.clear();
        self.persist_sessions();
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
        self.expire_sessions();
        self.sessions
            .insert(self.session_key(&token), unix_now() + SESSION_TTL.as_secs());
        self.persist_sessions();
        Some(token)
    }

    pub fn validate(&mut self, token: &str) -> bool {
        if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
            return false;
        }
        let key = self.session_key(token);
        match self.sessions.get(&key) {
            Some(expires) if *expires > unix_now() => true,
            Some(_) => {
                self.sessions.remove(&key);
                self.persist_sessions();
                false
            }
            None => false,
        }
    }

    pub fn logout(&mut self, token: &str) {
        if self.sessions.remove(&self.session_key(token)).is_some() {
            self.persist_sessions();
        }
    }

    pub fn expire_sessions(&mut self) {
        let now = unix_now();
        let before = self.sessions.len();
        self.sessions.retain(|_, expires| *expires > now);
        if before != self.sessions.len() {
            self.persist_sessions();
        }
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::distr::{Alphanumeric, SampleString};

    fn test_password() -> String {
        Alphanumeric.sample_string(&mut rand::rng(), 32)
    }

    #[test]
    fn login_sessions_and_throttle() {
        let password = test_password();
        let mut auth = AuthState::new(password.clone(), false);
        let wrong_password = &password[..password.len() - 1];
        assert!(auth.login(wrong_password).is_none());
        let token = auth.login(&password).unwrap();
        assert_eq!(token.len(), 64);
        assert!(auth.validate(&token));
        auth.logout(&token);
        assert!(!auth.validate(&token));

        for _ in 0..MAX_FAILURES {
            assert!(auth.login(wrong_password).is_none());
        }
        assert!(auth.throttled().is_some());
        let password = test_password();
        auth.set_password(password.clone());
        assert!(auth.check_password(&password));
        assert!(!auth.check_password(&password[..password.len() - 1]));
    }
    #[test]
    fn sessions_survive_restart_and_logout_remains_revoked() {
        let dir = tempfile::tempdir().unwrap();
        let password = test_password();
        let mut auth = AuthState::load(password.clone(), false, dir.path());
        let token = auth.login(&password).unwrap();
        let expiry = auth.sessions[&auth.session_key(&token)];
        let contents = std::fs::read_to_string(dir.path().join("web-sessions.json")).unwrap();
        assert!(!contents.contains(&token));
        assert!(!contents.contains(&password));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(dir.path().join("web-sessions.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        drop(auth);
        let mut restarted = AuthState::load(password.clone(), false, dir.path());
        assert!(restarted.validate(&token));
        assert_eq!(restarted.sessions[&restarted.session_key(&token)], expiry);
        restarted.logout(&token);
        drop(restarted);
        assert!(!AuthState::load(password, false, dir.path()).validate(&token));
    }

    #[test]
    fn expired_sessions_and_password_changes_do_not_survive_restart() {
        let dir = tempfile::tempdir().unwrap();
        let password = test_password();
        let mut auth = AuthState::load(password.clone(), false, dir.path());
        let expired = auth.login(&password).unwrap();
        auth.sessions
            .insert(auth.session_key(&expired), unix_now() - 1);
        auth.persist_sessions();
        drop(auth);
        let mut auth = AuthState::load(password.clone(), false, dir.path());
        assert!(!auth.validate(&expired));
        let token = auth.login(&password).unwrap();
        // An externally changed password also invalidates the old cookie.
        assert!(!AuthState::load(test_password(), true, dir.path()).validate(&token));
        let new_password = test_password();
        auth.set_password(new_password.clone());
        assert!(!auth.validate(&token));
        drop(auth);
        assert!(!AuthState::load(new_password, false, dir.path()).validate(&token));
        assert!(!AuthState::load(password, false, dir.path()).validate(&token));
    }

    #[test]
    fn malformed_session_file_does_not_prevent_a_new_login() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("web-sessions.json"), "broken").unwrap();
        let password = test_password();
        let mut auth = AuthState::load(password.clone(), false, dir.path());
        assert!(!auth.validate(&"a".repeat(64)));
        let token = auth.login(&password).unwrap();
        assert!(AuthState::load(password, false, dir.path()).validate(&token));
    }
}
