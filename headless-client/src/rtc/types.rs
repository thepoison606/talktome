//! mediasoup signalling types as exchanged with the Talktome server.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IceParameters {
    pub username_fragment: String,
    pub password: String,
    #[serde(default)]
    pub ice_lite: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IceCandidate {
    pub foundation: String,
    pub priority: u64,
    /// mediasoup < 3.13 used `ip`, newer versions use `address`.
    #[serde(default)]
    pub ip: Option<String>,
    #[serde(default)]
    pub address: Option<String>,
    pub protocol: String,
    pub port: u16,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub tcp_type: Option<String>,
}

impl IceCandidate {
    pub fn host(&self) -> &str {
        self.address
            .as_deref()
            .or(self.ip.as_deref())
            .unwrap_or("127.0.0.1")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DtlsFingerprint {
    pub algorithm: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DtlsParameters {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    pub fingerprints: Vec<DtlsFingerprint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IceServer {
    /// A single URL string or an array of URLs (RTCIceServer shape).
    pub urls: Value,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub credential: Option<String>,
}

impl IceServer {
    pub fn url_list(&self) -> Vec<String> {
        match &self.urls {
            Value::String(s) => vec![s.clone()],
            Value::Array(items) => items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect(),
            _ => Vec::new(),
        }
    }
}

/// Acknowledgement of `create-send-transport` / `create-recv-transport`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TransportInfo {
    pub id: String,
    pub ice_parameters: IceParameters,
    pub ice_candidates: Vec<IceCandidate>,
    pub dtls_parameters: DtlsParameters,
    #[serde(default)]
    pub ice_servers: Vec<IceServer>,
    #[serde(default)]
    pub ice_transport_policy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RtcpFeedback {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parameter: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RtpCodecCapability {
    pub kind: String,
    pub mime_type: String,
    #[serde(default)]
    pub preferred_payload_type: Option<u8>,
    pub clock_rate: u32,
    #[serde(default)]
    pub channels: Option<u8>,
    #[serde(default)]
    pub parameters: Map<String, Value>,
    #[serde(default)]
    pub rtcp_feedback: Vec<RtcpFeedback>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RtpHeaderExtension {
    pub kind: String,
    pub uri: String,
    pub preferred_id: u16,
    #[serde(default)]
    pub preferred_encrypt: bool,
    #[serde(default)]
    pub direction: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RtpCapabilities {
    #[serde(default)]
    pub codecs: Vec<RtpCodecCapability>,
    #[serde(default)]
    pub header_extensions: Vec<RtpHeaderExtension>,
}

impl RtpCapabilities {
    pub fn opus(&self) -> Option<&RtpCodecCapability> {
        self.codecs
            .iter()
            .find(|c| c.mime_type.eq_ignore_ascii_case("audio/opus"))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RtpCodecParameters {
    pub mime_type: String,
    pub payload_type: u8,
    pub clock_rate: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channels: Option<u8>,
    #[serde(default)]
    pub parameters: Map<String, Value>,
    #[serde(default)]
    pub rtcp_feedback: Vec<RtcpFeedback>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RtpHeaderExtensionParameters {
    pub uri: String,
    pub id: u16,
    #[serde(default)]
    pub encrypt: bool,
    #[serde(default)]
    pub parameters: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RtpEncodingParameters {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssrc: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dtx: Option<bool>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RtcpParameters {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cname: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reduced_size: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mux: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RtpParameters {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mid: Option<String>,
    pub codecs: Vec<RtpCodecParameters>,
    #[serde(default)]
    pub header_extensions: Vec<RtpHeaderExtensionParameters>,
    #[serde(default)]
    pub encodings: Vec<RtpEncodingParameters>,
    #[serde(default)]
    pub rtcp: Option<RtcpParameters>,
}

impl RtpParameters {
    pub fn primary_ssrc(&self) -> Option<u32> {
        self.encodings.iter().find_map(|e| e.ssrc)
    }
}

/// Acknowledgement of `consume`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConsumerInfo {
    pub id: String,
    pub producer_id: String,
    pub kind: String,
    pub rtp_parameters: RtpParameters,
}

/// `new-producer` / `producer-closed` / `request-active-producers` entries.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProducerAnnouncement {
    #[serde(default)]
    pub peer_id: Option<String>,
    #[serde(default)]
    pub speaker_user_id: Option<Value>,
    #[serde(default)]
    pub producer_id: Option<String>,
    #[serde(default)]
    pub app_data: Map<String, Value>,
}

impl ProducerAnnouncement {
    pub fn producer_id(&self) -> Option<&str> {
        self.producer_id
            .as_deref()
            .or_else(|| self.app_data.get("producerId").and_then(Value::as_str))
    }

    pub fn app_type(&self) -> Option<&str> {
        self.app_data.get("type").and_then(Value::as_str)
    }

    pub fn app_id(&self) -> Option<String> {
        match self.app_data.get("id") {
            Some(Value::Number(n)) => Some(n.to_string()),
            Some(Value::String(s)) => Some(s.clone()),
            _ => None,
        }
    }
}
