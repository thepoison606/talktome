const socket = io();

socket.onAny((event, ...args) => {
  console.log("[socket.onAny] got event", event, args);
});

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res.json();
}


document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded, initializing...");

  // 🔒 Check ob mediasoup-client geladen wurde
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
  const targetsList = document.getElementById("targets-list");
  const btnAll = document.getElementById("talk-all");
  const btnReply = document.getElementById("reply");
  const audioStreamsDiv = document.getElementById("audio-streams");
  const peerConsumers = new Map();

  // MediaSoup Variablen
  let device, sendTransport, recvTransport, producer;
  const consumers = new Map();
  const audioElements = new Map();
  const speakingPeers = new Set();
  const lastSpokePeers = new Map();
  const mutedPeers = new Set();
  let currentTargetPeer = null;
  let lastSpeaker = null;
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

    // 1️⃣ User-Targets (nur, wenn Datenbank-ID matcht und online)
    for (const { socketId, userId, name } of users) {
      // 2️⃣ auch hier casten
      if (!userTargetIds.has(Number(userId)) || socketId === socket.id) continue;

      const li = document.createElement("li");
      li.id = `user-${socketId}`;
      li.classList.add("target-item", "user-target");

      // Icon & Label
      const icon = document.createElement("div");
      icon.className = "user-icon";
      icon.textContent = name
          ? name.charAt(0).toUpperCase()
          : socketId.substr(0, 2);

      const label = document.createElement("span");
      label.textContent = name || socketId;

      li.append(icon, label);

      // ——— Mute-Button ———
      const muteBtn = document.createElement("button");
      muteBtn.className = "mute-btn";
      muteBtn.textContent = "Mute";
      muteBtn.title = "Stummschalten";
      muteBtn.addEventListener("pointerdown", e => e.stopPropagation());
      muteBtn.addEventListener("click", e => {
        e.stopPropagation();
        toggleMute(socketId);
        const muted = muteBtn.classList.toggle("muted");
        muteBtn.textContent = muted ? "Unmute" : "Mute";
        icon.classList.toggle("muted", muted);
      });
      li.appendChild(muteBtn);

      // ——— Push-to-Talk ———
      ["down", "up", "leave", "cancel"].forEach(ev => {
        li.addEventListener(`pointer${ev}`, e => {
          if (e.target.closest(".mute-btn")) return;
          if (ev === "down") handleTalk(e, { type: "user", id: socketId });
          else handleStopTalking(e);
        });
      });

      list.appendChild(li);
    }

    // 2️⃣ Conference-Targets (immer anzeigen)
    for (const { targetId: id, name } of confTargets) {
      const li = document.createElement("li");
      li.id = `conf-${id}`;
      li.classList.add("target-item", "conf-target");

      // Icon & Label
      const icon = document.createElement("div");
      icon.className = "conf-icon";
      icon.textContent = "📡";

      const label = document.createElement("span");
      label.textContent = name;

      li.append(icon, label);

      // Mute-Button
      const muteBtn = document.createElement("button");
      muteBtn.className = "mute-btn";
      muteBtn.textContent = "Mute";
      muteBtn.title = "Stummschalten";
      muteBtn.addEventListener("pointerdown", e => e.stopPropagation());
      muteBtn.addEventListener("click", e => {
        e.stopPropagation();
        toggleMute(id);
        const muted = muteBtn.classList.toggle("muted");
        muteBtn.textContent = muted ? "Unmute" : "Mute";
        icon.classList.toggle("muted", muted);
      });
      li.appendChild(muteBtn);

      // Push-to-Talk
      ["down", "up", "leave", "cancel"].forEach(ev => {
        li.addEventListener(`pointer${ev}`, e => {
          if (e.target.closest(".mute-btn")) return;
          if (ev === "down") handleTalk(e, { type: "conference", id });
          else handleStopTalking(e);
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
    // Falls rawId schon ein fertiger Key ist:
    if (rawId.startsWith?.("user-") || rawId.startsWith?.("conf-")) return rawId;
    return `user-${rawId}`;                            // Socket → DOM-Key
  }

  socket.on("new-producer", async ({ peerId, producerId, appData }) => {
    console.log(`New producer ${producerId} from peer ${peerId}`);

    // ---------- Key bestimmen ----------
    const key = toKey(peerId, appData);               // "user-…" oder "conf-…"

    // Skip our own producers
    if (peerId === socket.id) return;

    // Optionales Server-Flag: Ist der Stream nur für einen bestimmten Peer?
    const targetPeer = appData?.targetPeer;
    if (targetPeer && targetPeer !== socket.id) {
      console.log("Producer not for us, skipping");
      return;
    }

    try {
      // ---------- Highlight an ----------
      speakingPeers.add(key);
      updateSpeakerHighlight(key, true);

      // ---------- Consumer anlegen ----------
      const consumeParams = await new Promise((resolve) => {
        socket.emit(
            "consume",
            { producerId, rtpCapabilities: device.rtpCapabilities },
            resolve
        );
      });

      if (consumeParams.error) throw new Error(consumeParams.error);

      const consumer = await recvTransport.consume(consumeParams);
      consumers.set(consumer.id, { consumer, key });

      // Map nach Key für sofortiges Muten
      (peerConsumers.get(key) ??= new Set()).add(consumer);

      // Sofort muten, falls Key bereits stumm
      if (mutedPeers.has(key)) consumer.pause();

      // ---------- Audio-Element ----------
      const audio = document.createElement("audio");
      audio.srcObject = new MediaStream([consumer.track]);
      audio.autoplay  = true;
      audio.volume    = mutedPeers.has(key) ? 0 : 1.0;

      audioStreamsDiv.appendChild(audio);
      audioElements.set(consumer.id, { audio, key });

      // Autoplay-Fallback
      try {
        await audio.play();
        console.log("✓ Audio playback started");
      } catch (playErr) {
        console.warn("Autoplay failed:", playErr);
        if (!document.getElementById("enable-audio-btn")) {
          const btn = document.createElement("button");
          btn.id = "enable-audio-btn";
          btn.textContent = "Please click to enable audio";
          Object.assign(btn.style, {
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 1000,
            background: "#ff9800",
            padding: "100px 100px"
          });
          btn.onclick = async () => {
            for (const a of audioStreamsDiv.querySelectorAll("audio")) {
              try { await a.play(); } catch {}
            }
            btn.remove();
          };
          document.body.appendChild(btn);
        }
      }

      // ---------- Consumer starten ----------
      await new Promise((res) => {
        socket.emit("resume-consumer", { consumerId: consumer.id }, res);
      });

      // ---------- Cleanup ----------
      consumer.on("producerclose", () => {
        console.log(`Producer closed for consumer ${consumer.id}`);
        speakingPeers.delete(key);
        updateSpeakerHighlight(key, false);

        const aData = audioElements.get(consumer.id);
        if (aData) {
          aData.audio.remove();
          audioElements.delete(consumer.id);
        }
        peerConsumers.get(key)?.delete(consumer);
        consumers.delete(consumer.id);
      });
    } catch (err) {
      console.error("Error consuming:", err);
    }
  });


  socket.on("producer-closed", ({ peerId, appData }) => {
    const key = makeKey(appData, peerId);     // appData jetzt mitsenden!
    updateSpeakerHighlight(key, false);
  });


  // Update speaker highlight
  function updateSpeakerHighlight(targetKey, isSpeaking) {
    const el   = document.getElementById(targetKey);
    if (!el) return;

    const icon = el.querySelector(
        targetKey.startsWith("conf-") ? ".conf-icon" : ".user-icon"
    );

    if (isSpeaking) {
      el.classList.add("speaking");
      el.classList.remove("last-spoke");
      icon?.classList.add("speaking");
    } else {
      el.classList.remove("speaking");
      icon?.classList.remove("speaking");

      // 1) Setze lastSpeaker und aktiviere Reply-Button
      lastSpeaker = peerId;
      if (peerId !== socket.id) {
        btnReply.disabled = false;
      }

      // 2) Markiere als letzte Stimme
      document
        .querySelectorAll(".last-spoke")
        .forEach((el) => el.classList.remove("last-spoke"));
      userEl.classList.add("last-spoke");

      // 3) Nach 20s wieder aufräumen
      setTimeout(() => {
        if (!speakingPeers.has(peerId)) {
          userEl.classList.remove("last-spoke");
          // Button ggf. wieder deaktivieren
          if (lastSpeaker === peerId) {
            lastSpeaker = null;
            btnReply.disabled = true;
          }
        }
      }, 20000);
    }
  }

// ---------- Hilfsfunktion einmal zentral definieren ----------
  function toKey(rawId) {
    // Ist es schon ein fertiger Key?
    if (rawId.startsWith("user-") || rawId.startsWith("conf-")) return rawId;
    // Konferenz-IDs sind rein numerisch → alles andere ist Socket-ID
    return isFinite(rawId) ? `conf-${rawId}` : `user-${rawId}`;
  }

// ---------- Toggle mute ----------
  function toggleMute(rawId) {
    const key     = toKey(rawId);                 // "user-<socket>" oder "conf-<id>"
    const isMuted = mutedPeers.has(key);

    // Mute-Status umschalten
    if (isMuted) mutedPeers.delete(key);
    else         mutedPeers.add(key);

    // Alle Consumer dieses Keys ansprechen
    const consumers = peerConsumers.get(key);
    if (consumers) {
      consumers.forEach((c) => {
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
    if (producer) return; // schon sprechender Producer? abbrechen

    isTalking = true;
    currentTarget = target;

    try {
      // Mikrofon holen
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      const track = stream.getAudioTracks()[0];

      // Producer-Parameter
      const params = { track };
      if (target) {
        // für einen einzelnen User
        // target = { type: "user", id: userId }
        // oder für eine Konferenz:
        // target = { type: "conf", id: confId }
        params.appData = { type: target.type, id: target.id };
      }

      // Produktion starten
      const newProducer = await sendTransport.produce(params);

      // Falls Button inzwischen losgelassen wurde
      if (!isTalking) {
        newProducer.close();
        track.stop();
        return;
      }

      // Zustand übernehmen & UI aktualisieren
      producer = newProducer;
      btnAll.classList.toggle("active", target === null);
      btnReply.classList.toggle("active", target !== null);

      // Visuelles Feedback: speaking-to
      if (target) {
        const selector = target.type === "user"
            ? `#user-${target.id}`
            : `#conf-${target.id}`;
        document.querySelector(selector)?.classList.add("talking-to");
      }
    } catch (err) {
      console.error("Mikrofon-Fehler:", err);
      alert("Fehler beim Starten des Mikrofons: " + err.message);
      // UI zurücksetzen
      isTalking = false;
      btnAll.classList.remove("active");
      btnReply.classList.remove("active");
    }
  }



  // Event-Handler für die Buttons:
  btnAll.addEventListener("pointerdown", e => handleTalk(e, { type: "global", id: "broadcast" }));
  btnAll.addEventListener("pointerup", handleStopTalking);
  btnAll.addEventListener("pointerleave", handleStopTalking);
  btnAll.addEventListener("pointercancel", handleStopTalking);

  btnReply.addEventListener("pointerdown", e => {
    e.preventDefault();
    if (!lastSpeaker) return;
    handleTalk(e, lastSpeaker);
  });

  btnReply.addEventListener("pointerup", handleStopTalking);
  btnReply.addEventListener("pointerleave", handleStopTalking);
  btnReply.addEventListener("pointercancel", handleStopTalking);

  function handleStopTalking(e) {
    e.preventDefault();
    isTalking = false;

    // 1) UI: Active-Klassen immer entfernen
    btnAll.classList.remove("active");
    btnReply.classList.remove("active");

    // 2) Wenn kein Producer existiert, beenden
    if (!producer) return;

    console.log("Stopping audio");

    // 3) Server informieren, damit er den Producer schließt
    socket.emit("producer-close", { producerId: producer.id });

    // 4) Lokal den Producer stoppen
    producer.close();
    producer.track.stop();
    producer = null;

    // 5) UI: „talking-to“ entfernen
    if (currentTarget) {
      const selector = currentTarget.type === "user"
          ? `#user-${currentTarget.id}`
          : `#conf-${currentTarget.id}`;
      const el = document.querySelector(selector);
      if (el) el.classList.remove("talking-to");
    }

    currentTarget = null;
  }

  // Initial connection check
  console.log("Socket connected?", socket.connected);
});