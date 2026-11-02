//! Talktome signalling: HTTP login/targets and the Socket.IO connection.

/// `register-user` `clientType`. v1.5.9 only labels `ios-app` and
/// `android-app`; this value is sent so a server that allowlists it can
/// show the panel as a headless client instead of a browser.
pub const REGISTERED_CLIENT_TYPE: &str = "headless";

pub mod alerts;
pub mod http;
pub mod panel;
pub mod session;
pub mod socketio;
