const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const statusDot = document.getElementById("status-dot");
const statusLabel = document.getElementById("status-label");
const serverStatusLine = document.getElementById("server-status-line");
const serverPath = document.getElementById("server-path");
const saveConfig = document.getElementById("save-config");
const copyApiKey = document.getElementById("copy-api-key");
const toggleServer = document.getElementById("toggle-server");
const restartServer = document.getElementById("restart-server");
const openAdmin = document.getElementById("open-admin");
const openLogs = document.getElementById("open-logs");
const runAtLogin = document.getElementById("run-at-login");
const logOutput = document.getElementById("log-output");
const httpsPort = document.getElementById("https-port");
const mdnsHost = document.getElementById("mdns-host");
const mdnsEnabled = document.getElementById("mdns-enabled");
const rtcPortStart = document.getElementById("rtc-port-start");
const rtcPortCount = document.getElementById("rtc-port-count");
const rtcSharedPort = document.getElementById("rtc-shared-port");
const rtcSharedPortEnabled = document.getElementById("rtc-shared-port-enabled");
const rtcPortTooltip = document.getElementById("rtc-port-tooltip");
const rtcPortToggle = rtcPortTooltip.parentElement;
const mediaNetworkMode = document.getElementById("media-network-mode");
const interfaceRow = document.getElementById("interface-row");
const mediaInterfaceName = document.getElementById("media-interface-name");
const manualAddressRow = document.getElementById("manual-address-row");
const mediaAnnouncedAddress = document.getElementById("media-announced-address");
const shell = document.querySelector(".shell");

let currentRunning = false;
let currentStarting = false;
let currentConfigured = false;
let refreshTimer = null;
let configTouched = false;
let resizeWindowFrame = null;
let lastRequestedWindowHeight = 0;

const MIN_WINDOW_HEIGHT = 360;
const MAX_WINDOW_HEIGHT = 820;
const LOG_STICKY_BOTTOM_THRESHOLD = 16;

async function suppressWindowFocusHide(milliseconds = 500) {
  try {
    await invoke("suppress_window_focus_hide", { milliseconds });
  } catch (error) {
    console.warn("failed to suppress window focus hide", error);
  }
}

function installWindowFocusSuppressionForControls() {
  const interactiveSelector = "button,input,select,textarea,label,[role='button']";
  const suppressForEvent = (event) => {
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest(interactiveSelector);
    if (!control) return;
    const milliseconds = control instanceof HTMLSelectElement ? 3000 : 1200;
    suppressWindowFocusHide(milliseconds);
  };

  document.addEventListener("pointerdown", suppressForEvent, { capture: true });
  document.addEventListener("touchstart", suppressForEvent, { capture: true, passive: true });
  document.addEventListener("focusin", suppressForEvent, true);
  document.addEventListener("change", suppressForEvent, true);
}

function syncMediaNetworkRows() {
  const mode = mediaNetworkMode.value || "auto";
  interfaceRow.hidden = mode !== "interface";
  manualAddressRow.hidden = mode !== "manual";
}

function syncRtcPortFields() {
  const shared = rtcSharedPortEnabled.checked;
  rtcSharedPort.disabled = !shared;
  rtcSharedPort.closest("label").hidden = !shared;
  document.getElementById("rtc-port-start-label").textContent = shared ? "Plain RTP start port" : "RTC start port";
  document.getElementById("rtc-port-count-label").textContent = shared ? "Plain RTP port count" : "RTC port count";
}

function renderMediaInterfaceOptions(container, interfaces, selectedName) {
  const selected = new Set(String(selectedName || '').split(',').map(name => name.trim()).filter(Boolean));
  const entries = new Map();
  for (const entry of interfaces || []) {
    if (!entry?.name) continue;
    const previous = entries.get(entry.name);
    entries.set(entry.name, previous ? `${previous}, ${entry.address}` : (entry.label || `${entry.name} - ${entry.address}`));
  }
  for (const name of selected) {
    if (!entries.has(name)) entries.set(name, `${name} (saved, unavailable)`);
  }
  container.replaceChildren();
  for (const [name, description] of entries) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.setAttribute('role', 'switch');
    checkbox.value = name;
    checkbox.checked = selected.has(name);
    const text = document.createElement('span');
    text.textContent = description;
    const control = document.createElement('span');
    control.className = 'switch-row';
    const track = document.createElement('span');
    track.className = 'switch-track';
    track.setAttribute('aria-hidden', 'true');
    control.append(checkbox, track);
    label.append(text, control);
    container.append(label);
  }
  if (!entries.size) container.textContent = 'No network adapters available';
}

function parsePortInput(input, fallback) {
  const parsed = Number.parseInt(input.value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function applyConfig(config, configured) {
  if (!config || configTouched) return;
  httpsPort.value = config.httpsPort ?? 8443;
  mdnsEnabled.checked = !!config.mdnsHost && config.mdnsHost !== "off";
  mdnsHost.value = mdnsEnabled.checked ? config.mdnsHost : "intercom.local";
  mdnsHost.disabled = !mdnsEnabled.checked;
  rtcPortStart.value = config.rtcPortStart ?? 40000;
  rtcPortCount.value = config.rtcPortCount ?? 10000;
  rtcSharedPort.value = config.webRtcSharedPort ?? rtcSharedPort.defaultValue;
  rtcSharedPortEnabled.checked = config.webRtcSharedPort != null;
  syncRtcPortFields();
  mediaNetworkMode.value = config.mediaNetworkMode || "auto";
  renderMediaInterfaceOptions(mediaInterfaceName, config.availableMediaInterfaces, config.mediaInterfaceName || "");
  mediaAnnouncedAddress.value = config.mediaAnnouncedAddress || "";
  syncMediaNetworkRows();
}

function readConfig() {
  const mode = mediaNetworkMode.value || "auto";
  const shared = rtcSharedPortEnabled.checked;
  return {
    httpsPort: parsePortInput(httpsPort, 8443),
    mdnsHost: mdnsEnabled.checked ? mdnsHost.value.trim() || "intercom.local" : "off",
    httpPort: "off",
    rtcPortStart: parsePortInput(rtcPortStart, 40000),
    rtcPortCount: parsePortInput(rtcPortCount, 10000),
    webRtcSharedPort: shared ? Number(rtcSharedPort.value || rtcSharedPort.defaultValue) : null,
    mediaNetworkMode: mode,
    mediaInterfaceName:
      mode === "interface" ? Array.from(mediaInterfaceName.querySelectorAll("input:checked"), input => input.value).join(",") || null : null,
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

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard unavailable");
}

async function copyCompanionApiKey() {
  if (!copyApiKey) return;

  const originalLabel = copyApiKey.textContent;
  copyApiKey.disabled = true;
  try {
    const apiKey = await invoke("get_companion_api_key");
    if (!apiKey) throw new Error("API key not available yet. Start the server once to create it.");
    await copyTextToClipboard(apiKey);
    copyApiKey.textContent = "Copied";
    window.setTimeout(() => {
      copyApiKey.textContent = originalLabel;
    }, 1200);
  } catch (error) {
    appendLogLine(`Could not copy API key: ${error}`);
  } finally {
    window.setTimeout(() => {
      copyApiKey.disabled = false;
    }, 250);
  }
}

function setStatus(status) {
  currentRunning = !!status.running;
  currentConfigured = !!status.configured;
  // A setup screen is never a server start. Guard this in the renderer as
  // well, so a stale status event cannot show "Starting…" before first-run
  // settings have been saved.
  currentStarting = currentConfigured && !!status.starting;
  if (status?.config) {
    status.config.availableMediaInterfaces = status.availableMediaInterfaces || [];
  }
  applyConfig(status.config, currentConfigured);

  const state = !currentConfigured
    ? "setup"
    : status.error
      ? "error"
      : currentStarting
        ? "starting"
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
  } else if (currentStarting) {
    statusLabel.textContent = "Starting…";
  } else {
    statusLabel.textContent = currentRunning ? "Running" : "Stopped";
  }

  toggleServer.textContent = currentStarting ? "Starting…" : currentRunning ? "Stop" : "Start";
  toggleServer.disabled = currentStarting || (!currentConfigured && !currentRunning);
  restartServer.disabled = currentStarting || !status.serverPath || !currentConfigured;
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
  if (![rtcPortStart, rtcPortCount, rtcSharedPort].every(input => input.reportValidity())) return;
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

copyApiKey?.addEventListener("click", copyCompanionApiKey);

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
  mdnsEnabled,
  rtcPortStart,
  rtcPortCount,
  rtcSharedPort,
  rtcSharedPortEnabled,
  mediaNetworkMode,
  mediaInterfaceName,
  mediaAnnouncedAddress,
].forEach((input) => {
  input.addEventListener("input", () => {
    configTouched = true;
    if (input === mdnsEnabled) mdnsHost.disabled = !mdnsEnabled.checked;
    if (input === rtcSharedPortEnabled) syncRtcPortFields();
    syncMediaNetworkRows();
    requestWindowResize();
  });
  input.addEventListener("change", () => {
    configTouched = true;
    if (input === mdnsEnabled) mdnsHost.disabled = !mdnsEnabled.checked;
    syncMediaNetworkRows();
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
installWindowFocusSuppressionForControls();
installWindowAutoResize();
for (const event of ["pointerenter", "focusin"]) {
  rtcPortToggle.addEventListener(event, () => rtcPortToggle.removeAttribute("data-tip-dismissed"));
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && getComputedStyle(rtcPortTooltip).visibility === "visible") {
    rtcPortToggle.setAttribute("data-tip-dismissed", "");
  }
});
refreshTimer = window.setInterval(refreshStatus, 1000);

window.addEventListener("beforeunload", () => {
  if (refreshTimer) window.clearInterval(refreshTimer);
});
