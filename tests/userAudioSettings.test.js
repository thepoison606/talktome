const PROJECT_ROOT = require('./helpers/projectRoot');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DEFAULTS, normalize, resolve } = require('../public/userAudioSettings');

test('normalizes complete per-user audio settings', () => {
  assert.deepEqual(normalize({
    audioProfile: 'low',
    dimAmountDb: -18,
    dimFeedsWhileSpeaking: true,
    dimWhenAddressed: false,
    audioAutoProcessing: true,
    playConnectionSounds: false,
    showIncomingLevels: true,
    leftHandMode: true,
    lockMultipleTargets: true,
    userInputGainDb: 12.5,
    voiceTriggerEnabled: true,
    voiceTriggerTarget: 'conference:42',
    voiceTriggerThresholdDb: -28,
  }, { strict: true }), {
    audioProfile: 'low',
    dimAmountDb: -18,
    dimFeedsWhileSpeaking: true,
    dimWhenAddressed: false,
    audioAutoProcessing: true,
    playConnectionSounds: false,
    showIncomingLevels: true,
    leftHandMode: true,
    lockMultipleTargets: true,
    userInputGainDb: 12.5,
    voiceTriggerEnabled: true,
    voiceTriggerTarget: 'conference:42',
    voiceTriggerThresholdDb: -28,
  });
});

test('resolves missing values and rejects unsafe settings', () => {
  assert.deepEqual(resolve(null), DEFAULTS);
  assert.equal(resolve({}).showIncomingLevels, false);
  assert.equal(resolve({ showIncomingLevels: true }).showIncomingLevels, true);
  assert.throws(() => normalize({ showIncomingLevels: 'true' }, { strict: true }), /boolean/);
  assert.throws(() => normalize({ userInputGainDb: 80 }, { strict: true }), /mic gain/);
  for (const gain of [-40, 40]) {
    assert.equal(normalize({ userInputGainDb: gain }, { strict: true }).userInputGainDb, gain);
  }
  for (const gain of [-41, 41]) {
    assert.throws(() => normalize({ userInputGainDb: gain }, { strict: true }), /mic gain/);
  }
  assert.throws(() => normalize({ voiceTriggerTarget: 'feed:1' }, { strict: true }), /trigger target/);
});

test('admin and client share the per-user audio settings model', () => {
  const adminHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'admin.html'), 'utf8');
  const clientHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'index.html'), 'utf8');
  const adminScript = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'admin.js'), 'utf8');
  const clientScript = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'client.js'), 'utf8');
  const serverScript = fs.readFileSync(path.join(PROJECT_ROOT, 'src/server/serverCore.js'), 'utf8');

  assert.match(adminHtml, /src="\/userAudioSettings\.js"/);
  assert.match(clientHtml, /src="\/userAudioSettings\.js"/);
  assert.match(adminScript, /openUserAudioSettings/);
  assert.match(adminScript, /class="small user-settings-button"[\s\S]*?<span>Audio<\/span>[\s\S]*?<svg/);
  assert.doesNotMatch(adminScript, /class="small icon-button user-settings/);
  assert.match(clientScript, /user-audio-settings-update/);
  assert.match(clientScript, /user-audio-settings-updated/);
  assert.match(serverScript, /configuredAsBridge: Boolean\(user\.bridge_enabled\)/);
  assert.match(adminHtml, /id="user-audio-settings-notice"[\s\S]*?do not affect Bridge audio/);
  assert.match(adminScript, /userAudioSettingsNotice\?\.classList\.toggle\('is-hidden', !payload\.configuredAsBridge\)/);
});

test('bridge endpoint browser login requires an explicit confirmation', () => {
  const clientHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'index.html'), 'utf8');
  const clientScript = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'client.js'), 'utf8');
  const serverScript = fs.readFileSync(path.join(PROJECT_ROOT, 'src/server/serverCore.js'), 'utf8');

  assert.match(clientHtml, /id="bridge-login-panel"[\s\S]*?may disconnect an active Bridge session/);
  assert.match(clientScript, /confirmBridgeBrowserLogin/);
  assert.match(clientScript, /if \(!bridgeLoginConfirmed\)/);
  assert.match(serverScript, /configuredAsBridge: kind === "user" && Boolean\(storedUser\?\.bridge_enabled\)/);
});


test('main button override is optional and does not turn a default into a forced preference', () => {
  assert.equal(resolve({}, { bigMainButton: true }).bigMainButton, undefined);
  assert.equal(resolve({ bigMainButton: false }, { bigMainButton: true }).bigMainButton, false);
  assert.throws(() => normalize({ bigMainButton: 'true' }, { strict: true }), /boolean/);
});
