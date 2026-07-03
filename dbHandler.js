const db = require('./db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const BRIDGE_ENDPOINT_TEXT_LIMIT = 200;
const BRIDGE_TRIGGER_DEFAULT_THRESHOLD_DB = -45;
const BRIDGE_TRIGGER_MIN_THRESHOLD_DB = -80;
const BRIDGE_TRIGGER_MAX_THRESHOLD_DB = -10;

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

function exportDatabaseSnapshot() {
  return {
    users: db.prepare(`
      SELECT id, name, password, is_admin, is_superadmin, admin_must_change, is_guest_profile, last_online_at
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
    db.prepare('DELETE FROM user_target_audio_state').run();
    db.prepare('DELETE FROM user_bridge_endpoints').run();
    db.prepare('DELETE FROM feed_bridge_endpoints').run();
    db.prepare('DELETE FROM feeds').run();
    db.prepare('DELETE FROM conferences').run();
    db.prepare('DELETE FROM users').run();

    try {
      db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('users', 'conferences', 'feeds')").run();
    } catch (err) {
      // sqlite_sequence may not exist yet; safe to ignore
    }

    const insertUser = db.prepare(`
      INSERT INTO users (id, name, password, is_admin, is_superadmin, admin_must_change, is_guest_profile, last_online_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
    const insertTargetAudioState = db.prepare(`
      INSERT INTO user_target_audio_state (user_id, target_type, target_id, muted, volume, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertBridgeEndpoint = db.prepare(`
      INSERT INTO user_bridge_endpoints (
        user_id,
        enabled,
        bridge_device,
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFeedBridgeEndpoint = db.prepare(`
      INSERT INTO feed_bridge_endpoints (
        feed_id,
        enabled,
        bridge_device,
        input_device,
        input_left_channel,
        input_right_channel,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
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
        row.admin_must_change ? 1 : 0,
        row.is_guest_profile ? 1 : 0,
        row.last_online_at ? String(row.last_online_at) : null
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

    userBridgeEndpoints.forEach((row) => {
      const normalized = normalizeBridgeEndpointConfig({
        enabled: row.enabled,
        bridgeDevice: row.bridge_device,
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
        inputDevice: row.input_device,
        inputLeftChannel: row.input_left_channel,
        inputRightChannel: row.input_right_channel,
      });
      insertFeedBridgeEndpoint.run(
        Number(row.feed_id),
        normalized.enabled ? 1 : 0,
        normalized.bridgeDevice,
        normalized.inputDevice,
        normalized.inputLeftChannel,
        normalized.inputRightChannel,
        String(row.updated_at || new Date().toISOString())
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
  const stmt = db.prepare('INSERT OR IGNORE INTO user_conference (user_id, conference_id) VALUES (?, ?)');
  stmt.run(userId, conferenceId);
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

function updateUserBridgeEndpoint(userId, config = {}) {
  const numericUserId = Number(userId);
  if (!Number.isInteger(numericUserId) || numericUserId < 1) {
    throw new Error('Invalid user id');
  }

  const normalized = normalizeBridgeEndpointConfig(config);
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO user_bridge_endpoints (
      user_id,
      enabled,
      bridge_device,
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      enabled = excluded.enabled,
      bridge_device = excluded.bridge_device,
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
      input_device,
      input_left_channel,
      input_right_channel,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(feed_id) DO UPDATE SET
      enabled = excluded.enabled,
      bridge_device = excluded.bridge_device,
      input_device = excluded.input_device,
      input_left_channel = excluded.input_left_channel,
      input_right_channel = excluded.input_right_channel,
      updated_at = excluded.updated_at
  `);

  const result = stmt.run(
    numericFeedId,
    normalized.enabled ? 1 : 0,
    normalized.bridgeDevice,
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
  const stmt = db.prepare('UPDATE feeds SET password = ? WHERE id = ?');
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
  db.prepare('DELETE FROM user_feed_targets WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_target_order WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_conference WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_bridge_endpoints WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

function deleteConference(confId) {
  const tx = db.transaction((id) => {
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
  getAllUsers,
  getUserById,
  getBridgeEndpointsForDevice,
  getFeedBridgeEndpointsForDevice,
  getGuestProfileUser,
  getOrCreateGuestProfile,
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
  getUsersForFeed,
  getOrCreateApplePttChannelForUser,
  registerApplePttPushToken,
  unregisterApplePttPushToken,
  getApplePttRegistrationsForUsers,
  ensureDefaultAdmin,
  exportDatabaseSnapshot,
  importDatabaseSnapshot
};
