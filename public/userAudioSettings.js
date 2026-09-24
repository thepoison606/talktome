(function initUserAudioSettings(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TalktomeUserAudioSettings = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createUserAudioSettingsApi() {
  const AUDIO_PROFILES = Object.freeze(['ultra-low', 'low', 'standard']);
  const DIM_AMOUNT_DB_OPTIONS = Object.freeze([-6, -12, -15, -18, -24]);
  const DEFAULTS = Object.freeze({
    audioProfile: 'ultra-low',
    dimAmountDb: -15,
    dimFeedsWhileSpeaking: false,
    dimWhenAddressed: true,
    audioAutoProcessing: false,
    playConnectionSounds: true,
    leftHandMode: false,
    lockMultipleTargets: false,
    userInputGainDb: 18,
    voiceTriggerEnabled: false,
    voiceTriggerTarget: '',
    voiceTriggerThresholdDb: -32,
  });

  function normalize(value, { strict = false, partial = false } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      if (strict) throw new Error('Audio settings must be an object.');
      return partial ? {} : { ...DEFAULTS };
    }
    const output = partial ? {} : { ...DEFAULTS };
    const reject = (message) => {
      if (strict) throw new Error(message);
    };
    const has = (key) => Object.prototype.hasOwnProperty.call(value, key);

    if (has('audioProfile')) {
      if (AUDIO_PROFILES.includes(value.audioProfile)) output.audioProfile = value.audioProfile;
      else reject('Invalid audio profile.');
    }
    if (has('dimAmountDb')) {
      const number = Number(value.dimAmountDb) === -14 ? -15 : Number(value.dimAmountDb);
      if (DIM_AMOUNT_DB_OPTIONS.includes(number)) output.dimAmountDb = number;
      else reject('Invalid dim amount.');
    }
    ['dimFeedsWhileSpeaking', 'dimWhenAddressed', 'audioAutoProcessing', 'playConnectionSounds', 'leftHandMode', 'lockMultipleTargets', 'voiceTriggerEnabled']
      .forEach((key) => {
        if (!has(key)) return;
        if (typeof value[key] === 'boolean') output[key] = value[key];
        else reject(`Invalid boolean value for ${key}.`);
      });
    if (has('userInputGainDb')) {
      const number = Number(value.userInputGainDb);
      if (Number.isFinite(number) && number >= -30 && number <= 40) output.userInputGainDb = Math.round(number * 2) / 2;
      else reject('Invalid manual mic gain.');
    }
    if (has('voiceTriggerThresholdDb')) {
      const number = Number(value.voiceTriggerThresholdDb);
      if (Number.isFinite(number) && number >= -60 && number <= -6) output.voiceTriggerThresholdDb = Math.round(number);
      else reject('Invalid level trigger threshold.');
    }
    if (has('voiceTriggerTarget')) {
      const target = String(value.voiceTriggerTarget || '').trim();
      if (!target || /^(user|conference):\d+$/.test(target)) output.voiceTriggerTarget = target;
      else reject('Invalid level trigger target.');
    }
    return output;
  }

  function resolve(value, configuredDefaults = {}) {
    return {
      ...DEFAULTS,
      ...normalize(configuredDefaults, { partial: true }),
      ...normalize(value, { partial: true }),
    };
  }

  return Object.freeze({ AUDIO_PROFILES, DIM_AMOUNT_DB_OPTIONS, DEFAULTS, normalize, resolve });
}));
