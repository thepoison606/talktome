//! Optional device diagnostics using the route to this instance's server.
use serde_json::{json, Value};
use std::net::{IpAddr, Ipv4Addr};
use std::path::Path;

fn route_interface(routes: &str, destination: Ipv4Addr) -> Option<&str> {
    let address = u32::from_le_bytes(destination.octets());
    routes
        .lines()
        .skip(1)
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() < 8 {
                return None;
            }
            let target = u32::from_str_radix(fields[1], 16).ok()?;
            let flags = u32::from_str_radix(fields[3], 16).ok()?;
            let metric = fields[6].parse::<u32>().ok()?;
            let mask = u32::from_str_radix(fields[7], 16).ok()?;
            (flags & 1 != 0 && address & mask == target & mask).then_some((
                fields[0],
                mask.count_ones(),
                metric,
            ))
        })
        .max_by_key(|(_, prefix, metric)| (*prefix, std::cmp::Reverse(*metric)))
        .map(|(interface, _, _)| interface)
}

fn interface_kind(root: &Path, interface: &str) -> &'static str {
    let path = root.join(interface);
    if path.join("wireless").exists() {
        "wifi"
    } else if path.join("tun_flags").exists() || interface.starts_with("wg") {
        "vpn"
    } else if interface.starts_with("wwan")
        || interface.starts_with("ppp")
        || interface.starts_with("rmnet")
    {
        "cellular"
    } else if std::fs::read_to_string(path.join("type")).is_ok_and(|t| t.trim() == "1") {
        "ethernet"
    } else {
        "other"
    }
}

pub async fn network_type(server: &str) -> Option<&'static str> {
    let url = url::Url::parse(server).ok()?;
    let host = url.host_str()?;
    let addresses = tokio::time::timeout(
        std::time::Duration::from_millis(200),
        tokio::net::lookup_host((host, url.port_or_known_default()?)),
    )
    .await
    .ok()?
    .ok()?;
    let routes = std::fs::read_to_string("/proc/net/route").ok()?;
    for address in addresses {
        if let IpAddr::V4(ip) = address.ip() {
            if let Some(interface) = route_interface(&routes, ip) {
                return Some(interface_kind(Path::new("/sys/class/net"), interface));
            }
        }
    }
    None
}

pub fn payload(output: Option<&str>, network: Option<&str>) -> Value {
    json!({
        "audioOutput": output.map(|label| json!({ "label": label, "kind": "other" })),
        "networkType": network,
        "batteryPercent": null,
        "charging": null,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uses_server_route_instead_of_guessing_from_active_interfaces() {
        let routes = "Iface Destination Gateway Flags RefCnt Use Metric Mask\nwlan0 00000000 0100A8C0 0003 0 0 100 00000000\neth0 00B2A8C0 00000000 0001 0 0 200 00FFFFFF\neth1 00B2A8C0 00000000 0001 0 0 300 00FFFFFF\n";
        assert_eq!(
            route_interface(routes, "192.168.178.166".parse().unwrap()),
            Some("eth0")
        );
        assert_eq!(
            route_interface(routes, "8.8.8.8".parse().unwrap()),
            Some("wlan0")
        );
        assert_eq!(route_interface("invalid", Ipv4Addr::LOCALHOST), None);
    }
    #[test]
    fn identifies_wifi_ethernet_and_vpn_and_reports_the_selected_output() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("wlan0/wireless")).unwrap();
        std::fs::create_dir_all(root.path().join("eth0")).unwrap();
        std::fs::write(root.path().join("eth0/type"), "1\n").unwrap();
        assert_eq!(interface_kind(root.path(), "eth0"), "ethernet");
        assert_eq!(interface_kind(root.path(), "wlan0"), "wifi");
        assert_eq!(interface_kind(root.path(), "wg0"), "vpn");
        assert_eq!(interface_kind(root.path(), "wwan0"), "cellular");
        let report = payload(Some("hw:CARD=wm8960soundcard,DEV=0"), Some("ethernet"));
        assert_eq!(
            report["audioOutput"]["label"],
            "hw:CARD=wm8960soundcard,DEV=0"
        );
        assert_eq!(report["networkType"], "ethernet");
        assert!(payload(None, None)["audioOutput"].is_null());
    }
}
