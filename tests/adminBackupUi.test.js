const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/admin.js', 'utf8');

function runFunction(name, endMarker, globals) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(endMarker, start);
  const context = vm.createContext(globals);
  vm.runInContext(source.slice(start, end), context);
  return context;
}

test('backup import requires a file and shows its filename as text', () => {
  const filename = { textContent: '' };
  const input = { files: [] };
  const button = { disabled: false };
  const context = runFunction('syncConfigImportSelection', 'configImportFile?.addEventListener', {
    configImportFile: input, configImportBtn: button,
    document: { getElementById: () => filename },
  });
  context.syncConfigImportSelection();
  assert.equal(button.disabled, true);
  input.files = [{ name: 'backup-2026-10-05.json' }];
  context.syncConfigImportSelection();
  assert.equal(button.disabled, false);
  assert.equal(filename.textContent, input.files[0].name);
  input.files = [];
  context.syncConfigImportSelection();
  assert.equal(button.disabled, true);
  assert.equal(filename.textContent, 'No file selected');
});

test('automatic backups expand their details and distinguish unsaved schedules', () => {
  const nodes = Object.fromEntries(['details', 'interval-field', 'status', 'error', 'next'].map(key => [`config-auto-backup-${key}`, { hidden: true, dataset: { savedValue: 'Disabled' } }]));
  const times = [{ hidden: true }, { hidden: true }];
  const enabled = { checked: false };
  const interval = { value: '7' };
  const context = runFunction('syncAutomaticBackupVisibility', 'async function loadAutomaticBackupSettings', {
    automaticBackupForm: { classList: { toggle() {} }, querySelectorAll: () => times },
    automaticBackupEnabled: enabled, automaticBackupInterval: interval,
    savedAutomaticBackupSettings: { enabled: false, intervalDays: 7 },
    document: { getElementById: id => nodes[id] },
  });
  context.syncAutomaticBackupVisibility();
  assert.equal(nodes['config-auto-backup-details'].hidden, true);
  enabled.checked = true;
  context.syncAutomaticBackupVisibility();
  assert.equal(nodes['config-auto-backup-details'].hidden, false);
  assert.ok(times.every(time => !time.hidden));
  assert.equal(nodes['config-auto-backup-next'].textContent, 'Updating…');
  context.savedAutomaticBackupSettings.enabled = true;
  nodes['config-auto-backup-next'].dataset.savedValue = 'Tomorrow';
  context.syncAutomaticBackupVisibility();
  assert.equal(nodes['config-auto-backup-next'].textContent, 'Tomorrow');
  interval.value = '14';
  context.syncAutomaticBackupVisibility();
  assert.equal(nodes['config-auto-backup-next'].textContent, 'Updating…');
  enabled.checked = false;
  context.syncAutomaticBackupVisibility();
  assert.equal(nodes['config-auto-backup-details'].hidden, true);
});
