//! A small SDP reader: enough to pull mids, SSRCs, codecs, header extensions
//! and DTLS fingerprints out of the descriptions webrtc-rs produces.

use anyhow::{bail, Result};

#[derive(Debug, Clone, Default)]
pub struct ParsedSdp {
    pub session_attributes: Vec<(String, Option<String>)>,
    pub media: Vec<ParsedMedia>,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedMedia {
    pub kind: String,
    pub port: u16,
    pub payload_types: Vec<u8>,
    pub attributes: Vec<(String, Option<String>)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RtpMap {
    pub payload_type: u8,
    pub encoding: String,
    pub clock_rate: u32,
    pub channels: Option<u8>,
}

pub fn parse(sdp: &str) -> Result<ParsedSdp> {
    let mut parsed = ParsedSdp::default();
    let mut current: Option<ParsedMedia> = None;
    for raw in sdp.lines() {
        let line = raw.trim_end_matches('\r');
        if line.len() < 2 || line.as_bytes()[1] != b'=' {
            continue;
        }
        let (key, value) = (line.as_bytes()[0], &line[2..]);
        match key {
            b'm' => {
                if let Some(media) = current.take() {
                    parsed.media.push(media);
                }
                let mut parts = value.split_whitespace();
                let kind = parts.next().unwrap_or_default().to_string();
                let port = parts
                    .next()
                    .and_then(|p| p.split('/').next())
                    .and_then(|p| p.parse().ok())
                    .unwrap_or(0);
                let _protocol = parts.next();
                let payload_types = parts.filter_map(|p| p.parse().ok()).collect();
                current = Some(ParsedMedia {
                    kind,
                    port,
                    payload_types,
                    attributes: Vec::new(),
                });
            }
            b'a' => {
                let (name, attr_value) = match value.split_once(':') {
                    Some((n, v)) => (n.to_string(), Some(v.to_string())),
                    None => (value.to_string(), None),
                };
                match current.as_mut() {
                    Some(media) => media.attributes.push((name, attr_value)),
                    None => parsed.session_attributes.push((name, attr_value)),
                }
            }
            _ => {}
        }
    }
    if let Some(media) = current.take() {
        parsed.media.push(media);
    }
    if parsed.media.is_empty() && parsed.session_attributes.is_empty() {
        bail!("SDP contains no session attributes or media sections");
    }
    Ok(parsed)
}

impl ParsedSdp {
    pub fn session_attribute(&self, name: &str) -> Option<&str> {
        self.session_attributes
            .iter()
            .find(|(n, _)| n == name)
            .and_then(|(_, v)| v.as_deref())
    }

    /// `(algorithm, value)` from the session or the first media section.
    pub fn fingerprint(&self) -> Option<(String, String)> {
        let raw = self
            .session_attribute("fingerprint")
            .or_else(|| self.media.iter().find_map(|m| m.attribute("fingerprint")))?;
        let (algorithm, value) = raw.split_once(' ')?;
        Some((algorithm.trim().to_string(), value.trim().to_string()))
    }
}

impl ParsedMedia {
    pub fn attribute(&self, name: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find(|(n, _)| n == name)
            .and_then(|(_, v)| v.as_deref())
    }

    pub fn has_flag(&self, name: &str) -> bool {
        self.attributes.iter().any(|(n, _)| n == name)
    }

    pub fn attributes_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a str> + 'a {
        self.attributes
            .iter()
            .filter(move |(n, _)| n == name)
            .filter_map(|(_, v)| v.as_deref())
    }

    pub fn mid(&self) -> Option<&str> {
        self.attribute("mid")
    }

    pub fn ssrcs(&self) -> Vec<u32> {
        let mut out = Vec::new();
        for value in self.attributes_named("ssrc") {
            if let Some(ssrc) = value
                .split_whitespace()
                .next()
                .and_then(|s| s.parse::<u32>().ok())
            {
                if !out.contains(&ssrc) {
                    out.push(ssrc);
                }
            }
        }
        out
    }

    pub fn cname(&self) -> Option<String> {
        self.attributes_named("ssrc").find_map(|value| {
            let (_ssrc, rest) = value.split_once(' ')?;

            rest.strip_prefix("cname:").map(|c| c.trim().to_string())
        })
    }

    pub fn rtpmaps(&self) -> Vec<RtpMap> {
        self.attributes_named("rtpmap")
            .filter_map(|value| {
                let (pt, codec) = value.split_once(' ')?;
                let mut pieces = codec.split('/');
                let encoding = pieces.next()?.to_string();
                let clock_rate = pieces.next()?.parse().ok()?;
                let channels = pieces.next().and_then(|c| c.parse().ok());
                Some(RtpMap {
                    payload_type: pt.parse().ok()?,
                    encoding,
                    clock_rate,
                    channels,
                })
            })
            .collect()
    }

    pub fn fmtp(&self, payload_type: u8) -> Option<String> {
        self.attributes_named("fmtp").find_map(|value| {
            let (pt, params) = value.split_once(' ')?;
            (pt.parse::<u8>().ok()? == payload_type).then(|| params.trim().to_string())
        })
    }

    pub fn rtcp_feedback(&self, payload_type: u8) -> Vec<(String, Option<String>)> {
        self.attributes_named("rtcp-fb")
            .filter_map(|value| {
                let (pt, rest) = value.split_once(' ')?;
                let applies = pt == "*" || pt.parse::<u8>().ok()? == payload_type;
                if !applies {
                    return None;
                }
                let mut parts = rest.splitn(2, ' ');
                let kind = parts.next()?.to_string();
                let parameter = parts.next().map(|p| p.trim().to_string());
                Some((kind, parameter))
            })
            .collect()
    }

    pub fn extmaps(&self) -> Vec<(u16, String)> {
        self.attributes_named("extmap")
            .filter_map(|value| {
                let (id_part, uri) = value.split_once(' ')?;
                let id = id_part.split('/').next()?.parse().ok()?;
                Some((id, uri.split_whitespace().next()?.to_string()))
            })
            .collect()
    }
}

/// Parses `a=fmtp` parameters (`minptime=10;useinbandfec=1`) into JSON values,
/// converting integers where possible as mediasoup expects.
pub fn parse_fmtp(params: &str) -> serde_json::Map<String, serde_json::Value> {
    let mut map = serde_json::Map::new();
    for pair in params.split(';') {
        let pair = pair.trim();
        if pair.is_empty() {
            continue;
        }
        let (key, value) = match pair.split_once('=') {
            Some((k, v)) => (k.trim(), v.trim()),
            None => (pair, ""),
        };
        let json = match value.parse::<i64>() {
            Ok(n) => serde_json::Value::from(n),
            Err(_) => serde_json::Value::String(value.to_string()),
        };
        map.insert(key.to_string(), json);
    }
    map
}

pub fn format_fmtp(params: &serde_json::Map<String, serde_json::Value>) -> String {
    let mut parts: Vec<String> = params
        .iter()
        .map(|(k, v)| match v {
            serde_json::Value::String(s) => format!("{k}={s}"),
            other => format!("{k}={other}"),
        })
        .collect();
    parts.sort();
    parts.join(";")
}

#[cfg(test)]
mod tests {
    use super::*;

    const OFFER: &str = "v=0\r\no=- 1 2 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\na=fingerprint:sha-256 AA:BB\r\na=group:BUNDLE 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 100\r\nc=IN IP4 0.0.0.0\r\na=setup:actpass\r\na=mid:0\r\na=ice-ufrag:abc\r\na=ice-pwd:def\r\na=rtcp-mux\r\na=rtcp-rsize\r\na=rtpmap:100 opus/48000/2\r\na=fmtp:100 minptime=10;useinbandfec=1\r\na=rtcp-fb:100 transport-cc\r\na=extmap:1 urn:ietf:params:rtp-hdrext:sdes:mid\r\na=extmap:2 urn:ietf:params:rtp-hdrext:ssrc-audio-level\r\na=sendrecv\r\na=ssrc:12345 cname:talktome\r\na=ssrc:12345 msid:s t\r\n";

    #[test]
    fn parses_media_details() {
        let parsed = parse(OFFER).unwrap();
        assert_eq!(
            parsed.fingerprint(),
            Some(("sha-256".into(), "AA:BB".into()))
        );
        let media = &parsed.media[0];
        assert_eq!(media.kind, "audio");
        assert_eq!(media.payload_types, vec![100]);
        assert_eq!(media.mid(), Some("0"));
        assert_eq!(media.ssrcs(), vec![12345]);
        assert_eq!(media.cname().as_deref(), Some("talktome"));
        assert_eq!(media.port, 9);
        assert_eq!(
            media.rtpmaps(),
            vec![RtpMap {
                payload_type: 100,
                encoding: "opus".into(),
                clock_rate: 48000,
                channels: Some(2)
            }]
        );
        assert_eq!(
            media.fmtp(100).as_deref(),
            Some("minptime=10;useinbandfec=1")
        );
        assert_eq!(
            media.rtcp_feedback(100),
            vec![("transport-cc".to_string(), None)]
        );
        assert_eq!(media.extmaps().len(), 2);
        assert_eq!(media.attribute("ice-ufrag"), Some("abc"));
        assert!(media.has_flag("rtcp-mux"));
    }

    #[test]
    fn fmtp_round_trip() {
        let map = parse_fmtp("minptime=10;useinbandfec=1;stereo=0");
        assert_eq!(map["minptime"], 10);
        assert_eq!(format_fmtp(&map), "minptime=10;stereo=0;useinbandfec=1");
    }
}
