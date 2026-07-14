const adminState = {
  isAuthenticated: false,
  isSuperAdmin: false,
  mustChangePassword: false,
  userId: null,
  name: ''
};

function setupPasswordVisibilityToggles(root = document) {
  root.querySelectorAll('[data-password-toggle]').forEach((button) => {
    if (button.dataset.passwordToggleReady === 'true') return;
    const inputId = button.dataset.passwordToggle;
    const input = inputId ? document.getElementById(inputId) : null;
    if (!input) return;

    const updateButtonState = () => {
      const isVisible = input.type === 'text';
      const label = isVisible ? 'Hide password' : 'Show password';
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(isVisible));
      button.title = label;
    };

    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
    });

    button.addEventListener('click', () => {
      const shouldShow = input.type === 'password';
      const selectionStart = input.selectionStart;
      const selectionEnd = input.selectionEnd;
      input.type = shouldShow ? 'text' : 'password';
      updateButtonState();
      if (selectionStart !== null && selectionEnd !== null) {
        try {
          input.setSelectionRange(selectionStart, selectionEnd);
        } catch {}
      }
    });

    button.dataset.passwordToggleReady = 'true';
    updateButtonState();
  });
}

setupPasswordVisibilityToggles();

const adminLogin = document.getElementById('admin-login');
const adminLoginForm = document.getElementById('admin-login-form');
const adminLoginMessage = document.getElementById('admin-login-message');
const adminNameInput = document.getElementById('admin-name');
const adminApp = document.getElementById('admin-app');
const adminBar = document.getElementById('admin-bar');
const adminNameLabel = document.getElementById('admin-name-label');
const adminLogoutBtn = document.getElementById('admin-logout');
const adminNavLinks = [...document.querySelectorAll('[data-admin-nav]')];
const statusUsersBody = document.getElementById('status-users-body');
const statusFeedsBody = document.getElementById('status-feeds-body');
const statusBridgesBody = document.getElementById('status-bridges-body');
const statusCompanionsBody = document.getElementById('status-companions-body');
const targetMatrixContainer = document.getElementById('target-matrix-container');
const conferenceMembershipMatrixContainer = document.getElementById('conference-membership-matrix-container');
const configExportBtn = document.getElementById('config-export-btn');
const configImportBtn = document.getElementById('config-import-btn');
const configImportFile = document.getElementById('config-import-file');
const apiKeyCopyBtn = document.getElementById('api-key-copy-btn');
const mediaNetworkMeta = document.getElementById('media-network-meta');
const mediaNetworkQrContainer = document.getElementById('media-network-qr');
const mediaNetworkQrButton = document.getElementById('media-network-qr-button');
const mediaNetworkQrImage = document.getElementById('media-network-qr-image');
const mediaNetworkQrDownloadButton = document.getElementById('media-network-qr-download');
const guestLoginForm = document.getElementById('guest-login-form');
const guestLoginEnabledInput = document.getElementById('guest-login-enabled');
const guestLoginStatus = document.getElementById('guest-login-status');
const guestLoginProfile = document.getElementById('guest-login-profile');
const adminImageLightbox = document.getElementById('admin-image-lightbox');
const adminImageLightboxClose = document.getElementById('admin-image-lightbox-close');
const adminImageLightboxImage = document.getElementById('admin-image-lightbox-image');
const adminImageLightboxDownloadButton = document.getElementById('admin-image-lightbox-download');

const collapsibleAdminSections = {
  status: {
    label: 'Status',
    bodyEl: document.getElementById('status-section-body'),
    buttonEl: document.getElementById('status-section-toggle'),
    cardEl: document.getElementById('status-section-toggle')?.closest('.card'),
    headerEl: document.getElementById('status-section-toggle')?.closest('.card-header'),
  },
  users: {
    label: 'Users',
    bodyEl: document.getElementById('users-section-body'),
    buttonEl: document.getElementById('users-section-toggle'),
    cardEl: document.getElementById('users-section-toggle')?.closest('.card'),
    headerEl: document.getElementById('users-section-toggle')?.closest('.card-header'),
  },
  feeds: {
    label: 'Feeds',
    bodyEl: document.getElementById('feeds-section-body'),
    buttonEl: document.getElementById('feeds-section-toggle'),
    cardEl: document.getElementById('feeds-section-toggle')?.closest('.card'),
    headerEl: document.getElementById('feeds-section-toggle')?.closest('.card-header'),
  },
  matrix: {
    label: 'Matrix',
    bodyEl: document.getElementById('matrix-section-body'),
    buttonEl: document.getElementById('matrix-section-toggle'),
    cardEl: document.getElementById('matrix-section-toggle')?.closest('.card'),
    headerEl: document.getElementById('matrix-section-toggle')?.closest('.card-header'),
  },
  conferences: {
    label: 'Conferences',
    bodyEl: document.getElementById('conferences-section-body'),
    buttonEl: document.getElementById('conferences-section-toggle'),
    cardEl: document.getElementById('conferences-section-toggle')?.closest('.card'),
    headerEl: document.getElementById('conferences-section-toggle')?.closest('.card-header'),
  },
  config: {
    label: 'Config',
    bodyEl: document.getElementById('config-section-body'),
    buttonEl: document.getElementById('config-section-toggle'),
    cardEl: document.getElementById('config-section-toggle')?.closest('.card'),
    headerEl: document.getElementById('config-section-toggle')?.closest('.card-header'),
  },
};

const ADMIN_SECTION_COLLAPSED_STORAGE_PREFIX = 'talktome:admin-section-collapsed:';

let currentMediaNetworkQrState = null;
let currentBridgeRegistry = [];
let currentAdminCatalog = { users: [], conferences: [], feeds: [] };
const targetAssignmentsByUser = new Map();
const targetEditorRefreshTimers = new Map();
const conferenceMembershipsByConference = new Map();
const conferenceMembershipEditorRefreshes = new Map();
let statusLoadPromise = null;
let statusEventSource = null;
let statusClockTimer = null;
let statusFallbackTimer = null;
let statusHealthTimer = null;
let latestAdminStatus = null;
let serverReachable = null;
let activeAdminView = null;

function focusAdminLoginNameField() {
  if (!adminNameInput) return;
  window.requestAnimationFrame(() => {
    try {
      adminNameInput.focus();
      adminNameInput.select?.();
    } catch {}
  });
}

function showLogin(message) {
  stopStatusStream();
  closeAdminImageLightbox();
  if (adminLogin) adminLogin.classList.remove('is-hidden');
  if (adminApp) adminApp.classList.add('is-hidden');
  if (adminBar) adminBar.classList.add('is-hidden');
  if (adminLoginMessage) {
    adminLoginMessage.textContent = message || '';
    adminLoginMessage.classList.toggle('is-visible', Boolean(message));
    adminLoginMessage.classList.remove('flash-success', 'flash-warning');
    adminLoginMessage.classList.add('flash-error');
  }
  focusAdminLoginNameField();
}

function showAdminApp() {
  if (adminLogin) adminLogin.classList.add('is-hidden');
  if (adminApp) adminApp.classList.remove('is-hidden');
  if (adminBar) adminBar.classList.remove('is-hidden');
  activateAdminView(getAdminViewFromHash() || activeAdminView || adminNavLinks[0]?.dataset.adminNav || 'status', {
    updateHash: false,
  });
}

function showLoginMessage(message, tone = 'error') {
  if (!adminLoginMessage) return;
  const toneClass = tone === 'success' || tone === 'green'
    ? 'flash-success'
    : tone === 'warning'
      ? 'flash-warning'
      : 'flash-error';

  adminLoginMessage.textContent = message;
  adminLoginMessage.classList.remove('flash-success', 'flash-error', 'flash-warning');
  adminLoginMessage.classList.add('is-visible', toneClass);
}

function showMessage(text, tone = 'error', scope = 'global') {
  const targetId = scope === 'user'
    ? 'user-message'
    : scope === 'conf'
      ? 'conf-message'
      : scope === 'feed'
        ? 'feed-message'
        : scope === 'matrix'
          ? 'matrix-message'
        : scope === 'status'
          ? 'status-message'
        : scope === 'config'
          ? 'config-message'
          : 'message';

  const el = document.getElementById(targetId);
  if (!el) return;

  const toneClass = tone === 'success' || tone === 'green'
    ? 'flash-success'
    : tone === 'warning'
      ? 'flash-warning'
      : 'flash-error';

  el.textContent = text;
  el.classList.remove('flash-success', 'flash-error', 'flash-warning');
  el.classList.add('is-visible', toneClass);

  showMessage._timers = showMessage._timers || {};
  clearTimeout(showMessage._timers[targetId]);
  showMessage._timers[targetId] = setTimeout(() => {
    el.classList.remove('is-visible', toneClass);
    el.textContent = '';
  }, 5000);
}

function getStoredAdminSectionCollapsed(sectionKey) {
  try {
    const storedValue = localStorage.getItem(`${ADMIN_SECTION_COLLAPSED_STORAGE_PREFIX}${sectionKey}`);
    if (storedValue === null) return sectionKey !== 'status';
    return storedValue === '1';
  } catch {
    return true;
  }
}

function setAdminSectionCollapsed(sectionKey, collapsed, { persist = true } = {}) {
  const section = collapsibleAdminSections[sectionKey];
  if (!section) return;
  const cardEl = section.bodyEl?.closest('.card') || section.buttonEl?.closest('.card') || null;

  if (section.bodyEl) {
    section.bodyEl.hidden = Boolean(collapsed);
  }

  if (cardEl) {
    cardEl.classList.toggle('card--collapsed', Boolean(collapsed));
    cardEl.classList.add('card--toggleable');
  }

  if (section.buttonEl) {
    section.buttonEl.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    section.buttonEl.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${section.label.toLowerCase()} section`);
  }

  if (!collapsed && sectionKey === 'config') {
    window.requestAnimationFrame(() => {
      syncMediaNetworkQrPreviewSize();
    });
  }

  if (!persist) return;

  try {
    localStorage.setItem(`${ADMIN_SECTION_COLLAPSED_STORAGE_PREFIX}${sectionKey}`, collapsed ? '1' : '0');
  } catch {}
}

for (const sectionKey of Object.keys(collapsibleAdminSections)) {
  setAdminSectionCollapsed(sectionKey, getStoredAdminSectionCollapsed(sectionKey), { persist: false });
}

function setActiveAdminNav(sectionKey) {
  adminNavLinks.forEach((link) => {
    if (link.dataset.adminNav === sectionKey) {
      link.setAttribute('aria-current', 'location');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function getKnownAdminViews() {
  return adminNavLinks
    .map((link) => link.dataset.adminNav)
    .filter(Boolean);
}

function getAdminViewFromHash() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;
  const normalized = hash.endsWith('-section') ? hash.slice(0, -8) : hash;
  return getKnownAdminViews().includes(normalized) ? normalized : null;
}

function activateAdminView(sectionKey, { updateHash = true, replaceHash = false } = {}) {
  const knownViews = getKnownAdminViews();
  const nextSectionKey = knownViews.includes(sectionKey) ? sectionKey : knownViews[0];
  if (!nextSectionKey) return;

  activeAdminView = nextSectionKey;
  setActiveAdminNav(nextSectionKey);

  knownViews.forEach((viewKey) => {
    const section = document.getElementById(`${viewKey}-section`);
    if (!section) return;
    const isActive = viewKey === nextSectionKey;
    section.classList.toggle('admin-view-active', isActive);
    section.hidden = !isActive;
  });

  setAdminSectionCollapsed(nextSectionKey, false, { persist: false });

  if (updateHash) {
    const nextHash = `#${nextSectionKey}`;
    if (window.location.hash !== nextHash) {
      if (replaceHash) {
        history.replaceState(null, '', nextHash);
      } else {
        history.pushState(null, '', nextHash);
      }
    }
  }

  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

window.openUserFromStatus = async function (userId) {
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId)) return;

  activateAdminView('users');

  let targetDiv = document.getElementById(`user-nested-${numericUserId}`);
  if (!targetDiv) {
    await refreshAdminLists({ users: true });
    targetDiv = document.getElementById(`user-nested-${numericUserId}`);
  }
  if (!targetDiv) return;

  const button = document.getElementById(`user-toggle-${numericUserId}`);
  if (!targetDiv.classList.contains('is-open')) {
    try {
      await renderUserConferenceList(numericUserId);
      targetDiv.classList.add('is-open');
      button?.setAttribute('aria-expanded', 'true');
    } catch (err) {
      showMessage('❌ Failed to load user details', 'error', 'user');
      console.error(err);
      return;
    }
  }

  const listItem = targetDiv.closest('.list-item');
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const scrollTarget = listItem || targetDiv;
      scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
      listItem?.classList.add('list-item--jump-highlight');
      window.setTimeout(() => {
        listItem?.classList.remove('list-item--jump-highlight');
      }, 1400);
    });
  });
};

function setupAdminNavigation() {
  activateAdminView(getAdminViewFromHash() || adminNavLinks[0]?.dataset.adminNav || 'status', {
    updateHash: Boolean(getAdminViewFromHash()),
    replaceHash: true,
  });

  adminNavLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const sectionKey = link.dataset.adminNav;
      activateAdminView(sectionKey);
    });
  });

  window.addEventListener('hashchange', () => {
    activateAdminView(getAdminViewFromHash() || adminNavLinks[0]?.dataset.adminNav || 'status', {
      updateHash: false,
    });
  });
  window.addEventListener('popstate', () => {
    activateAdminView(getAdminViewFromHash() || adminNavLinks[0]?.dataset.adminNav || 'status', {
      updateHash: false,
    });
  });
}

setupAdminNavigation();

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function valueOrEmpty(value) {
  return value === null || value === undefined ? '' : String(value);
}

function readBridgePairSelect(inputId, label) {
  const value = document.getElementById(inputId)?.value || '';
  if (!value) return { left: null, right: null };
  const [left, right] = value.split(':').map((part) => Number(part));
  if (!Number.isInteger(left) || !Number.isInteger(right) || left < 1 || right < 1) {
    throw new Error(`${label} channel selection is invalid`);
  }
  return { left, right };
}

function validateBridgeChannelPair(left, right, label) {
  if ((left === null) !== (right === null)) {
    throw new Error(`${label} channel selection must include left and right channels`);
  }
  if (left !== null && right !== left && right !== left + 1) {
    throw new Error(`${label} channel selection must use one mono channel or an adjacent stereo pair`);
  }
}

function validateOptionalBridgeDeviceChannel(device, leftChannel, label) {
  if (device && leftChannel === null) {
    throw new Error(`${label} channel is required when ${label.toLowerCase()} device is set`);
  }
  if (!device && leftChannel !== null) {
    throw new Error(`${label} device is required when ${label.toLowerCase()} channel is set`);
  }
}

function readBridgeTriggerConfig(userId, validate = true) {
  const mode = document.getElementById(`bridge-trigger-mode-${userId}`)?.value === 'audio-level'
    ? 'audio-level'
    : 'external';
  const targetValue = mode === 'audio-level'
    ? document.getElementById(`bridge-trigger-target-${userId}`)?.value || ''
    : '';
  const thresholdValue = document.getElementById(`bridge-trigger-threshold-${userId}`)?.value;
  const payload = {
    triggerMode: mode,
    triggerTargetType: '',
    triggerTargetId: null,
    triggerThresholdDb: Number(thresholdValue || -45),
  };

  if (targetValue) {
    const [targetType, rawTargetId] = targetValue.split(':');
    payload.triggerTargetType = targetType === 'user' || targetType === 'conference' ? targetType : '';
    payload.triggerTargetId = Number(rawTargetId);
  }

  if (validate && mode === 'audio-level') {
    if (!payload.triggerTargetType || !Number.isInteger(payload.triggerTargetId) || payload.triggerTargetId < 1) {
      throw new Error('Audio level trigger requires a selected user or conference target');
    }
    if (!Number.isFinite(payload.triggerThresholdDb)) {
      throw new Error('Audio level trigger threshold is invalid');
    }
  }

  return payload;
}

function syncBridgeTriggerControls(userId) {
  const modeSelect = document.getElementById(`bridge-trigger-mode-${userId}`);
  const details = document.getElementById(`bridge-trigger-details-${userId}`);
  const isLevelTrigger = modeSelect?.value === 'audio-level';
  if (details) {
    details.hidden = !isLevelTrigger;
    details.querySelectorAll('select, input').forEach((field) => {
      field.disabled = !isLevelTrigger;
    });
  }
}

function getBridgeById(bridgeId) {
  return currentBridgeRegistry.find((bridge) => bridge.id === bridgeId) || null;
}

function getBridgeDeviceById(bridge, deviceId, direction) {
  return (bridge?.inventory?.devices || [])
    .find((device) => device.id === deviceId && device.direction === direction) || null;
}

function buildBridgeChannelOptions(device) {
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
      label: label || (normalizedLeft === normalizedRight ? `${normalizedLeft}` : `${normalizedLeft}/${normalizedRight}`),
    });
  };

  (device?.channel_pairs || []).forEach((pair) => {
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

function renderBridgeInstanceOptions(selectedBridgeId) {
  const options = ['<option value="">Select bridge</option>'];
  const knownSelected = currentBridgeRegistry.some((bridge) => bridge.id === selectedBridgeId);
  if (selectedBridgeId && !knownSelected) {
    options.push(`<option value="${escapeHtml(selectedBridgeId)}" selected>${escapeHtml(selectedBridgeId)} (saved, offline)</option>`);
  }
  currentBridgeRegistry.forEach((bridge) => {
    const staleSuffix = bridge.stale ? ' (stale)' : '';
    const selected = bridge.id === selectedBridgeId ? ' selected' : '';
    options.push(`<option value="${escapeHtml(bridge.id)}"${selected}>${escapeHtml(bridge.name || bridge.id)}${staleSuffix}</option>`);
  });
  return options.join('');
}

function setBridgeSelectOptions(select, options, selectedValue, fallbackLabel) {
  select.innerHTML = '';
  const emptyOption = document.createElement('option');
  emptyOption.value = '';
  emptyOption.textContent = fallbackLabel;
  select.appendChild(emptyOption);

  options.forEach((entry) => {
    const option = document.createElement('option');
    option.value = entry.value;
    option.textContent = entry.label;
    select.appendChild(option);
  });

  if (selectedValue && !options.some((entry) => entry.value === selectedValue)) {
    const option = document.createElement('option');
    option.value = selectedValue;
    option.textContent = `${selectedValue} (saved, unavailable)`;
    select.appendChild(option);
  }

  select.value = selectedValue || '';
}

function updateBridgeEndpointDeviceOptions(formKey) {
  const bridgeSelect = document.getElementById(`bridge-device-${formKey}`);
  const inputDeviceSelect = document.getElementById(`bridge-input-device-${formKey}`);
  const outputDeviceSelect = document.getElementById(`bridge-output-device-${formKey}`);
  if (!bridgeSelect || !inputDeviceSelect) return;

  const bridge = getBridgeById(bridgeSelect.value);
  const inputSavedValue = inputDeviceSelect.dataset.savedValue || '';
  const outputSavedValue = outputDeviceSelect?.dataset.savedValue || '';
  const inputDevices = (bridge?.inventory?.devices || [])
    .filter((device) => device.direction === 'input')
    .map((device) => ({
      value: device.id,
      label: `${device.name}${device.is_default ? ' (default)' : ''}`,
    }));

  setBridgeSelectOptions(
    inputDeviceSelect,
    inputDevices,
    inputSavedValue && (!inputDeviceSelect.value || inputDeviceSelect.value === inputSavedValue) ? inputSavedValue : inputDeviceSelect.value,
    bridge ? 'Select input device' : 'Select bridge first'
  );
  inputDeviceSelect.disabled = !bridge;
  updateBridgeEndpointPairOptions(formKey, 'input');

  if (outputDeviceSelect) {
    const outputDevices = (bridge?.inventory?.devices || [])
      .filter((device) => device.direction === 'output')
      .map((device) => ({
        value: device.id,
        label: `${device.name}${device.is_default ? ' (default)' : ''}`,
      }));
    setBridgeSelectOptions(
      outputDeviceSelect,
      outputDevices,
      outputSavedValue && (!outputDeviceSelect.value || outputDeviceSelect.value === outputSavedValue) ? outputSavedValue : outputDeviceSelect.value,
      bridge ? 'Select output device' : 'Select bridge first'
    );
    outputDeviceSelect.disabled = !bridge;
    updateBridgeEndpointPairOptions(formKey, 'output');
  }
}

function updateBridgeEndpointPairOptions(formKey, direction) {
  const bridgeSelect = document.getElementById(`bridge-device-${formKey}`);
  const deviceSelect = document.getElementById(`bridge-${direction}-device-${formKey}`);
  const pairSelect = document.getElementById(`bridge-${direction}-pair-${formKey}`);
  if (!bridgeSelect || !deviceSelect || !pairSelect) return;

  const bridge = getBridgeById(bridgeSelect.value);
  const device = getBridgeDeviceById(bridge, deviceSelect.value, direction);
  const savedLeft = pairSelect.dataset.savedLeft || '';
  const savedRight = pairSelect.dataset.savedRight || '';
  const savedPair = savedLeft && savedRight ? `${savedLeft}:${savedRight}` : '';
  const pairs = buildBridgeChannelOptions(device);
  const preferredValue = pairSelect.value || savedPair;
  setBridgeSelectOptions(
    pairSelect,
    pairs,
    preferredValue,
    device ? 'Select channel' : 'Select device first'
  );
  pairSelect.disabled = !device;
}

function syncBridgeEndpointFormsWithRegistry() {
  document.querySelectorAll('[data-bridge-config-user-id], [data-bridge-config-key]').forEach((form) => {
    const formKey = form.dataset.bridgeConfigKey || form.dataset.bridgeConfigUserId;
    const bridgeSelect = document.getElementById(`bridge-device-${formKey}`);
    if (!formKey || !bridgeSelect) return;

    const selectedBridgeId = bridgeSelect.value || '';
    bridgeSelect.innerHTML = renderBridgeInstanceOptions(selectedBridgeId);
    bridgeSelect.value = selectedBridgeId;
    updateBridgeEndpointDeviceOptions(formKey);
  });
}

function updateBridgeTriggerTargetOptions(userId, targets = []) {
  const select = document.getElementById(`bridge-trigger-target-${userId}`);
  if (!select) return;

  const savedValue = select.dataset.savedValue || '';
  const preferredValue = select.value || savedValue;
  const triggerTargets = targets
    .filter((target) => target.targetType === 'user' || target.targetType === 'conference')
    .map((target) => ({
      value: `${target.targetType}:${target.targetId}`,
      label: `${target.name} (${target.targetType})`,
    }));

  select.innerHTML = '<option value="">Select target</option>';
  for (const target of triggerTargets) {
    const option = document.createElement('option');
    option.value = target.value;
    option.textContent = target.label;
    select.appendChild(option);
  }

  if (preferredValue && !triggerTargets.some((target) => target.value === preferredValue)) {
    const option = document.createElement('option');
    option.value = preferredValue;
    option.textContent = `${preferredValue} (saved, unavailable)`;
    select.appendChild(option);
  }
  select.value = [...select.options].some((option) => option.value === preferredValue) ? preferredValue : '';
}

function updateBridgeRegistryFromStatus(snapshot = {}) {
  if (!Array.isArray(snapshot.bridges)) return;
  const hasInventory = snapshot.bridges.some((bridge) => Array.isArray(bridge?.inventory?.devices));
  if (!hasInventory && snapshot.bridges.length > 0) return;

  currentBridgeRegistry = snapshot.bridges;
  syncBridgeEndpointFormsWithRegistry();
}

function initializeBridgeEndpointForms() {
  document.querySelectorAll('[data-bridge-config-user-id], [data-bridge-config-key]').forEach((form) => {
    const formKey = form.dataset.bridgeConfigKey || form.dataset.bridgeConfigUserId;
    const enabledToggle = document.getElementById(`bridge-enabled-${formKey}`);
    const options = document.getElementById(`bridge-options-${formKey}`);
    const bridgeSelect = document.getElementById(`bridge-device-${formKey}`);
    const inputDeviceSelect = document.getElementById(`bridge-input-device-${formKey}`);
    const outputDeviceSelect = document.getElementById(`bridge-output-device-${formKey}`);
    if (!bridgeSelect || bridgeSelect.dataset.bridgeReady === 'true') return;

    enabledToggle?.addEventListener('change', () => {
      if (options) options.hidden = !enabledToggle.checked;
    });

    bridgeSelect.addEventListener('change', () => {
      if (inputDeviceSelect) {
        inputDeviceSelect.dataset.savedValue = '';
        inputDeviceSelect.value = '';
      }
      if (outputDeviceSelect) {
        outputDeviceSelect.dataset.savedValue = '';
        outputDeviceSelect.value = '';
      }
      const inputPairSelect = document.getElementById(`bridge-input-pair-${formKey}`);
      const outputPairSelect = document.getElementById(`bridge-output-pair-${formKey}`);
      if (inputPairSelect) {
        inputPairSelect.dataset.savedLeft = '';
        inputPairSelect.dataset.savedRight = '';
        inputPairSelect.value = '';
      }
      if (outputPairSelect) {
        outputPairSelect.dataset.savedLeft = '';
        outputPairSelect.dataset.savedRight = '';
        outputPairSelect.value = '';
      }
      updateBridgeEndpointDeviceOptions(formKey);
    });
    inputDeviceSelect?.addEventListener('change', () => {
      const pairSelect = document.getElementById(`bridge-input-pair-${formKey}`);
      if (pairSelect) {
        pairSelect.dataset.savedLeft = '';
        pairSelect.dataset.savedRight = '';
        pairSelect.value = '';
      }
      updateBridgeEndpointPairOptions(formKey, 'input');
    });
    outputDeviceSelect?.addEventListener('change', () => {
      const pairSelect = document.getElementById(`bridge-output-pair-${formKey}`);
      if (pairSelect) {
        pairSelect.dataset.savedLeft = '';
        pairSelect.dataset.savedRight = '';
        pairSelect.value = '';
      }
      updateBridgeEndpointPairOptions(formKey, 'output');
    });
    const triggerModeSelect = document.getElementById(`bridge-trigger-mode-${formKey}`);
    triggerModeSelect?.addEventListener('change', () => syncBridgeTriggerControls(formKey));
    syncBridgeTriggerControls(formKey);
    bridgeSelect.dataset.bridgeReady = 'true';
    updateBridgeEndpointDeviceOptions(formKey);
  });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard unavailable');
}

function selectNextByIndex(selectEl, previousIndex) {
  if (!selectEl) return;
  const options = Array.from(selectEl.options || []);
  if (!options.length) return;
  let startIndex = Number.isInteger(previousIndex) ? previousIndex : selectEl.selectedIndex;
  if (startIndex < 0) startIndex = 0;
  if (startIndex >= options.length) startIndex = 0;
  const total = options.length;
  for (let offset = 0; offset < total; offset += 1) {
    const idx = (startIndex + offset) % total;
    if (!options[idx].disabled) {
      selectEl.selectedIndex = idx;
      return;
    }
  }
}

async function authedFetch(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    adminState.isAuthenticated = false;
    adminState.isSuperAdmin = false;
    adminState.mustChangePassword = false;
    adminState.userId = null;
    adminState.name = '';
    throw new Error('Unauthorized');
  }
  return res;
}

async function fetchJSON(url) {
  const res = await authedFetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

function applyAdminState(payload) {
  adminState.isAuthenticated = true;
  adminState.isSuperAdmin = Boolean(payload?.isSuperadmin);
  adminState.mustChangePassword = Boolean(payload?.mustChangePassword);
  adminState.userId = payload?.id ?? null;
  adminState.name = payload?.name ?? '';
  if (adminNameLabel) {
    adminNameLabel.textContent = adminState.name || 'Admin';
  }
}

function escapeSvgText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ADMIN_QR_RENDER_VIEWBOX_WIDTH = 420;
const ADMIN_QR_RENDER_VIEWBOX_HEIGHT = 480;
const ADMIN_QR_RENDER_SCALE = 2;

function buildRenderedQrImageDataUrl({ qrCodeDataUrl, qrUrl, mdnsHostLabel }) {
  if (!qrCodeDataUrl || !qrUrl) return '';
  const mdnsLabel = mdnsHostLabel || 'mDNS disabled';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${ADMIN_QR_RENDER_VIEWBOX_WIDTH * ADMIN_QR_RENDER_SCALE}" height="${ADMIN_QR_RENDER_VIEWBOX_HEIGHT * ADMIN_QR_RENDER_SCALE}" viewBox="0 0 ${ADMIN_QR_RENDER_VIEWBOX_WIDTH} ${ADMIN_QR_RENDER_VIEWBOX_HEIGHT}" role="img" aria-label="Connection QR code">
      <rect width="${ADMIN_QR_RENDER_VIEWBOX_WIDTH}" height="${ADMIN_QR_RENDER_VIEWBOX_HEIGHT}" rx="20" fill="#ffffff"/>
      <image href="${escapeSvgText(qrCodeDataUrl)}" x="50" y="26" width="320" height="320"/>
      <text x="26" y="380" fill="#64748b" font-size="13" font-weight="700" font-family="Inter, Arial, sans-serif">IP URL</text>
      <text x="26" y="404" fill="#0f172a" font-size="15" font-weight="600" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace">${escapeSvgText(qrUrl)}</text>
      <text x="26" y="438" fill="#64748b" font-size="13" font-weight="700" font-family="Inter, Arial, sans-serif">mDNS URL</text>
      <text x="26" y="462" fill="#0f172a" font-size="15" font-weight="600" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace">${escapeSvgText(mdnsLabel)}</text>
    </svg>
  `.trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function closeAdminImageLightbox() {
  if (!adminImageLightbox) return;
  adminImageLightbox.classList.add('is-hidden');
  document.body.style.removeProperty('overflow');
}

function buildMediaNetworkQrFilename(extension = 'png') {
  const rawUrl = currentMediaNetworkQrState?.qrUrl || '';
  try {
    const host = new URL(rawUrl).hostname || 'talktome';
    const safeHost = host.replace(/[^a-z0-9.-]+/gi, '-').replace(/-+/g, '-');
    return `talktome-connect-qr-${safeHost}.${extension}`;
  } catch {
    return `talktome-connect-qr.${extension}`;
  }
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load QR image'));
    image.src = dataUrl;
  });
}

async function rasterizeQrDataUrlToPngBlob(dataUrl) {
  const image = await loadImageFromDataUrl(dataUrl);
  const width = Math.max(1, image.naturalWidth || image.width || 420);
  const height = Math.max(1, image.naturalHeight || image.height || 480);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas context unavailable');
  }
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    throw new Error('Failed to encode PNG');
  }
  return blob;
}

async function downloadMediaNetworkQrImage() {
  const dataUrl = currentMediaNetworkQrState?.renderedQrDataUrl || '';
  if (!dataUrl) return;
  try {
    const blob = await rasterizeQrDataUrlToPngBlob(dataUrl);
    triggerDownload(blob, buildMediaNetworkQrFilename('png'));
  } catch (error) {
    console.error('Failed to download media network QR image:', error);
    showMessage('❌ Failed to download QR image', 'error', 'config');
  }
}

function openAdminImageLightbox() {
  if (!adminImageLightbox || !currentMediaNetworkQrState?.renderedQrDataUrl) return;
  if (adminImageLightboxImage) {
    adminImageLightboxImage.src = currentMediaNetworkQrState.renderedQrDataUrl;
  }
  adminImageLightbox.classList.remove('is-hidden');
  document.body.style.overflow = 'hidden';
}

function renderMediaNetworkQr(payload = null) {
  const qrUrl = payload?.qrUrl || '';
  const mdnsUrl = payload?.mdnsUrl || '';
  const qrCodeDataUrl = payload?.qrCodeDataUrl || '';
  const activeMdnsHost = typeof payload?.activeMdnsHost === 'string' ? payload.activeMdnsHost.trim() : '';
  const mdnsHostLabel = activeMdnsHost && activeMdnsHost !== 'off'
    ? activeMdnsHost
    : '';
  const renderedQrDataUrl = buildRenderedQrImageDataUrl({
    qrCodeDataUrl,
    qrUrl,
    mdnsHostLabel,
  });

  currentMediaNetworkQrState = renderedQrDataUrl
    ? {
        qrUrl,
        mdnsUrl,
        renderedQrDataUrl,
      }
    : null;

  if (!mediaNetworkQrContainer || !mediaNetworkQrButton || !mediaNetworkQrImage) return;

  if (!renderedQrDataUrl || !qrUrl) {
    mediaNetworkQrContainer.classList.add('is-hidden');
    mediaNetworkQrButton.disabled = true;
    if (mediaNetworkQrDownloadButton) mediaNetworkQrDownloadButton.disabled = true;
    mediaNetworkQrButton.removeAttribute('aria-expanded');
    mediaNetworkQrButton.style.height = '';
    mediaNetworkQrImage.removeAttribute('src');
    mediaNetworkQrImage.alt = 'Connection QR code unavailable';
    mediaNetworkQrImage.style.height = '';
    mediaNetworkQrImage.style.width = '';
    closeAdminImageLightbox();
    return;
  }

  mediaNetworkQrContainer.classList.remove('is-hidden');
  mediaNetworkQrButton.disabled = false;
  if (mediaNetworkQrDownloadButton) mediaNetworkQrDownloadButton.disabled = false;
  mediaNetworkQrImage.src = renderedQrDataUrl;
  mediaNetworkQrImage.alt = `Connection QR code for ${qrUrl}`;
  mediaNetworkQrButton.setAttribute('aria-label', `Open large connection QR code for ${qrUrl}`);
  syncMediaNetworkQrPreviewSize();
}

function syncMediaNetworkQrPreviewSize() {
  if (!mediaNetworkQrContainer || !mediaNetworkQrButton || !mediaNetworkQrImage) return;

  if (window.matchMedia('(max-width: 768px)').matches) {
    mediaNetworkQrButton.style.height = '';
    mediaNetworkQrImage.style.height = '';
    mediaNetworkQrImage.style.width = '';
    return;
  }

  const metaHeight = mediaNetworkMeta?.getBoundingClientRect?.().height || 0;
  if (!metaHeight) return;

  const nextHeight = Math.max(144, Math.round(metaHeight + 24));
  mediaNetworkQrButton.style.height = `${nextHeight}px`;
  mediaNetworkQrImage.style.height = `${Math.max(nextHeight - 6, 128)}px`;
  mediaNetworkQrImage.style.width = '100%';
}

async function logoutAdmin(message) {
  try {
    await authedFetch('/admin/logout', { method: 'POST' });
  } catch (err) {
    console.warn('Logout failed:', err);
  }
  adminState.isAuthenticated = false;
  adminState.isSuperAdmin = false;
  adminState.mustChangePassword = false;
  adminState.userId = null;
  adminState.name = '';
  closeAdminImageLightbox();
  showLogin(message || '');
}

async function enforcePasswordChange() {
  if (!adminState.mustChangePassword) return true;

  const newPassword = prompt('Please set a new admin password (min 4 characters).');
  if (!newPassword) {
    await logoutAdmin('Password change required before continuing.');
    return false;
  }
  if (newPassword.trim().length < 4) {
    alert('Password must be at least 4 characters.');
    return enforcePasswordChange();
  }

  try {
    const res = await authedFetch('/admin/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword.trim() })
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      alert(payload.error || 'Failed to update password.');
      return enforcePasswordChange();
    }
    adminState.mustChangePassword = false;
    showMessage('✅ Admin password updated', 'success');
    return true;
  } catch (err) {
    alert('Failed to update password.');
    return enforcePasswordChange();
  }
}

async function ensureAdminSession() {
  try {
    const payload = await fetchJSON('/admin/me');
    applyAdminState(payload);
    showAdminApp();
    const ok = await enforcePasswordChange();
    if (ok) {
      await loadData();
    }
  } catch (err) {
    showLogin();
  }
}

function statusDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatStatusExact(value) {
  const date = statusDate(value);
  return date ? date.toLocaleString() : '';
}

function formatStatusElapsed(value, { suffix = true } = {}) {
  const date = statusDate(value);
  if (!date) return 'Never';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  let text;
  if (seconds < 10) text = 'just now';
  else if (seconds < 60) text = `${seconds}s`;
  else if (seconds < 3600) text = `${Math.floor(seconds / 60)}m`;
  else if (seconds < 86400) text = `${Math.floor(seconds / 3600)}h`;
  else if (seconds < 604800) text = `${Math.floor(seconds / 86400)}d`;
  else text = date.toLocaleDateString();
  return suffix && text !== 'just now' && seconds < 604800 ? `${text} ago` : text;
}

function formatStatusUptime(value) {
  const date = statusDate(value);
  if (!date) return '-';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function statusTimeHtml(value, { suffix = true, empty = 'Never' } = {}) {
  const exact = formatStatusExact(value);
  if (!exact) return escapeHtml(empty);
  return `<span title="${escapeHtml(exact)}">${escapeHtml(formatStatusElapsed(value, { suffix }))}</span>`;
}

function statusIndicatorHtml({ online, talking = false, warning = false, onlineLabel = 'Online', offlineLabel = 'Offline', warningLabel = 'Warning' }) {
  const label = talking ? 'Talking' : warning ? warningLabel : online ? onlineLabel : offlineLabel;
  const stateClass = talking ? 'is-talking' : warning ? 'is-warning' : online ? 'is-online' : '';
  return `
    <span class="status-indicator">
      <span class="status-indicator__dot ${stateClass}" aria-hidden="true"></span>
      <span>${escapeHtml(label)}</span>
    </span>
  `;
}

function setServerReachability(online) {
  serverReachable = online === true ? true : online === false ? false : null;
  const dot = document.getElementById('status-server-dot');
  if (!dot) return;
  dot.classList.toggle('is-online', online === true);
  dot.classList.toggle('is-offline', online === false);
  const label = online === true ? 'Server online' : online === false ? 'Server offline' : 'Server status unknown';
  dot.setAttribute('aria-label', label);
  dot.title = label;
  if (online === false) {
    setStatusText('status-summary-uptime', 'Offline');
  }
}

async function probeServerHealth() {
  try {
    const response = await fetch('/api/v1/health', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
    const payload = await response.json();
    if (!payload?.ok) throw new Error('Health check failed');
    setServerReachability(true);
    if (payload.serverStartedAt) {
      setStatusText('status-summary-uptime', formatStatusUptime(payload.serverStartedAt));
    }
    return true;
  } catch {
    setServerReachability(false);
    return false;
  }
}

function startServerHealthProbe() {
  if (statusHealthTimer !== null) return;
  probeServerHealth();
  statusHealthTimer = window.setInterval(probeServerHealth, 3000);
}

function stopServerHealthProbe() {
  if (statusHealthTimer !== null) window.clearInterval(statusHealthTimer);
  statusHealthTimer = null;
}

function setStatusText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function formatStatusLatency(networkStats) {
  const roundTripMs = Number(networkStats?.roundTripMs);
  return Number.isFinite(roundTripMs) ? `${Math.round(roundTripMs)} ms` : '-';
}

function formatStatusPacketLoss(networkStats) {
  const packetLossPercent = Number(networkStats?.packetLossPercent);
  if (!Number.isFinite(packetLossPercent)) return '-';
  return `${packetLossPercent.toFixed(packetLossPercent >= 10 ? 0 : 1)}%`;
}

function renderAdminStatus(payload = {}) {
  latestAdminStatus = payload;
  const users = Array.isArray(payload.users) ? [...payload.users] : [];
  const feeds = Array.isArray(payload.feeds) ? [...payload.feeds] : [];
  const bridges = Array.isArray(payload.bridges) ? [...payload.bridges] : [];
  const companions = Array.isArray(payload.companions) ? [...payload.companions] : [];
  const summary = payload.summary || {};
  const sortByOnlineAndName = (a, b) => (
    Number(Boolean(b.online)) - Number(Boolean(a.online))
    || String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
  );

  users.sort(sortByOnlineAndName);
  feeds.sort(sortByOnlineAndName);
  bridges.sort(sortByOnlineAndName);
  companions.sort(sortByOnlineAndName);

  setStatusText('status-summary-users', `${summary.usersOnline || 0} / ${summary.usersTotal || 0}`);
  setStatusText('status-summary-bridges', `${summary.bridgesOnline || 0} / ${summary.bridgesTotal || 0}`);
  setStatusText('status-summary-companions', String(summary.companionsOnline || 0));
  setStatusText('status-summary-feeds', String(summary.feedsOnline || 0));
  setStatusText('status-summary-guests', String(summary.guestsOnline || 0));
  setStatusText('status-summary-uptime', formatStatusUptime(payload.serverStartedAt));
  setStatusText('status-users-count', `${summary.usersOnline || 0} online of ${summary.usersTotal || 0}`);
  setStatusText('status-feeds-count', `${summary.feedsOnline || 0} online of ${summary.feedsTotal || 0}`);
  setStatusText('status-bridges-count', `${summary.bridgesOnline || 0} online of ${summary.bridgesTotal || 0}`);
  setStatusText('status-companions-count', `${summary.companionsOnline || 0} online of ${companions.length}`);

  if (statusUsersBody) {
    statusUsersBody.innerHTML = users.length
      ? users.map((user) => {
          const userId = Number(user.id);
          const userNameHtml = Number.isFinite(userId)
            ? `<button type="button" class="status-primary status-user-link" onclick="openUserFromStatus(${userId})" title="Open settings for ${escapeHtml(user.name)}">${escapeHtml(user.name)}</button>`
            : `<span class="status-primary">${escapeHtml(user.name)}</span>`;
          const clientLabel = user.online
            ? user.client || '-'
            : user.configuredAsBridge
              ? 'Bridge configured'
              : '-';
          return `
            <tr>
              <td>${statusIndicatorHtml(user)}</td>
              <td>${userNameHtml}</td>
              <td>${escapeHtml(clientLabel)}</td>
              <td>${escapeHtml(user.remoteAddress || '-')}</td>
              <td title="WebRTC round-trip time from this browser">${formatStatusLatency(user.networkStats)}</td>
              <td title="WebRTC audio packet loss reported by this browser">${formatStatusPacketLoss(user.networkStats)}</td>
              <td>${user.online ? statusTimeHtml(user.connectedAt, { suffix: false, empty: '-' }) : '-'}</td>
              <td>${user.online ? 'Now' : statusTimeHtml(user.lastOnlineAt)}</td>
            </tr>
          `;
        }).join('')
      : '<tr><td colspan="8" class="status-empty">No users configured.</td></tr>';
  }

  if (statusFeedsBody) {
    statusFeedsBody.innerHTML = feeds.length
      ? feeds.map((feed) => {
          const clientLabel = feed.online
            ? feed.client || '-'
            : feed.configuredAsBridge
              ? 'Bridge configured'
              : '-';
          return `
            <tr>
              <td>${statusIndicatorHtml(feed)}</td>
              <td><span class="status-primary">${escapeHtml(feed.name)}</span></td>
              <td>${escapeHtml(clientLabel)}</td>
              <td>${escapeHtml(feed.remoteAddress || '-')}</td>
              <td title="WebRTC round-trip time from this browser">${formatStatusLatency(feed.networkStats)}</td>
              <td title="WebRTC audio packet loss reported by this browser">${formatStatusPacketLoss(feed.networkStats)}</td>
              <td>${feed.online ? statusTimeHtml(feed.connectedAt, { suffix: false, empty: '-' }) : '-'}</td>
              <td>${feed.online ? 'Now' : statusTimeHtml(feed.lastSeenAt, { empty: 'Never' })}</td>
            </tr>
          `;
        }).join('')
      : '<tr><td colspan="8" class="status-empty">No feeds configured.</td></tr>';
  }

  if (statusBridgesBody) {
    statusBridgesBody.innerHTML = bridges.length
      ? bridges.map((bridge) => `
            <tr>
              <td>${statusIndicatorHtml({
                online: bridge.online,
                warning: bridge.online && bridge.deviceMissing,
                onlineLabel: 'Online',
                offlineLabel: 'Stale',
                warningLabel: 'Device missing',
              })}</td>
              <td><span class="status-primary">${escapeHtml(bridge.name)}</span></td>
              <td>${escapeHtml(bridge.client || 'Bridge')}</td>
              <td>${escapeHtml(bridge.remoteAddress || '-')}</td>
              <td>${bridge.online ? statusTimeHtml(bridge.connectedAt, { suffix: false, empty: '-' }) : '-'}</td>
              <td>${bridge.online ? 'Now' : statusTimeHtml(bridge.lastSeenAt)}</td>
            </tr>
          `).join('')
      : '<tr><td colspan="6" class="status-empty">No bridge announced.</td></tr>';
  }

  if (statusCompanionsBody) {
    statusCompanionsBody.innerHTML = companions.length
      ? companions.map((companion) => {
          const connectedSince = companion.online
            ? statusTimeHtml(companion.connectedAt, { suffix: false, empty: '-' })
            : '-';
          const lastSeen = companion.online
            ? 'Now'
            : statusTimeHtml(companion.lastSeenAt, { empty: '-' });
          return `
            <tr>
              <td>${statusIndicatorHtml({ online: companion.online, onlineLabel: 'Online', offlineLabel: 'Stale' })}</td>
              <td><span class="status-primary">${escapeHtml(companion.name)}</span></td>
              <td>${escapeHtml(companion.client || '-')}</td>
              <td>${escapeHtml(companion.remoteAddress || '-')}</td>
              <td>${connectedSince}</td>
              <td>${lastSeen}</td>
            </tr>
          `;
        }).join('')
      : '<tr><td colspan="6" class="status-empty">No Companion instance connected.</td></tr>';
  }

  setStatusText('status-version', `Server version ${payload.appVersion || 'unknown'}`);
}

async function loadAdminStatus({ silent = false } = {}) {
  if (statusLoadPromise) return statusLoadPromise;
  statusLoadPromise = (async () => {
    try {
      const payload = await fetchJSON('/admin/status');
      setServerReachability(true);
      updateBridgeRegistryFromStatus(payload);
      renderAdminStatus(payload);
      stopServerHealthProbe();
    } catch (error) {
      startServerHealthProbe();
      if (!silent) {
        showMessage('Failed to load status', 'error', 'status');
      }
      if (!adminState.isAuthenticated) {
        showLogin('Session expired.');
      }
      console.error('Failed to load admin status:', error);
    } finally {
      statusLoadPromise = null;
    }
  })();
  return statusLoadPromise;
}

function startStatusStream() {
  stopStatusStream();

  statusClockTimer = window.setInterval(() => {
    if (latestAdminStatus && serverReachable !== false && !document.hidden) {
      renderAdminStatus(latestAdminStatus);
    }
  }, 30_000);

  if (!window.EventSource) {
    loadAdminStatus();
    statusFallbackTimer = window.setInterval(() => {
      if (adminState.isAuthenticated && !document.hidden) {
        loadAdminStatus({ silent: true });
      }
    }, 30_000);
    return;
  }

  statusEventSource = new EventSource('/admin/status/events');
  statusEventSource.addEventListener('status', (event) => {
    try {
      const payload = JSON.parse(event.data || '{}');
      const snapshot = payload.snapshot || {};
      const reason = String(payload.reason || '');
      const refresh = payload.refresh || {};
      setServerReachability(true);
      updateBridgeRegistryFromStatus(snapshot);
      renderAdminStatus(snapshot);
      const refreshUsers = Boolean(refresh.users || reason === 'bridge-endpoint-updated');
      const refreshFeeds = Boolean(refresh.feeds || reason === 'bridge-feed-endpoint-updated');
      if (refreshUsers || refreshFeeds) {
        refreshAdminLists({ users: refreshUsers, feeds: refreshFeeds }).catch((error) => {
          console.error('Failed to refresh bridge endpoint config:', error);
        });
      }
      stopServerHealthProbe();
    } catch (error) {
      console.error('Failed to parse status event:', error);
    }
  });
  const handleExpiredSession = () => {
    adminState.isAuthenticated = false;
    stopStatusStream();
    showLogin('Session expired.');
  };
  statusEventSource.addEventListener('auth-expired', handleExpiredSession);
  statusEventSource.addEventListener('logged-out', handleExpiredSession);
  statusEventSource.addEventListener('error', () => {
    startServerHealthProbe();
  });
}

function stopStatusStream() {
  statusEventSource?.close();
  statusEventSource = null;
  if (statusClockTimer !== null) window.clearInterval(statusClockTimer);
  if (statusFallbackTimer !== null) window.clearInterval(statusFallbackTimer);
  stopServerHealthProbe();
  statusClockTimer = null;
  statusFallbackTimer = null;
  setServerReachability(null);
}

async function loadData() {
  await loadGuestLoginSettings();
  const { users, conferences, feeds, bridges } = await fetchAdminCollections();
  await loadMdnsSettings();
  await loadMediaNetworkSettings();
  await loadRtcPortSettings();
  await renderUserList(users, conferences, feeds, bridges);
  renderFeedList(feeds);
  await renderConferenceList(conferences, users);
  renderTargetMatrix(users, conferences, feeds);
  renderConferenceMembershipMatrix(users, conferences);
  startStatusStream();
  activateAdminView(getAdminViewFromHash() || activeAdminView || 'status', { updateHash: false });
}

async function fetchAdminCollections() {
  const [users, conferences, feeds, bridgePayload] = await Promise.all([
    fetchJSON('/users'),
    fetchJSON('/conferences'),
    fetchJSON('/feeds'),
    fetchJSON('/admin/bridges'),
  ]);
  const bridges = Array.isArray(bridgePayload?.bridges) ? bridgePayload.bridges : [];
  currentBridgeRegistry = bridges;

  return { users, conferences, feeds, bridges };
}

function targetAssignmentKey(targetType, targetId) {
  return `${String(targetType)}:${String(targetId)}`;
}

function cacheUserTargetAssignments(userId, targets) {
  const key = String(userId);
  const assignments = new Set(
    (Array.isArray(targets) ? targets : []).map((target) => (
      targetAssignmentKey(target.targetType, target.targetId)
    ))
  );
  targetAssignmentsByUser.set(key, assignments);

  if (!targetMatrixContainer) return;
  targetMatrixContainer
    .querySelectorAll(`.target-matrix-toggle[data-user-id="${key}"]`)
    .forEach((toggle) => {
      if (toggle.disabled) return;
      toggle.setAttribute('aria-pressed', String(assignments.has(
        targetAssignmentKey(toggle.dataset.targetType, toggle.dataset.targetId)
      )));
    });
}

function setCachedTargetAssignment(userId, targetType, targetId, enabled) {
  const userKey = String(userId);
  const assignmentKey = targetAssignmentKey(targetType, targetId);
  const assignments = targetAssignmentsByUser.get(userKey) || new Set();
  if (enabled) {
    assignments.add(assignmentKey);
  } else {
    assignments.delete(assignmentKey);
  }
  targetAssignmentsByUser.set(userKey, assignments);
}

function scheduleUserTargetEditorRefresh(userId) {
  const key = String(userId);
  clearTimeout(targetEditorRefreshTimers.get(key));
  targetEditorRefreshTimers.set(key, setTimeout(() => {
    targetEditorRefreshTimers.delete(key);
    loadUserTargets(
      userId,
      currentAdminCatalog.users,
      currentAdminCatalog.conferences,
      currentAdminCatalog.feeds
    ).catch((error) => {
      console.error('Failed to refresh user targets after matrix update:', error);
    });
  }, 200));
}

function cacheConferenceMemberships(conferenceId, users) {
  const key = String(conferenceId);
  const memberships = new Set(
    (Array.isArray(users) ? users : []).map((user) => String(user.id))
  );
  conferenceMembershipsByConference.set(key, memberships);

  if (!conferenceMembershipMatrixContainer) return;
  conferenceMembershipMatrixContainer
    .querySelectorAll(`.conference-membership-toggle[data-conference-id="${key}"]`)
    .forEach((toggle) => {
      if (toggle.disabled) return;
      toggle.setAttribute('aria-pressed', String(memberships.has(String(toggle.dataset.userId))));
    });
}

function setCachedConferenceMembership(conferenceId, userId, enabled) {
  const conferenceKey = String(conferenceId);
  const userKey = String(userId);
  const memberships = conferenceMembershipsByConference.get(conferenceKey) || new Set();
  if (enabled) {
    memberships.add(userKey);
  } else {
    memberships.delete(userKey);
  }
  conferenceMembershipsByConference.set(conferenceKey, memberships);
}

function scheduleConferenceMembershipEditorRefresh(conferenceId, userId) {
  const key = String(conferenceId);
  const pending = conferenceMembershipEditorRefreshes.get(key) || {
    userIds: new Set(),
    timer: null,
  };
  pending.userIds.add(String(userId));
  clearTimeout(pending.timer);
  pending.timer = setTimeout(async () => {
    conferenceMembershipEditorRefreshes.delete(key);
    try {
      await updateConferenceParticipantOptions(conferenceId, currentAdminCatalog.users);
      await Promise.all([...pending.userIds].map((pendingUserId) => (
        updateUserConferenceOptions(pendingUserId, currentAdminCatalog.conferences)
      )));
      if (document.getElementById(`conf-controls-${conferenceId}`)?.classList.contains('is-open')) {
        await renderConferenceParticipantList(conferenceId);
      }
      await Promise.all([...pending.userIds].map((pendingUserId) => (
        document.getElementById(`user-nested-${pendingUserId}`)?.classList.contains('is-open')
          ? renderUserConferenceList(pendingUserId)
          : Promise.resolve()
      )));
    } catch (error) {
      console.error('Failed to refresh conference membership editors:', error);
    }
  }, 200);
  conferenceMembershipEditorRefreshes.set(key, pending);
}

function renderTargetMatrix(users, conferences, feeds) {
  if (!targetMatrixContainer) return;

  currentAdminCatalog = {
    users: Array.isArray(users) ? users : [],
    conferences: Array.isArray(conferences) ? conferences : [],
    feeds: Array.isArray(feeds) ? feeds : [],
  };

  const rowUsers = currentAdminCatalog.users.filter((user) => !user.is_superadmin);
  const targetUsers = currentAdminCatalog.users.filter((user) => (
    !user.is_superadmin && !user.is_guest_profile
  ));
  const groups = [
    { type: 'user', label: 'Users', className: 'users', items: targetUsers },
    { type: 'conference', label: 'Conferences', className: 'conferences', items: currentAdminCatalog.conferences },
    { type: 'feed', label: 'Feeds', className: 'feeds', items: currentAdminCatalog.feeds },
  ].filter((group) => group.items.length > 0);
  const columns = groups.flatMap((group) => (
    group.items.map((item) => ({ ...item, targetType: group.type }))
  ));

  if (rowUsers.length === 0 || columns.length === 0) {
    targetMatrixContainer.innerHTML = '<p class="target-matrix-empty">Add users and targets to configure the matrix.</p>';
    return;
  }

  const groupHeaders = groups.map((group) => `
    <th class="target-matrix__group target-matrix__group--${group.className}" colspan="${group.items.length}" scope="colgroup">${escapeHtml(group.label)}</th>
  `).join('');
  const columnHeaders = columns.map((column, columnIndex) => `
    <th class="target-matrix__target-column target-matrix__column--${escapeHtml(column.targetType)}" data-matrix-column="${columnIndex}" scope="col" title="${escapeHtml(column.name)}">
      <span class="target-matrix__column-label">${escapeHtml(column.name)}</span>
    </th>
  `).join('');
  const bodyRows = rowUsers.map((user) => {
    const assignments = targetAssignmentsByUser.get(String(user.id)) || new Set();
    const cells = columns.map((column, columnIndex) => {
      const isSelfTarget = column.targetType === 'user' && Number(column.id) === Number(user.id);
      if (isSelfTarget) {
        return `<td class="target-matrix__unavailable target-matrix__target-column target-matrix__column--user" data-matrix-column="${columnIndex}" aria-label="A user cannot target itself">&mdash;</td>`;
      }
      const checked = assignments.has(targetAssignmentKey(column.targetType, column.id));
      const label = `${column.name} as target for ${user.name}`;
      return `
        <td class="target-matrix__coupling target-matrix__target-column target-matrix__column--${escapeHtml(column.targetType)}" data-matrix-column="${columnIndex}">
          <button
            type="button"
            class="target-matrix-toggle"
            data-user-id="${user.id}"
            data-target-type="${escapeHtml(column.targetType)}"
            data-target-id="${column.id}"
            aria-label="${escapeHtml(label)}"
            aria-pressed="${checked ? 'true' : 'false'}"
            title="${escapeHtml(label)}"
          ></button>
        </td>
      `;
    }).join('');
    return `
      <tr>
        <th class="target-matrix__user-name" scope="row">${escapeHtml(user.name)}</th>
        ${cells}
      </tr>
    `;
  }).join('');
  const matrixTableWidth = 7.5 + (columns.length * 1.9);
  const targetColumnDefinitions = columns.map(() => (
    '<col class="target-matrix__target-col" />'
  )).join('');

  targetMatrixContainer.innerHTML = `
    <table class="target-matrix" style="--matrix-table-width: ${matrixTableWidth}rem">
      <colgroup>
        <col class="target-matrix__profile-column" />
        ${targetColumnDefinitions}
      </colgroup>
      <thead>
        <tr>
          <th class="target-matrix__corner" rowspan="2" scope="col" aria-label="Users by targets">
            <span class="target-matrix__corner-label target-matrix__corner-label--users">Users</span>
            <span class="target-matrix__corner-label target-matrix__corner-label--targets">Targets</span>
          </th>
          ${groupHeaders}
        </tr>
        <tr>${columnHeaders}</tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

function renderConferenceMembershipMatrix(users, conferences) {
  if (!conferenceMembershipMatrixContainer) return;
  const columnUsers = (Array.isArray(users) ? users : []).filter((user) => (
    !user.is_superadmin && !user.is_guest_profile
  ));
  const rows = Array.isArray(conferences) ? conferences : [];

  if (columnUsers.length === 0 || rows.length === 0) {
    conferenceMembershipMatrixContainer.innerHTML = '<p class="target-matrix-empty">Add users and conferences to configure memberships.</p>';
    return;
  }

  const columnHeaders = columnUsers.map((user, columnIndex) => `
    <th class="target-matrix__target-column target-matrix__column--user" data-matrix-column="${columnIndex}" scope="col" title="${escapeHtml(user.name)}">
      <span class="target-matrix__column-label">${escapeHtml(user.name)}</span>
    </th>
  `).join('');
  const bodyRows = rows.map((conference) => {
    const memberships = conferenceMembershipsByConference.get(String(conference.id)) || new Set();
    const cells = columnUsers.map((user, columnIndex) => {
      const enabled = memberships.has(String(user.id));
      const label = `${user.name} in conference ${conference.name}`;
      return `
        <td class="target-matrix__coupling target-matrix__target-column target-matrix__column--user" data-matrix-column="${columnIndex}">
          <button
            type="button"
            class="target-matrix-toggle conference-membership-toggle"
            data-conference-id="${conference.id}"
            data-user-id="${user.id}"
            aria-label="${escapeHtml(label)}"
            aria-pressed="${enabled ? 'true' : 'false'}"
            title="${escapeHtml(label)}"
          ></button>
        </td>
      `;
    }).join('');
    return `
      <tr>
        <th class="target-matrix__user-name" scope="row" title="${escapeHtml(conference.name)}">${escapeHtml(conference.name)}</th>
        ${cells}
      </tr>
    `;
  }).join('');
  const matrixTableWidth = 7.5 + (columnUsers.length * 1.9);
  const targetColumnDefinitions = columnUsers.map(() => (
    '<col class="target-matrix__target-col" />'
  )).join('');

  conferenceMembershipMatrixContainer.innerHTML = `
    <table class="target-matrix" style="--matrix-table-width: ${matrixTableWidth}rem">
      <colgroup>
        <col class="target-matrix__profile-column" />
        ${targetColumnDefinitions}
      </colgroup>
      <thead>
        <tr>
          <th class="target-matrix__corner" rowspan="2" scope="col" aria-label="Conferences by users">
            <span class="target-matrix__corner-label target-matrix__corner-label--users">Conferences</span>
            <span class="target-matrix__corner-label target-matrix__corner-label--targets">Users</span>
          </th>
          <th class="target-matrix__group target-matrix__group--users" colspan="${columnUsers.length}" scope="colgroup">Users</th>
        </tr>
        <tr>${columnHeaders}</tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

function highlightMatrixColumn(container, columnIndex = null) {
  if (!container) return;
  container.querySelectorAll('.is-column-highlighted').forEach((cell) => {
    cell.classList.remove('is-column-highlighted');
  });

  if (columnIndex === null || columnIndex === undefined || columnIndex === '') return;
  const numericIndex = Number(columnIndex);
  if (!Number.isInteger(numericIndex) || numericIndex < 0) return;
  container
    .querySelectorAll(`[data-matrix-column="${numericIndex}"]`)
    .forEach((cell) => cell.classList.add('is-column-highlighted'));
}

async function handleTargetMatrixToggle(toggle, forcedEnabled = null) {
  const userId = Number(toggle.dataset.userId);
  const targetType = toggle.dataset.targetType;
  const targetId = Number(toggle.dataset.targetId);
  const wasEnabled = toggle.getAttribute('aria-pressed') === 'true';
  const enabled = typeof forcedEnabled === 'boolean' ? forcedEnabled : !wasEnabled;
  if (!Number.isFinite(userId) || !Number.isFinite(targetId) || !targetType) return;
  if (enabled === wasEnabled || toggle.disabled) return;

  toggle.setAttribute('aria-pressed', String(enabled));
  toggle.disabled = true;
  try {
    const url = enabled
      ? `/users/${userId}/targets`
      : `/users/${userId}/targets/${encodeURIComponent(targetType)}/${targetId}`;
    const response = await authedFetch(url, enabled
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetType, targetId }),
        }
      : { method: 'DELETE' });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Target update failed');
    }

    setCachedTargetAssignment(userId, targetType, targetId, enabled);
    scheduleUserTargetEditorRefresh(userId);
  } catch (error) {
    toggle.setAttribute('aria-pressed', String(wasEnabled));
    showMessage(error.message || 'Target update failed', 'error', 'matrix');
  } finally {
    toggle.disabled = false;
  }
}

async function handleConferenceMembershipToggle(toggle, forcedEnabled = null) {
  const conferenceId = Number(toggle.dataset.conferenceId);
  const userId = Number(toggle.dataset.userId);
  const wasEnabled = toggle.getAttribute('aria-pressed') === 'true';
  const enabled = typeof forcedEnabled === 'boolean' ? forcedEnabled : !wasEnabled;
  if (!Number.isFinite(conferenceId) || !Number.isFinite(userId)) return;
  if (enabled === wasEnabled || toggle.disabled) return;

  toggle.setAttribute('aria-pressed', String(enabled));
  toggle.disabled = true;
  try {
    const response = await authedFetch(`/conferences/${conferenceId}/users/${userId}`, {
      method: enabled ? 'POST' : 'DELETE',
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Conference membership update failed');
    }

    setCachedConferenceMembership(conferenceId, userId, enabled);
    scheduleConferenceMembershipEditorRefresh(conferenceId, userId);
  } catch (error) {
    toggle.setAttribute('aria-pressed', String(wasEnabled));
    showMessage(error.message || 'Conference membership update failed', 'error', 'matrix');
  } finally {
    toggle.disabled = false;
  }
}

function getOpenListState() {
  return {
    users: [...document.querySelectorAll('[id^="user-nested-"].is-open')]
      .map(el => el.id.replace('user-nested-', '')),
    conferences: [...document.querySelectorAll('[id^="conf-controls-"].is-open')]
      .map(el => el.id.replace('conf-controls-', '')),
    feeds: [...document.querySelectorAll('[id^="feed-nested-"].is-open')]
      .map(el => el.id.replace('feed-nested-', '')),
  };
}

async function restoreOpenListState(state = {}) {
  for (const userId of state.users || []) {
    const container = document.getElementById(`user-nested-${userId}`);
    const button = document.getElementById(`user-toggle-${userId}`);
    if (!container) continue;
    await renderUserConferenceList(userId);
    container.classList.add('is-open');
    if (button) button.setAttribute('aria-expanded', 'true');
  }

  for (const confId of state.conferences || []) {
    const container = document.getElementById(`conf-controls-${confId}`);
    const button = document.getElementById(`conf-toggle-${confId}`);
    if (!container) continue;
    await renderConferenceParticipantList(confId);
    container.classList.add('is-open');
    if (button) button.setAttribute('aria-expanded', 'true');
  }

  for (const feedId of state.feeds || []) {
    const container = document.getElementById(`feed-nested-${feedId}`);
    const button = document.getElementById(`feed-toggle-${feedId}`);
    if (!container) continue;
    container.classList.add('is-open');
    if (button) button.setAttribute('aria-expanded', 'true');
  }
}

async function refreshAdminLists({ users: refreshUsers = false, conferences: refreshConferences = false, feeds: refreshFeeds = false } = {}) {
  const openState = getOpenListState();
  const { users, conferences, feeds, bridges } = await fetchAdminCollections();

  if (refreshUsers) {
    await renderUserList(users, conferences, feeds, bridges);
  }
  if (refreshFeeds) {
    renderFeedList(feeds);
  }
  if (refreshConferences) {
    await renderConferenceList(conferences, users);
  }

  if (refreshUsers || refreshConferences || refreshFeeds) {
    renderTargetMatrix(users, conferences, feeds);
    renderConferenceMembershipMatrix(users, conferences);
  }

  await restoreOpenListState(openState);
}

async function renderUserList(users, conferences, feeds, bridges = currentBridgeRegistry) {
  currentBridgeRegistry = Array.isArray(bridges) ? bridges : [];
  targetAssignmentsByUser.clear();
  const userList = document.getElementById('user-list');
  userList.innerHTML = '';

  for (const user of users) {
    const safeName = escapeHtml(user.name);
    const isAdmin = Boolean(user.is_admin);
    const isSuperadmin = Boolean(user.is_superadmin);
    const isGuestProfile = Boolean(user.is_guest_profile);
    const isBridgeEndpoint = Boolean(user.bridge_enabled);
    const adminBadge = isSuperadmin
      ? '<span class="badge superadmin">Superadmin</span>'
      : isAdmin
        ? '<span class="badge admin">Admin</span>'
        : '';
    const guestBadge = isGuestProfile
      ? '<span class="badge guest-profile">Guest profile</span>'
      : '';
    const bridgeBadge = isBridgeEndpoint
      ? '<span class="badge bridge">Bridge</span>'
      : '';
    const adminToggle = adminState.isAuthenticated
      ? isSuperadmin || isGuestProfile
        ? `<button type="button" class="small admin-role-toggle" disabled title="${isSuperadmin ? 'Superadmin role cannot be changed' : 'Guest profile cannot be made admin'}">Make admin</button>`
        : `<button type="button" class="small admin-role-toggle ${isAdmin ? 'warning' : ''}" onclick="toggleAdminRole(${user.id}, ${isAdmin ? 'false' : 'true'})">${isAdmin ? 'Remove admin' : 'Make admin'}</button>`
      : '';
    const passwordAttrs = isGuestProfile ? 'disabled title="Guest profile does not use a password"' : '';
    const loginLinkAttrs = isSuperadmin
      ? 'disabled title="Superadmin does not use a login URL"'
      : isGuestProfile
        ? 'disabled title="Guest profile does not use a login URL"'
        : '';
    const deleteAttrs = isGuestProfile
      ? 'disabled title="Guest profile cannot be deleted"'
      : isAdmin ? 'disabled title="Admin accounts cannot be deleted"' : '';
    const li = document.createElement('li');
    li.className = 'list-item list-item--toggleable';
    li.setAttribute('onclick', `toggleUserConfs(${user.id})`);

    const optionsHtml = conferences.length
      ? conferences.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')
      : '<option value="" disabled selected>No conferences</option>';
    const bridgeControls = !isSuperadmin && !isGuestProfile
      ? `
        <div class="nested-block">
          <form class="bridge-config-form" id="bridge-config-${user.id}" data-bridge-config-user-id="${user.id}" onsubmit="saveBridgeEndpoint(event, ${user.id})">
            <label class="toggle-row" for="bridge-enabled-${user.id}">
              <input type="checkbox" id="bridge-enabled-${user.id}" ${isBridgeEndpoint ? 'checked' : ''}>
              <span>Use this user as bridge endpoint</span>
            </label>
            <div class="bridge-config-options" id="bridge-options-${user.id}" ${isBridgeEndpoint ? '' : 'hidden'}>
              <div class="field-group bridge-instance-field">
                <label for="bridge-device-${user.id}">Bridge device</label>
                <select id="bridge-device-${user.id}">
                  ${renderBridgeInstanceOptions(user.bridge_device || '')}
                </select>
              </div>
              <div class="bridge-channel-row">
                <div class="field-group">
                  <label for="bridge-input-device-${user.id}">Input device</label>
                  <select id="bridge-input-device-${user.id}" data-saved-value="${escapeHtml(user.bridge_input_device)}"></select>
                </div>
                <div class="field-group">
                  <label for="bridge-input-pair-${user.id}">Input channel</label>
                  <select id="bridge-input-pair-${user.id}" data-saved-left="${escapeHtml(valueOrEmpty(user.bridge_input_left_channel))}" data-saved-right="${escapeHtml(valueOrEmpty(user.bridge_input_right_channel))}"></select>
                </div>
              </div>
              <div class="bridge-channel-row">
                <div class="field-group">
                  <label for="bridge-output-device-${user.id}">Output device</label>
                  <select id="bridge-output-device-${user.id}" data-saved-value="${escapeHtml(user.bridge_output_device)}"></select>
                </div>
                <div class="field-group">
                  <label for="bridge-output-pair-${user.id}">Output channel</label>
                  <select id="bridge-output-pair-${user.id}" data-saved-left="${escapeHtml(valueOrEmpty(user.bridge_output_left_channel))}" data-saved-right="${escapeHtml(valueOrEmpty(user.bridge_output_right_channel))}"></select>
                </div>
              </div>
              <div class="bridge-trigger-row">
                <div class="field-group">
                  <label for="bridge-trigger-mode-${user.id}">Talk trigger</label>
                  <select id="bridge-trigger-mode-${user.id}">
                    <option value="external" ${user.bridge_trigger_mode === 'audio-level' ? '' : 'selected'}>External trigger</option>
                    <option value="audio-level" ${user.bridge_trigger_mode === 'audio-level' ? 'selected' : ''}>Audio level</option>
                  </select>
                </div>
                <div class="bridge-trigger-details" id="bridge-trigger-details-${user.id}" ${user.bridge_trigger_mode === 'audio-level' ? '' : 'hidden'}>
                  <div class="field-group">
                    <label for="bridge-trigger-target-${user.id}">Trigger target</label>
                    <select id="bridge-trigger-target-${user.id}" data-saved-value="${escapeHtml(user.bridge_trigger_target_type && user.bridge_trigger_target_id ? `${user.bridge_trigger_target_type}:${user.bridge_trigger_target_id}` : '')}"></select>
                  </div>
                  <div class="field-group">
                    <label for="bridge-trigger-threshold-${user.id}">Threshold dBFS</label>
                    <input id="bridge-trigger-threshold-${user.id}" type="number" min="-120" max="-10" step="1" value="${escapeHtml(valueOrEmpty(user.bridge_trigger_threshold_db ?? -45))}">
                  </div>
                </div>
              </div>
            </div>
            <button type="submit" class="small">Save bridge</button>
          </form>
        </div>
      `
      : '';

    li.innerHTML = `
      <div class="list-item-header list-item-header--toggleable">
        <button
          type="button"
          class="list-item-title list-item-title--toggle"
          id="user-toggle-${user.id}"
          onclick="event.stopPropagation(); toggleUserConfs(${user.id}, this)"
          aria-expanded="false"
          aria-controls="user-nested-${user.id}"
          aria-label="Toggle details for ${safeName}"
        >
          <span class="list-item-disclosure" aria-hidden="true"></span>
          <span>${safeName}</span>
          ${adminBadge}
          ${guestBadge}
          ${bridgeBadge}
        </button>
        <div class="inline-controls" onclick="event.stopPropagation()">
          <button type="button" class="small" onclick='copyUserLoginUrl(${user.id}, ${JSON.stringify(user.name)}, this)' ${loginLinkAttrs}>Copy Login URL</button>
          <button type="button" class="small warning" onclick='editUser(${user.id}, ${JSON.stringify(user.name)})'>Rename</button>
          <button type="button" class="small warning" onclick='resetPassword(${user.id}, ${JSON.stringify(user.name)})' ${passwordAttrs}>Reset Password</button>
          ${adminToggle}
          <button type="button" class="small danger" onclick="deleteUser(${user.id})" ${deleteAttrs}>Delete</button>
        </div>
      </div>
      <div class="nested" id="user-nested-${user.id}" onclick="event.stopPropagation()">
        <div class="nested-block">
          <strong>Conferences</strong>
          <div class="inline-controls">
            <select id="add-user-conf-${user.id}">${optionsHtml}</select>
            <button type="button" class="small" ${conferences.length ? '' : 'disabled'} onclick="assignUserToConference(${user.id})">Add to conference</button>
          </div>
          <ul id="user-confs-${user.id}"></ul>
        </div>
        <div class="nested-block">
          <strong>Target Buttons</strong>
          <div class="inline-controls">
            <select id="add-target-type-${user.id}">
              <option value="user">User</option>
              <option value="conference">Conference</option>
              <option value="feed">Feed</option>
            </select>
            <select id="add-target-id-${user.id}"></select>
            <button type="button" id="add-target-btn-${user.id}" class="small" onclick="addTarget(${user.id})">Add target</button>
          </div>
          <ul id="user-targets-${user.id}"></ul>
        </div>
        ${bridgeControls}
      </div>
    `;

    userList.appendChild(li);
  }

  await Promise.all(users.map(async (user) => {
    await updateUserConferenceOptions(user.id, conferences);
    await loadUserTargets(user.id, users, conferences, feeds);
  }));
  initializeBridgeEndpointForms();
}

function renderFeedList(feeds) {
  const feedList = document.getElementById('feed-list');
  feedList.innerHTML = '';

  for (const feed of feeds) {
    const safeName = escapeHtml(feed.name);
    const formKey = `feed-${feed.id}`;
    const isBridgeEndpoint = Boolean(feed.bridge_enabled);
    const bridgeBadge = isBridgeEndpoint
      ? '<span class="badge bridge">Bridge</span>'
      : '';
    const li = document.createElement('li');
    li.className = 'list-item list-item--toggleable';
    li.setAttribute('onclick', `toggleFeedBridge(${feed.id})`);
    li.innerHTML = `
      <div class="list-item-header list-item-header--toggleable">
        <button
          type="button"
          class="list-item-title list-item-title--toggle"
          id="feed-toggle-${feed.id}"
          onclick="event.stopPropagation(); toggleFeedBridge(${feed.id}, this)"
          aria-expanded="false"
          aria-controls="feed-nested-${feed.id}"
          aria-label="Toggle details for ${safeName}"
        >
          <span class="list-item-disclosure" aria-hidden="true"></span>
          <span>${safeName}</span>
          ${bridgeBadge}
        </button>
        <div class="inline-controls" onclick="event.stopPropagation()">
          <button type="button" class="small warning" onclick='editFeed(${feed.id}, ${JSON.stringify(feed.name)})'>Rename</button>
          <button type="button" class="small warning" onclick='resetFeedPassword(${feed.id}, ${JSON.stringify(feed.name)})'>Reset Password</button>
          <button type="button" class="small danger" onclick="deleteFeed(${feed.id})">Delete</button>
        </div>
      </div>
      <div class="nested" id="feed-nested-${feed.id}" onclick="event.stopPropagation()">
        <div class="nested-block">
          <form class="bridge-config-form" id="bridge-config-${formKey}" data-bridge-config-key="${formKey}" onsubmit="saveFeedBridgeEndpoint(event, ${feed.id})">
            <label class="toggle-row" for="bridge-enabled-${formKey}">
              <input type="checkbox" id="bridge-enabled-${formKey}" ${isBridgeEndpoint ? 'checked' : ''}>
              <span>Use this feed as bridge input</span>
            </label>
            <div class="bridge-config-options" id="bridge-options-${formKey}" ${isBridgeEndpoint ? '' : 'hidden'}>
              <div class="field-group bridge-instance-field">
                <label for="bridge-device-${formKey}">Bridge device</label>
                <select id="bridge-device-${formKey}">
                  ${renderBridgeInstanceOptions(feed.bridge_device || '')}
                </select>
              </div>
              <div class="bridge-channel-row">
                <div class="field-group">
                  <label for="bridge-input-device-${formKey}">Input device</label>
                  <select id="bridge-input-device-${formKey}" data-saved-value="${escapeHtml(feed.bridge_input_device)}"></select>
                </div>
                <div class="field-group">
                  <label for="bridge-input-pair-${formKey}">Input channel</label>
                  <select id="bridge-input-pair-${formKey}" data-saved-left="${escapeHtml(valueOrEmpty(feed.bridge_input_left_channel))}" data-saved-right="${escapeHtml(valueOrEmpty(feed.bridge_input_right_channel))}"></select>
                </div>
              </div>
            </div>
            <button type="submit" class="small">Save bridge</button>
          </form>
        </div>
      </div>
    `;
    feedList.appendChild(li);
  }
  initializeBridgeEndpointForms();
}

async function renderConferenceList(conferences, users) {
  conferenceMembershipsByConference.clear();
  const confList = document.getElementById('conf-list');
  confList.innerHTML = '';

  for (const conf of conferences) {
    const safeName = escapeHtml(conf.name);
    const li = document.createElement('li');
    li.className = 'list-item list-item--toggleable';
    li.dataset.confId = String(conf.id);
    li.setAttribute('onclick', `toggleConfUsers(${conf.id})`);
    li.innerHTML = `
      <div class="list-item-header list-item-header--toggleable">
        <button
          type="button"
          class="list-item-title list-item-title--toggle"
          id="conf-toggle-${conf.id}"
          onclick="event.stopPropagation(); toggleConfUsers(${conf.id}, this)"
          aria-expanded="false"
          aria-controls="conf-controls-${conf.id}"
          aria-label="Toggle details for ${safeName}"
        >
          <span class="list-item-disclosure" aria-hidden="true"></span>
          <span>${safeName}</span>
        </button>
        <div class="inline-controls" onclick="event.stopPropagation()">
          <button type="button" class="small warning" onclick='editConference(${conf.id}, ${JSON.stringify(conf.name)})'>Rename</button>
          <button type="button" class="small danger" onclick="deleteConference(${conf.id})">Delete</button>
        </div>
      </div>
      <div class="nested" id="conf-controls-${conf.id}" onclick="event.stopPropagation()">
        <strong>Participants</strong>
        <div class="inline-controls">
          <select id="add-conf-user-${conf.id}"></select>
          <button type="button" class="small" id="add-conf-user-btn-${conf.id}" onclick="assignConferenceParticipant(${conf.id})">Add participant</button>
        </div>
        <ul id="conf-users-${conf.id}"></ul>
      </div>
    `;
    confList.appendChild(li);
  }

  await Promise.all(conferences.map(conf => updateConferenceParticipantOptions(conf.id, users)));
}

async function loadMdnsSettings() {
  const payload = await fetchJSON('/admin/settings/mdns');
  const activeHostEl = document.getElementById('mdns-active-host');
  const savedHostEl = document.getElementById('mdns-saved-host');
  const inputEl = document.getElementById('mdns-host');
  const restartHintEl = document.getElementById('mdns-restart-hint');
  const containerHintEl = document.getElementById('mdns-container-hint');

  const activeHost = payload?.activeMdnsHost || 'off';
  const savedHost = payload?.mdnsHost || 'off';
  const runningInContainer = Boolean(payload?.runningInContainer);

  if (activeHostEl) activeHostEl.textContent = activeHost;
  if (savedHostEl) savedHostEl.textContent = savedHost;
  if (inputEl) inputEl.value = savedHost === 'off' ? 'off' : savedHost;
  if (restartHintEl) {
    restartHintEl.textContent = payload?.restartRequired
      ? 'Saved. Restart the server to apply the new mDNS alias.'
      : 'Current server alias matches the saved setting.';
  }
  if (containerHintEl) {
    containerHintEl.classList.toggle('is-hidden', !runningInContainer);
  }
}

function describeMediaNetworkMode(mode, detail = '') {
  if (mode === 'interface') {
    return detail ? `Preferred adapter (${detail})` : 'Preferred adapter';
  }
  if (mode === 'manual') {
    return detail ? `Manual (${detail})` : 'Manual';
  }
  return 'Automatic';
}

function updateMediaNetworkFormVisibility() {
  const modeEl = document.getElementById('media-network-mode');
  const interfaceGroupEl = document.getElementById('media-interface-group');
  const manualGroupEl = document.getElementById('media-announced-address-group');
  const mode = modeEl?.value || 'auto';

  if (interfaceGroupEl) {
    interfaceGroupEl.classList.toggle('is-hidden', mode !== 'interface');
  }
  if (manualGroupEl) {
    manualGroupEl.classList.toggle('is-hidden', mode !== 'manual');
  }
}

async function loadMediaNetworkSettings() {
  const payload = await fetchJSON('/admin/settings/media-network');
  const activeModeEl = document.getElementById('media-network-active-mode');
  const activeAddressEl = document.getElementById('media-network-active-address');
  const savedModeEl = document.getElementById('media-network-saved-mode');
  const modeEl = document.getElementById('media-network-mode');
  const interfaceEl = document.getElementById('media-interface-name');
  const addressEl = document.getElementById('media-announced-address');
  const restartHintEl = document.getElementById('media-network-restart-hint');
  const overrideHintEl = document.getElementById('media-network-override-hint');

  const activeMode = payload?.activeMediaNetworkMode || 'auto';
  const activeInterfaceName = payload?.activeMediaInterfaceName || '';
  const activeAddress = payload?.activeAnnouncedAddress || 'Unavailable';
  const savedMode = payload?.mediaNetworkMode || 'auto';
  const savedInterfaceName = payload?.mediaInterfaceName || '';
  const savedAddress = payload?.mediaAnnouncedAddress || '';
  const availableInterfaces = Array.isArray(payload?.availableInterfaces) ? payload.availableInterfaces : [];
  const activeDetail = activeMode === 'interface'
    ? activeInterfaceName
    : activeMode === 'manual'
      ? activeAddress
      : activeInterfaceName || activeAddress;
  const savedDetail = savedMode === 'interface'
    ? savedInterfaceName
    : savedMode === 'manual'
      ? savedAddress
      : '';

  if (activeModeEl) activeModeEl.textContent = describeMediaNetworkMode(activeMode, activeDetail);
  if (activeAddressEl) activeAddressEl.textContent = payload?.activeResolutionError || activeAddress;
  if (savedModeEl) savedModeEl.textContent = describeMediaNetworkMode(savedMode, savedDetail);

  if (modeEl) {
    modeEl.value = savedMode;
  }
  if (interfaceEl) {
    interfaceEl.innerHTML = '<option value="">Select adapter</option>';
    availableInterfaces.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.name;
      option.textContent = entry.label || `${entry.name} - ${entry.address}`;
      interfaceEl.appendChild(option);
    });
    interfaceEl.value = savedInterfaceName || '';
  }
  if (addressEl) {
    addressEl.value = savedAddress;
  }

  updateMediaNetworkFormVisibility();

  if (restartHintEl) {
    if (payload?.environmentOverride) {
      restartHintEl.textContent = 'An environment override is currently active for media routing.';
    } else {
      restartHintEl.textContent = payload?.restartRequired
        ? 'Saved. Restart the server to apply the new media network.'
        : 'Current media network matches the saved setting.';
    }
  }
  if (overrideHintEl) {
    overrideHintEl.classList.toggle('is-hidden', !payload?.environmentOverride);
  }

  renderMediaNetworkQr(payload);
}

function formatRtcPortRange(start, end) {
  const startNumber = Number(start);
  const endNumber = Number(end);
  if (!Number.isInteger(startNumber) || !Number.isInteger(endNumber)) {
    return 'Unavailable';
  }
  return `${startNumber}-${endNumber}`;
}

async function loadRtcPortSettings() {
  const payload = await fetchJSON('/admin/settings/rtc-ports');
  const activeRangeEl = document.getElementById('rtc-ports-active-range');
  const savedRangeEl = document.getElementById('rtc-ports-saved-range');
  const startInput = document.getElementById('rtc-port-start');
  const countInput = document.getElementById('rtc-port-count');
  const restartHintEl = document.getElementById('rtc-ports-restart-hint');
  const overrideHintEl = document.getElementById('rtc-ports-override-hint');

  if (activeRangeEl) {
    activeRangeEl.textContent = formatRtcPortRange(payload?.activeRtcPortStart, payload?.activeRtcPortEnd);
  }
  if (savedRangeEl) {
    savedRangeEl.textContent = formatRtcPortRange(payload?.rtcPortStart, payload?.rtcPortEnd);
  }
  if (startInput) {
    startInput.value = payload?.rtcPortStart ?? '';
  }
  if (countInput) {
    countInput.value = payload?.rtcPortCount ?? '';
  }
  if (restartHintEl) {
    if (payload?.environmentOverride) {
      restartHintEl.textContent = 'An environment override is currently active for RTC ports.';
    } else {
      restartHintEl.textContent = payload?.restartRequired
        ? 'Saved. Restart the server to apply the new RTC port range.'
        : 'Current RTC port range matches the saved setting.';
    }
  }
  if (overrideHintEl) {
    overrideHintEl.classList.toggle('is-hidden', !payload?.environmentOverride);
  }
}

async function loadGuestLoginSettings() {
  const payload = await fetchJSON('/admin/settings/guest-login');
  const enabled = payload?.enabled === true;
  if (guestLoginEnabledInput) {
    guestLoginEnabledInput.checked = enabled;
  }
  if (guestLoginStatus) {
    guestLoginStatus.textContent = enabled ? 'Enabled' : 'Disabled';
  }
  if (guestLoginProfile) {
    const profileName = payload?.profileName || 'Guest';
    const profileId = payload?.profileUserId != null ? `ID ${payload.profileUserId}` : 'not created';
    guestLoginProfile.textContent = `${profileName} (${profileId})`;
  }
  return payload;
}

async function updateUserConferenceOptions(userId, allConfs, previousIndex) {
  const select = document.getElementById(`add-user-conf-${userId}`);
  if (!select) return;
  const button = select.parentElement?.querySelector('button');
  let assigned = [];
  try {
    assigned = await fetchJSON(`/users/${userId}/conferences`);
  } catch (err) {
    console.error('Failed to load user conferences for select', err);
  }

  const assignedIds = new Set(assigned.map(c => String(c.id)));
  const conferences = Array.isArray(allConfs) ? allConfs : [];
  const available = conferences.filter(c => !assignedIds.has(String(c.id)));

  if (!available.length) {
    select.disabled = true;
    select.innerHTML = '<option value="" disabled selected>No conferences available</option>';
    if (button) button.disabled = true;
    return;
  }

  select.disabled = false;
  select.innerHTML = available
    .map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join('');
  if (button) button.disabled = false;
  selectNextByIndex(select, previousIndex);
}

async function updateConferenceParticipantOptions(confId, allUsers, previousIndex) {
  const select = document.getElementById(`add-conf-user-${confId}`);
  if (!select) return;
  const button = document.getElementById(`add-conf-user-btn-${confId}`) || select.parentElement?.querySelector('button');

  let assignedUsers = [];
  try {
    assignedUsers = await fetchJSON(`/conferences/${confId}/users`);
    cacheConferenceMemberships(confId, assignedUsers);
  } catch (err) {
    console.error('Failed to load conference participants for select', err);
  }

  const assignedIds = new Set(assignedUsers.map(u => String(u.id)));
  const users = Array.isArray(allUsers) ? allUsers : [];
  const available = users.filter(u => (
    !u.is_superadmin
    && !u.is_guest_profile
    && !assignedIds.has(String(u.id))
  ));

  if (!available.length) {
    select.disabled = true;
    select.innerHTML = '<option value="" disabled selected>No users available</option>';
    if (button) button.disabled = true;
    return;
  }

  select.disabled = false;
  select.innerHTML = available
    .map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`)
    .join('');
  if (button) button.disabled = false;
  selectNextByIndex(select, previousIndex);
}

async function renderUserConferenceList(userId) {
  const confUl = document.getElementById(`user-confs-${userId}`);
  if (!confUl) return;

  const confs = await fetchJSON(`/users/${userId}/conferences`);
  confUl.innerHTML = confs.length
    ? confs.map(c => `
        <li class="list-chip">
          <span class="chip-label">${escapeHtml(c.name)}</span>
          <button type="button" class="small danger" onclick="confirmUnassign(${userId}, ${c.id})">Remove</button>
        </li>
      `).join('')
    : '<li class="list-chip"><span class="chip-label">No conferences assigned yet</span></li>';
}

async function renderConferenceParticipantList(confId) {
  const usersUl = document.getElementById(`conf-users-${confId}`);
  if (!usersUl) return;

  const users = await fetchJSON(`/conferences/${confId}/users`);
  cacheConferenceMemberships(confId, users);
  usersUl.innerHTML = users.length
    ? users.map(u => `
        <li class="list-chip">
          <span class="chip-label">${escapeHtml(u.name)}</span>
          <button type="button" class="small danger" onclick="confirmUnassign(${u.id},${confId})">Remove</button>
        </li>
      `).join('')
    : '<li class="list-chip"><span class="chip-label">No participants yet</span></li>';
}

// Fetch and render targets + rebuild the “type → id” dropdown
async function loadUserTargets(userId, allUsers, allConfs, allFeeds = []) {
  const targets = await fetchJSON(`/users/${userId}/targets`);
  cacheUserTargetAssignments(userId, targets);
  const usedByType = targets.reduce((acc, target) => {
    const type = String(target.targetType || '');
    const id = String(target.targetId || '');
    if (!type) return acc;
    if (!acc[type]) acc[type] = new Set();
    acc[type].add(id);
    return acc;
  }, {});
  const ul = document.getElementById(`user-targets-${userId}`);
  ul.innerHTML = targets.map(t => {
    return `
      <li class="list-chip draggable-target" draggable="true"
          data-type="${escapeHtml(t.targetType)}" data-id="${escapeHtml(t.targetId)}">
        <span class="drag-handle" title="Drag to reorder">☰</span>
        <span class="chip-label">${escapeHtml(t.name)}</span>
        <span class="badge">${escapeHtml(t.targetType)}</span>
        <button type="button" class="small danger" onclick="removeTarget(${userId}, '${t.targetType}', '${t.targetId}')">Remove</button>
      </li>
    `;
  }).join('');
  updateBridgeTriggerTargetOptions(userId, targets);

  initTargetOrdering(userId, ul);

  const selType = document.getElementById(`add-target-type-${userId}`);
  const selId   = document.getElementById(`add-target-id-${userId}`);
  const addBtn  = document.getElementById(`add-target-btn-${userId}`);
  const refreshTargetSelectors = () => {
    const type = selType.value;
    const selectableUsers = allUsers.filter(item => (
      !item.is_superadmin &&
      !item.is_guest_profile &&
      Number(item.id) !== Number(userId)
    ));
    let options = [];
    if (type === 'user') {
      const used = usedByType.user || new Set();
      options = selectableUsers
        .filter(item => !used.has(String(item.id)))
        .map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`);
    } else if (type === 'conference') {
      const used = usedByType.conference || new Set();
      options = (allConfs || [])
        .filter(item => !used.has(String(item.id)))
        .map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`);
    } else if (type === 'feed') {
      const used = usedByType.feed || new Set();
      options = allFeeds
        .filter(item => !used.has(String(item.id)))
        .map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`);
    }

    if (options.length === 0) {
      selId.disabled = true;
      selId.innerHTML = '<option value="" disabled selected>No entries available</option>';
    } else {
      selId.disabled = false;
      selId.innerHTML = options.join('');
    }

    if (addBtn) addBtn.disabled = selId.disabled;
  };

  refreshTargetSelectors();
  selType.onchange = refreshTargetSelectors;
}

function initTargetOrdering(userId, ul) {
  const items = [...ul.querySelectorAll('.draggable-target')];
  items.forEach(item => {
    item.addEventListener('dragstart', () => item.classList.add('dragging'));
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      saveTargetOrder(userId, ul);
    });
  });

  const onDragOver = e => {
    e.preventDefault();
    const dragging = ul.querySelector('.dragging');
    if (!dragging) return;
    const afterElement = getDragAfterElement(ul, e.clientY);
    if (!afterElement) {
      ul.appendChild(dragging);
    } else if (afterElement !== dragging) {
      ul.insertBefore(dragging, afterElement);
    }
  };

  if (ul._dragOverHandler) ul.removeEventListener('dragover', ul._dragOverHandler);
  ul._dragOverHandler = onDragOver;
  ul.addEventListener('dragover', onDragOver);
  ul.addEventListener('drop', e => e.preventDefault());
}

function getDragAfterElement(container, y) {
  const elements = [...container.querySelectorAll('.draggable-target:not(.dragging)')];
  return elements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

async function saveTargetOrder(userId, ul) {
  const items = Array.from(ul.children).map(li => ({
    targetType: li.dataset.type,
    targetId: li.dataset.id,
  }));

  try {
    const res = await authedFetch(`/users/${userId}/targets/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) {
      showMessage('❌ Failed to save order', 'error', 'user');
    } else {
      showMessage('✅ Order updated', 'success', 'user');
    }
  } catch (err) {
    console.error('Failed to save order', err);
    showMessage('❌ Failed to save order', 'error', 'user');
  }
}

// Called by the “➕” button
window.addTarget = async function(userId) {
  const typeSelect = document.getElementById(`add-target-type-${userId}`);
  const idSelect = document.getElementById(`add-target-id-${userId}`);
  const type = typeSelect?.value;
  const id = idSelect?.value;
  const prevIdIndex = idSelect?.selectedIndex ?? -1;
  try {
    const res = await authedFetch(`/users/${userId}/targets`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ targetType: type, targetId: id })
    });
    if (!res.ok) {
      showMessage('❌ Failed to add target', 'error', 'user');
    } else {
      // Refresh only that user’s target list
      const users = await fetchJSON('/users');
      const confs = await fetchJSON('/conferences');
      const feeds = await fetchJSON('/feeds');
      await loadUserTargets(userId, users, confs, feeds);
      const nextTypeSelect = document.getElementById(`add-target-type-${userId}`);
      const nextIdSelect = document.getElementById(`add-target-id-${userId}`);
      if (nextTypeSelect && type) {
        nextTypeSelect.value = type;
        nextTypeSelect.dispatchEvent(new Event('change'));
      }
      if (nextIdSelect) {
        selectNextByIndex(nextIdSelect, prevIdIndex);
      }
    }
  } catch (err) {
    showMessage('❌ Failed to add target', 'error', 'user');
    console.error(err);
  }
};

// Called by each 🗑️ in the target list
window.removeTarget = async function(userId, type, tid) {
  try {
    const res = await authedFetch(
      `/users/${userId}/targets/${type}/${tid}`, { method: 'DELETE' }
    );
    if (!res.ok) {
      showMessage('❌ Failed to remove target', 'error', 'user');
    } else {
      const users = await fetchJSON('/users');
      const confs = await fetchJSON('/conferences');
      const feeds = await fetchJSON('/feeds');
      await loadUserTargets(userId, users, confs, feeds);
    }
  } catch (err) {
    showMessage('❌ Failed to remove target', 'error', 'user');
    console.error(err);
  }
};


window.editFeed = async function(feedId, currentName) {
  const newName = prompt('New feed name:', currentName);
  if (!newName || newName === currentName) return;

  try {
    const res = await authedFetch(`/feeds/${feedId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });

    if (res.status === 409) {
      showMessage('⚠️ Feed name already exists!', 'warning', 'feed');
    } else if (res.ok) {
      showMessage('✅ Feed updated', 'success', 'feed');
      await refreshAdminLists({ users: true, feeds: true });
    } else {
      showMessage('❌ Failed to update feed', 'error', 'feed');
    }
  } catch (err) {
    console.error('Error updating feed:', err);
    showMessage('❌ Error updating feed: ' + err.message, 'error', 'feed');
  }
};

window.resetFeedPassword = async function(feedId, feedName) {
  const label = feedName ?? 'this feed';
  const newPassword = prompt(`Enter a new password for ${label}:`);
  if (!newPassword) return;
  if (newPassword.length < 4) {
    showMessage('⚠️ Password should be at least 4 characters', 'warning', 'feed');
    return;
  }

  try {
    const res = await authedFetch(`/feeds/${feedId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword })
    });

    if (res.ok) {
      showMessage(`✅ Password updated for ${label}`, 'success', 'feed');
    } else {
      const payload = await res.json().catch(() => ({}));
      showMessage(payload.error ? `❌ ${payload.error}` : '❌ Failed to reset password', 'error', 'feed');
    }
  } catch (err) {
    console.error('Error resetting feed password:', err);
    showMessage('❌ Error resetting password: ' + err.message, 'error', 'feed');
  }
};

window.deleteFeed = async function(feedId) {
  if (!confirm('Are you sure you want to delete this feed?')) return;
  try {
    const res = await authedFetch(`/feeds/${feedId}`, { method: 'DELETE' });
    if (res.ok) {
      showMessage('✅ Feed deleted', 'success', 'feed');
      await refreshAdminLists({ users: true, feeds: true });
    } else {
      showMessage('❌ Failed to delete feed', 'error', 'feed');
    }
  } catch (err) {
    console.error('Error deleting feed:', err);
    showMessage('❌ Error deleting feed: ' + err.message, 'error', 'feed');
  }
};


window.editUser = async function (userId, currentName) {
  const newName = prompt('New username:', currentName);
  if (!newName || newName === currentName) return;

  try {
    const res = await authedFetch(`/users/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });

    if (res.ok) {
      showMessage('✅ User updated', 'success', 'user');
      await refreshAdminLists({ users: true, conferences: true });
    } else {
      showMessage('❌ Failed to update user', 'error', 'user');
    }
  } catch (err) {
    showMessage('❌ Failed to update user', 'error', 'user');
    console.error(err);
  }
};

window.toggleUserConfs = async function (userId, toggleBtn) {
  const targetDiv = document.getElementById(`user-nested-${userId}`);
  const button    = toggleBtn || document.getElementById(`user-toggle-${userId}`);
  const willOpen  = !targetDiv.classList.contains('is-open');

  if (willOpen) {
    try {
      await renderUserConferenceList(userId);
      targetDiv.classList.add('is-open');
    } catch (err) {
      showMessage('❌ Failed to load conferences', 'error', 'user');
      console.error(err);
      return;
    }
  } else {
    targetDiv.classList.remove('is-open');
  }

  if (button) {
    button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  }
};


// === Rename conferences ===
window.editConference = async function(confId, currentName) {
  const newName = prompt('New conference name:', currentName);
  if (!newName || newName === currentName) return;

  try {
    const res = await authedFetch(`/conferences/${confId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });

    if (res.status === 409) {
      showMessage('⚠️ Conference name already exists!', 'warning', 'conf');
    } else if (res.ok) {
      showMessage('✅ Conference updated', 'success', 'conf');
      await refreshAdminLists({ users: true, conferences: true });
    } else {
      showMessage('❌ Failed to update conference', 'error', 'conf');
    }
  } catch (err) {
    console.error('Error updating conference:', err);
    showMessage('❌ Error updating conference: ' + err.message, 'error', 'conf');
  }
};


window.toggleConfUsers = async function (confId, toggleBtn) {
  const nested   = document.getElementById(`conf-controls-${confId}`);
  const button   = toggleBtn || document.getElementById(`conf-toggle-${confId}`);
  const willOpen = !nested.classList.contains('is-open');

  if (willOpen) {
    try {
      await renderConferenceParticipantList(confId);
      nested.classList.add('is-open');
    } catch (err) {
      showMessage('❌ Failed to load participants', 'error', 'conf');
      console.error(err);
      return;
    }
  } else {
    nested.classList.remove('is-open');
  }

  if (button) {
    button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  }
};



window.confirmUnassign = function (userId, confId) {
  if (confirm('Are you sure you want to remove this user from the conference?')) {
    unassignUser(userId, confId);
  }
};

window.unassignUser = async function (userId, confId) {
  try {
    const res = await authedFetch(`/conferences/${confId}/users/${userId}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      showMessage('✅ User removed from conference', 'success', 'user');
      const [users, confs] = await Promise.all([
        fetchJSON('/users'),
        fetchJSON('/conferences'),
      ]);
      await Promise.all([
        updateUserConferenceOptions(userId, confs),
        updateConferenceParticipantOptions(confId, users),
        document.getElementById(`user-nested-${userId}`)?.classList.contains('is-open')
          ? renderUserConferenceList(userId)
          : Promise.resolve(),
        document.getElementById(`conf-controls-${confId}`)?.classList.contains('is-open')
          ? renderConferenceParticipantList(confId)
          : Promise.resolve(),
      ]);
    } else if (res.status === 404) {
      showMessage('⚠️ Relationship not found', 'warning', 'user');
    } else {
      showMessage('❌ Failed to remove user', 'error', 'user');
    }
  } catch (err) {
    showMessage('❌ Unexpected error: ' + err.message, 'error', 'user');
    console.error(err);
  }
};
window.deleteUser = async function (userId) {
  if (!confirm('Are you sure you want to delete this user?')) return;
  try {
    const res = await authedFetch(`/users/${userId}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      showMessage('✅ User deleted', 'success', 'user');
      await refreshAdminLists({ users: true, conferences: true });
    } else {
      const payload = await res.json().catch(() => ({}));
      showMessage(payload.error ? `❌ ${payload.error}` : '❌ Failed to delete user', 'error', 'user');
    }
  } catch (err) {
    showMessage('❌ Error deleting user: ' + err.message, 'error', 'user');
    console.error(err);
  }
};

window.toggleFeedBridge = function(feedId, toggleBtn) {
  const nested = document.getElementById(`feed-nested-${feedId}`);
  const button = toggleBtn || document.getElementById(`feed-toggle-${feedId}`);
  if (!nested) return;

  const willOpen = !nested.classList.contains('is-open');
  nested.classList.toggle('is-open', willOpen);
  if (button) {
    button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  }
};

window.toggleAdminRole = async function (userId, shouldMakeAdmin) {
  const label = shouldMakeAdmin ? 'grant admin rights' : 'remove admin rights';
  if (!confirm(`Are you sure you want to ${label} for this user?`)) return;
  try {
    const res = await authedFetch(`/admin/users/${userId}/admin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isAdmin: Boolean(shouldMakeAdmin) })
    });
    if (res.ok) {
      showMessage('✅ Admin role updated', 'success', 'user');
      await refreshAdminLists({ users: true, conferences: true });
    } else {
      const payload = await res.json().catch(() => ({}));
      showMessage(payload.error ? `❌ ${payload.error}` : '❌ Failed to update admin role', 'error', 'user');
    }
  } catch (err) {
    showMessage('❌ Error updating admin role: ' + err.message, 'error', 'user');
    console.error(err);
  }
};

window.copyUserLoginUrl = async function (userId, userName, button) {
  const originalLabel = button?.textContent || 'Copy Login URL';
  if (button) button.disabled = true;
  try {
    const res = await authedFetch(`/admin/users/${userId}/login-link`, {
      method: 'POST'
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload.token) {
      throw new Error(payload.error || 'Failed to create login URL');
    }

    const loginUrl = `${window.location.origin}/#login=${encodeURIComponent(payload.token)}`;
    await copyTextToClipboard(loginUrl);
    if (button) button.textContent = 'Copied';
    showMessage(`✅ Login URL copied for ${userName}`, 'success', 'user');
    window.setTimeout(() => {
      if (button) {
        button.textContent = originalLabel;
        button.disabled = false;
      }
    }, 1800);
  } catch (err) {
    if (button) button.disabled = false;
    showMessage(`❌ ${err.message || 'Failed to copy login URL'}`, 'error', 'user');
    console.error('Failed to copy login URL:', err);
  }
};

window.saveBridgeEndpoint = async function(event, userId) {
  event.preventDefault();

  const submitButton = event.submitter;
  if (submitButton) submitButton.disabled = true;

  try {
    const inputPair = readBridgePairSelect(`bridge-input-pair-${userId}`, 'Input');
    const outputPair = readBridgePairSelect(`bridge-output-pair-${userId}`, 'Output');
    validateBridgeChannelPair(inputPair.left, inputPair.right, 'Input');
    validateBridgeChannelPair(outputPair.left, outputPair.right, 'Output');

    const enabled = Boolean(document.getElementById(`bridge-enabled-${userId}`)?.checked);
    const payload = {
      enabled,
      bridgeDevice: document.getElementById(`bridge-device-${userId}`)?.value || '',
      inputDevice: document.getElementById(`bridge-input-device-${userId}`)?.value || '',
      inputLeftChannel: inputPair.left,
      inputRightChannel: inputPair.right,
      outputDevice: document.getElementById(`bridge-output-device-${userId}`)?.value || '',
      outputLeftChannel: outputPair.left,
      outputRightChannel: outputPair.right,
      ...readBridgeTriggerConfig(userId, enabled),
    };
    if (payload.enabled) {
      if (!payload.bridgeDevice) {
        throw new Error('Bridge device is required when bridge endpoint is enabled');
      }
      validateOptionalBridgeDeviceChannel(payload.inputDevice, payload.inputLeftChannel, 'Input');
      validateOptionalBridgeDeviceChannel(payload.outputDevice, payload.outputLeftChannel, 'Output');
    }

    const res = await authedFetch(`/users/${userId}/bridge-endpoint`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      showMessage('Bridge endpoint saved', 'success', 'user');
      await refreshAdminLists({ users: true });
    } else {
      const response = await res.json().catch(() => ({}));
      showMessage(response.error || 'Failed to save bridge endpoint', 'error', 'user');
    }
  } catch (err) {
    showMessage(err.message || 'Failed to save bridge endpoint', 'error', 'user');
    console.error(err);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
};

window.saveFeedBridgeEndpoint = async function(event, feedId) {
  event.preventDefault();
  const formKey = `feed-${feedId}`;

  const submitButton = event.submitter;
  if (submitButton) submitButton.disabled = true;

  try {
    const inputPair = readBridgePairSelect(`bridge-input-pair-${formKey}`, 'Input');
    validateBridgeChannelPair(inputPair.left, inputPair.right, 'Input');

    const payload = {
      enabled: Boolean(document.getElementById(`bridge-enabled-${formKey}`)?.checked),
      bridgeDevice: document.getElementById(`bridge-device-${formKey}`)?.value || '',
      inputDevice: document.getElementById(`bridge-input-device-${formKey}`)?.value || '',
      inputLeftChannel: inputPair.left,
      inputRightChannel: inputPair.right,
    };
    if (payload.enabled) {
      if (!payload.bridgeDevice) {
        throw new Error('Bridge device is required when bridge endpoint is enabled');
      }
      validateOptionalBridgeDeviceChannel(payload.inputDevice, payload.inputLeftChannel, 'Input');
    }

    const res = await authedFetch(`/feeds/${feedId}/bridge-endpoint`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      showMessage('Bridge feed endpoint saved', 'success', 'feed');
      await refreshAdminLists({ feeds: true });
    } else {
      const response = await res.json().catch(() => ({}));
      showMessage(response.error || 'Failed to save bridge feed endpoint', 'error', 'feed');
    }
  } catch (err) {
    showMessage(err.message || 'Failed to save bridge feed endpoint', 'error', 'feed');
    console.error(err);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
};

window.deleteConference = async function (confId) {
  if (!confirm('Are you sure you want to delete this conference?')) return;
  try {
    const res = await authedFetch(`/conferences/${confId}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      showMessage('✅ Conference deleted', 'success', 'conf');
      await refreshAdminLists({ users: true, conferences: true });
    } else {
      let message = `Failed to delete conference (${res.status})`;
      try {
        const payload = await res.json();
        if (payload?.error) message = payload.error;
      } catch {}
      showMessage(`❌ ${message}`, 'error', 'conf');
    }
  } catch (err) {
    showMessage('❌ Error deleting conference: ' + err.message, 'error', 'conf');
    console.error(err);
  }
};


document.getElementById('user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  try {
    const res = await authedFetch('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password })
    });

    if (res.status === 409) {
      showMessage('⚠️ Username already exists!', 'warning', 'user');
    } else if (res.ok) {
      showMessage('✅ User created', 'success', 'user');
      await refreshAdminLists({ users: true, conferences: true });
    } else {
      showMessage('❌ Failed to create user', 'error', 'user');
    }
  } catch (err) {
    showMessage('❌ Failed to create user', 'error', 'user');
    console.error(err);
  }
});

document.getElementById('conf-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('confname').value;

  try {
    const res = await authedFetch('/conferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    if (res.status === 409) {
      showMessage('⚠️ Conference already exists!', 'warning', 'conf');
    } else if (res.ok) {
      showMessage('✅ Conference created', 'success', 'conf');
      await refreshAdminLists({ users: true, conferences: true });
    } else {
      showMessage('❌ Failed to create conference', 'error', 'conf');
    }
  } catch (err) {
    showMessage('❌ Failed to create conference', 'error', 'conf');
    console.error(err);
  }
});

document.getElementById('feed-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('feedname').value;
  const password = document.getElementById('feedpassword').value;

  try {
    const res = await authedFetch('/feeds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password })
    });

    if (res.status === 409) {
      showMessage('⚠️ Feed already exists!', 'warning', 'feed');
    } else if (res.ok) {
      showMessage('✅ Feed created', 'success', 'feed');
      await refreshAdminLists({ users: true, feeds: true });
    } else {
      showMessage('❌ Failed to create feed', 'error', 'feed');
    }
  } catch (err) {
    showMessage('❌ Failed to create feed', 'error', 'feed');
    console.error(err);
  }
});

document.getElementById('mdns-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('mdns-host');
  const mdnsHost = input?.value?.trim() || '';

  try {
    const res = await authedFetch('/admin/settings/mdns', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mdnsHost })
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      showMessage(payload.error || 'Failed to save mDNS name', 'error', 'config');
      return;
    }

    const payload = await res.json();
    await loadMdnsSettings();
    showMessage(
      payload.restartRequired
        ? '✅ mDNS name saved. Restart the server to apply it.'
        : '✅ mDNS name saved.',
      'success',
      'config'
    );
  } catch (err) {
    console.error('Failed to save mDNS setting:', err);
    showMessage('❌ Failed to save mDNS name', 'error', 'config');
  }
});

document.getElementById('media-network-mode')?.addEventListener('change', () => {
  updateMediaNetworkFormVisibility();
});

document.getElementById('media-network-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const mode = document.getElementById('media-network-mode')?.value || 'auto';
  const mediaInterfaceName = document.getElementById('media-interface-name')?.value || '';
  const mediaAnnouncedAddress = document.getElementById('media-announced-address')?.value?.trim() || '';

  try {
    const res = await authedFetch('/admin/settings/media-network', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaNetworkMode: mode,
        mediaInterfaceName,
        mediaAnnouncedAddress,
      }),
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      showMessage(payload.error || 'Failed to save media network', 'error', 'config');
      return;
    }

    const payload = await res.json();
    await loadMediaNetworkSettings();
    showMessage(
      payload.environmentOverride
        ? '✅ Media network setting saved. An environment override is currently active.'
        : payload.restartRequired
          ? '✅ Media network saved. Restart the server to apply it.'
          : '✅ Media network saved.',
      'success',
      'config'
    );
  } catch (err) {
    console.error('Failed to save media network setting:', err);
    showMessage('❌ Failed to save media network', 'error', 'config');
  }
});

document.getElementById('rtc-ports-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const rtcPortStart = document.getElementById('rtc-port-start')?.value?.trim() || '';
  const rtcPortCount = document.getElementById('rtc-port-count')?.value?.trim() || '';

  try {
    const res = await authedFetch('/admin/settings/rtc-ports', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rtcPortStart,
        rtcPortCount,
      }),
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      showMessage(payload.error || 'Failed to save RTC ports', 'error', 'config');
      return;
    }

    const payload = await res.json();
    await loadRtcPortSettings();
    showMessage(
      payload.environmentOverride
        ? '✅ RTC port range saved. An environment override is currently active.'
        : payload.restartRequired
          ? '✅ RTC port range saved. Restart the server to apply it.'
          : '✅ RTC port range saved.',
      'success',
      'config'
    );
  } catch (err) {
    console.error('Failed to save RTC port setting:', err);
    showMessage('❌ Failed to save RTC ports', 'error', 'config');
  }
});

if (guestLoginForm) {
  guestLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await authedFetch('/admin/settings/guest-login', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: Boolean(guestLoginEnabledInput?.checked) })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showMessage(payload.error || 'Failed to save Guest login', 'error', 'config');
        return;
      }
      showMessage(
        payload.enabled ? '✅ Guest login enabled' : '✅ Guest login disabled',
        'success',
        'config'
      );
      await loadGuestLoginSettings();
      await refreshAdminLists({ users: true, conferences: true });
    } catch (err) {
      console.error('Failed to save Guest login:', err);
      showMessage('❌ Failed to save Guest login', 'error', 'config');
    }
  });
}

if (configExportBtn) {
  configExportBtn.addEventListener('click', async () => {
    try {
      const res = await authedFetch('/admin/config/export');
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        showMessage(payload.error || 'Failed to export configuration', 'error', 'config');
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || 'talktome-config.json';
      triggerDownload(blob, filename);
      showMessage('✅ Configuration exported', 'success', 'config');
    } catch (err) {
      console.error('Failed to export configuration:', err);
      showMessage('❌ Failed to export configuration', 'error', 'config');
    }
  });
}

if (apiKeyCopyBtn) {
  apiKeyCopyBtn.addEventListener('click', async () => {
    const originalLabel = apiKeyCopyBtn.textContent;
    apiKeyCopyBtn.disabled = true;

    try {
      const res = await authedFetch('/admin/api-key');
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.apiKey) {
        showMessage(payload.error || 'Failed to load API key', 'error', 'config');
        return;
      }

      await copyTextToClipboard(payload.apiKey);
      apiKeyCopyBtn.textContent = 'Copied';
      showMessage('✅ API key copied', 'success', 'config');
      window.setTimeout(() => {
        apiKeyCopyBtn.textContent = originalLabel;
      }, 1200);
    } catch (err) {
      console.error('Failed to copy API key:', err);
      showMessage('❌ Failed to copy API key', 'error', 'config');
    } finally {
      window.setTimeout(() => {
        apiKeyCopyBtn.disabled = false;
      }, 250);
    }
  });
}

if (configImportBtn) {
  configImportBtn.addEventListener('click', async () => {
    const file = configImportFile?.files?.[0];
    if (!file) {
      showMessage('⚠️ Select a config file first', 'warning', 'config');
      return;
    }

    const confirmed = confirm('Importing will replace the current users, conferences, feeds and target configuration. Continue?');
    if (!confirmed) return;

    configImportBtn.disabled = true;

    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const res = await authedFetch('/admin/config/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const responsePayload = await res.json().catch(() => ({}));
        showMessage(responsePayload.error || 'Failed to import configuration', 'error', 'config');
        configImportBtn.disabled = false;
        return;
      }

      const responsePayload = await res.json();
      await loadData();
      if (configImportFile) {
        configImportFile.value = '';
      }

      showMessage(
        responsePayload.restartRequired
          ? '✅ Configuration imported. Restart the server to fully apply it.'
          : '✅ Configuration imported.',
        'success',
        'config'
      );
    } catch (err) {
      console.error('Failed to import configuration:', err);
      showMessage('❌ Failed to import configuration', 'error', 'config');
    } finally {
      configImportBtn.disabled = false;
    }
  });
}


// Called by the "Add to Conf" button inside each user's block
window.assignUserToConference = async function(userId) {
  const sel = document.getElementById(`add-user-conf-${userId}`);
  const confId = sel.value;
  const prevIndex = sel?.selectedIndex ?? -1;
  try {
    const res = await authedFetch(`/conferences/${confId}/users/${userId}`, {
      method: 'POST'
    });
    if (res.ok) {
      showMessage('✅ User assigned to conference', 'success', 'user');
      const [users, confs] = await Promise.all([
        fetchJSON('/users'),
        fetchJSON('/conferences'),
      ]);
      await Promise.all([
        updateUserConferenceOptions(userId, confs, prevIndex),
        updateConferenceParticipantOptions(confId, users),
        document.getElementById(`user-nested-${userId}`)?.classList.contains('is-open')
          ? renderUserConferenceList(userId)
          : Promise.resolve(),
        document.getElementById(`conf-controls-${confId}`)?.classList.contains('is-open')
          ? renderConferenceParticipantList(confId)
          : Promise.resolve(),
      ]);
    } else {
      showMessage('❌ Failed to assign user to conference', 'error', 'user');
    }
  } catch (err) {
    showMessage('❌ Failed to assign user to conference', 'error', 'user');
    console.error(err);
  }
};

window.assignConferenceParticipant = async function(confId) {
  const sel = document.getElementById(`add-conf-user-${confId}`);
  const userId = sel?.value;
  const prevIndex = sel?.selectedIndex ?? -1;

  if (!sel || !userId) return;

  try {
    const res = await authedFetch(`/conferences/${confId}/users/${userId}`, {
      method: 'POST'
    });
    if (res.ok) {
      showMessage('✅ User assigned to conference', 'success', 'conf');
      const [users, confs] = await Promise.all([
        fetchJSON('/users'),
        fetchJSON('/conferences'),
      ]);
      await Promise.all([
        updateConferenceParticipantOptions(confId, users, prevIndex),
        updateUserConferenceOptions(userId, confs),
        document.getElementById(`conf-controls-${confId}`)?.classList.contains('is-open')
          ? renderConferenceParticipantList(confId)
          : Promise.resolve(),
        document.getElementById(`user-nested-${userId}`)?.classList.contains('is-open')
          ? renderUserConferenceList(userId)
          : Promise.resolve(),
      ]);
    } else {
      showMessage('❌ Failed to assign user to conference', 'error', 'conf');
    }
  } catch (err) {
    showMessage('❌ Failed to assign user to conference', 'error', 'conf');
    console.error(err);
  }
};

window.resetPassword = async function(userId, userName) {
  const label = userName ?? 'this user';
  const newPassword = prompt(`Enter a new password for ${label}:`);
  if (!newPassword) return;
  if (newPassword.length < 4) {
    showMessage('⚠️ Password should be at least 4 characters', 'warning', 'user');
    return;
  }

  try {
    const res = await authedFetch(`/users/${userId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword })
    });

    if (res.ok) {
      showMessage(`✅ Password updated for ${label}`, 'success', 'user');
    } else {
      const payload = await res.json().catch(() => ({}));
      showMessage(payload.error ? `❌ ${payload.error}` : '❌ Failed to reset password', 'error', 'user');
    }
  } catch (err) {
    showMessage('❌ Error resetting password: ' + err.message, 'error', 'user');
  }
};

if (adminLoginForm) {
  adminLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('admin-name')?.value?.trim() || '';
    const password = document.getElementById('admin-password')?.value || '';

    if (!name || !password) {
      showLoginMessage('Username and password are required.', 'warning');
      return;
    }

    try {
      const res = await fetch('/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password })
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        showLoginMessage(payload.error || 'Login failed.');
        return;
      }

      const payload = await res.json();
      applyAdminState(payload);
      showAdminApp();
      const ok = await enforcePasswordChange();
      if (ok) {
        await loadData();
      }
    } catch (err) {
      showLoginMessage('Login failed.');
      console.error('Admin login error:', err);
    }
  });
}

if (adminLogoutBtn) {
  adminLogoutBtn.addEventListener('click', () => logoutAdmin());
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && adminState.isAuthenticated && latestAdminStatus && serverReachable !== false) {
    renderAdminStatus(latestAdminStatus);
  }
});

function setupMatrixInteractions(container, toggleSelector, toggleHandler) {
  if (!container) return;
  let paintSession = null;
  let suppressPointerClick = false;

  const findToggleAtPoint = (event) => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const toggle = element?.closest(toggleSelector);
    return toggle && container.contains(toggle) ? toggle : null;
  };

  const paintToggle = (toggle) => {
    if (!paintSession || !toggle || paintSession.visited.has(toggle)) return;
    paintSession.visited.add(toggle);
    toggleHandler(toggle, paintSession.enabled);
  };

  container.addEventListener('click', (event) => {
    const toggle = event.target.closest(toggleSelector);
    if (!toggle) return;
    if (suppressPointerClick) {
      event.preventDefault();
      return;
    }
    toggleHandler(toggle);
  });
  container.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' || event.button !== 0) return;
    const toggle = event.target.closest(toggleSelector);
    if (!toggle || toggle.disabled) return;

    event.preventDefault();
    suppressPointerClick = true;
    paintSession = {
      pointerId: event.pointerId,
      enabled: toggle.getAttribute('aria-pressed') !== 'true',
      visited: new Set(),
    };
    container.classList.add('is-painting');
    try {
      container.setPointerCapture(event.pointerId);
    } catch {}
    paintToggle(toggle);
  });
  container.addEventListener('pointermove', (event) => {
    if (!paintSession || event.pointerId !== paintSession.pointerId) return;
    if ((event.buttons & 1) === 0) {
      finishPainting(event);
      return;
    }

    event.preventDefault();
    const toggle = findToggleAtPoint(event);
    paintToggle(toggle);
    const cell = toggle?.closest('[data-matrix-column]');
    highlightMatrixColumn(container, cell?.dataset.matrixColumn ?? null);
  });

  const finishPainting = (event) => {
    if (!paintSession || event.pointerId !== paintSession.pointerId) return;
    paintSession = null;
    container.classList.remove('is-painting');
    try {
      container.releasePointerCapture(event.pointerId);
    } catch {}
    setTimeout(() => {
      suppressPointerClick = false;
    }, 0);
  };
  container.addEventListener('pointerup', finishPainting);
  container.addEventListener('pointercancel', finishPainting);
  container.addEventListener('pointerover', (event) => {
    const cell = event.target.closest('[data-matrix-column]');
    highlightMatrixColumn(container, cell?.dataset.matrixColumn ?? null);
  });
  container.addEventListener('pointerleave', () => {
    highlightMatrixColumn(container);
  });
  container.addEventListener('focusin', (event) => {
    const cell = event.target.closest('[data-matrix-column]');
    highlightMatrixColumn(container, cell?.dataset.matrixColumn ?? null);
  });
  container.addEventListener('focusout', (event) => {
    if (!container.contains(event.relatedTarget)) {
      highlightMatrixColumn(container);
    }
  });
}

setupMatrixInteractions(targetMatrixContainer, '.target-matrix-toggle', handleTargetMatrixToggle);
setupMatrixInteractions(
  conferenceMembershipMatrixContainer,
  '.conference-membership-toggle',
  handleConferenceMembershipToggle
);

if (mediaNetworkQrButton) {
  mediaNetworkQrButton.addEventListener('click', () => openAdminImageLightbox());
}

if (mediaNetworkQrDownloadButton) {
  mediaNetworkQrDownloadButton.addEventListener('click', () => downloadMediaNetworkQrImage());
}

if (adminImageLightboxClose) {
  adminImageLightboxClose.addEventListener('click', () => closeAdminImageLightbox());
}

if (adminImageLightboxDownloadButton) {
  adminImageLightboxDownloadButton.addEventListener('click', () => downloadMediaNetworkQrImage());
}

if (adminImageLightbox) {
  adminImageLightbox.addEventListener('click', (event) => {
    if (event.target === adminImageLightbox) {
      closeAdminImageLightbox();
    }
  });
}

window.addEventListener('resize', () => {
  if (mediaNetworkQrContainer && !mediaNetworkQrContainer.classList.contains('is-hidden')) {
    syncMediaNetworkQrPreviewSize();
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && adminImageLightbox && !adminImageLightbox.classList.contains('is-hidden')) {
    closeAdminImageLightbox();
  }
});

ensureAdminSession();
