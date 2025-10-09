// db.js
const Database = require("better-sqlite3");
const db = new Database("app.db");

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

    DROP TABLE IF EXISTS user_global_targets;
`);

module.exports = db;
