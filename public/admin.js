const adminState = {
  isAuthenticated: false,
  isSuperAdmin: false,
  mustChangePassword: false,
  userId: null,
  name: ''
};

const adminLogin = document.getElementById('admin-login');
const adminLoginForm = document.getElementById('admin-login-form');
const adminLoginMessage = document.getElementById('admin-login-message');
const adminNameInput = document.getElementById('admin-name');
const adminApp = document.getElementById('admin-app');
const adminBar = document.getElementById('admin-bar');
const adminNameLabel = document.getElementById('admin-name-label');
const adminLogoutBtn = document.getElementById('admin-logout');
const configExportBtn = document.getElementById('config-export-btn');
const configImportBtn = document.getElementById('config-import-btn');
const configImportFile = document.getElementById('config-import-file');
const mediaNetworkMeta = document.getElementById('media-network-meta');
const mediaNetworkQrContainer = document.getElementById('media-network-qr');
const mediaNetworkQrButton = document.getElementById('media-network-qr-button');
const mediaNetworkQrImage = document.getElementById('media-network-qr-image');
const mediaNetworkQrDownloadButton = document.getElementById('media-network-qr-download');
const adminImageLightbox = document.getElementById('admin-image-lightbox');
const adminImageLightboxClose = document.getElementById('admin-image-lightbox-close');
const adminImageLightboxImage = document.getElementById('admin-image-lightbox-image');
const adminImageLightboxDownloadButton = document.getElementById('admin-image-lightbox-download');

const collapsibleAdminSections = {
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
    if (storedValue === null) return true;
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

async function loadData() {
  // 1) Daten holen
  const users       = await fetchJSON('/users');
  const conferences = await fetchJSON('/conferences');
  const feeds       = await fetchJSON('/feeds');
  await loadMdnsSettings();
  await loadMediaNetworkSettings();

  // 2) Container referenzieren und leeren
  const userList   = document.getElementById('user-list');
  const confList   = document.getElementById('conf-list');
  const feedList   = document.getElementById('feed-list');
  userList.innerHTML   = '';
  confList.innerHTML   = '';
  feedList.innerHTML   = '';


  for (const user of users) {
    const safeName = escapeHtml(user.name);
    const isAdmin = Boolean(user.is_admin);
    const isSuperadmin = Boolean(user.is_superadmin);
    const adminBadge = isSuperadmin
      ? '<span class="badge superadmin">Superadmin</span>'
      : isAdmin
        ? '<span class="badge admin">Admin</span>'
        : '';
    const adminToggle = adminState.isAuthenticated
      ? isSuperadmin
        ? ''
        : `<button type="button" class="small ${isAdmin ? 'warning' : ''}" onclick="toggleAdminRole(${user.id}, ${isAdmin ? 'false' : 'true'})">${isAdmin ? 'Remove admin' : 'Make admin'}</button>`
      : '';
    const deleteAttrs = isAdmin ? 'disabled title="Admin accounts cannot be deleted"' : '';
    const li = document.createElement('li');
    li.className = 'list-item list-item--toggleable';
    li.setAttribute('onclick', `toggleUserConfs(${user.id})`);

    const optionsHtml = conferences.length
      ? conferences.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')
      : '<option value="" disabled selected>No conferences</option>';

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
          <span class="badge">ID ${user.id}</span>
        </button>
        <div class="inline-controls" onclick="event.stopPropagation()">
          <button type="button" class="small warning" onclick='editUser(${user.id}, ${JSON.stringify(user.name)})'>Rename</button>
          <button type="button" class="small warning" onclick='resetPassword(${user.id}, ${JSON.stringify(user.name)})'>Reset Password</button>
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
      </div>
    `;

    userList.appendChild(li);
    await updateUserConferenceOptions(user.id, conferences);
    await loadUserTargets(user.id, users, conferences, feeds);
  }

  for (const feed of feeds) {
    const safeName = escapeHtml(feed.name);
    const li = document.createElement('li');
    li.className = 'list-item';
    li.innerHTML = `
      <div class="list-item-header">
        <div class="list-item-title">
          <span>${safeName}</span>
          <span class="badge">ID ${feed.id}</span>
        </div>
        <div class="inline-controls">
          <button type="button" class="small warning" onclick='editFeed(${feed.id}, ${JSON.stringify(feed.name)})'>Rename</button>
          <button type="button" class="small warning" onclick='resetFeedPassword(${feed.id}, ${JSON.stringify(feed.name)})'>Reset Password</button>
          <button type="button" class="small danger" onclick="deleteFeed(${feed.id})">Delete</button>
        </div>
      </div>
    `;
    feedList.appendChild(li);
  }

  for (const conf of conferences) {
    const safeName = escapeHtml(conf.name);
    const isAllConference = safeName.toLowerCase() === 'all';
    const li = document.createElement('li');
    li.className = 'list-item list-item--toggleable';
    li.dataset.confId = String(conf.id);
    li.dataset.isAll = String(isAllConference);
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
          <span class="badge">ID ${conf.id}</span>
        </button>
        ${isAllConference ? '' : `
        <div class="inline-controls" onclick="event.stopPropagation()">
          <button type="button" class="small warning" onclick='editConference(${conf.id}, ${JSON.stringify(conf.name)})'>Rename</button>
          <button type="button" class="small danger" onclick="deleteConference(${conf.id})">Delete</button>
        </div>`}
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
    await updateConferenceParticipantOptions(conf.id, users);
  }
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
  } catch (err) {
    console.error('Failed to load conference participants for select', err);
  }

  const assignedIds = new Set(assignedUsers.map(u => String(u.id)));
  const users = Array.isArray(allUsers) ? allUsers : [];
  const available = users.filter(u => !assignedIds.has(String(u.id)));

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

// Fetch and render targets + rebuild the “type → id” dropdown
async function loadUserTargets(userId, allUsers, allConfs, allFeeds = []) {
  const targets = await fetchJSON(`/users/${userId}/targets`);
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

  initTargetOrdering(userId, ul);

  const selType = document.getElementById(`add-target-type-${userId}`);
  const selId   = document.getElementById(`add-target-id-${userId}`);
  const addBtn  = document.getElementById(`add-target-btn-${userId}`);
  const refreshTargetSelectors = () => {
    const type = selType.value;
    const selectableUsers = allUsers.filter(item => !item.is_superadmin && Number(item.id) !== Number(userId));
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
      loadData();
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
      loadData();
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
      loadData();
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
  const confUl    = document.getElementById(`user-confs-${userId}`);
  const button    = toggleBtn || document.getElementById(`user-toggle-${userId}`);
  const willOpen  = !targetDiv.classList.contains('is-open');

  if (willOpen) {
    try {
      const confs = await fetchJSON(`/users/${userId}/conferences`);
      confUl.innerHTML = confs.length
        ? confs.map(c => `
            <li class="list-chip">
              <span class="chip-label">${escapeHtml(c.name)}</span>
              <button type="button" class="small danger" onclick="confirmUnassign(${userId}, ${c.id})">Remove</button>
            </li>
          `).join('')
        : '<li class="list-chip"><span class="chip-label">No conferences assigned yet</span></li>';

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
      loadData();
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
  const usersUl  = document.getElementById(`conf-users-${confId}`);
  const button   = toggleBtn || document.getElementById(`conf-toggle-${confId}`);
  const willOpen = !nested.classList.contains('is-open');

  if (willOpen) {
    try {
      const users = await fetchJSON(`/conferences/${confId}/users`);
      usersUl.innerHTML = users.length
        ? users.map(u => `
            <li class="list-chip">
              <span class="chip-label">${escapeHtml(u.name)}</span>
              <button type="button" class="small danger" onclick="confirmUnassign(${u.id},${confId})">Remove</button>
            </li>
          `).join('')
        : '<li class="list-chip"><span class="chip-label">No participants yet</span></li>';
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
      loadData();
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
      loadData();
    } else {
      const payload = await res.json().catch(() => ({}));
      showMessage(payload.error ? `❌ ${payload.error}` : '❌ Failed to delete user', 'error', 'user');
    }
  } catch (err) {
    showMessage('❌ Error deleting user: ' + err.message, 'error', 'user');
    console.error(err);
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
      loadData();
    } else {
      const payload = await res.json().catch(() => ({}));
      showMessage(payload.error ? `❌ ${payload.error}` : '❌ Failed to update admin role', 'error', 'user');
    }
  } catch (err) {
    showMessage('❌ Error updating admin role: ' + err.message, 'error', 'user');
    console.error(err);
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
      loadData();
    } else {
      showMessage('❌ Failed to delete conference', 'error', 'conf');
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
      loadData();
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
      loadData();
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
      loadData();
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
      const confs = await fetchJSON('/conferences');
      await updateUserConferenceOptions(userId, confs, prevIndex);
      const container = document.getElementById(`user-nested-${userId}`);
      if (container?.classList.contains('is-open')) {
        await toggleUserConfs(userId);
        await toggleUserConfs(userId);
      }
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
      const users = await fetchJSON('/users');
      await updateConferenceParticipantOptions(confId, users, prevIndex);

      const container = document.getElementById(`conf-controls-${confId}`);
      if (container?.classList.contains('is-open')) {
        await toggleConfUsers(confId);
        await toggleConfUsers(confId);
      }
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

for (const [sectionKey, section] of Object.entries(collapsibleAdminSections)) {
  if (!section.cardEl || !section.bodyEl) continue;
  section.cardEl.addEventListener('click', (event) => {
    if (event.target.closest('.card-header__actions')) return;
    if (event.target.closest('.card-section-body')) return;
    setAdminSectionCollapsed(sectionKey, !section.bodyEl.hidden);
  });
}

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
