import '../../public/bridgeTalkTrigger.js';
import '../../public/targetPicker.js';
import '../../public/targetPicker.css';
import { openUrl } from "@tauri-apps/plugin-opener";
import { audioLevels, audioMeter, gainLabel, renderPortAudioControl } from './portAudioControls.js';

const bridgeTalkTrigger = globalThis.TalktomeBridgeTalkTrigger;
const targetPicker = globalThis.TalktomeTargetPicker;

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
const announceStatus = document.getElementById("announce-status");
const announceError = document.getElementById("announce-error");
const autostartInput = document.getElementById("autostart-enabled");
const autostartStatus = document.getElementById("autostart-status");
const ndiRuntime = document.getElementById("ndi-runtime");
const ndiRuntimeDetail = document.getElementById("ndi-runtime-detail");
const refreshNdiButton = document.getElementById("refresh-ndi");
const ndiRuntimeLink = document.getElementById("ndi-runtime-link");
const omtRuntime = document.getElementById("omt-runtime");
const omtRuntimeDetail = document.getElementById("omt-runtime-detail");
const refreshOmtButton = document.getElementById("refresh-omt");
const omtRuntimeLink = document.getElementById("omt-runtime-link");
const audioScanStatus = document.getElementById("audio-scan-status");

const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;

async function loadBridgeAppVersion() {
  if (!invoke) return;
  try {
    const version = await invoke('get_bridge_app_version');
    const label = document.getElementById('bridge-app-version');
    if (label && typeof version === 'string' && version) label.textContent = `v${version}`;
  } catch (error) {
    console.warn('Unable to read Bridge version:', error);
  }
}

const STORAGE_KEYS = {
  serverUrl: "talktome:bridge-server-url",
  apiKey: "talktome:bridge-api-key",
  bridgeName: "talktome:bridge-name",
  bridgeId: "talktome:bridge-id",
  bridgeToken: "talktome:bridge-token"
};
const MANAGED_EVENT_FALLBACK_POLL_MS = 250;
// This timer only reads the lightweight device snapshot. Full format discovery
// runs at startup, on manual refresh, or after the snapshot actually changes.
const MANAGED_INVENTORY_WATCH_MS = 5_000;
const MANAGED_INVENTORY_RETRY_MS = 30_000;
const MANAGED_RETRY_MS = 2_000;
const MANAGED_LEVEL_TRIGGER_POLL_MS = 50;
const MANAGED_LEVEL_TEXT_REFRESH_MS = 250;
const MANAGED_LEVEL_TRIGGER_ATTACK_MS = 45;
const MANAGED_LEVEL_TRIGGER_RELEASE_MS = 450;
const MANAGED_INPUT_ACTIVITY_GRACE_MS = 2000;
const MANAGED_LEVEL_TRIGGER_DEFAULT_THRESHOLD_DB = -45;
const MANAGED_LEVEL_TRIGGER_MIN_THRESHOLD_DB = -120;
const MANAGED_LEVEL_TRIGGER_MAX_THRESHOLD_DB = -10;
const MANAGED_DEFAULT_TARGET_VOLUME = 0.9;
const AUDIO_INVENTORY_TIMEOUT_MS = 10_000;
const AUDIO_STATUS_TIMEOUT_MS = 5_000;
const MIN_WINDOW_HEIGHT = 260;
const MAX_WINDOW_HEIGHT = 820;
const ALLOWED_NDI_INFORMATION_URLS = new Set([
  "https://ndi.video/",
  "https://ndi.video/tools/"
]);
const ALLOWED_OMT_INFORMATION_URLS = new Set([
  "https://www.openmediatransport.org/"
]);

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
let managedLevelTriggerTimer = null;
let managedRetryRunning = false;
let managedLevelTriggerRunning = false;
let managedLevelTriggerStartedAt = 0;
let managedLevelDisplayRefreshRunning = false;
let lastManagedLevelDisplayRefreshAt = 0;
let managedInventoryWatchRunning = false;
let managedInventoryWatchRetryAt = 0;
let managedRangeInteractionActive = false;
let lastManagedRangeFocusSuppressionAt = 0;
let lastAnnouncedInventorySignature = "";
let lastAudioDeviceSnapshotSignature = "";
let lastManagedBridgePortsHtml = "";
let bridgeEventStreamListenerPromise = null;
let resizeWindowFrame = null;
let lastRequestedWindowHeight = 0;
let bridgeSettingsApplyTimer = null;
let bridgeSettingsApplyRunning = false;
let bridgeSettingsApplyQueued = false;
const managedSessions = new Map();
const nativeEventStreamSessions = new Map();
const managedPortDrafts = new Map();
const managedPortEditStates = new Map();
const managedPortDraftRevisions = new Map();
const managedPortAutoSaveTimers = new Map();
const managedPortSaveInFlight = new Set();
const managedPortSaveQueued = new Set();
const managedAudioEdits = new Map();
let managedAudioPopover = null;
let managedAudioMeterTimer = null;
let managedAudioMeterBusy = false;

function withTimeout(promise, milliseconds, label) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} did not respond within ${Math.ceil(milliseconds / 1000)} seconds`));
    }, milliseconds);
    Promise.resolve(promise).then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

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

function isBridgeSettingsControlFocused() {
  return [serverUrlInput, apiKeyInput, bridgeNameInput].includes(document.activeElement);
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

function setBridgeConnectionError(error = null) {
  if (!announceError) return;
  if (!error) {
    announceError.textContent = "";
    requestBridgeWindowResize();
    return;
  }

  const message = String(error?.message || error);
  if (isServerOfflineError(error)) {
    let serverUrl = serverUrlInput.value.trim();
    try {
      serverUrl = normalizeServerUrl(serverUrl);
      const parsedUrl = new URL(serverUrl);
      const portHint = parsedUrl.port
        ? ""
        : " If the server does not use HTTPS port 443, include its port in the URL (for example :8443).";
      announceError.textContent = `Could not reach ${serverUrl}.${portHint}`;
    } catch {
      announceError.textContent = message;
    }
  } else {
    announceError.textContent = message;
  }
  requestBridgeWindowResize();
}

function renderNdiStatus(status) {
  if (!ndiRuntime || !ndiRuntimeDetail) return;
  const available = Boolean(status?.available);
  ndiRuntime.dataset.state = available ? "available" : "unavailable";
  if (!available) {
    const error = String(status?.error || "NDI Runtime not found");
    const timedOut = /timed out|did not respond|query is still running/i.test(error);
    ndiRuntimeDetail.textContent = timedOut
      ? "NDI query is taking longer than expected. Try Refresh again shortly."
      : "Runtime not installed. NDI devices are hidden until the current NDI Runtime is installed.";
    ndiRuntimeDetail.title = error;
    if (ndiRuntimeLink) {
      ndiRuntimeLink.href = timedOut ? "https://ndi.video/" : "https://ndi.video/tools/";
      ndiRuntimeLink.textContent = "Info";
    }
    return;
  }
  const version = String(status?.version || "installed runtime");
  const sourceCount = Number(status?.sourceCount || 0);
  ndiRuntimeDetail.textContent = `${version} · ${sourceCount} source${sourceCount === 1 ? "" : "s"} found`;
  ndiRuntimeDetail.title = String(status?.runtimePath || "");
  if (ndiRuntimeLink) {
    ndiRuntimeLink.href = "https://ndi.video/";
    ndiRuntimeLink.textContent = "Info";
  }
}

function renderOmtStatus(status) {
  if (!omtRuntime || !omtRuntimeDetail) return;
  const available = Boolean(status?.available);
  omtRuntime.dataset.state = available ? "available" : "unavailable";
  const version = String(status?.version || "OMT");
  if (!available) {
    const error = String(status?.error || "Bundled OMT backend not found");
    const timedOut = /timed out|did not respond|query is still running/i.test(error);
    omtRuntimeDetail.textContent = timedOut
      ? "OMT query is taking longer than expected. Try Refresh again shortly."
      : "Bundled backend unavailable. Reinstall the Bridge to restore OMT devices.";
    omtRuntimeDetail.title = error;
    return;
  }
  const sourceCount = Number(status?.sourceCount || 0);
  omtRuntimeDetail.textContent = `${version} · ${sourceCount} source${sourceCount === 1 ? "" : "s"} found`;
  omtRuntimeDetail.title = String(status?.runtimePath || "Bundled with Talktome Bridge");
}

async function refreshNdiDevices() {
  if (!invoke || !refreshNdiButton) return;
  refreshNdiButton.disabled = true;
  refreshNdiButton.textContent = "Refreshing…";
  if (ndiRuntime) ndiRuntime.dataset.state = "checking";
  if (ndiRuntimeDetail) ndiRuntimeDetail.textContent = "Discovering NDI sources…";
  try {
    await refreshDevices();
  } finally {
    refreshNdiButton.disabled = false;
    refreshNdiButton.textContent = "Refresh";
  }
}

async function refreshOmtDevices() {
  if (!invoke || !refreshOmtButton) return;
  refreshOmtButton.disabled = true;
  refreshOmtButton.textContent = "Refreshing…";
  if (omtRuntime) omtRuntime.dataset.state = "checking";
  if (omtRuntimeDetail) omtRuntimeDetail.textContent = "Discovering OMT sources…";
  try {
    await refreshDevices();
  } finally {
    refreshOmtButton.disabled = false;
    refreshOmtButton.textContent = "Refresh";
  }
}

async function openNdiInformation(event) {
  event.preventDefault();
  const url = ndiRuntimeLink?.href;
  if (!url || !ALLOWED_NDI_INFORMATION_URLS.has(url)) return;

  try {
    await suppressWindowFocusHide(750);
    await openUrl(url);
  } catch (error) {
    console.error("Could not open NDI information", error);
    if (ndiRuntimeDetail) {
      ndiRuntimeDetail.textContent = `Could not open the NDI website: ${String(error)}`;
    }
    requestBridgeWindowResize();
  }
}

async function openOmtInformation(event) {
  event.preventDefault();
  const url = omtRuntimeLink?.href;
  if (!url || !ALLOWED_OMT_INFORMATION_URLS.has(url)) return;

  try {
    await suppressWindowFocusHide(750);
    await openUrl(url);
  } catch (error) {
    console.error("Could not open OMT information", error);
    if (omtRuntimeDetail) {
      omtRuntimeDetail.textContent = `Could not open the OMT website: ${String(error)}`;
    }
    requestBridgeWindowResize();
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
    devices,
    videoSources: inventory.videoSources || []
  });
}

function audioDeviceSnapshotSignature(snapshot) {
  if (!snapshot) return "";
  const devices = (snapshot.devices || []).map((device) => ({
    id: device.id || "",
    name: device.name || "",
    direction: device.direction || "",
    isDefault: Boolean(device.is_default ?? device.isDefault)
  })).sort((a, b) => (
    a.direction.localeCompare(b.direction)
    || a.id.localeCompare(b.id)
    || a.name.localeCompare(b.name)
  ));

  return JSON.stringify({
    host: snapshot.host || "",
    devices
  });
}

function getBridgeCredential() {
  return localStorage.getItem(STORAGE_KEYS.bridgeToken) || apiKeyInput.value.trim();
}

function normalizeServerUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    throw new Error("Server URL is required");
  }

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Server URL is invalid");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Server URL must use HTTPS or HTTP");
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error("Server URL must contain a valid host without credentials");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Server URL must not contain a query or fragment");
  }

  return parsed.toString().replace(/\/+$/, "");
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
  return port?.kind === "user";
}

function bridgePortHasPersistentNetworkOutput(port) {
  if (!bridgePortHasOutput(port)) return false;
  const deviceId = String(port.output?.deviceId || "");
  return deviceId.startsWith("ndi:send:") || deviceId.startsWith("omt:send:");
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
    if (state) return getManagedPanelOutputState(session, output, state);
  }
  return getManagedPanelOutputState(session, output, { volume: MANAGED_DEFAULT_TARGET_VOLUME, muted: false });
}

function getManagedPanelOutputState(session, output, state) {
  const storage = session.panelSettings?.storage || {};
  const conferenceId = output?.appData?.type === 'conference' ? Number(output.appData.id) : null;
  const sourceUserId = Number(output?.speakerUserId);
  let memberLevel = 1;
  let memberMuted = false;
  if (conferenceId != null && Number.isFinite(sourceUserId)) {
    try {
      const excluded = JSON.parse(storage[`conferenceListenExclusions:user:${session.port.userId}`] || '{}');
      const levels = JSON.parse(storage[`conferenceMemberLevels:user:${session.port.userId}`] || '{}');
      memberMuted = (excluded[conferenceId] || []).includes(sourceUserId);
      memberLevel = Math.max(0, Math.min(1, Number(levels[conferenceId]?.[sourceUserId] ?? 1)));
    } catch {}
  }
  let feedStopped = false;
  if (output?.appData?.type === 'feed') {
    try { feedStopped = Boolean(JSON.parse(storage[`stoppedFeeds:user:${session.port.userId}`] || '{}')[`feed-${output.appData.id}`]); } catch {}
  }
  return { ...state, volume: state.volume * memberLevel, muted: state.muted || memberMuted || feedStopped };
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

function getManagedOutputUnavailableReason(port) {
  if (!currentInventory?.devices?.length || !bridgePortHasOutput(port)) return "";
  return getManagedAssignmentUnavailableReason("output", port.output);
}

function setManagedInputError(session, error) {
  const classified = classifyManagedPortError(error);
  recordManagedLifecycle(session, "input-error", classified.detail);
  session.inputError = classified.detail;
  session.inputRetryable = classified.retryable;
  session.inputRetryAt = classified.retryable
    ? Date.now() + getManagedRetryDelay(session)
    : null;
}

function clearManagedInputError(session) {
  session.inputError = null;
  session.inputRetryAt = null;
  session.inputRetryable = true;
}

async function stopManagedInputPath(session, reason = "input-stop") {
  if (session.talking) {
    await applyManagedTalkState(session, {
      talking: false,
      targets: [],
      source: session.talkSource || "external",
      preserveAlwaysOn: false
    }).catch((error) => {
      recordManagedLifecycle(session, "input-talk-release-error", String(error?.message || error));
    });
  }
  await invoke("stop_bridge_input", { streamId: session.inputStreamId }).catch(() => {});
  session.talking = false;
  session.talkSource = null;
  session.lockActive = false;
  session.targets = [];
  session.panelBaseTalkState = null;
  session.panelTalkInputs?.clear();
  session.panelTalkLocks?.clear();
  session.producerId = null;
  session.inputStartedAt = 0;
  session.inputReady = false;
  session.inputStarting = false;
  if (session.levelTriggerState) {
    session.levelTriggerState.revision = Number(session.levelTriggerState.revision || 0) + 1;
    session.levelTriggerState.active = false;
    session.levelTriggerState.aboveSince = 0;
    session.levelTriggerState.belowSince = 0;
    session.levelTriggerState.pending = false;
    session.levelTriggerState.releaseRequired = false;
  }
  recordManagedLifecycle(session, "input-stopped", reason);
}

async function auditManagedSessionDevices() {
  for (const session of managedSessions.values()) {
    if (!session.ready || session.starting) continue;
    const outputUnavailableReason = getManagedOutputUnavailableReason(session.port);
    if (outputUnavailableReason) {
      await stopManagedSession(session, { remove: false, reason: "output-device-unavailable" });
      setManagedSessionError(session, new Error(outputUnavailableReason));
      continue;
    }

    if (session.port.kind === "feed" && !session.port.input?.deviceId && session.port.videoSource) continue;
    if (!currentInventory?.devices?.length) continue;
    const inputUnavailableReason = getManagedAssignmentUnavailableReason("input", session.port.input);
    if (inputUnavailableReason) {
      if (session.inputReady || session.inputStarting) {
        await stopManagedInputPath(session, "input-device-unavailable");
      }
      if (session.inputError !== inputUnavailableReason) {
        setManagedInputError(session, new Error(inputUnavailableReason));
      }
    }
  }
}

async function auditManagedNativeMediaStatus(status = null) {
  if (!invoke) return;
  const nativeStatus = status || await invoke("get_bridge_media_status");
  const inputErrors = new Map((nativeStatus?.inputStreamErrors || []).map((entry) => [
    String(entry.streamId || ""),
    String(entry.message || "Bridge input stream failed")
  ]));
  const outputErrors = new Map((nativeStatus?.outputStreamErrors || []).map((entry) => [
    String(entry.streamId || ""),
    String(entry.message || "Bridge output stream failed")
  ]));
  const outputStats = new Map((nativeStatus?.outputStreamStats || []).map((entry) => [
    String(entry.streamId || ""),
    {
      decodedFrames: Number(entry.decodedFrames || 0),
      decodedBytes: Number(entry.decodedBytes || 0)
    }
  ]));

  for (const session of managedSessions.values()) {
    if (!session.ready || session.starting) continue;
    const inputError = session.inputReady ? inputErrors.get(session.inputStreamId) : null;
    let outputError = null;
    for (const output of session.outputs.values()) {
      const stats = outputStats.get(output.streamId);
      if (stats) {
        if (stats.decodedFrames > output.decodedFrames) {
          output.lastDecodedAt = Date.now();
        }
        output.decodedFrames = stats.decodedFrames;
        output.decodedBytes = stats.decodedBytes;
      }
      outputError = outputErrors.get(output.streamId);
      if (outputError) break;
    }
    if (inputError) {
      await stopManagedInputPath(session, "native-input-error");
      setManagedInputError(session, new Error(inputError));
    }
    if (outputError) {
      await stopManagedSession(session, { remove: false, reason: "native-output-error" });
      setManagedSessionError(session, new Error(outputError));
    }
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
    || lower.includes("bridge announce request failed")
    || lower.includes("error sending request")
    || lower.includes("connection refused")
    || lower.includes("connection reset")
    || lower.includes("connection closed")
    || lower.includes("dns")
    || lower.includes("timed out")
    || lower.includes("server")
  ) {
    return { label: "Server offline", detail: "Server offline", retryable: true };
  }
  if (lower.includes("session was replaced") || lower.includes("session-kicked")) {
    return { label: "Session replaced", detail: message, retryable: true };
  }
  return { label: "Error", detail: message, retryable: true };
}

function isServerOfflineError(error) {
  return classifyManagedPortError(error).label === "Server offline";
}

function setManagedSessionError(session, error) {
  const classified = classifyManagedPortError(error);
  recordManagedLifecycle(session, "error", classified.detail);
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

function recordManagedLifecycle(session, event, detail = "") {
  if (!session) return;
  const events = session.lifecycleEvents || (session.lifecycleEvents = []);
  events.push({
    event: String(event || "unknown").slice(0, 80),
    detail: String(detail || "").slice(0, 500)
  });
  if (events.length > 20) events.splice(0, events.length - 20);
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
  if (session.inputError) {
    return {
      label: "Input unavailable",
      className: session.inputRetryable === false ? "error" : "warning"
    };
  }
  if (port.kind === "feed") return { label: "Streaming", className: "active" };
  if (session.talking) return { label: "Transmitting", className: "active" };
  const addressedNow = Array.isArray(session.addressedNow) ? session.addressedNow : [];
  if (addressedNow.length) return { label: "Receiving", className: "" };
  return { label: "Ready", className: "" };
}

function bridgeAssignmentSignature(assignment) {
  return {
    deviceId: assignment?.deviceId || "",
    leftChannel: assignment?.leftChannel ?? null,
    rightChannel: assignment?.rightChannel ?? null,
  };
}

function bridgePortSignature(port) {
  return JSON.stringify({
    id: port.id,
    kind: port.kind || "user",
    userId: port.userId ?? null,
    feedId: port.feedId ?? null,
    input: bridgeAssignmentSignature(port.input),
    output: bridgePortHasOutput(port) ? bridgeAssignmentSignature(port.output) : null,
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
  const trigger = port.trigger || {};
  return {
    videoSource: draft.videoSource ?? port.videoSource ?? "",
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
    trigger: port.kind === "user" ? {
      mode: draft.trigger?.mode ?? bridgeTalkTrigger.mode(trigger.mode),
      targets: draft.trigger?.targets ?? bridgeTalkTrigger.fromTrigger(trigger),
      thresholdDb: draft.trigger?.thresholdDb ?? (trigger.thresholdDb ?? MANAGED_LEVEL_TRIGGER_DEFAULT_THRESHOLD_DB),
    } : null,
  };
}

function buildManagedDeviceOptions(direction, selectedDeviceId) {
  const devices = devicesByDirection(direction);
  const selected = String(selectedDeviceId || "");
  const hasSelected = devices.some((device) => device.id === selected);
  const options = [];
  options.push('<option value="">Select device</option>');
  if (selected && !hasSelected) {
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

function getManagedIncomingSpeakerNames(session) {
  const names = [];
  const seen = new Set();
  const addName = (value) => {
    const name = String(value || "").trim();
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };

  for (const entry of Array.isArray(session?.addressedNow) ? session.addressedNow : []) {
    addName(entry?.fromName || entry?.speakerName || entry?.name);
  }
  for (const output of session?.outputs?.values?.() || []) {
    if (String(output?.appData?.type || "").toLowerCase() === "feed") {
      addName(output?.speakerName);
    }
  }

  return names;
}

function formatActiveReturnPaths(count, speakerNames = []) {
  const activeCount = Number(count) || 0;
  if (activeCount <= 0) return "No active incoming talk";
  if (speakerNames.length) {
    const unknownCount = Math.max(0, activeCount - speakerNames.length);
    const unknownSuffix = unknownCount > 0
      ? ` + ${unknownCount} other${unknownCount === 1 ? "" : "s"}`
      : "";
    return `${speakerNames.join(", ")}${unknownSuffix} speaking`;
  }
  if (activeCount === 1) return "1 active incoming talk";
  return `${activeCount} active incoming talks`;
}

function formatManagedReturnPathStatus(session) {
  const addressedNow = Array.isArray(session?.addressedNow) ? session.addressedNow : [];
  const outputs = [...(session?.outputs?.values?.() || [])];
  const feedOutputs = outputs.filter((output) => String(output?.appData?.type || "").toLowerCase() === "feed");
  const activeCount = addressedNow.length + feedOutputs.length;
  if (!activeCount) return "No active incoming talk";

  const base = formatActiveReturnPaths(activeCount, getManagedIncomingSpeakerNames(session));
  if (!outputs.length) return base;

  if (outputs.some((output) => Date.now() - Number(output.lastDecodedAt || 0) < 1_500)) {
    return `${base}, receiving audio`;
  }

  const oldestOutputAge = outputs.reduce((age, output) => {
    const startedAt = Number(output.startedAt) || Date.now();
    return Math.max(age, Date.now() - startedAt);
  }, 0);
  if (oldestOutputAge >= 1_000) {
    return `${base}, waiting for RTP audio`;
  }
  return base;
}

function audioEditKey(port, direction) { return `${bridgePortKey(port)}:${direction}`; }

function getManagedAudioLevel(port, direction) {
  const edit = managedAudioEdits.get(audioEditKey(port, direction));
  return audioLevels.normalizeLevel(edit?.dirty ? edit.level : port.audioLevels?.[direction], direction);
}

async function applyManagedPortAudioLevel(port, direction, level = getManagedAudioLevel(port, direction)) {
  if (!invoke) throw new Error('Native audio control is unavailable');
  await invoke('set_bridge_port_audio_level', { request: { portId: port.id, direction, level } });
}

async function syncManagedPortAudioLevels(port) {
  for (const direction of ['input', 'output']) {
    if (direction === 'output' && !bridgePortHasOutput(port)) continue;
    const edit = managedAudioEdits.get(audioEditKey(port, direction));
    if (edit?.dirty) continue;
    const session = managedSessions.get(bridgePortKey(port));
    const level = getManagedAudioLevel(port, direction);
    const signature = JSON.stringify(level);
    session.appliedAudioLevels ||= {};
    if (session.appliedAudioLevels[direction] !== signature) {
      await applyManagedPortAudioLevel(port, direction, level);
      session.appliedAudioLevels[direction] = signature;
    }
  }
}

function managedAudioControl(port, direction) {
  return getManagedPortElement(bridgePortKey(port))?.querySelector(`[data-audio-direction="${direction}"]`);
}

function updateManagedAudioControl(port, direction) {
  const control = managedAudioControl(port, direction);
  if (!control) return;
  const level = getManagedAudioLevel(port, direction);
  const edit = managedAudioEdits.get(audioEditKey(port, direction));
  const button = control.querySelector('[data-audio-open]');
  button.title = `${direction === 'input' ? 'Input gain' : 'Output volume'}: ${gainLabel(level)}`;
  button.classList.toggle('is-adjusted', level.gainDb !== 0 || level.muted);
  for (const selector of ['[data-audio-range]', '[data-audio-number]']) {
    const input = control.querySelector(selector);
    if (input !== document.activeElement) input.value = String(level.gainDb);
  }
  control.querySelector('[data-audio-mute]').checked = level.muted;
  control.querySelector('[data-audio-mute-label]').textContent = level.muted ? 'Muted' : 'Mute';
  const [min, max] = audioLevels.LIMITS[direction];
  control.querySelector('[data-audio-step="-0.5"]').disabled = level.gainDb <= min;
  control.querySelector('[data-audio-step="0.5"]').disabled = level.gainDb >= max;
  const status = control.querySelector('[data-audio-save]');
  status.textContent = edit?.error || (edit?.dirty || edit?.saving ? 'Saving…' : 'Saved');
  status.classList.toggle('is-error', Boolean(edit?.error));
  control.querySelector('[data-audio-retry]').hidden = !edit?.error;
}

async function persistManagedAudioLevel(port, direction) {
  const edit = managedAudioEdits.get(audioEditKey(port, direction));
  if (!edit?.dirty || edit.saving) return;
  edit.saving = true;
  const revision = edit.revision;
  const level = { ...edit.level };
  try {
    await edit.nativePromise;
    const result = await bridgeApi('PUT', `/api/v1/bridge/${encodeURIComponent(managedBridgeConfig.bridgeId)}/ports/${port.kind}/${bridgePortTargetId(port)}/levels/${direction}`, level);
    port.audioLevels = { ...port.audioLevels, [direction]: result.audioLevels[direction] };
    const current = (managedBridgeConfig?.ports || []).find(entry => bridgePortKey(entry) === bridgePortKey(port));
    if (current) current.audioLevels = { ...current.audioLevels, [direction]: result.audioLevels[direction] };
    if (edit.revision === revision) { edit.dirty = false; edit.error = null; }
  } catch (error) {
    edit.error = String(error?.message || error);
  } finally {
    edit.saving = false;
    updateManagedAudioControl(port, direction);
    if (edit.revision !== revision) {
      clearTimeout(edit.timer);
      edit.timer = setTimeout(() => persistManagedAudioLevel(port, direction), 0);
    }
  }
}

function changeManagedAudioLevel(port, direction, value) {
  const key = audioEditKey(port, direction);
  const edit = managedAudioEdits.get(key) || { revision: 0 };
  const normalized = audioLevels.normalizeLevel(value, direction);
  const previous = getManagedAudioLevel(port, direction);
  if (!edit.error && normalized.gainDb === previous.gainDb && normalized.muted === previous.muted) return;
  edit.level = normalized;
  edit.revision++;
  edit.dirty = true;
  edit.error = null;
  // Preserve the ordering of drag updates at the native command boundary.
  const level = { ...edit.level };
  edit.nativePromise = (edit.nativePromise || Promise.resolve()).catch(() => {}).then(() => applyManagedPortAudioLevel(port, direction, level));
  edit.nativePromise.catch(() => {});
  managedAudioEdits.set(key, edit);
  clearTimeout(edit.timer);
  edit.timer = setTimeout(() => persistManagedAudioLevel(port, direction), 250);
  updateManagedAudioControl(port, direction);
}

function closeManagedAudioPopover(restoreFocus = true) {
  if (!managedAudioPopover) return;
  const { panel, button } = managedAudioPopover;
  managedAudioPopover = null;
  panel.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  clearInterval(managedAudioMeterTimer);
  managedAudioMeterTimer = null;
  if (restoreFocus) button.focus({ preventScroll: true });
}

function positionManagedAudioPopover() {
  if (!managedAudioPopover) return;
  const { panel, button } = managedAudioPopover;
  const box = button.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(innerWidth - panel.offsetWidth - 8, box.right - panel.offsetWidth))}px`;
  panel.style.top = `${Math.max(8, box.bottom + panel.offsetHeight + 8 > innerHeight ? box.top - panel.offsetHeight - 8 : box.bottom + 8)}px`;
}

async function pollManagedAudioMeter() {
  const open = managedAudioPopover;
  if (!open || !invoke || managedAudioMeterBusy || document.hidden) return;
  managedAudioMeterBusy = true;
  try {
    const status = await invoke('get_bridge_media_status');
    if (managedAudioPopover !== open) return;
    const rows = open.direction === 'input'
      ? (status.inputStreamStats || []).filter(row => row.streamId === `${open.port.id}:input`)
      : (status.outputStreamStats || []).filter(row => row.streamId.startsWith(`${open.port.id}:consumer:`));
    const now = Date.now();
    let rmsDb = -120;
    let active = false;
    for (const row of rows) {
      const frames = row.capturedFrames ?? row.decodedFrames;
      const previous = open.meters.get(row.streamId);
      const changed = frames > 0 && frames !== previous?.frames;
      const at = changed ? now : previous?.at || 0;
      const clipped = Number(row.clippedSamples || 0);
      if (previous && clipped > previous.clipped) open.clipUntil = now + 1200;
      open.meters.set(row.streamId, { frames, at, clipped });
      if (now - at > 500 || !Number.isFinite(row.rmsDb)) continue;
      active = true;
      rmsDb = Math.max(rmsDb, row.rmsDb);
    }
    const meter = open.panel.querySelector('[role="meter"]');
    const meterMinDb = Number(meter.getAttribute('aria-valuemin'));
    const displayedDb = Math.max(meterMinDb, Math.min(0, rmsDb));
    meter.setAttribute('aria-valuenow', String(displayedDb));
    const fill = open.panel.querySelector('[data-audio-meter-fill]');
    audioMeter.renderLevel(fill, (displayedDb - meterMinDb) / -meterMinDb * 100, meterMinDb);
    const muted = getManagedAudioLevel(open.port, open.direction).muted;
    const inputSession = open.direction === 'input' ? managedSessions.get(bridgePortKey(open.port)) : null;
    if (inputSession) {
      updateManagedInputLevelDisplay(inputSession, rows[0]);
    } else if (open.levelTextActive !== active || open.levelTextMuted !== muted
      || now - (open.lastLevelTextAt || 0) >= MANAGED_LEVEL_TEXT_REFRESH_MS) {
      const label = open.direction === 'input' ? 'Input level' : 'Output level';
      open.panel.querySelector('[data-audio-meter-label]').textContent = `${label}: ${active ? `${rmsDb.toFixed(1)} dBFS` : 'No audio'}${muted ? ' - Muted' : ''}`;
      open.lastLevelTextAt = now;
      open.levelTextActive = active;
      open.levelTextMuted = muted;
    }
    open.panel.querySelector('[data-audio-clip]').hidden = now > (open.clipUntil || 0);
  } catch {
    if (managedAudioPopover === open) {
      open.panel.querySelector('[data-audio-meter-label]').textContent = 'Meter unavailable';
      open.lastLevelTextAt = 0;
    }
  } finally { managedAudioMeterBusy = false; }
}

function handleManagedAudioClick(event) {
  const control = event.target.closest('[data-audio-direction]');
  if (!control) return;
  const key = control.closest('[data-managed-port-key]')?.dataset.managedPortKey;
  const port = (managedBridgeConfig?.ports || []).find(port => bridgePortKey(port) === key);
  if (!port) return;
  const direction = control.dataset.audioDirection;
  if (event.target.closest('[data-audio-open]')) {
    const button = control.querySelector('[data-audio-open]');
    const wasOpen = managedAudioPopover?.button === button;
    closeManagedAudioPopover(false);
    if (wasOpen) return;
    const panel = control.querySelector('.port-audio-popover');
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    managedAudioPopover = { port, direction, panel, button, meters: new Map() };
    positionManagedAudioPopover();
    updateManagedAudioControl(port, direction);
    panel.querySelector('[data-audio-range]').focus({ preventScroll: true });
    pollManagedAudioMeter();
    managedAudioMeterTimer = setInterval(pollManagedAudioMeter, 125);
  } else if (event.target.closest('[data-audio-close]')) closeManagedAudioPopover();
  else if (event.target.closest('[data-audio-step]')) {
    const level = getManagedAudioLevel(port, direction);
    const step = Number(event.target.closest('[data-audio-step]').dataset.audioStep);
    changeManagedAudioLevel(port, direction, { ...level, gainDb: level.gainDb + step });
  }
  else if (event.target.closest('[data-audio-reset]')) changeManagedAudioLevel(port, direction, { gainDb: 0, muted: false });
  else if (event.target.closest('[data-audio-retry]')) changeManagedAudioLevel(port, direction, getManagedAudioLevel(port, direction));
}

function handleManagedAudioInput(event) {
  const input = event.target;
  if (!input.matches('[data-audio-range], [data-audio-number], [data-audio-mute]')) return;
  if (input.matches('[data-audio-mute]') && event.type !== 'change') return;
  const control = input.closest('[data-audio-direction]');
  const port = (managedBridgeConfig?.ports || []).find(port => bridgePortKey(port) === control.closest('[data-managed-port-key]').dataset.managedPortKey);
  if (!port) return;
  const direction = control.dataset.audioDirection;
  const level = getManagedAudioLevel(port, direction);
  if (input.matches('[data-audio-mute]')) level.muted = input.checked;
  else {
    if (!input.value.trim() || !Number.isFinite(Number(input.value))) return;
    level.gainDb = Number(input.value);
  }
  changeManagedAudioLevel(port, direction, level);
  if (event.type === 'change' && input.matches('[data-audio-number]')) {
    input.value = String(getManagedAudioLevel(port, direction).gainDb);
  }
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
    ${renderPortAudioControl(escapeHtml(port.id), direction, getManagedAudioLevel(port, direction))}
    <label class="managed-port-control managed-port-control--channel">
      <span>${labelPrefix} channel</span>
      <select data-managed-port-control data-field="${direction}Channel">
        ${buildManagedChannelOptions(device, assignment.leftChannel, assignment.rightChannel)}
      </select>
    </label>
  `;
}

function buildManagedTriggerTargetOptions(port, triggerDraft, { includeUnavailable = true } = {}) {
  const selected = new Set(bridgeTalkTrigger.targets(triggerDraft?.targets).map(target => `${target.type}:${target.id}`));
  const options = new Map((port.triggerTargets || []).filter(target => ['user', 'conference'].includes(target.type))
    .map(target => [`${target.type}:${target.id}`, { label: target.name, type: target.type }]));
  if (includeUnavailable) for (const key of selected) {
    if (!options.has(key)) options.set(key, { label: key, type: key.split(':')[0], unavailable: true });
  }
  return [...options].map(([value, option]) => ({ value, ...option }));
}

function renderManagedTriggerControls(port, draft) {
  if (port.kind !== 'user') return '';
  const trigger = draft.trigger || {};
  const mode = bridgeTalkTrigger.mode(trigger.mode);
  const threshold = Number(trigger.thresholdDb ?? MANAGED_LEVEL_TRIGGER_DEFAULT_THRESHOLD_DB);
  const hint = mode === 'always-on'
    ? 'Sends continuously to all selected targets. Resumes after reconnects. Change mode to stop.'
    : mode === 'audio-level' ? 'Sends to all selected targets when the input exceeds the threshold.'
      : 'Targets are supplied by API / Companion commands.';
  return `<div class="managed-port-trigger-grid ${mode !== 'audio-level' ? 'managed-port-trigger-grid--simple' : ''}">
    <label class="managed-port-control"><span>Talk trigger</span>
      <select data-managed-port-control data-field="triggerMode">
        <option value="external" ${mode === 'external' ? 'selected' : ''}>External API / Companion</option>
        <option value="audio-level" ${mode === 'audio-level' ? 'selected' : ''}>Audio level</option>
        <option value="always-on" ${mode === 'always-on' ? 'selected' : ''}>Always on</option>
      </select>
    </label>
    <label class="managed-port-control managed-port-control--threshold" ${mode === 'audio-level' ? '' : 'hidden'}>
      <span class="managed-port-threshold-label"><span>Threshold</span><output data-trigger-threshold-value>${escapeHtml(threshold)} dBFS</output></span>
      <input data-managed-port-control data-field="triggerThreshold" type="range" min="${MANAGED_LEVEL_TRIGGER_MIN_THRESHOLD_DB}" max="${MANAGED_LEVEL_TRIGGER_MAX_THRESHOLD_DB}" step="1" value="${escapeHtml(threshold)}" aria-label="Audio trigger threshold">
    </label>
    <div class="managed-port-control managed-port-control--targets" ${mode === 'external' ? 'hidden' : ''}>
      <span id="${escapeHtml(port.id)}-talk-targets-label" title="${escapeHtml(hint)} Targets are global. Selected conferences also open return audio; mute or adjust it in the Panel.">Talk targets ⓘ</span>
      <div data-managed-target-picker data-selected-targets="${escapeHtml(JSON.stringify(bridgeTalkTrigger.targets(trigger.targets)))}" role="group" aria-labelledby="${escapeHtml(port.id)}-talk-targets-label"></div>
    </div>
  </div>`;
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

function readManagedTriggerFromElement(card) {
  const mode = bridgeTalkTrigger.mode(card.querySelector('[data-field="triggerMode"]')?.value);
  const targets = targetPicker.read(card.querySelector('[data-managed-target-picker]')).map(value => {
    const [type, id] = value.split(':');
    return { type, id: Number(id) };
  });
  const threshold = Number(card.querySelector('[data-field="triggerThreshold"]')?.value);
  return { mode, targets, thresholdDb: Number.isFinite(threshold)
    ? Math.max(MANAGED_LEVEL_TRIGGER_MIN_THRESHOLD_DB, Math.min(MANAGED_LEVEL_TRIGGER_MAX_THRESHOLD_DB, threshold))
    : MANAGED_LEVEL_TRIGGER_DEFAULT_THRESHOLD_DB };
}

function updateManagedPortDraftFromElement(card) {
  const key = card?.dataset?.managedPortKey;
  if (!key) return;
  const port = (managedBridgeConfig?.ports || []).find((entry) => bridgePortKey(entry) === key);
  if (!port) return;
  const draft = {
    videoSource: card.querySelector('[data-field="videoSource"]')?.value || "",
    input: readManagedPortAssignmentFromElement(card, "input"),
    output: bridgePortHasOutput(port)
      ? readManagedPortAssignmentFromElement(card, "output")
      : null,
    trigger: port.kind === "user" ? readManagedTriggerFromElement(card) : null,
  };
  managedPortDrafts.set(key, draft);
  managedPortDraftRevisions.set(key, (managedPortDraftRevisions.get(key) || 0) + 1);
  const editState = managedPortEditStates.get(key) || {};
  managedPortEditStates.set(key, { ...editState, dirty: true, error: null });
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

function validateManagedTrigger(trigger) {
  if (!trigger) return;
  const targets = bridgeTalkTrigger.targets(trigger.targets, null, { strict: true });
  if (trigger.mode !== 'external' && !targets.length) throw new Error('Select at least one talk target');
  if (trigger.mode === 'audio-level' && !Number.isFinite(Number(trigger.thresholdDb))) {
    throw new Error('Audio level trigger threshold is invalid');
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
  const saveRevision = managedPortDraftRevisions.get(key) || 0;
  const draft = managedPortDrafts.get(key) || getManagedPortDraft(port);

  if (draft.input.deviceId || port.kind !== "feed" || !draft.videoSource) validateManagedPortAssignment(draft.input, "Input");
  if (bridgePortHasOutput(port)) {
    validateManagedPortAssignment(draft.output, "Output");
  }
  validateManagedTrigger(draft.trigger);

  const payload = {
    ...(port.kind === "feed" ? { videoSource: draft.videoSource } : {}),
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
  if (port.kind === "user") {
    payload.triggerMode = bridgeTalkTrigger.mode(draft.trigger?.mode);
    payload.triggerThresholdDb = draft.trigger?.thresholdDb ?? MANAGED_LEVEL_TRIGGER_DEFAULT_THRESHOLD_DB;
    payload.triggerTargets = draft.trigger?.targets || [];
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
    if ((managedPortDraftRevisions.get(key) || 0) === saveRevision) {
      managedPortDrafts.delete(key);
      managedPortEditStates.delete(key);
    } else {
      managedPortEditStates.set(key, { dirty: true });
    }
    await reconcileManagedBridgeConfig(config);
  } catch (error) {
    managedPortEditStates.set(key, {
      dirty: true,
      error: String(error?.message || error)
    });
    renderManagedBridgePorts();
    throw error;
  }
}

function scheduleManagedPortAutoSave(key, delay = 200) {
  if (!key) return;
  const existingTimer = managedPortAutoSaveTimers.get(key);
  if (existingTimer) window.clearTimeout(existingTimer);
  const timer = window.setTimeout(() => {
    managedPortAutoSaveTimers.delete(key);
    runManagedPortAutoSave(key);
  }, delay);
  managedPortAutoSaveTimers.set(key, timer);
}

async function runManagedPortAutoSave(key) {
  if (managedPortSaveInFlight.has(key)) {
    managedPortSaveQueued.add(key);
    return;
  }

  managedPortSaveInFlight.add(key);
  try {
    await saveManagedBridgePort(key);
  } catch (error) {
    console.error("Failed to save managed bridge port", error);
  } finally {
    managedPortSaveInFlight.delete(key);
    if (managedPortSaveQueued.delete(key)) {
      scheduleManagedPortAutoSave(key, 0);
    }
  }
}

function handleManagedPortControlChange(event) {
  const control = event.target;
  if (
    !(control instanceof HTMLSelectElement || control instanceof HTMLInputElement) ||
    !control.matches("[data-managed-port-control]")
  ) {
    return;
  }
  const card = control.closest("[data-managed-port-key]");
  if (!(card instanceof HTMLElement)) return;
  const portKey = card.dataset.managedPortKey || "";

  const field = control.dataset.field || "";
  if (field === "triggerThreshold" && event.type === "input") {
    const thresholdValue = Number(control.value);
    const valueDisplay = card.querySelector("[data-trigger-threshold-value]");
    if (valueDisplay instanceof HTMLOutputElement && Number.isFinite(thresholdValue)) {
      valueDisplay.textContent = `${Math.round(thresholdValue)} dBFS`;
      const port = (managedBridgeConfig?.ports || []).find((entry) => bridgePortKey(entry) === portKey);
      if (port) {
        const draft = managedPortDrafts.get(portKey) || getManagedPortDraft(port);
        draft.trigger = { ...draft.trigger, thresholdDb: thresholdValue };
        managedPortDrafts.set(portKey, draft);
        managedPortDraftRevisions.set(portKey, (managedPortDraftRevisions.get(portKey) || 0) + 1);
        managedPortEditStates.set(portKey, {
          ...managedPortEditStates.get(portKey),
          dirty: true,
          error: null
        });
      }
    }
    if (managedRangeInteractionActive && Date.now() - lastManagedRangeFocusSuppressionAt >= 2_500) {
      lastManagedRangeFocusSuppressionAt = Date.now();
      suppressWindowFocusHide(5000);
    }
    return;
  }
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
  if (field === "triggerThreshold") {
    const thresholdValue = Number(control.value);
    const valueDisplay = card.querySelector("[data-trigger-threshold-value]");
    if (valueDisplay instanceof HTMLOutputElement && Number.isFinite(thresholdValue)) {
      valueDisplay.textContent = `${Math.round(thresholdValue)} dBFS`;
    }
    if (event.type === "change") {
      finishManagedRangeInteraction();
    }
  }
  if (field === 'triggerMode') {
    renderManagedBridgePorts();
    requestBridgeWindowResize();
  }
  if (event.type === "change") {
    scheduleManagedPortAutoSave(portKey);
  }
}

function startManagedRangeInteraction(event) {
  const control = event.target;
  if (!(control instanceof HTMLInputElement) || control.type !== "range") return;
  if (!control.matches('[data-field="triggerThreshold"]')) return;
  managedRangeInteractionActive = true;
  lastManagedRangeFocusSuppressionAt = Date.now();
  suppressWindowFocusHide(5000);
}

function finishManagedRangeInteraction() {
  if (!managedRangeInteractionActive) return;
  managedRangeInteractionActive = false;
  suppressWindowFocusHide(750);
  window.requestAnimationFrame(renderManagedBridgePorts);
}

function renderManagedVideoControls(port, draft) {
  if (port.kind !== 'feed') return '';
  const sources = currentInventory?.videoSources || [];
  const options = [{ id: '', name: 'Off' }, ...sources];
  if (draft.videoSource && !sources.some(source => source.id === draft.videoSource)) {
    options.push({ id: draft.videoSource, name: `${draft.videoSource} (saved, unavailable)` });
  }
  return `<label class="field-group managed-video-source">Video source (optional)
    <select data-field="videoSource">${options.map(source => `<option value="${escapeHtml(source.id)}"${source.id === draft.videoSource ? ' selected' : ''}>${escapeHtml(source.name)}</option>`).join('')}</select></label>`;
}

function renderManagedBridgePorts() {
  if (managedAudioPopover || targetPicker.isOpen()) return;
  const activeElement = document.activeElement;
  const managedControlFocused = (
    activeElement instanceof HTMLElement
    && bridgePorts?.contains(activeElement)
    && activeElement.matches("select, input, textarea")
  );
  if (managedRangeInteractionActive || managedControlFocused) return;
  const configuredPorts = managedBridgeConfig?.ports ?? [];
  if (!managedBridgeConfig) {
    const html = '<div class="empty-state">Connect to the server to load bridge endpoints.</div>';
    if (html !== lastManagedBridgePortsHtml) {
      bridgePorts.innerHTML = html;
      lastManagedBridgePortsHtml = html;
    }
    requestBridgeWindowResize();
    return;
  }
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
    const hasOutput = bridgePortHasOutput(port);
    const draft = getManagedPortDraft(port);
    const editState = managedPortEditStates.get(key) || {};
    const state = editState.saving
      ? { label: "Saving", className: "warning" }
      : getManagedSessionState(session, port);
    const sessionError = (session?.error || session?.inputError) !== state.label
      ? (session?.error || session?.inputError || "")
      : "";
    return `
      <article class="managed-port-card" data-managed-port-key="${escapeHtml(key)}">
      <div class="managed-port-title">
        <div class="managed-port-identity">
          <strong>${escapeHtml(port.label)}</strong>
          <small class="managed-port-kind">${escapeHtml(port.kind === "feed" ? "Feed" : "User")}</small>
        </div>
        <div class="managed-port-actions">
          <span class="managed-port-state ${escapeHtml(state.className)}">${escapeHtml(state.label)}</span>
        </div>
      </div>
      <div class="managed-port-routing-grid">
        ${renderManagedAssignmentControls(port, "input", draft.input)}
        ${hasOutput ? renderManagedAssignmentControls(port, "output", draft.output) : ""}
        ${renderManagedVideoControls(port, draft)}
      </div>
      ${renderManagedTriggerControls(port, draft)}
      ${hasOutput || port.kind === "user" ? `<div class="managed-port-status-row">
        ${hasOutput ? `<small>${escapeHtml(formatManagedReturnPathStatus(session))}</small>` : "<span></span>"}
        ${port.kind === "user" ? `<small class="managed-port-input-level" data-managed-input-level${draft.trigger?.mode === "audio-level" ? "" : " hidden"}>Input level: waiting…</small>` : ""}
      </div>` : ""}
      ${port.kind === "feed" && port.videoSource ? `<small>Video: ${escapeHtml(session?.videoError || (session?.videoFrames ? "Live" : "Waiting for source…"))}</small>` : ""}
      ${sessionError ? `<div class="managed-port-error">${escapeHtml(sessionError)}</div>` : ""}
      ${editState.error ? `<div class="managed-port-error">${escapeHtml(editState.error)}</div>` : ""}
      </article>
    `;
  }).join("");

  if (html !== lastManagedBridgePortsHtml) {
    bridgePorts.innerHTML = html;
    lastManagedBridgePortsHtml = html;
    for (const port of configuredPorts.filter(port => port.kind === 'user')) {
      const card = getManagedPortElement(bridgePortKey(port));
      const picker = card?.querySelector('[data-managed-target-picker]');
      if (!picker) continue;
      const draft = getManagedPortDraft(port);
      targetPicker.mount(picker, buildManagedTriggerTargetOptions(port, draft.trigger),
        bridgeTalkTrigger.targets(draft.trigger?.targets).map(target => `${target.type}:${target.id}`), () => {
          updateManagedPortDraftFromElement(card);
          scheduleManagedPortAutoSave(bridgePortKey(port));
          requestBridgeWindowResize();
        });
    }
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
    speakerName: producerPayload.speakerName || null,
    startedAt: Date.now(),
    decodedFrames: 0,
    decodedBytes: 0,
    lastDecodedAt: 0
  };
  session.outputs.set(producerId, output);
  renderManagedBridgePorts();

  try {
    const reserved = await invoke("reserve_bridge_output", {
      request: {
        streamId,
        assignment: session.port.output,
        audioLevel: getManagedAudioLevel(session.port, 'output')
      }
    });
    const consumer = await bridgeApi("POST", managedSessionPath(session, "/consumers"), {
      producerId,
      port: reserved.port,
      rtpHandshake: true
    });
    output.consumerId = consumer.id;
    const codec = (consumer.rtpParameters?.codecs || []).find((entry) =>
      String(entry.mimeType || "").toLowerCase() === "audio/opus"
    ) || consumer.rtpParameters?.codecs?.[0];
    if (!codec) throw new Error("Server returned no audio codec for bridge consumer");
    const returnTransport = consumer.transport;
    const handshake = returnTransport?.ip && Number(returnTransport?.port) > 0
      ? {
          handshakeIp: returnTransport.ip,
          handshakePort: Number(returnTransport.port)
        }
      : {};
    await invoke("activate_bridge_output", {
      request: {
        streamId,
        payloadType: Number(codec.payloadType || 100),
        clockRate: Number(codec.clockRate || 48000),
        channels: Number(codec.channels || 2),
        fmtp: codecParametersToFmtp(codec.parameters),
        ...handshake
      }
    });
    await bridgeApi(
      "POST",
      managedSessionPath(session, `/consumers/${encodeURIComponent(consumer.id)}/resume`),
      {}
    );
    await applyManagedOutputAudioState(session, output);
    await applyManagedPortAudioLevel(session.port, 'output');
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

function getManagedTriggerTargets(port) {
  if (!['audio-level', 'always-on'].includes(port?.trigger?.mode)) return [];
  const targets = bridgeTalkTrigger.fromTrigger(port?.trigger);
  if (!Array.isArray(port?.triggerTargets)) return targets;
  const allowed = new Set(port.triggerTargets.map(target => `${target.type}:${target.id}`));
  return targets.filter(target => allowed.has(`${target.type}:${target.id}`));
}

function managedTalkTargetsMatch(currentTargets, nextTargets) {
  return bridgeTalkTrigger.matches(currentTargets, nextTargets);
}

async function ensureManagedAlwaysOn(session) {
  if (session.port.kind !== 'user' || session.port.trigger?.mode !== 'always-on'
    || !session.ready || session.starting || !session.inputReady || !session.producerId
    || session.automaticReleaseRequired) return;
  const targets = getManagedTriggerTargets(session.port);
  if (!targets.length) {
    if (session.talking && session.talkSource === 'always-on') {
      await applyManagedTalkState(session, { talking: false, targets: [], preserveAlwaysOn: false });
    }
    return;
  }
  const current = new Set((session.targets || []).map(target => `${target.type}:${target.id}`));
  if (session.talking && targets.every(target => current.has(`${target.type}:${target.id}`))) return;
  await applyManagedTalkState(session, { talking: true, targets, source: 'always-on' });
}

async function syncManagedAutomaticTalk(session) {
  if (session.automaticReleaseRequired) {
    await applyManagedTalkState(session, { talking: false, targets: [], preserveAlwaysOn: false });
    session.automaticReleaseRequired = false;
  }
  await ensureManagedAlwaysOn(session);
  if (session.automaticRetryAt) {
    session.error = null;
    session.statusLabel = null;
    session.automaticRetryAt = 0;
  }
}

function getManagedLevelTriggerThreshold(port) {
  const threshold = Number(port?.trigger?.thresholdDb);
  if (!Number.isFinite(threshold)) return MANAGED_LEVEL_TRIGGER_DEFAULT_THRESHOLD_DB;
  return Math.max(MANAGED_LEVEL_TRIGGER_MIN_THRESHOLD_DB, Math.min(MANAGED_LEVEL_TRIGGER_MAX_THRESHOLD_DB, threshold));
}

function isManagedLevelTriggerEnabled(port) {
  return port?.kind === "user" && port?.trigger?.mode === "audio-level";
}

function getManagedEffectiveTriggerPort(session) {
  // Only saved configuration may open a microphone automatically. Incomplete
  // edits (especially a new mode with no targets yet) stay in the form draft.
  return session?.port;
}

function isManagedLevelTriggerEnabledForSession(session) {
  return isManagedLevelTriggerEnabled(getManagedEffectiveTriggerPort(session));
}

async function disableManagedLevelTrigger(session, { forceRelease = false } = {}) {
  const state = session.levelTriggerState || {
    active: false,
    aboveSince: 0,
    belowSince: 0,
    pending: false,
    revision: 0,
    releaseRequired: false
  };
  session.levelTriggerState = state;
  state.revision = Number(state.revision || 0) + 1;
  state.active = false;
  state.aboveSince = 0;
  state.belowSince = 0;
  if (forceRelease) {
    state.releaseRequired = true;
  }

  try {
    if (
      session.sessionId
      && session.producerId
      && (
        forceRelease
        || state.releaseRequired
        || (session.talking && session.talkSource === "level")
      )
    ) {
      await applyManagedTalkState(session, {
        talking: false,
        targets: [],
        source: "level"
      });
      recordManagedLifecycle(session, "level-trigger-talk-released", "trigger mode disabled");
    }
    state.releaseRequired = false;
  } finally {
    state.pending = false;
  }
}

function getManagedInputLevelMap(status) {
  return new Map((status?.inputStreamStats || []).map((entry) => [
    String(entry.streamId || ""),
    {
      rmsDb: Number(entry.rmsDb ?? entry.rms_db ?? -120),
      capturedFrames: Number(entry.capturedFrames ?? entry.captured_frames ?? NaN)
    }
  ]));
}

function updateManagedInputLevelDisplay(session, inputStats) {
  const card = getManagedPortElement(bridgePortKey(session.port));
  const display = card?.querySelector("[data-managed-input-level]");
  if (!(display instanceof HTMLElement)) return;

  const rmsDb = Number(inputStats?.rmsDb);
  const capturedFrames = Number(inputStats?.capturedFrames);
  const now = Date.now();
  const elapsed = now - Number(session.inputStartedAt || now);
  const muted = getManagedAudioLevel(session.port, 'input').muted;
  const mode = muted ? 'muted'
    : Number.isFinite(capturedFrames) && capturedFrames <= 0
      ? elapsed >= MANAGED_INPUT_ACTIVITY_GRACE_MS ? 'no-input' : 'waiting'
      : !Number.isFinite(rmsDb) ? 'unavailable'
        : elapsed >= MANAGED_INPUT_ACTIVITY_GRACE_MS && rmsDb <= -119.9 ? 'silent' : 'active';
  const previous = session.inputLevelTextUpdate;
  const popoverLabel = managedAudioPopover?.direction === 'input'
    && bridgePortKey(managedAudioPopover.port) === bridgePortKey(session.port)
    ? managedAudioPopover.panel.querySelector('[data-audio-meter-label]') : null;
  if (previous?.display === display && previous.mode === mode
    && now - previous.at < MANAGED_LEVEL_TEXT_REFRESH_MS) {
    if (popoverLabel) popoverLabel.textContent = display.textContent;
    return;
  }
  session.inputLevelTextUpdate = { display, mode, at: now };
  let text;
  let warning = false;

  if (muted) {
    text = Number.isFinite(rmsDb)
      ? `Input level: ${rmsDb.toFixed(1)} dBFS - Muted`
      : 'Input level: Muted';
    warning = true;
  } else if (Number.isFinite(capturedFrames) && capturedFrames <= 0) {
    text = elapsed >= MANAGED_INPUT_ACTIVITY_GRACE_MS
      ? "No input audio - check microphone permission"
      : "Input level: waiting…";
    warning = elapsed >= MANAGED_INPUT_ACTIVITY_GRACE_MS;
  } else if (!Number.isFinite(rmsDb)) {
    text = "Input level unavailable";
    warning = true;
  } else {
    text = `Input level: ${rmsDb.toFixed(1)} dBFS`;
    if (elapsed >= MANAGED_INPUT_ACTIVITY_GRACE_MS && rmsDb <= -119.9) {
      text += " - check device and channels";
      warning = true;
    }
  }
  display.textContent = text;
  display.classList.toggle('warning', warning);
  if (popoverLabel) popoverLabel.textContent = text;
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

async function performManagedTalkState(session, { talking, targets, lockActive = false, source = "external", preserveAlwaysOn = true }) {
  if (session.port.kind === "feed") {
    throw new Error("Feed bridge ports do not support talk state");
  }
  if (preserveAlwaysOn && session.port.trigger?.mode === 'always-on') {
    const automatic = getManagedTriggerTargets(session.port);
    // A manual press/release must not close the permanently configured route.
    targets = bridgeTalkTrigger.targets([...(talking ? targets : []), ...automatic]);
    talking = targets.length > 0;
    if (talking && bridgeTalkTrigger.matches(targets, automatic)) {
      source = 'always-on';
      lockActive = false;
    }
  }
  if (talking) {
    if (!session.inputReady || !session.producerId) {
      throw new Error(session.inputError || "Input device is unavailable");
    }
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
    if (session.producerId) {
      await bridgeApi(
        "POST",
        managedSessionPath(session, `/producers/${encodeURIComponent(session.producerId)}/pause`),
        {}
      );
    }
    await bridgeApi("POST", managedSessionPath(session, "/talk-state"), {
      talking: false,
      targets: [],
      lockActive: false
    });
  }
  session.talking = Boolean(talking);
  session.talkSource = talking ? source : null;
  if (source !== "panel") session.panelBaseTalkState = null;
  if (source !== "level" && session.levelTriggerState) {
    session.levelTriggerState.revision = Number(session.levelTriggerState.revision || 0) + 1;
    session.levelTriggerState.active = false;
    session.levelTriggerState.aboveSince = 0;
    session.levelTriggerState.belowSince = 0;
    session.levelTriggerState.pending = false;
    session.levelTriggerState.releaseRequired = false;
  }
  session.lockActive = Boolean(lockActive && talking);
  session.targets = talking ? targets : [];
  renderManagedBridgePorts();
  return true;
}

function applyManagedTalkState(session, request) {
  const operation = async () => {
    if (
      request?.talking
      && request?.source === "level"
      && !isManagedLevelTriggerEnabledForSession(session)
    ) {
      recordManagedLifecycle(session, "level-trigger-start-skipped", "trigger mode is no longer audio-level");
      return false;
    }
    if (request?.talking && ['always-on', 'level'].includes(request.source)) {
      if (request.source === 'always-on' && session.port.trigger?.mode !== 'always-on') return false;
      request = { ...request, targets: getManagedTriggerTargets(session.port) };
      if (!request.targets.length) return false;
    }
    return performManagedTalkState(session, request);
  };

  const queued = (session.talkStateQueue || Promise.resolve())
    .catch(() => {})
    .then(operation);
  session.talkStateQueue = queued;
  return queued;
}

async function applyManagedCompanionTalkState(session, request) {
  const panelTargets = [...(session.panelTalkLocks?.values() || []), ...(session.panelTalkInputs?.values() || [])];
  if (!panelTargets.length) {
    session.panelBaseTalkState = null;
    return applyManagedTalkState(session, request);
  }
  // Companion owns the underlying external intent. Updating it while a panel
  // holds Talk must not interrupt that hold or restore a released Companion input.
  session.panelBaseTalkState = {
    targets: request.talking ? request.targets : [], lockActive: Boolean(request.lockActive), source: "external",
  };
  const base = session.panelBaseTalkState;
  const targets = [...new Map([...base.targets, ...panelTargets].map(target => [`${target.type}:${target.id}`, target])).values()];
  return applyManagedTalkState(session, {
    talking: targets.length > 0, targets, source: "panel",
    lockActive: Boolean(session.panelTalkLocks?.size) || (base.lockActive && base.targets.length > 0),
  });
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
      await applyManagedCompanionTalkState(session, { talking: false, targets: [] });
      await sendManagedCommandResult(session, payload, {
        ok: true,
        talking: session.talking,
        lockActive: session.lockActive
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

    if (payload.action === "lock-toggle" && (session.panelBaseTalkState?.lockActive ?? session.lockActive)) {
      await applyManagedCompanionTalkState(session, { talking: false, targets: [] });
      await sendManagedCommandResult(session, payload, {
        ok: true,
        talking: session.talking,
        lockActive: session.lockActive
      });
      return;
    }

    if (payload.action === "press" || payload.action === "lock-toggle") {
      if (!session.inputReady || !session.producerId) {
        await sendManagedCommandResult(session, payload, {
          ok: false,
          reason: "input-device-unavailable"
        });
        return;
      }
      const lockActive = payload.action === "lock-toggle";
      await applyManagedCompanionTalkState(session, { talking: true, targets, lockActive });
      await sendManagedCommandResult(session, payload, {
        ok: true,
        talking: session.talking,
        lockActive: session.lockActive,
        target: session.targets[0],
        targets: session.targets
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

function getManagedPanelReport(session) {
  return {
    revision: Number(session.panelSettings?.revision) || 0,
    storage: session.panelSettings?.storage || {},
    audioStates: [...session.targetAudioStates.values()].map(({ targetType, targetId, volume, muted }) => ({ targetType, targetId, volume, muted })),
    runtime: {
      devices: [], outputSupported: false,
      talking: session.talking, targets: session.targets || [],
      lockedTargets: session.lockActive ? session.targets || [] : [],
    },
  };
}

async function handleManagedPanelCommand(session, payload) {
  try {
    if (payload.kind !== 'talk') session.panelSettings = payload.panelSettings || session.panelSettings;
    if (payload.kind === 'target-audio') {
      const state = normalizeManagedTargetAudioState(payload.audio);
      if (!state) throw new Error('Invalid audio target');
      session.targetAudioStates.set(state.key, state);
      await applyManagedTargetAudioState(session, state);
    } else if (payload.kind === 'preferences') {
      if (Object.keys(payload.patch || {}).some(key => key.startsWith('preferredAudio'))) {
        throw new Error('Bridge audio devices are configured in Admin Users');
      }
      for (const output of session.outputs.values()) await applyManagedOutputAudioState(session, output);
    } else if (payload.kind === 'talk') {
      if (!(session.panelTalkInputs instanceof Map)) session.panelTalkInputs = new Map();
      if (!(session.panelTalkLocks instanceof Map)) session.panelTalkLocks = new Map();
      if (payload.action === 'stop') {
        session.panelTalkInputs.clear(); session.panelTalkLocks.clear(); session.panelBaseTalkState = null;
        await applyManagedTalkState(session, { talking: false, targets: [] });
      } else {
        const targets = resolveBridgeCommandTargets(session, payload);
        const target = targets[0];
        const key = target ? `${target.type}:${target.id}` : '';
        if (payload.action === 'press' || payload.action === 'lock') {
          if (!target) throw new Error('Talk target is not available');
          if (!session.inputReady || !session.producerId) throw new Error('Input device is unavailable');
          if (!session.panelBaseTalkState) session.panelBaseTalkState = {
            targets: session.talkSource !== 'panel' && session.talking ? [...session.targets] : [],
            lockActive: session.lockActive, source: session.talkSource || "external",
          };
          if (payload.action === 'press') session.panelTalkInputs.set(payload.inputKey, target);
          else session.panelTalkLocks.set(key, target);
        } else if (payload.action === 'release') {
          if (!session.panelTalkInputs.has(payload.inputKey)) return sendManagedCommandResult(session, payload, { ok: true, report: getManagedPanelReport(session) });
          session.panelTalkInputs.delete(payload.inputKey);
          if (session.talkSource !== 'panel') return sendManagedCommandResult(session, payload, { ok: true, report: getManagedPanelReport(session) });
        } else if (payload.action === 'unlock') {
          session.panelTalkLocks.delete(key);
          if (session.panelBaseTalkState) session.panelBaseTalkState.targets = session.panelBaseTalkState.targets.filter(entry => `${entry.type}:${entry.id}` !== key);
          else if (session.lockActive) await applyManagedTalkState(session, { talking: false, targets: [] });
        }
        const base = session.panelBaseTalkState || { targets: [], lockActive: false };
        const all = new Map([...base.targets, ...session.panelTalkLocks.values(), ...session.panelTalkInputs.values()].map(target => [`${target.type}:${target.id}`, target]));
        await applyManagedTalkState(session, {
          talking: all.size > 0, targets: [...all.values()],
          lockActive: session.panelTalkLocks.size > 0 || (base.lockActive && base.targets.length > 0),
          source: session.panelTalkInputs.size || session.panelTalkLocks.size ? 'panel' : base.source || 'external',
        });
        if (!session.panelTalkInputs.size && !session.panelTalkLocks.size) session.panelBaseTalkState = null;
      }
    } else if (payload.kind === 'audio-settings') {
      return sendManagedCommandResult(session, payload, { ok: true, message: 'Saved for browser client', report: getManagedPanelReport(session) });
    } else if (payload.kind === 'production') {
      throw new Error('Bridge routing is configured in Admin Users');
    }
    await sendManagedCommandResult(session, payload, { ok: true, report: getManagedPanelReport(session) });
    renderManagedBridgePorts();
  } catch (error) {
    await sendManagedCommandResult(session, payload, { ok: false, reason: error.message, report: getManagedPanelReport(session) });
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
      renderManagedBridgePorts();
      break;
    case "panel-command":
      await handleManagedPanelCommand(session, payload);
      break;
    case "panel-state-request":
      await sendManagedCommandResult(session, {}, { ok: true, report: getManagedPanelReport(session) });
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
    recordManagedLifecycle(session, "event-stream-open", "native");
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
      recordManagedLifecycle(session, "event-stream-session-closed", reason);
      setManagedSessionError(session, new Error(reason));
      session.ready = false;
      renderManagedBridgePorts();
    }
    return;
  }

  if (payload.event === "error") {
    session.eventStreamActive = false;
    recordManagedLifecycle(session, "event-stream-error", payload.error || "Bridge event stream failed");
    setManagedSessionError(session, payload.error || "Bridge event stream failed");
    renderManagedBridgePorts();
    return;
  }

  if (payload.event === "closed") {
    nativeEventStreamSessions.delete(payload.streamId);
    session.eventStreamId = null;
    session.eventStreamActive = false;
    recordManagedLifecycle(session, "event-stream-closed", "native");
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
      path: managedSessionPath(session, "/events/stream"),
      inputStreamId: session.inputStreamId,
      outputStreamPrefix: `${session.port.id}:consumer:`
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

  let nativeMediaStatus = null;
  if (invoke) {
    nativeMediaStatus = await invoke("get_bridge_media_status").catch((error) => {
      console.warn("failed to collect Bridge media diagnostics", error);
      return null;
    });
  }
  const inputStatsById = new Map((nativeMediaStatus?.inputStreamStats || []).map((entry) => [
    String(entry.streamId || ""),
    entry
  ]));
  const outputStatsById = new Map((nativeMediaStatus?.outputStreamStats || []).map((entry) => [
    String(entry.streamId || ""),
    entry
  ]));

  for (const session of sessions) {
    try {
      const input = inputStatsById.get(session.inputStreamId) || null;
      const outputs = [...session.outputs.values()]
        .map((output) => outputStatsById.get(output.streamId))
        .filter(Boolean);
      const heartbeatStartedAt = performance.now();
      await bridgeApi("POST", managedSessionPath(session, "/heartbeat"), {
        // Native event streams report media health independently of WebView
        // timer throttling. Keep this fallback for browser/EventSource mode.
        mediaDiagnostics: session.eventStreamId
          ? null
          : (input || outputs.length ? { input, outputs } : null),
        networkStats: Number.isFinite(session.lastHeartbeatRoundTripMs)
          && performance.now() - session.lastHeartbeatMeasuredAt < 30_000
          ? { roundTripMs: session.lastHeartbeatRoundTripMs }
          : null,
        lifecycleEvents: session.lifecycleEvents?.splice(0) || []
      });
      session.lastHeartbeatRoundTripMs = Math.round(performance.now() - heartbeatStartedAt);
      session.lastHeartbeatMeasuredAt = performance.now();
      if (session.error && session.statusLabel === "Server offline") {
        session.error = null;
        session.statusLabel = null;
      }
    } catch (error) {
      if (!session.sessionId) continue;
      if (String(error?.message || error || "").toLowerCase().includes("bridge session not found")) {
        await stopManagedSession(session, { remove: false, reason: "heartbeat-session-not-found" });
      } else {
        recordManagedLifecycle(session, "heartbeat-error", String(error?.message || error));
        session.ready = false;
      }
      setManagedSessionError(session, error);
    }
  }
}

async function refreshManagedInputLevelsDuringTransition() {
  if (managedLevelDisplayRefreshRunning || !invoke || Date.now() - lastManagedLevelDisplayRefreshAt < 100) return;
  managedLevelDisplayRefreshRunning = true;
  lastManagedLevelDisplayRefreshAt = Date.now();
  try {
    const levels = getManagedInputLevelMap(await invoke("get_bridge_media_status"));
    for (const session of managedSessions.values()) {
      if (session.ready && session.inputReady && isManagedLevelTriggerEnabledForSession(session)) {
        updateManagedInputLevelDisplay(session, levels.get(session.inputStreamId));
      }
    }
  } catch {
    // The regular trigger poll reports native media errors.
  } finally {
    managedLevelDisplayRefreshRunning = false;
  }
}

async function processManagedLevelTriggers() {
  if (managedLevelTriggerRunning) {
    if (Date.now() - managedLevelTriggerStartedAt >= 150) {
      refreshManagedInputLevelsDuringTransition();
    }
    return;
  }
  if (!invoke || !managedSessions.size) return;
  const sessions = [...managedSessions.values()].filter((session) => (
    session.ready
    && session.inputReady
    && !session.starting
    && (isManagedLevelTriggerEnabledForSession(session) || session.port.trigger?.mode === 'always-on' || session.automaticReleaseRequired)
  ));
  if (!sessions.length) return;

  managedLevelTriggerRunning = true;
  managedLevelTriggerStartedAt = Date.now();
  try {
    const status = await invoke("get_bridge_media_status");
    await auditManagedNativeMediaStatus(status);

    const levels = getManagedInputLevelMap(status);
    const now = Date.now();

    for (const session of sessions) {
      if (!session.ready || session.starting || !session.inputReady) continue;
      if (session.port.trigger?.mode === 'always-on' || session.automaticReleaseRequired) {
        if (session.automaticRetryAt > Date.now()) continue;
        try {
          await syncManagedAutomaticTalk(session);
        } catch (error) {
          session.automaticRetryAt = Date.now() + 1000;
          setManagedSessionError(session, error);
        }
        continue;
      }
      if (!isManagedLevelTriggerEnabledForSession(session)) {
        await disableManagedLevelTrigger(session).catch((error) => {
          setManagedSessionError(session, error);
        });
        continue;
      }
      const effectivePort = getManagedEffectiveTriggerPort(session);
      const triggerTargets = getManagedTriggerTargets(effectivePort);
      const state = session.levelTriggerState || {
        active: false,
        aboveSince: 0,
        belowSince: 0,
        pending: false,
        revision: 0,
        releaseRequired: false
      };
      session.levelTriggerState = state;
      const inputStats = levels.get(session.inputStreamId);
      updateManagedInputLevelDisplay(session, inputStats);
      if (state.pending) continue;
      const triggerRevision = Number(state.revision || 0);
      const levelDb = Number(inputStats?.rmsDb);

      if (!triggerTargets.length) {
        if (state.active && session.talking && session.talkSource === "level") {
          state.pending = true;
          try {
            await applyManagedTalkState(session, { talking: false, targets: [], source: "level" });
          } catch (error) {
            setManagedSessionError(session, error);
          } finally {
            state.active = false;
            state.aboveSince = 0;
            state.belowSince = 0;
            state.pending = false;
          }
        }
        continue;
      }

      if (!Number.isFinite(levelDb)) continue;
      const thresholdDb = getManagedLevelTriggerThreshold(effectivePort);

      if (levelDb >= thresholdDb) {
        state.belowSince = 0;
        if (!state.aboveSince) state.aboveSince = now;
        if (
          !state.active
          && !session.talking
          && now - state.aboveSince >= MANAGED_LEVEL_TRIGGER_ATTACK_MS
        ) {
          state.pending = true;
          try {
            const started = await applyManagedTalkState(session, {
              talking: true,
              targets: triggerTargets,
              source: "level"
            });
            if (
              started
              && isManagedLevelTriggerEnabledForSession(session)
              && Number(state.revision || 0) === triggerRevision
            ) {
              state.active = true;
              state.belowSince = 0;
            } else {
              if (session.talking && session.talkSource === "level") {
                await applyManagedTalkState(session, {
                  talking: false,
                  targets: [],
                  source: "level"
                });
              }
              state.active = false;
              state.aboveSince = 0;
              state.belowSince = 0;
            }
          } catch (error) {
            setManagedSessionError(session, error);
          } finally {
            state.pending = false;
          }
        }
        continue;
      }

      state.aboveSince = 0;
      if (!state.active) continue;
      if (!state.belowSince) state.belowSince = now;
      if (now - state.belowSince < MANAGED_LEVEL_TRIGGER_RELEASE_MS) continue;

      state.pending = true;
      try {
        if (session.talking && session.talkSource === "level") {
          await applyManagedTalkState(session, {
            talking: false,
            targets: [],
            source: "level"
          });
        }
        state.active = false;
        state.aboveSince = 0;
      } catch (error) {
        setManagedSessionError(session, error);
      } finally {
        state.pending = false;
      }
    }
  } catch (error) {
    // Status polling errors are handled by the regular managed sync loop.
  } finally {
    managedLevelTriggerRunning = false;
    managedLevelTriggerStartedAt = 0;
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
    inputReady: false,
    inputStarting: false,
    inputStartedAt: 0,
    inputError: null,
    inputRetryAt: null,
    inputRetryable: true,
    outputEndpointId: null,
    outputs: new Map(),
    ready: false,
    talking: false,
    talkSource: null,
    lockActive: false,
    targets: [],
    replyTarget: null,
    addressedNow: [],
    targetAudioStates: new Map(),
    levelTriggerState: {
      active: false,
      aboveSince: 0,
      belowSince: 0,
      pending: false,
      revision: 0,
      releaseRequired: false
    },
    eventStreamId: null,
    eventSource: null,
    eventStreamActive: false,
    eventQueue: Promise.resolve(),
    talkStateQueue: Promise.resolve(),
    retryAt: null,
    retryable: true,
    statusLabel: null,
    starting: false,
    backgroundRetry: false,
    error: null,
    lifecycleEvents: []
  };
}

async function startManagedInputPath(session, { reason = "input-start" } = {}) {
  if (session.port.kind === 'feed' && !session.port.input?.deviceId && session.port.videoSource) return false;
  if (session.inputReady || session.inputStarting) return session.inputReady;
  if (!session.sessionId) throw new Error("Bridge session is not ready for input");

  if (currentInventory?.devices?.length) {
    const unavailableReason = getManagedAssignmentUnavailableReason("input", session.port.input);
    if (unavailableReason) {
      setManagedInputError(session, new Error(unavailableReason));
      return false;
    }
  }

  session.inputStarting = true;
  session.inputRetryAt = null;
  try {
    const transport = await bridgeApi(
      "POST",
      managedSessionPath(session, "/plain-send-transport"),
      {}
    );
    const rtp = buildProducerRtpParameters(transport);
    await invoke("start_bridge_input", {
      request: {
        streamId: session.inputStreamId,
        assignment: session.port.input,
        rtpIp: transport.ip,
        rtpPort: Number(transport.port),
        payloadType: rtp.payloadType,
        ssrc: rtp.ssrc,
        audioLevel: getManagedAudioLevel(session.port, 'input')
      }
    });
    session.inputStartedAt = Date.now();
    const producer = await bridgeApi("POST", managedSessionPath(session, "/producers"), rtp);
    session.producerId = producer.id;
    session.inputReady = true;
    clearManagedInputError(session);
    recordManagedLifecycle(session, "producer-started", `reason=${reason}`);
    await ensureManagedAlwaysOn(session);
    return true;
  } catch (error) {
    await invoke("stop_bridge_input", { streamId: session.inputStreamId }).catch(() => {});
    session.producerId = null;
    session.inputStartedAt = 0;
    session.inputReady = false;
    const classified = classifyManagedPortError(error);
    if (["Server offline", "Reconnecting", "Session replaced"].includes(classified.label)) {
      throw error;
    }
    setManagedInputError(session, error);
    return false;
  } finally {
    session.inputStarting = false;
  }
}

async function stopManagedVideoPath(session) {
  if (session.port.kind !== "feed") return;
  session.videoRevision = (session.videoRevision || 0) + 1;
  await invoke('stop_bridge_video', { streamId: `${session.port.id}:video` }).catch(() => {});
  if (session.sessionId) await bridgeApi('DELETE', managedSessionPath(session, '/video')).catch(() => {});
  session.videoProducerId = null;
  session.videoFrames = 0;
  session.videoPublished = false;
  session.videoStartedAt = 0;
}

async function startManagedVideoPath(session) {
  if (session.port.kind !== 'feed' || !session.port.videoSource || !session.sessionId || session.videoStarting || session.videoProducerId) return;
  session.videoStarting = true;
  const revision = session.videoRevision || 0;
  const sourceId = session.port.videoSource;
  const path = managedSessionPath(session);
  const active = () => revision === (session.videoRevision || 0) && session.sessionId && session.port.videoSource === sourceId;
  try {
    const transport = await bridgeApi('POST', path + '/video-send-transport', {});
    if (!active()) { await bridgeApi('DELETE', path + '/video').catch(() => {}); return; }
    const producer = await bridgeApi('POST', path + '/video-producer', {});
    if (!active()) { await bridgeApi('DELETE', path + '/video').catch(() => {}); return; }
    await invoke('start_bridge_video', { request: { streamId: `${session.port.id}:video`, sourceId,
      rtpIp: transport.ip, rtpPort: transport.port, payloadType: transport.payloadType, ssrc: transport.ssrc, cname: transport.cname } });
    if (!active()) { await stopManagedVideoPath(session); return; }
    session.videoProducerId = producer.id;
    session.videoStartedAt = Date.now();
    session.videoError = null;
  } catch (error) {
    if (active()) {
      await stopManagedVideoPath(session);
      session.videoError = String(error?.message || error);
      session.videoRetryAt = Date.now() + 5000;
    }
  } finally { session.videoStarting = false; }
}

async function auditManagedVideoStatus() {
  const feeds = [...managedSessions.values()].filter(session => session.ready && session.port.kind === 'feed' && session.port.videoSource);
  if (!feeds.length) return;
  const statuses = await withTimeout(invoke('get_bridge_video_status'), 3000, 'Video status');
  for (const session of feeds) {
    if (session.videoStarting) continue;
    if (!session.videoProducerId) {
      if (!session.videoRetryAt || session.videoRetryAt <= Date.now()) await startManagedVideoPath(session);
      continue;
    }
    const status = statuses.find(entry => entry.streamId === `${session.port.id}:video`);
    const stalled = Date.now() - session.videoStartedAt > 10000
      && (!status?.encodedFrames || status.lastFrameAgeMs > 5000);
    if (status?.error || !status?.running || stalled) {
      await stopManagedVideoPath(session);
      session.videoError = status?.error || 'Source unavailable; reconnecting…';
      session.videoRetryAt = Date.now() + 5000;
    } else {
      session.videoFrames = status.encodedFrames;
      if (session.videoFrames > 0 && !session.videoPublished) {
        await bridgeApi('POST', managedSessionPath(session, `/producers/${session.videoProducerId}/resume`), {});
        session.videoPublished = true;
      }
    }
  }
}

async function startManagedSession(port, { reuse = false, silentRetry = false, reason = "initial-start" } = {}) {
  const key = bridgePortKey(port);
  const existingSession = managedSessions.get(key);
  const session = reuse && existingSession ? existingSession : createManagedSession(port);
  const backgroundRetry = Boolean(silentRetry && reuse && existingSession && existingSession.error && !existingSession.ready);
  if (existingSession && existingSession !== session) {
    await stopManagedSession(existingSession, { reason: "replaced-by-new-session" });
  }
  if (session.sessionId || session.ready || session.outputs?.size) {
    await stopManagedSession(session, { remove: false, reason: `restart-before-start:${reason}` });
  }
  session.port = port;
  session.signature = bridgePortSignature(port);
  session.inputStreamId = `${port.id}:input`;
  session.outputs = session.outputs instanceof Map ? session.outputs : new Map();
  session.levelTriggerState = session.levelTriggerState || {
    active: false,
    aboveSince: 0,
    belowSince: 0,
    pending: false,
    revision: 0,
    releaseRequired: false
  };
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
  recordManagedLifecycle(session, "start-requested", reason);
  if (!backgroundRetry) {
    renderManagedBridgePorts();
  }

  try {
    const outputUnavailableReason = getManagedOutputUnavailableReason(port);
    if (outputUnavailableReason) {
      throw new Error(outputUnavailableReason);
    }
    const registered = await bridgeApi("POST", "/api/v1/bridge/sessions", {
      bridgeId: managedBridgeConfig.bridgeId,
      portId: port.id,
      userId: port.kind === "feed" ? null : port.userId,
      feedId: port.kind === "feed" ? port.feedId : null
    });
    session.sessionId = registered.sessionId;
    session.panelSettings = registered.panelSettings || { revision: 0, storage: {} };
    for (const rawState of registered.targetAudioStates || []) {
      const state = normalizeManagedTargetAudioState(rawState);
      if (state) session.targetAudioStates.set(state.key, state);
    }
    recordManagedLifecycle(session, "session-created", `reason=${reason}`);
    await startManagedInputPath(session, { reason });
    if (bridgePortHasPersistentNetworkOutput(port)) {
      session.outputEndpointId = `${port.id}:network-output`;
      await invoke("ensure_bridge_output_endpoint", {
        request: {
          endpointId: session.outputEndpointId,
          assignment: port.output
        }
      });
    }
    session.ready = true;
    await startManagedVideoPath(session);
    recordManagedLifecycle(
      session,
      "session-ready",
      `reason=${reason} input=${session.inputReady ? "ready" : "unavailable"}`
    );
    await startManagedEventStream(session);
    if (bridgePortHasOutput(port)) {
      const active = await bridgeApi("GET", managedSessionPath(session, "/active-producers"));
      for (const producerPayload of active.producers || []) {
        if (producerPayload?.retainOnly) continue;
        await startManagedConsumer(session, producerPayload);
      }
    }
    session.retryAt = null;
    session.retryable = true;
    session.error = null;
    session.statusLabel = null;
  } catch (error) {
    await stopManagedSession(session, { remove: false, reason: `start-failed:${String(error?.message || error)}` });
    setManagedSessionError(session, error);
  } finally {
    session.starting = false;
    session.backgroundRetry = false;
    await ensureManagedAlwaysOn(session).catch(error => setManagedSessionError(session, error));
    renderManagedBridgePorts();
  }
}

async function stopManagedSession(session, { remove = true, reason = "client-stop" } = {}) {
  stopManagedEventStream(session);
  await stopManagedVideoPath(session);
  for (const output of [...session.outputs.values()]) {
    await stopManagedConsumer(session, output).catch(() => {});
  }
  if (session.outputEndpointId) {
    await invoke("release_bridge_output_endpoint", {
      endpointId: session.outputEndpointId
    }).catch(() => {});
  }
  await invoke("stop_bridge_input", { streamId: session.inputStreamId }).catch(() => {});
  if (session.sessionId) {
    await bridgeApi("DELETE", managedSessionPath(session), { reason }).catch(() => {});
  }
  session.sessionId = null;
  session.producerId = null;
  session.outputEndpointId = null;
  session.inputStartedAt = 0;
  session.inputReady = false;
  session.inputStarting = false;
  session.inputError = null;
  session.inputRetryAt = null;
  session.inputRetryable = true;
  session.outputs.clear();
  session.talking = false;
  session.talkSource = null;
  session.lockActive = false;
  session.targets = [];
  session.panelBaseTalkState = null;
  session.panelTalkInputs?.clear();
  session.panelTalkLocks?.clear();
  session.replyTarget = null;
  session.addressedNow = [];
  if (session.levelTriggerState) {
    session.levelTriggerState.revision = Number(session.levelTriggerState.revision || 0) + 1;
    session.levelTriggerState.active = false;
    session.levelTriggerState.aboveSince = 0;
    session.levelTriggerState.belowSince = 0;
    session.levelTriggerState.pending = false;
    session.levelTriggerState.releaseRequired = false;
  }
  session.automaticReleaseRequired = false;
  session.automaticRetryAt = 0;
  session.ready = false;
  session.starting = false;
  session.backgroundRetry = false;
  if (remove) managedSessions.delete(bridgePortKey(session.port));
}

async function reconcileManagedBridgeConfig(config) {
  managedBridgeConfig = config;
  const wanted = new Map((config?.ports || []).map((port) => [bridgePortKey(port), port]));
  if (managedAudioPopover && !wanted.has(bridgePortKey(managedAudioPopover.port))) closeManagedAudioPopover(false);

  for (const [key, session] of [...managedSessions.entries()]) {
    const nextPort = wanted.get(key);
    if (!nextPort) {
      await stopManagedSession(session, { reason: "port-removed-from-config" });
      continue;
    }
    const nextSignature = bridgePortSignature(nextPort);
    if (nextSignature !== session.signature) {
      await stopManagedSession(session, { reason: "port-config-changed" });
      continue;
    }
    const previousMode = bridgeTalkTrigger.mode(session.port.trigger?.mode);
    const nextMode = bridgeTalkTrigger.mode(nextPort.trigger?.mode);
    const targetsChanged = !managedTalkTargetsMatch(getManagedTriggerTargets(session.port), getManagedTriggerTargets(nextPort));
    const videoChanged = session.port.videoSource !== nextPort.videoSource;
    if (videoChanged) await stopManagedVideoPath(session);
    session.port = nextPort;
    if (videoChanged && session.ready) await startManagedVideoPath(session);
    session.signature = nextSignature;
    await syncManagedPortAudioLevels(nextPort);
    if ((previousMode !== nextMode || targetsChanged) && previousMode !== 'external') {
      // Discard only transient talk state; the new saved automatic route is
      // applied below. Never restore a removed destination from a panel lock.
      session.panelBaseTalkState = null;
      session.panelTalkInputs?.clear();
      session.panelTalkLocks?.clear();
      if (session.levelTriggerState) {
        session.levelTriggerState.revision += 1;
        session.levelTriggerState.active = false;
        session.levelTriggerState.aboveSince = 0;
        session.levelTriggerState.belowSince = 0;
      }
      session.automaticReleaseRequired = true;
    }
    await syncManagedAutomaticTalk(session).catch(error => {
      session.automaticRetryAt = Date.now() + 1000;
      setManagedSessionError(session, error);
    });
  }
  for (const [key, port] of wanted) {
    const session = managedSessions.get(key);
    if (!session) {
      await startManagedSession(port, { reason: "config-initial" });
    } else if (!session.ready && !session.starting && session.retryable !== false && (!session.retryAt || session.retryAt <= Date.now())) {
      await startManagedSession(port, { reuse: true, silentRetry: true, reason: "config-retry" });
    }
  }
  renderManagedBridgePorts();
}

async function refreshManagedInventoryOnly() {
  if (!invoke) return;
  const inventory = await withTimeout(
    invoke("list_audio_devices"),
    AUDIO_INVENTORY_TIMEOUT_MS,
    "Audio device scan"
  );
  managedInventoryWatchRetryAt = 0;
  renderInventory(inventory);
  const [ndiResult, omtResult] = await Promise.allSettled([
    withTimeout(invoke("get_ndi_status"), AUDIO_STATUS_TIMEOUT_MS, "NDI status check"),
    withTimeout(invoke("get_omt_status"), AUDIO_STATUS_TIMEOUT_MS, "OMT status check")
  ]);
  if (ndiResult.status === "fulfilled") {
    renderNdiStatus(ndiResult.value);
  } else {
    renderNdiStatus({ available: false, error: String(ndiResult.reason) });
  }
  if (omtResult.status === "fulfilled") {
    renderOmtStatus(omtResult.value);
  } else {
    renderOmtStatus({ available: false, error: String(omtResult.reason) });
  }
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
  const inputDue = [...managedSessions.values()].filter((session) => (
    session.ready
    && !session.starting
    && !session.inputReady
    && !session.inputStarting
    && session.inputRetryable !== false
    && (!session.inputRetryAt || session.inputRetryAt <= now)
  ));
  if (!due.length && !inputDue.length) {
    renderManagedBridgePorts();
    return;
  }

  managedRetryRunning = true;
  try {
    const portsByKey = new Map((managedBridgeConfig?.ports || []).map((port) => [bridgePortKey(port), port]));
    for (const session of inputDue) {
      const port = portsByKey.get(bridgePortKey(session.port));
      if (!port || bridgePortSignature(port) !== session.signature) continue;
      try {
        await startManagedInputPath(session, { reason: "input-retry" });
      } catch (error) {
        setManagedInputError(session, error);
        if (isServerOfflineError(error)) {
          setManagedSessionError(session, error);
        }
      }
    }
    for (const session of due) {
      const port = portsByKey.get(bridgePortKey(session.port));
      if (!port || bridgePortSignature(port) !== session.signature) continue;
      await startManagedSession(port, { reuse: true, silentRetry: true, reason: "scheduled-retry" });
    }
  } finally {
    managedRetryRunning = false;
    renderManagedBridgePorts();
  }
}

async function syncManagedBridge() {
  if (managedSyncRunning) return;
  // Do not reconnect with a partially edited address or credential. Apart from
  // producing avoidable failures, programmatic connection updates can disturb
  // the text selection in Windows WebView2 while the user is still typing.
  if (isBridgeSettingsControlFocused()) return;
  if (!serverUrlInput.value.trim() || !getBridgeCredential()) return;
  managedSyncRunning = true;
  try {
    await announceBridge({ quiet: true, syncConfig: false });
    const bridgeId = localStorage.getItem(STORAGE_KEYS.bridgeId) || "";
    if (!bridgeId) throw new Error("Bridge announce did not return an ID");
    setServerConnectionState("connected");
    await auditManagedSessionDevices();
    await auditManagedNativeMediaStatus();
    const config = await bridgeApi(
      "GET",
      `/api/v1/bridge/${encodeURIComponent(bridgeId)}/config`
    );
    await reconcileManagedBridgeConfig(config);
    startManagedTimers();
    await heartbeatManagedSessions();
    if (connectionStatus) {
      connectionStatus.textContent = managedSessions.size ? "Connected" : "Announced";
    }
  } catch (error) {
    if (isServerOfflineError(error)) {
      if (connectionStatus) {
        connectionStatus.textContent = "Disconnected";
      }
      setServerConnectionState("disconnected");
    }
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
  if (
    managedInventoryWatchRunning
    || managedSyncRunning
    || !invoke
    || Date.now() < managedInventoryWatchRetryAt
  ) return;
  if (isBridgeSettingsControlFocused()) return;
  if (!serverUrlInput.value.trim() || !getBridgeCredential()) return;

  managedInventoryWatchRunning = true;
  try {
    const snapshot = await withTimeout(
      invoke("get_audio_device_snapshot"),
      AUDIO_INVENTORY_TIMEOUT_MS,
      "Audio device snapshot"
    );
    const nextSnapshotSignature = audioDeviceSnapshotSignature(snapshot);
    managedInventoryWatchRetryAt = 0;
    if (!lastAudioDeviceSnapshotSignature) {
      lastAudioDeviceSnapshotSignature = nextSnapshotSignature;
    } else if (nextSnapshotSignature && nextSnapshotSignature !== lastAudioDeviceSnapshotSignature) {
      const inventory = await refreshManagedInventoryOnly();
      const nextInventorySignature = inventorySignature(inventory);
      if (nextInventorySignature && nextInventorySignature !== lastAnnouncedInventorySignature) {
        await announceBridge({ quiet: true, syncConfig: false });
      }
    }
    await auditManagedSessionDevices();
    await auditManagedNativeMediaStatus();
    await auditManagedVideoStatus();
    renderManagedBridgePorts();
  } catch (error) {
    console.warn("managed inventory watch failed", error);
    if (/audio device snapshot did not respond/i.test(String(error?.message || error))) {
      managedInventoryWatchRetryAt = Date.now() + MANAGED_INVENTORY_RETRY_MS;
    }
  } finally {
    managedInventoryWatchRunning = false;
  }
}

function startManagedConnectionRetry() {
  if (!managedHeartbeatTimer) {
    managedHeartbeatTimer = window.setInterval(syncManagedBridge, 10_000);
  }
}

function startManagedTimers() {
  startManagedConnectionRetry();
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
  if (!managedLevelTriggerTimer) {
    managedLevelTriggerTimer = window.setInterval(processManagedLevelTriggers, MANAGED_LEVEL_TRIGGER_POLL_MS);
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
  lastAudioDeviceSnapshotSignature = audioDeviceSnapshotSignature(inventory);
  renderSummary(inventory);
  if (audioScanStatus) {
    const warnings = Array.isArray(inventory?.warnings) ? inventory.warnings : [];
    audioScanStatus.textContent = warnings.length
      ? `${warnings.length} audio component${warnings.length === 1 ? " was" : "s were"} skipped because ${warnings.length === 1 ? "it" : "they"} could not be queried safely.`
      : "";
    audioScanStatus.title = warnings.join("\n");
    requestBridgeWindowResize();
  }
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
  if (!quiet) {
    setBridgeConnectionError();
    setServerConnectionState("connecting");
  }

  const bridgeId = localStorage.getItem(STORAGE_KEYS.bridgeId) || "";
  const sendAnnounce = async (authToken) => {
    if (invoke) {
      if (!currentInventory) {
        throw new Error("Audio devices are not ready yet.");
      }
      return invoke("announce_bridge", {
        serverUrl,
        apiKey: authToken,
        bridgeId: bridgeId || null,
        bridgeName,
        inventory: currentInventory
      });
    }

    if (!currentInventory) {
      throw new Error("Audio devices are not ready yet.");
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
      throw new Error(payload.error || `Bridge update failed (${response.status})`);
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
  setBridgeConnectionError();
  if (connectionStatus) {
    connectionStatus.textContent = "Announced";
  }
  setServerConnectionState("connected");
  if (syncConfig && announcedBridge.id) {
    try {
      const config = await bridgeApi(
        "GET",
        `/api/v1/bridge/${encodeURIComponent(announcedBridge.id)}/config`
      );
      await reconcileManagedBridgeConfig(config);
      startManagedTimers();
      if (connectionStatus) {
        connectionStatus.textContent = managedSessions.size ? "Connected" : "Announced";
      }
    } catch (error) {
      if (isServerOfflineError(error)) {
        setServerConnectionState("disconnected");
      }
      throw error;
    }
  }
}

async function applyBridgeSettings() {
  try {
    await announceBridge();
  } catch (error) {
    console.error(error);
    setBridgeConnectionError(error);
    if (connectionStatus) {
      connectionStatus.textContent = "Connection failed";
    }
    setServerConnectionState("disconnected");
  } finally {
    if (invoke && currentInventory && serverUrlInput.value.trim() && getBridgeCredential()) {
      startManagedConnectionRetry();
    }
  }
}

function scheduleBridgeSettingsApply(delay = 700) {
  saveBridgeSettings();
  if (bridgeSettingsApplyTimer) window.clearTimeout(bridgeSettingsApplyTimer);
  bridgeSettingsApplyTimer = window.setTimeout(runBridgeSettingsApply, delay);
}

async function runBridgeSettingsApply() {
  bridgeSettingsApplyTimer = null;
  if (bridgeSettingsApplyRunning) {
    bridgeSettingsApplyQueued = true;
    return;
  }

  bridgeSettingsApplyRunning = true;
  try {
    await applyBridgeSettings();
  } finally {
    bridgeSettingsApplyRunning = false;
    if (bridgeSettingsApplyQueued) {
      bridgeSettingsApplyQueued = false;
      scheduleBridgeSettingsApply(0);
    }
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

  portRows.forEach((row) => {
    const activeElement = document.activeElement;
    const rowControlFocused = (
      activeElement instanceof HTMLElement
      && row.element?.contains(activeElement)
      && activeElement.matches("select, input, textarea")
    );
    if (rowControlFocused) return;
    populatePortControls(row);
  });
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
  audioMeter.renderLevel(row.refs.leftMeter, 0);
  audioMeter.renderLevel(row.refs.rightMeter, 0);
  row.refs.status.textContent = "Stopped";
}

function renderRunningPort(row, status) {
  row.running = true;
  updatePortControlState(row);
  row.refs.leftDb.textContent = formatDb(status.rms_left_db);
  row.refs.rightDb.textContent = formatDb(status.rms_right_db);
  audioMeter.renderLevel(row.refs.leftMeter, meterPercent(status.rms_left_db));
  audioMeter.renderLevel(row.refs.rightMeter, meterPercent(status.rms_right_db));

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
    // Inventory probes each backend with a native timeout first. Status checks
    // run afterwards so a quarantined backend cannot block the other results.
    const inventoryResult = await Promise.allSettled([
      withTimeout(invoke("list_audio_devices"), AUDIO_INVENTORY_TIMEOUT_MS, "Audio device scan")
    ]);
    const inventory = inventoryResult[0].status === "fulfilled"
      ? inventoryResult[0].value
      : { host: "Unavailable", devices: [], warnings: [String(inventoryResult[0].reason)] };
    if (inventoryResult[0].status === "fulfilled") {
      managedInventoryWatchRetryAt = 0;
    }
    renderInventory(inventory);

    const bridgeStatusPromise = invoke("get_bridge_status").then((status) => {
      renderBridgeStatus(status);
      return status;
    });
    const portStatusesPromise = (localPortList
      ? invoke("get_audio_probe_ports_status")
      : Promise.resolve([])).then((statuses) => {
        renderPortStatuses(statuses);
        return statuses;
      });
    const ndiStatusPromise = withTimeout(
      invoke("get_ndi_status"),
      AUDIO_STATUS_TIMEOUT_MS,
      "NDI status check"
    ).then((status) => {
      renderNdiStatus(status);
      return status;
    });
    const omtStatusPromise = withTimeout(
      invoke("get_omt_status"),
      AUDIO_STATUS_TIMEOUT_MS,
      "OMT status check"
    ).then((status) => {
      renderOmtStatus(status);
      return status;
    });
    const announcePromise = serverUrlInput.value.trim() && getBridgeCredential()
      ? announceBridge({ quiet: true }).catch((announceError) => {
          console.warn("auto announce failed", announceError);
          if (isServerOfflineError(announceError)) {
            setServerConnectionState("disconnected");
          }
          setBridgeConnectionError(announceError);
        })
      : Promise.resolve();
    const statusResults = await Promise.allSettled([
      bridgeStatusPromise,
      portStatusesPromise,
      ndiStatusPromise,
      omtStatusPromise
    ]);
    if (statusResults[2].status === "rejected") {
      renderNdiStatus({ available: false, error: String(statusResults[2].reason) });
    }
    if (statusResults[3].status === "rejected") {
      renderOmtStatus({ available: false, error: String(statusResults[3].reason) });
    }
    await announcePromise;
  } catch (error) {
    console.error(error);
    if (connectionStatus) {
      connectionStatus.textContent = "Probe failed";
    }
    if (deviceList) {
      deviceList.innerHTML = `<div class="empty-state">Audio probe failed: ${String(error)}</div>`;
    }
  } finally {
    if (currentInventory && serverUrlInput.value.trim() && getBridgeCredential()) {
      startManagedConnectionRetry();
    }
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = "Refresh";
    }
  }
}

addPortButton?.addEventListener("click", addPort);
stopAllPortsButton?.addEventListener("click", stopAllPorts);
refreshButton?.addEventListener("click", refreshDevices);
refreshNdiButton?.addEventListener("click", refreshNdiDevices);
ndiRuntimeLink?.addEventListener("click", openNdiInformation);
refreshOmtButton?.addEventListener("click", refreshOmtDevices);
omtRuntimeLink?.addEventListener("click", openOmtInformation);
autostartInput.addEventListener("change", setAutostartState);
bridgePorts?.addEventListener("change", handleManagedPortControlChange);
bridgePorts?.addEventListener("input", handleManagedPortControlChange);
bridgePorts?.addEventListener('click', handleManagedAudioClick);
bridgePorts?.addEventListener('input', handleManagedAudioInput);
bridgePorts?.addEventListener('change', handleManagedAudioInput);
document.addEventListener('pointerdown', event => {
  if (managedAudioPopover && !event.target.closest('[data-audio-direction]')) closeManagedAudioPopover(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && managedAudioPopover) { event.preventDefault(); closeManagedAudioPopover(); }
});
window.addEventListener('resize', positionManagedAudioPopover);
document.querySelector('.shell')?.addEventListener('scroll', positionManagedAudioPopover);
bridgePorts?.addEventListener("pointerdown", startManagedRangeInteraction);
window.addEventListener("pointerup", finishManagedRangeInteraction);
window.addEventListener("pointercancel", finishManagedRangeInteraction);
[serverUrlInput, apiKeyInput, bridgeNameInput].forEach((input) => {
  input.addEventListener("input", () => {
    saveBridgeSettings();
    if (bridgeSettingsApplyTimer) {
      window.clearTimeout(bridgeSettingsApplyTimer);
      bridgeSettingsApplyTimer = null;
    }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    scheduleBridgeSettingsApply(0);
  });
  input.addEventListener("change", () => scheduleBridgeSettingsApply(0));
});
window.addEventListener("beforeunload", () => {
  if (managedHeartbeatTimer) window.clearInterval(managedHeartbeatTimer);
  if (managedEventTimer) window.clearInterval(managedEventTimer);
  if (managedInventoryTimer) window.clearInterval(managedInventoryTimer);
  if (managedRetryTimer) window.clearInterval(managedRetryTimer);
  if (managedLevelTriggerTimer) window.clearInterval(managedLevelTriggerTimer);
  if (bridgeSettingsApplyTimer) window.clearTimeout(bridgeSettingsApplyTimer);
  for (const timer of managedPortAutoSaveTimers.values()) window.clearTimeout(timer);
  for (const session of managedSessions.values()) {
    stopManagedEventStream(session);
  }
  invoke?.("stop_all_bridge_media").catch(() => {});
});

loadBridgeSettings();
loadBridgeAppVersion();
installWindowFocusSuppressionForControls();
installBridgeWindowAutoResize();
loadAutostartState();
listenForAutostartChanges();
refreshDevices();
