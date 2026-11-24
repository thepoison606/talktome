const PROJECT_ROOT = require('./helpers/projectRoot');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'admin.html'), 'utf8');
const script = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'admin.js'), 'utf8');

test('mobile admin forms and navigation fit the viewport', () => {
  assert.match(html, /\.admin-bar__nav\s*\{[^}]*justify-content:\s*space-between;[^}]*overflow-x:\s*hidden;/s);
  assert.match(html, /\.entity-sidebar \.entity-create-form \.password-input-wrap,[\s\S]*?inline-size:\s*100%;/);
  assert.match(html, /\.entity-sidebar \.entity-create-form button\[type='submit'\][\s\S]*?width:\s*100%;/);
  assert.match(html, /\.entity-sidebar \.entity-create-form\s*\{[^}]*display:\s*grid;[^}]*gap:\s*0\.55rem;/s);
  assert.match(html, /\.entity-sidebar \.entity-create-form \.field-group\s*\{[^}]*display:\s*contents;/s);
  assert.match(html, /:is\(#user-form, #conf-form, #feed-form\)\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  assert.match(html, /:is\(#user-form, #conf-form, #feed-form\) > button\[type='submit'\][\s\S]*?width:\s*100% !important;/);
  assert.match(html, /:is\(#user-form, #feed-form\) > \.field-group > \.password-input-wrap > input\s*\{[^}]*width:\s*100% !important;/s);
  assert.match(script, /matchMedia\?\.\('\(hover: none\) and \(pointer: coarse\)'\)[\s\S]*?link\.blur\(\)/);
});

test('matrix controls suppress double-tap zoom', () => {
  assert.match(html, /\.target-matrix-toggle\s*\{[^}]*touch-action:\s*manipulation;/s);
  assert.match(script, /container\.addEventListener\('dblclick',[\s\S]*?event\.preventDefault\(\);/);
});

test('target button ordering supports touch pointers', () => {
  assert.match(html, /\.drag-handle\s*\{[^}]*touch-action:\s*none;/s);
  assert.match(script, /function initTouchTargetOrdering\(/);
  assert.match(script, /list\.addEventListener\('pointerdown'/);
  assert.match(script, /list\.addEventListener\('pointermove'/);
  assert.match(script, /initTouchTargetOrdering\(list, \(\) => saveProductionTargetOrder/);
  assert.match(script, /initTouchTargetOrdering\(ul, \(\) => saveTargetOrder/);
});

test('user audio settings dialog remains compact on regular screens', () => {
  assert.match(html, /\.user-audio-settings-dialog__panel\s*\{[^}]*width:\s*min\(44rem,\s*100%\);[^}]*font-size:\s*0\.86rem;/s);
  assert.match(html, /\.user-audio-settings-dialog__header h2\s*\{[^}]*font-size:\s*1\.15rem;[^}]*font-weight:\s*650;/s);
  assert.match(html, /\.user-audio-settings-dialog button\.user-audio-settings-dialog__close,\s*button\.image-lightbox__close\s*\{[^}]*width:\s*2\.2rem;[^}]*height:\s*2\.2rem;[^}]*aspect-ratio:\s*1;/s);
  assert.match(html, /\.user-audio-settings-form\s*\{[^}]*gap:\s*0\.5rem;/s);
  assert.match(html, /\.user-audio-settings-row select\s*\{[^}]*height:\s*2\.15rem;/s);
  assert.match(html, /\.user-audio-settings-range input\[type='range'\]\s*\{[^}]*height:\s*1\.15rem;/s);
  assert.match(html, /user-audio-settings-dialog__actions admin-action-dialog__actions/);
  assert.match(html, /id="user-audio-settings-cancel" class="admin-action-dialog__cancel"/);
  assert.match(html, /id="user-audio-settings-save" class="admin-action-dialog__confirm"/);
  assert.match(html, /\.admin-action-dialog__actions button,\s*\.user-audio-settings-dialog__close,\s*\.image-lightbox__close\s*\{[^}]*height:\s*2\.2rem;[^}]*min-height:\s*0;[^}]*padding:\s*0\.4rem 0\.75rem;[^}]*font-size:\s*0\.8rem;/s);
});
