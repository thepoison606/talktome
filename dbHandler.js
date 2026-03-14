const db = require('./db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const ALL_CONFERENCE_NAME = 'All';

function getAllUsers() {
  return db.prepare('SELECT id, name, is_admin, is_superadmin FROM users ORDER BY name COLLATE NOCASE').all();
}

function getUserById(id) {
  return db.prepare('SELECT id, name, is_admin, is_superadmin, admin_must_change FROM users WHERE id = ?').get(id);
}

function getAllConferences() {
  return db.prepare('SELECT id, name FROM conferences').all();
}

function getAllFeeds() {
  return db.prepare('SELECT id, name FROM feeds ORDER BY name COLLATE NOCASE').all();
}

function exportDatabaseSnapshot() {
  return {
    users: db.prepare(`
      SELECT id, name, password, is_admin, is_superadmin, admin_must_change
      FROM users
      ORDER BY id
    `).all(),
    conferences: db.prepare(`
      SELECT id, name
      FROM conferences
      ORDER BY id
    `).all(),
    feeds: db.prepare(`
      SELECT id, name, password
      FROM feeds
      ORDER BY id
    `).all(),
    userConference: db.prepare(`
      SELECT user_id, conference_id
      FROM user_conference
      ORDER BY user_id, conference_id
    `).all(),
    userUserTargets: db.prepare(`
      SELECT user_id, target_user
      FROM user_user_targets
      ORDER BY user_id, target_user
    `).all(),
    userConfTargets: db.prepare(`
      SELECT user_id, target_conf
      FROM user_conf_targets
      ORDER BY user_id, target_conf
    `).all(),
    userFeedTargets: db.prepare(`
      SELECT user_id, feed_id
      FROM user_feed_targets
      ORDER BY user_id, feed_id
    `).all(),
    userTargetOrder: db.prepare(`
      SELECT user_id, target_type, target_id, position
      FROM user_target_order
      ORDER BY user_id, position, target_type, target_id
    `).all(),
    applePttChannels: db.prepare(`
      SELECT user_id, channel_uuid, channel_name, updated_at
      FROM apple_ptt_channels
      ORDER BY user_id
    `).all(),
    applePttRegistrations: db.prepare(`
      SELECT user_id, channel_uuid, push_token, created_at, updated_at
      FROM apple_ptt_registrations
      ORDER BY user_id, channel_uuid, push_token
    `).all(),
  };
}

function importDatabaseSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Invalid database snapshot');
  }

  const users = Array.isArray(snapshot.users) ? snapshot.users : null;
  const conferences = Array.isArray(snapshot.conferences) ? snapshot.conferences : null;
  const feeds = Array.isArray(snapshot.feeds) ? snapshot.feeds : null;
  const userConference = Array.isArray(snapshot.userConference) ? snapshot.userConference : [];
  const userUserTargets = Array.isArray(snapshot.userUserTargets) ? snapshot.userUserTargets : [];
  const userConfTargets = Array.isArray(snapshot.userConfTargets) ? snapshot.userConfTargets : [];
  const userFeedTargets = Array.isArray(snapshot.userFeedTargets) ? snapshot.userFeedTargets : [];
  const userTargetOrder = Array.isArray(snapshot.userTargetOrder) ? snapshot.userTargetOrder : [];
  const applePttChannels = Array.isArray(snapshot.applePttChannels) ? snapshot.applePttChannels : [];
  const applePttRegistrations = Array.isArray(snapshot.applePttRegistrations) ? snapshot.applePttRegistrations : [];

  if (!users || !conferences || !feeds) {
    throw new Error('Snapshot is missing required collections');
  }

  const restore = db.transaction(() => {
    db.prepare('DELETE FROM user_target_order').run();
    db.prepare('DELETE FROM apple_ptt_registrations').run();
    db.prepare('DELETE FROM apple_ptt_channels').run();
    db.prepare('DELETE FROM user_user_targets').run();
    db.prepare('DELETE FROM user_conf_targets').run();
    db.prepare('DELETE FROM user_feed_targets').run();
    db.prepare('DELETE FROM user_conference').run();
    db.prepare('DELETE FROM feeds').run();
    db.prepare('DELETE FROM conferences').run();
    db.prepare('DELETE FROM users').run();

    try {
      db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('users', 'conferences', 'feeds')").run();
    } catch (err) {
      // sqlite_sequence may not exist yet; safe to ignore
    }

    const insertUser = db.prepare(`
      INSERT INTO users (id, name, password, is_admin, is_superadmin, admin_must_change)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertConference = db.prepare(`
      INSERT INTO conferences (id, name)
      VALUES (?, ?)
    `);
    const insertFeed = db.prepare(`
      INSERT INTO feeds (id, name, password)
      VALUES (?, ?, ?)
    `);
    const insertMembership = db.prepare(`
      INSERT INTO user_conference (user_id, conference_id)
      VALUES (?, ?)
    `);
    const insertUserTarget = db.prepare(`
      INSERT INTO user_user_targets (user_id, target_user)
      VALUES (?, ?)
    `);
    const insertConfTarget = db.prepare(`
      INSERT INTO user_conf_targets (user_id, target_conf)
      VALUES (?, ?)
    `);
    const insertFeedTarget = db.prepare(`
      INSERT INTO user_feed_targets (user_id, feed_id)
      VALUES (?, ?)
    `);
    const insertTargetOrder = db.prepare(`
      INSERT INTO user_target_order (user_id, target_type, target_id, position)
      VALUES (?, ?, ?, ?)
    `);
    const insertApplePttChannel = db.prepare(`
      INSERT INTO apple_ptt_channels (user_id, channel_uuid, channel_name, updated_at)
      VALUES (?, ?, ?, ?)
    `);
    const insertApplePttRegistration = db.prepare(`
      INSERT INTO apple_ptt_registrations (user_id, channel_uuid, push_token, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    users.forEach((row) => {
      insertUser.run(
        Number(row.id),
        String(row.name),
        String(row.password),
        row.is_admin ? 1 : 0,
        row.is_superadmin ? 1 : 0,
        row.admin_must_change ? 1 : 0
      );
    });

    conferences.forEach((row) => {
      insertConference.run(Number(row.id), String(row.name));
    });

    feeds.forEach((row) => {
      insertFeed.run(Number(row.id), String(row.name), String(row.password));
    });

    userConference.forEach((row) => {
      insertMembership.run(Number(row.user_id), Number(row.conference_id));
    });

    userUserTargets.forEach((row) => {
      insertUserTarget.run(Number(row.user_id), Number(row.target_user));
    });

    userConfTargets.forEach((row) => {
      insertConfTarget.run(Number(row.user_id), Number(row.target_conf));
    });

    userFeedTargets.forEach((row) => {
      insertFeedTarget.run(Number(row.user_id), Number(row.feed_id));
    });

    userTargetOrder.forEach((row) => {
      insertTargetOrder.run(
        Number(row.user_id),
        String(row.target_type),
        Number(row.target_id),
        Number(row.position)
      );
    });

    applePttChannels.forEach((row) => {
      insertApplePttChannel.run(
        Number(row.user_id),
        String(row.channel_uuid),
        String(row.channel_name),
        String(row.updated_at)
      );
    });

    applePttRegistrations.forEach((row) => {
      insertApplePttRegistration.run(
        Number(row.user_id),
        String(row.channel_uuid),
        String(row.push_token),
        String(row.created_at),
        String(row.updated_at)
      );
    });

    ensureAllConference();
    ensureDefaultAdmin();
  });

  restore();
}

function createUser(name, password) {
  try {
    const hash = bcrypt.hashSync(password, 10);
    const stmt = db.prepare('INSERT INTO users (name, password) VALUES (?, ?)');
    const result = stmt.run(name, hash);
    return result.lastInsertRowid;
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error('Username already exists');
    }
    throw err;
  }
}

function createConference(name) {
  try {
    const stmt = db.prepare('INSERT INTO conferences (name) VALUES (?)');
    return stmt.run(name).lastInsertRowid;
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error('Conference name already exists');
    }
    throw err;
  }
}

function createFeed(name, password) {
  try {
    const hash = bcrypt.hashSync(password, 10);
    const stmt = db.prepare('INSERT INTO feeds (name, password) VALUES (?, ?)');
    return stmt.run(name, hash).lastInsertRowid;
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error('Feed name already exists');
    }
    throw err;
  }
}

function addUserToConference(userId, conferenceId) {
  const stmt = db.prepare('INSERT OR IGNORE INTO user_conference (user_id, conference_id) VALUES (?, ?)');
  stmt.run(userId, conferenceId);
}

function getUsersForConference(conferenceId) {
  const stmt = db.prepare(`
    SELECT users.id, users.name FROM users
    JOIN user_conference ON users.id = user_conference.user_id
    WHERE user_conference.conference_id = ?
      AND users.is_superadmin = 0
  `);
  return stmt.all(conferenceId);
}

function getUserByName(name) {
  const stmt = db.prepare('SELECT * FROM users WHERE name = ?');
  return stmt.get(name);
}

function verifyUser(name, plainPassword) {
  const user = getUserByName(name);
  if (!user) return null;
  const isValid = bcrypt.compareSync(plainPassword, user.password);
  return isValid ? user : null;
}

function getFeedByName(name) {
  return db.prepare('SELECT * FROM feeds WHERE name = ?').get(name);
}

function verifyFeed(name, plainPassword) {
  const feed = getFeedByName(name);
  if (!feed) return null;
  const isValid = bcrypt.compareSync(plainPassword, feed.password);
  if (!isValid) return null;
  return { id: feed.id, name: feed.name };
}

function getConferencesForUser(userId) {
  const stmt = db.prepare(`
    SELECT conferences.id, conferences.name FROM conferences
    JOIN user_conference ON conferences.id = user_conference.conference_id
    WHERE user_conference.user_id = ?
  `);
  return stmt.all(userId);
}

function removeUserFromConference(userId, conferenceId) {
  const stmt = db.prepare(`
    DELETE FROM user_conference
    WHERE user_id = ? AND conference_id = ?
  `);
  stmt.run(userId, conferenceId);
}

function updateUserName(id, name) {
  const stmt = db.prepare('UPDATE users SET name = ? WHERE id = ?');
  const result = stmt.run(name, id);
  return result.changes > 0;
}

function updateConferenceName(id, name) {
  const stmt = db.prepare('UPDATE conferences SET name = ? WHERE id = ?');
  const result = stmt.run(name, id);
  return result.changes > 0;
}

function updateUserPassword(id, password) {
  const hash = bcrypt.hashSync(password, 10);
  const stmt = db.prepare('UPDATE users SET password = ? WHERE id = ?');
  const result = stmt.run(hash, id);
  return result.changes > 0;
}

function updateAdminPassword(id, password) {
  const hash = bcrypt.hashSync(password, 10);
  const stmt = db.prepare('UPDATE users SET password = ?, admin_must_change = 0 WHERE id = ?');
  const result = stmt.run(hash, id);
  return result.changes > 0;
}

function setUserAdminRole(id, isAdmin) {
  const stmt = db.prepare('UPDATE users SET is_admin = ? WHERE id = ?');
  const result = stmt.run(isAdmin ? 1 : 0, id);
  return result.changes > 0;
}

function setUserSuperAdmin(id, isSuperAdmin) {
  const stmt = db.prepare('UPDATE users SET is_superadmin = ? WHERE id = ?');
  const result = stmt.run(isSuperAdmin ? 1 : 0, id);
  return result.changes > 0;
}

function setAdminMustChange(id, mustChange) {
  const stmt = db.prepare('UPDATE users SET admin_must_change = ? WHERE id = ?');
  const result = stmt.run(mustChange ? 1 : 0, id);
  return result.changes > 0;
}

function updateFeedName(id, name) {
  const stmt = db.prepare('UPDATE feeds SET name = ? WHERE id = ?');
  const result = stmt.run(name, id);
  return result.changes > 0;
}

function updateFeedPassword(id, password) {
  const hash = bcrypt.hashSync(password, 10);
  const stmt = db.prepare('UPDATE feeds SET password = ? WHERE id = ?');
  const result = stmt.run(hash, id);
  return result.changes > 0;
}

function deleteUser(userId) {
  db.prepare('DELETE FROM user_feed_targets WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_target_order WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_conference WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

function deleteConference(confId) {
  db.prepare('DELETE FROM user_conference WHERE conference_id = ?').run(confId);
  db.prepare('DELETE FROM conferences WHERE id = ?').run(confId);
}

function deleteFeed(feedId) {
  const tx = db.transaction(id => {
    db.prepare('DELETE FROM user_feed_targets WHERE feed_id = ?').run(id);
    db.prepare("DELETE FROM user_target_order WHERE target_type = 'feed' AND target_id = ?").run(id);
    db.prepare('DELETE FROM feeds WHERE id = ?').run(id);
  });
  tx(feedId);
}

// Returns every target a user is allowed to see, including resolved names
function getUserTargets(userId) {
  return db.prepare(`
    SELECT targetType, targetId, name
    FROM (
      SELECT
        'user' AS targetType,
        ut.target_user AS targetId,
        u.name AS name,
        o.position AS position,
        ut.rowid AS fallback
      FROM user_user_targets ut
      JOIN users u ON u.id = ut.target_user AND u.is_superadmin = 0
      LEFT JOIN user_target_order o
        ON o.user_id = ut.user_id
       AND o.target_type = 'user'
       AND o.target_id = ut.target_user
      WHERE ut.user_id = ?

      UNION ALL

      SELECT
        'conference' AS targetType,
        ct.target_conf AS targetId,
        c.name AS name,
        o.position AS position,
        ct.rowid AS fallback
      FROM user_conf_targets ct
      JOIN conferences c ON c.id = ct.target_conf
      LEFT JOIN user_target_order o
        ON o.user_id = ct.user_id
       AND o.target_type = 'conference'
       AND o.target_id = ct.target_conf
      WHERE ct.user_id = ?

      UNION ALL

      SELECT
        'feed' AS targetType,
        ft.feed_id AS targetId,
        f.name AS name,
        o.position AS position,
        ft.rowid AS fallback
      FROM user_feed_targets ft
      JOIN feeds f ON f.id = ft.feed_id
      LEFT JOIN user_target_order o
        ON o.user_id = ft.user_id
       AND o.target_type = 'feed'
       AND o.target_id = ft.feed_id
      WHERE ft.user_id = ?

    )
    ORDER BY COALESCE(position, fallback)
  `).all(userId, userId, userId);
}


function addUserTargetToUser(userId, targetUserId) {
  const targetUser = getUserById(targetUserId);
  if (!targetUser) {
    throw new Error('Target user not found');
  }
  if (targetUser.is_superadmin) {
    throw new Error('Superadmin users cannot be targets');
  }

  db.prepare(`
    INSERT OR IGNORE INTO user_user_targets (user_id, target_user)
    VALUES (?, ?)
  `).run(userId, targetUserId);
  appendTargetOrder(userId, 'user', targetUserId);
}

function addUserTargetToConference(userId, targetConfId) {
  db.prepare(`
    INSERT OR IGNORE INTO user_conf_targets (user_id, target_conf)
    VALUES (?, ?)
  `).run(userId, targetConfId);
  appendTargetOrder(userId, 'conference', targetConfId);
}

function addUserTargetToFeed(userId, feedId) {
  db.prepare(`
    INSERT OR IGNORE INTO user_feed_targets (user_id, feed_id)
    VALUES (?, ?)
  `).run(userId, feedId);
  appendTargetOrder(userId, 'feed', feedId);
}


function removeUserTarget(userId, type, targetId) {
  if (type === "user") {
    removeUserUserTarget(userId, targetId);
  } else if (type === "conference") {
    removeUserConfTarget(userId, targetId);
  } else if (type === 'feed') {
    removeUserFeedTarget(userId, targetId);
  } else {
    throw new Error(`Unsupported target type: ${type}`);
  }
  removeTargetOrder(userId, type, targetId);
}

// Remove a user target (user → user)
function removeUserUserTarget(userId, targetUserId) {
  db.prepare(`
    DELETE FROM user_user_targets
    WHERE user_id    = ?
      AND target_user = ?
  `).run(userId, targetUserId);
}

// Remove a conference target (user → conference)
function removeUserConfTarget(userId, targetConfId) {
  db.prepare(`
    DELETE FROM user_conf_targets
    WHERE user_id     = ?
      AND target_conf = ?
  `).run(userId, targetConfId);
}

function removeUserFeedTarget(userId, feedId) {
  db.prepare(`
    DELETE FROM user_feed_targets
    WHERE user_id = ?
      AND feed_id  = ?
  `).run(userId, feedId);
}


function appendTargetOrder(userId, targetType, targetId) {
  const uid = Number(userId);
  const max = db.prepare(`
    SELECT COALESCE(MAX(position), -1) AS maxPos
    FROM user_target_order
    WHERE user_id = ?
  `).get(uid).maxPos;

  db.prepare(`
    INSERT OR REPLACE INTO user_target_order (user_id, target_type, target_id, position)
    VALUES (?, ?, ?, ?)
  `).run(uid, targetType, Number(targetId), max + 1);
}

function removeTargetOrder(userId, targetType, targetId) {
  db.prepare(`
    DELETE FROM user_target_order
    WHERE user_id = ? AND target_type = ? AND target_id = ?
  `).run(Number(userId), targetType, Number(targetId));
}

const updateTargetOrderStmt = db.prepare(`
  INSERT OR REPLACE INTO user_target_order (user_id, target_type, target_id, position)
  VALUES (?, ?, ?, ?)
`);

const clearTargetOrderStmt = db.prepare(`
  DELETE FROM user_target_order WHERE user_id = ?
`);

const updateUserTargetOrder = db.transaction((userId, items) => {
  const uid = Number(userId);
  clearTargetOrderStmt.run(uid);
  items.forEach((item, index) => {
    updateTargetOrderStmt.run(uid, item.targetType, Number(item.targetId), index);
  });
});

function ensureAllConference() {
  let row = db.prepare('SELECT id FROM conferences WHERE name = ?').get(ALL_CONFERENCE_NAME);
  if (!row) {
    const insert = db.prepare('INSERT INTO conferences (name) VALUES (?)');
    const result = insert.run(ALL_CONFERENCE_NAME);
    row = { id: result.lastInsertRowid };
  }

  db.prepare("DELETE FROM user_target_order WHERE target_type = 'global'").run();
}

function getAllConferenceId() {
  const row = db.prepare('SELECT id FROM conferences WHERE name = ?').get(ALL_CONFERENCE_NAME);
  return row?.id ?? null;
}

function getFeedIdsForUser(userId) {
  return db.prepare('SELECT feed_id FROM user_feed_targets WHERE user_id = ?').all(userId).map(row => row.feed_id);
}

function getUsersForFeed(feedId) {
  return db.prepare('SELECT user_id FROM user_feed_targets WHERE feed_id = ?').all(feedId);
}

function getOrCreateApplePttChannelForUser(userId, channelName = 'TalkToMe') {
  const existing = db.prepare(`
    SELECT user_id, channel_uuid, channel_name
    FROM apple_ptt_channels
    WHERE user_id = ?
  `).get(userId);

  const normalizedName = String(channelName || 'TalkToMe').trim() || 'TalkToMe';
  const now = new Date().toISOString();

  if (existing) {
    if (existing.channel_name !== normalizedName) {
      db.prepare(`
        UPDATE apple_ptt_channels
        SET channel_name = ?, updated_at = ?
        WHERE user_id = ?
      `).run(normalizedName, now, userId);
      existing.channel_name = normalizedName;
    }
    return existing;
  }

  const channelUUID = crypto.randomUUID();
  db.prepare(`
    INSERT INTO apple_ptt_channels (user_id, channel_uuid, channel_name, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, channelUUID, normalizedName, now);

  return {
    user_id: userId,
    channel_uuid: channelUUID,
    channel_name: normalizedName,
  };
}

function registerApplePttPushToken(userId, channelUUID, pushToken) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO apple_ptt_registrations (user_id, channel_uuid, push_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(push_token) DO UPDATE SET
      user_id = excluded.user_id,
      channel_uuid = excluded.channel_uuid,
      updated_at = excluded.updated_at
  `).run(userId, channelUUID, pushToken, now, now);
}

function unregisterApplePttPushToken(userId, channelUUID) {
  db.prepare(`
    DELETE FROM apple_ptt_registrations
    WHERE user_id = ? AND channel_uuid = ?
  `).run(userId, channelUUID);
}

function getApplePttRegistrationsForUsers(userIds, channelUUID = null) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return [];
  }

  const placeholders = userIds.map(() => '?').join(', ');
  const params = [...userIds];
  let sql = `
    SELECT user_id, channel_uuid, push_token
    FROM apple_ptt_registrations
    WHERE user_id IN (${placeholders})
  `;

  if (channelUUID) {
    sql += ' AND channel_uuid = ?';
    params.push(channelUUID);
  }

  return db.prepare(sql).all(...params);
}

function ensureDefaultAdmin() {
  const existingAdmin = db.prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1').get();
  if (existingAdmin) return existingAdmin.id;

  const existingUser = db.prepare('SELECT id FROM users WHERE name = ?').get('admin');
  if (existingUser) {
    db.prepare('UPDATE users SET is_admin = 1, is_superadmin = 1, admin_must_change = 1 WHERE id = ?')
      .run(existingUser.id);
    return existingUser.id;
  }

  const hash = bcrypt.hashSync('admin', 10);
  const stmt = db.prepare(`
    INSERT INTO users (name, password, is_admin, is_superadmin, admin_must_change)
    VALUES (?, ?, 1, 1, 1)
  `);
  const result = stmt.run('admin', hash);
  const userId = result.lastInsertRowid;
  const allConference = db.prepare('SELECT id FROM conferences WHERE name = ?').get(ALL_CONFERENCE_NAME);
  if (allConference) {
    addUserToConference(userId, allConference.id);
    addUserTargetToConference(userId, allConference.id);
  }
  return userId;
}

ensureAllConference();
ensureDefaultAdmin();



module.exports = {
  getAllUsers,
  getUserById,
  getAllConferences,
  getAllFeeds,
  createUser,
  createConference,
  createFeed,
  addUserToConference,
  getUsersForConference,
  getConferencesForUser,
  removeUserFromConference,
  updateUserName,
  updateConferenceName,
  updateUserPassword,
  updateAdminPassword,
  updateFeedName,
  updateFeedPassword,
  setUserAdminRole,
  setUserSuperAdmin,
  setAdminMustChange,
  deleteUser,
  deleteConference,
  deleteFeed,
  verifyUser,
  verifyFeed,
  getUserTargets,
  addUserTargetToUser,
  addUserTargetToConference,
  addUserTargetToFeed,
  removeUserTarget,
  updateUserTargetOrder,
  getAllConferenceId,
  getFeedIdsForUser,
  getUsersForFeed,
  getOrCreateApplePttChannelForUser,
  registerApplePttPushToken,
  unregisterApplePttPushToken,
  getApplePttRegistrationsForUsers,
  ensureDefaultAdmin,
  exportDatabaseSnapshot,
  importDatabaseSnapshot
};
