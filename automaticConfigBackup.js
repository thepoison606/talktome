const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const AUTO_BACKUP_INTERVAL_DAYS = Object.freeze([1, 3, 7, 14, 30]);
const DEFAULT_AUTO_BACKUP_INTERVAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const MAX_TIMER_MS = DAY_MS;
const BACKUP_PREFIX = 'talktome-config-auto-';

function normalizeAutomaticBackupSettings(value, { strict = false } = {}) {
  if (strict && (!value || typeof value !== 'object' || Array.isArray(value))) {
    throw new Error('Automatic backup settings must be an object');
  }
  if (strict && typeof value.enabled !== 'boolean') {
    throw new Error('Automatic backup enabled must be true or false');
  }
  const intervalDays = value?.intervalDays == null
    ? DEFAULT_AUTO_BACKUP_INTERVAL_DAYS
    : Number(value.intervalDays);
  if (strict && !AUTO_BACKUP_INTERVAL_DAYS.includes(intervalDays)) {
    throw new Error('Unsupported automatic backup interval');
  }
  return {
    enabled: value?.enabled === true,
    intervalDays: AUTO_BACKUP_INTERVAL_DAYS.includes(intervalDays)
      ? intervalDays
      : DEFAULT_AUTO_BACKUP_INTERVAL_DAYS,
  };
}

function latestAutomaticBackupAt(directory) {
  if (!fs.existsSync(directory)) return null;
  let latest = null;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(BACKUP_PREFIX) || !entry.name.endsWith('.json')) continue;
    const modifiedAt = fs.statSync(path.join(directory, entry.name)).mtimeMs;
    if (Number.isFinite(modifiedAt) && (latest === null || modifiedAt > latest)) latest = modifiedAt;
  }
  return latest;
}

function writeAutomaticBackup(directory, bundle, now = Date.now()) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const filename = `${BACKUP_PREFIX}${stamp}-${crypto.randomUUID().slice(0, 8)}.json`;
  const destination = path.join(directory, filename);
  const temporary = path.join(directory, `.${filename}.tmp`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(bundle, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, destination);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
  return destination;
}

function createAutomaticConfigBackup({ directory, getSettings, buildBundle, logger = console, now = Date.now }) {
  let timer = null;
  let retryAt = 0;
  let lastError = null;

  function getStatus() {
    const settings = normalizeAutomaticBackupSettings(getSettings());
    let latestAt = null;
    try {
      latestAt = latestAutomaticBackupAt(directory);
    } catch (error) {
      lastError = error.message;
    }
    const dueAt = latestAt === null ? now() : latestAt + settings.intervalDays * DAY_MS;
    const nextAt = settings.enabled ? Math.max(dueAt, retryAt) : null;
    return {
      ...settings,
      directory,
      lastBackupAt: latestAt === null ? null : new Date(latestAt).toISOString(),
      nextBackupAt: nextAt === null ? null : new Date(nextAt).toISOString(),
      lastError,
    };
  }

  function runNow() {
    try {
      const destination = writeAutomaticBackup(directory, buildBundle(), now());
      retryAt = 0;
      lastError = null;
      logger.log(`[BACKUP] Saved automatic configuration backup: ${destination}`);
      return destination;
    } catch (error) {
      lastError = error.message;
      retryAt = now() + RETRY_MS;
      logger.error(`[BACKUP] Automatic configuration backup failed: ${error.message}`);
      return null;
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = null;
    const settings = normalizeAutomaticBackupSettings(getSettings());
    if (!settings.enabled) return;
    let latestAt;
    try {
      latestAt = latestAutomaticBackupAt(directory);
    } catch (error) {
      lastError = error.message;
      retryAt = now() + RETRY_MS;
      logger.error(`[BACKUP] Failed to inspect automatic backups: ${error.message}`);
      latestAt = null;
    }
    const dueAt = latestAt === null ? now() : latestAt + settings.intervalDays * DAY_MS;
    const delay = Math.max(0, Math.min(Math.max(dueAt, retryAt) - now(), MAX_TIMER_MS));
    timer = setTimeout(() => {
      timer = null;
      const status = getStatus();
      if (status.nextBackupAt && Date.parse(status.nextBackupAt) <= now()) {
        runNow();
      }
      schedule();
    }, delay);
    timer.unref?.();
  }

  function settingsChanged({ createImmediately = false } = {}) {
    retryAt = 0;
    lastError = null;
    if (createImmediately && normalizeAutomaticBackupSettings(getSettings()).enabled) runNow();
    schedule();
    return getStatus();
  }

  return { getStatus, runNow, schedule, settingsChanged };
}

module.exports = {
  AUTO_BACKUP_INTERVAL_DAYS,
  normalizeAutomaticBackupSettings,
  latestAutomaticBackupAt,
  writeAutomaticBackup,
  createAutomaticConfigBackup,
};
