const db = require('./db');
const bcrypt = require('bcryptjs');

const ALL_CONFERENCE_NAME = 'All';

function getAllUsers() {
  return db.prepare('SELECT id, name FROM users').all();
}

function getAllConferences() {
  return db.prepare('SELECT id, name FROM conferences').all();
}

function getAllFeeds() {
  return db.prepare('SELECT id, name FROM feeds ORDER BY name COLLATE NOCASE').all();
}

function createUser(name, password) {
  try {
    const hash = bcrypt.hashSync(password, 10);
    const stmt = db.prepare('INSERT INTO users (name, password) VALUES (?, ?)');
    const result = stmt.run(name, hash);
    const userId = result.lastInsertRowid;
    const allConference = db.prepare('SELECT id FROM conferences WHERE name = ?').get(ALL_CONFERENCE_NAME);
    if (allConference) {
      addUserToConference(userId, allConference.id);
      addUserTargetToConference(userId, allConference.id);
    }
    return userId;
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
      JOIN users u ON u.id = ut.target_user
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

  const allId = row.id;
  db.prepare('INSERT OR IGNORE INTO user_conference (user_id, conference_id) SELECT id, ? FROM users').run(allId);
  db.prepare('INSERT OR IGNORE INTO user_conf_targets (user_id, target_conf) SELECT id, ? FROM users').run(allId);
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

ensureAllConference();



module.exports = {
  getAllUsers,
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
  updateFeedName,
  updateFeedPassword,
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
  getUsersForFeed
};
