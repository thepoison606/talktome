const express = require("express");
const https = require("https");
const fs = require("fs");
const path = require("path");
const socketIO = require("socket.io");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const os = require("os");
const dgram = require("dgram");
const selfsigned = require("selfsigned");
const { getDataDir } = require("./dataPaths");
const { ApplePttPushService } = require("./applePttPushService");

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

// 4) pkg bundle: copy the binary into a writable folder
if (process.pkg) {
  const execDir = path.dirname(process.execPath);
  const sources = [
    workerBin,
    path.join(execDir, "worker", "out", "Release", workerName),
    path.join(execDir, workerName)
  ];
  const sourceBin = sources.find((candidate) => fs.existsSync(candidate));

  if (!sourceBin) {
    throw new Error(
      `mediasoup worker binary missing from pkg bundle.\n` +
      `Checked: ${sources.join(", ")}`
    );
  }

  const dest = path.join(process.cwd(), workerName);
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(sourceBin, dest);
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
  createFeed,
  addUserToConference,
  removeUserFromConference,
  updateUserName,
  updateConferenceName,
  updateUserPassword,
  updateAdminPassword,
  getUsersForConference,
  getConferencesForUser,
  getAllUsers,
  getUserById,
  getAllConferences,
  getAllFeeds,
  deleteUser,
  deleteConference,
  deleteFeed,
  verifyUser,
  verifyFeed,
  getUserTargets,
  addUserTargetToUser,
  addUserTargetToConference,
  addUserTargetToFeed,
  removeUserTarget,
  updateUserTargetOrder,
  getAllConferenceId,
  getFeedIdsForUser,
  getUsersForFeed,
  getOrCreateApplePttChannelForUser,
  registerApplePttPushToken,
  unregisterApplePttPushToken,
  getApplePttRegistrationsForUsers,
  setUserAdminRole,
  exportDatabaseSnapshot,
  importDatabaseSnapshot
} = require("./dbHandler");

const app = express();
app.use(express.json({ limit: "10mb" }));

const execDir = path.dirname(process.execPath);
const execPublicDir = path.join(execDir, "public");
const snapshotPublicDir = path.join(__dirname, "public");
const dataDir = getDataDir();
const dataConfigPath = path.join(dataDir, "config.json");
const legacyConfigPath = path.join(__dirname, "config.json");
const legacyPkgConfigPath = path.join(execDir, "config.json");

function copyDirRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) {
    return false;
  }
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
  return true;
}

let publicDir = snapshotPublicDir;
if (process.pkg) {
  try {
    if (copyDirRecursive(snapshotPublicDir, execPublicDir)) {
      publicDir = execPublicDir;
    } else {
      console.warn(`[PUBLIC] Snapshot directory not found: ${snapshotPublicDir}`);
    }
  } catch (err) {
    console.warn(`[PUBLIC] Failed to materialize assets: ${err.message}`);
  }
}

if (!fs.existsSync(publicDir)) {
  console.warn(`[PUBLIC] Not found: ${publicDir}`);
} else if (!fs.existsSync(path.join(publicDir, "index.html"))) {
  console.warn(`[PUBLIC] Missing index.html in ${publicDir}`);
}

function getConfigPath() {
  if (!process.pkg && fs.existsSync(legacyConfigPath)) {
    return legacyConfigPath;
  }

  if (process.pkg && fs.existsSync(legacyPkgConfigPath) && !fs.existsSync(dataConfigPath)) {
    return legacyPkgConfigPath;
  }

  return dataConfigPath;
}

function loadRuntimeConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    console.warn(`[CONFIG] Failed to read ${configPath}: ${error.message}`);
    return null;
  }
}

function saveRuntimeConfig(config) {
  const configPath = getConfigPath();

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

const applePttPushService = new ApplePttPushService({
  loadConfig: loadRuntimeConfig,
  logger: console,
});

function normalizeMdnsSetting(value) {
  if (value === undefined || value === null) {
    return "intercom.local";
  }

  const trimmed = String(value).trim();
  if (!trimmed) return "intercom.local";

  const lowered = trimmed.toLowerCase();
  if (["off", "false", "no", "none", "disable", "disabled"].includes(lowered)) {
    return "off";
  }

  const normalized = normalizeHostname(trimmed);
  if (!normalized) return "intercom.local";

  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.local$/.test(normalized)) {
    return null;
  }

  return normalized;
}

app.use(express.static(publicDir));

app.get("/", (req, res) => {
  const indexPath = path.join(publicDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    return res.status(404).send("Cannot GET /");
  }
  try {
    const html = fs.readFileSync(indexPath, "utf8");
    res.type("html").send(html);
  } catch (err) {
    res.status(500).send("Failed to load index.html");
  }
});

function findSocketIoClientPath() {
  const socketIoEntry = require.resolve("socket.io");
  let socketIoPkgDir = path.dirname(socketIoEntry);
  const root = path.parse(socketIoPkgDir).root;
  while (
    !fs.existsSync(path.join(socketIoPkgDir, "package.json")) &&
    socketIoPkgDir !== root
  ) {
    socketIoPkgDir = path.dirname(socketIoPkgDir);
  }
  const candidate = path.join(socketIoPkgDir, "client-dist", "socket.io.js");
  return fs.existsSync(candidate) ? candidate : null;
}

const socketIoClientPath = findSocketIoClientPath();
if (process.pkg) {
  if (socketIoClientPath) {
    const destPath = path.join(execPublicDir, "socket.io.js");
    try {
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(socketIoClientPath, destPath);
      }
    } catch (err) {
      console.warn(`[SOCKET.IO] Failed to copy client script: ${err.message}`);
    }
  } else {
    console.warn("[SOCKET.IO] client script not found; /socket.io.js will 404");
  }
} else if (socketIoClientPath) {
  app.get("/socket.io.js", (req, res) => {
    res.sendFile(socketIoClientPath);
  });
} else {
  console.warn("[SOCKET.IO] client script not found; /socket.io.js will 404");
}

if (process.pkg) {
  app.get("/socket.io.js", (req, res) => {
    const diskPath = path.join(execPublicDir, "socket.io.js");
    if (fs.existsSync(diskPath)) {
      return res.sendFile(diskPath);
    }
    if (socketIoClientPath) {
      return res.sendFile(socketIoClientPath);
    }
    res.sendStatus(404);
  });
}

const nodeModulesDir = path.join(__dirname, "node_modules");
if (fs.existsSync(nodeModulesDir)) {
  app.use("/node_modules", express.static(nodeModulesDir));
}

const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const adminSessions = new Map();

function parseCookieHeader(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(";").forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed) return;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) return;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function getAdminSession(req) {
  const cookies = parseCookieHeader(req.headers.cookie || "");
  const token = cookies.admin_session;
  if (!token) return null;
  const session = adminSessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return null;
  }
  return { token, session };
}

function createAdminSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  adminSessions.set(token, {
    userId: user.id,
    isSuperAdmin: !!user.is_superadmin,
    createdAt: Date.now(),
    expiresAt: Date.now() + ADMIN_SESSION_TTL_MS,
  });
  return token;
}

function requireAdmin(req, res, next) {
  const result = getAdminSession(req);
  if (!result) {
    return res.status(401).json({ error: "Admin login required" });
  }
  req.adminSession = result.session;
  req.adminToken = result.token;
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.adminSession?.isSuperAdmin) {
    return res.status(403).json({ error: "Superadmin required" });
  }
  next();
}

const COMPANION_DEFAULT_WAIT_MS = 1500;
const COMPANION_MAX_WAIT_MS = 10000;
const COMPANION_PENDING_TTL_MS = 30000;
const COMPANION_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const COMPANION_DEFAULT_VOLUME_STEP = 0.1;
const COMPANION_API_KEY_FILE = path.join(getDataDir(), "companion_api_key");

const companionUserState = new Map();
const companionPendingCommands = new Map();
const companionSessions = new Map();
let companionNamespace = null;

function readCompanionApiKeyFromEnv() {
  if (typeof process.env.COMPANION_API_KEY !== "string") {
    return null;
  }
  const value = process.env.COMPANION_API_KEY.trim();
  return value.length ? value : null;
}

function loadOrCreateCompanionApiKey() {
  const envKey = readCompanionApiKeyFromEnv();
  if (envKey) {
    console.log("[COMPANION] Using API key from COMPANION_API_KEY");
    return envKey;
  }

  try {
    if (fs.existsSync(COMPANION_API_KEY_FILE)) {
      const existing = fs.readFileSync(COMPANION_API_KEY_FILE, "utf8").trim();
      if (existing) {
        console.log(`[COMPANION] Using API key from ${COMPANION_API_KEY_FILE}`);
        return existing;
      }
    }
  } catch (err) {
    console.warn(`[COMPANION] Failed to read API key file: ${err.message}`);
  }

  const generated = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(path.dirname(COMPANION_API_KEY_FILE), { recursive: true });
    fs.writeFileSync(COMPANION_API_KEY_FILE, generated, { mode: 0o600 });
    console.log(`[COMPANION] Generated API key at ${COMPANION_API_KEY_FILE}`);
  } catch (err) {
    console.warn(`[COMPANION] Failed to persist API key: ${err.message}`);
  }
  return generated;
}

const companionApiKey = loadOrCreateCompanionApiKey();

function parseBearerToken(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token || null;
}

function extractCompanionApiKeyFromRequest(req) {
  const bearer = parseBearerToken(req.get("authorization"));
  if (bearer) return bearer;

  const headerKey = req.get("x-api-key");
  if (headerKey) return String(headerKey).trim();

  if (typeof req.query?.apiKey === "string" && req.query.apiKey.trim()) {
    return req.query.apiKey.trim();
  }

  return null;
}

function extractCompanionApiKeyFromSocket(socket) {
  const authPayload = socket?.handshake?.auth || {};
  if (typeof authPayload === "object" && authPayload !== null) {
    if (typeof authPayload.apiKey === "string" && authPayload.apiKey.trim()) {
      return authPayload.apiKey.trim();
    }
    if (typeof authPayload.token === "string" && authPayload.token.trim()) {
      return authPayload.token.trim();
    }
  }

  const headers = socket?.handshake?.headers || {};
  const bearer = parseBearerToken(headers.authorization);
  if (bearer) return bearer;

  const headerKey = headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey.trim()) {
    return headerKey.trim();
  }

  const queryPayload = socket?.handshake?.query || {};
  if (typeof queryPayload.apiKey === "string" && queryPayload.apiKey.trim()) {
    return queryPayload.apiKey.trim();
  }

  return null;
}

function isValidCompanionApiKey(candidate) {
  if (typeof candidate !== "string" || !candidate) return false;
  const left = Buffer.from(candidate, "utf8");
  const right = Buffer.from(companionApiKey, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function createCompanionSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  companionSessions.set(token, {
    userId: user.id,
    userName: user.name || null,
    isAdmin: !!user.is_admin,
    isSuperadmin: !!user.is_superadmin,
    createdAt: now,
    expiresAt: now + COMPANION_SESSION_TTL_MS,
  });
  return token;
}

function getCompanionSession(token) {
  const value = typeof token === "string" ? token.trim() : "";
  if (!value) return null;
  const session = companionSessions.get(value);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    companionSessions.delete(value);
    return null;
  }
  return { token: value, session };
}

function resolveCompanionAuth(candidate) {
  if (isValidCompanionApiKey(candidate)) {
    return {
      type: "api-key",
      token: null,
      userId: null,
      userName: null,
      isAdmin: true,
      isSuperadmin: true,
    };
  }

  const sessionResult = getCompanionSession(candidate);
  if (!sessionResult) return null;
  return {
    type: "session",
    token: sessionResult.token,
    userId: sessionResult.session.userId,
    userName: sessionResult.session.userName,
    isAdmin: !!sessionResult.session.isAdmin,
    isSuperadmin: !!sessionResult.session.isSuperadmin,
  };
}

function hasCompanionGlobalAccess(auth) {
  return Boolean(auth && (auth.type === "api-key" || auth.isSuperadmin));
}

function canCompanionControlUser(auth, userId) {
  if (!auth || !Number.isFinite(Number(userId))) return false;
  if (hasCompanionGlobalAccess(auth)) return true;
  return Number(auth.userId) === Number(userId);
}

function buildCompanionAuthScope(auth) {
  if (!auth) {
    return { mode: "none", userId: null };
  }
  if (hasCompanionGlobalAccess(auth)) {
    return {
      mode: "all",
      userId: Number.isFinite(Number(auth.userId)) ? Number(auth.userId) : null,
      userName: auth.userName || null,
      isSuperadmin: !!auth.isSuperadmin,
    };
  }
  return {
    mode: "self",
    userId: Number(auth.userId),
    userName: auth.userName || null,
    isSuperadmin: false,
  };
}

function requireCompanionApiKey(req, res, next) {
  const candidate = extractCompanionApiKeyFromRequest(req);
  const auth = resolveCompanionAuth(candidate);
  if (!candidate || !auth) {
    return res.status(401).json({ error: "Companion authentication required" });
  }
  req.companionAuth = auth;
  next();
}

function normalizeCompanionTarget(target) {
  if (!target || typeof target !== "object") return null;
  const rawType = typeof target.type === "string" ? target.type.trim().toLowerCase() : "";
  if (!["user", "conference"].includes(rawType)) {
    return null;
  }
  const rawId = target.id;
  if (rawId === null || rawId === undefined || rawId === "") {
    return null;
  }
  const numeric = Number(rawId);
  const normalizedId = Number.isFinite(numeric) ? numeric : String(rawId);
  return { type: rawType, id: normalizedId };
}

function normalizeCompanionTargetAudioState(state) {
  if (!state || typeof state !== "object") return null;
  const rawType = typeof state.targetType === "string" ? state.targetType.trim().toLowerCase() : "";
  if (!["user", "conference", "feed"].includes(rawType)) {
    return null;
  }

  const targetId = Number(state.targetId);
  if (!Number.isFinite(targetId)) {
    return null;
  }

  return {
    targetType: rawType,
    targetId,
    muted: Boolean(state.muted),
  };
}

function normalizeCompanionTargetAudioStates(states) {
  if (!Array.isArray(states)) {
    return [];
  }

  const normalized = [];
  const seen = new Set();
  for (const rawState of states) {
    const state = normalizeCompanionTargetAudioState(rawState);
    if (!state) continue;
    const key = `${state.targetType}:${state.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(state);
  }

  return normalized;
}

function parseCompanionWaitMs(raw) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return COMPANION_DEFAULT_WAIT_MS;
  }
  return Math.min(COMPANION_MAX_WAIT_MS, Math.max(100, Math.round(parsed)));
}

function normalizeTalkCommandInput(input = {}) {
  let { action, targetType = "conference", targetId = null } = input || {};

  if (!["press", "release", "lock-toggle"].includes(action)) {
    return { ok: false, status: 400, error: "action must be press, release, or lock-toggle" };
  }

  const allConferenceId = getAllConferenceId();
  const normalizedType = typeof targetType === "string" ? targetType.trim().toLowerCase() : "conference";
  targetType = normalizedType;

  if (targetType === "reply") {
    targetId = undefined;
  } else {
    if (targetType === "global" || targetType === "all") {
      targetType = "conference";
      targetId = allConferenceId;
    }

    if (targetType === "conference" && (targetId === null || targetId === undefined || targetId === "")) {
      targetId = allConferenceId;
    }

    if (targetType === "conference" && (targetId === null || targetId === undefined)) {
      return { ok: false, status: 500, error: "All conference not configured" };
    }

    if (targetType === "conference" || targetType === "user") {
      const numericTargetId = Number(targetId);
      if (!Number.isFinite(numericTargetId)) {
        const errorLabel = targetType === "conference" ? "conference" : "user";
        return { ok: false, status: 400, error: `Invalid ${errorLabel} id` };
      }
      targetId = numericTargetId;
    } else {
      return { ok: false, status: 400, error: "targetType must be conference, user, reply, global, or all" };
    }
  }

  const payload = targetType === "reply"
    ? { action, targetType }
    : { action, targetType, targetId };

  return { ok: true, value: { action, targetType, targetId, payload } };
}

function normalizeTargetAudioCommandInput(input = {}) {
  let { action, targetType = "conference", targetId = null, step = COMPANION_DEFAULT_VOLUME_STEP } = input || {};

  if (!["volume-up", "volume-down", "mute-toggle"].includes(action)) {
    return {
      ok: false,
      status: 400,
      error: "action must be volume-up, volume-down, or mute-toggle",
    };
  }

  const normalizedType = typeof targetType === "string" ? targetType.trim().toLowerCase() : "conference";
  targetType = normalizedType;
  if (!["conference", "user", "feed"].includes(targetType)) {
    return { ok: false, status: 400, error: "targetType must be conference, user, or feed" };
  }

  const numericTargetId = Number(targetId);
  if (!Number.isFinite(numericTargetId)) {
    return { ok: false, status: 400, error: `Invalid ${targetType} id` };
  }
  targetId = numericTargetId;

  let normalizedStep = null;
  if (action === "volume-up" || action === "volume-down") {
    const requestedStep = Number(step);
    const safeStep = Number.isFinite(requestedStep) ? requestedStep : COMPANION_DEFAULT_VOLUME_STEP;
    normalizedStep = Math.min(1, Math.max(0.01, safeStep));
  }

  const payload = { action, targetType, targetId };
  if (normalizedStep !== null) {
    payload.step = normalizedStep;
  }

  return { ok: true, value: { action, targetType, targetId, step: normalizedStep, payload } };
}

function findUserPeerByUserId(userId) {
  const key = String(userId);
  for (const [socketId, peer] of peers) {
    if (peer?.kind === "user" && peer.userId != null && String(peer.userId) === key) {
      return { socketId, peer };
    }
  }
  return null;
}

function disconnectUserPeerForLogout({ userId = null, socketId = null } = {}) {
  const normalizedUserId = Number(userId);
  const normalizedSocketId =
    typeof socketId === "string" && socketId.trim() ? socketId.trim() : null;

  let target = null;
  if (normalizedSocketId) {
    const peer = peers.get(normalizedSocketId);
    if (
      peer &&
      peer.kind === "user" &&
      Number.isFinite(normalizedUserId) &&
      String(peer.userId) === String(normalizedUserId)
    ) {
      target = { socketId: normalizedSocketId, peer };
    }
  }

  if (!target && Number.isFinite(normalizedUserId)) {
    target = findUserPeerByUserId(normalizedUserId);
  }

  if (!target) {
    return false;
  }

  try {
    target.peer?.socket?.disconnect(true);
  } catch {}
  return true;
}

function getPeerActiveTalkTarget(peer) {
  if (!peer || peer.kind !== "user") return null;
  for (const producer of peer.producers.values()) {
    const appData = producer?.appData;
    if (!appData || typeof appData !== "object") continue;
    if (appData.type === "user" || appData.type === "conference") {
      return normalizeCompanionTarget({ type: appData.type, id: appData.id });
    }
  }
  return null;
}

function ensureCompanionUserState(userId, fallbackName = null) {
  const key = String(userId);
  let state = companionUserState.get(key);
  if (!state) {
    state = {
      userId,
      userName: fallbackName || null,
      online: false,
      socketId: null,
      talking: false,
      talkLocked: false,
      currentTarget: null,
      lastTarget: null,
      targetAudioStates: [],
      lastSpokeAt: null,
      lastCommandId: null,
      lastCommandResult: null,
      updatedAt: Date.now(),
    };
    companionUserState.set(key, state);
  } else if (fallbackName && !state.userName) {
    state.userName = fallbackName;
  }
  return state;
}

function buildCompanionUserState(userId, fallbackName = null) {
  const base = ensureCompanionUserState(userId, fallbackName);
  const found = findUserPeerByUserId(userId);
  const peer = found?.peer || null;
  const socketId = found?.socketId || null;
  const activeTarget = peer ? getPeerActiveTalkTarget(peer) : null;
  const fallbackCurrentTarget = normalizeCompanionTarget(base.currentTarget);
  const currentTarget = activeTarget || fallbackCurrentTarget || null;
  const talking = Boolean(found && (activeTarget || base.talking));
  const resolvedName = peer?.name || base.userName || fallbackName || null;
  const lastTarget = normalizeCompanionTarget(base.lastTarget) || currentTarget || null;

  return {
    userId,
    name: resolvedName,
    socketId,
    online: Boolean(found),
    talking,
    talkLocked: Boolean(base.talkLocked && found),
    currentTarget: talking ? currentTarget : null,
    lastTarget,
    lastSpokeAt: base.lastSpokeAt || null,
    cutCamera: Boolean(resolvedName && cutCameraUser && resolvedName === cutCameraUser),
    lastCommandId: base.lastCommandId || null,
    lastCommandResult: base.lastCommandResult || null,
    targetAudioStates: normalizeCompanionTargetAudioStates(base.targetAudioStates),
    updatedAt: base.updatedAt || null,
  };
}

function isCompanionAddressableUser(user) {
  return Boolean(user && !user.is_superadmin);
}

function isCompanionAddressableUserId(userId) {
  const user = getUserById(userId);
  return isCompanionAddressableUser(user);
}

function getCompanionAddressableUsers() {
  return getAllUsers().filter(isCompanionAddressableUser);
}

function buildCompanionSnapshot() {
  const users = getCompanionAddressableUsers().map((user) => ({
    id: user.id,
    name: user.name,
    state: buildCompanionUserState(user.id, user.name),
  }));

  return {
    version: 1,
    serverTime: new Date().toISOString(),
    cutCameraUser,
    users,
    conferences: getAllConferences(),
    feeds: getAllFeeds(),
  };
}

function buildCompanionSnapshotForAuth(auth) {
  return {
    ...buildCompanionSnapshot(),
    scope: buildCompanionAuthScope(auth),
  };
}

function emitCompanionEvent(event, payload = {}) {
  if (!companionNamespace) return;
  companionNamespace.emit(event, payload);
}

function emitCompanionUserState(userId, reason = "state-updated", fallbackName = null) {
  if (!isCompanionAddressableUserId(userId)) return;
  const state = buildCompanionUserState(userId, fallbackName);
  emitCompanionEvent("user-state", {
    reason,
    at: new Date().toISOString(),
    state,
  });
}

function updateCompanionUserState(userId, patch = {}, { reason = "state-updated", fallbackName = null } = {}) {
  if (userId === null || userId === undefined) return;
  if (!isCompanionAddressableUserId(userId)) return;
  const state = ensureCompanionUserState(userId, fallbackName);
  const normalizedPatch = { ...patch };
  if ("targetAudioStates" in normalizedPatch) {
    normalizedPatch.targetAudioStates = normalizeCompanionTargetAudioStates(normalizedPatch.targetAudioStates);
  }
  Object.assign(state, normalizedPatch, { userId, updatedAt: Date.now() });
  if (fallbackName && !state.userName) {
    state.userName = fallbackName;
  }
  emitCompanionUserState(userId, reason, fallbackName);
}

function syncPeerCompanionState(peer, { reason = "peer-sync" } = {}) {
  if (!peer || peer.kind !== "user" || peer.userId === null || peer.userId === undefined) {
    return;
  }
  const activeTarget = getPeerActiveTalkTarget(peer);
  const patch = {
    userName: peer.name || null,
    online: true,
    socketId: peer.socket?.id || null,
    talking: Boolean(activeTarget),
    currentTarget: activeTarget,
  };
  if (activeTarget) {
    patch.lastTarget = activeTarget;
  } else {
    patch.talkLocked = false;
    patch.lastSpokeAt = Date.now();
  }
  updateCompanionUserState(peer.userId, patch, { reason, fallbackName: peer.name || null });
}

function registerCompanionPendingCommand(meta = {}) {
  const commandId = meta.commandId || crypto.randomUUID();
  let resolvePromise = () => {};
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  const expiresAt = Date.now() + COMPANION_PENDING_TTL_MS;
  const expiryTimer = setTimeout(() => {
    const entry = companionPendingCommands.get(commandId);
    if (!entry) return;
    companionPendingCommands.delete(commandId);
    const timeoutPayload = {
      commandId,
      ok: false,
      reason: "result-timeout",
      timedOut: true,
      userId: entry.userId ?? null,
      at: new Date().toISOString(),
    };
    entry.resolve(timeoutPayload);
    emitCompanionEvent("command-result", timeoutPayload);
  }, COMPANION_PENDING_TTL_MS);

  companionPendingCommands.set(commandId, {
    ...meta,
    commandId,
    expiresAt,
    expiryTimer,
    resolve: resolvePromise,
  });

  return { commandId, promise };
}

function settleCompanionPendingCommand(commandId, payload = {}) {
  const entry = companionPendingCommands.get(commandId);
  if (!entry) return false;

  companionPendingCommands.delete(commandId);
  clearTimeout(entry.expiryTimer);
  entry.resolve({
    commandId,
    userId: entry.userId ?? null,
    ...payload,
  });
  return true;
}

function failPendingCommandsForUser(userId, reason = "user-disconnected") {
  const nowIso = new Date().toISOString();
  for (const [commandId, entry] of companionPendingCommands.entries()) {
    if (String(entry.userId) !== String(userId)) continue;
    companionPendingCommands.delete(commandId);
    clearTimeout(entry.expiryTimer);
    const payload = {
      commandId,
      userId: entry.userId ?? null,
      ok: false,
      reason,
      at: nowIso,
    };
    entry.resolve(payload);
    emitCompanionEvent("command-result", payload);
  }
}

function dispatchCompanionCommandToUser(userId, socketEvent, payload, { commandId = null } = {}) {
  const target = findUserPeerByUserId(userId);
  if (!target) {
    return { ok: false, status: 404, error: "user not connected" };
  }

  const message = { ...payload };
  if (commandId) {
    message.commandId = commandId;
    message.sentAt = new Date().toISOString();
    updateCompanionUserState(target.peer.userId, {
      lastCommandId: commandId,
      lastCommandResult: "pending",
    }, {
      reason: "command-dispatched",
      fallbackName: target.peer.name || null,
    });
  }

  target.peer.socket.emit(socketEvent, message);
  return { ok: true, socketId: target.socketId, peer: target.peer };
}

function dispatchTalkCommandToUser(userId, payload, options = {}) {
  return dispatchCompanionCommandToUser(userId, "api-talk-command", payload, options);
}

function dispatchTargetAudioCommandToUser(userId, payload, options = {}) {
  return dispatchCompanionCommandToUser(userId, "api-target-audio-command", payload, options);
}

// HTTPS port (defaults to 443)
const HTTPS_PORT = parseInt(process.env.PORT || process.env.HTTPS_PORT || "443", 10);
const mdnsHostname = (() => {
  const raw =
    process.env.MDNS_HOST ||
    process.env.MDNS_NAME ||
    process.env.INTERCOM_HOSTNAME;
  if (raw !== undefined) {
    const trimmed = String(raw).trim().toLowerCase();
    if (
      !trimmed ||
      ["off", "false", "no", "none", "disable", "disabled"].includes(trimmed)
    ) {
      return null;
    }
    return normalizeHostname(raw);
  }
  return normalizeHostname("intercom.local");
})();

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
app.get("/users", requireAdmin, (req, res) => {
  res.json(getAllUsers());
});

app.get("/conferences", requireAdmin, (req, res) => {
  res.json(getAllConferences());
});

app.get("/feeds", requireAdmin, (req, res) => {
  res.json(getAllFeeds());
});

app.get("/users/:id/conferences", requireAdmin, (req, res) => {
  try {
    const conferences = getConferencesForUser(req.params.id);
    res.json(conferences);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get('/conferences/:id/users', requireAdmin, (req, res) => {
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
    if (user) {
      console.log("Login successful for user:", user.name);
      return res.json({ id: user.id, name: user.name, kind: "user" });
    }

    const feed = verifyFeed(name, password);
    if (feed) {
      console.log("Login successful for feed:", feed.name);
      return res.json({ id: feed.id, name: feed.name, kind: "feed" });
    }

    console.warn("Login failed for:", name);
    return res.status(401).json({ error: "Invalid credentials" });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/admin/login", (req, res) => {
  const { name, password } = req.body || {};
  if (!name || !password) {
    return res.status(400).json({ error: "Name and password are required" });
  }

  try {
    const user = verifyUser(name, password);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    if (!user.is_admin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const token = createAdminSession(user);
    res.cookie("admin_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: ADMIN_SESSION_TTL_MS,
    });
    return res.json({
      id: user.id,
      name: user.name,
      isAdmin: true,
      isSuperadmin: !!user.is_superadmin,
      mustChangePassword: !!user.admin_must_change,
    });
  } catch (err) {
    console.error("Admin login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/admin/logout", requireAdmin, (req, res) => {
  if (req.adminToken) {
    adminSessions.delete(req.adminToken);
  }
  res.clearCookie("admin_session", { httpOnly: true, sameSite: "lax", secure: true });
  res.sendStatus(204);
});

app.get(["/admin", "/admin/"], (req, res) => {
  res.redirect("/admin.html");
});

app.get(["/debug", "/debug/"], (req, res) => {
  res.redirect("/debug.html");
});

app.get("/admin/me", (req, res) => {
  const result = getAdminSession(req);
  if (!result) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const user = getUserById(result.session.userId);
  if (!user || !user.is_admin) {
    adminSessions.delete(result.token);
    res.clearCookie("admin_session", { httpOnly: true, sameSite: "lax", secure: true });
    return res.status(401).json({ error: "Not authenticated" });
  }

  return res.json({
    id: user.id,
    name: user.name,
    isAdmin: !!user.is_admin,
    isSuperadmin: !!user.is_superadmin,
    mustChangePassword: !!user.admin_must_change,
  });
});

app.get("/admin/api-key", requireAdmin, (req, res) => {
  res.json({ apiKey: companionApiKey });
});

app.get("/admin/settings/mdns", requireAdmin, (req, res) => {
  const config = loadRuntimeConfig() || {};
  const configuredHost = normalizeMdnsSetting(config.mdnsHost) || "intercom.local";
  const activeHost = mdnsHostname || "off";

  res.json({
    mdnsHost: configuredHost,
    activeMdnsHost: activeHost,
    restartRequired: configuredHost !== activeHost,
    configPath: getConfigPath(),
  });
});

app.put("/admin/settings/mdns", requireAdmin, (req, res) => {
  const nextHost = normalizeMdnsSetting(req.body?.mdnsHost);
  if (!nextHost) {
    return res.status(400).json({ error: "Invalid mDNS name. Use letters, numbers, hyphens and optional dots, or 'off'." });
  }
  const currentConfig = loadRuntimeConfig() || {};
  const updatedConfig = {
    ...currentConfig,
    mdnsHost: nextHost,
  };

  try {
    const configPath = saveRuntimeConfig(updatedConfig);
    return res.json({
      mdnsHost: nextHost,
      activeMdnsHost: mdnsHostname || "off",
      restartRequired: nextHost !== (mdnsHostname || "off"),
      configPath,
    });
  } catch (err) {
    console.error("Error saving mDNS setting:", err);
    return res.status(500).json({ error: "Failed to save mDNS setting" });
  }
});

app.get("/admin/config/export", requireAdmin, (req, res) => {
  try {
    const bundle = {
      format: "talktome-config",
      version: 1,
      exportedAt: new Date().toISOString(),
      serverConfig: loadRuntimeConfig() || {},
      database: exportDatabaseSnapshot(),
    };

    const stamp = bundle.exportedAt.replace(/[:.]/g, "-");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"talktome-config-${stamp}.json\"`);
    res.send(JSON.stringify(bundle, null, 2));
  } catch (err) {
    console.error("Error exporting config:", err);
    res.status(500).json({ error: "Failed to export configuration" });
  }
});

app.post("/admin/config/import", requireAdmin, (req, res) => {
  const bundle = req.body;
  if (!bundle || typeof bundle !== "object") {
    return res.status(400).json({ error: "Invalid import payload" });
  }
  if (bundle.format !== "talktome-config") {
    return res.status(400).json({ error: "Unsupported config file" });
  }
  if (!bundle.database || typeof bundle.database !== "object") {
    return res.status(400).json({ error: "Config file is missing database data" });
  }

  try {
    const currentConfig = loadRuntimeConfig() || {};
    const nextConfig = { ...currentConfig };

    if (bundle.serverConfig && typeof bundle.serverConfig === "object") {
      if (Object.prototype.hasOwnProperty.call(bundle.serverConfig, "httpsPort")) {
        const httpsPort = parseRequiredPort(bundle.serverConfig.httpsPort, nextConfig.httpsPort ?? 443);
        nextConfig.httpsPort = httpsPort;
      }

      if (Object.prototype.hasOwnProperty.call(bundle.serverConfig, "httpPort")) {
        nextConfig.httpPort = parseOptionalPort(bundle.serverConfig.httpPort);
      }

      if (Object.prototype.hasOwnProperty.call(bundle.serverConfig, "mdnsHost")) {
        const mdnsHost = normalizeMdnsSetting(bundle.serverConfig.mdnsHost);
        if (!mdnsHost) {
          return res.status(400).json({ error: "Config file contains an invalid mDNS name" });
        }
        nextConfig.mdnsHost = mdnsHost;
      }
    }

    importDatabaseSnapshot(bundle.database);
    saveRuntimeConfig(nextConfig);

    res.json({
      ok: true,
      restartRequired: true,
      importedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Error importing config:", err);
    res.status(500).json({ error: err.message || "Failed to import configuration" });
  }
});

app.post("/api/v1/companion/auth/login", (req, res) => {
  const { name, password } = req.body || {};
  if (!name || !password) {
    return res.status(400).json({ error: "Name and password are required" });
  }

  try {
    const user = verifyUser(name, password);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = createCompanionSession(user);
    const scope = user.is_superadmin ? "all" : "self";
    return res.json({
      token,
      expiresInMs: COMPANION_SESSION_TTL_MS,
      user: {
        id: user.id,
        name: user.name,
        isAdmin: !!user.is_admin,
        isSuperadmin: !!user.is_superadmin,
      },
      scope: {
        mode: scope,
        userId: user.id,
      },
    });
  } catch (err) {
    console.error("Companion auth login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/admin/password", requireAdmin, (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== "string" || password.trim().length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters" });
  }

  try {
    const updated = updateAdminPassword(req.adminSession.userId, password.trim());
    if (!updated) {
      return res.status(404).json({ error: "Admin user not found" });
    }
    res.sendStatus(204);
  } catch (err) {
    console.error("Error updating admin password:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/admin/users/:id/admin", requireAdmin, (req, res) => {
  const { isAdmin } = req.body || {};
  if (typeof isAdmin !== "boolean") {
    return res.status(400).json({ error: "isAdmin must be boolean" });
  }

  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) {
    return res.status(400).json({ error: "Invalid user id" });
  }

  const user = getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  if (user.is_superadmin && !isAdmin) {
    return res.status(403).json({ error: "Superadmin cannot be demoted" });
  }

  try {
    const updated = setUserAdminRole(userId, isAdmin);
    if (!updated) {
      return res.status(404).json({ error: "User not found" });
    }
    res.sendStatus(204);
  } catch (err) {
    console.error("Error updating admin role:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/users", requireAdmin, (req, res) => {
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

app.post("/conferences", requireAdmin, (req, res) => {
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

app.post("/feeds", requireAdmin, (req, res) => {
  const { name, password } = req.body || {};
  if (!name || !password) {
    return res.status(400).json({ error: "Name and password are required" });
  }
  try {
    const id = createFeed(name, password);
    res.json({ id });
  } catch (err) {
    if (err.message.includes("exists")) {
      res.status(409).json({ error: err.message });
    } else {
      console.error("Error creating feed:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

app.post('/conferences/:conferenceId/users/:userId', requireAdmin, (req, res) => {
  addUserToConference(req.params.userId, req.params.conferenceId);
  res.sendStatus(204);
});


app.post('/users/:id/targets', requireAdmin, (req, res) => {
  const { targetType, targetId } = req.body;
  try {
    if (targetType === 'user') {
      const numericTargetId = Number(targetId);
      if (!Number.isFinite(numericTargetId)) {
        return res.status(400).json({ error: 'Invalid target user id' });
      }
      const targetUser = getUserById(numericTargetId);
      if (!targetUser) {
        return res.status(404).json({ error: 'Target user not found' });
      }
      if (targetUser.is_superadmin) {
        return res.status(400).json({ error: 'Superadmin users cannot be targets' });
      }
      addUserTargetToUser(req.params.id, targetId);
    } else if (targetType === 'conference') {
      addUserTargetToConference(req.params.id, targetId);
    } else if (targetType === 'feed') {
      addUserTargetToFeed(req.params.id, targetId);
    } else {
      return res.status(400).json({ error: 'Unsupported target type' });
    }
    notifyTargetChange(req.params.id);
    res.sendStatus(204);
  } catch (err) {
    console.error('Error in add-target:', err);
    const lower = String(err?.message || '').toLowerCase();
    if (lower.includes('superadmin users cannot be targets') || lower.includes('target user not found')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/users/:id/targets/order', requireAdmin, (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items) {
    return res.status(400).json({ error: 'items array required' });
  }

  const normalized = items.map(item => ({
    targetType: item?.targetType,
    targetId: Number(item?.targetId),
  }));

  const validTypes = ['user', 'conference', 'feed'];
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

app.get("/api/v1/companion/config", requireCompanionApiKey, (req, res) => {
  res.json({
    version: 1,
    auth: {
      type: "api-key-or-session-token",
      header: "x-api-key",
      alternative: "Authorization: Bearer <api-key-or-session-token>",
      loginEndpoint: "/api/v1/companion/auth/login",
    },
    scope: buildCompanionAuthScope(req.companionAuth),
    realtime: {
      transport: "socket.io",
      namespace: "/companion",
      events: ["snapshot", "user-state", "command-result", "cut-camera"],
    },
  });
});

app.get("/api/v1/companion/state", requireCompanionApiKey, (req, res) => {
  res.json({
    ...buildCompanionSnapshot(),
    scope: buildCompanionAuthScope(req.companionAuth),
  });
});

app.get("/api/v1/companion/users", requireCompanionApiKey, (req, res) => {
  const allUsers = getCompanionAddressableUsers().map((user) => ({
    id: user.id,
    name: user.name,
    state: buildCompanionUserState(user.id, user.name),
  }));

  if (!hasCompanionGlobalAccess(req.companionAuth)) {
    const ownUserId = Number(req.companionAuth?.userId);
    const ownRows = allUsers.filter((row) => Number(row.id) === ownUserId);
    return res.json(ownRows);
  }

  res.json(allUsers);
});

app.get("/api/v1/companion/conferences", requireCompanionApiKey, (req, res) => {
  res.json(getAllConferences());
});

app.get("/api/v1/companion/feeds", requireCompanionApiKey, (req, res) => {
  res.json(getAllFeeds());
});

app.get("/api/v1/companion/users/:id/targets", requireCompanionApiKey, (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) {
    return res.status(400).json({ error: "Invalid user id" });
  }
  if (!isCompanionAddressableUserId(userId)) {
    return res.status(404).json({ error: "User not found" });
  }
  try {
    const targets = getUserTargets(userId);
    res.json(targets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/v1/client/logout", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const userId = Number(body.userId);
  const socketId = typeof body.socketId === "string" ? body.socketId : null;

  if (!Number.isFinite(userId)) {
    return res.sendStatus(204);
  }

  const disconnected = disconnectUserPeerForLogout({ userId, socketId });

  // Fallback: if no live peer was found, reflect offline immediately for companion.
  if (!disconnected && isCompanionAddressableUserId(userId)) {
    const userName = getUserById(userId)?.name || null;
    updateCompanionUserState(
      userId,
      {
        userName,
        online: false,
        socketId: null,
        talking: false,
        talkLocked: false,
        currentTarget: null,
        targetAudioStates: [],
        lastSpokeAt: Date.now(),
      },
      {
        reason: "client-logout-http",
        fallbackName: userName,
      }
    );
    failPendingCommandsForUser(userId, "user-logout");
  }

  return res.sendStatus(204);
});

app.post("/api/v1/companion/users/:id/talk", requireCompanionApiKey, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) {
    return res.status(400).json({ error: "Invalid user id" });
  }
  if (!canCompanionControlUser(req.companionAuth, userId)) {
    return res.status(403).json({ error: "Forbidden for this companion account" });
  }
  if (!isCompanionAddressableUserId(userId)) {
    return res.status(404).json({ error: "User not found" });
  }

  const normalized = normalizeTalkCommandInput(req.body || {});
  if (!normalized.ok) {
    return res.status(normalized.status).json({ error: normalized.error });
  }

  const waitMs = parseCompanionWaitMs(
    req.query?.waitMs ?? req.body?.waitMs ?? COMPANION_DEFAULT_WAIT_MS
  );
  const commandId = crypto.randomUUID();
  const { promise } = registerCompanionPendingCommand({
    commandId,
    userId,
    action: normalized.value.action,
    targetType: normalized.value.targetType,
    targetId: normalized.value.targetId,
  });

  const dispatch = dispatchTalkCommandToUser(userId, normalized.value.payload, { commandId });
  if (!dispatch.ok) {
    const failedPayload = {
      ok: false,
      reason: dispatch.error || "dispatch-failed",
      at: new Date().toISOString(),
    };
    settleCompanionPendingCommand(commandId, failedPayload);
    emitCompanionEvent("command-result", {
      commandId,
      userId,
      ...failedPayload,
    });
    return res.status(dispatch.status || 500).json({ error: dispatch.error || "Dispatch failed" });
  }

  const result = await Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), waitMs)),
  ]);

  if (!result) {
    return res.status(202).json({
      commandId,
      status: "pending",
      waitMs,
      accepted: true,
    });
  }

  const responsePayload = {
    commandId,
    status: result.ok ? "ok" : "failed",
    accepted: true,
    result,
  };
  return res.status(result.ok ? 200 : 409).json(responsePayload);
});

app.post("/api/v1/companion/users/:id/target-audio", requireCompanionApiKey, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) {
    return res.status(400).json({ error: "Invalid user id" });
  }
  if (!canCompanionControlUser(req.companionAuth, userId)) {
    return res.status(403).json({ error: "Forbidden for this companion account" });
  }
  if (!isCompanionAddressableUserId(userId)) {
    return res.status(404).json({ error: "User not found" });
  }

  const normalized = normalizeTargetAudioCommandInput(req.body || {});
  if (!normalized.ok) {
    return res.status(normalized.status).json({ error: normalized.error });
  }

  const waitMs = parseCompanionWaitMs(
    req.query?.waitMs ?? req.body?.waitMs ?? COMPANION_DEFAULT_WAIT_MS
  );
  const commandId = crypto.randomUUID();
  const { promise } = registerCompanionPendingCommand({
    commandId,
    userId,
    action: normalized.value.action,
    targetType: normalized.value.targetType,
    targetId: normalized.value.targetId,
  });

  const dispatch = dispatchTargetAudioCommandToUser(userId, normalized.value.payload, { commandId });
  if (!dispatch.ok) {
    const failedPayload = {
      ok: false,
      reason: dispatch.error || "dispatch-failed",
      at: new Date().toISOString(),
    };
    settleCompanionPendingCommand(commandId, failedPayload);
    emitCompanionEvent("command-result", {
      commandId,
      userId,
      ...failedPayload,
    });
    return res.status(dispatch.status || 500).json({ error: dispatch.error || "Dispatch failed" });
  }

  const result = await Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), waitMs)),
  ]);

  if (!result) {
    return res.status(202).json({
      commandId,
      status: "pending",
      waitMs,
      accepted: true,
    });
  }

  const responsePayload = {
    commandId,
    status: result.ok ? "ok" : "failed",
    accepted: true,
    result,
  };
  return res.status(result.ok ? 200 : 409).json(responsePayload);
});

app.post('/users/:id/talk', requireCompanionApiKey, (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) {
    return res.status(400).json({ error: "Invalid user id" });
  }
  if (!canCompanionControlUser(req.companionAuth, userId)) {
    return res.status(403).json({ error: "Forbidden for this companion account" });
  }
  if (!isCompanionAddressableUserId(userId)) {
    return res.status(404).json({ error: "User not found" });
  }

  const normalized = normalizeTalkCommandInput(req.body || {});
  if (!normalized.ok) {
    return res.status(normalized.status).json({ error: normalized.error });
  }

  const dispatch = dispatchTalkCommandToUser(userId, normalized.value.payload);
  if (!dispatch.ok) {
    return res.status(dispatch.status || 500).json({ error: dispatch.error || "Dispatch failed" });
  }

  res.sendStatus(202);
});

// === PUT ===
app.put("/users/:id", requireAdmin, (req, res) => {
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

app.put('/users/:id/password', requireAdmin, (req, res) => {
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
app.put('/conferences/:id', requireAdmin, (req, res) => {
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

app.put('/feeds/:id', requireAdmin, (req, res) => {
  const { name } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    const listeners = getUsersForFeed(req.params.id) || [];
    const updated = updateFeedName(req.params.id, name.trim());
    if (!updated) return res.status(404).json({ error: 'Feed not found' });
    listeners.forEach(({ user_id }) => notifyTargetChange(user_id));
    res.sendStatus(204);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      res.status(409).json({ error: 'Feed name already exists' });
    } else {
      console.error('Error renaming feed:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

app.put('/feeds/:id/password', requireAdmin, (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.trim().length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters long' });
  }

  try {
    const updated = updateFeedPassword(req.params.id, password.trim());
    if (!updated) return res.status(404).json({ error: 'Feed not found' });
    res.sendStatus(204);
  } catch (err) {
    console.error('Error updating feed password:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// === DELETE (specific routes FIRST) ===
app.delete("/conferences/:conferenceId/users/:userId", requireAdmin, (req, res) => {
  try {
    removeUserFromConference(req.params.userId, req.params.conferenceId);
    res.sendStatus(204);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete user (generic)
app.delete("/users/:id", requireAdmin, (req, res) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (user.is_admin) {
      return res.status(403).json({ error: "Admin accounts cannot be deleted" });
    }
    deleteUser(req.params.id);
    res.sendStatus(204);
  } catch (err) {
    res.status(500).json({ error: "Failed to delete user" });
  }
});

app.delete("/feeds/:id", requireAdmin, (req, res) => {
  try {
    const listeners = getUsersForFeed(req.params.id) || [];
    deleteFeed(req.params.id);
    listeners.forEach(({ user_id }) => notifyTargetChange(user_id));
    res.sendStatus(204);
  } catch (err) {
    res.status(500).json({ error: "Failed to delete feed" });
  }
});

// Delete conference (generic)
app.delete("/conferences/:id", requireAdmin, (req, res) => {
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

app.delete("/users/:id/targets/:type/:tid", requireAdmin, (req, res) => {
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
    if (peer.kind === "user" && String(peer.userId) === idStr) {
      peer.socket.emit('user-targets-updated');
    }
  }
  emitCompanionEvent("user-targets-updated", {
    at: new Date().toISOString(),
    userId: Number(userId),
  });
}


// Create a self-signed certificate if none exists yet.
// Keep certificates in the per-user app data directory (writable across platforms).
const certDir = path.join(getDataDir(), "certs");
const keyPath = path.join(certDir, "key.pem");
const certPath = path.join(certDir, "cert.pem");

if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
}

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  const attrs = [{ name: "commonName", value: mdnsHostname || os.hostname() }];
  const pems = selfsigned.generate(attrs, { keySize: 4096, days: 365 });
  fs.writeFileSync(keyPath, pems.private, { mode: 0o600 });
  fs.writeFileSync(certPath, pems.cert, { mode: 0o600 });
  console.log("ℹ️  Generated self-signed TLS certificate in ./certs");
}

// HTTPS Server Setup
const httpsOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath),
};

const server = https.createServer(httpsOptions, app);
const io = socketIO(server, { serveClient: false });

companionNamespace = io.of("/companion");
companionNamespace.use((socket, next) => {
  const candidate = extractCompanionApiKeyFromSocket(socket);
  const auth = resolveCompanionAuth(candidate);
  if (!candidate || !auth) {
    return next(new Error("unauthorized"));
  }
  socket.data.companionAuth = auth;
  next();
});
companionNamespace.on("connection", (socket) => {
  socket.emit("snapshot", buildCompanionSnapshotForAuth(socket.data?.companionAuth || null));
  socket.on("request-snapshot", () => {
    socket.emit("snapshot", buildCompanionSnapshotForAuth(socket.data?.companionAuth || null));
  });
});

app.post("/cut-camera", (req, res) => {
  const { user } = req.body;
  if (typeof user !== "string") {
    return res.status(400).json({ error: "user must be provided" });
  }

  console.log(`[CUT-CAMERA] Request for user: ${user}`);
  const previousCutCameraUser = cutCameraUser;
  // empty string disables all highlights
  cutCameraUser = user.trim() || null;

  for (const peer of peers.values()) {
    peer.socket.emit("cut-camera", peer.name === cutCameraUser);
  }

  emitCompanionEvent("cut-camera", {
    at: new Date().toISOString(),
    previousUser: previousCutCameraUser,
    user: cutCameraUser,
  });

  if (previousCutCameraUser !== cutCameraUser) {
    const touchedNames = new Set([previousCutCameraUser, cutCameraUser].filter(Boolean));
    if (touchedNames.size) {
      const allUsers = getAllUsers();
      allUsers.forEach((u) => {
        if (touchedNames.has(u.name)) {
          emitCompanionUserState(u.id, "cut-camera-changed", u.name);
        }
      });
    }
  }

  res.json({ user: cutCameraUser });
});


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

function parseRequiredPort(value, fallback = null) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fallback;
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

function getStartupHosts() {
  const configuredPublicIp = typeof process.env.PUBLIC_IP === "string"
    ? process.env.PUBLIC_IP.trim()
    : "";

  if (configuredPublicIp) {
    return [configuredPublicIp];
  }

  return Array.from(new Set(getLocalIPv4Addresses()));
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
    userId: peer.userId ?? null,
    feedId: peer.feedId ?? null,
    kind: peer.kind ?? (peer.userId ? "user" : peer.feedId ? "feed" : "guest"),
    name: peer.name || null
  }));
}

function resolveApplePttRecipientUserIds({ type, targetId, speakerSocketId }) {
  const recipientUserIds = new Set();
  const speakerPeer = peers.get(speakerSocketId);
  const speakerUserId = speakerPeer?.userId != null ? Number(speakerPeer.userId) : null;

  if (type === "user") {
    const targetPeer = peers.get(targetId);
    if (targetPeer?.userId != null) {
      recipientUserIds.add(Number(targetPeer.userId));
    }
  } else if (type === "conference") {
    const members = getUsersForConference(targetId) || [];
    for (const member of members) {
      recipientUserIds.add(Number(member.id));
    }
  } else if (type === "feed") {
    const listeners = getUsersForFeed(targetId) || [];
    for (const listener of listeners) {
      recipientUserIds.add(Number(listener.user_id));
    }
  }

  if (speakerUserId != null) {
    recipientUserIds.delete(speakerUserId);
  }

  return Array.from(recipientUserIds);
}

function resolveApplePttSpeakerName(socketId) {
  const peer = peers.get(socketId);
  const trimmed = typeof peer?.name === "string" ? peer.name.trim() : "";
  return trimmed || "TalkToMe";
}

async function sendApplePttSpeakerStarted({ type, targetId, speakerSocketId, reason }) {
  if (!applePttPushService.isConfigured()) {
    return [];
  }

  const recipientUserIds = resolveApplePttRecipientUserIds({ type, targetId, speakerSocketId });
  if (recipientUserIds.length === 0) {
    return recipientUserIds;
  }

  const registrations = getApplePttRegistrationsForUsers(recipientUserIds);
  await applePttPushService.sendActiveRemoteParticipant({
    registrations,
    participantName: resolveApplePttSpeakerName(speakerSocketId),
    reason,
  });

  return recipientUserIds;
}

async function sendApplePttServiceUpdate({ recipientUserIds, reason }) {
  if (!applePttPushService.isConfigured()) {
    return;
  }

  if (!Array.isArray(recipientUserIds) || recipientUserIds.length === 0) {
    return;
  }

  const registrations = getApplePttRegistrationsForUsers(recipientUserIds);
  await applePttPushService.sendServiceUpdate({
    registrations,
    reason,
  });
}

io.on("connection", (socket) => {
  console.log(`[CONN] Client connected: ${socket.id}`);
  peers.set(socket.id, {
    socket,
    userId:   null,
    feedId:   null,
    name:     null,
    kind:     "guest",
    consumers: new Map(),
    producers: new Map(),
  });

  // Emit lists
  io.emit("user-list", getUserList());
  socket.emit("conference-list", getAllConferences());

  socket.on("register-user", ({ id, name, kind = "user", force = false } = {}, callback) => {
    const peer = peers.get(socket.id);
    if (!peer) {
      if (typeof callback === "function") callback({ error: "Peer not registered" });
      return;
    }

    const normalizedKind = kind === "feed" ? "feed" : "user";
    const numericId = Number(id);
    const effectiveId = Number.isFinite(numericId) ? numericId : id;

    if (normalizedKind === "user") {
      const existing = Array.from(peers.entries()).find(([sid, p]) => (
        sid !== socket.id
        && p?.kind === "user"
        && p?.userId != null
        && String(p.userId) === String(effectiveId)
      ));

      if (existing) {
        const [existingSocketId, existingPeer] = existing;
        if (!force) {
          if (typeof callback === "function") {
            callback({
              conflict: true,
              existing: {
                socketId: existingSocketId,
                name: existingPeer?.name || null,
              },
            });
          }
          return;
        }

        try {
          existingPeer?.socket?.emit("session-kicked", {
            reason: "duplicate-login",
            bySocketId: socket.id,
          });
        } catch {}
        try {
          existingPeer?.socket?.disconnect(true);
        } catch {}
      }

      peer.name = name;
      peer.kind = normalizedKind;
      peer.userId = effectiveId;
      peer.feedId = null;
      console.log(`[USER] Registered operator ${name} (${effectiveId}) on socket ${socket.id}`);
      socket.emit("cut-camera", name === cutCameraUser);
    } else {
      peer.name = name;
      peer.kind = normalizedKind;
      peer.feedId = effectiveId;
      peer.userId = null;
      console.log(`[USER] Registered feed ${name} (${effectiveId}) on socket ${socket.id}`);
    }

    io.emit("user-list", getUserList());

    if (normalizedKind === "user" && peer.userId !== null && peer.userId !== undefined) {
      updateCompanionUserState(peer.userId, {
        userName: peer.name || null,
        online: true,
        socketId: socket.id,
        targetAudioStates: [],
      }, {
        reason: "user-online",
        fallbackName: peer.name || null,
      });
      syncPeerCompanionState(peer, { reason: "register-user" });
    }

    if (normalizedKind === "feed") {
      socket.emit("conference-list", []);
    }

    if (typeof callback === "function") callback({ ok: true });
  });

  socket.on("request-apple-ptt-bootstrap", (callback = () => {}) => {
    const peer = peers.get(socket.id);
    if (!peer || peer.kind !== "user" || peer.userId == null) {
      return callback({ ok: false, error: "Peer not registered" });
    }

    const runtimeConfig = loadRuntimeConfig() || {};
    if (runtimeConfig.applePtt?.enabled !== true) {
      return callback({ ok: true, enabled: false });
    }

    const channel = getOrCreateApplePttChannelForUser(peer.userId, "TalkToMe");
    callback({
      ok: true,
      enabled: true,
      channelUUID: channel.channel_uuid,
      channelName: channel.channel_name,
    });
  });

  socket.on("register-apple-ptt-push-token", ({ channelUUID, pushToken } = {}, callback = () => {}) => {
    const peer = peers.get(socket.id);
    if (!peer || peer.kind !== "user" || peer.userId == null) {
      return callback({ ok: false, error: "Peer not registered" });
    }

    if (typeof channelUUID !== "string" || !channelUUID.trim()) {
      return callback({ ok: false, error: "Missing channelUUID" });
    }

    if (typeof pushToken !== "string" || !/^[0-9a-f]+$/i.test(pushToken)) {
      return callback({ ok: false, error: "Invalid pushToken" });
    }

    registerApplePttPushToken(peer.userId, channelUUID.trim(), pushToken.toLowerCase());
    callback({ ok: true });
  });

  socket.on("unregister-apple-ptt-push-token", ({ channelUUID } = {}, callback = () => {}) => {
    const peer = peers.get(socket.id);
    if (!peer || peer.kind !== "user" || peer.userId == null) {
      return callback({ ok: false, error: "Peer not registered" });
    }

    if (typeof channelUUID !== "string" || !channelUUID.trim()) {
      return callback({ ok: false, error: "Missing channelUUID" });
    }

    unregisterApplePttPushToken(peer.userId, channelUUID.trim());
    callback({ ok: true });
  });

  socket.on("target-audio-state-snapshot", ({ reason = "target-audio-state", states = [] } = {}) => {
    const peer = peers.get(socket.id);
    if (!peer || peer.kind !== "user" || peer.userId === null || peer.userId === undefined) {
      return;
    }

    updateCompanionUserState(peer.userId, {
      userName: peer.name || null,
      targetAudioStates: states,
    }, {
      reason,
      fallbackName: peer.name || null,
    });
  });

  socket.on("ptt-state", (payload = {}) => {
    const peer = peers.get(socket.id);
    if (!peer || peer.kind !== "user" || peer.userId === null || peer.userId === undefined) {
      return;
    }

    const patch = {
      userName: peer.name || null,
      online: true,
      socketId: socket.id,
    };

    if (typeof payload.talking === "boolean") {
      patch.talking = payload.talking;
      if (!payload.talking) {
        patch.currentTarget = null;
        patch.lastSpokeAt = Date.now();
      }
    }
    if (typeof payload.lockActive === "boolean") {
      patch.talkLocked = payload.lockActive;
    }

    const normalizedTarget = normalizeCompanionTarget(payload.target);
    if (normalizedTarget) {
      patch.lastTarget = normalizedTarget;
      if (payload.talking !== false) {
        patch.currentTarget = normalizedTarget;
      }
    } else if (payload.target === null) {
      patch.currentTarget = null;
    }

    updateCompanionUserState(peer.userId, patch, {
      reason: "ptt-state",
      fallbackName: peer.name || null,
    });
  });

  const handleApiCommandResult = (payload = {}) => {
    const peer = peers.get(socket.id);
    if (!peer || peer.kind !== "user" || peer.userId === null || peer.userId === undefined) {
      return;
    }

    const commandId = typeof payload.commandId === "string" ? payload.commandId : null;
    if (!commandId) return;

    const resultPayload = {
      commandId,
      userId: peer.userId,
      userName: peer.name || null,
      socketId: socket.id,
      ok: Boolean(payload.ok),
      action: payload.action || null,
      targetType: payload.targetType || null,
      targetId: payload.targetId ?? null,
      reason: payload.reason || null,
      at: new Date().toISOString(),
    };

    const normalizedTarget = normalizeCompanionTarget(payload.target);
    const patch = {
      userName: peer.name || null,
      lastCommandId: commandId,
      lastCommandResult: resultPayload.ok ? "ok" : (resultPayload.reason || "failed"),
    };
    if (typeof payload.lockActive === "boolean") {
      patch.talkLocked = payload.lockActive;
    }
    if (typeof payload.talking === "boolean") {
      patch.talking = payload.talking;
      if (!payload.talking) {
        patch.currentTarget = null;
        patch.lastSpokeAt = Date.now();
      }
    }
    if (normalizedTarget) {
      patch.lastTarget = normalizedTarget;
      if (payload.talking !== false) {
        patch.currentTarget = normalizedTarget;
      }
    }
    updateCompanionUserState(peer.userId, patch, {
      reason: "command-result",
      fallbackName: peer.name || null,
    });

    resultPayload.state = buildCompanionUserState(peer.userId, peer.name || null);
    settleCompanionPendingCommand(commandId, resultPayload);
    emitCompanionEvent("command-result", resultPayload);
  };

  socket.on("api-talk-command-result", handleApiCommandResult);
  socket.on("api-target-audio-command-result", handleApiCommandResult);

  socket.on("request-active-producers", (callback = () => {}) => {
    const peer = peers.get(socket.id);
    if (!peer || peer.kind !== "user" || !peer.userId) {
      return callback([]);
    }

    const response = [];
    let conferenceIds = null;
    let feedIds = null;

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

    const loadFeedIds = () => {
      if (feedIds !== null) {
        return feedIds;
      }
      if (!peer.userId) {
        feedIds = new Set();
        return feedIds;
      }
      const rows = getFeedIdsForUser(peer.userId) || [];
      feedIds = new Set(rows.map((id) => String(id)));
      return feedIds;
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

        if (appData.type === "feed") {
          const feedId = appData.id;
          if (feedId == null) continue;
          const membership = loadFeedIds();
          if (membership.has(String(feedId))) {
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

  socket.on("user-logout", (callback = () => {}) => {
    try {
      callback({ ok: true });
    } catch {}
    disconnectUserPeerForLogout({ socketId: socket.id });
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
    syncPeerCompanionState(peer, { reason: "producer-close" });

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

      if (peer.kind === "user" && peer.userId !== null && peer.userId !== undefined) {
        updateCompanionUserState(peer.userId, {
          userName: peer.name || null,
          online: true,
          socketId: socket.id,
        }, {
          reason: "register-name",
          fallbackName: peer.name || null,
        });
      }

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
        const validTypes = ["user","conference","feed"];

        if (
            !type ||
            !validTypes.includes(type) ||
            !targetId
        ) {
          console.warn("[PRODUCE] Invalid appData:", appData);
          return callback({
            error:
                "Invalid appData: For 'user', 'conference', or 'feed', 'id' must be provided.",
          });
        }

        try {
          //----------------------------------------------------------------
          // 1️⃣  Create the producer
          //----------------------------------------------------------------
          const peer = peers.get(socket.id);
          if (!peer) {
            return callback({ error: "Peer not registered" });
          }

          if (type === "feed") {
            if (
              peer.kind !== "feed" ||
              peer.feedId === null ||
              String(peer.feedId) !== String(targetId)
            ) {
              console.warn(`[PRODUCE] Peer ${socket.id} is not authorized to produce for feed ${targetId}`);
              return callback({ error: "Not authorized to produce for this feed" });
            }
          } else if (peer.kind === "feed") {
            console.warn(`[PRODUCE] Feed peer ${socket.id} tried to produce for type ${type}`);
            return callback({ error: "Feeds can only produce their assigned feed" });
          }

          const transport = peer.sendTransport;
          if (!transport) {
            console.warn(`[PRODUCE] No send transport for peer ${socket.id}`);
            return callback({ error: "Send transport not ready" });
          }

          const producer = await transport.produce({
            kind,
            rtpParameters,
            appData,
          });

          peer.producers.set(producer.id, producer);
          syncPeerCompanionState(peer, { reason: "produce-started" });
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
          } else if (type === "feed") {
            const listeners = getUsersForFeed(targetId) || [];
            const listenerIds = new Set(listeners.map((row) => String(row.user_id)));

            for (const [sid, p] of peers) {
              if (sid === socket.id) continue;
              if (p.kind !== "user" || p.userId === null) continue;
              if (!listenerIds.has(String(p.userId))) continue;

              p.socket.emit("new-producer", {
                peerId: socket.id,
                producerId: producer.id,
                appData,
              });
            }
            console.log(`[ROUTE] Sent to feed listeners of ${targetId}`);
          }

          const applePttRecipientUserIds = await sendApplePttSpeakerStarted({
            type,
            targetId,
            speakerSocketId: socket.id,
            reason: "producer-started",
          });
          //----------------------------------------------------------------
          // 4️⃣  Cleanup listener
          //----------------------------------------------------------------
          producer.appData = appData;  // store once
          producer.__applePttRecipientUserIds = applePttRecipientUserIds;

          producer.on("close", () => {
            peer.producers.delete(producer.id);
            syncPeerCompanionState(peer, { reason: "produce-closed" });
            socket.broadcast.emit("producer-closed", {
              peerId:     socket.id,
              producerId: producer.id,
              appData     // included now
            });
          });


          producer.on("transportclose", () => {
            peer.producers.delete(producer.id);
            syncPeerCompanionState(peer, { reason: "produce-transport-closed" });
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
    const disconnectedUserId =
      peer && peer.kind === "user" && peer.userId !== null && peer.userId !== undefined
        ? peer.userId
        : null;
    const disconnectedUserName =
      disconnectedUserId !== null ? (peer?.name || null) : null;

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

    // Remove the peer first so companion state rebuild does not still resolve
    // this socket as online while we emit the offline update.
    peers.delete(socket.id);

    if (disconnectedUserId !== null) {
      updateCompanionUserState(disconnectedUserId, {
        userName: disconnectedUserName,
        online: false,
        socketId: null,
        talking: false,
        talkLocked: false,
        currentTarget: null,
        targetAudioStates: [],
        lastSpokeAt: Date.now(),
      }, {
        reason: "user-offline",
        fallbackName: disconnectedUserName,
      });
      failPendingCommandsForUser(disconnectedUserId, "user-disconnected");
    }

    io.emit("user-list", getUserList());
  });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[HTTPS] Port ${HTTPS_PORT} is already in use.`);
    console.error("       Choose another port or stop the process using it.");
  } else if (err.code === "EACCES") {
    console.error(`[HTTPS] Permission denied on port ${HTTPS_PORT}.`);
    console.error("       Run with elevated privileges or choose a high port.");
  } else {
    console.error(`[HTTPS] Failed to start server on port ${HTTPS_PORT}: ${err.message}`);
  }
  process.exit(1);
});

server.listen(HTTPS_PORT, () => {
  const startupHosts = getStartupHosts();
  console.log(`🔒 HTTPS Server running on port ${HTTPS_PORT}`);
  console.log("📍 Access via:");
  startupHosts.forEach((host) => {
    console.log(`   https://${host}:${HTTPS_PORT}`);
  });
  console.log("🛠️ Administration via:");
  startupHosts.forEach((host) => {
    console.log(`   https://${host}:${HTTPS_PORT}/admin.html`);
  });
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
  console.log("🔌 Companion API:");
  startupHosts.forEach((host) => {
    console.log(`   https://${host}:${HTTPS_PORT}/api/v1/companion/state`);
  });
  console.log(`🔌 Companion Socket.IO namespace: /companion`);
  if (!readCompanionApiKeyFromEnv()) {
    console.log(`🔐 API key file: ${COMPANION_API_KEY_FILE}`);
  }
});
