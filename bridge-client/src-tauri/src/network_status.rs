//! Detect the interface used for this server, rather than guessing from active adapters.
use serde_json::{json, Value};
use std::net::{IpAddr, UdpSocket};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

static CACHE: OnceLock<Mutex<Option<(String, Instant, Value)>>> = OnceLock::new();

pub fn report(server: &str) -> Value {
    let cache = CACHE.get_or_init(Default::default);
    if let Ok(value) = cache.lock() {
        if let Some((url, at, status)) = value.as_ref() {
            if url == server && at.elapsed() < Duration::from_secs(15) {
                return status.clone();
            }
        }
    }
    let status = detect(server).unwrap_or_else(|| json!({}));
    if let Ok(mut value) = cache.lock() {
        *value = Some((server.into(), Instant::now(), status.clone()));
    }
    status
}

fn detect(server: &str) -> Option<Value> {
    let url = reqwest::Url::parse(server).ok()?;
    for remote in url.socket_addrs(|| None).ok()? {
        let socket = UdpSocket::bind(if remote.is_ipv6() {
            "[::]:0"
        } else {
            "0.0.0.0:0"
        })
        .ok()?;
        if socket.connect(remote).is_err() {
            continue;
        }
        let local = socket.local_addr().ok()?.ip();
        let kind = if local.is_loopback() || local == remote.ip() {
            "local"
        } else {
            interface_kind(local, remote.ip())
        };
        return Some(json!({ "networkType": kind, "localAddress": local.to_string() }));
    }
    None
}

fn command(program: &str, args: &[&str]) -> Option<String> {
    use std::io::Read;
    let mut process = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        process.creation_flags(0x08000000);
    }
    let mut child = process
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().ok()? {
            if !status.success() {
                return None;
            }
            let mut text = String::new();
            child
                .stdout
                .take()?
                .take(32768)
                .read_to_string(&mut text)
                .ok()?;
            return Some(text);
        }
        if start.elapsed() >= Duration::from_millis(500) {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn named_interface_kind(name: &str) -> &'static str {
    let name = name.to_ascii_lowercase();
    if name.contains("wi-fi")
        || name.contains("wifi")
        || name.contains("wireless")
        || name.contains("802.11")
        || name.contains("802_11")
        || name.contains("airport")
    {
        "wifi"
    } else if name.contains("bluetooth") {
        "bluetooth"
    } else if name.contains("ethernet") || name.contains("802.3") || name.contains("802_3") {
        "ethernet"
    } else if name.starts_with("utun")
        || name.starts_with("tun")
        || name.starts_with("tap")
        || name.starts_with("wg")
    {
        "vpn"
    } else {
        "other"
    }
}

#[cfg(target_os = "macos")]
fn interface_kind(_local: IpAddr, remote: IpAddr) -> &'static str {
    let ip = remote.to_string();
    let Some(route) = command("/sbin/route", &["-n", "get", &ip]) else {
        return "other";
    };
    let Some(device) = route
        .lines()
        .find_map(|line| line.trim().strip_prefix("interface:").map(str::trim))
    else {
        return "other";
    };
    let ports = command("/usr/sbin/networksetup", &["-listallhardwareports"]).unwrap_or_default();
    mac_interface_kind(&ports, device)
}

#[cfg(any(target_os = "macos", test))]
fn mac_interface_kind(ports: &str, device: &str) -> &'static str {
    let mut port = "";
    for line in ports.lines().map(str::trim) {
        if let Some(value) = line.strip_prefix("Hardware Port:") {
            port = value.trim();
        }
        if line.strip_prefix("Device:").map(str::trim) == Some(device) {
            return named_interface_kind(port);
        }
    }
    named_interface_kind(device)
}

#[cfg(target_os = "linux")]
fn interface_kind(_local: IpAddr, remote: IpAddr) -> &'static str {
    let Some(route) = command("ip", &["-j", "route", "get", &remote.to_string()]) else {
        return "other";
    };
    let Ok(rows) = serde_json::from_str::<Value>(&route) else {
        return "other";
    };
    let Some(device) = rows[0]["dev"].as_str() else {
        return "other";
    };
    let path = std::path::Path::new("/sys/class/net").join(device);
    if path.join("wireless").exists() {
        "wifi"
    } else if path.join("tun_flags").exists() || device.starts_with("wg") {
        "vpn"
    } else if std::fs::read_to_string(path.join("type")).is_ok_and(|kind| kind.trim() == "1") {
        "ethernet"
    } else {
        "other"
    }
}

#[cfg(target_os = "windows")]
fn interface_kind(local: IpAddr, _remote: IpAddr) -> &'static str {
    // local is a parsed IP address, never shell input from the server URL.
    let script = format!("Get-NetIPAddress -IPAddress '{}' | ForEach-Object {{ Get-NetAdapter -InterfaceIndex $_.InterfaceIndex }} | Select-Object -ExpandProperty PhysicalMediaType", local);
    command(
        "powershell.exe",
        &["-NoProfile", "-NonInteractive", "-Command", &script],
    )
    .map(|kind| named_interface_kind(kind.trim()))
    .unwrap_or("other")
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn interface_kind(_local: IpAddr, _remote: IpAddr) -> &'static str {
    "other"
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matches_the_routed_mac_interface_not_the_first_active_adapter() {
        let ports = "Hardware Port: Wi-Fi\nDevice: en0\n\nHardware Port: USB 10/100/1000 LAN Ethernet\nDevice: en7\n";
        assert_eq!(mac_interface_kind(ports, "en0"), "wifi");
        assert_eq!(mac_interface_kind(ports, "en7"), "ethernet");
        assert_eq!(mac_interface_kind(ports, "utun4"), "vpn");
    }
    #[test]
    fn localhost_is_local_and_never_mislabeled_as_ethernet() {
        assert_eq!(report("https://127.0.0.1:8443")["networkType"], "local");
        assert_eq!(report("https://[::1]:8443")["networkType"], "local");
        assert_eq!(report("not a URL"), json!({}));
    }
}
