const adminState = {
  isAuthenticated: false,
  isGlobalAdmin: false,
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
const adminBarMessage = document.getElementById('admin-bar-message');
const adminNameLabel = document.getElementById('admin-name-label');
const adminLogoutBtn = document.getElementById('admin-logout');
const adminNavLinks = [...document.querySelectorAll('[data-admin-nav]')];
const statusUsersBody = document.getElementById('status-users-body');
const statusFeedsBody = document.getElementById('status-feeds-body');
const statusBridgesBody = document.getElementById('status-bridges-body');
const statusCompanionsBody = document.getElementById('status-companions-body');
const targetMatrixContainer = document.getElementById('target-matrix-container');
const userPicker = document.getElementById('user-picker');
const userSearch = document.getElementById('user-search');
const userSearchClear = document.getElementById('user-search-clear');
const userEmpty = document.getElementById('user-empty');
const conferencePicker = document.getElementById('conference-picker');
const conferenceSearch = document.getElementById('conference-search');
const conferenceSearchClear = document.getElementById('conference-search-clear');
const conferenceEmpty = document.getElementById('conference-empty');
const feedPicker = document.getElementById('feed-picker');
const feedSearch = document.getElementById('feed-search');
const feedSearchClear = document.getElementById('feed-search-clear');
const feedEmpty = document.getElementById('feed-empty');
const productionList = document.getElementById('production-list');
const productionCreateForm = document.getElementById('production-create-form');
const productionCreateName = document.getElementById('production-create-name');
const productionSearch = document.getElementById('production-search');
const productionSearchClear = document.getElementById('production-search-clear');
const productionEmpty = document.getElementById('production-empty');
const productionDetail = document.getElementById('production-detail');
const productionDetailName = document.getElementById('production-detail-name');
const productionGlobalActions = document.getElementById('production-global-actions');
const productionRenameButton = document.getElementById('production-rename');
const productionDeleteButton = document.getElementById('production-delete');
const productionMembersList = document.getElementById('production-members');
const productionTargetMatrixContainer = document.getElementById('production-target-matrix-container');
const productionOrderUser = document.getElementById('production-order-user');
const productionOrderList = document.getElementById('production-order-list');
const productionLayout = document.getElementById('production-layout');
const productionSidebar = document.getElementById('production-sidebar');
const productionDefaultDetail = document.getElementById('production-default-detail');
const multipleProductionsInput = document.getElementById('multiple-productions-enabled');
const configExportBtn = document.getElementById('config-export-btn');
const configImportBtn = document.getElementById('config-import-btn');
const configImportFile = document.getElementById('config-import-file');
const automaticBackupForm = document.getElementById('config-auto-backup-form');
const automaticBackupEnabled = document.getElementById('config-auto-backup-enabled');
const automaticBackupInterval = document.getElementById('config-auto-backup-interval');
const apiKeyRegenerateBtn = document.getElementById('api-key-regenerate-btn');
const apiKeyCopyBtn = document.getElementById('api-key-copy-btn');
const apiKeyValueInput = document.getElementById('api-key-value');
const containerRestartPanel = document.getElementById('container-restart-panel');
const containerRestartBtn = document.getElementById('container-restart-btn');
const mediaNetworkMeta = document.getElementById('media-network-meta');
const mediaNetworkQrContainer = document.getElementById('media-network-qr');
const mediaNetworkQrButton = document.getElementById('media-network-qr-button');
const mediaNetworkQrImage = document.getElementById('media-network-qr-image');
const mediaNetworkQrDownloadButton = document.getElementById('media-network-qr-download');
const guestLoginEnabledInput = document.getElementById('guest-login-enabled');
const guestLoginStatus = document.getElementById('guest-login-status');
const guestLoginProfile = document.getElementById('guest-login-profile');
const defaultClientSettingsForm = document.getElementById('default-client-settings-form');
const defaultClientAudioProfile = document.getElementById('default-client-audio-profile');
const defaultClientDimAmount = document.getElementById('default-client-dim-amount');
const defaultClientDimSelf = document.getElementById('default-client-dim-self');
const defaultClientDimIncoming = document.getElementById('default-client-dim-incoming');
const defaultClientAudioProcessing = document.getElementById('default-client-audio-processing');
const defaultClientConnectionSounds = document.getElementById('default-client-connection-sounds');
const defaultClientLeftHand = document.getElementById('default-client-left-hand');
const defaultClientLockMultiple = document.getElementById('default-client-lock-multiple');
const adminImageLightbox = document.getElementById('admin-image-lightbox');
const adminImageLightboxClose = document.getElementById('admin-image-lightbox-close');
const adminImageLightboxTitle = document.getElementById('admin-image-lightbox-title');
const adminImageLightboxImage = document.getElementById('admin-image-lightbox-image');
const adminImageLightboxDownloadButton = document.getElementById('admin-image-lightbox-download');
const adminActionDialog = document.getElementById('admin-action-dialog');
const adminActionDialogForm = document.getElementById('admin-action-dialog-form');
const adminActionDialogTitle = document.getElementById('admin-action-dialog-title');
const adminActionDialogMessage = document.getElementById('admin-action-dialog-message');
const adminActionDialogField = document.getElementById('admin-action-dialog-field');
const adminActionDialogLabel = document.getElementById('admin-action-dialog-label');
const adminActionDialogInput = document.getElementById('admin-action-dialog-input');
const adminActionDialogPasswordToggle = document.getElementById('admin-action-dialog-password-toggle');
const adminActionDialogError = document.getElementById('admin-action-dialog-error');
const adminActionDialogCancel = document.getElementById('admin-action-dialog-cancel');
const adminActionDialogConfirm = document.getElementById('admin-action-dialog-confirm');

let activeAdminActionDialog = null;

function closeAdminActionDialog(result) {
  const state = activeAdminActionDialog;
  if (!state) return;

  activeAdminActionDialog = null;
  adminActionDialog?.classList.add('is-hidden');
  document.body.classList.remove('admin-dialog-open');
  adminActionDialogForm?.reset();
  adminActionDialogError?.classList.add('is-hidden');
  if (adminActionDialogError) adminActionDialogError.textContent = '';

  const returnFocus = state.returnFocus;
  state.resolve(result);
  window.setTimeout(() => {
    if (returnFocus?.isConnected && typeof returnFocus.focus === 'function') {
      returnFocus.focus();
    }
  }, 0);
}

function showAdminActionDialogError(message) {
  if (!adminActionDialogError) return;
  adminActionDialogError.textContent = message;
  adminActionDialogError.classList.toggle('is-hidden', !message);
}

function openAdminActionDialog({
  mode = 'confirm',
  title = 'Confirm action',
  message = '',
  label = 'Value',
  value = '',
  inputType = 'text',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  required = false,
  minLength = 0,
  validationMessage = '',
} = {}) {
  if (!adminActionDialog || !adminActionDialogForm) {
    return Promise.resolve(mode === 'input' ? null : false);
  }

  if (activeAdminActionDialog) closeAdminActionDialog(null);

  return new Promise((resolve) => {
    const hasInput = mode === 'input';
    const canCancel = mode !== 'notice';
    activeAdminActionDialog = {
      resolve,
      mode,
      canCancel,
      required,
      minLength: Number(minLength) || 0,
      validationMessage,
      returnFocus: document.activeElement,
    };

    adminActionDialogTitle.textContent = title;
    adminActionDialogMessage.textContent = message;
    adminActionDialogField.classList.toggle('is-hidden', !hasInput);
    adminActionDialogLabel.textContent = label;
    const isPassword = inputType === 'password';
    adminActionDialogInput.type = isPassword ? 'password' : 'text';
    adminActionDialogInput.autocomplete = isPassword ? 'new-password' : 'off';
    adminActionDialogInput.value = String(value ?? '');
    adminActionDialogInput.parentElement?.classList.toggle('has-password-toggle', isPassword);
    adminActionDialogPasswordToggle.classList.toggle('is-hidden', !isPassword);
    adminActionDialogPasswordToggle.setAttribute('aria-pressed', 'false');
    adminActionDialogPasswordToggle.setAttribute('aria-label', 'Show password');
    adminActionDialogPasswordToggle.title = 'Show password';
    adminActionDialogCancel.textContent = cancelLabel;
    adminActionDialogCancel.classList.toggle('is-hidden', !canCancel);
    adminActionDialogConfirm.textContent = confirmLabel;
    adminActionDialogConfirm.classList.toggle('danger', Boolean(danger));
    showAdminActionDialogError('');

    document.body.classList.add('admin-dialog-open');
    adminActionDialog.classList.remove('is-hidden');
    window.requestAnimationFrame(() => {
      if (hasInput) {
        adminActionDialogInput.focus();
        adminActionDialogInput.select();
      } else {
        adminActionDialogConfirm.focus();
      }
    });
  });
}

function adminConfirm(message, options = {}) {
  return openAdminActionDialog({ mode: 'confirm', message, ...options });
}

function adminPrompt(message, value = '', options = {}) {
  return openAdminActionDialog({
    mode: 'input',
    title: 'Change value',
    message,
    value,
    required: true,
    ...options,
  });
}

function adminNotice(message, options = {}) {
  return openAdminActionDialog({
    mode: 'notice',
    title: 'Notice',
    message,
    confirmLabel: 'OK',
    ...options,
  });
}

adminActionDialogForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const state = activeAdminActionDialog;
  if (!state) return;

  if (state.mode === 'input') {
    const value = adminActionDialogInput.value;
    if (state.required && !value.trim()) {
      showAdminActionDialogError(state.validationMessage || 'Please enter a value.');
      adminActionDialogInput.focus();
      return;
    }
    if (state.minLength > 0 && value.trim().length < state.minLength) {
      showAdminActionDialogError(
        state.validationMessage || `Please enter at least ${state.minLength} characters.`
      );
      adminActionDialogInput.focus();
      return;
    }
    closeAdminActionDialog(value);
    return;
  }

  closeAdminActionDialog(true);
});

adminActionDialogCancel?.addEventListener('click', () => closeAdminActionDialog(null));
adminActionDialog?.addEventListener('pointerdown', (event) => {
  if (event.target === adminActionDialog && activeAdminActionDialog?.canCancel) {
    closeAdminActionDialog(null);
  }
});
document.addEventListener('keydown', (event) => {
  if (!activeAdminActionDialog || adminActionDialog.classList.contains('is-hidden')) return;
  if (event.key === 'Escape' && activeAdminActionDialog.canCancel) {
    event.preventDefault();
    closeAdminActionDialog(null);
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = [...adminActionDialog.querySelectorAll('button:not([disabled]):not(.is-hidden), input:not([disabled]):not(.is-hidden)')]
    .filter((element) => element.offsetParent !== null);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

function syncExpandedAdminBarOffset() {
  if (!adminBar?.classList.contains('has-expanded-message')) {
    document.documentElement.style.removeProperty('--admin-expanded-bar-height');
    return;
  }
  document.documentElement.style.setProperty(
    '--admin-expanded-bar-height',
    `${Math.ceil(adminBar.getBoundingClientRect().height)}px`
  );
}

window.addEventListener('resize', syncExpandedAdminBarOffset);

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
let currentAdminImageLightboxState = null;
let currentBridgeRegistry = [];
let currentAdminCatalog = { users: [], conferences: [], feeds: [] };
const targetAssignmentsByUser = new Map();
const targetEditorRefreshTimers = new Map();
const conferenceMembershipEditorRefreshes = new Map();
let statusLoadPromise = null;
let statusEventSource = null;
let statusClockTimer = null;
let statusFallbackTimer = null;
let statusHealthTimer = null;
let latestAdminStatus = null;
let serverReachable = null;
let activeAdminView = null;
let productionSummaries = [];
let selectedProductionId = null;
let selectedProductionPayload = null;
let guestLoginEnabled = false;
let currentApiKey = '';
const entityMasterDetailState = {
  users: { selectedId: null, query: '' },
  conferences: { selectedId: null, query: '' },
  feeds: { selectedId: null, query: '' },
};
let productionSearchQuery = '';
let multipleProductionsEnabled = false;
let multipleProductionsSupported = true;

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
  clearApiKeyField();
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
  const el = adminBarMessage;
  if (!el) return;

  const toneClass = tone === 'success' || tone === 'green'
    ? 'flash-success'
    : tone === 'warning'
      ? 'flash-warning'
      : 'flash-error';

  el.textContent = text;
  el.title = text;
  el.classList.remove('flash-success', 'flash-error', 'flash-warning');
  el.classList.add('is-visible', toneClass);
  adminBar?.classList.add('has-message');
  adminBar?.classList.remove('has-expanded-message');

  window.requestAnimationFrame(() => {
    if (!el.classList.contains('is-visible')) return;
    const isTruncated = el.scrollWidth > el.clientWidth + 1;
    adminBar?.classList.toggle('has-expanded-message', isTruncated);
    syncExpandedAdminBarOffset();
  });

  showMessage._timers = showMessage._timers || {};
  clearTimeout(showMessage._timers.adminBar);
  showMessage._timers.adminBar = setTimeout(() => {
    el.classList.remove('is-visible', toneClass);
    el.textContent = '';
    el.removeAttribute('title');
    adminBar?.classList.remove('has-message', 'has-expanded-message');
    syncExpandedAdminBarOffset();
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
    .filter((link) => !link.hidden)
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

  let listItem = document.querySelector(`#user-list [data-entity-id="${numericUserId}"]`);
  if (!listItem) {
    await refreshAdminLists({ users: true });
    listItem = document.querySelector(`#user-list [data-entity-id="${numericUserId}"]`);
  }
  if (!listItem) return;

  try {
    await selectAdminEntity('users', numericUserId);
  } catch (err) {
    showMessage('❌ Failed to load user details', 'error', 'user');
    console.error(err);
    return;
  }
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      listItem.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      if (window.matchMedia?.('(hover: none) and (pointer: coarse)').matches) {
        link.blur();
      }
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

function updateBridgeTriggerTargetOptions(userId, targets = [], { includeUnavailable = true } = {}) {
  const select = document.getElementById(`bridge-trigger-target-${userId}`);
  if (!select) return;

  const savedValue = select.dataset.savedValue || '';
  const preferredValue = select.value || savedValue;
  const triggerTargets = targets
    .filter((target) => (
      (target.targetType || target.type) === 'user'
      || ((target.targetType || target.type) === 'conference' && target.canTalk !== false)
    ))
    .map((target) => ({
      value: `${target.targetType || target.type}:${target.targetId ?? target.id}`,
      label: `${target.name} (${target.targetType || target.type})`,
    }));

  select.innerHTML = '<option value="">Select target</option>';
  for (const target of triggerTargets) {
    const option = document.createElement('option');
    option.value = target.value;
    option.textContent = target.label;
    select.appendChild(option);
  }

  if (includeUnavailable && preferredValue && !triggerTargets.some((target) => target.value === preferredValue)) {
    const option = document.createElement('option');
    option.value = preferredValue;
    option.textContent = `${preferredValue} (saved, unavailable)`;
    select.appendChild(option);
  }
  select.value = [...select.options].some((option) => option.value === preferredValue) ? preferredValue : '';
}

async function loadBridgeTriggerTargets(userId, { includeUnavailable = true } = {}) {
  const payload = await fetchJSON(`/admin/users/${userId}/audio-settings`);
  updateBridgeTriggerTargetOptions(userId, payload.targets || [], { includeUnavailable });
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
    adminState.isGlobalAdmin = false;
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
  if (!res.ok) {
    const error = new Error(`Request failed: ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

function applyAdminState(payload) {
  adminState.isAuthenticated = true;
  adminState.isGlobalAdmin = Boolean(payload?.isGlobalAdmin ?? payload?.isAdmin);
  adminState.isSuperAdmin = Boolean(payload?.isSuperadmin);
  adminState.mustChangePassword = Boolean(payload?.mustChangePassword);
  adminState.userId = payload?.id ?? null;
  adminState.name = payload?.name ?? '';
  if (adminNameLabel) {
    adminNameLabel.textContent = adminState.name || 'Admin';
  }
  adminNavLinks.forEach((link) => {
    link.hidden = !adminState.isGlobalAdmin && link.dataset.adminNav !== 'matrix';
  });
  if (productionCreateForm) productionCreateForm.hidden = !adminState.isGlobalAdmin;
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
  currentAdminImageLightboxState = null;
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

async function downloadAdminImageLightboxImage() {
  const state = currentAdminImageLightboxState;
  if (!state?.dataUrl) return;
  try {
    const blob = await rasterizeQrDataUrlToPngBlob(state.dataUrl);
    triggerDownload(blob, state.filename || 'talktome-login-qr.png');
  } catch (error) {
    console.error('Failed to download QR image:', error);
    showMessage('❌ Failed to download QR image', 'error', state.messageSection || 'user');
  }
}

function openAdminImageLightbox({ dataUrl, title, alt, filename, messageSection } = {}) {
  if (!adminImageLightbox || !dataUrl) return;
  currentAdminImageLightboxState = { dataUrl, filename, messageSection };
  if (adminImageLightboxTitle) {
    adminImageLightboxTitle.textContent = title || 'QR Code';
  }
  if (adminImageLightboxImage) {
    adminImageLightboxImage.src = dataUrl;
    adminImageLightboxImage.alt = alt || title || 'QR Code';
  }
  adminImageLightbox.classList.remove('is-hidden');
  document.body.style.overflow = 'hidden';
}

function openMediaNetworkQrLightbox() {
  if (!currentMediaNetworkQrState?.renderedQrDataUrl) return;
  openAdminImageLightbox({
    dataUrl: currentMediaNetworkQrState.renderedQrDataUrl,
    title: 'Connection QR Code',
    alt: 'Large connection QR code',
    filename: buildMediaNetworkQrFilename('png'),
    messageSection: 'config',
  });
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
  adminState.isGlobalAdmin = false;
  adminState.isSuperAdmin = false;
  adminState.mustChangePassword = false;
  adminState.userId = null;
  adminState.name = '';
  closeAdminImageLightbox();
  showLogin(message || '');
}

async function enforcePasswordChange() {
  if (!adminState.mustChangePassword) return true;

  const newPassword = await adminPrompt(
    'Please set a new admin password.',
    '',
    {
      title: 'Change admin password',
      label: 'New password',
      inputType: 'password',
      confirmLabel: 'Update password',
      minLength: 4,
      validationMessage: 'Password must be at least 4 characters.',
    }
  );
  if (newPassword === null) {
    await logoutAdmin('Password change required before continuing.');
    return false;
  }

  try {
    const res = await authedFetch('/admin/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword.trim() })
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      await adminNotice(payload.error || 'Failed to update password.', { title: 'Password update failed' });
      return enforcePasswordChange();
    }
    adminState.mustChangePassword = false;
    showMessage('✅ Admin password updated', 'success');
    return true;
  } catch (err) {
    await adminNotice('Failed to update password.', { title: 'Password update failed' });
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

const STATUS_TALKING_PULSE_MS = 1350;

function statusIndicatorHtml({ online, talking = false, talkingLabel = 'Talking', warning = false, onlineLabel = 'Online', offlineLabel = 'Offline', warningLabel = 'Warning' }) {
  const label = talking ? talkingLabel : warning ? warningLabel : online ? onlineLabel : offlineLabel;
  const stateClass = talking ? 'is-talking' : warning ? 'is-warning' : online ? 'is-online' : '';
  const animationPhase = talking
    ? ` style="--status-talking-animation-delay: -${Date.now() % STATUS_TALKING_PULSE_MS}ms"`
    : '';
  return `
    <span class="status-indicator">
      <span class="status-indicator__dot ${stateClass}"${animationPhase} aria-hidden="true"></span>
      <span title="${escapeHtml(label)}">${escapeHtml(label)}</span>
    </span>
  `;
}

function formatStatusTalkTargetLabel(user) {
  const targets = Array.isArray(user?.talkTargets) ? user.talkTargets : [];
  const names = targets
    .map((target) => String(target?.name || '').trim())
    .filter(Boolean);
  return `→ ${names.length > 0 ? names.join(', ') : 'Target'}`;
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
  const roundTripMs = networkStats?.roundTripMs;
  return Number.isFinite(roundTripMs) ? `${Math.round(roundTripMs)} ms` : '-';
}

function formatStatusPacketLoss(networkStats) {
  const packetLossPercent = networkStats?.packetLossPercent;
  if (!Number.isFinite(packetLossPercent)) return '-';
  return `${packetLossPercent.toFixed(packetLossPercent >= 10 ? 0 : 1)}%`;
}

function syncStopTransmissionButtons(users = latestAdminStatus?.users || []) {
  const statusByUserId = new Map(
    (Array.isArray(users) ? users : []).map((user) => [Number(user.id), user])
  );

  document.querySelectorAll('[data-stop-transmission-user-id]').forEach((button) => {
    if (button.dataset.requestPending === 'true') return;
    const user = statusByUserId.get(Number(button.dataset.stopTransmissionUserId));
    const canStop = Boolean(user?.online && user?.talking);
    button.disabled = !canStop;
    button.title = canStop
      ? 'Immediately stop this user\'s active transmission'
      : user?.online
        ? 'User is not transmitting'
        : 'User is offline';
  });
}

const statusSortPreferences = new Map();

function statusSortValue(row, key) {
  switch (key) {
    case 'Status': return row.talking ? 2 : row.online ? 1 : 0;
    case 'Name': return row.name || '';
    case 'Production': return row.activeProduction?.name || '';
    case 'Client': return row.client || (row.configuredAsBridge ? 'Bridge configured' : '');
    case 'Address': return row.remoteAddress || '';
    case 'RTT': return Number(row.networkStats?.roundTripMs) || 0;
    case 'Loss': return Number(row.networkStats?.packetLossPercent) || 0;
    case 'Connected since': return Date.parse(row.connectedAt) || 0;
    case 'Last seen': return row.online ? Number.MAX_SAFE_INTEGER : Date.parse(row.lastOnlineAt || row.lastSeenAt) || 0;
    default: return '';
  }
}

function sortStatusRows(rows, body, fallback) {
  const preference = statusSortPreferences.get(body?.id);
  rows.sort(preference ? (a, b) => {
    const av = statusSortValue(a, preference.key);
    const bv = statusSortValue(b, preference.key);
    const result = typeof av === 'number' && typeof bv === 'number'
      ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
    return result * preference.direction || String(a.name || '').localeCompare(String(b.name || ''));
  } : fallback);
  body?.closest('table')?.querySelectorAll('thead th').forEach(header => {
    const key = header.dataset.sortKey || header.textContent.trim();
    header.dataset.sortKey = key;
    header.setAttribute('aria-sort', preference?.key === key
      ? preference.direction === 1 ? 'ascending' : 'descending' : 'none');
    if (header.querySelector('button')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'status-sort-button';
    button.textContent = key;
    button.title = `Sort by ${key}`;
    button.addEventListener('click', () => {
      const previous = statusSortPreferences.get(body.id);
      if (previous?.key === key && previous.direction === -1) {
        statusSortPreferences.delete(body.id);
      } else {
        statusSortPreferences.set(body.id, { key, direction: previous?.key === key ? -1 : 1 });
      }
      renderAdminStatus(latestAdminStatus);
    });
    header.replaceChildren(button);
  });
}

function renderAdminStatus(payload = {}) {
  const canRestartServer = Boolean(adminState.isSuperAdmin && payload.restartSupported);
  const showProductionColumn = payload.multipleProductionsEnabled === true;
  containerRestartPanel?.classList.toggle('is-hidden', !canRestartServer);
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

  sortStatusRows(users, statusUsersBody, sortByOnlineAndName);
  sortStatusRows(feeds, statusFeedsBody, sortByOnlineAndName);
  sortStatusRows(bridges, statusBridgesBody, sortByOnlineAndName);
  sortStatusRows(companions, statusCompanionsBody, sortByOnlineAndName);
  syncStopTransmissionButtons(users);

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

  document.querySelectorAll('#status-section .status-table').forEach((table) => {
    table.classList.toggle('status-table--with-production', showProductionColumn);
    table.querySelectorAll('[data-status-production-column]').forEach((element) => {
      element.hidden = !showProductionColumn;
    });
  });

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
          const productionLabel = user.online
            ? user.activeProduction?.name || (user.connectionType === 'bridge' ? 'Global' : '-')
            : '-';
          return `
            <tr>
              <td><span class="status-with-stop">${statusIndicatorHtml({
                ...user,
                talkingLabel: formatStatusTalkTargetLabel(user),
              })}${user.talkLocked ? '<svg class="status-talk-lock-icon" viewBox="0 0 24 24" role="img" aria-label="Talk locked" title="Talk locked"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="5" y="10" width="14" height="11" rx="2"/></svg>' : ''}${user.online && user.talking && Number.isFinite(userId) ? `<button type="button" class="status-stop-mic" data-stop-transmission-user-id="${userId}" onclick="stopUserTransmission(${userId}, this)" title="Stop transmission" aria-label="Stop transmission for ${escapeHtml(user.name)}"><img src="/images/mute_mic.png" alt="" /></button>` : ''}</span></td>
              <td>${userNameHtml}</td>
              ${showProductionColumn ? `<td title="${escapeHtml(productionLabel)}">${escapeHtml(productionLabel)}</td>` : ''}
              <td>${escapeHtml(clientLabel)}</td>
              <td>${escapeHtml(user.remoteAddress || '-')}</td>
              <td title="${user.connectionType === 'bridge' ? 'Bridge API request round-trip time' : 'WebRTC round-trip time from this browser'}">${formatStatusLatency(user.networkStats)}</td>
              <td title="${user.connectionType === 'bridge' ? 'Input RTP packet loss from Bridge to server' : 'WebRTC audio packet loss reported by this browser'}">${formatStatusPacketLoss(user.networkStats)}</td>
              <td>${user.online ? statusTimeHtml(user.connectedAt, { suffix: false, empty: '-' }) : '-'}</td>
              <td>${user.online ? 'Now' : statusTimeHtml(user.lastOnlineAt)}</td>
            </tr>
          `;
        }).join('')
      : `<tr><td colspan="${showProductionColumn ? 9 : 8}" class="status-empty">No users configured.</td></tr>`;
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
              ${showProductionColumn ? '<td class="status-production-spacer" aria-hidden="true"></td>' : ''}
              <td>${escapeHtml(clientLabel)}</td>
              <td>${escapeHtml(feed.remoteAddress || '-')}</td>
              <td title="${feed.connectionType === 'bridge' ? 'Bridge API request round-trip time' : 'WebRTC round-trip time from this browser'}">${formatStatusLatency(feed.networkStats)}</td>
              <td title="${feed.connectionType === 'bridge' ? 'Input RTP packet loss from Bridge to server' : 'WebRTC audio packet loss reported by this browser'}">${formatStatusPacketLoss(feed.networkStats)}</td>
              <td>${feed.online ? statusTimeHtml(feed.connectedAt, { suffix: false, empty: '-' }) : '-'}</td>
              <td>${feed.online ? 'Now' : statusTimeHtml(feed.lastSeenAt, { empty: 'Never' })}</td>
            </tr>
          `;
        }).join('')
      : `<tr><td colspan="${showProductionColumn ? 9 : 8}" class="status-empty">No feeds configured.</td></tr>`;
  }

  if (statusBridgesBody) {
    statusBridgesBody.innerHTML = bridges.length
      ? bridges.map((bridge) => `
            <tr>
              <td>${statusIndicatorHtml({
                online: bridge.online,
                warning: bridge.online && bridge.deviceMissing,
                onlineLabel: 'Online',
                offlineLabel: 'Offline',
                warningLabel: 'Device missing',
              })}</td>
              <td><span class="status-primary">${escapeHtml(bridge.name)}</span></td>
              ${showProductionColumn ? '<td class="status-production-spacer" aria-hidden="true"></td>' : ''}
              <td>${escapeHtml(bridge.client || 'Bridge')}</td>
              <td>${escapeHtml(bridge.remoteAddress || '-')}</td>
              <td title="Average Bridge API request round-trip time across active ports">${formatStatusLatency(bridge.networkStats)}</td>
              <td title="Input RTP packet loss from Bridge to server across active ports">${formatStatusPacketLoss(bridge.networkStats)}</td>
              <td>${bridge.online ? statusTimeHtml(bridge.connectedAt, { suffix: false, empty: '-' }) : '-'}</td>
              <td>${bridge.online ? 'Now' : statusTimeHtml(bridge.lastSeenAt)}</td>
            </tr>
          `).join('')
      : `<tr><td colspan="${showProductionColumn ? 9 : 8}" class="status-empty">No bridge announced.</td></tr>`;
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
              ${showProductionColumn ? '<td class="status-production-spacer" aria-hidden="true"></td>' : ''}
              <td>${escapeHtml(companion.client || '-')}</td>
              <td>${escapeHtml(companion.remoteAddress || '-')}</td>
              <td>-</td>
              <td>-</td>
              <td>${connectedSince}</td>
              <td>${lastSeen}</td>
            </tr>
          `;
        }).join('')
      : `<tr><td colspan="${showProductionColumn ? 9 : 8}" class="status-empty">No Companion instance connected.</td></tr>`;
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
      const refreshConferences = Boolean(refresh.conferences);
      if (refreshUsers || refreshConferences || refreshFeeds) {
        refreshAdminLists({
          users: refreshUsers,
          conferences: refreshConferences,
          feeds: refreshFeeds,
        }).catch((error) => {
          console.error('Failed to refresh admin data after a server update:', error);
        });
      }
      stopServerHealthProbe();
    } catch (error) {
      console.error('Failed to parse status event:', error);
    }
  });
  const handleExpiredSession = () => {
    adminState.isAuthenticated = false;
    adminState.isGlobalAdmin = false;
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

function normalizeAdminSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase();
}

function getEntityMasterDetailConfig(kind) {
  if (kind === 'users') {
    return {
      picker: userPicker,
      search: userSearch,
      clear: userSearchClear,
      empty: userEmpty,
      detailList: document.getElementById('user-list'),
      itemLabel: 'users',
    };
  }
  if (kind === 'conferences') {
    return {
      picker: conferencePicker,
      search: conferenceSearch,
      clear: conferenceSearchClear,
      empty: conferenceEmpty,
      detailList: document.getElementById('conf-list'),
      itemLabel: 'conferences',
    };
  }
  if (kind === 'feeds') {
    return {
      picker: feedPicker,
      search: feedSearch,
      clear: feedSearchClear,
      empty: feedEmpty,
      detailList: document.getElementById('feed-list'),
      itemLabel: 'feeds',
    };
  }
  return null;
}

function getEntityMasterDetailItems(kind) {
  const items = Array.isArray(currentAdminCatalog[kind]) ? currentAdminCatalog[kind] : [];
  if (kind === 'users' && !guestLoginEnabled) {
    return items.filter((item) => !item.is_guest_profile);
  }
  return items;
}

function renderEntityPickerBadges(kind, item) {
  if (kind !== 'users') return '';
  const badges = [];
  if (item.is_superadmin) {
    badges.push('<span class="badge superadmin">Superadmin</span>');
  } else if (item.is_admin) {
    badges.push('<span class="badge admin">Admin</span>');
  }
  if (item.bridge_enabled) {
    badges.push('<span class="badge bridge">Bridge</span>');
  }
  if (item.is_guest_profile) {
    badges.push('<span class="badge guest-profile">Guest</span>');
  }
  return badges.length ? `<span class="entity-picker-badges">${badges.join('')}</span>` : '';
}

function renderEntityMasterDetailPicker(kind, items = getEntityMasterDetailItems(kind)) {
  const config = getEntityMasterDetailConfig(kind);
  const state = entityMasterDetailState[kind];
  if (!config?.picker || !state) return;

  const query = normalizeAdminSearch(state.query);
  const matches = items.filter((item) => normalizeAdminSearch(item.name).includes(query));
  if (!matches.length) {
    config.picker.innerHTML = `<li class="entity-picker-empty">${items.length ? `No matching ${config.itemLabel}.` : `No ${config.itemLabel} configured.`}</li>`;
    return;
  }

  config.picker.innerHTML = matches.map((item) => `
    <li>
      <button type="button" data-entity-kind="${kind}" data-entity-select="${item.id}"
        aria-current="${Number(item.id) === Number(state.selectedId)}">
        <span class="entity-picker-name">${escapeHtml(item.name)}</span>
        ${renderEntityPickerBadges(kind, item)}
      </button>
    </li>
  `).join('');
}

async function syncEntityMasterDetail(kind, items = getEntityMasterDetailItems(kind), preferredId = null) {
  const config = getEntityMasterDetailConfig(kind);
  const state = entityMasterDetailState[kind];
  if (!config || !state) return;

  const requestedId = preferredId == null ? state.selectedId : preferredId;
  const selected = items.find((item) => Number(item.id) === Number(requestedId)) || items[0] || null;
  state.selectedId = selected?.id ?? null;
  renderEntityMasterDetailPicker(kind, items);

  config.empty?.classList.toggle('is-hidden', Boolean(selected));
  config.detailList?.querySelectorAll('[data-entity-id]').forEach((item) => {
    const isSelected = Number(item.dataset.entityId) === Number(state.selectedId);
    item.hidden = !isSelected;
    item.querySelector('.nested')?.classList.toggle('is-open', isSelected);
  });

  if (!selected) return;
  try {
    if (kind === 'users') {
      await renderUserConferenceList(selected.id);
    } else if (kind === 'conferences') {
      await renderConferenceParticipantList(selected.id);
    }
  } catch (error) {
    console.error(`Failed to load ${kind} detail`, error);
    showMessage(`Failed to load ${kind} detail`, 'error', kind === 'conferences' ? 'conf' : kind);
  }
}

async function selectAdminEntity(kind, entityId) {
  const state = entityMasterDetailState[kind];
  if (!state) return;
  state.selectedId = Number(entityId);
  await syncEntityMasterDetail(kind);
}

function bindEntitySearch(input, clearButton, onChange) {
  if (!input) return;
  const update = () => {
    if (clearButton) clearButton.hidden = !input.value;
    onChange(input.value);
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !input.value) return;
    input.value = '';
    update();
  });
  clearButton?.addEventListener('click', () => {
    input.value = '';
    update();
    input.focus();
  });
  update();
}

function clearEntitySearch(input) {
  if (!input || !input.value) return;
  input.value = '';
  input.dispatchEvent(new Event('input'));
}

for (const kind of ['users', 'conferences', 'feeds']) {
  const config = getEntityMasterDetailConfig(kind);
  config?.picker?.addEventListener('click', (event) => {
    const button = event.target.closest(`[data-entity-kind="${kind}"][data-entity-select]`);
    if (button) selectAdminEntity(kind, button.dataset.entitySelect);
  });
  bindEntitySearch(config?.search, config?.clear, (query) => {
    entityMasterDetailState[kind].query = query;
    renderEntityMasterDetailPicker(kind);
  });
}

async function productionRequest(url, options = undefined) {
  const response = await authedFetch(url, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || `Request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response;
}

function renderProductionSummaries() {
  if (!productionList) return;
  const query = normalizeAdminSearch(productionSearchQuery);
  const availableLayouts = productionSummaries;
  const matches = availableLayouts.filter((production) => normalizeAdminSearch(production.name).includes(query));
  if (!matches.length) {
    productionList.innerHTML = '<li class="entity-picker-empty">No matching matrix layouts.</li>';
    return;
  }
  productionList.innerHTML = matches.map((production) => `
    <li>
      <button type="button" data-production-select="${production.id}" aria-current="${String(production.id) === String(selectedProductionId)}">
        ${escapeHtml(production.name)}
      </button>
    </li>
  `).join('');
}

bindEntitySearch(productionSearch, productionSearchClear, (query) => {
  productionSearchQuery = query;
  renderProductionSummaries();
});

function setProductionDetailVisible(view = 'empty') {
  const showDefault = view === 'default';
  const showProduction = view === 'production';
  productionDefaultDetail?.classList.toggle('is-hidden', !showDefault);
  productionDetail?.classList.toggle('is-hidden', !showProduction);
  productionEmpty?.classList.toggle('is-hidden', showDefault || showProduction);
}

function productionTargetKey(targetType, targetId) {
  return `${targetType}:${targetId}`;
}

function getProductionTargetState(targetType, target = null) {
  if (!target) return 'off';
  if (targetType === 'conference' && target.canTalk === false) return 'listen-only';
  return 'talk';
}

function setProductionTargetToggleState(toggle, state) {
  const normalizedState = ['talk', 'listen-only'].includes(state) ? state : 'off';
  toggle.dataset.state = normalizedState;
  toggle.setAttribute('aria-pressed', normalizedState === 'talk' ? 'true' : normalizedState === 'listen-only' ? 'mixed' : 'false');
  if (toggle.dataset.targetType === 'conference' && toggle.dataset.label) {
    const mode = normalizedState === 'talk'
      ? 'talk and listen'
      : normalizedState === 'listen-only'
        ? 'listen only'
        : 'not a member';
    const description = `${toggle.dataset.label} (${mode})`;
    toggle.setAttribute('aria-label', description);
    toggle.title = description;
  }
}

function renderProductionMembers(payload) {
  if (!productionMembersList) return;
  const memberMap = new Map(payload.members.map((member) => [String(member.id), member]));
  const renderRows = (type, label, catalog, activeItems) => {
    const activeIds = new Set(activeItems.map((item) => String(item.id)));
    const rows = catalog.map((item) => {
      const isMember = type === 'user' ? memberMap.has(String(item.id)) : activeIds.has(String(item.id));
      const member = type === 'user' ? memberMap.get(String(item.id)) : null;
      const adminControl = type === 'user' && member && payload.permissions.globalAdmin
        ? item.is_guest_profile
          ? '<button type="button" class="small production-admin-role-toggle" disabled title="Guest profile cannot be made production admin">Make admin</button>'
          : `<button type="button" class="small production-admin-role-toggle ${member.isProductionAdmin ? 'warning' : ''}"
              data-production-admin="${item.id}" data-should-make-admin="${member.isProductionAdmin ? 'false' : 'true'}">
              ${member.isProductionAdmin ? 'Remove admin' : 'Make admin'}
            </button>`
        : member?.isProductionAdmin
          ? '<span class="badge admin">Production admin</span>'
          : '';
      return `
        <li class="production-check-row${isMember ? '' : ' is-inactive'}"
          data-production-entity-row="${type}:${item.id}" tabindex="0">
          <button type="button" class="production-member-toggle${isMember ? ' is-member' : ''}"
            data-production-entity-type="${type}" data-production-entity-id="${item.id}"
            data-is-member="${isMember ? 'true' : 'false'}"
            aria-label="${isMember ? 'Remove' : 'Add'} ${escapeHtml(item.name)} ${isMember ? 'from' : 'to'} this production"
            title="${isMember ? 'Remove from production' : 'Add to production'}">${isMember ? '−' : '+'}</button>
          <span>${escapeHtml(item.name)}${item.is_guest_profile ? ' <span class="badge guest-profile">Guest</span>' : ''}</span>
          ${adminControl}
        </li>
      `;
    }).join('') || '<li class="section-note">None available.</li>';
    return `<li class="production-entity-heading">${escapeHtml(label)}</li>${rows}`;
  };

  productionMembersList.innerHTML = [
    renderRows('user', 'Users', payload.catalog.users, payload.members),
    renderRows('conference', 'Conferences', payload.catalog.conferences, payload.conferences),
    renderRows('feed', 'Feeds', payload.catalog.feeds, payload.feeds),
  ].join('');
}

function renderProductionTargetMatrix(payload) {
  if (!productionTargetMatrixContainer) return;
  const rowUsers = payload.members;
  const targetUsers = payload.members.filter((user) => !user.is_guest_profile);
  const groups = [
    { type: 'user', label: 'Users', className: 'users', items: targetUsers },
    { type: 'conference', label: 'Conferences', className: 'conferences', items: payload.conferences },
    { type: 'feed', label: 'Feeds', className: 'feeds', items: payload.feeds },
  ].filter((group) => group.items.length > 0);
  const columns = groups.flatMap((group) => group.items.map((item) => ({ ...item, targetType: group.type })));

  if (!rowUsers.length || !columns.length) {
    productionTargetMatrixContainer.innerHTML = '<p class="target-matrix-empty">Add members and targets to configure this layout.</p>';
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
    const assignments = new Map((payload.targets[String(user.id)] || []).map((target) => (
      [productionTargetKey(target.targetType, target.targetId), target]
    )));
    const cells = columns.map((column, columnIndex) => {
      const self = column.targetType === 'user' && Number(column.id) === Number(user.id);
      if (self) {
        return `<td class="target-matrix__unavailable target-matrix__target-column target-matrix__column--user" data-matrix-column="${columnIndex}">&mdash;</td>`;
      }
      const label = `${column.name} as target for ${user.name}`;
      const assignment = assignments.get(productionTargetKey(column.targetType, column.id));
      const state = getProductionTargetState(column.targetType, assignment);
      const conferenceTitle = state === 'talk'
        ? `${label} (talk and listen)`
        : state === 'listen-only'
          ? `${label} (listen only)`
          : `${label} (not a member)`;
      return `
        <td class="target-matrix__coupling target-matrix__target-column target-matrix__column--${escapeHtml(column.targetType)}" data-matrix-column="${columnIndex}">
          <button type="button" class="target-matrix-toggle production-target-toggle"
            data-user-id="${user.id}" data-target-type="${escapeHtml(column.targetType)}" data-target-id="${column.id}"
            data-label="${escapeHtml(label)}"
            data-state="${state}" ${column.targetType === 'conference' ? 'data-matrix-multistate="true"' : ''}
            aria-label="${escapeHtml(column.targetType === 'conference' ? conferenceTitle : label)}"
            title="${escapeHtml(column.targetType === 'conference' ? conferenceTitle : label)}"
            aria-pressed="${state === 'talk' ? 'true' : state === 'listen-only' ? 'mixed' : 'false'}"></button>
        </td>
      `;
    }).join('');
    return `<tr><th class="target-matrix__user-name" scope="row">${escapeHtml(user.name)}</th>${cells}</tr>`;
  }).join('');
  const matrixTableWidth = 7.5 + (columns.length * 1.9);
  productionTargetMatrixContainer.innerHTML = `
    <table class="target-matrix" style="--matrix-table-width: ${matrixTableWidth}rem">
      <colgroup><col class="target-matrix__profile-column" />${columns.map(() => '<col class="target-matrix__target-col" />').join('')}</colgroup>
      <thead><tr><th class="target-matrix__corner" rowspan="2" scope="col"><span class="target-matrix__corner-label target-matrix__corner-label--users">Users</span><span class="target-matrix__corner-label target-matrix__corner-label--targets">Targets</span></th>${groupHeaders}</tr><tr>${columnHeaders}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

function renderProductionOrder(payload, preferredUserId = null) {
  if (!productionOrderUser || !productionOrderList) return;
  const current = String(preferredUserId || productionOrderUser.value || payload.members[0]?.id || '');
  productionOrderUser.innerHTML = payload.members.map((member) => (
    `<option value="${member.id}" ${String(member.id) === current ? 'selected' : ''}>${escapeHtml(member.name)}</option>`
  )).join('');
  const userId = productionOrderUser.value;
  const targets = payload.targets[String(userId)] || [];
  productionOrderList.innerHTML = targets.map((target) => `
    <li class="list-chip draggable-target" draggable="true"
        data-type="${escapeHtml(target.targetType)}" data-id="${escapeHtml(target.targetId)}">
      <span class="drag-handle" title="Drag to reorder">☰</span>
      <span class="chip-label">${escapeHtml(target.name)}</span>
      <span class="badge">${escapeHtml(target.targetType)}</span>
    </li>
  `).join('') || '<li class="section-note">No target buttons assigned to this member.</li>';
  initProductionTargetOrdering(Number(userId), productionOrderList);
}

function initProductionTargetOrdering(userId, list) {
  const items = [...list.querySelectorAll('.draggable-target')];
  items.forEach((item) => {
    item.addEventListener('dragstart', () => item.classList.add('dragging'));
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      saveProductionTargetOrder(userId, list);
    });
  });

  const onDragOver = (event) => {
    event.preventDefault();
    const dragging = list.querySelector('.dragging');
    if (!dragging) return;
    const afterElement = getDragAfterElement(list, event.clientY);
    if (!afterElement) list.appendChild(dragging);
    else if (afterElement !== dragging) list.insertBefore(dragging, afterElement);
  };
  if (list._productionDragOverHandler) {
    list.removeEventListener('dragover', list._productionDragOverHandler);
  }
  list._productionDragOverHandler = onDragOver;
  list.addEventListener('dragover', onDragOver);
  if (!list._productionDropReady) {
    list.addEventListener('drop', (event) => event.preventDefault());
    list._productionDropReady = true;
  }
  initTouchTargetOrdering(list, () => saveProductionTargetOrder(userId, list));
}

async function saveProductionTargetOrder(userId, list) {
  if (!selectedProductionPayload || !selectedProductionId) return;
  const items = [...list.querySelectorAll('.draggable-target')].map((item) => ({
    targetType: item.dataset.type,
    targetId: Number(item.dataset.id),
  }));
  try {
    await productionRequest(`/admin/productions/${selectedProductionId}/users/${userId}/targets/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const targetsByKey = new Map(
      (selectedProductionPayload.targets[String(userId)] || []).map((target) => (
        [productionTargetKey(target.targetType, target.targetId), target]
      ))
    );
    selectedProductionPayload.targets[String(userId)] = items
      .map((item) => targetsByKey.get(productionTargetKey(item.targetType, item.targetId)))
      .filter(Boolean);
  } catch (error) {
    showMessage(error.message || 'Failed to reorder targets', 'error', 'productions');
    await loadProductionDetail(selectedProductionId);
  }
}

function renderProductionDetail(payload, preferredOrderUserId = null) {
  selectedProductionPayload = payload;
  setProductionDetailVisible('production');
  if (productionDetailName) productionDetailName.textContent = payload.production.name;
  if (productionGlobalActions) productionGlobalActions.hidden = !payload.permissions.globalAdmin;
  renderProductionMembers(payload);
  renderProductionTargetMatrix(payload);
  renderProductionOrder(payload, preferredOrderUserId);
}

async function loadProductionDetail(productionId, { preferredOrderUserId = null } = {}) {
  selectedProductionId = Number(productionId);
  renderProductionSummaries();
  try {
    const payload = await fetchJSON(`/admin/productions/${selectedProductionId}`);
    renderProductionDetail(payload, preferredOrderUserId);
  } catch (error) {
    selectedProductionPayload = null;
    setProductionDetailVisible('empty');
    showMessage(error.message || 'Failed to load production', 'error', 'productions');
  }
}

async function loadProductions({ selectId = selectedProductionId } = {}) {
  let mode;
  try {
    mode = await fetchJSON('/admin/settings/multiple-productions');
    multipleProductionsSupported = true;
  } catch (error) {
    if (error?.status !== 404) throw error;
    multipleProductionsSupported = false;
    mode = { enabled: false, configurable: false };
    console.warn('Multiple Productions requires a server restart to load the matching backend.');
  }
  multipleProductionsEnabled = mode?.enabled === true;
  if (multipleProductionsInput) {
    multipleProductionsInput.checked = multipleProductionsEnabled;
    multipleProductionsInput.disabled = !multipleProductionsSupported || mode?.configurable !== true;
    const switchLabel = multipleProductionsInput.closest('label');
    if (switchLabel) {
      switchLabel.title = multipleProductionsSupported
        ? 'Enable separate matrices for multiple productions. Layouts and memberships stay independent; conferences with the same name remain one global audio channel.'
        : 'Restart the Talktome server to enable Multiple Productions.';
    }
  }
  if (productionSidebar) productionSidebar.hidden = !multipleProductionsEnabled;
  productionLayout?.classList.toggle('production-layout--single', !multipleProductionsEnabled);
  productionSummaries = await fetchJSON('/admin/productions');
  if (productionEmpty) productionEmpty.textContent = 'Select a matrix layout to configure it.';
  if (!multipleProductionsEnabled) selectId = mode?.primaryProductionId ?? productionSummaries[0]?.id ?? null;
  const validSelection = productionSummaries.some((item) => Number(item.id) === Number(selectId));
  if (!validSelection) {
    selectId = productionSummaries[0]?.id || null;
  }
  selectedProductionId = selectId ? Number(selectId) : null;
  renderProductionSummaries();
  if (selectedProductionId) {
    await loadProductionDetail(selectedProductionId);
  } else {
    selectedProductionPayload = null;
    setProductionDetailVisible('empty');
  }
}

async function loadData() {
  if (!adminState.isGlobalAdmin) {
    await loadProductions();
    stopStatusStream();
    activateAdminView('matrix', { updateHash: true, replaceHash: true });
    return;
  }

  const productionLoad = loadProductions().catch((error) => {
    console.error('Failed to load matrix layouts:', error);
    showMessage('Failed to load Production layouts. Default data is still available.', 'warning', 'matrix');
  });
  const guestSettingsLoad = loadGuestLoginSettings().catch((error) => {
    console.error('Failed to load Guest login settings:', error);
  });
  const { users, conferences, feeds, bridges } = await fetchAdminCollections();
  await Promise.all([productionLoad, guestSettingsLoad]);

  // Render the matrix immediately. Per-user requests update its switches as
  // they arrive, including conference memberships.
  renderTargetMatrix(users, conferences, feeds);
  await Promise.all([
    renderUserList(users, conferences, feeds, bridges),
    renderFeedList(feeds),
    renderConferenceList(conferences, users),
  ]);

  await Promise.allSettled([
    loadDefaultClientSettings(),
    loadAutomaticBackupSettings(),
    loadMdnsSettings(),
    loadMediaNetworkSettings(),
    loadRtcPortSettings(),
    loadApiKeyField(),
  ]);
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
  currentAdminCatalog = {
    users: Array.isArray(users) ? users : [],
    conferences: Array.isArray(conferences) ? conferences : [],
    feeds: Array.isArray(feeds) ? feeds : [],
  };

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
  const conferenceKey = String(conferenceId);
  const memberships = new Set(
    (Array.isArray(users) ? users : []).map((user) => String(user.id))
  );
  currentAdminCatalog.users.forEach((user) => {
    if (user.is_superadmin) return;
    const userKey = String(user.id);
    const enabled = memberships.has(userKey);
    setCachedTargetAssignment(user.id, 'conference', conferenceId, enabled);
    targetMatrixContainer
      ?.querySelector(`.target-matrix-toggle[data-user-id="${userKey}"][data-target-type="conference"][data-target-id="${conferenceKey}"]`)
      ?.setAttribute('aria-pressed', String(enabled));
  });
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
            title="${escapeHtml(column.targetType === 'conference' ? `${label} (also controls conference membership)` : label)}"
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
    if (targetType === 'conference') {
      scheduleConferenceMembershipEditorRefresh(targetId, userId);
    }
  } catch (error) {
    toggle.setAttribute('aria-pressed', String(wasEnabled));
    showMessage(error.message || 'Target update failed', 'error', 'matrix');
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
  const { users, conferences, feeds, bridges } = await fetchAdminCollections();

  if (refreshUsers) {
    await renderUserList(users, conferences, feeds, bridges);
  }
  if (refreshFeeds) {
    await renderFeedList(feeds);
  }
  if (refreshConferences) {
    await renderConferenceList(conferences, users);
  }

  if (refreshUsers || refreshConferences || refreshFeeds) {
    renderTargetMatrix(users, conferences, feeds);
    await loadProductions({ selectId: selectedProductionId });
  }
}

async function renderUserList(users, conferences, feeds, bridges = currentBridgeRegistry) {
  currentBridgeRegistry = Array.isArray(bridges) ? bridges : [];
  targetAssignmentsByUser.clear();
  const userList = document.getElementById('user-list');
  userList.innerHTML = '';
  const visibleUsers = guestLoginEnabled
    ? users
    : users.filter((user) => !user.is_guest_profile);

  for (const user of visibleUsers) {
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
      ? isSuperadmin
        ? ''
        : isGuestProfile
          ? '<button type="button" class="small admin-role-toggle" disabled title="Guest profile cannot be made admin">Make admin</button>'
        : `<button type="button" class="small admin-role-toggle ${isAdmin ? 'warning' : ''}" onclick="toggleAdminRole(${user.id}, ${isAdmin ? 'false' : 'true'})">${isAdmin ? 'Remove admin' : 'Make admin'}</button>`
      : '';
    const passwordAttrs = isGuestProfile ? 'disabled title="Guest profile does not use a password"' : '';
    const copyLoginButton = isSuperadmin
      ? ''
      : `<button type="button" class="small copy-login-url-button" onclick='copyEntityLoginUrl("${isGuestProfile ? 'guest' : 'user'}", ${user.id}, ${JSON.stringify(user.name)}, this)'>Copy Login URL</button>`;
    const loginQrButton = isSuperadmin
      ? ''
      : `<button type="button" class="small" onclick='openEntityLoginQr("${isGuestProfile ? 'guest' : 'user'}", ${user.id}, ${JSON.stringify(user.name)}, this)'>QR Code</button>`;
    const deleteAttrs = isGuestProfile
      ? 'disabled title="Guest profile cannot be deleted"'
      : isAdmin ? 'disabled title="Admin accounts cannot be deleted"' : '';
    const deleteButton = isSuperadmin
      ? ''
      : `<button type="button" class="small danger" onclick="deleteUser(${user.id})" ${deleteAttrs}>Delete</button>`;
    const audioSettingsButton = !isSuperadmin && !isGuestProfile
      ? `<button type="button" class="small user-settings-button" onclick='openUserAudioSettings(${user.id}, ${JSON.stringify(user.name)})' aria-label="Audio settings for ${safeName}" title="Audio settings">
          <span>Audio</span>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><path d="M12 15.25A3.25 3.25 0 1 0 12 8.75a3.25 3.25 0 0 0 0 6.5Z" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 13.5a7.8 7.8 0 0 0 .05-3l2-1.55-2-3.45-2.48 1a8.2 8.2 0 0 0-2.57-1.49L14 2.4h-4l-.4 2.61A8.2 8.2 0 0 0 7.03 6.5l-2.48-1-2 3.45 2 1.55a7.8 7.8 0 0 0 .05 3l-2.05 1.55 2 3.45 2.5-1a8.2 8.2 0 0 0 2.55 1.48L10 21.6h4l.4-2.62a8.2 8.2 0 0 0 2.55-1.48l2.5 1 2-3.45-2.05-1.55Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>`
      : '';
    const li = document.createElement('li');
    li.className = 'list-item entity-detail-item';
    li.dataset.entityId = String(user.id);
    li.hidden = true;

    const bridgeControls = !isSuperadmin && !isGuestProfile
      ? `
        <div class="nested-block">
          <form class="bridge-config-form" id="bridge-config-${user.id}" data-bridge-config-user-id="${user.id}" onsubmit="saveBridgeEndpoint(event, ${user.id})">
            <label class="admin-switch bridge-input-switch" for="bridge-enabled-${user.id}">
              <input type="checkbox" id="bridge-enabled-${user.id}" role="switch" ${isBridgeEndpoint ? 'checked' : ''}>
              <span class="admin-switch__track" aria-hidden="true"></span>
              <span>Use this user as bridge endpoint</span>
            </label>
            <div class="bridge-config-options" id="bridge-options-${user.id}" ${isBridgeEndpoint ? '' : 'hidden'}>
              <div class="bridge-scope-row">
                <div class="field-group bridge-instance-field">
                  <label for="bridge-device-${user.id}">Bridge device</label>
                  <select id="bridge-device-${user.id}">
                    ${renderBridgeInstanceOptions(user.bridge_device || '')}
                  </select>
                </div>
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
            <button type="submit" class="small">Save</button>
          </form>
        </div>
      `
      : '';
    const targetControls = isSuperadmin || multipleProductionsEnabled
      ? ''
      : `
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
      `;
    const detailControls = targetControls || bridgeControls
      ? `
        <div class="nested" id="user-nested-${user.id}" onclick="event.stopPropagation()">
          ${targetControls}
          ${bridgeControls}
        </div>
      `
      : '';

    li.innerHTML = `
      <div class="list-item-header">
        <div class="list-item-title">
          <span>${safeName}</span>
          ${adminBadge}
          ${guestBadge}
          ${bridgeBadge}
        </div>
        <div class="inline-controls" onclick="event.stopPropagation()">
          ${copyLoginButton}
          ${loginQrButton}
          <button type="button" class="small warning" onclick='editUser(${user.id}, ${JSON.stringify(user.name)})'>Rename</button>
          <button type="button" class="small warning" onclick='resetPassword(${user.id}, ${JSON.stringify(user.name)})' ${passwordAttrs}>Reset Password</button>
          ${audioSettingsButton}
          ${adminToggle}
          ${deleteButton}
        </div>
      </div>
      ${detailControls}
    `;

    userList.appendChild(li);
  }

  const targetLoads = await Promise.allSettled(visibleUsers.map(async (user) => {
    if (user.is_superadmin || multipleProductionsEnabled) {
      cacheUserTargetAssignments(user.id, []);
      await loadBridgeTriggerTargets(user.id);
      return;
    }
    await loadUserTargets(user.id, users, conferences, feeds);
  }));
  targetLoads.forEach((result, index) => {
    if (result.status !== 'rejected') return;
    const user = visibleUsers[index];
    cacheUserTargetAssignments(user.id, []);
    console.warn(`Failed to load targets for ${user.name}:`, result.reason);
  });
  initializeBridgeEndpointForms();
  await syncEntityMasterDetail('users', visibleUsers);
  syncStopTransmissionButtons();
}

async function renderFeedList(feeds) {
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
    li.className = 'list-item entity-detail-item';
    li.dataset.entityId = String(feed.id);
    li.hidden = true;
    li.innerHTML = `
      <div class="list-item-header">
        <div class="list-item-title">
          <span>${safeName}</span>
          ${bridgeBadge}
        </div>
        <div class="inline-controls" onclick="event.stopPropagation()">
          <button type="button" class="small" onclick='openEntityLoginQr("feed", ${feed.id}, ${JSON.stringify(feed.name)}, this)'>QR Code</button>
          <button type="button" class="small warning" onclick='editFeed(${feed.id}, ${JSON.stringify(feed.name)})'>Rename</button>
          <button type="button" class="small warning" onclick='resetFeedPassword(${feed.id}, ${JSON.stringify(feed.name)})'>Reset Password</button>
          <button type="button" class="small danger" onclick="deleteFeed(${feed.id})">Delete</button>
        </div>
      </div>
      <div class="nested" id="feed-nested-${feed.id}" onclick="event.stopPropagation()">
        <div class="nested-block">
          <form class="bridge-config-form" id="bridge-config-${formKey}" data-bridge-config-key="${formKey}" onsubmit="saveFeedBridgeEndpoint(event, ${feed.id})">
            <label class="admin-switch bridge-input-switch" for="bridge-enabled-${formKey}">
              <input type="checkbox" id="bridge-enabled-${formKey}" role="switch" ${isBridgeEndpoint ? 'checked' : ''}>
              <span class="admin-switch__track" aria-hidden="true"></span>
              <span>Use this feed as bridge input</span>
            </label>
            <div class="bridge-config-options" id="bridge-options-${formKey}" ${isBridgeEndpoint ? '' : 'hidden'}>
              <div class="bridge-scope-row">
                <div class="field-group bridge-instance-field">
                  <label for="bridge-device-${formKey}">Bridge device</label>
                  <select id="bridge-device-${formKey}">
                    ${renderBridgeInstanceOptions(feed.bridge_device || '')}
                  </select>
                </div>
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
            <button type="submit" class="small">Save</button>
          </form>
        </div>
      </div>
    `;
    feedList.appendChild(li);
  }
  initializeBridgeEndpointForms();
  await syncEntityMasterDetail('feeds', feeds);
}

async function renderConferenceList(conferences, users) {
  const confList = document.getElementById('conf-list');
  confList.innerHTML = '';

  for (const conf of conferences) {
    const safeName = escapeHtml(conf.name);
    const participantControls = multipleProductionsEnabled
      ? ''
      : `
        <div class="nested" id="conf-controls-${conf.id}" onclick="event.stopPropagation()">
          <strong>Participants</strong>
          <div class="inline-controls">
            <select id="add-conf-user-${conf.id}"></select>
            <button type="button" class="small" id="add-conf-user-btn-${conf.id}" onclick="assignConferenceParticipant(${conf.id})">Add participant</button>
          </div>
          <ul id="conf-users-${conf.id}"></ul>
        </div>
      `;
    const li = document.createElement('li');
    li.className = 'list-item entity-detail-item';
    li.dataset.entityId = String(conf.id);
    li.hidden = true;
    li.innerHTML = `
      <div class="list-item-header">
        <div class="list-item-title">
          <span>${safeName}</span>
        </div>
        <div class="inline-controls" onclick="event.stopPropagation()">
          <button type="button" class="small warning" onclick='editConference(${conf.id}, ${JSON.stringify(conf.name)})'>Rename</button>
          <button type="button" class="small danger" onclick="deleteConference(${conf.id})">Delete</button>
        </div>
      </div>
      ${participantControls}
    `;
    confList.appendChild(li);
  }

  if (!multipleProductionsEnabled) {
    await Promise.all(conferences.map(conf => updateConferenceParticipantOptions(conf.id, users)));
  }
  await syncEntityMasterDetail('conferences', conferences);
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
  return detail ? `Automatic (${detail})` : 'Automatic (all adapters)';
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
  const warningEl = document.getElementById('media-network-warning');

  const activeMode = payload?.activeMediaNetworkMode || 'auto';
  const activeInterfaceName = payload?.activeMediaInterfaceName || '';
  const activeAddress = payload?.activeAnnouncedAddress || 'Unavailable';
  const activeRtcAddresses = Array.isArray(payload?.activeRtcAddresses)
    ? payload.activeRtcAddresses.filter(Boolean)
    : [activeAddress].filter(Boolean);
  const savedMode = payload?.mediaNetworkMode || 'auto';
  const savedInterfaceName = payload?.mediaInterfaceName || '';
  const savedAddress = payload?.mediaAnnouncedAddress || '';
  const availableInterfaces = Array.isArray(payload?.availableInterfaces) ? payload.availableInterfaces : [];
  const activeDetail = activeMode === 'auto'
    ? `${activeRtcAddresses.length} RTC address${activeRtcAddresses.length === 1 ? '' : 'es'}`
    : activeMode === 'interface'
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
  if (activeAddressEl) {
    activeAddressEl.textContent = payload?.activeResolutionError || activeRtcAddresses.join(', ') || activeAddress;
  }
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
  if (warningEl) {
    warningEl.textContent = payload?.mediaNetworkWarning || '';
    warningEl.classList.toggle('is-hidden', !payload?.mediaNetworkWarning);
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
  guestLoginEnabled = enabled;
  if (guestLoginEnabledInput) {
    guestLoginEnabledInput.checked = enabled;
  }
  if (guestLoginStatus) {
    guestLoginStatus.textContent = enabled ? 'Enabled' : 'Disabled';
  }
  if (guestLoginProfile) {
    const profileName = payload?.profileName || 'Guest';
    guestLoginProfile.textContent = profileName;
  }
  return payload;
}

async function loadDefaultClientSettings() {
  const payload = await fetchJSON('/admin/settings/default-client');
  const settings = payload?.settings || {};
  if (defaultClientAudioProfile) defaultClientAudioProfile.value = settings.audioProfile || 'ultra-low';
  if (defaultClientDimAmount) defaultClientDimAmount.value = String(settings.dimAmountDb ?? -15);
  if (defaultClientDimSelf) defaultClientDimSelf.checked = settings.dimFeedsWhileSpeaking === true;
  if (defaultClientDimIncoming) defaultClientDimIncoming.checked = settings.dimWhenAddressed === true;
  if (defaultClientAudioProcessing) defaultClientAudioProcessing.checked = settings.audioAutoProcessing === true;
  if (defaultClientConnectionSounds) defaultClientConnectionSounds.checked = settings.playConnectionSounds !== false;
  if (defaultClientLeftHand) defaultClientLeftHand.checked = settings.leftHandMode === true;
  if (defaultClientLockMultiple) defaultClientLockMultiple.checked = settings.lockMultipleTargets === true;
  return payload;
}

function renderAutomaticBackupSettings(settings = {}) {
  if (automaticBackupEnabled) automaticBackupEnabled.checked = settings.enabled === true;
  if (automaticBackupInterval) automaticBackupInterval.value = String(settings.intervalDays ?? 7);
  const directory = document.getElementById('config-auto-backup-directory');
  const last = document.getElementById('config-auto-backup-last');
  const next = document.getElementById('config-auto-backup-next');
  const error = document.getElementById('config-auto-backup-error');
  const formatTime = (value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unavailable';
  };
  if (directory) directory.textContent = settings.directory || 'Unavailable';
  if (last) last.textContent = settings.lastBackupAt ? formatTime(settings.lastBackupAt) : 'Never';
  if (next) {
    next.textContent = !settings.enabled
      ? 'Disabled'
      : settings.nextBackupAt ? formatTime(settings.nextBackupAt) : 'Pending';
  }
  if (error) {
    error.textContent = settings.lastError ? `Last error: ${settings.lastError}` : '';
    error.classList.toggle('is-hidden', !settings.lastError);
  }
  syncAutomaticBackupVisibility();
}

function syncAutomaticBackupVisibility() {
  if (!automaticBackupForm) return;
  const enabled = automaticBackupEnabled?.checked === true;
  automaticBackupForm.classList.toggle('is-collapsed', !enabled);
  const intervalField = document.getElementById('config-auto-backup-interval-field');
  const status = document.getElementById('config-auto-backup-status');
  const error = document.getElementById('config-auto-backup-error');
  if (intervalField) intervalField.hidden = !enabled;
  if (status) status.hidden = !enabled;
  if (error) error.hidden = !enabled;
  automaticBackupForm.querySelectorAll('.config-auto-backup-time').forEach((item) => {
    item.hidden = !enabled;
  });
}

async function loadAutomaticBackupSettings() {
  const settings = await fetchJSON('/admin/settings/automatic-backup');
  renderAutomaticBackupSettings(settings);
  return settings;
}

function clearApiKeyField() {
  currentApiKey = '';
  if (!apiKeyValueInput) return;
  apiKeyValueInput.value = '';
  apiKeyValueInput.type = 'password';
  apiKeyValueInput.placeholder = 'Loading…';
  const toggle = document.querySelector('[data-password-toggle="api-key-value"]');
  if (toggle) {
    toggle.setAttribute('aria-label', 'Show API key');
    toggle.setAttribute('aria-pressed', 'false');
    toggle.title = 'Show API key';
  }
}

async function loadApiKeyField() {
  if (!apiKeyValueInput) return '';
  try {
    const res = await authedFetch('/admin/api-key');
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload.apiKey) {
      throw new Error(payload.error || 'Failed to load API key');
    }
    currentApiKey = payload.apiKey;
    apiKeyValueInput.value = currentApiKey;
    apiKeyValueInput.placeholder = '';
    return currentApiKey;
  } catch (err) {
    currentApiKey = '';
    apiKeyValueInput.value = '';
    apiKeyValueInput.placeholder = 'API key unavailable';
    console.error('Failed to load API key:', err);
    return '';
  }
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
    : '';
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
    : '';
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
  updateBridgeTriggerTargetOptions(userId, targets);
  if (!ul) return;
  ul.innerHTML = targets.map(t => {
    const isConference = t.targetType === 'conference';
    return `
      <li class="list-chip draggable-target" draggable="true"
          data-type="${escapeHtml(t.targetType)}" data-id="${escapeHtml(t.targetId)}">
        <span class="drag-handle" title="Drag to reorder">☰</span>
        <span class="chip-label">${escapeHtml(t.name)}</span>
        <span class="badge">${escapeHtml(t.targetType)}</span>
        ${isConference ? '<span class="badge" title="Conference membership">membership</span>' : ''}
        <button type="button" class="small danger" onclick="removeTarget(${userId}, '${t.targetType}', '${t.targetId}')">Remove</button>
      </li>
    `;
  }).join('');
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
      options = allConfs
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
  initTouchTargetOrdering(ul, () => saveTargetOrder(userId, ul));
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

function initTouchTargetOrdering(list, onCommit) {
  list._touchReorderCommit = onCommit;
  if (list._touchReorderReady) return;

  let session = null;
  const finish = (event, cancelled = false) => {
    if (!session || event.pointerId !== session.pointerId) return;
    const { handle, item, moved, originalNextSibling } = session;
    session = null;
    item.classList.remove('dragging');
    list.classList.remove('is-touch-reordering');
    try {
      handle.releasePointerCapture(event.pointerId);
    } catch {}

    if (cancelled) {
      list.insertBefore(item, originalNextSibling);
      return;
    }
    if (moved) list._touchReorderCommit?.();
  };

  list.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    const handle = event.target.closest('.drag-handle');
    const item = handle?.closest('.draggable-target');
    if (!handle || !item || !list.contains(item)) return;

    event.preventDefault();
    session = {
      pointerId: event.pointerId,
      handle,
      item,
      moved: false,
      originalNextSibling: item.nextSibling,
    };
    item.classList.add('dragging');
    list.classList.add('is-touch-reordering');
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {}
  });

  list.addEventListener('pointermove', (event) => {
    if (!session || event.pointerId !== session.pointerId) return;
    event.preventDefault();
    const afterElement = getDragAfterElement(list, event.clientY);
    const previousNextSibling = session.item.nextSibling;
    if (!afterElement) list.appendChild(session.item);
    else if (afterElement !== session.item) list.insertBefore(session.item, afterElement);
    if (session.item.nextSibling !== previousNextSibling) session.moved = true;

    const edge = 56;
    if (event.clientY < edge) window.scrollBy(0, -12);
    else if (event.clientY > window.innerHeight - edge) window.scrollBy(0, 12);
  }, { passive: false });

  list.addEventListener('pointerup', (event) => finish(event));
  list.addEventListener('pointercancel', (event) => finish(event, true));
  list._touchReorderReady = true;
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
      setCachedTargetAssignment(userId, type, id, true);
      if (type === 'conference') {
        scheduleConferenceMembershipEditorRefresh(id, userId);
      }
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
      setCachedTargetAssignment(userId, type, tid, false);
      if (type === 'conference') {
        scheduleConferenceMembershipEditorRefresh(tid, userId);
      }
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
  const newName = await adminPrompt('Enter a new name for this feed.', currentName, {
    title: 'Rename feed',
    label: 'Feed name',
    confirmLabel: 'Save',
  });
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
  const newPassword = await adminPrompt(`Enter a new password for ${label}.`, '', {
    title: 'Reset feed password',
    label: 'New password',
    inputType: 'password',
    confirmLabel: 'Reset password',
    minLength: 4,
    validationMessage: 'Password must be at least 4 characters.',
  });
  if (!newPassword) return;

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
  if (!await adminConfirm('Are you sure you want to delete this feed?', {
    title: 'Delete feed',
    confirmLabel: 'Delete',
    danger: true,
  })) return;
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
  const newName = await adminPrompt('Enter a new name for this user.', currentName, {
    title: 'Rename user',
    label: 'Username',
    confirmLabel: 'Save',
  });
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

window.stopUserTransmission = async function (userId, button) {
  const userName = latestAdminStatus?.users?.find((user) => Number(user.id) === Number(userId))?.name || 'User';
  if (button) {
    button.dataset.requestPending = 'true';
    button.disabled = true;
  }

  try {
    const res = await authedFetch(`/admin/users/${userId}/stop-transmission`, { method: 'POST' });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload.error || 'Failed to stop transmission');
    }

    const statusUser = latestAdminStatus?.users?.find((user) => Number(user.id) === Number(userId));
    if (statusUser) statusUser.talking = false;

    showMessage(
      payload.stopped
        ? `✅ Transmission stopped for ${userName}`
        : `ℹ️ ${userName} was no longer transmitting`,
      payload.stopped ? 'success' : 'warning',
      'status'
    );
  } catch (err) {
    console.error('Error stopping user transmission:', err);
    showMessage(`❌ ${err.message}`, 'error', 'status');
  } finally {
    if (button) delete button.dataset.requestPending;
    syncStopTransmissionButtons();
    if (latestAdminStatus) renderAdminStatus(latestAdminStatus);
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
  const newName = await adminPrompt('Enter a new name for this conference.', currentName, {
    title: 'Rename conference',
    label: 'Conference name',
    confirmLabel: 'Save',
  });
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



window.confirmUnassign = async function (userId, confId) {
  if (await adminConfirm('Are you sure you want to remove this user from the conference?', {
    title: 'Remove conference member',
    confirmLabel: 'Remove',
    danger: true,
  })) {
    await unassignUser(userId, confId);
  }
};

window.unassignUser = async function (userId, confId) {
  try {
    const res = await authedFetch(`/conferences/${confId}/users/${userId}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      showMessage('✅ User removed from conference', 'success', 'user');
      scheduleUserTargetEditorRefresh(userId);
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
      await loadProductions({ selectId: selectedProductionId });
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
  if (!await adminConfirm('Are you sure you want to delete this user?', {
    title: 'Delete user',
    confirmLabel: 'Delete',
    danger: true,
  })) return;
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
  if (!await adminConfirm(`Are you sure you want to ${label} for this user?`, {
    title: 'Change admin rights',
    confirmLabel: shouldMakeAdmin ? 'Make admin' : 'Remove admin',
    danger: !shouldMakeAdmin,
  })) return;
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

function getAdminLoginLinkPath(kind, entityId, includeQrCode = false) {
  const collection = kind === 'feed' ? 'feeds' : 'users';
  return `/admin/${collection}/${entityId}/login-link${includeQrCode ? '?qr=1' : ''}`;
}

async function requestAdminLoginLink(kind, entityId, includeQrCode = false) {
  const res = await authedFetch(getAdminLoginLinkPath(kind, entityId, includeQrCode), {
    method: 'POST'
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.loginUrl) {
    throw new Error(payload.error || 'Failed to create login URL');
  }
  return payload;
}

function buildEntityLoginQrFilename(kind, entityName) {
  const safeName = String(entityName || kind)
    .trim()
    .replace(/[^a-z0-9.-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-') || kind;
  return `talktome-${kind}-${safeName}-login-qr.png`;
}

function holdButtonWidth(button) {
  if (!button) return () => {};
  const originalWidth = button.style.width;
  const width = button.getBoundingClientRect().width;
  if (width > 0) button.style.width = `${Math.ceil(width)}px`;
  return () => {
    button.style.width = originalWidth;
  };
}

window.copyEntityLoginUrl = async function (kind, entityId, entityName, button) {
  const normalizedKind = kind === 'feed' ? 'feed' : kind === 'guest' ? 'guest' : 'user';
  const originalLabel = button?.textContent || 'Copy Login URL';
  const releaseButtonWidth = holdButtonWidth(button);
  if (button) button.disabled = true;
  try {
    const payload = await requestAdminLoginLink(normalizedKind, entityId);

    await copyTextToClipboard(payload.loginUrl);
    if (button) button.textContent = 'Copied';
    showMessage(`✅ Login URL copied for ${entityName}`, 'success', normalizedKind === 'feed' ? 'feed' : 'user');
    window.setTimeout(() => {
      if (button) {
        button.textContent = originalLabel;
        button.disabled = false;
        releaseButtonWidth();
      }
    }, 1800);
  } catch (err) {
    if (button) {
      button.disabled = false;
      releaseButtonWidth();
    }
    showMessage(`❌ ${err.message || 'Failed to copy login URL'}`, 'error', 'user');
    console.error('Failed to copy login URL:', err);
  }
};

window.copyUserLoginUrl = function (userId, userName, button) {
  return window.copyEntityLoginUrl('user', userId, userName, button);
};

window.openEntityLoginQr = async function (kind, entityId, entityName, button) {
  const normalizedKind = kind === 'feed' ? 'feed' : kind === 'guest' ? 'guest' : 'user';
  const messageSection = normalizedKind === 'feed' ? 'feed' : 'user';
  if (button) button.disabled = true;
  try {
    const payload = await requestAdminLoginLink(normalizedKind, entityId, true);
    if (!payload.qrCodeDataUrl || !payload.loginUrl) {
      throw new Error('Failed to create login QR code');
    }
    const typeLabel = normalizedKind === 'feed' ? 'Feed' : normalizedKind === 'guest' ? 'Guest' : 'User';
    openAdminImageLightbox({
      dataUrl: payload.qrCodeDataUrl,
      title: `Login QR Code · ${entityName}`,
      alt: `Login QR code for ${typeLabel.toLowerCase()} ${entityName}`,
      filename: buildEntityLoginQrFilename(normalizedKind, entityName),
      messageSection,
    });
  } catch (err) {
    showMessage(`❌ ${err.message || 'Failed to create login QR code'}`, 'error', messageSection);
    console.error('Failed to create login QR code:', err);
  } finally {
    if (button) button.disabled = false;
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
  if (!await adminConfirm('Are you sure you want to delete this conference?', {
    title: 'Delete conference',
    confirmLabel: 'Delete',
    danger: true,
  })) return;
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
      const created = await res.json().catch(() => ({}));
      entityMasterDetailState.users.selectedId = created.id ?? null;
      document.getElementById('user-form')?.reset();
      clearEntitySearch(userSearch);
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
      const created = await res.json().catch(() => ({}));
      entityMasterDetailState.conferences.selectedId = created.id ?? null;
      document.getElementById('conf-form')?.reset();
      clearEntitySearch(conferenceSearch);
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
      const created = await res.json().catch(() => ({}));
      entityMasterDetailState.feeds.selectedId = created.id ?? null;
      document.getElementById('feed-form')?.reset();
      clearEntitySearch(feedSearch);
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

if (guestLoginEnabledInput) {
  guestLoginEnabledInput.addEventListener('change', async () => {
    const enabled = Boolean(guestLoginEnabledInput.checked);
    guestLoginEnabledInput.disabled = true;
    let saved = false;
    try {
      const res = await authedFetch('/admin/settings/guest-login', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || 'Failed to save Guest login');
      }
      saved = true;
      showMessage(
        payload.enabled ? '✅ Guest login enabled' : '✅ Guest login disabled',
        'success',
        'config'
      );
      try {
        await loadGuestLoginSettings();
        await refreshAdminLists({ users: true, conferences: true });
      } catch (refreshError) {
        console.error('Failed to refresh Guest login UI:', refreshError);
      }
    } catch (err) {
      if (!saved) guestLoginEnabledInput.checked = !enabled;
      console.error('Failed to save Guest login:', err);
      showMessage(`❌ ${err.message || 'Failed to save Guest login'}`, 'error', 'config');
    } finally {
      guestLoginEnabledInput.disabled = false;
    }
  });
}

if (defaultClientSettingsForm) {
  defaultClientSettingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = defaultClientSettingsForm.querySelector('button[type="submit"]');
    const settings = {
      audioProfile: defaultClientAudioProfile?.value || 'ultra-low',
      dimAmountDb: Number(defaultClientDimAmount?.value ?? -15),
      dimFeedsWhileSpeaking: Boolean(defaultClientDimSelf?.checked),
      dimWhenAddressed: Boolean(defaultClientDimIncoming?.checked),
      audioAutoProcessing: Boolean(defaultClientAudioProcessing?.checked),
      playConnectionSounds: Boolean(defaultClientConnectionSounds?.checked),
      leftHandMode: Boolean(defaultClientLeftHand?.checked),
      lockMultipleTargets: Boolean(defaultClientLockMultiple?.checked),
    };

    if (submitButton) submitButton.disabled = true;
    try {
      const res = await authedFetch('/admin/settings/default-client', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Failed to save default client settings');
      await loadDefaultClientSettings();
      showMessage('✅ Default client settings saved', 'success', 'config');
    } catch (error) {
      console.error('Failed to save default client settings:', error);
      showMessage(`❌ ${error.message || 'Failed to save default client settings'}`, 'error', 'config');
    } finally {
      if (submitButton) submitButton.disabled = false;
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

if (automaticBackupForm) {
  automaticBackupEnabled?.addEventListener('change', syncAutomaticBackupVisibility);
  automaticBackupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = automaticBackupForm.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    try {
      const res = await authedFetch('/admin/settings/automatic-backup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: Boolean(automaticBackupEnabled?.checked),
          intervalDays: Number(automaticBackupInterval?.value || 7),
        }),
      });
      const settings = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(settings.error || 'Failed to save automatic backup settings');
      renderAutomaticBackupSettings(settings);
      showMessage(
        settings.lastError
          ? `⚠️ Automatic backup is enabled, but the backup failed: ${settings.lastError}`
          : '✅ Automatic backup settings saved',
        settings.lastError ? 'warning' : 'success',
        'config'
      );
    } catch (error) {
      console.error('Failed to save automatic backup settings:', error);
      showMessage(`❌ ${error.message || 'Failed to save automatic backup settings'}`, 'error', 'config');
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

if (apiKeyCopyBtn) {
  apiKeyCopyBtn.addEventListener('click', async () => {
    const originalLabel = apiKeyCopyBtn.textContent;
    const originalWidth = Math.ceil(apiKeyCopyBtn.getBoundingClientRect().width);
    apiKeyCopyBtn.disabled = true;

    try {
      const apiKey = currentApiKey || await loadApiKeyField();
      if (!apiKey) {
        showMessage('Failed to load API key', 'error', 'config');
        return;
      }

      await copyTextToClipboard(apiKey);
      apiKeyCopyBtn.style.width = `${originalWidth}px`;
      apiKeyCopyBtn.textContent = 'Copied';
      showMessage('✅ API key copied', 'success', 'config');
      window.setTimeout(() => {
        apiKeyCopyBtn.textContent = originalLabel;
        apiKeyCopyBtn.style.removeProperty('width');
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

if (apiKeyRegenerateBtn) {
  apiKeyRegenerateBtn.addEventListener('click', async () => {
    if (!await adminConfirm(
      'Regenerating the API key immediately invalidates the old key. Companion, Bridge and automation clients using it must be updated. Continue?',
      {
        title: 'Regenerate API key',
        confirmLabel: 'Regenerate',
        danger: true,
      },
    )) {
      return;
    }

    apiKeyRegenerateBtn.disabled = true;
    if (apiKeyCopyBtn) apiKeyCopyBtn.disabled = true;
    const originalLabel = apiKeyRegenerateBtn.textContent;
    apiKeyRegenerateBtn.textContent = 'Regenerating…';

    try {
      const res = await authedFetch('/admin/api-key/regenerate', { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.apiKey) {
        throw new Error(payload.error || 'Failed to regenerate API key');
      }

      clearApiKeyField();
      currentApiKey = payload.apiKey;
      if (apiKeyValueInput) {
        apiKeyValueInput.value = currentApiKey;
        apiKeyValueInput.placeholder = '';
      }
      showMessage('✅ API key regenerated. Update all clients using the old key.', 'success', 'config');
    } catch (err) {
      console.error('Failed to regenerate API key:', err);
      showMessage(err.message || 'Failed to regenerate API key', 'error', 'config');
    } finally {
      apiKeyRegenerateBtn.disabled = false;
      apiKeyRegenerateBtn.textContent = originalLabel;
      if (apiKeyCopyBtn) apiKeyCopyBtn.disabled = false;
    }
  });
}

if (containerRestartBtn) {
  containerRestartBtn.addEventListener('click', async () => {
    if (!await adminConfirm('Restart the server now? All connected clients will be disconnected briefly.', {
      title: 'Restart server',
      confirmLabel: 'Restart',
      danger: true,
    })) {
      return;
    }

    containerRestartBtn.disabled = true;
    containerRestartBtn.textContent = 'Restarting…';
    try {
      const res = await authedFetch('/admin/restart', { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showMessage(payload.error || 'Failed to restart server', 'error', 'config');
        containerRestartBtn.disabled = false;
        containerRestartBtn.textContent = 'Restart server';
        return;
      }
      showMessage('✅ Server restart requested. Reconnecting…', 'success', 'config');
    } catch (err) {
      console.error('Failed to restart server:', err);
      showMessage('❌ Failed to restart server', 'error', 'config');
      containerRestartBtn.disabled = false;
      containerRestartBtn.textContent = 'Restart server';
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

    const confirmed = await adminConfirm(
      'Importing will replace the current users, conferences, feeds and target configuration. Continue?',
      {
        title: 'Import configuration',
        confirmLabel: 'Import',
        danger: true,
      }
    );
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
      scheduleUserTargetEditorRefresh(userId);
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
      await loadProductions({ selectId: selectedProductionId });
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
      scheduleUserTargetEditorRefresh(userId);
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
      await loadProductions({ selectId: selectedProductionId });
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
  const newPassword = await adminPrompt(`Enter a new password for ${label}.`, '', {
    title: 'Reset user password',
    label: 'New password',
    inputType: 'password',
    confirmLabel: 'Reset password',
    minLength: 4,
    validationMessage: 'Password must be at least 4 characters.',
  });
  if (!newPassword) return;

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

async function handleProductionTargetToggle(toggle, forcedEnabled = null) {
  if (!selectedProductionPayload || !selectedProductionId) return;
  const userId = Number(toggle.dataset.userId);
  const targetType = toggle.dataset.targetType;
  const targetId = Number(toggle.dataset.targetId);
  const previousState = toggle.dataset.state || (toggle.getAttribute('aria-pressed') === 'true' ? 'talk' : 'off');
  let nextState;
  if (typeof forcedEnabled === 'string' && ['off', 'talk', 'listen-only'].includes(forcedEnabled)) {
    nextState = forcedEnabled;
  } else if (typeof forcedEnabled === 'boolean') {
    nextState = forcedEnabled ? 'talk' : 'off';
  } else if (targetType === 'conference') {
    nextState = previousState === 'off' ? 'talk' : previousState === 'talk' ? 'listen-only' : 'off';
  } else {
    nextState = previousState === 'talk' ? 'off' : 'talk';
  }
  if (!Number.isFinite(userId) || !Number.isFinite(targetId) || !targetType || nextState === previousState) return;

  setProductionTargetToggleState(toggle, nextState);
  toggle.disabled = true;
  try {
    const base = `/admin/productions/${selectedProductionId}/users/${userId}/targets`;
    if (nextState === 'talk') {
      await productionRequest(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId }),
      });
    } else if (nextState === 'listen-only') {
      await productionRequest(`${base}/conference/${targetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'listen-only' }),
      });
    } else {
      await productionRequest(`${base}/${encodeURIComponent(targetType)}/${targetId}`, { method: 'DELETE' });
    }
    const targets = selectedProductionPayload.targets[String(userId)] || [];
    const existingTarget = targets.find((target) => (
      target.targetType === targetType && Number(target.targetId) === targetId
    ));
    if (nextState === 'talk' && !existingTarget) {
      const catalogs = targetType === 'user'
        ? selectedProductionPayload.members
        : targetType === 'conference'
          ? selectedProductionPayload.conferences
          : selectedProductionPayload.feeds;
      const target = catalogs.find((item) => Number(item.id) === targetId);
      targets.push({ targetType, targetId, name: target?.name || String(targetId), canTalk: true });
    } else if (nextState === 'talk' && existingTarget) {
      existingTarget.canTalk = true;
    } else if (nextState === 'listen-only' && existingTarget) {
      existingTarget.canTalk = false;
    } else if (nextState === 'off') {
      selectedProductionPayload.targets[String(userId)] = targets.filter((target) => !(
        target.targetType === targetType && Number(target.targetId) === targetId
      ));
    }
    renderProductionOrder(selectedProductionPayload, productionOrderUser?.value);
  } catch (error) {
    setProductionTargetToggleState(toggle, previousState);
    showMessage(error.message || 'Target update failed', 'error', 'productions');
  } finally {
    toggle.disabled = false;
  }
}

productionList?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-production-select]');
  if (!button) return;
  loadProductionDetail(button.dataset.productionSelect);
});

multipleProductionsInput?.addEventListener('change', async () => {
  const enabled = multipleProductionsInput.checked;
  multipleProductionsInput.disabled = true;
  try {
    await productionRequest('/admin/settings/multiple-productions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    await loadProductions({ selectId: selectedProductionId });
    await Promise.all([
      renderUserList(
        currentAdminCatalog.users,
        currentAdminCatalog.conferences,
        currentAdminCatalog.feeds,
        currentBridgeRegistry
      ),
      renderConferenceList(currentAdminCatalog.conferences, currentAdminCatalog.users),
    ]);
    showMessage(`Multiple Productions ${enabled ? 'enabled' : 'disabled'}.`, 'success', 'matrix');
  } catch (error) {
    multipleProductionsInput.checked = !enabled;
    if (error?.status === 404) {
      multipleProductionsSupported = false;
      showMessage(
        'Restart the Talktome server to enable Multiple Productions.',
        'warning',
        'matrix'
      );
    } else {
      showMessage(error.message || 'Failed to update production mode', 'error', 'matrix');
    }
  } finally {
    multipleProductionsInput.disabled = !multipleProductionsSupported || !adminState.isGlobalAdmin;
  }
});

productionCreateForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = productionCreateName?.value?.trim() || '';
  if (!name) return;
  try {
    const response = await productionRequest('/admin/productions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const created = await response.json();
    productionCreateForm.reset();
    clearEntitySearch(productionSearch);
    await loadProductions({ selectId: created.id });
    showMessage('Production created.', 'success', 'productions');
  } catch (error) {
    showMessage(error.message || 'Failed to create production', 'error', 'productions');
  }
});

productionRenameButton?.addEventListener('click', async () => {
  if (!selectedProductionPayload || !selectedProductionId) return;
  const name = (await adminPrompt(
    'Enter a new name for this production.',
    selectedProductionPayload.production.name,
    {
      title: 'Rename production',
      label: 'Production name',
      confirmLabel: 'Save',
    }
  ))?.trim();
  if (!name || name === selectedProductionPayload.production.name) return;
  try {
    await productionRequest(`/admin/productions/${selectedProductionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await loadProductions({ selectId: selectedProductionId });
    showMessage('Production renamed.', 'success', 'productions');
  } catch (error) {
    showMessage(error.message || 'Failed to rename production', 'error', 'productions');
  }
});

productionDeleteButton?.addEventListener('click', async () => {
  if (!selectedProductionPayload || !selectedProductionId) return;
  if (!await adminConfirm(
    `Delete production “${selectedProductionPayload.production.name}”? Global users, conferences and feeds will not be deleted.`,
    {
      title: 'Delete production',
      confirmLabel: 'Delete',
      danger: true,
    }
  )) return;
  try {
    await productionRequest(`/admin/productions/${selectedProductionId}`, { method: 'DELETE' });
    selectedProductionId = null;
    await loadProductions();
    showMessage('Production deleted.', 'success', 'productions');
  } catch (error) {
    showMessage(error.message || 'Failed to delete production', 'error', 'productions');
  }
});

async function updateProductionEntity(button, shouldBeMember) {
  const entityType = button?.dataset.productionEntityType;
  const entityId = Number(button?.dataset.productionEntityId);
  const pathByType = { user: 'users', conference: 'conferences', feed: 'feeds' };
  const path = pathByType[entityType];
  if (!selectedProductionId || !path || !Number.isFinite(entityId)) return;
  button.disabled = true;
  try {
    if (shouldBeMember) {
      await productionRequest(`/admin/productions/${selectedProductionId}/${path}/${entityId}`, {
        method: 'PUT',
        ...(entityType === 'user' ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isAdmin: false }),
        } : {}),
      });
    } else {
      await productionRequest(`/admin/productions/${selectedProductionId}/${path}/${entityId}`, { method: 'DELETE' });
    }
    await loadProductionDetail(selectedProductionId, {
      preferredOrderUserId: entityType === 'user' && shouldBeMember ? entityId : null,
    });
  } catch (error) {
    button.disabled = false;
    showMessage(error.message || 'Failed to update production contents', 'error', 'matrix');
  }
}

productionMembersList?.addEventListener('click', async (event) => {
  const adminButton = event.target.closest('[data-production-admin]');
  if (adminButton) {
    event.stopPropagation();
    const userId = Number(adminButton.dataset.productionAdmin);
    const shouldMakeAdmin = adminButton.dataset.shouldMakeAdmin === 'true';
    if (!selectedProductionId || !Number.isFinite(userId)) return;
    const action = shouldMakeAdmin ? 'make this user a production admin' : 'remove production admin rights from this user';
    if (!await adminConfirm(`Are you sure you want to ${action}?`, {
      title: 'Change production admin rights',
      confirmLabel: shouldMakeAdmin ? 'Make admin' : 'Remove admin',
      danger: !shouldMakeAdmin,
    })) return;
    adminButton.disabled = true;
    try {
      await productionRequest(`/admin/productions/${selectedProductionId}/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAdmin: shouldMakeAdmin }),
      });
      await loadProductionDetail(selectedProductionId);
    } catch (error) {
      adminButton.disabled = false;
      showMessage(error.message || 'Failed to update production admin', 'error', 'productions');
    }
    return;
  }

  const memberButton = event.target.closest('[data-production-entity-type][data-production-entity-id]');
  if (memberButton) {
    event.stopPropagation();
    if (!memberButton.disabled) {
      updateProductionEntity(memberButton, memberButton.dataset.isMember !== 'true');
    }
    return;
  }

  if (event.target.closest('button, input, a, select')) return;
  const row = event.target.closest('[data-production-entity-row]');
  const button = row?.querySelector('[data-production-entity-type][data-production-entity-id]');
  if (!button || button.disabled) return;
  updateProductionEntity(button, button.dataset.isMember !== 'true');
});

productionMembersList?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (event.target.closest('button, input, a, select')) return;
  const row = event.target.closest('[data-production-entity-row]');
  const button = row?.querySelector('[data-production-entity-type][data-production-entity-id]');
  if (!button || button.disabled) return;
  event.preventDefault();
  updateProductionEntity(button, button.dataset.isMember !== 'true');
});

productionOrderUser?.addEventListener('change', () => {
  if (selectedProductionPayload) renderProductionOrder(selectedProductionPayload, productionOrderUser.value);
});

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
    toggleHandler(toggle, paintSession.value);
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
  container.addEventListener('dblclick', (event) => {
    if (!event.target.closest(toggleSelector)) return;
    event.preventDefault();
  });
  container.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' || event.button !== 0) return;
    const toggle = event.target.closest(toggleSelector);
    if (!toggle || toggle.disabled) return;

    event.preventDefault();
    suppressPointerClick = true;
    const currentState = toggle.dataset.state || (toggle.getAttribute('aria-pressed') === 'true' ? 'talk' : 'off');
    const paintValue = toggle.dataset.matrixMultistate === 'true'
      ? currentState === 'off' ? 'talk' : currentState === 'talk' ? 'listen-only' : 'off'
      : toggle.getAttribute('aria-pressed') !== 'true';
    paintSession = {
      pointerId: event.pointerId,
      value: paintValue,
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
setupMatrixInteractions(productionTargetMatrixContainer, '.production-target-toggle', handleProductionTargetToggle);

if (mediaNetworkQrButton) {
  mediaNetworkQrButton.addEventListener('click', () => openMediaNetworkQrLightbox());
}

if (mediaNetworkQrDownloadButton) {
  mediaNetworkQrDownloadButton.addEventListener('click', () => downloadMediaNetworkQrImage());
}

if (adminImageLightboxClose) {
  adminImageLightboxClose.addEventListener('click', () => closeAdminImageLightbox());
}

if (adminImageLightboxDownloadButton) {
  adminImageLightboxDownloadButton.addEventListener('click', () => downloadAdminImageLightboxImage());
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
  if (event.key === 'Escape' && userAudioSettingsDialog && !userAudioSettingsDialog.classList.contains('is-hidden')) {
    closeUserAudioSettings();
    return;
  }
  if (event.key === 'Escape' && adminImageLightbox && !adminImageLightbox.classList.contains('is-hidden')) {
    closeAdminImageLightbox();
  }
});

const userAudioSettingsDialog = document.getElementById('user-audio-settings-dialog');
const userAudioSettingsForm = document.getElementById('user-audio-settings-form');
const userAudioSettingsFields = document.getElementById('user-audio-settings-fields');
const userAudioSettingsTitle = document.getElementById('user-audio-settings-title');
const userAudioSettingsNotice = document.getElementById('user-audio-settings-notice');
const userAudioSettingsError = document.getElementById('user-audio-settings-error');
const userAudioSettingsSave = document.getElementById('user-audio-settings-save');
let editingAudioSettingsUserId = null;

function renderUserAudioSettingsFields(settings, targets = []) {
  const settingsApi = window.TalktomeUserAudioSettings;
  const checked = (key) => settings[key] ? 'checked' : '';
  const options = (values, selected, label) => values.map((value) => (
    `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(label(value))}</option>`
  )).join('');
  const targetOptions = targets.map((target) => {
    const identity = `${target.type}:${target.id}`;
    const typeLabel = target.type === 'conference' ? 'Conference' : 'User';
    return `<option value="${escapeHtml(identity)}" ${identity === settings.voiceTriggerTarget ? 'selected' : ''}>${escapeHtml(target.name)} (${typeLabel})</option>`;
  }).join('');
  userAudioSettingsFields.innerHTML = `
    <div class="user-audio-settings-row"><label for="admin-audio-profile">Audio profile</label><select id="admin-audio-profile">${options(settingsApi.AUDIO_PROFILES, settings.audioProfile, (value) => ({ 'ultra-low': 'Ultra low (5 ms frame)', low: 'Low (10 ms frame)', standard: 'Standard (20 ms frame)' }[value]))}</select></div>
    <div class="user-audio-settings-row"><label for="admin-dim-amount">Dim amount</label><select id="admin-dim-amount">${options(settingsApi.DIM_AMOUNT_DB_OPTIONS, settings.dimAmountDb, (value) => `${value} dB`)}</select></div>
    <label class="user-audio-settings-switch"><span>Dim feeds while speaking</span><span class="admin-switch"><input id="admin-dim-speaking" type="checkbox" role="switch" ${checked('dimFeedsWhileSpeaking')}><span class="admin-switch__track" aria-hidden="true"></span></span></label>
    <label class="user-audio-settings-switch"><span>Dim when addressed</span><span class="admin-switch"><input id="admin-dim-addressed" type="checkbox" role="switch" ${checked('dimWhenAddressed')}><span class="admin-switch__track" aria-hidden="true"></span></span></label>
    <label class="user-audio-settings-switch"><span>Audio auto processing</span><span class="admin-switch"><input id="admin-auto-processing" type="checkbox" role="switch" ${checked('audioAutoProcessing')}><span class="admin-switch__track" aria-hidden="true"></span></span></label>
    <label class="user-audio-settings-switch"><span>Play connection sounds</span><span class="admin-switch"><input id="admin-connection-sounds" type="checkbox" role="switch" ${checked('playConnectionSounds')}><span class="admin-switch__track" aria-hidden="true"></span></span></label>
    <label class="user-audio-settings-switch"><span>Left-hand mode</span><span class="admin-switch"><input id="admin-left-hand" type="checkbox" role="switch" ${checked('leftHandMode')}><span class="admin-switch__track" aria-hidden="true"></span></span></label>
    <label class="user-audio-settings-switch"><span>Lock multiple targets</span><span class="admin-switch"><input id="admin-lock-multiple" type="checkbox" role="switch" ${checked('lockMultipleTargets')}><span class="admin-switch__track" aria-hidden="true"></span></span></label>
    <div class="user-audio-settings-range"><label class="user-audio-settings-range__label" for="admin-mic-gain"><span>Manual mic gain</span><output id="admin-mic-gain-value">${Number(settings.userInputGainDb).toFixed(1)} dB</output></label><input id="admin-mic-gain" type="range" min="-30" max="40" step="0.5" value="${settings.userInputGainDb}"></div>
    <label class="user-audio-settings-switch"><span>Level trigger</span><span class="admin-switch"><input id="admin-level-trigger" type="checkbox" role="switch" ${checked('voiceTriggerEnabled')}><span class="admin-switch__track" aria-hidden="true"></span></span></label>
    <div class="user-audio-settings-row"><label for="admin-level-target">Target</label><select id="admin-level-target"><option value="">Select target</option>${targetOptions}</select></div>
    <div class="user-audio-settings-range"><label class="user-audio-settings-range__label" for="admin-level-threshold"><span>Threshold</span><output id="admin-level-threshold-value">${Number(settings.voiceTriggerThresholdDb).toFixed(1)} dB</output></label><input id="admin-level-threshold" type="range" min="-60" max="-6" step="1" value="${settings.voiceTriggerThresholdDb}"></div>
  `;
  document.getElementById('admin-mic-gain')?.addEventListener('input', (event) => {
    document.getElementById('admin-mic-gain-value').textContent = `${Number(event.target.value).toFixed(1)} dB`;
  });
  document.getElementById('admin-level-threshold')?.addEventListener('input', (event) => {
    document.getElementById('admin-level-threshold-value').textContent = `${Number(event.target.value).toFixed(1)} dB`;
  });
}

async function openUserAudioSettings(userId, userName) {
  editingAudioSettingsUserId = Number(userId);
  userAudioSettingsTitle.textContent = `Audio settings · ${userName}`;
  userAudioSettingsFields.innerHTML = '<div class="setting-meta">Loading…</div>';
  userAudioSettingsSave.disabled = true;
  userAudioSettingsNotice?.classList.add('is-hidden');
  userAudioSettingsError.classList.add('is-hidden');
  userAudioSettingsDialog.classList.remove('is-hidden');
  try {
    const response = await authedFetch(`/admin/users/${userId}/audio-settings`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Unable to load audio settings');
    if (editingAudioSettingsUserId !== Number(userId)) return;
    userAudioSettingsNotice?.classList.toggle('is-hidden', !payload.configuredAsBridge);
    renderUserAudioSettingsFields(payload.settings, payload.targets);
    userAudioSettingsSave.disabled = false;
  } catch (error) {
    userAudioSettingsFields.innerHTML = '';
    userAudioSettingsError.textContent = error.message;
    userAudioSettingsError.classList.remove('is-hidden');
  }
}

function closeUserAudioSettings() {
  editingAudioSettingsUserId = null;
  userAudioSettingsDialog.classList.add('is-hidden');
}

userAudioSettingsForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!editingAudioSettingsUserId) return;
  const settings = window.TalktomeUserAudioSettings.normalize({
    audioProfile: document.getElementById('admin-audio-profile').value,
    dimAmountDb: Number(document.getElementById('admin-dim-amount').value),
    dimFeedsWhileSpeaking: document.getElementById('admin-dim-speaking').checked,
    dimWhenAddressed: document.getElementById('admin-dim-addressed').checked,
    audioAutoProcessing: document.getElementById('admin-auto-processing').checked,
    playConnectionSounds: document.getElementById('admin-connection-sounds').checked,
    leftHandMode: document.getElementById('admin-left-hand').checked,
    lockMultipleTargets: document.getElementById('admin-lock-multiple').checked,
    userInputGainDb: Number(document.getElementById('admin-mic-gain').value),
    voiceTriggerEnabled: document.getElementById('admin-level-trigger').checked,
    voiceTriggerTarget: document.getElementById('admin-level-target').value,
    voiceTriggerThresholdDb: Number(document.getElementById('admin-level-threshold').value),
  }, { strict: true });
  userAudioSettingsSave.disabled = true;
  try {
    const response = await authedFetch(`/admin/users/${editingAudioSettingsUserId}/audio-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Unable to save audio settings');
    closeUserAudioSettings();
    showMessage('Audio settings saved', 'success', 'users');
  } catch (error) {
    userAudioSettingsError.textContent = error.message;
    userAudioSettingsError.classList.remove('is-hidden');
  } finally {
    userAudioSettingsSave.disabled = false;
  }
});
document.getElementById('user-audio-settings-close')?.addEventListener('click', closeUserAudioSettings);
document.getElementById('user-audio-settings-cancel')?.addEventListener('click', closeUserAudioSettings);
userAudioSettingsDialog?.addEventListener('click', (event) => {
  if (event.target === userAudioSettingsDialog) closeUserAudioSettings();
});

ensureAdminSession();
