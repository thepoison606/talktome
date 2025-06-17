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
  const usersList = document.getElementById("users");
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
    socket.emit("register-name", userName);
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

      socket.emit("register-name", user.name);

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
    myIdEl.textContent = `${localStorage.getItem("userName")}`;

    // Initialize MediaSoup immediately after connection
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

  socket.on("user-list", async (users) => {
    // 1️⃣ fetch your allowed targets and build a Set of their IDs
    const dbUserId = localStorage.getItem("userId");
    const targets = await fetchJSON(`/users/${dbUserId}/targets`);
    const allowedNames = new Set(targets.map(t => t.name));

    console.log("Received full user-list:", users);
    console.log("Filtering to only targets:", Array.from(allowedNames));

    // 2️⃣ clear out the old list
    usersList.innerHTML = "";

    // 3️⃣ only show peers that are both connected AND in your target list
    for (const { id, name } of users) {
      // skip yourself
      if (id === socket.id) continue;
      // skip anyone not in allowedIds
      if (!allowedNames.has(name)) continue;

      const li = document.createElement("li");
      li.id = `user-${id}`;
      li.className = id === socket.id ? "you" : "";

      // user info
      const userInfo = document.createElement("div");
      userInfo.className = "user-info";

      const icon = document.createElement("div");
      icon.className = "user-icon";
      icon.textContent = name
          ? name.charAt(0).toUpperCase()
          : id.substring(0, 2).toUpperCase();

      const label = document.createElement("span");
      label.textContent = name || id;

      userInfo.append(icon, label);
      li.appendChild(userInfo);

      // build the mute & push-to-talk controls if it's not you
      if (id !== socket.id) {
        const muteBtn = document.createElement("button");
        muteBtn.className = "mute-btn";
        muteBtn.textContent = "Mute";
        muteBtn.title = "Stummschalten";
        muteBtn.addEventListener("pointerdown", e => e.stopPropagation());
        muteBtn.addEventListener("pointerup",   e => e.stopPropagation());
        muteBtn.addEventListener("click", e => {
          e.stopPropagation();
          toggleMute(id);
          muteBtn.classList.toggle("muted");
          muteBtn.textContent = muteBtn.classList.contains("muted")
              ? "Muted"
              : "Mute";
          muteBtn.title = muteBtn.classList.contains("muted")
              ? "Ton einschalten"
              : "Stummschalten";
        });
        li.appendChild(muteBtn);

        // push-to-talk
        ["down","up","leave","cancel"].forEach(ev => {
          li.addEventListener(`pointer${ev}`, e => {
            if (e.target.closest(".mute-btn")) return;
            if (ev === "down") return handleTalk(e, id);
            else                  return handleStopTalking(e);
          });
        });
      }

      usersList.appendChild(li);

      // restore any speaking/muted highlights
      if (speakingPeers.has(id)) {
        li.classList.add("speaking");
        icon.classList.add("speaking");
      }
      if (lastSpokePeers.has(id) && !speakingPeers.has(id)) {
        li.classList.add("last-spoke");
      }
      if (mutedPeers.has(id)) {
        const mb = li.querySelector(".mute-btn");
        if (mb) {
          mb.classList.add("muted");
          mb.textContent = "Muted";
          icon.classList.add("muted");
        }
      }
    }
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

      sendTransport.on("produce", async (parameters, callback, errback) => {
        try {
          const response = await new Promise((resolve) => {
            socket.emit(
              "produce",
              {
                kind: parameters.kind,
                rtpParameters: parameters.rtpParameters,
                appData: { targetPeer: currentTargetPeer }, // Send target info
              },
              resolve
            );
          });
          callback({ id: response.id });
        } catch (error) {
          errback(error);
        }
      });

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
  socket.on("new-producer", async ({ peerId, producerId, appData }) => {
    console.log(`New producer ${producerId} from peer ${peerId}`);

    // Skip our own producers
    if (peerId === socket.id) return;

    // Check if this producer is meant for us (or for all)
    const targetPeer = appData?.targetPeer;
    if (targetPeer && targetPeer !== socket.id) {
      console.log("Producer not for us, skipping");
      return;
    }

    try {
      // Add speaker to list and highlight
      speakingPeers.add(peerId);
      updateSpeakerHighlight(peerId, true);

      // Consume the audio
      const consumeParams = await new Promise((resolve) => {
        socket.emit(
          "consume",
          {
            producerId,
            rtpCapabilities: device.rtpCapabilities,
          },
          resolve
        );
      });

      if (consumeParams.error) {
        console.warn("Consumer konnte nicht erzeugt werden für", peerId);
        throw new Error(consumeParams.error);
      }

      const consumer = await recvTransport.consume(consumeParams);
      consumers.set(consumer.id, { consumer, peerId });

      // Speichern des Consumers nach peerId für sofortiges Muten
      if (!peerConsumers.has(peerId)) {
        peerConsumers.set(peerId, new Set());
      }
      peerConsumers.get(peerId).add(consumer);

      if (mutedPeers.has(peerId)) {
        consumer.pause();
      }

      // Create hidden audio element
      const audio = document.createElement("audio");
      audio.srcObject = new MediaStream([consumer.track]);
      audio.autoplay = true;
      audio.volume = mutedPeers.has(peerId) ? 0 : 1.0;

      // Add to hidden container
      audioStreamsDiv.appendChild(audio);
      audioElements.set(consumer.id, { audio, peerId });

      // Try to play
      try {
        await audio.play();
        console.log("✓ Audio playback started");
      } catch (playError) {
        console.warn("Autoplay failed:", playError);
        // Create a hidden play button that the user needs to click once
        if (!document.getElementById("enable-audio-btn")) {
          const enableBtn = document.createElement("button");
          enableBtn.id = "enable-audio-btn";
          enableBtn.textContent = "Please click to enable audio";
          enableBtn.style.position = "fixed";
          enableBtn.style.top = "50%";
          enableBtn.style.left = "50%";
          enableBtn.style.transform = "translate(-50%, -50%)";
          enableBtn.style.zIndex = "1000";
          enableBtn.style.background = "#ff9800";
          enableBtn.style.padding = "100px 100px";
          enableBtn.onclick = async () => {
            // Try to play all audio elements
            const audioEls = audioStreamsDiv.querySelectorAll("audio");
            for (const a of audioEls) {
              try {
                await a.play();
              } catch (e) {
                console.error("Play failed:", e);
              }
            }
            enableBtn.remove();
          };
          document.body.appendChild(enableBtn);
        }
      }

      // Resume consumer
      await new Promise((resolve) => {
        socket.emit("resume-consumer", { consumerId: consumer.id }, resolve);
      });

      // Monitor when producer closes
      consumer.on("producerclose", () => {
        console.log(`Producer closed for consumer ${consumer.id}`);
        speakingPeers.delete(peerId);
        updateSpeakerHighlight(peerId, false);
        // Clean up
        const audioData = audioElements.get(consumer.id);
        if (audioData) {
          audioData.audio.remove();
          audioElements.delete(consumer.id);
        }
        consumers.delete(consumer.id);
      });
    } catch (err) {
      console.error("Error consuming:", err);
    }
  });

  socket.on("producer-closed", ({ peerId }) => {
    console.log(`Producer von ${peerId} geschlossen – entferne .speaking`);
    updateSpeakerHighlight(peerId, false);
  });

  // Update speaker highlight
  function updateSpeakerHighlight(peerId, isSpeaking) {
    const userEl = document.getElementById(`user-${peerId}`);
    if (!userEl) return;
    const icon = userEl.querySelector(".user-icon");

    if (isSpeaking) {
      // Jemand spricht gerade
      userEl.classList.add("speaking");
      userEl.classList.remove("last-spoke");
      if (icon) icon.classList.add("speaking");
    } else {
      // Jemand hat aufgehört zu sprechen
      userEl.classList.remove("speaking");
      if (icon) icon.classList.remove("speaking");

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

  // Toggle mute for a peer
  function toggleMute(peerId) {
    const isMuted = mutedPeers.has(peerId);

    if (isMuted) {
      mutedPeers.delete(peerId);
    } else {
      mutedPeers.add(peerId);
    }

    // Neue Variante: direkt alle aktiven consumer pro Peer ansprechen
    const consumers = peerConsumers.get(peerId);
    if (consumers) {
      consumers.forEach((consumer) => {
        if (!consumer?.pause || !consumer?.resume) return;

        if (mutedPeers.has(peerId)) {
          consumer.pause(); // Ton sofort stoppen
        } else {
          consumer.resume(); // Ton sofort aktivieren
        }
      });
    } else {
      console.warn(
        `Kein aktiver Consumer für ${peerId}, mute wird vorgemerkt.`
      );
    }

    // Icon updaten
    const icon = document.querySelector(`#user-${peerId} .user-icon`);
    if (icon) {
      icon.classList.toggle("muted", mutedPeers.has(peerId));
    }
  }

  // Gemeinsame Push-to-Talk-Funktion
  async function handleTalk(e, targetPeer) {
    e.preventDefault();
    if (producer) return; // schon sprechender Producer? abbrechen

    isTalking = true; // Flag: Button gedrückt
    currentTargetPeer = targetPeer;

    try {
      // 1) Mikrofon holen
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const track = stream.getAudioTracks()[0];

      // 2) Gemeinsam produzieren, evtl. mit Ziel-Info
      const params = { track };
      if (targetPeer) params.appData = { targetPeer };
      const newProducer = await sendTransport.produce(params);

      // 3) Abbruch, wenn Button schon losgelassen
      if (!isTalking) {
        newProducer.close();
        track.stop();
        return;
      }

      // 4) Übernehmen & UI aktualisieren
      producer = newProducer;
      if (targetPeer === null) {
        btnAll.classList.add("active");
      } else {
        btnReply.classList.add("active");
        const el = document.getElementById(`user-${targetPeer}`);
        if (el) el.classList.add("talking-to");
      }
    } catch (err) {
      console.error("Mikrofon-Fehler:", err);
      alert("Mikrofon-Fehler: " + err.message);
      // UI zurücksetzen
      isTalking = false;
      btnAll.classList.remove("active");
      btnReply.classList.remove("active");
    }
  }

  // Event-Handler für die Buttons:
  btnAll.addEventListener("pointerdown", (e) => handleTalk(e, null));
  btnAll.addEventListener("pointerup", handleStopTalking);
  btnAll.addEventListener("pointerleave", handleStopTalking);
  btnAll.addEventListener("pointercancel", handleStopTalking);

  btnReply.addEventListener("pointerdown", (e) => {
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
    if (currentTargetPeer) {
      const userEl = document.getElementById(`user-${currentTargetPeer}`);
      if (userEl) userEl.classList.remove("talking-to");
    }
    currentTargetPeer = null;
  }

  // Initial connection check
  console.log("Socket connected?", socket.connected);
});
