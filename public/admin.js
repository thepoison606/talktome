function showMessage(text, color = 'red') {
  const el = document.getElementById('message');
  el.textContent = text;
  el.style.color = color;
  setTimeout(() => {
    el.textContent = '';
  }, 5000);
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


// 3) Iterate Users
  for (const user of users) {
    const li = document.createElement('li');
    li.innerHTML = `
    <span style="cursor:pointer;" onclick="toggleUserConfs(${user.id}, this)">▶</span>
    ${user.name} (id: ${user.id})
    <button class="small" onclick="editUser(${user.id}, '${user.name}')">Edit</button>
    <button class="small" onclick="deleteUser(${user.id})">🗑️</button>

    <!-- Combined collapsible container -->
    <div class="nested" id="user-nested-${user.id}">
      <strong>Part of Conferences</strong>
      <ul id="user-confs-${user.id}"></ul>

      <!-- NEW: Add user→conference UI -->
      <div style="margin-top:1em;">
        <select id="add-user-conf-${user.id}">
          ${conferences.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
        </select>
        <button class="small" onclick="assignUserToConference(${user.id})">➕ Add User to Conference</button>
      </div>

      <!-- Force a line-break before Target Buttons -->
      <div style="margin-top:1em;">
        <strong>Target Buttons</strong><br/>
        <ul id="user-targets-${user.id}"></ul>

        <!-- Add target-button UI -->
        <select id="add-target-type-${user.id}">
          <option value="user">User</option>
          <option value="conference">Conference</option>
        </select>
        <select id="add-target-id-${user.id}"></select>
        <button class="small" onclick="addTarget(${user.id})">➕ Add Target Button</button>
      </div>
    </div>
  `;
    userList.appendChild(li);

    await loadUserTargets(user.id, users, conferences);
  }


  // 4) Conferences iterieren
  for (const conf of conferences) {
    const li = document.createElement('li');
    li.innerHTML = `
    <span style="cursor:pointer;" onclick="toggleConfUsers(${conf.id}, this)">▶</span>
    ${conf.name} (id: ${conf.id})
    <button class="small"
            onclick="editConference(${conf.id}, '${conf.name.replace(/'/g, "\\'")}')">
      Edit
    </button>
    <button class="small"
            onclick="deleteConference(${conf.id})">
      🗑️
    </button>
    <ul class="nested" id="conf-users-${conf.id}"></ul>
  `;
    confList.appendChild(li);
  }
}

// Fetch and render targets + rebuild the “type → id” dropdown
async function loadUserTargets(userId, allUsers, allConfs) {
  const targets = await fetchJSON(`/users/${userId}/targets`);
  const ul = document.getElementById(`user-targets-${userId}`);
  ul.innerHTML = targets.map(t =>
      `<li>
       ${t.name} (${t.targetType})
       <button class="small"
               onclick="removeTarget(${userId}, '${t.targetType}', '${t.targetId}')">
         🗑️
       </button>
     </li>`
  ).join('');

  const selType = document.getElementById(`add-target-type-${userId}`);
  const selId   = document.getElementById(`add-target-id-${userId}`);
  const list    = selType.value === 'user' ? allUsers : allConfs;

  selId.innerHTML = list.map(item =>
      `<option value="${item.id}">${item.name}</option>`
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
    showMessage('❌ Failed to add target');
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
    showMessage('❌ Failed to remove target');
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
    showMessage('✅ User updated', 'green');
    loadData();
  } else {
    showMessage('❌ Failed to update user');
  }
};

window.toggleUserConfs = async function (userId, arrowEl) {
  const targetDiv = document.getElementById(`user-nested-${userId}`);
  const confUl    = document.getElementById(`user-confs-${userId}`);
  // prüfen, ob wir gerade offen sind
  const isOpen    = targetDiv.style.display === 'block';

  if (isOpen) {
    // ─── Schließen ────────────────────────────────────────────
    targetDiv.style.display = 'none';
    arrowEl.textContent     = '▶';
  } else {
    // ─── Öffnen ────────────────────────────────────────────────
    // 1) Inhalte nachladen
    const confs = await fetchJSON(`/users/${userId}/conferences`);
    confUl.innerHTML = confs.map(c => `
      <li>
        ${c.name}
        <button class="small" onclick="confirmUnassign(${userId}, ${c.id})">
          Remove
        </button>
      </li>
    `).join('');

    // 2) Anzeigen & Pfeil umdrehen
    targetDiv.style.display = 'block';
    arrowEl.textContent     = '▼';
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
      showMessage('✅ Conference updated', 'green');
      loadData();
    } else {
      showMessage('❌ Failed to update conference');
    }
  } catch (err) {
    console.error('Error updating conference:', err);
    showMessage('❌ Error updating conference: ' + err.message);
  }
};


window.toggleConfUsers = async function (confId, arrowEl) {
  const ul = document.getElementById(`conf-users-${confId}`);

  if (ul.innerHTML !== '') {
    // hide the list again
    ul.innerHTML = '';
    ul.style.display = 'none';
    arrowEl.textContent = '▶';
    return;
  }

  // fetch and render
  const users = await fetchJSON(`/conferences/${confId}/users`);
  ul.innerHTML = users.map(u =>
      `<li>
       ${u.name}
       <button class="small" onclick="confirmUnassign(${u.id}, ${confId})">Remove</button>
     </li>`
  ).join('');

  // make it visible
  ul.style.display = 'block';
  arrowEl.textContent = '▼';
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
      showMessage('✅ User removed from conference', 'green');
      loadData();
    } else if (res.status === 404) {
      showMessage('⚠️ Relationship not found');
    } else {
      showMessage('❌ Failed to remove user');
    }
  } catch (err) {
    showMessage('❌ Unexpected error: ' + err.message);
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
      showMessage('✅ User deleted', 'green');
      loadData();
    } else {
      showMessage('❌ Failed to delete user');
    }
  } catch (err) {
    showMessage('❌ Error deleting user: ' + err.message);
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
      showMessage('✅ Conference deleted', 'green');
      loadData();
    } else {
      showMessage('❌ Failed to delete conference');
    }
  } catch (err) {
    showMessage('❌ Error deleting conference: ' + err.message);
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
    showMessage('⚠️ Username already exists!');
  } else if (res.ok) {
    showMessage('✅ User created', 'green');
    loadData();
  } else {
    showMessage('❌ Failed to create user');
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
    showMessage('⚠️ Conference already exists!');
  } else if (res.ok) {
    showMessage('✅ Conference created', 'green');
    loadData();
  } else {
    showMessage('❌ Failed to create conference');
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
    showMessage('✅ User assigned to conference', 'green');
    // If the conferences list is already open, refresh it:
    const confUl = document.getElementById(`user-confs-${userId}`);
    if (confUl && confUl.innerHTML !== '') {
      // re-open to refresh
      await toggleUserConfs(userId, document.querySelector(`#user-nested-${userId}`).previousElementSibling);
    }
  } else {
    showMessage('❌ Failed to assign user to conference');
  }
};


loadData();
