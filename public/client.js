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
const IDENTITY_KIND_KEY = 'identityKind';
const FEED_ID_STORAGE_KEY = 'feedId';
const FEED_DUCKING_DB_STORAGE_KEY = 'feedDimDb';
const DEFAULT_FEED_DUCKING_DB = -14;
const FEED_DUCKING_DB_MIN = -60;
const FEED_DUCKING_DB_MAX = -6;
const FEED_DIM_SELF_STORAGE_KEY = 'feedDimSelf';
const AUDIO_PROCESSING_STORAGE_KEY = 'audioProcessingEnabled';
const FEED_INPUT_GAIN_DB_STORAGE_KEY = 'feedInputGainDb';
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

const TARGET_HOTKEY_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const targetHotkeys = new Map();
const pressedHotkeyDigits = new Set();

let feedDuckingDb = DEFAULT_FEED_DUCKING_DB;
let feedDuckingFactor = dbToLinear(feedDuckingDb);
let feedDimSelf = false;
let audioProcessingEnabled = false;
const audioProcessingOptions = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};
let feedInputGainDb = 0;
let feedInputGainLinear = dbToLinear(feedInputGainDb);
let userInputGainDb = 18;
let userInputGainLinear = dbToLinear(userInputGainDb);

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
    const storedProcessing = window.localStorage?.getItem(AUDIO_PROCESSING_STORAGE_KEY);
    if (storedProcessing !== null) {
      audioProcessingEnabled = storedProcessing === 'true';
    } else {
      // Default: enable processing on mobile, disable on desktop
      try {
        const ua = navigator?.userAgent || '';
        const isIpadDesktopUA = (navigator?.maxTouchPoints > 1) && /Macintosh/.test(ua);
        const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobi/i.test(ua);
        audioProcessingEnabled = !!(isMobileUA || isIpadDesktopUA);
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
  ? /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent || ''))
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
  constraints: { channelCount: 2, sampleRate: 48000 },
};

let session = { kind: 'guest', userId: null, feedId: null, name: null };
let inputSelect;
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
const USER_ACTIVATION_EVENTS = ['pointerdown', 'mousedown', 'click', 'touchstart', 'keydown'];
const UI_ICONS = {
  talk: '/images/walkie-talkies-white.png',
  speakerOn: '/images/speaker-white.png',
  speakerMuted: '/images/speaker-muted.png',
};
const pendingAutoplayAudios = new Set();
let sharedAudioContext = null;
let onAudioContextRunning = null;
let audioContextPrimed = false;
let feedProcessingChain = null;
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

function ensureAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioContext) {
    try {
      sharedAudioContext = new AudioCtx({ latencyHint: 'interactive', sampleRate: 48000 });
      sharedAudioContext.addEventListener('statechange', () => {
        if (sharedAudioContext.state === 'running' && typeof onAudioContextRunning === 'function') {
          onAudioContextRunning();
        }
      });
    } catch (err) {
      console.warn('Failed to create AudioContext:', err);
      sharedAudioContext = null;
      return null;
    }
  }
  return sharedAudioContext;
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
  const ctx = ensureAudioContext();
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
  // Make a best effort to keep stereo through the WebAudio pipe
  try { outputTrack.applyConstraints?.({ channelCount: 2 }); } catch {}

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

function getSelectedDeviceId() {
  const selected = inputSelect?.value;
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
  const constraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    ...(FEED_PROFILE.constraints || {}),
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
      if (session.kind === 'feed' && feedProcessingChain) {
        scheduleFeedMeterUpdate();
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
  settingsMenuOpen = true;
  startInputMonitor();
}

function handleSettingsMenuClosed() {
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
  const ctx = ensureAudioContext();
  if (!ctx) return;
  if (ctx.state === 'running') {
    if (typeof onAudioContextRunning === 'function') {
      onAudioContextRunning();
    }
    return;
  }
  if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
    ctx.resume().then(() => {
      if (typeof onAudioContextRunning === 'function') {
        onAudioContextRunning();
      }
    }).catch(err => {
      console.warn('Failed to resume AudioContext:', err);
    });
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
  const v = sessionStorage.getItem(key);
  return v !== null ? parseFloat(v) : defaultValue;
}

function storeVolume(key, value) {
  sessionStorage.setItem(key, String(value));
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

  // Populate the input dropdown
  if (inputSelect) {
    inputSelect.innerHTML = `<option value="">Select device</option>`;
    inputs.forEach(d => {
      const opt = document.createElement("option");
      opt.value       = d.deviceId;
      opt.textContent = d.label || `Microphone ${inputSelect.length}`;
      inputSelect.append(opt);
    });

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
      inputSelect.value = desiredDeviceId;
      if (inputSelect.value !== desiredDeviceId) {
        const match = Array.from(inputSelect.options).find(opt => opt.value === desiredDeviceId);
        if (match) {
          match.selected = true;
        }
      }
      localStorage.setItem(MIC_DEVICE_STORAGE_KEY, desiredDeviceId);
    } else {
      inputSelect.value = '';
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

  const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
  const [track] = stream.getAudioTracks();

  micStream = stream;
  micTrack = track;
  micDeviceId = selectedDeviceId || track.getSettings?.().deviceId || null;
  micPrimed = true;

  if (micDeviceId) {
    localStorage.setItem(MIC_DEVICE_STORAGE_KEY, micDeviceId);
    if (inputSelect && inputSelect.value !== micDeviceId) {
      const match = Array.from(inputSelect.options || []).find(opt => opt.value === micDeviceId);
      if (match) {
        match.selected = true;
      }
    }
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
  feedInputGainSlider = document.getElementById('feed-input-gain');
  feedInputGainValueDisplay = document.getElementById('feed-input-gain-value');
  feedMeterBarLEl = document.getElementById('feed-meter-bar-L');
  feedMeterClipLEl = document.getElementById('feed-meter-clip-L');
  feedMeterValueLEl = document.getElementById('feed-meter-value-L');
  feedMeterBarREl = document.getElementById('feed-meter-bar-R');
  feedMeterClipREl = document.getElementById('feed-meter-clip-R');
  feedMeterValueREl = document.getElementById('feed-meter-value-R');

  updateUserGainUI();
  setUserMeterDisplay(0, formatDbDisplay(-Infinity), false, null, { forceText: true });
  updateFeedGainUI();
  setFeedMeterDisplayFor(feedMeterBarLEl, feedMeterValueLEl, feedMeterClipLEl, feedMeterStateL, 0, formatDbDisplay(-Infinity), false, null, { forceText: true });
  setFeedMeterDisplayFor(feedMeterBarREl, feedMeterValueREl, feedMeterClipREl, feedMeterStateR, 0, formatDbDisplay(-Infinity), false, null, { forceText: true });
  applyUserGainControlState();

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

  inputSelect?.addEventListener('change', () => {
    const selected = inputSelect.value;
    if (selected) {
      localStorage.setItem(MIC_DEVICE_STORAGE_KEY, selected);
    } else {
      localStorage.removeItem(MIC_DEVICE_STORAGE_KEY);
    }
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

  // mediasoup variables
  let device, sendTransport, recvTransport, producer;
  const audioElements = new Map();
  const audioEntryMap = new WeakMap();
  const confAudioElements = new Map();
  const feedAudioElements = new Map();
  const targetStreamMap = new Map();
  const feedDimmingDisabled = new Set();
  const activeTalkersForMe = new Set();
  const talkerConsumersForMe = new Map();
  const speakingPeers = new Set();
  const lastSpokePeers = new Map();
  const mutedPeers = new Set();
  const pendingProducerQueue = [];
let currentTargetPeer = null;
let lastTarget = null;
let isTalking = false;
let currentTarget = null;
let selfTalkingKey = null;
let cachedUsers = [];
  let mediaInitialized = false;
  let initializingMediaPromise = null;
  let shouldInitializeAfterConnect = false;
  let activeLockButton = null;
  let activeLockTarget = null;
  let pendingPttSizingRaf = null;
  let pttSizingListenerBound = false;
  let speakingPruneInterval = null;
  let slideHintShown = false;

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

  function forEachStreamKey(targetKey, callback) {
    const set = targetStreamMap.get(targetKey);
    if (!set) return;
    Array.from(set).forEach(callback);
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

  function pruneSpeakingState() {
    // Remove stale stream bookkeeping so "speaking" can't get stuck due to missed events.
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
        const trackLive = !track || track.readyState === 'live';
        const audioInDom = !!(audioEl && document.body.contains(audioEl));

        if (!entry || !hasConsumers || !audioInDom || !trackLive) {
          unregisterStreamKey(targetKey, streamKey);
        }
      }

      if (!hasActiveStreams(targetKey) && speakingPeers.has(targetKey)) {
        speakingPeers.delete(targetKey);
        updateSpeakerHighlight(targetKey, false);
      }
    }

    for (const targetKey of Array.from(speakingPeers)) {
      if (!hasActiveStreams(targetKey)) {
        speakingPeers.delete(targetKey);
        updateSpeakerHighlight(targetKey, false);
      }
    }
  }

  function applyVolumeToTarget(targetKey, volume) {
    const clamped = Math.max(0, Math.min(1, Number(volume) || 0));
    forEachStreamEntry(targetKey, (entry) => {
      entry.volume = clamped;
      if (entry.type === 'feed') {
        if (!mutedPeers.has(targetKey)) {
          setFeedEntryLevel(entry, clamped);
          enforcePitchLock(entry.audio);
          attemptPlayAudio(entry.audio).catch(() => {});
        }
        return;
      }

      if (!entry.audio) return;
      if (mutedPeers.has(targetKey)) {
        entry.audio.muted = true;
        entry.audio.volume = 0;
        return;
      }
      entry.audio.muted = false;
      entry.audio.volume = clamped;
      enforcePitchLock(entry.audio);
    });
  }

  onAudioContextRunning = () => {
    if (!audioContextPrimed) {
      audioContextPrimed = true;
      primeVoiceProcessingMode().catch(() => {});
    }
    attemptPendingAutoplay();
    if (session.kind === 'user') {
      applyFeedDucking();
    } else {
      feedAudioElements.forEach(set => {
        set.forEach(audioEl => {
          const entry = audioEntryMap.get(audioEl);
          if (!entry) return;
          if (mutedPeers.has(entry.key)) {
            muteFeedEntry(entry);
          } else {
            setFeedEntryLevel(entry, entry.volume ?? defaultVolume);
            enforcePitchLock(entry.audio);
            attemptPlayAudio(entry.audio).catch(() => {});
          }
        });
      });
    }
  };

  function setFeedEntryLevel(entry, value) {
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

  function muteFeedEntry(entry) {
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

  function clearReplyTarget() {
    lastTarget = null;
    btnReply.disabled = true;
    renderReplyButtonLabel();
  }

  clearReplyTarget();

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

  function applyFeedDucking() {
    if (session.kind !== 'user') return;
    const shouldDimSelf = feedDimSelf && isTalking;
    const shouldDuck = activeTalkersForMe.size > 0 || shouldDimSelf;
    const stateChanged = shouldDuck !== feedDuckingActive;
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

        const base = Math.max(0, Math.min(1, entry.volume ?? defaultVolume));
        const targetVol = shouldDim
          ? Math.max(0, Math.min(1, base * feedDuckingFactor))
          : base;

        setFeedEntryLevel(entry, targetVol);
        enforcePitchLock(entry.audio);
        attemptPlayAudio(entry.audio).catch(() => {});
      }
    }

    if (stateChanged) {
      attemptPendingAutoplay();
    }
  }

  function trackTalkerForMe(key, consumerId) {
    let set = talkerConsumersForMe.get(key);
    if (!set) {
      set = new Set();
      talkerConsumersForMe.set(key, set);
    }

    const hadEntries = set.size > 0;
    set.add(consumerId);
    if (!hadEntries) {
      activeTalkersForMe.add(key);
      if (session.kind === 'user') {
        applyFeedDucking();
      }
    }
  }

  function untrackTalkerForMe(key, consumerId) {
    const set = talkerConsumersForMe.get(key);
    if (!set) return;

    if (!set.delete(consumerId)) {
      return;
    }

    if (set.size === 0) {
      talkerConsumersForMe.delete(key);
      if (activeTalkersForMe.delete(key) && session.kind === 'user') {
        applyFeedDucking();
      }
    }
  }

  function clearTalkersForKey(key) {
    talkerConsumersForMe.delete(key);
    if (activeTalkersForMe.delete(key) && session.kind === 'user') {
      applyFeedDucking();
    }
  }

  async function startFeedStream({ manual = false } = {}) {
    if (session.kind !== 'feed') return;
    if (feedStreaming) return;
    if (!session.feedId) return;

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
      speakingPeers.delete(feedKey);
      updateSpeakerHighlight(feedKey, false);
      forEachStreamKey(feedKey, (streamKey) => {
        const consumers = peerConsumers.get(streamKey);
        if (consumers) {
          consumers.forEach(c => { try { c.close(); } catch {} });
          peerConsumers.delete(streamKey);
        }
        const entry = audioElements.get(streamKey);
        if (entry) {
          pendingAutoplayAudios.delete(entry.audio);
          if (entry.mediaSource) {
            try { entry.mediaSource.disconnect(); } catch {}
            entry.mediaSource = null;
          }
          if (entry.gainNode) {
            try { entry.gainNode.disconnect(); } catch {}
            entry.gainNode = null;
          }
          try { entry.audio.pause?.(); } catch {}
          try { entry.audio.srcObject = null; } catch {}
          entry.audio.remove();
          audioEntryMap.delete(entry.audio);
          audioElements.delete(streamKey);
          const feedId = Number(session.feedId);
          feedAudioElements.get(feedId)?.delete(entry.audio);
        }
        unregisterStreamKey(feedKey, streamKey);
      });
    }

    shouldStartFeedWhenReady = false;

    try {
      const selectedDeviceId = inputSelect?.value;
      const audioConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(FEED_PROFILE.constraints || {}),
        ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {})
      };

      const track = await ensureMicTrack(audioConstraints, selectedDeviceId);
      // Hint the browser that this is program audio, not speech
      try { track.contentHint = 'music'; } catch {}
      try { await track.applyConstraints?.({ channelCount: 2 }); } catch {}
      track.enabled = true;

      const processing = ensureFeedProcessingChain(track);
      const processedTrack = processing?.outputTrack || track;
      try { processedTrack.contentHint = 'music'; } catch {}
      try { await processedTrack.applyConstraints?.({ channelCount: 2 }); } catch {}
      processedTrack.enabled = true;

      const newProducer = await sendTransport.produce({
        track: processedTrack,
        appData: { type: 'feed', id: session.feedId },
        codecOptions: FEED_PROFILE.codecOptions ? { ...FEED_PROFILE.codecOptions } : undefined,
        encodings: FEED_PROFILE.encodings ? FEED_PROFILE.encodings.map(enc => ({ ...enc })) : undefined,
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
      try {
        socket.emit('producer-close', { producerId: producer.id });
      } catch (err) {
        console.warn('Error notifying server about feed stop:', err);
      }
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
      speakingPeers.delete(feedKey);
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

  function initializeMediaIfPossible() {
    shouldInitializeAfterConnect = true;
    if (socket.connected) {
      ensureMediaInitialized().catch(err => {
        console.error('Media initialization failed:', err);
      });
    }
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
      socket.emit("register-user", { id: storedId, name: storedName, kind: "user" });
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
      socket.emit("register-user", { id: storedFeedId, name: storedName, kind: "feed" });
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

      localStorage.setItem("userName", user.name);
      localStorage.setItem(IDENTITY_KIND_KEY, kind);

      if (kind === 'user') {
        localStorage.setItem("userId", session.userId);
        localStorage.removeItem(FEED_ID_STORAGE_KEY);
      } else {
        localStorage.setItem(FEED_ID_STORAGE_KEY, session.feedId);
        localStorage.removeItem("userId");
      }

      feedManualStop = false;
      shouldStartFeedWhenReady = kind === 'feed';

      const identityId = kind === 'feed' ? session.feedId : session.userId;
      socket.emit("register-user", { id: identityId, name: user.name, kind });

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

  // Logout Handler
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      if (session.kind === 'feed') {
        stopFeedStream({ manual: true });
      }
      localStorage.removeItem("userId");
      localStorage.removeItem(FEED_ID_STORAGE_KEY);
      localStorage.removeItem("userName");
      localStorage.removeItem(IDENTITY_KIND_KEY);
      location.reload();
    });
  }

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
      if (session.kind === 'user' && session.userId) {
        socket.emit("register-user", { id: session.userId, name: session.name, kind: "user" });
      } else if (session.kind === 'feed' && session.feedId) {
        socket.emit("register-user", { id: session.feedId, name: session.name, kind: "feed" });
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
  });

  socket.on("disconnect", () => {
    console.log("Disconnected from server");
    myIdEl.textContent = "Getrennt";
    clearReplyTarget();
    // Disable all user buttons
    document
      .querySelectorAll(".talk-user")
      .forEach((btn) => (btn.disabled = true));

    mediaInitialized = false;
    initializingMediaPromise = null;
    device = null;
    sendTransport = null;
    recvTransport = null;
    producer = null;
    pendingProducerQueue.length = 0;
    speakingPeers.clear();
    activeTalkersForMe.clear();
    talkerConsumersForMe.clear();
    feedAudioElements.clear();

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
    }
  });

  socket.on('user-targets-updated', async () => {
    if (session.kind !== 'user') return;
    if (cachedUsers.length) {
      await renderTargetList(cachedUsers);
    }
  });

  socket.on('api-talk-command', async ({ action, targetType = 'conference', targetId = null }) => {
    if (session.kind !== 'user') return;
    const dummyEvent = { preventDefault() {} };

    const resolveUserTarget = () => {
      const numericId = Number(targetId);
      const user = cachedUsers.find(u => Number(u.userId) === numericId);
      if (!user || !user.socketId) {
        console.warn('Talk command: target user not available', targetId);
        return null;
      }
      return { type: 'user', id: user.socketId };
    };

    const resolveTarget = () => {
      if (targetType === 'user') return resolveUserTarget();
      if (targetType === 'reply') {
        if (!lastTarget) {
          console.warn('Talk command: no last target for reply');
          return null;
        }
        return { type: lastTarget.type, id: lastTarget.id };
      }
      if (targetType === 'conference') return { type: 'conference', id: Number(targetId) };
      return null; // fallback
    };

    if (action === 'lock-toggle') {
      const target = resolveTarget();
      if (!target) return;
      toggleTalkLock(target);
      return;
    }

    if (action === 'press') {
      const target = resolveTarget();
      if (targetType === 'reply' && target) {
        btnReply.classList.add('active');
      }
      await handleTalk(dummyEvent, target);
    } else if (action === 'release') {
      if (targetType === 'reply') {
        btnReply.classList.remove('active');
      }
      handleStopTalking({ preventDefault() {}, currentTarget: null });
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
          applyVolumeToTarget(targetKey, vol);
          storeVolume(userKey, vol);
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
            handleStopTalking({ preventDefault() {}, currentTarget: activeLockButton });
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
          const nowMuted = mutedPeers.has(targetKey);
          muteIcon.src = nowMuted ? UI_ICONS.speakerMuted : UI_ICONS.speakerOn;
          muteBtn.title = nowMuted ? 'Unmute' : 'Mute';
          muteBtn.classList.toggle('muted', nowMuted);
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
                toggleTalkLock(targetData);
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
        const audios = confAudioElements.get(id);
        if (audios) {
          audios.forEach(a => {
            a.volume = vol;
            const entry = audioEntryMap.get(a);
            if (entry) entry.volume = vol;
          });
        }
        storeVolume(confKey, vol);
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
          handleStopTalking({ preventDefault() {}, currentTarget: activeLockButton });
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
        const nowMuted = mutedPeers.has(key);
        muteIcon.src = nowMuted ? UI_ICONS.speakerMuted : UI_ICONS.speakerOn;
        muteBtn.title = nowMuted ? 'Unmute' : 'Mute';
        muteBtn.classList.toggle('muted', nowMuted);
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
              toggleTalkLock(targetData);
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
        const audios = feedAudioElements.get(id);
        if (audios) {
          audios.forEach(a => {
            const entry = audioEntryMap.get(a);
            if (entry?.audio) {
              entry.volume = vol;
              if (!mutedPeers.has(key)) {
                setFeedEntryLevel(entry, vol);
                enforcePitchLock(entry.audio);
                attemptPlayAudio(entry.audio).catch(() => {});
              }
            }
          });
        }
        storeVolume(feedKey, vol);
        applyFeedDucking();
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
        const nowMuted = mutedPeers.has(key);
        muteIcon.src = nowMuted ? UI_ICONS.speakerMuted : UI_ICONS.speakerOn;
        muteBtn.title = nowMuted ? 'Unmute' : 'Mute';
        muteBtn.classList.toggle('muted', nowMuted);
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
        speakingPeers.delete(feedKey);
        updateSpeakerHighlight(feedKey, false);
      }
      mutedPeers.delete(feedKey);
      pendingAutoplayAudios.delete(entry.audio);
      if (entry.mediaSource) {
        try { entry.mediaSource.disconnect(); } catch {}
        entry.mediaSource = null;
      }
      if (entry.gainNode) {
        try { entry.gainNode.disconnect(); } catch {}
        entry.gainNode = null;
      }
      entry.audio.remove();
      audioEntryMap.delete(entry.audio);
      audioElements.delete(mapKey);
      feedAudioElements.get(feedId)?.delete(entry.audio);
    }

    if (feedsToRemove.length) {
      applyFeedDucking();
    }

    if (activeLockButton && !document.body.contains(activeLockButton)) {
      handleStopTalking({ preventDefault() {}, currentTarget: activeLockButton });
    }

    for (const targetKey of Array.from(speakingPeers)) {
      if (!hasActiveStreams(targetKey)) {
        speakingPeers.delete(targetKey);
      }
    }
    for (const [targetKey, streams] of targetStreamMap.entries()) {
      if (streams && streams.size) {
        speakingPeers.add(targetKey);
      }
    }

    document.querySelectorAll('.target-item').forEach(li => {
      const key = li.id;
      const icon = key.startsWith('user-')
        ? li.querySelector('.user-icon')
        : key.startsWith('conf-')
          ? li.querySelector('.conf-icon')
          : key.startsWith('feed-')
            ? li.querySelector('.feed-icon')
            : null;

      const isSpeaking = speakingPeers.has(key);
      li.classList.toggle('speaking', isSpeaking);
      if (icon) icon.classList.toggle('speaking', isSpeaking);

      li.classList.toggle('last-spoke', lastSpokePeers.has(key));
      const isMuted = mutedPeers.has(key);
      li.classList.toggle('muted', isMuted);
      if (icon) icon.classList.toggle('muted', isMuted);
    });

    if (lastTarget) {
      const key = lastTarget.type === 'conference'
        ? `conf-${lastTarget.id}`
        : `user-${lastTarget.id}`;
      const updatedLabel = targetLabels.get(key);
      if (updatedLabel && updatedLabel !== lastTarget.label) {
        lastTarget = { ...lastTarget, label: updatedLabel };
        renderReplyButtonLabel();
      }
    }

    schedulePttButtonSizing();
    if (!pttSizingListenerBound) {
      window.addEventListener('resize', schedulePttButtonSizing, { passive: true });
      pttSizingListenerBound = true;
    }
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

    try {
      const shouldTrackForMe = !isFeed;

      const { error, ...consumeParams } = await new Promise((resolve) =>
        socket.emit('consume', {
          producerId,
          rtpCapabilities: device.rtpCapabilities,
        }, resolve)
      );
      if (error) throw new Error(error);

      const consumer = await recvTransport.consume(consumeParams);
      const receiver = consumer?.rtpReceiver;
      if (receiver && 'playoutDelayHint' in receiver) {
        try { receiver.playoutDelayHint = 0.1; } catch (err) { console.debug('playoutDelayHint set failed', err); }
      }

      if (!peerConsumers.has(streamKey)) peerConsumers.set(streamKey, new Set());
      peerConsumers.get(streamKey).add(consumer);
      if (mutedPeers.has(targetKey) && !isFeedKey(targetKey)) consumer.pause();
      if (shouldTrackForMe) {
        trackTalkerForMe(targetKey, consumer.id);
      }

      const stream = new MediaStream([consumer.track]);
      const ctxForFeed = isFeed ? ensureAudioContext() : null;

      const initVolRaw = getStoredVolume(volumeStorageKey);
      const initVol = Math.max(0, Math.min(1, initVolRaw));

      const audio = document.createElement('audio');
      audio.srcObject = stream;
      audio.autoplay = true;
      audio.playsInline = true;
      audio.setAttribute('playsinline', 'true');
      audio.setAttribute('autoplay', 'true');
      enforcePitchLock(audio);

      let gainNode = null;
      let mediaSource = null;

      if (isFeed && ctxForFeed) {
        try {
          mediaSource = ctxForFeed.createMediaStreamSource(stream);
          gainNode = ctxForFeed.createGain();
          gainNode.gain.value = 0;
          mediaSource.connect(gainNode);
          gainNode.connect(ctxForFeed.destination);
          audio.muted = true;
          audio.volume = 0;
          if (ctxForFeed.state !== 'running' && typeof ctxForFeed.resume === 'function') {
            ctxForFeed.resume().catch(err => console.warn('Failed to resume AudioContext:', err));
          }
        } catch (err) {
          console.warn('Failed to initialize feed gain path:', err);
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
        type: normalizedAppData.type || 'user',
        gainNode,
        mediaSource,
        lastAppliedLevel: null,
        producerId: effectiveProducerId,
      };
      audioElements.set(streamKey, entry);
      audioEntryMap.set(audio, entry);
      registerStreamKey(targetKey, streamKey);
      if (!speakingPeers.has(targetKey)) {
        speakingPeers.add(targetKey);
        updateSpeakerHighlight(targetKey, true);
      }

      if (isFeed) {
        if (mutedPeers.has(targetKey)) {
          muteFeedEntry(entry);
        } else if (session.kind === 'user') {
          setFeedEntryLevel(entry, entry.volume);
          applyFeedDucking();
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
        const applied = Math.max(0, Math.min(1, entry.volume));
        if (mutedPeers.has(targetKey)) {
          entry.audio.muted = true;
          entry.audio.volume = 0;
        } else {
          entry.audio.muted = false;
          entry.audio.volume = applied;
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

      await new Promise((res) =>
        socket.emit('resume-consumer', { consumerId: consumer.id }, res)
      );

      let consumerClosed = false;
      const handleConsumerClosed = () => {
        if (consumerClosed) return;
        consumerClosed = true;
        console.log(`Producer closed for consumer ${consumer.id}`);

        if (shouldTrackForMe) {
          untrackTalkerForMe(targetKey, consumer.id);
        }

        const consumersSet = peerConsumers.get(streamKey);
        if (consumersSet) {
          consumersSet.delete(consumer);
          if (consumersSet.size === 0) {
            peerConsumers.delete(streamKey);
          }
        }

        unregisterStreamKey(targetKey, streamKey);
        if (!hasActiveStreams(targetKey)) {
          speakingPeers.delete(targetKey);
          updateSpeakerHighlight(targetKey, false);
        }

        pendingAutoplayAudios.delete(audio);
        if (entry.mediaSource) {
          try { entry.mediaSource.disconnect(); } catch {}
          entry.mediaSource = null;
        }
        if (entry.gainNode) {
          try { entry.gainNode.disconnect(); } catch {}
          entry.gainNode = null;
        }
        try { audio.pause?.(); } catch {}
        try { audio.srcObject = null; } catch {}
        audio.remove();
        audioEntryMap.delete(audio);
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
    }
  }

  async function processPendingProducers() {
    if (!device || !recvTransport) return;

    const seenDuringFlush = new Set();
    while (pendingProducerQueue.length) {
      const payload = pendingProducerQueue.shift();
      if (payload?.appData?.type === 'conference' && payload.appData.id != null) {
        seenDuringFlush.add(Number(payload.appData.id));
      }
      try {
        await consumeProducerPayload(payload);
      } catch (err) {
        console.error('Failed to consume queued producer', err);
      }
    }
    if (seenDuringFlush.size) {
      document.querySelectorAll('.target-item.conf-target').forEach(li => {
        const confId = Number(li.dataset.id);
        if (!Number.isFinite(confId)) return;
        const key = `conf-${confId}`;
        if (!seenDuringFlush.has(confId) && !hasActiveStreams(key)) {
          speakingPeers.delete(key);
          lastSpokePeers.delete(key);
          updateSpeakerHighlight(key, false);
        }
      });
    }
  }

  async function requestActiveProducers() {
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

      for (const payload of payloads) {
        await handleIncomingProducer(payload);
      }
    } catch (err) {
      console.error('Failed to request active producers', err);
    }
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
      if (!speakingPruneInterval) {
        speakingPruneInterval = setInterval(pruneSpeakingState, 2000);
      }
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
      if (!hasActiveStreams(key)) {
        speakingPeers.delete(key);
        updateSpeakerHighlight(key, false);
      }
      return;
    }

    consumersSet.forEach(c => {
      if (appData?.type !== 'feed') {
        untrackTalkerForMe(key, c.id);
      }
      try { c.close(); } catch {}
    });
    peerConsumers.delete(streamKey);
    unregisterStreamKey(key, streamKey);

    if (!hasActiveStreams(key)) {
      speakingPeers.delete(key);
      updateSpeakerHighlight(key, false);
    }

    const stored = audioElements.get(streamKey);
    if (stored) {
      const audioEl = stored.audio;
      pendingAutoplayAudios.delete(audioEl);
      // Disconnect any WebAudio nodes first to avoid stale graph artifacts.
      if (stored.mediaSource) {
        try { stored.mediaSource.disconnect(); } catch {}
        stored.mediaSource = null;
      }
      if (stored.gainNode) {
        try { stored.gainNode.disconnect(); } catch {}
        stored.gainNode = null;
      }
      // Release element playback and stream reference before removing.
      try { audioEl.pause?.(); } catch {}
      try { audioEl.srcObject = null; } catch {}
      audioEl.remove();
      audioEntryMap.delete(audioEl);
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

    let lockTargetMatches = false;
    if (activeLockButton && !isFeed && (isConference || isUser)) {
      const candidate = {
        type: isConference ? "conference" : "user",
        id: rawId,
      };
      lockTargetMatches = isSameTarget(activeLockTarget, candidate);
    }

    const lastTargetMatchesKey =
      lastTarget &&
      (lastTarget.type === "conference"
        ? `conf-${lastTarget.id}` === targetKey
        : lastTarget.type === "user"
          ? `user-${lastTarget.id}` === targetKey
          : false);

    if (!el) {
      if (!isFeed && lastTargetMatchesKey) {
        clearReplyTarget();
      }
      applyFeedDucking();
      return;
    }

  if (isSpeaking) {
    el?.classList.add("speaking");
    el?.classList.remove("last-spoke");
    icon?.classList.add("speaking");
    lastSpokePeers.delete(targetKey);
    return;
  }

    el?.classList.remove("speaking");
    icon?.classList.remove("speaking");
    if (lockTargetMatches) {
      el?.classList.add("talking-to");
    }

    const labelText = getTargetLabel(targetKey);

    if (isFeed) {
      el?.classList.remove("last-spoke");
      lastSpokePeers.delete(targetKey);
      return;
    }

    if (!isConference && !isUser) {
      clearReplyTarget();
    } else {
      const targetData = {
        type: isConference ? "conference" : "user",
        id: rawId,
        label: labelText || rawId,
      };

      if (targetData.type === "user" && targetData.id === socket.id) {
        lastTarget = null;
      } else {
        lastTarget = targetData;
      }
    }

    btnReply.disabled = !lastTarget;
    renderReplyButtonLabel();

    document.querySelectorAll(".last-spoke")
        .forEach(elem => elem.classList.remove("last-spoke"));
    el?.classList.add("last-spoke");
    lastSpokePeers.clear();
    lastSpokePeers.set(targetKey, Date.now());

/*    setTimeout(() => {
      if (!speakingPeers.has(targetKey)) {
        el?.classList.remove("last-spoke");
        if (lastTarget &&
            (lastTarget.type === "conference"
                ? `conf-${lastTarget.id}` === targetKey
                : `user-${lastTarget.id}` === targetKey)
        ) {
          clearReplyTarget();
        }
      }
    }, 20000);*/

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
  function toggleMute(rawId) {
    // 1) Derive the key
    const key = toKey(rawId);

    // ─── Debug helper ──────────────────────────────────────────────
    const consumers = collectConsumersForTarget(key);
    console.log("[DEBUG] toggleMute with key:", key, "Consumers:", consumers.length);

    // 2) Remaining logic
    const wasMuted = mutedPeers.has(key);
    if (wasMuted) mutedPeers.delete(key);
    else          mutedPeers.add(key);

    const nowMuted = mutedPeers.has(key);

    if (isFeedKey(key)) {
      forEachStreamEntry(key, (entry) => {
        if (nowMuted) {
          muteFeedEntry(entry);
        } else {
          setFeedEntryLevel(entry, entry.volume ?? defaultVolume);
          enforcePitchLock(entry.audio);
          attemptPlayAudio(entry.audio).catch(() => {});
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
          entry.audio.muted = true;
          entry.audio.volume = 0;
        } else {
          const base = Math.max(0, Math.min(1, entry.volume ?? defaultVolume));
          const applied = Math.max(0, Math.min(1, base));
          entry.audio.muted = false;
          entry.audio.volume = applied;
          enforcePitchLock(entry.audio);
          attemptPlayAudio(entry.audio).catch(() => {});
        }
      });
    }

    // Update icon and list entry
    const elSelector   = `#${key}`;
    const iconSelector = key.startsWith("conf-")
        ? `${elSelector} .conf-icon`
        : key.startsWith('feed-')
          ? `${elSelector} .feed-icon`
          : `${elSelector} .user-icon`;

    document.querySelector(elSelector)?.classList.toggle("muted", nowMuted);
    document.querySelector(iconSelector)?.classList.toggle("muted", nowMuted);
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

  function activateTalkLock(target, button) {
    if (session.kind !== 'user') return;
    if (!target || !button) return;
    activeLockButton = button;
    activeLockTarget = { type: target.type, id: target.id };
    setTalkButtonLocked(button, true);
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
    if (producer) return;
    if (!target) return;
    const targetKey = keyFromTarget(target);
    if (!slideHintShown && targetKey && !targetKey.startsWith('feed-')) {
      const li = document.getElementById(targetKey);
      if (li) {
        slideHintShown = true;
        li.classList.add('show-slide-hint');
        setTimeout(() => li.classList.remove('show-slide-hint'), 3000);
      }
    }

    isTalking     = true;
    currentTarget = target;
    currentTargetPeer = target.type === 'user' ? target.id : null;
    if (feedDimSelf) {
      applyFeedDucking();
    }

    const shouldPinSelfColor = targetKey ? speakingPeers.has(targetKey) : false;
    setSelfTalkingKey(shouldPinSelfColor ? targetKey : null);

    try {
      const qualityKey = currentQualityKey();
      const profile = QUALITY_PROFILES[qualityKey] || QUALITY_PROFILES['low-latency'];

      // 1️⃣ Read the selected microphone from the dropdown
      const inputSelect = document.getElementById("input-select");
      const selectedDeviceId = inputSelect?.value;

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
      track.enabled = true;

      let processedTrack = null;
      if (!audioProcessingEnabled) {
        const processing = ensureUserProcessingChain(track);
        processedTrack = processing?.outputTrack || null;
      }

      const finalTrack = processedTrack || track;
      finalTrack.enabled = true;

      // ◆ Producer parameters: always include appData
      const params = {
        track: finalTrack,
        appData: { type: target.type, id: target.id },
        codecOptions: profile?.codecOptions ? { ...profile.codecOptions } : undefined,
        encodings: profile?.encodings ? profile.encodings.map(enc => ({ ...enc })) : undefined,
        stopTracks: false,
      };

      // ◆ Start producing
      const newProducer = await sendTransport.produce(params);

      // ◆ If the button was released in the meantime
      if (!isTalking) {
        newProducer.close();
        finalTrack.enabled = false;
        if (processedTrack && processedTrack !== track) {
          processedTrack.enabled = false;
        }
        track.enabled = false;
        scheduleMicCleanup();
        return;
      }

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
      const selector = target.type === "user"
          ? `#user-${target.id}`
          : `#conf-${target.id}`;
      document.querySelector(selector)?.classList.add("talking-to");
    } catch (err) {
      console.error("Microphone error:", err);
      alert("Failed to start the microphone: " + err.message);
      setReplyButtonActive(false);
      clearLockState();
      isTalking = false;
      if (micTrack) {
        micTrack.enabled = false;
      }
      if (userProcessingChain?.outputTrack) {
        userProcessingChain.outputTrack.enabled = false;
      }
      scheduleMicCleanup();
      applyFeedDucking();

      if (currentTarget) {
        const selector = currentTarget.type === "conference"
            ? `#conf-${currentTarget.id}`
            : `#user-${currentTarget.id}`;
        document.querySelector(selector)?.classList.remove("talking-to");
      }
      currentTarget = null;
      setSelfTalkingKey(null);
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

    if (activeLockButton && e.currentTarget && e.currentTarget !== activeLockButton) {
      return;
    }

    isTalking = false;
    setSelfTalkingKey(null);

    // Reset button states
    setReplyButtonActive(false);
    clearLockState();

    if (producer) {
      socket.emit("producer-close", { producerId: producer.id });
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
    if (currentTarget) {
      const li = document.querySelector(
          currentTarget.type === "conference"
              ? `#conf-${currentTarget.id}`
              : `#user-${currentTarget.id}`
      );
      li?.classList.remove("talking-to");
    }
    currentTarget = null;
    currentTargetPeer = null;
    applyFeedDucking();
    attemptPendingAutoplay();
    clearHotkeyActiveStyles();
    pressedHotkeyDigits.clear();
  }

  // Safety stop so PTT can't get stuck on iOS/background transitions.
  function stopTalkingSafely({ respectLock = false } = {}) {
    if (session.kind !== 'user') return;
    if (!producer && !isTalking) return;
    if (respectLock && activeLockButton) return;
    handleStopTalking({ preventDefault() {}, currentTarget: null });
  }

  function stopTalkingIfHidden() {
    if (document.visibilityState === 'hidden') {
      stopTalkingSafely();
    }
  }

  document.addEventListener('visibilitychange', stopTalkingIfHidden);
  window.addEventListener('pagehide', () => stopTalkingSafely());
  window.addEventListener('blur', () => stopTalkingSafely({ respectLock: true }));
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
