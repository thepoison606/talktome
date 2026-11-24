const AUDIO_PROFILES = Object.freeze(["ultra-low", "low", "standard"]);
const DIM_AMOUNT_DB_OPTIONS = Object.freeze([-6, -12, -15, -18, -24]);
const TARGET_COLOR_KEYS = new Set(require("../../public/targetColors.json").map(({ value }) => value));
const BUILTIN_TARGET_APPEARANCE = Object.freeze({
  colors: Object.freeze({}),
  keepBackgroundWhileTalking: false,
});

const BUILTIN_DEFAULT_CLIENT_SETTINGS = Object.freeze({
  audioProfile: "ultra-low",
  dimAmountDb: -15,
  dimFeedsWhileSpeaking: false,
  dimWhenAddressed: true,
  audioAutoProcessing: false,
  playConnectionSounds: true,
  showIncomingLevels: false,
  leftHandMode: false,
  bigMainButton: false,
  lockMultipleTargets: false,
  tapToLock: true,
  allowTargetRearrange: true,
  allowTargetAddRemove: false,
  allowFeedVideo: false,
  targetAppearance: BUILTIN_TARGET_APPEARANCE,
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

  for (const key of DEFAULT_CLIENT_SETTING_KEYS) {
    if (typeof BUILTIN_DEFAULT_CLIENT_SETTINGS[key] !== "boolean") continue;
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (typeof value[key] === "boolean") normalized[key] = value[key];
    else reject(`Invalid boolean value for ${key}.`);
  }

  if (Object.prototype.hasOwnProperty.call(value, "targetAppearance")) {
    const appearance = value.targetAppearance;
    if (!appearance || typeof appearance !== "object" || Array.isArray(appearance)) {
      reject("Invalid target appearance settings.");
      return normalized;
    }
    const { colors, keepBackgroundWhileTalking } = appearance;
    const overrides = {};
    if (colors && typeof colors === "object" && !Array.isArray(colors)) {
      for (const [key, color] of Object.entries(colors)) {
        if (!TARGET_COLOR_KEYS.has(key) || typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) {
          reject("Invalid target palette color.");
        } else if (color.toLowerCase() !== key) {
          overrides[key] = color.toLowerCase();
        }
      }
    } else if (colors !== undefined) {
      reject("Target palette colors must be an object.");
    }
    if (keepBackgroundWhileTalking !== undefined && typeof keepBackgroundWhileTalking !== "boolean") {
      reject("Invalid background setting for talk.");
    }
    normalized.targetAppearance = {
      colors: overrides,
      keepBackgroundWhileTalking: keepBackgroundWhileTalking === true,
    };
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

function normalizeApplyToAll(value, settings) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(key => !DEFAULT_CLIENT_SETTING_KEYS.includes(key)
      || typeof BUILTIN_DEFAULT_CLIENT_SETTINGS[key] !== 'boolean'
      || typeof settings[key] !== 'boolean')) throw new Error('Invalid applyToAll settings.');
  return [...new Set(value)];
}

module.exports = {
  normalizeApplyToAll,
  AUDIO_PROFILES,
  DIM_AMOUNT_DB_OPTIONS,
  BUILTIN_DEFAULT_CLIENT_SETTINGS,
  normalizeConfiguredDefaultClientSettings,
  resolveDefaultClientSettings,
  serializeDefaultClientSettingsScript,
};
