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
const FEED_DUCKING_FACTOR = 0.35;

const FEED_PROFILE = {
  label: 'Feed (raw stream)',
  codecLabel: 'opus 48k',
  codecOptions: {
    opusStereo: 0,
    opusFec: 0,
    opusDtx: 0,
    opusMaxAverageBitrate: 128000,
    opusPtime: 20,
  },
  encodings: [{ dtx: false, maxBitrate: 128000, priority: 'high' }],
  constraints: { channelCount: 1, sampleRate: 48000 },
};

let session = { kind: 'guest', userId: null, feedId: null, name: null };
let inputSelect;
let qualitySelect;
const MIC_DEVICE_STORAGE_KEY = 'preferredAudioInputDeviceId';

let micStream = null;
let micTrack = null;
let micDeviceId = null;
let micCleanupTimer = null;
const audioProcessingOptions = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: true,
};

let feedStreaming = false;
let feedManualStop = false;
let shouldStartFeedWhenReady = false;


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
      return micTrack;
    }
    cleanupMicTrack();
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
  const [track] = stream.getAudioTracks();

  micStream = stream;
  micTrack = track;
  micDeviceId = selectedDeviceId || track.getSettings?.().deviceId || null;

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

  return micTrack;
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
  const echoToggle = document.getElementById('toggle-echo');
  const noiseToggle = document.getElementById('toggle-noise');
  const agcToggle = document.getElementById('toggle-agc');

  const processingToggles = [
    { element: echoToggle, key: 'audioEchoCancellation', option: 'echoCancellation', defaultValue: false },
    { element: noiseToggle, key: 'audioNoiseSuppression', option: 'noiseSuppression', defaultValue: false },
    { element: agcToggle, key: 'audioAutoGainControl', option: 'autoGainControl', defaultValue: true },
  ];

  processingToggles.forEach(({ element, key, option, defaultValue }) => {
    if (!element) return;
    const stored = localStorage.getItem(key);
    const initial = stored === null ? defaultValue : stored === 'true';
    audioProcessingOptions[option] = initial;
    element.checked = initial;
    element.addEventListener('change', () => {
      const value = !!element.checked;
      audioProcessingOptions[option] = value;
      localStorage.setItem(key, String(value));
      cleanupMicTrack();
    });
  });

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
  const feedDimmingDisabled = new Set();
  const speakingPeers = new Set();
  const lastSpokePeers = new Map();
  const mutedPeers = new Set();
  const pendingProducerQueue = [];
  let currentTargetPeer = null;
  let lastTarget = null;
  let isTalking = false;
  let currentTarget = null;
  let cachedUsers = [];
  let mediaInitialized = false;
  let initializingMediaPromise = null;
  let shouldInitializeAfterConnect = false;
  let activeLockButton = null;
  let activeLockTarget = null;

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

    processingToggles.forEach(({ element, key, option, defaultValue }) => {
      if (!element) return;
      if (isFeed) {
        element.checked = false;
        element.disabled = true;
        audioProcessingOptions[option] = false;
      } else {
        element.disabled = false;
        const stored = localStorage.getItem(key);
        const value = stored === null ? defaultValue : stored === 'true';
        element.checked = value;
        audioProcessingOptions[option] = value;
      }
    });

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

    updateFeedControls();
  }

  applySessionUI();

  function updateFeedControls() {
    if (!feedBanner) return;
    const isFeed = session.kind === 'feed';
    feedBanner.hidden = !isFeed;
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
    const shouldDuck = Array.from(speakingPeers).some((key) => !key.startsWith('feed-'));

    for (const [feedId, audios] of feedAudioElements) {
      const key = `feed-${feedId}`;
      const tile = document.getElementById(key);
      const dimDisabled = feedDimmingDisabled.has(feedId);
      tile?.classList.toggle('feed-dimmed', shouldDuck && !dimDisabled);

      for (const audioEl of audios) {
        const entry = audioEntryMap.get(audioEl);
        if (!entry) continue;
        const base = Math.max(0, Math.min(1, entry.volume ?? defaultVolume));
        const targetVol = shouldDuck ? Math.max(0, Math.min(1, base * FEED_DUCKING_FACTOR)) : base;
        audioEl.volume = targetVol;
      }
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
      const consumers = peerConsumers.get(feedKey);
      if (consumers) {
        consumers.forEach(c => { try { c.close(); } catch {} });
        peerConsumers.delete(feedKey);
      }
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
      track.enabled = true;

      const newProducer = await sendTransport.produce({
        track,
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
      intercomApp.style.display = "block";
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
      if (targetType === 'conference') return { type: 'conference', id: Number(targetId) };
      return null; // fallback
    };

    if (action === 'press') {
      const target = resolveTarget();
      await handleTalk(dummyEvent, target);
    } else if (action === 'release') {
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

    targetLabels.clear();

    const usersById = new Map();
    users.forEach(u => {
      usersById.set(Number(u.userId), u);
      targetLabels.set(`user-${u.socketId}`, u.name || u.socketId);
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
      const user = usersById.get(targetIdNum);
      if (!user) return;
      const { socketId, name } = user;
      if (!socketId || socketId === socket.id) return;

      const li = document.createElement('li');
      li.id = `user-${socketId}`;
      li.classList.add('target-item', 'user-target');

      const icon = document.createElement('div');
      icon.className = 'user-icon';
      icon.textContent = name ? name.charAt(0).toUpperCase() : socketId.slice(0, 2);

      const info = document.createElement('div');
      info.className = 'target-info';

      const label = document.createElement('span');
      label.className = 'target-label';
      label.textContent = name || socketId;
      info.appendChild(label);

      const userKey = `volume_user_${socketId}`;
      const volSlider = document.createElement('input');
      volSlider.type = 'range';
      volSlider.min = '0';
      volSlider.max = '1';
      volSlider.step = '0.01';
      volSlider.value = getStoredVolume(userKey).toString();
      volSlider.className = 'volume-slider';
      volSlider.title = 'Source Volume';
      volSlider.addEventListener('input', e => {
        const vol = parseFloat(e.target.value);
        const entry = audioElements.get(socketId);
        if (entry?.audio) {
          entry.audio.volume = vol;
          entry.volume = vol;
        }
        storeVolume(userKey, vol);
      });
      info.appendChild(volSlider);

      const lockBtn = document.createElement('button');
      lockBtn.className = 'lock-btn';
      lockBtn.textContent = 'Talk Lock';
      lockBtn.type = 'button';
      lockBtn.setAttribute('aria-pressed', 'false');
      lockBtn.setAttribute('aria-label', `Toggle talk lock for ${name || socketId}`);
      lockBtn.addEventListener('pointerdown', e => e.stopPropagation());
      lockBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleTargetLock({ type: 'user', id: socketId }, lockBtn);
      });

      const muteBtn = document.createElement('button');
      muteBtn.className = 'mute-btn';
      muteBtn.textContent = mutedPeers.has(`user-${socketId}`) ? 'Unmute' : 'Mute';
      muteBtn.type = 'button';
      muteBtn.addEventListener('pointerdown', e => e.stopPropagation());
      muteBtn.addEventListener('click', e => {
        e.stopPropagation();
        const key = `user-${socketId}`;
        toggleMute(socketId);
        const nowMuted = mutedPeers.has(key);
        muteBtn.textContent = nowMuted ? 'Unmute' : 'Mute';
        muteBtn.classList.toggle('muted', nowMuted);
      });
      muteBtn.classList.toggle('muted', mutedPeers.has(`user-${socketId}`));

      const actions = document.createElement('div');
      actions.className = 'target-actions';
      actions.append(lockBtn, muteBtn);

      const isLocked = isSameTarget(activeLockTarget, { type: 'user', id: socketId });
      if (isLocked) {
        activeLockButton = lockBtn;
        lockBtn.classList.add('active');
        lockBtn.textContent = 'Unlock';
        lockBtn.setAttribute('aria-pressed', 'true');
      }

      li.append(icon, info, actions);

      ['down', 'up', 'leave', 'cancel'].forEach(ev => {
        li.addEventListener(`pointer${ev}`, e => {
          if (
            e.target.closest('.mute-btn') ||
            e.target.closest('.lock-btn') ||
            e.target.closest('.volume-slider')
          ) return;
          if (ev === 'down') handleTalk(e, { type: 'user', id: socketId });
          else handleStopTalking(e);
        });
      });

      list.appendChild(li);
    };

    const appendConferenceTarget = (target) => {
      const id = Number(target.targetId);
      const name = conferenceNames.get(id) || target.name;
      const key = `conf-${id}`;

      const li = document.createElement('li');
      li.id = key;
      li.classList.add('target-item', 'conf-target');

      const icon = document.createElement('div');
      icon.className = 'conf-icon';
      icon.textContent = '📡';

      const info = document.createElement('div');
      info.className = 'target-info';

      const label = document.createElement('span');
      label.className = 'target-label';
      label.textContent = name;
      info.appendChild(label);

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

      const lockBtn = document.createElement('button');
      lockBtn.className = 'lock-btn';
      lockBtn.textContent = 'Talk Lock';
      lockBtn.type = 'button';
      lockBtn.setAttribute('aria-pressed', 'false');
      lockBtn.setAttribute('aria-label', `Toggle talk lock for ${name}`);
      lockBtn.addEventListener('pointerdown', e => e.stopPropagation());
      lockBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleTargetLock({ type: 'conference', id }, lockBtn);
      });

      const muteBtn = document.createElement('button');
      muteBtn.className = 'mute-btn';
      const muted = mutedPeers.has(key);
      muteBtn.textContent = muted ? 'Unmute' : 'Mute';
      muteBtn.type = 'button';
      if (muted) muteBtn.classList.add('muted');
      muteBtn.addEventListener('pointerdown', e => e.stopPropagation());
      muteBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleMute(id);
        const nowMuted = mutedPeers.has(key);
        muteBtn.textContent = nowMuted ? 'Unmute' : 'Mute';
        muteBtn.classList.toggle('muted', nowMuted);
      });
      const actions = document.createElement('div');
      actions.className = 'target-actions';
      actions.append(lockBtn, muteBtn);

      if (isSameTarget(activeLockTarget, { type: 'conference', id })) {
        activeLockButton = lockBtn;
        lockBtn.classList.add('active');
        lockBtn.textContent = 'Unlock';
        lockBtn.setAttribute('aria-pressed', 'true');
      }

      li.append(icon, info, actions);

      ['down', 'up', 'leave', 'cancel'].forEach(ev => {
        li.addEventListener(`pointer${ev}`, e => {
          if (
            e.target.closest('.mute-btn') ||
            e.target.closest('.lock-btn') ||
            e.target.closest('.volume-slider')
          ) return;
          if (ev === 'down') handleTalk(e, { type: 'conference', id });
          else handleStopTalking(e);
        });
      });

      list.appendChild(li);
    };

    targets.forEach(target => {
      if (target.targetType === 'user') {
        appendUserTarget(target);
      } else if (target.targetType === 'conference') {
        appendConferenceTarget(target);
      } else if (target.targetType === 'feed') {
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
        const dimDisabled = feedDimmingDisabled.has(id);
        dimBtn.textContent = 'Dim';
        dimBtn.type = 'button';
        dimBtn.setAttribute('aria-pressed', dimDisabled ? 'true' : 'false');
        dimBtn.classList.toggle('dim-off', dimDisabled);
        dimBtn.addEventListener('pointerdown', e => e.stopPropagation());
        dimBtn.addEventListener('click', e => {
          e.stopPropagation();
          if (feedDimmingDisabled.has(id)) {
            feedDimmingDisabled.delete(id);
            dimBtn.setAttribute('aria-pressed', 'false');
            dimBtn.classList.remove('dim-off');
          } else {
            feedDimmingDisabled.add(id);
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
          const vol = parseFloat(e.target.value);
          const audios = feedAudioElements.get(id);
          if (audios) {
            audios.forEach(a => {
              const entry = audioEntryMap.get(a);
              if (entry) entry.volume = vol;
            });
          }
          storeVolume(feedKey, vol);
          applyFeedDucking();
        });
        info.appendChild(feedSlider);

        const muteBtn = document.createElement('button');
        muteBtn.className = 'mute-btn';
        const muted = mutedPeers.has(key);
        muteBtn.textContent = muted ? 'Unmute' : 'Mute';
        muteBtn.type = 'button';
        muteBtn.classList.toggle('muted', muted);
        muteBtn.addEventListener('pointerdown', e => e.stopPropagation());
        muteBtn.addEventListener('click', e => {
          e.stopPropagation();
          toggleMute(key);
          const nowMuted = mutedPeers.has(key);
          muteBtn.textContent = nowMuted ? 'Unmute' : 'Mute';
          muteBtn.classList.toggle('muted', nowMuted);
        });

        const actions = document.createElement('div');
        actions.className = 'target-actions';
        actions.append(dimBtn, muteBtn);

        li.append(icon, info, actions);
        list.appendChild(li);
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
      const consumers = peerConsumers.get(feedKey);
      if (consumers) {
        consumers.forEach(c => { try { c.close(); } catch {} });
        peerConsumers.delete(feedKey);
      }
      speakingPeers.delete(feedKey);
      mutedPeers.delete(feedKey);
      updateSpeakerHighlight(feedKey, false);
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

    document.querySelectorAll('.target-item').forEach(li => {
      const [type, id] = li.id.split('-');
      const key = `${type}-${id}`;
      const icon = type === 'user'
        ? li.querySelector('.user-icon')
        : type === 'conference'
          ? li.querySelector('.conf-icon')
          : li.querySelector('.feed-icon');

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

    let key;
    let volumeStorageKey;
    if (normalizedAppData.type === 'conference') {
      key = `conf-${normalizedAppData.id}`;
      volumeStorageKey = `volume_conf_${normalizedAppData.id}`;
    } else if (normalizedAppData.type === 'feed') {
      key = `feed-${normalizedAppData.id}`;
      volumeStorageKey = `volume_feed_${normalizedAppData.id}`;
    } else {
      key = `user-${peerId}`;
      volumeStorageKey = `volume_user_${peerId}`;
    }

    // ignore our own streams
    if (peerId === socket.id) return;

    // skip streams not intended for us
    if (normalizedAppData.targetPeer && normalizedAppData.targetPeer !== socket.id) {
      console.log('Producer not for us, skipping');
      return;
    }

    try {
      speakingPeers.add(key);
      updateSpeakerHighlight(key, true);

      // request to consume this producer
      const { error, ...consumeParams } = await new Promise((resolve) =>
        socket.emit('consume', {
          producerId,
          rtpCapabilities: device.rtpCapabilities,
        }, resolve)
      );
      if (error) throw new Error(error);

      // actually create the consumer
      const consumer = await recvTransport.consume(consumeParams);

      // track this consumer for mute/unmute
      if (!peerConsumers.has(key)) peerConsumers.set(key, new Set());
      peerConsumers.get(key).add(consumer);
      if (mutedPeers.has(key)) consumer.pause();

      // wrap the track in a MediaStream
      const stream = new MediaStream([consumer.track]);

      // if this is the first time seeing this peer, create an <audio> element
      if (!audioElements.has(key)) {
        const audio = document.createElement('audio');
        audio.srcObject = stream;
        audio.autoplay = true;

        const initVol = getStoredVolume(volumeStorageKey);
        audio.volume = initVol;

        // add the element to the DOM and save it
        audioStreamsDiv.appendChild(audio);
        const entry = { audio, volume: initVol, key, type: normalizedAppData.type || 'user' };
        audioElements.set(key, entry);
        audioEntryMap.set(audio, entry);

        // if this is a conference stream, also track it in confAudioElements
        if (normalizedAppData.type === 'conference') {
          const confId = normalizedAppData.id;
          if (!confAudioElements.has(confId)) {
            confAudioElements.set(confId, new Set());
          }
          confAudioElements.get(confId).add(audio);

          // remove from the set when the producer closes
          consumer.on('producerclose', () => {
            confAudioElements.get(confId)?.delete(audio);
          });
        }

        if (normalizedAppData.type === 'feed') {
          const feedId = normalizedAppData.id;
          if (!feedAudioElements.has(feedId)) {
            feedAudioElements.set(feedId, new Set());
          }
          feedAudioElements.get(feedId).add(audio);

          consumer.on('producerclose', () => {
            feedAudioElements.get(feedId)?.delete(audio);
            applyFeedDucking();
          });
          applyFeedDucking();
        }
      } else {
        // for subsequent streams, just swap the stream and preserve volume
        const entry = audioElements.get(key);
        entry.audio.srcObject = stream;
        entry.audio.volume = entry.volume;
        audioEntryMap.set(entry.audio, entry);
        if (entry.type === 'feed') {
          applyFeedDucking();
        }
      }

      // attempt to play
      try {
        await audioElements.get(key).audio.play();
      } catch {}

      // tell server to resume the consumer
      await new Promise((res) =>
        socket.emit('resume-consumer', { consumerId: consumer.id }, res)
      );

      // cleanup when the producer actually closes
      consumer.on('producerclose', () => {
        console.log(`Producer closed for consumer ${consumer.id}`);
        speakingPeers.delete(key);
        updateSpeakerHighlight(key, false);

        const stored = audioElements.get(key);
        if (stored) {
          const audioEl = stored.audio;
          audioEl.remove();
          audioEntryMap.delete(audioEl);
          audioElements.delete(key);
          if (stored.type === 'feed') {
            const feedId = normalizedAppData.id;
            feedAudioElements.get(feedId)?.delete(audioEl);
            applyFeedDucking();
          }
        }
        peerConsumers.get(key)?.delete(consumer);
      });
    } catch (err) {
      console.error('Error consuming:', err);
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


  socket.on("producer-closed", ({ peerId, appData }) => {
    // 1️⃣ Compute the key like always
    let key;
    if (appData?.type === "conference") {
      key = `conf-${appData.id}`;
    } else if (appData?.type === "feed") {
      key = `feed-${appData.id}`;
    } else if (appData?.type === "user" && appData?.id) {
      key = `user-${appData.id}`;
    } else {
      key = `user-${peerId}`;
    }

    // 2️⃣ Continue only if we were actually consuming this key
    const consumersSet = peerConsumers.get(key);
    if (!consumersSet || consumersSet.size === 0) {
      // We are not listening to this stream, so skip the highlight
      return;
    }

    // 3️⃣ Clean up any remaining consumers
    consumersSet.forEach(c => { try { c.close(); } catch {} });
    peerConsumers.delete(key);

    // 4️⃣ Remove from speakingPeers
    speakingPeers.delete(key);

    // 5️⃣ Update the last-spoke indicator
    updateSpeakerHighlight(key, false);
    if (key.startsWith('feed-')) {
      applyFeedDucking();
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
    if (targetKey.startsWith('feed-')) {
      const tile = document.getElementById(targetKey);
      if (isSpeaking) {
        tile?.classList.add('feed-speaking');
      } else {
        tile?.classList.remove('feed-speaking');
      }
      return;
    }

    const iconCls = targetKey.startsWith("conf-") ? ".conf-icon" : ".user-icon";
    const icon    = el?.querySelector(iconCls);

    if (isSpeaking) {
      el?.classList.add("speaking");
      el?.classList.remove("last-spoke");
      icon?.classList.add("speaking");
      return;
    }

    el?.classList.remove("speaking");
    icon?.classList.remove("speaking");

    const labelText = getTargetLabel(targetKey);
    const separatorIndex = targetKey.indexOf("-");
    const rawId = separatorIndex >= 0 ? targetKey.slice(separatorIndex + 1) : targetKey;
    const isConference = targetKey.startsWith("conf-");
    const isUser = targetKey.startsWith("user-");
    const isFeed = targetKey.startsWith("feed-");

    if (isFeed) {
      el?.classList.remove("last-spoke");
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
  function toKey(rawId) {
    // Always treat the raw ID as a string
    const id = String(rawId);

    // Already a fully qualified key?
    if (id.startsWith("user-") || id.startsWith("conf-") || id.startsWith("feed-")) {
      return id;
    }

    // Conference IDs are numeric; everything else is a socket ID
    return isFinite(id) ? `conf-${id}` : `user-${id}`;
  }


// ---------- Toggle mute ----------
  function toggleMute(rawId) {
    // 1) Derive the key
    const key = toKey(rawId);

    // ─── Debug helper ──────────────────────────────────────────────
    const consumers = peerConsumers.get(key);
    console.log("[DEBUG] toggleMute with key:", key, "Consumers:", consumers);

    // 2) Remaining logic
    const isMuted = mutedPeers.has(key);
    if (isMuted) mutedPeers.delete(key);
    else         mutedPeers.add(key);

    if (consumers) {
      consumers.forEach(c => {
        if (!c?.pause || !c?.resume) return;
        mutedPeers.has(key) ? c.pause() : c.resume();
      });
    } else {
      console.warn(`No active consumer for ${key}; deferring mute toggle.`);
    }

    // Update icon and list entry
    const elSelector   = `#${key}`;
    const iconSelector = key.startsWith("conf-")
        ? `${elSelector} .conf-icon`
        : key.startsWith('feed-')
          ? `${elSelector} .feed-icon`
          : `${elSelector} .user-icon`;

    document.querySelector(elSelector)?.classList.toggle("muted", mutedPeers.has(key));
    document.querySelector(iconSelector)?.classList.toggle("muted", mutedPeers.has(key));
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
    activeLockButton.classList.remove("active");
    activeLockButton.textContent = "Talk Lock";
    activeLockButton.setAttribute("aria-pressed", "false");
    activeLockButton = null;
    activeLockTarget = null;
  }

  function toggleTargetLock(target, button) {
    if (session.kind !== 'user') return;
    const normalizedTarget = {
      type: target.type,
      id: target.id
    };

    if (activeLockButton === button) {
      handleStopTalking({ preventDefault() {}, currentTarget: button });
      return;
    }

    if (activeLockButton && activeLockButton !== button) {
      handleStopTalking({ preventDefault() {}, currentTarget: activeLockButton });
    } else if (producer) {
      handleStopTalking({ preventDefault() {}, currentTarget: button });
    }

    activeLockButton = button;
    activeLockTarget = normalizedTarget;
    button.classList.add("active");
    button.textContent = "Unlock";
    button.setAttribute("aria-pressed", "true");
    handleTalk({ preventDefault() {} }, normalizedTarget);
  }

  async function handleTalk(e, target) {
    e.preventDefault();
    if (session.kind !== 'user') return;
    if (producer) return;
    if (!target) return;

    isTalking     = true;
    currentTarget = target;

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

      // ◆ Producer parameters: always include appData
      const params = {
        track,
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
        scheduleMicCleanup();
      });

      // ◆ Visual feedback only for targeted recipients
      const selector = target.type === "user"
          ? `#user-${target.id}`
          : `#conf-${target.id}`;
      document.querySelector(selector)?.classList.add("talking-to");
    } catch (err) {
      console.error("Microphone error:", err);
      alert("Failed to start the microphone: " + err.message);
      btnReply.classList.remove("active");
      clearLockState();
      isTalking = false;
      if (micTrack) {
        micTrack.enabled = false;
      }
      scheduleMicCleanup();

      if (currentTarget) {
        const selector = currentTarget.type === "conference"
            ? `#conf-${currentTarget.id}`
            : `#user-${currentTarget.id}`;
        document.querySelector(selector)?.classList.remove("talking-to");
      }
      currentTarget = null;
    }
  }




  btnReply.addEventListener("pointerdown", e => {
    e.preventDefault();
    if (session.kind !== 'user') return;
    if (!lastTarget) return;
    btnReply.classList.add("active");
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

    // Reset button states
    btnReply.classList.remove("active");
    clearLockState();

    if (producer) {
      socket.emit("producer-close", { producerId: producer.id });
      producer.close();
      producer = null;
    }

    if (micTrack) {
      micTrack.enabled = false;
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
  }


  // Initial connection check
  console.log("Socket connected?", socket.connected);
});
