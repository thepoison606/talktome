const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  normalizeAutomaticBackupSettings,
  createAutomaticConfigBackup,
} = require('./automaticConfigBackup');

test('automatic backups are off by default and reject unsupported intervals', () => {
  assert.deepEqual(normalizeAutomaticBackupSettings(), { enabled: false, intervalDays: 7 });
  assert.throws(() => normalizeAutomaticBackupSettings({ enabled: true, intervalDays: 2 }, { strict: true }));
  assert.throws(() => normalizeAutomaticBackupSettings({ enabled: 'true', intervalDays: 7 }, { strict: true }));
});

test('automatic backup writes the export bundle privately and schedules from the saved file', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'talktome-auto-backup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'backups');
  const settings = { enabled: true, intervalDays: 1 };
  const bundle = { format: 'talktome-config', version: 1, database: { users: [] } };
  const manager = createAutomaticConfigBackup({
    directory,
    getSettings: () => settings,
    buildBundle: () => bundle,
    logger: { log() {}, error() {} },
  });
  manager.schedule();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const files = fs.readdirSync(directory);
  assert.equal(files.length, 1);
  const file = path.join(directory, files[0]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), bundle);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  const status = manager.getStatus();
  assert.equal(status.enabled, true);
  assert.ok(status.lastBackupAt);
  assert.ok(Date.parse(status.nextBackupAt) > Date.parse(status.lastBackupAt));
  manager.schedule();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fs.readdirSync(directory).length, 1);

  const overdue = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  fs.utimesSync(file, overdue, overdue);
  manager.schedule();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fs.readdirSync(directory).length, 2);
});

test('a failed backup reports the error and delays the next attempt', () => {
  const directory = path.join(os.tmpdir(), `talktome-auto-backup-failure-${process.pid}-${Date.now()}`);
  const manager = createAutomaticConfigBackup({
    directory,
    getSettings: () => ({ enabled: true, intervalDays: 7 }),
    buildBundle: () => { throw new Error('database unavailable'); },
    logger: { log() {}, error() {} },
  });
  assert.equal(manager.runNow(), null);
  const status = manager.getStatus();
  assert.equal(status.lastError, 'database unavailable');
  assert.ok(Date.parse(status.nextBackupAt) > Date.now());
});
