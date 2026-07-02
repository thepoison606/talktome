const deviceList = document.getElementById("device-list");
const deviceSummary = document.getElementById("device-summary");
const refreshButton = document.getElementById("refresh-devices");
const connectionStatus = document.getElementById("connection-status");
const bridgePorts = document.getElementById("bridge-ports");
const localPortList = document.getElementById("local-port-list");
const addPortButton = document.getElementById("add-port");
const stopAllPortsButton = document.getElementById("stop-all-ports");
const serverUrlInput = document.getElementById("server-url");
const apiKeyInput = document.getElementById("api-key");
const bridgeNameInput = document.getElementById("bridge-name");
const announceBridgeButton = document.getElementById("announce-bridge");
const announceStatus = document.getElementById("announce-status");
const autostartInput = document.getElementById("autostart-enabled");
const autostartStatus = document.getElementById("autostart-status");

const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;

const STORAGE_KEYS = {
  serverUrl: "talktome:bridge-server-url",
  apiKey: "talktome:bridge-api-key",
  bridgeName: "talktome:bridge-name",
  bridgeId: "talktome:bridge-id",
  bridgeToken: "talktome:bridge-token"
};
const MANAGED_EVENT_FALLBACK_POLL_MS = 250;
const MANAGED_INVENTORY_WATCH_MS = 2_000;
const MANAGED_RETRY_MS = 2_000;
const MANAGED_DEFAULT_TARGET_VOLUME = 0.9;
const MIN_WINDOW_HEIGHT = 260;
const MAX_WINDOW_HEIGHT = 820;

let currentInventory = null;
let portRows = [];
let nextPortNumber = 1;
let statusPollTimer = null;
let managedBridgeConfig = null;
let managedSyncRunning = false;
let managedEventPollRunning = false;
let managedHeartbeatTimer = null;
let managedEventTimer = null;
let managedInventoryTimer = null;
let managedRetryTimer = null;
let managedRetryRunning = false;
let managedInventoryWatchRunning = false;
let lastAnnouncedInventorySignature = "";
let lastManagedBridgePortsHtml = "";
let bridgeEventStreamListenerPromise = null;
let resizeWindowFrame = null;
let lastRequestedWindowHeight = 0;
const managedSessions = new Map();
const nativeEventStreamSessions = new Map();
const managedPortDrafts = new Map();
const managedPortEditStates = new Map();

function measureBridgeWindowContentHeight() {
  const shell = document.querySelector(".shell");
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

function requestBridgeWindowResize() {
  if (!invoke || resizeWindowFrame) return;

  resizeWindowFrame = window.requestAnimationFrame(async () => {
    resizeWindowFrame = null;
    const measuredHeight = measureBridgeWindowContentHeight();
    if (!measuredHeight) return;
    const height = Math.min(MAX_WINDOW_HEIGHT, Math.max(MIN_WINDOW_HEIGHT, measuredHeight));
    if (Math.abs(height - lastRequestedWindowHeight) < 2) return;
    lastRequestedWindowHeight = height;

    try {
      await invoke("resize_main_window_to_content", { height });
    } catch (error) {
      console.warn("failed to resize bridge window", error);
    }
  });
}

function installBridgeWindowAutoResize() {
  requestBridgeWindowResize();

  if (!("ResizeObserver" in window)) {
    window.setInterval(requestBridgeWindowResize, 1_000);
    return;
  }

  const shell = document.querySelector(".shell");
  if (!shell) return;

  const observer = new ResizeObserver(requestBridgeWindowResize);
  Array.from(shell.children).forEach((child) => observer.observe(child));
  observer.observe(shell);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function loadBridgeSettings() {
  serverUrlInput.value = localStorage.getItem(STORAGE_KEYS.serverUrl) || "";
  apiKeyInput.value = localStorage.getItem(STORAGE_KEYS.apiKey) || "";
  bridgeNameInput.value = localStorage.getItem(STORAGE_KEYS.bridgeName) || "Bridge";
}

function saveBridgeSettings() {
  localStorage.setItem(STORAGE_KEYS.serverUrl, serverUrlInput.value.trim());
  localStorage.setItem(STORAGE_KEYS.apiKey, apiKeyInput.value.trim());
  localStorage.setItem(STORAGE_KEYS.bridgeName, bridgeNameInput.value.trim());
}

function setServerConnectionState(state) {
  if (!announceStatus) return;
  const normalizedState = ["connected", "connecting", "disconnected"].includes(state)
    ? state
    : "disconnected";
  announceStatus.dataset.state = normalizedState;
  const label = announceStatus.querySelector("strong");
  const text = normalizedState === "connected"
    ? "Connected"
    : normalizedState === "connecting"
      ? "Connecting"
      : "Disconnected";
  if (label) {
    label.textContent = text;
  } else {
    announceStatus.textContent = text;
  }
}

async function loadAutostartState() {
  if (!invoke) {
    autostartInput.disabled = true;
    autostartStatus.textContent = "Autostart is only available in the native app.";
    return;
  }

  autostartInput.disabled = true;
  autostartStatus.textContent = "";
  try {
    autostartInput.checked = Boolean(await invoke("get_autostart_enabled"));
    autostartStatus.textContent = "";
  } catch (error) {
    autostartStatus.textContent = `Startup setting unavailable: ${String(error)}`;
  } finally {
    autostartInput.disabled = false;
  }
}

async function setAutostartState() {
  if (!invoke) return;

  const requestedState = autostartInput.checked;
  autostartInput.disabled = true;
  autostartStatus.textContent = "";
  try {
    autostartInput.checked = Boolean(await invoke("set_autostart_enabled", { enabled: requestedState }));
    autostartStatus.textContent = "";
  } catch (error) {
    autostartInput.checked = !requestedState;
    autostartStatus.textContent = `Failed to update startup setting: ${String(error)}`;
  } finally {
    autostartInput.disabled = false;
  }
}

async function listenForAutostartChanges() {
  if (!listen) return;
  await listen("autostart-changed", (event) => {
    autostartInput.checked = Boolean(event.payload);
    autostartStatus.textContent = "";
  });
}

function inventorySignature(inventory) {
  if (!inventory) return "";
  const devices = (inventory.devices || []).map((device) => ({
    id: device.id || "",
    name: device.name || "",
    direction: device.direction || "",
    isDefault: Boolean(device.is_default ?? device.isDefault),
    maxChannels: Number(device.max_channels ?? device.maxChannels ?? 0),
    supports48k: Boolean(device.supports_48k ?? device.supports48k),
    pairs: (device.channel_pairs ?? device.channelPairs ?? [])
      .map((pair) => [
        Number(pair.left_channel ?? pair.leftChannel ?? 0),
        Number(pair.right_channel ?? pair.rightChannel ?? 0)
      ])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  })).sort((a, b) => (
    a.direction.localeCompare(b.direction)
    || a.id.localeCompare(b.id)
    || a.name.localeCompare(b.name)
  ));

  return JSON.stringify({
    host: inventory.host || "",
    devices
  });
}

function getBridgeCredential() {
  return localStorage.getItem(STORAGE_KEYS.bridgeToken) || apiKeyInput.value.trim();
}

function normalizeServerUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("Server URL is required");
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function getBridgeClientPlatform() {
  const platform = String(navigator?.platform || navigator?.userAgent || "").toLowerCase();
  if (platform.includes("mac")) return "macos";
  if (platform.includes("win")) return "windows";
  if (platform.includes("linux")) return "linux";
  return "unknown";
}

async function bridgeApi(method, path, body = null) {
  if (!invoke) {
    throw new Error("Native bridge API is unavailable");
  }
  return invoke("bridge_api_request", {
    serverUrl: normalizeServerUrl(serverUrlInput.value),
    apiKey: getBridgeCredential(),
    method,
    path,
    body
  });
}

async function suppressWindowFocusHide(milliseconds = 500) {
  if (!invoke) return;
  try {
    await invoke("suppress_window_focus_hide", { milliseconds });
  } catch {}
}

function managedSessionPath(session, suffix = "") {
  return `/api/v1/bridge/sessions/${encodeURIComponent(session.sessionId)}${suffix}`;
}

function managedSessionEventStreamUrl(session) {
  const url = new URL(
    managedSessionPath(session, "/events/stream"),
    `${normalizeServerUrl(serverUrlInput.value)}/`
  );
  url.searchParams.set("apiKey", getBridgeCredential());
  return url.toString();
}

function bridgePortKey(port) {
  if (port?.kind === "feed") {
    return `feed:${port.feedId}`;
  }
  return `user:${port?.userId}`;
}

function bridgePortHasOutput(port) {
  return Boolean(port?.output?.deviceId);
}

function bridgePortTargetId(port) {
  return port?.kind === "feed" ? Number(port.feedId) : Number(port?.userId);
}

function buildManagedTargetAudioKey(targetType, targetId) {
  const normalizedType = String(targetType || "").trim().toLowerCase();
  const numericId = Number(targetId);
  if (!["user", "conference", "feed"].includes(normalizedType) || !Number.isFinite(numericId)) {
    return "";
  }
  return `${normalizedType}:${numericId}`;
}

function normalizeManagedTargetAudioState(state = {}) {
  const targetType = String(state.targetType || "").trim().toLowerCase();
  const targetId = Number(state.targetId);
  const key = buildManagedTargetAudioKey(targetType, targetId);
  if (!key) return null;
  const rawVolume = Number(state.volume);
  return {
    key,
    targetType,
    targetId,
    volume: Math.max(0, Math.min(1, Number.isFinite(rawVolume) ? rawVolume : MANAGED_DEFAULT_TARGET_VOLUME)),
    muted: Boolean(state.muted)
  };
}

function getManagedOutputTargetKeys(output) {
  const keys = [];
  const appData = output?.appData || {};
  const appType = String(appData.type || "").trim().toLowerCase();
  const appId = Number(appData.id);
  if (["conference", "feed"].includes(appType) && Number.isFinite(appId)) {
    return [buildManagedTargetAudioKey(appType, appId)].filter(Boolean);
  }
  const speakerUserId = Number(output?.speakerUserId);
  if (Number.isFinite(speakerUserId)) {
    keys.push(buildManagedTargetAudioKey("user", speakerUserId));
  }
  return keys.filter(Boolean);
}

function getManagedOutputAudioState(session, output) {
  if (!(session.targetAudioStates instanceof Map)) {
    session.targetAudioStates = new Map();
  }
  const targetKeys = getManagedOutputTargetKeys(output);
  for (const key of targetKeys) {
    const state = session.targetAudioStates.get(key);
    if (state) return state;
  }
  return {
    volume: MANAGED_DEFAULT_TARGET_VOLUME,
    muted: false
  };
}

function getManagedRetryDelay(session) {
  return MANAGED_RETRY_MS;
}

function findInventoryDevice(direction, assignment) {
  if (!assignment?.deviceId) return null;
  return (currentInventory?.devices || []).find((device) => (
    device.direction === direction && device.id === assignment.deviceId
  )) || null;
}

function validateManagedPortInventory(port) {
  if (!currentInventory?.devices?.length) return;
  const unavailableReason = getManagedPortUnavailableReason(port);
  if (unavailableReason) {
    throw new Error(unavailableReason);
  }
}

function getManagedAssignmentUnavailableReason(direction, assignment) {
  const label = direction === "output" ? "Output" : "Input";
  if (!assignment?.deviceId) {
    return direction === "output" ? "" : `${label} device is not configured`;
  }
  const device = findInventoryDevice(direction, assignment);
  const deviceName = assignment.deviceName || assignment.deviceId || "unknown";
  if (!device) {
    return `${label} device missing: ${deviceName}`;
  }

  const left = Number(assignment.leftChannel);
  const right = Number(assignment.rightChannel);
  const requiredChannel = Math.max(left, right);
  if (!Number.isInteger(left) || !Number.isInteger(right) || left < 1 || right < 1) {
    return `${label} channel selection is invalid for ${deviceName}`;
  }
  const maxChannels = Number(device.max_channels ?? device.maxChannels ?? 0);
  if (maxChannels < requiredChannel) {
    return `${label} device ${deviceName} has ${maxChannels} channel(s), ${requiredChannel} required`;
  }
  return "";
}

function getManagedPortUnavailableReason(port) {
  if (!currentInventory?.devices?.length) return "";
  return getManagedAssignmentUnavailableReason("input", port.input)
    || getManagedAssignmentUnavailableReason("output", port.output);
}

async function auditManagedSessionDevices() {
  for (const session of managedSessions.values()) {
    if (!session.ready || session.starting) continue;
    const unavailableReason = getManagedPortUnavailableReason(session.port);
    if (!unavailableReason) continue;
    await stopManagedSession(session, { remove: false });
    setManagedSessionError(session, new Error(unavailableReason));
  }
}

async function auditManagedNativeMediaStatus() {
  if (!invoke) return;
  const status = await invoke("get_bridge_media_status");
  const inputErrors = new Map((status?.inputStreamErrors || []).map((entry) => [
    String(entry.streamId || ""),
    String(entry.message || "Bridge input stream failed")
  ]));
  const outputErrors = new Map((status?.outputStreamErrors || []).map((entry) => [
    String(entry.streamId || ""),
    String(entry.message || "Bridge output stream failed")
  ]));

  for (const session of managedSessions.values()) {
    if (!session.ready || session.starting) continue;
    const inputError = inputErrors.get(session.inputStreamId);
    let outputError = null;
    for (const output of session.outputs.values()) {
      outputError = outputErrors.get(output.streamId);
      if (outputError) break;
    }
    const message = inputError || outputError;
    if (!message) continue;
    await stopManagedSession(session, { remove: false });
    setManagedSessionError(session, new Error(message));
  }
}

function classifyManagedPortError(error) {
  const message = String(error?.message || error || "");
  const lower = message.toLowerCase();
  if (!message) {
    return { label: "Error", detail: "Unknown bridge error", retryable: true };
  }
  if (
    lower.includes("device missing")
    || lower.includes("device not found")
    || lower.includes("audio device")
    || lower.includes("no longer reports")
    || lower.includes("channel pair is invalid")
    || lower.includes("channel selection is invalid")
    || lower.includes("channel(s)")
  ) {
    return { label: "Device unavailable", detail: message, retryable: true };
  }
  if (lower.includes("no f32/48 khz") || lower.includes("stream config") || lower.includes("sample rate")) {
    return { label: "Audio format unavailable", detail: message, retryable: true };
  }
  if (lower.includes("ffmpeg")) {
    return { label: "Codec error", detail: message, retryable: false };
  }
  if (
    lower.includes("bridge session not found")
    || lower.includes("bridge-session-timeout")
    || lower.includes("bridge-session-closed")
  ) {
    return {
      label: "Reconnecting",
      detail: "Bridge port session expired; reconnecting.",
      retryable: true
    };
  }
  if (
    lower.includes("failed to fetch")
    || lower.includes("load failed")
    || lower.includes("network")
    || lower.includes("bridge api request failed")
    || lower.includes("server")
  ) {
    return { label: "Server offline", detail: message, retryable: true };
  }
  if (lower.includes("session was replaced") || lower.includes("session-kicked")) {
    return { label: "Session replaced", detail: message, retryable: true };
  }
  return { label: "Error", detail: message, retryable: true };
}

function setManagedSessionError(session, error) {
  const classified = classifyManagedPortError(error);
  session.error = classified.detail;
  session.statusLabel = classified.label;
  session.retryable = classified.retryable;
  if (classified.retryable) {
    const delay = getManagedRetryDelay(session);
    session.retryAt = Date.now() + delay;
  } else {
    session.retryAt = null;
  }
}

function getManagedSessionState(session, port) {
  if (!session) return { label: "Connecting", className: "" };
  if (session.starting && !session.backgroundRetry) return { label: "Connecting", className: "" };
  if (session.error) {
    return {
      label: session.statusLabel || "Error",
      className: session.retryable === false ? "error" : "warning"
    };
  }
  if (!session.ready) return { label: "Waiting", className: "warning" };
  if (port.kind === "feed") return { label: "Streaming", className: "" };
  if (session.talking) return { label: "Transmitting", className: "" };
  const addressedNow = Array.isArray(session.addressedNow) ? session.addressedNow : [];
  if (addressedNow.length) return { label: "Receiving", className: "" };
  return { label: "Ready", className: "" };
}

function bridgePortSignature(port) {
  return JSON.stringify({
    id: port.id,
    kind: port.kind || "user",
    userId: port.userId,
    feedId: port.feedId,
    input: port.input,
    output: port.output,
    updatedAt: port.updatedAt
  });
}

function getDeviceLabel(device) {
  return device?.name || device?.id || "Unknown device";
}

function findDeviceByDirectionAndId(direction, deviceId) {
  if (!deviceId) return null;
  return devicesByDirection(direction).find((device) => device.id === deviceId) || null;
}

function getManagedPortDraft(port) {
  const key = bridgePortKey(port);
  const draft = managedPortDrafts.get(key) || {};
  return {
    input: {
      deviceId: draft.input?.deviceId ?? port.input?.deviceId ?? "",
      leftChannel: draft.input?.leftChannel ?? port.input?.leftChannel ?? null,
      rightChannel: draft.input?.rightChannel ?? port.input?.rightChannel ?? null,
    },
    output: bridgePortHasOutput(port) ? {
      deviceId: draft.output?.deviceId ?? port.output?.deviceId ?? "",
      leftChannel: draft.output?.leftChannel ?? port.output?.leftChannel ?? null,
      rightChannel: draft.output?.rightChannel ?? port.output?.rightChannel ?? null,
    } : null,
  };
}

function buildManagedDeviceOptions(direction, selectedDeviceId) {
  const devices = devicesByDirection(direction);
  const selected = String(selectedDeviceId || "");
  const hasSelected = devices.some((device) => device.id === selected);
  const options = [];
  if (!selected) {
    options.push('<option value="">Select device</option>');
  } else if (!hasSelected) {
    options.push(`<option value="${escapeHtml(selected)}" selected>${escapeHtml(`${selected} (saved, unavailable)`)}</option>`);
  }

  devices.forEach((device) => {
    const selectedAttr = device.id === selected ? " selected" : "";
    const suffix = device.is_default ? " (default)" : "";
    options.push(`<option value="${escapeHtml(device.id)}"${selectedAttr}>${escapeHtml(`${getDeviceLabel(device)}${suffix}`)}</option>`);
  });

  return options.join("");
}

function buildManagedChannelOptions(device, selectedLeft, selectedRight) {
  const normalizedLeft = Number(selectedLeft);
  const normalizedRight = Number(selectedRight);
  const selectedPair = (
    Number.isInteger(normalizedLeft) &&
    Number.isInteger(normalizedRight) &&
    normalizedLeft >= 1 &&
    normalizedRight >= 1
  )
    ? `${Number(selectedLeft)}:${Number(selectedRight)}`
    : "";
  const options = buildChannelOptions(device);
  const hasSelected = options.some((option) => option.value === selectedPair);
  const html = [];

  if (!selectedPair) {
    html.push('<option value="">Select channel</option>');
  } else if (!hasSelected) {
    html.push(`<option value="${escapeHtml(selectedPair)}" selected>${escapeHtml(`${formatChannelSelection(selectedLeft, selectedRight)} (saved, unavailable)`)}</option>`);
  }

  options.forEach((option) => {
    const selectedAttr = option.value === selectedPair ? " selected" : "";
    html.push(`<option value="${escapeHtml(option.value)}"${selectedAttr}>${escapeHtml(option.label)}</option>`);
  });

  return html.join("");
}

function formatActiveReturnPaths(count) {
  const activeCount = Number(count) || 0;
  if (activeCount <= 0) return "No active incoming talk";
  if (activeCount === 1) return "1 active incoming talk";
  return `${activeCount} active incoming talks`;
}

function renderManagedAssignmentControls(port, direction, assignment) {
  const device = findDeviceByDirectionAndId(direction, assignment.deviceId);
  const labelPrefix = direction === "output" ? "Output" : "Input";
  return `
    <label class="managed-port-control managed-port-control--device">
      <span>${labelPrefix} device</span>
      <select data-managed-port-control data-field="${direction}Device">
        ${buildManagedDeviceOptions(direction, assignment.deviceId)}
      </select>
    </label>
    <label class="managed-port-control managed-port-control--channel">
      <span>${labelPrefix} channel</span>
      <select data-managed-port-control data-field="${direction}Channel">
        ${buildManagedChannelOptions(device, assignment.leftChannel, assignment.rightChannel)}
      </select>
    </label>
  `;
}

function getManagedPortElement(key) {
  return Array.from(bridgePorts.querySelectorAll("[data-managed-port-key]"))
    .find((element) => element.dataset.managedPortKey === key) || null;
}

function readManagedPortAssignmentFromElement(card, direction) {
  const deviceId = card.querySelector(`[data-field="${direction}Device"]`)?.value || "";
  const channelValue = card.querySelector(`[data-field="${direction}Channel"]`)?.value || "";
  const pair = parsePair(channelValue);
  return {
    deviceId,
    leftChannel: pair.left,
    rightChannel: pair.right,
  };
}

function updateManagedPortDraftFromElement(card) {
  const key = card?.dataset?.managedPortKey;
  if (!key) return;
  const port = (managedBridgeConfig?.ports || []).find((entry) => bridgePortKey(entry) === key);
  if (!port) return;
  const draft = {
    input: readManagedPortAssignmentFromElement(card, "input"),
    output: bridgePortHasOutput(port)
      ? readManagedPortAssignmentFromElement(card, "output")
      : null,
  };
  managedPortDrafts.set(key, draft);
  managedPortEditStates.set(key, { dirty: true });
}

function validateManagedPortAssignment(assignment, label) {
  if (!assignment.deviceId) {
    throw new Error(`${label} device is required`);
  }
  if (
    !Number.isInteger(assignment.leftChannel) ||
    !Number.isInteger(assignment.rightChannel) ||
    assignment.leftChannel < 1 ||
    assignment.rightChannel < 1
  ) {
    throw new Error(`${label} channel is required`);
  }
}

async function saveManagedBridgePort(key) {
  const port = (managedBridgeConfig?.ports || []).find((entry) => bridgePortKey(entry) === key);
  const bridgeId = managedBridgeConfig?.bridgeId || localStorage.getItem(STORAGE_KEYS.bridgeId) || "";
  const targetId = bridgePortTargetId(port);
  if (!port || !bridgeId || !Number.isFinite(targetId)) return;

  const card = getManagedPortElement(key);
  if (!card) return;
  updateManagedPortDraftFromElement(card);
  const draft = managedPortDrafts.get(key) || getManagedPortDraft(port);

  validateManagedPortAssignment(draft.input, "Input");
  if (bridgePortHasOutput(port)) {
    validateManagedPortAssignment(draft.output, "Output");
  }

  const payload = {
    enabled: true,
    inputDevice: draft.input.deviceId,
    inputLeftChannel: draft.input.leftChannel,
    inputRightChannel: draft.input.rightChannel,
  };
  if (bridgePortHasOutput(port)) {
    payload.outputDevice = draft.output.deviceId;
    payload.outputLeftChannel = draft.output.leftChannel;
    payload.outputRightChannel = draft.output.rightChannel;
  }

  managedPortEditStates.set(key, { saving: true });
  renderManagedBridgePorts();
  try {
    await suppressWindowFocusHide(500);
    const config = await bridgeApi(
      "PUT",
      `/api/v1/bridge/${encodeURIComponent(bridgeId)}/ports/${encodeURIComponent(port.kind)}/${encodeURIComponent(targetId)}`,
      payload
    );
    managedPortDrafts.delete(key);
    managedPortEditStates.delete(key);
    await reconcileManagedBridgeConfig(config);
  } catch (error) {
    managedPortEditStates.set(key, { error: String(error?.message || error) });
    renderManagedBridgePorts();
    throw error;
  }
}

function handleManagedPortControlChange(event) {
  const control = event.target;
  if (!(control instanceof HTMLSelectElement) || !control.matches("[data-managed-port-control]")) {
    return;
  }
  const card = control.closest("[data-managed-port-key]");
  if (!(card instanceof HTMLElement)) return;

  const field = control.dataset.field || "";
  if (field === "inputDevice" || field === "outputDevice") {
    const direction = field.startsWith("output") ? "output" : "input";
    const channelSelect = card.querySelector(`[data-field="${direction}Channel"]`);
    if (channelSelect instanceof HTMLSelectElement) {
      const device = findDeviceByDirectionAndId(direction, control.value);
      channelSelect.innerHTML = buildManagedChannelOptions(device, null, null);
      const firstRealOptionIndex = Array.from(channelSelect.options).findIndex((option) => option.value);
      if (firstRealOptionIndex >= 0) {
        channelSelect.selectedIndex = firstRealOptionIndex;
      }
    }
  }

  updateManagedPortDraftFromElement(card);
}

async function handleManagedPortSaveClick(event) {
  const button = event.target instanceof Element
    ? event.target.closest("[data-save-managed-port]")
    : null;
  if (!(button instanceof HTMLButtonElement)) return;
  const key = button.dataset.saveManagedPort || "";
  if (!key) return;
  try {
    await saveManagedBridgePort(key);
  } catch (error) {
    console.error("Failed to save managed bridge port", error);
  }
}

function renderManagedBridgePorts() {
  const configuredPorts = managedBridgeConfig?.ports ?? [];
  if (!configuredPorts.length) {
    const html = '<div class="empty-state">No enabled bridge endpoints are assigned to this bridge.</div>';
    if (html !== lastManagedBridgePortsHtml) {
      bridgePorts.innerHTML = html;
      lastManagedBridgePortsHtml = html;
    }
    requestBridgeWindowResize();
    return;
  }

  const html = configuredPorts.map((port) => {
    const key = bridgePortKey(port);
    const session = managedSessions.get(key);
    const addressedNow = Array.isArray(session?.addressedNow) ? session.addressedNow : [];
    const speakerNames = addressedNow
      .map((entry) => entry?.speakerName || entry?.name || null)
      .filter(Boolean);
    const hasOutput = bridgePortHasOutput(port);
    const state = getManagedSessionState(session, port);
    const draft = getManagedPortDraft(port);
    const editState = managedPortEditStates.get(key) || {};
    const saveLabel = editState.saving ? "Saving" : "Save";
    return `
      <article class="managed-port-card" data-managed-port-key="${escapeHtml(key)}">
      <div class="managed-port-title">
        <div>
          <strong>${escapeHtml(port.label)}</strong>
          <small>${escapeHtml(port.kind === "feed" ? "Feed" : "User")}</small>
        </div>
        <div class="managed-port-actions">
          <span class="managed-port-state ${escapeHtml(state.className)}">${escapeHtml(state.label)}</span>
          <button type="button" class="managed-port-save" data-save-managed-port="${escapeHtml(key)}"${editState.saving ? " disabled" : ""}>${escapeHtml(saveLabel)}</button>
        </div>
      </div>
      <div class="managed-port-routing-grid">
        ${renderManagedAssignmentControls(port, "input", draft.input)}
        ${hasOutput ? renderManagedAssignmentControls(port, "output", draft.output) : ""}
      </div>
      ${hasOutput ? `<small>${escapeHtml(formatActiveReturnPaths(session?.outputs?.size))}</small>` : ""}
      ${speakerNames.length ? `<small>From: ${escapeHtml(speakerNames.join(", "))}</small>` : ""}
      ${session?.error ? `<div class="managed-port-error">${escapeHtml(session.error)}</div>` : ""}
      ${editState.error ? `<div class="managed-port-error">${escapeHtml(editState.error)}</div>` : ""}
      </article>
    `;
  }).join("");

  if (html !== lastManagedBridgePortsHtml) {
    bridgePorts.innerHTML = html;
    lastManagedBridgePortsHtml = html;
  }
  requestBridgeWindowResize();
}

function buildProducerRtpParameters(transport) {
  return {
    payloadType: Number(transport.payloadType || 100),
    ssrc: Number(transport.ssrc || 11111111)
  };
}

function codecParametersToFmtp(parameters = {}) {
  return Object.entries(parameters)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(";");
}

async function startManagedConsumer(session, producerPayload) {
  if (!bridgePortHasOutput(session.port)) return;
  const producerId = String(producerPayload?.producerId || "");
  if (!producerId || session.outputs.has(producerId)) return;

  const streamId = `${session.port.id}:consumer:${producerId}`;
  const output = {
    producerId,
    streamId,
    consumerId: null,
    peerId: producerPayload.peerId || null,
    appData: producerPayload.appData || {},
    speakerUserId: producerPayload.speakerUserId ?? null,
    speakerName: producerPayload.speakerName || null
  };
  session.outputs.set(producerId, output);
  renderManagedBridgePorts();

  try {
    const reserved = await invoke("reserve_bridge_output", {
      request: {
        streamId,
        assignment: session.port.output
      }
    });
    const consumer = await bridgeApi("POST", managedSessionPath(session, "/consumers"), {
      producerId,
      port: reserved.port
    });
    output.consumerId = consumer.id;
    const codec = (consumer.rtpParameters?.codecs || []).find((entry) =>
      String(entry.mimeType || "").toLowerCase() === "audio/opus"
    ) || consumer.rtpParameters?.codecs?.[0];
    if (!codec) throw new Error("Server returned no audio codec for bridge consumer");
    await invoke("activate_bridge_output", {
      request: {
        streamId,
        payloadType: Number(codec.payloadType || 100),
        clockRate: Number(codec.clockRate || 48000),
        channels: Number(codec.channels || 2),
        fmtp: codecParametersToFmtp(codec.parameters)
      }
    });
    await bridgeApi(
      "POST",
      managedSessionPath(session, `/consumers/${encodeURIComponent(consumer.id)}/resume`),
      {}
    );
    await applyManagedOutputAudioState(session, output);
  } catch (error) {
    session.outputs.delete(producerId);
    await invoke("stop_bridge_output", { streamId }).catch(() => {});
    if (output.consumerId) {
      await bridgeApi(
        "DELETE",
        managedSessionPath(session, `/consumers/${encodeURIComponent(output.consumerId)}`)
      ).catch(() => {});
    }
    throw error;
  } finally {
    renderManagedBridgePorts();
  }
}

async function stopManagedConsumer(session, { producerId = null, consumerId = null } = {}) {
  const entry = [...session.outputs.values()].find((candidate) => (
    (producerId && String(candidate.producerId) === String(producerId))
    || (consumerId && String(candidate.consumerId) === String(consumerId))
  ));
  if (!entry) return;
  session.outputs.delete(entry.producerId);
  await invoke("stop_bridge_output", { streamId: entry.streamId }).catch(() => {});
  if (entry.consumerId) {
    await bridgeApi(
      "DELETE",
      managedSessionPath(session, `/consumers/${encodeURIComponent(entry.consumerId)}`)
    ).catch(() => {});
  }
  renderManagedBridgePorts();
}

async function applyManagedOutputAudioState(session, output) {
  if (!invoke || !output?.streamId) return;
  const state = getManagedOutputAudioState(session, output);
  output.volume = state.volume;
  output.muted = state.muted;
  await invoke("set_bridge_output_level", {
    request: {
      streamId: output.streamId,
      volume: state.volume,
      muted: state.muted
    }
  });
}

async function applyManagedTargetAudioState(session, targetState) {
  let matchedOutputs = 0;
  for (const output of session.outputs.values()) {
    if (!getManagedOutputTargetKeys(output).includes(targetState.key)) continue;
    matchedOutputs += 1;
    await applyManagedOutputAudioState(session, output);
  }
  return matchedOutputs;
}

function updateManagedTargetAudioState(session, payload) {
  if (!(session.targetAudioStates instanceof Map)) {
    session.targetAudioStates = new Map();
  }
  const state = normalizeManagedTargetAudioState(payload);
  if (!state) {
    throw new Error("target-not-available");
  }
  const previous = session.targetAudioStates.get(state.key) || {
    ...state,
    volume: MANAGED_DEFAULT_TARGET_VOLUME,
    muted: false
  };
  const action = String(payload.action || "").trim().toLowerCase();
  if (action === "volume-up" || action === "volume-down") {
    const requestedStep = Number(payload.step);
    const step = Math.max(0.01, Math.min(1, Number.isFinite(requestedStep) ? requestedStep : 0.1));
    const signedStep = action === "volume-up" ? step : -step;
    state.volume = Math.max(0, Math.min(1, previous.volume + signedStep));
    state.muted = previous.muted;
  } else if (action === "mute-toggle") {
    state.volume = previous.volume;
    state.muted = !previous.muted;
  } else {
    throw new Error("unsupported-action");
  }
  session.targetAudioStates.set(state.key, state);
  return state;
}

function resolveBridgeCommandTargets(session, payload) {
  const type = String(payload?.targetType || "").toLowerCase();
  if (type === "reply") {
    return session.replyTarget ? [session.replyTarget] : [];
  }
  if (!["user", "conference"].includes(type)) return [];
  const id = Number(payload?.targetId);
  return Number.isFinite(id) ? [{ type, id }] : [];
}

async function sendManagedCommandResult(session, payload, result) {
  await bridgeApi("POST", managedSessionPath(session, "/command-result"), {
    commandId: payload.commandId || null,
    action: payload.action || null,
    targetType: payload.targetType || null,
    targetId: payload.targetId ?? null,
    ...result
  });
}

async function applyManagedTalkState(session, { talking, targets, lockActive = false }) {
  if (session.port.kind === "feed") {
    throw new Error("Feed bridge ports do not support talk state");
  }
  if (talking) {
    await bridgeApi("POST", managedSessionPath(session, "/talk-state"), {
      talking: true,
      targets,
      lockActive
    });
    await bridgeApi(
      "POST",
      managedSessionPath(session, `/producers/${encodeURIComponent(session.producerId)}/resume`),
      {}
    );
  } else {
    await bridgeApi(
      "POST",
      managedSessionPath(session, `/producers/${encodeURIComponent(session.producerId)}/pause`),
      {}
    );
    await bridgeApi("POST", managedSessionPath(session, "/talk-state"), {
      talking: false,
      targets: [],
      lockActive: false
    });
  }
  session.talking = Boolean(talking);
  session.lockActive = Boolean(lockActive && talking);
  session.targets = talking ? targets : [];
  renderManagedBridgePorts();
}

async function handleManagedTalkCommand(session, payload) {
  try {
    if (session.port.kind === "feed") {
      await sendManagedCommandResult(session, payload, {
        ok: false,
        reason: "feed-bridge-port"
      }).catch(() => {});
      return;
    }
    if (payload.action === "release") {
      await applyManagedTalkState(session, { talking: false, targets: [] });
      await sendManagedCommandResult(session, payload, {
        ok: true,
        talking: false,
        lockActive: false
      });
      return;
    }

    const targets = resolveBridgeCommandTargets(session, payload);
    if (!targets.length) {
      await sendManagedCommandResult(session, payload, {
        ok: false,
        reason: "target-not-available"
      });
      return;
    }

    if (payload.action === "lock-toggle" && session.lockActive) {
      await applyManagedTalkState(session, { talking: false, targets: [] });
      await sendManagedCommandResult(session, payload, {
        ok: true,
        talking: false,
        lockActive: false
      });
      return;
    }

    if (payload.action === "press" || payload.action === "lock-toggle") {
      const lockActive = payload.action === "lock-toggle";
      await applyManagedTalkState(session, { talking: true, targets, lockActive });
      await sendManagedCommandResult(session, payload, {
        ok: true,
        talking: true,
        lockActive,
        target: targets[0],
        targets
      });
      return;
    }

    await sendManagedCommandResult(session, payload, {
      ok: false,
      reason: "unsupported-action"
    });
  } catch (error) {
    await sendManagedCommandResult(session, payload, {
      ok: false,
      reason: String(error.message || error)
    }).catch(() => {});
    throw error;
  }
}

async function handleManagedEvent(session, event) {
  const payload = event?.payload || {};
  switch (event?.event) {
    case "new-producer":
      await startManagedConsumer(session, payload);
      break;
    case "producer-closed":
      await stopManagedConsumer(session, { producerId: payload.producerId });
      break;
    case "consumer-closed":
      await stopManagedConsumer(session, {
        producerId: payload.producerId,
        consumerId: payload.consumerId
      });
      break;
    case "incoming-talk-state":
      session.replyTarget = payload.state?.replyTarget || null;
      session.addressedNow = payload.state?.addressedNow || [];
      break;
    case "api-talk-command":
      await handleManagedTalkCommand(session, payload);
      break;
    case "api-target-audio-command":
      if (session.port.kind === "feed") {
        await sendManagedCommandResult(session, payload, {
          ok: false,
          reason: "feed-bridge-port"
        });
        break;
      }
      try {
        const targetState = updateManagedTargetAudioState(session, payload);
        const matchedOutputs = await applyManagedTargetAudioState(session, targetState);
        await sendManagedCommandResult(session, payload, {
          ok: true,
          muted: targetState.muted,
          volume: targetState.volume,
          matchedOutputs
        });
        renderManagedBridgePorts();
      } catch (error) {
        await sendManagedCommandResult(session, payload, {
          ok: false,
          reason: String(error.message || error)
        });
      }
      break;
    case "session-kicked":
      throw new Error(payload.reason || "Bridge session was replaced");
    default:
      break;
  }
}

function enqueueManagedEvent(session, event) {
  session.eventQueue = (session.eventQueue || Promise.resolve())
    .then(() => handleManagedEvent(session, event))
    .catch((error) => {
      setManagedSessionError(session, error);
      if (event?.event === "session-kicked") {
        session.ready = false;
      }
      renderManagedBridgePorts();
    });
  return session.eventQueue;
}

function handleNativeBridgeEventStreamMessage(message) {
  const payload = message?.payload || {};
  const session = nativeEventStreamSessions.get(payload.streamId);
  if (!session) return;

  if (payload.event === "open") {
    session.eventStreamActive = true;
    session.error = null;
    renderManagedBridgePorts();
    return;
  }

  if (payload.event === "bridge-event") {
    try {
      const event = JSON.parse(payload.data || "{}");
      enqueueManagedEvent(session, event);
    } catch (error) {
      session.error = `Failed to parse bridge event: ${String(error.message || error)}`;
      renderManagedBridgePorts();
    }
    return;
  }

  if (payload.event === "session-closed") {
    nativeEventStreamSessions.delete(payload.streamId);
    session.eventStreamId = null;
    session.eventStreamActive = false;
    if (session.ready) {
      let reason = "Bridge session closed";
      try {
        const data = JSON.parse(payload.data || "{}");
        reason = data.reason || reason;
      } catch {}
      setManagedSessionError(session, new Error(reason));
      session.ready = false;
      renderManagedBridgePorts();
    }
    return;
  }

  if (payload.event === "error") {
    session.eventStreamActive = false;
    setManagedSessionError(session, payload.error || "Bridge event stream failed");
    renderManagedBridgePorts();
    return;
  }

  if (payload.event === "closed") {
    nativeEventStreamSessions.delete(payload.streamId);
    session.eventStreamId = null;
    session.eventStreamActive = false;
    renderManagedBridgePorts();
  }
}

function ensureNativeBridgeEventListener() {
  if (!listen) return Promise.resolve(false);
  if (!bridgeEventStreamListenerPromise) {
    bridgeEventStreamListenerPromise = listen(
      "bridge-event-stream-message",
      handleNativeBridgeEventStreamMessage
    )
      .then(() => true)
      .catch(() => false);
  }
  return bridgeEventStreamListenerPromise;
}

async function startNativeManagedEventStream(session) {
  if (!invoke || !listen || !session?.sessionId || !getBridgeCredential()) {
    return false;
  }
  const listenerReady = await ensureNativeBridgeEventListener();
  if (!listenerReady) return false;

  const streamId = `${session.port.id}:events:${session.sessionId}`;
  session.eventStreamId = streamId;
  nativeEventStreamSessions.set(streamId, session);
  await invoke("start_bridge_event_stream", {
    request: {
      streamId,
      serverUrl: normalizeServerUrl(serverUrlInput.value),
      apiKey: getBridgeCredential(),
      path: managedSessionPath(session, "/events/stream")
    }
  });
  return true;
}

function stopManagedEventStream(session) {
  if (session?.eventStreamId) {
    const streamId = session.eventStreamId;
    nativeEventStreamSessions.delete(streamId);
    invoke?.("stop_bridge_event_stream", { streamId }).catch(() => {});
    session.eventStreamId = null;
  }
  if (session?.eventSource) {
    session.eventSource.close();
    session.eventSource = null;
  }
  if (session) {
    session.eventStreamActive = false;
  }
}

async function startManagedEventStream(session) {
  stopManagedEventStream(session);
  try {
    if (await startNativeManagedEventStream(session)) {
      return true;
    }
  } catch (error) {
    if (session.eventStreamId) {
      nativeEventStreamSessions.delete(session.eventStreamId);
      session.eventStreamId = null;
    }
    setManagedSessionError(session, error);
  }

  if (!window.EventSource || !session?.sessionId || !getBridgeCredential()) {
    return false;
  }

  const source = new EventSource(managedSessionEventStreamUrl(session));
  session.eventSource = source;
  session.eventStreamActive = false;

  source.addEventListener("open", () => {
    if (session.eventSource !== source) return;
    session.eventStreamActive = true;
    session.error = null;
    renderManagedBridgePorts();
  });

  source.addEventListener("bridge-event", (message) => {
    if (session.eventSource !== source) return;
    try {
      const event = JSON.parse(message.data || "{}");
      enqueueManagedEvent(session, event);
    } catch (error) {
      session.error = `Failed to parse bridge event: ${String(error.message || error)}`;
      renderManagedBridgePorts();
    }
  });

  source.addEventListener("session-closed", (message) => {
    if (session.eventSource !== source) return;
    source.close();
    session.eventSource = null;
    session.eventStreamActive = false;
    if (session.ready) {
      try {
        const payload = JSON.parse(message.data || "{}");
        session.error = payload.reason || "Bridge session closed";
      } catch {
        session.error = "Bridge session closed";
      }
      session.ready = false;
      renderManagedBridgePorts();
    }
  });

  source.addEventListener("error", () => {
    if (session.eventSource !== source) return;
    session.eventStreamActive = false;
    renderManagedBridgePorts();
  });

  return true;
}

async function pollManagedEvents() {
  if (managedEventPollRunning || !managedSessions.size) return;
  managedEventPollRunning = true;
  try {
    for (const session of managedSessions.values()) {
      if (!session.ready || session.eventStreamActive) continue;
      try {
        const response = await bridgeApi("GET", managedSessionPath(session, "/events"));
        for (const event of response.events || []) {
          await enqueueManagedEvent(session, event);
        }
        if (session.ready) {
          session.error = null;
        }
      } catch (error) {
        session.ready = false;
        setManagedSessionError(session, error);
      }
    }
  } finally {
    managedEventPollRunning = false;
    renderManagedBridgePorts();
  }
}

async function heartbeatManagedSessions() {
  const sessions = [...managedSessions.values()].filter((session) => (
    session.sessionId
    && !session.starting
    && (session.ready || session.eventStreamActive)
  ));
  if (!sessions.length) return;

  for (const session of sessions) {
    try {
      await bridgeApi("POST", managedSessionPath(session, "/heartbeat"), {});
      if (session.error && session.statusLabel === "Server offline") {
        session.error = null;
        session.statusLabel = null;
      }
    } catch (error) {
      if (!session.sessionId) continue;
      if (String(error?.message || error || "").toLowerCase().includes("bridge session not found")) {
        await stopManagedSession(session, { remove: false });
      } else {
        session.ready = false;
      }
      setManagedSessionError(session, error);
    }
  }
}

function createManagedSession(port) {
  const key = bridgePortKey(port);
  return {
    port,
    signature: bridgePortSignature(port),
    sessionId: null,
    producerId: null,
    inputStreamId: `${port.id}:input`,
    outputs: new Map(),
    ready: false,
    talking: false,
    lockActive: false,
    targets: [],
    replyTarget: null,
    addressedNow: [],
    targetAudioStates: new Map(),
    eventStreamId: null,
    eventSource: null,
    eventStreamActive: false,
    eventQueue: Promise.resolve(),
    retryAt: null,
    retryable: true,
    statusLabel: null,
    starting: false,
    backgroundRetry: false,
    error: null
  };
}

async function startManagedSession(port, { reuse = false, silentRetry = false } = {}) {
  const key = bridgePortKey(port);
  const existingSession = managedSessions.get(key);
  const session = reuse && existingSession ? existingSession : createManagedSession(port);
  const backgroundRetry = Boolean(silentRetry && reuse && existingSession && existingSession.error && !existingSession.ready);
  if (existingSession && existingSession !== session) {
    await stopManagedSession(existingSession);
  }
  if (session.sessionId || session.ready || session.outputs?.size) {
    await stopManagedSession(session, { remove: false });
  }
  session.port = port;
  session.signature = bridgePortSignature(port);
  session.inputStreamId = `${port.id}:input`;
  session.outputs = session.outputs instanceof Map ? session.outputs : new Map();
  session.ready = false;
  session.starting = true;
  session.backgroundRetry = backgroundRetry;
  if (!backgroundRetry) {
    session.error = null;
    session.statusLabel = "Connecting";
  }
  session.retryAt = null;
  session.retryable = true;
  managedSessions.set(key, session);
  if (!backgroundRetry) {
    renderManagedBridgePorts();
  }

  try {
    validateManagedPortInventory(port);
    const registered = await bridgeApi("POST", "/api/v1/bridge/sessions", {
      bridgeId: managedBridgeConfig.bridgeId,
      portId: port.id,
      userId: port.kind === "feed" ? null : port.userId,
      feedId: port.kind === "feed" ? port.feedId : null
    });
    session.sessionId = registered.sessionId;
    const transport = await bridgeApi(
      "POST",
      managedSessionPath(session, "/plain-send-transport"),
      {}
    );
    const rtp = buildProducerRtpParameters(transport);
    await invoke("start_bridge_input", {
      request: {
        streamId: session.inputStreamId,
        assignment: port.input,
        rtpIp: transport.ip,
        rtpPort: Number(transport.port),
        payloadType: rtp.payloadType,
        ssrc: rtp.ssrc
      }
    });
    const producer = await bridgeApi("POST", managedSessionPath(session, "/producers"), rtp);
    session.producerId = producer.id;
    session.ready = true;
    await startManagedEventStream(session);
    if (bridgePortHasOutput(port)) {
      const active = await bridgeApi("GET", managedSessionPath(session, "/active-producers"));
      for (const producerPayload of active.producers || []) {
        await startManagedConsumer(session, producerPayload);
      }
    }
    session.retryAt = null;
    session.retryable = true;
    session.error = null;
    session.statusLabel = null;
  } catch (error) {
    await stopManagedSession(session, { remove: false });
    setManagedSessionError(session, error);
  } finally {
    session.starting = false;
    session.backgroundRetry = false;
    renderManagedBridgePorts();
  }
}

async function stopManagedSession(session, { remove = true } = {}) {
  stopManagedEventStream(session);
  for (const output of [...session.outputs.values()]) {
    await stopManagedConsumer(session, output).catch(() => {});
  }
  await invoke("stop_bridge_input", { streamId: session.inputStreamId }).catch(() => {});
  if (session.sessionId) {
    await bridgeApi("DELETE", managedSessionPath(session)).catch(() => {});
  }
  session.sessionId = null;
  session.producerId = null;
  session.outputs.clear();
  session.talking = false;
  session.lockActive = false;
  session.targets = [];
  session.replyTarget = null;
  session.addressedNow = [];
  session.ready = false;
  session.starting = false;
  session.backgroundRetry = false;
  if (remove) managedSessions.delete(bridgePortKey(session.port));
}

async function reconcileManagedBridgeConfig(config) {
  managedBridgeConfig = config;
  const wanted = new Map((config?.ports || []).map((port) => [bridgePortKey(port), port]));

  for (const [key, session] of [...managedSessions.entries()]) {
    const nextPort = wanted.get(key);
    if (!nextPort || bridgePortSignature(nextPort) !== session.signature) {
      await stopManagedSession(session);
    }
  }
  for (const [key, port] of wanted) {
    const session = managedSessions.get(key);
    if (!session) {
      await startManagedSession(port);
    } else if (!session.ready && !session.starting && session.retryable !== false && (!session.retryAt || session.retryAt <= Date.now())) {
      await startManagedSession(port, { reuse: true, silentRetry: true });
    }
  }
  renderManagedBridgePorts();
}

async function refreshManagedInventoryOnly() {
  if (!invoke) return;
  await suppressWindowFocusHide(250);
  const inventory = await invoke("list_audio_devices");
  renderInventory(inventory);
  return inventory;
}

async function retryDueManagedSessions() {
  if (managedRetryRunning || !managedBridgeConfig?.ports?.length) {
    renderManagedBridgePorts();
    return;
  }
  await auditManagedNativeMediaStatus().catch(() => {});
  const now = Date.now();
  const due = [...managedSessions.values()].filter((session) => (
    !session.ready
    && !session.starting
    && session.retryable !== false
    && session.retryAt
    && session.retryAt <= now
  ));
  if (!due.length) {
    renderManagedBridgePorts();
    return;
  }

  managedRetryRunning = true;
  try {
    await refreshManagedInventoryOnly().catch(() => {});
    const portsByKey = new Map((managedBridgeConfig?.ports || []).map((port) => [bridgePortKey(port), port]));
    for (const session of due) {
      const port = portsByKey.get(bridgePortKey(session.port));
      if (!port || bridgePortSignature(port) !== session.signature) continue;
      await startManagedSession(port, { reuse: true, silentRetry: true });
    }
  } finally {
    managedRetryRunning = false;
    renderManagedBridgePorts();
  }
}

async function syncManagedBridge() {
  if (managedSyncRunning) return;
  const bridgeId = localStorage.getItem(STORAGE_KEYS.bridgeId) || "";
  if (!bridgeId || !serverUrlInput.value.trim() || !getBridgeCredential()) return;
  managedSyncRunning = true;
  try {
    await refreshManagedInventoryOnly().catch(() => {});
    await announceBridge({ quiet: true, syncConfig: false });
    await auditManagedSessionDevices();
    await auditManagedNativeMediaStatus();
    const config = await bridgeApi(
      "GET",
      `/api/v1/bridge/${encodeURIComponent(bridgeId)}/config`
    );
    await reconcileManagedBridgeConfig(config);
    await heartbeatManagedSessions();
    if (connectionStatus) {
      connectionStatus.textContent = managedSessions.size ? "Connected" : "Announced";
    }
  } catch (error) {
    if (connectionStatus) {
      connectionStatus.textContent = "Disconnected";
    }
    setServerConnectionState("disconnected");
    for (const session of managedSessions.values()) {
      if (session.retryable === false) continue;
      setManagedSessionError(session, error);
    }
    renderManagedBridgePorts();
  } finally {
    managedSyncRunning = false;
  }
}

async function watchManagedInventory() {
  if (managedInventoryWatchRunning || managedSyncRunning || !invoke) return;
  if (!serverUrlInput.value.trim() || !getBridgeCredential()) return;

  managedInventoryWatchRunning = true;
  try {
    const inventory = await refreshManagedInventoryOnly();
    const nextSignature = inventorySignature(inventory);
    if (nextSignature && nextSignature !== lastAnnouncedInventorySignature) {
      await suppressWindowFocusHide(900);
      await announceBridge({ quiet: true, syncConfig: false });
    }
    await auditManagedSessionDevices();
    await auditManagedNativeMediaStatus();
    renderManagedBridgePorts();
  } catch (error) {
    console.warn("managed inventory watch failed", error);
  } finally {
    managedInventoryWatchRunning = false;
  }
}

function startManagedTimers() {
  if (!managedHeartbeatTimer) {
    managedHeartbeatTimer = window.setInterval(syncManagedBridge, 10_000);
  }
  if (!managedInventoryTimer) {
    managedInventoryTimer = window.setInterval(watchManagedInventory, MANAGED_INVENTORY_WATCH_MS);
  }
  if (!managedEventTimer) {
    managedEventTimer = window.setInterval(pollManagedEvents, MANAGED_EVENT_FALLBACK_POLL_MS);
    pollManagedEvents();
  }
  if (!managedRetryTimer) {
    managedRetryTimer = window.setInterval(retryDueManagedSessions, 1_000);
  }
}

function devicesByDirection(direction) {
  return (currentInventory?.devices ?? []).filter((device) => device.direction === direction);
}

function findDeviceById(deviceId) {
  return (currentInventory?.devices ?? []).find((device) => device.id === deviceId);
}

function buildChannelOptions(device) {
  const maxChannels = Number(device?.max_channels ?? device?.maxChannels ?? 0);
  const options = [];
  const seen = new Set();
  const addOption = (left, right, label = null) => {
    const normalizedLeft = Number(left);
    const normalizedRight = Number(right);
    if (!Number.isInteger(normalizedLeft) || !Number.isInteger(normalizedRight)) return;
    if (normalizedLeft < 1 || normalizedRight < 1) return;
    const key = `${normalizedLeft}:${normalizedRight}`;
    if (seen.has(key)) return;
    seen.add(key);
    options.push({
      value: key,
      label: label || formatChannelSelection(normalizedLeft, normalizedRight),
    });
  };

  (device?.channel_pairs ?? device?.channelPairs ?? []).forEach((pair) => {
    addOption(pair.left_channel ?? pair.leftChannel, pair.right_channel ?? pair.rightChannel, pair.label);
  });

  if (Number.isInteger(maxChannels) && maxChannels > 0) {
    for (let channel = 1; channel <= maxChannels; channel += 1) {
      addOption(channel, channel);
    }
    for (let left = 1; left < maxChannels; left += 2) {
      addOption(left, left + 1);
    }
  }

  return options;
}

function renderSummary(inventory) {
  if (!deviceSummary) return;

  const inputCount = inventory.devices.filter((device) => device.direction === "input").length;
  const outputCount = inventory.devices.filter((device) => device.direction === "output").length;
  const maxInputChannels = Math.max(0, ...inventory.devices
    .filter((device) => device.direction === "input")
    .map((device) => device.max_channels || 0));
  const maxOutputChannels = Math.max(0, ...inventory.devices
    .filter((device) => device.direction === "output")
    .map((device) => device.max_channels || 0));

  deviceSummary.innerHTML = "";
  [
    ["Host", inventory.host],
    ["Inputs", String(inputCount)],
    ["Outputs", String(outputCount)],
    ["Max input channels", String(maxInputChannels)],
    ["Max output channels", String(maxOutputChannels)]
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "summary-card";
    item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`;
    deviceSummary.appendChild(item);
  });
}

function renderConfigRange(config) {
  const sampleRates = config.min_sample_rate === config.max_sample_rate
    ? `${config.max_sample_rate} Hz`
    : `${config.min_sample_rate}-${config.max_sample_rate} Hz`;
  const buffer = config.min_buffer_size && config.max_buffer_size
    ? `, buffer ${config.min_buffer_size}-${config.max_buffer_size}`
    : "";
  return `${config.channels} ch, ${sampleRates}, ${config.sample_format}${buffer}`;
}

function renderDevice(device) {
  const article = document.createElement("article");
  article.className = "device-card";

  const channelOptions = buildChannelOptions(device);
  const pairs = channelOptions.length
    ? channelOptions.map((option) => `<span>${escapeHtml(option.label)}</span>`).join("")
    : "<span>no channel options</span>";

  const configs = device.supported_configs.length
    ? device.supported_configs.slice(0, 8).map((config) => `<li>${escapeHtml(renderConfigRange(config))}</li>`).join("")
    : `<li class="muted">No supported ${device.direction} configs reported</li>`;

  article.innerHTML = `
    <div class="device-card__title">
      <div>
        <span class="device-direction">${escapeHtml(device.direction)}</span>
        <h3>${escapeHtml(device.name)}</h3>
      </div>
      ${device.is_default ? '<span class="default-badge">default</span>' : ""}
    </div>
    <div class="device-meta">
      <span>${device.max_channels} max channels</span>
      <span>${device.supports_48k ? "48 kHz available" : "Resampling required"}</span>
    </div>
    <div class="channel-pairs">${pairs}</div>
    <details>
      <summary>Supported configs (${device.supported_configs.length})</summary>
      <ul>${configs}</ul>
    </details>
  `;

  return article;
}

function renderBridgeTarget(target) {
  if (!target) {
    return "Unassigned";
  }
  return `${target.type}: ${target.name ?? target.id}`;
}

function renderChannelAssignment(assignment) {
  if (!assignment) {
    return "Not assigned";
  }
  return `${assignment.device_name} ${formatChannelSelection(assignment.left_channel, assignment.right_channel)}`;
}

function renderBridgeStatus(status) {
  if (!managedBridgeConfig) {
    if (connectionStatus) {
      connectionStatus.textContent = status.connected ? "Connected" : "Local probe";
    }
  }
  renderManagedBridgePorts();
}

function renderInventory(inventory) {
  currentInventory = inventory;
  renderSummary(inventory);
  if (!deviceList) {
    renderAllPortControls();
    return;
  }
  deviceList.innerHTML = "";

  if (!inventory.devices.length) {
    deviceList.innerHTML = '<div class="empty-state">No audio devices were reported by the native backend.</div>';
    renderAllPortControls();
    return;
  }

  inventory.devices.forEach((device) => {
    deviceList.appendChild(renderDevice(device));
  });
  renderAllPortControls();
}

async function announceBridge({ quiet = false, syncConfig = true } = {}) {
  const serverUrl = normalizeServerUrl(serverUrlInput.value);
  const apiKey = apiKeyInput.value.trim();
  const bridgeToken = localStorage.getItem(STORAGE_KEYS.bridgeToken) || "";
  const credential = bridgeToken || apiKey;
  const bridgeName = bridgeNameInput.value.trim() || "Bridge";
  if (!credential) {
    throw new Error("API key or bridge token is required");
  }

  saveBridgeSettings();
  announceBridgeButton.disabled = true;
  if (!quiet) setServerConnectionState("connecting");

  try {
    const bridgeId = localStorage.getItem(STORAGE_KEYS.bridgeId) || "";
    const sendAnnounce = async (authToken) => {
      if (invoke) {
        await suppressWindowFocusHide(250);
        return invoke("announce_bridge", {
          serverUrl,
          apiKey: authToken,
          bridgeId: bridgeId || null,
          bridgeName
        });
      }

      if (!currentInventory) {
        throw new Error("Refresh audio devices before saving.");
      }

      const response = await fetch(`${serverUrl}/api/v1/bridge/announce`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${authToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          bridgeId,
          bridgeName,
          platform: getBridgeClientPlatform(),
          inventory: currentInventory
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Save failed (${response.status})`);
      }
      return payload;
    };

    let announceResponse;
    try {
      announceResponse = await sendAnnounce(credential);
    } catch (error) {
      if (!bridgeToken || !apiKey || credential === apiKey || !/auth|access|forbidden|required|401|403/i.test(String(error.message || error))) {
        throw error;
      }
      announceResponse = await sendAnnounce(apiKey);
    }
    const announcedBridge = announceResponse?.bridge || announceResponse || {};
    if (announceResponse?.bridgeToken) {
      localStorage.setItem(STORAGE_KEYS.bridgeToken, announceResponse.bridgeToken);
    }

    if (announcedBridge.id) {
      localStorage.setItem(STORAGE_KEYS.bridgeId, announcedBridge.id);
    }
    lastAnnouncedInventorySignature = inventorySignature(currentInventory);
    if (connectionStatus) {
      connectionStatus.textContent = "Announced";
    }
    setServerConnectionState("connected");
    if (syncConfig && announcedBridge.id) {
      const config = await bridgeApi(
        "GET",
        `/api/v1/bridge/${encodeURIComponent(announcedBridge.id)}/config`
      );
      await reconcileManagedBridgeConfig(config);
      startManagedTimers();
      if (connectionStatus) {
        connectionStatus.textContent = managedSessions.size ? "Connected" : "Announced";
      }
    }
  } finally {
    announceBridgeButton.disabled = false;
  }
}

async function announceBridgeFromButton() {
  try {
    await announceBridge();
  } catch (error) {
    console.error(error);
    if (connectionStatus) {
      connectionStatus.textContent = "Save failed";
    }
    setServerConnectionState("disconnected");
  }
}

function populateDeviceSelect(select, direction, preferredValue) {
  const devices = devicesByDirection(direction);
  select.innerHTML = "";

  devices.forEach((device) => {
    const option = document.createElement("option");
    option.value = device.id;
    option.textContent = device.name;
    select.appendChild(option);
  });

  if (devices.some((device) => device.id === preferredValue)) {
    select.value = preferredValue;
  } else {
    const defaultDevice = devices.find((device) => device.is_default) ?? devices[0];
    select.value = defaultDevice?.id ?? "";
  }
}

function populatePairSelect(deviceId, select, preferredValue) {
  const device = findDeviceById(deviceId);
  select.innerHTML = "";

  buildChannelOptions(device).forEach((pair) => {
    const option = document.createElement("option");
    option.value = pair.value;
    option.textContent = pair.label;
    select.appendChild(option);
  });

  if ([...select.options].some((option) => option.value === preferredValue)) {
    select.value = preferredValue;
  }
}

function parsePair(value) {
  const [left, right] = value.split(":").map((part) => Number.parseInt(part, 10));
  return { left, right };
}

function formatChannelSelection(left, right) {
  const normalizedLeft = Number(left);
  const normalizedRight = Number(right);
  if (!Number.isFinite(normalizedLeft) || !Number.isFinite(normalizedRight)) return "";
  return normalizedLeft === normalizedRight
    ? String(normalizedLeft)
    : `${normalizedLeft}/${normalizedRight}`;
}

function formatDb(value) {
  if (!Number.isFinite(value) || value <= -119.9) {
    return "-120.0 dBFS";
  }
  return `${value.toFixed(1)} dBFS`;
}

function meterPercent(db) {
  if (!Number.isFinite(db)) {
    return 0;
  }
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

function createPortRow() {
  const number = nextPortNumber;
  nextPortNumber += 1;

  return {
    id: `local-port-${number}`,
    label: `Port ${number}`,
    inputDeviceId: "",
    inputPair: "",
    outputDeviceId: "",
    outputPair: "",
    gain: 0.5,
    running: false,
    element: null,
    refs: null
  };
}

function addPort() {
  if (!localPortList) return;
  const row = createPortRow();
  portRows.push(row);
  renderPortRow(row);
  renderAllPortControls();
}

async function removePort(row) {
  if (row.running) {
    await stopPort(row);
  }
  row.element?.remove();
  portRows = portRows.filter((candidate) => candidate !== row);
}

function renderPortRow(row) {
  const article = document.createElement("article");
  article.className = "local-port-card";
  article.dataset.portId = row.id;
  article.innerHTML = `
    <div class="local-port-header">
      <div class="local-port-title">
        <input class="port-label-input" type="text" value="${escapeHtml(row.label)}" />
      </div>
      <div class="button-row">
        <button class="port-start" type="button">Start</button>
        <button class="port-stop" type="button" disabled>Stop</button>
        <button class="port-remove" type="button">Remove</button>
      </div>
    </div>

    <div class="probe-grid">
      <label>
        <span>Input device</span>
        <select class="port-input-device"></select>
      </label>
      <label>
        <span>Input channel</span>
        <select class="port-input-pair"></select>
      </label>
      <label>
        <span>Output device</span>
        <select class="port-output-device"></select>
      </label>
      <label>
        <span>Output channel</span>
        <select class="port-output-pair"></select>
      </label>
    </div>

    <div class="probe-options">
      <div></div>
      <label class="gain-row">
        <span>Gain</span>
        <input class="port-gain" type="range" min="0" max="2" step="0.05" value="${row.gain}" />
        <strong class="port-gain-value">${row.gain.toFixed(2)}x</strong>
      </label>
    </div>

    <div class="level-grid">
      <div class="meter-card">
        <div class="meter-label">
          <span>Left RMS</span>
          <strong class="port-left-db">-120.0 dBFS</strong>
        </div>
        <div class="meter"><div class="port-left-meter"></div></div>
      </div>
      <div class="meter-card">
        <div class="meter-label">
          <span>Right RMS</span>
          <strong class="port-right-db">-120.0 dBFS</strong>
        </div>
        <div class="meter"><div class="port-right-meter"></div></div>
      </div>
    </div>

    <div class="probe-status port-status">Stopped</div>
  `;

  row.element = article;
  row.refs = {
    label: article.querySelector(".port-label-input"),
    inputDevice: article.querySelector(".port-input-device"),
    inputPair: article.querySelector(".port-input-pair"),
    outputDevice: article.querySelector(".port-output-device"),
    outputPair: article.querySelector(".port-output-pair"),
    gain: article.querySelector(".port-gain"),
    gainValue: article.querySelector(".port-gain-value"),
    start: article.querySelector(".port-start"),
    stop: article.querySelector(".port-stop"),
    remove: article.querySelector(".port-remove"),
    leftDb: article.querySelector(".port-left-db"),
    rightDb: article.querySelector(".port-right-db"),
    leftMeter: article.querySelector(".port-left-meter"),
    rightMeter: article.querySelector(".port-right-meter"),
    status: article.querySelector(".port-status")
  };

  row.refs.label.addEventListener("input", () => {
    row.label = row.refs.label.value.trim() || row.id;
  });
  row.refs.inputDevice.addEventListener("change", () => {
    row.inputDeviceId = row.refs.inputDevice.value;
    populatePairSelect(row.inputDeviceId, row.refs.inputPair, row.inputPair);
    row.inputPair = row.refs.inputPair.value;
    updatePortControlState(row);
  });
  row.refs.outputDevice.addEventListener("change", () => {
    row.outputDeviceId = row.refs.outputDevice.value;
    populatePairSelect(row.outputDeviceId, row.refs.outputPair, row.outputPair);
    row.outputPair = row.refs.outputPair.value;
    updatePortControlState(row);
  });
  row.refs.inputPair.addEventListener("change", () => {
    row.inputPair = row.refs.inputPair.value;
    updatePortControlState(row);
  });
  row.refs.outputPair.addEventListener("change", () => {
    row.outputPair = row.refs.outputPair.value;
    updatePortControlState(row);
  });
  row.refs.gain.addEventListener("input", () => {
    row.gain = Number.parseFloat(row.refs.gain.value);
    row.refs.gainValue.textContent = `${row.gain.toFixed(2)}x`;
  });
  row.refs.start.addEventListener("click", () => startPort(row));
  row.refs.stop.addEventListener("click", () => stopPort(row));
  row.refs.remove.addEventListener("click", () => removePort(row));

  localPortList.appendChild(article);
  populatePortControls(row);
}

function populatePortControls(row) {
  if (!row.refs) {
    return;
  }

  populateDeviceSelect(row.refs.inputDevice, "input", row.inputDeviceId);
  row.inputDeviceId = row.refs.inputDevice.value;
  populatePairSelect(row.inputDeviceId, row.refs.inputPair, row.inputPair);
  row.inputPair = row.refs.inputPair.value;

  populateDeviceSelect(row.refs.outputDevice, "output", row.outputDeviceId);
  row.outputDeviceId = row.refs.outputDevice.value;
  populatePairSelect(row.outputDeviceId, row.refs.outputPair, row.outputPair);
  row.outputPair = row.refs.outputPair.value;

  updatePortControlState(row);
}

function renderAllPortControls() {
  if (!localPortList) return;

  if (!portRows.length) {
    addPort();
    return;
  }

  portRows.forEach((row) => populatePortControls(row));
}

function updatePortControlState(row) {
  if (!row.refs) {
    return;
  }

  const hasInput = Boolean(row.inputDeviceId && row.inputPair);
  const hasOutput = Boolean(row.outputDeviceId && row.outputPair);
  row.refs.start.disabled = row.running || !hasInput || !hasOutput;
  row.refs.stop.disabled = !row.running;
  row.refs.remove.disabled = row.running;
  row.refs.label.disabled = row.running;
  row.refs.inputDevice.disabled = row.running;
  row.refs.inputPair.disabled = row.running;
  row.refs.outputDevice.disabled = row.running;
  row.refs.outputPair.disabled = row.running;
  row.refs.gain.disabled = row.running;
}

function renderStoppedPort(row) {
  row.running = false;
  updatePortControlState(row);
  row.refs.leftDb.textContent = "-120.0 dBFS";
  row.refs.rightDb.textContent = "-120.0 dBFS";
  row.refs.leftMeter.style.width = "0%";
  row.refs.rightMeter.style.width = "0%";
  row.refs.status.textContent = "Stopped";
}

function renderRunningPort(row, status) {
  row.running = true;
  updatePortControlState(row);
  row.refs.leftDb.textContent = formatDb(status.rms_left_db);
  row.refs.rightDb.textContent = formatDb(status.rms_right_db);
  row.refs.leftMeter.style.width = `${meterPercent(status.rms_left_db)}%`;
  row.refs.rightMeter.style.width = `${meterPercent(status.rms_right_db)}%`;

  const inputConfig = status.input_config
    ? `${status.input_config.channels} ch ${status.input_config.sample_rate} Hz ${status.input_config.sample_format}`
    : "no input config";
  const outputConfig = status.output_config
    ? `${status.output_config.channels} ch ${status.output_config.sample_rate} Hz ${status.output_config.sample_format}`
    : "no output stream";
  const error = status.last_error ? `, error: ${status.last_error}` : "";
  row.refs.status.textContent = [
    `Input: ${status.input_device_name ?? "unknown"} (${inputConfig})`,
    `Output: ${status.output_device_name ?? "unknown"} (${outputConfig})`,
    `queued ${status.queued_frames} frames, underruns ${status.underruns}, callbacks in/out ${status.input_callbacks}/${status.output_callbacks}, frames ${status.frames_seen}${error}`
  ].join("\n");
}

function renderPortStatuses(statuses) {
  if (!localPortList) return;

  const statusById = new Map(statuses.map((status) => [status.port_id, status]));
  portRows.forEach((row) => {
    const status = statusById.get(row.id);
    if (status?.running) {
      renderRunningPort(row, status);
    } else if (row.running) {
      renderStoppedPort(row);
    }
  });

  const anyRunning = statuses.some((status) => status.running);
  if (stopAllPortsButton) {
    stopAllPortsButton.disabled = !anyRunning;
  }
  if (anyRunning) {
    startStatusPolling();
  } else {
    stopStatusPolling();
  }
}

async function refreshPortStatuses() {
  if (!invoke) {
    return;
  }

  try {
    const statuses = await invoke("get_audio_probe_ports_status");
    renderPortStatuses(statuses);
  } catch (error) {
    portRows.forEach((row) => {
      row.refs.status.textContent = `Status failed: ${String(error)}`;
    });
  }
}

function startStatusPolling() {
  if (!statusPollTimer) {
    statusPollTimer = window.setInterval(refreshPortStatuses, 120);
  }
}

function stopStatusPolling() {
  if (statusPollTimer) {
    window.clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
}

async function startPort(row) {
  if (!invoke) {
    return;
  }

  const inputPair = parsePair(row.inputPair);
  const outputPair = parsePair(row.outputPair);
  const request = {
    port_id: row.id,
    label: row.label,
    input_device_id: row.inputDeviceId,
    input_left_channel: inputPair.left,
    input_right_channel: inputPair.right,
    output_device_id: row.outputDeviceId,
    output_left_channel: outputPair.left,
    output_right_channel: outputPair.right,
    loopback_enabled: true,
    gain: row.gain
  };

  row.refs.start.disabled = true;
  try {
    const status = await invoke("start_audio_probe", { request });
    renderRunningPort(row, status);
    await refreshPortStatuses();
    startStatusPolling();
  } catch (error) {
    row.refs.status.textContent = `Start failed: ${String(error)}`;
    await refreshPortStatuses();
  }
}

async function stopPort(row) {
  if (!invoke) {
    return;
  }

  try {
    const statuses = await invoke("stop_audio_probe_port", { portId: row.id });
    renderStoppedPort(row);
    renderPortStatuses(statuses);
  } catch (error) {
    row.refs.status.textContent = `Stop failed: ${String(error)}`;
  }
}

async function stopAllPorts() {
  if (!invoke) {
    return;
  }

  try {
    const statuses = await invoke("stop_all_audio_probe_ports");
    portRows.forEach(renderStoppedPort);
    renderPortStatuses(statuses);
  } catch (error) {
    portRows.forEach((row) => {
      row.refs.status.textContent = `Stop all failed: ${String(error)}`;
    });
  }
}

async function refreshDevices() {
  if (!invoke) {
    if (deviceList) {
      deviceList.innerHTML = '<div class="empty-state">Tauri API is not available. Start this UI through the bridge client.</div>';
    }
    if (connectionStatus) {
      connectionStatus.textContent = "Not in Tauri";
    }
    bridgePorts.innerHTML = '<div class="empty-state">No native bridge status available.</div>';
    if (localPortList) {
      localPortList.innerHTML = '<div class="empty-state">No native port runtime available.</div>';
    }
    return;
  }

  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing";
  }
  try {
    await suppressWindowFocusHide(250);
    const [inventory, bridgeStatus, portStatuses] = await Promise.all([
      invoke("list_audio_devices"),
      invoke("get_bridge_status"),
      localPortList ? invoke("get_audio_probe_ports_status") : Promise.resolve([])
    ]);
    renderBridgeStatus(bridgeStatus);
    renderInventory(inventory);
    renderPortStatuses(portStatuses);
    if (serverUrlInput.value.trim() && getBridgeCredential()) {
      try {
        await announceBridge({ quiet: true });
      } catch (announceError) {
        console.warn("auto announce failed", announceError);
        setServerConnectionState("disconnected");
      }
    }
  } catch (error) {
    console.error(error);
    if (connectionStatus) {
      connectionStatus.textContent = "Probe failed";
    }
    if (deviceList) {
      deviceList.innerHTML = `<div class="empty-state">Audio probe failed: ${String(error)}</div>`;
    }
  } finally {
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = "Refresh";
    }
  }
}

addPortButton?.addEventListener("click", addPort);
stopAllPortsButton?.addEventListener("click", stopAllPorts);
refreshButton?.addEventListener("click", refreshDevices);
announceBridgeButton.addEventListener("click", announceBridgeFromButton);
autostartInput.addEventListener("change", setAutostartState);
bridgePorts?.addEventListener("change", handleManagedPortControlChange);
bridgePorts?.addEventListener("click", handleManagedPortSaveClick);
[serverUrlInput, apiKeyInput, bridgeNameInput].forEach((input) => {
  input.addEventListener("change", saveBridgeSettings);
});
window.addEventListener("beforeunload", () => {
  if (managedHeartbeatTimer) window.clearInterval(managedHeartbeatTimer);
  if (managedEventTimer) window.clearInterval(managedEventTimer);
  if (managedInventoryTimer) window.clearInterval(managedInventoryTimer);
  if (managedRetryTimer) window.clearInterval(managedRetryTimer);
  for (const session of managedSessions.values()) {
    stopManagedEventStream(session);
  }
  invoke?.("stop_all_bridge_media").catch(() => {});
});

loadBridgeSettings();
installBridgeWindowAutoResize();
loadAutostartState();
listenForAutostartChanges();
refreshDevices();
