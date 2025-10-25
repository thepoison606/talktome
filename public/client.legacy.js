(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __objRest = (source, exclude) => {
    var target = {};
    for (var prop in source)
      if (__hasOwnProp.call(source, prop) && exclude.indexOf(prop) < 0)
        target[prop] = source[prop];
    if (source != null && __getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(source)) {
        if (exclude.indexOf(prop) < 0 && __propIsEnum.call(source, prop))
          target[prop] = source[prop];
      }
    return target;
  };
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
        opusMaxAverageBitrate: 48e3,
        opusPtime: 5
      },
      encodings: [{ dtx: true, maxBitrate: 48e3, priority: "high" }],
      constraints: { channelCount: 1, sampleRate: 48e3 },
      note: "minimal latency, best on stable networks"
    },
    low: {
      label: "Low (10 ms, DTX on)",
      codecLabel: "opus 48k",
      codecOptions: {
        opusStereo: 0,
        opusFec: 0,
        opusDtx: 1,
        opusMaxAverageBitrate: 64e3,
        opusPtime: 10
      },
      encodings: [{ dtx: true, maxBitrate: 64e3, priority: "high" }],
      constraints: { channelCount: 1, sampleRate: 48e3 },
      note: "balanced latency vs. robustness"
    },
    standard: {
      label: "Standard (20 ms, DTX off)",
      codecLabel: "opus 48k",
      codecOptions: {
        opusStereo: 0,
        opusFec: 1,
        opusDtx: 0,
        opusMaxAverageBitrate: 64e3,
        opusPtime: 20
      },
      encodings: [{ dtx: false, maxBitrate: 64e3, priority: "high" }],
      constraints: { channelCount: 1, sampleRate: 48e3 },
      note: "highest resilience, highest latency"
    }
  };
  const defaultVolume = 0.9;
  const IDENTITY_KIND_KEY = "identityKind";
  const FEED_ID_STORAGE_KEY = "feedId";
  const FEED_DUCKING_DB_STORAGE_KEY = "feedDimDb";
  const DEFAULT_FEED_DUCKING_DB = -14;
  const FEED_DUCKING_DB_MIN = -60;
  const FEED_DUCKING_DB_MAX = -6;
  const FEED_DIM_SELF_STORAGE_KEY = "feedDimSelf";
  const AUDIO_PROCESSING_STORAGE_KEY = "audioProcessingEnabled";
  const FEED_INPUT_GAIN_DB_STORAGE_KEY = "feedInputGainDb";
  const FEED_INPUT_GAIN_DB_MIN = -30;
  const FEED_INPUT_GAIN_DB_MAX = 40;
  const FEED_METER_MIN_DB = -60;
  const FEED_CLIP_THRESHOLD_DB = -0.5;
  const USER_INPUT_GAIN_DB_STORAGE_KEY = "userInputGainDb";
  const USER_INPUT_GAIN_DB_MIN = -30;
  const USER_INPUT_GAIN_DB_MAX = 40;
  const USER_METER_MIN_DB = -60;
  const USER_CLIP_THRESHOLD_DB = -0.5;
  const FEED_METER_TEXT_UPDATE_INTERVAL_MS = 160;
  const USER_METER_TEXT_UPDATE_INTERVAL_MS = 160;
  const METER_TEXT_DB_THRESHOLD = 0.5;
  let feedDuckingDb = DEFAULT_FEED_DUCKING_DB;
  let feedDuckingFactor = dbToLinear(feedDuckingDb);
  let feedDimSelf = false;
  let audioProcessingEnabled = false;
  const audioProcessingOptions = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  };
  let feedInputGainDb = 18;
  let feedInputGainLinear = dbToLinear(feedInputGainDb);
  let userInputGainDb = 18;
  let userInputGainLinear = dbToLinear(userInputGainDb);
  var _a, _b, _c, _d, _e;
  if (typeof window !== "undefined") {
    try {
      const storedDb = (_a = window.localStorage) == null ? void 0 : _a.getItem(FEED_DUCKING_DB_STORAGE_KEY);
      if (storedDb !== null) {
        const parsed = parseFloat(storedDb);
        if (!Number.isNaN(parsed)) {
          feedDuckingDb = clampFeedDuckingDb(parsed);
          feedDuckingFactor = dbToLinear(feedDuckingDb);
        }
      }
      const storedSelfDim = (_b = window.localStorage) == null ? void 0 : _b.getItem(FEED_DIM_SELF_STORAGE_KEY);
      if (storedSelfDim !== null) {
        feedDimSelf = storedSelfDim === "true";
      }
      const storedProcessing = (_c = window.localStorage) == null ? void 0 : _c.getItem(AUDIO_PROCESSING_STORAGE_KEY);
      if (storedProcessing !== null) {
        audioProcessingEnabled = storedProcessing === "true";
      }
      const storedInputGainDb = (_d = window.localStorage) == null ? void 0 : _d.getItem(FEED_INPUT_GAIN_DB_STORAGE_KEY);
      if (storedInputGainDb !== null) {
        const parsedGainDb = parseFloat(storedInputGainDb);
        if (!Number.isNaN(parsedGainDb)) {
          feedInputGainDb = clampFeedInputGainDb(parsedGainDb);
          feedInputGainLinear = dbToLinear(feedInputGainDb);
        }
      }
      const storedUserGainDb = (_e = window.localStorage) == null ? void 0 : _e.getItem(USER_INPUT_GAIN_DB_STORAGE_KEY);
      if (storedUserGainDb !== null) {
        const parsedUserGainDb = parseFloat(storedUserGainDb);
        if (!Number.isNaN(parsedUserGainDb)) {
          userInputGainDb = clampUserInputGainDb(parsedUserGainDb);
          userInputGainLinear = dbToLinear(userInputGainDb);
        }
      }
    } catch (err) {
      console.warn("Unable to restore feed dim level from storage:", err);
    }
  }
  syncAudioProcessingOptions();
  const isiOS = typeof navigator !== "undefined" ? /iPad|iPhone|iPod/.test(navigator.userAgent || "") || navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent || "") : false;
  const FEED_PROFILE = {
    label: "Feed (raw stream)",
    codecLabel: "opus 48k",
    codecOptions: {
      opusStereo: 0,
      opusFec: 0,
      opusDtx: 0,
      opusMaxAverageBitrate: 128e3,
      opusPtime: 20
    },
    encodings: [{ dtx: false, maxBitrate: 128e3, priority: "high" }],
    constraints: { channelCount: 1, sampleRate: 48e3 }
  };
  let session = { kind: "guest", userId: null, feedId: null, name: null };
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
  let feedMeterBarEl;
  let feedMeterClipEl;
  let feedMeterValueEl;
  let feedMeterLastText = "-inf dB";
  let feedMeterLastTextTime = 0;
  let feedMeterLastDb = -Infinity;
  let userMeterLastText = "-inf dB";
  let userMeterLastTextTime = 0;
  let userMeterLastDb = -Infinity;
  const MIC_DEVICE_STORAGE_KEY = "preferredAudioInputDeviceId";
  let micStream = null;
  let micTrack = null;
  let micDeviceId = null;
  let micCleanupTimer = null;
  let micPrimed = false;
  let micPrimingPromise = null;
  let feedStreaming = false;
  let feedManualStop = false;
  let shouldStartFeedWhenReady = false;
  const USER_ACTIVATION_EVENTS = ["pointerdown", "touchstart", "keydown"];
  const pendingAutoplayAudios = /* @__PURE__ */ new Set();
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
    if (rounded === 0) return "No dim (0 dB)";
    return `Custom (${rounded} dB)`;
  }
  function formatDbDisplay(dbValue) {
    if (!Number.isFinite(dbValue)) return "-inf dB";
    const rounded = Math.round(dbValue * 10) / 10;
    const normalized = Object.is(rounded, -0) ? 0 : rounded;
    const sign = normalized >= 0 ? "+" : "";
    return `${sign}${normalized.toFixed(1)} dB`;
  }
  function syncDimAmountSelect(value) {
    if (!dimAmountSelect) return;
    const valueStr = String(value);
    const options = Array.from(dimAmountSelect.options);
    if (!options.some((opt) => opt.value === valueStr)) {
      const opt = document.createElement("option");
      opt.value = valueStr;
      opt.textContent = formatFeedDimDbOptionText(value);
      dimAmountSelect.appendChild(opt);
    }
    if (dimAmountSelect.value !== valueStr) {
      dimAmountSelect.value = valueStr;
    }
  }
  function ensureAudioContext() {
    if (typeof window === "undefined") return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioContext) {
      try {
        sharedAudioContext = new AudioCtx({ latencyHint: "interactive", sampleRate: 48e3 });
        sharedAudioContext.addEventListener("statechange", () => {
          if (sharedAudioContext.state === "running" && typeof onAudioContextRunning === "function") {
            onAudioContextRunning();
          }
        });
      } catch (err) {
        console.warn("Failed to create AudioContext:", err);
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
    var _a2;
    audioProcessingEnabled = !!enabled;
    const applied = syncAudioProcessingOptions();
    if (updateUI && audioProcessingToggle) {
      audioProcessingToggle.checked = applied;
    }
    applyUserGainControlState();
    if (applied) {
      destroyUserProcessing();
    } else if (micTrack && session.kind !== "feed" && !reinitialize) {
      ensureUserProcessingChain(micTrack);
    }
    if (persist && typeof window !== "undefined") {
      try {
        (_a2 = window.localStorage) == null ? void 0 : _a2.setItem(AUDIO_PROCESSING_STORAGE_KEY, String(applied));
      } catch (err) {
        console.warn("Unable to persist audio processing preference:", err);
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
    var _a2;
    if (Number.isNaN(dbValue) || !Number.isFinite(dbValue)) return;
    const clamped = clampFeedInputGainDb(dbValue);
    feedInputGainDb = clamped;
    feedInputGainLinear = dbToLinear(clamped);
    updateFeedGainUI();
    if (persist && typeof window !== "undefined") {
      try {
        (_a2 = window.localStorage) == null ? void 0 : _a2.setItem(FEED_INPUT_GAIN_DB_STORAGE_KEY, String(clamped));
      } catch (err) {
        console.warn("Unable to persist feed input gain:", err);
      }
    }
    if (apply && (feedProcessingChain == null ? void 0 : feedProcessingChain.gainNode)) {
      feedProcessingChain.gainNode.gain.value = feedInputGainLinear;
    }
  }
  function nowMs() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }
  function textToDbValue(text) {
    if (typeof text !== "string") return NaN;
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith("-inf")) return -Infinity;
    const parsed = parseFloat(trimmed);
    return Number.isNaN(parsed) ? NaN : parsed;
  }
  function hasSignificantDbChange(lastDb, nextDb) {
    if (!Number.isFinite(lastDb) || !Number.isFinite(nextDb)) {
      return lastDb !== nextDb;
    }
    return Math.abs(nextDb - lastDb) >= METER_TEXT_DB_THRESHOLD;
  }
  function setFeedMeterDisplay(fraction, text, showClip, clipFraction = null, { forceText = false } = {}) {
    const clampedFraction = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
    if (feedMeterBarEl) {
      feedMeterBarEl.style.width = `${(clampedFraction * 100).toFixed(1)}%`;
    }
    if (feedMeterValueEl) {
      const now = nowMs();
      const elapsed = now - feedMeterLastTextTime;
      const nextDb = textToDbValue(text);
      const dbChanged = hasSignificantDbChange(feedMeterLastDb, nextDb);
      const allowUpdate = forceText || elapsed >= FEED_METER_TEXT_UPDATE_INTERVAL_MS || dbChanged;
      if (allowUpdate) {
        feedMeterValueEl.textContent = text;
        feedMeterLastText = text;
        feedMeterLastTextTime = now;
        feedMeterLastDb = nextDb;
      }
      feedMeterValueEl.classList.toggle("is-clipping", !!showClip);
    }
    if (feedMeterClipEl) {
      if (showClip) {
        const raw = clipFraction == null ? 1 : Number(clipFraction);
        const clampedClip = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 1));
        feedMeterClipEl.style.left = `${(clampedClip * 100).toFixed(1)}%`;
        feedMeterClipEl.style.opacity = "1";
      } else {
        feedMeterClipEl.style.opacity = "0";
      }
    }
  }
  function destroyFeedProcessing({ resetUI = true } = {}) {
    var _a2, _b2, _c2, _d2, _e2, _f, _g, _h;
    if (!feedProcessingChain) return;
    if (feedProcessingChain.rafId) {
      cancelAnimationFrame(feedProcessingChain.rafId);
    }
    try {
      (_a2 = feedProcessingChain.sourceNode) == null ? void 0 : _a2.disconnect();
    } catch (e) {
    }
    try {
      (_b2 = feedProcessingChain.gainNode) == null ? void 0 : _b2.disconnect();
    } catch (e) {
    }
    try {
      (_c2 = feedProcessingChain.analyser) == null ? void 0 : _c2.disconnect();
    } catch (e) {
    }
    try {
      const tracks = (_f = (_e2 = (_d2 = feedProcessingChain.destination) == null ? void 0 : _d2.stream) == null ? void 0 : _e2.getAudioTracks) == null ? void 0 : _f.call(_e2);
      if (tracks && typeof tracks.forEach === "function") {
        tracks.forEach((track) => {
          if (track && track.readyState !== "ended") {
            try {
              track.stop();
            } catch (e) {
            }
          }
        });
      }
    } catch (err) {
      console.warn("Error stopping feed destination tracks:", err);
    }
    try {
      (_h = (_g = feedProcessingChain.outputTrack) == null ? void 0 : _g.stop) == null ? void 0 : _h.call(_g);
    } catch (e) {
    }
    feedProcessingChain = null;
    if (resetUI) {
      setFeedMeterDisplay(0, formatDbDisplay(-Infinity), false, null, { forceText: true });
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
    const normalizedDb = Number.isFinite(peakDb) ? Math.max(FEED_METER_MIN_DB, Math.min(0, peakDb)) : FEED_METER_MIN_DB;
    const fraction = normalizedDb <= FEED_METER_MIN_DB ? 0 : (normalizedDb - FEED_METER_MIN_DB) / (0 - FEED_METER_MIN_DB);
    const clipDetected = Number.isFinite(peakDb) && peakDb >= FEED_CLIP_THRESHOLD_DB;
    if (clipDetected) {
      chain.clipHoldFrames = 24;
    } else if (chain.clipHoldFrames > 0) {
      chain.clipHoldFrames -= 1;
    }
    const showClip = (chain.clipHoldFrames || 0) > 0;
    const displayText = Number.isFinite(peakDb) ? formatDbDisplay(peakDb) : "-inf dB";
    setFeedMeterDisplay(fraction, displayText, showClip, fraction);
  }
  function ensureFeedProcessingChain(track) {
    const ctx = ensureAudioContext();
    if (!ctx) {
      console.warn("AudioContext unavailable; feed input gain disabled.");
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
      console.warn("Unable to create feed source stream:", err);
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
      gainNode.gain.value = feedInputGainLinear;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.98;
      destination = ctx.createMediaStreamDestination();
      sourceNode.connect(gainNode);
      gainNode.connect(analyser);
      analyser.connect(destination);
      [outputTrack] = destination.stream.getAudioTracks();
    } catch (err) {
      console.error("Failed to set up feed processing chain:", err);
      try {
        sourceNode == null ? void 0 : sourceNode.disconnect();
      } catch (e) {
      }
      try {
        gainNode == null ? void 0 : gainNode.disconnect();
      } catch (e) {
      }
      try {
        analyser == null ? void 0 : analyser.disconnect();
      } catch (e) {
      }
      return null;
    }
    if (!outputTrack) {
      console.warn("Feed processing destination produced no audio track.");
      try {
        sourceNode == null ? void 0 : sourceNode.disconnect();
      } catch (e) {
      }
      try {
        gainNode == null ? void 0 : gainNode.disconnect();
      } catch (e) {
      }
      try {
        analyser == null ? void 0 : analyser.disconnect();
      } catch (e) {
      }
      return null;
    }
    outputTrack.enabled = track.enabled;
    outputTrack.contentHint = track.contentHint || "speech";
    const meterData = new Float32Array(analyser.fftSize);
    feedProcessingChain = {
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
      clipHoldFrames: 0
    };
    setFeedMeterDisplay(0, formatDbDisplay(-Infinity), false, null, { forceText: true });
    scheduleFeedMeterUpdate();
    if (typeof outputTrack.addEventListener === "function") {
      outputTrack.addEventListener("ended", () => {
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
    var _a2;
    const selected = inputSelect == null ? void 0 : inputSelect.value;
    if (selected && selected !== "") return selected;
    try {
      const stored = (_a2 = window.localStorage) == null ? void 0 : _a2.getItem(MIC_DEVICE_STORAGE_KEY);
      return stored || null;
    } catch (e) {
      return null;
    }
  }
  function buildUserAudioConstraints(selectedDeviceId) {
    const qualityKey = currentQualityKey();
    const profile = QUALITY_PROFILES[qualityKey] || QUALITY_PROFILES["ultra-low"];
    const constraints = __spreadValues({
      echoCancellation: audioProcessingOptions.echoCancellation,
      noiseSuppression: audioProcessingOptions.noiseSuppression,
      autoGainControl: audioProcessingOptions.autoGainControl
    }, (profile == null ? void 0 : profile.constraints) || {});
    if (selectedDeviceId) {
      constraints.deviceId = { exact: selectedDeviceId };
    }
    return constraints;
  }
  function buildFeedAudioConstraints(selectedDeviceId) {
    const constraints = __spreadValues({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }, FEED_PROFILE.constraints || {});
    if (selectedDeviceId) {
      constraints.deviceId = { exact: selectedDeviceId };
    }
    return constraints;
  }
  function getCurrentAudioConstraints() {
    const selectedDeviceId = getSelectedDeviceId();
    const constraints = session.kind === "feed" ? buildFeedAudioConstraints(selectedDeviceId) : buildUserAudioConstraints(selectedDeviceId);
    return { constraints, selectedDeviceId };
  }
  async function startInputMonitor() {
    if (!settingsMenuOpen) return null;
    if (settingsMonitorActive || settingsMonitorPromise) {
      return settingsMonitorPromise;
    }
    if (session.kind === "guest") return null;
    const { constraints, selectedDeviceId } = getCurrentAudioConstraints();
    const startPromise = (async () => {
      try {
        const track = await ensureMicTrack(constraints, selectedDeviceId);
        if (!track) return null;
        if (!settingsMenuOpen) {
          if (!producer && !feedStreaming && !isTalking) {
            try {
              track.enabled = false;
            } catch (e) {
            }
          }
          return null;
        }
        track.enabled = true;
        settingsMonitorActive = true;
        if (session.kind !== "feed" && !audioProcessingEnabled) {
          ensureUserProcessingChain(track);
        }
        if (session.kind === "feed" && feedProcessingChain) {
          scheduleFeedMeterUpdate();
        }
        if (!audioProcessingEnabled && userProcessingChain) {
          scheduleUserMeterUpdate();
        }
        return track;
      } catch (err) {
        console.warn("Failed to start microphone monitoring:", err);
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
  if (typeof window !== "undefined") {
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
    const disabled = audioProcessingEnabled || session.kind === "feed";
    if (userLevelControls) {
      userLevelControls.classList.toggle("is-disabled", disabled);
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
    var _a2;
    if (Number.isNaN(dbValue) || !Number.isFinite(dbValue)) return;
    const clamped = clampUserInputGainDb(dbValue);
    userInputGainDb = clamped;
    userInputGainLinear = dbToLinear(clamped);
    updateUserGainUI();
    if (persist && typeof window !== "undefined") {
      try {
        (_a2 = window.localStorage) == null ? void 0 : _a2.setItem(USER_INPUT_GAIN_DB_STORAGE_KEY, String(clamped));
      } catch (err) {
        console.warn("Unable to persist user input gain:", err);
      }
    }
    if (apply && (userProcessingChain == null ? void 0 : userProcessingChain.gainNode)) {
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
      const allowUpdate = forceText || elapsed >= USER_METER_TEXT_UPDATE_INTERVAL_MS || dbChanged;
      if (allowUpdate) {
        userMeterValueEl.textContent = text;
        userMeterLastText = text;
        userMeterLastTextTime = now;
        userMeterLastDb = nextDb;
      }
      userMeterValueEl.classList.toggle("is-clipping", !!showClip);
    }
    if (userMeterClipEl) {
      if (showClip) {
        const raw = clipFraction == null ? 1 : Number(clipFraction);
        const clampedClip = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 1));
        userMeterClipEl.style.left = `${(clampedClip * 100).toFixed(1)}%`;
        userMeterClipEl.style.opacity = "1";
      } else {
        userMeterClipEl.style.opacity = "0";
      }
    }
  }
  function destroyUserProcessing({ resetUI = true } = {}) {
    var _a2, _b2, _c2, _d2, _e2, _f, _g, _h;
    if (!userProcessingChain) return;
    if (userProcessingChain.rafId) {
      cancelAnimationFrame(userProcessingChain.rafId);
    }
    try {
      (_a2 = userProcessingChain.sourceNode) == null ? void 0 : _a2.disconnect();
    } catch (e) {
    }
    try {
      (_b2 = userProcessingChain.gainNode) == null ? void 0 : _b2.disconnect();
    } catch (e) {
    }
    try {
      (_c2 = userProcessingChain.analyser) == null ? void 0 : _c2.disconnect();
    } catch (e) {
    }
    try {
      const tracks = (_f = (_e2 = (_d2 = userProcessingChain.destination) == null ? void 0 : _d2.stream) == null ? void 0 : _e2.getAudioTracks) == null ? void 0 : _f.call(_e2);
      if (tracks && typeof tracks.forEach === "function") {
        tracks.forEach((track) => {
          if (track && track.readyState !== "ended") {
            try {
              track.stop();
            } catch (e) {
            }
          }
        });
      }
    } catch (err) {
      console.warn("Error stopping user destination tracks:", err);
    }
    try {
      (_h = (_g = userProcessingChain.outputTrack) == null ? void 0 : _g.stop) == null ? void 0 : _h.call(_g);
    } catch (e) {
    }
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
    const normalizedDb = Number.isFinite(peakDb) ? Math.max(USER_METER_MIN_DB, Math.min(0, peakDb)) : USER_METER_MIN_DB;
    const fraction = normalizedDb <= USER_METER_MIN_DB ? 0 : (normalizedDb - USER_METER_MIN_DB) / (0 - USER_METER_MIN_DB);
    const clipDetected = Number.isFinite(peakDb) && peakDb >= USER_CLIP_THRESHOLD_DB;
    if (clipDetected) {
      chain.clipHoldFrames = 24;
    } else if (chain.clipHoldFrames > 0) {
      chain.clipHoldFrames -= 1;
    }
    const showClip = (chain.clipHoldFrames || 0) > 0;
    const displayText = Number.isFinite(peakDb) ? formatDbDisplay(peakDb) : "-inf dB";
    setUserMeterDisplay(fraction, displayText, showClip, fraction);
  }
  function ensureUserProcessingChain(track) {
    const ctx = ensureAudioContext();
    if (!ctx) {
      console.warn("AudioContext unavailable; user manual gain disabled.");
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
      console.warn("Unable to create user source stream:", err);
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
      console.error("Failed to set up user processing chain:", err);
      try {
        sourceNode == null ? void 0 : sourceNode.disconnect();
      } catch (e) {
      }
      try {
        gainNode == null ? void 0 : gainNode.disconnect();
      } catch (e) {
      }
      try {
        analyser == null ? void 0 : analyser.disconnect();
      } catch (e) {
      }
      return null;
    }
    if (!outputTrack) {
      console.warn("User processing destination produced no audio track.");
      try {
        sourceNode == null ? void 0 : sourceNode.disconnect();
      } catch (e) {
      }
      try {
        gainNode == null ? void 0 : gainNode.disconnect();
      } catch (e) {
      }
      try {
        analyser == null ? void 0 : analyser.disconnect();
      } catch (e) {
      }
      return null;
    }
    outputTrack.enabled = track.enabled;
    outputTrack.contentHint = track.contentHint || "speech";
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
      clipHoldFrames: 0
    };
    setUserMeterDisplay(0, formatDbDisplay(-Infinity), false, null, { forceText: true });
    scheduleUserMeterUpdate();
    if (typeof outputTrack.addEventListener === "function") {
      outputTrack.addEventListener("ended", () => {
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
    pendingAutoplayAudios.forEach((audio) => {
      var _a2;
      const playPromise = (_a2 = audio.play) == null ? void 0 : _a2.call(audio);
      if (!playPromise || typeof playPromise.then !== "function") {
        if (!audio.paused) {
          pendingAutoplayAudios.delete(audio);
        }
        return;
      }
      playPromise.then(() => pendingAutoplayAudios.delete(audio)).catch((err) => console.warn("Autoplay retry failed:", err));
    });
  }
  function handleUserActivation() {
    attemptPendingAutoplay();
    primeVoiceProcessingMode().catch(() => {
    });
    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === "running") {
      if (typeof onAudioContextRunning === "function") {
        onAudioContextRunning();
      }
      return;
    }
    if (ctx.state === "suspended" && typeof ctx.resume === "function") {
      ctx.resume().then(() => {
        if (typeof onAudioContextRunning === "function") {
          onAudioContextRunning();
        }
      }).catch((err) => {
        console.warn("Failed to resume AudioContext:", err);
      });
    }
  }
  USER_ACTIVATION_EVENTS.forEach((event) => {
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
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      console.warn("No microphone access; device labels may be empty", e);
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === "audioinput");
    if (inputSelect) {
      inputSelect.innerHTML = `<option value="">Select device</option>`;
      inputs.forEach((d) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || `Microphone ${inputSelect.length}`;
        inputSelect.append(opt);
      });
      const storedDeviceId = localStorage.getItem(MIC_DEVICE_STORAGE_KEY);
      const availableIds = new Set(inputs.map((d) => d.deviceId));
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
          const match = Array.from(inputSelect.options).find((opt) => opt.value === desiredDeviceId);
          if (match) {
            match.selected = true;
          }
        }
        localStorage.setItem(MIC_DEVICE_STORAGE_KEY, desiredDeviceId);
      } else {
        inputSelect.value = "";
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
      try {
        micTrack.stop();
      } catch (e) {
      }
      micTrack.onended = null;
      micTrack = null;
    }
    if (micStream) {
      micStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
        }
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
    }, 6e4);
  }
  async function ensureMicTrack(audioConstraints, selectedDeviceId) {
    var _a2;
    if (micTrack && micTrack.readyState === "live") {
      if (!selectedDeviceId || selectedDeviceId === micDeviceId) {
        if (micCleanupTimer) {
          clearTimeout(micCleanupTimer);
          micCleanupTimer = null;
        }
        if (session.kind !== "feed") {
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
    micDeviceId = selectedDeviceId || ((_a2 = track.getSettings) == null ? void 0 : _a2.call(track).deviceId) || null;
    micPrimed = true;
    if (micDeviceId) {
      localStorage.setItem(MIC_DEVICE_STORAGE_KEY, micDeviceId);
      if (inputSelect && inputSelect.value !== micDeviceId) {
        const match = Array.from(inputSelect.options || []).find((opt) => opt.value === micDeviceId);
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
    if (session.kind !== "feed") {
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
            autoGainControl: true
          },
          video: false
        });
        const [track] = stream.getAudioTracks();
        if (!track) {
          console.warn("Voice processing priming: no audio track returned");
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
            await new Promise((res) => setTimeout(res, 200));
            source.disconnect();
            gain.disconnect();
          } catch (err) {
            console.warn("Voice processing priming via AudioContext failed:", err);
          }
        } else {
          const tempAudio = document.createElement("audio");
          tempAudio.srcObject = stream;
          tempAudio.muted = true;
          try {
            await tempAudio.play();
            await new Promise((res) => setTimeout(res, 200));
          } catch (err) {
            console.warn("Voice processing priming playback failed:", err);
          } finally {
            tempAudio.pause();
            tempAudio.srcObject = null;
          }
        }
      } catch (err) {
        console.warn("Voice processing priming failed:", err);
      } finally {
        if (stream) {
          stream.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch (e) {
            }
          });
        }
        micPrimingPromise = null;
      }
    })();
    return micPrimingPromise;
  }
  function currentQualityKey() {
    const fromSelect = qualitySelect == null ? void 0 : qualitySelect.value;
    if (fromSelect && QUALITY_PROFILES[fromSelect]) return fromSelect;
    const stored = localStorage.getItem("audioQualityProfile");
    if (stored && QUALITY_PROFILES[stored]) return stored;
    return "ultra-low";
  }
  document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM loaded, initializing...");
    inputSelect = document.getElementById("input-select");
    qualitySelect = document.getElementById("quality-select");
    dimAmountSelect = document.getElementById("dim-amount-select");
    dimWhileSpeakingToggle = document.getElementById("toggle-self-dim");
    audioProcessingToggle = document.getElementById("toggle-processing");
    userLevelControls = document.getElementById("user-level-controls");
    userInputGainSlider = document.getElementById("user-input-gain");
    userInputGainValueDisplay = document.getElementById("user-input-gain-value");
    userMeterBarEl = document.getElementById("user-meter-bar");
    userMeterClipEl = document.getElementById("user-meter-clip");
    userMeterValueEl = document.getElementById("user-meter-value");
    feedInputGainSlider = document.getElementById("feed-input-gain");
    feedInputGainValueDisplay = document.getElementById("feed-input-gain-value");
    feedMeterBarEl = document.getElementById("feed-meter-bar");
    feedMeterClipEl = document.getElementById("feed-meter-clip");
    feedMeterValueEl = document.getElementById("feed-meter-value");
    updateUserGainUI();
    setUserMeterDisplay(0, formatDbDisplay(-Infinity), false, null, { forceText: true });
    updateFeedGainUI();
    setFeedMeterDisplay(0, formatDbDisplay(-Infinity), false, null, { forceText: true });
    applyUserGainControlState();
    if (feedInputGainSlider) {
      feedInputGainSlider.addEventListener("input", () => {
        const value = parseFloat(feedInputGainSlider.value);
        if (!Number.isNaN(value)) {
          setFeedInputGainDb(value, { persist: false });
        }
      });
      feedInputGainSlider.addEventListener("change", () => {
        const value = parseFloat(feedInputGainSlider.value);
        if (!Number.isNaN(value)) {
          setFeedInputGainDb(value);
        }
      });
    }
    if (userInputGainSlider) {
      userInputGainSlider.addEventListener("input", () => {
        const value = parseFloat(userInputGainSlider.value);
        if (!Number.isNaN(value)) {
          setUserInputGainDb(value, { persist: false });
        }
      });
      userInputGainSlider.addEventListener("change", () => {
        const value = parseFloat(userInputGainSlider.value);
        if (!Number.isNaN(value)) {
          setUserInputGainDb(value);
        }
      });
    }
    if (audioProcessingToggle) {
      audioProcessingToggle.checked = audioProcessingEnabled;
      audioProcessingToggle.addEventListener("change", () => {
        setAudioProcessingEnabled(audioProcessingToggle.checked);
      });
    }
    const storedQuality = localStorage.getItem("audioQualityProfile");
    if (qualitySelect) {
      if (storedQuality && QUALITY_PROFILES[storedQuality]) {
        qualitySelect.value = storedQuality;
      } else {
        qualitySelect.value = "ultra-low";
        localStorage.setItem("audioQualityProfile", "ultra-low");
      }
      qualitySelect.addEventListener("change", () => {
        const selected = qualitySelect.value;
        if (!QUALITY_PROFILES[selected]) {
          qualitySelect.value = "ultra-low";
        }
        localStorage.setItem("audioQualityProfile", qualitySelect.value);
        cleanupMicTrack();
      });
    } else if (!storedQuality || !QUALITY_PROFILES[storedQuality]) {
      localStorage.setItem("audioQualityProfile", "ultra-low");
    }
    function setFeedDuckingDb(dbValue, { persist = true, apply = true } = {}) {
      var _a2;
      if (Number.isNaN(dbValue) || !Number.isFinite(dbValue)) return;
      const clamped = clampFeedDuckingDb(dbValue);
      feedDuckingDb = clamped;
      feedDuckingFactor = dbToLinear(clamped);
      syncDimAmountSelect(clamped);
      if (persist && typeof window !== "undefined") {
        try {
          (_a2 = window.localStorage) == null ? void 0 : _a2.setItem(FEED_DUCKING_DB_STORAGE_KEY, String(clamped));
        } catch (err) {
          console.warn("Unable to persist feed dim level:", err);
        }
      }
      if (apply) {
        applyFeedDucking();
      }
    }
    if (dimAmountSelect) {
      syncDimAmountSelect(feedDuckingDb);
      dimAmountSelect.addEventListener("change", () => {
        const selectedDb = parseFloat(dimAmountSelect.value);
        if (Number.isNaN(selectedDb)) return;
        setFeedDuckingDb(selectedDb);
      });
    }
    function setFeedDimSelf(value, { persist = true, apply = true } = {}) {
      var _a2;
      const enabled = !!value;
      feedDimSelf = enabled;
      if (dimWhileSpeakingToggle && dimWhileSpeakingToggle.checked !== enabled) {
        dimWhileSpeakingToggle.checked = enabled;
      }
      if (persist && typeof window !== "undefined") {
        try {
          (_a2 = window.localStorage) == null ? void 0 : _a2.setItem(FEED_DIM_SELF_STORAGE_KEY, String(enabled));
        } catch (err) {
          console.warn("Unable to persist self dim preference:", err);
        }
      }
      if (apply) {
        applyFeedDucking();
      }
    }
    if (dimWhileSpeakingToggle) {
      dimWhileSpeakingToggle.checked = feedDimSelf;
      dimWhileSpeakingToggle.addEventListener("change", () => {
        setFeedDimSelf(dimWhileSpeakingToggle.checked);
      });
    }
    updateDeviceList().catch((err) => console.error("updateDeviceList failed:", err));
    navigator.mediaDevices.addEventListener(
      "devicechange",
      () => updateDeviceList().catch((err) => console.error(err))
    );
    inputSelect == null ? void 0 : inputSelect.addEventListener("change", () => {
      const selected = inputSelect.value;
      if (selected) {
        localStorage.setItem(MIC_DEVICE_STORAGE_KEY, selected);
      } else {
        localStorage.removeItem(MIC_DEVICE_STORAGE_KEY);
      }
      if (session.kind === "feed") {
        const wasStreaming = feedStreaming;
        if (feedStreaming) {
          stopFeedStream();
        } else {
          cleanupMicTrack();
        }
        if (wasStreaming) {
          startFeedStream().catch((err) => console.error("Failed to restart feed after device change", err));
        }
      } else {
        cleanupMicTrack();
      }
    });
    if (typeof mediasoupClient === "undefined") {
      console.error("mediasoup-client not loaded!");
      alert("Failed to load the mediasoup client library!");
      return;
    }
    console.log("mediasoup-client version:", mediasoupClient.version);
    const loginForm = document.getElementById("login-form");
    const loginContainer = document.getElementById("login-container");
    const intercomApp = document.getElementById("intercom-app");
    const loginError = document.getElementById("login-error");
    const logoutBtn = document.getElementById("logout-btn");
    const myIdEl = document.getElementById("my-id");
    const btnReply = document.getElementById("reply");
    const audioStreamsDiv = document.getElementById("audio-streams");
    const feedBanner = document.getElementById("feed-banner");
    const feedStreamToggle = document.getElementById("feed-stream-toggle");
    const feedStreamStatus = document.getElementById("feed-stream-status");
    const peerConsumers = /* @__PURE__ */ new Map();
    const targetLabels = /* @__PURE__ */ new Map();
    let device, sendTransport, recvTransport, producer2;
    const audioElements = /* @__PURE__ */ new Map();
    const audioEntryMap = /* @__PURE__ */ new WeakMap();
    const confAudioElements = /* @__PURE__ */ new Map();
    const feedAudioElements = /* @__PURE__ */ new Map();
    const feedDimmingDisabled = /* @__PURE__ */ new Set();
    const activeTalkersForMe = /* @__PURE__ */ new Set();
    const talkerConsumersForMe = /* @__PURE__ */ new Map();
    const speakingPeers = /* @__PURE__ */ new Set();
    const lastSpokePeers = /* @__PURE__ */ new Map();
    const mutedPeers = /* @__PURE__ */ new Set();
    const pendingProducerQueue = [];
    let currentTargetPeer = null;
    let lastTarget = null;
    let isTalking2 = false;
    let currentTarget = null;
    let cachedUsers = [];
    let mediaInitialized = false;
    let initializingMediaPromise = null;
    let shouldInitializeAfterConnect = false;
    let activeLockButton = null;
    let activeLockTarget = null;
    onAudioContextRunning = () => {
      if (!audioContextPrimed) {
        audioContextPrimed = true;
        primeVoiceProcessingMode().catch(() => {
        });
      }
      attemptPendingAutoplay();
      if (session.kind === "user") {
        applyFeedDucking();
      } else {
        feedAudioElements.forEach((set) => {
          set.forEach((audioEl) => {
            var _a2;
            const entry = audioEntryMap.get(audioEl);
            if (!entry) return;
            if (mutedPeers.has(entry.key)) {
              muteFeedEntry(entry);
            } else {
              setFeedEntryLevel(entry, (_a2 = entry.volume) != null ? _a2 : defaultVolume);
              enforcePitchLock(entry.audio);
              attemptPlayAudio(entry.audio).catch(() => {
              });
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
      return typeof key === "string" && key.startsWith("feed-");
    }
    function enforcePitchLock(audioEl) {
      if (!audioEl) return;
      audioEl.defaultPlaybackRate = 1;
      audioEl.playbackRate = 1;
      ["preservesPitch", "mozPreservesPitch", "webkitPreservesPitch"].forEach((prop) => {
        if (prop in audioEl) {
          try {
            audioEl[prop] = true;
          } catch (e) {
          }
        }
      });
    }
    function attemptPlayAudio(audioEl) {
      if (!audioEl || typeof audioEl.play !== "function") return Promise.resolve();
      try {
        const maybePromise = audioEl.play();
        if (maybePromise && typeof maybePromise.then === "function") {
          return maybePromise.then(() => {
            pendingAutoplayAudios.delete(audioEl);
          }).catch((err) => {
            pendingAutoplayAudios.add(audioEl);
            console.warn("Autoplay blocked, queued for retry:", err);
            throw err;
          });
        }
        pendingAutoplayAudios.delete(audioEl);
        return Promise.resolve();
      } catch (err) {
        pendingAutoplayAudios.add(audioEl);
        console.warn("Autoplay attempt failed, queued for retry:", err);
        return Promise.reject(err);
      }
    }
    function renderReplyButtonLabel() {
      const suffix = (lastTarget == null ? void 0 : lastTarget.label) ? ` (${lastTarget.label})` : "";
      btnReply.setAttribute("data-label", `${BASE_REPLY_LABEL}${suffix}`);
      const aria = (lastTarget == null ? void 0 : lastTarget.label) ? `Reply to ${lastTarget.label}` : "Reply";
      btnReply.setAttribute("aria-label", aria);
    }
    function clearReplyTarget() {
      lastTarget = null;
      btnReply.disabled = true;
      renderReplyButtonLabel();
    }
    clearReplyTarget();
    function applySessionUI() {
      const isFeed = session.kind === "feed";
      document.body.classList.toggle("feed-mode", isFeed);
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
          qualitySelect.value = "standard";
          qualitySelect.disabled = true;
        } else {
          qualitySelect.disabled = false;
          const storedQuality2 = localStorage.getItem("audioQualityProfile");
          if (storedQuality2 && QUALITY_PROFILES[storedQuality2]) {
            qualitySelect.value = storedQuality2;
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
      const isFeed = session.kind === "feed";
      feedBanner.hidden = !isFeed;
      feedBanner.classList.toggle("is-streaming", feedStreaming);
      if (!isFeed) return;
      const transportReady = !!sendTransport && !sendTransport.closed;
      let statusText = "Feed ready";
      if (!transportReady) {
        statusText = "Waiting for connection\u2026";
      } else if (feedStreaming) {
        statusText = "Feed streaming";
      } else if (feedManualStop) {
        statusText = "Feed stopped";
      }
      if (feedStreamStatus) {
        feedStreamStatus.textContent = statusText;
      }
      if (feedStreamToggle) {
        feedStreamToggle.textContent = feedStreaming ? "Stop Feed" : "Start Feed";
        feedStreamToggle.disabled = !transportReady;
      }
    }
    function applyFeedDucking() {
      var _a2;
      if (session.kind !== "user") return;
      const shouldDimSelf = feedDimSelf && isTalking2;
      const shouldDuck = activeTalkersForMe.size > 0 || shouldDimSelf;
      const stateChanged = shouldDuck !== feedDuckingActive;
      feedDuckingActive = shouldDuck;
      for (const [feedId, audios] of feedAudioElements) {
        const key = `feed-${feedId}`;
        const tile = document.getElementById(key);
        const dimDisabled = feedDimmingDisabled.has(String(feedId));
        const shouldDim = shouldDuck && !dimDisabled && feedDuckingFactor < 0.999;
        tile == null ? void 0 : tile.classList.toggle("feed-dimmed", shouldDim);
        for (const audioEl of audios) {
          const entry = audioEntryMap.get(audioEl);
          if (!entry) continue;
          if (mutedPeers.has(key)) {
            muteFeedEntry(entry);
            continue;
          }
          const base = Math.max(0, Math.min(1, (_a2 = entry.volume) != null ? _a2 : defaultVolume));
          const targetVol = shouldDim ? Math.max(0, Math.min(1, base * feedDuckingFactor)) : base;
          setFeedEntryLevel(entry, targetVol);
          enforcePitchLock(entry.audio);
          attemptPlayAudio(entry.audio).catch(() => {
          });
        }
      }
      if (stateChanged) {
        attemptPendingAutoplay();
      }
    }
    function trackTalkerForMe(key, consumerId) {
      let set = talkerConsumersForMe.get(key);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        talkerConsumersForMe.set(key, set);
      }
      const hadEntries = set.size > 0;
      set.add(consumerId);
      if (!hadEntries) {
        activeTalkersForMe.add(key);
        if (session.kind === "user") {
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
        if (activeTalkersForMe.delete(key) && session.kind === "user") {
          applyFeedDucking();
        }
      }
    }
    function clearTalkersForKey(key) {
      talkerConsumersForMe.delete(key);
      if (activeTalkersForMe.delete(key) && session.kind === "user") {
        applyFeedDucking();
      }
    }
    async function startFeedStream({ manual = false } = {}) {
      if (session.kind !== "feed") return;
      if (feedStreaming) return;
      if (!session.feedId) return;
      if (!sendTransport || sendTransport.closed) {
        shouldStartFeedWhenReady = true;
        updateFeedControls();
        if (manual) {
          alert("Transport not ready yet, please wait a moment.");
        }
        return;
      }
      const feedKey = session.feedId != null ? `feed-${session.feedId}` : null;
      if (feedKey) {
        speakingPeers.delete(feedKey);
        updateSpeakerHighlight(feedKey, false);
        const consumers = peerConsumers.get(feedKey);
        if (consumers) {
          consumers.forEach((c) => {
            try {
              c.close();
            } catch (e) {
            }
          });
          peerConsumers.delete(feedKey);
        }
      }
      shouldStartFeedWhenReady = false;
      try {
        const selectedDeviceId = inputSelect == null ? void 0 : inputSelect.value;
        const audioConstraints = __spreadValues(__spreadValues({
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }, FEED_PROFILE.constraints || {}), selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {});
        const track = await ensureMicTrack(audioConstraints, selectedDeviceId);
        track.enabled = true;
        const processing = ensureFeedProcessingChain(track);
        const processedTrack = (processing == null ? void 0 : processing.outputTrack) || track;
        processedTrack.enabled = true;
        const newProducer = await sendTransport.produce({
          track: processedTrack,
          appData: { type: "feed", id: session.feedId },
          codecOptions: FEED_PROFILE.codecOptions ? __spreadValues({}, FEED_PROFILE.codecOptions) : void 0,
          encodings: FEED_PROFILE.encodings ? FEED_PROFILE.encodings.map((enc) => __spreadValues({}, enc)) : void 0,
          stopTracks: false
        });
        if (!newProducer) {
          throw new Error("Failed to create feed producer");
        }
        producer2 = newProducer;
        feedStreaming = true;
        if (manual) {
          feedManualStop = false;
        }
        newProducer.on("close", () => {
          if (producer2 === newProducer) {
            producer2 = null;
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
        newProducer.on("transportclose", () => {
          if (producer2 === newProducer) {
            producer2 = null;
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
        console.error("Failed to start feed stream:", err);
        if (manual) {
          alert("Failed to start feed: " + err.message);
        }
      }
    }
    function stopFeedStream({ manual = false } = {}) {
      if (session.kind !== "feed") return;
      const feedKey = session.feedId != null ? `feed-${session.feedId}` : null;
      if (producer2) {
        try {
          socket.emit("producer-close", { producerId: producer2.id });
        } catch (err) {
          console.warn("Error notifying server about feed stop:", err);
        }
        try {
          producer2.close();
        } catch (err) {
          console.warn("Error closing feed producer", err);
        }
        producer2 = null;
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
        ensureMediaInitialized().catch((err) => {
          console.error("Media initialization failed:", err);
        });
      }
    }
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
        intercomApp.style.display = "block";
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
        intercomApp.style.display = "block";
        myIdEl.textContent = storedName;
        feedManualStop = false;
        shouldStartFeedWhenReady = true;
        socket.emit("register-user", { id: storedFeedId, name: storedName, kind: "feed" });
        applySessionUI();
        initializeMediaIfPossible();
      }
    }
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("login-username").value;
      const password = document.getElementById("login-password").value;
      loginError.textContent = "";
      try {
        const res = await fetch("/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, password })
        });
        if (!res.ok) {
          loginError.textContent = "Invalid username or password";
          return;
        }
        const user = await res.json();
        console.log("Logged in as:", user);
        const kind = user.kind === "feed" ? "feed" : "user";
        session = {
          kind,
          userId: kind === "user" ? String(user.id) : null,
          feedId: kind === "feed" ? String(user.id) : null,
          name: user.name
        };
        localStorage.setItem("userName", user.name);
        localStorage.setItem(IDENTITY_KIND_KEY, kind);
        if (kind === "user") {
          localStorage.setItem("userId", session.userId);
          localStorage.removeItem(FEED_ID_STORAGE_KEY);
        } else {
          localStorage.setItem(FEED_ID_STORAGE_KEY, session.feedId);
          localStorage.removeItem("userId");
        }
        feedManualStop = false;
        shouldStartFeedWhenReady = kind === "feed";
        const identityId = kind === "feed" ? session.feedId : session.userId;
        socket.emit("register-user", { id: identityId, name: user.name, kind });
        loginContainer.style.display = "none";
        intercomApp.style.display = "block";
        myIdEl.textContent = user.name;
        applySessionUI();
        initializeMediaIfPossible();
      } catch (err) {
        loginError.textContent = "Error logging in";
        console.error("Login failed:", err);
      }
    });
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        if (session.kind === "feed") {
          stopFeedStream({ manual: true });
        }
        localStorage.removeItem("userId");
        localStorage.removeItem(FEED_ID_STORAGE_KEY);
        localStorage.removeItem("userName");
        localStorage.removeItem(IDENTITY_KIND_KEY);
        location.reload();
      });
    }
    feedStreamToggle == null ? void 0 : feedStreamToggle.addEventListener("click", () => {
      if (session.kind !== "feed") return;
      if (feedStreaming) {
        stopFeedStream({ manual: true });
      } else {
        feedManualStop = false;
        startFeedStream({ manual: true }).catch((err) => console.error("Failed to start feed", err));
      }
    });
    socket.on("connect", async () => {
      console.log("Connected to signaling server as", socket.id);
      if (session.name) {
        if (session.kind === "user" && session.userId) {
          socket.emit("register-user", { id: session.userId, name: session.name, kind: "user" });
        } else if (session.kind === "feed" && session.feedId) {
          socket.emit("register-user", { id: session.feedId, name: session.name, kind: "feed" });
        }
        myIdEl.textContent = session.name;
      }
      if (!shouldInitializeAfterConnect && session.kind !== "guest" && session.name) {
        shouldInitializeAfterConnect = true;
      }
      if (shouldInitializeAfterConnect) {
        try {
          await ensureMediaInitialized();
        } catch (err) {
          console.error("Media initialization on connect failed:", err);
        }
      }
      if (session.kind === "feed" && !feedManualStop) {
        shouldStartFeedWhenReady = true;
      }
      updateFeedControls();
    });
    socket.on("disconnect", () => {
      console.log("Disconnected from server");
      myIdEl.textContent = "Getrennt";
      clearReplyTarget();
      document.querySelectorAll(".talk-user").forEach((btn) => btn.disabled = true);
      mediaInitialized = false;
      initializingMediaPromise = null;
      device = null;
      sendTransport = null;
      recvTransport = null;
      producer2 = null;
      pendingProducerQueue.length = 0;
      speakingPeers.clear();
      activeTalkersForMe.clear();
      talkerConsumersForMe.clear();
      feedAudioElements.clear();
      if (session.kind === "feed") {
        feedStreaming = false;
        if (!feedManualStop) {
          shouldStartFeedWhenReady = true;
        }
        updateFeedControls();
      }
    });
    socket.on("user-list", async (users) => {
      cachedUsers = users;
      if (session.kind === "user") {
        await renderTargetList(users);
      }
    });
    socket.on("user-targets-updated", async () => {
      if (session.kind !== "user") return;
      if (cachedUsers.length) {
        await renderTargetList(cachedUsers);
      }
    });
    socket.on("api-talk-command", async ({ action, targetType = "conference", targetId = null }) => {
      if (session.kind !== "user") return;
      const dummyEvent = { preventDefault() {
      } };
      const resolveUserTarget = () => {
        const numericId = Number(targetId);
        const user = cachedUsers.find((u) => Number(u.userId) === numericId);
        if (!user || !user.socketId) {
          console.warn("Talk command: target user not available", targetId);
          return null;
        }
        return { type: "user", id: user.socketId };
      };
      const resolveTarget = () => {
        if (targetType === "user") return resolveUserTarget();
        if (targetType === "conference") return { type: "conference", id: Number(targetId) };
        return null;
      };
      if (action === "lock-toggle") {
        const target = resolveTarget();
        if (!target) return;
        const lockBtn = findLockButtonForTarget(target);
        if (!lockBtn) {
          console.warn("Talk command: lock button not found for target", target);
          return;
        }
        if (isSameTarget(activeLockTarget, target) && activeLockButton) {
          handleStopTalking({ preventDefault() {
          }, currentTarget: activeLockButton });
        } else {
          toggleTargetLock(target, lockBtn);
        }
        return;
      }
      if (action === "press") {
        const target = resolveTarget();
        await handleTalk(dummyEvent, target);
      } else if (action === "release") {
        handleStopTalking({ preventDefault() {
        }, currentTarget: null });
      }
    });
    async function renderTargetList(users) {
      var _a2;
      if (session.kind !== "user") return;
      const dbUserId = session.userId;
      if (!dbUserId) return;
      let targets;
      try {
        targets = await fetchJSON(`/users/${dbUserId}/targets`);
      } catch (err) {
        console.error("Failed to fetch targets", err);
        return;
      }
      const list = document.getElementById("targets-list");
      if (!list) return;
      list.innerHTML = "";
      targetLabels.clear();
      const usersById = /* @__PURE__ */ new Map();
      users.forEach((u) => {
        usersById.set(Number(u.userId), u);
        targetLabels.set(`user-${u.socketId}`, u.name || u.socketId);
      });
      const conferenceNames = /* @__PURE__ */ new Map();
      targets.filter((t) => t.targetType === "conference").forEach((t) => {
        conferenceNames.set(Number(t.targetId), t.name);
        targetLabels.set(`conf-${t.targetId}`, t.name);
      });
      targets.filter((t) => t.targetType === "feed").forEach((t) => {
        targetLabels.set(`feed-${t.targetId}`, t.name);
      });
      const appendUserTarget = (target) => {
        const targetIdNum = Number(target.targetId);
        const user = usersById.get(targetIdNum);
        if (!user) return;
        const { socketId, name } = user;
        if (!socketId || socketId === socket.id) return;
        const li = document.createElement("li");
        li.id = `user-${socketId}`;
        li.classList.add("target-item", "user-target");
        const icon = document.createElement("div");
        icon.className = "user-icon";
        icon.textContent = name ? name.charAt(0).toUpperCase() : socketId.slice(0, 2);
        const info = document.createElement("div");
        info.className = "target-info";
        const label = document.createElement("span");
        label.className = "target-label";
        label.textContent = name || socketId;
        info.appendChild(label);
        const userKey = `volume_user_${socketId}`;
        const volSlider = document.createElement("input");
        volSlider.type = "range";
        volSlider.min = "0";
        volSlider.max = "1";
        volSlider.step = "0.01";
        volSlider.value = getStoredVolume(userKey).toString();
        volSlider.className = "volume-slider";
        volSlider.title = "Source Volume";
        volSlider.addEventListener("input", (e) => {
          const vol = parseFloat(e.target.value);
          const entry = audioElements.get(socketId);
          if (entry == null ? void 0 : entry.audio) {
            entry.audio.volume = vol;
            entry.volume = vol;
          }
          storeVolume(userKey, vol);
        });
        info.appendChild(volSlider);
        const lockBtn = document.createElement("button");
        lockBtn.className = "lock-btn";
        lockBtn.textContent = "Talk Lock";
        lockBtn.type = "button";
        lockBtn.setAttribute("aria-pressed", "false");
        lockBtn.setAttribute("aria-label", `Toggle talk lock for ${name || socketId}`);
        lockBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
        lockBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleTargetLock({ type: "user", id: socketId }, lockBtn);
        });
        const muteBtn = document.createElement("button");
        muteBtn.className = "mute-btn";
        muteBtn.textContent = mutedPeers.has(`user-${socketId}`) ? "Unmute" : "Mute";
        muteBtn.type = "button";
        muteBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
        muteBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const key = `user-${socketId}`;
          toggleMute(socketId);
          const nowMuted = mutedPeers.has(key);
          muteBtn.textContent = nowMuted ? "Unmute" : "Mute";
          muteBtn.classList.toggle("muted", nowMuted);
        });
        muteBtn.classList.toggle("muted", mutedPeers.has(`user-${socketId}`));
        const actions = document.createElement("div");
        actions.className = "target-actions";
        actions.append(lockBtn, muteBtn);
        const isLocked = isSameTarget(activeLockTarget, { type: "user", id: socketId });
        if (isLocked) {
          activeLockButton = lockBtn;
          lockBtn.classList.add("active");
          lockBtn.textContent = "Unlock";
          lockBtn.setAttribute("aria-pressed", "true");
        }
        li.append(icon, info, actions);
        ["down", "up", "leave", "cancel"].forEach((ev) => {
          li.addEventListener(`pointer${ev}`, (e) => {
            if (e.target.closest(".mute-btn") || e.target.closest(".lock-btn") || e.target.closest(".volume-slider")) return;
            if (ev === "down") handleTalk(e, { type: "user", id: socketId });
            else handleStopTalking(e);
          });
        });
        list.appendChild(li);
      };
      const appendConferenceTarget = (target) => {
        const id = Number(target.targetId);
        const name = conferenceNames.get(id) || target.name;
        const key = `conf-${id}`;
        const li = document.createElement("li");
        li.id = key;
        li.classList.add("target-item", "conf-target");
        const icon = document.createElement("div");
        icon.className = "conf-icon";
        icon.textContent = "\u{1F4E1}";
        const info = document.createElement("div");
        info.className = "target-info";
        const label = document.createElement("span");
        label.className = "target-label";
        label.textContent = name;
        info.appendChild(label);
        const confKey = `volume_conf_${id}`;
        const confSlider = document.createElement("input");
        confSlider.type = "range";
        confSlider.min = "0";
        confSlider.max = "1";
        confSlider.step = "0.01";
        confSlider.value = getStoredVolume(confKey).toString();
        confSlider.className = "volume-slider";
        confSlider.title = "Conference Volume";
        confSlider.addEventListener("input", (e) => {
          const vol = parseFloat(e.target.value);
          const audios = confAudioElements.get(id);
          if (audios) {
            audios.forEach((a) => {
              a.volume = vol;
              const entry = audioEntryMap.get(a);
              if (entry) entry.volume = vol;
            });
          }
          storeVolume(confKey, vol);
        });
        info.appendChild(confSlider);
        const lockBtn = document.createElement("button");
        lockBtn.className = "lock-btn";
        lockBtn.textContent = "Talk Lock";
        lockBtn.type = "button";
        lockBtn.setAttribute("aria-pressed", "false");
        lockBtn.setAttribute("aria-label", `Toggle talk lock for ${name}`);
        lockBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
        lockBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleTargetLock({ type: "conference", id }, lockBtn);
        });
        const muteBtn = document.createElement("button");
        muteBtn.className = "mute-btn";
        const muted = mutedPeers.has(key);
        muteBtn.textContent = muted ? "Unmute" : "Mute";
        muteBtn.type = "button";
        if (muted) muteBtn.classList.add("muted");
        muteBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
        muteBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleMute(id);
          const nowMuted = mutedPeers.has(key);
          muteBtn.textContent = nowMuted ? "Unmute" : "Mute";
          muteBtn.classList.toggle("muted", nowMuted);
        });
        const actions = document.createElement("div");
        actions.className = "target-actions";
        actions.append(lockBtn, muteBtn);
        if (isSameTarget(activeLockTarget, { type: "conference", id })) {
          activeLockButton = lockBtn;
          lockBtn.classList.add("active");
          lockBtn.textContent = "Unlock";
          lockBtn.setAttribute("aria-pressed", "true");
        }
        li.append(icon, info, actions);
        ["down", "up", "leave", "cancel"].forEach((ev) => {
          li.addEventListener(`pointer${ev}`, (e) => {
            if (e.target.closest(".mute-btn") || e.target.closest(".lock-btn") || e.target.closest(".volume-slider")) return;
            if (ev === "down") handleTalk(e, { type: "conference", id });
            else handleStopTalking(e);
          });
        });
        list.appendChild(li);
      };
      targets.forEach((target) => {
        if (target.targetType === "user") {
          appendUserTarget(target);
        } else if (target.targetType === "conference") {
          appendConferenceTarget(target);
        } else if (target.targetType === "feed") {
          const id = Number(target.targetId);
          const name = target.name;
          const key = `feed-${id}`;
          const li = document.createElement("li");
          li.id = key;
          li.classList.add("target-item", "feed-target");
          li.dataset.type = "feed";
          li.dataset.id = String(id);
          const icon = document.createElement("div");
          icon.className = "feed-icon";
          icon.textContent = "\u{1F3A7}";
          const info = document.createElement("div");
          info.className = "target-info";
          const labelWrap = document.createElement("div");
          labelWrap.className = "target-label-row";
          const label = document.createElement("span");
          label.className = "target-label";
          label.textContent = name;
          labelWrap.appendChild(label);
          const dimBtn = document.createElement("button");
          dimBtn.className = "lock-btn dim-btn";
          const feedKeyId = String(id);
          const dimDisabled = feedDimmingDisabled.has(feedKeyId);
          dimBtn.textContent = "Dim";
          dimBtn.type = "button";
          dimBtn.setAttribute("aria-pressed", dimDisabled ? "true" : "false");
          dimBtn.classList.toggle("dim-off", dimDisabled);
          dimBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
          dimBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (feedDimmingDisabled.has(feedKeyId)) {
              feedDimmingDisabled.delete(feedKeyId);
              dimBtn.setAttribute("aria-pressed", "false");
              dimBtn.classList.remove("dim-off");
            } else {
              feedDimmingDisabled.add(feedKeyId);
              dimBtn.setAttribute("aria-pressed", "true");
              dimBtn.classList.add("dim-off");
            }
            applyFeedDucking();
          });
          labelWrap.appendChild(dimBtn);
          info.appendChild(labelWrap);
          const feedKey = `volume_feed_${id}`;
          const feedSlider = document.createElement("input");
          feedSlider.type = "range";
          feedSlider.min = "0";
          feedSlider.max = "1";
          feedSlider.step = "0.01";
          feedSlider.value = getStoredVolume(feedKey).toString();
          feedSlider.className = "volume-slider";
          feedSlider.title = "Feed Volume";
          feedSlider.addEventListener("input", (e) => {
            const vol = Math.max(0, Math.min(1, parseFloat(e.target.value)));
            const audios = feedAudioElements.get(id);
            if (audios) {
              audios.forEach((a) => {
                const entry = audioEntryMap.get(a);
                if (entry == null ? void 0 : entry.audio) {
                  entry.volume = vol;
                  if (!mutedPeers.has(key)) {
                    setFeedEntryLevel(entry, vol);
                    enforcePitchLock(entry.audio);
                    attemptPlayAudio(entry.audio).catch(() => {
                    });
                  }
                }
              });
            }
            storeVolume(feedKey, vol);
            applyFeedDucking();
          });
          info.appendChild(feedSlider);
          const muteBtn = document.createElement("button");
          muteBtn.className = "mute-btn";
          const muted = mutedPeers.has(key);
          muteBtn.textContent = muted ? "Unmute" : "Mute";
          muteBtn.type = "button";
          muteBtn.classList.toggle("muted", muted);
          muteBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
          muteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleMute(key);
            const nowMuted = mutedPeers.has(key);
            muteBtn.textContent = nowMuted ? "Unmute" : "Mute";
            muteBtn.classList.toggle("muted", nowMuted);
          });
          const actions = document.createElement("div");
          actions.className = "target-actions";
          actions.append(dimBtn, muteBtn);
          li.append(icon, info, actions);
          list.appendChild(li);
        }
      });
      const allowedFeedKeys = new Set(
        targets.filter((t) => t.targetType === "feed").map((t) => `feed-${t.targetId}`)
      );
      const feedsToRemove = [];
      audioElements.forEach((entry, mapKey) => {
        if ((entry == null ? void 0 : entry.type) === "feed" && !allowedFeedKeys.has(entry.key)) {
          feedsToRemove.push({ entry, mapKey });
        }
      });
      for (const { entry, mapKey } of feedsToRemove) {
        const feedKey = entry.key;
        const feedId = Number(feedKey.split("-")[1]);
        const consumers = peerConsumers.get(feedKey);
        if (consumers) {
          consumers.forEach((c) => {
            try {
              c.close();
            } catch (e) {
            }
          });
          peerConsumers.delete(feedKey);
        }
        speakingPeers.delete(feedKey);
        mutedPeers.delete(feedKey);
        updateSpeakerHighlight(feedKey, false);
        pendingAutoplayAudios.delete(entry.audio);
        if (entry.mediaSource) {
          try {
            entry.mediaSource.disconnect();
          } catch (e) {
          }
          entry.mediaSource = null;
        }
        if (entry.gainNode) {
          try {
            entry.gainNode.disconnect();
          } catch (e) {
          }
          entry.gainNode = null;
        }
        entry.audio.remove();
        audioEntryMap.delete(entry.audio);
        audioElements.delete(mapKey);
        (_a2 = feedAudioElements.get(feedId)) == null ? void 0 : _a2.delete(entry.audio);
      }
      if (feedsToRemove.length) {
        applyFeedDucking();
      }
      if (activeLockButton && !document.body.contains(activeLockButton)) {
        handleStopTalking({ preventDefault() {
        }, currentTarget: activeLockButton });
      }
      document.querySelectorAll(".target-item").forEach((li) => {
        const [type, id] = li.id.split("-");
        const key = `${type}-${id}`;
        const icon = type === "user" ? li.querySelector(".user-icon") : type === "conference" ? li.querySelector(".conf-icon") : li.querySelector(".feed-icon");
        const isSpeaking = speakingPeers.has(key);
        li.classList.toggle("speaking", isSpeaking);
        if (icon) icon.classList.toggle("speaking", isSpeaking);
        li.classList.toggle("last-spoke", lastSpokePeers.has(key));
        const isMuted = mutedPeers.has(key);
        li.classList.toggle("muted", isMuted);
        if (icon) icon.classList.toggle("muted", isMuted);
      });
      if (lastTarget) {
        const key = lastTarget.type === "conference" ? `conf-${lastTarget.id}` : `user-${lastTarget.id}`;
        const updatedLabel = targetLabels.get(key);
        if (updatedLabel && updatedLabel !== lastTarget.label) {
          lastTarget = __spreadProps(__spreadValues({}, lastTarget), { label: updatedLabel });
          renderReplyButtonLabel();
        }
      }
    }
    async function handleIncomingProducer(payload) {
      if (!payload || typeof payload !== "object") return;
      if (!device || !recvTransport) {
        pendingProducerQueue.push(payload);
        return;
      }
      await consumeProducerPayload(payload);
    }
    async function consumeProducerPayload({ peerId, producerId, appData }) {
      var _b2, _c2, _d2, _e2, _f, _g;
      const normalizedAppData = appData && typeof appData === "object" ? appData : {};
      let key;
      let volumeStorageKey;
      if (normalizedAppData.type === "conference") {
        key = `conf-${normalizedAppData.id}`;
        volumeStorageKey = `volume_conf_${normalizedAppData.id}`;
      } else if (normalizedAppData.type === "feed") {
        key = `feed-${normalizedAppData.id}`;
        volumeStorageKey = `volume_feed_${normalizedAppData.id}`;
      } else {
        key = `user-${peerId}`;
        volumeStorageKey = `volume_user_${peerId}`;
      }
      if (peerId === socket.id) return;
      if (normalizedAppData.targetPeer && normalizedAppData.targetPeer !== socket.id) {
        console.log("Producer not for us, skipping");
        return;
      }
      try {
        const shouldTrackForMe = normalizedAppData.type !== "feed";
        speakingPeers.add(key);
        updateSpeakerHighlight(key, true);
        const _a2 = await new Promise(
          (resolve) => socket.emit("consume", {
            producerId,
            rtpCapabilities: device.rtpCapabilities
          }, resolve)
        ), { error } = _a2, consumeParams = __objRest(_a2, ["error"]);
        if (error) throw new Error(error);
        const consumer = await recvTransport.consume(consumeParams);
        const receiver = consumer == null ? void 0 : consumer.rtpReceiver;
        if (receiver && "playoutDelayHint" in receiver) {
          try {
            receiver.playoutDelayHint = 0.02;
          } catch (err) {
            console.debug("playoutDelayHint set failed", err);
          }
        }
        if (!peerConsumers.has(key)) peerConsumers.set(key, /* @__PURE__ */ new Set());
        peerConsumers.get(key).add(consumer);
        if (mutedPeers.has(key) && !isFeedKey(key)) consumer.pause();
        if (shouldTrackForMe) {
          trackTalkerForMe(key, consumer.id);
        }
        const stream = new MediaStream([consumer.track]);
        const ctxForFeed = normalizedAppData.type === "feed" ? ensureAudioContext() : null;
        if (!audioElements.has(key)) {
          const audio = document.createElement("audio");
          audio.srcObject = stream;
          audio.autoplay = true;
          audio.playsInline = true;
          audio.setAttribute("playsinline", "true");
          audio.setAttribute("autoplay", "true");
          enforcePitchLock(audio);
          const initVolRaw = getStoredVolume(volumeStorageKey);
          const initVol = Math.max(0, Math.min(1, initVolRaw));
          let gainNode = null;
          let mediaSource = null;
          if (normalizedAppData.type === "feed" && ctxForFeed) {
            try {
              mediaSource = ctxForFeed.createMediaStreamSource(stream);
              gainNode = ctxForFeed.createGain();
              gainNode.gain.value = 0;
              mediaSource.connect(gainNode);
              gainNode.connect(ctxForFeed.destination);
              audio.muted = true;
              audio.volume = 0;
              if (ctxForFeed.state !== "running" && typeof ctxForFeed.resume === "function") {
                ctxForFeed.resume().catch((err) => {
                  console.warn("Failed to resume AudioContext:", err);
                });
              }
            } catch (err) {
              console.warn("Failed to initialize feed gain path:", err);
              gainNode = null;
              mediaSource = null;
            }
          }
          if (!gainNode) {
            const applied = Math.max(0, Math.min(1, initVol));
            if (mutedPeers.has(key)) {
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
            key,
            type: normalizedAppData.type || "user",
            gainNode,
            mediaSource,
            lastAppliedLevel: null
          };
          audioElements.set(key, entry);
          audioEntryMap.set(audio, entry);
          if (normalizedAppData.type === "feed") {
            if (mutedPeers.has(key)) {
              muteFeedEntry(entry);
            } else if (session.kind === "user") {
              setFeedEntryLevel(entry, entry.volume);
              applyFeedDucking();
            } else {
              setFeedEntryLevel(entry, entry.volume);
            }
            const feedId = Number(normalizedAppData.id);
            if (!feedAudioElements.has(feedId)) {
              feedAudioElements.set(feedId, /* @__PURE__ */ new Set());
            }
            feedAudioElements.get(feedId).add(audio);
            consumer.on("producerclose", () => {
              const set = feedAudioElements.get(feedId);
              set == null ? void 0 : set.delete(audio);
              if (session.kind === "user") {
                applyFeedDucking();
              }
            });
          } else {
            const applied = Math.max(0, Math.min(1, entry.volume));
            if (mutedPeers.has(key)) {
              entry.audio.muted = true;
              entry.audio.volume = 0;
            } else {
              entry.audio.muted = false;
              entry.audio.volume = applied;
            }
            if (normalizedAppData.type === "conference") {
              const confId = normalizedAppData.id;
              if (!confAudioElements.has(confId)) {
                confAudioElements.set(confId, /* @__PURE__ */ new Set());
              }
              confAudioElements.get(confId).add(audio);
              consumer.on("producerclose", () => {
                var _a3;
                (_a3 = confAudioElements.get(confId)) == null ? void 0 : _a3.delete(audio);
              });
            }
          }
        } else {
          const entry = audioElements.get(key);
          entry.audio.srcObject = stream;
          enforcePitchLock(entry.audio);
          if (entry.type === "feed") {
            const ctx = ensureAudioContext();
            if (entry.gainNode && ctx) {
              try {
                (_b2 = entry.mediaSource) == null ? void 0 : _b2.disconnect();
                entry.mediaSource = ctx.createMediaStreamSource(stream);
                entry.mediaSource.connect(entry.gainNode);
                entry.audio.muted = true;
                entry.audio.volume = 0;
                if (ctx.state !== "running" && typeof ctx.resume === "function") {
                  ctx.resume().catch((err) => {
                    console.warn("Failed to resume AudioContext:", err);
                  });
                }
              } catch (err) {
                console.warn("Failed to refresh feed gain path:", err);
                entry.mediaSource = null;
                try {
                  entry.gainNode.disconnect();
                } catch (e) {
                }
                entry.gainNode = null;
                entry.audio.muted = false;
                entry.audio.volume = Math.max(0, Math.min(1, (_c2 = entry.volume) != null ? _c2 : defaultVolume));
              }
            }
            if (mutedPeers.has(key)) {
              muteFeedEntry(entry);
            } else if (session.kind === "user") {
              setFeedEntryLevel(entry, (_d2 = entry.volume) != null ? _d2 : defaultVolume);
              applyFeedDucking();
            } else {
              setFeedEntryLevel(entry, (_e2 = entry.volume) != null ? _e2 : defaultVolume);
            }
          } else {
            const applied = Math.max(0, Math.min(1, (_f = entry.volume) != null ? _f : defaultVolume));
            entry.audio.muted = mutedPeers.has(key);
            entry.audio.volume = mutedPeers.has(key) ? 0 : applied;
          }
          audioEntryMap.set(entry.audio, entry);
          if (entry.type === "feed" && session.kind === "user") {
            applyFeedDucking();
          }
        }
        await attemptPlayAudio((_g = audioElements.get(key)) == null ? void 0 : _g.audio).catch(() => {
        });
        await new Promise(
          (res) => socket.emit("resume-consumer", { consumerId: consumer.id }, res)
        );
        consumer.on("producerclose", () => {
          var _a3;
          console.log(`Producer closed for consumer ${consumer.id}`);
          if (shouldTrackForMe) {
            untrackTalkerForMe(key, consumer.id);
          }
          const consumersSet = peerConsumers.get(key);
          let remaining = 0;
          if (consumersSet) {
            consumersSet.delete(consumer);
            remaining = consumersSet.size;
            if (remaining === 0) {
              peerConsumers.delete(key);
            }
          }
          if (remaining > 0) {
            return;
          }
          speakingPeers.delete(key);
          updateSpeakerHighlight(key, false);
          const stored = audioElements.get(key);
          if (stored) {
            const audioEl = stored.audio;
            pendingAutoplayAudios.delete(audioEl);
            if (stored.mediaSource) {
              try {
                stored.mediaSource.disconnect();
              } catch (e) {
              }
              stored.mediaSource = null;
            }
            if (stored.gainNode) {
              try {
                stored.gainNode.disconnect();
              } catch (e) {
              }
              stored.gainNode = null;
            }
            audioEl.remove();
            audioEntryMap.delete(audioEl);
            audioElements.delete(key);
            if (stored.type === "feed") {
              const feedId = Number(normalizedAppData.id);
              (_a3 = feedAudioElements.get(feedId)) == null ? void 0 : _a3.delete(audioEl);
              if (session.kind === "user") {
                applyFeedDucking();
              }
            }
          }
        });
      } catch (err) {
        console.error("Error consuming:", err);
      }
    }
    async function processPendingProducers() {
      var _a2;
      if (!device || !recvTransport) return;
      const seenDuringFlush = /* @__PURE__ */ new Set();
      while (pendingProducerQueue.length) {
        const payload = pendingProducerQueue.shift();
        if (((_a2 = payload == null ? void 0 : payload.appData) == null ? void 0 : _a2.type) === "conference" && payload.appData.id != null) {
          seenDuringFlush.add(Number(payload.appData.id));
        }
        try {
          await consumeProducerPayload(payload);
        } catch (err) {
          console.error("Failed to consume queued producer", err);
        }
      }
      if (seenDuringFlush.size) {
        document.querySelectorAll(".target-item.conference-target").forEach((li) => {
          var _a3;
          const confId = Number(li.dataset.id);
          if (!seenDuringFlush.has(confId)) {
            li.classList.remove("speaking", "last-spoke");
            (_a3 = li.querySelector(".conf-icon")) == null ? void 0 : _a3.classList.remove("speaking");
          }
        });
      }
    }
    async function requestActiveProducers() {
      try {
        const payloads = await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Timeout requesting active producers")),
            5e3
          );
          socket.emit("request-active-producers", (list) => {
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
        console.error("Failed to request active producers", err);
      }
    }
    async function initializeMediaSoup() {
      try {
        console.log("=== Starting MediaSoup initialization ===");
        console.log("1. Requesting RTP Capabilities...");
        const rtpCapabilities = await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Timeout getting RTP caps")),
            5e3
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
        console.log("1. \u2713 Got RTP Capabilities");
        console.log("2. Creating MediaSoup Device...");
        device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities });
        console.log("2. \u2713 Device loaded");
        console.log("3. Creating send transport...");
        const sendParams = await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Timeout creating send transport")),
            5e3
          );
          socket.emit("create-send-transport", null, (params) => {
            clearTimeout(timeout);
            resolve(params);
          });
        });
        sendTransport = device.createSendTransport(sendParams);
        console.log("3. \u2713 Send transport created");
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
        sendTransport.on(
          "produce",
          async ({ kind, rtpParameters, appData }, callback, errback) => {
            try {
              const mergedAppData = __spreadValues(__spreadValues({}, appData), currentTargetPeer ? { targetPeer: currentTargetPeer } : {});
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
        console.log("4. Creating receive transport...");
        const recvParams = await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Timeout creating recv transport")),
            5e3
          );
          socket.emit("create-recv-transport", null, (params) => {
            clearTimeout(timeout);
            resolve(params);
          });
        });
        recvTransport = device.createRecvTransport(recvParams);
        console.log("4. \u2713 Recv transport created");
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
        document.querySelectorAll("#users li:not(.you)").forEach((li) => {
          li.style.cursor = "pointer";
        });
        await processPendingProducers();
        await requestActiveProducers();
        if (session.kind === "feed") {
          updateFeedControls();
          if (!feedManualStop && (feedStreaming || shouldStartFeedWhenReady)) {
            shouldStartFeedWhenReady = false;
            startFeedStream().catch((err) => console.error("Failed to start feed after init", err));
          }
        }
        console.log("=== \u2713 MediaSoup initialization complete! ===");
      } catch (err) {
        console.error("=== \u2717 MediaSoup initialization failed ===");
        console.error("Error:", err);
        alert("Initialization failed: " + err.message);
      }
    }
    socket.on("new-producer", (payload) => {
      if (payload && typeof payload === "object") {
        console.log(`New producer ${payload.producerId} from peer ${payload.peerId}`, payload.appData);
      }
      handleIncomingProducer(payload).catch((err) => console.error("Failed to handle producer", err));
    });
    socket.on("producer-closed", ({ peerId, appData }) => {
      var _a2;
      let key;
      if ((appData == null ? void 0 : appData.type) === "conference") {
        key = `conf-${appData.id}`;
      } else if ((appData == null ? void 0 : appData.type) === "feed") {
        key = `feed-${appData.id}`;
      } else {
        key = `user-${peerId}`;
      }
      const consumersSet = peerConsumers.get(key);
      if (!consumersSet || consumersSet.size === 0) {
        clearTalkersForKey(key);
        speakingPeers.delete(key);
        updateSpeakerHighlight(key, false);
        return;
      }
      consumersSet.forEach((c) => {
        if ((appData == null ? void 0 : appData.type) !== "feed") {
          untrackTalkerForMe(key, c.id);
        }
        try {
          c.close();
        } catch (e) {
        }
      });
      peerConsumers.delete(key);
      speakingPeers.delete(key);
      updateSpeakerHighlight(key, false);
      const stored = audioElements.get(key);
      if (stored) {
        const audioEl = stored.audio;
        pendingAutoplayAudios.delete(audioEl);
        audioEl.remove();
        audioEntryMap.delete(audioEl);
        audioElements.delete(key);
        if (stored.type === "feed") {
          const feedId = Number(appData == null ? void 0 : appData.id);
          (_a2 = feedAudioElements.get(feedId)) == null ? void 0 : _a2.delete(audioEl);
          if (session.kind === "user") {
            applyFeedDucking();
          }
        }
      }
    });
    function getTargetLabel(targetKey) {
      var _a2;
      if (targetLabels.has(targetKey)) {
        return (_a2 = targetLabels.get(targetKey)) != null ? _a2 : "";
      }
      const separatorIndex = targetKey.indexOf("-");
      const fallback = separatorIndex >= 0 ? targetKey.slice(separatorIndex + 1) : targetKey;
      return fallback || "";
    }
    function updateSpeakerHighlight(targetKey, isSpeaking) {
      const el = document.getElementById(targetKey);
      const iconCls = targetKey.startsWith("conf-") ? ".conf-icon" : targetKey.startsWith("feed-") ? ".feed-icon" : ".user-icon";
      const icon = el == null ? void 0 : el.querySelector(iconCls);
      if (isSpeaking) {
        el == null ? void 0 : el.classList.add("speaking");
        el == null ? void 0 : el.classList.remove("last-spoke");
        icon == null ? void 0 : icon.classList.add("speaking");
        return;
      }
      el == null ? void 0 : el.classList.remove("speaking");
      icon == null ? void 0 : icon.classList.remove("speaking");
      const labelText = getTargetLabel(targetKey);
      const separatorIndex = targetKey.indexOf("-");
      const rawId = separatorIndex >= 0 ? targetKey.slice(separatorIndex + 1) : targetKey;
      const isConference = targetKey.startsWith("conf-");
      const isUser = targetKey.startsWith("user-");
      const isFeed = targetKey.startsWith("feed-");
      if (isFeed) {
        el == null ? void 0 : el.classList.remove("last-spoke");
        return;
      }
      if (!isConference && !isUser) {
        clearReplyTarget();
      } else {
        const targetData = {
          type: isConference ? "conference" : "user",
          id: rawId,
          label: labelText || rawId
        };
        if (targetData.type === "user" && targetData.id === socket.id) {
          lastTarget = null;
        } else {
          lastTarget = targetData;
        }
      }
      btnReply.disabled = !lastTarget;
      renderReplyButtonLabel();
      document.querySelectorAll(".last-spoke").forEach((elem) => elem.classList.remove("last-spoke"));
      el == null ? void 0 : el.classList.add("last-spoke");
      applyFeedDucking();
    }
    function toKey(rawId) {
      const id = String(rawId);
      if (id.startsWith("user-") || id.startsWith("conf-") || id.startsWith("feed-")) {
        return id;
      }
      return isFinite(id) ? `conf-${id}` : `user-${id}`;
    }
    function toggleMute(rawId) {
      var _a2, _b2, _c2, _d2;
      const key = toKey(rawId);
      const consumers = peerConsumers.get(key);
      console.log("[DEBUG] toggleMute with key:", key, "Consumers:", consumers);
      const wasMuted = mutedPeers.has(key);
      if (wasMuted) mutedPeers.delete(key);
      else mutedPeers.add(key);
      const nowMuted = mutedPeers.has(key);
      if (isFeedKey(key)) {
        const entry = audioElements.get(key);
        if (entry == null ? void 0 : entry.audio) {
          if (nowMuted) {
            muteFeedEntry(entry);
          } else {
            setFeedEntryLevel(entry, (_a2 = entry.volume) != null ? _a2 : defaultVolume);
            enforcePitchLock(entry.audio);
            attemptPlayAudio(entry.audio).catch(() => {
            });
          }
        }
        if (session.kind === "user") {
          applyFeedDucking();
        }
      } else if (consumers) {
        consumers.forEach((c) => {
          if (!(c == null ? void 0 : c.pause) || !(c == null ? void 0 : c.resume)) return;
          nowMuted ? c.pause() : c.resume();
        });
      } else {
        console.warn(`No active consumer for ${key}; deferring mute toggle.`);
      }
      if (!isFeedKey(key)) {
        const entry = audioElements.get(key);
        if (entry == null ? void 0 : entry.audio) {
          if (nowMuted) {
            entry.audio.muted = true;
            entry.audio.volume = 0;
          } else {
            const base = Math.max(0, Math.min(1, (_b2 = entry.volume) != null ? _b2 : defaultVolume));
            const applied = Math.max(0, Math.min(1, base));
            entry.audio.muted = false;
            entry.audio.volume = applied;
            enforcePitchLock(entry.audio);
          }
        }
      }
      const elSelector = `#${key}`;
      const iconSelector = key.startsWith("conf-") ? `${elSelector} .conf-icon` : key.startsWith("feed-") ? `${elSelector} .feed-icon` : `${elSelector} .user-icon`;
      (_c2 = document.querySelector(elSelector)) == null ? void 0 : _c2.classList.toggle("muted", nowMuted);
      (_d2 = document.querySelector(iconSelector)) == null ? void 0 : _d2.classList.toggle("muted", nowMuted);
    }
    function isSameTarget(a, b) {
      if (!a || !b) return false;
      return a.type === b.type && String(a.id) === String(b.id);
    }
    function clearLockState() {
      if (!activeLockButton) return;
      activeLockButton.classList.remove("active");
      activeLockButton.textContent = "Talk Lock";
      activeLockButton.setAttribute("aria-pressed", "false");
      activeLockButton = null;
      activeLockTarget = null;
    }
    function toggleTargetLock(target, button) {
      if (session.kind !== "user") return;
      const normalizedTarget = {
        type: target.type,
        id: target.id
      };
      if (activeLockButton === button) {
        handleStopTalking({ preventDefault() {
        }, currentTarget: button });
        return;
      }
      if (activeLockButton && activeLockButton !== button) {
        handleStopTalking({ preventDefault() {
        }, currentTarget: activeLockButton });
      } else if (producer2) {
        handleStopTalking({ preventDefault() {
        }, currentTarget: button });
      }
      activeLockButton = button;
      activeLockTarget = normalizedTarget;
      button.classList.add("active");
      button.textContent = "Unlock";
      button.setAttribute("aria-pressed", "true");
      handleTalk({ preventDefault() {
      } }, normalizedTarget);
    }
    function findLockButtonForTarget(target) {
      if (!target) return null;
      if (target.type === "user") {
        return document.querySelector(`#user-${target.id} .lock-btn`);
      }
      if (target.type === "conference") {
        return document.querySelector(`#conf-${target.id} .lock-btn`);
      }
      return null;
    }
    async function handleTalk(e, target) {
      var _a2, _b2;
      e.preventDefault();
      if (session.kind !== "user") return;
      if (producer2) return;
      if (!target) return;
      isTalking2 = true;
      currentTarget = target;
      currentTargetPeer = target.type === "user" ? target.id : null;
      if (feedDimSelf) {
        applyFeedDucking();
      }
      try {
        const qualityKey = currentQualityKey();
        const profile = QUALITY_PROFILES[qualityKey] || QUALITY_PROFILES["low-latency"];
        const inputSelect2 = document.getElementById("input-select");
        const selectedDeviceId = inputSelect2 == null ? void 0 : inputSelect2.value;
        const audioConstraints = __spreadValues(__spreadValues({
          echoCancellation: audioProcessingOptions.echoCancellation,
          noiseSuppression: audioProcessingOptions.noiseSuppression,
          autoGainControl: audioProcessingOptions.autoGainControl
        }, (profile == null ? void 0 : profile.constraints) || {}), selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {});
        const track = await ensureMicTrack(audioConstraints, selectedDeviceId);
        track.enabled = true;
        let processedTrack = null;
        if (!audioProcessingEnabled) {
          const processing = ensureUserProcessingChain(track);
          processedTrack = (processing == null ? void 0 : processing.outputTrack) || null;
        }
        const finalTrack = processedTrack || track;
        finalTrack.enabled = true;
        const params = {
          track: finalTrack,
          appData: { type: target.type, id: target.id },
          codecOptions: (profile == null ? void 0 : profile.codecOptions) ? __spreadValues({}, profile.codecOptions) : void 0,
          encodings: (profile == null ? void 0 : profile.encodings) ? profile.encodings.map((enc) => __spreadValues({}, enc)) : void 0,
          stopTracks: false
        };
        const newProducer = await sendTransport.produce(params);
        if (!isTalking2) {
          newProducer.close();
          finalTrack.enabled = false;
          if (processedTrack && processedTrack !== track) {
            processedTrack.enabled = false;
          }
          track.enabled = false;
          scheduleMicCleanup();
          return;
        }
        producer2 = newProducer;
        newProducer.on("close", () => {
          if (producer2 === newProducer) {
            producer2 = null;
          }
          if (micTrack) {
            micTrack.enabled = false;
          }
          if (processedTrack && processedTrack !== micTrack) {
            processedTrack.enabled = false;
          }
          scheduleMicCleanup();
        });
        const selector = target.type === "user" ? `#user-${target.id}` : `#conf-${target.id}`;
        (_a2 = document.querySelector(selector)) == null ? void 0 : _a2.classList.add("talking-to");
      } catch (err) {
        console.error("Microphone error:", err);
        alert("Failed to start the microphone: " + err.message);
        btnReply.classList.remove("active");
        clearLockState();
        isTalking2 = false;
        if (micTrack) {
          micTrack.enabled = false;
        }
        if (userProcessingChain == null ? void 0 : userProcessingChain.outputTrack) {
          userProcessingChain.outputTrack.enabled = false;
        }
        scheduleMicCleanup();
        applyFeedDucking();
        if (currentTarget) {
          const selector = currentTarget.type === "conference" ? `#conf-${currentTarget.id}` : `#user-${currentTarget.id}`;
          (_b2 = document.querySelector(selector)) == null ? void 0 : _b2.classList.remove("talking-to");
        }
        currentTarget = null;
      }
    }
    btnReply.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (session.kind !== "user") return;
      if (!lastTarget) return;
      btnReply.classList.add("active");
      handleTalk(e, { type: lastTarget.type, id: lastTarget.id });
    });
    btnReply.addEventListener("pointerup", handleStopTalking);
    btnReply.addEventListener("pointerleave", handleStopTalking);
    btnReply.addEventListener("pointercancel", handleStopTalking);
    function handleStopTalking(e) {
      e.preventDefault();
      if (session.kind !== "user") return;
      if (activeLockButton && e.currentTarget && e.currentTarget !== activeLockButton) {
        return;
      }
      isTalking2 = false;
      btnReply.classList.remove("active");
      clearLockState();
      if (producer2) {
        socket.emit("producer-close", { producerId: producer2.id });
        producer2.close();
        producer2 = null;
      }
      if (micTrack) {
        micTrack.enabled = false;
      }
      if (userProcessingChain == null ? void 0 : userProcessingChain.outputTrack) {
        userProcessingChain.outputTrack.enabled = false;
      }
      scheduleMicCleanup();
      if (currentTarget) {
        const li = document.querySelector(
          currentTarget.type === "conference" ? `#conf-${currentTarget.id}` : `#user-${currentTarget.id}`
        );
        li == null ? void 0 : li.classList.remove("talking-to");
      }
      currentTarget = null;
      currentTargetPeer = null;
      applyFeedDucking();
      attemptPendingAutoplay();
    }
    console.log("Socket connected?", socket.connected);
  });
})();
