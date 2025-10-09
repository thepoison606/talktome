const express = require("express");
const https = require("https");
const fs = require("fs");
const path = require("path");
const socketIO = require("socket.io");
const bcrypt = require("bcrypt");
const os = require("os");
const dgram = require("dgram");

const workerName = process.platform === "win32" ? "mediasoup-worker.exe" : "mediasoup-worker";

// 1) Find the mediasoup entry file (instead of package.json)
const mediasoupEntry = require.resolve("mediasoup");

// 2) Walk up to the package root (where package.json lives)
let mediasoupPkgDir = path.dirname(mediasoupEntry);
const root = path.parse(mediasoupPkgDir).root;
while (
  !fs.existsSync(path.join(mediasoupPkgDir, "package.json")) &&
  mediasoupPkgDir !== root
) {
  mediasoupPkgDir = path.dirname(mediasoupPkgDir);
}

// 3) Build the default worker path (without "node")
let workerBin = path.join(mediasoupPkgDir, "worker", "out", "Release", workerName);

// 4) Legacy fallback for the old ".../node/worker/..." layout
if (!fs.existsSync(workerBin)) {
  const legacyBin = path.join(mediasoupPkgDir, "node", "worker", "out", "Release", workerName);
  if (fs.existsSync(legacyBin)) {
    workerBin = legacyBin;
  }
}

// 5) pkg bundle: copy the binary into a writable folder
if (process.pkg) {
  const dest = path.join(process.cwd(), workerName);
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(workerBin, dest);
    fs.chmodSync(dest, 0o755);
  }
  workerBin = dest;
}

// 6) Set the path (must happen before the first mediasoup require)
process.env.MEDIASOUP_WORKER_BIN = workerBin;

// 7) Fail fast with a clear error if the binary is missing
if (!fs.existsSync(process.env.MEDIASOUP_WORKER_BIN)) {
  throw new Error(
    `mediasoup worker binary not found at: ${process.env.MEDIASOUP_WORKER_BIN}\n` +
    `Expected: node_modules/mediasoup/worker/out/Release/${workerName}`
  );
}

const mediasoup = require("mediasoup");


const {
  createUser,
  createConference,
  addUserToConference,
  removeUserFromConference,
  updateUserName,
  updateConferenceName,
  updateUserPassword,
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
  removeUserTarget,
  updateUserTargetOrder,
  getAllConferenceId
} = require("./dbHandler");

const app = express();
app.use(express.json());

// HTTPS port (defaults to 443)
const HTTPS_PORT = parseInt(process.env.PORT || process.env.HTTPS_PORT || "443", 10);
const mdnsHostname = normalizeHostname(
  process.env.MDNS_HOST ||
  process.env.MDNS_NAME ||
  process.env.INTERCOM_HOSTNAME ||
  "intercom.local"
);

let mdnsSocket = null;

const HTTP_PORT = (() => {
  const explicitPort = parseOptionalPort(process.env.HTTP_PORT);
  if (explicitPort !== null) {
    return explicitPort;
  }
  if (mdnsHostname) {
    return 80;
  }
  return null;
})();
const httpPortSource = process.env.HTTP_PORT ? "explicit" : (HTTP_PORT !== null ? "auto" : "disabled");

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
    } else if (targetType === 'conference') {
      addUserTargetToConference(req.params.id, targetId);
    } else {
      return res.status(400).json({ error: 'Unsupported target type' });
    }
    notifyTargetChange(req.params.id);
    res.sendStatus(204);
  } catch (err) {
    console.error('Error in add-target:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/users/:id/targets/order', (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items) {
    return res.status(400).json({ error: 'items array required' });
  }

  const normalized = items.map(item => ({
    targetType: item?.targetType,
    targetId: Number(item?.targetId),
  }));

  const validTypes = ['user', 'conference'];
  if (normalized.some(item => !validTypes.includes(item.targetType))) {
    return res.status(400).json({ error: 'Invalid target type' });
  }

  if (normalized.some(item => Number.isNaN(item.targetId))) {
    return res.status(400).json({ error: 'Invalid target id' });
  }

  try {
    updateUserTargetOrder(req.params.id, normalized);
    notifyTargetChange(req.params.id);
    res.sendStatus(204);
  } catch (err) {
    console.error('Failed to update target order:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/users/:id/talk', (req, res) => {
  let { action, targetType = 'conference', targetId = null, mode = 'list' } = req.body || {};

  if (!['press', 'release'].includes(action)) {
    return res.status(400).json({ error: 'action must be press or release' });
  }

  const allConferenceId = getAllConferenceId();

  if (targetType === 'global' || targetType === 'all') {
    targetType = 'conference';
    targetId = allConferenceId;
  }

  if (targetType === 'conference' && (targetId === null || targetId === undefined)) {
    targetId = allConferenceId;
  }

  if (targetType === 'conference' && (targetId === null || targetId === undefined)) {
    return res.status(500).json({ error: 'All conference not configured' });
  }

  if (targetType === 'conference' && targetId != null) {
    targetId = Number(targetId);
    if (!Number.isFinite(targetId)) {
      return res.status(400).json({ error: 'Invalid conference id' });
    }
  }

  const uid = String(req.params.id);
  const payload = { action, targetType, targetId, mode };

  let delivered = false;
  for (const [, peer] of peers) {
    if (String(peer.userId) === uid) {
      peer.socket.emit('api-talk-command', payload);
      delivered = true;
    }
  }

  if (!delivered) {
    return res.status(404).json({ error: 'user not connected' });
  }

  res.sendStatus(202);
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

app.put('/users/:id/password', (req, res) => {
  const { password } = req.body;

  if (typeof password !== 'string' || password.trim().length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters long' });
  }

  try {
    const updated = updateUserPassword(req.params.id, password.trim());
    if (!updated) return res.status(404).json({ error: 'User not found' });
    res.sendStatus(204);
  } catch (err) {
    console.error('Error updating password:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Rename conference
app.put('/conferences/:id', (req, res) => {
  const { name } = req.body;
  const allId = getAllConferenceId();
  if (allId !== null && Number(req.params.id) === Number(allId)) {
    return res.status(400).json({ error: "Cannot rename the All conference" });
  }
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
  const allId = getAllConferenceId();
  if (allId !== null && Number(req.params.conferenceId) === Number(allId)) {
    return res.status(400).json({ error: "Cannot remove users from the All conference" });
  }
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
  const allId = getAllConferenceId();
  if (allId !== null && Number(req.params.id) === Number(allId)) {
    return res.status(400).json({ error: "Cannot delete the All conference" });
  }
  try {
    deleteConference(req.params.id);
    res.sendStatus(204);
  } catch (err) {
    res.status(500).json({ error: "Failed to delete conference" });
  }
});

app.delete("/users/:id/targets/:type/:tid", (req, res) => {
  const allId = getAllConferenceId();
  if (req.params.type === 'conference' && allId !== null && Number(req.params.tid) === Number(allId)) {
    return res.status(400).json({ error: "Cannot remove the All conference from targets" });
  }
  try {
    removeUserTarget(req.params.id, req.params.type, req.params.tid);
    notifyTargetChange(req.params.id);
    res.sendStatus(204);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function notifyTargetChange(userId) {
  const idStr = String(userId);
  for (const [, peer] of peers) {
    if (String(peer.userId) === idStr) {
      peer.socket.emit('user-targets-updated');
    }
  }
}


// Create a self-signed certificate if none exists yet
// When running inside `pkg` the bundled directory is read-only
// so we keep the certificates relative to the current working directory
const certDir = path.join(process.cwd(), "certs");
if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
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

  console.log(`[CUT-CAMERA] Request for user: ${user}`);
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

function normalizeHostname(value) {
  if (!value) return null;
  const trimmed = String(value).trim().toLowerCase().replace(/\.+$/, "");
  if (!trimmed) return null;
  return trimmed.endsWith(".local") ? trimmed : `${trimmed}.local`;
}

function parseOptionalPort(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed || trimmed === "false" || trimmed === "off" || trimmed === "no") {
    return null;
  }

  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.warn(`[HTTP] Ignoring invalid HTTP_PORT value: ${value}`);
    return null;
  }

  return port;
}

function getLocalIPv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (!net || net.internal) continue;
      if (net.family === "IPv4") {
        addresses.push(net.address);
      }
    }
  }

  if (addresses.length === 0) {
    addresses.push("127.0.0.1");
  }

  return addresses;
}

function encodeDnsName(name) {
  const labels = name.split(".").filter(Boolean);
  const parts = [];

  for (const label of labels) {
    const buf = Buffer.from(label, "utf8");
    const len = Buffer.alloc(1);
    len[0] = buf.length;
    parts.push(len, buf);
  }

  parts.push(Buffer.from([0x00]));
  return Buffer.concat(parts);
}

function decodeDnsName(buffer, offset, depth = 0) {
  if (depth > 10 || offset >= buffer.length) {
    return null;
  }

  const labels = [];
  let idx = offset;

  while (idx < buffer.length) {
    const len = buffer[idx];

    if (len === 0) {
      idx += 1;
      return { name: labels.join("."), nextOffset: idx };
    }

    if ((len & 0xc0) === 0xc0) {
      if (idx + 1 >= buffer.length) {
        return null;
      }

      const pointer = ((len & 0x3f) << 8) | buffer[idx + 1];
      const result = decodeDnsName(buffer, pointer, depth + 1);
      if (!result) {
        return null;
      }

      const pointerLabels = result.name ? result.name.split(".") : [];
      const combined = labels.concat(pointerLabels.filter(Boolean));
      return { name: combined.join("."), nextOffset: idx + 2 };
    }

    const end = idx + 1 + len;
    if (end > buffer.length) {
      return null;
    }

    labels.push(buffer.toString("utf8", idx + 1, end));
    idx = end;
  }

  return null;
}

function startMdnsResponder(hostname) {
  const questionName = hostname.toLowerCase();
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const CLASS_IN = 0x0001;
  const TYPE_A = 0x0001;
  const TYPE_ANY = 0x00ff;

  socket.on("error", (err) => {
    console.warn(`[mDNS] ${err.message}`);
    try {
      socket.close();
    } catch (closeErr) {
      console.warn(`[mDNS] Failed to close socket: ${closeErr.message}`);
    }
  });

  socket.on("message", (message, rinfo) => {
    if (message.length < 12) {
      return;
    }

    const flags = message.readUInt16BE(2);
    const isQuery = (flags & 0x8000) === 0;
    if (!isQuery) {
      return;
    }

    const qdCount = message.readUInt16BE(4);
    if (!qdCount) {
      return;
    }

    let offset = 12;
    for (let i = 0; i < qdCount; i += 1) {
      const decoded = decodeDnsName(message, offset);
      if (!decoded) {
        return;
      }

      const { name, nextOffset } = decoded;
      offset = nextOffset;

      if (offset + 4 > message.length) {
        return;
      }

      const type = message.readUInt16BE(offset);
      offset += 2;
      const qclass = message.readUInt16BE(offset);
      offset += 2;

      const normalizedName = name.toLowerCase().replace(/\.$/, "");
      if (normalizedName !== questionName) {
        continue;
      }

      if (type !== TYPE_A && type !== TYPE_ANY) {
        continue;
      }

      const addresses = getLocalIPv4Addresses();
      if (!addresses.length) {
        return;
      }

      const wantsUnicast = (qclass & 0x8000) !== 0;
      const nameBuf = encodeDnsName(questionName);

      const header = Buffer.alloc(12);
      header.writeUInt16BE(0x0000, 0); // ID must be 0 for mDNS
      header.writeUInt16BE(0x8400, 2); // standard response, authoritative
      header.writeUInt16BE(1, 4); // one question echoed back
      header.writeUInt16BE(addresses.length, 6); // number of answers
      header.writeUInt16BE(0, 8); // no NS records
      header.writeUInt16BE(0, 10); // no additional records

      const question = Buffer.alloc(nameBuf.length + 4);
      nameBuf.copy(question);
      question.writeUInt16BE(type, nameBuf.length);
      question.writeUInt16BE(qclass & 0x7fff, nameBuf.length + 2);

      const answers = [];
      for (const address of addresses) {
        const octets = address.split(".").map((part) => Number(part));
        if (octets.length !== 4 || octets.some((num) => Number.isNaN(num))) {
          continue;
        }

        const data = Buffer.from(octets);
        const answer = Buffer.alloc(nameBuf.length + 10 + data.length);
        nameBuf.copy(answer);
        let idx = nameBuf.length;
        answer.writeUInt16BE(TYPE_A, idx);
        idx += 2;
        answer.writeUInt16BE(CLASS_IN | 0x8000, idx); // cache flush bit + IN
        idx += 2;
        answer.writeUInt32BE(120, idx); // TTL 120 seconds
        idx += 4;
        answer.writeUInt16BE(data.length, idx);
        idx += 2;
        data.copy(answer, idx);
        answers.push(answer);
      }

      if (!answers.length) {
        return;
      }

      const response = Buffer.concat([header, question, ...answers]);
      const targetPort = wantsUnicast ? rinfo.port : 5353;
      const targetAddress = wantsUnicast ? rinfo.address : "224.0.0.251";

      socket.send(response, targetPort, targetAddress, (err) => {
        if (err) {
          console.warn(`[mDNS] Failed to send response: ${err.message}`);
        }
      });

      break;
    }
  });

  socket.bind({ address: "0.0.0.0", port: 5353, exclusive: false }, () => {
    try {
      socket.addMembership("224.0.0.251");
    } catch (err) {
      console.warn(`[mDNS] Unable to join multicast group: ${err.message}`);
    }
    socket.setMulticastTTL(255);
    socket.setMulticastLoopback(true);
    console.log(`[mDNS] Advertising ${questionName} on ${getLocalIPv4Addresses().join(", ")}`);
  });

  return socket;
}

// Optional HTTP → HTTPS redirect server
const http = require("http");
if (HTTP_PORT !== null) {
  const redirectServer = http.createServer((req, res) => {
    const headerHost = req.headers.host?.replace(/:.*/, "");
    const host = headerHost || mdnsHostname || "localhost";
    res.writeHead(301, {
      Location: `https://${host}:${HTTPS_PORT}${req.url}`,
    });
    res.end();
  });

  redirectServer.listen(HTTP_PORT, () => {
    const sourceLabel = httpPortSource === "auto" ? "(auto for mDNS)" : "";
    console.log(`HTTP redirect server running on port ${HTTP_PORT} ${sourceLabel}`.trim());
  });

  redirectServer.on("error", (err) => {
    if (err.code === "EACCES") {
      console.warn(`Failed to start HTTP redirect server on ${HTTP_PORT}: ${err.message}. Run with elevated privileges or set HTTP_PORT to a high port.`);
    } else {
      console.warn(`Failed to start HTTP redirect server on ${HTTP_PORT}: ${err.message}`);
    }
  });
}

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
    userId: peer.userId || null,    // store the database ID here
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

    peer.userId = id;    // the actual database ID
    peer.name   = name;  // display name
    console.log(`[USER] Registered ${name} (${id}) on socket ${socket.id}`);

    socket.emit("cut-camera", name === cutCameraUser);

    // Broadcast the refreshed list to every client
    io.emit("user-list", getUserList());
  });

  socket.on("request-active-producers", (callback = () => {}) => {
    const peer = peers.get(socket.id);
    if (!peer || !peer.userId) {
      return callback([]);
    }

    const response = [];
    let conferenceIds = null;

    const loadConferenceIds = () => {
      if (conferenceIds !== null) {
        return conferenceIds;
      }
      if (!peer.userId) {
        conferenceIds = new Set();
        return conferenceIds;
      }
      const memberships = getConferencesForUser(peer.userId) || [];
      conferenceIds = new Set(
        memberships.map((conf) => String(conf.id))
      );
      return conferenceIds;
    };

    for (const [otherSocketId, otherPeer] of peers) {
      if (otherSocketId === socket.id) continue;

      for (const [producerId, producer] of otherPeer.producers) {
        const appData = producer?.appData;
        if (!appData || typeof appData !== "object") continue;

        if (appData.type === "conference") {
          const confId = appData.id;
          if (confId == null) continue;
          const membership = loadConferenceIds();
          if (membership.has(String(confId))) {
            response.push({ peerId: otherSocketId, producerId, appData });
          }
          continue;
        }

        if (appData.type === "user") {
          const targetPeerId = appData.targetPeer || appData.id;
          if (targetPeerId && targetPeerId === socket.id) {
            response.push({ peerId: otherSocketId, producerId, appData });
          }
        }
      }
    }

    callback(response);
  });

  socket.on("producer-close", ({ producerId }) => {
    console.log(
        `[SIGNAL] producer-close received from client ${socket.id} for producer ${producerId}`
    );

    const peer     = peers.get(socket.id);
    const producer = peer?.producers.get(producerId);
    if (!producer) {
      console.warn(`[SIGNAL] No producer found with ID ${producerId}.`);
      return;
    }

    // Read the appData so the client knows which tile it was
    const { appData } = producer;

    // 2. Close the producer and clean up internal state
    producer.close();
    peer.producers.delete(producerId);

    // 3. Broadcast to all other clients immediately, including appData
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

      // Send the updated list afterwards
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
        // 0️⃣  Validate incoming data
        //------------------------------------------------------------------
        const { type, id: targetId } = appData || {};
        const validTypes = ["user","conference"];

        if (
            !type ||
            !validTypes.includes(type) ||
            !targetId
        ) {
          console.warn("[PRODUCE] Invalid appData:", appData);
          return callback({
            error:
                "Invalid appData: For 'user' and 'conference', 'id' must be provided.",
          });
        }

        try {
          //----------------------------------------------------------------
          // 1️⃣  Create the producer
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
          // 2️⃣  Send the ID back to the client
          //----------------------------------------------------------------
          callback({ id: producer.id });

          //----------------------------------------------------------------
          // 3️⃣  Routing
          //----------------------------------------------------------------
          if (type === "user") {
            // 🎯 Direct target (socket ID)
            const targetPeer = peers.get(targetId);
            if (targetPeer?.userId) {
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
            // 👥 Conference: notify every participant
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
          //----------------------------------------------------------------
          // 4️⃣  Cleanup listener
          //----------------------------------------------------------------
          producer.appData = appData;  // store once

          producer.on("close", () => {
            peer.producers.delete(producer.id);
            socket.broadcast.emit("producer-closed", {
              peerId:     socket.id,
              producerId: producer.id,
              appData     // included now
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

server.listen(HTTPS_PORT, () => {
  console.log(`🔒 HTTPS Server running on port ${HTTPS_PORT}`);
  console.log(`📍 Access via: https://YOUR-IP:${HTTPS_PORT}`);
  console.log(`🛠️ Administration via: https://YOUR-IP:${HTTPS_PORT}/admin.html`);
  console.log("");
  console.log("⚠️  Browsers will show a certificate warning.");
  console.log('   Click "Advanced" → "Proceed to site" to continue.');
  console.log("");
  if (mdnsHostname) {
    try {
      if (!mdnsSocket) {
        mdnsSocket = startMdnsResponder(mdnsHostname);
      }
      console.log(`📡 mDNS alias: https://${mdnsHostname}:${HTTPS_PORT}`);
    } catch (err) {
      console.warn(`[mDNS] Failed to advertise ${mdnsHostname}: ${err.message}`);
    }
  } else {
    console.log("📡 mDNS alias disabled (no hostname configured)");
  }
  if (!process.env.PUBLIC_IP) {
    console.log("💡 For external access, set PUBLIC_IP environment variable:");
    console.log("   PUBLIC_IP=YOUR.PUBLIC.IP node server-https.js");
  }
});
