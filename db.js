// db.js
const Database = require("better-sqlite3");
const db = new Database("app.db");

// Tabellen initialisieren (einmalig)
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

  CREATE TABLE IF NOT EXISTS user_conference (
    user_id INTEGER,
    conference_id INTEGER,
    PRIMARY KEY (user_id, conference_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (conference_id) REFERENCES conferences(id)
  );
`);

module.exports = db;
