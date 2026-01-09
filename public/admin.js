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
const adminApp = document.getElementById('admin-app');
const adminBar = document.getElementById('admin-bar');
const adminNameLabel = document.getElementById('admin-name-label');
const adminLogoutBtn = document.getElementById('admin-logout');

function showLogin(message) {
  if (adminLogin) adminLogin.classList.remove('is-hidden');
  if (adminApp) adminApp.classList.add('is-hidden');
  if (adminBar) adminBar.classList.add('is-hidden');
  if (adminLoginMessage) {
    adminLoginMessage.textContent = message || '';
    adminLoginMessage.classList.toggle('is-visible', Boolean(message));
    adminLoginMessage.classList.remove('flash-success', 'flash-warning');
    adminLoginMessage.classList.add('flash-error');
  }
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    li.className = 'list-item';

    const optionsHtml = conferences.length
      ? conferences.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')
      : '<option value="" disabled selected>No conferences</option>';

    li.innerHTML = `
      <div class="list-item-header">
        <div class="list-item-title">
          <button type="button" class="small" id="user-toggle-${user.id}" onclick="toggleUserConfs(${user.id}, this)" aria-expanded="false">Show details</button>
          <span>${safeName}</span>
          ${adminBadge}
          <span class="badge">ID ${user.id}</span>
        </div>
        <div class="inline-controls">
          <button type="button" class="small warning" onclick='editUser(${user.id}, ${JSON.stringify(user.name)})'>Rename</button>
          <button type="button" class="small warning" onclick='resetPassword(${user.id}, ${JSON.stringify(user.name)})'>Reset Password</button>
          ${adminToggle}
          <button type="button" class="small danger" onclick="deleteUser(${user.id})" ${deleteAttrs}>Delete</button>
        </div>
      </div>
      <div class="nested" id="user-nested-${user.id}">
        <div class="nested-block">
          <strong>Conferences</strong>
          <ul id="user-confs-${user.id}"></ul>
          <div class="inline-controls">
            <select id="add-user-conf-${user.id}">${optionsHtml}</select>
            <button type="button" class="small" ${conferences.length ? '' : 'disabled'} onclick="assignUserToConference(${user.id})">Add to conference</button>
          </div>
        </div>
        <div class="nested-block">
          <strong>Target Buttons</strong>
          <ul id="user-targets-${user.id}"></ul>
          <div class="inline-controls">
            <select id="add-target-type-${user.id}">
              <option value="user">User</option>
              <option value="conference">Conference</option>
              <option value="feed">Feed</option>
            </select>
            <select id="add-target-id-${user.id}"></select>
            <button type="button" id="add-target-btn-${user.id}" class="small" onclick="addTarget(${user.id})">Add target</button>
          </div>
        </div>
      </div>
    `;

    userList.appendChild(li);
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
    li.className = 'list-item';
    li.dataset.confId = String(conf.id);
    li.dataset.isAll = String(isAllConference);
    li.innerHTML = `
      <div class="list-item-header">
        <div class="list-item-title">
          <button type="button" class="small" id="conf-toggle-${conf.id}" onclick="toggleConfUsers(${conf.id}, this)" aria-expanded="false">Show details</button>
          <span>${safeName}</span>
          <span class="badge">ID ${conf.id}</span>
        </div>
        ${isAllConference ? '' : `
        <div class="inline-controls">
          <button type="button" class="small warning" onclick='editConference(${conf.id}, ${JSON.stringify(conf.name)})'>Rename</button>
          <button type="button" class="small danger" onclick="deleteConference(${conf.id})">Delete</button>
        </div>`}
      </div>
      <div class="nested" id="conf-controls-${conf.id}">
        <strong>Participants</strong>
        <ul id="conf-users-${conf.id}"></ul>
      </div>
    `;
    confList.appendChild(li);
  }
}

// Fetch and render targets + rebuild the “type → id” dropdown
async function loadUserTargets(userId, allUsers, allConfs, allFeeds = []) {
  const targets = await fetchJSON(`/users/${userId}/targets`);
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
    let options = [];
    if (type === 'user') {
      options = allUsers.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`);
    } else if (type === 'conference') {
      options = allConfs.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`);
    } else if (type === 'feed') {
      options = allFeeds.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`);
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
  const type = document.getElementById(`add-target-type-${userId}`).value;
  const id   = document.getElementById(`add-target-id-${userId}`).value;
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
    button.setAttribute('aria-expanded', willOpen);
    button.textContent = willOpen ? 'Hide details' : 'Show details';
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
    button.setAttribute('aria-expanded', willOpen);
    button.textContent = willOpen ? 'Hide details' : 'Show details';
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


// Called by the "Add to Conf" button inside each user's block
window.assignUserToConference = async function(userId) {
  const sel = document.getElementById(`add-user-conf-${userId}`);
  const confId = sel.value;
  try {
    const res = await authedFetch(`/conferences/${confId}/users/${userId}`, {
      method: 'POST'
    });
    if (res.ok) {
      showMessage('✅ User assigned to conference', 'success', 'user');
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

ensureAdminSession();
