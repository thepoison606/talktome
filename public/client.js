const socket = io();

socket.on("cut-camera", (value) => {
  document.body.classList.toggle("cut-camera", value);
});

const BASE_REPLY_LABEL = "🔊 REPLY";
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
let inputSelect;
let qualitySelect;

let micStream = null;
let micTrack = null;
let micDeviceId = null;
let micCleanupTimer = null;
const audioProcessingOptions = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: true,
};


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
    console.warn("Kein Mikrofon-Zugriff, Labels evtl. leer", e);
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs  = devices.filter(d => d.kind === "audioinput");

  // Populate the input dropdown
  if (inputSelect) {
    inputSelect.innerHTML = `<option value="">Select device</option>`;
    inputs.forEach(d => {
      const opt = document.createElement("option");
      opt.value       = d.deviceId;
      opt.textContent = d.label || `Mikrofon ${inputSelect.length}`;
      inputSelect.append(opt);
    });
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
    cleanupMicTrack();
  });


  // Check if mediasoup-client was loaded
  if (typeof mediasoupClient === "undefined") {
    console.error("mediasoup-client not loaded!");
    alert("MediaSoup Client konnte nicht geladen werden!");
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
  const btnAll = document.getElementById("talk-all");
  const btnHold = document.getElementById("talk-lock");
  const btnReply = document.getElementById("reply");
  const audioStreamsDiv = document.getElementById("audio-streams");
  const peerConsumers = new Map();
  const targetLabels = new Map();

  // mediasoup variables
  let device, sendTransport, recvTransport, producer;
  const audioElements = new Map();
  const confAudioElements = new Map();
  const speakingPeers = new Set();
  const lastSpokePeers = new Map();
  const mutedPeers = new Set();
  const pendingProducerQueue = [];
  let currentTargetPeer = null;
  let lastTarget = null;
  let isTalking = false;
  let cachedUsers = [];
  let mediaInitialized = false;
  let initializingMediaPromise = null;
  let shouldInitializeAfterConnect = false;

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
  const userId = localStorage.getItem("userId");
  const userName = localStorage.getItem("userName");

  if (userId && userName) {
    console.log("Auto-login as:", userName);
    loginContainer.style.display = "none";
    intercomApp.style.display = "block";
    myIdEl.textContent = userName;
    socket.emit("register-user", { id: userId, name: userName });
    initializeMediaIfPossible();
  }

  // Login Handler
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("login-username").value;
    const password = document.getElementById("login-password").value;

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

      // Persist auto-login state
      localStorage.setItem("userId", user.id);
      localStorage.setItem("userName", user.name);

      socket.emit("register-user", { id: user.id, name: user.name });

      loginContainer.style.display = "none";
      intercomApp.style.display = "block";
      myIdEl.textContent = user.name;
      initializeMediaIfPossible();
    } catch (err) {
      loginError.textContent = "Error logging in";
      console.error("Login failed:", err);
    }
  });

  // Logout Handler
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem("userId");
      localStorage.removeItem("userName");
      location.reload();
    });
  }

  // Signaling Events
  socket.on("connect", async () => {
    console.log("Connected to signaling server as", socket.id);
    const dbUserId   = localStorage.getItem("userId");
    const dbUserName = localStorage.getItem("userName");
    if (dbUserId && dbUserName) {
      socket.emit("register-user", { id: dbUserId, name: dbUserName });
      myIdEl.textContent = dbUserName;
    }
    if (!shouldInitializeAfterConnect && dbUserId && dbUserName) {
      shouldInitializeAfterConnect = true;
    }

    if (shouldInitializeAfterConnect) {
      try {
        await ensureMediaInitialized();
      } catch (err) {
        console.error('Media initialization on connect failed:', err);
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("Disconnected from server");
    myIdEl.textContent = "Getrennt";
    btnAll.disabled = true;
    btnHold.disabled = true;
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
  });

  socket.on("user-list", async users => {
    cachedUsers = users;
    await renderTargetList(users);
  });

  socket.on('user-targets-updated', async () => {
    if (cachedUsers.length) {
      await renderTargetList(cachedUsers);
    }
  });

  socket.on('api-talk-command', async ({ action, targetType = 'global', targetId = null, mode = 'list' }) => {
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
      return null; // global
    };

    if (action === 'press') {
      const target = resolveTarget();
      if (targetType === 'global') {
        if (mode === 'all') btnAll.classList.add('active');
        else if (mode === 'hold') btnHold.classList.add('active');
      }
      await handleTalk(dummyEvent, target);
    } else if (action === 'release') {
      let currentTarget = null;
      if (mode === 'hold') {
        currentTarget = btnHold;
      } else if (mode === 'all') {
        currentTarget = btnAll;
      }
      handleStopTalking({ preventDefault() {}, currentTarget });
    }
  });

  async function renderTargetList(users) {
    const dbUserId = localStorage.getItem('userId');
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
        if (entry?.audio) entry.audio.volume = vol;
        storeVolume(userKey, vol);
      });
      info.appendChild(volSlider);

      const muteBtn = document.createElement('button');
      muteBtn.className = 'mute-btn';
      muteBtn.textContent = mutedPeers.has(`user-${socketId}`) ? 'Unmute' : 'Mute';
      muteBtn.addEventListener('pointerdown', e => e.stopPropagation());
      muteBtn.addEventListener('click', e => {
        e.stopPropagation();
        const key = `user-${socketId}`;
        toggleMute(socketId);
        const nowMuted = mutedPeers.has(key);
        muteBtn.textContent = nowMuted ? 'Unmute' : 'Mute';
        muteBtn.classList.toggle('muted', nowMuted);
      });
      li.append(icon, info, muteBtn);

      ['down', 'up', 'leave', 'cancel'].forEach(ev => {
        li.addEventListener(`pointer${ev}`, e => {
          if (e.target.closest('.mute-btn') || e.target.closest('.volume-slider')) return;
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
        if (audios) audios.forEach(a => (a.volume = vol));
        storeVolume(confKey, vol);
      });
      info.appendChild(confSlider);

      const muteBtn = document.createElement('button');
      muteBtn.className = 'mute-btn';
      const muted = mutedPeers.has(key);
      muteBtn.textContent = muted ? 'Unmute' : 'Mute';
      if (muted) muteBtn.classList.add('muted');
      muteBtn.addEventListener('pointerdown', e => e.stopPropagation());
      muteBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleMute(id);
        const nowMuted = mutedPeers.has(key);
        muteBtn.textContent = nowMuted ? 'Unmute' : 'Mute';
        muteBtn.classList.toggle('muted', nowMuted);
      });
      li.append(icon, info, muteBtn);

      ['down', 'up', 'leave', 'cancel'].forEach(ev => {
        li.addEventListener(`pointer${ev}`, e => {
          if (e.target.closest('.mute-btn') || e.target.closest('.volume-slider')) return;
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
      }
    });

    document.querySelectorAll('.target-item').forEach(li => {
      const [type, id] = li.id.split('-');
      const icon = li.querySelector(type === 'user' ? '.user-icon' : '.conf-icon');

      const isSpeaking = speakingPeers.has(id);
      li.classList.toggle('speaking', isSpeaking);
      if (icon) icon.classList.toggle('speaking', isSpeaking);

      li.classList.toggle('last-spoke', lastSpokePeers.has(id));
      li.classList.toggle('muted', mutedPeers.has(id));
      if (icon) icon.classList.toggle('muted', mutedPeers.has(id));
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

    // determine a unique key for this stream (either a conference or a user)
    const key = normalizedAppData.type === 'conference'
      ? `conf-${normalizedAppData.id}`
      : `user-${peerId}`;

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
      if (!audioElements.has(peerId)) {
        const audio = document.createElement('audio');
        audio.srcObject = stream;
        audio.autoplay = true;

        // load the saved volume from sessionStorage
        const volKey = normalizedAppData.type === 'conference'
          ? `volume_conf_${normalizedAppData.id}`
          : `volume_user_${peerId}`;
        const initVol = getStoredVolume(volKey);
        audio.volume = initVol;

        // add the element to the DOM and save it
        audioStreamsDiv.appendChild(audio);
        audioElements.set(peerId, { audio, volume: initVol });

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
      } else {
        // for subsequent streams, just swap the stream and preserve volume
        const entry = audioElements.get(peerId);
        entry.audio.srcObject = stream;
        entry.audio.volume = entry.volume;
      }

      // attempt to play
      try {
        await audioElements.get(peerId).audio.play();
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

        const stored = audioElements.get(peerId);
        if (stored) {
          stored.audio.remove();
          audioElements.delete(peerId);
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

      // Enable buttons after successful initialization
      btnAll.disabled = false;
      btnHold.disabled = false;
      // Update all user list items to be clickable
      document.querySelectorAll("#users li:not(.you)").forEach((li) => {
        li.style.cursor = "pointer";
      });

      await processPendingProducers();
      await requestActiveProducers();
      console.log("=== ✓ MediaSoup initialization complete! ===");
    } catch (err) {
      console.error("=== ✗ MediaSoup initialization failed ===");
      console.error("Error:", err);
      alert("Fehler bei der Initialisierung: " + err.message);
    }
  }

  // Handle new producers
// Helper function (if not already defined globally)
  function toKey(rawId, appData) {
    if (appData?.type === "conference") return `conf-${appData.id}`;
    if (rawId.startsWith?.("user-") || rawId.startsWith?.("conf-")) return rawId;
    return `user-${rawId}`;
  }

  socket.on('new-producer', (payload) => {
    if (payload && typeof payload === 'object') {
      console.log(`New producer ${payload.producerId} from peer ${payload.peerId}`, payload.appData);
    }
    handleIncomingProducer(payload).catch(err => console.error('Failed to handle producer', err));
  });


  socket.on("producer-closed", ({ peerId, appData }) => {
    // 1️⃣ Compute the key like always
    const key = appData?.type === "conference"
        ? `conf-${appData.id}`
        : `user-${peerId}`;

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
  }

// ---------- Helper defined once centrally ----------
  function toKey(rawId) {
    // Always treat the raw ID as a string
    const id = String(rawId);

    // Already a fully qualified key?
    if (id.startsWith("user-") || id.startsWith("conf-")) {
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
    console.log("[DEBUG] toggleMute mit key:", key, "Consumers:", consumers);

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
      console.warn(`Kein aktiver Consumer für ${key}, mute wird vorgemerkt.`);
    }

    // Update icon and list entry
    const elSelector   = `#${key}`;
    const iconSelector = key.startsWith("conf-")
        ? `${elSelector} .conf-icon`
        : `${elSelector} .user-icon`;

    document.querySelector(elSelector)?.classList.toggle("muted", mutedPeers.has(key));
    document.querySelector(iconSelector)?.classList.toggle("muted", mutedPeers.has(key));
  }


  // target = null               → broadcast to everyone
  // target = { type: "user", id: "<userId>" }
  // target = { type: "conf", id: "<confId>" }
  async function handleTalk(e, target) {
    e.preventDefault();
    if (producer) return;

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
        appData: target
            ? { type: target.type, id: target.id }
            : { type: 'global' },
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
      if (target) {
        const selector = target.type === "user"
            ? `#user-${target.id}`
            : `#conf-${target.id}`;
        document.querySelector(selector)?.classList.add("talking-to");
      }
    } catch (err) {
      console.error("Mikrofon-Fehler:", err);
      alert("Fehler beim Starten des Mikrofons: " + err.message);
      btnAll.classList.remove("active");
      isTalking = false;
      if (micTrack) {
        micTrack.enabled = false;
      }
      scheduleMicCleanup();
    }
  }



  // Event handler for the "All" button
  btnAll.addEventListener("pointerdown", e => {
    e.preventDefault();
    if (producer) return;             // cancel if already talking
    btnAll.classList.add("active");   // highlight the button itself
    handleTalk(e, null);              // null → broadcast to everyone
  });
  btnAll.addEventListener("pointerup",   handleStopTalking);
  btnAll.addEventListener("pointerleave", handleStopTalking);
  btnAll.addEventListener("pointercancel",handleStopTalking);

  function stopHoldTalking() {
    handleStopTalking({
      preventDefault() {},
      currentTarget: btnHold,
    });
  }

  function startHoldTalking(event) {
    event?.preventDefault?.();
    btnHold.classList.add("active");
    handleTalk(event ?? { preventDefault() {} }, null);
  }

  btnHold.addEventListener("pointerdown", e => {
    if (btnHold.classList.contains("active")) {
      e.preventDefault();
      handleStopTalking(e);
    } else {
      startHoldTalking(e);
    }
  });

  btnHold.addEventListener("keydown", e => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (btnHold.classList.contains("active")) {
      stopHoldTalking();
    } else {
      startHoldTalking({ preventDefault() {} });
    }
  });

  btnHold.addEventListener("click", e => e.preventDefault());


  btnReply.addEventListener("pointerdown", e => {
    e.preventDefault();
    if (!lastTarget) return;
    btnReply.classList.add("active");
    handleTalk(e, { type: lastTarget.type, id: lastTarget.id });
  });

  btnReply.addEventListener("pointerup", handleStopTalking);
  btnReply.addEventListener("pointerleave", handleStopTalking);
  btnReply.addEventListener("pointercancel", handleStopTalking);

  function handleStopTalking(e) {
    e.preventDefault();

    // Ignore events while HOLD is active unless the HOLD button fired them
    // to keep the mode engaged even if other controls emit pointerleave
    if (btnHold.classList.contains("active") && e.currentTarget !== btnHold) {
      return;
    }

    isTalking = false;

    // Reset button states
    btnAll.classList.remove("active");
    btnHold.classList.remove("active");
    // Reply button only needs clearing if no reply is active
    btnReply.classList.remove("active");


    if (!producer) return;

    socket.emit("producer-close", { producerId: producer.id });
    producer.close();
    producer = null;

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
