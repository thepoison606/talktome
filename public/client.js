const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
  randomizationFactor: 0.5,
  timeout: 10000,
});

const connectionSounds = createConnectionSounds(() => ensureAudioContext());
connectionSounds.setBackground(document.visibilityState === 'hidden');
document.addEventListener('visibilitychange', () => {
  connectionSounds.setBackground(document.visibilityState === 'hidden');
});
for (const event of ['pointerdown', 'touchend', 'click', 'keydown']) {
  // Retry on later gestures too: mobile Safari may interrupt an unlocked context.
  document.addEventListener(event, () => {
    if (playConnectionSoundsEnabled) void connectionSounds.prepare();
  }, { passive: true });
}

const USER_AGENT = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
const isTouchMacUA = typeof navigator !== 'undefined'
  ? navigator.maxTouchPoints > 1 && /Macintosh/.test(USER_AGENT)
  : false;
const isiOS = typeof navigator !== 'undefined'
  ? /iPad|iPhone|iPod/.test(USER_AGENT) || isTouchMacUA
  : false;

function setupPasswordVisibilityToggles(root = document) {
  root.querySelectorAll('[data-password-toggle]').forEach((button) => {
    if (button.dataset.passwordToggleReady === 'true') return;
    const inputId = button.dataset.passwordToggle;
    const input = inputId ? document.getElementById(inputId) : null;
    if (!input) return;

    const updateButtonState = () => {
      const isVisible = input.type === 'text';
      const label = isVisible ? 'Hide password' : 'Show password';
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(isVisible));
      button.title = label;
    };

    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
    });

    button.addEventListener('click', () => {
      const shouldShow = input.type === 'password';
      const selectionStart = input.selectionStart;
      const selectionEnd = input.selectionEnd;
      input.type = shouldShow ? 'text' : 'password';
      updateButtonState();
      if (selectionStart !== null && selectionEnd !== null) {
        try {
          input.setSelectionRange(selectionStart, selectionEnd);
        } catch {}
      }
    });

    button.dataset.passwordToggleReady = 'true';
    updateButtonState();
  });
}

setupPasswordVisibilityToggles();

socket.on("cut-camera", (value) => {
  const pgm = typeof value === "boolean" ? value : Boolean(value?.pgm);
  const prv = typeof value === "object" && value !== null ? Boolean(value.prv) : false;
  // A user may be on both buses. PGM has visual priority, so expose exactly
  // one color state to Safari instead of leaving both classes active.
  const visiblePrv = prv && !pgm;
  const themeColor = pgm ? "#e00000" : visiblePrv ? "#00875a" : "#0b1120";
  const browserThemeColor = isiOS ? "#0b1120" : themeColor;
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');

  document.documentElement.classList.remove("preview-camera", "cut-camera");
  document.body.classList.remove("preview-camera", "cut-camera");
  if (pgm) document.body.classList.add("cut-camera");
  else if (visiblePrv) document.body.classList.add("preview-camera");

  // iOS Safari caches the lower browser chrome color independently. Keep the
  // browser surface neutral there and render tally only in the application.
  if (!isiOS) {
    if (pgm) document.documentElement.classList.add("cut-camera");
    else if (visiblePrv) document.documentElement.classList.add("preview-camera");
  }
  document.documentElement.style.backgroundColor = browserThemeColor;
  document.body.style.backgroundColor = browserThemeColor;
  themeColorMeta?.setAttribute("content", browserThemeColor);
});

const BASE_REPLY_LABEL = "REPLY";
const QUALITY_PROFILES = {
  "ultra-low": {
    label: "Ultra low (5 ms frame)",
    codecLabel: "opus 48k",
    codecOptions: {
      opusStereo: 0,
      opusFec: 0,
      opusDtx: 0,
      opusMaxAverageBitrate: 48000,
      opusPtime: 5,
    },
    encodings: [{ dtx: false, maxBitrate: 48000, priority: 'high' }],
    constraints: { channelCount: 1, sampleRate: 48000 },
    note: "minimal latency, best on stable networks",
  },
  low: {
    label: "Low (10 ms frame)",
    codecLabel: "opus 48k",
    codecOptions: {
      opusStereo: 0,
      opusFec: 0,
      opusDtx: 0,
      opusMaxAverageBitrate: 64000,
      opusPtime: 10,
    },
    encodings: [{ dtx: false, maxBitrate: 64000, priority: 'high' }],
    constraints: { channelCount: 1, sampleRate: 48000 },
    note: "balanced latency vs. robustness",
  },
  standard: {
    label: "Standard (20 ms frame)",
    codecLabel: "opus 48k",
    codecOptions: {
      opusStereo: 0,
      opusFec: 1,
      opusDtx: 0,
      opusMaxAverageBitrate: 64000,
      opusPtime: 20,
    },
    encodings: [{ dtx: false, maxBitrate: 64000, priority: 'high' }],
    constraints: { channelCount: 1, sampleRate: 48000 },
    note: "highest resilience, highest latency",
  },
};

const defaultVolume = 0.9;
const volumeMemoryStore = new Map();
let warnedVolumeStorageRead = false;
let warnedVolumeStorageWrite = false;
const TARGET_AUDIO_VOLUME_STORAGE_PREFIXES = ['volume_user_', 'volume_conf_', 'volume_feed_'];
const CONFERENCE_LISTEN_EXCLUSIONS_STORAGE_PREFIX = 'conferenceListenExclusions';
const CONFERENCE_MEMBER_LEVELS_STORAGE_PREFIX = 'conferenceMemberLevels';
const IDENTITY_KIND_KEY = 'identityKind';
const FEED_ID_STORAGE_KEY = 'feedId';
const GUEST_SESSION_STORAGE_KEY = 'guestSession';
const FEED_DUCKING_DB_STORAGE_KEY = 'feedDimDb';
const FEED_INPUT_PROCESSING_STORAGE_KEY = 'feedInputProcessingEnabled';
const FEED_PTIME_STORAGE_KEY = 'feedPtimeMs';
const DEFAULT_FEED_DUCKING_DB = -15;
const DEFAULT_FEED_PTIME_MS = 20;
const FEED_DUCKING_DB_MIN = -60;
const FEED_DUCKING_DB_MAX = -6;
const FEED_DIM_SELF_STORAGE_KEY = 'feedDimSelf';
const FEED_DIM_INCOMING_STORAGE_KEY = 'feedDimIncoming';
const AUDIO_PROCESSING_STORAGE_KEY = 'audioProcessingEnabled';
const AUDIO_PROCESSING_EXPLICIT_STORAGE_KEY = 'audioProcessingEnabledExplicit';
const CONNECTION_SOUNDS_STORAGE_KEY = 'playConnectionSounds';
const LEFT_HAND_MODE_STORAGE_KEY = 'leftHandModeEnabled';
const LOCK_MULTIPLE_TARGETS_STORAGE_KEY = 'lockMultipleTargetsEnabled';
const FEED_INPUT_GAIN_DB_STORAGE_KEY = 'feedInputGainDb';
const MIC_DEVICE_STORAGE_KEY = 'preferredAudioInputDeviceId';
const OUTPUT_DEVICE_STORAGE_KEY = 'preferredAudioOutputDeviceId';
const MIC_DEVICE_EXPLICIT_STORAGE_KEY = 'preferredAudioInputDeviceExplicit';
const FEED_INPUT_GAIN_DB_MIN = -30;
const FEED_INPUT_GAIN_DB_MAX = 40;
const FEED_METER_MIN_DB = -60;
const FEED_CLIP_THRESHOLD_DB = -0.5;
const USER_INPUT_GAIN_DB_STORAGE_KEY = 'userInputGainDb';
const USER_INPUT_GAIN_DB_MIN = -30;
const USER_INPUT_GAIN_DB_MAX = 40;
const USER_METER_MIN_DB = -60;
const USER_CLIP_THRESHOLD_DB = -0.5;
const INPUT_MONITOR_SINK_GAIN = 0.000001;
const VOICE_TRIGGER_ENABLED_STORAGE_KEY = 'voiceTriggerEnabled';
const VOICE_TRIGGER_TARGET_STORAGE_KEY = 'voiceTriggerTarget';
const VOICE_TRIGGER_THRESHOLD_DB_STORAGE_KEY = 'voiceTriggerThresholdDb';
const VOICE_TRIGGER_DEFAULT_THRESHOLD_DB = -32;
const VOICE_TRIGGER_MIN_DB = -60;
const VOICE_TRIGGER_MAX_DB = -6;
const VOICE_TRIGGER_ATTACK_MS = 80;
const VOICE_TRIGGER_RELEASE_MS = 700;
const VOICE_TRIGGER_HYSTERESIS_DB = 6;
const FEED_METER_TEXT_UPDATE_INTERVAL_MS = 160;
const USER_METER_TEXT_UPDATE_INTERVAL_MS = 160;
const METER_TEXT_DB_THRESHOLD = 0.5;
const FEED_PTIME_OPTIONS = Object.freeze({
  5: { label: '5 ms (lowest latency, highest load)' },
  10: { label: '10 ms (balanced latency/load)' },
  20: { label: '20 ms (highest resilience, lowest load)' },
});
const USER_OFFLINE_GRACE_MS = 1500;
const MEDIA_NETWORK_STATS_INTERVAL_MS = 5_000;
const MOBILE_TARGET_LAYER_MAX_WIDTH = 699;
const MOBILE_TARGET_LAYER_COMPACT_MAX_WIDTH = 414;
const MOBILE_TARGET_LAYER_LANDSCAPE_SIZE = 4;
const MOBILE_TARGET_LAYER_DEFAULT_SIZE = 8;
const MOBILE_TARGET_LAYER_COMPACT_SIZE = 7;
const TARGET_HOTKEY_STORAGE_KEY_PREFIX = 'targetHotkeys:';
const ACTIVE_PRODUCTION_STORAGE_KEY_PREFIX = 'activeProduction:';
const DEFAULT_PRODUCTION_STORAGE_VALUE = 'default';
const REPLY_HOTKEY_IDENTITY = 'reply';
const DEFAULT_REPLY_HOTKEY_BINDING = Object.freeze({
  id: 'code:Space',
  type: 'code',
  value: 'Space',
  label: 'Space',
});

const serverDefaultClientSettings = (
  typeof window !== 'undefined'
  && window.TALKTOME_DEFAULT_CLIENT_SETTINGS
  && typeof window.TALKTOME_DEFAULT_CLIENT_SETTINGS === 'object'
)
  ? window.TALKTOME_DEFAULT_CLIENT_SETTINGS
  : {};

function hasServerDefaultClientSetting(key) {
  return Object.prototype.hasOwnProperty.call(serverDefaultClientSettings, key);
}

const TARGET_HOTKEY_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const DEFAULT_TARGET_HOTKEY_BINDINGS = Object.freeze(
  TARGET_HOTKEY_DIGITS.map((digit) => Object.freeze({
    id: `digit:${digit}`,
    type: 'digit',
    value: String(digit),
    label: String(digit),
  }))
);
const HOTKEY_CODE_LABELS = Object.freeze({
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  NumpadEnter: 'Num Enter',
});
const HOTKEY_BLOCKED_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'ContextMenu',
  'Escape',
  'Tab',
]);
const targetHotkeys = new Map();
const targetHotkeysByTarget = new Map();
const hotkeyBindingElements = new Map();
const pressedHotkeyBindings = new Set();
const customTargetHotkeys = new Map();
const persistedTargetAudioStateMap = new Map();
const pendingOfflineUserTimers = new Map();
let recoverExistingIncomingPlayback = () => {};
let attemptPlayAudio = () => Promise.resolve();
let persistUserAudioSettingsHandler = () => {};
let loadedTargetHotkeyStorageKey = null;

let feedDuckingDb = hasServerDefaultClientSetting('dimAmountDb')
  ? clampFeedDuckingDb(Number(serverDefaultClientSettings.dimAmountDb))
  : DEFAULT_FEED_DUCKING_DB;
let feedDuckingFactor = dbToLinear(feedDuckingDb);
let feedDimSelf = hasServerDefaultClientSetting('dimFeedsWhileSpeaking')
  ? serverDefaultClientSettings.dimFeedsWhileSpeaking === true
  : false;
let feedDimIncoming = hasServerDefaultClientSetting('dimWhenAddressed')
  ? serverDefaultClientSettings.dimWhenAddressed === true
  : true;
let audioProcessingEnabled = false;
let playConnectionSoundsEnabled = hasServerDefaultClientSetting('playConnectionSounds')
  ? serverDefaultClientSettings.playConnectionSounds === true
  : true;
let audioProcessingReinitializePending = false;
let refreshTalkProducerForAudioProcessingChange = null;
let ensureWarmTalkProducerAfterMicAccess = () => Promise.resolve(null);
let leftHandModeEnabled = hasServerDefaultClientSetting('leftHandMode')
  ? serverDefaultClientSettings.leftHandMode === true
  : false;
let lockMultipleTargetsEnabled = hasServerDefaultClientSetting('lockMultipleTargets')
  ? serverDefaultClientSettings.lockMultipleTargets === true
  : false;
let feedInputProcessingEnabled = false;
let feedPtimeMs = DEFAULT_FEED_PTIME_MS;
const audioProcessingOptions = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};
let feedInputGainDb = 0;
let feedInputGainLinear = dbToLinear(feedInputGainDb);
let userInputGainDb = 18;
let userInputGainLinear = dbToLinear(userInputGainDb);
let voiceTriggerEnabled = false;
let voiceTriggerTargetIdentity = '';
let voiceTriggerThresholdDb = VOICE_TRIGGER_DEFAULT_THRESHOLD_DB;
let preferredInputDeviceId = '';
let preferredInputDeviceExplicit = false;
let preferredOutputDeviceId = '';

function getSlideToLockHintText() {
  return leftHandModeEnabled ? 'Slide to lock →' : '← Slide to lock';
}

function didReachSlideToLockThreshold(currentX, startX) {
  const delta = Number(currentX) - Number(startX);
  return leftHandModeEnabled ? delta >= 42 : delta <= -42;
}

const isAndroidBrowser = /Android/i.test(USER_AGENT);
const isMobileBrowser = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobi/i.test(USER_AGENT)
  || isTouchMacUA;
const isSafariBrowser = typeof navigator !== 'undefined'
  ? /Safari/i.test(USER_AGENT) && !/Chrome|CriOS|Edg|OPR|Firefox|FxiOS/i.test(USER_AGENT)
  : false;
function createDigitHotkeyBinding(digit) {
  const value = String(digit);
  if (!/^[0-9]$/.test(value)) return null;
  return {
    id: `digit:${value}`,
    type: 'digit',
    value,
    label: value,
  };
}

function formatHotkeyCodeLabel(code, fallbackKey = '') {
  if (typeof code !== 'string' || !code.trim()) return '';

  let match = code.match(/^Key([A-Z])$/);
  if (match) return match[1];
  match = code.match(/^Digit([0-9])$/);
  if (match) return match[1];
  match = code.match(/^Numpad([0-9])$/);
  if (match) return `Num ${match[1]}`;
  match = code.match(/^F([1-9]|1[0-9]|2[0-4])$/);
  if (match) return `F${match[1]}`;

  if (HOTKEY_CODE_LABELS[code]) {
    return HOTKEY_CODE_LABELS[code];
  }

  if (typeof fallbackKey === 'string') {
    const normalized = fallbackKey.trim();
    if (normalized && normalized !== 'Unidentified') {
      if (normalized === ' ') return 'Space';
      if (normalized.length === 1) return normalized.toUpperCase();
      return normalized;
    }
  }

  return code;
}

function createCodeHotkeyBinding(code, fallbackKey = '') {
  if (typeof code !== 'string' || !code.trim()) return null;
  const normalizedCode = code.trim();
  return {
    id: `code:${normalizedCode}`,
    type: 'code',
    value: normalizedCode,
    label: formatHotkeyCodeLabel(normalizedCode, fallbackKey),
  };
}

function normalizeStoredTargetHotkeyBinding(rawBinding) {
  if (!rawBinding || typeof rawBinding !== 'object') return null;
  if (rawBinding.type === 'digit') {
    return createDigitHotkeyBinding(rawBinding.value);
  }
  if (rawBinding.type === 'code') {
    return createCodeHotkeyBinding(rawBinding.value, rawBinding.label);
  }
  return null;
}

function getTargetHotkeyStorageKeyForSession() {
  if (session?.kind !== 'user' || !session?.userId) return null;
  const productionSuffix = session.productionId ? `:production:${session.productionId}` : '';
  return `${TARGET_HOTKEY_STORAGE_KEY_PREFIX}${session.userId}${productionSuffix}`;
}

function ensureCustomTargetHotkeysLoaded() {
  const storageKey = getTargetHotkeyStorageKeyForSession();
  if (loadedTargetHotkeyStorageKey === storageKey) return;

  customTargetHotkeys.clear();
  loadedTargetHotkeyStorageKey = storageKey;
  if (!storageKey || typeof window === 'undefined') return;

  try {
    const rawValue = window.localStorage?.getItem(storageKey);
    if (!rawValue) return;
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object') return;
    Object.entries(parsed).forEach(([targetIdentity, rawBinding]) => {
      if (typeof targetIdentity !== 'string' || !targetIdentity.trim()) return;
      const binding = normalizeStoredTargetHotkeyBinding(rawBinding);
      if (!binding) return;
      customTargetHotkeys.set(targetIdentity, binding);
    });
  } catch (error) {
    console.warn('Unable to restore custom target hotkeys:', error);
  }
}

function persistCustomTargetHotkeys() {
  const storageKey = getTargetHotkeyStorageKeyForSession();
  if (!storageKey || typeof window === 'undefined') return;

  const serialized = {};
  customTargetHotkeys.forEach((binding, targetIdentity) => {
    if (!binding || typeof targetIdentity !== 'string') return;
    serialized[targetIdentity] = {
      type: binding.type,
      value: binding.value,
      label: binding.label,
    };
  });

  try {
    if (Object.keys(serialized).length === 0) {
      window.localStorage?.removeItem(storageKey);
      return;
    }
    window.localStorage?.setItem(storageKey, JSON.stringify(serialized));
  } catch (error) {
    console.warn('Unable to persist custom target hotkeys:', error);
  }
}

function getHotkeyLookupIds(event) {
  if (!event) return [];
  const lookupIds = [];
  if (event.key && /^[0-9]$/.test(event.key)) {
    lookupIds.push(`digit:${event.key}`);
  }

  const code = typeof event.code === 'string' ? event.code : '';
  let match = code.match(/^Digit([0-9])$/);
  if (match) lookupIds.push(`digit:${match[1]}`);
  match = code.match(/^Numpad([0-9])$/);
  if (match) lookupIds.push(`digit:${match[1]}`);
  if (code) lookupIds.push(`code:${code}`);

  return [...new Set(lookupIds)];
}

function getRecordableHotkeyBinding(event) {
  if (!event || typeof event !== 'object') return null;
  if (event.altKey || event.ctrlKey || event.metaKey) return null;

  const code = typeof event.code === 'string' ? event.code.trim() : '';
  if (!code || HOTKEY_BLOCKED_CODES.has(code)) return null;

  let match = code.match(/^Digit([0-9])$/);
  if (match) return createDigitHotkeyBinding(match[1]);
  match = code.match(/^Numpad([0-9])$/);
  if (match) return createDigitHotkeyBinding(match[1]);

  return createCodeHotkeyBinding(code, event.key);
}

function logReceiveDiagnostic(event, details = {}) {
  if (!(isiOS || isSafariBrowser)) return;
  const sharedCtx = sharedAudioContext && sharedAudioContext.state !== 'closed'
    ? sharedAudioContext
    : null;
  const audioSession = typeof navigator !== 'undefined' ? navigator.audioSession : null;
  console.info(`[audio][recv][${event}]`, {
    at: typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? Math.round(performance.now())
      : Date.now(),
    sharedAudioContextState: sharedCtx?.state || null,
    audioSessionType: audioSession?.type || null,
    audioSessionState: audioSession?.state || null,
    visibilityState: typeof document !== 'undefined' ? document.visibilityState : null,
    documentHidden: typeof document !== 'undefined' ? document.hidden : null,
    documentHasFocus: typeof document !== 'undefined' && typeof document.hasFocus === 'function'
      ? document.hasFocus()
      : null,
    pendingAutoplayCount: pendingAutoplayAudios.size,
    ...details,
  });
}

function getAudioTrackSnapshot(track) {
  if (!track) return null;
  return {
    enabled: track.enabled ?? null,
    muted: track.muted ?? null,
    readyState: track.readyState ?? null,
    settings: typeof track.getSettings === 'function' ? track.getSettings() : null,
  };
}

function getAudioElementSnapshot(audioEl) {
  if (!audioEl) return null;
  const track = audioEl.srcObject?.getAudioTracks?.()?.[0] || null;
  return {
    paused: audioEl.paused ?? null,
    muted: audioEl.muted ?? null,
    volume: audioEl.volume ?? null,
    readyState: audioEl.readyState ?? null,
    networkState: audioEl.networkState ?? null,
    errorCode: audioEl.error?.code ?? null,
    track: getAudioTrackSnapshot(track),
  };
}

function enforcePitchLock(audioEl) {
  if (!audioEl) return;
  audioEl.defaultPlaybackRate = 1;
  audioEl.playbackRate = 1;
  ['preservesPitch', 'mozPreservesPitch', 'webkitPreservesPitch'].forEach(prop => {
    if (prop in audioEl) {
      try { audioEl[prop] = true; } catch {}
    }
  });
}

function appendPlaybackAudioElement(audioEl) {
  if (!audioEl || typeof document === 'undefined') return false;
  const host = document.getElementById('audio-streams');
  if (!host) return false;
  if (audioEl.parentNode !== host) {
    host.appendChild(audioEl);
  }
  return true;
}

function supportsFeedDimming() {
  return shouldUseFeedPlaybackBus();
}

if (typeof window !== 'undefined') {
  try {
    const storedDb = window.localStorage?.getItem(FEED_DUCKING_DB_STORAGE_KEY);
    if (storedDb !== null) {
      const parsed = parseFloat(storedDb);
      if (!Number.isNaN(parsed)) {
        feedDuckingDb = clampFeedDuckingDb(parsed);
        feedDuckingFactor = dbToLinear(feedDuckingDb);
      }
    }
    const storedSelfDim = window.localStorage?.getItem(FEED_DIM_SELF_STORAGE_KEY);
    if (storedSelfDim !== null) {
      feedDimSelf = storedSelfDim === 'true';
    }
    const storedIncomingDim = window.localStorage?.getItem(FEED_DIM_INCOMING_STORAGE_KEY);
    if (storedIncomingDim !== null) {
      feedDimIncoming = storedIncomingDim === 'true';
    }
    if (!supportsFeedDimming()) {
      feedDimSelf = false;
      feedDimIncoming = false;
    }
    const storedFeedInputProcessing = window.localStorage?.getItem(FEED_INPUT_PROCESSING_STORAGE_KEY);
    if (storedFeedInputProcessing !== null) {
      feedInputProcessingEnabled = storedFeedInputProcessing === 'true';
    }
    const storedInputDeviceId = window.localStorage?.getItem(MIC_DEVICE_STORAGE_KEY);
    if (storedInputDeviceId !== null) {
      preferredInputDeviceId = storedInputDeviceId;
    }
    const storedInputDeviceExplicit = window.localStorage?.getItem(MIC_DEVICE_EXPLICIT_STORAGE_KEY);
    if (storedInputDeviceExplicit !== null) {
      preferredInputDeviceExplicit = storedInputDeviceExplicit === 'true';
    }
    const storedOutputDeviceId = window.localStorage?.getItem(OUTPUT_DEVICE_STORAGE_KEY);
    if (storedOutputDeviceId !== null) {
      preferredOutputDeviceId = storedOutputDeviceId;
    }
    const storedFeedPtime = window.localStorage?.getItem(FEED_PTIME_STORAGE_KEY);
    if (storedFeedPtime !== null) {
      const parsedFeedPtime = parseInt(storedFeedPtime, 10);
      if (!Number.isNaN(parsedFeedPtime)) {
        feedPtimeMs = clampFeedPtimeMs(parsedFeedPtime);
      }
    }
    const storedProcessingExplicit = window.localStorage?.getItem(AUDIO_PROCESSING_EXPLICIT_STORAGE_KEY);
    const storedProcessing = window.localStorage?.getItem(AUDIO_PROCESSING_STORAGE_KEY);
    if (storedProcessingExplicit !== null && storedProcessing !== null) {
      audioProcessingEnabled = storedProcessing === 'true';
    } else if (hasServerDefaultClientSetting('audioAutoProcessing')) {
      audioProcessingEnabled = serverDefaultClientSettings.audioAutoProcessing === true;
    } else {
      // Default: enable processing on mobile/tablet browsers, disable on desktop.
      // Legacy stored values without an explicit marker should not keep mobile
      // devices stuck on the old desktop-style default.
      try {
        audioProcessingEnabled = !!isMobileBrowser;
      } catch (err) {
        audioProcessingEnabled = false;
      }
    }
    const storedConnectionSounds = window.localStorage?.getItem(CONNECTION_SOUNDS_STORAGE_KEY);
    if (storedConnectionSounds !== null) {
      playConnectionSoundsEnabled = storedConnectionSounds === 'true';
    }
    const storedLeftHandMode = window.localStorage?.getItem(LEFT_HAND_MODE_STORAGE_KEY);
    if (storedLeftHandMode !== null) {
      leftHandModeEnabled = storedLeftHandMode === 'true';
    }
    const storedLockMultipleTargets = window.localStorage?.getItem(LOCK_MULTIPLE_TARGETS_STORAGE_KEY);
    if (storedLockMultipleTargets !== null) {
      lockMultipleTargetsEnabled = storedLockMultipleTargets === 'true';
    }
    const storedInputGainDb = window.localStorage?.getItem(FEED_INPUT_GAIN_DB_STORAGE_KEY);
    if (storedInputGainDb !== null) {
      const parsedGainDb = parseFloat(storedInputGainDb);
      if (!Number.isNaN(parsedGainDb)) {
        feedInputGainDb = clampFeedInputGainDb(parsedGainDb);
        feedInputGainLinear = dbToLinear(feedInputGainDb);
      }
    }
    const storedUserGainDb = window.localStorage?.getItem(USER_INPUT_GAIN_DB_STORAGE_KEY);
    if (storedUserGainDb !== null) {
      const parsedUserGainDb = parseFloat(storedUserGainDb);
      if (!Number.isNaN(parsedUserGainDb)) {
        userInputGainDb = clampUserInputGainDb(parsedUserGainDb);
        userInputGainLinear = dbToLinear(userInputGainDb);
      }
    }
    const storedVoiceTriggerEnabled = window.localStorage?.getItem(VOICE_TRIGGER_ENABLED_STORAGE_KEY);
    if (storedVoiceTriggerEnabled !== null) {
      voiceTriggerEnabled = storedVoiceTriggerEnabled === 'true';
    }
    const storedVoiceTriggerTarget = window.localStorage?.getItem(VOICE_TRIGGER_TARGET_STORAGE_KEY);
    if (storedVoiceTriggerTarget !== null) {
      voiceTriggerTargetIdentity = String(storedVoiceTriggerTarget || '').trim();
    }
    const storedVoiceTriggerThreshold = window.localStorage?.getItem(VOICE_TRIGGER_THRESHOLD_DB_STORAGE_KEY);
    if (storedVoiceTriggerThreshold !== null) {
      const parsedVoiceTriggerThreshold = parseFloat(storedVoiceTriggerThreshold);
      if (!Number.isNaN(parsedVoiceTriggerThreshold)) {
        voiceTriggerThresholdDb = clampVoiceTriggerThresholdDb(parsedVoiceTriggerThreshold);
      }
    }
  } catch (err) {
    console.warn('Unable to restore saved preferences from storage:', err);
  }
}
connectionSounds.setEnabled(playConnectionSoundsEnabled);
syncAudioProcessingOptions();

const FEED_PROFILE = {
  label: 'Feed (raw stream)',
  codecLabel: 'opus 48k',
  codecOptions: {
    opusStereo: 1,
    opusFec: 0,
    opusDtx: 0,
    opusMaxAverageBitrate: 128000,
    opusPtime: 20,
  },
  encodings: [{ dtx: false, maxBitrate: 128000, priority: 'high' }],
  constraints: {
    channelCount: { ideal: 2 },
    sampleRate: { ideal: 48000 },
  },
};

function createAnonymousSession() {
  return {
    kind: 'guest',
    userId: null,
    feedId: null,
    guestId: null,
    guestProfileUserId: null,
    productionId: null,
    productionName: null,
    productions: [],
    name: null,
  };
}

let session = createAnonymousSession();
let device = null;
let sendTransport = null;
let recvTransport = null;
let producer = null;
let mediaNetworkStatsTimer = null;
let mediaNetworkStatsReportInFlight = false;
let collectMediaConsumerNetworkStats = async () => [];

function isAudioRtpStats(stats) {
  return stats?.kind === 'audio' || stats?.mediaType === 'audio';
}

function collectMediaNetworkStatsFromReport(report, summary) {
  if (!report || typeof report.forEach !== 'function') return;

  const selectedCandidatePairIds = new Set();
  report.forEach((stats) => {
    if (stats?.type === 'transport' && stats.selectedCandidatePairId) {
      selectedCandidatePairIds.add(stats.selectedCandidatePairId);
    }
  });

  report.forEach((stats) => {
    if (!stats || typeof stats !== 'object') return;

    if (
      stats.type === 'candidate-pair'
      && (selectedCandidatePairIds.has(stats.id) || stats.selected === true || stats.nominated === true)
    ) {
      const roundTripTime = Number(stats.currentRoundTripTime);
      if (Number.isFinite(roundTripTime) && roundTripTime >= 0) {
        summary.roundTripTimes.push(roundTripTime * 1000);
      }
    }

    if (
      (stats.type !== 'inbound-rtp' && stats.type !== 'remote-inbound-rtp')
      || !isAudioRtpStats(stats)
    ) {
      return;
    }

    const packetsLost = Number(stats.packetsLost);
    const packetsReceived = Number(stats.packetsReceived);
    if (!Number.isFinite(packetsLost) || !Number.isFinite(packetsReceived)) return;
    summary.packetsLost += Math.max(0, packetsLost);
    summary.packetsReceived += Math.max(0, packetsReceived);
    summary.packetsTotal += Math.max(0, packetsLost) + Math.max(0, packetsReceived);
    if (stats.type === 'inbound-rtp') {
      const jitter = Number(stats.jitter);
      if (Number.isFinite(jitter) && jitter >= 0) summary.jitters.push(jitter * 1000);
      summary.packetsDiscarded += Math.max(0, Number(stats.packetsDiscarded) || 0);
      summary.concealedSamples += Math.max(0, Number(stats.concealedSamples) || 0);
      summary.concealmentEvents += Math.max(0, Number(stats.concealmentEvents) || 0);
      const jitterBufferDelay = Number(stats.jitterBufferDelay);
      const jitterBufferEmittedCount = Number(stats.jitterBufferEmittedCount);
      if (
        Number.isFinite(jitterBufferDelay)
        && jitterBufferDelay >= 0
        && Number.isFinite(jitterBufferEmittedCount)
        && jitterBufferEmittedCount > 0
      ) {
        summary.jitterBufferDelaySeconds += jitterBufferDelay;
        summary.jitterBufferEmittedCount += jitterBufferEmittedCount;
      }
    }
  });
}

function summarizeMediaNetworkStats(summary) {
  const averageRoundTripMs = summary.roundTripTimes.length
    ? summary.roundTripTimes.reduce((total, value) => total + value, 0) / summary.roundTripTimes.length
    : null;
  const packetLossPercent = summary.packetsTotal > 0
    ? (summary.packetsLost / summary.packetsTotal) * 100
    : null;
  const averageJitterMs = summary.jitters.length
    ? summary.jitters.reduce((total, value) => total + value, 0) / summary.jitters.length
    : null;
  const averageJitterBufferMs = summary.jitterBufferEmittedCount > 0
    ? (summary.jitterBufferDelaySeconds / summary.jitterBufferEmittedCount) * 1000
    : null;

  return {
    roundTripMs: Number.isFinite(averageRoundTripMs) ? Math.round(averageRoundTripMs) : null,
    packetLossPercent: Number.isFinite(packetLossPercent)
      ? Math.round(packetLossPercent * 10) / 10
      : null,
    jitterMs: Number.isFinite(averageJitterMs) ? Math.round(averageJitterMs) : null,
    jitterBufferMs: Number.isFinite(averageJitterBufferMs) ? Math.round(averageJitterBufferMs) : null,
    packetsLost: summary.packetsLost,
    packetsReceived: summary.packetsReceived,
    packetsDiscarded: summary.packetsDiscarded,
    concealedSamples: summary.concealedSamples,
    concealmentEvents: summary.concealmentEvents,
  };
}

function createMediaNetworkStatsSummary() {
  return {
    roundTripTimes: [],
    jitters: [],
    packetsLost: 0,
    packetsReceived: 0,
    packetsTotal: 0,
    packetsDiscarded: 0,
    concealedSamples: 0,
    concealmentEvents: 0,
    jitterBufferDelaySeconds: 0,
    jitterBufferEmittedCount: 0,
  };
}

async function reportMediaNetworkStats() {
  if (mediaNetworkStatsReportInFlight) return;
  if (!socket.connected || (session.kind !== 'user' && session.kind !== 'feed')) return;

  const transports = [sendTransport, recvTransport]
    .filter((transport) => transport && !transport.closed && typeof transport.getStats === 'function');
  if (!transports.length) return;

  mediaNetworkStatsReportInFlight = true;
  try {
    const reports = await Promise.allSettled(transports.map((transport) => transport.getStats()));
    const summary = createMediaNetworkStatsSummary();
    reports.forEach((result) => {
      if (result.status === 'fulfilled') {
        collectMediaNetworkStatsFromReport(result.value, summary);
      }
    });

    const streams = await collectMediaConsumerNetworkStats();

    socket.emit('media-network-stats', {
      ...summarizeMediaNetworkStats(summary),
      streams,
    });
  } catch (error) {
    console.debug('Unable to collect WebRTC network stats:', error);
  } finally {
    mediaNetworkStatsReportInFlight = false;
  }
}

function startMediaNetworkStatsReporting() {
  if (mediaNetworkStatsTimer) return;
  reportMediaNetworkStats();
  mediaNetworkStatsTimer = window.setInterval(reportMediaNetworkStats, MEDIA_NETWORK_STATS_INTERVAL_MS);
}

function stopMediaNetworkStatsReporting() {
  if (!mediaNetworkStatsTimer) return;
  window.clearInterval(mediaNetworkStatsTimer);
  mediaNetworkStatsTimer = null;
}

function isGuestSessionActive() {
  return Boolean(
    session?.kind === 'guest'
    && session?.guestId
    && session?.guestProfileUserId
    && session?.name
  );
}

function isOperatorSession() {
  return session?.kind === 'user' || isGuestSessionActive();
}

function getSessionRegistrationId() {
  if (session?.kind === 'feed') return session.feedId || null;
  if (session?.kind === 'guest') return isGuestSessionActive() ? session.guestId : null;
  return session?.userId || null;
}

function getOperatorProfileUserId() {
  if (session?.kind === 'guest') return isGuestSessionActive() ? session.guestProfileUserId : null;
  return session?.kind === 'user' ? session.userId : null;
}

function installMediaConstraintDiagnostics() {
  if (typeof window === 'undefined') return;
  if (window.__talkToMeMediaConstraintDiagnosticsInstalled) return;
  window.__talkToMeMediaConstraintDiagnosticsInstalled = true;

  if (navigator.mediaDevices?.getUserMedia) {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      try {
        return await originalGetUserMedia(constraints);
      } catch (error) {
        if (error?.name === 'OverconstrainedError') {
          console.error('[media] getUserMedia OverconstrainedError', {
            constraints,
            constraint: error?.constraint,
            message: error?.message || String(error),
            sessionKind: session?.kind || 'unknown',
            sessionName: session?.name || null,
            stack: new Error().stack,
          });
        }
        throw error;
      }
    };
  }

  if (typeof MediaStreamTrack !== 'undefined' && MediaStreamTrack.prototype?.applyConstraints) {
    const originalApplyConstraints = MediaStreamTrack.prototype.applyConstraints;
    MediaStreamTrack.prototype.applyConstraints = async function patchedApplyConstraints(constraints) {
      try {
        return await originalApplyConstraints.call(this, constraints);
      } catch (error) {
        if (error?.name === 'OverconstrainedError') {
          console.error('[media] applyConstraints OverconstrainedError', {
            constraints,
            constraint: error?.constraint,
            message: error?.message || String(error),
            trackLabel: this?.label || null,
            trackKind: this?.kind || null,
            readyState: this?.readyState || null,
            sessionKind: session?.kind || 'unknown',
            sessionName: session?.name || null,
            stack: new Error().stack,
          });
        }
        throw error;
      }
    };
  }
}

installMediaConstraintDiagnostics();
let inputSelect;
let feedInputSelect;
let outputDeviceSelector;
let outputSelect;
let qualitySelect;
let dimAmountSelect;
let settingsMainView;
let settingsShortcutsView;
let settingsArrangeView;
let shortcutSettingsOpenButton;
let shortcutSettingsBackButton;
let arrangeTargetsOpenButton;
let arrangeTargetsBackButton;
let shortcutSettingsSection;
let shortcutSettingsList;
let shortcutSettingsEmpty;
let shortcutResetButton;
let sessionSlideHintEl;
let dimWhileSpeakingToggle;
let dimWhenAddressedToggle;
let audioProcessingToggle;
let connectionSoundsToggle;
let leftHandModeToggle;
let lockMultipleTargetsToggle;
let userLevelControls;
let userInputGainSlider;
let userInputGainValueDisplay;
let userMeterBarEl;
let userMeterClipEl;
let userMeterValueEl;
let voiceTriggerControls;
let voiceTriggerToggle;
let voiceTriggerTargetSelect;
let voiceTriggerThresholdSlider;
let voiceTriggerThresholdValueDisplay;
let voiceTriggerStatusEl;
let feedInputGainSlider;
let feedInputGainValueDisplay;
let feedInputProcessingToggle;
let feedPtimeSelect;
let feedLevelControls;
// Feed meters: stereo (L/R)
let feedMeterBarLEl;
let feedMeterClipLEl;
let feedMeterValueLEl;
let feedMeterBarREl;
let feedMeterClipREl;
let feedMeterValueREl;
const feedMeterStateL = { lastText: '-inf dB', lastTextTime: 0, lastDb: -Infinity };
const feedMeterStateR = { lastText: '-inf dB', lastTextTime: 0, lastDb: -Infinity };
let userMeterLastText = '-inf dB';
let userMeterLastTextTime = 0;
let userMeterLastDb = -Infinity;
let micStream = null;
let micTrack = null;
let micDeviceId = null;
let micCleanupTimer = null;
let micPrimed = false;
let micPrimingPromise = null;
let initialMicAccessRequested = false;
let mediaInitialized = false;

let feedStreaming = false;
let feedManualStop = false;
let shouldStartFeedWhenReady = false;
let isTalking = false;
let pendingTalkStart = null;
let warmTalkProducerPromise = null;
let activeHotkeyCaptureTargetIdentity = null;
let activeSettingsView = 'main';
const USER_ACTIVATION_EVENTS = ['pointerdown', 'mousedown', 'click', 'touchstart', 'keydown'];
const ACTIVE_PRODUCERS_SYNC_INTERVAL_MS = 10000;
const UI_ICONS = {
  talk: '/images/walkie-talkies-white.png',
  speakerOn: '/images/speaker-white.png',
  speakerMuted: '/images/speaker-muted.png',
};
const FEED_RECEPTION_ICONS = {
  play: '<svg class="feed-reception-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z"/></svg>',
  stop: '<svg class="feed-reception-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7h10v10H7z"/></svg>',
};
const pendingAutoplayAudios = new Set();
const pendingAudioPlayPromises = new WeakMap();
const playbackAudioDiagnostics = new WeakSet();
let sharedAudioContext = null;
let feedProcessingAudioContext = null;
let onAudioContextRunning = null;
let audioContextPrimed = false;
let feedProcessingChain = null;
let feedPlaybackBus = null;
let targetPlaybackBuses = new Map();
let remotePlaybackBus = null;
let targetHasActiveStreams = () => false;
let userProcessingChain = null;
let userMeterMonitorChain = null;
let voiceTriggerMonitorChain = null;
let voiceTriggerRafId = null;
let voiceTriggerActive = false;
let voiceTriggerAboveSince = 0;
let voiceTriggerBelowSince = 0;
let voiceTriggerAdminInhibited = false;
let settingsMonitorActive = false;
let settingsMonitorPromise = null;
let settingsMenuOpen = false;
let stopHotkeyCaptureHandler = () => {};
let renderTargetHotkeySettingsHandler = () => {};
let refreshTargetHotkeyUiHandler = () => {};
let loadArrangeTargetsHandler = () => {};
let cancelArrangeTargetsDragHandler = () => {};
let restartVoiceTriggerMonitorHandler = () => {};

function attachPlaybackAudioDiagnostics(audioEl, label) {
  if (!audioEl || playbackAudioDiagnostics.has(audioEl)) return;
  playbackAudioDiagnostics.add(audioEl);
  ['pause', 'play', 'playing', 'waiting', 'stalled', 'suspend', 'emptied', 'ended', 'error'].forEach(eventName => {
    audioEl.addEventListener(eventName, () => {
      logReceiveDiagnostic(`audio-${eventName}`, {
        label,
        audio: getAudioElementSnapshot(audioEl),
      });
    });
  });
}

function clampFeedDuckingDb(value) {
  if (value === -14) return -15;
  if (!Number.isFinite(value)) return DEFAULT_FEED_DUCKING_DB;
  return Math.min(FEED_DUCKING_DB_MAX, Math.max(FEED_DUCKING_DB_MIN, value));
}

function clampFeedInputGainDb(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(FEED_INPUT_GAIN_DB_MAX, Math.max(FEED_INPUT_GAIN_DB_MIN, value));
}

function clampFeedPtimeMs(value) {
  const numeric = Number(value);
  return FEED_PTIME_OPTIONS[numeric] ? numeric : DEFAULT_FEED_PTIME_MS;
}

function clampUserInputGainDb(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(USER_INPUT_GAIN_DB_MAX, Math.max(USER_INPUT_GAIN_DB_MIN, value));
}

function clampVoiceTriggerThresholdDb(value) {
  if (!Number.isFinite(value)) return VOICE_TRIGGER_DEFAULT_THRESHOLD_DB;
  return Math.min(VOICE_TRIGGER_MAX_DB, Math.max(VOICE_TRIGGER_MIN_DB, value));
}

function dbToLinear(dbValue) {
  return Math.pow(10, dbValue / 20);
}

function formatFeedDimDbOptionText(dbValue) {
  const rounded = Math.round(dbValue * 10) / 10;
  if (rounded === 0) return 'No dim (0 dB)';
  return `Custom (${rounded} dB)`;
}

function formatDbDisplay(dbValue) {
  if (!Number.isFinite(dbValue)) return '-inf dB';
  const rounded = Math.round(dbValue * 10) / 10;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  const sign = normalized >= 0 ? '+' : '';
  return `${sign}${normalized.toFixed(1)} dB`;
}

function formatLinearLevelDb(level) {
  const linearLevel = Math.max(0, Math.min(1, Number(level)));
  if (!Number.isFinite(linearLevel) || linearLevel <= 0) return '-inf dB';
  const rounded = Math.round((20 * Math.log10(linearLevel)) * 10) / 10;
  if (rounded >= 0) return '0 dB';
  return `${rounded.toFixed(1)} dB`;
}

function syncDimAmountSelect(value) {
  if (!dimAmountSelect) return;
  const valueStr = String(value);
  const options = Array.from(dimAmountSelect.options);
  if (!options.some(opt => opt.value === valueStr)) {
    const opt = document.createElement('option');
    opt.value = valueStr;
    opt.textContent = formatFeedDimDbOptionText(value);
    dimAmountSelect.appendChild(opt);
  }
  if (dimAmountSelect.value !== valueStr) {
    dimAmountSelect.value = valueStr;
  }
}

function createManagedAudioContext({ label = 'AudioContext', onRunning = null } = {}) {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  try {
    const ctx = new AudioCtx({ latencyHint: 'interactive', sampleRate: 48000 });
    if (typeof ctx.addEventListener === 'function') {
      ctx.addEventListener('statechange', () => {
        logReceiveDiagnostic('audio-context-statechange', {
          label,
          state: ctx.state,
          remotePlaybackBus: getAudioElementSnapshot(remotePlaybackBus?.audio || null),
          micTrack: getAudioTrackSnapshot(micTrack),
        });
        if (ctx.state === 'running') {
          if (typeof onRunning === 'function') {
            onRunning();
          }
        }
      });
    }
    if (supportsAudioOutputSelection() && preferredOutputDeviceId && typeof ctx.setSinkId === 'function') {
      ctx.setSinkId(preferredOutputDeviceId).catch(err => {
        console.warn('Failed to restore audio output device on AudioContext:', err);
      });
    }
    return ctx;
  } catch (err) {
    console.warn(`Failed to create ${label}:`, err);
    return null;
  }
}

async function resumeAudioContextIfNeeded(ctx, { label = 'AudioContext', onRunning = null } = {}) {
  if (!ctx) return;
  if (ctx.state === 'running') {
    logReceiveDiagnostic('context-already-running', { label });
    if (typeof onRunning === 'function') {
      onRunning();
    }
    return;
  }
  if (!['suspended', 'interrupted'].includes(ctx.state) || typeof ctx.resume !== 'function') {
    logReceiveDiagnostic('context-resume-skipped', {
      label,
      state: ctx.state,
      canResume: typeof ctx.resume === 'function',
    });
    return;
  }
  try {
    logReceiveDiagnostic('context-resume-start', { label, state: ctx.state });
    await ctx.resume();
    logReceiveDiagnostic('context-resume-done', { label, state: ctx.state });
  } catch (err) {
    logReceiveDiagnostic('context-resume-failed', {
      label,
      state: ctx.state,
      error: err?.message || String(err),
    });
    console.warn(`Failed to resume ${label}:`, err);
  }
}

function ensureAudioContext() {
  if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
    return sharedAudioContext;
  }
  sharedAudioContext = createManagedAudioContext({
    label: 'shared AudioContext',
    onRunning: () => {
      if (typeof onAudioContextRunning === 'function') {
        onAudioContextRunning();
      }
    }
  });
  return sharedAudioContext;
}

function ensureFeedProcessingAudioContext() {
  if (feedProcessingAudioContext && feedProcessingAudioContext.state !== 'closed') {
    return feedProcessingAudioContext;
  }
  // Keep the feed ingest graph isolated from playback state so feed uplink stays stable.
  feedProcessingAudioContext = createManagedAudioContext({ label: 'feed ingest AudioContext' });
  return feedProcessingAudioContext;
}

function ensureFeedPlaybackBus() {
  const ctx = ensureAudioContext();
  if (!ctx) return null;

  if (feedPlaybackBus?.ctx === ctx && feedPlaybackBus.inputNode && feedPlaybackBus.outputNode) {
    return feedPlaybackBus;
  }

  if (feedPlaybackBus) {
    try { feedPlaybackBus.inputNode?.disconnect(); } catch {}
    try { feedPlaybackBus.outputNode?.disconnect(); } catch {}
    feedPlaybackBus = null;
  }

  try {
    const inputNode = ctx.createGain();
    const outputNode = ctx.createGain();
    inputNode.gain.value = 1;
    outputNode.gain.value = 1;
    inputNode.connect(outputNode);
    outputNode.connect(ctx.destination);
    feedPlaybackBus = { ctx, inputNode, outputNode };
  } catch (err) {
    console.warn('Failed to initialize feed playback bus:', err);
    feedPlaybackBus = null;
  }

  return feedPlaybackBus;
}

function shouldUsePersistentRemotePlaybackBus() {
  if (shouldUseAdaptiveReceivePlayback()) return false;
  return isiOS || isSafariBrowser;
}

function shouldUseAdaptiveReceivePlayback() {
  return window.TalktomeReceivePlaybackPolicy?.shouldUseAdaptiveReceivePlayback({ isiOS })
    ?? isiOS;
}

function shouldUseAdaptivePlainReceivePlayback() {
  return window.TalktomeReceivePlaybackPolicy?.shouldUsePlainReceivePlayback({
    isiOS,
    isSafariBrowser,
    visibilityState: typeof document !== 'undefined' ? document.visibilityState : 'visible',
  }) ?? (isiOS && typeof document !== 'undefined' && document.visibilityState === 'hidden');
}

function disposeRemotePlaybackBus() {
  if (!remotePlaybackBus) return;
  pendingAutoplayAudios.delete(remotePlaybackBus.audio);
  pendingAudioPlayPromises.delete(remotePlaybackBus.audio);
  try { remotePlaybackBus.silenceSource?.stop?.(); } catch {}
  try { remotePlaybackBus.silenceSource?.disconnect?.(); } catch {}
  try { remotePlaybackBus.mixNode?.disconnect(); } catch {}
  try { remotePlaybackBus.destinationNode?.disconnect?.(); } catch {}
  try { remotePlaybackBus.audio?.pause?.(); } catch {}
  try {
    if (remotePlaybackBus.audio) {
      remotePlaybackBus.audio.srcObject = null;
      remotePlaybackBus.audio.remove();
    }
  } catch {}
  remotePlaybackBus = null;
}

function createRemotePlaybackBusSilenceSource(ctx, outputNode) {
  if (!ctx || !outputNode) return null;
  try {
    const sampleRate = Number(ctx.sampleRate) || 48000;
    const frameCount = Math.max(1, Math.round(sampleRate * 0.02));
    const buffer = ctx.createBuffer(1, frameCount, sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(outputNode);
    source.start(0);
    return source;
  } catch (err) {
    console.warn('Failed to initialize silent remote playback source:', err);
    return null;
  }
}

function ensureRemotePlaybackBus() {
  const ctx = ensureAudioContext();
  if (!ctx || !shouldUsePersistentRemotePlaybackBus()) return null;

  if (remotePlaybackBus?.ctx === ctx && remotePlaybackBus.audio && remotePlaybackBus.mixNode && remotePlaybackBus.destinationNode) {
    return remotePlaybackBus;
  }
  if (remotePlaybackBus) {
    disposeRemotePlaybackBus();
  }

  try {
    const mixNode = ctx.createGain();
    const destinationNode = ctx.createMediaStreamDestination();
    mixNode.gain.value = 1;
    mixNode.connect(destinationNode);
    const silenceSource = createRemotePlaybackBusSilenceSource(ctx, mixNode);

    const audio = document.createElement('audio');
    audio.srcObject = destinationNode.stream;
    audio.autoplay = true;
    audio.playsInline = true;
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('autoplay', 'true');
    audio.dataset.remotePlaybackBus = 'true';
    enforcePitchLock(audio);
    attachPlaybackAudioDiagnostics(audio, 'remote-playback-bus');
    if (supportsAudioOutputSelection() && preferredOutputDeviceId && typeof audio.setSinkId === 'function') {
      audio.setSinkId(preferredOutputDeviceId).catch(err => {
        console.warn('Failed to apply audio output device to remote playback bus:', err);
      });
    }
    appendPlaybackAudioElement(audio);

    remotePlaybackBus = {
      ctx,
      mixNode,
      destinationNode,
      silenceSource,
      audio,
    };
    return remotePlaybackBus;
  } catch (err) {
    console.warn('Failed to initialize remote playback bus:', err);
    return null;
  }
}

function disposeTargetPlaybackBus(bus) {
  if (!bus) return;
  try { bus.inputNode?.disconnect(); } catch {}
  try { bus.levelNode?.disconnect(); } catch {}
}

function ensureTargetPlaybackBus(targetKey, { type = 'user' } = {}) {
  const remoteBus = ensureRemotePlaybackBus();
  const ctx = remoteBus?.ctx || null;
  if (!ctx || !shouldUsePersistentRemotePlaybackBus()) return null;

  const existing = targetPlaybackBuses.get(targetKey);
  if (existing?.ctx === ctx && existing.inputNode && existing.levelNode && existing.outputNode) {
    return existing;
  }
  if (existing) {
    disposeTargetPlaybackBus(existing);
    targetPlaybackBuses.delete(targetKey);
  }

  try {
    const inputNode = ctx.createGain();
    const levelNode = ctx.createGain();
    inputNode.gain.value = 1;
    levelNode.gain.value = 1;
    inputNode.connect(levelNode);
    levelNode.connect(remoteBus.mixNode);

    const bus = {
      key: targetKey,
      type,
      ctx,
      inputNode,
      levelNode,
      outputNode: remoteBus.mixNode,
    };
    targetPlaybackBuses.set(targetKey, bus);
    return bus;
  } catch (err) {
    console.warn('Failed to initialize target playback bus:', err);
    return null;
  }
}

function primeTargetPlaybackBus(targetKey, { type = 'user', forceRetry = false, reason = 'prime-playback-bus' } = {}) {
  ensureTargetPlaybackBus(targetKey, { type });
  const busAudio = ensureRemotePlaybackBus()?.audio || null;
  if (!busAudio) return;
  const shouldRetry = forceRetry || busAudio.paused || pendingAutoplayAudios.has(busAudio);
  if (!shouldRetry) return;
  attemptPlayAudio(busAudio, {
    reason,
    streamKey: 'bus::remote',
    targetKey,
    type,
    persistentBus: true,
  }).catch(() => {});
}

function collectVisibleRemoteTargetKeys() {
  const keys = new Map();
  document.querySelectorAll('#targets-list li.target-item').forEach((targetEl) => {
    const targetKey = targetEl?.id;
    const type = targetEl?.dataset?.type;
    if (!targetKey || !type || type === 'feed') return;
    keys.set(targetKey, type);
  });
  return keys;
}

function primeVisibleRemotePlaybackBuses({ forceRetry = false } = {}) {
  if (!shouldUsePersistentRemotePlaybackBus()) return;
  collectVisibleRemoteTargetKeys().forEach((type, targetKey) => {
    primeTargetPlaybackBus(targetKey, {
      type,
      forceRetry,
      reason: forceRetry ? 'prime-visible-playback-bus-force' : 'prime-visible-playback-bus',
    });
  });
}

function pruneTargetPlaybackBuses(allowedTargetKeys = null) {
  if (!targetPlaybackBuses.size) return;
  const visibleKeys = allowedTargetKeys || collectVisibleRemoteTargetKeys();
  targetPlaybackBuses.forEach((bus, targetKey) => {
    const keepVisible = visibleKeys instanceof Map
      ? visibleKeys.has(targetKey)
      : visibleKeys instanceof Set
      ? visibleKeys.has(targetKey)
      : false;
    if (keepVisible || targetHasActiveStreams(targetKey)) return;
    disposeTargetPlaybackBus(bus);
    targetPlaybackBuses.delete(targetKey);
  });
  if (!targetPlaybackBuses.size && remotePlaybackBus) {
    disposeRemotePlaybackBus();
  }
}

function shouldUseFeedPlaybackBus() {
  // Android browsers have been the least reliable path for the shared WebAudio
  // feed bus. Keep feeds on plain <audio> playback there.
  return !isAndroidBrowser;
}

function logRemoteAudioPlaybackDecision({
  streamKey,
  targetKey,
  isFeed = false,
  path = 'element',
  audio = null,
  context = null,
  reason = '',
} = {}) {
  const track = audio?.srcObject?.getAudioTracks?.()?.[0] || null;
  console.info('[audio][remote-playback]', {
    streamKey,
    targetKey,
    isFeed,
    path,
    reason,
    isAndroidBrowser,
    isMobileBrowser,
    isiOS,
    audioPaused: audio?.paused ?? null,
    audioMuted: audio?.muted ?? null,
    audioVolume: audio?.volume ?? null,
    trackEnabled: track?.enabled ?? null,
    trackMuted: track?.muted ?? null,
    trackReadyState: track?.readyState ?? null,
    contextState: context?.state ?? null,
  });
}

function syncAudioProcessingOptions() {
  const enabled = !!audioProcessingEnabled;
  audioProcessingOptions.echoCancellation = enabled;
  audioProcessingOptions.noiseSuppression = enabled;
  audioProcessingOptions.autoGainControl = enabled;
  return enabled;
}

function setAudioProcessingEnabled(enabled, { persist = true, updateUI = true, reinitialize = true } = {}) {
  audioProcessingEnabled = !!enabled;
  const applied = syncAudioProcessingOptions();

  if (updateUI && audioProcessingToggle) {
    audioProcessingToggle.checked = applied;
  }

  applyUserGainControlState();
  if (!reinitialize) {
    if (applied) {
      destroyUserProcessing();
    } else if (micTrack && session.kind !== 'feed') {
      ensureUserProcessingChain(micTrack);
    }
  }

  if (persist && typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(AUDIO_PROCESSING_STORAGE_KEY, String(applied));
      window.localStorage?.setItem(AUDIO_PROCESSING_EXPLICIT_STORAGE_KEY, 'true');
    } catch (err) {
      console.warn('Unable to persist audio processing preference:', err);
    }
    persistUserAudioSettingsHandler();
  }

  if (reinitialize) {
    if (typeof refreshTalkProducerForAudioProcessingChange === 'function') {
      refreshTalkProducerForAudioProcessingChange().catch((error) => {
        console.warn('Failed to refresh microphone after audio processing change:', error);
      });
    } else {
      cleanupMicTrack();
      if (settingsMenuOpen) {
        startInputMonitor();
      }
      restartVoiceTriggerMonitorHandler();
    }
  } else if (settingsMenuOpen) {
    startInputMonitor();
  }
}

function setPlayConnectionSounds(enabled, { persist = true } = {}) {
  playConnectionSoundsEnabled = !!enabled;
  connectionSounds.setEnabled(playConnectionSoundsEnabled);
  if (connectionSoundsToggle) connectionSoundsToggle.checked = playConnectionSoundsEnabled;
  if (persist && typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(CONNECTION_SOUNDS_STORAGE_KEY, String(playConnectionSoundsEnabled));
    } catch (err) {
      console.warn('Unable to persist connection sounds preference:', err);
    }
    persistUserAudioSettingsHandler();
  }
}

function updateFeedGainUI() {
  if (feedInputGainSlider) {
    const valueStr = String(feedInputGainDb);
    if (feedInputGainSlider.value !== valueStr) {
      feedInputGainSlider.value = valueStr;
    }
  }
  if (feedInputGainValueDisplay) {
    feedInputGainValueDisplay.textContent = formatDbDisplay(feedInputGainDb);
  }
}

function updateFeedProcessingUI() {
  if (feedInputProcessingToggle) {
    feedInputProcessingToggle.checked = feedInputProcessingEnabled;
  }
  if (feedLevelControls) {
    feedLevelControls.classList.toggle('is-disabled', !feedInputProcessingEnabled);
  }
  if (feedInputGainSlider) {
    feedInputGainSlider.disabled = !feedInputProcessingEnabled;
  }
  if (!feedInputProcessingEnabled) {
    setFeedMeterDisplayFor(feedMeterBarLEl, feedMeterValueLEl, feedMeterClipLEl, feedMeterStateL, 0, formatDbDisplay(-Infinity), false, null, { forceText: true });
    setFeedMeterDisplayFor(feedMeterBarREl, feedMeterValueREl, feedMeterClipREl, feedMeterStateR, 0, formatDbDisplay(-Infinity), false, null, { forceText: true });
  } else if (feedProcessingChain) {
    scheduleFeedMeterUpdate();
  }
}

function setFeedInputProcessingEnabled(enabled, { persist = true } = {}) {
  feedInputProcessingEnabled = !!enabled;
  updateFeedProcessingUI();

  if (persist && typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(FEED_INPUT_PROCESSING_STORAGE_KEY, String(feedInputProcessingEnabled));
    } catch (err) {
      console.warn('Unable to persist feed input processing preference:', err);
    }
  }

  if (!feedInputProcessingEnabled) {
    destroyFeedProcessing();
    return;
  }

  if (session.kind === 'feed' && micTrack && !feedStreaming) {
    ensureFeedProcessingChain(micTrack);
  }
}

function updateFeedPtimeUI() {
  if (feedPtimeSelect) {
    feedPtimeSelect.value = String(feedPtimeMs);
  }
}

function setFeedPtimeMs(value, { persist = true } = {}) {
  feedPtimeMs = clampFeedPtimeMs(value);
  updateFeedPtimeUI();

  if (persist && typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(FEED_PTIME_STORAGE_KEY, String(feedPtimeMs));
    } catch (err) {
      console.warn('Unable to persist feed ptime preference:', err);
    }
  }
}

function setFeedInputGainDb(dbValue, { persist = true, apply = true } = {}) {
  if (Number.isNaN(dbValue) || !Number.isFinite(dbValue)) return;
  const clamped = clampFeedInputGainDb(dbValue);
  feedInputGainDb = clamped;
  feedInputGainLinear = dbToLinear(clamped);
  updateFeedGainUI();

  if (persist && typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(FEED_INPUT_GAIN_DB_STORAGE_KEY, String(clamped));
    } catch (err) {
      console.warn('Unable to persist feed input gain:', err);
    }
  }

  if (apply && feedProcessingChain?.gainNode) {
    feedProcessingChain.gainNode.gain.value = feedInputGainLinear;
  }
}

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function textToDbValue(text) {
  if (typeof text !== 'string') return NaN;
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('-inf')) return -Infinity;
  const parsed = parseFloat(trimmed);
  return Number.isNaN(parsed) ? NaN : parsed;
}

function hasSignificantDbChange(lastDb, nextDb) {
  if (!Number.isFinite(lastDb) || !Number.isFinite(nextDb)) {
    return lastDb !== nextDb;
  }
  return Math.abs(nextDb - lastDb) >= METER_TEXT_DB_THRESHOLD;
}

function setFeedMeterDisplayFor(barEl, valueEl, clipEl, state, fraction, text, showClip, clipFraction = null, { forceText = false } = {}) {
  const clampedFraction = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  if (barEl) {
    barEl.style.width = `${(clampedFraction * 100).toFixed(1)}%`;
  }
  if (valueEl && state) {
    const now = nowMs();
    const elapsed = now - state.lastTextTime;
    const nextDb = textToDbValue(text);
    const dbChanged = hasSignificantDbChange(state.lastDb, nextDb);
    const allowUpdate = forceText
      || elapsed >= FEED_METER_TEXT_UPDATE_INTERVAL_MS
      || dbChanged;
    if (allowUpdate) {
      valueEl.textContent = text;
      state.lastText = text;
      state.lastTextTime = now;
      state.lastDb = nextDb;
    }
    valueEl.classList.toggle('is-clipping', !!showClip);
  }
  if (clipEl) {
    if (showClip) {
      const raw = clipFraction == null ? 1 : Number(clipFraction);
      const clampedClip = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 1));
      clipEl.style.left = `${(clampedClip * 100).toFixed(1)}%`;
      clipEl.style.opacity = '1';
    } else {
      clipEl.style.opacity = '0';
    }
  }
}

function destroyFeedProcessing({ resetUI = true } = {}) {
  if (!feedProcessingChain) return;
  if (feedProcessingChain.rafId) {
    cancelAnimationFrame(feedProcessingChain.rafId);
  }
  try { feedProcessingChain.sourceNode?.disconnect(); } catch {}
  try { feedProcessingChain.gainNode?.disconnect(); } catch {}
  try { feedProcessingChain.analyser?.disconnect(); } catch {}
  try { feedProcessingChain.splitter?.disconnect(); } catch {}
  try { feedProcessingChain.analyserL?.disconnect(); } catch {}
  try { feedProcessingChain.analyserR?.disconnect(); } catch {}

  try {
    const tracks = feedProcessingChain.destination?.stream?.getAudioTracks?.();
    if (tracks && typeof tracks.forEach === 'function') {
      tracks.forEach(track => {
        if (track && track.readyState !== 'ended') {
          try { track.stop(); } catch {}
        }
      });
    }
  } catch (err) {
    console.warn('Error stopping feed destination tracks:', err);
  }

  try {
    feedProcessingChain.outputTrack?.stop?.();
  } catch {}

  feedProcessingChain = null;

  if (resetUI) {
    setFeedMeterDisplayFor(feedMeterBarLEl, feedMeterValueLEl, feedMeterClipLEl, feedMeterStateL, 0, formatDbDisplay(-Infinity), false, null, { forceText: true });
    setFeedMeterDisplayFor(feedMeterBarREl, feedMeterValueREl, feedMeterClipREl, feedMeterStateR, 0, formatDbDisplay(-Infinity), false, null, { forceText: true });
  }
}

function scheduleFeedMeterUpdate() {
  if (!feedProcessingChain) return;
  if (feedProcessingChain.rafId) return;
  const tick = () => {
    if (!feedProcessingChain) return;
    feedProcessingChain.rafId = null;
    updateFeedMeterFromAnalyser();
    if (feedProcessingChain) {
      feedProcessingChain.rafId = requestAnimationFrame(tick);
    }
  };
  feedProcessingChain.rafId = requestAnimationFrame(tick);
}

function updateFeedMeterFromAnalyser() {
  const chain = feedProcessingChain;
  if (!chain) return;

  const compute = (analyser, meterData) => {
    if (!analyser || !meterData) return { peakDb: -Infinity, fraction: 0, showClip: false };
    analyser.getFloatTimeDomainData(meterData);
    let peak = 0;
    for (let i = 0; i < meterData.length; i += 1) {
      const sample = meterData[i];
      if (!Number.isFinite(sample)) continue;
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
    }
    let peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    if (!Number.isFinite(peakDb)) peakDb = -Infinity;
    const normalizedDb = Number.isFinite(peakDb)
      ? Math.max(FEED_METER_MIN_DB, Math.min(0, peakDb))
      : FEED_METER_MIN_DB;
    const fraction = normalizedDb <= FEED_METER_MIN_DB
      ? 0
      : (normalizedDb - FEED_METER_MIN_DB) / (0 - FEED_METER_MIN_DB);
    return { peakDb, fraction };
  };

  const left = compute(chain.analyserL || chain.analyser, chain.meterDataL || chain.meterData);
  const right = compute(chain.analyserR || chain.analyser, chain.meterDataR || chain.meterData);

  // Clip hold per channel
  const clipL = Number.isFinite(left.peakDb) && left.peakDb >= FEED_CLIP_THRESHOLD_DB;
  if (clipL) chain.clipHoldFramesL = 24; else if (chain.clipHoldFramesL > 0) chain.clipHoldFramesL -= 1;
  const clipR = Number.isFinite(right.peakDb) && right.peakDb >= FEED_CLIP_THRESHOLD_DB;
  if (clipR) chain.clipHoldFramesR = 24; else if (chain.clipHoldFramesR > 0) chain.clipHoldFramesR -= 1;

  const showClipL = (chain.clipHoldFramesL || 0) > 0;
  const showClipR = (chain.clipHoldFramesR || 0) > 0;

  const textL = Number.isFinite(left.peakDb) ? formatDbDisplay(left.peakDb) : '-inf dB';
  const textR = Number.isFinite(right.peakDb) ? formatDbDisplay(right.peakDb) : '-inf dB';

  setFeedMeterDisplayFor(
    feedMeterBarLEl,
    feedMeterValueLEl,
    feedMeterClipLEl,
    feedMeterStateL,
    left.fraction,
    textL,
    showClipL,
    left.fraction
  );
  setFeedMeterDisplayFor(
    feedMeterBarREl,
    feedMeterValueREl,
    feedMeterClipREl,
    feedMeterStateR,
    right.fraction,
    textR,
    showClipR,
    right.fraction
  );
}

// Builds an AudioContext processing graph for the feed to apply gain and drive the meter.
function ensureFeedProcessingChain(track) {
  if (!feedInputProcessingEnabled) {
    destroyFeedProcessing();
    return null;
  }
  const ctx = ensureFeedProcessingAudioContext();
  if (!ctx) {
    console.warn('AudioContext unavailable; feed input gain disabled.');
    return null;
  }

  if (feedProcessingChain && feedProcessingChain.originalTrack === track) {
    if (!feedProcessingChain.rafId) {
      scheduleFeedMeterUpdate();
    }
    feedProcessingChain.gainNode.gain.value = feedInputGainLinear;
    return feedProcessingChain;
  }

  destroyFeedProcessing({ resetUI: false });

  let sourceStream;
  try {
    sourceStream = new MediaStream([track]);
  } catch (err) {
    console.warn('Unable to create feed source stream:', err);
    return null;
  }

  let sourceNode;
  let gainNode;
  let analyser; // overall (fallback)
  let splitter;
  let analyserL;
  let analyserR;
  let destination;
  let outputTrack;

  try {
    sourceNode = ctx.createMediaStreamSource(sourceStream);
    gainNode = ctx.createGain();
    gainNode.gain.value = feedInputGainLinear;

    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.98;

    splitter = ctx.createChannelSplitter(2);
    analyserL = ctx.createAnalyser();
    analyserR = ctx.createAnalyser();
    analyserL.fftSize = 2048;
    analyserR.fftSize = 2048;
    analyserL.smoothingTimeConstant = 0.98;
    analyserR.smoothingTimeConstant = 0.98;

    destination = ctx.createMediaStreamDestination();

    sourceNode.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(destination);
    // Branch for per-channel analysis
    gainNode.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);

    [outputTrack] = destination.stream.getAudioTracks();
  } catch (err) {
    console.error('Failed to set up feed processing chain:', err);
    try { sourceNode?.disconnect(); } catch {}
    try { gainNode?.disconnect(); } catch {}
    try { analyser?.disconnect(); } catch {}
    return null;
  }

  if (!outputTrack) {
    console.warn('Feed processing destination produced no audio track.');
    try { sourceNode?.disconnect(); } catch {}
    try { gainNode?.disconnect(); } catch {}
    try { analyser?.disconnect(); } catch {}
    return null;
  }

  outputTrack.enabled = track.enabled;
  // For program feeds we want full-bandwidth stereo, not speech processing
  try { outputTrack.contentHint = 'music'; } catch {}

  const meterData = new Float32Array(analyser.fftSize);
  const meterDataL = new Float32Array(analyserL.fftSize);
  const meterDataR = new Float32Array(analyserR.fftSize);

  feedProcessingChain = {
    ctx,
    originalTrack: track,
    sourceStream,
    sourceNode,
    gainNode,
    analyser,
    splitter,
    analyserL,
    analyserR,
    destination,
    outputTrack,
    meterData,
    meterDataL,
    meterDataR,
    rafId: null,
    clipHoldFrames: 0,
    clipHoldFramesL: 0,
    clipHoldFramesR: 0,
  };

  setFeedMeterDisplayFor(feedMeterBarLEl, feedMeterValueLEl, feedMeterClipLEl, feedMeterStateL, 0, formatDbDisplay(-Infinity), false, null, { forceText: true });
  setFeedMeterDisplayFor(feedMeterBarREl, feedMeterValueREl, feedMeterClipREl, feedMeterStateR, 0, formatDbDisplay(-Infinity), false, null, { forceText: true });
  scheduleFeedMeterUpdate();

  if (typeof outputTrack.addEventListener === 'function') {
    outputTrack.addEventListener('ended', () => {
      if (feedProcessingChain && feedProcessingChain.outputTrack === outputTrack) {
        destroyFeedProcessing();
      }
    });
  } else {
    outputTrack.onended = () => {
      if (feedProcessingChain && feedProcessingChain.outputTrack === outputTrack) {
        destroyFeedProcessing();
      }
    };
  }

  return feedProcessingChain;
}

function getFeedProfile() {
  return {
    ...FEED_PROFILE,
    codecOptions: FEED_PROFILE.codecOptions
      ? { ...FEED_PROFILE.codecOptions, opusPtime: feedPtimeMs }
      : undefined,
    encodings: FEED_PROFILE.encodings ? FEED_PROFILE.encodings.map(enc => ({ ...enc })) : undefined,
  };
}

function getManagedInputSelects() {
  return [inputSelect, feedInputSelect].filter(Boolean);
}

function supportsAudioOutputSelection() {
  if (typeof window === 'undefined') return false;
  if (isMobileBrowser) return false;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  return !!(navigator.mediaDevices?.enumerateDevices
    && AudioCtx?.prototype
    && typeof AudioCtx.prototype.setSinkId === 'function');
}

function syncOutputSelectorVisibility() {
  if (!outputDeviceSelector) return;
  outputDeviceSelector.hidden = !supportsAudioOutputSelection();
}

function syncManagedOutputSelects(deviceId) {
  if (!outputSelect) return;
  const nextValue = deviceId || '';
  outputSelect.value = nextValue;
  if (nextValue && outputSelect.value !== nextValue) {
    const match = Array.from(outputSelect.options || []).find(opt => opt.value === nextValue);
    if (match) {
      match.selected = true;
    }
  }
}

function syncManagedInputSelects(deviceId) {
  const nextValue = deviceId || '';
  getManagedInputSelects().forEach((selectEl) => {
    selectEl.value = nextValue;
    if (nextValue && selectEl.value !== nextValue) {
      const match = Array.from(selectEl.options || []).find(opt => opt.value === nextValue);
      if (match) {
        match.selected = true;
      }
    }
  });
}

function setPreferredInputDeviceId(deviceId, { persist = true, explicit = preferredInputDeviceExplicit } = {}) {
  const normalized = deviceId || '';
  preferredInputDeviceId = normalized;
  preferredInputDeviceExplicit = Boolean(normalized && explicit);
  if (persist) {
    if (preferredInputDeviceExplicit) {
      localStorage.setItem(MIC_DEVICE_STORAGE_KEY, normalized);
      localStorage.setItem(MIC_DEVICE_EXPLICIT_STORAGE_KEY, 'true');
    } else {
      localStorage.removeItem(MIC_DEVICE_STORAGE_KEY);
      localStorage.removeItem(MIC_DEVICE_EXPLICIT_STORAGE_KEY);
    }
  }
  syncManagedInputSelects(normalized);
}

function persistPreferredOutputDeviceId(deviceId) {
  const normalized = deviceId || '';
  preferredOutputDeviceId = normalized;
  if (normalized) {
    localStorage.setItem(OUTPUT_DEVICE_STORAGE_KEY, normalized);
  } else {
    localStorage.removeItem(OUTPUT_DEVICE_STORAGE_KEY);
  }
}

function getSelectedDeviceId() {
  if (!preferredInputDeviceExplicit) return null;
  return preferredInputDeviceId || null;
}

function buildUserAudioConstraints(selectedDeviceId) {
  const qualityKey = currentQualityKey();
  const profile = QUALITY_PROFILES[qualityKey] || QUALITY_PROFILES['ultra-low'];
  const constraints = {
    echoCancellation: audioProcessingOptions.echoCancellation,
    noiseSuppression: audioProcessingOptions.noiseSuppression,
    autoGainControl: audioProcessingOptions.autoGainControl,
    ...(profile?.constraints || {}),
  };
  if (selectedDeviceId) {
    constraints.deviceId = { exact: selectedDeviceId };
  }
  return constraints;
}

function buildFeedAudioConstraints(selectedDeviceId) {
  const profile = getFeedProfile();
  const constraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    ...(profile.constraints || {}),
  };
  if (selectedDeviceId) {
    constraints.deviceId = { exact: selectedDeviceId };
  }
  return constraints;
}

function getCurrentAudioConstraints() {
  const selectedDeviceId = getSelectedDeviceId();
  const constraints = session.kind === 'feed'
    ? buildFeedAudioConstraints(selectedDeviceId)
    : buildUserAudioConstraints(selectedDeviceId);
  return { constraints, selectedDeviceId };
}

async function requestInitialMicrophoneAccess({ reason = 'startup' } = {}) {
  if (initialMicAccessRequested) return null;
  if (session.kind === 'guest' && !isGuestSessionActive()) return null;
  if (!navigator.mediaDevices?.getUserMedia) return null;

  initialMicAccessRequested = true;

  try {
    const { constraints, selectedDeviceId } = getCurrentAudioConstraints();
    const track = await ensureMicTrack(constraints, selectedDeviceId);
    if (!track) return null;

    if (!settingsMenuOpen && !producer && !feedStreaming && !isTalking && !(voiceTriggerEnabled && isOperatorSession())) {
      try { track.enabled = false; } catch {}
      if (shouldKeepReceiveAudioSessionWarm()) {
        keepMicTrackWarmForReceiveAudio('initial-mic-access');
      } else {
        scheduleMicCleanup();
      }
    }

    if (mediaInitialized && isOperatorSession() && session.kind === 'user') {
      ensureWarmTalkProducerAfterMicAccess(`initial-mic-access:${reason}`).catch((error) => {
        console.warn('Failed to pre-warm talk producer after microphone access:', error);
      });
    }

    return track;
  } catch (err) {
    console.warn(`Initial microphone access request failed (${reason}):`, err);
    return null;
  }
}

async function startInputMonitor() {
  if (!settingsMenuOpen) return null;
  if (settingsMonitorPromise) {
    return settingsMonitorPromise;
  }
  if (session.kind === 'guest' && !isGuestSessionActive()) return null;

  const activateUserMeter = async (track) => {
    if (!track || session.kind === 'feed' || audioProcessingEnabled) return;
    ensureUserProcessingChain(track);
    const monitor = ensureUserMeterMonitorChain(track);
    if (!monitor) return;
    await resumeAudioContextIfNeeded(monitor.ctx, { label: 'user input meter AudioContext' });
    scheduleUserMeterUpdate();
  };

  if (settingsMonitorActive && micTrack?.readyState === 'live') {
    micTrack.enabled = true;
    await activateUserMeter(micTrack);
    return micTrack;
  }
  settingsMonitorActive = false;

  const { constraints, selectedDeviceId } = getCurrentAudioConstraints();
  const startPromise = (async () => {
    try {
      const track = await ensureMicTrack(constraints, selectedDeviceId);
      if (!track) return null;
      if (!settingsMenuOpen) {
        if (!producer && !feedStreaming && !isTalking) {
          if (!(voiceTriggerEnabled && isOperatorSession())) {
            try { track.enabled = false; } catch {}
          }
        }
        return null;
      }

      track.enabled = true;
      settingsMonitorActive = true;

      if (session.kind !== 'feed' && !audioProcessingEnabled) {
        await activateUserMeter(track);
      }
      if (session.kind === 'feed') {
        if (feedInputProcessingEnabled) {
          ensureFeedProcessingChain(track);
          if (feedProcessingChain) {
            scheduleFeedMeterUpdate();
          }
        } else {
          destroyFeedProcessing();
        }
      }
      return track;
    } catch (err) {
      console.warn('Failed to start microphone monitoring:', err);
      return null;
    } finally {
      settingsMonitorPromise = null;
      if (!settingsMenuOpen) {
        settingsMonitorActive = false;
      }
    }
  })();

  settingsMonitorPromise = startPromise;
  return startPromise;
}

function stopInputMonitor() {
  if (settingsMonitorPromise) {
    settingsMonitorPromise = null;
  }
  settingsMonitorActive = false;

  if (feedStreaming || isTalking || pendingTalkStart || (voiceTriggerEnabled && isOperatorSession())) {
    return;
  }

  if (producer && !producer.closed) {
    if (micTrack) micTrack.enabled = false;
    if (userProcessingChain?.outputTrack) userProcessingChain.outputTrack.enabled = false;
    destroyUserMeterMonitorChain();
    return;
  }

  cleanupMicTrack();
}

function handleSettingsMenuOpened() {
  if (settingsMenuOpen) return;
  settingsMenuOpen = true;
  setActiveSettingsView('main');
  // The assigned handler owns the current user list inside the
  // DOMContentLoaded scope. Passing that closure-scoped variable here used
  // to throw because this function lives outside that scope.
  refreshTargetHotkeyUiHandler();
  startInputMonitor();
}

function handleSettingsMenuClosed() {
  if (!settingsMenuOpen) return;
  settingsMenuOpen = false;
  setActiveSettingsView('main');
  stopHotkeyCaptureHandler({ rerender: false });
  stopInputMonitor();
}

function setActiveSettingsView(nextView = 'main') {
  const resolvedView = nextView === 'shortcuts' || nextView === 'arrange' ? nextView : 'main';
  if (resolvedView === activeSettingsView && settingsMainView && settingsShortcutsView && settingsArrangeView) {
    return;
  }

  if (resolvedView !== 'shortcuts') {
    stopHotkeyCaptureHandler({ rerender: false });
  }
  if (resolvedView !== 'arrange') {
    cancelArrangeTargetsDragHandler();
  }

  activeSettingsView = resolvedView;

  if (settingsMainView) {
    settingsMainView.hidden = resolvedView !== 'main';
  }
  if (settingsShortcutsView) {
    settingsShortcutsView.hidden = resolvedView !== 'shortcuts';
  }
  if (settingsArrangeView) {
    settingsArrangeView.hidden = resolvedView !== 'arrange';
  }

  if (resolvedView === 'shortcuts') {
    renderTargetHotkeySettingsHandler();
  } else if (resolvedView === 'arrange') {
    loadArrangeTargetsHandler();
  }
}

function bindSettingsViewButton(button, nextView) {
  if (!button) return;
  const handleActivate = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    setActiveSettingsView(nextView);
  };
  button.addEventListener('click', handleActivate);
  button.addEventListener('pointerup', handleActivate);
}

if (typeof window !== 'undefined') {
  window.__talktomeOpenSettings = handleSettingsMenuOpened;
  window.__talktomeCloseSettings = handleSettingsMenuClosed;
}

function updateUserGainUI() {
  if (userInputGainSlider) {
    const valueStr = String(userInputGainDb);
    if (userInputGainSlider.value !== valueStr) {
      userInputGainSlider.value = valueStr;
    }
  }
  if (userInputGainValueDisplay) {
    userInputGainValueDisplay.textContent = formatDbDisplay(userInputGainDb);
  }
}

function applyUserGainControlState() {
  const disabled = audioProcessingEnabled || session.kind === 'feed';
  if (userLevelControls) {
    userLevelControls.classList.toggle('is-disabled', disabled);
  }
  if (userInputGainSlider) {
    userInputGainSlider.disabled = disabled;
  }
  if (disabled) {
    destroyUserMeterMonitorChain();
  } else if (settingsMenuOpen && micTrack?.readyState === 'live') {
    ensureUserMeterMonitorChain(micTrack);
    scheduleUserMeterUpdate();
  }
  return disabled;
}

function setUserInputGainDb(dbValue, { persist = true, apply = true } = {}) {
  if (Number.isNaN(dbValue) || !Number.isFinite(dbValue)) return;
  const clamped = clampUserInputGainDb(dbValue);
  userInputGainDb = clamped;
  userInputGainLinear = dbToLinear(clamped);
  updateUserGainUI();

  if (persist && typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(USER_INPUT_GAIN_DB_STORAGE_KEY, String(clamped));
    } catch (err) {
      console.warn('Unable to persist user input gain:', err);
    }
    persistUserAudioSettingsHandler();
  }

  if (apply && userProcessingChain?.gainNode) {
    userProcessingChain.gainNode.gain.value = userInputGainLinear;
  }
  if (apply && userMeterMonitorChain?.gainNode) {
    userMeterMonitorChain.gainNode.gain.value = userInputGainLinear;
  }
}

function setUserMeterDisplay(fraction, text, showClip, clipFraction = null, { forceText = false } = {}) {
  const clampedFraction = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  if (userMeterBarEl) {
    userMeterBarEl.style.width = `${(clampedFraction * 100).toFixed(1)}%`;
  }
  if (userMeterValueEl) {
    const now = nowMs();
    const elapsed = now - userMeterLastTextTime;
    const nextDb = textToDbValue(text);
    const dbChanged = hasSignificantDbChange(userMeterLastDb, nextDb);
    const allowUpdate = forceText
      || elapsed >= USER_METER_TEXT_UPDATE_INTERVAL_MS
      || dbChanged;
    if (allowUpdate) {
      userMeterValueEl.textContent = text;
      userMeterLastText = text;
      userMeterLastTextTime = now;
      userMeterLastDb = nextDb;
    }
    userMeterValueEl.classList.toggle('is-clipping', !!showClip);
  }
  if (userMeterClipEl) {
    if (showClip) {
      const raw = clipFraction == null ? 1 : Number(clipFraction);
      const clampedClip = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 1));
      userMeterClipEl.style.left = `${(clampedClip * 100).toFixed(1)}%`;
      userMeterClipEl.style.opacity = '1';
    } else {
      userMeterClipEl.style.opacity = '0';
    }
  }
}

function destroyUserMeterMonitorChain({ resetUI = true } = {}) {
  if (userMeterMonitorChain?.rafId) {
    cancelAnimationFrame(userMeterMonitorChain.rafId);
  }
  try { userMeterMonitorChain?.sourceNode?.disconnect(); } catch {}
  try { userMeterMonitorChain?.gainNode?.disconnect(); } catch {}
  try { userMeterMonitorChain?.analyser?.disconnect(); } catch {}
  try { userMeterMonitorChain?.sinkGain?.disconnect(); } catch {}
  if (userMeterMonitorChain?.monitorTrack && userMeterMonitorChain.monitorTrack !== userMeterMonitorChain.originalTrack) {
    try { userMeterMonitorChain.monitorTrack.stop(); } catch {}
  }
  userMeterMonitorChain = null;

  if (resetUI) {
    setUserMeterDisplay(0, formatDbDisplay(-Infinity), false, null, { forceText: true });
  }
}

function ensureUserMeterMonitorChain(track) {
  if (!track || track.readyState !== 'live' || audioProcessingEnabled || session.kind === 'feed') {
    return null;
  }

  if (
    userMeterMonitorChain
    && userMeterMonitorChain.originalTrack === track
    && userMeterMonitorChain.monitorTrack?.readyState === 'live'
  ) {
    userMeterMonitorChain.gainNode.gain.value = userInputGainLinear;
    return userMeterMonitorChain;
  }

  destroyUserMeterMonitorChain({ resetUI: false });
  const ctx = ensureAudioContext();
  if (!ctx) return null;

  let sourceStream;
  let monitorTrack;
  let sourceNode;
  let gainNode;
  let analyser;
  let sinkGain;
  try {
    monitorTrack = typeof track.clone === 'function' ? track.clone() : track;
    monitorTrack.enabled = true;
    sourceStream = new MediaStream([monitorTrack]);
    sourceNode = ctx.createMediaStreamSource(sourceStream);
    gainNode = ctx.createGain();
    gainNode.gain.value = userInputGainLinear;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;
    sinkGain = ctx.createGain();
    sinkGain.gain.value = INPUT_MONITOR_SINK_GAIN;
    sourceNode.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(sinkGain);
    sinkGain.connect(ctx.destination);
  } catch (error) {
    console.warn('Failed to set up user input meter:', error);
    try { sourceNode?.disconnect(); } catch {}
    try { gainNode?.disconnect(); } catch {}
    try { analyser?.disconnect(); } catch {}
    try { sinkGain?.disconnect(); } catch {}
    if (monitorTrack && monitorTrack !== track) {
      try { monitorTrack.stop(); } catch {}
    }
    return null;
  }

  userMeterMonitorChain = {
    ctx,
    originalTrack: track,
    monitorTrack,
    sourceStream,
    sourceNode,
    gainNode,
    analyser,
    sinkGain,
    meterData: new Float32Array(analyser.fftSize),
    rafId: null,
    clipHoldFrames: 0,
  };
  setUserMeterDisplay(0, formatDbDisplay(-Infinity), false, null, { forceText: true });
  return userMeterMonitorChain;
}

function destroyUserProcessing({ resetUI = true } = {}) {
  if (!userProcessingChain) return;
  try { userProcessingChain.sourceNode?.disconnect(); } catch {}
  try { userProcessingChain.gainNode?.disconnect(); } catch {}
  try { userProcessingChain.analyser?.disconnect(); } catch {}

  try {
    const tracks = userProcessingChain.destination?.stream?.getAudioTracks?.();
    if (tracks && typeof tracks.forEach === 'function') {
      tracks.forEach(track => {
        if (track && track.readyState !== 'ended') {
          try { track.stop(); } catch {}
        }
      });
    }
  } catch (err) {
    console.warn('Error stopping user destination tracks:', err);
  }

  try {
    userProcessingChain.outputTrack?.stop?.();
  } catch {}

  userProcessingChain = null;

  if (resetUI && !userMeterMonitorChain) {
    setUserMeterDisplay(0, formatDbDisplay(-Infinity), false, null, { forceText: true });
  }
}

function scheduleUserMeterUpdate() {
  if (!userMeterMonitorChain) return;
  if (userMeterMonitorChain.rafId) return;
  const tick = () => {
    if (!userMeterMonitorChain) return;
    userMeterMonitorChain.rafId = null;
    updateUserMeterFromAnalyser();
    if (userMeterMonitorChain) {
      userMeterMonitorChain.rafId = requestAnimationFrame(tick);
    }
  };
  userMeterMonitorChain.rafId = requestAnimationFrame(tick);
}

function updateUserMeterFromAnalyser() {
  const chain = userMeterMonitorChain;
  if (!chain || !chain.analyser || !chain.meterData) return;
  chain.analyser.getFloatTimeDomainData(chain.meterData);

  let peak = 0;
  for (let i = 0; i < chain.meterData.length; i += 1) {
    const sample = chain.meterData[i];
    if (!Number.isFinite(sample)) continue;
    const abs = Math.abs(sample);
    if (abs > peak) peak = abs;
  }

  let peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  if (!Number.isFinite(peakDb)) {
    peakDb = -Infinity;
  }

  const normalizedDb = Number.isFinite(peakDb)
    ? Math.max(USER_METER_MIN_DB, Math.min(0, peakDb))
    : USER_METER_MIN_DB;

  const fraction = normalizedDb <= USER_METER_MIN_DB
    ? 0
    : (normalizedDb - USER_METER_MIN_DB) / (0 - USER_METER_MIN_DB);

  const clipDetected = Number.isFinite(peakDb) && peakDb >= USER_CLIP_THRESHOLD_DB;
  if (clipDetected) {
    chain.clipHoldFrames = 24;
  } else if (chain.clipHoldFrames > 0) {
    chain.clipHoldFrames -= 1;
  }
  const showClip = (chain.clipHoldFrames || 0) > 0;

  const displayText = Number.isFinite(peakDb)
    ? formatDbDisplay(peakDb)
    : '-inf dB';

  setUserMeterDisplay(fraction, displayText, showClip, fraction);
}

function ensureUserProcessingChain(track) {
  const ctx = ensureAudioContext();
  if (!ctx) {
    console.warn('AudioContext unavailable; user manual gain disabled.');
    return null;
  }

  if (userProcessingChain && userProcessingChain.originalTrack === track) {
    userProcessingChain.gainNode.gain.value = userInputGainLinear;
    return userProcessingChain;
  }

  destroyUserProcessing({ resetUI: false });

  let sourceStream;
  try {
    sourceStream = new MediaStream([track]);
  } catch (err) {
    console.warn('Unable to create user source stream:', err);
    return null;
  }

  let sourceNode;
  let gainNode;
  let analyser;
  let destination;
  let outputTrack;

  try {
    sourceNode = ctx.createMediaStreamSource(sourceStream);
    gainNode = ctx.createGain();
    gainNode.gain.value = userInputGainLinear;

    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;

    destination = ctx.createMediaStreamDestination();

    sourceNode.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(destination);

    [outputTrack] = destination.stream.getAudioTracks();
  } catch (err) {
    console.error('Failed to set up user processing chain:', err);
    try { sourceNode?.disconnect(); } catch {}
    try { gainNode?.disconnect(); } catch {}
    try { analyser?.disconnect(); } catch {}
    return null;
  }

  if (!outputTrack) {
    console.warn('User processing destination produced no audio track.');
    try { sourceNode?.disconnect(); } catch {}
    try { gainNode?.disconnect(); } catch {}
    try { analyser?.disconnect(); } catch {}
    return null;
  }

  outputTrack.enabled = track.enabled;
  outputTrack.contentHint = track.contentHint || 'speech';

  userProcessingChain = {
    ctx,
    originalTrack: track,
    sourceStream,
    sourceNode,
    gainNode,
    analyser,
    destination,
    outputTrack,
  };

  if (typeof outputTrack.addEventListener === 'function') {
    outputTrack.addEventListener('ended', () => {
      if (userProcessingChain && userProcessingChain.outputTrack === outputTrack) {
        destroyUserProcessing();
      }
    });
  } else {
    outputTrack.onended = () => {
      if (userProcessingChain && userProcessingChain.outputTrack === outputTrack) {
        destroyUserProcessing();
      }
    };
  }

  return userProcessingChain;
}

function destroyVoiceTriggerMonitorChain() {
  if (!voiceTriggerMonitorChain) return;
  try { voiceTriggerMonitorChain.sourceNode?.disconnect(); } catch {}
  try { voiceTriggerMonitorChain.analyser?.disconnect(); } catch {}
  try { voiceTriggerMonitorChain.sinkGain?.disconnect(); } catch {}
  voiceTriggerMonitorChain = null;
}

function ensureVoiceTriggerMonitorChain(track) {
  if (!track || track.readyState !== 'live') return null;

  if (
    !audioProcessingEnabled
    && userMeterMonitorChain
    && userMeterMonitorChain.originalTrack === track
    && userMeterMonitorChain.analyser
    && userMeterMonitorChain.meterData
  ) {
    destroyVoiceTriggerMonitorChain();
    return {
      analyser: userMeterMonitorChain.analyser,
      meterData: userMeterMonitorChain.meterData,
      shared: true,
    };
  }

  if (voiceTriggerMonitorChain && voiceTriggerMonitorChain.originalTrack === track) {
    return voiceTriggerMonitorChain;
  }

  destroyVoiceTriggerMonitorChain();

  const ctx = ensureAudioContext();
  if (!ctx) return null;

  let sourceStream;
  let sourceNode;
  let analyser;
  let sinkGain;

  try {
    sourceStream = new MediaStream([track]);
    sourceNode = ctx.createMediaStreamSource(sourceStream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    sinkGain = ctx.createGain();
    sinkGain.gain.value = INPUT_MONITOR_SINK_GAIN;
    sourceNode.connect(analyser);
    analyser.connect(sinkGain);
    sinkGain.connect(ctx.destination);
  } catch (err) {
    console.warn('Failed to set up voice trigger monitor:', err);
    try { sourceNode?.disconnect(); } catch {}
    try { analyser?.disconnect(); } catch {}
    try { sinkGain?.disconnect(); } catch {}
    return null;
  }

  voiceTriggerMonitorChain = {
    originalTrack: track,
    sourceStream,
    sourceNode,
    analyser,
    sinkGain,
    meterData: new Float32Array(analyser.fftSize),
  };

  return voiceTriggerMonitorChain;
}

function getPeakDbFromAnalyser(analyser, meterData) {
  if (!analyser || !meterData) return -Infinity;
  analyser.getFloatTimeDomainData(meterData);

  let peak = 0;
  for (let i = 0; i < meterData.length; i += 1) {
    const sample = meterData[i];
    if (!Number.isFinite(sample)) continue;
    const abs = Math.abs(sample);
    if (abs > peak) peak = abs;
  }

  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  return Number.isFinite(peakDb) ? peakDb : -Infinity;
}

function attemptPendingAutoplay() {
  pendingAutoplayAudios.forEach(audio => {
    attemptPlayAudio(audio, { reason: 'pending-autoplay-retry' })
      .catch(err => console.warn('Autoplay retry failed:', err));
  });
}

function handleUserActivation() {
  primeVoiceProcessingMode().catch(() => {});
  const sharedCtx = ensureAudioContext();
  resumeAudioContextIfNeeded(sharedCtx, {
    label: 'shared AudioContext',
    onRunning: typeof onAudioContextRunning === 'function' ? onAudioContextRunning : null,
  });
  if (feedProcessingAudioContext) {
    resumeAudioContextIfNeeded(feedProcessingAudioContext, { label: 'feed ingest AudioContext' });
  }
  const remoteBusAudio = ensureRemotePlaybackBus()?.audio || null;
  if (remoteBusAudio) {
    attemptPlayAudio(remoteBusAudio, {
      reason: 'user-activation-prime-remote-bus',
      streamKey: 'bus::remote',
      targetKey: 'remote-bus',
      type: 'remote-bus',
      persistentBus: true,
    }).catch(() => {});
  }
  primeVisibleRemotePlaybackBuses({ forceRetry: true });
  attemptPendingAutoplay();
  recoverExistingIncomingPlayback({ forceRetryAll: true });
}

function installReceiveAudioSessionDiagnostics() {
  if (!(isiOS || isSafariBrowser)) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  ['visibilitychange'].forEach(eventName => {
    document.addEventListener(eventName, () => {
      logReceiveDiagnostic(`document-${eventName}`, {
        remotePlaybackBus: getAudioElementSnapshot(remotePlaybackBus?.audio || null),
        micTrack: getAudioTrackSnapshot(micTrack),
      });
    });
  });
  ['focus', 'blur', 'pagehide', 'pageshow'].forEach(eventName => {
    window.addEventListener(eventName, () => {
      logReceiveDiagnostic(`window-${eventName}`, {
        remotePlaybackBus: getAudioElementSnapshot(remotePlaybackBus?.audio || null),
        micTrack: getAudioTrackSnapshot(micTrack),
      });
    });
  });

  const audioSession = typeof navigator !== 'undefined' ? navigator.audioSession : null;
  if (audioSession && typeof audioSession.addEventListener === 'function') {
    audioSession.addEventListener('statechange', () => {
      logReceiveDiagnostic('audio-session-statechange', {
        remotePlaybackBus: getAudioElementSnapshot(remotePlaybackBus?.audio || null),
        micTrack: getAudioTrackSnapshot(micTrack),
      });
    });
  }
}

installReceiveAudioSessionDiagnostics();

USER_ACTIVATION_EVENTS.forEach(event => {
  window.addEventListener(event, handleUserActivation, { capture: true });
});


socket.onAny((event, ...args) => {
  console.log("[socket.onAny] got event", event, args);
});

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res.json();
}

function getStoredVolume(key, defaultValue = defaultVolume) {
  const normalizeVolume = (rawValue, fallbackValue) => {
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) return fallbackValue;
    return Math.max(0, Math.min(1, numericValue));
  };

  try {
    const v = sessionStorage.getItem(key);
    if (v !== null) {
      const normalized = normalizeVolume(v, defaultValue);
      volumeMemoryStore.set(key, normalized);
      return normalized;
    }
  } catch (error) {
    if (!warnedVolumeStorageRead) {
      warnedVolumeStorageRead = true;
      console.warn('Session storage unavailable for volume read:', error);
    }
  }

  if (volumeMemoryStore.has(key)) {
    return normalizeVolume(volumeMemoryStore.get(key), defaultValue);
  }

  return normalizeVolume(defaultValue, defaultValue);
}

function storeVolume(key, value) {
  const numericValue = Number(value);
  const normalized = Math.max(
    0,
    Math.min(1, Number.isFinite(numericValue) ? numericValue : defaultVolume)
  );
  volumeMemoryStore.set(key, normalized);
  try {
    sessionStorage.setItem(key, String(normalized));
  } catch (error) {
    if (!warnedVolumeStorageWrite) {
      warnedVolumeStorageWrite = true;
      console.warn('Session storage unavailable for volume write:', error);
    }
  }
}

async function updateDeviceList() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs  = devices.filter(d => d.kind === "audioinput");
  const outputs = devices.filter(d => d.kind === "audiooutput");

  const selectors = getManagedInputSelects();
  selectors.forEach((selectEl) => {
    selectEl.innerHTML = `<option value="">Select device</option>`;
    inputs.forEach((d, index) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `Microphone ${index + 1}`;
      selectEl.append(opt);
    });
  });

  if (selectors.length > 0) {
    const availableIds = new Set(inputs.map(d => d.deviceId));
    let desiredDeviceId = null;

    if (micDeviceId && availableIds.has(micDeviceId)) {
      desiredDeviceId = micDeviceId;
    } else if (preferredInputDeviceExplicit && preferredInputDeviceId && availableIds.has(preferredInputDeviceId)) {
      desiredDeviceId = preferredInputDeviceId;
    } else if (inputs[0]) {
      desiredDeviceId = inputs[0].deviceId;
    }

    if (desiredDeviceId) {
      if (preferredInputDeviceExplicit && desiredDeviceId === preferredInputDeviceId) {
        setPreferredInputDeviceId(desiredDeviceId, { persist: true, explicit: true });
      } else {
        preferredInputDeviceExplicit = false;
        try {
          localStorage.removeItem(MIC_DEVICE_STORAGE_KEY);
          localStorage.removeItem(MIC_DEVICE_EXPLICIT_STORAGE_KEY);
        } catch {}
        preferredInputDeviceId = desiredDeviceId;
        syncManagedInputSelects(desiredDeviceId);
      }
    } else {
      preferredInputDeviceId = '';
      preferredInputDeviceExplicit = false;
      syncManagedInputSelects('');
    }
  }

  if (outputSelect) {
    outputSelect.innerHTML = `<option value="">System default</option>`;
    const concreteOutputs = outputs.filter((d) =>
      d?.deviceId
      && d.deviceId !== 'default'
      && d.deviceId !== 'communications'
    );
    concreteOutputs.forEach((d, index) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `Output ${index + 1}`;
      outputSelect.append(opt);
    });

    const hasSelectableOutputs = supportsAudioOutputSelection() && concreteOutputs.length > 0;
    if (outputDeviceSelector) {
      outputDeviceSelector.hidden = !hasSelectableOutputs;
    }

    if (hasSelectableOutputs) {
      const availableIds = new Set(concreteOutputs.map(d => d.deviceId));
      const desiredOutputId = preferredOutputDeviceId && availableIds.has(preferredOutputDeviceId)
        ? preferredOutputDeviceId
        : '';
      syncManagedOutputSelects(desiredOutputId);
      outputSelect.disabled = false;
    } else {
      syncManagedOutputSelects('');
      outputSelect.disabled = true;
    }
  }
}

function cleanupMicTrack() {
  if (micCleanupTimer) {
    clearTimeout(micCleanupTimer);
    micCleanupTimer = null;
  }

  settingsMonitorActive = false;
  settingsMonitorPromise = null;

  destroyFeedProcessing();
  destroyUserMeterMonitorChain();
  destroyUserProcessing();
  destroyVoiceTriggerMonitorChain();

  if (micTrack) {
    try { micTrack.stop(); } catch {}
    micTrack.onended = null;
    micTrack = null;
  }

  if (micStream) {
    micStream.getTracks().forEach(track => {
      try { track.stop(); } catch {}
    });
    micStream = null;
  }

  micDeviceId = null;
}

function shouldKeepReceiveAudioSessionWarm() {
  return isiOS && isSafariBrowser && session.kind !== 'feed';
}

function keepMicTrackWarmForReceiveAudio(reason = 'receive-audio-session') {
  if (micCleanupTimer) {
    clearTimeout(micCleanupTimer);
    micCleanupTimer = null;
  }
  logReceiveDiagnostic('mic-kept-warm-for-receive-audio', {
    reason,
    micTrack: getAudioTrackSnapshot(micTrack),
  });
}

function scheduleMicCleanup() {
  if (voiceTriggerEnabled && isOperatorSession()) {
    return;
  }

  if (shouldKeepReceiveAudioSessionWarm() && micTrack?.readyState === 'live') {
    keepMicTrackWarmForReceiveAudio('skip-idle-cleanup');
    return;
  }

  if (micCleanupTimer) {
    clearTimeout(micCleanupTimer);
  }

  micCleanupTimer = setTimeout(() => {
    if (!producer) {
      cleanupMicTrack();
    }
  }, 60000);
}

function buildRelaxedAudioConstraints(audioConstraints, { dropDeviceId = false } = {}) {
  if (!audioConstraints || typeof audioConstraints !== 'object') {
    return audioConstraints;
  }

  const relaxed = { ...audioConstraints };
  if (dropDeviceId) {
    delete relaxed.deviceId;
  }
  if ('channelCount' in relaxed) {
    delete relaxed.channelCount;
  }
  if ('sampleRate' in relaxed) {
    delete relaxed.sampleRate;
  }
  return relaxed;
}

async function ensureMicTrack(audioConstraints, selectedDeviceId) {
  if (micTrack && micTrack.readyState === 'live') {
    if (!selectedDeviceId || selectedDeviceId === micDeviceId) {
      if (micCleanupTimer) {
        clearTimeout(micCleanupTimer);
        micCleanupTimer = null;
      }
      if (session.kind !== 'feed') {
        if (!audioProcessingEnabled) {
          ensureUserProcessingChain(micTrack);
        } else {
          destroyUserProcessing();
        }
      }
      return micTrack;
    }
    cleanupMicTrack();
  }

  let stream;
  const openMic = (constraints) => navigator.mediaDevices.getUserMedia({ audio: constraints });
  try {
    stream = await openMic(audioConstraints);
  } catch (error) {
    const shouldRetryRelaxed = error?.name === 'OverconstrainedError' || error?.name === 'NotFoundError';
    if (!shouldRetryRelaxed) {
      throw error;
    }

    const relaxedConstraints = buildRelaxedAudioConstraints(audioConstraints, {
      dropDeviceId: !!selectedDeviceId,
    });
    console.warn('Retrying microphone access with relaxed constraints:', {
      original: audioConstraints,
      relaxed: relaxedConstraints,
      error: error?.message || error,
    });
    try {
      stream = await openMic(relaxedConstraints);
    } catch (retryError) {
      const shouldRetryPlain = retryError?.name === 'OverconstrainedError' || retryError?.name === 'NotFoundError';
      if (!shouldRetryPlain) {
        throw retryError;
      }
      console.warn('Retrying microphone access with plain audio constraints:', {
        original: audioConstraints,
        relaxed: relaxedConstraints,
        error: retryError?.message || retryError,
      });
      stream = await openMic(true);
    }
  }
  const [track] = stream.getAudioTracks();

  micStream = stream;
  micTrack = track;
  micDeviceId = selectedDeviceId || track.getSettings?.().deviceId || null;
  micPrimed = true;

  if (micDeviceId) {
    setPreferredInputDeviceId(micDeviceId, {
      persist: preferredInputDeviceExplicit,
      explicit: preferredInputDeviceExplicit && !!selectedDeviceId,
    });
  }

  track.onended = () => {
    micTrack = null;
    micStream = null;
    micDeviceId = null;
  };

  if (micCleanupTimer) {
    clearTimeout(micCleanupTimer);
    micCleanupTimer = null;
  }

  if (session.kind !== 'feed') {
    if (!audioProcessingEnabled) {
      ensureUserProcessingChain(micTrack);
    } else {
      destroyUserProcessing();
    }
  }

  updateDeviceList().catch((error) => {
    console.warn('Failed to refresh device list after microphone access:', error);
  });

  return micTrack;
}

async function warmReceiveAudioSession(reason = 'receive-audio-session') {
  if (!shouldKeepReceiveAudioSessionWarm()) return micTrack;
  if (!navigator.mediaDevices?.getUserMedia) return micTrack;
  if (micTrack?.readyState === 'live') {
    if (!settingsMenuOpen && !(voiceTriggerEnabled && isOperatorSession())) {
      try { micTrack.enabled = false; } catch {}
    }
    keepMicTrackWarmForReceiveAudio(reason);
    return micTrack;
  }

  const { constraints, selectedDeviceId } = getCurrentAudioConstraints();
  const track = await ensureMicTrack(constraints, selectedDeviceId);
  if (track && !settingsMenuOpen && !(voiceTriggerEnabled && isOperatorSession())) {
    try { track.enabled = false; } catch {}
  }
  keepMicTrackWarmForReceiveAudio(reason);
  return track;
}

async function primeVoiceProcessingMode() {
  if (!isiOS) return;
  if (micPrimed) return;
  if (micPrimingPromise) return micPrimingPromise;

  micPrimingPromise = (async () => {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      const [track] = stream.getAudioTracks();
      if (!track) {
        console.warn('Voice processing priming: no audio track returned');
        return;
      }
      micPrimed = true;
      const ctx = ensureAudioContext();
      if (ctx) {
        try {
          const source = ctx.createMediaStreamSource(stream);
          const gain = ctx.createGain();
          gain.gain.value = 0;
          source.connect(gain).connect(ctx.destination);
          await new Promise(res => setTimeout(res, 200));
          source.disconnect();
          gain.disconnect();
        } catch (err) {
          console.warn('Voice processing priming via AudioContext failed:', err);
        }
      } else {
        const tempAudio = document.createElement('audio');
        tempAudio.srcObject = stream;
        tempAudio.muted = true;
        try {
          await tempAudio.play();
          await new Promise(res => setTimeout(res, 200));
        } catch (err) {
          console.warn('Voice processing priming playback failed:', err);
        } finally {
          tempAudio.pause();
          tempAudio.srcObject = null;
        }
      }
    } catch (err) {
      console.warn('Voice processing priming failed:', err);
    } finally {
      if (stream) {
        stream.getTracks().forEach(track => {
          try { track.stop(); } catch {}
        });
      }
      micPrimingPromise = null;
    }
  })();

  return micPrimingPromise;
}

function currentQualityKey() {
  const fromSelect = qualitySelect?.value;
  if (fromSelect && QUALITY_PROFILES[fromSelect]) return fromSelect;

  const stored = localStorage.getItem('audioQualityProfile');
  if (stored && QUALITY_PROFILES[stored]) return stored;

  const serverDefault = serverDefaultClientSettings.audioProfile;
  return QUALITY_PROFILES[serverDefault] ? serverDefault : 'ultra-low';
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded, initializing...");
  document.body?.classList.toggle('feed-dim-unsupported', !supportsFeedDimming());

  inputSelect  = document.getElementById("input-select");
  feedInputSelect = document.getElementById("feed-input-select");
  outputDeviceSelector = document.getElementById("output-device-selector");
  outputSelect = document.getElementById("output-select");
  qualitySelect = document.getElementById("quality-select");
  dimAmountSelect = document.getElementById('dim-amount-select');
  settingsMainView = document.getElementById('settings-main-view');
  settingsShortcutsView = document.getElementById('settings-shortcuts-view');
  settingsArrangeView = document.getElementById('settings-arrange-view');
  shortcutSettingsOpenButton = document.getElementById('shortcut-settings-open');
  shortcutSettingsBackButton = document.getElementById('shortcut-settings-back');
  arrangeTargetsOpenButton = document.getElementById('arrange-targets-open');
  arrangeTargetsBackButton = document.getElementById('arrange-targets-back');
  shortcutSettingsSection = document.getElementById('shortcut-settings');
  shortcutSettingsList = document.getElementById('shortcut-settings-list');
  shortcutSettingsEmpty = document.getElementById('shortcut-settings-empty');
  shortcutResetButton = document.getElementById('shortcut-reset-btn');
  sessionSlideHintEl = document.getElementById('session-slide-hint');
  dimWhileSpeakingToggle = document.getElementById('toggle-self-dim');
  dimWhenAddressedToggle = document.getElementById('toggle-incoming-dim');
  audioProcessingToggle = document.getElementById('toggle-processing');
  connectionSoundsToggle = document.getElementById('toggle-connection-sounds');
  leftHandModeToggle = document.getElementById('toggle-left-hand-mode');
  lockMultipleTargetsToggle = document.getElementById('toggle-lock-multiple-targets');
  userLevelControls = document.getElementById('user-level-controls');
  userInputGainSlider = document.getElementById('user-input-gain');
  userInputGainValueDisplay = document.getElementById('user-input-gain-value');
  userMeterBarEl = document.getElementById('user-meter-bar');
  userMeterClipEl = document.getElementById('user-meter-clip');
  userMeterValueEl = document.getElementById('user-meter-value');
  voiceTriggerControls = document.getElementById('voice-trigger-controls');
  voiceTriggerToggle = document.getElementById('toggle-voice-trigger');
  voiceTriggerTargetSelect = document.getElementById('voice-trigger-target');
  voiceTriggerThresholdSlider = document.getElementById('voice-trigger-threshold');
  voiceTriggerThresholdValueDisplay = document.getElementById('voice-trigger-threshold-value');
  voiceTriggerStatusEl = document.getElementById('voice-trigger-status');
  feedInputProcessingToggle = document.getElementById('toggle-feed-input-processing');
  feedPtimeSelect = document.getElementById('feed-ptime-select');
  feedLevelControls = document.getElementById('feed-level-controls');
  feedInputGainSlider = document.getElementById('feed-input-gain');
  feedInputGainValueDisplay = document.getElementById('feed-input-gain-value');
  feedMeterBarLEl = document.getElementById('feed-meter-bar-L');
  feedMeterClipLEl = document.getElementById('feed-meter-clip-L');
  feedMeterValueLEl = document.getElementById('feed-meter-value-L');
  feedMeterBarREl = document.getElementById('feed-meter-bar-R');
  feedMeterClipREl = document.getElementById('feed-meter-clip-R');
  feedMeterValueREl = document.getElementById('feed-meter-value-R');
  syncOutputSelectorVisibility();
  syncManagedOutputSelects(preferredOutputDeviceId);

  updateUserGainUI();
  setUserMeterDisplay(0, formatDbDisplay(-Infinity), false, null, { forceText: true });
  updateFeedGainUI();
  updateFeedProcessingUI();
  updateFeedPtimeUI();
  setFeedMeterDisplayFor(feedMeterBarLEl, feedMeterValueLEl, feedMeterClipLEl, feedMeterStateL, 0, formatDbDisplay(-Infinity), false, null, { forceText: true });
  setFeedMeterDisplayFor(feedMeterBarREl, feedMeterValueREl, feedMeterClipREl, feedMeterStateR, 0, formatDbDisplay(-Infinity), false, null, { forceText: true });
  applyUserGainControlState();
  ensureCustomTargetHotkeysLoaded();

  if (shortcutResetButton) {
    shortcutResetButton.addEventListener('click', () => {
      resetCustomTargetHotkeys();
    });
  }
  bindSettingsViewButton(shortcutSettingsOpenButton, 'shortcuts');
  bindSettingsViewButton(shortcutSettingsBackButton, 'main');
  bindSettingsViewButton(arrangeTargetsOpenButton, 'arrange');
  bindSettingsViewButton(arrangeTargetsBackButton, 'main');

  if (feedInputProcessingToggle) {
    feedInputProcessingToggle.checked = feedInputProcessingEnabled;
    feedInputProcessingToggle.addEventListener('change', () => {
      setFeedInputProcessingEnabled(feedInputProcessingToggle.checked);
      if (session.kind === 'feed' && feedStreaming) {
        restartFeedStreamForSettingsChange('feed input processing').catch(err => {
          console.error('Failed to restart feed after input processing change', err);
        });
      }
    });
  }

  if (feedPtimeSelect) {
    feedPtimeSelect.value = String(feedPtimeMs);
    feedPtimeSelect.addEventListener('change', () => {
      setFeedPtimeMs(feedPtimeSelect.value);
      if (session.kind === 'feed' && feedStreaming) {
        restartFeedStreamForSettingsChange('packet time').catch(err => {
          console.error('Failed to restart feed after packet time change', err);
        });
      }
    });
  }

  if (feedInputGainSlider) {
    feedInputGainSlider.addEventListener('input', () => {
      const value = parseFloat(feedInputGainSlider.value);
      if (!Number.isNaN(value)) {
        setFeedInputGainDb(value, { persist: false });
      }
    });
    feedInputGainSlider.addEventListener('change', () => {
      const value = parseFloat(feedInputGainSlider.value);
      if (!Number.isNaN(value)) {
        setFeedInputGainDb(value);
      }
    });
  }

  if (userInputGainSlider) {
    userInputGainSlider.addEventListener('input', () => {
      const value = parseFloat(userInputGainSlider.value);
      if (!Number.isNaN(value)) {
        setUserInputGainDb(value, { persist: false });
      }
    });
    userInputGainSlider.addEventListener('change', () => {
      const value = parseFloat(userInputGainSlider.value);
      if (!Number.isNaN(value)) {
        setUserInputGainDb(value);
      }
    });
  }

  updateVoiceTriggerThresholdUI();
  updateVoiceTriggerControlsState();

  if (voiceTriggerToggle) {
    voiceTriggerToggle.checked = voiceTriggerEnabled;
    voiceTriggerToggle.addEventListener('change', () => {
      setVoiceTriggerEnabled(voiceTriggerToggle.checked);
    });
  }

  if (voiceTriggerTargetSelect) {
    voiceTriggerTargetSelect.addEventListener('change', () => {
      setVoiceTriggerTargetIdentity(voiceTriggerTargetSelect.value);
      if (voiceTriggerEnabled) {
        startVoiceTriggerMonitoring();
      }
    });
  }

  if (voiceTriggerThresholdSlider) {
    voiceTriggerThresholdSlider.addEventListener('input', () => {
      setVoiceTriggerThresholdDb(voiceTriggerThresholdSlider.value, { persist: false });
    });
    voiceTriggerThresholdSlider.addEventListener('change', () => {
      setVoiceTriggerThresholdDb(voiceTriggerThresholdSlider.value);
    });
  }

  if (audioProcessingToggle) {
    audioProcessingToggle.checked = syncAudioProcessingOptions();
    audioProcessingToggle.addEventListener('change', () => {
      setAudioProcessingEnabled(audioProcessingToggle.checked);
    });
  }

  if (connectionSoundsToggle) {
    connectionSoundsToggle.checked = playConnectionSoundsEnabled;
    connectionSoundsToggle.addEventListener('change', () => {
      setPlayConnectionSounds(connectionSoundsToggle.checked);
    });
  }

  function setLeftHandMode(value, { persist = true } = {}) {
    leftHandModeEnabled = Boolean(value);
    document.body?.classList.toggle('left-hand-mode', leftHandModeEnabled);
    if (leftHandModeToggle && leftHandModeToggle.checked !== leftHandModeEnabled) {
      leftHandModeToggle.checked = leftHandModeEnabled;
    }
    const hintText = getSlideToLockHintText();
    if (sessionSlideHintEl) sessionSlideHintEl.textContent = hintText;
    document.querySelectorAll('.slide-to-lock-hint').forEach((hint) => {
      hint.textContent = hintText;
    });
    if (persist && typeof window !== 'undefined') {
      try {
        window.localStorage?.setItem(LEFT_HAND_MODE_STORAGE_KEY, String(leftHandModeEnabled));
      } catch (error) {
        console.warn('Unable to persist left-hand mode:', error);
      }
      persistUserAudioSettingsHandler();
    }
  }

  setLeftHandMode(leftHandModeEnabled, { persist: false });
  leftHandModeToggle?.addEventListener('change', () => {
    setLeftHandMode(leftHandModeToggle.checked);
  });

  function setLockMultipleTargets(value, { persist = true } = {}) {
    const wasEnabled = lockMultipleTargetsEnabled;
    lockMultipleTargetsEnabled = Boolean(value);
    if (lockMultipleTargetsToggle && lockMultipleTargetsToggle.checked !== lockMultipleTargetsEnabled) {
      lockMultipleTargetsToggle.checked = lockMultipleTargetsEnabled;
    }
    if (persist && typeof window !== 'undefined') {
      try {
        window.localStorage?.setItem(LOCK_MULTIPLE_TARGETS_STORAGE_KEY, String(lockMultipleTargetsEnabled));
      } catch (error) {
        console.warn('Unable to persist multiple-target lock mode:', error);
      }
      persistUserAudioSettingsHandler();
    }
    if (wasEnabled && !lockMultipleTargetsEnabled && activeTalkLocks.size > 1) {
      const [lockToKeep, ...locksToRemove] = getActiveTalkLockEntries();
      locksToRemove.forEach((entry) => {
        setTalkButtonLocked(entry.button, false);
        activeTalkLocks.delete(getTalkTargetIdentity(entry.target));
      });
      setCurrentTalkTargets(collectActiveTalkTargetsFromPointers());
      emitTalkTargetsUpdated('talk-targets-updated', currentTargets);
      emitPttState('multiple-target-lock-disabled', {
        talking: currentTargets.length > 0,
        lockActive: Boolean(lockToKeep),
        target: lockToKeep?.target || currentTargets[0] || null,
        targets: currentTargets,
      });
    }
  }

  setLockMultipleTargets(lockMultipleTargetsEnabled, { persist: false });
  lockMultipleTargetsToggle?.addEventListener('change', () => {
    setLockMultipleTargets(lockMultipleTargetsToggle.checked);
  });

  const storedQuality = localStorage.getItem('audioQualityProfile');
  const defaultQuality = QUALITY_PROFILES[serverDefaultClientSettings.audioProfile]
    ? serverDefaultClientSettings.audioProfile
    : 'ultra-low';
  if (qualitySelect) {
    if (storedQuality && QUALITY_PROFILES[storedQuality]) {
      qualitySelect.value = storedQuality;
    } else {
      qualitySelect.value = defaultQuality;
    }

    qualitySelect.addEventListener('change', () => {
      const selected = qualitySelect.value;
      if (!QUALITY_PROFILES[selected]) {
        qualitySelect.value = 'ultra-low';
      }
      localStorage.setItem('audioQualityProfile', qualitySelect.value);
      persistUserAudioSettingsHandler();
      cleanupMicTrack();
      if (voiceTriggerEnabled) {
        startVoiceTriggerMonitoring();
      }
    });
  }

  function setFeedDuckingDb(dbValue, { persist = true, apply = true } = {}) {
    if (Number.isNaN(dbValue) || !Number.isFinite(dbValue)) return;
    const clamped = clampFeedDuckingDb(dbValue);
    feedDuckingDb = clamped;
    feedDuckingFactor = dbToLinear(clamped);

    syncDimAmountSelect(clamped);

    if (persist && typeof window !== 'undefined') {
      try {
        window.localStorage?.setItem(FEED_DUCKING_DB_STORAGE_KEY, String(clamped));
      } catch (err) {
        console.warn('Unable to persist feed dim level:', err);
      }
      persistUserAudioSettingsHandler();
    }

    if (apply) {
      applyFeedDucking();
    }
  }

  if (dimAmountSelect) {
    syncDimAmountSelect(feedDuckingDb);
    dimAmountSelect.addEventListener('change', () => {
      const selectedDb = parseFloat(dimAmountSelect.value);
      if (Number.isNaN(selectedDb)) return;
      setFeedDuckingDb(selectedDb);
    });
  }

  function setFeedDimSelf(value, { persist = true, apply = true } = {}) {
    const enabled = supportsFeedDimming() && !!value;
    feedDimSelf = enabled;
    if (dimWhileSpeakingToggle && dimWhileSpeakingToggle.checked !== enabled) {
      dimWhileSpeakingToggle.checked = enabled;
    }
    if (persist && typeof window !== 'undefined') {
      try {
        window.localStorage?.setItem(FEED_DIM_SELF_STORAGE_KEY, String(enabled));
      } catch (err) {
        console.warn('Unable to persist self dim preference:', err);
      }
      persistUserAudioSettingsHandler();
    }
    if (apply) {
      applyFeedDucking();
    }
  }

  if (dimWhileSpeakingToggle) {
    dimWhileSpeakingToggle.checked = feedDimSelf;
    dimWhileSpeakingToggle.addEventListener('change', () => {
      setFeedDimSelf(dimWhileSpeakingToggle.checked);
    });
  }

  function setFeedDimIncoming(value, { persist = true, apply = true } = {}) {
    const enabled = supportsFeedDimming() && !!value;
    feedDimIncoming = enabled;
    if (dimWhenAddressedToggle && dimWhenAddressedToggle.checked !== enabled) {
      dimWhenAddressedToggle.checked = enabled;
    }
    if (persist && typeof window !== 'undefined') {
      try {
        window.localStorage?.setItem(FEED_DIM_INCOMING_STORAGE_KEY, String(enabled));
      } catch (err) {
        console.warn('Unable to persist incoming dim preference:', err);
      }
      persistUserAudioSettingsHandler();
    }
    if (apply) {
      applyFeedDucking();
    }
  }

  if (dimWhenAddressedToggle) {
    dimWhenAddressedToggle.checked = feedDimIncoming;
    dimWhenAddressedToggle.addEventListener('change', () => {
      setFeedDimIncoming(dimWhenAddressedToggle.checked);
    });
  }

  updateDeviceList().catch(err => console.error("updateDeviceList failed:", err));
  navigator.mediaDevices.addEventListener("devicechange", () =>
      updateDeviceList().catch(err => console.error(err))
  );

  const handleInputDeviceSelectionChange = (selected) => {
    setPreferredInputDeviceId(selected, { persist: true, explicit: Boolean(selected) });
    if (session.kind === 'feed') {
      const wasStreaming = feedStreaming;
      if (feedStreaming) {
        stopFeedStream();
      } else {
        cleanupMicTrack();
      }
      if (wasStreaming) {
        startFeedStream().catch(err => console.error('Failed to restart feed after device change', err));
      }
    } else {
      cleanupMicTrack();
      if (voiceTriggerEnabled) {
        startVoiceTriggerMonitoring();
      }
    }
  };

  inputSelect?.addEventListener('change', () => {
    handleInputDeviceSelectionChange(inputSelect.value);
  });

  feedInputSelect?.addEventListener('change', () => {
    handleInputDeviceSelectionChange(feedInputSelect.value);
  });


  // Check if mediasoup-client was loaded
  if (typeof mediasoupClient === "undefined") {
    console.error("mediasoup-client not loaded!");
    alert("Failed to load the mediasoup client library!");
    return;
  }
  console.log("mediasoup-client version:", mediasoupClient.version);

  // DOM elements
  const loginForm = document.getElementById("login-form");
  const loginContainer = document.getElementById("login-container");
  const loginUsernameInput = document.getElementById("login-username");
  const guestLoginPanel = document.getElementById("guest-login-panel");
  const guestLoginButton = document.getElementById("guest-login-button");
  const guestDisplayNameInput = document.getElementById("guest-display-name");
  const settingsServerVersion = document.getElementById('settings-server-version');
  const productionLoginPanel = document.getElementById('production-login-panel');
  const productionLoginOptions = document.getElementById('production-login-options');
  const bridgeLoginPanel = document.getElementById('bridge-login-panel');
  const bridgeLoginCancel = document.getElementById('bridge-login-cancel');
  const bridgeLoginContinue = document.getElementById('bridge-login-continue');
  const adminLoginLink = document.getElementById('admin-login-link');
  const intercomApp = document.getElementById("intercom-app");
  const loginError = document.getElementById("login-error");
  const logoutBtn = document.getElementById("logout-btn");
  const feedLogoutBtn = document.getElementById("feed-logout-btn");
  const conferenceMembersModal = document.getElementById('conference-members-modal');
  const conferenceMembersModalDescription = document.getElementById('conference-members-modal-description');
  const conferenceMembersModalList = document.getElementById('conference-members-modal-list');
  const conferenceMembersModalDone = document.getElementById('conference-members-modal-done');
  const targetLayerSwitcher = document.getElementById('target-layer-switcher');
  const targetLayerButton = document.getElementById('target-layer-button');

  const myIdEl = document.getElementById("my-id");
  const sessionInfoPrefixEl = document.getElementById('session-info-prefix');
  const activeProductionLabelEl = document.getElementById('active-production-label');
  const productionSessionSelector = document.getElementById('production-session-selector');
  const productionSessionSelect = document.getElementById('production-session-select');
  const mediaConnectionStatusEl = document.getElementById('media-connection-status');
  const mediaConnectionStatusLabelEl = document.getElementById('media-connection-status-label');
  const mediaConnectionState = {
    heartbeatInterrupted: false,
    signaling: socket.connected ? 'connected' : 'connecting',
    send: 'idle',
    receive: 'idle',
    sendIce: 'idle',
    receiveIce: 'idle',
    iceError: null,
  };

  function describeIceCandidateError(event) {
    if (!event) return null;
    const parts = [];
    if (event.errorCode) parts.push(`ICE ${event.errorCode}`);
    if (event.errorText) parts.push(String(event.errorText));
    if (event.url) parts.push(String(event.url));
    return parts.length ? parts.join(' · ') : 'ICE candidate negotiation failed';
  }

  function renderMediaConnectionStatus() {
    if (!mediaConnectionStatusEl || !mediaConnectionStatusLabelEl) return;

    const states = [mediaConnectionState.send, mediaConnectionState.receive];
    const iceStates = [mediaConnectionState.sendIce, mediaConnectionState.receiveIce];
    let label = 'Media idle';
    let className = '';

    if (mediaConnectionState.signaling === 'failed') {
      label = 'Server unavailable';
      className = 'is-failed';
    } else if (mediaConnectionState.signaling !== 'connected') {
      label = 'Server connecting';
      className = 'is-connecting';
    } else if (states.includes('failed')) {
      label = 'Media failed';
      className = 'is-failed';
    } else if (mediaConnectionState.heartbeatInterrupted) {
      label = 'Server not responding';
      className = 'is-warning';
    } else if (states.includes('disconnected')) {
      label = 'Media interrupted';
      className = 'is-warning';
    } else if (states.includes('connecting')) {
      label = 'Media connecting';
      className = 'is-connecting';
    } else if (iceStates.includes('gathering')) {
      label = 'ICE gathering';
      className = 'is-connecting';
    } else if (states.includes('connected')) {
      label = 'Media connected';
      className = 'is-connected';
    } else if (mediaConnectionState.iceError) {
      label = 'ICE warning';
      className = 'is-warning';
    } else if (mediaInitialized) {
      label = 'Media ready';
      className = 'is-connected';
    }

    mediaConnectionStatusEl.className = `media-connection-status${className ? ` ${className}` : ''}`;
    mediaConnectionStatusLabelEl.textContent = label;
    mediaConnectionStatusEl.title = [
      `Signaling: ${mediaConnectionState.signaling}`,
      `Server heartbeat: ${mediaConnectionState.heartbeatInterrupted ? 'missing' : 'no interruption detected'}`,
      `Send media: ${mediaConnectionState.send}`,
      `Receive media: ${mediaConnectionState.receive}`,
      `Send ICE: ${mediaConnectionState.sendIce}`,
      `Receive ICE: ${mediaConnectionState.receiveIce}`,
      mediaConnectionState.iceError ? `Last ICE error: ${mediaConnectionState.iceError}` : null,
    ].filter(Boolean).join('\n');
  }

  function setSignalingConnectionState(state) {
    mediaConnectionState.signaling = state;
    if (state === 'connected') mediaConnectionState.iceError = null;
    renderMediaConnectionStatus();
  }

  function reportMediaTransportEvent(direction, event, state, detail = null) {
    if (!socket.connected) return;
    socket.emit('media-transport-event', {
      direction,
      event,
      state: state || 'unknown',
      detail: detail ? String(detail).slice(0, 500) : null,
      clientTime: new Date().toISOString(),
    });
  }

  function announceConnectionRecovery() {
    if (!sessionResetInProgress && session.name && socket.connected
        && !mediaConnectionState.heartbeatInterrupted
        // Unused transports stay 'new' until the first producer/consumer.
        // Only current transport states matter after transports are replaced.
        && ![mediaConnectionState.send, mediaConnectionState.receive]
          .some((state) => ['disconnected', 'failed', 'connecting'].includes(state))) {
      connectionSounds.reconnected();
    }
  }

  function bindMediaTransportStatus(transport, direction) {
    if (!transport || !['send', 'receive'].includes(direction)) return;
    mediaConnectionState[direction] = transport.connectionState || 'new';
    mediaConnectionState[`${direction}Ice`] = transport.iceGatheringState || 'new';
    renderMediaConnectionStatus();

    transport.on('connectionstatechange', (state) => {
      if (direction === 'send' && transport !== sendTransport) return;
      if (direction === 'receive' && transport !== recvTransport) return;
      mediaConnectionState[direction] = state || transport.connectionState || 'unknown';
      if (!sessionResetInProgress && session.name) {
        if (['disconnected', 'failed'].includes(mediaConnectionState[direction])) {
          connectionSounds.disconnected();
        } else if (state === 'connected') {
          announceConnectionRecovery();
        }
      }
      if (state === 'connected') mediaConnectionState.iceError = null;
      renderMediaConnectionStatus();
      reportMediaTransportEvent(direction, 'connection-state', mediaConnectionState[direction]);
    });

    transport.on('icegatheringstatechange', (state) => {
      if (direction === 'send' && transport !== sendTransport) return;
      if (direction === 'receive' && transport !== recvTransport) return;
      mediaConnectionState[`${direction}Ice`] = state || transport.iceGatheringState || 'unknown';
      renderMediaConnectionStatus();
      reportMediaTransportEvent(direction, 'ice-gathering-state', mediaConnectionState[`${direction}Ice`]);
    });

    transport.on('icecandidateerror', (event) => {
      if (direction === 'send' && transport !== sendTransport) return;
      if (direction === 'receive' && transport !== recvTransport) return;
      mediaConnectionState.iceError = describeIceCandidateError(event);
      renderMediaConnectionStatus();
      reportMediaTransportEvent(direction, 'ice-candidate-error', 'warning', mediaConnectionState.iceError);
    });
  }

  function resetMediaConnectionState() {
    mediaConnectionState.send = 'idle';
    mediaConnectionState.receive = 'idle';
    mediaConnectionState.sendIce = 'idle';
    mediaConnectionState.receiveIce = 'idle';
    mediaConnectionState.iceError = null;
    renderMediaConnectionStatus();
  }

  renderMediaConnectionStatus();

  function setSessionDisplay(text, { connectionStatus = false } = {}) {
    if (sessionInfoPrefixEl) sessionInfoPrefixEl.hidden = connectionStatus;
    myIdEl.textContent = text;
  }
  const btnReply = document.getElementById("reply");
  if (btnReply) {
    btnReply.setAttribute("aria-pressed", "false");
  }
  targetLayerButton?.addEventListener('click', () => {
    advanceTargetLayer();
  });
  const audioStreamsDiv = document.getElementById("audio-streams");
  const feedBanner = document.getElementById("feed-banner");
  const feedStreamToggle = document.getElementById("feed-stream-toggle");
  const feedStreamStatus = document.getElementById("feed-stream-status");
  const peerConsumers = new Map();
  const targetLabels = new Map();
  const conferenceLabels = new Map();

  const audioElements = new Map();
  const audioEntryMap = new WeakMap();
  const confAudioElements = new Map();
  const feedAudioElements = new Map();
  const targetStreamMap = new Map();
  const stoppedFeedKeys = new Set();
  const listenOnlyConferenceKeys = new Set();
  const activeFeedKeys = new Set();
  collectMediaConsumerNetworkStats = async () => {
    const consumerEntries = [];
    for (const [streamKey, consumers] of peerConsumers.entries()) {
      for (const consumer of consumers || []) {
        if (
          consumerEntries.length >= 50
          || !consumer
          || consumer.closed
          || typeof consumer.getStats !== 'function'
        ) {
          continue;
        }
        const entry = audioElements.get(streamKey);
        consumerEntries.push({
          consumer,
          streamKey,
          targetKey: entry?.key || null,
          type: entry?.type || consumer?.appData?.type || null,
        });
      }
    }

    const reports = await Promise.allSettled(consumerEntries.map(async (item) => {
      const report = await item.consumer.getStats();
      const summary = createMediaNetworkStatsSummary();
      collectMediaNetworkStatsFromReport(report, summary);
      return {
        consumerId: item.consumer.id || null,
        producerId: item.consumer.producerId || null,
        streamKey: item.streamKey,
        targetKey: item.targetKey,
        type: item.type,
        ...summarizeMediaNetworkStats(summary),
      };
    }));
    return reports
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
  };
  let guestLoginEnabled = false;
  let ssoLoginEnabled = false;
  const isMobileLoginViewport = () => (
    window.matchMedia?.('(pointer: coarse)').matches
    || window.matchMedia?.('(max-width: 700px)').matches
  );
  const focusLoginNameField = () => {
    if (!loginUsernameInput || session.name) return;
    if (guestLoginRequested && guestLoginEnabled && guestDisplayNameInput) {
      window.requestAnimationFrame(() => guestDisplayNameInput.focus());
      return;
    }
    if (guestLoginEnabled && isMobileLoginViewport()) return;
    window.requestAnimationFrame(() => {
      try {
        loginUsernameInput.focus();
        loginUsernameInput.select?.();
      } catch {}
    });
  };

  function setLoginError(message = '') {
    if (!loginError) return;
    loginError.textContent = message || '';
  }

  function clearStoredPersistentIdentity() {
    localStorage.removeItem("userId");
    localStorage.removeItem(FEED_ID_STORAGE_KEY);
    localStorage.removeItem("userName");
    localStorage.removeItem(IDENTITY_KIND_KEY);
  }

  function loadStoredGuestSession() {
    try {
      const raw = sessionStorage.getItem(GUEST_SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const guestId = String(parsed?.guestId || '').trim();
      const guestProfileUserId = String(parsed?.guestProfileUserId || '').trim();
      const name = String(parsed?.name || '').trim();
      if (!guestId || !guestProfileUserId || !name) return null;
      return {
        kind: 'guest',
        userId: null,
        feedId: null,
        guestId,
        guestProfileUserId,
        productionId: parsed?.productionId ? String(parsed.productionId) : null,
        productionName: parsed?.productionName || null,
        productions: Array.isArray(parsed?.productions) ? parsed.productions : [],
        name,
      };
    } catch (err) {
      console.warn('Failed to restore Guest session:', err);
      return null;
    }
  }

  function persistGuestSession(nextSession) {
    if (!nextSession || nextSession.kind !== 'guest') return;
    try {
      sessionStorage.setItem(GUEST_SESSION_STORAGE_KEY, JSON.stringify({
        guestId: nextSession.guestId,
        guestProfileUserId: nextSession.guestProfileUserId,
        productionId: nextSession.productionId,
        productionName: nextSession.productionName,
        productions: nextSession.productions,
        name: nextSession.name,
      }));
    } catch (err) {
      console.warn('Failed to store Guest session:', err);
    }
  }

  function clearStoredGuestSession() {
    try {
      sessionStorage.removeItem(GUEST_SESSION_STORAGE_KEY);
    } catch {}
  }

  async function loadLoginOptions() {
    try {
      const res = await fetch('/login/options');
      if (!res.ok) throw new Error(`Login options failed: ${res.status}`);
      const payload = await res.json();
      const appVersion = String(payload?.appVersion || '').trim();
      if (settingsServerVersion && appVersion) {
        const displayVersion = appVersion === 'unknown'
          ? 'unknown'
          : `v${appVersion.replace(/^v/i, '')}`;
        settingsServerVersion.textContent = `Server ${displayVersion}`;
        settingsServerVersion.hidden = false;
      }
      const guestLogin = payload?.guestLogin || {};
      const enabled = guestLogin.enabled === true;
      guestLoginEnabled = enabled;
      ssoLoginEnabled = payload?.sso?.enabled === true;
      guestLoginPanel?.classList.toggle('is-hidden', !enabled);
      if (guestLoginButton) {
        guestLoginButton.disabled = !enabled;
        guestLoginButton.textContent = `Login as ${guestLogin.label || 'Guest'}`;
      }
      return { guestLoginEnabled: enabled, ssoLoginEnabled };
    } catch (err) {
      console.warn('Failed to load login options:', err);
      guestLoginEnabled = false;
      ssoLoginEnabled = false;
      guestLoginPanel?.classList.add('is-hidden');
      if (guestLoginButton) guestLoginButton.disabled = true;
      return { guestLoginEnabled: false, ssoLoginEnabled: false };
    }
  }
  recoverExistingIncomingPlayback = ({ forceRetryAll = false } = {}) => {
    const remoteBusAudio = remotePlaybackBus?.audio || null;
    if (remoteBusAudio && typeof remoteBusAudio.play === 'function') {
      const track = remoteBusAudio.srcObject?.getAudioTracks?.()?.[0] || null;
      const hasLiveTrack = !track || track.readyState === 'live';
      if (hasLiveTrack) {
        const shouldRetry = forceRetryAll || remoteBusAudio.paused || pendingAutoplayAudios.has(remoteBusAudio);
        if (shouldRetry) {
          attemptPlayAudio(remoteBusAudio, {
            reason: forceRetryAll ? 'recover-force-retry-playback-bus' : 'recover-retry-playback-bus',
            streamKey: 'bus::remote',
            targetKey: 'remote-bus',
            type: 'remote-bus',
            persistentBus: true,
          }).catch(() => {});
        }
      }
    }

    audioElements.forEach((entry, streamKey) => {
      if (entry?.usesSharedAudioElement) return;
      const audioEl = entry?.audio;
      if (!audioEl || typeof audioEl.play !== 'function') return;

      const track = audioEl.srcObject?.getAudioTracks?.()?.[0] || null;
      const hasLiveTrack = !track || track.readyState === 'live';
      if (!hasLiveTrack) return;

      const shouldRetry = forceRetryAll || audioEl.paused || pendingAutoplayAudios.has(audioEl);
      if (!shouldRetry) return;

      attemptPlayAudio(audioEl, {
        reason: forceRetryAll ? 'recover-force-retry' : 'recover-retry',
        streamKey,
        targetKey: entry?.key || null,
        type: entry?.type || null,
      }).catch(() => {});
    });
  };
  if (typeof window !== 'undefined') {
    window.talktomeDumpAudioState = () => {
      const sharedCtx = sharedAudioContext && sharedAudioContext.state !== 'closed'
        ? sharedAudioContext
        : null;
      const entries = Array.from(audioElements.entries()).map(([streamKey, entry]) => {
        const track = entry?.audio?.srcObject?.getAudioTracks?.()?.[0] || null;
        return {
          streamKey,
          targetKey: entry?.key || null,
          type: entry?.type || null,
          sourceUserId: entry?.sourceUserId ?? null,
          memberListenExcluded: Boolean(entry?.memberListenExcluded),
          memberListenLevel: entry?.memberListenLevel ?? 1,
          paused: entry?.audio?.paused ?? null,
          muted: entry?.audio?.muted ?? null,
          volume: entry?.audio?.volume ?? null,
          gainNode: !!entry?.gainNode,
          feedDuckingNode: !!entry?.feedDuckingNode,
          trackMuted: track?.muted ?? null,
          trackReadyState: track?.readyState ?? null,
        };
      });
      const snapshot = {
        userAgent: USER_AGENT,
        isAndroidBrowser,
        isMobileBrowser,
        isiOS,
        visibilityState: document.visibilityState,
        documentHidden: document.hidden,
        documentHasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
        audioSession: {
          supported: !!navigator.audioSession,
          type: navigator.audioSession?.type || null,
          state: navigator.audioSession?.state || null,
        },
        sharedAudioContextState: sharedCtx?.state || null,
        pendingAutoplayCount: pendingAutoplayAudios.size,
        remotePlaybackBus: getAudioElementSnapshot(remotePlaybackBus?.audio || null),
        micTrack: getAudioTrackSnapshot(micTrack),
        playbackBuses: Array.from(targetPlaybackBuses.entries()).map(([targetKey, bus]) => ({
          targetKey,
          type: bus?.type || null,
          levelGain: bus?.levelNode?.gain?.value ?? null,
        })),
        entries,
      };
      console.info('[audio][dump]', snapshot);
      return snapshot;
    };
    window.talktomeWarmReceiveAudioSession = async (reason = 'manual-debug') => {
      const track = await warmReceiveAudioSession(reason);
      const snapshot = window.talktomeDumpAudioState?.() || null;
      logReceiveDiagnostic('manual-warm-receive-audio-session', {
        reason,
        micTrack: getAudioTrackSnapshot(track),
      });
      return snapshot;
    };
    window.talktomeSetAudioSessionType = (type = 'play-and-record') => {
      if (!navigator.audioSession) {
        throw new Error('navigator.audioSession is not available');
      }
      navigator.audioSession.type = type;
      const snapshot = window.talktomeDumpAudioState?.() || null;
      logReceiveDiagnostic('manual-set-audio-session-type', {
        type,
      });
      return snapshot;
    };
  }
  // Server-authoritative set of user/conference targets that are currently addressing us.
  const speakingPeers = new Set();
  const mutedPeers = new Set();
  const pendingProducerQueue = [];
let currentTargetPeer = null;
let lastTarget = null;
let currentTarget = null;
let currentTargets = [];
const activeTalkPointers = new Map();
let selfTalkingKey = null;
let cachedUsers = [];
let latestServerUsers = [];
let cachedOperatorTargets = null;
  const arrangeTargetsList = document.getElementById('arrange-targets-list');
  const arrangeTargetsEmpty = document.getElementById('arrange-targets-empty');
  const arrangeTargetsMessage = document.getElementById('arrange-targets-message');
  let arrangeTargetsDraft = [];
  let arrangeTargetsSaved = [];
  let arrangeTargetsLoadGeneration = 0;
  let arrangeTargetsSaving = false;
  let arrangeTargetsForUserId = null;
  let arrangeTargetsForProductionId = null;
  let arrangeTargetsDrag = null;

  function setArrangeTargetsMessage(message = '', isError = false) {
    if (!arrangeTargetsMessage) return;
    arrangeTargetsMessage.textContent = message;
    arrangeTargetsMessage.hidden = !message;
    arrangeTargetsMessage.classList.toggle('is-error', isError);
  }

  function renderArrangeTargets() {
    if (!arrangeTargetsList || !arrangeTargetsEmpty) return;
    arrangeTargetsList.replaceChildren();
    arrangeTargetsEmpty.hidden = arrangeTargetsDraft.length > 0;

    arrangeTargetsDraft.forEach((target, index) => {
      const name = String(target.name || `${target.targetType} ${target.targetId}`);
      const kind = target.targetType === 'conference'
        ? target.canTalk === false ? 'Conference · Listen only' : 'Conference'
        : target.targetType === 'feed' ? 'Feed' : 'User';
      const row = document.createElement('div');
      row.className = 'arrange-targets__row';
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'arrange-targets__handle';
      handle.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>';
      handle.setAttribute('aria-label', `Reorder ${name}. Drag or use the up and down arrow keys.`);
      handle.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        event.stopPropagation();
        if (arrangeTargetsSaving) return;
        const nextIndex = index + (event.key === 'ArrowUp' ? -1 : 1);
        moveArrangeTarget(index, nextIndex, true);
      });
      const identity = document.createElement('div');
      identity.className = 'shortcut-settings__target';
      const label = document.createElement('span');
      label.className = 'arrange-targets__name';
      label.textContent = name;
      const type = document.createElement('span');
      type.className = 'arrange-targets__kind';
      type.textContent = kind;
      identity.append(label, type);
      row.append(handle, identity);
      arrangeTargetsList.appendChild(row);
    });
  }

  function clearArrangeTargetsDrag() {
    if (!arrangeTargetsDrag) return;
    const { pointerId } = arrangeTargetsDrag;
    arrangeTargetsDrag = null;
    arrangeTargetsList.querySelectorAll('.arrange-targets__row').forEach((row) => {
      row.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after');
      row.style.transform = '';
    });
    try {
      if (arrangeTargetsList.hasPointerCapture?.(pointerId)) {
        arrangeTargetsList.releasePointerCapture(pointerId);
      }
    } catch {}
  }

  cancelArrangeTargetsDragHandler = clearArrangeTargetsDrag;

  function updateArrangeTargetsDropPosition(clientY) {
    const drag = arrangeTargetsDrag;
    if (!drag) return;
    const rows = [...arrangeTargetsList.querySelectorAll('.arrange-targets__row')];
    const otherRows = rows.filter((row) => row !== drag.row);
    const beforeIndex = otherRows.findIndex((row) => {
      const box = row.getBoundingClientRect();
      return clientY < box.top + box.height / 2;
    });
    drag.destinationIndex = beforeIndex < 0 ? otherRows.length : beforeIndex;
    rows.forEach((row) => row.classList.remove('is-drop-before', 'is-drop-after'));
    if (drag.destinationIndex === drag.sourceIndex) return;
    const nextRow = otherRows[drag.destinationIndex];
    if (nextRow) nextRow.classList.add('is-drop-before');
    else otherRows.at(-1)?.classList.add('is-drop-after');
  }

  function moveArrangeTarget(sourceIndex, destinationIndex, restoreFocus = false) {
    if (arrangeTargetsSaving || destinationIndex < 0 || destinationIndex >= arrangeTargetsDraft.length
      || sourceIndex === destinationIndex) return;
    const [target] = arrangeTargetsDraft.splice(sourceIndex, 1);
    arrangeTargetsDraft.splice(destinationIndex, 0, target);
    renderArrangeTargets();
    if (restoreFocus) {
      arrangeTargetsList.children[destinationIndex]?.querySelector('.arrange-targets__handle')?.focus({ preventScroll: true });
    }
    persistArrangeTargets();
  }

  arrangeTargetsList?.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('.arrange-targets__handle');
    if (!handle || !event.isPrimary || event.button !== 0 || arrangeTargetsSaving || arrangeTargetsDrag) return;
    const row = handle.closest('.arrange-targets__row');
    const sourceIndex = [...arrangeTargetsList.children].indexOf(row);
    if (sourceIndex < 0 || arrangeTargetsDraft.length < 2) return;
    event.preventDefault();
    arrangeTargetsDrag = {
      pointerId: event.pointerId,
      row,
      sourceIndex,
      destinationIndex: sourceIndex,
      startY: event.clientY,
      moved: false,
    };
    try {
      arrangeTargetsList.setPointerCapture(event.pointerId);
    } catch {}
  });

  arrangeTargetsList?.addEventListener('pointermove', (event) => {
    const drag = arrangeTargetsDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    if (!drag.moved && Math.abs(event.clientY - drag.startY) < 4) return;
    drag.moved = true;
    drag.row.classList.add('is-dragging');
    drag.row.style.transform = `translateY(${event.clientY - drag.startY}px)`;
    updateArrangeTargetsDropPosition(event.clientY);
  });

  arrangeTargetsList?.addEventListener('pointerup', (event) => {
    const drag = arrangeTargetsDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.moved) updateArrangeTargetsDropPosition(event.clientY);
    const { sourceIndex, destinationIndex, moved } = drag;
    clearArrangeTargetsDrag();
    if (moved) moveArrangeTarget(sourceIndex, destinationIndex);
  });

  arrangeTargetsList?.addEventListener('pointercancel', (event) => {
    if (event.pointerId === arrangeTargetsDrag?.pointerId) clearArrangeTargetsDrag();
  });

  async function loadArrangeTargets() {
    if (session.kind !== 'user' || !session.userId) return;
    clearArrangeTargetsDrag();
    const generation = ++arrangeTargetsLoadGeneration;
    const userId = session.userId;
    const productionId = session.productionId;
    arrangeTargetsDraft = [];
    arrangeTargetsSaved = [];
    arrangeTargetsForUserId = null;
    arrangeTargetsForProductionId = null;
    renderArrangeTargets();
    setArrangeTargetsMessage('Loading…');
    try {
      const productionQuery = productionId ? `?productionId=${encodeURIComponent(productionId)}` : '';
      const targets = await fetchJSON(`/users/${encodeURIComponent(userId)}/targets${productionQuery}`);
      if (generation !== arrangeTargetsLoadGeneration || activeSettingsView !== 'arrange'
        || session.userId !== userId || session.productionId !== productionId) return false;
      arrangeTargetsDraft = Array.isArray(targets) ? targets.map((target) => ({ ...target })) : [];
      arrangeTargetsSaved = arrangeTargetsDraft.map((target) => ({ ...target }));
      arrangeTargetsForUserId = userId;
      arrangeTargetsForProductionId = productionId;
      renderArrangeTargets();
      setArrangeTargetsMessage();
      return true;
    } catch (error) {
      if (generation !== arrangeTargetsLoadGeneration) return false;
      setArrangeTargetsMessage(`Could not load targets: ${error.message}`, true);
      return false;
    }
  }

  loadArrangeTargetsHandler = loadArrangeTargets;
  async function persistArrangeTargets() {
    if (arrangeTargetsSaving || session.kind !== 'user' || !session.userId) return;
    const userId = arrangeTargetsForUserId;
    const productionId = arrangeTargetsForProductionId;
    if (session.userId !== userId || session.productionId !== productionId) {
      loadArrangeTargets();
      return;
    }
    const generation = arrangeTargetsLoadGeneration;
    const submitted = arrangeTargetsDraft.map((target) => ({ ...target }));
    arrangeTargetsSaving = true;
    setArrangeTargetsMessage('Saving…');
    let refreshOnFinish = false;
    try {
      const response = await fetch('/api/v1/client/targets/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productionId,
          items: submitted.map(({ targetType, targetId }) => ({ targetType, targetId })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (generation !== arrangeTargetsLoadGeneration || session.userId !== userId
        || session.productionId !== productionId) {
        refreshOnFinish = activeSettingsView === 'arrange';
        return;
      }
      if (response.status === 409) {
        if (await loadArrangeTargets()) {
          setArrangeTargetsMessage('Targets changed. The latest list has been loaded.', true);
        }
        return;
      }
      if (!response.ok) throw new Error(payload.error || 'Could not save target order');
      arrangeTargetsSaved = submitted;
      setArrangeTargetsMessage('Saved');
    } catch (error) {
      if (generation !== arrangeTargetsLoadGeneration) return;
      arrangeTargetsDraft = arrangeTargetsSaved.map((target) => ({ ...target }));
      renderArrangeTargets();
      setArrangeTargetsMessage(error.message || 'Could not save target order', true);
    } finally {
      arrangeTargetsSaving = false;
      if (refreshOnFinish) loadArrangeTargets();
    }
  }
  const conferenceMemberListenExclusions = new Map();
  const conferenceMemberListenLevels = new Map();
  let loadedConferenceListenExclusionsKey = null;
  let loadedConferenceMemberLevelsKey = null;
  let conferenceMembersModalRestoreFocus = null;
  let incomingTalkState = { addressedNow: [], replyTarget: null };
  let initializingMediaPromise = null;
  let mediaStateGeneration = 0;
  let shouldInitializeAfterConnect = false;
  const activeTalkLocks = new Map();
  let suspendedLockState = null;
  let suspendedLockRestoreTimer = null;
  let pendingPttSizingRaf = null;
  let pttSizingListenerBound = false;
  let currentTargetLayerIndex = 0;
  let streamPruneInterval = null;
  let activeProducerSyncInterval = null;
  let activeProducersSyncInFlight = false;
  let pendingIncomingConsumeKeys = new Set();
  const EARLY_CLOSED_CONSUMER_TTL_MS = 10000;
  const earlyClosedConsumerIds = new Map();
  const earlyClosedStreamKeys = new Map();
  let slideHintShown = false;
  let slideHintTimeoutId = null;

  function getConferenceListenExclusionsStorageKey() {
    const profileUserId = getOperatorProfileUserId();
    if (!profileUserId) return null;
    const identityKind = session.kind === 'guest' ? 'guest' : 'user';
    return `${CONFERENCE_LISTEN_EXCLUSIONS_STORAGE_PREFIX}:${identityKind}:${profileUserId}`;
  }

  function getConferenceMemberLevelsStorageKey() {
    const profileUserId = getOperatorProfileUserId();
    if (!profileUserId) return null;
    const identityKind = session.kind === 'guest' ? 'guest' : 'user';
    return `${CONFERENCE_MEMBER_LEVELS_STORAGE_PREFIX}:${identityKind}:${profileUserId}`;
  }

  function ensureConferenceListenExclusionsLoaded() {
    const storageKey = getConferenceListenExclusionsStorageKey();
    if (storageKey === loadedConferenceListenExclusionsKey) return;

    conferenceMemberListenExclusions.clear();
    loadedConferenceListenExclusionsKey = storageKey;
    if (!storageKey) return;

    try {
      const parsed = JSON.parse(window.localStorage?.getItem(storageKey) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      Object.entries(parsed).forEach(([conferenceId, userIds]) => {
        const numericConferenceId = Number(conferenceId);
        if (!Number.isFinite(numericConferenceId) || !Array.isArray(userIds)) return;
        const normalizedUserIds = new Set(
          userIds
            .map((userId) => Number(userId))
            .filter((userId) => Number.isFinite(userId))
        );
        if (normalizedUserIds.size) {
          conferenceMemberListenExclusions.set(numericConferenceId, normalizedUserIds);
        }
      });
    } catch (error) {
      console.warn('Failed to load conference member listen preferences:', error);
    }
  }

  function persistConferenceListenExclusions() {
    ensureConferenceListenExclusionsLoaded();
    const storageKey = loadedConferenceListenExclusionsKey;
    if (!storageKey) return;

    const serialized = {};
    conferenceMemberListenExclusions.forEach((userIds, conferenceId) => {
      if (!userIds?.size) return;
      serialized[String(conferenceId)] = Array.from(userIds).sort((a, b) => a - b);
    });

    try {
      window.localStorage?.setItem(storageKey, JSON.stringify(serialized));
    } catch (error) {
      console.warn('Failed to save conference member listen preferences:', error);
    }
  }

  function ensureConferenceMemberLevelsLoaded() {
    const storageKey = getConferenceMemberLevelsStorageKey();
    if (storageKey === loadedConferenceMemberLevelsKey) return;

    conferenceMemberListenLevels.clear();
    loadedConferenceMemberLevelsKey = storageKey;
    if (!storageKey) return;

    try {
      const parsed = JSON.parse(window.localStorage?.getItem(storageKey) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      Object.entries(parsed).forEach(([conferenceId, rawLevels]) => {
        const numericConferenceId = Number(conferenceId);
        if (
          !Number.isFinite(numericConferenceId)
          || !rawLevels
          || typeof rawLevels !== 'object'
          || Array.isArray(rawLevels)
        ) return;
        const normalizedLevels = new Map();
        Object.entries(rawLevels).forEach(([userId, rawLevel]) => {
          const numericUserId = Number(userId);
          const numericLevel = Number(rawLevel);
          if (!Number.isFinite(numericUserId) || !Number.isFinite(numericLevel)) return;
          normalizedLevels.set(numericUserId, Math.max(0, Math.min(1, numericLevel)));
        });
        if (normalizedLevels.size) {
          conferenceMemberListenLevels.set(numericConferenceId, normalizedLevels);
        }
      });
    } catch (error) {
      console.warn('Failed to load conference member levels:', error);
    }
  }

  function persistConferenceMemberLevels() {
    ensureConferenceMemberLevelsLoaded();
    const storageKey = loadedConferenceMemberLevelsKey;
    if (!storageKey) return;

    const serialized = {};
    conferenceMemberListenLevels.forEach((levels, conferenceId) => {
      const serializedLevels = {};
      levels?.forEach((level, userId) => {
        if (level >= 0.999) return;
        serializedLevels[String(userId)] = Math.round(level * 100) / 100;
      });
      if (Object.keys(serializedLevels).length) {
        serialized[String(conferenceId)] = serializedLevels;
      }
    });

    try {
      window.localStorage?.setItem(storageKey, JSON.stringify(serialized));
    } catch (error) {
      console.warn('Failed to save conference member levels:', error);
    }
  }

  function getConferenceMemberListenLevel(conferenceId, userId) {
    if (conferenceId == null || userId == null) return 1;
    const numericConferenceId = Number(conferenceId);
    const numericUserId = Number(userId);
    if (!Number.isFinite(numericConferenceId) || !Number.isFinite(numericUserId)) return 1;
    ensureConferenceMemberLevelsLoaded();
    return conferenceMemberListenLevels.get(numericConferenceId)?.get(numericUserId) ?? 1;
  }

  function isConferenceMemberExcluded(conferenceId, userId) {
    const numericConferenceId = Number(conferenceId);
    const numericUserId = Number(userId);
    if (!Number.isFinite(numericConferenceId) || !Number.isFinite(numericUserId)) return false;
    ensureConferenceListenExclusionsLoaded();
    return conferenceMemberListenExclusions.get(numericConferenceId)?.has(numericUserId) || false;
  }

  function isConferenceMemberEntryExcluded(entry) {
    if (entry?.type !== 'conference') return false;
    const conferenceId = Number(String(entry.key || '').replace(/^conf-/, ''));
    return isConferenceMemberExcluded(conferenceId, entry.sourceUserId);
  }

  function applyConferenceMemberListenPreference(conferenceId, userId) {
    const targetKey = `conf-${conferenceId}`;
    forEachStreamEntry(targetKey, (entry) => {
      if (Number(entry?.sourceUserId) !== Number(userId)) return;
      if (mutedPeers.has(targetKey)) {
        mutePlaybackEntry(entry);
      } else {
        setPlaybackEntryLevel(entry, entry.volume ?? defaultVolume);
      }
    });
  }

  function setConferenceMemberListening(conferenceId, userId, listening) {
    const numericConferenceId = Number(conferenceId);
    const numericUserId = Number(userId);
    if (!Number.isFinite(numericConferenceId) || !Number.isFinite(numericUserId)) return;
    ensureConferenceListenExclusionsLoaded();

    let excludedUserIds = conferenceMemberListenExclusions.get(numericConferenceId);
    if (!excludedUserIds) {
      excludedUserIds = new Set();
      conferenceMemberListenExclusions.set(numericConferenceId, excludedUserIds);
    }
    if (listening) excludedUserIds.delete(numericUserId);
    else excludedUserIds.add(numericUserId);
    if (!excludedUserIds.size) conferenceMemberListenExclusions.delete(numericConferenceId);

    persistConferenceListenExclusions();
    applyConferenceMemberListenPreference(numericConferenceId, numericUserId);
  }

  function setConferenceMemberListenLevel(conferenceId, userId, level, { persist = true } = {}) {
    const numericConferenceId = Number(conferenceId);
    const numericUserId = Number(userId);
    const numericLevel = Number(level);
    if (
      !Number.isFinite(numericConferenceId)
      || !Number.isFinite(numericUserId)
      || !Number.isFinite(numericLevel)
    ) return;
    ensureConferenceMemberLevelsLoaded();
    const clamped = Math.max(0, Math.min(1, numericLevel));

    let levels = conferenceMemberListenLevels.get(numericConferenceId);
    if (!levels) {
      levels = new Map();
      conferenceMemberListenLevels.set(numericConferenceId, levels);
    }
    if (clamped >= 0.999) levels.delete(numericUserId);
    else levels.set(numericUserId, clamped);
    if (!levels.size) conferenceMemberListenLevels.delete(numericConferenceId);

    if (persist) persistConferenceMemberLevels();
    applyConferenceMemberListenPreference(numericConferenceId, numericUserId);
  }

  function refreshIncomingEntrySourceUserIds(users = cachedUsers) {
    const userIdBySocketId = new Map(
      (Array.isArray(users) ? users : [])
        .filter((user) => user?.socketId && user?.userId != null)
        .map((user) => [String(user.socketId), Number(user.userId)])
        .filter(([, userId]) => Number.isFinite(userId))
    );

    audioElements.forEach((entry) => {
      if (!entry || entry.sourceUserId != null || !entry.sourcePeerId) return;
      const sourceUserId = userIdBySocketId.get(String(entry.sourcePeerId));
      if (!Number.isFinite(sourceUserId)) return;
      entry.sourceUserId = sourceUserId;
      if (entry.type !== 'conference' || mutedPeers.has(entry.key)) return;
      setPlaybackEntryLevel(entry, entry.volume ?? defaultVolume);
    });
  }

  function makePersistedTargetAudioStateKey(targetType, targetId) {
    const normalizedType = typeof targetType === 'string' ? targetType.trim().toLowerCase() : '';
    const numericId = Number(targetId);
    if (!['user', 'conference', 'feed'].includes(normalizedType)) return null;
    if (!Number.isFinite(numericId)) return null;
    return `${normalizedType}:${numericId}`;
  }

  function buildVolumeStorageKeyForTargetState(targetType, targetId) {
    const normalizedType = typeof targetType === 'string' ? targetType.trim().toLowerCase() : '';
    const numericId = Number(targetId);
    if (!Number.isFinite(numericId)) return null;
    if (normalizedType === 'user') return `volume_user_${numericId}`;
    if (normalizedType === 'conference') return `volume_conf_${numericId}`;
    if (normalizedType === 'feed') return `volume_feed_${numericId}`;
    return null;
  }

  function shouldUseHeaderSlideHint() {
    if (typeof window === 'undefined') return false;
    return window.innerWidth >= 700;
  }

  function showSlideToLockHint(targetKey) {
    if (slideHintShown || !targetKey || String(targetKey).startsWith('feed-')) return;
    slideHintShown = true;

    if (slideHintTimeoutId) {
      clearTimeout(slideHintTimeoutId);
      slideHintTimeoutId = null;
    }

    if (shouldUseHeaderSlideHint() && sessionSlideHintEl) {
      sessionSlideHintEl.classList.remove('is-visible');
      void sessionSlideHintEl.offsetWidth;
      sessionSlideHintEl.classList.add('is-visible');
      slideHintTimeoutId = window.setTimeout(() => {
        sessionSlideHintEl?.classList.remove('is-visible');
        slideHintTimeoutId = null;
      }, 3000);
      return;
    }

    const li = document.getElementById(targetKey);
    if (!li) return;
    li.classList.remove('show-slide-hint');
    void li.offsetWidth;
    li.classList.add('show-slide-hint');
    slideHintTimeoutId = window.setTimeout(() => {
      li.classList.remove('show-slide-hint');
      slideHintTimeoutId = null;
    }, 3000);
  }

  function normalizePersistedTargetAudioState(rawState) {
    const targetType = typeof rawState?.targetType === 'string'
      ? rawState.targetType.trim().toLowerCase()
      : '';
    const targetId = Number(rawState?.targetId);
    const rawVolume = Number(rawState?.volume);
    if (!['user', 'conference', 'feed'].includes(targetType)) return null;
    if (!Number.isFinite(targetId)) return null;
    return {
      targetType,
      targetId,
      muted: Boolean(rawState?.muted),
      volume: Math.max(0, Math.min(1, Number.isFinite(rawVolume) ? rawVolume : defaultVolume)),
    };
  }

  function getPersistedTargetAudioState(targetType, targetId) {
    const key = makePersistedTargetAudioStateKey(targetType, targetId);
    return key ? persistedTargetAudioStateMap.get(key) || null : null;
  }

  function persistTargetAudioStateLocally(state) {
    const normalized = normalizePersistedTargetAudioState(state);
    if (!normalized) return null;
    const persistedKey = makePersistedTargetAudioStateKey(normalized.targetType, normalized.targetId);
    const volumeStorageKey = buildVolumeStorageKeyForTargetState(normalized.targetType, normalized.targetId);
    if (!persistedKey || !volumeStorageKey) return null;
    persistedTargetAudioStateMap.set(persistedKey, normalized);
    storeVolume(volumeStorageKey, normalized.volume);
    return normalized;
  }

  function clearStoredTargetAudioPreferences() {
    persistedTargetAudioStateMap.clear();
    volumeMemoryStore.forEach((_, key) => {
      if (TARGET_AUDIO_VOLUME_STORAGE_PREFIXES.some(prefix => String(key).startsWith(prefix))) {
        volumeMemoryStore.delete(key);
      }
    });
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
        const key = sessionStorage.key(i);
        if (key && TARGET_AUDIO_VOLUME_STORAGE_PREFIXES.some(prefix => key.startsWith(prefix))) {
          sessionStorage.removeItem(key);
        }
      }
    } catch (error) {
      console.warn('Session storage unavailable while clearing target audio preferences:', error);
    }
  }

  function syncRenderedTargetAudioPreferences() {
    const visibleTargetEls = Array.from(document.querySelectorAll('li.target-item'));
    const visibleTargetKeys = new Set();
    const nextMutedKeys = new Set();

    visibleTargetEls.forEach((targetEl) => {
      const targetKey = targetEl?.id;
      const targetType = targetEl?.dataset?.type;
      const targetId = Number(targetEl?.dataset?.id);
      if (!targetKey || !targetType || !Number.isFinite(targetId)) return;

      visibleTargetKeys.add(targetKey);
      const persistedState = getPersistedTargetAudioState(targetType, targetId);
      const volumeStorageKey = buildVolumeStorageKeyForTargetState(targetType, targetId);
      if (volumeStorageKey) {
        const volume = persistedState?.volume ?? getStoredVolume(volumeStorageKey);
        applyVolumeToTarget(targetKey, volume);
        updateTargetVolumeSliderUi(targetKey, volume);
      }
      if (persistedState?.muted) {
        nextMutedKeys.add(targetKey);
      }
    });

    visibleTargetKeys.forEach((targetKey) => {
      const shouldBeMuted = nextMutedKeys.has(targetKey);
      if (shouldBeMuted) mutedPeers.add(targetKey);
      else mutedPeers.delete(targetKey);

      if (isFeedKey(targetKey)) {
        forEachStreamEntry(targetKey, (entry) => {
          if (shouldBeMuted || stoppedFeedKeys.has(targetKey)) {
            muteFeedEntry(entry);
          } else {
            setFeedEntryLevel(entry, entry.volume ?? defaultVolume);
          }
        });
        updateMuteUiForTarget(targetKey, shouldBeMuted);
        updateFeedReceptionUi(targetKey);
        return;
      }

      const consumers = collectConsumersForTarget(targetKey);
      consumers.forEach((consumer) => {
        if (!consumer?.pause || !consumer?.resume) return;
        shouldBeMuted ? consumer.pause() : consumer.resume();
      });
      forEachStreamEntry(targetKey, (entry) => {
        if (shouldBeMuted) {
          mutePlaybackEntry(entry);
        } else {
          setPlaybackEntryLevel(entry, entry.volume ?? defaultVolume);
        }
      });
      updateMuteUiForTarget(targetKey, shouldBeMuted);
    });

    if (isOperatorSession()) {
      applyFeedDucking();
    }
  }

  function applyPersistedTargetAudioStates(states, { replace = true } = {}) {
    if (replace) {
      clearStoredTargetAudioPreferences();
    }
    if (Array.isArray(states)) {
      states.forEach((state) => {
        persistTargetAudioStateLocally(state);
      });
    }
    syncRenderedTargetAudioPreferences();
  }

  async function applyOutputDeviceSelection(deviceId, { persist = true, sync = true, requestPermission = false } = {}) {
    const normalized = deviceId || '';
    if (!supportsAudioOutputSelection()) {
      if (sync) syncManagedOutputSelects('');
      if (persist) persistPreferredOutputDeviceId('');
      return false;
    }

    let resolvedDeviceId = normalized;
    if (requestPermission && resolvedDeviceId && typeof navigator.mediaDevices?.selectAudioOutput === 'function') {
      try {
        const grantedDevice = await navigator.mediaDevices.selectAudioOutput({ deviceId: resolvedDeviceId });
        resolvedDeviceId = grantedDevice?.deviceId || resolvedDeviceId;
      } catch (err) {
        console.warn('Audio output device selection was not granted:', err);
        if (sync) syncManagedOutputSelects(preferredOutputDeviceId);
        return false;
      }
    }

    if (sharedAudioContext && sharedAudioContext.state !== 'closed' && typeof sharedAudioContext.setSinkId === 'function') {
      try {
        await sharedAudioContext.setSinkId(resolvedDeviceId);
      } catch (err) {
        console.warn('Failed to apply audio output device to AudioContext:', err);
        if (sync) syncManagedOutputSelects(preferredOutputDeviceId);
        return false;
      }
    }

    const sinkPromises = [];
    audioElements.forEach((entry) => {
      if (entry?.usesSharedAudioElement) return;
      const audioEl = entry?.audio;
      if (audioEl && typeof audioEl.setSinkId === 'function') {
        sinkPromises.push(
          audioEl.setSinkId(resolvedDeviceId).catch(err => {
            console.warn('Failed to apply audio output device to audio element:', err);
          })
        );
      }
    });
    const remoteBusAudio = remotePlaybackBus?.audio || null;
    if (remoteBusAudio && typeof remoteBusAudio.setSinkId === 'function') {
      sinkPromises.push(
        remoteBusAudio.setSinkId(resolvedDeviceId).catch(err => {
          console.warn('Failed to apply audio output device to remote playback bus:', err);
        })
      );
    }
    await Promise.allSettled(sinkPromises);

    if (persist) {
      persistPreferredOutputDeviceId(resolvedDeviceId);
    } else {
      preferredOutputDeviceId = resolvedDeviceId;
    }
    if (sync) {
      syncManagedOutputSelects(resolvedDeviceId);
    }
    return true;
  }

  outputSelect?.addEventListener('change', async () => {
    const selected = outputSelect.value;
    outputSelect.disabled = true;
    try {
      await applyOutputDeviceSelection(selected, { requestPermission: !!selected });
    } finally {
      outputSelect.disabled = !supportsAudioOutputSelection();
    }
  });

  if (supportsAudioOutputSelection()) {
    applyOutputDeviceSelection(preferredOutputDeviceId, {
      persist: false,
      sync: true,
      requestPermission: false
    }).catch(err => {
      console.warn('Failed to restore preferred audio output device:', err);
    });
  }

  function normalizePttTarget(target) {
    if (!target || typeof target !== 'object') return null;
    if (target.type !== 'user' && target.type !== 'conference' && target.type !== 'guest') return null;
    if (target.type === 'guest') {
      const guestId = String(target.id ?? '').trim();
      if (!guestId) return null;
      return { type: 'guest', id: guestId };
    }
    const numericId = Number(target.id);
    return {
      type: target.type,
      id: Number.isFinite(numericId) ? numericId : String(target.id),
    };
  }

  function normalizePttTargets(targets) {
    if (!Array.isArray(targets)) return [];
    const normalizedTargets = [];
    const seen = new Set();
    targets.forEach((target) => {
      const normalizedTarget = normalizePttTarget(target);
      if (!normalizedTarget) return;
      const key = `${normalizedTarget.type}:${normalizedTarget.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      normalizedTargets.push(normalizedTarget);
    });
    return normalizedTargets;
  }

  function getActiveTalkLockEntries() {
    return Array.from(activeTalkLocks.values());
  }

  function getActiveTalkLockTargets() {
    return getActiveTalkLockEntries().map((entry) => entry.target);
  }

  function hasActiveTalkLocks() {
    return activeTalkLocks.size > 0;
  }

  function getTalkLockEntry(target) {
    const identity = getTalkTargetIdentity(target);
    return identity ? activeTalkLocks.get(identity) || null : null;
  }

  function isTalkTargetLocked(target) {
    return Boolean(getTalkLockEntry(target));
  }

  function isTalkButtonLocked(button) {
    return Boolean(button && getActiveTalkLockEntries().some((entry) => entry.button === button));
  }

  function getCurrentPttState(overrides = {}) {
    const firstLockedTarget = getActiveTalkLockTargets()[0] || null;
    const baseTarget = overrides.target !== undefined
      ? overrides.target
      : ((currentTargets[0] || currentTarget || firstLockedTarget || null));
    const baseTargets = overrides.targets !== undefined
      ? overrides.targets
      : (currentTargets.length > 0 ? currentTargets : (baseTarget ? [baseTarget] : []));
    return {
      talking: typeof overrides.talking === 'boolean' ? overrides.talking : Boolean(isTalking || pendingTalkStart),
      lockActive: typeof overrides.lockActive === 'boolean' ? overrides.lockActive : hasActiveTalkLocks(),
      target: normalizePttTarget(baseTarget),
      targets: normalizePttTargets(baseTargets),
    };
  }

  function emitPttState(reason, overrides = {}) {
    if (!isOperatorSession()) return;
    if (!socket.connected) return;
    const state = getCurrentPttState(overrides);
    socket.emit('ptt-state', {
      ...state,
      reason: reason || undefined,
    });
  }

  function emitTalkTargetsUpdated(reason, targets = currentTargets) {
    if (!isOperatorSession()) return;
    if (!socket.connected) return;
    socket.emit('talk-targets-updated', {
      reason: reason || undefined,
      targets: normalizePttTargets(targets),
    });
  }

  function emitSocketAck(eventName, payload = {}, { timeoutMs = 3000 } = {}) {
    if (!socket.connected) {
      return Promise.reject(new Error('Socket is not connected'));
    }
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error(`${eventName} timeout`));
      }, timeoutMs);
      try {
        socket.emit(eventName, payload, (response = {}) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (response?.error) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      } catch (error) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  async function pauseTalkProducer(producerToPause) {
    if (!producerToPause || producerToPause.closed) return;
    try { producerToPause.pause?.(); } catch {}
    await emitSocketAck('pause-producer', { producerId: producerToPause.id });
  }

  async function resumeTalkProducer(producerToResume) {
    if (!producerToResume || producerToResume.closed) {
      throw new Error('Talk producer is not available');
    }
    try { producerToResume.resume?.(); } catch {}
    await emitSocketAck('resume-producer', { producerId: producerToResume.id });
  }

  function attachTalkProducerCloseHandler(talkProducer, processedTrack = null) {
    talkProducer.on('close', () => {
      if (producer === talkProducer) {
        producer = null;
      }
      isTalking = false;
      currentTargetPeer = null;
      if (micTrack && !settingsMenuOpen && !(voiceTriggerEnabled && isOperatorSession())) {
        micTrack.enabled = false;
      }
      if (processedTrack && processedTrack !== micTrack) {
        processedTrack.enabled = false;
      }
      scheduleMicCleanup();
      clearPressedTalkPointers();
      setReplyButtonActive(false);
      clearHotkeyActiveStyles();
      pressedHotkeyBindings.clear();
      setSelfTalkingKey(null);
      if (hasActiveTalkLocks()) {
        clearLockState();
      }
    });
  }

  async function ensureWarmTalkProducer(reason = 'warm-talk-producer') {
    if (!isOperatorSession() || session.kind !== 'user') return null;
    if (producer && !producer.closed) return producer;
    if (pendingTalkStart || isTalking || feedStreaming) return null;
    if (!mediaInitialized || !sendTransport || sendTransport.closed) return null;
    if (warmTalkProducerPromise) return warmTalkProducerPromise;

    warmTalkProducerPromise = (async () => {
      const qualityKey = currentQualityKey();
      const profile = QUALITY_PROFILES[qualityKey] || QUALITY_PROFILES['low-latency'];
      const selectedDeviceId = getSelectedDeviceId();
      const audioConstraints = {
        echoCancellation: audioProcessingOptions.echoCancellation,
        noiseSuppression: audioProcessingOptions.noiseSuppression,
        autoGainControl: audioProcessingOptions.autoGainControl,
        ...(profile?.constraints || {}),
        ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {})
      };
      const track = await ensureMicTrack(audioConstraints, selectedDeviceId);
      if (!track || pendingTalkStart || isTalking || producer) return producer || null;
      track.enabled = false;

      let processedTrack = null;
      if (!audioProcessingEnabled) {
        const processing = ensureUserProcessingChain(track);
        processedTrack = processing?.outputTrack || null;
      }
      const finalTrack = processedTrack || track;
      finalTrack.enabled = false;

      const newProducer = await sendTransport.produce({
        track: finalTrack,
        appData: { type: 'talk' },
        codecOptions: profile?.codecOptions ? { ...profile.codecOptions } : undefined,
        encodings: profile?.encodings ? profile.encodings.map(enc => ({ ...enc })) : undefined,
        stopTracks: false,
      });

      producer = newProducer;
      attachTalkProducerCloseHandler(newProducer, processedTrack);
      try {
        await pauseTalkProducer(newProducer);
      } catch (error) {
        console.warn(`Failed to pause warm talk producer (${reason}):`, error);
        notifyServerProducerClosed(newProducer.id, { context: 'warm-talk-pause-failed' });
        newProducer.close();
        if (producer === newProducer) {
          producer = null;
        }
        return null;
      }
      if (settingsMenuOpen || (voiceTriggerEnabled && isOperatorSession())) {
        track.enabled = true;
        if (!audioProcessingEnabled) {
          ensureUserMeterMonitorChain(track);
          scheduleUserMeterUpdate();
        }
      }
      return producer;
    })();

    try {
      return await warmTalkProducerPromise;
    } finally {
      warmTalkProducerPromise = null;
    }
  }

  ensureWarmTalkProducerAfterMicAccess = ensureWarmTalkProducer;

  refreshTalkProducerForAudioProcessingChange = async function () {
    if (session.kind !== 'user') {
      cleanupMicTrack();
      if (settingsMenuOpen) await startInputMonitor();
      restartVoiceTriggerMonitorHandler();
      return;
    }

    // Do not tear down the track currently carrying an active PTT transmission.
    // The next idle transition below will recreate the paused warm producer.
    if (isTalking || pendingTalkStart) {
      audioProcessingReinitializePending = true;
      return;
    }

    const staleProducer = producer && !producer.closed ? producer : null;
    if (staleProducer) {
      notifyServerProducerClosed(staleProducer.id, {
        context: 'audio-processing-changed',
      });
      staleProducer.close();
      if (producer === staleProducer) {
        producer = null;
      }
    }

    cleanupMicTrack();
    if (settingsMenuOpen) await startInputMonitor();
    restartVoiceTriggerMonitorHandler();

    if (mediaInitialized && isOperatorSession() && session.kind === 'user') {
      await ensureWarmTalkProducer('audio-processing-changed');
    }
  };

  function emitApiCommandResult(eventName, {
    commandId = null,
    ok = false,
    reason = null,
    action = null,
    targetType = null,
    targetId = null,
    talking,
    lockActive,
    target,
  } = {}) {
    if (!commandId || !socket.connected || session.kind !== 'user') return;
    const state = getCurrentPttState({ talking, lockActive, target });
    socket.emit(eventName, {
      commandId,
      ok: Boolean(ok),
      reason: reason || null,
      action: action || null,
      targetType: targetType || null,
      targetId: targetId ?? null,
      ...state,
    });
  }

  function emitApiTalkCommandResult(payload = {}) {
    emitApiCommandResult('api-talk-command-result', payload);
  }

  function emitApiTargetAudioCommandResult(payload = {}) {
    emitApiCommandResult('api-target-audio-command-result', payload);
  }

  function updatePttButtonSizing() {
    const list = document.getElementById('targets-list');
    if (!list) return;
    list.querySelectorAll('li.target-item .target-actions.ptt-actions').forEach(actions => {
      const li = actions.closest('li.target-item');
      if (!li) return;
      const info = li.querySelector('.target-info');
      const baseEl = info || li;
      const rectHeight = baseEl.getBoundingClientRect().height;
      const height = Math.max(0, Math.round(rectHeight));
      if (height > 0) {
        const next = `${height}px`;
        if (li.style.getPropertyValue('--ptt-btn-size') !== next) {
          li.style.setProperty('--ptt-btn-size', next);
        }
      }
    });
  }

  function schedulePttButtonSizing() {
    if (pendingPttSizingRaf != null) return;
    pendingPttSizingRaf = requestAnimationFrame(() => {
      pendingPttSizingRaf = null;
      updatePttButtonSizing();
    });
  }

  function makeStreamKey(targetKey, producerId) {
    if (!producerId) return targetKey;
    return `${targetKey}::${producerId}`;
  }

  function registerStreamKey(targetKey, streamKey) {
    if (!targetStreamMap.has(targetKey)) {
      targetStreamMap.set(targetKey, new Set());
    }
    targetStreamMap.get(targetKey).add(streamKey);
  }

  function unregisterStreamKey(targetKey, streamKey) {
    const set = targetStreamMap.get(targetKey);
    if (!set) return;
    set.delete(streamKey);
    if (set.size === 0) {
      targetStreamMap.delete(targetKey);
    }
  }

  function hasActiveStreams(targetKey) {
    const set = targetStreamMap.get(targetKey);
    return !!(set && set.size);
  }
  targetHasActiveStreams = hasActiveStreams;

  function isTargetSpeaking(targetKey) {
    return speakingPeers.has(targetKey) || activeFeedKeys.has(targetKey);
  }

  function updateFeedOnlineUi(targetKey) {
    if (!isFeedKey(targetKey)) return;
    const el = document.getElementById(targetKey);
    if (!el) return;
    el.classList.toggle('is-offline', !activeFeedKeys.has(targetKey));
  }

  function forEachStreamKey(targetKey, callback) {
    const seen = new Set();
    const set = targetStreamMap.get(targetKey);
    if (set) {
      Array.from(set).forEach((streamKey) => {
        seen.add(streamKey);
        callback(streamKey);
      });
    }

    for (const [streamKey, entry] of audioElements.entries()) {
      if (!entry || entry.key !== targetKey || seen.has(streamKey)) continue;
      registerStreamKey(targetKey, streamKey);
      seen.add(streamKey);
      callback(streamKey);
    }
  }

  function forEachStreamEntry(targetKey, callback) {
    forEachStreamKey(targetKey, (streamKey) => {
      const entry = audioElements.get(streamKey);
      if (entry) {
        callback(entry, streamKey);
      }
    });
  }

  function collectConsumersForTarget(targetKey) {
    const collected = [];
    forEachStreamKey(targetKey, (streamKey) => {
      const consumers = peerConsumers.get(streamKey);
      if (consumers) {
        consumers.forEach((consumer) => collected.push(consumer));
      }
    });
    return collected;
  }

  function emitConsumerPauseState(consumer, paused) {
    if (!consumer?.id || !socket?.connected) return;
    const eventName = paused ? 'pause-consumer' : 'resume-consumer';
    try {
      socket.emit(eventName, { consumerId: consumer.id }, (response = {}) => {
        if (response?.error) {
          console.warn(`Failed to ${paused ? 'pause' : 'resume'} consumer ${consumer.id}:`, response.error);
        }
      });
    } catch (error) {
      console.warn(`Failed to emit ${eventName}:`, error);
    }
  }

  function closeConsumerOnServer(consumerId) {
    if (!consumerId || !socket?.connected) return;
    try {
      socket.emit('close-consumer', { consumerId }, () => {});
    } catch (error) {
      console.warn('Failed to emit close-consumer:', error);
    }
  }

  function updateFeedReceptionUi(targetKey) {
    const stopped = stoppedFeedKeys.has(targetKey);
    const targetEl = document.getElementById(targetKey);
    targetEl?.classList.toggle('feed-stopped', stopped);

    const button = targetEl?.querySelector('.feed-reception-btn');
    if (!button) return;
    button.innerHTML = stopped ? FEED_RECEPTION_ICONS.play : FEED_RECEPTION_ICONS.stop;
    button.title = stopped ? 'Start receiving feed' : 'Stop receiving feed';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', stopped ? 'true' : 'false');
    button.classList.toggle('is-stopped', stopped);
  }

  function setFeedReceptionStopped(targetKey, stopped) {
    if (!isFeedKey(targetKey)) return;
    const shouldStop = !!stopped;
    if (shouldStop) stoppedFeedKeys.add(targetKey);
    else stoppedFeedKeys.delete(targetKey);

    const consumers = collectConsumersForTarget(targetKey);
    consumers.forEach((consumer) => {
      if (!consumer?.pause || !consumer?.resume) return;
      if (shouldStop) {
        try { consumer.pause(); } catch {}
        emitConsumerPauseState(consumer, true);
      } else {
        try { consumer.resume(); } catch {}
        emitConsumerPauseState(consumer, false);
      }
    });

    forEachStreamEntry(targetKey, (entry) => {
      if (shouldStop || mutedPeers.has(targetKey)) {
        muteFeedEntry(entry);
        return;
      }
      setFeedEntryLevel(entry, entry.volume ?? defaultVolume);
      attemptPlayAudio(entry.audio, {
        reason: 'feed-reception-restarted',
        targetKey,
        streamKey: entry.streamKey,
        consumerId: entry.consumerId,
        type: entry.type,
      }).catch(() => {});
    });

    updateFeedReceptionUi(targetKey);
    if (isOperatorSession()) {
      applyFeedDucking();
    }
  }

  function pruneIncomingStreamBookkeeping() {
    // Remove stale stream bookkeeping so orphaned audio elements cannot linger.
    for (const [targetKey, set] of Array.from(targetStreamMap.entries())) {
      for (const streamKey of Array.from(set)) {
        const entry = audioElements.get(streamKey);
        const consumers = peerConsumers.get(streamKey);
        let hasConsumers = false;
        if (consumers) {
          for (const consumer of Array.from(consumers)) {
            if (consumer?.closed) {
              consumers.delete(consumer);
            }
          }
          if (consumers.size === 0) {
            peerConsumers.delete(streamKey);
          } else {
            hasConsumers = true;
          }
        }
        const audioEl = entry?.audio || null;
        const track = audioEl?.srcObject?.getTracks?.()?.[0] || null;
        const trackLive = !!(track && track.readyState === 'live');
        const audioInDom = !!(audioEl && document.body.contains(audioEl));
        const keepLiveEntryMapped = !!(entry && audioInDom && trackLive);

        if (keepLiveEntryMapped) {
          continue;
        }

        if (!entry || !hasConsumers || !audioInDom || !trackLive) {
          unregisterStreamKey(targetKey, streamKey);
        }
      }

      if (isFeedKey(targetKey) && !hasActiveStreams(targetKey) && activeFeedKeys.has(targetKey)) {
        activeFeedKeys.delete(targetKey);
        updateSpeakerHighlight(targetKey, false);
      }
    }
  }

  function targetKeyFromProducerPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const { peerId, speakerUserId, appData } = payload;
    if (!appData || typeof appData !== 'object') return null;
    if (appData.type === 'conference') return `conf-${appData.id}`;
    if (appData.type === 'feed') return `feed-${appData.id}`;
    return resolveRenderedUserTargetKey({ userId: speakerUserId, peerId });
  }

  function streamKeyFromProducerPayload(payload) {
    const targetKey = targetKeyFromProducerPayload(payload);
    if (!targetKey) return null;
    const producerId = payload?.producerId || payload?.appData?.producerId || null;
    return makeStreamKey(targetKey, producerId);
  }

  function cleanupConsumerById(consumerId, { suppressUi = false } = {}) {
    if (!consumerId) return false;
    const normalizedId = String(consumerId);

    for (const [streamKey, entry] of audioElements.entries()) {
      if (String(entry?.consumerId || "") !== normalizedId) continue;
      const targetKey = entry?.key || null;
      if (!targetKey) return false;
      cleanupIncomingStream(targetKey, streamKey, { suppressUi });
      return true;
    }

    for (const [streamKey, consumers] of peerConsumers.entries()) {
      const matches = Array.from(consumers || []).some(
        (consumer) => String(consumer?.id || "") === normalizedId
      );
      if (!matches) continue;

      const targetKey = audioElements.get(streamKey)?.key
        || Array.from(targetStreamMap.entries()).find(([, set]) => set?.has(streamKey))?.[0]
        || null;
      if (!targetKey) return false;
      cleanupIncomingStream(targetKey, streamKey, { suppressUi });
      return true;
    }

    return false;
  }

  function receiveNowMs() {
    return (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
  }

  function pruneEarlyClosedConsumers(now = receiveNowMs()) {
    for (const [consumerId, rememberedAt] of Array.from(earlyClosedConsumerIds.entries())) {
      if (now - rememberedAt > EARLY_CLOSED_CONSUMER_TTL_MS) {
        earlyClosedConsumerIds.delete(consumerId);
      }
    }
  }

  function rememberEarlyClosedConsumer(consumerId) {
    if (!consumerId) return;
    const normalizedId = String(consumerId);
    const now = receiveNowMs();
    earlyClosedConsumerIds.set(normalizedId, now);
    pruneEarlyClosedConsumers(now);
    logReceiveDiagnostic('consumer-closed-deferred', {
      consumerId: normalizedId,
      deferredCount: earlyClosedConsumerIds.size,
    });
  }

  function takeEarlyClosedConsumer(consumerId) {
    if (!consumerId) return false;
    const normalizedId = String(consumerId);
    pruneEarlyClosedConsumers();
    const hadEarlyClose = earlyClosedConsumerIds.delete(normalizedId);
    if (hadEarlyClose) {
      logReceiveDiagnostic('consumer-closed-deferred-match', {
        consumerId: normalizedId,
        deferredCount: earlyClosedConsumerIds.size,
      });
    }
    return hadEarlyClose;
  }

  function pruneEarlyClosedStreams(now = receiveNowMs()) {
    for (const [streamKey, entry] of Array.from(earlyClosedStreamKeys.entries())) {
      const rememberedAt = typeof entry === 'number' ? entry : entry?.rememberedAt;
      if (!Number.isFinite(rememberedAt) || now - rememberedAt > EARLY_CLOSED_CONSUMER_TTL_MS) {
        earlyClosedStreamKeys.delete(streamKey);
      }
    }
  }

  function rememberEarlyClosedStream(streamKey, details = {}) {
    if (!streamKey) return;
    const normalizedKey = String(streamKey);
    const now = receiveNowMs();
    earlyClosedStreamKeys.set(normalizedKey, {
      rememberedAt: now,
      producerId: details.producerId || null,
      peerId: details.peerId || null,
      targetKey: details.targetKey || null,
    });
    pruneEarlyClosedStreams(now);
    logReceiveDiagnostic('producer-closed-deferred', {
      streamKey: normalizedKey,
      producerId: details.producerId || null,
      peerId: details.peerId || null,
      targetKey: details.targetKey || null,
      deferredCount: earlyClosedStreamKeys.size,
    });
  }

  function takeEarlyClosedStream(streamKey) {
    if (!streamKey) return false;
    const normalizedKey = String(streamKey);
    pruneEarlyClosedStreams();
    const hadEarlyClose = earlyClosedStreamKeys.delete(normalizedKey);
    if (hadEarlyClose) {
      logReceiveDiagnostic('producer-closed-deferred-match', {
        streamKey: normalizedKey,
        deferredCount: earlyClosedStreamKeys.size,
      });
    }
    return hadEarlyClose;
  }

  function cleanupIncomingStream(targetKey, streamKey, { suppressUi = false } = {}) {
    const consumersSet = peerConsumers.get(streamKey);
    if (consumersSet) {
      consumersSet.forEach(c => {
        closeConsumerOnServer(c?.id);
        try { c.close(); } catch {}
      });
      peerConsumers.delete(streamKey);
    }

    unregisterStreamKey(targetKey, streamKey);

    const stored = audioElements.get(streamKey);
    if (stored) {
      const audioEl = stored.audio;
      disposePlaybackEntry(stored);
      audioElements.delete(streamKey);

      if (stored.type === 'feed') {
        const feedId = Number(targetKey.split('-')[1]);
        feedAudioElements.get(feedId)?.delete(audioEl);
        if (isOperatorSession()) {
          applyFeedDucking();
        }
      } else if (stored.type === 'conference') {
        const confId = Number(targetKey.split('-')[1]);
        confAudioElements.get(confId)?.delete(audioEl);
      }
    }

    if (isFeedKey(targetKey) && !hasActiveStreams(targetKey) && activeFeedKeys.has(targetKey)) {
      activeFeedKeys.delete(targetKey);
      if (!suppressUi) {
        updateSpeakerHighlight(targetKey, false);
      }
    }
  }

  function cleanupAllIncomingStreams({ suppressUi = false } = {}) {
    for (const [targetKey, set] of Array.from(targetStreamMap.entries())) {
      for (const streamKey of Array.from(set)) {
        cleanupIncomingStream(targetKey, streamKey, { suppressUi });
      }
    }
    targetStreamMap.clear();
    peerConsumers.clear();
    audioElements.clear();
    earlyClosedConsumerIds.clear();
    earlyClosedStreamKeys.clear();
    pendingAutoplayAudios.clear();
    activeFeedKeys.clear();
    confAudioElements.clear();
    feedAudioElements.clear();
    targetPlaybackBuses.forEach((bus) => disposeTargetPlaybackBus(bus));
    targetPlaybackBuses.clear();
    disposeRemotePlaybackBus();
  }

  let lastAdaptiveReceiveVisibilityState = document.visibilityState;

  function refreshAdaptiveReceivePlaybackForVisibility(reason = 'visibilitychange') {
    if (!shouldUseAdaptiveReceivePlayback()) return;
    const nextVisibilityState = document.visibilityState;
    if (nextVisibilityState === lastAdaptiveReceiveVisibilityState) return;
    lastAdaptiveReceiveVisibilityState = nextVisibilityState;

    for (const [targetKey, set] of Array.from(targetStreamMap.entries())) {
      for (const streamKey of Array.from(set)) {
        cleanupIncomingStream(targetKey, streamKey, { suppressUi: true });
      }
    }
    pruneTargetPlaybackBuses(new Set());
    syncRenderedTargetStateUi();

    console.info('[audio][recv][adaptive-visibility-refresh]', {
      reason,
      visibilityState: nextVisibilityState,
      receivePath: shouldUseAdaptivePlainReceivePlayback()
        ? 'plain-audio-element'
        : 'web-audio-gain-or-feed-bus',
    });

    if (mediaInitialized) {
      requestActiveProducers().catch(() => {});
    }
  }

  function disconnectPlaybackNodes(entry) {
    if (!entry) return;
    if (entry.gainNode?.gain) {
      try { entry.gainNode.gain.value = 0; } catch {}
    }
    if (entry.feedDuckingNode?.gain) {
      try { entry.feedDuckingNode.gain.value = 0; } catch {}
    }
    if (entry.mediaSource) {
      try { entry.mediaSource.disconnect(); } catch {}
      entry.mediaSource = null;
    }
    if (entry.gainNode) {
      try { entry.gainNode.disconnect(); } catch {}
      entry.gainNode = null;
    }
    if (entry.feedDuckingNode) {
      try { entry.feedDuckingNode.disconnect(); } catch {}
      entry.feedDuckingNode = null;
    }
  }

  function finalizeDetachedAudioElement(audioEl) {
    if (!audioEl) return;
    try { audioEl.load?.(); } catch {}
    try { audioEl.remove(); } catch {}
    audioEntryMap.delete(audioEl);
  }

  function disposeDetachedAudioElement(audioEl) {
    if (!audioEl) return;
    if (isiOS || isSafariBrowser) {
      window.setTimeout(() => {
        finalizeDetachedAudioElement(audioEl);
      }, 0);
      return;
    }
    finalizeDetachedAudioElement(audioEl);
  }

  function disposePlaybackEntry(entry) {
    if (!entry) return;
    disconnectPlaybackNodes(entry);
    if (entry.stream) {
      try {
        entry.stream.getTracks().forEach((track) => {
          try { track.stop(); } catch {}
        });
      } catch {}
      entry.stream = null;
    }
    if (entry.usesSharedAudioElement) {
      if (entry.playbackGainNode?.gain && entry.key && !hasActiveStreams(entry.key)) {
        try { entry.playbackGainNode.gain.value = 0; } catch {}
      }
      return;
    }
    if (!entry.audio) return;
    pendingAutoplayAudios.delete(entry.audio);
    pendingAudioPlayPromises.delete(entry.audio);
    try { entry.audio.pause?.(); } catch {}
    try { entry.audio.srcObject = null; } catch {}
    try { entry.audio.removeAttribute('src'); } catch {}
    disposeDetachedAudioElement(entry.audio);
  }

  function shouldDimFeedEntry(entry) {
    if (!isOperatorSession()) return false;
    if (!supportsFeedDimming()) return false;
    if (!feedDimIncoming && !feedDimSelf) return false;
    if (!feedDuckingActive || feedDuckingFactor >= 0.999) return false;
    return isFeedKey(entry?.key || '');
  }

  function getFeedEntryLevel(entry, value) {
    const base = Math.max(0, Math.min(1, Number(value) || 0));
    if (entry?.feedDuckingNode) {
      return base;
    }
    return shouldDimFeedEntry(entry)
      ? Math.max(0, Math.min(1, base * feedDuckingFactor))
      : base;
  }

  function applyVolumeToTarget(targetKey, volume) {
    const clamped = Math.max(0, Math.min(1, Number(volume) || 0));
    forEachStreamEntry(targetKey, (entry) => {
      entry.volume = clamped;
      if (isFeedKey(targetKey) && stoppedFeedKeys.has(targetKey)) {
        muteFeedEntry(entry);
        return;
      }
      if (mutedPeers.has(targetKey)) {
        if (isFeedKey(targetKey)) {
          muteFeedEntry(entry);
        } else {
          mutePlaybackEntry(entry);
        }
        return;
      }

      if (isFeedKey(targetKey)) {
        setFeedEntryLevel(entry, clamped);
      } else {
        setPlaybackEntryLevel(entry, clamped);
      }
    });
  }

  function updateTargetVolumeSliderUi(targetKey, volume) {
    const targetEl = document.getElementById(targetKey);
    const slider = targetEl?.querySelector('.volume-slider');
    if (slider) {
      slider.value = String(Math.max(0, Math.min(1, Number(volume) || 0)));
    }
  }

  function setTargetVolumeAndPersist(targetKey, volumeStorageKey, volume, persistedState = null, { syncServer = true } = {}) {
    const clamped = Math.max(0, Math.min(1, Number(volume) || 0));
    applyVolumeToTarget(targetKey, clamped);
    storeVolume(volumeStorageKey, clamped);
    if (persistedState) {
      persistTargetAudioStateLocally({
        ...persistedState,
        volume: clamped,
      });
    }
    updateTargetVolumeSliderUi(targetKey, clamped);
    if (targetKey.startsWith('feed-') && isOperatorSession()) {
      applyFeedDucking();
    }
    if (syncServer) emitTargetAudioStateSnapshot('target-audio-volume');
    return clamped;
  }

  onAudioContextRunning = () => {
    if (!audioContextPrimed) {
      audioContextPrimed = true;
      primeVoiceProcessingMode().catch(() => {});
    }
    const remoteBusAudio = ensureRemotePlaybackBus()?.audio || null;
    if (remoteBusAudio) {
      attemptPlayAudio(remoteBusAudio, {
        reason: 'audio-context-running-remote-bus',
        streamKey: 'bus::remote',
        targetKey: 'remote-bus',
        type: 'remote-bus',
        persistentBus: true,
      }).catch(() => {});
    }
    primeVisibleRemotePlaybackBuses({ forceRetry: true });
    attemptPendingAutoplay();
    audioElements.forEach((entry) => {
      if (!entry?.gainNode || !entry.audio) return;
      if (entry.type === 'feed' && isOperatorSession()) return;
      if (mutedPeers.has(entry.key)) {
        mutePlaybackEntry(entry);
      } else {
        setPlaybackEntryLevel(entry, entry.volume ?? defaultVolume);
      }
    });
    if (isOperatorSession()) {
      applyFeedDucking();
    }
  };

  function setPlaybackEntryLevel(entry, value) {
    if (!entry || (!entry.audio && !entry.playbackBus?.audio)) return;
    const audioEl = entry.audio || entry.playbackBus?.audio || null;
    const playbackGainNode = entry.playbackGainNode || entry.gainNode || null;
    const base = Math.max(0, Math.min(1, value));
    let applied = base;
    const memberExcluded = isConferenceMemberEntryExcluded(entry);
    const conferenceId = entry?.type === 'conference'
      ? Number(String(entry.key || '').replace(/^conf-/, ''))
      : null;
    const memberLevel = getConferenceMemberListenLevel(conferenceId, entry?.sourceUserId);
    const memberGain = memberExcluded ? 0 : memberLevel;
    if (entry.usesSharedAudioElement && entry.gainNode?.gain) {
      entry.gainNode.gain.value = memberGain;
    } else {
      applied *= memberGain;
    }
    if (playbackGainNode) {
      if (entry.usesMediaElementSource || entry.usesSharedAudioElement) {
        audioEl.muted = false;
        audioEl.volume = 1;
      } else {
        audioEl.muted = true;
        audioEl.volume = 0;
      }
      playbackGainNode.gain.value = applied;
    } else {
      audioEl.muted = applied === 0;
      audioEl.volume = applied;
    }
    entry.lastAppliedLevel = applied;
    entry.memberListenExcluded = memberExcluded;
    entry.memberListenLevel = memberLevel;
  }

  function mutePlaybackEntry(entry) {
    if (!entry || (!entry.audio && !entry.playbackBus?.audio)) return;
    const audioEl = entry.audio || entry.playbackBus?.audio || null;
    const playbackGainNode = entry.playbackGainNode || entry.gainNode || null;
    if (playbackGainNode) {
      if (entry.usesMediaElementSource || entry.usesSharedAudioElement) {
        audioEl.muted = false;
        audioEl.volume = 1;
      } else {
        audioEl.muted = true;
        audioEl.volume = 0;
      }
      playbackGainNode.gain.value = 0;
    } else {
      audioEl.muted = true;
      audioEl.volume = 0;
    }
    entry.lastAppliedLevel = 0;
  }

  function setFeedEntryLevel(entry, value) {
    setPlaybackEntryLevel(entry, getFeedEntryLevel(entry, value));
  }

  function muteFeedEntry(entry) {
    mutePlaybackEntry(entry);
  }
  let feedDuckingActive = false;

  function isFeedKey(key) {
    return typeof key === 'string' && key.startsWith('feed-');
  }

  attemptPlayAudio = (audioEl, meta = {}) => {
    if (!audioEl || typeof audioEl.play !== 'function') return Promise.resolve();
    const inFlightPlay = pendingAudioPlayPromises.get(audioEl);
    if (inFlightPlay) {
      return inFlightPlay;
    }
    const track = audioEl.srcObject?.getAudioTracks?.()?.[0] || null;
    logReceiveDiagnostic('play-attempt', {
      paused: audioEl.paused,
      muted: audioEl.muted,
      volume: audioEl.volume,
      trackMuted: track?.muted ?? null,
      trackReadyState: track?.readyState ?? null,
      ...meta,
    });
    try {
      const maybePromise = audioEl.play();
      if (maybePromise && typeof maybePromise.then === 'function') {
        const trackedPromise = maybePromise
          .then(() => {
            pendingAutoplayAudios.delete(audioEl);
            const startedTrack = audioEl.srcObject?.getAudioTracks?.()?.[0] || null;
            logReceiveDiagnostic('play-started', {
              paused: audioEl.paused,
              muted: audioEl.muted,
              volume: audioEl.volume,
              trackMuted: startedTrack?.muted ?? null,
              trackReadyState: startedTrack?.readyState ?? null,
              ...meta,
            });
            console.info('[audio][playback-started]', {
              paused: audioEl.paused,
              muted: audioEl.muted,
              volume: audioEl.volume,
              trackMuted: startedTrack?.muted ?? null,
              trackReadyState: startedTrack?.readyState ?? null,
            });
          })
          .catch(err => {
            pendingAutoplayAudios.add(audioEl);
            logReceiveDiagnostic('play-blocked', {
              error: err?.message || String(err),
              paused: audioEl.paused,
              muted: audioEl.muted,
              volume: audioEl.volume,
              trackMuted: track?.muted ?? null,
              trackReadyState: track?.readyState ?? null,
              ...meta,
            });
            console.warn('Autoplay blocked, queued for retry:', err);
            throw err;
          })
          .finally(() => {
            if (pendingAudioPlayPromises.get(audioEl) === trackedPromise) {
              pendingAudioPlayPromises.delete(audioEl);
            }
          });
        pendingAudioPlayPromises.set(audioEl, trackedPromise);
        return trackedPromise;
      }
      pendingAutoplayAudios.delete(audioEl);
      pendingAudioPlayPromises.delete(audioEl);
      return Promise.resolve();
    } catch (err) {
      pendingAutoplayAudios.add(audioEl);
      pendingAudioPlayPromises.delete(audioEl);
      logReceiveDiagnostic('play-failed', {
        error: err?.message || String(err),
        paused: audioEl.paused,
        muted: audioEl.muted,
        volume: audioEl.volume,
        trackMuted: track?.muted ?? null,
        trackReadyState: track?.readyState ?? null,
        ...meta,
      });
      console.warn('Autoplay attempt failed, queued for retry:', err);
      return Promise.reject(err);
    }
  };

  function getMainButtonStorageKey() {
    const profileId = getOperatorProfileUserId();
    return profileId == null ? null
      : `mainButtonTarget:${session.kind}:${profileId}:${session.productionId || 'default'}`;
  }

  function getConfiguredMainButtonIdentity() {
    const key = getMainButtonStorageKey();
    try { return key ? localStorage.getItem(key) || '' : ''; } catch { return ''; }
  }

  function getMainButtonTarget() {
    const identity = getConfiguredMainButtonIdentity();
    if (!identity) return lastTarget;
    const descriptor = buildTalkTargetDescriptors().find(entry =>
      entry.kind === 'target' && entry.identity === identity);
    return descriptor ? { ...descriptor.target, label: descriptor.label } : null;
  }

  function updateMainButtonOptions() {
    const select = document.getElementById('main-button-target');
    if (!select) return;
    const identity = getConfiguredMainButtonIdentity();
    const options = [new Option('Reply', '')];
    for (const entry of buildTalkTargetDescriptors()) {
      if (entry.kind === 'target') {
        options.push(new Option(`${entry.label} (${entry.kindLabel})`, entry.identity));
      }
    }
    // Keep unavailable selections explicit; never silently send to a different target.
    if (identity && !options.some(option => option.value === identity)) {
      options.push(new Option('Unavailable target', identity));
    }
    select.replaceChildren(...options);
    select.value = identity;
    updateReplyButtonState();
  }

  document.getElementById('main-button-target')?.addEventListener('change', event => {
    const key = getMainButtonStorageKey();
    try {
      if (key) {
        if (event.target.value) localStorage.setItem(key, event.target.value);
        else localStorage.removeItem(key);
      }
    } catch {}
    updateReplyButtonState();
  });

  function renderReplyButtonLabel() {
    if (getConfiguredMainButtonIdentity()) {
      const target = getMainButtonTarget();
      btnReply.setAttribute('data-label', target?.label || 'Unavailable target');
      btnReply.setAttribute('aria-label', target ? `Talk to ${target.label}` : 'Unavailable target');
      return;
    }
    const suffix = lastTarget?.label ? ` (${lastTarget.label})` : "";
    btnReply.setAttribute("data-label", `${BASE_REPLY_LABEL}${suffix}`);
    const aria = lastTarget?.label ? `Reply to ${lastTarget.label}` : "Reply";
    btnReply.setAttribute("aria-label", aria);
  }

  function resolveReplyLabel(target) {
    if (!target || target.id == null) return "";

    if (target.type === "conference") {
      const numericId = Number(target.id);
      if (Number.isFinite(numericId) && conferenceLabels.has(numericId)) {
        return conferenceLabels.get(numericId) ?? "";
      }
      return targetLabels.get(`conf-${target.id}`) ?? target.label ?? "";
    }

    if (target.type === "user") {
      return targetLabels.get(`user-${target.id}`) ?? target.label ?? "";
    }

    return target.label ?? "";
  }

  function refreshLastTargetLabel() {
    if (!lastTarget) return;
    const resolved = resolveReplyLabel(lastTarget);
    if (resolved && resolved !== lastTarget.label) {
      lastTarget = { ...lastTarget, label: resolved };
      renderReplyButtonLabel();
    }
  }

  function clearReplyTarget() {
    lastTarget = null;
    updateReplyButtonState();
  }

  function resolveReplyUserSocketId(target) {
    if (!target || target.type !== 'user') return null;
    return resolveUserSocketId(target.id)
      || cachedUsers.find((entry) => String(entry?.socketId) === String(target.id))?.socketId
      || null;
  }

  function updateReplyButtonState() {
    refreshLastTargetLabel();
    const target = getMainButtonTarget();
    const replyUserSocketId = resolveReplyUserSocketId(target);
    btnReply.disabled = !socket.connected || !isOperatorSession() || !target
      || (target.type === 'user' && !replyUserSocketId);
    renderReplyButtonLabel();
  }

  clearReplyTarget();

  function normalizeIncomingAddressedEntry(rawEntry) {
    if (!rawEntry || typeof rawEntry !== 'object') return null;
    const targetType = typeof rawEntry.targetType === 'string' ? rawEntry.targetType.trim().toLowerCase() : '';
    if (targetType !== 'user' && targetType !== 'conference' && targetType !== 'guest') return null;

    const numericTargetId = Number(rawEntry.targetId);
    const targetId = targetType === 'guest'
      ? String(rawEntry.targetId ?? '').trim()
      : Number.isFinite(numericTargetId) ? numericTargetId : String(rawEntry.targetId ?? '');
    if (targetId === '') return null;

    const numericFromUserId = Number(rawEntry.fromUserId);
    const at = Number(rawEntry.at);
    const replyTargetType = typeof rawEntry.replyTargetType === 'string'
      ? rawEntry.replyTargetType.trim().toLowerCase()
      : '';
    const replyTargetId = rawEntry.replyTargetId ?? null;

    return {
      targetType,
      targetId,
      fromUserId: Number.isFinite(numericFromUserId) ? numericFromUserId : null,
      fromGuestId: rawEntry.fromGuestId ? String(rawEntry.fromGuestId) : null,
      fromName: typeof rawEntry.fromName === 'string' ? rawEntry.fromName : '',
      replyTargetType: ['user', 'conference', 'guest'].includes(replyTargetType) ? replyTargetType : null,
      replyTargetId,
      canReply: rawEntry.canReply !== false,
      at: Number.isFinite(at) ? at : 0,
    };
  }

  function normalizeIncomingTalkState(rawState) {
    const normalizedEntries = [];
    const seen = new Set();
    const entries = Array.isArray(rawState?.addressedNow) ? rawState.addressedNow : [];
    entries.forEach((rawEntry) => {
      const entry = normalizeIncomingAddressedEntry(rawEntry);
      if (!entry) return;
      const speakerKey = entry.fromGuestId
        ? `guest:${entry.fromGuestId}`
        : Number.isFinite(Number(entry.fromUserId))
          ? Number(entry.fromUserId)
          : String(entry.fromName || '').trim().toLowerCase();
      const key = `${entry.targetType}:${entry.targetId}:${speakerKey}`;
      if (seen.has(key)) return;
      seen.add(key);
      normalizedEntries.push(entry);
    });
    normalizedEntries.sort((left, right) => Number(right?.at || 0) - Number(left?.at || 0));

    return {
      addressedNow: normalizedEntries,
      replyTarget: normalizeIncomingAddressedEntry(rawState?.replyTarget),
    };
  }

  function resolveUserSocketId(rawUserId) {
    const numericId = Number(rawUserId);
    if (!Number.isFinite(numericId)) return null;
    const user = cachedUsers.find((entry) => Number(entry?.userId) === numericId);
    return user?.socketId || null;
  }

  function getRenderedUserTargetIdentities() {
    return Array.from(document.querySelectorAll('#targets-list .user-target')).map((target) => ({
      key: target.id || null,
      userId: target.dataset.id || null,
      socketId: target.dataset.socketId || null,
    }));
  }

  function resolveRenderedUserTargetKey({ userId = null, peerId = null } = {}) {
    return window.TalktomeTargetIdentity?.resolveRenderedUserTargetKey({
      userId,
      peerId,
      renderedTargets: getRenderedUserTargetIdentities(),
    }) ?? (peerId ? `user-${peerId}` : userId != null ? `user-${userId}` : null);
  }

  function targetKeyFromIncomingAddressedEntry(entry) {
    if (!entry) return null;
    if (entry.targetType === 'conference') {
      return `conf-${entry.targetId}`;
    }
    if (entry.targetType === 'user') {
      return resolveRenderedUserTargetKey({
        userId: entry.fromUserId ?? entry.targetId,
      });
    }
    if (entry.targetType === 'guest') {
      return `guest-${entry.targetId}`;
    }
    return null;
  }

  function resolveExplicitReplyTarget(entry) {
    const replyType = entry?.replyTargetType;
    if (!replyType) return null;
    if (replyType === 'guest') {
      const guestId = String(entry.replyTargetId ?? '').trim();
      if (!guestId) return null;
      return {
        type: 'guest',
        id: guestId,
        label: entry.fromName || 'Guest',
      };
    }
    if (replyType === 'user') {
      const numericUserId = Number(entry.replyTargetId);
      if (!Number.isFinite(numericUserId)) return null;
      const socketId = resolveUserSocketId(numericUserId);
      const onlineUser = cachedUsers.find((candidate) => Number(candidate?.userId) === numericUserId);
      return {
        type: 'user',
        id: socketId || numericUserId,
        label: onlineUser?.name || entry.fromName || String(numericUserId),
      };
    }
    if (replyType === 'conference') {
      const conferenceId = Number(entry.replyTargetId);
      if (!Number.isFinite(conferenceId)) return null;
      const conferenceKey = `conf-${conferenceId}`;
      return {
        type: 'conference',
        id: conferenceId,
        label: conferenceLabels.get(conferenceId) || targetLabels.get(conferenceKey) || String(conferenceId),
      };
    }
    return null;
  }

  function resolveReplyTargetFromIncomingEntry(entry) {
    if (!entry) return null;
    if (entry.canReply === false) return null;
    const replyConferenceId = entry.replyTargetType === 'conference'
      ? Number(entry.replyTargetId)
      : entry.targetType === 'conference'
        ? Number(entry.targetId)
        : NaN;
    if (
      Number.isFinite(replyConferenceId)
      && listenOnlyConferenceKeys.has(`conf-${replyConferenceId}`)
    ) {
      return null;
    }
    const explicitReplyTarget = resolveExplicitReplyTarget(entry);
    if (explicitReplyTarget) return explicitReplyTarget;

    if (entry.targetType === 'conference') {
      const conferenceId = Number(entry.targetId);
      if (!Number.isFinite(conferenceId)) return null;
      const conferenceKey = `conf-${conferenceId}`;
      return {
        type: 'conference',
        id: conferenceId,
        label: conferenceLabels.get(conferenceId) || targetLabels.get(conferenceKey) || String(conferenceId),
      };
    }

    if (entry.targetType === 'user') {
      const numericUserId = Number(entry.targetId);
      if (!Number.isFinite(numericUserId)) return null;
      const socketId = resolveUserSocketId(numericUserId);
      const onlineUser = cachedUsers.find((candidate) => Number(candidate?.userId) === numericUserId);
      return {
        type: 'user',
        id: socketId || numericUserId,
        label: onlineUser?.name || entry.fromName || String(numericUserId),
      };
    }

    return null;
  }

  function applyIncomingTalkState() {
    if (!isOperatorSession()) return;

    const nextSpeaking = new Set();
    incomingTalkState.addressedNow.forEach((entry) => {
      const targetKey = targetKeyFromIncomingAddressedEntry(entry);
      if (targetKey) {
        nextSpeaking.add(targetKey);
      }
    });

    for (const targetKey of Array.from(speakingPeers)) {
      if (!nextSpeaking.has(targetKey)) {
        speakingPeers.delete(targetKey);
        updateSpeakerHighlight(targetKey, false);
      }
    }

    speakingPeers.clear();
    for (const targetKey of Array.from(nextSpeaking)) {
      speakingPeers.add(targetKey);
      updateSpeakerHighlight(targetKey, true);
    }

    const replyEntry = incomingTalkState.replyTarget
      || incomingTalkState.addressedNow[0]
      || null;
    const replyTarget = resolveReplyTargetFromIncomingEntry(replyEntry);
    if (replyTarget) {
      lastTarget = replyTarget;
      updateReplyButtonState();
    } else {
      clearReplyTarget();
    }

    applyFeedDucking();
  }

  function applySessionUI() {
    const isFeed = session.kind === 'feed';
    const isOperator = isOperatorSession();
    applyProductionSessionUI();
    document.body.classList.toggle('feed-mode', isFeed);
    ensureCustomTargetHotkeysLoaded();
    if (!isOperator) {
      setActiveSettingsView('main');
      stopHotkeyCapture({ rerender: false });
    }
    if (shortcutSettingsOpenButton) {
      shortcutSettingsOpenButton.hidden = !isOperator;
    }
    if (arrangeTargetsOpenButton) {
      arrangeTargetsOpenButton.hidden = session.kind !== 'user';
    }
    if (session.kind !== 'user' && activeSettingsView === 'arrange') {
      setActiveSettingsView('main');
    }

    if (feedBanner) {
      feedBanner.hidden = !isFeed;
    }

    if (audioProcessingToggle) {
      audioProcessingToggle.disabled = isFeed;
      if (isFeed) {
        audioProcessingToggle.checked = false;
        audioProcessingOptions.echoCancellation = false;
        audioProcessingOptions.noiseSuppression = false;
        audioProcessingOptions.autoGainControl = false;
      } else {
        const applied = syncAudioProcessingOptions();
        audioProcessingToggle.checked = applied;
      }
    } else {
      if (!isFeed) {
        syncAudioProcessingOptions();
      }
    }

    if (qualitySelect) {
      if (isFeed) {
        qualitySelect.value = 'standard';
        qualitySelect.disabled = true;
      } else {
        qualitySelect.disabled = false;
        const storedQuality = localStorage.getItem('audioQualityProfile');
        if (storedQuality && QUALITY_PROFILES[storedQuality]) {
          qualitySelect.value = storedQuality;
        }
      }
    }

    if (dimWhileSpeakingToggle) {
      dimWhileSpeakingToggle.disabled = isFeed || !supportsFeedDimming();
      if (!isFeed) {
        dimWhileSpeakingToggle.checked = feedDimSelf;
      }
    }
    if (dimWhenAddressedToggle) {
      dimWhenAddressedToggle.disabled = isFeed || !supportsFeedDimming();
      if (!isFeed) {
        dimWhenAddressedToggle.checked = feedDimIncoming;
      }
    }

    updateFeedProcessingUI();
    updateFeedPtimeUI();
    applyUserGainControlState();
    updateFeedControls();
    updateVoiceTriggerTargetOptions(cachedUsers);
    if (!isOperator || isFeed) {
      stopVoiceTriggerMonitoring();
      updateVoiceTriggerControlsState();
    } else {
      updateVoiceTriggerControlsState();
      if (voiceTriggerEnabled) {
        startVoiceTriggerMonitoring();
      }
    }
    renderTargetHotkeySettings(cachedUsers);
  }

  applySessionUI();

  function updateFeedControls() {
    if (!feedBanner) return;
    const isFeed = session.kind === 'feed';
    feedBanner.hidden = !isFeed;
    feedBanner.classList.toggle('is-streaming', feedStreaming);
    if (!isFeed) return;

    const transportReady = !!sendTransport && !sendTransport.closed;
    let statusText = 'Feed ready';
    if (!transportReady) {
      statusText = 'Waiting for connection…';
    } else if (feedStreaming) {
      statusText = 'Feed streaming';
    } else if (feedManualStop) {
      statusText = 'Feed stopped';
    }

    if (feedStreamStatus) {
      feedStreamStatus.textContent = statusText;
    }

    if (feedStreamToggle) {
      feedStreamToggle.textContent = feedStreaming ? 'Stop Feed' : 'Start Feed';
      feedStreamToggle.disabled = !transportReady;
    }
  }

  async function restartFeedStreamForSettingsChange(reason) {
    if (session.kind !== 'feed') return;
    if (!feedStreaming) return;
    console.log(`Restarting feed stream after ${reason} change`);
    stopFeedStream({ manual: false });
    await startFeedStream({ manual: false });
  }

  function applyFeedDucking() {
    if (!isOperatorSession()) return;
    const dimmingSupported = supportsFeedDimming();
    const shouldDimSelf = dimmingSupported && feedDimSelf && isTalking;
    const shouldDimIncoming = dimmingSupported && feedDimIncoming && speakingPeers.size > 0;
    const shouldDuck = shouldDimIncoming || shouldDimSelf;
    feedDuckingActive = shouldDuck;

    for (const [feedId, audios] of feedAudioElements) {
      const key = `feed-${feedId}`;

      for (const audioEl of audios) {
        const entry = audioEntryMap.get(audioEl);
        if (!entry) continue;
        if (stoppedFeedKeys.has(key)) {
          muteFeedEntry(entry);
          continue;
        }
        if (mutedPeers.has(key)) {
          muteFeedEntry(entry);
          continue;
        }

        if (entry.feedDuckingNode) {
          entry.feedDuckingNode.gain.value = shouldDimFeedEntry(entry) ? feedDuckingFactor : 1;
          setFeedEntryLevel(entry, entry.volume ?? defaultVolume);
          continue;
        }

        setFeedEntryLevel(entry, entry.volume ?? defaultVolume);
      }
    }
  }

  async function startFeedStream({ manual = false } = {}) {
    if (session.kind !== 'feed') return;
    if (feedStreaming) return;
    if (!session.feedId) return;
    const feedProfile = getFeedProfile();

    if (!sendTransport || sendTransport.closed) {
      shouldStartFeedWhenReady = true;
      updateFeedControls();
      if (manual) {
        alert('Transport not ready yet, please wait a moment.');
      }
      return;
    }

    const feedKey = session.feedId != null ? `feed-${session.feedId}` : null;
    if (feedKey) {
      activeFeedKeys.delete(feedKey);
      updateSpeakerHighlight(feedKey, false);
      forEachStreamKey(feedKey, (streamKey) => {
        const consumers = peerConsumers.get(streamKey);
        if (consumers) {
          consumers.forEach(c => { try { c.close(); } catch {} });
          peerConsumers.delete(streamKey);
        }
        const entry = audioElements.get(streamKey);
        if (entry) {
          disposePlaybackEntry(entry);
          audioElements.delete(streamKey);
          const feedId = Number(session.feedId);
          feedAudioElements.get(feedId)?.delete(entry.audio);
        }
        unregisterStreamKey(feedKey, streamKey);
      });
    }

    shouldStartFeedWhenReady = false;

    try {
      const selectedDeviceId = getSelectedDeviceId();
      const audioConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(feedProfile.constraints || {}),
        ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {})
      };

      const track = await ensureMicTrack(audioConstraints, selectedDeviceId);
      // Hint the browser that this is program audio, not speech
      try { track.contentHint = 'music'; } catch {}
      try { await track.applyConstraints?.({ channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 } }); } catch {}
      track.enabled = true;

      const processing = feedInputProcessingEnabled ? ensureFeedProcessingChain(track) : null;
      if (!feedInputProcessingEnabled) {
        destroyFeedProcessing();
      }
      if (processing?.ctx) {
        await resumeAudioContextIfNeeded(processing.ctx, { label: 'feed ingest AudioContext' });
      }
      const processedTrack = processing?.outputTrack || track;
      try { processedTrack.contentHint = 'music'; } catch {}
      processedTrack.enabled = true;

      const newProducer = await sendTransport.produce({
        track: processedTrack,
        appData: { type: 'feed', id: session.feedId },
        codecOptions: feedProfile.codecOptions ? { ...feedProfile.codecOptions } : undefined,
        encodings: feedProfile.encodings ? feedProfile.encodings.map(enc => ({ ...enc })) : undefined,
        stopTracks: false,
      });

      if (!newProducer) {
        throw new Error('Failed to create feed producer');
      }

      producer = newProducer;
      feedStreaming = true;
      if (manual) {
        feedManualStop = false;
      }

      newProducer.on('close', () => {
        if (producer === newProducer) {
          producer = null;
        }
        feedStreaming = false;
        updateFeedControls();
        if (!feedManualStop) {
          scheduleMicCleanup();
          shouldStartFeedWhenReady = true;
        }
        if (processedTrack && processedTrack !== track) {
          processedTrack.enabled = false;
        }
      });

      newProducer.on('transportclose', () => {
        if (producer === newProducer) {
          producer = null;
        }
        feedStreaming = false;
        updateFeedControls();
        if (!feedManualStop) {
          shouldStartFeedWhenReady = true;
        }
        if (processedTrack && processedTrack !== track) {
          processedTrack.enabled = false;
        }
      });

      updateFeedControls();
    } catch (err) {
      feedStreaming = false;
      shouldStartFeedWhenReady = true;
      updateFeedControls();
      console.error('Failed to start feed stream:', err);
      if (manual) {
        alert('Failed to start feed: ' + err.message);
      }
    }
  }

  function stopFeedStream({ manual = false } = {}) {
    if (session.kind !== 'feed') return;
    const feedKey = session.feedId != null ? `feed-${session.feedId}` : null;

    if (producer) {
      notifyServerProducerClosed(producer.id, { context: 'feed-stop' });
      try {
        producer.close();
      } catch (err) {
        console.warn('Error closing feed producer', err);
      }
      producer = null;
    }
    feedStreaming = false;
    if (manual) {
      feedManualStop = true;
      shouldStartFeedWhenReady = false;
    }
    if (feedKey) {
      activeFeedKeys.delete(feedKey);
      updateSpeakerHighlight(feedKey, false);
    }
    cleanupMicTrack();
    updateFeedControls();
    applyFeedDucking();
  }

  async function ensureMediaInitialized() {
    if (mediaInitialized) return;
    if (initializingMediaPromise) {
      return initializingMediaPromise;
    }

    const generation = mediaStateGeneration;
    initializingMediaPromise = (async () => {
      await initializeMediaSoup();
      if (generation !== mediaStateGeneration || !socket.connected) {
        closeMediaTransportState();
        throw new Error('Media initialization was superseded by a connection reset');
      }
      mediaInitialized = true;
      renderMediaConnectionStatus();
      if (isOperatorSession() && session.kind === 'user' && micTrack?.readyState === 'live') {
        await ensureWarmTalkProducer('media-initialized');
      }
    })();

    try {
      await initializingMediaPromise;
    } catch (err) {
      mediaInitialized = false;
      throw err;
    } finally {
      initializingMediaPromise = null;
    }
  }

  function closeMediaTransportState() {
    mediaStateGeneration += 1;
    stopMediaNetworkStatsReporting();
    try {
      producer?.close();
    } catch {}
    try {
      sendTransport?.close();
    } catch {}
    try {
      recvTransport?.close();
    } catch {}
    producer = null;
    sendTransport = null;
    recvTransport = null;
    device = null;
    mediaInitialized = false;
    resetMediaConnectionState();
  }

  function notifyServerProducerClosed(producerId, { context = 'producer-close' } = {}) {
    if (!producerId) return;
    try {
      socket.emit('producer-close', { producerId });
    } catch (err) {
      console.warn(`Error notifying server about ${context}:`, err);
    }
  }

  function initializeMediaIfPossible() {
    shouldInitializeAfterConnect = true;
    if (socket.connected) {
      ensureMediaInitialized().catch(err => {
        console.error('Media initialization failed:', err);
        if (session?.name && !sessionResetInProgress) {
          setSessionDisplay('Reconnecting...', { connectionStatus: true });
          scheduleReconnectRecovery('media-initialization');
        }
      });
    }
  }

  function clearStoredIdentity() {
    localStorage.removeItem("userId");
    localStorage.removeItem(FEED_ID_STORAGE_KEY);
    localStorage.removeItem("userName");
    localStorage.removeItem(IDENTITY_KIND_KEY);
    clearStoredGuestSession();
    clearStoredTargetAudioPreferences();
  }

  function sendLogoutBeacon() {
    if (!session?.name || session?.kind === 'guest') return;
    if (typeof navigator?.sendBeacon !== 'function') return;
    const payload = JSON.stringify({
      userId: session.kind === 'user' ? Number(session.userId) : null,
      socketId: socket?.id || null,
    });
    try {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon('/api/v1/client/logout', blob);
    } catch {}
  }

  async function notifyServerLogoutViaHttp({ timeoutMs = 800 } = {}) {
    if (!session?.name || session?.kind === 'guest') return;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => {
          try {
            controller.abort();
          } catch {}
        }, timeoutMs)
      : null;

    try {
      await fetch('/api/v1/client/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          userId: session.kind === 'user' ? Number(session.userId) : null,
          socketId: socket?.id || null,
        }),
        signal: controller?.signal,
      });
    } catch {
      sendLogoutBeacon();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function notifyServerLogoutAndDisconnect({ timeoutMs = 800 } = {}) {
    const pending = [notifyServerLogoutViaHttp({ timeoutMs })];

    if (socket?.connected) {
      pending.push(
        new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };
          const timer = setTimeout(finish, timeoutMs);
          try {
            socket.emit("user-logout", () => {
              clearTimeout(timer);
              finish();
            });
          } catch {
            clearTimeout(timer);
            finish();
          }
        })
      );
    }

    await Promise.allSettled(pending);

    if (socket?.connected) {
      try {
        socket.disconnect();
      } catch {}
    }
  }

  async function hardLogoutAndReload(message = null, { silent = false, notifyServer = true } = {}) {
    sessionResetInProgress = true;
    suppressLogoutBeacon = !notifyServer;
    try {
      if (!silent && message) alert(message);
    } catch {}
    try {
      if (session?.kind === 'feed') {
        stopFeedStream({ manual: true });
      }
    } catch {}
    if (notifyServer) {
      await notifyServerLogoutAndDisconnect();
    } else if (socket?.connected) {
      try {
        socket.disconnect();
      } catch {}
    }
    clearStoredIdentity();
    if (!notifyServer) {
      session = createAnonymousSession();
    }
    location.reload();
  }

  window.addEventListener("pagehide", () => {
    if (suppressLogoutBeacon) return;
    if (socket?.connected) {
      try {
        socket.disconnect();
      } catch {}
    }
  });

  function emitRegisterUser(payload, { timeoutMs = 5000 } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        resolve(result || {});
      };
      const timer = setTimeout(() => finish({ error: "register-user timeout" }), timeoutMs);
      try {
        socket.emit("register-user", payload, (resp) => {
          clearTimeout(timer);
          finish(resp);
        });
      } catch (err) {
        clearTimeout(timer);
        finish({ error: err?.message || String(err) });
      }
    });
  }

  let activeRegistrationPromise = null;
  let activeRegistrationKey = null;
  let sessionResetInProgress = false;
  let suppressLogoutBeacon = false;
  let reconnectRecoveryTimer = null;
  let reconnectRecoveryAttempt = 0;
  let reconnectRecoveryPromise = null;
  let connectionGeneration = 0;
  let lastConnectedSocketId = null;
  let previousSocketId = null;

  async function registerUserWithConflictPrompt({ id, name, kind, allowPrompt = true, guestProfileUserId = null, productionId = null } = {}) {
    const first = await emitRegisterUser({ id, name, kind, guestProfileUserId, productionId, force: false });
    if (first?.conflict && kind === 'user') {
      if (previousSocketId && first?.existing?.socketId === previousSocketId) {
        return emitRegisterUser({ id, name, kind, guestProfileUserId, productionId, force: true });
      }
      if (!allowPrompt) return { conflict: true };
      const existingName = first?.existing?.name ? ` (${first.existing.name})` : '';
      const ok = confirm(`This user is already signed in${existingName}. Sign out the other session?`);
      if (!ok) return { cancelled: true };
      const forced = await emitRegisterUser({ id, name, kind, guestProfileUserId, productionId, force: true });
      return forced?.ok ? forced : forced;
    }
    return first?.ok ? first : first;
  }

  function buildRegistrationKey({ id, name, kind, allowPrompt = true, guestProfileUserId = null, productionId = null } = {}) {
    return JSON.stringify({
      id: id ?? null,
      name: name ?? null,
      kind: kind ?? null,
      guestProfileUserId: guestProfileUserId ?? null,
      productionId: productionId ?? null,
      allowPrompt: !!allowPrompt,
    });
  }

  async function registerIdentity({ id, name, kind, allowPrompt = true, guestProfileUserId = null, productionId = null } = {}) {
    const key = buildRegistrationKey({ id, name, kind, allowPrompt, guestProfileUserId, productionId });
    if (activeRegistrationPromise && activeRegistrationKey === key) {
      return activeRegistrationPromise;
    }

    const promise = (async () => {
      if (kind === 'user') {
        return registerUserWithConflictPrompt({ id, name, kind, allowPrompt, guestProfileUserId, productionId });
      }
      const result = await emitRegisterUser({ id, name, kind, guestProfileUserId, productionId, force: false });
      return result?.ok ? result : result;
    })();

    activeRegistrationKey = key;
    activeRegistrationPromise = promise;

    try {
      return await promise;
    } finally {
      if (activeRegistrationPromise === promise) {
        activeRegistrationPromise = null;
        activeRegistrationKey = null;
      }
    }
  }

  async function registerCurrentSession({ allowPromptForUser = true } = {}) {
    if (!session?.name) return { skipped: true };
    const id = getSessionRegistrationId();
    if (!id) return { skipped: true };
    return registerIdentity({
      id,
      name: session.name,
      kind: session.kind,
      guestProfileUserId: session.kind === 'guest' ? session.guestProfileUserId : null,
      productionId: session.productionId,
      allowPrompt: allowPromptForUser,
    });
  }

  function clearReconnectRecovery({ resetAttempt = false } = {}) {
    if (reconnectRecoveryTimer) {
      clearTimeout(reconnectRecoveryTimer);
      reconnectRecoveryTimer = null;
    }
    if (resetAttempt) {
      reconnectRecoveryAttempt = 0;
    }
  }

  function scheduleReconnectRecovery(reason = 'retry') {
    if (sessionResetInProgress || !session?.name) return;
    clearReconnectRecovery();
    const attempt = reconnectRecoveryAttempt++;
    const delay = Math.min(500 * (2 ** attempt), 10000);
    console.warn(`Scheduling session recovery in ${delay} ms (${reason})`);
    reconnectRecoveryTimer = setTimeout(() => {
      reconnectRecoveryTimer = null;
      if (sessionResetInProgress || !session?.name) return;
      if (!socket.connected) {
        socket.connect();
        return;
      }
      recoverConnectedSession(`retry:${reason}`).catch((err) => {
        console.error('Session recovery retry failed:', err);
        scheduleReconnectRecovery('retry-error');
      });
    }, delay);
  }

  function isPermanentGuestRegistrationFailure(result) {
    if (session?.kind !== 'guest') return false;
    return /guest login is disabled|invalid guest profile/i.test(String(result?.error || ''));
  }

  function isPermanentCredentialRegistrationFailure(result) {
    if (session?.kind !== 'user' && session?.kind !== 'feed') return false;
    return /authenticated identity does not match|authenticated account no longer exists/i.test(
      String(result?.error || '')
    );
  }

  async function recoverConnectedSession(reason = 'socket-connect') {
    if (reconnectRecoveryPromise) return reconnectRecoveryPromise;

    const generation = connectionGeneration;
    const recovery = (async () => {
      if (sessionResetInProgress || !socket.connected) return false;

      if (session?.name) {
        const hasIdentity = (session.kind === 'user' && session.userId)
          || (session.kind === 'feed' && session.feedId)
          || isGuestSessionActive();
        if (hasIdentity) {
          const registration = await registerCurrentSession();
          if (generation !== connectionGeneration || !socket.connected) return false;
          if (!registration?.ok) {
            if (registration?.conflict || registration?.cancelled) {
              if (session.kind === 'user') {
                await hardLogoutAndReload(
                  registration.cancelled ? null : 'You are already signed in on another device.',
                  {
                    silent: !!registration.cancelled,
                    notifyServer: !registration.cancelled,
                  }
                );
              }
              return false;
            }
            if (isPermanentGuestRegistrationFailure(registration)) {
              await hardLogoutAndReload('Guest login is no longer available.');
              return false;
            }
            if (isPermanentCredentialRegistrationFailure(registration)) {
              await hardLogoutAndReload('Your login session is no longer valid.');
              return false;
            }
            setSessionDisplay('Reconnecting...', { connectionStatus: true });
            scheduleReconnectRecovery(`registration:${registration?.error || 'failed'}`);
            return false;
          }
          if (session.kind === 'user') {
            applyPersistedTargetAudioStates(registration.targetAudioStates || []);
            if (registration.userAudioSettings) applyUserAudioSettings(registration.userAudioSettings);
            else persistUserAudioSettingsHandler();
          }
          applyRegisteredProductionState(session, registration);
          const registeredProduction = (session.productions || []).find((production) => (
            String(production.id) === String(session.productionId)
          )) || null;
          persistActiveProduction(session, registeredProduction);
          if (session.kind === 'guest') persistGuestSession(session);
          applyProductionSessionUI();
        }
        setSessionDisplay(session.name);
      }

      if (!shouldInitializeAfterConnect && session.name && (session.kind === 'feed' || isOperatorSession())) {
        shouldInitializeAfterConnect = true;
      }

      if (shouldInitializeAfterConnect) {
        try {
          await ensureMediaInitialized();
          if (generation !== connectionGeneration || !socket.connected) return false;
        } catch (err) {
          if (generation !== connectionGeneration) return false;
          console.error(`Media initialization failed during ${reason}:`, err);
          setSessionDisplay('Reconnecting...', { connectionStatus: true });
          scheduleReconnectRecovery('media-initialization');
          return false;
        }
      }

      if (session.kind === 'feed' && !feedManualStop) {
        shouldStartFeedWhenReady = true;
      }
      updateFeedControls();
      if (isOperatorSession()) {
        emitPttState('socket-connect-sync');
      }
      clearReconnectRecovery({ resetAttempt: true });
      previousSocketId = null;
      announceConnectionRecovery();
      return true;
    })();

    reconnectRecoveryPromise = recovery;
    try {
      return await recovery;
    } finally {
      if (reconnectRecoveryPromise === recovery) {
        reconnectRecoveryPromise = null;
      }
    }
  }

  function requestSessionRecovery(reason = 'client-lifecycle') {
    if (sessionResetInProgress || !session?.name) return;
    if (!socket.connected) {
      socket.connect();
      return;
    }
    if (mediaInitialized) return;
    recoverConnectedSession(reason).catch((err) => {
      console.error(`Session recovery failed during ${reason}:`, err);
      scheduleReconnectRecovery(reason);
    });
  }

  function getActiveProductionStorageKey(identity) {
    const id = identity?.kind === 'guest'
      ? identity.guestProfileUserId
      : identity?.id || identity?.userId;
    return id ? `${ACTIVE_PRODUCTION_STORAGE_KEY_PREFIX}${id}` : null;
  }

  function restoreCredentialLoginView(kind = 'user') {
    productionLoginPanel?.classList.add('is-hidden');
    bridgeLoginPanel?.classList.add('is-hidden');
    loginForm?.classList.remove('is-hidden');
    adminLoginLink?.classList.remove('is-hidden');
    if (guestLoginPanel && guestLoginButton) {
      guestLoginButton.disabled = !guestLoginEnabled;
      guestLoginPanel.classList.toggle('is-hidden', !guestLoginEnabled);
    }
  }

  function confirmBridgeBrowserLogin(identity, { skip = false } = {}) {
    if (skip || identity?.kind === 'feed' || !identity?.configuredAsBridge) {
      return Promise.resolve(true);
    }

    loginForm?.classList.add('is-hidden');
    guestLoginPanel?.classList.add('is-hidden');
    productionLoginPanel?.classList.add('is-hidden');
    adminLoginLink?.classList.add('is-hidden');
    bridgeLoginPanel?.classList.remove('is-hidden');

    return new Promise((resolve) => {
      const finish = (confirmed) => {
        bridgeLoginCancel?.removeEventListener('click', cancel);
        bridgeLoginContinue?.removeEventListener('click', proceed);
        bridgeLoginPanel?.classList.add('is-hidden');
        resolve(confirmed);
      };
      const cancel = () => finish(false);
      const proceed = () => finish(true);
      bridgeLoginCancel?.addEventListener('click', cancel, { once: true });
      bridgeLoginContinue?.addEventListener('click', proceed, { once: true });
      bridgeLoginContinue?.focus();
    });
  }

  function chooseProduction(identity, { preferStored = false } = {}) {
    const productions = Array.isArray(identity?.productions) ? identity.productions : [];
    if (productions.length === 0) return Promise.resolve(null);
    if (productions.length === 1) return Promise.resolve(productions[0]);

    if (preferStored) {
      const storageKey = getActiveProductionStorageKey(identity);
      const storedId = storageKey ? localStorage.getItem(storageKey) : null;
      if (storedId === DEFAULT_PRODUCTION_STORAGE_VALUE) return Promise.resolve(productions[0]);
      const stored = productions.find((production) => String(production.id) === String(storedId));
      if (stored) return Promise.resolve(stored);
    }

    loginForm?.classList.add('is-hidden');
    guestLoginPanel?.classList.add('is-hidden');
    productionLoginPanel?.classList.remove('is-hidden');
    adminLoginLink?.classList.add('is-hidden');
    if (productionLoginOptions) {
      productionLoginOptions.innerHTML = '';
    }

    return new Promise((resolve) => {
      const finish = (selection) => {
        productionLoginPanel?.classList.add('is-hidden');
        resolve(selection);
      };
      productions.forEach((production) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = production.name;
        button.addEventListener('click', () => finish(production), { once: true });
        productionLoginOptions?.appendChild(button);
      });
    });
  }

  function applyProductionSessionUI() {
    const productions = Array.isArray(session?.productions) ? session.productions : [];
    if (activeProductionLabelEl) {
      const productionLabel = session.productionName || '';
      activeProductionLabelEl.textContent = productionLabel ? `· ${productionLabel}` : '';
      activeProductionLabelEl.classList.toggle('is-hidden', !productionLabel);
    }
    if (productionSessionSelector && productionSessionSelect) {
      productionSessionSelector.hidden = session.kind === 'feed' || productions.length < 2;
      const options = productions.map((production) => {
        const option = document.createElement('option');
        option.value = String(production.id);
        option.textContent = production.name;
        option.selected = String(production.id) === String(session.productionId);
        return option;
      });
      productionSessionSelect.replaceChildren(...options);
    }
  }

  function persistActiveProduction(identity, production) {
    const storageKey = getActiveProductionStorageKey(identity);
    if (!storageKey) return;
    if (production?.id) localStorage.setItem(storageKey, String(production.id));
    else localStorage.setItem(storageKey, DEFAULT_PRODUCTION_STORAGE_VALUE);
  }

  function applyRegisteredProductionState(targetSession, registration) {
    if (!targetSession || targetSession.kind === 'feed' || !registration?.ok) return;
    if (Array.isArray(registration.productions)) {
      targetSession.productions = registration.productions;
    }
    if (Object.prototype.hasOwnProperty.call(registration, 'productionId')) {
      targetSession.productionId = registration.productionId == null
        ? null
        : String(registration.productionId);
    }
    const activeProduction = (targetSession.productions || []).find((production) => (
      String(production.id) === String(targetSession.productionId)
    ));
    targetSession.productionName = activeProduction?.name || null;
  }

  function reconnectSocketWithBrowserSession({ timeoutMs = 10000 } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        socket.off('connect', handleConnect);
        socket.off('connect_error', handleError);
      };
      const finish = (error = null) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const handleConnect = () => finish();
      const handleError = (error) => finish(error || new Error('Unable to connect'));
      const timer = setTimeout(
        () => finish(new Error('Timed out while applying the login session')),
        timeoutMs
      );

      socket.once('connect', handleConnect);
      socket.once('connect_error', handleError);
      if (socket.connected) socket.disconnect();
      socket.connect();
    });
  }

  async function completeCredentialLogin(user, { preferStoredProduction = false, skipBridgeWarning = false } = {}) {
    const kind = user.kind === 'feed' ? 'feed' : 'user';
    const bridgeLoginConfirmed = await confirmBridgeBrowserLogin(user, { skip: skipBridgeWarning });
    if (!bridgeLoginConfirmed) {
      try {
        await fetch('/api/v1/client/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
      } catch {}
      restoreCredentialLoginView(kind);
      return false;
    }
    const production = kind === 'user'
      ? await chooseProduction(user, { preferStored: preferStoredProduction })
      : null;
    const nextSession = {
      kind,
      userId: kind === 'user' ? String(user.id) : null,
      feedId: kind === 'feed' ? String(user.id) : null,
      productionId: production?.id ? String(production.id) : null,
      productionName: production?.name || null,
      productions: kind === 'user' && Array.isArray(user.productions) ? user.productions : [],
      name: user.name,
    };

    try {
      await reconnectSocketWithBrowserSession();
    } catch (error) {
      console.error('Failed to apply browser login session:', error);
      restoreCredentialLoginView(kind);
      setLoginError('Unable to connect after signing in');
      return false;
    }

    const reg = await registerIdentity({
      id: kind === 'feed' ? nextSession.feedId : nextSession.userId,
      name: nextSession.name,
      kind: nextSession.kind,
      productionId: nextSession.productionId,
      allowPrompt: true,
    });
    if (!reg?.ok) {
      restoreCredentialLoginView(kind);
      if (!reg?.cancelled) setLoginError(reg?.error || "Unable to sign in");
      return false;
    }

    applyRegisteredProductionState(nextSession, reg);

    session = nextSession;
    feedManualStop = false;
    shouldStartFeedWhenReady = kind === 'feed';

    if (kind === 'user') {
      applyPersistedTargetAudioStates(reg.targetAudioStates || []);
      if (reg.userAudioSettings) applyUserAudioSettings(reg.userAudioSettings);
      else persistUserAudioSettingsHandler();
    }

    clearStoredGuestSession();
    localStorage.setItem("userName", user.name);
    localStorage.setItem(IDENTITY_KIND_KEY, kind);
    if (kind === 'user') {
      localStorage.setItem("userId", session.userId);
      persistActiveProduction(user, (session.productions || []).find((item) => (
        String(item.id) === String(session.productionId)
      )) || null);
      localStorage.removeItem(FEED_ID_STORAGE_KEY);
    } else {
      localStorage.setItem(FEED_ID_STORAGE_KEY, session.feedId);
      localStorage.removeItem("userId");
    }

    loginContainer.style.display = "none";
    intercomApp.style.display = "flex";
    setSessionDisplay(user.name);
    applyProductionSessionUI();
    applySessionUI();
    await syncOperatorTargetsFromLatestUserList(`login-${kind}`);
    requestInitialMicrophoneAccess({ reason: `login-${kind}` });
    initializeMediaIfPossible();
    return true;
  }

  productionSessionSelect?.addEventListener('change', async () => {
    if (!isOperatorSession()) return;
    const selectedValue = productionSessionSelect.value;
    const production = (session.productions || []).find((item) => String(item.id) === String(selectedValue));
    if (!production) return;
    const nextProductionId = String(production.id);
    if (String(nextProductionId || '') === String(session.productionId || '')) return;

    try {
      handleStopTalking({ preventDefault() {}, currentTarget: null });
    } catch {}
    const result = await new Promise((resolve) => {
      socket.emit('set-active-production', { productionId: nextProductionId }, (payload) => resolve(payload || {}));
    });
    if (!result?.ok) {
      setLoginError(result?.error || 'Unable to change production');
      applyProductionSessionUI();
      return;
    }
    session.productionId = nextProductionId;
    session.productionName = production?.name || null;
    loadedTargetHotkeyStorageKey = null;
    persistActiveProduction(session, production);
    if (session.kind === 'guest') persistGuestSession(session);
    applyProductionSessionUI();
    await renderTargetList(cachedUsers);
  });

  function consumeLoginTokenFromHash() {
    const hash = window.location.hash;
    if (!hash.startsWith('#login=')) return null;

    const token = new URLSearchParams(hash.slice(1)).get('login')?.trim() || null;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return token;
  }

  const loginToken = consumeLoginTokenFromHash();

  function consumeGuestLoginIntentFromHash() {
    if (window.location.hash !== '#guest') return false;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return true;
  }

  const guestLoginRequested = consumeGuestLoginIntentFromHash();

  function clearStoredCredentialIdentity() {
    localStorage.removeItem("userId");
    localStorage.removeItem(FEED_ID_STORAGE_KEY);
    localStorage.removeItem("userName");
    localStorage.removeItem(IDENTITY_KIND_KEY);
  }

  async function fetchLoginIdentity(url, options = {}) {
    const response = await fetch(url, options);
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error || `Login request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function restoreStoredGuestLogin(storedGuestSession) {
    if (!storedGuestSession) return false;
    session = storedGuestSession;
    console.log("Auto-login Guest:", storedGuestSession.name);
    loginContainer.style.display = "none";
    intercomApp.style.display = "flex";
    setSessionDisplay(storedGuestSession.name);
    applyProductionSessionUI();
    applySessionUI();
    shouldInitializeAfterConnect = true;
    requestSessionRecovery('auto-login-guest');
    requestInitialMicrophoneAccess({ reason: 'auto-login-guest' });
    return true;
  }

  async function bootstrapLogin() {
    await loadLoginOptions();

    if (guestLoginRequested) {
      clearStoredIdentity();
      if (!guestLoginEnabled) {
        setLoginError('Guest login is not available');
      }
      return;
    }

    if (loginToken) {
      clearStoredIdentity();
      setLoginError("");
      try {
        const user = await fetchLoginIdentity('/login/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: loginToken }),
        });
        await completeCredentialLogin(user);
      } catch (err) {
        setLoginError(err?.message || 'Unable to use this login link');
        console.error('Login link failed:', err);
      }
      return;
    }

    try {
      const browserIdentity = await fetchLoginIdentity('/login/session');
      if (browserIdentity) {
        await completeCredentialLogin(browserIdentity, { preferStoredProduction: true, skipBridgeWarning: true });
        return;
      }
    } catch (err) {
      console.warn('Unable to restore browser login session:', err);
    }

    if (ssoLoginEnabled) {
      try {
        const ssoIdentity = await fetchLoginIdentity('/login/sso', { method: 'POST' });
        if (ssoIdentity) {
          await completeCredentialLogin(ssoIdentity, { preferStoredProduction: true });
          return;
        }
      } catch (err) {
        console.warn('Trusted-header SSO login failed:', err);
      }
    }

    const storedGuestSession = loadStoredGuestSession();
    clearStoredCredentialIdentity();
    restoreStoredGuestLogin(storedGuestSession);
  }

  bootstrapLogin()
    .catch((err) => {
      console.error('Login initialization failed:', err);
      setLoginError('Unable to initialize login');
    })
    .finally(() => focusLoginNameField());

  // Login Handler
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("login-username").value;
    const password = document.getElementById("login-password").value;

    setLoginError("");

    try {
      const res = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });

      if (!res.ok) {
        setLoginError("Invalid username or password");
        return;
      }

      const user = await res.json();
      console.log("Logged in as:", user);

      await completeCredentialLogin(user);
    } catch (err) {
      setLoginError("Error logging in");
      console.error("Login failed:", err);
    }
  });

  guestLoginButton?.addEventListener('click', async () => {
    setLoginError("");
    guestLoginButton.disabled = true;
    try {
      const requestedName = guestDisplayNameInput?.value?.trim() || '';
      const res = await fetch('/login/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: requestedName }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoginError(payload?.error || "Guest login is not available");
        return;
      }

      const production = await chooseProduction({
        kind: 'guest',
        guestProfileUserId: payload.guestProfileUserId,
        productions: payload.productions,
      });

      const nextSession = {
        kind: 'guest',
        userId: null,
        feedId: null,
        guestId: String(payload.guestId || ''),
        guestProfileUserId: String(payload.guestProfileUserId || ''),
        productionId: production?.id ? String(production.id) : null,
        productionName: production?.name || null,
        productions: Array.isArray(payload.productions) ? payload.productions : [],
        name: payload.name || 'Guest',
      };

      const reg = await registerIdentity({
        id: nextSession.guestId,
        name: nextSession.name,
        kind: 'guest',
        guestProfileUserId: nextSession.guestProfileUserId,
        productionId: nextSession.productionId,
        allowPrompt: false,
      });
      if (!reg?.ok) {
        restoreCredentialLoginView('guest');
        setLoginError(reg?.error || "Unable to sign in as Guest");
        clearStoredGuestSession();
        return;
      }

      applyRegisteredProductionState(nextSession, reg);

      session = nextSession;
      feedManualStop = false;
      shouldStartFeedWhenReady = false;
      clearStoredPersistentIdentity();
      persistGuestSession(nextSession);
      persistActiveProduction(nextSession, (nextSession.productions || []).find((item) => (
        String(item.id) === String(nextSession.productionId)
      )) || null);

      loginContainer.style.display = "none";
      intercomApp.style.display = "flex";
      setSessionDisplay(nextSession.name);
      applyProductionSessionUI();
      applySessionUI();
      await syncOperatorTargetsFromLatestUserList('login-guest');
      requestInitialMicrophoneAccess({ reason: 'login-guest' });
      initializeMediaIfPossible();
    } catch (err) {
      setLoginError("Error logging in as Guest");
      console.error("Guest login failed:", err);
      restoreCredentialLoginView('guest');
    } finally {
      if (!isGuestSessionActive()) {
        guestLoginButton.disabled = false;
      }
    }
  });

  async function handleLogoutClick() {
    sessionResetInProgress = true;
    if (session.kind === 'feed') {
      stopFeedStream({ manual: true });
    }
    await notifyServerLogoutAndDisconnect();
    clearStoredIdentity();
    location.reload();
  }

  // Logout Handler
  logoutBtn?.addEventListener("click", handleLogoutClick);
  feedLogoutBtn?.addEventListener("click", handleLogoutClick);

  feedStreamToggle?.addEventListener('click', () => {
    if (session.kind !== 'feed') return;
    if (feedStreaming) {
      stopFeedStream({ manual: true });
    } else {
      feedManualStop = false;
      startFeedStream({ manual: true }).catch(err => console.error('Failed to start feed', err));
    }
  });

  // Signaling Events
  const connectionHealth = createConnectionHealth(socket, (interrupted) => {
    mediaConnectionState.heartbeatInterrupted = interrupted;
    renderMediaConnectionStatus();
    if (sessionResetInProgress || !session.name) return;
    if (interrupted) connectionSounds.disconnected();
    else announceConnectionRecovery();
  }, { isPaused: () => document.visibilityState === 'hidden' });
  if (socket.connected) connectionHealth.start();

  socket.on("connect", async () => {
    console.log("Connected to signaling server as", socket.id);
    setSignalingConnectionState('connected');
    connectionHealth.start();
    lastConnectedSocketId = socket.id;
    await recoverConnectedSession('socket-connect');
  });

  socket.on("session-kicked", () => {
    hardLogoutAndReload("You were signed out because you signed in somewhere else.", {
      notifyServer: false,
    });
  });

  socket.on("disconnect", (reason) => {
    connectionHealth.stop();
    console.log("Disconnected from server:", reason);
    if (!sessionResetInProgress && session.name && reason !== 'io client disconnect') {
      connectionSounds.disconnected();
    }
    setSignalingConnectionState('disconnected');
    previousSocketId = lastConnectedSocketId;
    lastConnectedSocketId = null;
    connectionGeneration += 1;
    clearReconnectRecovery();
    activeRegistrationPromise = null;
    activeRegistrationKey = null;
    reconnectRecoveryPromise = null;
    setSessionDisplay('Disconnected', { connectionStatus: true });
    pendingOfflineUserTimers.forEach((timerId) => clearTimeout(timerId));
    pendingOfflineUserTimers.clear();
    latestServerUsers = [];
    incomingTalkState = { addressedNow: [], replyTarget: null };
    speakingPeers.clear();
    activeFeedKeys.clear();
    clearReplyTarget();
    setReplyButtonActive(false);
    // Disable all user buttons
    document
      .querySelectorAll(".talk-user")
      .forEach((btn) => (btn.disabled = true));

    stopTalkingSafely();
    clearLockState();

    if (streamPruneInterval) {
      clearInterval(streamPruneInterval);
      streamPruneInterval = null;
    }
    stopActiveProducerSync();
    activeProducersSyncInFlight = false;
    cleanupAllIncomingStreams({ suppressUi: true });
    document.querySelectorAll('#targets-list li.target-item').forEach(li => {
      li.classList.remove('talking-to', 'speaking');
      li.querySelector('.user-icon')?.classList.remove('speaking');
      li.querySelector('.conf-icon')?.classList.remove('speaking');
      li.querySelector('.feed-icon')?.classList.remove('speaking');
    });
    clearReplyTarget();

    closeMediaTransportState();
    pendingProducerQueue.length = 0;

    if (session.kind === 'feed') {
      feedStreaming = false;
      if (!feedManualStop) {
        shouldStartFeedWhenReady = true;
      }
      updateFeedControls();
    }

    if (!sessionResetInProgress && session?.name && reason === 'io server disconnect') {
      setTimeout(() => socket.connect(), 500);
    }
  });

  socket.on("connect_error", (error) => {
    console.warn("Unable to connect to signaling server:", error?.message || error);
    setSignalingConnectionState('failed');
  });

  socket.on("user-list", async users => {
    const displayUsers = prepareDisplayUsersWithOfflineGrace(users);
    if (isOperatorSession()) {
      await applyUserListToUi(displayUsers);
    }
  });

  socket.on("conference-list", (conferences = []) => {
    conferenceLabels.clear();
    if (Array.isArray(conferences)) {
      conferences.forEach((conference) => {
        const id = Number(conference?.id);
        if (!Number.isFinite(id)) return;
        conferenceLabels.set(id, conference?.name || String(id));
      });
    }
    refreshLastTargetLabel();
    applyIncomingTalkState();
  });

  socket.on('incoming-talk-state', ({ state } = {}) => {
    if (!isOperatorSession()) return;
    incomingTalkState = normalizeIncomingTalkState(state);
    applyIncomingTalkState();
    const addressedNow = Array.isArray(incomingTalkState.addressedNow)
      ? incomingTalkState.addressedNow
      : [];
    if (mediaInitialized && socket.connected && addressedNow.length > 0) {
      requestActiveProducers()
        .then(() => recoverExistingIncomingPlayback())
        .catch((err) => console.error('Failed to sync active producers after incoming talk state', err));
    }
  });

  socket.on('user-targets-updated', async () => {
    if (!isOperatorSession()) return;
    if (cachedUsers.length) {
      await renderTargetList(cachedUsers);
    }
    requestActiveProducers().catch(() => {});
  });

  socket.on('active-production-reset', async ({ productionId = null } = {}) => {
    if (!isOperatorSession()) return;
    try {
      handleStopTalking({ preventDefault() {}, currentTarget: null });
    } catch {}
    session.productionId = productionId == null ? null : String(productionId);
    session.productionName = (session.productions || []).find((production) => (
      String(production.id) === String(session.productionId)
    ))?.name || null;
    loadedTargetHotkeyStorageKey = null;
    persistActiveProduction(session, (session.productions || []).find((production) => (
      String(production.id) === String(session.productionId)
    )) || null);
    if (session.kind === 'guest') persistGuestSession(session);
    applyProductionSessionUI();
    if (cachedUsers.length) await renderTargetList(cachedUsers);
  });

  socket.on('available-productions-updated', ({ productions = [] } = {}) => {
    if (!isOperatorSession()) return;
    session.productions = Array.isArray(productions) ? productions : [];
    const activeProduction = session.productions.find((production) => (
      String(production.id) === String(session.productionId)
    ));
    if (activeProduction) session.productionName = activeProduction.name || null;
    if (session.kind === 'guest') persistGuestSession(session);
    applyProductionSessionUI();
  });

  socket.on('conference-members-updated', async ({ conferenceId = null } = {}) => {
    if (!isOperatorSession() || !cachedUsers.length) return;
    const numericConferenceId = conferenceId == null ? null : Number(conferenceId);
    const conferenceIsVisible = numericConferenceId === null
      || !Number.isFinite(numericConferenceId)
      || cachedOperatorTargets?.some((target) => (
        target?.targetType === 'conference'
        && Number(target.targetId) === numericConferenceId
      ));
    if (!conferenceIsVisible) return;
    await renderTargetList(cachedUsers, { membershipUpdateOnly: true });
  });

  function resolveApiUserTargetSocketId(rawTargetId) {
    const numericId = Number(rawTargetId);
    const user = cachedUsers.find(u => Number(u.userId) === numericId);
    if (!user || !user.socketId) {
      return null;
    }
    return user.socketId;
  }

  function resolveApiTalkTarget(targetType, targetId) {
    if (targetType === 'user') {
      const socketId = resolveApiUserTargetSocketId(targetId);
      if (!socketId) {
        console.warn('Talk command: target user not available', targetId);
        return null;
      }
      return { type: 'user', id: socketId };
    }

    if (targetType === 'reply') {
      if (!lastTarget) {
        console.warn('Talk command: no last target for reply');
        return null;
      }
      return { type: lastTarget.type, id: lastTarget.id };
    }

    if (targetType === 'conference') {
      return { type: 'conference', id: Number(targetId) };
    }

    return null;
  }

  function resolveApiAudioTarget(targetType, targetId) {
    const normalizedType = typeof targetType === 'string' ? targetType.trim().toLowerCase() : '';
    const numericId = Number(targetId);
    let targetKey = null;
    let volumeStorageKey = null;

    if (normalizedType === 'user') {
      const socketId = resolveApiUserTargetSocketId(targetId);
      if (!socketId) {
        console.warn('Target audio command: target user not available', targetId);
        return null;
      }
      targetKey = `user-${socketId}`;
      volumeStorageKey = `volume_user_${numericId}`;
    } else if (normalizedType === 'conference' && Number.isFinite(numericId)) {
      targetKey = `conf-${numericId}`;
      volumeStorageKey = `volume_conf_${numericId}`;
    } else if (normalizedType === 'feed' && Number.isFinite(numericId)) {
      targetKey = `feed-${numericId}`;
      volumeStorageKey = `volume_feed_${numericId}`;
    } else {
      return null;
    }

    if (!document.getElementById(targetKey)) {
      console.warn('Target audio command: target not available in current UI', targetType, targetId);
      return null;
    }

    return { targetKey, volumeStorageKey, targetType: normalizedType, targetId: numericId };
  }

  function resolveCompanionTargetAudioStateFromKey(key) {
    if (typeof key !== 'string' || !key) return null;
    const normalizeCompanionVolume = (rawVolume) => {
      const numericVolume = Number(rawVolume);
      if (!Number.isFinite(numericVolume)) return defaultVolume;
      return Math.max(0, Math.min(1, numericVolume));
    };
    const readVisibleTargetVolume = (targetKey, volumeStorageKey) => {
      const targetEl = document.getElementById(targetKey);
      const sliderValue = Number(targetEl?.querySelector('.volume-slider')?.value);
      if (Number.isFinite(sliderValue)) {
        return normalizeCompanionVolume(sliderValue);
      }
      return normalizeCompanionVolume(getStoredVolume(volumeStorageKey));
    };

    if (key.startsWith('conf-')) {
      const targetId = Number(key.slice(5));
      if (!Number.isFinite(targetId)) return null;
      return {
        targetType: 'conference',
        targetId,
        muted: mutedPeers.has(key),
        volume: readVisibleTargetVolume(key, `volume_conf_${targetId}`),
      };
    }

    if (key.startsWith('feed-')) {
      const targetId = Number(key.slice(5));
      if (!Number.isFinite(targetId)) return null;
      return {
        targetType: 'feed',
        targetId,
        muted: mutedPeers.has(key),
        volume: readVisibleTargetVolume(key, `volume_feed_${targetId}`),
      };
    }

    if (key.startsWith('user-')) {
      const rawUserKey = key.slice(5);
      const user = cachedUsers.find((entry) => String(entry.socketId) === rawUserKey || String(entry.userId) === rawUserKey);
      const targetId = Number(user?.userId ?? rawUserKey);
      if (!Number.isFinite(targetId)) return null;
      return {
        targetType: 'user',
        targetId,
        muted: mutedPeers.has(key),
        volume: readVisibleTargetVolume(key, `volume_user_${targetId}`),
      };
    }

    return null;
  }

function collectVisibleTargetAudioStates() {
  const list = document.getElementById('targets-list');
  if (!list) return [];

    const seen = new Set();
    const states = [];
    list.querySelectorAll('li.target-item').forEach((targetEl) => {
      const key = targetEl?.id;
      const state = resolveCompanionTargetAudioStateFromKey(key);
      if (!state) return;
      const dedupeKey = `${state.targetType}:${state.targetId}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      states.push(state);
    });
  return states;
}

function updateCompactSessionBarMode(targetCount = null) {
  if (typeof document === 'undefined') return;
  const count = Number.isFinite(targetCount)
    ? targetCount
    : document.querySelectorAll('#targets-list li.target-item').length;
  const isSmallViewport = typeof window !== 'undefined'
    ? (window.innerWidth <= 430 || window.innerHeight <= 720)
    : false;
  const shouldCompact = isOperatorSession() && isSmallViewport && count >= 6;
  document.body.classList.toggle('compact-session-bar', shouldCompact);
}

function getMobileTargetLayerSize() {
  if (typeof window === 'undefined') return MOBILE_TARGET_LAYER_DEFAULT_SIZE;
  if (isPhoneLandscapeViewport()) {
    return MOBILE_TARGET_LAYER_LANDSCAPE_SIZE;
  }
  return window.innerWidth <= MOBILE_TARGET_LAYER_COMPACT_MAX_WIDTH
    ? MOBILE_TARGET_LAYER_COMPACT_SIZE
    : MOBILE_TARGET_LAYER_DEFAULT_SIZE;
}

function isPhoneLandscapeViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(orientation: landscape) and (pointer: coarse) and (max-height: 520px)').matches;
}

function getDynamicTargetLayerSize(list, targetEls) {
  if (typeof window === 'undefined' || !list || !Array.isArray(targetEls) || !targetEls.length) {
    return null;
  }

  const hasFinePointer = typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: fine)').matches
    : false;
  if (!hasFinePointer) {
    return null;
  }

  const probeTarget = targetEls.find((targetEl) => targetEl.getBoundingClientRect().height > 0) || null;
  if (!probeTarget) {
    return null;
  }

  const rect = probeTarget.getBoundingClientRect();
  const styles = window.getComputedStyle(probeTarget);
  const marginTop = parseFloat(styles.marginTop || '0');
  const marginBottom = parseFloat(styles.marginBottom || '0');
  const fullItemHeight = rect.height + marginTop + marginBottom;
  const availableHeight = list.clientHeight;

  if (!Number.isFinite(fullItemHeight) || fullItemHeight <= 0 || !Number.isFinite(availableHeight) || availableHeight <= 0) {
    return null;
  }

  const fittedCount = Math.floor(availableHeight / fullItemHeight);
  return fittedCount > 0 ? fittedCount : null;
}

function getTargetLayerSize(list, targetEls) {
  const baseLayerSize = getMobileTargetLayerSize();
  const dynamicLayerSize = getDynamicTargetLayerSize(list, targetEls);
  if (!Number.isFinite(dynamicLayerSize)) {
    return baseLayerSize;
  }
  return Math.max(baseLayerSize, dynamicLayerSize);
}

function updateTargetLayerControls() {
  if (typeof document === 'undefined') return;

  const list = document.getElementById('targets-list');
  if (!list || !targetLayerSwitcher || !targetLayerButton) {
    return;
  }

  const targetEls = Array.from(list.querySelectorAll('li.target-item'));
  const isMobileViewport = typeof window !== 'undefined'
    && (window.innerWidth <= MOBILE_TARGET_LAYER_MAX_WIDTH || isPhoneLandscapeViewport());
  const layerSize = getTargetLayerSize(list, targetEls);
  const shouldPaginate = isOperatorSession()
    && isMobileViewport
    && targetEls.length > layerSize;

  if (!shouldPaginate) {
    currentTargetLayerIndex = 0;
    targetEls.forEach((targetEl) => {
      targetEl.dataset.layer = '0';
      targetEl.classList.remove('layer-hidden');
    });
    list.dataset.activeLayer = '0';
    targetLayerButton.textContent = 'Layer 1/1';
    targetLayerButton.setAttribute('aria-label', 'Only one target layer');
    targetLayerSwitcher.hidden = true;
    return;
  }

  const layerCount = Math.max(1, Math.ceil(targetEls.length / layerSize));
  if (currentTargetLayerIndex >= layerCount) {
    currentTargetLayerIndex = layerCount - 1;
  }
  if (currentTargetLayerIndex < 0) {
    currentTargetLayerIndex = 0;
  }

  targetEls.forEach((targetEl, index) => {
    const layerIndex = Math.floor(index / layerSize);
    targetEl.dataset.layer = String(layerIndex);
    targetEl.classList.toggle('layer-hidden', layerIndex !== currentTargetLayerIndex);
  });

  list.dataset.activeLayer = String(currentTargetLayerIndex);
  targetLayerButton.textContent = `Layer ${currentTargetLayerIndex + 1}/${layerCount}`;
  targetLayerButton.setAttribute('aria-label', `Switch target layer, current layer ${currentTargetLayerIndex + 1} of ${layerCount}`);
  targetLayerSwitcher.hidden = false;
}

function setTargetLayer(nextIndex) {
  const list = document.getElementById('targets-list');
  if (!list) return;
  const targetEls = Array.from(list.querySelectorAll('li.target-item'));
  const layerSize = getTargetLayerSize(list, targetEls);
  const layerCount = Math.max(1, Math.ceil(targetEls.length / layerSize));
  if (layerCount <= 1) return;

  const parsedIndex = Number(nextIndex);
  const normalizedIndex = Number.isFinite(parsedIndex)
    ? Math.max(0, Math.min(layerCount - 1, parsedIndex))
    : 0;
  if (normalizedIndex === currentTargetLayerIndex) return;

  currentTargetLayerIndex = normalizedIndex;
  updateTargetLayerControls();
  schedulePttButtonSizing();
  list.scrollTop = 0;
}

function advanceTargetLayer() {
  const list = document.getElementById('targets-list');
  if (!list) return;
  const targetEls = Array.from(list.querySelectorAll('li.target-item'));
  const layerSize = getTargetLayerSize(list, targetEls);
  const layerCount = Math.max(1, Math.ceil(targetEls.length / layerSize));
  if (layerCount <= 1) return;

  const nextIndex = (currentTargetLayerIndex + 1) % layerCount;
  setTargetLayer(nextIndex);
}

function emitTargetAudioStateSnapshot(reason = 'target-audio-state') {
  if (session.kind !== 'user') return;
  if (!socket.connected) return;
    socket.emit('target-audio-state-snapshot', {
      reason,
      states: collectVisibleTargetAudioStates(),
    });
  }

  function applyRemoteAudioCommand(action, targetType, targetId, step) {
    const targetConfig = resolveApiAudioTarget(targetType, targetId);
    if (!targetConfig) {
      return { ok: false, reason: 'target-not-available' };
    }

    if (action === 'volume-up' || action === 'volume-down') {
      const requestedStep = Number(step);
      const normalizedStep = Number.isFinite(requestedStep) ? requestedStep : 0.1;
      const volumeStep = Math.max(0.01, Math.min(1, normalizedStep));
      const signedStep = action === 'volume-up' ? volumeStep : -volumeStep;
      const currentVolume = getStoredVolume(targetConfig.volumeStorageKey);
      const nextVolume = Math.max(0, Math.min(1, currentVolume + signedStep));
      setTargetVolumeAndPersist(targetConfig.targetKey, targetConfig.volumeStorageKey, nextVolume, {
        targetType: targetConfig.targetType,
        targetId: targetConfig.targetId,
        muted: mutedPeers.has(targetConfig.targetKey),
      });
      return { ok: true };
    }

    if (action === 'mute-toggle') {
      setMuteState(targetConfig.targetKey);
      return { ok: true };
    }

    return { ok: false, reason: 'unsupported-action' };
  }

  socket.on('api-talk-command', async ({
    commandId = null,
    action,
    targetType = 'conference',
    targetId = null,
    inputKey = null,
  } = {}) => {
    if (session.kind !== 'user') {
      emitApiTalkCommandResult({
        commandId,
        ok: false,
        reason: 'not-user-session',
        action,
        targetType,
        targetId,
      });
      return;
    }

    const normalizedInputKey = typeof inputKey === 'string' && inputKey.trim()
      ? inputKey.trim()
      : null;
    const dummyEvent = normalizedInputKey
      ? { preventDefault() {}, talkInputKey: normalizedInputKey }
      : { preventDefault() {} };

    try {
      if (action === 'lock-toggle') {
        const target = resolveApiTalkTarget(targetType, targetId);
        if (!target) {
          emitApiTalkCommandResult({
            commandId,
            ok: false,
            reason: 'target-not-available',
            action,
            targetType,
            targetId,
          });
          return;
        }
        toggleTalkLock(target);
        emitApiTalkCommandResult({
          commandId,
          ok: true,
          action,
          targetType,
          targetId,
          target,
        });
        return;
      }

      if (action === 'press') {
        const target = resolveApiTalkTarget(targetType, targetId);
        if (!target) {
          emitApiTalkCommandResult({
            commandId,
            ok: false,
            reason: 'target-not-available',
            action,
            targetType,
            targetId,
          });
          return;
        }
        if (targetType === 'reply') {
          btnReply.classList.add('active');
        }
        await handleTalk(dummyEvent, target);
        const started = Boolean(producer || isTalking);
        emitApiTalkCommandResult({
          commandId,
          ok: started,
          reason: started ? null : 'press-failed',
          action,
          targetType,
          targetId,
          target: started ? target : null,
        });
        return;
      }

      if (action === 'release') {
        if (targetType === 'reply') {
          btnReply.classList.remove('active');
        }
        handleStopTalking(
          normalizedInputKey
            ? { preventDefault() {}, currentTarget: null, talkInputKey: normalizedInputKey }
            : { preventDefault() {}, currentTarget: null }
        );
        emitApiTalkCommandResult({
          commandId,
          ok: true,
          action,
          targetType,
          targetId,
          talking: false,
          lockActive: false,
          target: null,
        });
        return;
      }

      emitApiTalkCommandResult({
        commandId,
        ok: false,
        reason: 'unsupported-action',
        action,
        targetType,
        targetId,
      });
    } catch (err) {
      emitApiTalkCommandResult({
        commandId,
        ok: false,
        reason: err?.message || 'command-error',
        action,
        targetType,
        targetId,
      });
    }
  });

  socket.on('api-target-audio-command', ({ commandId = null, action, targetType = 'conference', targetId = null, step = null } = {}) => {
    if (session.kind !== 'user') {
      emitApiTargetAudioCommandResult({
        commandId,
        ok: false,
        reason: 'not-user-session',
        action,
        targetType,
        targetId,
      });
      return;
    }

    try {
      const result = applyRemoteAudioCommand(action, targetType, targetId, step);
      emitApiTargetAudioCommandResult({
        commandId,
        ok: result.ok,
        reason: result.reason || null,
        action,
        targetType,
        targetId,
      });
    } catch (err) {
      emitApiTargetAudioCommandResult({
        commandId,
        ok: false,
        reason: err?.message || 'command-error',
        action,
        targetType,
        targetId,
      });
    }
  });

  function rebuildUserTargetLabels(users) {
    Array.from(targetLabels.keys()).forEach((key) => {
      if (key.startsWith('user-')) {
        targetLabels.delete(key);
      }
    });
    users.forEach((u) => {
      if (u?.userId != null) {
        targetLabels.set(`user-${u.userId}`, u.name || String(u.userId));
      }
      if (u?.socketId) {
        targetLabels.set(`user-${u.socketId}`, u.name || u.socketId);
      }
    });
  }

  function shouldRenderUserTargetRow(targetIdNum, usersById = null) {
    if (!Number.isFinite(targetIdNum)) return false;
    if (session.userId && Number(session.userId) === targetIdNum) return false;
    const onlineUser = usersById?.get(targetIdNum);
    const targetSocketId = onlineUser?.socketId || null;
    if (targetSocketId && targetSocketId === socket.id) return false;
    return true;
  }

  function buildTalkTargetDescriptors(users = cachedUsers) {
    if (!isOperatorSession()) return [];

    const usersById = new Map();
    (Array.isArray(users) ? users : []).forEach((user) => {
      if (user?.userId == null) return;
      usersById.set(Number(user.userId), user);
    });

    const descriptors = [{
      identity: 'main',
      kind: 'main',
      label: 'Main button',
      kindLabel: 'Action',
    }, {
      identity: REPLY_HOTKEY_IDENTITY,
      kind: 'reply',
      label: 'Reply',
      kindLabel: 'Action',
    }];

    if (!Array.isArray(cachedOperatorTargets)) {
      return descriptors;
    }

    cachedOperatorTargets.forEach((target) => {
      if (!target || typeof target !== 'object') return;

      if (target.targetType === 'user') {
        const targetIdNum = Number(target.targetId);
        if (!shouldRenderUserTargetRow(targetIdNum, usersById)) return;
        const onlineUser = usersById.get(targetIdNum);
        const targetData = { type: 'user', id: targetIdNum };
        descriptors.push({
          identity: getTalkTargetIdentity(targetData),
          kind: 'target',
          target: targetData,
          label: target.name || onlineUser?.name || `User ${targetIdNum}`,
          kindLabel: 'User',
        });
        return;
      }

      if (target.targetType === 'conference' && target.canTalk !== false) {
        const conferenceId = Number(target.targetId);
        const targetData = { type: 'conference', id: conferenceId };
        descriptors.push({
          identity: getTalkTargetIdentity(targetData),
          kind: 'target',
          target: targetData,
          label: target.name || `Conference ${conferenceId}`,
          kindLabel: 'Conference',
        });
      }
    });

    return descriptors.filter((entry) => entry.identity);
  }

  function parseTalkTargetIdentity(identity) {
    const raw = String(identity || '').trim();
    const [type, id] = raw.split(':');
    if ((type !== 'user' && type !== 'conference') || !id) return null;
    const numericId = Number(id);
    return {
      type,
      id: Number.isFinite(numericId) ? numericId : id,
    };
  }

  function getVoiceTriggerTarget() {
    return parseTalkTargetIdentity(voiceTriggerTargetIdentity);
  }

  function updateVoiceTriggerThresholdUI() {
    const threshold = clampVoiceTriggerThresholdDb(voiceTriggerThresholdDb);
    if (voiceTriggerThresholdSlider) {
      voiceTriggerThresholdSlider.value = String(Math.round(threshold));
    }
    if (voiceTriggerThresholdValueDisplay) {
      voiceTriggerThresholdValueDisplay.textContent = formatDbDisplay(threshold);
    }
  }

  function setVoiceTriggerState(state = 'idle') {
    const normalizedState = state === 'triggering'
      ? 'triggering'
      : state === 'armed'
        ? 'armed'
        : 'idle';
    if (voiceTriggerControls) {
      voiceTriggerControls.dataset.triggerState = normalizedState;
      voiceTriggerControls.classList.toggle('is-triggering', normalizedState === 'triggering');
    }
    if (voiceTriggerStatusEl) {
      voiceTriggerStatusEl.dataset.triggerState = normalizedState;
    }
  }

  function updateVoiceTriggerControlsState() {
    const enabledForSession = isOperatorSession() && session.kind !== 'feed';
    if (voiceTriggerControls) {
      voiceTriggerControls.hidden = !enabledForSession;
    }
    if (voiceTriggerToggle) {
      voiceTriggerToggle.checked = enabledForSession && voiceTriggerEnabled;
      voiceTriggerToggle.disabled = !enabledForSession;
    }
    if (voiceTriggerTargetSelect) {
      voiceTriggerTargetSelect.disabled = !enabledForSession;
    }
    if (voiceTriggerThresholdSlider) {
      voiceTriggerThresholdSlider.disabled = !enabledForSession;
    }
    if (!enabledForSession) {
      setVoiceTriggerState('idle');
    } else if (!voiceTriggerEnabled) {
      setVoiceTriggerState('idle');
    } else if (!getVoiceTriggerTarget()) {
      setVoiceTriggerState('idle');
    }
  }

  function updateVoiceTriggerTargetOptions(users = cachedUsers) {
    updateMainButtonOptions();
    if (!voiceTriggerTargetSelect) return;
    if (!Array.isArray(cachedOperatorTargets)) {
      updateVoiceTriggerControlsState();
      return;
    }

    const previousValue = voiceTriggerTargetIdentity || voiceTriggerTargetSelect.value || '';
    const descriptors = buildTalkTargetDescriptors(users)
      .filter((descriptor) => descriptor.kind === 'target' && descriptor.target);
    const validIdentities = new Set(descriptors.map((descriptor) => descriptor.identity));

    voiceTriggerTargetSelect.innerHTML = '';
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'Select target';
    voiceTriggerTargetSelect.appendChild(emptyOption);

    descriptors.forEach((descriptor) => {
      const option = document.createElement('option');
      option.value = descriptor.identity;
      option.textContent = `${descriptor.label} (${descriptor.kindLabel})`;
      voiceTriggerTargetSelect.appendChild(option);
    });

    if (previousValue && validIdentities.has(previousValue)) {
      voiceTriggerTargetIdentity = previousValue;
      voiceTriggerTargetSelect.value = previousValue;
    } else {
      voiceTriggerTargetIdentity = '';
      voiceTriggerTargetSelect.value = '';
    }

    updateVoiceTriggerControlsState();
    if (voiceTriggerEnabled && getVoiceTriggerTarget()) {
      startVoiceTriggerMonitoring();
    }
  }

  function stopVoiceTriggerTalk() {
    if (!voiceTriggerActive) return;
    voiceTriggerActive = false;
    voiceTriggerAboveSince = 0;
    voiceTriggerBelowSince = 0;
    handleStopTalking({
      preventDefault() {},
      currentTarget: null,
      talkInputKey: 'voice-trigger',
      suppressLockRestore: true,
    });
  }

  function stopVoiceTriggerMonitoring({ stopTalk = true } = {}) {
    if (voiceTriggerRafId !== null) {
      cancelAnimationFrame(voiceTriggerRafId);
      voiceTriggerRafId = null;
    }
    voiceTriggerAboveSince = 0;
    voiceTriggerBelowSince = 0;
    if (stopTalk) {
      stopVoiceTriggerTalk();
    } else {
      voiceTriggerActive = false;
    }
    destroyVoiceTriggerMonitorChain();
    if (!settingsMenuOpen) {
      destroyUserMeterMonitorChain();
    }
    if (!settingsMenuOpen && !producer && !isTalking && !pendingTalkStart && micTrack) {
      try { micTrack.enabled = false; } catch {}
      scheduleMicCleanup();
    }
    updateVoiceTriggerControlsState();
  }

  async function startVoiceTriggerMonitoring() {
    if (!voiceTriggerEnabled || !isOperatorSession() || session.kind === 'feed') {
      stopVoiceTriggerMonitoring();
      return;
    }

    updateVoiceTriggerControlsState();
    if (!getVoiceTriggerTarget()) return;
    if (voiceTriggerRafId !== null) return;

    const { constraints, selectedDeviceId } = getCurrentAudioConstraints();
    let track;
    try {
      track = await ensureMicTrack(constraints, selectedDeviceId);
    } catch (err) {
      console.warn('Failed to start level trigger monitoring:', err);
      setVoiceTriggerState('idle');
      return;
    }
    if (!track || !voiceTriggerEnabled) return;

    track.enabled = true;
    if (!audioProcessingEnabled) {
      ensureUserProcessingChain(track);
      ensureUserMeterMonitorChain(track);
      scheduleUserMeterUpdate();
    }

    const tick = () => {
      voiceTriggerRafId = null;
      if (!voiceTriggerEnabled || !isOperatorSession() || session.kind === 'feed') {
        stopVoiceTriggerMonitoring();
        return;
      }

      const target = getVoiceTriggerTarget();
      if (!target) {
        setVoiceTriggerState('idle');
        voiceTriggerRafId = requestAnimationFrame(tick);
        return;
      }
      const liveTarget = resolveLiveTalkTarget(target);
      if (!liveTarget) {
        if (voiceTriggerActive) {
          stopVoiceTriggerTalk();
        }
        setVoiceTriggerState('idle');
        voiceTriggerRafId = requestAnimationFrame(tick);
        return;
      }

      if (!micTrack || micTrack.readyState !== 'live') {
        startVoiceTriggerMonitoring();
        return;
      }

      try { micTrack.enabled = true; } catch {}

      const monitor = ensureVoiceTriggerMonitorChain(micTrack);
      if (!monitor) {
        setVoiceTriggerState('idle');
        voiceTriggerRafId = requestAnimationFrame(tick);
        return;
      }

      const peakDb = getPeakDbFromAnalyser(monitor.analyser, monitor.meterData);
      const now = nowMs();
      const startThreshold = clampVoiceTriggerThresholdDb(voiceTriggerThresholdDb);
      const stopThreshold = Math.max(VOICE_TRIGGER_MIN_DB, startThreshold - VOICE_TRIGGER_HYSTERESIS_DB);

      if (voiceTriggerAdminInhibited) {
        voiceTriggerAboveSince = 0;
        voiceTriggerBelowSince = 0;
        if (!Number.isFinite(peakDb) || peakDb < stopThreshold) {
          voiceTriggerAdminInhibited = false;
        }
        setVoiceTriggerState('armed');
        voiceTriggerRafId = requestAnimationFrame(tick);
        return;
      }

      if (!voiceTriggerActive) {
        if (Number.isFinite(peakDb) && peakDb >= startThreshold) {
          if (!voiceTriggerAboveSince) {
            voiceTriggerAboveSince = now;
          }
          if (
            now - voiceTriggerAboveSince >= VOICE_TRIGGER_ATTACK_MS
            && (!producer || producer.closed || producer.paused)
            && !pendingTalkStart
            && !isTalking
            && !hasActiveTalkLocks()
          ) {
            voiceTriggerActive = true;
            voiceTriggerBelowSince = 0;
            setVoiceTriggerState('triggering');
            handleTalk({
              preventDefault() {},
              currentTarget: null,
              talkInputKey: 'voice-trigger',
            }, liveTarget);
          }
        } else {
          voiceTriggerAboveSince = 0;
          setVoiceTriggerState('armed');
        }
      } else if (!Number.isFinite(peakDb) || peakDb < stopThreshold) {
        if (!voiceTriggerBelowSince) {
          voiceTriggerBelowSince = now;
        }
        if (now - voiceTriggerBelowSince >= VOICE_TRIGGER_RELEASE_MS) {
          stopVoiceTriggerTalk();
          setVoiceTriggerState('armed');
        }
      } else {
        voiceTriggerBelowSince = 0;
        setVoiceTriggerState('triggering');
      }

      voiceTriggerRafId = requestAnimationFrame(tick);
    };

    setVoiceTriggerState('armed');
    voiceTriggerRafId = requestAnimationFrame(tick);
  }

  function setVoiceTriggerEnabled(enabled, { persist = true } = {}) {
    voiceTriggerEnabled = !!enabled && isOperatorSession() && session.kind !== 'feed';
    voiceTriggerAdminInhibited = false;
    if (voiceTriggerToggle) {
      voiceTriggerToggle.checked = voiceTriggerEnabled;
    }
    if (persist && typeof window !== 'undefined') {
      try {
        window.localStorage?.setItem(VOICE_TRIGGER_ENABLED_STORAGE_KEY, String(voiceTriggerEnabled));
      } catch (err) {
        console.warn('Unable to persist level trigger state:', err);
      }
      persistUserAudioSettingsHandler();
    }
    updateVoiceTriggerControlsState();
    if (voiceTriggerEnabled) {
      startVoiceTriggerMonitoring();
    } else {
      stopVoiceTriggerMonitoring();
    }
  }

  function setVoiceTriggerTargetIdentity(identity, { persist = true } = {}) {
    voiceTriggerTargetIdentity = String(identity || '').trim();
    if (voiceTriggerTargetSelect && voiceTriggerTargetSelect.value !== voiceTriggerTargetIdentity) {
      voiceTriggerTargetSelect.value = voiceTriggerTargetIdentity;
    }
    if (persist && typeof window !== 'undefined') {
      try {
        if (voiceTriggerTargetIdentity) {
          window.localStorage?.setItem(VOICE_TRIGGER_TARGET_STORAGE_KEY, voiceTriggerTargetIdentity);
        } else {
          window.localStorage?.removeItem(VOICE_TRIGGER_TARGET_STORAGE_KEY);
        }
      } catch (err) {
        console.warn('Unable to persist level trigger target:', err);
      }
      persistUserAudioSettingsHandler();
    }
    if (voiceTriggerActive) {
      stopVoiceTriggerTalk();
    }
    updateVoiceTriggerControlsState();
  }

  function setVoiceTriggerThresholdDb(dbValue, { persist = true } = {}) {
    voiceTriggerThresholdDb = clampVoiceTriggerThresholdDb(Number(dbValue));
    updateVoiceTriggerThresholdUI();
    if (persist && typeof window !== 'undefined') {
      try {
        window.localStorage?.setItem(VOICE_TRIGGER_THRESHOLD_DB_STORAGE_KEY, String(voiceTriggerThresholdDb));
      } catch (err) {
        console.warn('Unable to persist level trigger threshold:', err);
      }
      persistUserAudioSettingsHandler();
    }
  }

  function currentUserAudioSettings() {
    return {
      audioProfile: qualitySelect?.value || currentQualityKey(),
      dimAmountDb: feedDuckingDb,
      dimFeedsWhileSpeaking: feedDimSelf,
      dimWhenAddressed: feedDimIncoming,
      audioAutoProcessing: audioProcessingEnabled,
      playConnectionSounds: playConnectionSoundsEnabled,
      leftHandMode: leftHandModeEnabled,
      lockMultipleTargets: lockMultipleTargetsEnabled,
      userInputGainDb,
      voiceTriggerEnabled,
      voiceTriggerTarget: voiceTriggerTargetIdentity,
      voiceTriggerThresholdDb,
    };
  }

  let userAudioSettingsSaveTimer = null;
  persistUserAudioSettingsHandler = () => {
    if (session.kind !== 'user' || !socket.connected) return;
    clearTimeout(userAudioSettingsSaveTimer);
    userAudioSettingsSaveTimer = setTimeout(() => {
      socket.emit('user-audio-settings-update', { settings: currentUserAudioSettings() }, (result = {}) => {
        if (!result.ok) console.warn('Unable to save user audio settings:', result.error);
      });
    }, 120);
  };

  function applyUserAudioSettings(value) {
    if (!value || typeof value !== 'object') return;
    const settings = window.TalktomeUserAudioSettings?.resolve
      ? window.TalktomeUserAudioSettings.resolve(value)
      : value;
    const qualityChanged = qualitySelect
      && QUALITY_PROFILES[settings.audioProfile]
      && qualitySelect.value !== settings.audioProfile;
    if (qualityChanged) qualitySelect.value = settings.audioProfile;
    setFeedDuckingDb(Number(settings.dimAmountDb), { persist: false });
    setFeedDimSelf(settings.dimFeedsWhileSpeaking, { persist: false });
    setFeedDimIncoming(settings.dimWhenAddressed, { persist: false });
    setAudioProcessingEnabled(settings.audioAutoProcessing, { persist: false });
    setPlayConnectionSounds(settings.playConnectionSounds, { persist: false });
    setLeftHandMode(settings.leftHandMode, { persist: false });
    setLockMultipleTargets(settings.lockMultipleTargets, { persist: false });
    setUserInputGainDb(Number(settings.userInputGainDb), { persist: false });
    setVoiceTriggerTargetIdentity(settings.voiceTriggerTarget, { persist: false });
    setVoiceTriggerThresholdDb(Number(settings.voiceTriggerThresholdDb), { persist: false });
    setVoiceTriggerEnabled(settings.voiceTriggerEnabled, { persist: false });
    if (qualityChanged) {
      cleanupMicTrack();
      if (voiceTriggerEnabled) startVoiceTriggerMonitoring();
    }
  }

  socket.on('user-audio-settings-updated', ({ settings } = {}) => {
    if (session.kind === 'user') applyUserAudioSettings(settings);
  });

  restartVoiceTriggerMonitorHandler = () => {
    stopVoiceTriggerMonitoring();
    if (voiceTriggerEnabled) {
      startVoiceTriggerMonitoring();
    }
  };

  function rebuildTargetHotkeyAssignments(users = cachedUsers) {
    ensureCustomTargetHotkeysLoaded();
    targetHotkeys.clear();
    targetHotkeysByTarget.clear();
    hotkeyBindingElements.clear();

    const descriptors = buildTalkTargetDescriptors(users);
    const claimedBindingIds = new Set();

    descriptors.forEach((descriptor) => {
      const customBinding = customTargetHotkeys.get(descriptor.identity);
      if (!customBinding || claimedBindingIds.has(customBinding.id)) return;
      claimedBindingIds.add(customBinding.id);
      targetHotkeys.set(customBinding.id, {
        kind: descriptor.kind || 'target',
        target: descriptor.target,
        binding: customBinding,
        identity: descriptor.identity,
      });
      targetHotkeysByTarget.set(descriptor.identity, customBinding);
    });

    let defaultIndex = 0;
    descriptors.forEach((descriptor) => {
      if (targetHotkeysByTarget.has(descriptor.identity)) return;
      if (descriptor.kind === 'reply' || descriptor.kind === 'main') {
        if (claimedBindingIds.has(DEFAULT_REPLY_HOTKEY_BINDING.id)) {
          const existing = targetHotkeys.get(DEFAULT_REPLY_HOTKEY_BINDING.id);
          if (descriptor.kind === 'reply' && existing?.kind === 'main'
            && !customTargetHotkeys.has('main')) {
            targetHotkeysByTarget.set(descriptor.identity, DEFAULT_REPLY_HOTKEY_BINDING);
          }
          return;
        }
        claimedBindingIds.add(DEFAULT_REPLY_HOTKEY_BINDING.id);
        targetHotkeys.set(DEFAULT_REPLY_HOTKEY_BINDING.id, {
          kind: descriptor.kind,
          target: null,
          binding: DEFAULT_REPLY_HOTKEY_BINDING,
          identity: descriptor.identity,
        });
        targetHotkeysByTarget.set(descriptor.identity, DEFAULT_REPLY_HOTKEY_BINDING);
        return;
      }
      while (
        defaultIndex < DEFAULT_TARGET_HOTKEY_BINDINGS.length
        && claimedBindingIds.has(DEFAULT_TARGET_HOTKEY_BINDINGS[defaultIndex].id)
      ) {
        defaultIndex += 1;
      }
      if (defaultIndex >= DEFAULT_TARGET_HOTKEY_BINDINGS.length) return;
      const defaultBinding = DEFAULT_TARGET_HOTKEY_BINDINGS[defaultIndex];
      defaultIndex += 1;
      claimedBindingIds.add(defaultBinding.id);
      targetHotkeys.set(defaultBinding.id, {
        kind: descriptor.kind || 'target',
        target: descriptor.target,
        binding: defaultBinding,
        identity: descriptor.identity,
      });
      targetHotkeysByTarget.set(descriptor.identity, defaultBinding);
    });

    return descriptors;
  }

  function findRenderedTargetRow(target) {
    const normalizedTarget = normalizePttTarget(target);
    if (!normalizedTarget) return null;
    if (normalizedTarget.type === 'conference') {
      return document.getElementById(`conf-${normalizedTarget.id}`);
    }
    if (normalizedTarget.type === 'user') {
      return document.querySelector(`.user-target[data-id="${String(normalizedTarget.id)}"]`);
    }
    return null;
  }

  function syncRenderedHotkeyBindings(users = cachedUsers) {
    hotkeyBindingElements.clear();
    document.querySelectorAll('.target-item').forEach((row) => {
      delete row.dataset.hotkeyId;
      delete row.dataset.hotkey;
      row.classList.remove('hotkey-active');
    });

    buildTalkTargetDescriptors(users).forEach((descriptor) => {
      if (descriptor.kind !== 'target') return;
      const binding = targetHotkeysByTarget.get(descriptor.identity);
      if (!binding) return;
      const row = findRenderedTargetRow(descriptor.target);
      if (!row) return;
      row.dataset.hotkeyId = binding.id;
      row.dataset.hotkey = binding.label;
      row.classList.toggle('hotkey-active', pressedHotkeyBindings.has(binding.id));
      hotkeyBindingElements.set(binding.id, row);
    });
  }

  function stopHotkeyCapture({ rerender = true } = {}) {
    if (!activeHotkeyCaptureTargetIdentity) return;
    activeHotkeyCaptureTargetIdentity = null;
    if (rerender) {
      renderTargetHotkeySettings(cachedUsers);
    }
  }

  function setCustomHotkeyForTarget(targetIdentity, binding) {
    if (!targetIdentity || !binding) return;
    ensureCustomTargetHotkeysLoaded();
    Array.from(customTargetHotkeys.entries()).forEach(([existingIdentity, existingBinding]) => {
      if (existingIdentity === targetIdentity) return;
      if (existingBinding?.id !== binding.id) return;
      customTargetHotkeys.delete(existingIdentity);
    });
    customTargetHotkeys.set(targetIdentity, binding);
    persistCustomTargetHotkeys();
    stopHotkeyCapture({ rerender: false });
    refreshTargetHotkeyUi(cachedUsers);
  }

  function clearCustomHotkeyForTarget(targetIdentity) {
    if (!targetIdentity || !customTargetHotkeys.has(targetIdentity)) return;
    customTargetHotkeys.delete(targetIdentity);
    persistCustomTargetHotkeys();
    stopHotkeyCapture({ rerender: false });
    refreshTargetHotkeyUi(cachedUsers);
  }

  function resetCustomTargetHotkeys() {
    if (customTargetHotkeys.size === 0) return;
    customTargetHotkeys.clear();
    persistCustomTargetHotkeys();
    stopHotkeyCapture({ rerender: false });
    refreshTargetHotkeyUi(cachedUsers);
  }

  function renderTargetHotkeySettings(users = cachedUsers) {
    if (!shortcutSettingsSection || !shortcutSettingsList || !shortcutSettingsEmpty) return;

      const shouldShow = isOperatorSession();
    shortcutSettingsSection.hidden = !shouldShow;
    if (!shouldShow) return;

    const descriptors = buildTalkTargetDescriptors(users);
    if (
      activeHotkeyCaptureTargetIdentity
      && !descriptors.some((descriptor) => descriptor.identity === activeHotkeyCaptureTargetIdentity)
    ) {
      activeHotkeyCaptureTargetIdentity = null;
    }
    shortcutSettingsList.innerHTML = '';
    if (shortcutResetButton) {
      shortcutResetButton.disabled = customTargetHotkeys.size === 0;
    }

    if (descriptors.length === 0) {
      shortcutSettingsEmpty.hidden = false;
      shortcutSettingsEmpty.textContent = 'No talk targets available yet.';
      return;
    }

    shortcutSettingsEmpty.hidden = true;

    descriptors.forEach((descriptor) => {
      const { identity, label, kindLabel } = descriptor;
      const binding = targetHotkeysByTarget.get(identity) || null;
      const isCustom = customTargetHotkeys.has(identity);
      const isRecording = activeHotkeyCaptureTargetIdentity === identity;

      const row = document.createElement('div');
      row.className = 'shortcut-settings__row';

      const targetInfo = document.createElement('div');
      targetInfo.className = 'shortcut-settings__target';

      const nameEl = document.createElement('span');
      nameEl.className = 'shortcut-settings__target-name';
      nameEl.textContent = label;
      targetInfo.appendChild(nameEl);

      const typeEl = document.createElement('span');
      typeEl.className = 'shortcut-settings__target-type';
      typeEl.textContent = kindLabel;
      targetInfo.appendChild(typeEl);

      const bindingWrap = document.createElement('div');
      bindingWrap.className = 'shortcut-settings__binding-wrap';

      const bindingEl = document.createElement('span');
      bindingEl.className = 'shortcut-settings__binding';
      if (isRecording) {
        bindingEl.classList.add('is-recording');
      } else if (isCustom) {
        bindingEl.classList.add('is-custom');
      }
      bindingEl.textContent = isRecording ? 'Press key…' : (binding?.label || 'None');
      bindingWrap.appendChild(bindingEl);

      const bindingMeta = document.createElement('span');
      bindingMeta.className = 'shortcut-settings__binding-meta';
      if (isRecording) {
        bindingMeta.hidden = true;
      } else if (isCustom) {
        bindingMeta.textContent = 'Custom';
      } else if (binding) {
        bindingMeta.textContent = 'Default';
      } else {
        bindingMeta.textContent = 'No default';
      }
      bindingWrap.appendChild(bindingMeta);

      const actions = document.createElement('div');
      actions.className = 'shortcut-settings__actions';

      const assignBtn = document.createElement('button');
      assignBtn.type = 'button';
      assignBtn.className = 'shortcut-settings__button';
      if (isRecording) {
        assignBtn.classList.add('is-recording');
      }
      assignBtn.textContent = isRecording ? 'Cancel' : 'Set key';
      assignBtn.addEventListener('click', () => {
        activeHotkeyCaptureTargetIdentity = isRecording ? null : identity;
        renderTargetHotkeySettings(cachedUsers);
      });
      actions.appendChild(assignBtn);

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'shortcut-settings__button shortcut-settings__button--secondary';
      resetBtn.textContent = 'Default';
      resetBtn.disabled = !isCustom;
      resetBtn.addEventListener('click', () => {
        clearCustomHotkeyForTarget(identity);
      });
      actions.appendChild(resetBtn);

      row.append(targetInfo, bindingWrap, actions);
      shortcutSettingsList.appendChild(row);
    });
  }

  function refreshTargetHotkeyUi(users = cachedUsers) {
    rebuildTargetHotkeyAssignments(users);
    syncRenderedHotkeyBindings(users);
    renderTargetHotkeySettings(users);
  }

  stopHotkeyCaptureHandler = stopHotkeyCapture;
  renderTargetHotkeySettingsHandler = renderTargetHotkeySettings;
  refreshTargetHotkeyUiHandler = refreshTargetHotkeyUi;

  function clearPendingOfflineUserTimer(userId) {
    const key = String(userId);
    const timerId = pendingOfflineUserTimers.get(key);
    if (!timerId) return;
    clearTimeout(timerId);
    pendingOfflineUserTimers.delete(key);
  }

  async function applyUserListToUi(users) {
    cachedUsers = users;
    refreshIncomingEntrySourceUserIds(users);
    const list = document.getElementById('targets-list');
    const hasRenderedTargets = Boolean(list?.querySelector('li.target-item'));
    if (!hasRenderedTargets || !Array.isArray(cachedOperatorTargets) || !cachedOperatorTargets.length) {
      await renderTargetList(users);
    } else {
      await refreshRenderedUserTargets(users);
      updateVoiceTriggerTargetOptions(users);
    }
    applyIncomingTalkState();
    primeVisibleRemotePlaybackBuses();
    requestActiveProducers().catch(() => {});
  }

  function buildDisplayUsersFromLatestServerState() {
    const latestById = new Map();
    latestServerUsers.forEach((user) => {
      if (user?.userId == null) return;
      latestById.set(String(user.userId), user);
    });

    const displayUsers = [...latestServerUsers];
    const previousUsers = Array.isArray(cachedUsers) ? cachedUsers : [];
    previousUsers.forEach((user) => {
      const key = String(user?.userId ?? '');
      if (!key || latestById.has(key) || !user?.socketId) return;
      if (!pendingOfflineUserTimers.has(key)) return;
      displayUsers.push(user);
    });

    return displayUsers;
  }

  function scheduleOfflineGraceTimer(userId) {
    const key = String(userId);
    if (!key || pendingOfflineUserTimers.has(key)) return;
    const timerId = setTimeout(() => {
      pendingOfflineUserTimers.delete(key);
      if (!isOperatorSession()) return;
      applyUserListToUi(buildDisplayUsersFromLatestServerState()).catch((err) => {
        console.error('Failed to apply delayed user offline state', err);
      });
    }, USER_OFFLINE_GRACE_MS);
    pendingOfflineUserTimers.set(key, timerId);
  }

  function prepareDisplayUsersWithOfflineGrace(users) {
    latestServerUsers = Array.isArray(users) ? users.map((user) => ({ ...user })) : [];
    const latestById = new Map();
    latestServerUsers.forEach((user) => {
      if (user?.userId == null) return;
      latestById.set(String(user.userId), user);
      clearPendingOfflineUserTimer(user.userId);
    });

    const previousUsers = Array.isArray(cachedUsers) ? cachedUsers : [];
    previousUsers.forEach((user) => {
      const key = String(user?.userId ?? '');
      if (!key || latestById.has(key) || !user?.socketId) return;
      scheduleOfflineGraceTimer(key);
    });

    return buildDisplayUsersFromLatestServerState();
  }

  async function syncOperatorTargetsFromLatestUserList(reason = 'operator-target-sync') {
    if (!isOperatorSession()) return;
    try {
      await applyUserListToUi(buildDisplayUsersFromLatestServerState());
    } catch (err) {
      console.error(`Failed to sync targets after ${reason}`, err);
    }
  }

  function syncRenderedTargetStateUi() {
    document.querySelectorAll('.target-item').forEach(li => {
      const key = li.id;
      const statusEl = li.querySelector('.target-status');

      const isSpeaking = isTargetSpeaking(key);
      li.classList.toggle('speaking', isSpeaking);
      getTargetIconElement(li, key)?.classList.toggle('speaking', isSpeaking);
      if (key.startsWith('feed-')) {
        li.classList.toggle('is-offline', !activeFeedKeys.has(key));
      }
      if (statusEl) {
        renderSpeakerStatus(statusEl, key, isSpeaking);
      }

      applyMuteVisualState(li, mutedPeers.has(key));
    });
  }

  function buildUserTargetElement(target, usersById) {
    const targetIdNum = Number(target.targetId);
    if (!shouldRenderUserTargetRow(targetIdNum, usersById)) return null;

      const onlineUser = usersById.get(targetIdNum);
      const socketId = onlineUser?.socketId || null;
      const isOnline = !!socketId;
      const displayName = target.name || onlineUser?.name || `User ${targetIdNum}`;
      const keyId = isOnline ? socketId : String(targetIdNum);

      const li = document.createElement('li');
      const targetKey = `user-${keyId}`;
      li.id = targetKey;
      li.classList.add('target-item', 'user-target');
      li.dataset.type = 'user';
      li.dataset.id = String(targetIdNum);
      li.dataset.socketId = socketId || '';
      if (!isOnline) {
        li.classList.add('is-offline');
      }

      const hint = document.createElement('div');
      hint.className = 'slide-to-lock-hint';
      hint.textContent = getSlideToLockHintText();
      hint.setAttribute('aria-hidden', 'true');

      const icon = document.createElement('div');
      icon.className = 'user-icon';
      icon.textContent = displayName ? displayName.charAt(0).toUpperCase() : String(targetIdNum).slice(0, 2);

      const info = document.createElement('div');
      info.className = 'target-info';

      const resolveCurrentUserSocketId = () => li.dataset.socketId || resolveUserSocketId(targetIdNum) || null;
      const getCurrentTargetKey = () => {
        const currentSocketId = resolveCurrentUserSocketId();
        return `user-${currentSocketId || targetIdNum}`;
      };

      const label = document.createElement('span');
      label.className = 'target-label';
      label.textContent = displayName;
      const labelRow = document.createElement('div');
      labelRow.className = 'target-label-row';
      labelRow.appendChild(label);
      labelRow.insertAdjacentHTML('afterbegin', '<svg class="target-talk-lock-icon" viewBox="0 0 24 24" aria-label="Talk locked" role="img"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="5" y="10" width="14" height="11" rx="2"/></svg>');
      info.appendChild(labelRow);

      const persistedUserState = getPersistedTargetAudioState('user', targetIdNum);
      const userKey = `volume_user_${targetIdNum}`;
      const volSlider = document.createElement('input');
      volSlider.type = 'range';
      volSlider.min = '0';
      volSlider.max = '1';
      volSlider.step = '0.01';
      volSlider.value = getStoredVolume(userKey).toString();
      volSlider.className = 'volume-slider';
      volSlider.title = 'Source Volume';
      const updateVolume = (e, syncServer) => {
        const vol = parseFloat(e.target.value);
        const currentTargetKey = getCurrentTargetKey();
        setTargetVolumeAndPersist(currentTargetKey, userKey, vol, {
          targetType: 'user',
          targetId: targetIdNum,
          muted: mutedPeers.has(currentTargetKey),
        }, { syncServer });
      };
      volSlider.addEventListener('input', e => updateVolume(e, false));
      volSlider.addEventListener('change', e => updateVolume(e, true));
      if (!isOnline) {
        volSlider.disabled = true;
      }
      info.appendChild(volSlider);

      const talkBtn = document.createElement('button');
      talkBtn.className = 'talk-btn';
      talkBtn.type = 'button';
      talkBtn.setAttribute('aria-pressed', 'false');
      talkBtn.setAttribute(
        'aria-label',
        isOnline ? `Hold to talk to ${displayName}` : `${displayName} is offline`
      );
      talkBtn.title = isOnline ? 'Hold to talk' : 'Offline';
      const talkIcon = document.createElement('img');
      talkIcon.className = 'btn-icon';
      talkIcon.src = UI_ICONS.talk;
      talkIcon.alt = '';
      talkIcon.setAttribute('aria-hidden', 'true');
      talkBtn.appendChild(talkIcon);
      talkBtn.addEventListener('pointerdown', e => {
        const currentSocketId = resolveCurrentUserSocketId();
        if (!currentSocketId) return;
        e.stopPropagation();
        li.classList.add('ptt-pressing');

        const normalizedTarget = { type: 'user', id: currentSocketId };

        if (hasActiveTalkLocks()) {
          if (isTalkTargetLocked(normalizedTarget)) {
            li.classList.remove('ptt-pressing');
            if (lockMultipleTargetsEnabled) {
              removeTalkLock(normalizedTarget);
            } else {
              handleStopTalking({ preventDefault() {}, currentTarget: talkBtn });
            }
            return;
          }
          if (!lockMultipleTargetsEnabled) {
            suspendActiveLockState();
            handleStopTalking({ preventDefault() {}, currentTarget: null, suppressLockRestore: true });
          }
        }

        const startX = e.clientX;
        let lockedByGesture = false;

        const onMove = (ev) => {
          if (lockedByGesture || isTalkButtonLocked(talkBtn)) return;
          if (didReachSlideToLockThreshold(ev.clientX, startX)) {
            lockedByGesture = true;
            activateTalkLock(normalizedTarget, talkBtn);
          }
        };

        const cleanup = () => {
          talkBtn.removeEventListener('pointermove', onMove);
          talkBtn.removeEventListener('pointerup', onEnd);
          talkBtn.removeEventListener('pointercancel', onEnd);
          try { talkBtn.releasePointerCapture(e.pointerId); } catch {}
        };

        const onEnd = (ev) => {
          cleanup();
          li.classList.remove('ptt-pressing');
          handleStopTalking(ev);
        };

        try { talkBtn.setPointerCapture(e.pointerId); } catch {}
        talkBtn.addEventListener('pointermove', onMove);
        talkBtn.addEventListener('pointerup', onEnd);
        talkBtn.addEventListener('pointercancel', onEnd);
        handleTalk(e, normalizedTarget);
      });
      if (!isOnline) {
        talkBtn.disabled = true;
      }

      const muteBtn = document.createElement('button');
      muteBtn.className = 'mute-btn';
      muteBtn.type = 'button';
      const initialMuted = Boolean(persistedUserState?.muted) || (isOnline && mutedPeers.has(getCurrentTargetKey()));
      muteBtn.title = initialMuted ? 'Unmute' : 'Mute';
      const muteIcon = document.createElement('img');
      muteIcon.className = 'btn-icon';
      muteIcon.src = initialMuted ? UI_ICONS.speakerMuted : UI_ICONS.speakerOn;
      muteIcon.alt = '';
      muteIcon.setAttribute('aria-hidden', 'true');
      muteBtn.appendChild(muteIcon);
      muteBtn.addEventListener('pointerdown', e => e.stopPropagation());
      muteBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleMute(getCurrentTargetKey());
      });
      const actions = document.createElement('div');
      actions.className = 'target-actions';
      actions.classList.add('ptt-actions');
      actions.append(muteBtn, talkBtn);
      applyMuteVisualState(li, initialMuted);

      if (isOnline) {
        li.append(icon, info, actions, hint);
      } else {
        li.append(icon, info, actions);
      }

      if (isOnline) {
        const lockEntry = getTalkLockEntry({ type: 'user', id: socketId });
        if (lockEntry) {
          lockEntry.button = talkBtn;
          setTalkButtonLocked(talkBtn, true);
        }
      }

      let rowPttGestureActive = false;
      let rowPttStartX = 0;
      let rowPttLockedByGesture = false;
      li.addEventListener('pointermove', (e) => {
        if (!rowPttGestureActive) return;
        if (rowPttLockedByGesture || isTalkButtonLocked(talkBtn)) return;
        if (didReachSlideToLockThreshold(e.clientX, rowPttStartX)) {
          const currentSocketId = resolveCurrentUserSocketId();
          if (!currentSocketId) return;
          rowPttLockedByGesture = true;
          activateTalkLock({ type: 'user', id: currentSocketId }, talkBtn);
        }
      });

      ['down', 'up', 'leave', 'cancel'].forEach(ev => {
        li.addEventListener(`pointer${ev}`, e => {
          if (
            e.target.closest('.talk-btn') ||
            e.target.closest('.mute-btn') ||
            e.target.closest('.volume-slider')
          ) return;
          if (ev === 'down') {
            const currentSocketId = resolveCurrentUserSocketId();
            if (!currentSocketId) return;
            const targetData = { type: 'user', id: currentSocketId };
            const existingLock = getTalkLockEntry(targetData);
            if (existingLock) {
              if (lockMultipleTargetsEnabled) {
                removeTalkLock(targetData);
              } else {
                handleStopTalking({ preventDefault() {}, currentTarget: existingLock.button });
              }
              return;
            }
            if (hasActiveTalkLocks() && !lockMultipleTargetsEnabled) {
              suspendActiveLockState();
              handleStopTalking({ preventDefault() {}, currentTarget: null, suppressLockRestore: true });
              rowPttGestureActive = true;
              rowPttLockedByGesture = false;
              rowPttStartX = e.clientX;
              li.classList.add('ptt-pressing');
              try { li.setPointerCapture(e.pointerId); } catch {}
              handleTalk(e, targetData);
              return;
            }

            rowPttGestureActive = true;
            rowPttLockedByGesture = false;
            rowPttStartX = e.clientX;
            li.classList.add('ptt-pressing');
            try { li.setPointerCapture(e.pointerId); } catch {}
            handleTalk(e, targetData);
            return;
          }

          if (ev === 'up' || ev === 'leave' || ev === 'cancel') {
            if (!rowPttGestureActive) return;
            rowPttGestureActive = false;
            li.classList.remove('ptt-pressing');
            try { li.releasePointerCapture(e.pointerId); } catch {}
          }
          handleStopTalking(e);
        });
      });

      return li;
  }

  function patchUserTargetElement(existingRow, target, usersById) {
    const targetIdNum = Number(target?.targetId);
    if (!Number.isFinite(targetIdNum) || !existingRow) return false;

    const onlineUser = usersById.get(targetIdNum);
    const socketId = onlineUser?.socketId || null;
    const isOnline = Boolean(socketId);
    const displayName = target.name || onlineUser?.name || `User ${targetIdNum}`;
    const targetKey = `user-${socketId || targetIdNum}`;
    const userKey = `volume_user_${targetIdNum}`;
    const persistedUserState = getPersistedTargetAudioState('user', targetIdNum);
    const currentMuted = Boolean(persistedUserState?.muted) || (isOnline && mutedPeers.has(targetKey));

    existingRow.id = targetKey;
    existingRow.dataset.type = 'user';
    existingRow.dataset.id = String(targetIdNum);
    existingRow.dataset.socketId = socketId || '';
    existingRow.classList.toggle('is-offline', !isOnline);

    const icon = existingRow.querySelector('.user-icon');
    if (icon) {
      icon.textContent = displayName ? displayName.charAt(0).toUpperCase() : String(targetIdNum).slice(0, 2);
    }

    const label = existingRow.querySelector('.target-label');
    if (label) {
      label.textContent = displayName;
    }

    let hint = existingRow.querySelector('.slide-to-lock-hint');
    if (isOnline) {
      if (!hint) {
        hint = document.createElement('div');
        hint.className = 'slide-to-lock-hint';
        hint.textContent = getSlideToLockHintText();
        hint.setAttribute('aria-hidden', 'true');
        existingRow.appendChild(hint);
      }
      hint.hidden = false;
    } else if (hint) {
      hint.hidden = true;
    }

    const volSlider = existingRow.querySelector('.volume-slider');
    if (volSlider) {
      volSlider.disabled = !isOnline;
      volSlider.title = 'Source Volume';
      if (!document.activeElement || document.activeElement !== volSlider) {
        volSlider.value = getStoredVolume(userKey).toString();
      }
    }

    const talkBtn = existingRow.querySelector('.talk-btn');
    if (talkBtn) {
      talkBtn.disabled = !isOnline;
      talkBtn.title = isOnline ? (talkBtn.dataset.locked === 'true' ? 'Locked (tap to unlock)' : 'Hold to talk') : 'Offline';
      talkBtn.setAttribute(
        'aria-label',
        isOnline ? `Hold to talk to ${displayName}` : `${displayName} is offline`
      );
    }

    applyMuteVisualState(existingRow, currentMuted);
    return true;
  }

  async function refreshRenderedUserTargets(users) {
    if (!isOperatorSession()) return false;
    if (!Array.isArray(cachedOperatorTargets)) return false;

    const list = document.getElementById('targets-list');
    if (!list) return false;

    const userTargets = cachedOperatorTargets.filter((target) => target?.targetType === 'user');
    const usersById = new Map();
    users.forEach((u) => {
      if (u?.userId == null) return;
      usersById.set(Number(u.userId), u);
    });
    rebuildUserTargetLabels(users);

    for (const target of userTargets) {
      const targetIdNum = Number(target?.targetId);
      if (!Number.isFinite(targetIdNum)) continue;
      if (!shouldRenderUserTargetRow(targetIdNum, usersById)) continue;
      const existingRow = list.querySelector(`.user-target[data-id="${String(targetIdNum)}"]`);
      if (!existingRow) {
        continue;
      }

      const currentSocketId = existingRow.dataset.socketId || '';
      const currentOnline = !existingRow.classList.contains('is-offline');
      const currentLabel = existingRow.querySelector('.target-label')?.textContent || '';
      const hotkeyActive = existingRow.classList.contains('hotkey-active');
      const onlineUser = usersById.get(targetIdNum);
      const nextSocketId = onlineUser?.socketId || '';
      const nextOnline = Boolean(nextSocketId);
      const nextLabel = target.name || onlineUser?.name || `User ${targetIdNum}`;

      if (
        currentSocketId === nextSocketId
        && currentOnline === nextOnline
        && currentLabel === nextLabel
      ) {
        continue;
      }

      const patched = patchUserTargetElement(existingRow, target, usersById);
      if (!patched) {
        continue;
      }
      if (hotkeyActive) {
        existingRow.classList.add('hotkey-active');
      }
    }

    applyIncomingTalkState();
    refreshConferenceMemberOnlineStates(users);
    syncRenderedTargetStateUi();
    syncRenderedTargetAudioPreferences();
    refreshTargetHotkeyUi(users);
    refreshLastTargetLabel();
    updateTargetLayerControls();
    updateCompactSessionBarMode(list.childElementCount);
    primeVisibleRemotePlaybackBuses();
    pruneTargetPlaybackBuses();
    return true;
  }

  function normalizeConferenceTargetMembers(target) {
    const currentProfileUserId = Number(getOperatorProfileUserId());
    const seenUserIds = new Set();
    return (Array.isArray(target?.members) ? target.members : [])
      .map((member) => ({
        userId: Number(member?.userId ?? member?.id),
        name: String(member?.name || '').trim(),
      }))
      .filter((member) => {
        if (!Number.isFinite(member.userId) || seenUserIds.has(member.userId)) return false;
        seenUserIds.add(member.userId);
        return member.userId !== currentProfileUserId;
      })
      .sort((left, right) => (
        (left.name || String(left.userId)).localeCompare(
          right.name || String(right.userId),
          undefined,
          { sensitivity: 'base' }
        )
      ));
  }

  function refreshConferenceMemberOnlineStates(users = cachedUsers) {
    const onlineUserIds = new Set(
      (Array.isArray(users) ? users : [])
        .filter((user) => user?.socketId && user?.userId != null)
        .map((user) => Number(user.userId))
        .filter((userId) => Number.isFinite(userId))
    );

    document.querySelectorAll('.conference-member-listen[data-user-id]').forEach((memberRow) => {
      const userId = Number(memberRow.dataset.userId);
      const online = onlineUserIds.has(userId);
      memberRow.classList.toggle('is-offline', !online);
      const state = memberRow.querySelector('.conference-member-online-state');
      if (state) state.textContent = online ? 'Online' : 'Offline';
    });
  }

  function renderConferenceMembersModal(target, users = cachedUsers) {
    if (!conferenceMembersModalDescription || !conferenceMembersModalList) return;
    const conferenceId = Number(target?.targetId);
    conferenceMembersModal.dataset.conferenceId = String(conferenceId);
    const members = normalizeConferenceTargetMembers(target);
    const usersById = new Map();
    (Array.isArray(users) ? users : []).forEach((user) => {
      if (user?.userId == null) return;
      usersById.set(Number(user.userId), user);
    });

    const conferenceName = target?.name || `Conference ${conferenceId}`;
    conferenceMembersModalDescription.textContent = `Choose who you hear in ${conferenceName}.`;
    conferenceMembersModalList.innerHTML = '';
    if (!members.length) {
      const empty = document.createElement('span');
      empty.className = 'conference-members-empty';
      empty.textContent = 'No other members';
      conferenceMembersModalList.appendChild(empty);
    } else {
      members.forEach((member) => {
        const online = Boolean(usersById.get(member.userId)?.socketId);
        const row = document.createElement('div');
        row.className = 'conference-member-listen';
        row.classList.toggle('is-offline', !online);
        row.dataset.userId = String(member.userId);

        const toggleLabel = document.createElement('label');
        toggleLabel.className = 'conference-member-listen__toggle';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'conference-member-listen-checkbox';
        checkbox.checked = !isConferenceMemberExcluded(conferenceId, member.userId);
        checkbox.setAttribute('aria-label', `Hear ${member.name || `user ${member.userId}`}`);
        checkbox.addEventListener('change', () => {
          setConferenceMemberListening(conferenceId, member.userId, checkbox.checked);
          row.classList.toggle('is-muted', !checkbox.checked);
        });

        const name = document.createElement('span');
        name.textContent = member.name || `User ${member.userId}`;

        const onlineState = document.createElement('span');
        onlineState.className = 'conference-member-online-state';
        onlineState.textContent = online ? 'Online' : 'Offline';
        toggleLabel.append(checkbox, name, onlineState);

        const level = getConferenceMemberListenLevel(conferenceId, member.userId);
        const levelControl = document.createElement('div');
        levelControl.className = 'conference-member-level';
        const levelSlider = document.createElement('input');
        levelSlider.type = 'range';
        levelSlider.className = 'conference-member-level__slider';
        levelSlider.min = '0';
        levelSlider.max = '1';
        levelSlider.step = '0.01';
        levelSlider.value = String(level);
        levelSlider.setAttribute('aria-label', `${member.name || `User ${member.userId}`} volume`);
        const levelOutput = document.createElement('output');
        levelOutput.className = 'conference-member-level__value';
        const updateLevelOutput = (nextLevel) => {
          levelOutput.value = formatLinearLevelDb(nextLevel);
          levelOutput.textContent = levelOutput.value;
          levelSlider.setAttribute('aria-valuetext', levelOutput.value);
        };
        updateLevelOutput(level);
        levelSlider.addEventListener('input', () => {
          const nextLevel = Math.max(0, Math.min(1, Number(levelSlider.value)));
          updateLevelOutput(nextLevel);
          setConferenceMemberListenLevel(conferenceId, member.userId, nextLevel, { persist: false });
        });
        levelSlider.addEventListener('change', () => {
          setConferenceMemberListenLevel(conferenceId, member.userId, levelSlider.value);
        });
        levelControl.append(levelSlider, levelOutput);

        row.classList.toggle('is-muted', !checkbox.checked);
        row.append(toggleLabel, levelControl);
        conferenceMembersModalList.appendChild(row);
      });
    }
  }

  function openConferenceMembersModal(target, triggerElement = null) {
    if (!conferenceMembersModal || !target) return;
    conferenceMembersModalRestoreFocus = triggerElement;
    renderConferenceMembersModal(target, cachedUsers);
    conferenceMembersModal.hidden = false;
    window.requestAnimationFrame(() => {
      conferenceMembersModal.querySelector(
        '.conference-member-listen-checkbox, .conference-members-modal__done'
      )?.focus();
    });
  }

  function closeConferenceMembersModal({ restoreFocus = true } = {}) {
    if (!conferenceMembersModal || conferenceMembersModal.hidden) return;
    conferenceMembersModal.hidden = true;
    const focusTarget = conferenceMembersModalRestoreFocus;
    conferenceMembersModalRestoreFocus = null;
    if (restoreFocus && focusTarget && document.body.contains(focusTarget)) {
      focusTarget.focus();
    }
  }

  conferenceMembersModalDone?.addEventListener('click', () => closeConferenceMembersModal());
  conferenceMembersModal?.addEventListener('click', (event) => {
    if (event.target === conferenceMembersModal) closeConferenceMembersModal();
  });
  conferenceMembersModal?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeConferenceMembersModal();
      return;
    }
    if (event.key !== 'Tab') {
      event.stopPropagation();
      return;
    }

    const focusable = Array.from(conferenceMembersModal.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => !element.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
    event.stopPropagation();
  });

  async function renderTargetList(users, { membershipUpdateOnly = false } = {}) {
    if (!isOperatorSession()) return;
    const dbUserId = getOperatorProfileUserId();
    if (!dbUserId) return;

    let targets;
    try {
      const productionQuery = session.productionId
        ? `?productionId=${encodeURIComponent(session.productionId)}`
        : '';
      targets = session.kind === 'guest'
        ? await fetchJSON(`/guest/targets${productionQuery}`)
        : await fetchJSON(`/users/${dbUserId}/targets?includeMemberships=1${session.productionId ? `&productionId=${encodeURIComponent(session.productionId)}` : ''}`);
    } catch (err) {
      console.error('Failed to fetch targets', err);
      return;
    }

    // Membership notifications also reach other participants. Preserve their
    // buttons, held keys and icon nodes when only the member data changed.
    const withoutMembers = (items) => items.map(({ members, ...target }) => target);
    if (membershipUpdateOnly && Array.isArray(targets) && Array.isArray(cachedOperatorTargets)
      && JSON.stringify(withoutMembers(targets)) === JSON.stringify(withoutMembers(cachedOperatorTargets))) {
      targets.forEach((target, index) => {
        cachedOperatorTargets[index].members = target.members;
      });
      if (conferenceMembersModal && !conferenceMembersModal.hidden) {
        const target = cachedOperatorTargets.find((item) => item.targetType === 'conference'
          && String(item.targetId) === conferenceMembersModal.dataset.conferenceId);
        if (target) renderConferenceMembersModal(target, users);
      }
      return;
    }

    cachedOperatorTargets = Array.isArray(targets) ? targets : [];

    const list = document.getElementById('targets-list');
    if (!list) return;
    closeConferenceMembersModal({ restoreFocus: false });
    list.innerHTML = '';

    ensureCustomTargetHotkeysLoaded();

    if (pressedHotkeyBindings.size) {
      handleStopTalking({ preventDefault() {}, currentTarget: null });
    }
    pressedHotkeyBindings.clear();
    clearHotkeyActiveStyles();

    targetLabels.clear();
    listenOnlyConferenceKeys.clear();

    const usersById = new Map();
    users.forEach(u => {
      if (u.userId == null) return;
      usersById.set(Number(u.userId), u);
    });
    rebuildUserTargetLabels(users);
    rebuildTargetHotkeyAssignments(users);
    updateVoiceTriggerTargetOptions(users);

    const conferenceNames = new Map();
    targets
      .filter(t => t.targetType === 'conference')
      .forEach(t => {
        conferenceNames.set(Number(t.targetId), t.name);
        conferenceLabels.set(Number(t.targetId), t.name);
        targetLabels.set(`conf-${t.targetId}`, t.name);
      });

    targets
      .filter(t => t.targetType === 'feed')
      .forEach(t => {
        targetLabels.set(`feed-${t.targetId}`, t.name);
      });

    const appendUserTarget = (target) => {
      const li = buildUserTargetElement(target, usersById);
      if (!li) return;
      list.appendChild(li);
    };

    const appendConferenceTarget = (target) => {
      const id = Number(target.targetId);
      const name = conferenceNames.get(id) || target.name;
      const key = `conf-${id}`;
      const canTalk = target.canTalk !== false;

      const li = document.createElement('li');
      li.id = key;
      li.classList.add('target-item', 'conf-target');
      if (!canTalk) {
        li.classList.add('monitor-only-target');
        listenOnlyConferenceKeys.add(key);
      }
      li.dataset.type = 'conference';
      li.dataset.id = String(id);

      const icon = document.createElement('div');
      icon.className = 'conf-icon';
      icon.textContent = '📡';
      icon.tabIndex = 0;
      icon.setAttribute('role', 'button');
      icon.setAttribute('aria-label', `Choose who you hear in ${name}`);
      icon.title = 'Choose who you hear';
      icon.addEventListener('pointerdown', (event) => event.stopPropagation());
      icon.addEventListener('click', (event) => {
        event.stopPropagation();
        openConferenceMembersModal(target, icon);
      });
      icon.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        openConferenceMembersModal(target, icon);
      });

      const info = document.createElement('div');
      info.className = 'target-info';

      const label = document.createElement('span');
      label.className = 'target-label';
      label.textContent = name;
      const labelRow = document.createElement('div');
      labelRow.className = 'target-label-row';
      labelRow.appendChild(label);
      labelRow.insertAdjacentHTML('afterbegin', '<svg class="target-talk-lock-icon" viewBox="0 0 24 24" aria-label="Talk locked" role="img"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="5" y="10" width="14" height="11" rx="2"/></svg>');

      const status = document.createElement('div');
      status.className = 'target-status target-status-inline';
      labelRow.appendChild(status);
      info.appendChild(labelRow);

      const persistedConfState = getPersistedTargetAudioState('conference', id);
      const confKey = `volume_conf_${id}`;
      const confSlider = document.createElement('input');
      confSlider.type = 'range';
      confSlider.min = '0';
      confSlider.max = '1';
      confSlider.step = '0.01';
      confSlider.value = getStoredVolume(confKey).toString();
      confSlider.className = 'volume-slider';
      confSlider.title = 'Conference Volume';
      const updateVolume = (e, syncServer) => {
        const vol = parseFloat(e.target.value);
        setTargetVolumeAndPersist(key, confKey, vol, {
          targetType: 'conference',
          targetId: id,
          muted: mutedPeers.has(key),
        }, { syncServer });
      };
      confSlider.addEventListener('input', e => updateVolume(e, false));
      confSlider.addEventListener('change', e => updateVolume(e, true));
      info.appendChild(confSlider);

      const muteBtn = document.createElement('button');
      muteBtn.className = 'mute-btn';
      const muted = persistedConfState?.muted || mutedPeers.has(key);
      muteBtn.type = 'button';
      muteBtn.title = muted ? 'Unmute' : 'Mute';
      const muteIcon = document.createElement('img');
      muteIcon.className = 'btn-icon';
      muteIcon.src = muted ? UI_ICONS.speakerMuted : UI_ICONS.speakerOn;
      muteIcon.alt = '';
      muteIcon.setAttribute('aria-hidden', 'true');
      muteBtn.appendChild(muteIcon);
      applyMuteVisualState(li, muted);
      muteBtn.addEventListener('pointerdown', e => e.stopPropagation());
      muteBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleMute(id);
      });

      const actions = document.createElement('div');
      actions.className = 'target-actions';
      actions.classList.add('ptt-actions');

      if (!canTalk) {
        actions.append(muteBtn);
        li.append(icon, info, actions);
        list.appendChild(li);
        return;
      }

      const hint = document.createElement('div');
      hint.className = 'slide-to-lock-hint';
      hint.textContent = getSlideToLockHintText();
      hint.setAttribute('aria-hidden', 'true');

      const talkBtn = document.createElement('button');
      talkBtn.className = 'talk-btn';
      talkBtn.type = 'button';
      talkBtn.setAttribute('aria-pressed', 'false');
      talkBtn.setAttribute('aria-label', `Hold to talk to ${name}`);
      talkBtn.title = 'Hold to talk';
      const talkIcon = document.createElement('img');
      talkIcon.className = 'btn-icon';
      talkIcon.src = UI_ICONS.talk;
      talkIcon.alt = '';
      talkIcon.setAttribute('aria-hidden', 'true');
      talkBtn.appendChild(talkIcon);
      talkBtn.addEventListener('pointerdown', e => {
        e.stopPropagation();
        li.classList.add('ptt-pressing');

        const normalizedTarget = { type: 'conference', id };

        if (hasActiveTalkLocks()) {
          if (isTalkTargetLocked(normalizedTarget)) {
            li.classList.remove('ptt-pressing');
            if (lockMultipleTargetsEnabled) {
              removeTalkLock(normalizedTarget);
            } else {
              handleStopTalking({ preventDefault() {}, currentTarget: talkBtn });
            }
            return;
          }
          if (!lockMultipleTargetsEnabled) {
            suspendActiveLockState();
            handleStopTalking({ preventDefault() {}, currentTarget: null, suppressLockRestore: true });
          }
        }

        const startX = e.clientX;
        let lockedByGesture = false;

        const onMove = (ev) => {
          if (lockedByGesture || isTalkButtonLocked(talkBtn)) return;
          if (didReachSlideToLockThreshold(ev.clientX, startX)) {
            lockedByGesture = true;
            activateTalkLock(normalizedTarget, talkBtn);
          }
        };

        const cleanup = () => {
          talkBtn.removeEventListener('pointermove', onMove);
          talkBtn.removeEventListener('pointerup', onEnd);
          talkBtn.removeEventListener('pointercancel', onEnd);
          try { talkBtn.releasePointerCapture(e.pointerId); } catch {}
        };

        const onEnd = (ev) => {
          cleanup();
          li.classList.remove('ptt-pressing');
          handleStopTalking(ev);
        };

        try { talkBtn.setPointerCapture(e.pointerId); } catch {}
        talkBtn.addEventListener('pointermove', onMove);
        talkBtn.addEventListener('pointerup', onEnd);
        talkBtn.addEventListener('pointercancel', onEnd);
        handleTalk(e, normalizedTarget);
      });

      actions.append(muteBtn, talkBtn);

      li.append(icon, info, actions, hint);

      const lockEntry = getTalkLockEntry({ type: 'conference', id });
      if (lockEntry) {
        lockEntry.button = talkBtn;
        setTalkButtonLocked(talkBtn, true);
      }

      let rowPttGestureActive = false;
      let rowPttStartX = 0;
      let rowPttLockedByGesture = false;
      li.addEventListener('pointermove', (e) => {
        if (!rowPttGestureActive) return;
        if (rowPttLockedByGesture || isTalkButtonLocked(talkBtn)) return;
        if (didReachSlideToLockThreshold(e.clientX, rowPttStartX)) {
          rowPttLockedByGesture = true;
          activateTalkLock({ type: 'conference', id }, talkBtn);
        }
      });

      ['down', 'up', 'leave', 'cancel'].forEach(ev => {
        li.addEventListener(`pointer${ev}`, e => {
          if (
            e.target.closest('.talk-btn') ||
            e.target.closest('.mute-btn') ||
            e.target.closest('.volume-slider') ||
            e.target.closest('.conf-icon')
          ) return;
          if (ev === 'down') {
            const targetData = { type: 'conference', id };
            const existingLock = getTalkLockEntry(targetData);
            if (existingLock) {
              if (lockMultipleTargetsEnabled) {
                removeTalkLock(targetData);
              } else {
                handleStopTalking({ preventDefault() {}, currentTarget: existingLock.button });
              }
              return;
            }
            if (hasActiveTalkLocks() && !lockMultipleTargetsEnabled) {
              suspendActiveLockState();
              handleStopTalking({ preventDefault() {}, currentTarget: null, suppressLockRestore: true });
              rowPttGestureActive = true;
              rowPttLockedByGesture = false;
              rowPttStartX = e.clientX;
              li.classList.add('ptt-pressing');
              try { li.setPointerCapture(e.pointerId); } catch {}
              handleTalk(e, targetData);
              return;
            }

            rowPttGestureActive = true;
            rowPttLockedByGesture = false;
            rowPttStartX = e.clientX;
            li.classList.add('ptt-pressing');
            try { li.setPointerCapture(e.pointerId); } catch {}
            handleTalk(e, targetData);
            return;
          }

          if (ev === 'up' || ev === 'leave' || ev === 'cancel') {
            if (!rowPttGestureActive) return;
            rowPttGestureActive = false;
            li.classList.remove('ptt-pressing');
            try { li.releasePointerCapture(e.pointerId); } catch {}
          }
          handleStopTalking(e);
        });
      });

      list.appendChild(li);
    };

    const appendFeedTarget = (target) => {
      const id = Number(target.targetId);
      const name = target.name;
      const key = `feed-${id}`;

      const li = document.createElement('li');
      li.id = key;
      li.classList.add('target-item', 'feed-target');
      li.classList.toggle('is-offline', !activeFeedKeys.has(key));
      li.dataset.type = 'feed';
      li.dataset.id = String(id);

      const icon = document.createElement('div');
      icon.className = 'feed-icon';
      icon.textContent = '🎧';

      const info = document.createElement('div');
      info.className = 'target-info';

      const labelWrap = document.createElement('div');
      labelWrap.className = 'target-label-row';

      const label = document.createElement('span');
      label.className = 'target-label';
      label.textContent = name;
      labelWrap.appendChild(label);

      const receptionBtn = document.createElement('button');
      receptionBtn.className = 'lock-btn feed-reception-btn';
      receptionBtn.type = 'button';
      const updateReceptionButton = () => {
        const stopped = stoppedFeedKeys.has(key);
        receptionBtn.innerHTML = stopped ? FEED_RECEPTION_ICONS.play : FEED_RECEPTION_ICONS.stop;
        receptionBtn.title = stopped ? 'Start receiving feed' : 'Stop receiving feed';
        receptionBtn.setAttribute('aria-label', receptionBtn.title);
        receptionBtn.setAttribute('aria-pressed', stopped ? 'true' : 'false');
        receptionBtn.classList.toggle('is-stopped', stopped);
        li.classList.toggle('feed-stopped', stopped);
      };
      updateReceptionButton();
      receptionBtn.addEventListener('pointerdown', e => e.stopPropagation());
      receptionBtn.addEventListener('click', e => {
        e.stopPropagation();
        setFeedReceptionStopped(key, !stoppedFeedKeys.has(key));
        updateReceptionButton();
      });

      const status = document.createElement('div');
      status.className = 'target-status target-status-inline';
      labelWrap.appendChild(status);

      info.appendChild(labelWrap);

      const persistedFeedState = getPersistedTargetAudioState('feed', id);
      const feedKey = `volume_feed_${id}`;
      const feedSlider = document.createElement('input');
      feedSlider.type = 'range';
      feedSlider.min = '0';
      feedSlider.max = '1';
      feedSlider.step = '0.01';
      feedSlider.value = getStoredVolume(feedKey).toString();
      feedSlider.className = 'volume-slider';
      feedSlider.title = 'Feed Volume';
      const updateVolume = (e, syncServer) => {
        const vol = Math.max(0, Math.min(1, parseFloat(e.target.value)));
        setTargetVolumeAndPersist(key, feedKey, vol, {
          targetType: 'feed',
          targetId: id,
          muted: mutedPeers.has(key),
        }, { syncServer });
      };
      feedSlider.addEventListener('input', e => updateVolume(e, false));
      feedSlider.addEventListener('change', e => updateVolume(e, true));
      info.appendChild(feedSlider);

      const muteBtn = document.createElement('button');
      muteBtn.className = 'mute-btn';
      const muted = persistedFeedState?.muted || mutedPeers.has(key);
      muteBtn.type = 'button';
      muteBtn.title = muted ? 'Unmute' : 'Mute';
      const muteIcon = document.createElement('img');
      muteIcon.className = 'btn-icon';
      muteIcon.src = muted ? UI_ICONS.speakerMuted : UI_ICONS.speakerOn;
      muteIcon.alt = '';
      muteIcon.setAttribute('aria-hidden', 'true');
      muteBtn.appendChild(muteIcon);
      applyMuteVisualState(li, muted);
      muteBtn.addEventListener('pointerdown', e => e.stopPropagation());
      muteBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleMute(key);
      });

      const actions = document.createElement('div');
      actions.className = 'target-actions';
      actions.classList.add('ptt-actions');
      actions.append(muteBtn, receptionBtn);

      li.append(icon, info, actions);
      list.appendChild(li);
    };

    targets.forEach(target => {
      if (target.targetType === 'user') {
        appendUserTarget(target);
      } else if (target.targetType === 'conference') {
        appendConferenceTarget(target);
      } else if (target.targetType === 'feed') {
        appendFeedTarget(target);
      }
    });

    // Re-apply outgoing talk highlight after re-rendering the target list.
    // The list is rebuilt via `innerHTML = ''`, so any previous DOM classes
    // (like "talking-to") are lost even though the producer may still be live.
    if (producer || isTalking || hasActiveTalkLocks()) {
      const activeTargetsToHighlight = currentTargets.length > 0
        ? currentTargets
        : (currentTarget ? [currentTarget] : []);
      activeTargetsToHighlight.forEach((target) => {
        if (!target || (target.type !== 'conference' && target.type !== 'user')) return;
        const selector = target.type === 'conference'
          ? `#conf-${target.id}`
          : `#user-${target.id}`;
        document.querySelector(selector)?.classList.add('talking-to');
      });

      if (activeTargetsToHighlight.length === 0) {
        getActiveTalkLockTargets().forEach((lockedTarget) => {
          const selector = lockedTarget.type === 'conference'
            ? `#conf-${lockedTarget.id}`
            : `#user-${lockedTarget.id}`;
          document.querySelector(selector)?.classList.add('talking-to');
        });
      }
    }

    const allowedFeedKeys = new Set(
      targets
        .filter(t => t.targetType === 'feed')
        .map(t => `feed-${t.targetId}`)
    );

    const feedsToRemove = [];
    audioElements.forEach((entry, mapKey) => {
      if (entry?.type === 'feed' && !allowedFeedKeys.has(entry.key)) {
        feedsToRemove.push({ entry, mapKey });
      }
    });

    for (const { entry, mapKey } of feedsToRemove) {
      const feedKey = entry.key;
      const feedId = Number(feedKey.split('-')[1]);
      const consumers = peerConsumers.get(mapKey);
      if (consumers) {
        consumers.forEach(c => {
          closeConsumerOnServer(c?.id);
          try { c.close(); } catch {}
        });
        peerConsumers.delete(mapKey);
      }
      unregisterStreamKey(feedKey, mapKey);
      if (!hasActiveStreams(feedKey)) {
        activeFeedKeys.delete(feedKey);
        updateSpeakerHighlight(feedKey, false);
      }
      mutedPeers.delete(feedKey);
      disposePlaybackEntry(entry);
      audioElements.delete(mapKey);
      feedAudioElements.get(feedId)?.delete(entry.audio);
    }

    if (feedsToRemove.length) {
      applyFeedDucking();
    }

    let removedUnavailableLock = false;
    getActiveTalkLockEntries().forEach((entry) => {
      if (entry.button && document.body.contains(entry.button) && !entry.button.disabled) return;
      activeTalkLocks.delete(getTalkTargetIdentity(entry.target));
      removedUnavailableLock = true;
    });
    if (removedUnavailableLock) {
      setCurrentTalkTargets(collectActiveTalkTargetsFromPointers());
      if (currentTargets.length > 0) {
        emitTalkTargetsUpdated('talk-targets-updated', currentTargets);
      } else {
        handleStopTalking({ preventDefault() {}, currentTarget: null, suppressLockRestore: true });
      }
    }

    pruneIncomingStreamBookkeeping();

    applyIncomingTalkState();
    syncRenderedTargetStateUi();

    syncRenderedTargetAudioPreferences();
    refreshTargetHotkeyUi(users);
    refreshLastTargetLabel();
    primeVisibleRemotePlaybackBuses();
    pruneTargetPlaybackBuses(collectVisibleRemoteTargetKeys());

    schedulePttButtonSizing();
    if (!pttSizingListenerBound) {
      window.addEventListener('resize', schedulePttButtonSizing, { passive: true });
      window.addEventListener('resize', updateTargetLayerControls, { passive: true });
      window.addEventListener('resize', () => updateCompactSessionBarMode(), { passive: true });
      pttSizingListenerBound = true;
    }
    updateTargetLayerControls();
    updateCompactSessionBarMode(list.childElementCount);
    emitTargetAudioStateSnapshot('target-audio-render');
  }




  async function handleIncomingProducer(payload) {
    if (!payload || typeof payload !== 'object') return;

    if (!device || !recvTransport) {
      logReceiveDiagnostic('new-producer-queued', {
        producerId: payload.producerId || null,
        peerId: payload.peerId || null,
        type: payload.appData?.type || null,
        targetId: payload.appData?.id ?? null,
      });
      pendingProducerQueue.push(payload);
      return;
    }

    await consumeProducerPayload(payload);
  }

  async function consumeProducerPayload({ peerId, speakerUserId = null, producerId, appData }) {
    const consumeStartedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    const normalizedAppData = appData && typeof appData === 'object' ? appData : {};
    const isConference = normalizedAppData.type === 'conference';
    const isFeed = normalizedAppData.type === 'feed';

    let targetKey;
    let volumeStorageKey;
    if (isConference) {
      targetKey = `conf-${normalizedAppData.id}`;
      volumeStorageKey = `volume_conf_${normalizedAppData.id}`;
    } else if (isFeed) {
      targetKey = `feed-${normalizedAppData.id}`;
      volumeStorageKey = `volume_feed_${normalizedAppData.id}`;
    } else {
      const stableUserId = Number(
        speakerUserId
          ?? cachedUsers.find((entry) => String(entry?.socketId) === String(peerId))?.userId
          ?? peerId
      );
      targetKey = resolveRenderedUserTargetKey({ userId: speakerUserId, peerId });
      volumeStorageKey = Number.isFinite(stableUserId)
        ? `volume_user_${stableUserId}`
        : `volume_user_${peerId}`;
    }

    // ignore our own streams
    if (peerId === socket.id) return;

    // skip streams not intended for us. For direct user targets, allow a stale
    // targetPeer hint if the stable target user id still matches the current session.
    if (normalizedAppData.targetPeer && normalizedAppData.targetPeer !== socket.id) {
      const directTargetUserId = Number(normalizedAppData.id);
      const isDirectTargetForCurrentUser = (
        normalizedAppData.type === 'user'
        && session.kind === 'user'
        && Number.isFinite(directTargetUserId)
        && Number(session.userId) === directTargetUserId
      );
      const directTargetGuestId = String(normalizedAppData.id ?? '').trim();
      const isDirectTargetForCurrentGuest = (
        normalizedAppData.type === 'guest'
        && isGuestSessionActive()
        && directTargetGuestId
        && String(session.guestId) === directTargetGuestId
      );
      if (!isDirectTargetForCurrentUser && !isDirectTargetForCurrentGuest) {
        console.log('Producer not for us, skipping');
        return;
      }
      console.info('[audio][direct-user-fallback]', {
        producerId,
        hintedTargetPeer: normalizedAppData.targetPeer,
        currentSocketId: socket.id,
        directTargetUserId,
        directTargetGuestId: isDirectTargetForCurrentGuest ? directTargetGuestId : null,
      });
    }

    const effectiveProducerId = producerId || normalizedAppData.producerId || `${peerId}-${Date.now()}`;
    const streamKey = makeStreamKey(targetKey, effectiveProducerId);
    logReceiveDiagnostic('consume-start', {
      producerId: effectiveProducerId,
      peerId,
      streamKey,
      targetKey,
      type: normalizedAppData.type || null,
      targetId: normalizedAppData.id ?? null,
    });
    if (takeEarlyClosedStream(streamKey)) {
      logReceiveDiagnostic('consume-skipped-closed-producer', {
        producerId: effectiveProducerId,
        peerId,
        streamKey,
        targetKey,
      });
      return;
    }
    const alreadyTracked = audioElements.has(streamKey)
      || peerConsumers.has(streamKey)
      || (targetStreamMap.get(targetKey)?.has(streamKey) ?? false);
    if (alreadyTracked || pendingIncomingConsumeKeys.has(streamKey)) {
      logReceiveDiagnostic('consume-skipped-duplicate', {
        producerId: effectiveProducerId,
        streamKey,
        targetKey,
      });
      return;
    }
    pendingIncomingConsumeKeys.add(streamKey);

    try {
      logReceiveDiagnostic('consume-request', {
        producerId: effectiveProducerId,
        peerId,
        streamKey,
        targetKey,
      });
      const { error, ...consumeParams } = await new Promise((resolve) =>
        socket.emit('consume', {
          producerId: effectiveProducerId,
          rtpCapabilities: device.rtpCapabilities,
        }, resolve)
      );
      if (error) throw new Error(error);
      logReceiveDiagnostic('consume-response', {
        producerId: effectiveProducerId,
        peerId,
        streamKey,
        targetKey,
        elapsedMs: Math.round(((typeof performance !== 'undefined' && typeof performance.now === 'function')
          ? performance.now()
          : Date.now()) - consumeStartedAt),
      });

      if (takeEarlyClosedStream(streamKey)) {
        if (consumeParams.id) {
          closeConsumerOnServer(consumeParams.id);
        }
        logReceiveDiagnostic('consume-response-after-producer-close', {
          producerId: effectiveProducerId,
          consumerId: consumeParams.id || null,
          peerId,
          streamKey,
          targetKey,
        });
        return;
      }

      const consumer = await recvTransport.consume(consumeParams);
      logReceiveDiagnostic('consumer-created', {
        producerId: effectiveProducerId,
        consumerId: consumer?.id || null,
        peerId,
        streamKey,
        targetKey,
      });
      if (takeEarlyClosedConsumer(consumer?.id) || takeEarlyClosedStream(streamKey)) {
        try { consumer.close(); } catch {}
        closeConsumerOnServer(consumer?.id);
        logReceiveDiagnostic('consumer-closed-before-registration', {
          producerId: effectiveProducerId,
          consumerId: consumer?.id || null,
          streamKey,
          targetKey,
        });
        return;
      }
      const nowTracked = audioElements.has(streamKey)
        || peerConsumers.has(streamKey)
        || (targetStreamMap.get(targetKey)?.has(streamKey) ?? false);
      if (nowTracked) {
        try { consumer.close(); } catch {}
        closeConsumerOnServer(consumer?.id);
        logReceiveDiagnostic('consumer-closed-duplicate', {
          producerId: effectiveProducerId,
          consumerId: consumer?.id || null,
          streamKey,
          targetKey,
        });
        return;
      }
      const receiver = consumer?.rtpReceiver;
      if (receiver && 'playoutDelayHint' in receiver) {
        try { receiver.playoutDelayHint = 0.1; } catch (err) { console.debug('playoutDelayHint set failed', err); }
      }

      if (!peerConsumers.has(streamKey)) peerConsumers.set(streamKey, new Set());
      peerConsumers.get(streamKey).add(consumer);
      if (mutedPeers.has(targetKey) && !isFeedKey(targetKey)) consumer.pause();

      const stream = new MediaStream([consumer.track]);
      const adaptivePlainReceive = shouldUseAdaptivePlainReceivePlayback();
      const adaptiveDirectReceive = !isFeed && shouldUseAdaptiveReceivePlayback() && !adaptivePlainReceive;
      const feedPlayback = isFeed && !adaptivePlainReceive && shouldUseFeedPlaybackBus() ? ensureFeedPlaybackBus() : null;
      let persistentPlaybackBus = !isFeed && !adaptivePlainReceive && !adaptiveDirectReceive && shouldUsePersistentRemotePlaybackBus()
        ? ensureTargetPlaybackBus(targetKey, { type: normalizedAppData.type || 'user' })
        : null;
      const shouldUseWebAudioLevelControl = !isFeed && !persistentPlaybackBus && !adaptivePlainReceive && (
        adaptiveDirectReceive || isiOS || isSafariBrowser
      );
      const ctxForPlayback = (persistentPlaybackBus || shouldUseWebAudioLevelControl) ? ensureAudioContext() : null;

      const initVolRaw = getStoredVolume(volumeStorageKey);
      const initVol = Math.max(0, Math.min(1, initVolRaw));

      const createIncomingAudioElement = () => {
        const nextAudio = document.createElement('audio');
        nextAudio.srcObject = stream;
        nextAudio.autoplay = true;
        nextAudio.playsInline = true;
        nextAudio.setAttribute('playsinline', 'true');
        nextAudio.setAttribute('autoplay', 'true');
        enforcePitchLock(nextAudio);
        attachPlaybackAudioDiagnostics(nextAudio, 'incoming-audio-element');
        if (supportsAudioOutputSelection() && preferredOutputDeviceId && typeof nextAudio.setSinkId === 'function') {
          nextAudio.setSinkId(preferredOutputDeviceId).catch(err => {
            console.warn('Failed to apply audio output device to new audio element:', err);
          });
        }
        return nextAudio;
      };

      let audio = persistentPlaybackBus?.audio || createIncomingAudioElement();
      if (consumer.track && typeof consumer.track.addEventListener === 'function') {
        consumer.track.addEventListener('mute', () => {
          logReceiveDiagnostic('consumer-track-mute', {
            producerId: effectiveProducerId,
            consumerId: consumer.id,
            streamKey,
            targetKey,
            track: getAudioTrackSnapshot(consumer.track),
          });
        });
        consumer.track.addEventListener('unmute', () => {
          logReceiveDiagnostic('consumer-track-unmute', {
            producerId: effectiveProducerId,
            consumerId: consumer.id,
            streamKey,
            targetKey,
            track: getAudioTrackSnapshot(consumer.track),
          });
        });
        consumer.track.addEventListener('ended', () => {
          logReceiveDiagnostic('consumer-track-ended', {
            producerId: effectiveProducerId,
            consumerId: consumer.id,
            streamKey,
            targetKey,
            track: getAudioTrackSnapshot(consumer.track),
          });
        });
      }

      let gainNode = null;
      let mediaSource = null;
      let feedDuckingNode = null;
      let usesMediaElementSource = false;
      let playbackGainNode = null;
      let usesSharedAudioElement = false;

      if (feedPlayback) {
        try {
          mediaSource = feedPlayback.ctx.createMediaStreamSource(stream);
          gainNode = feedPlayback.ctx.createGain();
          feedDuckingNode = feedPlayback.ctx.createGain();
          gainNode.gain.value = 0;
          feedDuckingNode.gain.value = 1;
          mediaSource.connect(gainNode);
          gainNode.connect(feedDuckingNode);
          feedDuckingNode.connect(feedPlayback.inputNode);
          audio.muted = true;
          audio.volume = 0;
          playbackGainNode = gainNode;
        } catch (err) {
          console.warn('Failed to initialize feed playback bus path:', err);
          gainNode = null;
          mediaSource = null;
          feedDuckingNode = null;
        }
      } else if (persistentPlaybackBus && ctxForPlayback) {
        try {
          mediaSource = ctxForPlayback.createMediaStreamSource(stream);
          gainNode = ctxForPlayback.createGain();
          gainNode.gain.value = 1;
          mediaSource.connect(gainNode);
          gainNode.connect(persistentPlaybackBus.inputNode);
          playbackGainNode = persistentPlaybackBus.levelNode;
          usesSharedAudioElement = true;
          audio.muted = false;
          audio.volume = 1;
          if (ctxForPlayback.state !== 'running' && typeof ctxForPlayback.resume === 'function') {
            ctxForPlayback.resume().catch(err => console.warn('Failed to resume AudioContext:', err));
          }
        } catch (err) {
          console.warn('Failed to initialize persistent target playback bus:', err);
          gainNode = null;
          mediaSource = null;
          playbackGainNode = null;
          usesSharedAudioElement = false;
          persistentPlaybackBus = null;
          audio = createIncomingAudioElement();
        }
      }

      if (!gainNode && ctxForPlayback && !feedPlayback && !persistentPlaybackBus) {
        try {
          if (!adaptiveDirectReceive && isSafariBrowser && typeof ctxForPlayback.createMediaElementSource === 'function') {
            mediaSource = ctxForPlayback.createMediaElementSource(audio);
            usesMediaElementSource = true;
          } else {
            mediaSource = ctxForPlayback.createMediaStreamSource(stream);
          }
          gainNode = ctxForPlayback.createGain();
          gainNode.gain.value = 0;
          mediaSource.connect(gainNode);
          gainNode.connect(ctxForPlayback.destination);
          playbackGainNode = gainNode;
          if (usesMediaElementSource) {
            audio.muted = false;
            audio.volume = 1;
          } else {
            audio.muted = true;
            audio.volume = 0;
          }
          if (ctxForPlayback.state !== 'running' && typeof ctxForPlayback.resume === 'function') {
            ctxForPlayback.resume().catch(err => console.warn('Failed to resume AudioContext:', err));
          }
        } catch (err) {
          console.warn('Failed to initialize remote gain path:', err);
          gainNode = null;
          mediaSource = null;
        }
      }

      if (!gainNode) {
        const applied = Math.max(0, Math.min(1, initVol));
        if (mutedPeers.has(targetKey)) {
          audio.muted = true;
          audio.volume = 0;
        } else {
          audio.muted = false;
          audio.volume = applied;
        }
      }

      logRemoteAudioPlaybackDecision({
        streamKey,
        targetKey,
        isFeed,
        path: feedPlayback
          ? 'feed-web-audio-bus'
          : usesSharedAudioElement
            ? 'persistent-target-playback-bus'
          : ctxForPlayback
            ? adaptiveDirectReceive
              ? 'adaptive-direct-web-audio-gain'
              : 'web-audio-gain'
            : 'plain-audio-element',
        audio,
        context: feedPlayback?.ctx || ctxForPlayback || null,
        reason: feedPlayback
          ? 'feed bus enabled'
          : isFeed && isAndroidBrowser
            ? 'android feed fallback'
            : usesSharedAudioElement
              ? 'persistent target playback bus'
            : ctxForPlayback
              ? adaptiveDirectReceive
                ? 'adaptive visible webaudio gain'
                : usesMediaElementSource
                ? 'safari media element gain'
                : 'ios remote gain control'
              : adaptivePlainReceive
                ? 'adaptive hidden plain audio'
                : 'default direct playback',
      });

      if (!usesSharedAudioElement) {
        appendPlaybackAudioElement(audio);
      }
      const entry = {
        audio,
        stream,
        volume: initVol,
        key: targetKey,
        streamKey,
        consumerId: consumer.id,
        type: normalizedAppData.type || 'user',
        gainNode,
        mediaSource,
        playbackGainNode,
        playbackBus: persistentPlaybackBus,
        usesMediaElementSource,
        usesSharedAudioElement,
        feedDuckingNode,
        lastAppliedLevel: null,
        producerId: effectiveProducerId,
        sourcePeerId: peerId,
        sourceUserId: speakerUserId !== null
          && speakerUserId !== undefined
          && Number.isFinite(Number(speakerUserId))
          ? Number(speakerUserId)
          : Number(cachedUsers.find((candidate) => String(candidate?.socketId) === String(peerId))?.userId) || null,
      };
      audioElements.set(streamKey, entry);
      if (!usesSharedAudioElement) {
        audioEntryMap.set(audio, entry);
      }
      registerStreamKey(targetKey, streamKey);
      if (isFeed) {
        activeFeedKeys.add(targetKey);
        updateSpeakerHighlight(targetKey, true);
      }

      if (isFeed) {
        if (mutedPeers.has(targetKey)) {
          muteFeedEntry(entry);
        } else {
          setFeedEntryLevel(entry, entry.volume);
        }

        const feedId = Number(normalizedAppData.id);
        if (!feedAudioElements.has(feedId)) {
          feedAudioElements.set(feedId, new Set());
        }
        feedAudioElements.get(feedId).add(audio);

        consumer.on('producerclose', () => {
          const set = feedAudioElements.get(feedId);
          set?.delete(audio);
          if (isOperatorSession()) {
            applyFeedDucking();
          }
        });
      } else {
        if (mutedPeers.has(targetKey)) {
          mutePlaybackEntry(entry);
        } else {
          setPlaybackEntryLevel(entry, entry.volume);
        }

        if (isConference) {
          const confId = normalizedAppData.id;
          if (!confAudioElements.has(confId)) {
            confAudioElements.set(confId, new Set());
          }
          confAudioElements.get(confId).add(audio);

          consumer.on('producerclose', () => {
            confAudioElements.get(confId)?.delete(audio);
          });
        }
      }

      let consumerClosed = false;
      const handleConsumerClosed = () => {
        if (consumerClosed) return;
        consumerClosed = true;
        console.log(`Producer closed for consumer ${consumer.id}`);

        const consumersSet = peerConsumers.get(streamKey);
        if (consumersSet) {
          consumersSet.delete(consumer);
          if (consumersSet.size === 0) {
            peerConsumers.delete(streamKey);
          }
        }

        unregisterStreamKey(targetKey, streamKey);
        if (isFeed && !hasActiveStreams(targetKey)) {
          activeFeedKeys.delete(targetKey);
          updateSpeakerHighlight(targetKey, false);
        }

        disposePlaybackEntry(entry);
        audioElements.delete(streamKey);

        if (entry.type === 'feed') {
          const feedId = Number(normalizedAppData.id);
          feedAudioElements.get(feedId)?.delete(audio);
          if (isOperatorSession()) {
            applyFeedDucking();
          }
        } else if (entry.type === 'conference') {
          confAudioElements.get(normalizedAppData.id)?.delete(audio);
        }
      };

      consumer.on('producerclose', handleConsumerClosed);
      consumer.on('trackended', handleConsumerClosed);
      consumer.on('transportclose', handleConsumerClosed);

      if (takeEarlyClosedConsumer(consumer.id) || takeEarlyClosedStream(streamKey)) {
        logReceiveDiagnostic('consumer-closed-before-playback', {
          producerId: effectiveProducerId,
          consumerId: consumer.id,
          streamKey,
          targetKey,
        });
        try { consumer.close(); } catch {}
        closeConsumerOnServer(consumer.id);
        handleConsumerClosed();
        return;
      }

      if (usesSharedAudioElement) {
        if (micPrimed || micTrack?.readyState === 'live') {
          await warmReceiveAudioSession('incoming-producer-before-playback').catch(err => {
            logReceiveDiagnostic('warm-receive-audio-session-failed', {
              producerId: effectiveProducerId,
              consumerId: consumer.id,
              streamKey,
              targetKey,
              error: err?.message || String(err),
            });
          });
        }
        primeTargetPlaybackBus(targetKey, {
          type: entry.type,
          reason: 'incoming-producer-playback-bus',
        });
      } else {
        await attemptPlayAudio(audio, {
          producerId: effectiveProducerId,
          consumerId: consumer.id,
          streamKey,
          targetKey,
          type: entry.type,
        }).catch(() => {});
      }
      if (isFeed && isOperatorSession()) {
        applyFeedDucking();
      }

      logReceiveDiagnostic('resume-consumer-start', {
        producerId: effectiveProducerId,
        consumerId: consumer.id,
        streamKey,
        targetKey,
      });
      await new Promise((res) =>
        socket.emit('resume-consumer', { consumerId: consumer.id }, res)
      );
      logReceiveDiagnostic('resume-consumer-done', {
        producerId: effectiveProducerId,
        consumerId: consumer.id,
        streamKey,
        targetKey,
        elapsedMs: Math.round(((typeof performance !== 'undefined' && typeof performance.now === 'function')
          ? performance.now()
          : Date.now()) - consumeStartedAt),
      });
    } catch (err) {
      if (err?.message === 'Producer not found') {
        logReceiveDiagnostic('consume-skipped-producer-not-found', {
          producerId: effectiveProducerId,
          peerId,
          streamKey,
          targetKey,
        });
        return;
      }
      console.error('Error consuming:', err);
    } finally {
      pendingIncomingConsumeKeys.delete(streamKey);
    }
  }

  async function processPendingProducers() {
    if (!device || !recvTransport) return;

    while (pendingProducerQueue.length) {
      const payload = pendingProducerQueue.shift();
      try {
        await consumeProducerPayload(payload);
      } catch (err) {
        console.error('Failed to consume queued producer', err);
      }
    }
  }

  async function requestActiveProducers() {
    if (!isOperatorSession()) return;
    if (activeProducersSyncInFlight) return;
    activeProducersSyncInFlight = true;
    try {
      const payloads = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Timeout requesting active producers')),
          5000
        );

        socket.emit('request-active-producers', (list) => {
          clearTimeout(timeout);
          if (!Array.isArray(list)) {
            resolve([]);
          } else {
            resolve(list);
          }
        });
      });

      const expectedStreamKeys = new Set();

      for (const payload of payloads) {
        const targetKey = targetKeyFromProducerPayload(payload);
        const streamKey = streamKeyFromProducerPayload(payload);
        if (!targetKey || !streamKey) continue;
        expectedStreamKeys.add(streamKey);

        const alreadyHave = audioElements.has(streamKey)
          || peerConsumers.has(streamKey)
          || (targetStreamMap.get(targetKey)?.has(streamKey) ?? false);

        if (payload?.retainOnly) {
          logReceiveDiagnostic(
            alreadyHave ? 'consumer-retained-paused-producer' : 'retain-only-producer-skipped',
            {
              producerId: payload.producerId || null,
              streamKey,
              targetKey,
            }
          );
          continue;
        }

        if (alreadyHave) continue;
        await handleIncomingProducer(payload);
      }

      // Remove streams we still have locally but that the server no longer
      // reports as active (e.g. missed events while backgrounded).
      for (const [targetKey, set] of Array.from(targetStreamMap.entries())) {
        for (const streamKey of Array.from(set)) {
          if (expectedStreamKeys.has(streamKey)) continue;
          cleanupIncomingStream(targetKey, streamKey);
        }
      }
    } catch (err) {
      console.error('Failed to request active producers', err);
    } finally {
      activeProducersSyncInFlight = false;
    }
  }

  function startActiveProducerSync() {
    if (activeProducerSyncInterval) return;
    activeProducerSyncInterval = setInterval(() => {
        if (!mediaInitialized) return;
        if (!isOperatorSession()) return;
        if (!socket.connected) return;
      requestActiveProducers().catch(() => {});
    }, ACTIVE_PRODUCERS_SYNC_INTERVAL_MS);
  }

  function stopActiveProducerSync() {
    if (!activeProducerSyncInterval) return;
    clearInterval(activeProducerSyncInterval);
    activeProducerSyncInterval = null;
  }



  // Initialize MediaSoup
  async function initializeMediaSoup() {
    try {
      console.log("=== Starting MediaSoup initialization ===");

      // 1. Get RTP Capabilities
      console.log("1. Requesting RTP Capabilities...");
      const rtpCapabilities = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Timeout getting RTP caps")),
          5000
        );

        socket.emit("get-router-rtp-capabilities", (caps) => {
          clearTimeout(timeout);
          if (!caps || typeof caps !== 'object') {
            reject(new Error("No RTP capabilities received"));
          } else if (caps.error) {
            reject(new Error(`Server could not provide RTP capabilities: ${caps.error}`));
          } else if (!Array.isArray(caps.codecs)) {
            reject(new Error("Server returned invalid RTP capabilities"));
          } else {
            resolve(caps);
          }
        });
      });
      console.log("1. ✓ Got RTP Capabilities");

      // 2. Initialize Device
      console.log("2. Creating MediaSoup Device...");
      device = new mediasoupClient.Device();
      await device.load({ routerRtpCapabilities: rtpCapabilities });
      console.log("2. ✓ Device loaded");

      // 3. Create Send Transport
      console.log("3. Creating send transport...");
      const sendParams = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Timeout creating send transport")),
          5000
        );

        socket.emit("create-send-transport", null, (params) => {
          clearTimeout(timeout);
          if (!params || typeof params !== 'object') {
            reject(new Error("Server returned no send transport parameters"));
          } else if (params.error) {
            reject(new Error(`Server could not create send transport: ${params.error}`));
          } else if (typeof params.id !== 'string') {
            reject(new Error("Server returned invalid send transport parameters"));
          } else {
            resolve(params);
          }
        });
      });

      sendTransport = device.createSendTransport(sendParams);
      bindMediaTransportStatus(sendTransport, 'send');
      console.log("3. ✓ Send transport created");

      sendTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          try {
            await new Promise((resolve) => {
              socket.emit(
                "connect-send-transport",
                { dtlsParameters },
                resolve
              );
            });
            callback();
          } catch (error) {
            errback(error);
          }
        }
      );

      // currentTargetPeer → socket ID of the peer for direct conversations
      sendTransport.on(
          "produce",
          async ({ kind, rtpParameters, appData }, callback, errback) => {
            try {
              const shouldAppendTargetPeer = appData?.type === 'user' && currentTargetPeer;
              const mergedAppData = {
                ...appData,
                ...(shouldAppendTargetPeer
                    ? { targetPeer: currentTargetPeer }
                    : {})
              };

              const response = await new Promise((resolve) => {
                socket.emit(
                    "produce",
                    { kind, rtpParameters, appData: mergedAppData },
                    resolve
                );
              });

              callback({ id: response.id });
            } catch (error) {
              errback(error);
            }
          }
      );


      // 4. Create Receive Transport
      console.log("4. Creating receive transport...");
      const recvParams = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Timeout creating recv transport")),
          5000
        );

        socket.emit("create-recv-transport", null, (params) => {
          clearTimeout(timeout);
          if (!params || typeof params !== 'object') {
            reject(new Error("Server returned no receive transport parameters"));
          } else if (params.error) {
            reject(new Error(`Server could not create receive transport: ${params.error}`));
          } else if (typeof params.id !== 'string') {
            reject(new Error("Server returned invalid receive transport parameters"));
          } else {
            resolve(params);
          }
        });
      });

      recvTransport = device.createRecvTransport(recvParams);
      bindMediaTransportStatus(recvTransport, 'receive');
      console.log("4. ✓ Recv transport created");

      recvTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          try {
            await new Promise((resolve) => {
              socket.emit(
                "connect-recv-transport",
                { dtlsParameters },
                resolve
              );
            });
            callback();
          } catch (error) {
            errback(error);
          }
        }
      );

      // Update all user list items to be clickable
      document.querySelectorAll("#users li:not(.you)").forEach((li) => {
        li.style.cursor = "pointer";
      });

      await processPendingProducers();
      await requestActiveProducers();
      if (!streamPruneInterval) {
        streamPruneInterval = setInterval(pruneIncomingStreamBookkeeping, 2000);
      }
      startActiveProducerSync();
      startMediaNetworkStatsReporting();
      if (session.kind === 'feed') {
        updateFeedControls();
        if (!feedManualStop && (feedStreaming || shouldStartFeedWhenReady)) {
          shouldStartFeedWhenReady = false;
          startFeedStream().catch(err => console.error('Failed to start feed after init', err));
        }
      }
      console.log("=== ✓ MediaSoup initialization complete! ===");
    } catch (err) {
      console.error("=== ✗ MediaSoup initialization failed ===");
      console.error("Error:", err);
      closeMediaTransportState();
      throw err;
    }
  }

  // Handle new producers
  socket.on('new-producer', (payload) => {
    if (payload && typeof payload === 'object') {
      console.log(`New producer ${payload.producerId} from peer ${payload.peerId}`, payload.appData);
      logReceiveDiagnostic('new-producer-received', {
        producerId: payload.producerId || null,
        peerId: payload.peerId || null,
        type: payload.appData?.type || null,
        targetId: payload.appData?.id ?? null,
        hintedTargetPeer: payload.appData?.targetPeer || null,
      });
    }
    handleIncomingProducer(payload).catch(err => console.error('Failed to handle producer', err));
  });

  socket.on('consumer-closed', ({ consumerId } = {}) => {
    const cleaned = cleanupConsumerById(consumerId);
    if (!cleaned && consumerId) {
      rememberEarlyClosedConsumer(consumerId);
    }
    if (!cleaned && mediaInitialized && isOperatorSession()) {
      requestActiveProducers().catch(() => {});
    }
  });


  socket.on("producer-closed", ({ peerId, speakerUserId = null, producerId, appData }) => {
    // 1️⃣ Compute the key like always
    let key;
    if (appData?.type === "conference") {
      key = `conf-${appData.id}`;
    } else if (appData?.type === "feed") {
      key = `feed-${appData.id}`;
    } else {
      key = resolveRenderedUserTargetKey({ userId: speakerUserId, peerId });
    }

    const closedProducerId = producerId || appData?.producerId || null;
    const streamKey = makeStreamKey(key, closedProducerId);

    // 2️⃣ Continue only if we were actually consuming this key
    const consumersSet = peerConsumers.get(streamKey);
    if (!consumersSet || consumersSet.size === 0) {
      if (closedProducerId) {
        rememberEarlyClosedStream(streamKey, {
          producerId: closedProducerId,
          peerId,
          targetKey: key,
        });
      }
      unregisterStreamKey(key, streamKey);
      if (isFeedKey(key) && !hasActiveStreams(key)) {
        activeFeedKeys.delete(key);
        updateSpeakerHighlight(key, false);
      }
      return;
    }

    consumersSet.forEach(c => {
      try { c.close(); } catch {}
    });
    peerConsumers.delete(streamKey);
    unregisterStreamKey(key, streamKey);

    if (isFeedKey(key) && !hasActiveStreams(key)) {
      activeFeedKeys.delete(key);
      updateSpeakerHighlight(key, false);
    }

    const stored = audioElements.get(streamKey);
    if (stored) {
      const audioEl = stored.audio;
      disposePlaybackEntry(stored);
      audioElements.delete(streamKey);
      if (stored.type === 'feed') {
        const feedId = Number(appData?.id);
        feedAudioElements.get(feedId)?.delete(audioEl);
          if (isOperatorSession()) {
            applyFeedDucking();
          }
      } else if (stored.type === 'conference') {
        confAudioElements.get(appData?.id)?.delete(audioEl);
      }
    }

  });


  // Update speaker highlight
  function getTargetLabel(targetKey) {
    if (targetLabels.has(targetKey)) {
      return targetLabels.get(targetKey) ?? "";
    }
    if (targetKey.startsWith("conf-")) {
      const confId = Number(targetKey.slice(5));
      if (Number.isFinite(confId) && conferenceLabels.has(confId)) {
        return conferenceLabels.get(confId) ?? "";
      }
    }
    const separatorIndex = targetKey.indexOf("-");
    const fallback = separatorIndex >= 0 ? targetKey.slice(separatorIndex + 1) : targetKey;
    return fallback || "";
  }

  function getConferenceSpeakerStatusText(targetKey) {
    if (!targetKey.startsWith('conf-')) return '';
    const conferenceId = Number(targetKey.slice(5));
    if (!Number.isFinite(conferenceId)) return '';

    const matchingEntries = incomingTalkState.addressedNow.filter((entry) => (
      entry?.targetType === 'conference'
      && Number(entry?.targetId) === conferenceId
    ));
    if (!matchingEntries.length) return '';

    const speakerNames = [];
    const seenNames = new Set();

    matchingEntries.forEach((entry) => {
      const numericFromUserId = Number(entry?.fromUserId);
      let speakerName = '';

      if (Number.isFinite(numericFromUserId)) {
        const onlineUser = cachedUsers.find((candidate) => Number(candidate?.userId) === numericFromUserId);
        speakerName = onlineUser?.name || entry?.fromName || String(numericFromUserId);
      } else {
        speakerName = entry?.fromName || '';
      }

      const normalizedName = String(speakerName || '').trim();
      if (!normalizedName || seenNames.has(normalizedName)) return;
      seenNames.add(normalizedName);
      speakerNames.push(normalizedName);
    });

    return speakerNames.join(', ');
  }

  function getSpeakerStatusText(targetKey, isSpeaking) {
    if (!isSpeaking) return '';
    if (targetKey.startsWith('feed-')) {
      return 'Streaming';
    }
    if (targetKey.startsWith('conf-')) {
      return getConferenceSpeakerStatusText(targetKey);
    }
    return '';
  }

  function renderSpeakerStatus(statusEl, targetKey, isSpeaking) {
    const text = getSpeakerStatusText(targetKey, isSpeaking);
    const showTalkIcon = isSpeaking && targetKey.startsWith('conf-');
    const signature = JSON.stringify([showTalkIcon, text]);
    if (statusEl.dataset.speakerStatus === signature) return;
    statusEl.dataset.speakerStatus = signature;
    statusEl.replaceChildren();
    statusEl.removeAttribute('aria-label');
    if (showTalkIcon) {
      const icon = document.createElement('img');
      icon.className = 'speaker-status-icon';
      icon.src = UI_ICONS.talk;
      icon.alt = '';
      icon.setAttribute('aria-hidden', 'true');
      statusEl.appendChild(icon);
      statusEl.setAttribute('aria-label', text ? `${text} speaking` : 'Speaking');
    }
    if (text) statusEl.appendChild(document.createTextNode(text));
  }

  function updateSpeakerHighlight(targetKey, isSpeaking) {
    const el = document.getElementById(targetKey);
    const iconCls = targetKey.startsWith("conf-") ? ".conf-icon" : targetKey.startsWith("feed-") ? ".feed-icon" : ".user-icon";
    const icon    = el?.querySelector(iconCls);
    const statusEl = el?.querySelector('.target-status');
    const separatorIndex = targetKey.indexOf("-");
    const rawId = separatorIndex >= 0 ? targetKey.slice(separatorIndex + 1) : targetKey;
    const isConference = targetKey.startsWith("conf-");
    const isUser = targetKey.startsWith("user-");
    const isFeed = targetKey.startsWith("feed-");

    let lockTargetMatches = false;
    if (hasActiveTalkLocks() && !isFeed && (isConference || isUser)) {
      const candidate = {
        type: isConference ? "conference" : "user",
        id: rawId,
      };
      lockTargetMatches = isTalkTargetLocked(candidate);
    }

    if (isSpeaking) {
      el?.classList.add("speaking");
      if (isFeed) {
        el?.classList.remove("is-offline");
      }
      icon?.classList.add("speaking");
      if (statusEl) {
        renderSpeakerStatus(statusEl, targetKey, true);
      }

      applyFeedDucking();
      return;
    }

    if (!el) {
      applyFeedDucking();
      return;
    }

    el?.classList.remove("speaking");
    if (isFeed) {
      updateFeedOnlineUi(targetKey);
    }
    icon?.classList.remove("speaking");
    if (statusEl) {
      renderSpeakerStatus(statusEl, targetKey, false);
    }
    if (lockTargetMatches) {
      el?.classList.add("talking-to");
    }

    applyFeedDucking();
  }

// ---------- Helper defined once centrally ----------
  function keyFromTarget(target) {
    if (!target || target.id == null) return null;
    if (target.type === 'conference') return `conf-${target.id}`;
    if (target.type === 'user') return `user-${target.id}`;
    if (target.type === 'guest') return `guest-${target.id}`;
    if (target.type === 'feed') return `feed-${target.id}`;
    return null;
  }

  function toKey(rawId) {
    const id = String(rawId);
    if (id.startsWith("user-") || id.startsWith("conf-") || id.startsWith("feed-") || id.startsWith("guest-")) {
      return id;
    }
    const numeric = Number(id);
    if (Number.isFinite(numeric)) {
      return `conf-${numeric}`;
    }
    return `user-${id}`;
  }

  function updateOutgoingTalkHighlight(target, isActive) {
    if (!target) return;
    let targetId = null;
    if (target.type === 'conference') {
      targetId = `conf-${target.id}`;
    } else if (target.type === 'user') {
      targetId = `user-${target.id}`;
    }
    if (!targetId) return;
    document.getElementById(targetId)?.classList.toggle('talking-to', Boolean(isActive));
  }

  function getTalkInputKey(event) {
    if (!event || typeof event !== 'object') return null;
    if (typeof event.talkInputKey === 'string' && event.talkInputKey.trim()) {
      return event.talkInputKey.trim();
    }
    if (Number.isFinite(Number(event.pointerId))) {
      return Number(event.pointerId);
    }
    return null;
  }

  function getTalkTargetIdentity(target) {
    const normalizedTarget = normalizePttTarget(target);
    if (!normalizedTarget) return null;
    return `${normalizedTarget.type}:${normalizedTarget.id}`;
  }

  function resolveLiveTalkTarget(target) {
    const normalizedTarget = normalizePttTarget(target);
    if (!normalizedTarget) return null;

    if (normalizedTarget.type === 'conference') {
      return normalizedTarget;
    }
    if (normalizedTarget.type === 'guest') {
      return normalizedTarget;
    }

    const socketId = resolveUserSocketId(normalizedTarget.id)
      || cachedUsers.find((entry) => String(entry?.socketId) === String(normalizedTarget.id))?.socketId
      || null;
    if (!socketId) {
      return null;
    }

    return { type: 'user', id: socketId };
  }

  function collectActiveTalkTargetsFromPointers() {
    const collectedTargets = [];
    const seen = new Set();
    for (const lockedTarget of getActiveTalkLockTargets()) {
      const normalizedTarget = normalizePttTarget(lockedTarget);
      const identity = getTalkTargetIdentity(normalizedTarget);
      if (!normalizedTarget || !identity || seen.has(identity)) continue;
      seen.add(identity);
      collectedTargets.push(normalizedTarget);
    }
    for (const pointerState of activeTalkPointers.values()) {
      const normalizedTarget = normalizePttTarget(pointerState?.target);
      if (!normalizedTarget) continue;
      const identity = getTalkTargetIdentity(normalizedTarget);
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      collectedTargets.push(normalizedTarget);
    }
    return collectedTargets;
  }

  function refreshSelfTalkingKey() {
    const matchingKey = currentTargets
      .map((target) => keyFromTarget(target))
      .find((targetKey) => targetKey && speakingPeers.has(targetKey));
    setSelfTalkingKey(matchingKey || null);
  }

  function setCurrentTalkTargets(nextTargets) {
    const normalizedTargets = normalizePttTargets(nextTargets);
    const previousTargets = Array.isArray(currentTargets) ? currentTargets : [];
    const previousKeys = new Set(previousTargets.map((target) => keyFromTarget(target)).filter(Boolean));
    const nextKeys = new Set(normalizedTargets.map((target) => keyFromTarget(target)).filter(Boolean));

    previousTargets.forEach((target) => {
      const targetKey = keyFromTarget(target);
      if (!targetKey || nextKeys.has(targetKey)) return;
      updateOutgoingTalkHighlight(target, false);
    });

    normalizedTargets.forEach((target) => {
      const targetKey = keyFromTarget(target);
      if (!targetKey) return;
      updateOutgoingTalkHighlight(target, true);
      previousKeys.delete(targetKey);
    });

    currentTargets = normalizedTargets;
    currentTarget = normalizedTargets[0] || null;
    refreshSelfTalkingKey();
  }

  function addPressedTalkPointer(pointerId, target) {
    if (pointerId === null || pointerId === undefined) return;
    const normalizedTarget = normalizePttTarget(target);
    if (!normalizedTarget) return;
    activeTalkPointers.set(pointerId, { target: normalizedTarget });
    setCurrentTalkTargets(collectActiveTalkTargetsFromPointers());
  }

  function removePressedTalkPointer(pointerId) {
    if (pointerId === null || pointerId === undefined) return;
    if (!activeTalkPointers.has(pointerId)) return;
    activeTalkPointers.delete(pointerId);
    setCurrentTalkTargets(collectActiveTalkTargetsFromPointers());
  }

  function clearPressedTalkPointers() {
    if (activeTalkPointers.size === 0 && currentTargets.length === 0) return;
    activeTalkPointers.clear();
    setCurrentTalkTargets([]);
  }

  function clearHotkeyActiveStyles() {
    document
      .querySelectorAll(".target-item.hotkey-active")
      .forEach((el) => el.classList.remove("hotkey-active"));
  }

  function setHotkeyElementState(bindingId, isActive) {
    const el = hotkeyBindingElements.get(bindingId) || null;
    if (!el) return;
    el.classList.toggle("hotkey-active", Boolean(isActive));
  }

  function getHotkeyAssignmentForEvent(event) {
    const lookupIds = getHotkeyLookupIds(event);
    for (const bindingId of lookupIds) {
      const assignment = targetHotkeys.get(bindingId);
      if (assignment) {
        return assignment;
      }
    }
    return null;
  }

  function resolveHotkeyAssignmentTarget(assignment) {
    if (!assignment || typeof assignment !== 'object') return null;
    if (assignment.kind === 'main') return getMainButtonTarget();
    if (assignment.kind === 'reply') {
      if (!lastTarget) return null;
      return { type: lastTarget.type, id: lastTarget.id };
    }
    return assignment.target || null;
  }

  function setHotkeyAssignmentActiveState(assignment, isActive) {
    if (!assignment || typeof assignment !== 'object') return;
    if (assignment.kind === 'main' || (assignment.kind === 'reply' && !getConfiguredMainButtonIdentity())) {
      setReplyButtonActive(isActive);
      return;
    }
    const bindingId = assignment.binding?.id || null;
    if (!bindingId) return;
    setHotkeyElementState(bindingId, isActive);
  }

  function canUseTargetHotkeys(event) {
    if (!isOperatorSession()) return false;
    if (hasActiveTalkLocks() && !lockMultipleTargetsEnabled) return false;
    if (settingsMenuOpen) return false;
    if (conferenceMembersModal && !conferenceMembersModal.hidden) return false;
    if (activeHotkeyCaptureTargetIdentity) return false;
    if (!event) return false;
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    if (isTextInput(event.target)) return false;
    return true;
  }


// ---------- Toggle mute ----------
  function updateMuteUiForTarget(key, nowMuted) {
    const targetEl = document.getElementById(key);
    if (targetEl) {
      applyMuteVisualState(targetEl, nowMuted);
    }
  }

  function getTargetIconElement(targetEl, key = targetEl?.id || '') {
    const iconSelector = key.startsWith("conf-")
      ? '.conf-icon'
      : key.startsWith('feed-')
        ? '.feed-icon'
        : '.user-icon';
    return targetEl?.querySelector(iconSelector) || null;
  }

  function applyMuteVisualState(targetEl, nowMuted) {
    if (!targetEl) return;
    const key = targetEl.id || '';
    targetEl.classList.toggle('muted', nowMuted);
    const muteBtn = targetEl?.querySelector('.mute-btn');
    if (muteBtn) {
      muteBtn.classList.toggle('muted', nowMuted);
      muteBtn.title = nowMuted ? 'Unmute' : 'Mute';

      const muteIcon = muteBtn.querySelector('.btn-icon');
      if (muteIcon) {
        muteIcon.src = nowMuted ? UI_ICONS.speakerMuted : UI_ICONS.speakerOn;
      }
    }

    getTargetIconElement(targetEl, key)?.classList.toggle('muted', nowMuted);
  }

  function setMuteState(rawId) {
    const key = toKey(rawId);
    const targetEl = document.getElementById(key);
    const persistedTargetType = targetEl?.dataset?.type || null;
    const persistedTargetId = Number(targetEl?.dataset?.id);

    const consumers = collectConsumersForTarget(key);

    const wasMuted = mutedPeers.has(key);
    const nowMuted = !wasMuted;
    if (nowMuted) mutedPeers.add(key);
    else mutedPeers.delete(key);

    if (isFeedKey(key)) {
      forEachStreamEntry(key, (entry) => {
        if (nowMuted || stoppedFeedKeys.has(key)) {
          muteFeedEntry(entry);
        } else {
          setFeedEntryLevel(entry, entry.volume ?? defaultVolume);
        }
      });
        if (isOperatorSession()) {
          applyFeedDucking();
        }
    } else if (consumers.length) {
      consumers.forEach(c => {
        if (!c?.pause || !c?.resume) return;
        nowMuted ? c.pause() : c.resume();
      });
    } else {
      console.warn(`No active consumer for ${key}; deferring mute toggle.`);
    }

    if (!isFeedKey(key)) {
      forEachStreamEntry(key, (entry) => {
        if (!entry.audio) return;
        if (nowMuted) {
          mutePlaybackEntry(entry);
        } else {
          setPlaybackEntryLevel(entry, entry.volume ?? defaultVolume);
        }
      });
    }

    updateMuteUiForTarget(key, nowMuted);
    if (persistedTargetType && Number.isFinite(persistedTargetId)) {
      const volumeStorageKey = buildVolumeStorageKeyForTargetState(persistedTargetType, persistedTargetId);
      persistTargetAudioStateLocally({
        targetType: persistedTargetType,
        targetId: persistedTargetId,
        muted: nowMuted,
        volume: volumeStorageKey ? getStoredVolume(volumeStorageKey) : defaultVolume,
      });
    }
    emitTargetAudioStateSnapshot('target-audio-mute');
    return nowMuted;
  }

  function toggleMute(rawId) {
    return setMuteState(rawId);
  }


  // target = null               → broadcast to everyone
  // target = { type: "user", id: "<userId>" }
  // target = { type: "conf", id: "<confId>" }

  function isSameTarget(a, b) {
    if (!a || !b) return false;
    return a.type === b.type && String(a.id) === String(b.id);
  }

  function clearLockState() {
    if (!hasActiveTalkLocks()) return;
    getActiveTalkLockEntries().forEach((entry) => setTalkButtonLocked(entry.button, false));
    activeTalkLocks.clear();
    setSelfTalkingKey(null);
    emitPttState('lock-cleared', { lockActive: false });
  }

  function setTalkButtonLocked(button, isLocked) {
    if (!button) return;
    button.closest('li.target-item')?.classList.toggle('talk-locked', isLocked);
    if (isLocked) {
      button.dataset.locked = 'true';
      button.setAttribute('aria-pressed', 'true');
      button.title = 'Locked (tap to unlock)';
    } else {
      button.removeAttribute('data-locked');
      button.setAttribute('aria-pressed', 'false');
      button.title = 'Hold to talk';
    }
  }

  function cancelSuspendedLockRestore() {
    if (!suspendedLockRestoreTimer) return;
    clearTimeout(suspendedLockRestoreTimer);
    suspendedLockRestoreTimer = null;
  }

  function clearSuspendedLockState() {
    cancelSuspendedLockRestore();
    suspendedLockState = null;
  }

  function activateTalkLock(target, button) {
    if (!isOperatorSession()) return;
    if (!target || !button) return;
    const normalizedTarget = normalizePttTarget(target);
    const identity = getTalkTargetIdentity(normalizedTarget);
    if (!normalizedTarget || !identity) return;
    clearSuspendedLockState();
    if (!lockMultipleTargetsEnabled) {
      getActiveTalkLockEntries().forEach((entry) => {
        if (getTalkTargetIdentity(entry.target) !== identity) {
          setTalkButtonLocked(entry.button, false);
          activeTalkLocks.delete(getTalkTargetIdentity(entry.target));
        }
      });
    }
    activeTalkLocks.set(identity, { target: normalizedTarget, button });
    setTalkButtonLocked(button, true);
    emitPttState('lock-activated', {
      lockActive: true,
      target: normalizedTarget,
      targets: getActiveTalkLockTargets(),
    });
  }

  function findTalkButtonForTarget(target) {
    if (!target) return null;
    if (target.type === 'user') {
      return document.getElementById(`user-${target.id}`)?.querySelector('.talk-btn') || null;
    }
    if (target.type === 'conference') {
      return document.getElementById(`conf-${target.id}`)?.querySelector('.talk-btn') || null;
    }
    return null;
  }

  function suspendActiveLockState() {
    if (!isOperatorSession()) return null;
    if (!hasActiveTalkLocks()) return null;
    suspendedLockState = {
      locks: getActiveTalkLockEntries().map((entry) => ({
        target: { type: entry.target.type, id: entry.target.id },
        button: entry.button,
      })),
    };
    clearLockState();
    return suspendedLockState;
  }

  function scheduleRestoreSuspendedLock() {
    if (!isOperatorSession()) return;
    if (!suspendedLockState) return;
    cancelSuspendedLockRestore();
    suspendedLockRestoreTimer = setTimeout(() => {
      suspendedLockRestoreTimer = null;
      if (!suspendedLockState) return;
      // A paused warm producer intentionally remains available between talks.
      // Only wait while another talk is actually still starting or active.
      if (pendingTalkStart || isTalking || currentTargets.length > 0) {
        scheduleRestoreSuspendedLock();
        return;
      }

      const lockState = suspendedLockState;
      suspendedLockState = null;
      const restoredLocks = (lockState?.locks || [])
        .map((lock) => {
          const target = lock?.target || null;
          const button = lock?.button && document.body.contains(lock.button)
            ? lock.button
            : findTalkButtonForTarget(target);
          return target && button && !button.disabled ? { target, button } : null;
        })
        .filter(Boolean);

      restoredLocks.forEach(({ target, button }) => activateTalkLock(target, button));
      const firstTarget = restoredLocks[0]?.target || null;
      if (firstTarget) {
        handleTalk({ preventDefault() {} }, firstTarget);
      }
    }, 0);
  }

  function removeTalkLock(target) {
    const identity = getTalkTargetIdentity(target);
    const entry = identity ? activeTalkLocks.get(identity) : null;
    if (!entry) return false;
    setTalkButtonLocked(entry.button, false);
    activeTalkLocks.delete(identity);
    setCurrentTalkTargets(collectActiveTalkTargetsFromPointers());

    if (currentTargets.length > 0) {
      emitTalkTargetsUpdated('talk-targets-updated', currentTargets);
      emitPttState('lock-removed', {
        talking: true,
        lockActive: hasActiveTalkLocks(),
        target: currentTargets[0] || null,
        targets: currentTargets,
      });
      applyFeedDucking();
      return true;
    }

    handleStopTalking({ preventDefault() {}, currentTarget: null, suppressLockRestore: true });
    return true;
  }

  function toggleTalkLock(target) {
    if (!isOperatorSession()) return;
    if (!target) return;
    const talkBtn = findTalkButtonForTarget(target);
    if (!talkBtn) return;

    const existingLock = getTalkLockEntry(target);
    if (existingLock) {
      if (lockMultipleTargetsEnabled) {
        removeTalkLock(target);
      } else {
        handleStopTalking({ preventDefault() {}, currentTarget: existingLock.button });
      }
      return;
    }

    if (hasActiveTalkLocks() && !lockMultipleTargetsEnabled) {
      handleStopTalking({ preventDefault() {}, currentTarget: getActiveTalkLockEntries()[0]?.button || null });
    } else if (producer) {
      if (!lockMultipleTargetsEnabled) {
        handleStopTalking({ preventDefault() {}, currentTarget: talkBtn });
      }
    }

    activateTalkLock(target, talkBtn);
    handleTalk({ preventDefault() {} }, { type: target.type, id: target.id });
  }

  function setSelfTalkingKey(nextKey) {
    if (selfTalkingKey === nextKey) return;
    if (selfTalkingKey) {
      document.getElementById(selfTalkingKey)?.classList.remove('talking-self');
    }
    selfTalkingKey = nextKey || null;
    if (selfTalkingKey) {
      document.getElementById(selfTalkingKey)?.classList.add('talking-self');
    }
  }

  function toggleTargetLock(target) {
    toggleTalkLock(target);
  }

  async function handleTalk(e, target) {
    e.preventDefault();
    if (!isOperatorSession()) return;
    if (!target) return;
    const normalizedTarget = resolveLiveTalkTarget(target);
    if (!normalizedTarget) {
      console.warn('Talk target is not currently available', target);
      return;
    }

    const inputKey = getTalkInputKey(e);
    if (inputKey !== null) {
      addPressedTalkPointer(inputKey, normalizedTarget);
    } else {
      setCurrentTalkTargets(normalizePttTargets([
        ...getActiveTalkLockTargets(),
        normalizedTarget,
      ]));
    }

    const effectiveTargets = currentTargets.length > 0 ? currentTargets : [normalizedTarget];
    const targetKey = keyFromTarget(effectiveTargets[0] || normalizedTarget);
    showSlideToLockHint(targetKey);

    if (!producer && warmTalkProducerPromise) {
      await warmTalkProducerPromise.catch(() => null);
    }

    if (producer && !producer.closed) {
      emitTalkTargetsUpdated('talk-targets-updated', effectiveTargets);
      if (micTrack?.readyState === 'live') {
        micTrack.enabled = true;
      }
      if (userProcessingChain?.outputTrack) {
        userProcessingChain.outputTrack.enabled = true;
      }
      setCurrentTalkTargets(effectiveTargets);
      currentTargetPeer = null;
      isTalking = true;
      refreshSelfTalkingKey();
      try {
        await resumeTalkProducer(producer);
        emitPttState('talk-started', {
          talking: true,
          lockActive: hasActiveTalkLocks(),
          target: effectiveTargets[0] || null,
          targets: effectiveTargets,
        });
      } catch (error) {
        console.error('Failed to resume talk producer:', error);
        isTalking = false;
        setSelfTalkingKey(null);
        emitTalkTargetsUpdated('talk-targets-cleared', []);
        emitPttState('talk-start-failed', {
          talking: false,
          lockActive: hasActiveTalkLocks(),
          target: null,
          targets: [],
        });
      }
      if (feedDimSelf) applyFeedDucking();
      return;
    }

    if (pendingTalkStart) {
      emitTalkTargetsUpdated('talk-targets-updated', effectiveTargets);
      emitPttState('talk-targets-updated', {
        talking: true,
        lockActive: hasActiveTalkLocks(),
        target: effectiveTargets[0] || null,
        targets: effectiveTargets,
      });
      if (feedDimSelf) applyFeedDucking();
      return;
    }

    const pendingStart = {
      canceled: false,
      targets: [...effectiveTargets],
    };
    pendingTalkStart = pendingStart;
    currentTargetPeer = null;
    emitTalkTargetsUpdated('talk-targets-starting', effectiveTargets);
    if (feedDimSelf) {
      applyFeedDucking();
    }

    try {
      const qualityKey = currentQualityKey();
      const profile = QUALITY_PROFILES[qualityKey] || QUALITY_PROFILES['low-latency'];

      // 1️⃣ Read the selected microphone from the dropdown
      const selectedDeviceId = getSelectedDeviceId();

      // 2️⃣ Assemble the audio constraints
      const audioConstraints = {
        echoCancellation: audioProcessingOptions.echoCancellation,
        noiseSuppression: audioProcessingOptions.noiseSuppression,
        autoGainControl: audioProcessingOptions.autoGainControl,
        ...(profile?.constraints || {}),
        ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {})
      };

      // 3️⃣ Ensure the microphone stream is ready and enabled
      const track = await ensureMicTrack(audioConstraints, selectedDeviceId);
      if (pendingTalkStart !== pendingStart || pendingStart.canceled) {
        if (pendingTalkStart === pendingStart) {
          pendingTalkStart = null;
        }
        if (!(voiceTriggerEnabled && isOperatorSession())) {
          track.enabled = false;
        }
        scheduleMicCleanup();
        applyFeedDucking();
        return;
      }
      track.enabled = true;

      let processedTrack = null;
      if (!audioProcessingEnabled) {
        const processing = ensureUserProcessingChain(track);
        processedTrack = processing?.outputTrack || null;
      }

      const finalTrack = processedTrack || track;
      const activeTargets = currentTargets.length > 0 ? currentTargets : pendingStart.targets;
      if (activeTargets.length === 0) {
        if (pendingTalkStart === pendingStart) {
          pendingTalkStart = null;
        }
        finalTrack.enabled = false;
        if (!(voiceTriggerEnabled && isOperatorSession())) {
          track.enabled = false;
        }
        scheduleMicCleanup();
        applyFeedDucking();
        return;
      }

      finalTrack.enabled = true;
      setCurrentTalkTargets(activeTargets);
      currentTargetPeer = null;
      isTalking = true;

      refreshSelfTalkingKey();

      const params = {
        track: finalTrack,
        appData: { type: 'talk' },
        codecOptions: profile?.codecOptions ? { ...profile.codecOptions } : undefined,
        encodings: profile?.encodings ? profile.encodings.map(enc => ({ ...enc })) : undefined,
        stopTracks: false,
      };

      const newProducer = await sendTransport.produce(params);

      if (!isTalking || pendingTalkStart !== pendingStart || pendingStart.canceled) {
        if (pendingTalkStart === pendingStart) {
          pendingTalkStart = null;
        }
        notifyServerProducerClosed(newProducer.id, { context: 'talk-start-cancel' });
        newProducer.close();
        finalTrack.enabled = false;
        if (processedTrack && processedTrack !== track) {
          processedTrack.enabled = false;
        }
        if (!(voiceTriggerEnabled && isOperatorSession())) {
          track.enabled = false;
        }
        scheduleMicCleanup();
        return;
      }

      pendingTalkStart = null;
      producer = newProducer;

      attachTalkProducerCloseHandler(newProducer, processedTrack);

      emitTalkTargetsUpdated('talk-targets-started', currentTargets.length > 0 ? currentTargets : activeTargets);
      emitPttState('talk-started', {
        talking: true,
        target: (currentTargets[0] || activeTargets[0] || null),
        targets: currentTargets.length > 0 ? currentTargets : activeTargets,
      });
    } catch (err) {
      const talkStartCanceled = pendingTalkStart === pendingStart && pendingStart.canceled;
      if (pendingTalkStart === pendingStart) {
        pendingTalkStart = null;
      }
      if (talkStartCanceled) {
        applyFeedDucking();
        return;
      }
      console.error("Microphone error:", err);
      alert("Failed to start the microphone: " + err.message);
      setReplyButtonActive(false);
      clearLockState();
      isTalking = false;
      currentTargetPeer = null;
      if (micTrack && !settingsMenuOpen && !(voiceTriggerEnabled && isOperatorSession())) {
        micTrack.enabled = false;
      }
      if (userProcessingChain?.outputTrack) {
        userProcessingChain.outputTrack.enabled = false;
      }
      scheduleMicCleanup();
      applyFeedDucking();

      clearPressedTalkPointers();
      setSelfTalkingKey(null);
      emitTalkTargetsUpdated('talk-targets-cleared', []);
      emitPttState('talk-start-failed', {
        talking: false,
        lockActive: hasActiveTalkLocks(),
        target: getActiveTalkLockTargets()[0] || null,
        targets: [],
      });
    }
  }




  function setReplyButtonActive(isActive) {
    if (!btnReply) return;
    btnReply.classList.toggle("active", isActive);
    btnReply.setAttribute("aria-pressed", isActive ? "true" : "false");
  }

    btnReply.addEventListener("pointerdown", e => {
      e.preventDefault();
      if (!isOperatorSession()) return;
    const target = getMainButtonTarget();
    if (!target || btnReply.disabled) return;
    setReplyButtonActive(true);
    try { btnReply.setPointerCapture(e.pointerId); } catch {}
    handleTalk(e, { type: target.type, id: target.id });
  });

  const handleReplyPointerEnd = (e) => {
    try { btnReply.releasePointerCapture(e.pointerId); } catch {}
    handleStopTalking(e);
  };

  btnReply.addEventListener("pointerup", handleReplyPointerEnd);
  btnReply.addEventListener("pointercancel", handleReplyPointerEnd);

  function handleStopTalking(e) {
    e.preventDefault();
    if (!isOperatorSession()) return;
    const shouldRestoreSuspendedLock = Boolean(suspendedLockState) && !e?.suppressLockRestore;
    const inputKey = getTalkInputKey(e);
    let producerPausePromise = null;

    if (
      !lockMultipleTargetsEnabled
      && hasActiveTalkLocks()
      && e.currentTarget
      && !isTalkButtonLocked(e.currentTarget)
    ) {
      return;
    }

    if (inputKey !== null && activeTalkPointers.has(inputKey)) {
      removePressedTalkPointer(inputKey);
      if (currentTargets.length > 0) {
        emitTalkTargetsUpdated('talk-targets-updated', currentTargets);
        emitPttState('talk-targets-updated', {
          talking: true,
          lockActive: hasActiveTalkLocks(),
          target: currentTargets[0] || null,
          targets: currentTargets,
        });
        applyFeedDucking();
        return;
      }
    }

    isTalking = false;
    setSelfTalkingKey(null);
    if (pendingTalkStart) {
      pendingTalkStart.canceled = true;
    }

    setReplyButtonActive(false);
    clearLockState();
    emitTalkTargetsUpdated('talk-targets-cleared', []);

    if (producer && !producer.closed) {
      producerPausePromise = pauseTalkProducer(producer).catch((error) => {
        console.warn('Failed to pause talk producer, closing it instead:', error);
        const staleProducer = producer;
        if (staleProducer && !staleProducer.closed) {
          notifyServerProducerClosed(staleProducer.id, { context: 'talk-stop-pause-failed' });
          staleProducer.close();
        }
        if (producer === staleProducer) {
          producer = null;
        }
      });
    }

    if (audioProcessingReinitializePending) {
      audioProcessingReinitializePending = false;
      queueMicrotask(() => {
        refreshTalkProducerForAudioProcessingChange?.().catch((error) => {
          console.warn('Failed to apply deferred audio processing change:', error);
        });
      });
    }

    if (micTrack && !settingsMenuOpen && !(voiceTriggerEnabled && isOperatorSession())) {
      micTrack.enabled = false;
    }
    if (userProcessingChain?.outputTrack) {
      userProcessingChain.outputTrack.enabled = false;
    }

    scheduleMicCleanup();

    currentTargetPeer = null;
    clearPressedTalkPointers();
    applyFeedDucking();
    if (inputKey === null) {
      clearHotkeyActiveStyles();
      pressedHotkeyBindings.clear();
    }
    emitPttState('talk-stopped', { talking: false, lockActive: false, target: null, targets: [] });

    if (shouldRestoreSuspendedLock) {
      if (producerPausePromise) {
        producerPausePromise.finally(() => scheduleRestoreSuspendedLock());
      } else {
        scheduleRestoreSuspendedLock();
      }
    }
  }

  socket.on('force-stop-transmission', () => {
    clearSuspendedLockState();
    if (voiceTriggerEnabled) {
      voiceTriggerAdminInhibited = true;
      voiceTriggerActive = false;
      voiceTriggerAboveSince = 0;
      voiceTriggerBelowSince = 0;
      setVoiceTriggerState('armed');
    }
    handleStopTalking({
      preventDefault() {},
      currentTarget: null,
      suppressLockRestore: true,
    });
  });

  // Safety stop so PTT can't get stuck on iOS/background transitions.
  function stopTalkingSafely({ respectLock = false, pointerId = null } = {}) {
    if (!isOperatorSession()) return;
    // An idle warm producer is already paused; unrelated pointer releases need no stop.
    if ((!producer || producer.closed || producer.paused)
      && !isTalking && !pendingTalkStart && currentTargets.length === 0
      && activeTalkPointers.size === 0 && !hasActiveTalkLocks()) return;
    if (respectLock && hasActiveTalkLocks()) return;
    if (pointerId !== null) {
      if (activeTalkPointers.has(pointerId)) {
        handleStopTalking({ preventDefault() {}, currentTarget: null, pointerId });
        return;
      }
      if (activeTalkPointers.size > 0) {
        return;
      }
    }
    handleStopTalking({ preventDefault() {}, currentTarget: null });
  }

  function stopTalkingIfHidden() {
    refreshAdaptiveReceivePlaybackForVisibility('visibilitychange');
    if (document.visibilityState === 'hidden') {
      // When switching tabs, the document becomes hidden. Don't force-stop if
      // talk lock is active.
      stopTalkingSafely({ respectLock: true });
      return;
    }
    if (document.visibilityState === 'visible') {
      requestSessionRecovery('visibility-visible');
      pruneIncomingStreamBookkeeping();
      primeVisibleRemotePlaybackBuses({ forceRetry: true });
      const sharedCtx = sharedAudioContext && sharedAudioContext.state !== 'closed'
        ? sharedAudioContext
        : null;
      if (sharedCtx) {
        resumeAudioContextIfNeeded(sharedCtx, { label: 'shared AudioContext' });
      }
      if (feedProcessingAudioContext && feedProcessingAudioContext.state !== 'closed') {
        resumeAudioContextIfNeeded(feedProcessingAudioContext, { label: 'feed ingest AudioContext' });
      }
      recoverExistingIncomingPlayback();
      if (mediaInitialized) {
        requestActiveProducers().catch(() => {});
      }
    }
  }

  document.addEventListener('visibilitychange', stopTalkingIfHidden);
  window.addEventListener('pagehide', () => stopTalkingSafely());
  window.addEventListener('blur', () => stopTalkingSafely({ respectLock: true }));
  window.addEventListener('focus', () => {
    requestSessionRecovery('window-focus');
    pruneIncomingStreamBookkeeping();
    const sharedCtx = sharedAudioContext && sharedAudioContext.state !== 'closed'
      ? sharedAudioContext
      : null;
    if (sharedCtx) {
      resumeAudioContextIfNeeded(sharedCtx, { label: 'shared AudioContext' });
    }
    if (feedProcessingAudioContext && feedProcessingAudioContext.state !== 'closed') {
      resumeAudioContextIfNeeded(feedProcessingAudioContext, { label: 'feed ingest AudioContext' });
    }
    recoverExistingIncomingPlayback();
    if (mediaInitialized) {
      requestActiveProducers().catch(() => {});
    }
  });
  window.addEventListener('pageshow', () => {
    requestSessionRecovery('pageshow');
    const sharedCtx = sharedAudioContext && sharedAudioContext.state !== 'closed'
      ? sharedAudioContext
      : null;
    if (sharedCtx) {
      resumeAudioContextIfNeeded(sharedCtx, { label: 'shared AudioContext' });
    }
    if (feedProcessingAudioContext && feedProcessingAudioContext.state !== 'closed') {
      resumeAudioContextIfNeeded(feedProcessingAudioContext, { label: 'feed ingest AudioContext' });
    }
    recoverExistingIncomingPlayback();
    if (mediaInitialized) {
      requestActiveProducers().catch(() => {});
      setTimeout(() => {
        recoverExistingIncomingPlayback();
      }, 250);
    }
  });
  window.addEventListener('online', () => requestSessionRecovery('network-online'));
  const handleGlobalPointerRelease = (e) => {
    const pointerId = Number.isFinite(Number(e?.pointerId)) ? Number(e.pointerId) : null;
    stopTalkingSafely({ respectLock: true, pointerId });
  };

  window.addEventListener('pointerup', handleGlobalPointerRelease);
  window.addEventListener('pointercancel', handleGlobalPointerRelease);
  window.addEventListener('touchend', () => {
    if (typeof window !== 'undefined' && 'PointerEvent' in window) return;
    stopTalkingSafely({ respectLock: true });
  }, { passive: true });
  window.addEventListener('touchcancel', () => {
    if (typeof window !== 'undefined' && 'PointerEvent' in window) return;
    stopTalkingSafely({ respectLock: true });
  }, { passive: true });

  function isTextInput(el) {
    const tag = (el?.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable;
  }

  window.addEventListener('keydown', (e) => {
    if (!activeHotkeyCaptureTargetIdentity) return;
    if (e.repeat) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    if (e.key === 'Escape') {
      stopHotkeyCapture();
      return;
    }

    const binding = getRecordableHotkeyBinding(e);
    if (!binding) return;
    setCustomHotkeyForTarget(activeHotkeyCaptureTargetIdentity, binding);
  }, { capture: true });

  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (!canUseTargetHotkeys(e)) return;
    const assignment = getHotkeyAssignmentForEvent(e);
    if (!assignment) return;
    const bindingId = assignment.binding?.id || null;
    if (!bindingId || pressedHotkeyBindings.has(bindingId)) return;
    const talkTarget = resolveHotkeyAssignmentTarget(assignment);
    if (!talkTarget) return;

    pressedHotkeyBindings.add(bindingId);
    e.preventDefault();
    setHotkeyAssignmentActiveState(assignment, true);
    const liveTalkTarget = resolveLiveTalkTarget(talkTarget);
    if (!liveTalkTarget) return;
    handleTalk({
      preventDefault() {},
      talkInputKey: `hotkey:${bindingId}`,
    }, liveTalkTarget);
  });

  window.addEventListener('keyup', e => {
    const assignment = getHotkeyAssignmentForEvent(e);
    if (!assignment) return;
    const bindingId = assignment.binding?.id || null;
    if (!bindingId || !pressedHotkeyBindings.has(bindingId)) return;
    pressedHotkeyBindings.delete(bindingId);
    setHotkeyAssignmentActiveState(assignment, false);
    e.preventDefault();
    const talkInputKey = `hotkey:${bindingId}`;
    if (!activeTalkPointers.has(talkInputKey)) return;
    handleStopTalking({
      preventDefault() {},
      currentTarget: null,
      talkInputKey,
    });
  });


  // Initial connection check
  console.log("Socket connected?", socket.connected);
});
