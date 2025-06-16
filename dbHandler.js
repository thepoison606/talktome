const db = require('./db');
const bcrypt = require('bcrypt');

function getAllUsers() {
  return db.prepare('SELECT id, name FROM users').all();
}

function getAllConferences() {
  return db.prepare('SELECT id, name FROM conferences').all();
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

function checkUserPassword(name, plainPassword) {
  const stmt = db.prepare('SELECT password FROM users WHERE name = ?');
  const user = stmt.get(name);
  if (!user) return false;

  return bcrypt.compareSync(plainPassword, user.password);
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

function deleteUser(userId) {
  db.prepare('DELETE FROM user_conference WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

function deleteConference(confId) {
  db.prepare('DELETE FROM user_conference WHERE conference_id = ?').run(confId);
  db.prepare('DELETE FROM conferences WHERE id = ?').run(confId);
}


module.exports = {
  getAllUsers,
  getAllConferences,
  createUser,
  createConference,
  addUserToConference,
  getUsersForConference,
  getConferencesForUser,
  removeUserFromConference,
  updateUserName,
  deleteUser,
  deleteConference,
  checkUserPassword,
  verifyUser,
};