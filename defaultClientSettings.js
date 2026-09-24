const AUDIO_PROFILES = Object.freeze(["ultra-low", "low", "standard"]);
const DIM_AMOUNT_DB_OPTIONS = Object.freeze([-6, -12, -15, -18, -24]);

const BUILTIN_DEFAULT_CLIENT_SETTINGS = Object.freeze({
  audioProfile: "ultra-low",
  dimAmountDb: -15,
  dimFeedsWhileSpeaking: false,
  dimWhenAddressed: true,
  audioAutoProcessing: false,
  playConnectionSounds: true,
  leftHandMode: false,
  lockMultipleTargets: false,
});

const DEFAULT_CLIENT_SETTING_KEYS = Object.freeze(Object.keys(BUILTIN_DEFAULT_CLIENT_SETTINGS));

function normalizeConfiguredDefaultClientSettings(value, { strict = false } = {}) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (strict) throw new Error("Default client settings must be an object.");
    return {};
  }

  const normalized = {};
  const reject = (message) => {
    if (strict) throw new Error(message);
  };

  if (Object.prototype.hasOwnProperty.call(value, "audioProfile")) {
    if (AUDIO_PROFILES.includes(value.audioProfile)) normalized.audioProfile = value.audioProfile;
    else reject("Invalid default audio profile.");
  }

  if (Object.prototype.hasOwnProperty.call(value, "dimAmountDb")) {
    const dimAmountDb = Number(value.dimAmountDb) === -14 ? -15 : Number(value.dimAmountDb);
    if (DIM_AMOUNT_DB_OPTIONS.includes(dimAmountDb)) normalized.dimAmountDb = dimAmountDb;
    else reject("Invalid default dim amount.");
  }

  for (const key of DEFAULT_CLIENT_SETTING_KEYS.filter((entry) => (
    entry !== "audioProfile" && entry !== "dimAmountDb"
  ))) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (typeof value[key] === "boolean") normalized[key] = value[key];
    else reject(`Invalid boolean value for ${key}.`);
  }

  return normalized;
}

function resolveDefaultClientSettings(value) {
  return {
    ...BUILTIN_DEFAULT_CLIENT_SETTINGS,
    ...normalizeConfiguredDefaultClientSettings(value),
  };
}

function serializeDefaultClientSettingsScript(value) {
  const json = JSON.stringify(normalizeConfiguredDefaultClientSettings(value))
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `window.TALKTOME_DEFAULT_CLIENT_SETTINGS = ${json};\n`;
}

module.exports = {
  AUDIO_PROFILES,
  DIM_AMOUNT_DB_OPTIONS,
  BUILTIN_DEFAULT_CLIENT_SETTINGS,
  normalizeConfiguredDefaultClientSettings,
  resolveDefaultClientSettings,
  serializeDefaultClientSettingsScript,
};
