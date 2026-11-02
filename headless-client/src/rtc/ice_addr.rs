//! Resolves mediasoup ICE candidate addresses to literal IPs.
//!
//! webrtc-rs (unlike browsers) rejects hostnames in `a=candidate` lines with
//! `parse addr: invalid IP address syntax`. Talktome may announce a DNS name
//! as the WebRTC address; we look it up before synthesising the remote SDP.

use std::net::IpAddr;

use anyhow::{bail, Context, Result};
use tokio::net::lookup_host;

use super::types::{IceCandidate, TransportInfo};

/// Parses an ICE candidate host as an IP, stripping SDP-style brackets and
/// IPv6 zone ids (`fe80::1%eth0`).
pub fn parse_ip_literal(host: &str) -> Option<IpAddr> {
    let trimmed = host.trim();
    if trimmed.is_empty() {
        return None;
    }
    let unbracketed = trimmed
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
        .unwrap_or(trimmed);
    let without_zone = unbracketed.split('%').next().unwrap_or(unbracketed);
    without_zone.parse().ok()
}

/// SDP candidate address form: IPv6 without brackets.
pub fn ip_to_candidate_address(ip: IpAddr) -> String {
    ip.to_string()
}

/// Resolves `host` to IP addresses, IPv4 first. Literals are returned as-is
/// (after stripping brackets / zone ids).
pub async fn resolve_candidate_addresses(host: &str) -> Result<Vec<IpAddr>> {
    if let Some(ip) = parse_ip_literal(host) {
        return Ok(vec![ip]);
    }
    let trimmed = host.trim();
    if trimmed.is_empty() {
        bail!("ICE candidate address is empty");
    }
    let lookup = format!("{trimmed}:0");
    let mut ipv4 = Vec::new();
    let mut ipv6 = Vec::new();
    for addr in lookup_host(&lookup)
        .await
        .with_context(|| format!("resolving ICE candidate host {trimmed}"))?
    {
        match addr.ip() {
            ip @ IpAddr::V4(_) if !ipv4.contains(&ip) => ipv4.push(ip),
            ip @ IpAddr::V6(_) if !ipv6.contains(&ip) => ipv6.push(ip),
            _ => {}
        }
    }
    ipv4.extend(ipv6);
    if ipv4.is_empty() {
        bail!("ICE candidate host {trimmed} resolved to no addresses");
    }
    Ok(ipv4)
}

/// Replaces hostname (or bracketed) candidate addresses with literal IPs so
/// webrtc-rs can parse the remote SDP. One hostname may expand to several
/// candidates (A + AAAA). Unresolvable entries are skipped; if none remain
/// the transport cannot be used.
pub async fn resolve_transport_candidates(mut info: TransportInfo) -> Result<TransportInfo> {
    let original = info.ice_candidates.clone();
    let mut resolved = Vec::new();
    for candidate in original {
        let host = candidate.host().to_string();
        match resolve_candidate_addresses(&host).await {
            Ok(ips) => {
                if parse_ip_literal(&host).is_none() {
                    tracing::info!(
                        event = "ice-candidate-resolved",
                        host = %host,
                        addresses = ?ips.iter().map(ToString::to_string).collect::<Vec<_>>(),
                        port = candidate.port
                    );
                }
                for ip in ips {
                    let mut copy = candidate.clone();
                    copy.address = Some(ip_to_candidate_address(ip));
                    copy.ip = None;
                    resolved.push(copy);
                }
            }
            Err(error) => {
                tracing::warn!(
                    event = "ice-candidate-unresolved",
                    host = %host,
                    port = candidate.port,
                    error = %format!("{error:#}")
                );
            }
        }
    }
    if resolved.is_empty() {
        let hosts: Vec<String> = info
            .ice_candidates
            .iter()
            .map(|c| format!("{}:{}", c.host(), c.port))
            .collect();
        bail!(
            "none of the server ICE candidates could be resolved to an IP address ({})",
            hosts.join(", ")
        );
    }
    info.ice_candidates = resolved;
    Ok(info)
}

pub fn describe_candidates(candidates: &[IceCandidate]) -> Vec<String> {
    candidates
        .iter()
        .map(|c| format!("{} {} {}:{}", c.protocol, c.kind, c.host(), c.port))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_v4_v6_brackets_and_zones() {
        assert_eq!(
            parse_ip_literal("192.0.2.10"),
            Some("192.0.2.10".parse().unwrap())
        );
        assert_eq!(
            parse_ip_literal("2001:db8::1"),
            Some("2001:db8::1".parse().unwrap())
        );
        assert_eq!(
            parse_ip_literal("[2001:db8::1]"),
            Some("2001:db8::1".parse().unwrap())
        );
        assert_eq!(
            parse_ip_literal("fe80::1%eth0"),
            Some("fe80::1".parse().unwrap())
        );
        assert!(parse_ip_literal("turn.example.invalid").is_none());
        assert!(parse_ip_literal("").is_none());
    }

    #[test]
    fn webrtc_ice_rejects_hostname_and_bracketed_candidates() {
        use webrtc::ice::candidate::candidate_base::CandidateBaseConfig;
        use webrtc::ice::candidate::candidate_host::CandidateHostConfig;

        let host = |address: &str| {
            CandidateHostConfig {
                base_config: CandidateBaseConfig {
                    network: "udp".into(),
                    address: address.into(),
                    port: 40000,
                    component: 1,
                    priority: 1,
                    foundation: "udpcandidate".into(),
                    ..CandidateBaseConfig::default()
                },
                ..CandidateHostConfig::default()
            }
            .new_candidate_host()
        };
        assert!(host("turn.example.invalid").is_err());
        assert!(host("[2001:db8::1]").is_err());
        assert!(host("192.0.2.10").is_ok());
        assert!(host("2001:db8::1").is_ok());
    }

    #[tokio::test]
    async fn resolves_literals_without_dns() {
        let ips = resolve_candidate_addresses("[2001:db8::8]").await.unwrap();
        assert_eq!(ips, vec!["2001:db8::8".parse::<IpAddr>().unwrap()]);
        let ips = resolve_candidate_addresses("127.0.0.1").await.unwrap();
        assert_eq!(ips, vec!["127.0.0.1".parse::<IpAddr>().unwrap()]);
    }

    #[tokio::test]
    async fn resolves_localhost() {
        let ips = resolve_candidate_addresses("localhost").await.unwrap();
        assert!(ips.iter().any(|ip| ip.is_loopback()));
        assert!(ips.iter().any(IpAddr::is_ipv4) || ips.iter().any(IpAddr::is_ipv6));
    }

    #[tokio::test]
    async fn transport_hostname_becomes_literal() {
        let info: TransportInfo = serde_json::from_value(serde_json::json!({
            "id": "t1",
            "iceParameters": { "usernameFragment": "u", "password": "p" },
            "iceCandidates": [
                { "foundation": "udpcandidate", "priority": 1, "address": "localhost", "protocol": "udp", "port": 40000, "type": "host" }
            ],
            "dtlsParameters": { "fingerprints": [{ "algorithm": "sha-256", "value": "AA" }] }
        }))
        .unwrap();
        let resolved = resolve_transport_candidates(info).await.unwrap();
        assert!(!resolved.ice_candidates.is_empty());
        for candidate in &resolved.ice_candidates {
            assert!(parse_ip_literal(candidate.host()).is_some());
        }
    }
}
