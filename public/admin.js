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
  const users = await fetchJSON('/users');
  const conferences = await fetchJSON('/conferences');

  const userList = document.getElementById('user-list');
  const confList = document.getElementById('conf-list');
  const assignUser = document.getElementById('assign-user');
  const assignConf = document.getElementById('assign-conf');

  userList.innerHTML = '';
  confList.innerHTML = '';
  assignUser.innerHTML = '';
  assignConf.innerHTML = '';

  for (const user of users) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span style="cursor:pointer;" onclick="toggleUserConfs(${user.id}, this)">▶</span> 
      ${user.name} (id: ${user.id})
      <button class="small" onclick="editUser(${user.id}, '${user.name}')">Edit</button>
      <button class="small" onclick="deleteUser(${user.id})">🗑️</button>
      <ul class="nested" id="user-confs-${user.id}"></ul>
    `;
    userList.appendChild(li);
    assignUser.innerHTML += `<option value="${user.id}">${user.name}</option>`;
  }

  for (const conf of conferences) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span style="cursor:pointer;" onclick="toggleConfUsers(${conf.id}, this)">▶</span>
      ${conf.name} (id: ${conf.id})
      <button class="small" onclick="deleteConference(${conf.id})">🗑️</button>
      <ul class="nested" id="conf-users-${conf.id}"></ul>
    `;
    confList.appendChild(li);
    assignConf.innerHTML += `<option value="${conf.id}">${conf.name}</option>`;
  }
}

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
  const ul = document.getElementById(`user-confs-${userId}`);
  if (ul.innerHTML !== '') {
    ul.innerHTML = '';
    arrowEl.textContent = '▶';
    return;
  }

  const confs = await fetchJSON(`/users/${userId}/conferences`);
  ul.innerHTML = confs.map(c =>
    `<li>
      ${c.name}
      <button class="small" onclick="confirmUnassign(${userId}, ${c.id})">Remove</button>
    </li>`
  ).join('');
  arrowEl.textContent = '▼';
};

window.toggleConfUsers = async function (confId, arrowEl) {
  const ul = document.getElementById(`conf-users-${confId}`);
  if (ul.innerHTML !== '') {
    ul.innerHTML = '';
    arrowEl.textContent = '▶';
    return;
  }

  const users = await fetchJSON(`/conferences/${confId}/users`);
  ul.innerHTML = users.map(u =>
    `<li>
      ${u.name}
      <button class="small" onclick="confirmUnassign(${u.id}, ${confId})">Remove</button>
    </li>`
  ).join('');
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

document.getElementById('assign-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const userId = document.getElementById('assign-user').value;
  const confId = document.getElementById('assign-conf').value;

  const res = await fetch(`/conferences/${confId}/users/${userId}`, {
    method: 'POST'
  });

  if (res.ok) {
    showMessage('✅ User assigned', 'green');
    loadData();
  } else {
    showMessage('❌ Failed to assign user');
  }
});

loadData();
