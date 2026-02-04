const fs = require("fs");
const os = require("os");
const path = require("path");

const APP_DIR_NAME = "talktome";

function getDataDir() {
  const override = process.env.TALKTOME_DATA_DIR;
  if (override && String(override).trim()) {
    return path.resolve(override);
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_DIR_NAME);
  }

  if (process.platform === "win32") {
    const base =
      process.env.LOCALAPPDATA ||
      process.env.APPDATA ||
      path.join(os.homedir(), "AppData", "Local");
    return path.join(base, APP_DIR_NAME);
  }

  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, APP_DIR_NAME);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDataFile(filename) {
  const dir = ensureDir(getDataDir());
  return path.join(dir, filename);
}

module.exports = {
  getDataDir,
  ensureDir,
  getDataFile,
};
