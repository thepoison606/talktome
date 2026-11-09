//! Translates between webrtc-rs' local SDP and mediasoup's ORTC-style
//! `rtpParameters` / `rtpCapabilities`, the way `mediasoup-client`'s `ortc`
//! helpers do for browsers.

use anyhow::{anyhow, Result};
use serde_json::{Map, Value};

use super::sdp::{parse_fmtp, ParsedMedia};
use super::types::*;

/// Header extensions this client registers with webrtc-rs for audio.
pub const SUPPORTED_AUDIO_EXTENSIONS: &[&str] = &[
    "urn:ietf:params:rtp-hdrext:sdes:mid",
    "urn:ietf:params:rtp-hdrext:ssrc-audio-level",
    "http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time",
    "http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
];

/// Everything `produce` needs about the local Opus track, taken from the
/// send peer connection's local offer.
#[derive(Debug, Clone)]
pub struct LocalAudioInfo {
    pub mid: String,
    pub ssrc: u32,
    pub cname: String,
    pub payload_type: u8,
    pub fmtp: Map<String, Value>,
    pub rtcp_feedback: Vec<(String, Option<String>)>,
    pub extensions: Vec<(u16, String)>,
    pub rtcp_mux: bool,
    pub rtcp_reduced_size: bool,
}

pub fn local_audio_info(media: &ParsedMedia) -> Result<LocalAudioInfo> {
    if media.port == 0 {
        return Err(anyhow!("local audio section is rejected (port 0)"));
    }
    let opus = media
        .rtpmaps()
        .into_iter()
        .find(|m| {
            m.encoding.eq_ignore_ascii_case("opus") && media.payload_types.contains(&m.payload_type)
        })
        .ok_or_else(|| anyhow!("local SDP has no opus payload type in its m= line"))?;
    let ssrc = media
        .ssrcs()
        .first()
        .copied()
        .ok_or_else(|| anyhow!("local SDP has no a=ssrc line"))?;
    Ok(LocalAudioInfo {
        mid: media.mid().unwrap_or("0").to_string(),
        ssrc,
        cname: media.cname().unwrap_or_else(|| "talktome".to_string()),
        payload_type: opus.payload_type,
        fmtp: media
            .fmtp(opus.payload_type)
            .map(|f| parse_fmtp(&f))
            .unwrap_or_default(),
        rtcp_feedback: media.rtcp_feedback(opus.payload_type),
        extensions: media.extmaps(),
        rtcp_mux: media.has_flag("rtcp-mux"),
        rtcp_reduced_size: media.has_flag("rtcp-rsize"),
    })
}

/// Builds the `rtpParameters` for `produce` from the local offer and the
/// router's capabilities (used to validate URIs and feedback types).
pub fn sending_rtp_parameters(
    local: &LocalAudioInfo,
    router: &RtpCapabilities,
) -> Result<RtpParameters> {
    let router_opus = router
        .opus()
        .ok_or_else(|| anyhow!("router does not support audio/opus"))?;

    let mut parameters = local.fmtp.clone();
    parameters
        .entry("useinbandfec".to_string())
        .or_insert_with(|| Value::from(1));
    parameters
        .entry("minptime".to_string())
        .or_insert_with(|| Value::from(10));
    parameters.insert("sprop-stereo".to_string(), Value::from(0));
    parameters.insert("usedtx".to_string(), Value::from(0));

    let rtcp_feedback = router_opus
        .rtcp_feedback
        .iter()
        .filter(|fb| {
            local.rtcp_feedback.iter().any(|(kind, parameter)| {
                kind == &fb.kind
                    && parameter.as_deref().unwrap_or("") == fb.parameter.as_deref().unwrap_or("")
            })
        })
        .cloned()
        .collect();

    let header_extensions = local
        .extensions
        .iter()
        .filter(|(_, uri)| {
            router.header_extensions.iter().any(|ext| {
                ext.kind == "audio"
                    && ext.uri == *uri
                    && ext.direction.as_deref() != Some("recvonly")
            })
        })
        .map(|(id, uri)| RtpHeaderExtensionParameters {
            uri: uri.clone(),
            id: *id,
            encrypt: false,
            parameters: Map::new(),
        })
        .collect();

    Ok(RtpParameters {
        mid: Some(local.mid.clone()),
        codecs: vec![RtpCodecParameters {
            mime_type: "audio/opus".into(),
            payload_type: local.payload_type,
            clock_rate: 48_000,
            channels: Some(2),
            parameters,
            rtcp_feedback,
        }],
        header_extensions,
        encodings: vec![RtpEncodingParameters {
            ssrc: Some(local.ssrc),
            dtx: Some(false),
            extra: Map::new(),
        }],
        rtcp: Some(RtcpParameters {
            cname: Some(local.cname.clone()),
            reduced_size: Some(local.rtcp_reduced_size),
            mux: Some(local.rtcp_mux),
        }),
    })
}

/// The `rtpCapabilities` sent with `consume`: the router's Opus codec plus
/// the audio header extensions this client understands, keeping the
/// router's preferred ids so consumer parameters match our remote offer.
pub fn receiving_rtp_capabilities(router: &RtpCapabilities) -> Result<RtpCapabilities> {
    let opus = router
        .opus()
        .ok_or_else(|| anyhow!("router does not support audio/opus"))?
        .clone();
    let header_extensions = router
        .header_extensions
        .iter()
        .filter(|ext| {
            ext.kind == "audio"
                && SUPPORTED_AUDIO_EXTENSIONS.contains(&ext.uri.as_str())
                && ext.direction.as_deref() != Some("sendonly")
        })
        .cloned()
        .collect();
    Ok(RtpCapabilities {
        codecs: vec![opus],
        header_extensions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rtc::sdp;

    fn router_caps() -> RtpCapabilities {
        serde_json::from_value(serde_json::json!({
            "codecs": [
                { "kind": "audio", "mimeType": "audio/opus", "preferredPayloadType": 100,
                  "clockRate": 48000, "channels": 2,
                  "parameters": { "minptime": 10, "useinbandfec": 1 },
                  "rtcpFeedback": [ { "type": "transport-cc", "parameter": "" }, { "type": "nack", "parameter": "" } ] }
            ],
            "headerExtensions": [
                { "kind": "audio", "uri": "urn:ietf:params:rtp-hdrext:sdes:mid", "preferredId": 1, "preferredEncrypt": false, "direction": "sendrecv" },
                { "kind": "video", "uri": "urn:ietf:params:rtp-hdrext:sdes:mid", "preferredId": 1, "preferredEncrypt": false, "direction": "sendrecv" },
                { "kind": "audio", "uri": "urn:ietf:params:rtp-hdrext:ssrc-audio-level", "preferredId": 10, "preferredEncrypt": false, "direction": "sendrecv" },
                { "kind": "audio", "uri": "http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01", "preferredId": 5, "preferredEncrypt": false, "direction": "recvonly" },
                { "kind": "audio", "uri": "urn:3gpp:video-orientation", "preferredId": 11, "preferredEncrypt": false, "direction": "sendrecv" }
            ]
        }))
        .unwrap()
    }

    const OFFER: &str = "v=0\r\no=- 1 2 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\na=fingerprint:sha-256 AA:BB\r\nm=audio 9 UDP/TLS/RTP/SAVPF 100\r\na=mid:0\r\na=rtcp-mux\r\na=rtcp-rsize\r\na=rtpmap:100 opus/48000/2\r\na=fmtp:100 minptime=10;useinbandfec=1\r\na=rtcp-fb:100 transport-cc\r\na=extmap:1 urn:ietf:params:rtp-hdrext:sdes:mid\r\na=extmap:2 urn:ietf:params:rtp-hdrext:ssrc-audio-level\r\na=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01\r\na=sendrecv\r\na=ssrc:777 cname:cn\r\n";

    #[test]
    fn builds_sending_parameters_from_offer() {
        let parsed = sdp::parse(OFFER).unwrap();
        let local = local_audio_info(&parsed.media[0]).unwrap();
        let params = sending_rtp_parameters(&local, &router_caps()).unwrap();
        assert_eq!(params.mid.as_deref(), Some("0"));
        assert_eq!(params.codecs[0].payload_type, 100);
        assert_eq!(params.codecs[0].parameters["useinbandfec"], 1);
        let low_latency = OFFER.replace(
            "minptime=10;useinbandfec=1",
            "minptime=10;useinbandfec=0;ptime=5",
        );
        let parsed = sdp::parse(&low_latency).unwrap();
        let local = local_audio_info(&parsed.media[0]).unwrap();
        let params = sending_rtp_parameters(&local, &router_caps()).unwrap();
        assert_eq!(params.codecs[0].parameters["ptime"], 5);
        assert_eq!(params.codecs[0].parameters["useinbandfec"], 0);
        assert_eq!(params.codecs[0].parameters["minptime"], 10);
        assert_eq!(params.codecs[0].rtcp_feedback.len(), 1);
        assert_eq!(params.codecs[0].rtcp_feedback[0].kind, "transport-cc");
        assert_eq!(params.encodings[0].ssrc, Some(777));
        // transport-cc extension is recvonly on the router -> not sent.
        let uris: Vec<&str> = params
            .header_extensions
            .iter()
            .map(|e| e.uri.as_str())
            .collect();
        assert_eq!(
            uris,
            vec![
                "urn:ietf:params:rtp-hdrext:sdes:mid",
                "urn:ietf:params:rtp-hdrext:ssrc-audio-level"
            ]
        );
        assert_eq!(params.header_extensions[1].id, 2);
        assert_eq!(params.rtcp.as_ref().unwrap().cname.as_deref(), Some("cn"));
    }

    #[test]
    fn receiving_capabilities_keep_router_ids() {
        let caps = receiving_rtp_capabilities(&router_caps()).unwrap();
        assert_eq!(caps.codecs.len(), 1);
        assert_eq!(caps.codecs[0].preferred_payload_type, Some(100));
        let ids: Vec<u16> = caps
            .header_extensions
            .iter()
            .map(|e| e.preferred_id)
            .collect();
        assert_eq!(ids, vec![1, 10, 5]);
    }
}
