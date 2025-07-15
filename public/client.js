const socket = io();
const defaultVolume = 0.85;

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

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded, initializing...");

  // Check ob mediasoup-client geladen wurde
  if (typeof mediasoupClient === "undefined") {
    console.error("mediasoup-client not loaded!");
    alert("MediaSoup Client konnte nicht geladen werden!");
    return;
  }
  console.log("mediasoup-client version:", mediasoupClient.version);

  // DOM Elemente
  const loginForm = document.getElementById("login-form");
  const loginContainer = document.getElementById("login-container");
  const intercomApp = document.getElementById("intercom-app");
  const loginError = document.getElementById("login-error");
  const logoutBtn = document.getElementById("logout-btn");

  const myIdEl = document.getElementById("my-id");
  const btnAll = document.getElementById("talk-all");
  const btnReply = document.getElementById("reply");
  const audioStreamsDiv = document.getElementById("audio-streams");
  const peerConsumers = new Map();

  // MediaSoup Variablen
  let device, sendTransport, recvTransport, producer;
  const audioElements = new Map();
  const confAudioElements = new Map();
  const speakingPeers = new Set();
  const lastSpokePeers = new Map();
  const mutedPeers = new Set();
  let currentTargetPeer = null;
  let lastTarget = null;
  let isTalking = false;

  // Auto-Login prüfen
  const userId = localStorage.getItem("userId");
  const userName = localStorage.getItem("userName");

  if (userId && userName) {
    console.log("Auto-login as:", userName);
    loginContainer.style.display = "none";
    intercomApp.style.display = "block";
    myIdEl.textContent = userName;
    socket.emit("register-user", { id: userId, name: userName });
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

      // Speichern für Auto-Login
      localStorage.setItem("userId", user.id);
      localStorage.setItem("userName", user.name);

      socket.emit("register-user", { id: user.id, name: user.name });

      loginContainer.style.display = "none";
      intercomApp.style.display = "block";
      myIdEl.textContent = user.name;
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
    await initializeMediaSoup();
  });

  socket.on("disconnect", () => {
    console.log("Disconnected from server");
    myIdEl.textContent = "Getrennt";
    btnAll.disabled = true;
    // Disable all user buttons
    document
      .querySelectorAll(".talk-user")
      .forEach((btn) => (btn.disabled = true));
  });

  socket.on("user-list", async users => {
    const dbUserId    = localStorage.getItem("userId");
    const targets     = await fetchJSON(`/users/${dbUserId}/targets`);

    // Erlaubte User-IDs (db-) und Conference-Ziele trennen
    const userTargetIds = new Set(
        targets
            .filter(t => t.targetType === "user")
            .map(t => Number(t.targetId))
    );
    const confTargets = targets.filter(t => t.targetType === "conference");

    const list = document.getElementById("targets-list");
    list.innerHTML = ""; // Liste leeren

    // 1️⃣ User-Targets
    for (const { socketId, userId, name } of users) {
      if (!userTargetIds.has(Number(userId)) || socketId === socket.id) continue;

      const li = document.createElement("li");
      li.id = `user-${socketId}`;
      li.classList.add("target-item", "user-target");

      // Icon & Label
      const icon = document.createElement("div");
      icon.className = "user-icon";
      icon.textContent = name ? name.charAt(0).toUpperCase() : socketId.slice(0,2);
      const label = document.createElement("span");
      label.textContent = name || socketId;
      li.append(icon, label);

      // ——— Lautstärke-Slider für User ———
      const userKey = `volume_user_${socketId}`;
      const volSlider = document.createElement("input");
      volSlider.type  = "range";
      volSlider.min   = "0";
      volSlider.max   = "1";
      volSlider.step  = "0.01";
      // aus sessionStorage laden oder default
      volSlider.value = getStoredVolume(userKey).toString();
      volSlider.className = "volume-slider";
      volSlider.title     = "Source Volume";
      // bei jeder Änderung in sessionStorage sichern
      volSlider.addEventListener("input", e => {
        const vol = parseFloat(e.target.value);
        const entry = audioElements.get(socketId);
        if (entry?.audio) entry.audio.volume = vol;
        storeVolume(userKey, vol);
      });
      li.appendChild(volSlider);

      // ——— Mute-Button für User ———
      const userMuteBtn = document.createElement("button");
      userMuteBtn.className = "mute-btn";
      userMuteBtn.textContent = mutedPeers.has(`user-${socketId}`) ? "Unmute" : "Mute";
      userMuteBtn.title = "Stummschalten";
      userMuteBtn.addEventListener("pointerdown", e => e.stopPropagation());
      userMuteBtn.addEventListener("click", e => {
        e.stopPropagation();
        const key = `user-${socketId}`;
        toggleMute(socketId);
        const nowMuted = mutedPeers.has(key);
        userMuteBtn.textContent = nowMuted ? "Unmute" : "Mute";
        userMuteBtn.classList.toggle("muted", nowMuted);
      });
      li.appendChild(userMuteBtn);

      // ——— Push-to-Talk ———
      ["down", "up", "leave", "cancel"].forEach(ev => {
        li.addEventListener(`pointer${ev}`, e => {
          if (e.target.closest(".mute-btn") || e.target === volSlider) return;
          if (ev === "down")   handleTalk(e, { type: "user", id: socketId });
          else                  handleStopTalking(e);
        });
      });

      list.appendChild(li);
    }

// 2️⃣ Conference-Targets
    for (const { targetId: id, name } of confTargets) {
      const key = `conf-${id}`; // unser DOM-Key

      const li = document.createElement("li");
      li.id = key;
      li.classList.add("target-item", "conf-target");

      // Icon & Label
      const icon = document.createElement("div");
      icon.className = "conf-icon";
      icon.textContent = "📡";
      const label = document.createElement("span");
      label.textContent = name;
      li.append(icon, label);

      // Volume-Slider for Conference
      const confKey = `volume_conf_${id}`;
      const confSlider = document.createElement("input");
      confSlider.type  = "range";
      confSlider.min   = "0";
      confSlider.max   = "1";
      confSlider.step  = "0.01";
      // initial aus sessionStorage
      confSlider.value = getStoredVolume(confKey).toString();
      confSlider.className = "volume-slider";
      confSlider.title     = "Conference Volume";
      confSlider.addEventListener("input", e => {
        const vol = parseFloat(e.target.value);
        const audios = confAudioElements.get(id);
        if (audios) {
          audios.forEach(a => a.volume = vol);
        }
        storeVolume(confKey, vol);
      });
      li.appendChild(confSlider);

      // Mute-Button für Conference
      const confMuteBtn = document.createElement("button");
      confMuteBtn.className = "mute-btn";
      const initiallyMuted = mutedPeers.has(key);
      confMuteBtn.textContent = initiallyMuted ? "Unmute" : "Mute";
      if (initiallyMuted) confMuteBtn.classList.add("muted");
      confMuteBtn.title = "Stummschalten";
      confMuteBtn.addEventListener("pointerdown", e => e.stopPropagation());
      confMuteBtn.addEventListener("click", e => {
        e.stopPropagation();
        toggleMute(id);
        const nowMuted = mutedPeers.has(key);
        confMuteBtn.textContent = nowMuted ? "Unmute" : "Mute";
        confMuteBtn.classList.toggle("muted", nowMuted);
      });
      li.appendChild(confMuteBtn);

      // Push-to-Talk für Conference (ignoriert Slider- und Mute-Clicks)
      ["down", "up", "leave", "cancel"].forEach(ev => {
        li.addEventListener(`pointer${ev}`, e => {
          if (
              e.target.closest(".mute-btn") ||
              e.target.closest(".volume-slider")
          ) {
            return;
          }
          if (ev === "down") {
            handleTalk(e, { type: "conference", id });
          } else {
            handleStopTalking(e);
          }
        });
      });

      list.appendChild(li);
    }

    // 3️⃣ Highlights (speaking, last-spoke, muted)
    document.querySelectorAll(".target-item").forEach(li => {
      const [type, id] = li.id.split("-");
      const icon = li.querySelector(
          type === "user" ? ".user-icon" : ".conf-icon"
      );

      const isSpeaking = speakingPeers.has(id);
      li.classList.toggle("speaking", isSpeaking);
      if (icon) icon.classList.toggle("speaking", isSpeaking);

      li.classList.toggle("last-spoke", lastSpokePeers.has(id));
      li.classList.toggle("muted", mutedPeers.has(id));
      if (icon) icon.classList.toggle("muted", mutedPeers.has(id));
    });
  });




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

      // currentTargetPeer → Socket-ID des Users, wenn du P2P reden willst.
      sendTransport.on(
          "produce",
          async ({ kind, rtpParameters, appData }, callback, errback) => {
            try {
              // App-Daten aus handleTalk() beibehalten und ggf. targetPeer ergänzen
              const mergedAppData = {
                ...appData,                     // { type: "user"/"conference", id: … }
                ...(currentTargetPeer
                    ? { targetPeer: currentTargetPeer }
                    : {})                         // nur anhängen, wenn definiert
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
      // Update all user list items to be clickable
      document.querySelectorAll("#users li:not(.you)").forEach((li) => {
        li.style.cursor = "pointer";
      });
      console.log("=== ✓ MediaSoup initialization complete! ===");
    } catch (err) {
      console.error("=== ✗ MediaSoup initialization failed ===");
      console.error("Error:", err);
      alert("Fehler bei der Initialisierung: " + err.message);
    }
  }

  // Handle new producers
// Hilfsfunktion (falls noch nicht global definiert)
  function toKey(rawId, appData) {
    if (appData?.type === "conference") return `conf-${appData.id}`;
    if (rawId.startsWith?.("user-") || rawId.startsWith?.("conf-")) return rawId;
    return `user-${rawId}`;
  }

  socket.on("new-producer", async ({ peerId, producerId, appData }) => {
    console.log(`New producer ${producerId} from peer ${peerId}`, appData);

    // Key für dieses Target
    const key = appData?.type === "conference"
        ? `conf-${appData.id}`
        : `user-${peerId}`;

    // Eigene Streams ignorieren
    if (peerId === socket.id) return;

    // Nur konsumieren, wenn für uns gedacht
    if (appData?.targetPeer && appData.targetPeer !== socket.id) {
      console.log("Producer not for us, skipping");
      return;
    }

    try {
      // Highlight einschalten
      speakingPeers.add(key);
      updateSpeakerHighlight(key, true);

      // Consumer erstellen
      const { error, ...consumeParams } = await new Promise(resolve =>
          socket.emit(
              "consume",
              { producerId, rtpCapabilities: device.rtpCapabilities },
              resolve
          )
      );
      if (error) throw new Error(error);
      const consumer = await recvTransport.consume(consumeParams);

      // Für Mute/Unmute tracken
      if (!peerConsumers.has(key)) peerConsumers.set(key, new Set());
      peerConsumers.get(key).add(consumer);
      if (mutedPeers.has(key)) consumer.pause();

      // Neuen Stream packen
      const stream = new MediaStream([consumer.track]);

      // Erstes Mal: Audio-Element anlegen & initiale Lautstärke laden
      if (!audioElements.has(peerId)) {
        const audio = document.createElement("audio");
        audio.srcObject = stream;
        audio.autoplay = true;

        // initiale Lautstärke aus sessionStorage holen
        let initVol;
        if (appData?.type === "conference") {
          const confKey = `volume_conf_${appData.id}`;
          initVol = getStoredVolume(confKey);
        } else {
          const userKey = `volume_user_${peerId}`;
          initVol = getStoredVolume(userKey);
        }
        audio.volume = initVol;

        audioStreamsDiv.appendChild(audio);
        // speichern für Folge-Events
        audioElements.set(peerId, { audio, volume: initVol });

        // Bei Conference-Streams zusätzlich in confAudioElements einsammeln
        if (appData?.type === "conference") {
          const confId = appData.id;
          if (!confAudioElements.has(confId)) {
            confAudioElements.set(confId, new Set());
          }
          confAudioElements.get(confId).add(audio);

          // Entfernen, wenn Producer schließt
          consumer.on("producerclose", () => {
            confAudioElements.get(confId)?.delete(audio);
          });
        }
      }
      // Folge-Streams: nur Track tauschen, Lautstärke belassen
      else {
        const entry = audioElements.get(peerId);
        entry.audio.srcObject = stream;
        entry.audio.volume = entry.volume;
      }

      // Autoplay versuchen
      try {
        await audioElements.get(peerId).audio.play();
      } catch {}

      // Consumer freischalten
      await new Promise(res =>
          socket.emit("resume-consumer", { consumerId: consumer.id }, res)
      );

      // Aufräumen, wenn der Producer endgültig schließt
      consumer.on("producerclose", () => {
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
      console.error("Error consuming:", err);
    }
  });


  socket.on("producer-closed", ({ peerId, appData }) => {
    // 1️⃣ Key berechnen wie immer
    const key = appData?.type === "conference"
        ? `conf-${appData.id}`
        : `user-${peerId}`;

    // 2️⃣ Nur weiter, wenn wir für diesen Key wirklich konsumiert hatten
    const consumersSet = peerConsumers.get(key);
    if (!consumersSet || consumersSet.size === 0) {
      // wir hören diesen Stream gar nicht – kein Gelb
      return;
    }

    // 3️⃣ Bereinigung aller verbliebenen Consumer
    consumersSet.forEach(c => { try { c.close(); } catch {} });
    peerConsumers.delete(key);

    // 4️⃣ speakingPeers aufräumen
    speakingPeers.delete(key);

    // 5️⃣ Last-Spoke (Gelb) setzen
    updateSpeakerHighlight(key, false);
  });


  // Update speaker highlight
  function updateSpeakerHighlight(targetKey, isSpeaking) {
    const el = document.getElementById(targetKey);
    if (!el) return;

    const iconCls = targetKey.startsWith("conf-") ? ".conf-icon" : ".user-icon";
    const icon    = el.querySelector(iconCls);

    if (isSpeaking) {
      // Sprecher läuft gerade
      el.classList.add("speaking");
      el.classList.remove("last-spoke");
      icon?.classList.add("speaking");
    } else {
      // Sprecher hat aufgehört
      el.classList.remove("speaking");
      icon?.classList.remove("speaking");

      // 1) lastTarget setzen
      if (targetKey.startsWith("conf-")) {
        lastTarget = { type: "conference", id: targetKey.slice(5) };
      } else {
        lastTarget = { type: "user", id: targetKey.slice(5) };
      }

      // Reply-Button aktivieren oder deaktivieren
      btnReply.disabled = (lastTarget.type === "user" && lastTarget.id === socket.id);

      // 2) Gelb markieren
      document.querySelectorAll(".last-spoke")
          .forEach(elem => elem.classList.remove("last-spoke"));
      el.classList.add("last-spoke");

/*      // 3) Nach 20s wieder aufräumen
      setTimeout(() => {
        if (!speakingPeers.has(targetKey)) {
          el.classList.remove("last-spoke");
          // Reply-Button zurücksetzen, falls das der letzte war
          if (lastTarget &&
              (lastTarget.type === "conference"
                  ? `conf-${lastTarget.id}` === targetKey
                  : `user-${lastTarget.id}` === targetKey)
          ) {
            lastTarget = null;
            btnReply.disabled = true;
          }
        }
      }, 20000);*/
    }
  }

// ---------- Hilfsfunktion einmal zentral definieren ----------
  function toKey(rawId) {
    // Roh-ID immer als String behandeln
    const id = String(rawId);

    // Ist es schon ein fertiger Key?
    if (id.startsWith("user-") || id.startsWith("conf-")) {
      return id;
    }

    // Konferenz-IDs sind rein numerisch → alles andere ist Socket-ID
    return isFinite(id) ? `conf-${id}` : `user-${id}`;
  }


// ---------- Toggle mute ----------
  function toggleMute(rawId) {
    // 1) Key berechnen
    const key = toKey(rawId);

    // ─── Debug hier ───────────────────────────────────────────────
    const consumers = peerConsumers.get(key);
    console.log("[DEBUG] toggleMute mit key:", key, "Consumers:", consumers);

    // 2) restliche Logik…
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

    // Icon & Listeneintrag updaten
    const elSelector   = `#${key}`;
    const iconSelector = key.startsWith("conf-")
        ? `${elSelector} .conf-icon`
        : `${elSelector} .user-icon`;

    document.querySelector(elSelector)?.classList.toggle("muted", mutedPeers.has(key));
    document.querySelector(iconSelector)?.classList.toggle("muted", mutedPeers.has(key));
  }


// target = null               → broadcast an alle
// target = { type: "user", id: "<userId>" }
// target = { type: "conf", id: "<confId>" }
  async function handleTalk(e, target) {
    e.preventDefault();
    if (producer) return;

    isTalking     = true;
    currentTarget = target;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      const track = stream.getAudioTracks()[0];

      // ◆ Producer-Parameter: immer appData mitgeben,
      //    entweder {type:'all'} oder gezielt {type:'user'|'conf',id:...}
      const params = {
        track,
        appData: target
            ? { type: target.type, id: target.id }
            : { type: 'global' }
      };

      // ◆ Produktion starten
      const newProducer = await sendTransport.produce(params);

      // ◆ Falls Button inzwischen losgelassen wurde
      if (!isTalking) {
        newProducer.close();
        track.stop();
        return;
      }

      producer = newProducer;

      // ◆ Visuelles Feedback nur für gezielte Targets
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
    }
  }



  // Event-Handler für „All“-Talk
  btnAll.addEventListener("pointerdown", e => {
    e.preventDefault();
    if (producer) return;             // abbrechen, wenn schon im Sprechen
    btnAll.classList.add("active");   // Button selber lila highlighten
    handleTalk(e, null);              // null → Broadcast an alle
  });
  btnAll.addEventListener("pointerup",   handleStopTalking);
  btnAll.addEventListener("pointerleave", handleStopTalking);
  btnAll.addEventListener("pointercancel",handleStopTalking);


  btnReply.addEventListener("pointerdown", e => {
    e.preventDefault();
    if (!lastTarget) return;
    btnReply.classList.add("active");
    handleTalk(e, lastTarget);
  });

  btnReply.addEventListener("pointerup", handleStopTalking);
  btnReply.addEventListener("pointerleave", handleStopTalking);
  btnReply.addEventListener("pointercancel", handleStopTalking);

  function handleStopTalking(e) {
    e.preventDefault();
    isTalking = false;

    // btnAll zurücksetzen
    btnAll.classList.remove("active");
    // btnReply nur zurücksetzen, wenn kein Reply im Gange ist
    btnReply.classList.remove("active");

    if (!producer) return;

    socket.emit("producer-close", { producerId: producer.id });
    producer.close();
    producer.track.stop();
    producer = null;

    // lila Highlight am <li> entfernen
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