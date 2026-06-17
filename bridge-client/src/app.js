const deviceList = document.getElementById("device-list");
const deviceSummary = document.getElementById("device-summary");
const refreshButton = document.getElementById("refresh-devices");
const connectionStatus = document.getElementById("connection-status");
const bridgePorts = document.getElementById("bridge-ports");
const localPortList = document.getElementById("local-port-list");
const addPortButton = document.getElementById("add-port");
const stopAllPortsButton = document.getElementById("stop-all-ports");

const invoke = window.__TAURI__?.core?.invoke;

let currentInventory = null;
let portRows = [];
let nextPortNumber = 1;
let statusPollTimer = null;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function devicesByDirection(direction) {
  return (currentInventory?.devices ?? []).filter((device) => device.direction === direction);
}

function findDeviceById(deviceId) {
  return (currentInventory?.devices ?? []).find((device) => device.id === deviceId);
}

function renderSummary(inventory) {
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

  const pairs = device.channel_pairs.length
    ? device.channel_pairs.map((pair) => `<span>${escapeHtml(pair.label)}</span>`).join("")
    : "<span>no stereo pairs</span>";

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
      <span>${device.supports_48k ? "48 kHz available" : "48 kHz not reported"}</span>
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
  return `${assignment.device_name} ${assignment.left_channel}/${assignment.right_channel}`;
}

function renderBridgeStatus(status) {
  connectionStatus.textContent = status.connected ? "Connected" : "Local probe";
  bridgePorts.innerHTML = "";

  if (!status.ports?.length) {
    bridgePorts.innerHTML = '<div class="empty-state">No bridge ports configured.</div>';
    return;
  }

  status.ports.forEach((port) => {
    const article = document.createElement("article");
    article.className = "port-card";
    article.innerHTML = `
      <span>${port.enabled ? "Enabled" : "Disabled"}</span>
      <strong>${escapeHtml(port.label)}</strong>
      <small>${escapeHtml(renderBridgeTarget(port.target))}</small>
      <small>In: ${escapeHtml(renderChannelAssignment(port.input))}</small>
      <small>Out: ${escapeHtml(renderChannelAssignment(port.output))}</small>
    `;
    bridgePorts.appendChild(article);
  });
}

function renderInventory(inventory) {
  currentInventory = inventory;
  renderSummary(inventory);
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

  (device?.channel_pairs ?? []).forEach((pair) => {
    const option = document.createElement("option");
    option.value = `${pair.left_channel}:${pair.right_channel}`;
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
        <span>Input pair</span>
        <select class="port-input-pair"></select>
      </label>
      <label>
        <span>Output device</span>
        <select class="port-output-device"></select>
      </label>
      <label>
        <span>Output pair</span>
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
  stopAllPortsButton.disabled = !anyRunning;
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
    deviceList.innerHTML = '<div class="empty-state">Tauri API is not available. Start this UI through the bridge client.</div>';
    connectionStatus.textContent = "Not in Tauri";
    bridgePorts.innerHTML = '<div class="empty-state">No native bridge status available.</div>';
    localPortList.innerHTML = '<div class="empty-state">No native port runtime available.</div>';
    return;
  }

  refreshButton.disabled = true;
  refreshButton.textContent = "Refreshing";
  try {
    const [inventory, bridgeStatus, portStatuses] = await Promise.all([
      invoke("list_audio_devices"),
      invoke("get_bridge_status"),
      invoke("get_audio_probe_ports_status")
    ]);
    renderBridgeStatus(bridgeStatus);
    renderInventory(inventory);
    renderPortStatuses(portStatuses);
  } catch (error) {
    console.error(error);
    connectionStatus.textContent = "Probe failed";
    deviceList.innerHTML = `<div class="empty-state">Audio probe failed: ${String(error)}</div>`;
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "Refresh";
  }
}

addPortButton.addEventListener("click", addPort);
stopAllPortsButton.addEventListener("click", stopAllPorts);
refreshButton.addEventListener("click", refreshDevices);

refreshDevices();
