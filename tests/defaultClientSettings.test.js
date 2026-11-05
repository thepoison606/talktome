const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BUILTIN_DEFAULT_CLIENT_SETTINGS,
  normalizeConfiguredDefaultClientSettings,
  resolveDefaultClientSettings,
  serializeDefaultClientSettingsScript,
} = require("../src/server/defaultClientSettings");
const { resolve: resolveUserAudioSettings } = require("../public/userAudioSettings");

test("resolves built-in client defaults when no server settings exist", () => {
  assert.deepEqual(resolveDefaultClientSettings(null), BUILTIN_DEFAULT_CLIENT_SETTINGS);
  assert.equal(resolveDefaultClientSettings(null).showIncomingLevels, false);
  assert.equal(resolveDefaultClientSettings(null).allowTargetRearrange, true);
  assert.equal(resolveDefaultClientSettings(null).bigMainButton, false);
});

test("big main button is a validated, serializable server default", () => {
  assert.equal(resolveDefaultClientSettings({ bigMainButton: true }).bigMainButton, true);
  assert.equal(resolveDefaultClientSettings({ bigMainButton: false }).bigMainButton, false);
  assert.throws(() => normalizeConfiguredDefaultClientSettings({ bigMainButton: 'true' }, { strict: true }), /Invalid boolean value/);
  assert.equal(serializeDefaultClientSettingsScript({ bigMainButton: true }),
    'window.TALKTOME_DEFAULT_CLIENT_SETTINGS = {"bigMainButton":true};\n');
});

test("keeps only valid configured client defaults", () => {
  assert.deepEqual(normalizeConfiguredDefaultClientSettings({
    audioProfile: "standard",
    dimAmountDb: -18,
    dimFeedsWhileSpeaking: true,
    showIncomingLevels: true,
    allowTargetRearrange: false,
    unknown: "ignored",
  }), {
    audioProfile: "standard",
    dimAmountDb: -18,
    dimFeedsWhileSpeaking: true,
    showIncomingLevels: true,
    allowTargetRearrange: false,
  });
});

test("rejects invalid admin client defaults in strict mode", () => {
  assert.throws(
    () => normalizeConfiguredDefaultClientSettings({ audioProfile: "studio" }, { strict: true }),
    /Invalid default audio profile/
  );
  assert.throws(
    () => normalizeConfiguredDefaultClientSettings({ leftHandMode: "yes" }, { strict: true }),
    /Invalid boolean value/
  );
  assert.throws(
    () => normalizeConfiguredDefaultClientSettings({ showIncomingLevels: "true" }, { strict: true }),
    /Invalid boolean value/
  );
});

test("serializes client defaults as a safe browser script", () => {
  const script = serializeDefaultClientSettingsScript({
    audioProfile: "low",
    lockMultipleTargets: true,
    showIncomingLevels: true,
  });
  assert.equal(
    script,
    'window.TALKTOME_DEFAULT_CLIENT_SETTINGS = {"audioProfile":"low","showIncomingLevels":true,"lockMultipleTargets":true};\n'
  );
});

test("incoming meter defaults apply until a user saves an explicit preference", () => {
  const enabled = resolveDefaultClientSettings({ showIncomingLevels: true });
  assert.equal(resolveUserAudioSettings({}, enabled).showIncomingLevels, true);
  assert.equal(resolveUserAudioSettings({ showIncomingLevels: false }, enabled).showIncomingLevels, false);
  const disabled = resolveDefaultClientSettings({ showIncomingLevels: false });
  assert.equal(resolveUserAudioSettings({ showIncomingLevels: true }, disabled).showIncomingLevels, true);
});

test('feed video defaults to off and only accepts boolean configuration', () => {
  assert.equal(resolveDefaultClientSettings({}).allowFeedVideo, false);
  assert.equal(resolveDefaultClientSettings({ allowFeedVideo: true }).allowFeedVideo, true);
  assert.throws(() => normalizeConfiguredDefaultClientSettings({ allowFeedVideo: 'true' }, { strict: true }), /boolean/);
});
