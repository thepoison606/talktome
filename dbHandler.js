const db = require('./db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { normalize: normalizeUserAudioSettings } = require('./public/userAudioSettings');

const BRIDGE_ENDPOINT_TEXT_LIMIT = 200;
const BRIDGE_TRIGGER_DEFAULT_THRESHOLD_DB = -45;
const BRIDGE_TRIGGER_MIN_THRESHOLD_DB = -120;
const BRIDGE_TRIGGER_MAX_THRESHOLD_DB = -10;

function hashBrowserSessionToken(token) {
  const normalized = typeof token === 'string' ? token.trim() : '';
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function saveBrowserSession(token, session = {}) {
  const tokenHash = hashBrowserSessionToken(token);
  const kind = session.kind === 'feed' ? 'feed' : session.kind === 'user' ? 'user' : null;
  const identityId = Number(kind === 'user' ? session.userId : session.feedId);
  const createdAt = Number(session.createdAt);
  const expiresAt = Number(session.expiresAt);
  if (!tokenHash || !kind || !Number.isInteger(identityId) || identityId < 1) {
    throw new Error('Invalid browser session identity');
  }
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) {
    throw new Error('Invalid browser session lifetime');
  }

  db.prepare(`
    INSERT INTO browser_sessions
      (token_hash, kind, identity_id, name, source, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(token_hash) DO UPDATE SET
      kind = excluded.kind,
      identity_id = excluded.identity_id,
      name = excluded.name,
      source = excluded.source,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at
  `).run(
    tokenHash,
    kind,
    identityId,
    String(session.name || ''),
    String(session.source || 'password'),
    createdAt,
    expiresAt
  );
}

function getBrowserSessionByToken(token) {
  const tokenHash = hashBrowserSessionToken(token);
  if (!tokenHash) return null;
  const row = db.prepare(`
    SELECT kind, identity_id, name, source, created_at, expires_at
    FROM browser_sessions
    WHERE token_hash = ?
  `).get(tokenHash);
  if (!row) return null;
  return {
    kind: row.kind,
    userId: row.kind === 'user' ? Number(row.identity_id) : undefined,
    feedId: row.kind === 'feed' ? Number(row.identity_id) : undefined,
    name: row.name,
    source: row.source,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
  };
}

function deleteBrowserSession(token) {
  const tokenHash = hashBrowserSessionToken(token);
  if (!tokenHash) return false;
  return db.prepare('DELETE FROM browser_sessions WHERE token_hash = ?')
    .run(tokenHash).changes > 0;
}

function purgeExpiredBrowserSessions(now = Date.now()) {
  return db.prepare('DELETE FROM browser_sessions WHERE expires_at <= ?')
    .run(Number(now)).changes;
}

function normalizeBridgeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, BRIDGE_ENDPOINT_TEXT_LIMIT);
}

function normalizeBridgeChannel(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return number;
}

function validateBridgePair(left, right, label) {
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

function normalizeBridgeTriggerMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return mode === 'audio-level' ? 'audio-level' : 'external';
}

function normalizeBridgeTriggerTargetType(value) {
  const type = String(value || '').trim().toLowerCase();
  return type === 'user' || type === 'conference' ? type : '';
}

function normalizeBridgeTriggerTargetId(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error('Bridge level trigger target id must be a positive integer');
  }
  return number;
}

function normalizeBridgeTriggerThresholdDb(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return BRIDGE_TRIGGER_DEFAULT_THRESHOLD_DB;
  return Math.min(
    BRIDGE_TRIGGER_MAX_THRESHOLD_DB,
    Math.max(BRIDGE_TRIGGER_MIN_THRESHOLD_DB, number)
  );
}

function normalizeBridgeEndpointConfig(config = {}) {
  const enabled = Boolean(config.enabled);
  const bridgeDevice = normalizeBridgeText(config.bridgeDevice);
  const inputDevice = normalizeBridgeText(config.inputDevice);
  const inputLeftChannel = normalizeBridgeChannel(config.inputLeftChannel, 'Input left channel');
  const inputRightChannel = normalizeBridgeChannel(config.inputRightChannel, 'Input right channel');
  const outputDevice = normalizeBridgeText(config.outputDevice);
  const outputLeftChannel = normalizeBridgeChannel(config.outputLeftChannel, 'Output left channel');
  const outputRightChannel = normalizeBridgeChannel(config.outputRightChannel, 'Output right channel');
  const triggerMode = normalizeBridgeTriggerMode(config.triggerMode);
  const triggerTargetType = normalizeBridgeTriggerTargetType(config.triggerTargetType);
  const triggerTargetId = normalizeBridgeTriggerTargetId(config.triggerTargetId);
  const triggerThresholdDb = normalizeBridgeTriggerThresholdDb(config.triggerThresholdDb);
  validateBridgePair(inputLeftChannel, inputRightChannel, 'Input');
  validateBridgePair(outputLeftChannel, outputRightChannel, 'Output');

  if (enabled) {
    if (!bridgeDevice) {
      throw new Error('Bridge device is required when bridge endpoint is enabled');
    }
    validateOptionalBridgeDeviceChannel(inputDevice, inputLeftChannel, 'Input');
    validateOptionalBridgeDeviceChannel(outputDevice, outputLeftChannel, 'Output');
    if (triggerMode === 'audio-level' && (!triggerTargetType || triggerTargetId === null)) {
      throw new Error('Audio level trigger requires a user or conference target');
    }
  }

  return {
    enabled,
    bridgeDevice,
    inputDevice,
    inputLeftChannel,
    inputRightChannel,
    outputDevice,
    outputLeftChannel,
    outputRightChannel,
    triggerMode,
    triggerTargetType,
    triggerTargetId,
    triggerThresholdDb,
  };
}

function normalizeFeedBridgeEndpointConfig(config = {}) {
  const enabled = Boolean(config.enabled);
  const bridgeDevice = normalizeBridgeText(config.bridgeDevice);
  const inputDevice = normalizeBridgeText(config.inputDevice);
  const inputLeftChannel = normalizeBridgeChannel(config.inputLeftChannel, 'Input left channel');
  const inputRightChannel = normalizeBridgeChannel(config.inputRightChannel, 'Input right channel');
  validateBridgePair(inputLeftChannel, inputRightChannel, 'Input');

  if (enabled) {
    if (!bridgeDevice) {
      throw new Error('Bridge device is required when bridge endpoint is enabled');
    }
    validateOptionalBridgeDeviceChannel(inputDevice, inputLeftChannel, 'Input');
  }

  return {
    enabled,
    bridgeDevice,
    inputDevice,
    inputLeftChannel,
    inputRightChannel,
  };
}

function getAllUsers() {
  return db.prepare(`
    SELECT
      users.id,
      users.name,
      users.is_admin,
      users.is_superadmin,
      users.is_guest_profile,
      users.last_online_at,
      COALESCE(user_bridge_endpoints.enabled, 0) AS bridge_enabled,
      COALESCE(user_bridge_endpoints.bridge_device, '') AS bridge_device,
      COALESCE(user_bridge_endpoints.input_device, '') AS bridge_input_device,
      user_bridge_endpoints.input_left_channel AS bridge_input_left_channel,
      user_bridge_endpoints.input_right_channel AS bridge_input_right_channel,
      COALESCE(user_bridge_endpoints.output_device, '') AS bridge_output_device,
      user_bridge_endpoints.output_left_channel AS bridge_output_left_channel,
      user_bridge_endpoints.output_right_channel AS bridge_output_right_channel,
      COALESCE(user_bridge_endpoints.trigger_mode, 'external') AS bridge_trigger_mode,
      COALESCE(user_bridge_endpoints.trigger_target_type, '') AS bridge_trigger_target_type,
      user_bridge_endpoints.trigger_target_id AS bridge_trigger_target_id,
      COALESCE(user_bridge_endpoints.trigger_threshold_db, -45) AS bridge_trigger_threshold_db,
      user_bridge_endpoints.updated_at AS bridge_updated_at
    FROM users
    LEFT JOIN user_bridge_endpoints ON user_bridge_endpoints.user_id = users.id
    ORDER BY users.is_guest_profile, users.name COLLATE NOCASE
  `).all();
}

function getUserById(id) {
  return db.prepare(`
    SELECT
      users.id,
      users.name,
      users.is_admin,
      users.is_superadmin,
      users.admin_must_change,
      users.is_guest_profile,
      users.last_online_at,
      COALESCE(user_bridge_endpoints.enabled, 0) AS bridge_enabled,
      COALESCE(user_bridge_endpoints.bridge_device, '') AS bridge_device,
      COALESCE(user_bridge_endpoints.input_device, '') AS bridge_input_device,
      user_bridge_endpoints.input_left_channel AS bridge_input_left_channel,
      user_bridge_endpoints.input_right_channel AS bridge_input_right_channel,
      COALESCE(user_bridge_endpoints.output_device, '') AS bridge_output_device,
      user_bridge_endpoints.output_left_channel AS bridge_output_left_channel,
      user_bridge_endpoints.output_right_channel AS bridge_output_right_channel,
      COALESCE(user_bridge_endpoints.trigger_mode, 'external') AS bridge_trigger_mode,
      COALESCE(user_bridge_endpoints.trigger_target_type, '') AS bridge_trigger_target_type,
      user_bridge_endpoints.trigger_target_id AS bridge_trigger_target_id,
      COALESCE(user_bridge_endpoints.trigger_threshold_db, -45) AS bridge_trigger_threshold_db,
      user_bridge_endpoints.updated_at AS bridge_updated_at
    FROM users
    LEFT JOIN user_bridge_endpoints ON user_bridge_endpoints.user_id = users.id
    WHERE users.id = ?
  `).get(id);
}

function getUserAudioSettings(userId) {
  const row = db.prepare('SELECT audio_settings FROM users WHERE id = ?').get(userId);
  if (!row) return null;
  try {
    return normalizeUserAudioSettings(JSON.parse(row.audio_settings || '{}'), { partial: true });
  } catch {
    return {};
  }
}

function updateUserAudioSettings(userId, settings) {
  const normalized = normalizeUserAudioSettings(settings, { strict: true, partial: true });
  const result = db.prepare('UPDATE users SET audio_settings = ? WHERE id = ?')
    .run(JSON.stringify(normalized), userId);
  return result.changes > 0 ? normalized : null;
}

function getUserPanelSettings(userId) {
  const row = db.prepare('SELECT panel_settings FROM users WHERE id = ?').get(userId);
  try { return JSON.parse(row?.panel_settings || '{}'); } catch { return {}; }
}

function updateUserPanelSettings(userId, settings) {
  db.prepare('UPDATE users SET panel_settings = ? WHERE id = ?').run(JSON.stringify(settings), userId);
}

function mergeUserTargetAudioStates(userId, states = []) {
  const insert = db.prepare(`
    INSERT INTO user_target_audio_state (user_id, target_type, target_id, muted, volume, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, target_type, target_id) DO UPDATE SET
      muted = excluded.muted, volume = excluded.volume, updated_at = excluded.updated_at
  `);
  db.transaction(() => {
    for (const state of normalizeUserTargetAudioStates(states)) {
      insert.run(Number(userId), state.targetType, state.targetId, state.muted ? 1 : 0, state.volume, new Date().toISOString());
    }
  })();
}

function getBridgeEndpointsForDevice(bridgeDevice) {
  const normalizedBridgeDevice = normalizeBridgeText(bridgeDevice);
  if (!normalizedBridgeDevice) return [];

  return db.prepare(`
    SELECT
      users.id AS user_id,
      users.name AS user_name,
      user_bridge_endpoints.bridge_device,
      user_bridge_endpoints.input_device,
      user_bridge_endpoints.input_left_channel,
      user_bridge_endpoints.input_right_channel,
      user_bridge_endpoints.output_device,
      user_bridge_endpoints.output_left_channel,
      user_bridge_endpoints.output_right_channel,
      COALESCE(user_bridge_endpoints.trigger_mode, 'external') AS trigger_mode,
      COALESCE(user_bridge_endpoints.trigger_target_type, '') AS trigger_target_type,
      user_bridge_endpoints.trigger_target_id,
      COALESCE(user_bridge_endpoints.trigger_threshold_db, -45) AS trigger_threshold_db,
      user_bridge_endpoints.updated_at
    FROM user_bridge_endpoints
    JOIN users ON users.id = user_bridge_endpoints.user_id
    WHERE user_bridge_endpoints.enabled = 1
      AND user_bridge_endpoints.bridge_device = ?
      AND users.is_superadmin = 0
      AND users.is_guest_profile = 0
    ORDER BY users.name COLLATE NOCASE, users.id
  `).all(normalizedBridgeDevice);
}

function getFeedBridgeEndpointsForDevice(bridgeDevice) {
  const normalizedBridgeDevice = normalizeBridgeText(bridgeDevice);
  if (!normalizedBridgeDevice) return [];

  return db.prepare(`
    SELECT
      feeds.id AS feed_id,
      feeds.name AS feed_name,
      feed_bridge_endpoints.bridge_device,
      feed_bridge_endpoints.input_device,
      feed_bridge_endpoints.input_left_channel,
      feed_bridge_endpoints.input_right_channel,
      feed_bridge_endpoints.updated_at
    FROM feed_bridge_endpoints
    JOIN feeds ON feeds.id = feed_bridge_endpoints.feed_id
    WHERE feed_bridge_endpoints.enabled = 1
      AND feed_bridge_endpoints.bridge_device = ?
    ORDER BY feeds.name COLLATE NOCASE, feeds.id
  `).all(normalizedBridgeDevice);
}

function getAllConferences() {
  return db.prepare('SELECT id, name FROM conferences').all();
}

function getAllFeeds() {
  return db.prepare(`
    SELECT
      feeds.id,
      feeds.name,
      COALESCE(feed_bridge_endpoints.enabled, 0) AS bridge_enabled,
      COALESCE(feed_bridge_endpoints.bridge_device, '') AS bridge_device,
      COALESCE(feed_bridge_endpoints.input_device, '') AS bridge_input_device,
      feed_bridge_endpoints.input_left_channel AS bridge_input_left_channel,
      feed_bridge_endpoints.input_right_channel AS bridge_input_right_channel,
      feed_bridge_endpoints.updated_at AS bridge_updated_at
    FROM feeds
    LEFT JOIN feed_bridge_endpoints ON feed_bridge_endpoints.feed_id = feeds.id
    ORDER BY feeds.name COLLATE NOCASE
  `).all();
}

function getFeedById(id) {
  return db.prepare('SELECT id, name FROM feeds WHERE id = ?').get(id) || null;
}

function normalizeProductionName(value) {
  const name = String(value || '').trim();
  if (!name) throw new Error('Production name is required');
  if (name.length > 100) throw new Error('Production name must be 100 characters or fewer');
  return name;
}

function getAllProductions() {
  return db.prepare(`
    SELECT
      p.id,
      p.name,
      p.is_primary,
      p.created_at,
      p.updated_at,
      COUNT(DISTINCT pu.user_id) AS member_count,
      COUNT(DISTINCT pc.conference_id) AS conference_count,
      COUNT(DISTINCT pf.feed_id) AS feed_count
    FROM productions p
    LEFT JOIN production_users pu ON pu.production_id = p.id
    LEFT JOIN production_conferences pc ON pc.production_id = p.id
    LEFT JOIN production_feeds pf ON pf.production_id = p.id
    GROUP BY p.id
    ORDER BY p.is_primary DESC, p.name COLLATE NOCASE, p.id
  `).all().map((row) => ({ ...row, isPrimary: Boolean(row.is_primary) }));
}

function getProductionById(productionId) {
  const production = db.prepare(`
    SELECT id, name, is_primary, created_at, updated_at
    FROM productions
    WHERE id = ?
  `).get(Number(productionId));
  return production ? { ...production, isPrimary: Boolean(production.is_primary) } : null;
}

function getPrimaryProduction() {
  const production = db.prepare(`
    SELECT id, name, is_primary, created_at, updated_at
    FROM productions
    ORDER BY is_primary DESC, name COLLATE NOCASE, id
    LIMIT 1
  `).get();
  return production ? { ...production, isPrimary: Boolean(production.is_primary) } : null;
}

function materializePrimaryProductionFromGlobal() {
  const existing = getPrimaryProduction();
  if (existing) {
    if (!existing.isPrimary) {
      db.prepare('UPDATE productions SET is_primary = 1 WHERE id = ?').run(Number(existing.id));
    }
    return Number(existing.id);
  }

  let name = 'Default';
  let suffix = 2;
  while (db.prepare('SELECT 1 FROM productions WHERE name = ?').get(name)) name = `Default ${suffix++}`;
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO productions (name, is_primary, created_at, updated_at) VALUES (?, 1, ?, ?)
  `).run(name, now, now);
  const productionId = Number(result.lastInsertRowid);
  db.prepare(`INSERT OR IGNORE INTO production_users (production_id, user_id, is_admin)
    SELECT ?, id, 0 FROM users WHERE is_superadmin = 0`).run(productionId);
  db.prepare(`INSERT OR IGNORE INTO production_conferences (production_id, conference_id)
    SELECT ?, id FROM conferences`).run(productionId);
  db.prepare(`INSERT OR IGNORE INTO production_feeds (production_id, feed_id)
    SELECT ?, id FROM feeds`).run(productionId);
  db.prepare(`INSERT OR IGNORE INTO production_user_conference (production_id, user_id, conference_id)
    SELECT ?, membership.user_id, membership.conference_id
    FROM user_conference membership
    JOIN users user ON user.id = membership.user_id AND user.is_superadmin = 0`).run(productionId);
  db.prepare(`INSERT OR IGNORE INTO production_user_targets (production_id, user_id, target_type, target_id)
    SELECT ?, user_id, 'user', target_user FROM user_user_targets`).run(productionId);
  db.prepare(`INSERT OR IGNORE INTO production_user_targets (production_id, user_id, target_type, target_id)
    SELECT ?, user_id, 'feed', feed_id FROM user_feed_targets`).run(productionId);
  db.prepare(`INSERT OR IGNORE INTO production_target_order
      (production_id, user_id, target_type, target_id, position)
    SELECT ?, user_id, target_type, target_id, position FROM user_target_order
    WHERE target_type IN ('user', 'conference', 'feed')`).run(productionId);
  return productionId;
}

function getProductionsForUser(userId) {
  return db.prepare(`
    SELECT p.id, p.name, pu.is_admin AS isAdmin
    FROM production_users pu
    JOIN productions p ON p.id = pu.production_id
    WHERE pu.user_id = ?
    ORDER BY p.is_primary DESC, p.name COLLATE NOCASE, p.id
  `).all(Number(userId)).map((row) => ({
    ...row,
    isAdmin: Boolean(row.isAdmin),
  }));
}

function getProductionsForFeed(feedId) {
  return db.prepare(`
    SELECT p.id, p.name
    FROM production_feeds pf
    JOIN productions p ON p.id = pf.production_id
    WHERE pf.feed_id = ?
    ORDER BY p.is_primary DESC, p.name COLLATE NOCASE, p.id
  `).all(Number(feedId));
}

function isUserInProduction(userId, productionId) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM production_users
    WHERE production_id = ? AND user_id = ?
  `).get(Number(productionId), Number(userId)));
}

function isUserProductionAdmin(userId, productionId) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM production_users
    WHERE production_id = ? AND user_id = ? AND is_admin = 1
  `).get(Number(productionId), Number(userId)));
}

function createProduction(name) {
  const now = new Date().toISOString();
  try {
    const result = db.prepare(`
      INSERT INTO productions (name, created_at, updated_at)
      VALUES (?, ?, ?)
    `).run(normalizeProductionName(name), now, now);
    return Number(result.lastInsertRowid);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error('Production name already exists');
    }
    throw err;
  }
}

function updateProductionName(productionId, name) {
  const result = db.prepare(`
    UPDATE productions
    SET name = ?, updated_at = ?
    WHERE id = ?
  `).run(normalizeProductionName(name), new Date().toISOString(), Number(productionId));
  return result.changes > 0;
}

function deleteProduction(productionId) {
  const id = Number(productionId);
  const remove = db.transaction(() => {
    const production = getProductionById(id);
    if (!production) return false;
    const remaining = db.prepare(`
      SELECT id FROM productions WHERE id != ? ORDER BY name COLLATE NOCASE, id LIMIT 1
    `).get(id);
    if (!remaining) throw new Error('The last production cannot be deleted');
    db.prepare('DELETE FROM production_user_conference WHERE production_id = ?').run(id);
    db.prepare('DELETE FROM production_target_order WHERE production_id = ?').run(id);
    db.prepare('DELETE FROM production_user_targets WHERE production_id = ?').run(id);
    db.prepare('DELETE FROM production_feeds WHERE production_id = ?').run(id);
    db.prepare('DELETE FROM production_conferences WHERE production_id = ?').run(id);
    db.prepare('DELETE FROM production_users WHERE production_id = ?').run(id);
    const deleted = db.prepare('DELETE FROM productions WHERE id = ?').run(id).changes > 0;
    if (deleted && production.is_primary) {
      db.prepare('UPDATE productions SET is_primary = 0').run();
      db.prepare('UPDATE productions SET is_primary = 1, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), Number(remaining.id));
    }
    return deleted;
  });
  return remove();
}

function getProductionMembers(productionId) {
  return db.prepare(`
    SELECT u.id, u.name, u.is_guest_profile, pu.is_admin AS isProductionAdmin
    FROM production_users pu
    JOIN users u ON u.id = pu.user_id
    WHERE pu.production_id = ? AND u.is_superadmin = 0
    ORDER BY u.is_guest_profile, u.name COLLATE NOCASE
  `).all(Number(productionId)).map((row) => ({
    ...row,
    isProductionAdmin: Boolean(row.isProductionAdmin),
  }));
}

function setProductionUser(productionId, userId, { isAdmin = false } = {}) {
  const production = getProductionById(productionId);
  const user = getUserById(userId);
  if (!production) throw new Error('Production not found');
  if (!user || user.is_superadmin) throw new Error('User not found');
  db.prepare(`
    INSERT INTO production_users (production_id, user_id, is_admin)
    VALUES (?, ?, ?)
    ON CONFLICT(production_id, user_id) DO UPDATE SET is_admin = excluded.is_admin
  `).run(Number(productionId), Number(userId), isAdmin ? 1 : 0);
}

function removeProductionUser(productionId, userId) {
  const pid = Number(productionId);
  const uid = Number(userId);
  const remove = db.transaction(() => {
    db.prepare('DELETE FROM production_user_conference WHERE production_id = ? AND user_id = ?').run(pid, uid);
    db.prepare('DELETE FROM production_target_order WHERE production_id = ? AND user_id = ?').run(pid, uid);
    db.prepare('DELETE FROM production_user_targets WHERE production_id = ? AND user_id = ?').run(pid, uid);
    db.prepare("DELETE FROM production_target_order WHERE production_id = ? AND target_type = 'user' AND target_id = ?").run(pid, uid);
    db.prepare("DELETE FROM production_user_targets WHERE production_id = ? AND target_type = 'user' AND target_id = ?").run(pid, uid);
    return db.prepare('DELETE FROM production_users WHERE production_id = ? AND user_id = ?').run(pid, uid).changes > 0;
  });
  return remove();
}

function getProductionConferences(productionId) {
  return db.prepare(`
    SELECT c.id, c.name
    FROM production_conferences pc
    JOIN conferences c ON c.id = pc.conference_id
    WHERE pc.production_id = ?
    ORDER BY c.name COLLATE NOCASE
  `).all(Number(productionId));
}

function getProductionFeeds(productionId) {
  return db.prepare(`
    SELECT f.id, f.name
    FROM production_feeds pf
    JOIN feeds f ON f.id = pf.feed_id
    WHERE pf.production_id = ?
    ORDER BY f.name COLLATE NOCASE
  `).all(Number(productionId));
}

function setProductionConference(productionId, conferenceId) {
  const pid = Number(productionId);
  const cid = Number(conferenceId);
  if (!getProductionById(pid)) throw new Error('Production not found');
  if (!db.prepare('SELECT 1 FROM conferences WHERE id = ?').get(cid)) {
    throw new Error('Conference not found');
  }
  db.prepare(`
    INSERT OR IGNORE INTO production_conferences (production_id, conference_id)
    VALUES (?, ?)
  `).run(pid, cid);
}

function removeProductionConference(productionId, conferenceId) {
  const pid = Number(productionId);
  const cid = Number(conferenceId);
  const remove = db.transaction(() => {
    db.prepare(`DELETE FROM production_user_conference
      WHERE production_id = ? AND conference_id = ?`).run(pid, cid);
    db.prepare(`DELETE FROM production_user_targets
      WHERE production_id = ? AND target_type = 'conference' AND target_id = ?`).run(pid, cid);
    db.prepare(`DELETE FROM production_target_order
      WHERE production_id = ? AND target_type = 'conference' AND target_id = ?`).run(pid, cid);
    return db.prepare(`DELETE FROM production_conferences
      WHERE production_id = ? AND conference_id = ?`).run(pid, cid).changes > 0;
  });
  return remove();
}

function setProductionFeed(productionId, feedId) {
  const pid = Number(productionId);
  const fid = Number(feedId);
  if (!getProductionById(pid)) throw new Error('Production not found');
  if (!db.prepare('SELECT 1 FROM feeds WHERE id = ?').get(fid)) {
    throw new Error('Feed not found');
  }
  db.prepare(`
    INSERT OR IGNORE INTO production_feeds (production_id, feed_id)
    VALUES (?, ?)
  `).run(pid, fid);
}

function removeProductionFeed(productionId, feedId) {
  const pid = Number(productionId);
  const fid = Number(feedId);
  const remove = db.transaction(() => {
    db.prepare(`DELETE FROM production_user_targets
      WHERE production_id = ? AND target_type = 'feed' AND target_id = ?`).run(pid, fid);
    db.prepare(`DELETE FROM production_target_order
      WHERE production_id = ? AND target_type = 'feed' AND target_id = ?`).run(pid, fid);
    return db.prepare(`DELETE FROM production_feeds
      WHERE production_id = ? AND feed_id = ?`).run(pid, fid).changes > 0;
  });
  return remove();
}

function getProductionConferencesForUser(userId, productionId) {
  return db.prepare(`
    SELECT c.id, c.name, membership.can_talk AS canTalk
    FROM production_user_conference membership
    JOIN conferences c ON c.id = membership.conference_id
    WHERE membership.production_id = ? AND membership.user_id = ?
    ORDER BY c.name COLLATE NOCASE
  `).all(Number(productionId), Number(userId)).map((conference) => ({
    ...conference,
    canTalk: Boolean(conference.canTalk),
  }));
}

function getProductionUsersForConference(conferenceId, productionId) {
  return db.prepare(`
    SELECT u.id, u.name
    FROM production_user_conference membership
    JOIN users u ON u.id = membership.user_id
    WHERE membership.production_id = ?
      AND membership.conference_id = ?
      AND u.is_superadmin = 0
    ORDER BY u.name COLLATE NOCASE
  `).all(Number(productionId), Number(conferenceId));
}

function getAllConfiguredUsersForConference(conferenceId) {
  return db.prepare(`
    SELECT DISTINCT u.id, u.name
    FROM users u
    JOIN production_user_conference membership ON membership.user_id = u.id
      AND membership.conference_id = ?
    WHERE u.is_superadmin = 0
      AND u.is_guest_profile = 0
    ORDER BY u.name COLLATE NOCASE
  `).all(Number(conferenceId));
}

function setProductionConferenceMembership(productionId, userId, conferenceId) {
  const pid = Number(productionId);
  const uid = Number(userId);
  const cid = Number(conferenceId);
  if (!isUserInProduction(uid, pid)) throw new Error('User is not a member of this production');
  if (!db.prepare(`SELECT 1 FROM production_conferences
    WHERE production_id = ? AND conference_id = ?`).get(pid, cid)) {
    throw new Error('Conference is not available in this production');
  }
  const add = db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO production_user_conference
      (production_id, user_id, conference_id, can_talk) VALUES (?, ?, ?, 1)`).run(pid, uid, cid);
    db.prepare(`UPDATE production_user_conference SET can_talk = 1
      WHERE production_id = ? AND user_id = ? AND conference_id = ?`).run(pid, uid, cid);
    db.prepare(`DELETE FROM production_user_targets
      WHERE production_id = ? AND user_id = ? AND target_type = 'conference' AND target_id = ?`)
      .run(pid, uid, cid);
    const max = db.prepare(`SELECT COALESCE(MAX(position), -1) AS maxPos
      FROM production_target_order WHERE production_id = ? AND user_id = ?`).get(pid, uid).maxPos;
    db.prepare(`INSERT OR IGNORE INTO production_target_order
      (production_id, user_id, target_type, target_id, position)
      VALUES (?, ?, 'conference', ?, ?)`).run(pid, uid, cid, max + 1);
  });
  add();
}

function setProductionConferenceListenOnly(productionId, userId, conferenceId) {
  const pid = Number(productionId);
  const uid = Number(userId);
  const cid = Number(conferenceId);
  if (!isUserInProduction(uid, pid)) throw new Error('User is not a member of this production');
  if (!db.prepare(`SELECT 1 FROM production_conferences
    WHERE production_id = ? AND conference_id = ?`).get(pid, cid)) {
    throw new Error('Conference is not available in this production');
  }
  const setListenOnly = db.transaction(() => {
    db.prepare(`INSERT INTO production_user_conference
      (production_id, user_id, conference_id, can_talk) VALUES (?, ?, ?, 0)
      ON CONFLICT(production_id, user_id, conference_id)
      DO UPDATE SET can_talk = 0`).run(pid, uid, cid);
    db.prepare(`DELETE FROM production_user_targets
      WHERE production_id = ? AND user_id = ? AND target_type = 'conference' AND target_id = ?`)
      .run(pid, uid, cid);
    const max = db.prepare(`SELECT COALESCE(MAX(position), -1) AS maxPos
      FROM production_target_order WHERE production_id = ? AND user_id = ?`).get(pid, uid).maxPos;
    db.prepare(`INSERT OR IGNORE INTO production_target_order
      (production_id, user_id, target_type, target_id, position)
      VALUES (?, ?, 'conference', ?, ?)`).run(pid, uid, cid, max + 1);
  });
  setListenOnly();
  return true;
}

function removeProductionConferenceMembership(productionId, userId, conferenceId) {
  const pid = Number(productionId);
  const uid = Number(userId);
  const cid = Number(conferenceId);
  const remove = db.transaction(() => {
    db.prepare(`DELETE FROM production_user_conference
      WHERE production_id = ? AND user_id = ? AND conference_id = ?`).run(pid, uid, cid);
    db.prepare(`DELETE FROM production_user_targets
      WHERE production_id = ? AND user_id = ? AND target_type = 'conference' AND target_id = ?`)
      .run(pid, uid, cid);
    db.prepare(`DELETE FROM production_target_order
      WHERE production_id = ? AND user_id = ? AND target_type = 'conference' AND target_id = ?`)
      .run(pid, uid, cid);
  });
  remove();
}

function getProductionTargets(userId, productionId) {
  return db.prepare(`
    SELECT targetType, targetId, name, canTalk
    FROM (
      SELECT 'user' AS targetType, t.target_id AS targetId, u.name AS name,
             1 AS canTalk, o.position AS position, t.rowid AS fallback
      FROM production_user_targets t
      JOIN users u ON t.target_type = 'user' AND u.id = t.target_id
        AND u.is_superadmin = 0 AND u.is_guest_profile = 0
      JOIN production_users target_member
        ON target_member.production_id = t.production_id AND target_member.user_id = t.target_id
      LEFT JOIN production_target_order o
        ON o.production_id = t.production_id AND o.user_id = t.user_id
       AND o.target_type = t.target_type AND o.target_id = t.target_id
      WHERE t.production_id = ? AND t.user_id = ? AND t.target_type = 'user'

      UNION ALL

      SELECT 'conference', membership.conference_id, c.name, membership.can_talk,
             o.position, membership.rowid
      FROM production_user_conference membership
      JOIN conferences c ON c.id = membership.conference_id
      LEFT JOIN production_target_order o
        ON o.production_id = membership.production_id AND o.user_id = membership.user_id
       AND o.target_type = 'conference' AND o.target_id = membership.conference_id
      WHERE membership.production_id = ? AND membership.user_id = ?

      UNION ALL

      SELECT 'feed', t.target_id, f.name, 0, o.position, t.rowid
      FROM production_user_targets t
      JOIN feeds f ON t.target_type = 'feed' AND f.id = t.target_id
      JOIN production_feeds available_feed
        ON available_feed.production_id = t.production_id AND available_feed.feed_id = t.target_id
      LEFT JOIN production_target_order o
        ON o.production_id = t.production_id AND o.user_id = t.user_id
       AND o.target_type = t.target_type AND o.target_id = t.target_id
      WHERE t.production_id = ? AND t.user_id = ? AND t.target_type = 'feed'
    )
    ORDER BY COALESCE(position, fallback)
  `).all(
    Number(productionId), Number(userId),
    Number(productionId), Number(userId),
    Number(productionId), Number(userId)
  ).map((target) => ({
    ...target,
    canTalk: Boolean(target.canTalk),
  }));
}

function getBridgeTargetsForUser(userId) {
  const targets = getProductionsForUser(userId)
    .flatMap((production) => getProductionTargets(userId, production.id));
  const unique = new Map();

  for (const target of targets) {
    if (!['user', 'conference'].includes(target.targetType)) continue;
    const key = `${target.targetType}:${target.targetId}`;
    const existing = unique.get(key);
    if (!existing || (target.targetType === 'conference' && target.canTalk && !existing.canTalk)) {
      unique.set(key, target);
    }
  }

  return [...unique.values()]
    .filter((target) => target.targetType !== 'conference' || target.canTalk)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
}

function getPrimaryProductionTargets(userId) {
  const primaryProduction = getPrimaryProduction();
  return primaryProduction
    ? getProductionTargets(userId, primaryProduction.id)
    : getUserTargets(userId);
}

function validateProductionTarget(productionId, userId, targetType, targetId) {
  const pid = Number(productionId);
  const uid = Number(userId);
  const tid = Number(targetId);
  if (!isUserInProduction(uid, pid)) throw new Error('User is not a member of this production');
  if (targetType === 'user') {
    if (uid === tid) throw new Error('A user cannot target itself');
    const target = getUserById(tid);
    if (!target || target.is_superadmin || target.is_guest_profile || !isUserInProduction(tid, pid)) {
      throw new Error('Target user is not available in this production');
    }
  } else if (targetType === 'conference') {
    if (!db.prepare(`SELECT 1 FROM production_user_conference
      WHERE production_id = ? AND user_id = ? AND conference_id = ?`).get(pid, uid, tid)) {
      throw new Error('User is not a member of this conference in the production');
    }
  } else if (targetType === 'feed') {
    if (!db.prepare(`SELECT 1 FROM production_feeds
      WHERE production_id = ? AND feed_id = ?`).get(pid, tid)) {
      throw new Error('Feed is not available in this production');
    }
  } else {
    throw new Error('Unsupported target type');
  }
}

function addProductionTarget(productionId, userId, targetType, targetId) {
  if (targetType === 'conference') {
    setProductionConferenceMembership(productionId, userId, targetId);
    return;
  }
  validateProductionTarget(productionId, userId, targetType, targetId);
  const pid = Number(productionId);
  const uid = Number(userId);
  const tid = Number(targetId);
  const add = db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO production_user_targets (production_id, user_id, target_type, target_id)
      VALUES (?, ?, ?, ?)
    `).run(pid, uid, targetType, tid);
    const max = db.prepare(`
      SELECT COALESCE(MAX(position), -1) AS maxPos
      FROM production_target_order
      WHERE production_id = ? AND user_id = ?
    `).get(pid, uid).maxPos;
    db.prepare(`
      INSERT OR IGNORE INTO production_target_order (production_id, user_id, target_type, target_id, position)
      VALUES (?, ?, ?, ?, ?)
    `).run(pid, uid, targetType, tid, max + 1);
  });
  add();
}

function removeProductionTarget(productionId, userId, targetType, targetId) {
  if (targetType === 'conference') {
    removeProductionConferenceMembership(productionId, userId, targetId);
    return;
  }
  const pid = Number(productionId);
  const uid = Number(userId);
  const tid = Number(targetId);
  const remove = db.transaction(() => {
    db.prepare(`DELETE FROM production_user_targets
      WHERE production_id = ? AND user_id = ? AND target_type = ? AND target_id = ?`)
      .run(pid, uid, targetType, tid);
    db.prepare(`DELETE FROM production_target_order
      WHERE production_id = ? AND user_id = ? AND target_type = ? AND target_id = ?`)
      .run(pid, uid, targetType, tid);
  });
  remove();
}

function updateProductionTargetOrder(productionId, userId, items) {
  const pid = Number(productionId);
  const uid = Number(userId);
  const reorder = db.transaction(() => {
    db.prepare('DELETE FROM production_target_order WHERE production_id = ? AND user_id = ?').run(pid, uid);
    items.forEach((item, index) => {
      validateProductionTarget(pid, uid, item.targetType, item.targetId);
      db.prepare(`
        INSERT INTO production_target_order (production_id, user_id, target_type, target_id, position)
        VALUES (?, ?, ?, ?, ?)
      `).run(pid, uid, item.targetType, Number(item.targetId), index);
    });
  });
  reorder();
}

function exportDatabaseSnapshot() {
  return {
    productions: db.prepare(`
      SELECT id, name, is_primary, created_at, updated_at
      FROM productions
      ORDER BY is_primary DESC, name COLLATE NOCASE, id
    `).all(),
    productionUsers: db.prepare(`
      SELECT production_id, user_id, is_admin
      FROM production_users
      ORDER BY production_id, user_id
    `).all(),
    productionConferences: db.prepare(`
      SELECT production_id, conference_id
      FROM production_conferences
      ORDER BY production_id, conference_id
    `).all(),
    productionFeeds: db.prepare(`
      SELECT production_id, feed_id
      FROM production_feeds
      ORDER BY production_id, feed_id
    `).all(),
    productionConferenceMemberships: db.prepare(`
      SELECT production_id, user_id, conference_id, can_talk
      FROM production_user_conference
      ORDER BY production_id, conference_id, user_id
    `).all(),
    productionUserTargets: db.prepare(`
      SELECT production_id, user_id, target_type, target_id
      FROM production_user_targets
      ORDER BY production_id, user_id, target_type, target_id
    `).all(),
    productionTargetOrder: db.prepare(`
      SELECT production_id, user_id, target_type, target_id, position
      FROM production_target_order
      ORDER BY production_id, user_id, position
    `).all(),
    users: db.prepare(`
      SELECT id, name, password, is_admin, is_superadmin, admin_must_change, is_guest_profile, login_token_hash, last_online_at, audio_settings, panel_settings
      FROM users
      ORDER BY id
    `).all(),
    conferences: db.prepare(`
      SELECT id, name
      FROM conferences
      ORDER BY id
    `).all(),
    feeds: db.prepare(`
      SELECT id, name, password, login_token_hash
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
    userTargetAudioState: db.prepare(`
      SELECT user_id, target_type, target_id, muted, volume, updated_at
      FROM user_target_audio_state
      ORDER BY user_id, target_type, target_id
    `).all(),
    userBridgeEndpoints: db.prepare(`
      SELECT
        user_id,
        enabled,
        bridge_device,
        production_id,
        input_device,
        input_left_channel,
        input_right_channel,
        output_device,
        output_left_channel,
        output_right_channel,
        trigger_mode,
        trigger_target_type,
        trigger_target_id,
        trigger_threshold_db,
        updated_at
      FROM user_bridge_endpoints
      ORDER BY user_id
    `).all(),
    feedBridgeEndpoints: db.prepare(`
      SELECT
        feed_id,
        enabled,
        bridge_device,
        production_id,
        input_device,
        input_left_channel,
        input_right_channel,
        updated_at
      FROM feed_bridge_endpoints
      ORDER BY feed_id
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
  const userTargetAudioState = Array.isArray(snapshot.userTargetAudioState) ? snapshot.userTargetAudioState : [];
  const userBridgeEndpoints = Array.isArray(snapshot.userBridgeEndpoints) ? snapshot.userBridgeEndpoints : [];
  const feedBridgeEndpoints = Array.isArray(snapshot.feedBridgeEndpoints) ? snapshot.feedBridgeEndpoints : [];
  const applePttChannels = Array.isArray(snapshot.applePttChannels) ? snapshot.applePttChannels : [];
  const applePttRegistrations = Array.isArray(snapshot.applePttRegistrations) ? snapshot.applePttRegistrations : [];
  const productions = Array.isArray(snapshot.productions) ? snapshot.productions : [];
  const productionUsers = Array.isArray(snapshot.productionUsers) ? snapshot.productionUsers : [];
  const hasProductionScopeCollections = Array.isArray(snapshot.productionConferences)
    && Array.isArray(snapshot.productionFeeds)
    && Array.isArray(snapshot.productionConferenceMemberships);
  const productionConferences = Array.isArray(snapshot.productionConferences) ? snapshot.productionConferences : [];
  const productionFeeds = Array.isArray(snapshot.productionFeeds) ? snapshot.productionFeeds : [];
  const productionConferenceMemberships = Array.isArray(snapshot.productionConferenceMemberships)
    ? snapshot.productionConferenceMemberships
    : [];
  const productionUserTargets = Array.isArray(snapshot.productionUserTargets) ? snapshot.productionUserTargets : [];
  const productionTargetOrder = Array.isArray(snapshot.productionTargetOrder) ? snapshot.productionTargetOrder : [];

  if (!users || !conferences || !feeds) {
    throw new Error('Snapshot is missing required collections');
  }

  const restore = db.transaction(() => {
    db.prepare('DELETE FROM browser_sessions').run();
    db.prepare('DELETE FROM user_bridge_endpoints').run();
    db.prepare('DELETE FROM feed_bridge_endpoints').run();
    db.prepare('DELETE FROM production_user_conference').run();
    db.prepare('DELETE FROM production_target_order').run();
    db.prepare('DELETE FROM production_user_targets').run();
    db.prepare('DELETE FROM production_feeds').run();
    db.prepare('DELETE FROM production_conferences').run();
    db.prepare('DELETE FROM production_users').run();
    db.prepare('DELETE FROM productions').run();
    db.prepare('DELETE FROM user_target_order').run();
    db.prepare('DELETE FROM apple_ptt_registrations').run();
    db.prepare('DELETE FROM apple_ptt_channels').run();
    db.prepare('DELETE FROM user_user_targets').run();
    db.prepare('DELETE FROM user_conf_targets').run();
    db.prepare('DELETE FROM user_feed_targets').run();
    db.prepare('DELETE FROM user_conference').run();
    db.prepare('DELETE FROM user_target_audio_state').run();
    db.prepare('DELETE FROM feeds').run();
    db.prepare('DELETE FROM conferences').run();
    db.prepare('DELETE FROM users').run();

    try {
      db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('users', 'conferences', 'feeds')").run();
    } catch (err) {
      // sqlite_sequence may not exist yet; safe to ignore
    }

    const insertUser = db.prepare(`
      INSERT INTO users (id, name, password, is_admin, is_superadmin, admin_must_change, is_guest_profile, login_token_hash, last_online_at, audio_settings, panel_settings)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertConference = db.prepare(`
      INSERT INTO conferences (id, name)
      VALUES (?, ?)
    `);
    const insertFeed = db.prepare(`
      INSERT INTO feeds (id, name, password, login_token_hash)
      VALUES (?, ?, ?, ?)
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
    const insertTargetAudioState = db.prepare(`
      INSERT INTO user_target_audio_state (user_id, target_type, target_id, muted, volume, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertBridgeEndpoint = db.prepare(`
      INSERT INTO user_bridge_endpoints (
        user_id,
        enabled,
        bridge_device,
        production_id,
        input_device,
        input_left_channel,
        input_right_channel,
        output_device,
        output_left_channel,
        output_right_channel,
        trigger_mode,
        trigger_target_type,
        trigger_target_id,
        trigger_threshold_db,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFeedBridgeEndpoint = db.prepare(`
      INSERT INTO feed_bridge_endpoints (
        feed_id,
        enabled,
        bridge_device,
        production_id,
        input_device,
        input_left_channel,
        input_right_channel,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertApplePttChannel = db.prepare(`
      INSERT INTO apple_ptt_channels (user_id, channel_uuid, channel_name, updated_at)
      VALUES (?, ?, ?, ?)
    `);
    const insertApplePttRegistration = db.prepare(`
      INSERT INTO apple_ptt_registrations (user_id, channel_uuid, push_token, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertProduction = db.prepare(`
      INSERT INTO productions (id, name, is_primary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertProductionUser = db.prepare(`
      INSERT INTO production_users (production_id, user_id, is_admin)
      VALUES (?, ?, ?)
    `);
    const insertProductionConference = db.prepare(`
      INSERT INTO production_conferences (production_id, conference_id)
      VALUES (?, ?)
    `);
    const insertProductionFeed = db.prepare(`
      INSERT INTO production_feeds (production_id, feed_id)
      VALUES (?, ?)
    `);
    const insertProductionConferenceMembership = db.prepare(`
      INSERT INTO production_user_conference (production_id, user_id, conference_id, can_talk)
      VALUES (?, ?, ?, ?)
    `);
    const insertProductionUserTarget = db.prepare(`
      INSERT INTO production_user_targets (production_id, user_id, target_type, target_id)
      VALUES (?, ?, ?, ?)
    `);
    const insertProductionTargetOrder = db.prepare(`
      INSERT INTO production_target_order (production_id, user_id, target_type, target_id, position)
      VALUES (?, ?, ?, ?, ?)
    `);

    users.forEach((row) => {
      insertUser.run(
        Number(row.id),
        String(row.name),
        String(row.password),
        row.is_admin ? 1 : 0,
        row.is_superadmin ? 1 : 0,
        row.admin_must_change ? 1 : 0,
        row.is_guest_profile ? 1 : 0,
        row.login_token_hash ? String(row.login_token_hash) : null,
        row.last_online_at ? String(row.last_online_at) : null,
        JSON.stringify(normalizeUserAudioSettings(
          typeof row.audio_settings === 'string' ? JSON.parse(row.audio_settings || '{}') : row.audio_settings,
          { partial: true }
        )),
        JSON.stringify(typeof row.panel_settings === 'string' ? JSON.parse(row.panel_settings || '{}') : row.panel_settings || {})
      );
    });

    conferences.forEach((row) => {
      insertConference.run(Number(row.id), String(row.name));
    });

    feeds.forEach((row) => {
      insertFeed.run(
        Number(row.id),
        String(row.name),
        String(row.password),
        row.login_token_hash ? String(row.login_token_hash) : null
      );
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

    userTargetAudioState.forEach((row) => {
      insertTargetAudioState.run(
        Number(row.user_id),
        String(row.target_type),
        Number(row.target_id),
        row.muted ? 1 : 0,
        Number(row.volume),
        String(row.updated_at)
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

    productions.forEach((row) => {
      insertProduction.run(
        Number(row.id),
        normalizeProductionName(row.name),
        row.is_primary || row.isPrimary ? 1 : 0,
        String(row.created_at || new Date().toISOString()),
        String(row.updated_at || row.created_at || new Date().toISOString())
      );
    });
    productionUsers.forEach((row) => {
      insertProductionUser.run(Number(row.production_id), Number(row.user_id), row.is_admin ? 1 : 0);
    });
    productionConferences.forEach((row) => {
      insertProductionConference.run(Number(row.production_id), Number(row.conference_id));
    });
    productionFeeds.forEach((row) => {
      insertProductionFeed.run(Number(row.production_id), Number(row.feed_id));
    });
    productionConferenceMemberships.forEach((row) => {
      insertProductionConferenceMembership.run(
        Number(row.production_id), Number(row.user_id), Number(row.conference_id),
        row.can_talk === 0 || row.canTalk === false ? 0 : 1
      );
    });
    productionUserTargets.forEach((row) => {
      insertProductionUserTarget.run(
        Number(row.production_id), Number(row.user_id), String(row.target_type), Number(row.target_id)
      );
    });
    productionTargetOrder.forEach((row) => {
      insertProductionTargetOrder.run(
        Number(row.production_id), Number(row.user_id), String(row.target_type),
        Number(row.target_id), Number(row.position)
      );
    });

    db.exec(`
      INSERT OR IGNORE INTO user_conference (user_id, conference_id)
      SELECT user_id, target_conf FROM user_conf_targets;
    `);

    // Backups created before production-scoped entities inferred their
    // available conferences, feeds and memberships from the old layout.
    if (!hasProductionScopeCollections) db.exec(`
      INSERT OR IGNORE INTO production_conferences (production_id, conference_id)
      SELECT production_id, target_id
      FROM production_user_targets
      WHERE target_type = 'conference';

      INSERT OR IGNORE INTO production_feeds (production_id, feed_id)
      SELECT production_id, target_id
      FROM production_user_targets
      WHERE target_type = 'feed';

      INSERT OR IGNORE INTO production_conferences (production_id, conference_id)
      SELECT production_member.production_id, membership.conference_id
      FROM production_users production_member
      JOIN user_conference membership ON membership.user_id = production_member.user_id;

      INSERT OR IGNORE INTO production_user_conference (production_id, user_id, conference_id)
      SELECT production_member.production_id, production_member.user_id, membership.conference_id
      FROM production_users production_member
      JOIN user_conference membership ON membership.user_id = production_member.user_id
      JOIN production_conferences production_conference
        ON production_conference.production_id = production_member.production_id
       AND production_conference.conference_id = membership.conference_id;
    `);

    db.exec(`
      DELETE FROM user_conf_targets;
      DELETE FROM user_conference;
      DELETE FROM user_target_order WHERE target_type = 'conference';
      DELETE FROM production_user_targets WHERE target_type = 'conference';
    `);

    materializePrimaryProductionFromGlobal();

    userBridgeEndpoints.forEach((row) => {
      const normalized = normalizeBridgeEndpointConfig({
        enabled: row.enabled,
        bridgeDevice: row.bridge_device,
        productionId: row.production_id,
        inputDevice: row.input_device,
        inputLeftChannel: row.input_left_channel,
        inputRightChannel: row.input_right_channel,
        outputDevice: row.output_device,
        outputLeftChannel: row.output_left_channel,
        outputRightChannel: row.output_right_channel,
        triggerMode: row.trigger_mode,
        triggerTargetType: row.trigger_target_type,
        triggerTargetId: row.trigger_target_id,
        triggerThresholdDb: row.trigger_threshold_db,
      });
      insertBridgeEndpoint.run(
        Number(row.user_id),
        normalized.enabled ? 1 : 0,
        normalized.bridgeDevice,
        null,
        normalized.inputDevice,
        normalized.inputLeftChannel,
        normalized.inputRightChannel,
        normalized.outputDevice,
        normalized.outputLeftChannel,
        normalized.outputRightChannel,
        normalized.triggerMode,
        normalized.triggerTargetType,
        normalized.triggerTargetId,
        normalized.triggerThresholdDb,
        String(row.updated_at || new Date().toISOString())
      );
    });

    feedBridgeEndpoints.forEach((row) => {
      const normalized = normalizeFeedBridgeEndpointConfig({
        enabled: row.enabled,
        bridgeDevice: row.bridge_device,
        productionId: row.production_id,
        inputDevice: row.input_device,
        inputLeftChannel: row.input_left_channel,
        inputRightChannel: row.input_right_channel,
      });
      insertFeedBridgeEndpoint.run(
        Number(row.feed_id),
        normalized.enabled ? 1 : 0,
        normalized.bridgeDevice,
        null,
        normalized.inputDevice,
        normalized.inputLeftChannel,
        normalized.inputRightChannel,
        String(row.updated_at || new Date().toISOString())
      );
    });

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

function getGuestProfileUser() {
  return db.prepare(`
    SELECT id, name, is_admin, is_superadmin, admin_must_change, is_guest_profile
    FROM users
    WHERE is_guest_profile = 1
    ORDER BY id
    LIMIT 1
  `).get();
}

function getOrCreateGuestProfile() {
  const existing = getGuestProfileUser();
  if (existing) return existing;

  const baseNames = ['Guest', 'Guest Profile'];
  let selectedName = null;
  for (const baseName of baseNames) {
    const exists = db.prepare('SELECT id FROM users WHERE name = ?').get(baseName);
    if (!exists) {
      selectedName = baseName;
      break;
    }
  }
  if (!selectedName) {
    let index = 2;
    while (!selectedName) {
      const candidate = `Guest Profile ${index}`;
      const exists = db.prepare('SELECT id FROM users WHERE name = ?').get(candidate);
      if (!exists) selectedName = candidate;
      index += 1;
    }
  }

  const hash = bcrypt.hashSync(crypto.randomUUID(), 10);
  const result = db.prepare(`
    INSERT INTO users (name, password, is_admin, is_superadmin, admin_must_change, is_guest_profile)
    VALUES (?, ?, 0, 0, 0, 1)
  `).run(selectedName, hash);
  return getUserById(result.lastInsertRowid);
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
  const uid = Number(userId);
  const cid = Number(conferenceId);
  const add = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO user_conference (user_id, conference_id) VALUES (?, ?)')
      .run(uid, cid);
    db.prepare('DELETE FROM user_conf_targets WHERE user_id = ? AND target_conf = ?').run(uid, cid);
    appendTargetOrder(uid, 'conference', cid);
  });
  add();
}

function getUsersForConference(conferenceId) {
  const stmt = db.prepare(`
    SELECT users.id, users.name FROM users
    JOIN user_conference ON users.id = user_conference.user_id
    WHERE user_conference.conference_id = ?
      AND users.is_superadmin = 0
      AND users.is_guest_profile = 0
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
  const uid = Number(userId);
  const cid = Number(conferenceId);
  const remove = db.transaction(() => {
    db.prepare(`DELETE FROM user_conference
      WHERE user_id = ? AND conference_id = ?`).run(uid, cid);
    db.prepare(`DELETE FROM user_conf_targets
      WHERE user_id = ? AND target_conf = ?`).run(uid, cid);
    removeTargetOrder(uid, 'conference', cid);
  });
  remove();
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
  const stmt = db.prepare('UPDATE users SET password = ?, login_token_hash = NULL WHERE id = ?');
  const result = stmt.run(hash, id);
  return result.changes > 0;
}

function createUserLoginToken(id) {
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId < 1) {
    throw new Error('Invalid user id');
  }

  const user = db.prepare(`
    SELECT id, is_superadmin, is_guest_profile
    FROM users
    WHERE id = ?
  `).get(userId);
  if (!user) throw new Error('User not found');
  if (user.is_superadmin) throw new Error('Superadmin does not use a login URL');
  if (user.is_guest_profile) throw new Error('Guest profile does not use a login URL');

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('UPDATE users SET login_token_hash = ? WHERE id = ?').run(tokenHash, userId);
  return token;
}

function getUserByLoginToken(token) {
  if (typeof token !== 'string') return null;
  const normalizedToken = token.trim();
  if (normalizedToken.length < 32 || normalizedToken.length > 256) return null;

  const tokenHash = crypto.createHash('sha256').update(normalizedToken).digest('hex');
  return db.prepare(`
    SELECT id, name
    FROM users
    WHERE login_token_hash = ?
      AND is_superadmin = 0
      AND is_guest_profile = 0
  `).get(tokenHash) || null;
}

function createFeedLoginToken(id) {
  const feedId = Number(id);
  if (!Number.isInteger(feedId) || feedId < 1) {
    throw new Error('Invalid feed id');
  }

  const feed = db.prepare('SELECT id FROM feeds WHERE id = ?').get(feedId);
  if (!feed) throw new Error('Feed not found');

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('UPDATE feeds SET login_token_hash = ? WHERE id = ?').run(tokenHash, feedId);
  return token;
}

function getFeedByLoginToken(token) {
  if (typeof token !== 'string') return null;
  const normalizedToken = token.trim();
  if (normalizedToken.length < 32 || normalizedToken.length > 256) return null;

  const tokenHash = crypto.createHash('sha256').update(normalizedToken).digest('hex');
  return db.prepare(`
    SELECT id, name
    FROM feeds
    WHERE login_token_hash = ?
  `).get(tokenHash) || null;
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

function updateUserBridgeEndpoint(userId, config = {}) {
  const numericUserId = Number(userId);
  if (!Number.isInteger(numericUserId) || numericUserId < 1) {
    throw new Error('Invalid user id');
  }

  const normalized = normalizeBridgeEndpointConfig(config);
  if (normalized.enabled && normalized.triggerMode === 'audio-level') {
    const triggerTarget = getBridgeTargetsForUser(numericUserId).find((target) => (
      target.targetType === normalized.triggerTargetType
      && Number(target.targetId) === Number(normalized.triggerTargetId)
    ));
    if (!triggerTarget) {
      throw new Error('Audio level trigger target is unavailable to this bridge user');
    }
  }
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO user_bridge_endpoints (
      user_id,
      enabled,
      bridge_device,
      production_id,
      input_device,
      input_left_channel,
      input_right_channel,
      output_device,
      output_left_channel,
      output_right_channel,
      trigger_mode,
      trigger_target_type,
      trigger_target_id,
      trigger_threshold_db,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      enabled = excluded.enabled,
      bridge_device = excluded.bridge_device,
      production_id = excluded.production_id,
      input_device = excluded.input_device,
      input_left_channel = excluded.input_left_channel,
      input_right_channel = excluded.input_right_channel,
      output_device = excluded.output_device,
      output_left_channel = excluded.output_left_channel,
      output_right_channel = excluded.output_right_channel,
      trigger_mode = excluded.trigger_mode,
      trigger_target_type = excluded.trigger_target_type,
      trigger_target_id = excluded.trigger_target_id,
      trigger_threshold_db = excluded.trigger_threshold_db,
      updated_at = excluded.updated_at
  `);

  const result = stmt.run(
    numericUserId,
    normalized.enabled ? 1 : 0,
    normalized.bridgeDevice,
    null,
    normalized.inputDevice,
    normalized.inputLeftChannel,
    normalized.inputRightChannel,
    normalized.outputDevice,
    normalized.outputLeftChannel,
    normalized.outputRightChannel,
    normalized.triggerMode,
    normalized.triggerTargetType,
    normalized.triggerTargetId,
    normalized.triggerThresholdDb,
    now
  );
  return result.changes > 0;
}

function updateFeedBridgeEndpoint(feedId, config = {}) {
  const numericFeedId = Number(feedId);
  if (!Number.isInteger(numericFeedId) || numericFeedId < 1) {
    throw new Error('Invalid feed id');
  }

  const normalized = normalizeFeedBridgeEndpointConfig(config);
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO feed_bridge_endpoints (
      feed_id,
      enabled,
      bridge_device,
      production_id,
      input_device,
      input_left_channel,
      input_right_channel,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(feed_id) DO UPDATE SET
      enabled = excluded.enabled,
      bridge_device = excluded.bridge_device,
      production_id = excluded.production_id,
      input_device = excluded.input_device,
      input_left_channel = excluded.input_left_channel,
      input_right_channel = excluded.input_right_channel,
      updated_at = excluded.updated_at
  `);

  const result = stmt.run(
    numericFeedId,
    normalized.enabled ? 1 : 0,
    normalized.bridgeDevice,
    null,
    normalized.inputDevice,
    normalized.inputLeftChannel,
    normalized.inputRightChannel,
    now
  );
  return result.changes > 0;
}

function updateFeedName(id, name) {
  const stmt = db.prepare('UPDATE feeds SET name = ? WHERE id = ?');
  const result = stmt.run(name, id);
  return result.changes > 0;
}

function updateFeedPassword(id, password) {
  const hash = bcrypt.hashSync(password, 10);
  const stmt = db.prepare('UPDATE feeds SET password = ?, login_token_hash = NULL WHERE id = ?');
  const result = stmt.run(hash, id);
  return result.changes > 0;
}

function updateUserLastOnline(userId, at = new Date().toISOString()) {
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId)) return false;
  const timestamp = typeof at === 'string' && at.trim()
    ? at.trim()
    : new Date().toISOString();
  const result = db.prepare('UPDATE users SET last_online_at = ? WHERE id = ?')
    .run(timestamp, numericUserId);
  return result.changes > 0;
}

function deleteUser(userId) {
  db.prepare('DELETE FROM production_user_conference WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM production_target_order WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM production_user_targets WHERE user_id = ?').run(userId);
  db.prepare("DELETE FROM production_target_order WHERE target_type = 'user' AND target_id = ?").run(userId);
  db.prepare("DELETE FROM production_user_targets WHERE target_type = 'user' AND target_id = ?").run(userId);
  db.prepare('DELETE FROM production_users WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_feed_targets WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_target_order WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_conference WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_bridge_endpoints WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

function deleteConference(confId) {
  const tx = db.transaction((id) => {
    db.prepare('DELETE FROM production_user_conference WHERE conference_id = ?').run(id);
    db.prepare('DELETE FROM production_conferences WHERE conference_id = ?').run(id);
    db.prepare("DELETE FROM production_target_order WHERE target_type = 'conference' AND target_id = ?").run(id);
    db.prepare("DELETE FROM production_user_targets WHERE target_type = 'conference' AND target_id = ?").run(id);
    db.prepare("DELETE FROM user_target_order WHERE target_type = 'conference' AND target_id = ?").run(id);
    db.prepare("DELETE FROM user_target_audio_state WHERE target_type = 'conference' AND target_id = ?").run(id);
    db.prepare('DELETE FROM user_conf_targets WHERE target_conf = ?').run(id);
    db.prepare('DELETE FROM user_conference WHERE conference_id = ?').run(id);
    db.prepare('DELETE FROM conferences WHERE id = ?').run(id);
  });
  tx(confId);
}

function deleteFeed(feedId) {
  const tx = db.transaction(id => {
    db.prepare('DELETE FROM production_feeds WHERE feed_id = ?').run(id);
    db.prepare("DELETE FROM production_target_order WHERE target_type = 'feed' AND target_id = ?").run(id);
    db.prepare("DELETE FROM production_user_targets WHERE target_type = 'feed' AND target_id = ?").run(id);
    db.prepare('DELETE FROM user_feed_targets WHERE feed_id = ?').run(id);
    db.prepare("DELETE FROM user_target_order WHERE target_type = 'feed' AND target_id = ?").run(id);
    db.prepare("DELETE FROM user_target_audio_state WHERE target_type = 'feed' AND target_id = ?").run(id);
    db.prepare('DELETE FROM feed_bridge_endpoints WHERE feed_id = ?').run(id);
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
      JOIN users u ON u.id = ut.target_user AND u.is_superadmin = 0 AND u.is_guest_profile = 0
      LEFT JOIN user_target_order o
        ON o.user_id = ut.user_id
       AND o.target_type = 'user'
       AND o.target_id = ut.target_user
      WHERE ut.user_id = ?

      UNION ALL

      SELECT
        'conference' AS targetType,
        membership.conference_id AS targetId,
        c.name AS name,
        o.position AS position,
        membership.rowid AS fallback
      FROM user_conference membership
      JOIN conferences c ON c.id = membership.conference_id
      LEFT JOIN user_target_order o
        ON o.user_id = membership.user_id
       AND o.target_type = 'conference'
       AND o.target_id = membership.conference_id
      WHERE membership.user_id = ?

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
  if (targetUser.is_guest_profile) {
    throw new Error('Guest profile cannot be a direct target');
  }

  db.prepare(`
    INSERT OR IGNORE INTO user_user_targets (user_id, target_user)
    VALUES (?, ?)
  `).run(userId, targetUserId);
  appendTargetOrder(userId, 'user', targetUserId);
}

function addUserTargetToConference(userId, targetConfId) {
  addUserToConference(userId, targetConfId);
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
  removeUserFromConference(userId, targetConfId);
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
    INSERT OR IGNORE INTO user_target_order (user_id, target_type, target_id, position)
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

function getFeedIdsForUser(userId) {
  return db.prepare('SELECT feed_id FROM user_feed_targets WHERE user_id = ?').all(userId).map(row => row.feed_id);
}

function getProductionFeedIdsForUser(userId, productionId) {
  return db.prepare(`
    SELECT target.target_id AS feed_id
    FROM production_user_targets target
    JOIN production_feeds available
      ON available.production_id = target.production_id
     AND available.feed_id = target.target_id
    WHERE target.production_id = ?
      AND target.user_id = ?
      AND target.target_type = 'feed'
    ORDER BY target.target_id
  `).all(Number(productionId), Number(userId)).map((row) => row.feed_id);
}

function getUsersForFeed(feedId) {
  return db.prepare('SELECT user_id FROM user_feed_targets WHERE feed_id = ?').all(feedId);
}

function getOrCreateApplePttChannelForUser(userId, channelName = 'Talktome') {
  const existing = db.prepare(`
    SELECT user_id, channel_uuid, channel_name
    FROM apple_ptt_channels
    WHERE user_id = ?
  `).get(userId);

  const normalizedName = String(channelName || 'Talktome').trim() || 'Talktome';
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

  const hash = bcrypt.hashSync('talktom3', 10);
  const stmt = db.prepare(`
    INSERT INTO users (name, password, is_admin, is_superadmin, admin_must_change)
    VALUES (?, ?, 1, 1, 1)
  `);
  const result = stmt.run('admin', hash);
  return result.lastInsertRowid;
}

function normalizeUserTargetAudioStates(states = []) {
  if (!Array.isArray(states)) return [];
  const seen = new Set();
  const normalized = [];

  for (const rawState of states) {
    const targetType = typeof rawState?.targetType === 'string'
      ? rawState.targetType.trim().toLowerCase()
      : '';
    if (!['user', 'conference', 'feed'].includes(targetType)) continue;

    const targetId = Number(rawState?.targetId);
    if (!Number.isFinite(targetId)) continue;

    const rawVolume = Number(rawState?.volume);
    const volume = Number.isFinite(rawVolume)
      ? Math.max(0, Math.min(1, rawVolume))
      : 0.9;

    const dedupeKey = `${targetType}:${targetId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    normalized.push({
      targetType,
      targetId,
      muted: Boolean(rawState?.muted),
      volume,
    });
  }

  return normalized;
}

function getUserTargetAudioStates(userId) {
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId)) return [];
  return db.prepare(`
    SELECT target_type AS targetType, target_id AS targetId, muted, volume
    FROM user_target_audio_state
    WHERE user_id = ?
    ORDER BY target_type, target_id
  `).all(numericUserId).map((row) => ({
    targetType: row.targetType,
    targetId: Number(row.targetId),
    muted: Boolean(row.muted),
    volume: Number(row.volume),
  }));
}

function replaceUserTargetAudioStates(userId, states = []) {
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId)) return;
  const normalizedStates = normalizeUserTargetAudioStates(states);
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM user_target_audio_state WHERE user_id = ?').run(numericUserId);
    const insert = db.prepare(`
      INSERT INTO user_target_audio_state (user_id, target_type, target_id, muted, volume, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    normalizedStates.forEach((state) => {
      insert.run(
        numericUserId,
        state.targetType,
        state.targetId,
        state.muted ? 1 : 0,
        state.volume,
        now
      );
    });
  });

  tx();
}

function ensureAppMetaTable() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `).run();
}

function getAppMeta(key) {
  ensureAppMetaTable();
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(String(key));
  return row ? row.value : null;
}

function setAppMeta(key, value) {
  ensureAppMetaTable();
  db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(key), String(value));
}

function cleanupLegacyDefaultConference() {
  ensureAppMetaTable();
  if (getAppMeta('legacy_default_all_conference_removed') === '1') return;

  const legacyAllConferences = db.prepare(`
    SELECT id
    FROM conferences
    WHERE LOWER(name) = 'all'
    ORDER BY id
  `).all();

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM user_target_order WHERE target_type = 'global'").run();
    legacyAllConferences
      .map((row) => Number(row.id))
      .filter(Number.isFinite)
      .forEach((id) => deleteConference(id));
    setAppMeta('legacy_default_all_conference_removed', '1');
  });
  tx();
}

cleanupLegacyDefaultConference();
ensureDefaultAdmin();



module.exports = {
  saveBrowserSession,
  getBrowserSessionByToken,
  deleteBrowserSession,
  purgeExpiredBrowserSessions,
  getAllUsers,
  getUserById,
  getUserAudioSettings,
  getUserPanelSettings,
  updateUserPanelSettings,
  mergeUserTargetAudioStates,
  updateUserAudioSettings,
  getBridgeEndpointsForDevice,
  getFeedBridgeEndpointsForDevice,
  getGuestProfileUser,
  getOrCreateGuestProfile,
  getAllConferences,
  getAllFeeds,
  getFeedById,
  getAllProductions,
  getProductionById,
  getPrimaryProduction,
  getProductionsForUser,
  getProductionsForFeed,
  isUserInProduction,
  isUserProductionAdmin,
  createProduction,
  updateProductionName,
  deleteProduction,
  getProductionMembers,
  setProductionUser,
  removeProductionUser,
  getProductionConferences,
  getProductionFeeds,
  setProductionConference,
  removeProductionConference,
  setProductionFeed,
  removeProductionFeed,
  getProductionConferencesForUser,
  getProductionUsersForConference,
  getAllConfiguredUsersForConference,
  setProductionConferenceMembership,
  setProductionConferenceListenOnly,
  removeProductionConferenceMembership,
  getProductionTargets,
  getBridgeTargetsForUser,
  getPrimaryProductionTargets,
  addProductionTarget,
  removeProductionTarget,
  updateProductionTargetOrder,
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
  createUserLoginToken,
  getUserByLoginToken,
  createFeedLoginToken,
  getFeedByLoginToken,
  updateAdminPassword,
  updateFeedName,
  updateFeedPassword,
  updateUserLastOnline,
  setUserAdminRole,
  setUserSuperAdmin,
  setAdminMustChange,
  updateUserBridgeEndpoint,
  updateFeedBridgeEndpoint,
  deleteUser,
  deleteConference,
  deleteFeed,
  verifyUser,
  getUserByName,
  verifyFeed,
  getUserTargets,
  addUserTargetToUser,
  addUserTargetToConference,
  addUserTargetToFeed,
  removeUserTarget,
  updateUserTargetOrder,
  getUserTargetAudioStates,
  replaceUserTargetAudioStates,
  getFeedIdsForUser,
  getProductionFeedIdsForUser,
  getUsersForFeed,
  getOrCreateApplePttChannelForUser,
  registerApplePttPushToken,
  unregisterApplePttPushToken,
  getApplePttRegistrationsForUsers,
  ensureDefaultAdmin,
  exportDatabaseSnapshot,
  importDatabaseSnapshot
};
