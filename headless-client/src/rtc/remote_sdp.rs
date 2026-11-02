//! Synthesises the "remote" SDP that webrtc-rs needs from mediasoup's
//! transport / consumer parameters — the Rust counterpart of
//! `mediasoup-client`'s `RemoteSdp`.

use std::fmt::Write as _;

use anyhow::{anyhow, Result};

use super::ortc::LocalAudioInfo;
use super::sdp::format_fmtp;
use super::types::*;

fn preferred_fingerprint(dtls: &DtlsParameters) -> Result<&DtlsFingerprint> {
    dtls.fingerprints
        .iter()
        .find(|f| f.algorithm.eq_ignore_ascii_case("sha-256"))
        .or_else(|| dtls.fingerprints.last())
        .ok_or_else(|| anyhow!("transport has no DTLS fingerprints"))
}

fn write_session_header(
    out: &mut String,
    transport: &TransportInfo,
    version: u64,
    mids: &[String],
) -> Result<()> {
    let fingerprint = preferred_fingerprint(&transport.dtls_parameters)?;
    let _ = writeln!(out, "v=0\r");
    let _ = writeln!(out, "o=- 2147483648 {version} IN IP4 0.0.0.0\r");
    let _ = writeln!(out, "s=-\r");
    let _ = writeln!(out, "t=0 0\r");
    let _ = writeln!(out, "a=ice-lite\r");
    let _ = writeln!(
        out,
        "a=fingerprint:{} {}\r",
        fingerprint.algorithm, fingerprint.value
    );
    let _ = writeln!(out, "a=msid-semantic: WMS *\r");
    if !mids.is_empty() {
        let _ = writeln!(out, "a=group:BUNDLE {}\r", mids.join(" "));
    }
    Ok(())
}

fn write_ice_and_dtls(out: &mut String, transport: &TransportInfo, setup: &str) {
    let _ = writeln!(
        out,
        "a=ice-ufrag:{}\r",
        transport.ice_parameters.username_fragment
    );
    let _ = writeln!(out, "a=ice-pwd:{}\r", transport.ice_parameters.password);
    for candidate in &transport.ice_candidates {
        let mut line = format!(
            "a=candidate:{} 1 {} {} {} {} typ {}",
            candidate.foundation,
            candidate.protocol.to_ascii_lowercase(),
            candidate.priority,
            candidate.host(),
            candidate.port,
            candidate.kind
        );
        if let Some(tcp_type) = &candidate.tcp_type {
            let _ = write!(line, " tcptype {tcp_type}");
        }
        let _ = writeln!(out, "{line}\r");
    }
    let _ = writeln!(out, "a=end-of-candidates\r");
    let _ = writeln!(out, "a=setup:{setup}\r");
    let _ = writeln!(out, "a=rtcp-mux\r");
    let _ = writeln!(out, "a=rtcp-rsize\r");
}

/// The answer for the send transport: mirrors the local offer's codec,
/// payload type and header-extension ids; the client is the DTLS client.
pub fn build_send_answer(
    local: &LocalAudioInfo,
    transport: &TransportInfo,
    version: u64,
) -> Result<String> {
    let mut out = String::new();
    write_session_header(
        &mut out,
        transport,
        version,
        std::slice::from_ref(&local.mid),
    )?;
    let _ = writeln!(out, "m=audio 7 UDP/TLS/RTP/SAVPF {}\r", local.payload_type);
    let _ = writeln!(out, "c=IN IP4 127.0.0.1\r");
    let _ = writeln!(out, "a=rtpmap:{} opus/48000/2\r", local.payload_type);
    if !local.fmtp.is_empty() {
        let _ = writeln!(
            out,
            "a=fmtp:{} {}\r",
            local.payload_type,
            format_fmtp(&local.fmtp)
        );
    }
    for (kind, parameter) in &local.rtcp_feedback {
        match parameter {
            Some(p) if !p.is_empty() => {
                let _ = writeln!(out, "a=rtcp-fb:{} {} {}\r", local.payload_type, kind, p);
            }
            _ => {
                let _ = writeln!(out, "a=rtcp-fb:{} {}\r", local.payload_type, kind);
            }
        }
    }
    for (id, uri) in &local.extensions {
        let _ = writeln!(out, "a=extmap:{id} {uri}\r");
    }
    let _ = writeln!(out, "a=mid:{}\r", local.mid);
    let _ = writeln!(out, "a=recvonly\r");
    write_ice_and_dtls(&mut out, transport, "passive");
    Ok(out)
}

/// One media section of the receive transport's remote offer.
#[derive(Debug, Clone)]
pub struct RecvSection {
    pub mid: String,
    pub consumer_id: Option<String>,
    pub rtp: Option<RtpParameters>,
}

/// Remote offer for the receive transport, growing by one media section per
/// consumer. Closed consumers stay as inactive sections so mids remain
/// stable for webrtc-rs; the transport is recreated when it becomes idle.
#[derive(Debug, Clone)]
pub struct RecvRemoteSdp {
    transport: TransportInfo,
    sections: Vec<RecvSection>,
    version: u64,
}

impl RecvRemoteSdp {
    pub fn new(transport: TransportInfo) -> Self {
        Self {
            transport,
            sections: Vec::new(),
            version: 1,
        }
    }

    pub fn section_count(&self) -> usize {
        self.sections.len()
    }

    /// Adds a consumer and returns the mid assigned to it.
    pub fn add_consumer(&mut self, consumer_id: &str, rtp: RtpParameters) -> String {
        let mid = rtp
            .mid
            .clone()
            .filter(|m| !m.is_empty() && !self.sections.iter().any(|s| &s.mid == m))
            .unwrap_or_else(|| self.sections.len().to_string());
        self.sections.push(RecvSection {
            mid: mid.clone(),
            consumer_id: Some(consumer_id.to_string()),
            rtp: Some(rtp),
        });
        self.version += 1;
        mid
    }

    /// Marks the consumer's section inactive; returns its mid.
    pub fn close_consumer(&mut self, consumer_id: &str) -> Option<String> {
        let section = self
            .sections
            .iter_mut()
            .find(|s| s.consumer_id.as_deref() == Some(consumer_id))?;
        section.consumer_id = None;
        section.rtp = None;
        self.version += 1;
        Some(section.mid.clone())
    }

    pub fn consumer_for_ssrc(&self, ssrc: u32) -> Option<&str> {
        self.sections.iter().find_map(|s| {
            let rtp = s.rtp.as_ref()?;
            (rtp.primary_ssrc() == Some(ssrc)).then_some(s.consumer_id.as_deref()?)
        })
    }

    pub fn consumer_for_mid(&self, mid: &str) -> Option<&str> {
        self.sections
            .iter()
            .find(|s| s.mid == mid)
            .and_then(|s| s.consumer_id.as_deref())
    }

    pub fn offer_sdp(&self) -> Result<String> {
        let mut out = String::new();
        let mids: Vec<String> = self.sections.iter().map(|s| s.mid.clone()).collect();
        write_session_header(&mut out, &self.transport, self.version, &mids)?;
        for section in &self.sections {
            match &section.rtp {
                Some(rtp) => write_active_section(&mut out, &self.transport, section, rtp)?,
                None => write_inactive_section(&mut out, &self.transport, section),
            }
        }
        Ok(out)
    }
}

fn write_active_section(
    out: &mut String,
    transport: &TransportInfo,
    section: &RecvSection,
    rtp: &RtpParameters,
) -> Result<()> {
    let codec = rtp
        .codecs
        .iter()
        .find(|c| c.mime_type.eq_ignore_ascii_case("audio/opus"))
        .ok_or_else(|| anyhow!("consumer {} has no opus codec", section.mid))?;
    let ssrc = rtp
        .primary_ssrc()
        .ok_or_else(|| anyhow!("consumer {} has no ssrc", section.mid))?;
    let cname = rtp
        .rtcp
        .as_ref()
        .and_then(|r| r.cname.clone())
        .unwrap_or_else(|| format!("talktome-{}", section.mid));
    let stream_id = format!("talktome-{}", section.mid);
    let track_id = format!("track-{}", section.mid);

    let _ = writeln!(out, "m=audio 7 UDP/TLS/RTP/SAVPF {}\r", codec.payload_type);
    let _ = writeln!(out, "c=IN IP4 127.0.0.1\r");
    let _ = writeln!(
        out,
        "a=rtpmap:{} opus/{}/{}\r",
        codec.payload_type,
        codec.clock_rate,
        codec.channels.unwrap_or(2)
    );
    if !codec.parameters.is_empty() {
        let _ = writeln!(
            out,
            "a=fmtp:{} {}\r",
            codec.payload_type,
            format_fmtp(&codec.parameters)
        );
    }
    for fb in &codec.rtcp_feedback {
        match fb.parameter.as_deref() {
            Some(p) if !p.is_empty() => {
                let _ = writeln!(out, "a=rtcp-fb:{} {} {}\r", codec.payload_type, fb.kind, p);
            }
            _ => {
                let _ = writeln!(out, "a=rtcp-fb:{} {}\r", codec.payload_type, fb.kind);
            }
        }
    }
    for ext in &rtp.header_extensions {
        let _ = writeln!(out, "a=extmap:{} {}\r", ext.id, ext.uri);
    }
    let _ = writeln!(out, "a=mid:{}\r", section.mid);
    let _ = writeln!(out, "a=msid:{stream_id} {track_id}\r");
    let _ = writeln!(out, "a=sendonly\r");
    write_ice_and_dtls(out, transport, "actpass");
    let _ = writeln!(out, "a=ssrc:{ssrc} cname:{cname}\r");
    let _ = writeln!(out, "a=ssrc:{ssrc} msid:{stream_id} {track_id}\r");
    Ok(())
}

fn write_inactive_section(out: &mut String, transport: &TransportInfo, section: &RecvSection) {
    let _ = writeln!(out, "m=audio 7 UDP/TLS/RTP/SAVPF 100\r");
    let _ = writeln!(out, "c=IN IP4 127.0.0.1\r");
    let _ = writeln!(out, "a=rtpmap:100 opus/48000/2\r");
    let _ = writeln!(out, "a=mid:{}\r", section.mid);
    let _ = writeln!(out, "a=inactive\r");
    write_ice_and_dtls(out, transport, "actpass");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn transport() -> TransportInfo {
        serde_json::from_value(json!({
            "id": "t1",
            "iceParameters": { "usernameFragment": "ufrag", "password": "pwd", "iceLite": true },
            "iceCandidates": [
                { "foundation": "udpcandidate", "priority": 1076302079, "address": "192.168.1.10", "protocol": "udp", "port": 40000, "type": "host" },
                { "foundation": "tcpcandidate", "priority": 1076302078, "ip": "192.168.1.10", "protocol": "tcp", "port": 40001, "type": "host", "tcpType": "passive" }
            ],
            "dtlsParameters": { "role": "auto", "fingerprints": [
                { "algorithm": "sha-1", "value": "11:22" },
                { "algorithm": "sha-256", "value": "AA:BB:CC" }
            ] },
            "iceServers": [ { "urls": ["turn:turn.example:3478?transport=udp"], "username": "u", "credential": "c" } ],
            "iceTransportPolicy": "all"
        }))
        .unwrap()
    }

    fn local() -> LocalAudioInfo {
        LocalAudioInfo {
            mid: "0".into(),
            ssrc: 4242,
            cname: "cn".into(),
            payload_type: 111,
            fmtp: crate::rtc::sdp::parse_fmtp("minptime=10;useinbandfec=1"),
            rtcp_feedback: vec![("transport-cc".into(), None)],
            extensions: vec![(1, "urn:ietf:params:rtp-hdrext:sdes:mid".into())],
            rtcp_mux: true,
            rtcp_reduced_size: true,
        }
    }

    #[test]
    fn send_answer_contains_transport_and_local_parameters() {
        let sdp = build_send_answer(&local(), &transport(), 3).unwrap();
        assert!(sdp.contains("a=ice-lite\r\n"));
        assert!(sdp.contains("a=fingerprint:sha-256 AA:BB:CC\r\n"));
        assert!(sdp.contains("a=group:BUNDLE 0\r\n"));
        assert!(sdp.contains("m=audio 7 UDP/TLS/RTP/SAVPF 111\r\n"));
        assert!(sdp.contains("a=rtpmap:111 opus/48000/2\r\n"));
        assert!(sdp.contains("a=fmtp:111 minptime=10;useinbandfec=1\r\n"));
        assert!(sdp.contains("a=rtcp-fb:111 transport-cc\r\n"));
        assert!(sdp.contains("a=extmap:1 urn:ietf:params:rtp-hdrext:sdes:mid\r\n"));
        assert!(sdp.contains("a=setup:passive\r\n"));
        assert!(sdp.contains("a=recvonly\r\n"));
        assert!(sdp.contains("a=ice-ufrag:ufrag\r\n"));
        assert!(sdp
            .contains("a=candidate:udpcandidate 1 udp 1076302079 192.168.1.10 40000 typ host\r\n"));
        assert!(sdp.contains("a=candidate:tcpcandidate 1 tcp 1076302078 192.168.1.10 40001 typ host tcptype passive\r\n"));
        assert!(sdp.contains("a=end-of-candidates\r\n"));
        assert!(!sdp.contains("sha-1"));
    }

    #[test]
    fn recv_offer_grows_and_closes_sections() {
        let mut remote = RecvRemoteSdp::new(transport());
        let rtp: RtpParameters = serde_json::from_value(json!({
            "mid": "0",
            "codecs": [ { "mimeType": "audio/opus", "payloadType": 100, "clockRate": 48000, "channels": 2,
                          "parameters": { "useinbandfec": 1 }, "rtcpFeedback": [ { "type": "transport-cc", "parameter": "" } ] } ],
            "headerExtensions": [ { "uri": "urn:ietf:params:rtp-hdrext:sdes:mid", "id": 1 } ],
            "encodings": [ { "ssrc": 5555 } ],
            "rtcp": { "cname": "abc", "reducedSize": true, "mux": true }
        }))
        .unwrap();
        let mid_a = remote.add_consumer("c-a", rtp.clone());
        let mut rtp_b = rtp.clone();
        rtp_b.mid = Some("0".into()); // duplicate mid from server must be re-assigned
        rtp_b.encodings[0].ssrc = Some(6666);
        let mid_b = remote.add_consumer("c-b", rtp_b);
        assert_eq!(mid_a, "0");
        assert_eq!(mid_b, "1");
        assert_eq!(remote.consumer_for_ssrc(6666), Some("c-b"));
        assert_eq!(remote.consumer_for_mid("0"), Some("c-a"));

        let sdp = remote.offer_sdp().unwrap();
        assert!(sdp.contains("a=group:BUNDLE 0 1\r\n"));
        assert_eq!(
            sdp.matches("m=audio 7 UDP/TLS/RTP/SAVPF 100\r\n").count(),
            2
        );
        assert!(sdp.contains("a=ssrc:5555 cname:abc\r\n"));
        assert!(sdp.contains("a=setup:actpass\r\n"));
        assert!(sdp.contains("a=sendonly\r\n"));

        assert_eq!(remote.close_consumer("c-a"), Some("0".to_string()));
        let sdp = remote.offer_sdp().unwrap();
        assert!(sdp.contains("a=inactive\r\n"));
        assert_eq!(remote.section_count(), 2);
        assert_eq!(remote.consumer_for_ssrc(5555), None);
    }
}
