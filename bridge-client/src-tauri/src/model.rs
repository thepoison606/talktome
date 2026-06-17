use serde::Serialize;

#[derive(Debug, Default, Serialize)]
pub struct BridgeStatus {
    pub connected: bool,
    pub server_url: Option<String>,
    pub bridge_name: Option<String>,
    pub active_ports: usize,
    pub ports: Vec<BridgePort>,
}

#[derive(Debug, Serialize)]
pub struct BridgePort {
    pub id: String,
    pub label: String,
    pub target: BridgeTarget,
    pub input: Option<ChannelAssignment>,
    pub output: Option<ChannelAssignment>,
    pub enabled: bool,
}

#[allow(dead_code)]
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BridgeTarget {
    User { id: i64, name: String },
    Conference { id: i64, name: String },
    Feed { id: i64, name: String },
}

#[derive(Debug, Serialize)]
pub struct ChannelAssignment {
    pub device_id: String,
    pub device_name: String,
    pub left_channel: u16,
    pub right_channel: u16,
}
