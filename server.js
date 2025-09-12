const express = require("express");
const https = require("https");
const fs = require("fs");
const path = require("path");
const socketIO = require("socket.io");
const mediasoup = require("mediasoup");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");

const {
  createUser,
  createConference,
  addUserToConference,
  removeUserFromConference,
  updateUserName,
  updateConferenceName,
  getUsersForConference,
  getConferencesForUser,
  getAllUsers,
  getAllConferences,
  deleteUser,
  deleteConference,
  verifyUser,
  getUserTargets,
  addUserTargetToUser,
  addUserTargetToConference,
  removeUserTarget
} = require("./dbHandler");

const app = express();
app.use(express.json());

// Track the user whose camera is currently "cut"
let cutCameraUser = null;

// === GET ===
app.get("/users", (req, res) => {
  res.json(getAllUsers());
});

app.get("/conferences", (req, res) => {
  res.json(getAllConferences());
});

app.get("/users/:id/conferences", (req, res) => {
  try {
    const conferences = getConferencesForUser(req.params.id);
    res.json(conferences);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get('/conferences/:id/users', (req, res) => {
  const confId = req.params.id;
  console.log(`[DEBUG] GET /conferences/${confId}/users → looking up in DB…`);
  try {
    const users = getUsersForConference(confId);
    console.log(`[DEBUG]  → found users:`, users);
    res.json(users);
  } catch (err) {
    console.error(`[ERROR] fetching users for conference ${confId}:`, err);
    res.status(500).json({ error: err.message });
  }
});


app.get('/users/:id/targets', (req, res) => {
  try {
    const targets = getUserTargets(req.params.id);
    res.json(targets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === POST ===
app.post("/login", (req, res) => {
  console.log("trying to login");
  const { name, password } = req.body;

  try {
    const user = verifyUser(name, password);
    if (!user) {
      console.warn("Login failed for:", name);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    console.log("Login successful for:", user.name);
    res.json({ id: user.id, name: user.name });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/users", (req, res) => {
  const { name, password } = req.body;
  try {
    const id = createUser(name, password);
    res.json({ id });
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Username already exists" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

app.post("/conferences", (req, res) => {
  const { name } = req.body;
  try {
    const id = createConference(name);
    res.json({ id });
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Conference name already exists" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

app.post('/conferences/:conferenceId/users/:userId', (req, res) => {
  addUserToConference(req.params.userId, req.params.conferenceId);
  res.sendStatus(204);
});


app.post('/users/:id/targets', (req, res) => {
  const { targetType, targetId } = req.body;
  try {
    if (targetType === 'user') {
      addUserTargetToUser(req.params.id, targetId);
    } else {
      addUserTargetToConference(req.params.id, targetId);
    }
    res.sendStatus(204);
  } catch (err) {
    console.error('Fehler in add‐target:', err);
    res.status(500).json({ error: err.message });
  }
});

// === PUT ===
app.put("/users/:id", (req, res) => {
  const { name } = req.body;
  try {
    const success = updateUserName(req.params.id, name);
    if (!success) return res.status(404).json({ error: "User not found" });
    res.sendStatus(204);
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Username already exists" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Rename conference
app.put('/conferences/:id', (req, res) => {
  const { name } = req.body;
  try {
    const success = updateConferenceName(req.params.id, name);
    if (!success) return res.status(404).json({ error: 'Conference not found' });
    res.sendStatus(204);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      res.status(409).json({ error: 'Conference name already exists' });
    } else {
      console.error('Error renaming conference:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});


// === DELETE (specific routes FIRST) ===
app.delete("/conferences/:conferenceId/users/:userId", (req, res) => {
  try {
    removeUserFromConference(req.params.userId, req.params.conferenceId);
    res.sendStatus(204);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete user (generic)
app.delete("/users/:id", (req, res) => {
  try {
    deleteUser(req.params.id);
    res.sendStatus(204);
  } catch (err) {
    res.status(500).json({ error: "Failed to delete user" });
  }
});

// Delete conference (generic)
app.delete("/conferences/:id", (req, res) => {
  try {
    deleteConference(req.params.id);
    res.sendStatus(204);
  } catch (err) {
    res.status(500).json({ error: "Failed to delete conference" });
  }
});

app.delete("/users/:id/targets/:type/:tid", (req, res) => {
  try {
    removeUserTarget(req.params.id, req.params.type, req.params.tid);
    res.sendStatus(204);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Erstelle selbst-signiertes Zertifikat falls nicht vorhanden
const certDir = path.join(__dirname, "certs");
if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir);
  console.log("⚠️  Bitte erstellen Sie SSL-Zertifikate:");
  console.log("   cd certs");
  console.log(
    "   openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes"
  );
  console.log("   cd ..");
  process.exit(1);
}

// HTTPS Server Setup
const httpsOptions = {
  key: fs.readFileSync(path.join(certDir, "key.pem")),
  cert: fs.readFileSync(path.join(certDir, "cert.pem")),
};

const server = https.createServer(httpsOptions, app);
const io = socketIO(server);

app.post("/cut-camera", (req, res) => {
  const { user } = req.body;
  if (typeof user !== "string") {
    return res.status(400).json({ error: "user must be provided" });
  }

  // empty string disables all highlights
  cutCameraUser = user.trim() || null;

  for (const peer of peers.values()) {
    peer.socket.emit("cut-camera", peer.name === cutCameraUser);
  }

  res.json({ user: cutCameraUser });
});

app.use(express.static("public"));
app.use("/node_modules", express.static("node_modules"));

app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

// Redirect HTTP to HTTPS
const http = require("http");
http
  .createServer((req, res) => {
    res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
    res.end();
  })
  .listen(80, () => {
    console.log("HTTP redirect server running on port 80");
  });

let worker, router;
const peers = new Map();

(async () => {
  console.log("[INIT] Starting mediasoup worker");
  worker = await mediasoup.createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
    logLevel: "warn",
    logTags: ["info", "ice", "dtls", "rtp", "srtp", "rtcp"],
  });
  console.log("[INIT] Worker created with PID:", worker.pid);
  console.log("[INIT] RTC ports: 40000-49999");

  router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
      },
    ],
  });
  console.log("[INIT] Router created");
})();

function getUserList() {
  return Array.from(peers.entries()).map(([socketId, peer]) => ({
    socketId,
    userId: peer.userId || null,    // <-- hier speichern wir die DB-ID
    name: peer.name || null
  }));
}

io.on("connection", (socket) => {
  console.log(`[CONN] Client connected: ${socket.id}`);
  peers.set(socket.id, {
    socket,
    userId:   null,
    name:     null,
    consumers: new Map(),
    producers: new Map(),
  });

  // Emit lists
  io.emit("user-list", getUserList());
  socket.emit("conference-list", getAllConferences());

  socket.on("register-user", ({ id, name }) => {
    const peer = peers.get(socket.id);
    if (!peer) return;

    peer.userId = id;    // die echte DB-ID
    peer.name   = name;  // Anzeigename
    console.log(`[USER] Registered ${name} (${id}) on socket ${socket.id}`);

    socket.emit("cut-camera", name === cutCameraUser);

    // Aktualisierte Liste an alle Clients schicken
    io.emit("user-list", getUserList());
  });

  socket.on("producer-close", ({ producerId }) => {
    console.log(
        `[SIGNAL] producer-close von Client ${socket.id} erhalten für Producer ${producerId}`
    );

    const peer     = peers.get(socket.id);
    const producer = peer?.producers.get(producerId);
    if (!producer) {
      console.warn(`[SIGNAL] Kein Producer mit ID ${producerId} gefunden.`);
      return;
    }

    // AppData mitlesen, damit der Client weiß, welche Kachel es war
    const { appData } = producer;

    // 2. Producer schließen und internen Zustand aufräumen
    producer.close();
    peer.producers.delete(producerId);

    // 3. Broadcast sofort an alle anderen Clients, inkl. appData
    socket.broadcast.emit("producer-closed", {
      peerId:     socket.id,
      producerId,
      appData
    });

    console.log(`[SIGNAL] producer-closed an alle anderen gesendet`);
  });


  socket.on("register-name", (name) => {
    const peer = peers.get(socket.id);
    if (peer) {
      peer.name = name;
      console.log(`[USER] Registered name for ${socket.id}: ${name}`);

      // Danach aktualisierte Liste senden
      io.emit("user-list", getUserList());
    }
  });

  // Send RTP capabilities on request
  socket.on("get-router-rtp-capabilities", (callback) => {
    if (!router) {
      console.warn("[RTP] Router not ready yet – rejecting request");
      return callback({ error: "Router not initialized, try again" });
    }
    callback(router.rtpCapabilities);
  });

  socket.on("create-send-transport", async (_, callback) => {
    console.log(`[TRANSPORT] Client ${socket.id} requests send transport`);
    try {
      // Auto-detect network interfaces if PUBLIC_IP not set
      const os = require("os");
      let announcedIp = process.env.PUBLIC_IP;

      if (!announcedIp) {
        const networkInterfaces = os.networkInterfaces();
        for (const name of Object.keys(networkInterfaces)) {
          for (const iface of networkInterfaces[name]) {
            if (iface.family === "IPv4" && !iface.internal) {
              announcedIp = iface.address;
              console.log(
                `[TRANSPORT] Auto-detected IP: ${announcedIp} (${name})`
              );
              break;
            }
          }
          if (announcedIp) break;
        }
      }

      console.log(`[TRANSPORT] Using announced IP: ${announcedIp}`);

      const transport = await router.createWebRtcTransport({
        listenIps: [
          {
            ip: "0.0.0.0",
            announcedIp: announcedIp,
          },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        // Additional debugging
        enableSctp: false,
        numSctpStreams: { OS: 0, MIS: 0 },
        initialAvailableOutgoingBitrate: 600000,
      });

      peers.get(socket.id).sendTransport = transport;
      console.log(`[TRANSPORT] Send transport created: ${transport.id}`);
      console.log(`[TRANSPORT] ICE Candidates:`, transport.iceCandidates);

      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
    } catch (error) {
      console.error("[TRANSPORT] Error creating send transport:", error);
      callback({ error: error.message });
    }
  });

  socket.on("create-recv-transport", async (_, callback) => {
    console.log(`[TRANSPORT] Client ${socket.id} requests recv transport`);
    try {
      // Use same IP detection as send transport
      const os = require("os");
      let announcedIp = process.env.PUBLIC_IP;

      if (!announcedIp) {
        const networkInterfaces = os.networkInterfaces();
        for (const name of Object.keys(networkInterfaces)) {
          for (const iface of networkInterfaces[name]) {
            if (iface.family === "IPv4" && !iface.internal) {
              announcedIp = iface.address;
              break;
            }
          }
          if (announcedIp) break;
        }
      }

      console.log(`[TRANSPORT] Using announced IP: ${announcedIp}`);

      const transport = await router.createWebRtcTransport({
        listenIps: [
          {
            ip: "0.0.0.0",
            announcedIp: announcedIp,
          },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        enableSctp: false,
        numSctpStreams: { OS: 0, MIS: 0 },
        initialAvailableOutgoingBitrate: 600000,
      });

      peers.get(socket.id).recvTransport = transport;
      console.log(`[TRANSPORT] Recv transport created: ${transport.id}`);
      console.log(`[TRANSPORT] ICE Candidates:`, transport.iceCandidates);

      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
    } catch (error) {
      console.error("[TRANSPORT] Error creating recv transport:", error);
      callback({ error: error.message });
    }
  });

  socket.on("connect-send-transport", async ({ dtlsParameters }, callback) => {
    console.log(`[CONNECT] Client ${socket.id} connecting send transport`);
    try {
      const transport = peers.get(socket.id).sendTransport;
      await transport.connect({ dtlsParameters });
      console.log(`[CONNECT] Send transport connected for ${socket.id}`);
      callback();
    } catch (error) {
      console.error("[CONNECT] Error:", error);
      callback({ error: error.message });
    }
  });

  socket.on("connect-recv-transport", async ({ dtlsParameters }, callback) => {
    console.log(`[CONNECT] Client ${socket.id} connecting recv transport`);
    try {
      const transport = peers.get(socket.id).recvTransport;
      await transport.connect({ dtlsParameters });
      console.log(`[CONNECT] Recv transport connected for ${socket.id}`);
      callback();
    } catch (error) {
      console.error("[CONNECT] Error:", error);
      callback({ error: error.message });
    }
  });

  socket.on(
      "produce",
      async ({ kind, rtpParameters, appData }, callback) => {
        console.log(
            `[PRODUCE] Client ${socket.id} wants to produce ${kind}`,
            appData
        );

        //------------------------------------------------------------------
        // 0️⃣  Eingehende Daten validieren
        //------------------------------------------------------------------
        const { type, id: targetId } = appData || {};
        const validTypes = ["user","conference","global"];

// global braucht kein targetId, user/conference aber schon
        if (
            !type ||
            !validTypes.includes(type) ||
            (type !== "global" && !targetId)
        ) {
          console.warn("[PRODUCE] Ungültiges appData:", appData);
          return callback({
            error:
                "Ungültiges appData: Für 'user' und 'conference' muss 'id' gesetzt sein, " +
                "für 'global' genügt { type: 'global' }",
          });
        }

        try {
          //----------------------------------------------------------------
          // 1️⃣  Producer anlegen
          //----------------------------------------------------------------
          const peer = peers.get(socket.id);
          const transport = peer.sendTransport;

          const producer = await transport.produce({
            kind,
            rtpParameters,
            appData,
          });

          peer.producers.set(producer.id, producer);
          console.log(
              `[PRODUCE] Producer created: ${producer.id} for ${socket.id}`
          );

          //----------------------------------------------------------------
          // 2️⃣  ID an den Client zurück
          //----------------------------------------------------------------
          callback({ id: producer.id });

          //----------------------------------------------------------------
          // 3️⃣  Routing
          //----------------------------------------------------------------
          if (type === "user") {
            // 🎯 Direktziel (Socket-ID)
            const targetPeer = peers.get(targetId);
            if (targetPeer) {
              targetPeer.socket.emit("new-producer", {
                peerId: socket.id,
                producerId: producer.id,
                appData,
              });
              console.log(`[ROUTE] Sent to user ${targetId}`);
            } else {
              console.warn(`[ROUTE] User ${targetId} not connected`);
            }
          } else if (type === "conference") {
            // 👥 Konferenz: alle Teilnehmer benachrichtigen
            const members = getUsersForConference(targetId); // [{ id, name }, …]

            for (const member of members) {
              for (const [sid, p] of peers) {
                if (String(p.userId) === String(member.id) && sid !== socket.id) {
                  p.socket.emit("new-producer", {
                    peerId: socket.id,
                    producerId: producer.id,
                    appData,
                  });
                }
              }
            }
            console.log(`[ROUTE] Sent to conference ${targetId}`);
          }
          else if (type === "global") {
            for (const [sid, p] of peers) {
              if (sid !== socket.id) {
                p.socket.emit("new-producer", {
                  peerId: socket.id,
                  producerId: producer.id,
                  appData
                });
              }
            }
            console.log("[ROUTE] Sent to ALL via global broadcast");
          }


          //----------------------------------------------------------------
          // 4️⃣  Cleanup-Listener
          //----------------------------------------------------------------
          producer.appData = appData;  // einmalig speichern

          producer.on("close", () => {
            peer.producers.delete(producer.id);
            socket.broadcast.emit("producer-closed", {
              peerId:     socket.id,
              producerId: producer.id,
              appData     // jetzt mit
            });
          });


          producer.on("transportclose", () => {
            peer.producers.delete(producer.id);
          });
        } catch (error) {
          console.error("[PRODUCE] Error:", error);
          callback({ error: error.message });
        }
      }
  );




  socket.on("consume", async ({ producerId, rtpCapabilities }, callback) => {
    console.log(
      `[CONSUME] Client ${socket.id} wants to consume producer ${producerId}`
    );

    try {
      // Find the producer
      let producerPeer = null;
      for (const [peerId, peer] of peers) {
        if (peer.producers.has(producerId)) {
          producerPeer = peerId;
          break;
        }
      }

      if (!producerPeer) {
        throw new Error("Producer not found");
      }

      console.log(`[CONSUME] Found producer from peer ${producerPeer}`);

      if (!router.canConsume({ producerId, rtpCapabilities })) {
        throw new Error("Cannot consume");
      }

      const transport = peers.get(socket.id).recvTransport;
      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });

      peers.get(socket.id).consumers.set(consumer.id, consumer);
      console.log(
        `[CONSUME] Consumer created: ${consumer.id} for ${socket.id}`
      );

      consumer.on("transportclose", () => {
        console.log(`[CONSUME] Consumer transport closed for ${consumer.id}`);
        peers.get(socket.id)?.consumers.delete(consumer.id);
      });

      consumer.on("producerclose", () => {
        console.log(`[CONSUME] Producer closed for consumer ${consumer.id}`);
        socket.emit("consumer-closed", { consumerId: consumer.id });
        peers.get(socket.id)?.consumers.delete(consumer.id);
      });

      callback({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (error) {
      console.error("[CONSUME] Error:", error);
      callback({ error: error.message });
    }
  });

  socket.on("resume-consumer", async ({ consumerId }, callback) => {
    console.log(`[RESUME] Client ${socket.id} resuming consumer ${consumerId}`);
    try {
      const consumer = peers.get(socket.id)?.consumers.get(consumerId);
      if (consumer) {
        await consumer.resume();
        console.log(`[RESUME] Consumer ${consumerId} resumed`);
      }
      callback();
    } catch (error) {
      console.error("[RESUME] Error:", error);
      callback({ error: error.message });
    }
  });

  socket.on("disconnect", () => {
    console.log(`[CONN] Client disconnected: ${socket.id}`);
    const peer = peers.get(socket.id);

    if (peer) {
      // Close all producers
      for (const producer of peer.producers.values()) {
        producer.close();
      }
      console.log(
        `[CLEANUP] ${peer.producers.size} producers closed for ${socket.id}`
      );

      // Close transports
      if (peer.sendTransport) {
        peer.sendTransport.close();
        console.log(`[CLEANUP] Send transport closed for ${socket.id}`);
      }
      if (peer.recvTransport) {
        peer.recvTransport.close();
        console.log(`[CLEANUP] Recv transport closed for ${socket.id}`);
      }

      // Close consumers
      peer.consumers.forEach((c) => c.close());
      console.log(
        `[CLEANUP] ${peer.consumers.size} consumers closed for ${socket.id}`
      );
    }

    peers.delete(socket.id);
    io.emit("user-list", Array.from(peers.keys()));
  });
});

const PORT = process.env.PORT || 443;
server.listen(PORT, () => {
  console.log(`🔒 HTTPS Server running on port ${PORT}`);
  console.log(`📍 Access via: https://YOUR-IP:${PORT}`);
  console.log(`🛠️ Administration via: https://YOUR-IP:${PORT}/admin.html`);
  console.log("");
  console.log("⚠️  Browsers will show a certificate warning.");
  console.log('   Click "Advanced" → "Proceed to site" to continue.');
  console.log("");
  if (!process.env.PUBLIC_IP) {
    console.log("💡 For external access, set PUBLIC_IP environment variable:");
    console.log("   PUBLIC_IP=YOUR.PUBLIC.IP node server-https.js");
  }
});
