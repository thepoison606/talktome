function showMessage(text, tone = 'error') {
  const el = document.getElementById('message');
  if (!el) return;

  const toneClass = tone === 'success' || tone === 'green'
    ? 'flash-success'
    : tone === 'warning'
      ? 'flash-warning'
      : 'flash-error';

  el.textContent = text;
  el.classList.remove('flash-success', 'flash-error', 'flash-warning');
  el.classList.add('is-visible', toneClass);

  clearTimeout(showMessage._timer);
  showMessage._timer = setTimeout(() => {
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

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

async function loadData() {
  // 1) Daten holen
  const users       = await fetchJSON('/users');
  const conferences = await fetchJSON('/conferences');

  // 2) Container referenzieren und leeren
  const userList   = document.getElementById('user-list');
  const confList   = document.getElementById('conf-list');
  userList.innerHTML   = '';
  confList.innerHTML   = '';


  for (const user of users) {
    const safeName = escapeHtml(user.name);
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
          <span class="badge">ID ${user.id}</span>
        </div>
        <div class="inline-controls">
          <button type="button" class="small warning" onclick='editUser(${user.id}, ${JSON.stringify(user.name)})'>Rename</button>
          <button type="button" class="small warning" onclick='resetPassword(${user.id}, ${JSON.stringify(user.name)})'>Reset Password</button>
          <button type="button" class="small danger" onclick="deleteUser(${user.id})">Delete</button>
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
            </select>
            <select id="add-target-id-${user.id}"></select>
            <button type="button" class="small" onclick="addTarget(${user.id})">Add target</button>
          </div>
        </div>
      </div>
    `;

    userList.appendChild(li);
    await loadUserTargets(user.id, users, conferences);
  }

  for (const conf of conferences) {
    const safeName = escapeHtml(conf.name);
    const li = document.createElement('li');
    li.className = 'list-item';
    li.innerHTML = `
      <div class="list-item-header">
        <div class="list-item-title">
          <button type="button" class="small" id="conf-toggle-${conf.id}" onclick="toggleConfUsers(${conf.id}, this)" aria-expanded="false">Show details</button>
          <span>${safeName}</span>
          <span class="badge">ID ${conf.id}</span>
        </div>
        <div class="inline-controls">
          <button type="button" class="small warning" onclick='editConference(${conf.id}, ${JSON.stringify(conf.name)})'>Rename</button>
          <button type="button" class="small danger" onclick="deleteConference(${conf.id})">Delete</button>
        </div>
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
async function loadUserTargets(userId, allUsers, allConfs) {
  const targets = await fetchJSON(`/users/${userId}/targets`);
  const ul = document.getElementById(`user-targets-${userId}`);
  ul.innerHTML = targets.map(t => `
      <li class="list-chip">
        <span class="chip-label">${escapeHtml(t.name)}</span>
        <span class="badge">${escapeHtml(t.targetType)}</span>
        <button type="button" class="small danger"
                onclick="removeTarget(${userId}, '${t.targetType}', '${t.targetId}')">
          Remove
        </button>
      </li>
    `).join('');

  const selType = document.getElementById(`add-target-type-${userId}`);
  const selId   = document.getElementById(`add-target-id-${userId}`);
  const list    = selType.value === 'user' ? allUsers : allConfs;

  selId.innerHTML = list.map(item =>
      `<option value="${item.id}">${escapeHtml(item.name)}</option>`
  ).join('');

  // Re-load the ID dropdown whenever the type changes
  selType.onchange = () =>
      loadUserTargets(userId, allUsers, allConfs);
}

// Called by the “➕” button
window.addTarget = async function(userId) {
  const type = document.getElementById(`add-target-type-${userId}`).value;
  const id   = document.getElementById(`add-target-id-${userId}`).value;
  const res = await fetch(`/users/${userId}/targets`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ targetType: type, targetId: id })
  });
  if (!res.ok) {
    showMessage('❌ Failed to add target', 'error');
  } else {
    // Refresh only that user’s target list
    const users = await fetchJSON('/users');
    const confs = await fetchJSON('/conferences');
    await loadUserTargets(userId, users, confs);
  }
};

// Called by each 🗑️ in the target list
window.removeTarget = async function(userId, type, tid) {
  const res = await fetch(
      `/users/${userId}/targets/${type}/${tid}`, { method: 'DELETE' }
  );
  if (!res.ok) {
    showMessage('❌ Failed to remove target', 'error');
  } else {
    const users = await fetchJSON('/users');
    const confs = await fetchJSON('/conferences');
    await loadUserTargets(userId, users, confs);
  }
};


window.editUser = async function (userId, currentName) {
  const newName = prompt('New username:', currentName);
  if (!newName || newName === currentName) return;

  const res = await fetch(`/users/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName })
  });

  if (res.ok) {
    showMessage('✅ User updated', 'success');
    loadData();
  } else {
    showMessage('❌ Failed to update user', 'error');
  }
};

window.toggleUserConfs = async function (userId, toggleBtn) {
  const targetDiv = document.getElementById(`user-nested-${userId}`);
  const confUl    = document.getElementById(`user-confs-${userId}`);
  const button    = toggleBtn || document.getElementById(`user-toggle-${userId}`);
  const willOpen  = !targetDiv.classList.contains('is-open');

  if (willOpen) {
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
  } else {
    targetDiv.classList.remove('is-open');
  }

  if (button) {
    button.setAttribute('aria-expanded', willOpen);
    button.textContent = willOpen ? 'Hide details' : 'Show details';
  }
};


// === Konferenzen umbenennen ===
window.editConference = async function(confId, currentName) {
  const newName = prompt('New conference name:', currentName);
  if (!newName || newName === currentName) return;

  try {
    const res = await fetch(`/conferences/${confId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });

    if (res.status === 409) {
      showMessage('⚠️ Conference name already exists!');
    } else if (res.ok) {
      showMessage('✅ Conference updated', 'success');
      loadData();
    } else {
      showMessage('❌ Failed to update conference', 'error');
    }
  } catch (err) {
    console.error('Error updating conference:', err);
    showMessage('❌ Error updating conference: ' + err.message, 'error');
  }
};


window.toggleConfUsers = async function (confId, toggleBtn) {
  const nested   = document.getElementById(`conf-controls-${confId}`);
  const usersUl  = document.getElementById(`conf-users-${confId}`);
  const button   = toggleBtn || document.getElementById(`conf-toggle-${confId}`);
  const willOpen = !nested.classList.contains('is-open');

  if (willOpen) {
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
    const res = await fetch(`/conferences/${confId}/users/${userId}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      showMessage('✅ User removed from conference', 'success');
      loadData();
    } else if (res.status === 404) {
      showMessage('⚠️ Relationship not found', 'warning');
    } else {
      showMessage('❌ Failed to remove user', 'error');
    }
  } catch (err) {
    showMessage('❌ Unexpected error: ' + err.message, 'error');
    console.error(err);
  }
};
window.deleteUser = async function (userId) {
  if (!confirm('Are you sure you want to delete this user?')) return;
  try {
    const res = await fetch(`/users/${userId}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      showMessage('✅ User deleted', 'success');
      loadData();
    } else {
      showMessage('❌ Failed to delete user', 'error');
    }
  } catch (err) {
    showMessage('❌ Error deleting user: ' + err.message, 'error');
    console.error(err);
  }
};

window.deleteConference = async function (confId) {
  if (!confirm('Are you sure you want to delete this conference?')) return;
  try {
    const res = await fetch(`/conferences/${confId}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      showMessage('✅ Conference deleted', 'success');
      loadData();
    } else {
      showMessage('❌ Failed to delete conference', 'error');
    }
  } catch (err) {
    showMessage('❌ Error deleting conference: ' + err.message, 'error');
    console.error(err);
  }
};


document.getElementById('user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  const res = await fetch('/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password })
  });

  if (res.status === 409) {
    showMessage('⚠️ Username already exists!', 'warning');
  } else if (res.ok) {
    showMessage('✅ User created', 'success');
    loadData();
  } else {
    showMessage('❌ Failed to create user', 'error');
  }
});

document.getElementById('conf-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('confname').value;

  const res = await fetch('/conferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });

  if (res.status === 409) {
    showMessage('⚠️ Conference already exists!', 'warning');
  } else if (res.ok) {
    showMessage('✅ Conference created', 'success');
    loadData();
  } else {
    showMessage('❌ Failed to create conference', 'error');
  }
});


// Called by the "Add to Conf" button inside each user's block
window.assignUserToConference = async function(userId) {
  const sel = document.getElementById(`add-user-conf-${userId}`);
  const confId = sel.value;
  const res = await fetch(`/conferences/${confId}/users/${userId}`, {
    method: 'POST'
  });
  if (res.ok) {
    showMessage('✅ User assigned to conference', 'success');
    const container = document.getElementById(`user-nested-${userId}`);
    if (container?.classList.contains('is-open')) {
      await toggleUserConfs(userId);
      await toggleUserConfs(userId);
    }
  } else {
    showMessage('❌ Failed to assign user to conference', 'error');
  }
};

window.resetPassword = async function(userId, userName) {
  const label = userName ?? 'this user';
  const newPassword = prompt(`Enter a new password for ${label}:`);
  if (!newPassword) return;
  if (newPassword.length < 4) {
    showMessage('⚠️ Password should be at least 4 characters', 'warning');
    return;
  }

  try {
    const res = await fetch(`/users/${userId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword })
    });

    if (res.ok) {
      showMessage(`✅ Password updated for ${label}`, 'success');
    } else {
      const payload = await res.json().catch(() => ({}));
      showMessage(payload.error ? `❌ ${payload.error}` : '❌ Failed to reset password', 'error');
    }
  } catch (err) {
    showMessage('❌ Error resetting password: ' + err.message, 'error');
  }
};

loadData();
