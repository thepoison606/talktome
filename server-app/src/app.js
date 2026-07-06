const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const statusDot = document.getElementById("status-dot");
const statusLabel = document.getElementById("status-label");
const serverStatusLine = document.getElementById("server-status-line");
const serverPath = document.getElementById("server-path");
const saveConfig = document.getElementById("save-config");
const toggleServer = document.getElementById("toggle-server");
const restartServer = document.getElementById("restart-server");
const openAdmin = document.getElementById("open-admin");
const openLogs = document.getElementById("open-logs");
const runAtLogin = document.getElementById("run-at-login");
const logOutput = document.getElementById("log-output");
const httpsPort = document.getElementById("https-port");
const mdnsHost = document.getElementById("mdns-host");
const rtcPortStart = document.getElementById("rtc-port-start");
const rtcPortCount = document.getElementById("rtc-port-count");
const mediaNetworkMode = document.getElementById("media-network-mode");
const manualAddressRow = document.getElementById("manual-address-row");
const mediaAnnouncedAddress = document.getElementById("media-announced-address");
const shell = document.querySelector(".shell");

let currentRunning = false;
let currentConfigured = false;
let refreshTimer = null;
let configTouched = false;
let resizeWindowFrame = null;
let lastRequestedWindowHeight = 0;

const MIN_WINDOW_HEIGHT = 360;
const MAX_WINDOW_HEIGHT = 820;
const LOG_STICKY_BOTTOM_THRESHOLD = 16;

function parsePortInput(input, fallback) {
  const parsed = Number.parseInt(input.value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function applyConfig(config, configured) {
  if (!config || configTouched) return;
  httpsPort.value = config.httpsPort ?? 8443;
  mdnsHost.value = config.mdnsHost || "intercom.local";
  rtcPortStart.value = config.rtcPortStart ?? 40000;
  rtcPortCount.value = config.rtcPortCount ?? 10000;
  mediaNetworkMode.value = config.mediaNetworkMode || "auto";
  mediaAnnouncedAddress.value = config.mediaAnnouncedAddress || "";
  manualAddressRow.hidden = mediaNetworkMode.value !== "manual";
}

function readConfig() {
  const mode = mediaNetworkMode.value || "auto";
  return {
    httpsPort: parsePortInput(httpsPort, 8443),
    mdnsHost: mdnsHost.value.trim() || "off",
    httpPort: "off",
    rtcPortStart: parsePortInput(rtcPortStart, 40000),
    rtcPortCount: parsePortInput(rtcPortCount, 10000),
    mediaNetworkMode: mode,
    mediaAnnouncedAddress:
      mode === "manual" ? mediaAnnouncedAddress.value.trim() || null : null,
  };
}

function isLogScrolledToBottom() {
  return (
    logOutput.scrollHeight - logOutput.scrollTop - logOutput.clientHeight <=
    LOG_STICKY_BOTTOM_THRESHOLD
  );
}

function replaceLogText(text) {
  if (logOutput.textContent === text) return;

  const wasAtBottom = isLogScrolledToBottom();
  const previousScrollTop = logOutput.scrollTop;

  logOutput.textContent = text;
  logOutput.scrollTop = wasAtBottom ? logOutput.scrollHeight : previousScrollTop;
}

function appendLogLine(line) {
  const wasAtBottom = isLogScrolledToBottom();
  const nextText = `${logOutput.textContent}${logOutput.textContent ? "\n" : ""}${line}`;
  const lines = nextText.split("\n");

  logOutput.textContent = lines.length > 200 ? lines.slice(-200).join("\n") : nextText;
  if (wasAtBottom) {
    logOutput.scrollTop = logOutput.scrollHeight;
  }
}

function setStatus(status) {
  currentRunning = !!status.running;
  currentConfigured = !!status.configured;
  applyConfig(status.config, currentConfigured);

  const state = !currentConfigured
    ? "setup"
    : status.error
      ? "error"
      : currentRunning
        ? "running"
        : "stopped";
  serverStatusLine.dataset.state = state;
  statusDot.className = "status-dot";
  statusDot.classList.add(
    state === "running" ? "online" : state === "error" || state === "setup" ? "error" : "offline",
  );

  if (!currentConfigured) {
    statusLabel.textContent = "Setup required";
  } else if (status.error) {
    statusLabel.textContent = "Error";
  } else {
    statusLabel.textContent = currentRunning ? "Running" : "Stopped";
  }

  toggleServer.textContent = currentRunning ? "Stop" : "Start";
  toggleServer.disabled = !currentConfigured && !currentRunning;
  restartServer.disabled = !status.serverPath || !currentConfigured;
  openAdmin.disabled = !currentRunning;
  serverPath.textContent = status.serverPath || "Server binary not found.";

  replaceLogText((status.logs || []).join("\n"));
  requestWindowResize();
}

function measureWindowContentHeight() {
  if (!shell) return 0;

  const styles = window.getComputedStyle(shell);
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
  const gap = Number.parseFloat(styles.rowGap || styles.gap) || 0;
  const visibleChildren = Array.from(shell.children).filter((child) => {
    if (!(child instanceof HTMLElement)) return false;
    return window.getComputedStyle(child).display !== "none";
  });
  const childrenHeight = visibleChildren.reduce((total, child, index) => {
    return total + child.getBoundingClientRect().height + (index > 0 ? gap : 0);
  }, 0);

  return Math.ceil(paddingTop + childrenHeight + paddingBottom);
}

function requestWindowResize() {
  if (resizeWindowFrame) return;

  resizeWindowFrame = window.requestAnimationFrame(async () => {
    resizeWindowFrame = null;
    const measuredHeight = measureWindowContentHeight();
    if (!measuredHeight) return;
    const height = Math.min(MAX_WINDOW_HEIGHT, Math.max(MIN_WINDOW_HEIGHT, measuredHeight));
    if (Math.abs(height - lastRequestedWindowHeight) < 2) return;
    lastRequestedWindowHeight = height;

    try {
      await invoke("resize_main_window_to_content", { height });
    } catch (error) {
      console.warn("failed to resize server window", error);
    }
  });
}

function installWindowAutoResize() {
  requestWindowResize();

  if (!("ResizeObserver" in window)) {
    window.setInterval(requestWindowResize, 1_000);
    return;
  }

  const observer = new ResizeObserver(requestWindowResize);
  observer.observe(document.body);
  if (shell) observer.observe(shell);
}

async function refreshStatus() {
  try {
    const status = await invoke("get_server_status");
    setStatus(status);
  } catch (error) {
    setStatus({
      running: false,
      configured: false,
      error: String(error),
      serverPath: "",
      config: readConfig(),
      logs: [String(error)],
    });
  }
}

async function refreshAutostart() {
  try {
    runAtLogin.checked = await invoke("get_autostart_enabled");
  } catch {
    runAtLogin.checked = false;
  }
}

toggleServer.addEventListener("click", async () => {
  if (currentRunning) {
    await invoke("stop_server");
  } else {
    await invoke("start_server");
  }
  await refreshStatus();
});

saveConfig.addEventListener("click", async () => {
  saveConfig.disabled = true;
  try {
    configTouched = false;
    const status = await invoke("save_server_config", {
      config: readConfig(),
      start: true,
    });
    setStatus(status);
  } catch (error) {
    setStatus({
      running: currentRunning,
      configured: currentConfigured,
      error: String(error),
      serverPath: serverPath.textContent,
      config: readConfig(),
      logs: [String(error)],
    });
  } finally {
    saveConfig.disabled = false;
  }
});

restartServer.addEventListener("click", async () => {
  await invoke("restart_server");
  await refreshStatus();
});

openAdmin.addEventListener("click", async () => {
  await invoke("open_admin");
});

openLogs.addEventListener("click", async () => {
  await invoke("open_logs");
});

runAtLogin.addEventListener("change", async () => {
  await invoke("set_autostart_enabled", { enabled: runAtLogin.checked });
  await refreshAutostart();
});

[
  httpsPort,
  mdnsHost,
  rtcPortStart,
  rtcPortCount,
  mediaNetworkMode,
  mediaAnnouncedAddress,
].forEach((input) => {
  input.addEventListener("input", () => {
    configTouched = true;
    manualAddressRow.hidden = mediaNetworkMode.value !== "manual";
    requestWindowResize();
  });
  input.addEventListener("change", () => {
    configTouched = true;
    manualAddressRow.hidden = mediaNetworkMode.value !== "manual";
    requestWindowResize();
  });
});

listen("server-log", (event) => {
  const line = event.payload;
  if (!line) return;
  appendLogLine(line);
  requestWindowResize();
});

listen("server-status-changed", refreshStatus);
listen("autostart-changed", refreshAutostart);

refreshStatus();
refreshAutostart();
installWindowAutoResize();
refreshTimer = window.setInterval(refreshStatus, 1000);

window.addEventListener("beforeunload", () => {
  if (refreshTimer) window.clearInterval(refreshTimer);
});
