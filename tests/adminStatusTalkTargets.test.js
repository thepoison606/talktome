const PROJECT_ROOT = require('./helpers/projectRoot');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.join(PROJECT_ROOT, 'src/server/serverCore.js'), 'utf8');
const admin = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'admin.html'), 'utf8');

test('admin status resolves active talk targets to display names', () => {
  assert.match(server, /function buildAdminStatusTalkTargets\(targets, usersById, conferencesById\)/);
  assert.match(server, /name: usersById\.get\(String\(target\.id\)\)\?\.name \|\| `User \$\{target\.id\}`/);
  assert.match(server, /name: conferencesById\.get\(String\(target\.id\)\)\?\.name \|\| `Conference \$\{target\.id\}`/);
  assert.match(server, /talkTargets,/);
});

test('talking users show an arrow and their active target names', () => {
  assert.match(admin, /return `→ \$\{names\.length > 0 \? names\.join\(', '\) : 'Target'\}`/);
  assert.match(admin, /talkingLabel: formatStatusTalkTargetLabel\(user\)/);
  assert.match(adminHtml, /@keyframes statusTalkingLedPulse/);
  assert.match(adminHtml, /\.status-indicator__dot\.is-talking \{\s*background: #8b5cf6;\s*animation: statusTalkingLedPulse/);
  assert.match(admin, /Date\.now\(\) % STATUS_TALKING_PULSE_MS/);
  assert.match(adminHtml, /animation-delay: var\(--status-talking-animation-delay, 0ms\)/);
  assert.doesNotMatch(adminHtml, /statusTalkingLedBlink/);
});

test('admin status exposes and conditionally renders the active production', () => {
  assert.match(server, /const multipleProductionsEnabled = areMultipleProductionsEnabled\(\)/);
  assert.match(server, /activeProduction: activeProduction/);
  assert.match(server, /multipleProductionsEnabled,/);
  assert.match(admin, /const showProductionColumn = payload\.multipleProductionsEnabled === true/);
  assert.match(admin, /user\.activeProduction\?\.name/);
  assert.match(adminHtml, /<th data-status-production-column data-sort-key="Production" hidden>/);
});

test('status tables reserve less space for short names than detailed client data', () => {
  const width = name => Number(adminHtml.match(new RegExp(`^      \\.status-col--${name} \\{ width: ([\\d.]+)%; \\}`, 'm'))?.[1]);
  assert.ok(width('name') < width('client'));
  assert.ok(width('version') < width('client'));
  assert.ok(width('battery') < width('version'));
  assert.equal((adminHtml.match(/<col class="status-col--status">\s*<col class="status-col--name">/g) || []).length, 4);
  assert.equal((adminHtml.match(/class="status-col--production" data-status-production-column hidden/g) || []).length, 4);
  assert.match(admin, /document\.querySelectorAll\('#status-section \.status-table'\)/);
  assert.match(admin, /status-production-spacer/);
});
