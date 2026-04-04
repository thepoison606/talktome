const socket = io();

socket.on("cut-camera", (value) => {
  document.body.classList.toggle("cut-camera", value);
});

const BASE_REPLY_LABEL = "REPLY";
const QUALITY_PROFILES = {
  "ultra-low": {
    label: "Ultra low (5 ms, DTX on)",
    codecLabel: "opus 48k",
    codecOptions: {
      opusStereo: 0,
      opusFec: 0,
      opusDtx: 1,
      opusMaxAverageBitrate: 48000,
      opusPtime: 5,
    },
    encodings: [{ dtx: true, maxBitrate: 48000, priority: 'high' }],
    constraints: { channelCount: 1, sampleRate: 48000 },
    note: "minimal latency, best on stable networks",
  },
  low: {
    label: "Low (10 ms, DTX on)",
    codecLabel: "opus 48k",
    codecOptions: {
      opusStereo: 0,
      opusFec: 0,
      opusDtx: 1,
      opusMaxAverageBitrate: 64000,
      opusPtime: 10,
    },
    encodings: [{ dtx: true, maxBitrate: 64000, priority: 'high' }],
    constraints: { channelCount: 1, sampleRate: 48000 },
    note: "balanced latency vs. robustness",
  },
  standard: {
    label: "Standard (20 ms, DTX off)",
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
const IDENTITY_KIND_KEY = 'identityKind';
const FEED_ID_STORAGE_KEY = 'feedId';
const FEED_DUCKING_DB_STORAGE_KEY = 'feedDimDb';
const FEED_INPUT_PROCESSING_STORAGE_KEY = 'feedInputProcessingEnabled';
const FEED_PTIME_STORAGE_KEY = 'feedPtimeMs';
const DEFAULT_FEED_DUCKING_DB = -14;
const DEFAULT_FEED_PTIME_MS = 20;
const FEED_DUCKING_DB_MIN = -60;
const FEED_DUCKING_DB_MAX = -6;
const FEED_DIM_SELF_STORAGE_KEY = 'feedDimSelf';
const AUDIO_PROCESSING_STORAGE_KEY = 'audioProcessingEnabled';
const FEED_INPUT_GAIN_DB_STORAGE_KEY = 'feedInputGainDb';
const OUTPUT_DEVICE_STORAGE_KEY = 'preferredAudioOutputDeviceId';
const FEED_INPUT_GAIN_DB_MIN = -30;
const FEED_INPUT_GAIN_DB_MAX = 40;
const FEED_METER_MIN_DB = -60;
const FEED_CLIP_THRESHOLD_DB = -0.5;
const USER_INPUT_GAIN_DB_STORAGE_KEY = 'userInputGainDb';
const USER_INPUT_GAIN_DB_MIN = -30;
const USER_INPUT_GAIN_DB_MAX = 40;
const USER_METER_MIN_DB = -60;
const USER_CLIP_THRESHOLD_DB = -0.5;
const FEED_METER_TEXT_UPDATE_INTERVAL_MS = 160;
const USER_METER_TEXT_UPDATE_INTERVAL_MS = 160;
const METER_TEXT_DB_THRESHOLD = 0.5;
const FEED_PTIME_OPTIONS = Object.freeze({
  5: { label: '5 ms (lowest latency, highest load)' },
  10: { label: '10 ms (balanced latency/load)' },
  20: { label: '20 ms (highest resilience, lowest load)' },
});

const TARGET_HOTKEY_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const targetHotkeys = new Map();
const pressedHotkeyDigits = new Set();

let feedDuckingDb = DEFAULT_FEED_DUCKING_DB;
let feedDuckingFactor = dbToLinear(feedDuckingDb);
let feedDimSelf = false;
let audioProcessingEnabled = false;
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
let preferredOutputDeviceId = '';
const USER_AGENT = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
const isTouchMacUA = typeof navigator !== 'undefined'
  ? navigator.maxTouchPoints > 1 && /Macintosh/.test(USER_AGENT)
  : false;
const isMobileBrowser = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobi/i.test(USER_AGENT)
  || isTouchMacUA;

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
    const storedFeedInputProcessing = window.localStorage?.getItem(FEED_INPUT_PROCESSING_STORAGE_KEY);
    if (storedFeedInputProcessing !== null) {
      feedInputProcessingEnabled = storedFeedInputProcessing === 'true';
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
    const storedProcessing = window.localStorage?.getItem(AUDIO_PROCESSING_STORAGE_KEY);
    if (storedProcessing !== null) {
      audioProcessingEnabled = storedProcessing === 'true';
    } else {
      // Default: enable processing on mobile, disable on desktop
      try {
        audioProcessingEnabled = !!isMobileBrowser;
      } catch (err) {
        // If detection fails, fall back to desktop default (off)
        audioProcessingEnabled = false;
      }
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
  } catch (err) {
    console.warn('Unable to restore feed dim level from storage:', err);
  }
}
syncAudioProcessingOptions();
const isiOS = typeof navigator !== 'undefined'
  ? /iPad|iPhone|iPod/.test(USER_AGENT) || isTouchMacUA
  : false;

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

let session = { kind: 'guest', userId: null, feedId: null, name: null };
let device = null;
let sendTransport = null;
let recvTransport = null;
let producer = null;

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
let dimWhileSpeakingToggle;
let audioProcessingToggle;
let userLevelControls;
let userInputGainSlider;
let userInputGainValueDisplay;
let userMeterBarEl;
let userMeterClipEl;
let userMeterValueEl;
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
const MIC_DEVICE_STORAGE_KEY = 'preferredAudioInputDeviceId';

let micStream = null;
let micTrack = null;
let micDeviceId = null;
let micCleanupTimer = null;
let micPrimed = false;
let micPrimingPromise = null;

let feedStreaming = false;
let feedManualStop = false;
let shouldStartFeedWhenReady = false;
let isTalking = false;
let pendingTalkStart = null;
const USER_ACTIVATION_EVENTS = ['pointerdown', 'mousedown', 'click', 'touchstart', 'keydown'];
const ACTIVE_PRODUCERS_SYNC_INTERVAL_MS = 10000;
const UI_ICONS = {
  talk: '/images/walkie-talkies-white.png',
  speakerOn: '/images/speaker-white.png',
  speakerMuted: '/images/speaker-muted.png',
};
const pendingAutoplayAudios = new Set();
let sharedAudioContext = null;
let feedProcessingAudioContext = null;
let onAudioContextRunning = null;
let audioContextPrimed = false;
let feedProcessingChain = null;
let feedPlaybackBus = null;
let userProcessingChain = null;
let settingsMonitorActive = false;
let settingsMonitorPromise = null;
let settingsMenuOpen = false;

function clampFeedDuckingDb(value) {
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
    if (typeof onRunning === 'function' && typeof ctx.addEventListener === 'function') {
      ctx.addEventListener('statechange', () => {
        if (ctx.state === 'running') {
          onRunning();
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
    if (typeof onRunning === 'function') {
      onRunning();
    }
    return;
  }
  if (ctx.state !== 'suspended' || typeof ctx.resume !== 'function') {
    return;
  }
  try {
    await ctx.resume();
  } catch (err) {
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
  if (applied) {
    destroyUserProcessing();
  } else if (micTrack && session.kind !== 'feed' && !reinitialize) {
    ensureUserProcessingChain(micTrack);
  }

  if (persist && typeof window !== 'undefined') {
    try {
      window.localStorage?.setItem(AUDIO_PROCESSING_STORAGE_KEY, String(applied));
    } catch (err) {
      console.warn('Unable to persist audio processing preference:', err);
    }
  }

  if (reinitialize) {
    cleanupMicTrack();
    if (settingsMenuOpen) {
      startInputMonitor();
    }
  } else if (settingsMenuOpen) {
    startInputMonitor();
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

function setPreferredInputDeviceId(deviceId) {
  const normalized = deviceId || '';
  if (normalized) {
    localStorage.setItem(MIC_DEVICE_STORAGE_KEY, normalized);
  } else {
    localStorage.removeItem(MIC_DEVICE_STORAGE_KEY);
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
  const selected = inputSelect?.value || feedInputSelect?.value;
  if (selected && selected !== '') return selected;
  try {
    const stored = window.localStorage?.getItem(MIC_DEVICE_STORAGE_KEY);
    return stored || null;
  } catch {
    return null;
  }
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

async function startInputMonitor() {
  if (!settingsMenuOpen) return null;
  if (settingsMonitorActive || settingsMonitorPromise) {
    return settingsMonitorPromise;
  }
  if (session.kind === 'guest') return null;

  const { constraints, selectedDeviceId } = getCurrentAudioConstraints();
  const startPromise = (async () => {
    try {
      const track = await ensureMicTrack(constraints, selectedDeviceId);
      if (!track) return null;
      if (!settingsMenuOpen) {
        if (!producer && !feedStreaming && !isTalking) {
          try { track.enabled = false; } catch {}
        }
        return null;
      }

      track.enabled = true;
      settingsMonitorActive = true;

      if (session.kind !== 'feed' && !audioProcessingEnabled) {
        ensureUserProcessingChain(track);
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
      if (!audioProcessingEnabled && userProcessingChain) {
        scheduleUserMeterUpdate();
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

  if (producer || feedStreaming || isTalking) {
    return;
  }

  cleanupMicTrack();
}

function handleSettingsMenuOpened() {
  if (settingsMenuOpen) return;
  settingsMenuOpen = true;
  startInputMonitor();
}

function handleSettingsMenuClosed() {
  if (!settingsMenuOpen) return;
  settingsMenuOpen = false;
  stopInputMonitor();
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
    setUserMeterDisplay(0, formatDbDisplay(-Infinity), false, null, { forceText: true });
  } else if (userProcessingChain) {
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
  }

  if (apply && userProcessingChain?.gainNode) {
    userProcessingChain.gainNode.gain.value = userInputGainLinear;
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

function destroyUserProcessing({ resetUI = true } = {}) {
  if (!userProcessingChain) return;
  if (userProcessingChain.rafId) {
    cancelAnimationFrame(userProcessingChain.rafId);
  }
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

  if (resetUI) {
    setUserMeterDisplay(0, formatDbDisplay(-Infinity), false, null, { forceText: true });
  }
}

function scheduleUserMeterUpdate() {
  if (!userProcessingChain) return;
  if (userProcessingChain.rafId) return;
  const tick = () => {
    if (!userProcessingChain) return;
    userProcessingChain.rafId = null;
    updateUserMeterFromAnalyser();
    if (userProcessingChain) {
      userProcessingChain.rafId = requestAnimationFrame(tick);
    }
  };
  userProcessingChain.rafId = requestAnimationFrame(tick);
}

function updateUserMeterFromAnalyser() {
  const chain = userProcessingChain;
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
    if (!userProcessingChain.rafId) {
      scheduleUserMeterUpdate();
    }
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

  const meterData = new Float32Array(analyser.fftSize);

  userProcessingChain = {
    ctx,
    originalTrack: track,
    sourceStream,
    sourceNode,
    gainNode,
    analyser,
    destination,
    outputTrack,
    meterData,
    rafId: null,
    clipHoldFrames: 0,
  };

  setUserMeterDisplay(0, formatDbDisplay(-Infinity), false, null, { forceText: true });
  scheduleUserMeterUpdate();

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

function attemptPendingAutoplay() {
  pendingAutoplayAudios.forEach(audio => {
    const playPromise = audio.play?.();
    if (!playPromise || typeof playPromise.then !== 'function') {
      if (!audio.paused) {
        pendingAutoplayAudios.delete(audio);
      }
      return;
    }
    playPromise
      .then(() => pendingAutoplayAudios.delete(audio))
      .catch(err => console.warn('Autoplay retry failed:', err));
  });
}

function handleUserActivation() {
  attemptPendingAutoplay();
  primeVoiceProcessingMode().catch(() => {});
  const sharedCtx = ensureAudioContext();
  resumeAudioContextIfNeeded(sharedCtx, {
    label: 'shared AudioContext',
    onRunning: typeof onAudioContextRunning === 'function' ? onAudioContextRunning : null,
  });
  if (feedProcessingAudioContext) {
    resumeAudioContextIfNeeded(feedProcessingAudioContext, { label: 'feed ingest AudioContext' });
  }
}

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
  // Request microphone access first (labels are often empty otherwise)
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    console.warn("No microphone access; device labels may be empty", e);
  }

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
    const storedDeviceId = localStorage.getItem(MIC_DEVICE_STORAGE_KEY);
    const availableIds = new Set(inputs.map(d => d.deviceId));
    let desiredDeviceId = null;

    if (micDeviceId && availableIds.has(micDeviceId)) {
      desiredDeviceId = micDeviceId;
    } else if (storedDeviceId && availableIds.has(storedDeviceId)) {
      desiredDeviceId = storedDeviceId;
    } else if (inputs[0]) {
      desiredDeviceId = inputs[0].deviceId;
    }

    if (desiredDeviceId) {
      setPreferredInputDeviceId(desiredDeviceId);
    } else {
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
  destroyUserProcessing();

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

function scheduleMicCleanup() {
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
    setPreferredInputDeviceId(micDeviceId);
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

  return micTrack;
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

  return 'ultra-low';
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded, initializing...");

  inputSelect  = document.getElementById("input-select");
  feedInputSelect = document.getElementById("feed-input-select");
  outputDeviceSelector = document.getElementById("output-device-selector");
  outputSelect = document.getElementById("output-select");
  qualitySelect = document.getElementById("quality-select");
  dimAmountSelect = document.getElementById('dim-amount-select');
  dimWhileSpeakingToggle = document.getElementById('toggle-self-dim');
  audioProcessingToggle = document.getElementById('toggle-processing');
  userLevelControls = document.getElementById('user-level-controls');
  userInputGainSlider = document.getElementById('user-input-gain');
  userInputGainValueDisplay = document.getElementById('user-input-gain-value');
  userMeterBarEl = document.getElementById('user-meter-bar');
  userMeterClipEl = document.getElementById('user-meter-clip');
  userMeterValueEl = document.getElementById('user-meter-value');
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

  if (audioProcessingToggle) {
    audioProcessingToggle.checked = audioProcessingEnabled;
    audioProcessingToggle.addEventListener('change', () => {
      setAudioProcessingEnabled(audioProcessingToggle.checked);
    });
  }

  const storedQuality = localStorage.getItem('audioQualityProfile');
  if (qualitySelect) {
    if (storedQuality && QUALITY_PROFILES[storedQuality]) {
      qualitySelect.value = storedQuality;
    } else {
      qualitySelect.value = 'ultra-low';
      localStorage.setItem('audioQualityProfile', 'ultra-low');
    }

    qualitySelect.addEventListener('change', () => {
      const selected = qualitySelect.value;
      if (!QUALITY_PROFILES[selected]) {
        qualitySelect.value = 'ultra-low';
      }
      localStorage.setItem('audioQualityProfile', qualitySelect.value);
      cleanupMicTrack();
    });
  } else if (!storedQuality || !QUALITY_PROFILES[storedQuality]) {
    localStorage.setItem('audioQualityProfile', 'ultra-low');
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
    const enabled = !!value;
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

  updateDeviceList().catch(err => console.error("updateDeviceList failed:", err));
  navigator.mediaDevices.addEventListener("devicechange", () =>
      updateDeviceList().catch(err => console.error(err))
  );

  const handleInputDeviceSelectionChange = (selected) => {
    setPreferredInputDeviceId(selected);
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
  const intercomApp = document.getElementById("intercom-app");
  const loginError = document.getElementById("login-error");
  const logoutBtn = document.getElementById("logout-btn");
  const feedLogoutBtn = document.getElementById("feed-logout-btn");

  const myIdEl = document.getElementById("my-id");
  const btnReply = document.getElementById("reply");
  if (btnReply) {
    btnReply.setAttribute("aria-pressed", "false");
  }
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
  const feedDimmingDisabled = new Set();
  const activeFeedKeys = new Set();
  // Server-authoritative set of user/conference targets that are currently addressing us.
  const speakingPeers = new Set();
  const mutedPeers = new Set();
  const pendingProducerQueue = [];
let currentTargetPeer = null;
let lastTarget = null;
let currentTarget = null;
let selfTalkingKey = null;
let cachedUsers = [];
  let incomingTalkState = { addressedNow: [], replyTarget: null };
  let mediaInitialized = false;
  let initializingMediaPromise = null;
  let shouldInitializeAfterConnect = false;
  let activeLockButton = null;
  let activeLockTarget = null;
  let suspendedLockState = null;
  let suspendedLockRestoreTimer = null;
  let pendingPttSizingRaf = null;
  let pttSizingListenerBound = false;
  let streamPruneInterval = null;
  let activeProducerSyncInterval = null;
  let activeProducersSyncInFlight = false;
  let pendingIncomingConsumeKeys = new Set();
  let slideHintShown = false;

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
      const audioEl = entry?.audio;
      if (audioEl && typeof audioEl.setSinkId === 'function') {
        sinkPromises.push(
          audioEl.setSinkId(resolvedDeviceId).catch(err => {
            console.warn('Failed to apply audio output device to audio element:', err);
          })
        );
      }
    });
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
    if (target.type !== 'user' && target.type !== 'conference') return null;
    const numericId = Number(target.id);
    return {
      type: target.type,
      id: Number.isFinite(numericId) ? numericId : String(target.id),
    };
  }

  function getCurrentPttState(overrides = {}) {
    const baseTarget = overrides.target !== undefined
      ? overrides.target
      : (currentTarget || activeLockTarget || null);
    return {
      talking: typeof overrides.talking === 'boolean' ? overrides.talking : Boolean(isTalking || producer),
      lockActive: typeof overrides.lockActive === 'boolean' ? overrides.lockActive : Boolean(activeLockButton),
      target: normalizePttTarget(baseTarget),
    };
  }

  function emitPttState(reason, overrides = {}) {
    if (session.kind !== 'user') return;
    if (!socket.connected) return;
    const state = getCurrentPttState(overrides);
    socket.emit('ptt-state', {
      ...state,
      reason: reason || undefined,
    });
  }

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

  function isTargetSpeaking(targetKey) {
    return speakingPeers.has(targetKey) || activeFeedKeys.has(targetKey);
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
    const { peerId, appData } = payload;
    if (!appData || typeof appData !== 'object') return null;
    if (appData.type === 'conference') return `conf-${appData.id}`;
    if (appData.type === 'feed') return `feed-${appData.id}`;
    return `user-${peerId}`;
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

  function cleanupIncomingStream(targetKey, streamKey, { suppressUi = false } = {}) {
    const consumersSet = peerConsumers.get(streamKey);
    if (consumersSet) {
      consumersSet.forEach(c => {
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
        if (session.kind === 'user') {
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
    pendingAutoplayAudios.clear();
    activeFeedKeys.clear();
    confAudioElements.clear();
    feedAudioElements.clear();
  }

  function disconnectPlaybackNodes(entry) {
    if (!entry) return;
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

  function disposePlaybackEntry(entry) {
    if (!entry?.audio) return;
    pendingAutoplayAudios.delete(entry.audio);
    disconnectPlaybackNodes(entry);
    try { entry.audio.pause?.(); } catch {}
    try { entry.audio.srcObject = null; } catch {}
    entry.audio.remove();
    audioEntryMap.delete(entry.audio);
  }

  function shouldDimFeedEntry(entry) {
    if (session.kind !== 'user') return false;
    if (!feedDuckingActive || feedDuckingFactor >= 0.999) return false;
    const feedId = Number(String(entry?.key || '').slice(5));
    if (!Number.isFinite(feedId)) return false;
    return !feedDimmingDisabled.has(String(feedId));
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

  function setTargetVolumeAndPersist(targetKey, volumeStorageKey, volume) {
    const clamped = Math.max(0, Math.min(1, Number(volume) || 0));
    applyVolumeToTarget(targetKey, clamped);
    storeVolume(volumeStorageKey, clamped);
    updateTargetVolumeSliderUi(targetKey, clamped);
    if (targetKey.startsWith('feed-') && session.kind === 'user') {
      applyFeedDucking();
    }
    emitTargetAudioStateSnapshot('target-audio-volume');
    return clamped;
  }

  onAudioContextRunning = () => {
    if (!audioContextPrimed) {
      audioContextPrimed = true;
      primeVoiceProcessingMode().catch(() => {});
    }
    attemptPendingAutoplay();
    audioElements.forEach((entry) => {
      if (!entry?.gainNode || !entry.audio) return;
      if (entry.type === 'feed' && session.kind === 'user') return;
      if (mutedPeers.has(entry.key)) {
        mutePlaybackEntry(entry);
      } else {
        setPlaybackEntryLevel(entry, entry.volume ?? defaultVolume);
      }
    });
    if (session.kind === 'user') {
      applyFeedDucking();
    }
  };

  function setPlaybackEntryLevel(entry, value) {
    if (!entry || !entry.audio) return;
    const applied = Math.max(0, Math.min(1, value));
    if (entry.gainNode) {
      entry.audio.muted = true;
      entry.audio.volume = 0;
      entry.gainNode.gain.value = applied;
    } else {
      entry.audio.muted = applied === 0;
      entry.audio.volume = applied;
    }
    entry.lastAppliedLevel = applied;
  }

  function mutePlaybackEntry(entry) {
    if (!entry || !entry.audio) return;
    if (entry.gainNode) {
      entry.audio.muted = true;
      entry.audio.volume = 0;
      entry.gainNode.gain.value = 0;
    } else {
      entry.audio.muted = true;
      entry.audio.volume = 0;
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

  function attemptPlayAudio(audioEl) {
    if (!audioEl || typeof audioEl.play !== 'function') return Promise.resolve();
    try {
      const maybePromise = audioEl.play();
      if (maybePromise && typeof maybePromise.then === 'function') {
        return maybePromise
          .then(() => {
            pendingAutoplayAudios.delete(audioEl);
          })
          .catch(err => {
            pendingAutoplayAudios.add(audioEl);
            console.warn('Autoplay blocked, queued for retry:', err);
            throw err;
          });
      }
      pendingAutoplayAudios.delete(audioEl);
      return Promise.resolve();
    } catch (err) {
      pendingAutoplayAudios.add(audioEl);
      console.warn('Autoplay attempt failed, queued for retry:', err);
      return Promise.reject(err);
    }
  }

  function renderReplyButtonLabel() {
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
    btnReply.disabled = true;
    renderReplyButtonLabel();
  }

  function resolveReplyUserSocketId(target) {
    if (!target || target.type !== 'user') return null;
    return resolveUserSocketId(target.id)
      || cachedUsers.find((entry) => String(entry?.socketId) === String(target.id))?.socketId
      || null;
  }

  function updateReplyButtonState() {
    if (!lastTarget) {
      clearReplyTarget();
      return;
    }

    refreshLastTargetLabel();
    const replyUserSocketId = resolveReplyUserSocketId(lastTarget);
    btnReply.disabled = lastTarget.type === 'user' ? !replyUserSocketId : false;
    renderReplyButtonLabel();
  }

  clearReplyTarget();

  function normalizeIncomingAddressedEntry(rawEntry) {
    if (!rawEntry || typeof rawEntry !== 'object') return null;
    const targetType = typeof rawEntry.targetType === 'string' ? rawEntry.targetType.trim().toLowerCase() : '';
    if (targetType !== 'user' && targetType !== 'conference') return null;

    const numericTargetId = Number(rawEntry.targetId);
    const targetId = Number.isFinite(numericTargetId) ? numericTargetId : String(rawEntry.targetId ?? '');
    if (targetId === '') return null;

    const numericFromUserId = Number(rawEntry.fromUserId);
    const at = Number(rawEntry.at);

    return {
      targetType,
      targetId,
      fromUserId: Number.isFinite(numericFromUserId) ? numericFromUserId : null,
      fromName: typeof rawEntry.fromName === 'string' ? rawEntry.fromName : '',
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
      const key = `${entry.targetType}:${entry.targetId}`;
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

  function targetKeyFromIncomingAddressedEntry(entry) {
    if (!entry) return null;
    if (entry.targetType === 'conference') {
      return `conf-${entry.targetId}`;
    }
    if (entry.targetType === 'user') {
      const socketId = resolveUserSocketId(entry.targetId);
      return `user-${socketId || entry.targetId}`;
    }
    return null;
  }

  function resolveReplyTargetFromIncomingEntry(entry) {
    if (!entry) return null;

    if (entry.targetType === 'conference') {
      const conferenceId = Number(entry.targetId);
      if (!Number.isFinite(conferenceId)) return null;
      return {
        type: 'conference',
        id: conferenceId,
        label: conferenceLabels.get(conferenceId) || targetLabels.get(`conf-${conferenceId}`) || String(conferenceId),
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
    if (session.kind !== 'user') return;

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

    const replyTarget = resolveReplyTargetFromIncomingEntry(incomingTalkState.replyTarget)
      || resolveReplyTargetFromIncomingEntry(incomingTalkState.addressedNow[0] || null);
    if (replyTarget) {
      lastTarget = replyTarget;
    }
    updateReplyButtonState();

    applyFeedDucking();
  }

  function applySessionUI() {
    const isFeed = session.kind === 'feed';
    document.body.classList.toggle('feed-mode', isFeed);

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
        audioProcessingToggle.checked = audioProcessingEnabled;
        syncAudioProcessingOptions();
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
      dimWhileSpeakingToggle.disabled = isFeed;
      if (!isFeed) {
        dimWhileSpeakingToggle.checked = feedDimSelf;
      }
    }

    updateFeedProcessingUI();
    updateFeedPtimeUI();
    applyUserGainControlState();
    updateFeedControls();
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
    if (session.kind !== 'user') return;
    const shouldDimSelf = feedDimSelf && isTalking;
    const shouldDuck = speakingPeers.size > 0 || shouldDimSelf;
    feedDuckingActive = shouldDuck;

    for (const [feedId, audios] of feedAudioElements) {
      const key = `feed-${feedId}`;
      const tile = document.getElementById(key);
      const dimDisabled = feedDimmingDisabled.has(String(feedId));
      const shouldDim = shouldDuck && !dimDisabled && feedDuckingFactor < 0.999;
      tile?.classList.toggle('feed-dimmed', shouldDim);

      for (const audioEl of audios) {
        const entry = audioEntryMap.get(audioEl);
        if (!entry) continue;
        if (mutedPeers.has(key)) {
          muteFeedEntry(entry);
          continue;
        }

        if (entry.feedDuckingNode) {
          entry.feedDuckingNode.gain.value = shouldDim ? feedDuckingFactor : 1;
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

    initializingMediaPromise = (async () => {
      await initializeMediaSoup();
      mediaInitialized = true;
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
      });
    }
  }

  function clearStoredIdentity() {
    localStorage.removeItem("userId");
    localStorage.removeItem(FEED_ID_STORAGE_KEY);
    localStorage.removeItem("userName");
    localStorage.removeItem(IDENTITY_KIND_KEY);
  }

  function sendLogoutBeacon() {
    if (session?.kind !== 'user' || !session?.userId) return;
    if (typeof navigator?.sendBeacon !== 'function') return;
    const payload = JSON.stringify({
      userId: Number(session.userId),
      socketId: socket?.id || null,
    });
    try {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon('/api/v1/client/logout', blob);
    } catch {}
  }

  async function notifyServerLogoutViaHttp({ timeoutMs = 800 } = {}) {
    if (session?.kind !== 'user' || !session?.userId) return;

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
          userId: Number(session.userId),
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

  async function hardLogoutAndReload(message = null) {
    try {
      if (message) alert(message);
    } catch {}
    try {
      if (session?.kind === 'feed') {
        stopFeedStream({ manual: true });
      }
    } catch {}
    await notifyServerLogoutAndDisconnect();
    clearStoredIdentity();
    location.reload();
  }

  window.addEventListener("pagehide", () => {
    sendLogoutBeacon();
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

  async function registerUserWithConflictPrompt({ id, name, kind, allowPrompt = true } = {}) {
    const first = await emitRegisterUser({ id, name, kind, force: false });
    if (first?.conflict && kind === 'user') {
      if (!allowPrompt) return { conflict: true };
      const existingName = first?.existing?.name ? ` (${first.existing.name})` : '';
      const ok = confirm(`This user is already signed in${existingName}. Sign out the other session?`);
      if (!ok) return { cancelled: true };
      const forced = await emitRegisterUser({ id, name, kind, force: true });
      return forced?.ok ? { ok: true } : forced;
    }
    return first?.ok ? { ok: true } : first;
  }

  function buildRegistrationKey({ id, name, kind, allowPrompt = true } = {}) {
    return JSON.stringify({
      id: id ?? null,
      name: name ?? null,
      kind: kind ?? null,
      allowPrompt: !!allowPrompt,
    });
  }

  async function registerIdentity({ id, name, kind, allowPrompt = true } = {}) {
    const key = buildRegistrationKey({ id, name, kind, allowPrompt });
    if (activeRegistrationPromise && activeRegistrationKey === key) {
      return activeRegistrationPromise;
    }

    const promise = (async () => {
      if (kind === 'user') {
        return registerUserWithConflictPrompt({ id, name, kind, allowPrompt });
      }
      const result = await emitRegisterUser({ id, name, kind, force: false });
      return result?.ok ? { ok: true } : result;
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
    if (!session?.name || session.kind === 'guest') return { skipped: true };
    const id = session.kind === 'feed' ? session.feedId : session.userId;
    return registerIdentity({
      id,
      name: session.name,
      kind: session.kind,
      allowPrompt: allowPromptForUser,
    });
  }

  // Check Auto-Login
  const storedName = localStorage.getItem("userName");
  const storedKindRaw = localStorage.getItem(IDENTITY_KIND_KEY);
  const fallbackKind = localStorage.getItem("userId") ? "user" : "guest";
  const storedKind = storedKindRaw || fallbackKind;

  if (storedKind === "user") {
    const storedId = localStorage.getItem("userId");
    if (storedId && storedName) {
      session = { kind: "user", userId: storedId, feedId: null, name: storedName };
      console.log("Auto-login as:", storedName);
      loginContainer.style.display = "none";
      intercomApp.style.display = "flex";
      myIdEl.textContent = storedName;
      registerCurrentSession()
        .then((res) => {
          if (res?.ok) return;
          hardLogoutAndReload("Login cancelled or session already in use.");
        });
      applySessionUI();
      initializeMediaIfPossible();
    }
  } else if (storedKind === "feed") {
    const storedFeedId = localStorage.getItem(FEED_ID_STORAGE_KEY);
    if (storedFeedId && storedName) {
      session = { kind: "feed", userId: null, feedId: storedFeedId, name: storedName };
      console.log("Auto-login feed:", storedName);
      loginContainer.style.display = "none";
      intercomApp.style.display = "flex";
      myIdEl.textContent = storedName;
      feedManualStop = false;
      shouldStartFeedWhenReady = true;
      registerCurrentSession().catch(() => {});
      applySessionUI();
      initializeMediaIfPossible();
    }
  }

  // Login Handler
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("login-username").value;
    const password = document.getElementById("login-password").value;

    loginError.textContent = "";

    try {
      const res = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      });

      if (!res.ok) {
        loginError.textContent = "Invalid username or password";
        return;
      }

      const user = await res.json();
      console.log("Logged in as:", user);

      const kind = user.kind === 'feed' ? 'feed' : 'user';

      session = {
        kind,
        userId: kind === 'user' ? String(user.id) : null,
        feedId: kind === 'feed' ? String(user.id) : null,
        name: user.name,
      };

      feedManualStop = false;
      shouldStartFeedWhenReady = kind === 'feed';

      const reg = await registerCurrentSession();
      if (!reg?.ok) {
        loginError.textContent = kind === 'user'
          ? (reg?.cancelled ? "Login cancelled" : "Unable to sign in")
          : "Unable to sign in";
        session = { kind: "guest", userId: null, feedId: null, name: null };
        return;
      }

      localStorage.setItem("userName", user.name);
      localStorage.setItem(IDENTITY_KIND_KEY, kind);
      if (kind === 'user') {
        localStorage.setItem("userId", session.userId);
        localStorage.removeItem(FEED_ID_STORAGE_KEY);
      } else {
        localStorage.setItem(FEED_ID_STORAGE_KEY, session.feedId);
        localStorage.removeItem("userId");
      }

      loginContainer.style.display = "none";
      intercomApp.style.display = "flex";
      myIdEl.textContent = user.name;
      applySessionUI();
      initializeMediaIfPossible();
    } catch (err) {
      loginError.textContent = "Error logging in";
      console.error("Login failed:", err);
    }
  });

  async function handleLogoutClick() {
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
  socket.on("connect", async () => {
    console.log("Connected to signaling server as", socket.id);
    if (session.name) {
      if ((session.kind === 'user' && session.userId) || (session.kind === 'feed' && session.feedId)) {
        const reg = await registerCurrentSession();
        if (!reg?.ok) {
          if (session.kind === 'user') {
            hardLogoutAndReload("You are already signed in on another device.");
          }
          return;
        }
      }
      myIdEl.textContent = session.name;
    }

    if (!shouldInitializeAfterConnect && session.kind !== 'guest' && session.name) {
      shouldInitializeAfterConnect = true;
    }

    if (shouldInitializeAfterConnect) {
      try {
        await ensureMediaInitialized();
      } catch (err) {
        console.error('Media initialization on connect failed:', err);
      }
    }

    if (session.kind === 'feed' && !feedManualStop) {
      shouldStartFeedWhenReady = true;
    }

    updateFeedControls();
    if (session.kind === 'user') {
      emitPttState('socket-connect-sync');
    }
  });

  socket.on("session-kicked", () => {
    hardLogoutAndReload("You were signed out because you signed in somewhere else.");
  });

  socket.on("disconnect", () => {
    console.log("Disconnected from server");
    myIdEl.textContent = "Disconnected";
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

    mediaInitialized = false;
    initializingMediaPromise = null;
    device = null;
    sendTransport = null;
    recvTransport = null;
    producer = null;
    pendingProducerQueue.length = 0;

    if (session.kind === 'feed') {
      feedStreaming = false;
      if (!feedManualStop) {
        shouldStartFeedWhenReady = true;
      }
      updateFeedControls();
    }
  });

  socket.on("user-list", async users => {
    cachedUsers = users;
    if (session.kind === 'user') {
      await renderTargetList(users);
      applyIncomingTalkState();
      requestActiveProducers().catch(() => {});
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
    if (session.kind !== 'user') return;
    incomingTalkState = normalizeIncomingTalkState(state);
    applyIncomingTalkState();
  });

  socket.on('user-targets-updated', async () => {
    if (session.kind !== 'user') return;
    if (cachedUsers.length) {
      await renderTargetList(cachedUsers);
    }
    requestActiveProducers().catch(() => {});
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
      volumeStorageKey = `volume_user_${socketId}`;
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

    return { targetKey, volumeStorageKey };
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
        volume: readVisibleTargetVolume(key, `volume_user_${rawUserKey}`),
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
      setTargetVolumeAndPersist(targetConfig.targetKey, targetConfig.volumeStorageKey, nextVolume);
      return { ok: true };
    }

    if (action === 'mute-toggle') {
      setMuteState(targetConfig.targetKey);
      return { ok: true };
    }

    return { ok: false, reason: 'unsupported-action' };
  }

  socket.on('api-talk-command', async ({ commandId = null, action, targetType = 'conference', targetId = null } = {}) => {
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

    const dummyEvent = { preventDefault() {} };

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
        handleStopTalking({ preventDefault() {}, currentTarget: null });
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

  async function renderTargetList(users) {
    if (session.kind !== 'user') return;
    const dbUserId = session.userId;
    if (!dbUserId) return;

    let targets;
    try {
      targets = await fetchJSON(`/users/${dbUserId}/targets`);
    } catch (err) {
      console.error('Failed to fetch targets', err);
      return;
    }

    const list = document.getElementById('targets-list');
    if (!list) return;
    list.innerHTML = '';

    if (pressedHotkeyDigits.size) {
      handleStopTalking({ preventDefault() {}, currentTarget: null });
    }
    pressedHotkeyDigits.clear();
    clearHotkeyActiveStyles();
    targetHotkeys.clear();
    let nextHotkeyIndex = 0;

    const takeHotkeyDigit = () => {
      if (nextHotkeyIndex >= TARGET_HOTKEY_DIGITS.length) return null;
      return TARGET_HOTKEY_DIGITS[nextHotkeyIndex++];
    };

    const applyHotkeyToTarget = (li, labelRow, targetData) => {
      const digit = takeHotkeyDigit();
      if (!digit) return;
      targetHotkeys.set(digit, targetData);
      li.dataset.hotkey = digit;
    };

    targetLabels.clear();

    const usersById = new Map();
    users.forEach(u => {
      if (u.userId == null) return;
      usersById.set(Number(u.userId), u);
      if (u.socketId) {
        targetLabels.set(`user-${u.socketId}`, u.name || u.socketId);
      }
    });

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
      const targetIdNum = Number(target.targetId);
      if (!Number.isFinite(targetIdNum)) return;
      if (session.userId && Number(session.userId) === targetIdNum) return;

      const onlineUser = usersById.get(targetIdNum);
      const socketId = onlineUser?.socketId || null;
      if (socketId && socketId === socket.id) return;

      const isOnline = !!socketId;
      const displayName = target.name || onlineUser?.name || `User ${targetIdNum}`;
      const keyId = isOnline ? socketId : String(targetIdNum);

      const li = document.createElement('li');
      const targetKey = `user-${keyId}`;
      li.id = targetKey;
      li.classList.add('target-item', 'user-target');
      if (!isOnline) {
        li.classList.add('is-offline');
      }

      const hint = document.createElement('div');
      hint.className = 'slide-to-lock-hint';
      hint.textContent = '← Slide to lock';
      hint.setAttribute('aria-hidden', 'true');

      const icon = document.createElement('div');
      icon.className = 'user-icon';
      icon.textContent = displayName ? displayName.charAt(0).toUpperCase() : String(targetIdNum).slice(0, 2);

      const info = document.createElement('div');
      info.className = 'target-info';

      const label = document.createElement('span');
      label.className = 'target-label';
      label.textContent = displayName;
      const labelRow = document.createElement('div');
      labelRow.className = 'target-label-row';
      labelRow.appendChild(label);
      info.appendChild(labelRow);

      const userKey = isOnline ? `volume_user_${socketId}` : null;
      const volSlider = document.createElement('input');
      volSlider.type = 'range';
      volSlider.min = '0';
      volSlider.max = '1';
      volSlider.step = '0.01';
      volSlider.value = isOnline && userKey ? getStoredVolume(userKey).toString() : '1';
      volSlider.className = 'volume-slider';
      volSlider.title = 'Source Volume';
      if (isOnline && userKey) {
        volSlider.addEventListener('input', e => {
          const vol = parseFloat(e.target.value);
          setTargetVolumeAndPersist(targetKey, userKey, vol);
        });
      } else {
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
      if (isOnline) {
        talkBtn.addEventListener('pointerdown', e => {
          e.stopPropagation();
          li.classList.add('ptt-pressing');

          const normalizedTarget = { type: 'user', id: socketId };

          if (activeLockButton) {
            if (activeLockButton === talkBtn) {
              li.classList.remove('ptt-pressing');
              handleStopTalking({ preventDefault() {}, currentTarget: talkBtn });
              return;
            }
            suspendActiveLockState();
            handleStopTalking({ preventDefault() {}, currentTarget: null, suppressLockRestore: true });
          }

          const startX = e.clientX;
          let lockedByGesture = false;

          const onMove = (ev) => {
            if (lockedByGesture || activeLockButton === talkBtn) return;
            if (ev.clientX - startX <= -42) {
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
            if (activeLockButton === talkBtn) return;
            handleStopTalking(ev);
          };

          try { talkBtn.setPointerCapture(e.pointerId); } catch {}
          talkBtn.addEventListener('pointermove', onMove);
          talkBtn.addEventListener('pointerup', onEnd);
          talkBtn.addEventListener('pointercancel', onEnd);
          handleTalk(e, normalizedTarget);
        });
      } else {
        talkBtn.disabled = true;
      }

      const muteBtn = document.createElement('button');
      muteBtn.className = 'mute-btn';
      muteBtn.type = 'button';
      const initialMuted = isOnline && mutedPeers.has(targetKey);
      muteBtn.title = initialMuted ? 'Unmute' : 'Mute';
      const muteIcon = document.createElement('img');
      muteIcon.className = 'btn-icon';
      muteIcon.src = initialMuted ? UI_ICONS.speakerMuted : UI_ICONS.speakerOn;
      muteIcon.alt = '';
      muteIcon.setAttribute('aria-hidden', 'true');
      muteBtn.appendChild(muteIcon);
      if (isOnline) {
        muteBtn.addEventListener('pointerdown', e => e.stopPropagation());
        muteBtn.addEventListener('click', e => {
          e.stopPropagation();
          toggleMute(socketId);
        });
        muteBtn.classList.toggle('muted', mutedPeers.has(targetKey));
      } else {
        muteBtn.disabled = true;
        muteBtn.title = 'Offline';
      }

      const actions = document.createElement('div');
      actions.className = 'target-actions';
      actions.classList.add('ptt-actions');
      actions.append(muteBtn, talkBtn);

      if (isOnline) {
        const isLocked = isSameTarget(activeLockTarget, { type: 'user', id: socketId });
        if (isLocked) {
          activeLockButton = talkBtn;
          setTalkButtonLocked(talkBtn, true);
        }
      }

      if (isOnline) {
        li.append(icon, info, actions, hint);
        applyHotkeyToTarget(li, labelRow, { type: 'user', id: socketId });
      } else {
        li.append(icon, info, actions);
      }

      if (isOnline) {
        let rowPttGestureActive = false;
        let rowPttStartX = 0;
        let rowPttLockedByGesture = false;
        li.addEventListener('pointermove', (e) => {
          if (!rowPttGestureActive) return;
          if (rowPttLockedByGesture || activeLockButton === talkBtn) return;
          if (e.clientX - rowPttStartX <= -42) {
            rowPttLockedByGesture = true;
            activateTalkLock({ type: 'user', id: socketId }, talkBtn);
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
              const targetData = { type: 'user', id: socketId };
              if (activeLockButton && isSameTarget(activeLockTarget, targetData)) {
                handleStopTalking({ preventDefault() {}, currentTarget: activeLockButton });
                return;
              }
              if (activeLockButton && !isSameTarget(activeLockTarget, targetData)) {
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
              if (rowPttGestureActive) {
                rowPttGestureActive = false;
                li.classList.remove('ptt-pressing');
                try { li.releasePointerCapture(e.pointerId); } catch {}
                if (activeLockButton === talkBtn) return;
              }
            }
            handleStopTalking(e);
          });
        });
      }

      list.appendChild(li);
    };

    const appendConferenceTarget = (target) => {
      const id = Number(target.targetId);
      const name = conferenceNames.get(id) || target.name;
      const key = `conf-${id}`;

      const li = document.createElement('li');
      li.id = key;
      li.classList.add('target-item', 'conf-target');
      li.dataset.type = 'conference';
      li.dataset.id = String(id);

      const hint = document.createElement('div');
      hint.className = 'slide-to-lock-hint';
      hint.textContent = '← Slide to lock';
      hint.setAttribute('aria-hidden', 'true');

      const icon = document.createElement('div');
      icon.className = 'conf-icon';
      icon.textContent = '📡';

      const info = document.createElement('div');
      info.className = 'target-info';

      const label = document.createElement('span');
      label.className = 'target-label';
      label.textContent = name;
      const labelRow = document.createElement('div');
      labelRow.className = 'target-label-row';
      labelRow.appendChild(label);
      info.appendChild(labelRow);

      const confKey = `volume_conf_${id}`;
      const confSlider = document.createElement('input');
      confSlider.type = 'range';
      confSlider.min = '0';
      confSlider.max = '1';
      confSlider.step = '0.01';
      confSlider.value = getStoredVolume(confKey).toString();
      confSlider.className = 'volume-slider';
      confSlider.title = 'Conference Volume';
      confSlider.addEventListener('input', e => {
        const vol = parseFloat(e.target.value);
        setTargetVolumeAndPersist(key, confKey, vol);
      });
      info.appendChild(confSlider);

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

        if (activeLockButton) {
          if (activeLockButton === talkBtn) {
            li.classList.remove('ptt-pressing');
            handleStopTalking({ preventDefault() {}, currentTarget: talkBtn });
            return;
          }
          suspendActiveLockState();
          handleStopTalking({ preventDefault() {}, currentTarget: null, suppressLockRestore: true });
        }

        const startX = e.clientX;
        let lockedByGesture = false;

        const onMove = (ev) => {
          if (lockedByGesture || activeLockButton === talkBtn) return;
          if (ev.clientX - startX <= -42) {
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
          if (activeLockButton === talkBtn) return;
          handleStopTalking(ev);
        };

        try { talkBtn.setPointerCapture(e.pointerId); } catch {}
        talkBtn.addEventListener('pointermove', onMove);
        talkBtn.addEventListener('pointerup', onEnd);
        talkBtn.addEventListener('pointercancel', onEnd);
        handleTalk(e, normalizedTarget);
      });

      const muteBtn = document.createElement('button');
      muteBtn.className = 'mute-btn';
      const muted = mutedPeers.has(key);
      muteBtn.type = 'button';
      muteBtn.title = muted ? 'Unmute' : 'Mute';
      if (muted) muteBtn.classList.add('muted');
      const muteIcon = document.createElement('img');
      muteIcon.className = 'btn-icon';
      muteIcon.src = muted ? UI_ICONS.speakerMuted : UI_ICONS.speakerOn;
      muteIcon.alt = '';
      muteIcon.setAttribute('aria-hidden', 'true');
      muteBtn.appendChild(muteIcon);
      muteBtn.addEventListener('pointerdown', e => e.stopPropagation());
      muteBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleMute(id);
      });
      const actions = document.createElement('div');
      actions.className = 'target-actions';
      actions.classList.add('ptt-actions');
      actions.append(muteBtn, talkBtn);

      if (isSameTarget(activeLockTarget, { type: 'conference', id })) {
        activeLockButton = talkBtn;
        setTalkButtonLocked(talkBtn, true);
      }

      li.append(icon, info, actions, hint);
      applyHotkeyToTarget(li, labelRow, { type: 'conference', id });

      let rowPttGestureActive = false;
      let rowPttStartX = 0;
      let rowPttLockedByGesture = false;
      li.addEventListener('pointermove', (e) => {
        if (!rowPttGestureActive) return;
        if (rowPttLockedByGesture || activeLockButton === talkBtn) return;
        if (e.clientX - rowPttStartX <= -42) {
          rowPttLockedByGesture = true;
          activateTalkLock({ type: 'conference', id }, talkBtn);
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
            const targetData = { type: 'conference', id };
            if (activeLockButton && isSameTarget(activeLockTarget, targetData)) {
              handleStopTalking({ preventDefault() {}, currentTarget: activeLockButton });
              return;
            }
            if (activeLockButton && !isSameTarget(activeLockTarget, targetData)) {
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
            if (rowPttGestureActive) {
              rowPttGestureActive = false;
              li.classList.remove('ptt-pressing');
              try { li.releasePointerCapture(e.pointerId); } catch {}
              if (activeLockButton === talkBtn) return;
            }
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

      const dimBtn = document.createElement('button');
      dimBtn.className = 'lock-btn dim-btn';
      const feedKeyId = String(id);
      const dimDisabled = feedDimmingDisabled.has(feedKeyId);
      dimBtn.textContent = 'Dim';
      dimBtn.type = 'button';
      dimBtn.setAttribute('aria-pressed', dimDisabled ? 'true' : 'false');
      dimBtn.classList.toggle('dim-off', dimDisabled);
      dimBtn.addEventListener('pointerdown', e => e.stopPropagation());
      dimBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (feedDimmingDisabled.has(feedKeyId)) {
          feedDimmingDisabled.delete(feedKeyId);
          dimBtn.setAttribute('aria-pressed', 'false');
          dimBtn.classList.remove('dim-off');
        } else {
          feedDimmingDisabled.add(feedKeyId);
          dimBtn.setAttribute('aria-pressed', 'true');
          dimBtn.classList.add('dim-off');
        }
        applyFeedDucking();
      });
      labelWrap.appendChild(dimBtn);

      info.appendChild(labelWrap);

      const feedKey = `volume_feed_${id}`;
      const feedSlider = document.createElement('input');
      feedSlider.type = 'range';
      feedSlider.min = '0';
      feedSlider.max = '1';
      feedSlider.step = '0.01';
      feedSlider.value = getStoredVolume(feedKey).toString();
      feedSlider.className = 'volume-slider';
      feedSlider.title = 'Feed Volume';
      feedSlider.addEventListener('input', e => {
        const vol = Math.max(0, Math.min(1, parseFloat(e.target.value)));
        setTargetVolumeAndPersist(key, feedKey, vol);
      });
      info.appendChild(feedSlider);

      const muteBtn = document.createElement('button');
      muteBtn.className = 'mute-btn';
      const muted = mutedPeers.has(key);
      muteBtn.type = 'button';
      muteBtn.classList.toggle('muted', muted);
      muteBtn.title = muted ? 'Unmute' : 'Mute';
      const muteIcon = document.createElement('img');
      muteIcon.className = 'btn-icon';
      muteIcon.src = muted ? UI_ICONS.speakerMuted : UI_ICONS.speakerOn;
      muteIcon.alt = '';
      muteIcon.setAttribute('aria-hidden', 'true');
      muteBtn.appendChild(muteIcon);
      muteBtn.addEventListener('pointerdown', e => e.stopPropagation());
      muteBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleMute(key);
      });

      const actions = document.createElement('div');
      actions.className = 'target-actions';
      actions.classList.add('ptt-actions');
      actions.append(muteBtn, dimBtn);

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
    if (producer || isTalking || activeLockTarget) {
      const target = currentTarget || activeLockTarget;
      if (target && (target.type === 'conference' || target.type === 'user')) {
        const selector = target.type === 'conference'
          ? `#conf-${target.id}`
          : `#user-${target.id}`;
        const el = document.querySelector(selector);
        if (el) {
          el.classList.add('talking-to');
        } else if (producer || isTalking) {
          // If we're still producing but the target is no longer present in the UI
          // (e.g. a user went offline), stop to avoid misleading UI/state.
          stopTalkingSafely();
        }
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
        consumers.forEach(c => { try { c.close(); } catch {} });
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

    if (activeLockButton && !document.body.contains(activeLockButton)) {
      handleStopTalking({ preventDefault() {}, currentTarget: activeLockButton });
    }

    pruneIncomingStreamBookkeeping();

    document.querySelectorAll('.target-item').forEach(li => {
      const key = li.id;
      const icon = key.startsWith('user-')
        ? li.querySelector('.user-icon')
        : key.startsWith('conf-')
          ? li.querySelector('.conf-icon')
        : key.startsWith('feed-')
            ? li.querySelector('.feed-icon')
            : null;

      const isSpeaking = isTargetSpeaking(key);
      li.classList.toggle('speaking', isSpeaking);
      if (icon) icon.classList.toggle('speaking', isSpeaking);

      const isMuted = mutedPeers.has(key);
      li.classList.toggle('muted', isMuted);
      if (icon) icon.classList.toggle('muted', isMuted);
    });

    refreshLastTargetLabel();
    applyIncomingTalkState();

    schedulePttButtonSizing();
    if (!pttSizingListenerBound) {
      window.addEventListener('resize', schedulePttButtonSizing, { passive: true });
      pttSizingListenerBound = true;
    }
    emitTargetAudioStateSnapshot('target-audio-render');
  }




  async function handleIncomingProducer(payload) {
    if (!payload || typeof payload !== 'object') return;

    if (!device || !recvTransport) {
      pendingProducerQueue.push(payload);
      return;
    }

    await consumeProducerPayload(payload);
  }

  async function consumeProducerPayload({ peerId, producerId, appData }) {
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
      targetKey = `user-${peerId}`;
      volumeStorageKey = `volume_user_${peerId}`;
    }

    // ignore our own streams
    if (peerId === socket.id) return;

    // skip streams not intended for us
    if (normalizedAppData.targetPeer && normalizedAppData.targetPeer !== socket.id) {
      console.log('Producer not for us, skipping');
      return;
    }

    const effectiveProducerId = producerId || normalizedAppData.producerId || `${peerId}-${Date.now()}`;
    const streamKey = makeStreamKey(targetKey, effectiveProducerId);
    const alreadyTracked = audioElements.has(streamKey)
      || peerConsumers.has(streamKey)
      || (targetStreamMap.get(targetKey)?.has(streamKey) ?? false);
    if (alreadyTracked || pendingIncomingConsumeKeys.has(streamKey)) {
      return;
    }
    pendingIncomingConsumeKeys.add(streamKey);

    try {
      const { error, ...consumeParams } = await new Promise((resolve) =>
        socket.emit('consume', {
          producerId,
          rtpCapabilities: device.rtpCapabilities,
        }, resolve)
      );
      if (error) throw new Error(error);

      const consumer = await recvTransport.consume(consumeParams);
      const nowTracked = audioElements.has(streamKey)
        || peerConsumers.has(streamKey)
        || (targetStreamMap.get(targetKey)?.has(streamKey) ?? false);
      if (nowTracked) {
        try { consumer.close(); } catch {}
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
      const feedPlayback = isFeed ? ensureFeedPlaybackBus() : null;
      const shouldUseWebAudioLevelControl = !isFeed && isiOS;
      const ctxForPlayback = shouldUseWebAudioLevelControl ? ensureAudioContext() : null;

      const initVolRaw = getStoredVolume(volumeStorageKey);
      const initVol = Math.max(0, Math.min(1, initVolRaw));

      const audio = document.createElement('audio');
      audio.srcObject = stream;
      audio.autoplay = true;
      audio.playsInline = true;
      audio.setAttribute('playsinline', 'true');
      audio.setAttribute('autoplay', 'true');
      enforcePitchLock(audio);
      if (supportsAudioOutputSelection() && preferredOutputDeviceId && typeof audio.setSinkId === 'function') {
        audio.setSinkId(preferredOutputDeviceId).catch(err => {
          console.warn('Failed to apply audio output device to new audio element:', err);
        });
      }

      let gainNode = null;
      let mediaSource = null;
      let feedDuckingNode = null;

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
        } catch (err) {
          console.warn('Failed to initialize feed playback bus path:', err);
          gainNode = null;
          mediaSource = null;
          feedDuckingNode = null;
        }
      } else if (ctxForPlayback) {
        try {
          mediaSource = ctxForPlayback.createMediaStreamSource(stream);
          gainNode = ctxForPlayback.createGain();
          gainNode.gain.value = 0;
          mediaSource.connect(gainNode);
          gainNode.connect(ctxForPlayback.destination);
          audio.muted = true;
          audio.volume = 0;
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

      audioStreamsDiv.appendChild(audio);
      const entry = {
        audio,
        volume: initVol,
        key: targetKey,
        streamKey,
        consumerId: consumer.id,
        type: normalizedAppData.type || 'user',
        gainNode,
        mediaSource,
        feedDuckingNode,
        lastAppliedLevel: null,
        producerId: effectiveProducerId,
      };
      audioElements.set(streamKey, entry);
      audioEntryMap.set(audio, entry);
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
          if (session.kind === 'user') {
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

      await attemptPlayAudio(audio).catch(() => {});
      if (isFeed && session.kind === 'user') {
        applyFeedDucking();
      }

      await new Promise((res) =>
        socket.emit('resume-consumer', { consumerId: consumer.id }, res)
      );

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
          if (session.kind === 'user') {
            applyFeedDucking();
          }
        } else if (entry.type === 'conference') {
          confAudioElements.get(normalizedAppData.id)?.delete(audio);
        }
      };

      consumer.on('producerclose', handleConsumerClosed);
      consumer.on('trackended', handleConsumerClosed);
      consumer.on('transportclose', handleConsumerClosed);
    } catch (err) {
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
      if (session.kind !== 'user') return;
      if (document.visibilityState === 'hidden') return;
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
          if (!caps) {
            reject(new Error("No RTP capabilities received"));
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
          resolve(params);
        });
      });

      sendTransport = device.createSendTransport(sendParams);
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
              // Keep the appData from handleTalk() and optionally add targetPeer
              const mergedAppData = {
                ...appData,                     // { type: "user"/"conference", id: … }
                ...(currentTargetPeer
                    ? { targetPeer: currentTargetPeer }
                    : {})                         // append only when defined
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
          resolve(params);
        });
      });

      recvTransport = device.createRecvTransport(recvParams);
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
      alert("Initialization failed: " + err.message);
    }
  }

  // Handle new producers
  socket.on('new-producer', (payload) => {
    if (payload && typeof payload === 'object') {
      console.log(`New producer ${payload.producerId} from peer ${payload.peerId}`, payload.appData);
    }
    handleIncomingProducer(payload).catch(err => console.error('Failed to handle producer', err));
  });

  socket.on('consumer-closed', ({ consumerId } = {}) => {
    const cleaned = cleanupConsumerById(consumerId);
    if (!cleaned && mediaInitialized && session.kind === 'user') {
      requestActiveProducers().catch(() => {});
    }
  });


  socket.on("producer-closed", ({ peerId, producerId, appData }) => {
    // 1️⃣ Compute the key like always
    let key;
    if (appData?.type === "conference") {
      key = `conf-${appData.id}`;
    } else if (appData?.type === "feed") {
      key = `feed-${appData.id}`;
    } else {
      key = `user-${peerId}`;
    }

    const streamKey = makeStreamKey(key, producerId || appData?.producerId);

    // 2️⃣ Continue only if we were actually consuming this key
    const consumersSet = peerConsumers.get(streamKey);
    if (!consumersSet || consumersSet.size === 0) {
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
        if (session.kind === 'user') {
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

  function updateSpeakerHighlight(targetKey, isSpeaking) {
    const el = document.getElementById(targetKey);
    const iconCls = targetKey.startsWith("conf-") ? ".conf-icon" : targetKey.startsWith("feed-") ? ".feed-icon" : ".user-icon";
    const icon    = el?.querySelector(iconCls);
    const separatorIndex = targetKey.indexOf("-");
    const rawId = separatorIndex >= 0 ? targetKey.slice(separatorIndex + 1) : targetKey;
    const isConference = targetKey.startsWith("conf-");
    const isUser = targetKey.startsWith("user-");
    const isFeed = targetKey.startsWith("feed-");
    const labelText = getTargetLabel(targetKey);

    let lockTargetMatches = false;
    if (activeLockButton && !isFeed && (isConference || isUser)) {
      const candidate = {
        type: isConference ? "conference" : "user",
        id: rawId,
      };
      lockTargetMatches = isSameTarget(activeLockTarget, candidate);
    }

    if (isSpeaking) {
      el?.classList.add("speaking");
      icon?.classList.add("speaking");

      applyFeedDucking();
      return;
    }

    if (!el) {
      applyFeedDucking();
      return;
    }

    el?.classList.remove("speaking");
    icon?.classList.remove("speaking");
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
    if (target.type === 'feed') return `feed-${target.id}`;
    return null;
  }

  function toKey(rawId) {
    const id = String(rawId);
    if (id.startsWith("user-") || id.startsWith("conf-") || id.startsWith("feed-")) {
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
    let selector = null;
    if (target.type === 'conference') {
      selector = `#conf-${target.id}`;
    } else if (target.type === 'user') {
      selector = `#user-${target.id}`;
    }
    if (!selector) return;
    document.querySelector(selector)?.classList.toggle('talking-to', Boolean(isActive));
  }

  function clearHotkeyActiveStyles() {
    document
      .querySelectorAll(".target-item.hotkey-active")
      .forEach((el) => el.classList.remove("hotkey-active"));
  }

  function setHotkeyElementState(digit, isActive) {
    const el = document.querySelector(`.target-item[data-hotkey="${digit}"]`);
    if (!el) return;
    el.classList.toggle("hotkey-active", Boolean(isActive));
  }

  function extractHotkeyDigit(event) {
    if (!event) return null;
    if (event.key && /^[1-9]$/.test(event.key)) {
      return event.key;
    }

    const code = event.code || "";
    let match = code.match(/^Digit([1-9])$/);
    if (match) return match[1];
    match = code.match(/^Numpad([1-9])$/);
    if (match) return match[1];
    return null;
  }

  function canUseTargetHotkeys(event) {
    if (session.kind !== "user") return false;
    if (activeLockButton) return false;
    if (!event) return false;
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    if (isTextInput(event.target)) return false;
    return true;
  }


// ---------- Toggle mute ----------
  function updateMuteUiForTarget(key, nowMuted) {
    const targetEl = document.getElementById(key);
    const iconSelector = key.startsWith("conf-")
        ? '.conf-icon'
        : key.startsWith('feed-')
          ? '.feed-icon'
          : '.user-icon';

    targetEl?.classList.toggle('muted', nowMuted);
    targetEl?.querySelector(iconSelector)?.classList.toggle('muted', nowMuted);

    const muteBtn = targetEl?.querySelector('.mute-btn');
    if (!muteBtn) return;
    muteBtn.classList.toggle('muted', nowMuted);
    muteBtn.title = nowMuted ? 'Unmute' : 'Mute';

    const muteIcon = muteBtn.querySelector('.btn-icon');
    if (muteIcon) {
      muteIcon.src = nowMuted ? UI_ICONS.speakerMuted : UI_ICONS.speakerOn;
    }
  }

  function setMuteState(rawId) {
    const key = toKey(rawId);

    const consumers = collectConsumersForTarget(key);
    console.log("[DEBUG] toggleMute with key:", key, "Consumers:", consumers.length);

    const wasMuted = mutedPeers.has(key);
    const nowMuted = !wasMuted;
    if (nowMuted) mutedPeers.add(key);
    else mutedPeers.delete(key);

    if (isFeedKey(key)) {
      forEachStreamEntry(key, (entry) => {
        if (nowMuted) {
          muteFeedEntry(entry);
        } else {
          setFeedEntryLevel(entry, entry.volume ?? defaultVolume);
        }
      });
      if (session.kind === 'user') {
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
    if (!activeLockButton) return;
    setTalkButtonLocked(activeLockButton, false);
    activeLockButton = null;
    activeLockTarget = null;
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
    if (session.kind !== 'user') return;
    if (!target || !button) return;
    clearSuspendedLockState();
    activeLockButton = button;
    activeLockTarget = { type: target.type, id: target.id };
    setTalkButtonLocked(button, true);
    emitPttState('lock-activated', { lockActive: true, target });
  }

  function findTalkButtonForTarget(target) {
    if (!target) return null;
    if (target.type === 'user') {
      return document.querySelector(`#user-${target.id} .talk-btn`);
    }
    if (target.type === 'conference') {
      return document.querySelector(`#conf-${target.id} .talk-btn`);
    }
    return null;
  }

  function suspendActiveLockState() {
    if (session.kind !== 'user') return null;
    if (!activeLockButton || !activeLockTarget) return null;
    suspendedLockState = {
      target: { type: activeLockTarget.type, id: activeLockTarget.id },
      button: activeLockButton,
    };
    clearLockState();
    return suspendedLockState;
  }

  function scheduleRestoreSuspendedLock() {
    if (session.kind !== 'user') return;
    if (!suspendedLockState) return;
    cancelSuspendedLockRestore();
    suspendedLockRestoreTimer = setTimeout(() => {
      suspendedLockRestoreTimer = null;
      if (!suspendedLockState) return;
      if (producer || pendingTalkStart) {
        scheduleRestoreSuspendedLock();
        return;
      }

      const lockState = suspendedLockState;
      suspendedLockState = null;
      const target = lockState?.target || null;
      const button = lockState?.button && document.body.contains(lockState.button)
        ? lockState.button
        : findTalkButtonForTarget(target);

      if (!target || !button || button.disabled) {
        return;
      }

      activateTalkLock(target, button);
      handleTalk({ preventDefault() {} }, { type: target.type, id: target.id });
    }, 0);
  }

  function toggleTalkLock(target) {
    if (session.kind !== 'user') return;
    if (!target) return;
    const talkBtn = findTalkButtonForTarget(target);
    if (!talkBtn) return;

    if (isSameTarget(activeLockTarget, target) && activeLockButton) {
      handleStopTalking({ preventDefault() {}, currentTarget: activeLockButton });
      return;
    }

    if (activeLockButton && activeLockButton !== talkBtn) {
      handleStopTalking({ preventDefault() {}, currentTarget: activeLockButton });
    } else if (producer) {
      handleStopTalking({ preventDefault() {}, currentTarget: talkBtn });
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
    if (session.kind !== 'user') return;
    if (producer || pendingTalkStart) return;
    if (!target) return;
    let normalizedTarget = { type: target.type, id: target.id };
    let resolvedTargetPeer = null;
    if (normalizedTarget.type === 'user') {
      resolvedTargetPeer = resolveUserSocketId(normalizedTarget.id)
        || cachedUsers.find((entry) => String(entry?.socketId) === String(normalizedTarget.id))?.socketId
        || null;
      if (!resolvedTargetPeer) {
        console.warn('Talk target is not currently available', normalizedTarget);
        return;
      }
      normalizedTarget = { type: 'user', id: resolvedTargetPeer };
    }
    const targetKey = keyFromTarget(normalizedTarget);
    if (!slideHintShown && targetKey && !targetKey.startsWith('feed-')) {
      const li = document.getElementById(targetKey);
      if (li) {
        slideHintShown = true;
        li.classList.add('show-slide-hint');
        setTimeout(() => li.classList.remove('show-slide-hint'), 3000);
      }
    }

    const pendingStart = {
      canceled: false,
      target: normalizedTarget,
      targetPeer: normalizedTarget.type === 'user' ? resolvedTargetPeer : null,
    };
    pendingTalkStart = pendingStart;
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
        track.enabled = false;
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
      finalTrack.enabled = true;
      currentTarget = normalizedTarget;
      currentTargetPeer = pendingStart.targetPeer;
      isTalking = true;

      const shouldPinSelfColor = targetKey ? speakingPeers.has(targetKey) : false;
      setSelfTalkingKey(shouldPinSelfColor ? targetKey : null);

      // ◆ Producer parameters: always include appData
      const params = {
        track: finalTrack,
        appData: { type: normalizedTarget.type, id: normalizedTarget.id },
        codecOptions: profile?.codecOptions ? { ...profile.codecOptions } : undefined,
        encodings: profile?.encodings ? profile.encodings.map(enc => ({ ...enc })) : undefined,
        stopTracks: false,
      };

      // ◆ Start producing
      const newProducer = await sendTransport.produce(params);

      // ◆ If the button was released in the meantime
      if (!isTalking || pendingTalkStart !== pendingStart || pendingStart.canceled) {
        if (pendingTalkStart === pendingStart) {
          pendingTalkStart = null;
        }
        // The server-side producer already exists once `produce()` resolves.
        // If the user released PTT during that async window, we still must
        // explicitly tell the server to close it or remote peers keep a stale
        // "speaking" state.
        notifyServerProducerClosed(newProducer.id, { context: 'talk-start-cancel' });
        newProducer.close();
        finalTrack.enabled = false;
        if (processedTrack && processedTrack !== track) {
          processedTrack.enabled = false;
        }
        track.enabled = false;
        scheduleMicCleanup();
        return;
      }

      pendingTalkStart = null;
      producer = newProducer;

      newProducer.on('close', () => {
        if (producer === newProducer) {
          producer = null;
        }
        if (micTrack) {
          micTrack.enabled = false;
        }
        if (processedTrack && processedTrack !== micTrack) {
          processedTrack.enabled = false;
        }
        scheduleMicCleanup();
        if (targetKey && selfTalkingKey === targetKey) {
          setSelfTalkingKey(null);
        }
      });

      // ◆ Visual feedback only for targeted recipients
      updateOutgoingTalkHighlight(normalizedTarget, true);
      emitPttState('talk-started', { talking: true, target: normalizedTarget });
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
      if (micTrack) {
        micTrack.enabled = false;
      }
      if (userProcessingChain?.outputTrack) {
        userProcessingChain.outputTrack.enabled = false;
      }
      scheduleMicCleanup();
      applyFeedDucking();

      updateOutgoingTalkHighlight(currentTarget, false);
      currentTarget = null;
      setSelfTalkingKey(null);
      emitPttState('talk-start-failed', { talking: false, lockActive: Boolean(activeLockButton), target: activeLockTarget || null });
    }
  }




  function setReplyButtonActive(isActive) {
    if (!btnReply) return;
    btnReply.classList.toggle("active", isActive);
    btnReply.setAttribute("aria-pressed", isActive ? "true" : "false");
  }

  btnReply.addEventListener("pointerdown", e => {
    e.preventDefault();
    if (session.kind !== 'user') return;
    if (!lastTarget) return;
    setReplyButtonActive(true);
    handleTalk(e, { type: lastTarget.type, id: lastTarget.id });
  });

  btnReply.addEventListener("pointerup", handleStopTalking);
  btnReply.addEventListener("pointerleave", handleStopTalking);
  btnReply.addEventListener("pointercancel", handleStopTalking);

  function handleStopTalking(e) {
    e.preventDefault();
    if (session.kind !== 'user') return;
    const shouldRestoreSuspendedLock = Boolean(suspendedLockState) && !e?.suppressLockRestore;

    if (activeLockButton && e.currentTarget && e.currentTarget !== activeLockButton) {
      return;
    }

    isTalking = false;
    setSelfTalkingKey(null);
    const pendingTarget = pendingTalkStart?.target || null;
    if (pendingTalkStart) {
      pendingTalkStart.canceled = true;
    }

    // Reset button states
    setReplyButtonActive(false);
    clearLockState();

    if (producer) {
      notifyServerProducerClosed(producer.id, { context: 'talk-stop' });
      producer.close();
      producer = null;
    }

    if (micTrack) {
      micTrack.enabled = false;
    }
    if (userProcessingChain?.outputTrack) {
      userProcessingChain.outputTrack.enabled = false;
    }

    scheduleMicCleanup();

    // Remove the purple highlight from the <li>
    updateOutgoingTalkHighlight(currentTarget || pendingTarget, false);
    currentTarget = null;
    currentTargetPeer = null;
    applyFeedDucking();
    clearHotkeyActiveStyles();
    pressedHotkeyDigits.clear();
    emitPttState('talk-stopped', { talking: false, lockActive: false, target: null });

    if (shouldRestoreSuspendedLock) {
      scheduleRestoreSuspendedLock();
    }
  }

  // Safety stop so PTT can't get stuck on iOS/background transitions.
  function stopTalkingSafely({ respectLock = false } = {}) {
    if (session.kind !== 'user') return;
    if (!producer && !isTalking && !pendingTalkStart) return;
    if (respectLock && activeLockButton) return;
    handleStopTalking({ preventDefault() {}, currentTarget: null });
  }

  function stopTalkingIfHidden() {
    if (document.visibilityState === 'hidden') {
      // When switching tabs, the document becomes hidden. Don't force-stop if
      // talk lock is active.
      stopTalkingSafely({ respectLock: true });
      return;
    }
    if (document.visibilityState === 'visible') {
      pruneIncomingStreamBookkeeping();
      if (mediaInitialized) {
        requestActiveProducers().catch(() => {});
      }
    }
  }

  document.addEventListener('visibilitychange', stopTalkingIfHidden);
  window.addEventListener('pagehide', () => stopTalkingSafely());
  window.addEventListener('blur', () => stopTalkingSafely({ respectLock: true }));
  window.addEventListener('focus', () => {
    pruneIncomingStreamBookkeeping();
    if (mediaInitialized) {
      requestActiveProducers().catch(() => {});
    }
  });
  window.addEventListener('pointerup', () => stopTalkingSafely({ respectLock: true }));
  window.addEventListener('pointercancel', () => stopTalkingSafely({ respectLock: true }));
  window.addEventListener('touchend', () => stopTalkingSafely({ respectLock: true }), { passive: true });
  window.addEventListener('touchcancel', () => stopTalkingSafely({ respectLock: true }), { passive: true });

  // Keyboard Push-to-Talk: hold Space to talk
  let spaceKeyHeld = false;
  function isTextInput(el) {
    const tag = (el?.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable;
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const isSpace = e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';
    if (!isSpace) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (session.kind !== 'user') return;
    if (!lastTarget) return;
    if (activeLockButton) return; // don't interfere with lock mode
    if (isTextInput(e.target)) return;

    spaceKeyHeld = true;
    e.preventDefault();
    // Reply-Button highlighten und als gedrückt markieren
    if (btnReply) {
      btnReply.classList.add('active');
      btnReply.setAttribute('aria-pressed', 'true');
    }
    setReplyButtonActive(true);
    handleTalk(e, { type: lastTarget.type, id: lastTarget.id });
  });

  window.addEventListener('keyup', (e) => {
    if (!spaceKeyHeld) return;
    const isSpace = e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';
    if (!isSpace) return;
    spaceKeyHeld = false;
    if (activeLockButton) return; // ignore when locked
    // Reply-Button Highlight entfernen
    if (btnReply) {
      btnReply.classList.remove('active');
      btnReply.setAttribute('aria-pressed', 'false');
    }
    setReplyButtonActive(false);
    handleStopTalking({ preventDefault() {}, currentTarget: null });
  });

  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    const digit = extractHotkeyDigit(e);
    if (!digit) return;
    if (!canUseTargetHotkeys(e)) return;
     if (pressedHotkeyDigits.size) return;
    if (pressedHotkeyDigits.has(digit)) return;
    const target = targetHotkeys.get(digit);
    if (!target) return;

    pressedHotkeyDigits.add(digit);
    e.preventDefault();
    setHotkeyElementState(digit, true);
    handleTalk(e, target);
  });

  window.addEventListener('keyup', e => {
    const digit = extractHotkeyDigit(e);
    if (!digit) return;
    if (!pressedHotkeyDigits.has(digit)) return;
    pressedHotkeyDigits.delete(digit);
    setHotkeyElementState(digit, false);
    e.preventDefault();
    handleStopTalking({ preventDefault() {}, currentTarget: null });
  });


  // Initial connection check
  console.log("Socket connected?", socket.connected);
});
