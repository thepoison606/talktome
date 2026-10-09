// db.js
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { getDataDir, getDataFile } = require("./dataPaths");
const { syncRuntimeFile } = require("./runtimeWorker");
const { getBetterSqliteBindingCandidates } = require("./betterSqliteBinding");

function resolveNativeBinding() {
  const execDir = path.dirname(process.execPath);
  const candidates = [
    ...getBetterSqliteBindingCandidates(),
    path.join(execDir, "binaries", "better_sqlite3.node"),
    path.join(execDir, "better_sqlite3.node"),
  ];
  const sourcePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!sourcePath) {
    throw new Error(
      `better_sqlite3.node is missing. Checked: ${candidates.join(", ")}`
    );
  }

  const targetPath = path.join(getDataDir(), "runtime", "better_sqlite3.node");
  const result = syncRuntimeFile(sourcePath, targetPath);
  if (result.updated) {
    console.log(`[INIT] Updated better-sqlite3 runtime: ${targetPath}`);
  }
  return targetPath;
}

const nativeBinding = resolveNativeBinding();
const dbPath = getDataFile("app.db");
const db = new Database(dbPath, { nativeBinding });

// Initialize tables (run once)
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
                                         id INTEGER PRIMARY KEY AUTOINCREMENT,
                                         name TEXT NOT NULL UNIQUE,
                                         password TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conferences (
                                               id INTEGER PRIMARY KEY AUTOINCREMENT,
                                               name TEXT NOT NULL UNIQUE
    );

    -- Membership table: keeps track of which users belong to which conferences
    CREATE TABLE IF NOT EXISTS user_conference (
                                                   user_id        INTEGER NOT NULL,
                                                   conference_id  INTEGER NOT NULL,
                                                   PRIMARY KEY (user_id, conference_id),
                                                   FOREIGN KEY (user_id)       REFERENCES users(id)      ON DELETE CASCADE,
                                                   FOREIGN KEY (conference_id) REFERENCES conferences(id) ON DELETE CASCADE
    );

    -- Talk target: user → user
    CREATE TABLE IF NOT EXISTS user_user_targets (
                                                     user_id     INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
                                                     target_user INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
                                                     PRIMARY KEY (user_id, target_user)
    );

    -- Talk target: user → conference
    CREATE TABLE IF NOT EXISTS user_conf_targets (
                                                     user_id     INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
                                                     target_conf INTEGER NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
                                                     PRIMARY KEY (user_id, target_conf)
    );

    CREATE TABLE IF NOT EXISTS user_target_order (
                                                      user_id     INTEGER NOT NULL,
                                                      target_type TEXT    NOT NULL,
                                                      target_id   INTEGER NOT NULL,
                                                      position    INTEGER NOT NULL,
                                                      PRIMARY KEY (user_id, target_type, target_id)
    );

    CREATE TABLE IF NOT EXISTS feeds (
                                          id INTEGER PRIMARY KEY AUTOINCREMENT,
                                          name TEXT NOT NULL UNIQUE,
                                          password TEXT NOT NULL,
                                          login_token_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS user_feed_targets (
                                                      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                      feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
                                                      PRIMARY KEY (user_id, feed_id)
    );

    CREATE TABLE IF NOT EXISTS user_target_audio_state (
                                                           user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                           target_type TEXT    NOT NULL,
                                                           target_id   INTEGER NOT NULL,
                                                           muted       INTEGER NOT NULL DEFAULT 0,
                                                           volume      REAL    NOT NULL DEFAULT 0.9,
                                                           updated_at  TEXT    NOT NULL,
                                                           PRIMARY KEY (user_id, target_type, target_id)
    );

    CREATE TABLE IF NOT EXISTS productions (
                                                   id         INTEGER PRIMARY KEY AUTOINCREMENT,
                                                   name       TEXT NOT NULL UNIQUE,
                                                   is_primary INTEGER NOT NULL DEFAULT 0,
                                                   created_at TEXT NOT NULL,
                                                   updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS production_users (
                                                       production_id INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
                                                       user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                       is_admin      INTEGER NOT NULL DEFAULT 0,
                                                       PRIMARY KEY (production_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS production_conferences (
                                                             production_id INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
                                                             conference_id INTEGER NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
                                                             PRIMARY KEY (production_id, conference_id)
    );

    CREATE TABLE IF NOT EXISTS production_feeds (
                                                        production_id INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
                                                        feed_id       INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
                                                        PRIMARY KEY (production_id, feed_id)
    );

    CREATE TABLE IF NOT EXISTS production_user_conference (
                                                                  production_id INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
                                                                  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                                  conference_id INTEGER NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
                                                                  can_talk      INTEGER NOT NULL DEFAULT 1,
                                                                  PRIMARY KEY (production_id, user_id, conference_id),
                                                                  FOREIGN KEY (production_id, user_id)
                                                                    REFERENCES production_users(production_id, user_id) ON DELETE CASCADE,
                                                                  FOREIGN KEY (production_id, conference_id)
                                                                    REFERENCES production_conferences(production_id, conference_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS production_user_targets (
                                                             production_id INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
                                                             user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                             target_type   TEXT NOT NULL,
                                                             target_id     INTEGER NOT NULL,
                                                             PRIMARY KEY (production_id, user_id, target_type, target_id)
    );

    CREATE TABLE IF NOT EXISTS production_target_order (
                                                             production_id INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
                                                             user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                             target_type   TEXT NOT NULL,
                                                             target_id     INTEGER NOT NULL,
                                                             position      INTEGER NOT NULL,
                                                             PRIMARY KEY (production_id, user_id, target_type, target_id)
    );

    CREATE INDEX IF NOT EXISTS idx_production_users_user
      ON production_users(user_id, production_id);

    CREATE INDEX IF NOT EXISTS idx_production_targets_user
      ON production_user_targets(production_id, user_id, target_type, target_id);

    CREATE INDEX IF NOT EXISTS idx_production_conference_members
      ON production_user_conference(conference_id, production_id, user_id);

    CREATE TABLE IF NOT EXISTS schema_migrations (
                                                       key        TEXT PRIMARY KEY,
                                                       applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_bridge_endpoints (
                                                          user_id              INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                                          enabled              INTEGER NOT NULL DEFAULT 0,
                                                          bridge_device        TEXT    NOT NULL DEFAULT '',
                                                          production_id        INTEGER REFERENCES productions(id) ON DELETE SET NULL,
                                                          input_device         TEXT    NOT NULL DEFAULT '',
                                                          input_left_channel   INTEGER,
                                                          input_right_channel  INTEGER,
                                                          output_device        TEXT    NOT NULL DEFAULT '',
                                                          output_left_channel  INTEGER,
                                                          output_right_channel INTEGER,
                                                          trigger_mode         TEXT    NOT NULL DEFAULT 'external',
                                                          trigger_target_type  TEXT    NOT NULL DEFAULT '',
                                                          trigger_target_id    INTEGER,
                                                          trigger_threshold_db REAL    NOT NULL DEFAULT -45,
                                                          updated_at           TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feed_bridge_endpoints (
                                                          feed_id              INTEGER PRIMARY KEY REFERENCES feeds(id) ON DELETE CASCADE,
                                                          enabled              INTEGER NOT NULL DEFAULT 0,
                                                          bridge_device        TEXT    NOT NULL DEFAULT '',
                                                          production_id        INTEGER REFERENCES productions(id) ON DELETE SET NULL,
                                                          input_device         TEXT    NOT NULL DEFAULT '',
                                                          input_left_channel   INTEGER,
                                                          input_right_channel  INTEGER,
                                                          updated_at           TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS apple_ptt_channels (
                                                      user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                                                      channel_uuid TEXT    NOT NULL UNIQUE,
                                                      channel_name TEXT    NOT NULL,
                                                      updated_at   TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS apple_ptt_registrations (
                                                            id           INTEGER PRIMARY KEY AUTOINCREMENT,
                                                            user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                            channel_uuid TEXT    NOT NULL,
                                                            push_token   TEXT    NOT NULL UNIQUE,
                                                            created_at   TEXT    NOT NULL,
                                                            updated_at   TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS browser_sessions (
                                                      token_hash  TEXT PRIMARY KEY,
                                                      kind        TEXT    NOT NULL,
                                                      identity_id INTEGER NOT NULL,
                                                      name        TEXT    NOT NULL DEFAULT '',
                                                      source      TEXT    NOT NULL DEFAULT 'password',
                                                      created_at  INTEGER NOT NULL,
                                                      expires_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_browser_sessions_expires_at
      ON browser_sessions(expires_at);

    DROP TABLE IF EXISTS user_global_targets;
`);

ensureColumn("productions", "is_primary", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "is_superadmin", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "is_guest_profile", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("production_user_conference", "can_talk", "INTEGER NOT NULL DEFAULT 1");

// Conference membership now provides both conference reception and its talk
// button. Preserve installations that previously configured those separately.
// This must only run once: repeating it would re-add memberships an admin later
// intentionally removed from an individual production.
const productionScopeMigrationKey = "unified-production-matrix-v1";
const productionScopeMigrationApplied = db.prepare(`
  SELECT 1
  FROM schema_migrations
  WHERE key = ?
`).get(productionScopeMigrationKey);

if (!productionScopeMigrationApplied) {
  db.transaction(() => {
    db.exec(`
  INSERT OR IGNORE INTO user_conference (user_id, conference_id)
  SELECT user_id, target_conf
  FROM user_conf_targets;

  INSERT OR IGNORE INTO user_target_order (user_id, target_type, target_id, position)
  SELECT
    membership.user_id,
    'conference',
    membership.conference_id,
    COALESCE((
      SELECT MAX(existing.position) + 1
      FROM user_target_order existing
      WHERE existing.user_id = membership.user_id
    ), 0) + ROW_NUMBER() OVER (
      PARTITION BY membership.user_id
      ORDER BY membership.conference_id
    ) - 1
  FROM user_conference membership
  WHERE NOT EXISTS (
    SELECT 1
    FROM user_target_order existing
    WHERE existing.user_id = membership.user_id
      AND existing.target_type = 'conference'
      AND existing.target_id = membership.conference_id
  );

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

  INSERT OR IGNORE INTO production_user_conference (production_id, user_id, conference_id)
  SELECT target.production_id, target.user_id, target.target_id
  FROM production_user_targets target
  JOIN production_users production_member
    ON production_member.production_id = target.production_id
   AND production_member.user_id = target.user_id
  JOIN production_conferences production_conference
    ON production_conference.production_id = target.production_id
   AND production_conference.conference_id = target.target_id
  WHERE target.target_type = 'conference';

  DELETE FROM user_conf_targets;
  DELETE FROM production_user_targets WHERE target_type = 'conference';
    `);
    db.prepare(`
      INSERT INTO schema_migrations (key, applied_at)
      VALUES (?, ?)
    `).run(productionScopeMigrationKey, new Date().toISOString());
  })();
}

// Turn the former global matrix into the first real production. From this
// point on there is no special, undeletable "Default" layout: whichever
// production is marked primary is also the layout used in single mode.
const primaryProductionMigrationKey = "materialized-primary-production-v1";
const primaryProductionMigrationApplied = db.prepare(`
  SELECT 1 FROM schema_migrations WHERE key = ?
`).get(primaryProductionMigrationKey);

if (!primaryProductionMigrationApplied) {
  db.transaction(() => {
    let name = "Default";
    let suffix = 2;
    while (db.prepare("SELECT 1 FROM productions WHERE name = ?").get(name)) {
      name = `Default ${suffix++}`;
    }
    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO productions (name, is_primary, created_at, updated_at)
      VALUES (?, 1, ?, ?)
    `).run(name, now, now);
    const productionId = Number(result.lastInsertRowid);

    db.prepare(`
      INSERT OR IGNORE INTO production_users (production_id, user_id, is_admin)
      SELECT ?, id, 0 FROM users WHERE is_superadmin = 0
    `).run(productionId);
    db.prepare(`
      INSERT OR IGNORE INTO production_conferences (production_id, conference_id)
      SELECT ?, id FROM conferences
    `).run(productionId);
    db.prepare(`
      INSERT OR IGNORE INTO production_feeds (production_id, feed_id)
      SELECT ?, id FROM feeds
    `).run(productionId);
    db.prepare(`
      INSERT OR IGNORE INTO production_user_conference (production_id, user_id, conference_id)
      SELECT ?, membership.user_id, membership.conference_id
      FROM user_conference membership
      JOIN users user ON user.id = membership.user_id AND user.is_superadmin = 0
    `).run(productionId);
    db.prepare(`
      INSERT OR IGNORE INTO production_user_targets (production_id, user_id, target_type, target_id)
      SELECT ?, target.user_id, 'user', target.target_user
      FROM user_user_targets target
      JOIN users source ON source.id = target.user_id AND source.is_superadmin = 0
      JOIN users destination ON destination.id = target.target_user
        AND destination.is_superadmin = 0 AND destination.is_guest_profile = 0
    `).run(productionId);
    db.prepare(`
      INSERT OR IGNORE INTO production_user_targets (production_id, user_id, target_type, target_id)
      SELECT ?, target.user_id, 'feed', target.feed_id
      FROM user_feed_targets target
      JOIN users source ON source.id = target.user_id AND source.is_superadmin = 0
    `).run(productionId);
    db.prepare(`
      INSERT OR IGNORE INTO production_target_order
        (production_id, user_id, target_type, target_id, position)
      SELECT ?, ordering.user_id, ordering.target_type, ordering.target_id, ordering.position
      FROM user_target_order ordering
      JOIN users source ON source.id = ordering.user_id AND source.is_superadmin = 0
      WHERE ordering.target_type IN ('user', 'conference', 'feed')
    `).run(productionId);
    db.prepare(`
      INSERT INTO schema_migrations (key, applied_at) VALUES (?, ?)
    `).run(primaryProductionMigrationKey, now);
  })();
}

// Production-scoped conference memberships are authoritative. The former
// global rows have already been copied into the primary production by the
// migrations above and must not keep acting as a second, divergent model.
const retiredGlobalConferenceMembershipsKey = "retired-global-conference-memberships-v1";
const retiredGlobalConferenceMembershipsApplied = db.prepare(`
  SELECT 1 FROM schema_migrations WHERE key = ?
`).get(retiredGlobalConferenceMembershipsKey);

if (!retiredGlobalConferenceMembershipsApplied) {
  db.transaction(() => {
    db.exec(`
      DELETE FROM user_conf_targets;
      DELETE FROM user_conference;
      DELETE FROM user_target_order WHERE target_type = 'conference';
    `);
    db.prepare(`
      INSERT INTO schema_migrations (key, applied_at) VALUES (?, ?)
    `).run(retiredGlobalConferenceMembershipsKey, new Date().toISOString());
  })();
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.some((col) => col.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("users", "is_admin", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "is_superadmin", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "admin_must_change", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "is_guest_profile", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "login_token_hash", "TEXT");
ensureColumn("users", "last_online_at", "TEXT");
ensureColumn("users", "audio_settings", "TEXT NOT NULL DEFAULT '{}'");
ensureColumn("users", "panel_settings", "TEXT NOT NULL DEFAULT '{}'");
ensureColumn("feeds", "login_token_hash", "TEXT");
ensureColumn("user_bridge_endpoints", "trigger_mode", "TEXT NOT NULL DEFAULT 'external'");
ensureColumn("user_bridge_endpoints", "trigger_target_type", "TEXT NOT NULL DEFAULT ''");
ensureColumn("user_bridge_endpoints", "trigger_target_id", "INTEGER");
ensureColumn("user_bridge_endpoints", "trigger_threshold_db", "REAL NOT NULL DEFAULT -45");
ensureColumn("user_bridge_endpoints", "production_id", "INTEGER REFERENCES productions(id) ON DELETE SET NULL");
ensureColumn("feed_bridge_endpoints", "production_id", "INTEGER REFERENCES productions(id) ON DELETE SET NULL");

// Bridge endpoints are global inputs/outputs. Production membership only
// controls which browser clients can see and use the associated user/feed.
db.exec(`
  UPDATE user_bridge_endpoints SET production_id = NULL WHERE production_id IS NOT NULL;
  UPDATE feed_bridge_endpoints SET production_id = NULL WHERE production_id IS NOT NULL;
`);

module.exports = db;
