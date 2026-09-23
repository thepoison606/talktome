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
const QRCode = require("qrcode");
const { resolveServerAppVersion } = require("./appVersion");
const { createBrowserSessionStore } = require("./browserSessions");
const { loadProxySsoConfig, resolveProxySsoIdentity } = require("./proxySso");
const { getDataDir } = require("./dataPaths");
const { ApplePttPushService } = require("./applePttPushService");
const { buildGuestLoginUrl, buildLoginUrl, normalizeConnectUrl, selectAdminQrUrl } = require("./qrConnectUrl");
const { buildWebRtcListenInfos, resolveClientIceConfig } = require("./webrtcConfig");
const { installHttpRedirectOnHttpsPort } = require("./httpsRedirect");
const {
  listMediaNetworkInterfaces,
  normalizeSocketAddress,
  resolveTransportMediaRoute,
  selectMediaRouteAddress,
} = require("./mediaNetwork");
const {
  producerDeliveryChanged,
  resolveProducerReconciliationDelivery,
  shouldAnnounceProducerDelivery,
} = require("./producerReconciliation");
const {
  shouldCloseBridgeSessionAfterEventStreamClose,
} = require("./bridgeSessionLiveness");
const { syncRuntimeExecutable } = require("./runtimeWorker");
const {
  normalizeConfiguredDefaultClientSettings,
  resolveDefaultClientSettings,
  serializeDefaultClientSettingsScript,
} = require("./defaultClientSettings");
const { stopPeerTransmission } = require("./transmissionControl");
const { resolveActiveProductionSelection } = require("./productionSelection");
const { createTallyStateStore, normalizeTallyBus } = require("./tallyState");
const {
  arePeersInSameActiveProduction: arePeersInSameActiveProductionScope,
  canRouteTargetBetweenPeers,
} = require("./productionRouting");
const {
  normalize: normalizeUserAudioSettings,
  resolve: resolveUserAudioSettings,
} = require("./public/userAudioSettings");

const SERVER_APP_VERSION = resolveServerAppVersion();
const CLIENT_ICE_CONFIG = resolveClientIceConfig(process.env);

const workerName = process.platform === "win32" ? "mediasoup-worker.exe" : "mediasoup-worker";
const windowsRuntimeDllPattern =
  /^(?:api-ms-win-crt-[a-z0-9-]+|concrt140|msvcp140(?:_[a-z0-9_]+)?|ucrtbase|vcruntime140(?:_[a-z0-9_]+)?)\.dll$/i;

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

  const runtimeDir = path.join(getDataDir(), "runtime");
  const dest = path.join(runtimeDir, workerName);
  const workerSync = syncRuntimeExecutable(sourceBin, dest);
  if (workerSync.updated) {
    console.log(`[INIT] Updated mediasoup worker runtime: ${dest}`);
  }

  // The packaged worker is copied out of pkg's virtual filesystem before it
  // can be executed. On Windows the loader resolves app-local DLLs relative
  // to that copied executable, not relative to the tray app or its resources
  // directory. Keep the bundled MSVC/UCRT files beside the runtime worker.
  if (process.platform === "win32") {
    const runtimeSourceDirs = [
      path.dirname(sourceBin),
      execDir,
      path.join(execDir, "binaries"),
    ];
    const copiedRuntimeDlls = new Set();

    for (const sourceDir of runtimeSourceDirs) {
      if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) continue;
      for (const file of fs.readdirSync(sourceDir)) {
        if (!windowsRuntimeDllPattern.test(file)) continue;
        const normalizedFile = file.toLowerCase();
        if (copiedRuntimeDlls.has(normalizedFile)) continue;
        fs.copyFileSync(path.join(sourceDir, file), path.join(runtimeDir, file));
        copiedRuntimeDlls.add(normalizedFile);
      }
    }
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
  createFeedLoginToken,
  updateUserName,
  updateConferenceName,
  updateUserPassword,
  createUserLoginToken,
  getUserByLoginToken,
  getFeedByLoginToken,
  updateAdminPassword,
  updateFeedName,
  updateFeedPassword,
  updateUserLastOnline,
  getGuestProfileUser,
  getOrCreateGuestProfile,
  getAllUsers,
  getUserById,
  getUserAudioSettings,
  updateUserAudioSettings,
  getBridgeEndpointsForDevice,
  getFeedBridgeEndpointsForDevice,
  getAllConferences,
  getAllFeeds,
  getFeedById,
  getAllProductions,
  getProductionById,
  getPrimaryProduction,
  getProductionsForUser,
  getProductionsForFeed,
  isUserInProduction,
  isUserProductionAdmin,
  createProduction,
  updateProductionName,
  deleteProduction,
  getProductionMembers,
  setProductionUser,
  removeProductionUser,
  getProductionConferences,
  getProductionFeeds,
  setProductionConference,
  removeProductionConference,
  setProductionFeed,
  removeProductionFeed,
  getProductionConferencesForUser,
  getProductionUsersForConference,
  setProductionConferenceMembership,
  setProductionConferenceListenOnly,
  removeProductionConferenceMembership,
  getProductionTargets,
  getBridgeTargetsForUser,
  addProductionTarget,
  removeProductionTarget,
  updateProductionTargetOrder,
  deleteUser,
  deleteConference,
  deleteFeed,
  verifyUser,
  getUserByName,
  verifyFeed,
  getUserTargets,
  addUserTargetToUser,
  addUserTargetToConference,
  addUserTargetToFeed,
  removeUserTarget,
  updateUserTargetOrder,
  getUserTargetAudioStates,
  replaceUserTargetAudioStates,
  getFeedIdsForUser,
  getProductionFeedIdsForUser,
  getUsersForFeed,
  updateFeedBridgeEndpoint,
  getOrCreateApplePttChannelForUser,
  registerApplePttPushToken,
  unregisterApplePttPushToken,
  getApplePttRegistrationsForUsers,
  setUserAdminRole,
  updateUserBridgeEndpoint,
  exportDatabaseSnapshot,
  importDatabaseSnapshot,
  saveBrowserSession,
  getBrowserSessionByToken,
  deleteBrowserSession,
  purgeExpiredBrowserSessions,
} = require("./dbHandler");

const app = express();
app.use(express.json({ limit: "10mb" }));
const PROXY_SSO_CONFIG = loadProxySsoConfig(process.env);

if (PROXY_SSO_CONFIG.enabled) {
  console.log(
    `[SSO] Trusted-header login enabled with ${PROXY_SSO_CONFIG.header} from `
    + PROXY_SSO_CONFIG.trustedProxies.join(", ")
  );
}

const execDir = path.dirname(process.execPath);
const execPublicDir = path.join(execDir, "public");
const snapshotPublicDir = path.join(__dirname, "public");
const dataDir = getDataDir();
const dataConfigPath = path.join(dataDir, "config.json");
const bridgeTokenPath = path.join(dataDir, "bridge-tokens.json");
const legacyConfigPath = path.join(__dirname, "config.json");
const legacyPkgConfigPath = path.join(execDir, "config.json");
const DEFAULT_RTC_PORT_START = 40000;
const DEFAULT_RTC_PORT_COUNT = 10000;
const BRIDGE_REGISTRY_STALE_MS = 45_000;
const BRIDGE_CONTROL_SESSION_STALE_MS = 30_000;
const BRIDGE_RTP_HANDSHAKE_TIMEOUT_MS = 3_000;
const SERVER_STARTED_AT = Date.now();

const bridgeRegistry = new Map();
const bridgeControlSessions = new Map();

function loadBridgeTokenStore() {
  try {
    if (!fs.existsSync(bridgeTokenPath)) return new Map();
    const parsed = JSON.parse(fs.readFileSync(bridgeTokenPath, "utf8"));
    if (!parsed || typeof parsed !== "object") return new Map();
    const entries = Object.entries(parsed)
      .map(([id, value]) => {
        const normalizedId = normalizeBridgeId(id);
        const token = typeof value?.token === "string" ? value.token.trim() : "";
        const tokenHash = typeof value?.tokenHash === "string" ? value.tokenHash.trim() : "";
        if (!normalizedId || !token || !tokenHash) return null;
        return [normalizedId, {
          token,
          tokenHash,
          createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
          updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
        }];
      })
      .filter(Boolean);
    return new Map(entries);
  } catch (err) {
    console.warn(`[BRIDGE] Failed to load bridge token store: ${err.message}`);
    return new Map();
  }
}

function saveBridgeTokenStore() {
  try {
    fs.mkdirSync(path.dirname(bridgeTokenPath), { recursive: true });
    const payload = {};
    for (const [id, entry] of bridgeTokenStore.entries()) {
      payload[id] = {
        token: entry.token,
        tokenHash: entry.tokenHash,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      };
    }
    fs.writeFileSync(bridgeTokenPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  } catch (err) {
    console.warn(`[BRIDGE] Failed to persist bridge token store: ${err.message}`);
  }
}

const bridgeTokenStore = loadBridgeTokenStore();

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

function areMultipleProductionsEnabled(config = loadRuntimeConfig() || {}) {
  return config?.multipleProductions === true;
}

function normalizeActiveProductionId(value, userId) {
  const primaryProductionId = Number(getPrimaryProduction()?.id);
  const memberships = userId === null || userId === undefined
    ? []
    : getProductionsForUser(userId);
  const { productionId, hasRequestedProduction } = resolveActiveProductionSelection({
    requestedValue: value,
    multipleProductionsEnabled: areMultipleProductionsEnabled(),
    primaryProductionId,
    memberships,
  });
  if (!getProductionById(productionId)) {
    throw new Error("Production not found");
  }
  if (userId !== null && userId !== undefined && !isUserInProduction(userId, productionId)) {
    throw new Error(hasRequestedProduction
      ? "User is not a member of this production"
      : "This user is not assigned to the active production");
  }
  return productionId;
}

function getEffectiveConferencesForUser(userId, productionId = null) {
  const effectiveProductionId = productionId ?? getPrimaryProduction()?.id ?? null;
  return effectiveProductionId === null
    ? []
    : getProductionConferencesForUser(userId, effectiveProductionId);
}

function getSingleProductionMembershipScope() {
  if (areMultipleProductionsEnabled()) {
    const error = new Error("Conference membership is production-specific; manage it in the selected Matrix production");
    error.statusCode = 409;
    throw error;
  }
  const productionId = Number(getPrimaryProduction()?.id);
  if (!Number.isFinite(productionId)) {
    const error = new Error("Primary production not found");
    error.statusCode = 404;
    throw error;
  }
  return productionId;
}

function getEffectiveConferencesForPeer(peer) {
  if (!peer || !isOperatorPeer(peer)) return [];
  const userId = peer.kind === "guest" ? peer.guestProfileUserId : peer.userId;
  if (userId === null || userId === undefined) return [];
  if (peer.isBridgePeer) {
    const conferences = new Map();
    for (const production of getProductionsForUser(userId)) {
      for (const conference of getProductionConferencesForUser(userId, production.id)) {
        const existing = conferences.get(Number(conference.id));
        conferences.set(Number(conference.id), {
          ...conference,
          canTalk: Boolean(existing?.canTalk || conference.canTalk),
        });
      }
    }
    return [...conferences.values()];
  }
  return getEffectiveConferencesForUser(userId, peer.productionId ?? null);
}

function getEffectiveFeedIdsForPeer(peer) {
  if (!peer || !isOperatorPeer(peer)) return [];
  const userId = peer.kind === "guest" ? peer.guestProfileUserId : peer.userId;
  if (userId === null || userId === undefined) return [];
  return peer.productionId === null || peer.productionId === undefined
    ? getFeedIdsForUser(userId)
    : getProductionFeedIdsForUser(userId, peer.productionId);
}

function getEnabledProductionsForUser(userId) {
  return areMultipleProductionsEnabled() ? getProductionsForUser(userId) : [];
}

function addEntityToPrimaryProductionWhenSingle(type, entityId) {
  if (areMultipleProductionsEnabled()) return;
  const productionId = getPrimaryProduction()?.id;
  if (!productionId) return;
  if (type === "user") setProductionUser(productionId, entityId);
  else if (type === "conference") setProductionConference(productionId, entityId);
  else if (type === "feed") setProductionFeed(productionId, entityId);
}

function getDefaultRtcPortRange() {
  return {
    start: DEFAULT_RTC_PORT_START,
    count: DEFAULT_RTC_PORT_COUNT,
    end: DEFAULT_RTC_PORT_START + DEFAULT_RTC_PORT_COUNT - 1,
  };
}

function hasConfigValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function normalizeRtcPortRange(startValue, countValue, fallback = getDefaultRtcPortRange()) {
  const start = hasConfigValue(startValue) ? Number(startValue) : fallback.start;
  const count = hasConfigValue(countValue) ? Number(countValue) : fallback.count;

  if (!Number.isInteger(start) || start < 1 || start > 65535) {
    return { error: "RTC port start must be a number between 1 and 65535." };
  }
  if (!Number.isInteger(count) || count < 1 || count > 65535) {
    return { error: "RTC port count must be a number between 1 and 65535." };
  }

  const end = start + count - 1;
  if (end > 65535) {
    return { error: "RTC port range must end at or below 65535." };
  }

  return { start, count, end };
}

function resolveSavedRtcPortRange(config) {
  const resolved = normalizeRtcPortRange(config?.rtcPortStart, config?.rtcPortCount);
  return resolved.error ? getDefaultRtcPortRange() : resolved;
}

function resolveActiveRtcPortRange(config) {
  const saved = resolveSavedRtcPortRange(config);
  const hasSavedRange =
    Object.prototype.hasOwnProperty.call(config || {}, "rtcPortStart") ||
    Object.prototype.hasOwnProperty.call(config || {}, "rtcPortCount");

  if (
    hasConfigValue(process.env.TALKTOME_RTC_PORT_START) ||
    hasConfigValue(process.env.TALKTOME_RTC_PORT_COUNT)
  ) {
    const resolved = normalizeRtcPortRange(
      process.env.TALKTOME_RTC_PORT_START,
      process.env.TALKTOME_RTC_PORT_COUNT
    );
    if (resolved.error) {
      console.warn(`[CONFIG] ${resolved.error} Falling back to RTC ports ${saved.start}-${saved.end}.`);
      return { ...saved, source: hasSavedRange ? "config" : "default" };
    }
    return { ...resolved, source: "env" };
  }

  return { ...saved, source: hasSavedRange ? "config" : "default" };
}

function normalizeGuestDisplayName(value) {
  const trimmed = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return trimmed.slice(0, 40);
}

function resolveGuestLoginSettings(config, { createProfile = false, persist = false } = {}) {
  const currentConfig = config && typeof config === "object" ? config : {};
  const rawGuestConfig = currentConfig.guestLogin && typeof currentConfig.guestLogin === "object"
    ? currentConfig.guestLogin
    : {};
  let profile = null;
  const configuredProfileId = Number(rawGuestConfig.profileUserId);
  if (Number.isFinite(configuredProfileId)) {
    const candidate = getUserById(configuredProfileId);
    if (candidate?.is_guest_profile) {
      profile = candidate;
    }
  }

  if (!profile && createProfile) {
    profile = getOrCreateGuestProfile();
    addEntityToPrimaryProductionWhenSingle("user", profile.id);
  }

  const enabled = rawGuestConfig.enabled === true && !!profile;
  const resolved = {
    enabled,
    profileUserId: profile?.id ?? null,
    profileName: profile?.name || "Guest",
  };

  if (persist && profile && rawGuestConfig.profileUserId !== profile.id) {
    saveRuntimeConfig({
      ...currentConfig,
      guestLogin: {
        ...rawGuestConfig,
        enabled,
        profileUserId: profile.id,
      },
    });
  }

  return resolved;
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

function normalizeMediaNetworkMode(value) {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed || trimmed === "auto") return "auto";
  if (trimmed === "interface") return "interface";
  if (trimmed === "manual") return "manual";
  return null;
}

function normalizeMediaInterfaceName(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || "";
}

function normalizeMediaAnnouncedAddress(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || "";
}

function resolveSavedMediaNetworkConfig(config) {
  const mode = normalizeMediaNetworkMode(config?.mediaNetworkMode)
    || (normalizeMediaInterfaceName(config?.mediaInterfaceName) ? "interface" : null)
    || (normalizeMediaAnnouncedAddress(config?.mediaAnnouncedAddress) ? "manual" : null)
    || "auto";

  return {
    mode,
    interfaceName: mode === "interface" ? normalizeMediaInterfaceName(config?.mediaInterfaceName) : "",
    announcedAddress: mode === "manual" ? normalizeMediaAnnouncedAddress(config?.mediaAnnouncedAddress) : "",
  };
}

function getAvailableMediaNetworkInterfaces() {
  return listMediaNetworkInterfaces(os.networkInterfaces());
}

function resolveTransportAnnouncedAddress() {
  const availableInterfaces = getAvailableMediaNetworkInterfaces();
  return resolveTransportMediaRoute({ env: process.env, availableInterfaces });
}

function getActiveRtcAddresses(mediaRoute) {
  const candidates = Array.isArray(mediaRoute?.candidateAddresses)
    ? mediaRoute.candidateAddresses
    : [];
  return [...new Set(candidates.map((address) => String(address || "").trim()).filter(Boolean))];
}

function buildMediaNetworkRequestWarning(mediaRoute, req) {
  if (mediaRoute?.mode === "manual") return null;
  const requestLocalAddress = normalizeSocketAddress(req?.socket?.localAddress);
  if (!requestLocalAddress || ["127.0.0.1", "0.0.0.0", "::"].includes(requestLocalAddress)) return null;
  const activeAddresses = getActiveRtcAddresses(mediaRoute);
  if (activeAddresses.includes(requestLocalAddress)) return null;
  return `This Admin page was reached through ${requestLocalAddress}, but RTC currently offers ${activeAddresses.join(", ") || "no usable address"}. Audio from this network may not connect.`;
}

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

app.get("/default-client-settings.js", (req, res) => {
  const config = loadRuntimeConfig() || {};
  res.setHeader("Cache-Control", "no-store");
  res.type("application/javascript").send(
    serializeDefaultClientSettingsScript(config.defaultClientSettings)
  );
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

function stripSocketIoSourceMapReference(source) {
  if (typeof source !== "string") return source;
  return source.replace(/\n\/\/# sourceMappingURL=socket\.io\.js\.map\s*$/, "\n");
}

const socketIoClientPath = findSocketIoClientPath();
const socketIoClientContents = (() => {
  if (!socketIoClientPath) return null;
  try {
    return stripSocketIoSourceMapReference(
      fs.readFileSync(socketIoClientPath, "utf8")
    );
  } catch (err) {
    console.warn(`[SOCKET.IO] Failed to read client script: ${err.message}`);
    return null;
  }
})();

if (process.pkg) {
  if (socketIoClientContents) {
    const destPath = path.join(execPublicDir, "socket.io.js");
    try {
      if (!fs.existsSync(destPath)) {
        fs.writeFileSync(destPath, socketIoClientContents, "utf8");
      }
    } catch (err) {
      console.warn(`[SOCKET.IO] Failed to copy client script: ${err.message}`);
    }
  } else {
    console.warn("[SOCKET.IO] client script not found; /socket.io.js will 404");
  }
} else if (socketIoClientContents) {
  app.get("/socket.io.js", (req, res) => {
    res.type("application/javascript").send(socketIoClientContents);
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
    if (socketIoClientContents) {
      return res.type("application/javascript").send(socketIoClientContents);
    }
    res.sendStatus(404);
  });
}

app.use(express.static(publicDir));

const nodeModulesDir = path.join(__dirname, "node_modules");
if (fs.existsSync(nodeModulesDir)) {
  app.use("/node_modules", express.static(nodeModulesDir));
}

const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const BROWSER_SESSION_COOKIE = "talktome_session";
const BROWSER_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const adminSessions = new Map();
const browserSessions = createBrowserSessionStore({
  ttlMs: BROWSER_SESSION_TTL_MS,
  persistence: {
    read: getBrowserSessionByToken,
    write: saveBrowserSession,
    remove: deleteBrowserSession,
    purgeExpired: purgeExpiredBrowserSessions,
  },
});
const adminStatusStreams = new Set();
let adminStatusBroadcastTimer = null;
let pendingAdminStatusReason = "status-changed";
let pendingAdminStatusRefresh = { users: false, conferences: false, feeds: false };
let containerRestartScheduled = false;

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
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      // Ignore malformed client-controlled cookie values.
    }
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

function getBrowserSessionFromCookieHeader(cookieHeader) {
  const cookies = parseCookieHeader(cookieHeader || "");
  return browserSessions.get(cookies[BROWSER_SESSION_COOKIE]);
}

function getBrowserSession(req) {
  return getBrowserSessionFromCookieHeader(req?.headers?.cookie || "");
}

function setBrowserSessionCookie(res, token) {
  res.cookie(BROWSER_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: BROWSER_SESSION_TTL_MS,
  });
}

function clearBrowserSession(req, res) {
  const result = getBrowserSession(req);
  if (result?.token) browserSessions.revoke(result.token);
  res.clearCookie(BROWSER_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
  });
}

function createUserBrowserSession(res, user, source = "password") {
  const { token } = browserSessions.create({
    kind: "user",
    userId: Number(user.id),
    name: user.name,
    source,
  });
  setBrowserSessionCookie(res, token);
}

function createFeedBrowserSession(res, feed, source = "password") {
  const { token } = browserSessions.create({
    kind: "feed",
    feedId: Number(feed.id),
    name: feed.name,
    source,
  });
  setBrowserSessionCookie(res, token);
}

function createAdminSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  adminSessions.set(token, {
    userId: user.id,
    isGlobalAdmin: !!user.is_admin,
    isSuperAdmin: !!user.is_superadmin,
    createdAt: Date.now(),
    expiresAt: Date.now() + ADMIN_SESSION_TTL_MS,
  });
  return token;
}

function requireAdminSession(req, res, next) {
  const result = getAdminSession(req);
  if (!result) {
    return res.status(401).json({ error: "Admin login required" });
  }
  req.adminSession = result.session;
  req.adminToken = result.token;
  next();
}

function requireAdmin(req, res, next) {
  requireAdminSession(req, res, () => {
    if (!req.adminSession?.isGlobalAdmin) {
      return res.status(403).json({ error: "Global admin access required" });
    }
    next();
  });
}

function requireProductionManager(req, res, next) {
  requireAdminSession(req, res, () => {
    const productionId = Number(req.params.productionId || req.params.id);
    if (!Number.isFinite(productionId) || !getProductionById(productionId)) {
      return res.status(404).json({ error: "Production not found" });
    }
    if (
      !req.adminSession?.isGlobalAdmin
      && !isUserProductionAdmin(req.adminSession?.userId, productionId)
    ) {
      return res.status(403).json({ error: "Production admin access required" });
    }
    req.productionId = productionId;
    next();
  });
}

function requireSuperAdmin(req, res, next) {
  if (!req.adminSession?.isSuperAdmin) {
    return res.status(403).json({ error: "Superadmin required" });
  }
  next();
}

function isServerRestartSupported() {
  return isRunningInContainer() || process.env.TALKTOME_MANAGED_SERVER === "1";
}

function restartServerProcess() {
  if (containerRestartScheduled) return;
  containerRestartScheduled = true;

  // Give the response a moment to reach the browser before ending the current
  // process. Containers are restarted by their runtime. Native tray installs
  // use a dedicated exit code so their supervisor retains ownership of the
  // replacement process instead of the server spawning a detached child.
  setTimeout(() => {
    console.log("[ADMIN] Server restart requested.");
    const exitCode = !isRunningInContainer() && process.env.TALKTOME_MANAGED_SERVER === "1"
      ? 75
      : 0;
    server.close(() => process.exit(exitCode));
    setTimeout(() => process.exit(exitCode), 1_000).unref();
  }, 150).unref();
}

function writeAdminStatusEvent(stream, event, payload) {
  try {
    stream.res.write(`event: ${event}\n`);
    stream.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    adminStatusStreams.delete(stream);
    clearInterval(stream.heartbeat);
    return false;
  }
}

function scheduleAdminStatusBroadcast(reason = "status-changed") {
  if (adminStatusStreams.size === 0) return;
  pendingAdminStatusReason = reason;
  if (reason === "bridge-endpoint-updated") {
    pendingAdminStatusRefresh.users = true;
  } else if (reason === "bridge-feed-endpoint-updated") {
    pendingAdminStatusRefresh.feeds = true;
  } else if (
    reason === "conference-membership-added"
    || reason === "conference-membership-removed"
  ) {
    pendingAdminStatusRefresh.users = true;
    pendingAdminStatusRefresh.conferences = true;
  }
  if (adminStatusBroadcastTimer !== null) return;
  adminStatusBroadcastTimer = setTimeout(() => {
    adminStatusBroadcastTimer = null;
    const refresh = pendingAdminStatusRefresh;
    pendingAdminStatusRefresh = { users: false, conferences: false, feeds: false };
    const payload = {
      reason: pendingAdminStatusReason,
      refresh,
      snapshot: buildAdminStatusSnapshot(),
    };
    for (const stream of [...adminStatusStreams]) {
      writeAdminStatusEvent(stream, "status", payload);
    }
  }, 75);
}

function closeAdminStatusStreamsForToken(token, event = "auth-expired") {
  if (!token) return;
  for (const stream of [...adminStatusStreams]) {
    if (stream.token !== token) continue;
    writeAdminStatusEvent(stream, event, { reason: event });
    adminStatusStreams.delete(stream);
    clearInterval(stream.heartbeat);
    try {
      stream.res.end();
    } catch {}
  }
}

const COMPANION_DEFAULT_WAIT_MS = 1500;
const COMPANION_MAX_WAIT_MS = 10000;
const COMPANION_PENDING_TTL_MS = 30000;
const COMPANION_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const COMPANION_DEFAULT_VOLUME_STEP = 0.1;
const COMPANION_STATUS_STALE_MS = 45000;
const COMPANION_API_KEY_FILE = path.join(getDataDir(), "companion_api_key");

const companionUserState = new Map();
const companionPendingCommands = new Map();
const companionSessions = new Map();
let companionNamespace = null;

function markCompanionSocketSeen(socket) {
  if (!socket) return;
  const now = Date.now();
  socket.data.lastSeenAt = now;
  socket.data.lastSeenAtIso = new Date(now).toISOString();
  if (socket.data.statusStaleTimer) {
    clearTimeout(socket.data.statusStaleTimer);
  }
  socket.data.statusStaleTimer = setTimeout(() => {
    scheduleAdminStatusBroadcast("companion-stale");
  }, COMPANION_STATUS_STALE_MS + 250);
}

function clearCompanionStatusTimer(socket) {
  if (!socket?.data?.statusStaleTimer) return;
  clearTimeout(socket.data.statusStaleTimer);
  socket.data.statusStaleTimer = null;
}

function isCompanionSocketOnline(socket, now = Date.now()) {
  if (!socket?.connected) return false;
  const lastSeenAt = Number(socket.data?.lastSeenAt || socket.data?.connectedAt || 0);
  return lastSeenAt > 0 && now - lastSeenAt <= COMPANION_STATUS_STALE_MS;
}

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

function persistCompanionApiKey(apiKey) {
  const directory = path.dirname(COMPANION_API_KEY_FILE);
  const tempFile = path.join(
    directory,
    `.companion_api_key.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );

  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.writeFileSync(tempFile, apiKey, { mode: 0o600, flag: "wx" });
    fs.renameSync(tempFile, COMPANION_API_KEY_FILE);
    try {
      fs.chmodSync(COMPANION_API_KEY_FILE, 0o600);
    } catch {}
  } catch (err) {
    try {
      fs.unlinkSync(tempFile);
    } catch {}
    throw err;
  }
}

let companionApiKey = loadOrCreateCompanionApiKey();

function regenerateCompanionApiKey() {
  if (readCompanionApiKeyFromEnv()) {
    const err = new Error(
      "The API key is managed by COMPANION_API_KEY and cannot be regenerated in the Admin page.",
    );
    err.statusCode = 409;
    throw err;
  }

  const generated = crypto.randomBytes(32).toString("hex");
  persistCompanionApiKey(generated);
  companionApiKey = generated;
  console.log(`[COMPANION] Regenerated API key at ${COMPANION_API_KEY_FILE}`);
  return generated;
}

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

function generateBridgeToken() {
  return `ttm_bridge_${crypto.randomBytes(32).toString("hex")}`;
}

function hashBridgeToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function isValidBridgeTokenHash(candidate, expectedHash) {
  if (typeof candidate !== "string" || !candidate || typeof expectedHash !== "string" || !expectedHash) {
    return false;
  }
  const left = Buffer.from(hashBridgeToken(candidate), "hex");
  const right = Buffer.from(expectedHash, "hex");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function resolveBridgeTokenAuth(candidate) {
  if (typeof candidate !== "string" || !candidate.trim()) return null;
  for (const entry of bridgeRegistry.values()) {
    if (isValidBridgeTokenHash(candidate.trim(), entry.tokenHash)) {
      return {
        type: "bridge-token",
        bridgeId: entry.id,
        isAdmin: false,
        isSuperadmin: false,
      };
    }
  }
  for (const [bridgeId, entry] of bridgeTokenStore.entries()) {
    if (isValidBridgeTokenHash(candidate.trim(), entry.tokenHash)) {
      return {
        type: "bridge-token",
        bridgeId,
        isAdmin: false,
        isSuperadmin: false,
      };
    }
  }
  return null;
}

function resolveBridgeApiAuth(candidate) {
  const companionAuth = resolveCompanionAuth(candidate);
  if (companionAuth) {
    return {
      type: "companion",
      companionAuth,
      isAdmin: companionAuth.isAdmin,
      isSuperadmin: companionAuth.isSuperadmin,
    };
  }
  return resolveBridgeTokenAuth(candidate);
}

function hasBridgeGlobalAccess(auth) {
  return Boolean(auth?.type === "companion" && hasCompanionGlobalAccess(auth.companionAuth));
}

function canBridgeAuthAccessBridge(auth, bridgeId) {
  if (hasBridgeGlobalAccess(auth)) return true;
  if (auth?.type !== "bridge-token") return false;
  return normalizeBridgeId(auth.bridgeId) === normalizeBridgeId(bridgeId);
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

function resolveCompanionProduction(auth, value) {
  if (!areMultipleProductionsEnabled()) return getPrimaryProduction()?.id ?? null;
  if (value === null || value === undefined || value === "") {
    const primaryId = getPrimaryProduction()?.id ?? null;
    if (primaryId === null || hasCompanionGlobalAccess(auth) || isUserInProduction(auth?.userId, primaryId)) {
      return primaryId;
    }
    return getProductionsForUser(auth?.userId)[0]?.id ?? null;
  }
  const productionId = Number(value);
  if (!Number.isFinite(productionId) || !getProductionById(productionId)) {
    const error = new Error("Production not found");
    error.statusCode = 404;
    throw error;
  }
  if (!hasCompanionGlobalAccess(auth) && !isUserInProduction(auth?.userId, productionId)) {
    const error = new Error("User is not a member of this production");
    error.statusCode = 403;
    throw error;
  }
  return productionId;
}

function requireBridgeApiAuth(req, res, next) {
  const candidate = extractCompanionApiKeyFromRequest(req);
  const auth = resolveBridgeApiAuth(candidate);
  if (!candidate || !auth) {
    return res.status(401).json({ error: "Bridge authentication required" });
  }
  req.bridgeApiAuth = auth;
  req.companionAuth = auth.type === "companion" ? auth.companionAuth : null;
  next();
}

function normalizeBridgeRegistryText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, 200) : fallback;
}

function normalizeBridgeRegistryChannel(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 512) return null;
  return number;
}

function sanitizeBridgeChannelPairs(pairs = []) {
  if (!Array.isArray(pairs)) return [];
  const result = [];
  for (const pair of pairs.slice(0, 1024)) {
    const left = normalizeBridgeRegistryChannel(pair?.left_channel ?? pair?.leftChannel);
    const right = normalizeBridgeRegistryChannel(pair?.right_channel ?? pair?.rightChannel);
    if (left === null || right === null || (right !== left && right !== left + 1)) continue;
    result.push({
      label: normalizeBridgeRegistryText(pair?.label, right === left ? `${left}` : `${left}/${right}`),
      left_channel: left,
      right_channel: right,
    });
  }
  return result;
}

function buildBridgeChannelOptions(maxChannels, pairs = []) {
  const normalizedMaxChannels = Number(maxChannels);
  const result = [];
  const seen = new Set();
  const addOption = (left, right, label = null) => {
    if (!Number.isInteger(left) || !Number.isInteger(right) || left < 1 || right < 1) return;
    const key = `${left}:${right}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({
      label: normalizeBridgeRegistryText(label, left === right ? `${left}` : `${left}/${right}`),
      left_channel: left,
      right_channel: right,
    });
  };

  for (const pair of pairs) {
    addOption(pair.left_channel, pair.right_channel, pair.label);
  }

  if (Number.isInteger(normalizedMaxChannels) && normalizedMaxChannels > 0) {
    for (let channel = 1; channel <= normalizedMaxChannels; channel += 1) {
      addOption(channel, channel);
    }
    for (let left = 1; left < normalizedMaxChannels; left += 2) {
      addOption(left, left + 1);
    }
  }

  return result;
}

function sanitizeBridgeInventory(inventory = {}) {
  const devices = Array.isArray(inventory.devices) ? inventory.devices : [];
  return {
    host: normalizeBridgeRegistryText(inventory.host, "unknown"),
    devices: devices.slice(0, 256).map((device, index) => {
      const direction = device?.direction === "output" ? "output" : "input";
      const id = normalizeBridgeRegistryText(device?.id, `${direction}-${index}`);
      const name = normalizeBridgeRegistryText(device?.name, id);
      const maxChannels = normalizeBridgeRegistryChannel(device?.max_channels ?? device?.maxChannels) || 0;
      const channelPairs = sanitizeBridgeChannelPairs(device?.channel_pairs ?? device?.channelPairs);
      return {
        id,
        name,
        direction,
        is_default: Boolean(device?.is_default ?? device?.isDefault),
        max_channels: maxChannels,
        supports_48k: Boolean(device?.supports_48k ?? device?.supports48k),
        channel_pairs: buildBridgeChannelOptions(maxChannels, channelPairs),
      };
    }),
  };
}

function normalizeBridgeId(value) {
  const normalized = normalizeBridgeRegistryText(value);
  if (!normalized) return crypto.randomUUID();
  return normalized.replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 120) || crypto.randomUUID();
}

function serializeBridgeRegistryEntry(entry, now = Date.now()) {
  return {
    id: entry.id,
    name: entry.name,
    platform: entry.platform || "unknown",
    host: entry.inventory.host,
    inventory: entry.inventory,
    connectedAt: entry.firstSeenAtIso || entry.lastSeenAtIso,
    lastSeenAt: entry.lastSeenAtIso,
    remoteAddress: entry.remoteAddress || null,
    stale: now - entry.lastSeenAtMs > BRIDGE_REGISTRY_STALE_MS,
  };
}

function getBridgeRegistrySnapshot() {
  const now = Date.now();
  return [...bridgeRegistry.values()]
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }))
    .map((entry) => serializeBridgeRegistryEntry(entry, now));
}

function buildBridgeRuntimeConfig(bridgeId) {
  const normalizedBridgeId = normalizeBridgeId(bridgeId);
  const serializeTriggerTargets = (userId) => getBridgeTargetsForUser(userId)
    .map((target) => ({
      type: target.targetType,
      id: Number(target.targetId),
      name: target.name || `${target.targetType} ${target.targetId}`,
    }));
  const userPorts = getBridgeEndpointsForDevice(normalizedBridgeId).map((row) => {
    return {
      id: `user-${row.user_id}`,
      kind: "user",
      userId: Number(row.user_id),
      feedId: null,
      label: row.user_name || `User ${row.user_id}`,
      enabled: true,
      input: {
        deviceId: row.input_device,
        leftChannel: Number(row.input_left_channel),
        rightChannel: Number(row.input_right_channel),
      },
      output: {
        deviceId: row.output_device,
        leftChannel: Number(row.output_left_channel),
        rightChannel: Number(row.output_right_channel),
      },
      trigger: {
        mode: row.trigger_mode === "audio-level" ? "audio-level" : "external",
        target: row.trigger_target_type && row.trigger_target_id
          ? {
              type: row.trigger_target_type,
              id: Number(row.trigger_target_id),
            }
          : null,
        thresholdDb: Number.isFinite(Number(row.trigger_threshold_db))
          ? Number(row.trigger_threshold_db)
          : -45,
      },
      triggerTargets: serializeTriggerTargets(row.user_id),
      updatedAt: row.updated_at || null,
    };
  });
  const feedPorts = getFeedBridgeEndpointsForDevice(normalizedBridgeId).map((row) => {
    return {
      id: `feed-${row.feed_id}`,
      kind: "feed",
      userId: null,
      feedId: Number(row.feed_id),
      label: row.feed_name || `Feed ${row.feed_id}`,
      enabled: true,
      input: {
        deviceId: row.input_device,
        leftChannel: Number(row.input_left_channel),
        rightChannel: Number(row.input_right_channel),
      },
      output: null,
      updatedAt: row.updated_at || null,
    };
  });
  const ports = [...userPorts, ...feedPorts];
  const signature = JSON.stringify(ports);
  return {
    bridgeId: normalizedBridgeId,
    revision: crypto.createHash("sha256").update(signature).digest("hex").slice(0, 16),
    ports,
  };
}

function allowBridgeCors(req, res, next) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization,x-api-key,content-type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
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

  const rawVolume = Number(state.volume);
  const volume = Number.isFinite(rawVolume)
    ? Math.min(1, Math.max(0, rawVolume))
    : null;

  return {
    targetType: rawType,
    targetId,
    muted: Boolean(state.muted),
    volume,
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

function resolveUserIdFromTargetIdentity(rawId) {
  if (rawId === null || rawId === undefined || rawId === "") {
    return null;
  }

  const socketId = typeof rawId === "string" ? rawId.trim() : "";
  if (socketId) {
    const peer = peers.get(socketId);
    if (peer?.kind === "user" && peer.userId !== null && peer.userId !== undefined) {
      const peerUserId = Number(peer.userId);
      if (Number.isFinite(peerUserId)) {
        return peerUserId;
      }
    }
  }

  const numericId = Number(rawId);
  if (Number.isFinite(numericId)) {
    const user = getUserById(numericId);
    if (isCompanionAddressableUser(user)) {
      return Number(user.id);
    }
  }

  const found = findUserPeerByUserId(rawId);
  if (found?.peer?.userId !== null && found?.peer?.userId !== undefined) {
    const peerUserId = Number(found.peer.userId);
    if (Number.isFinite(peerUserId)) {
      return peerUserId;
    }
  }

  return null;
}

function isOperatorPeer(peer) {
  return Boolean(peer && (peer.kind === "user" || peer.kind === "guest"));
}

function isPersistentUserPeer(peer) {
  return Boolean(peer && peer.kind === "user" && peer.userId !== null && peer.userId !== undefined);
}

function findGuestPeerByGuestId(guestId) {
  const key = String(guestId ?? "");
  if (!key) return null;
  for (const [socketId, peer] of peers) {
    if (peer?.kind === "guest" && String(peer.guestId || "") === key) {
      return { socketId, peer };
    }
  }
  return null;
}

function normalizeRuntimeTalkTarget(target) {
  if (!target || typeof target !== "object") return null;
  const rawType = typeof target.type === "string" ? target.type.trim().toLowerCase() : "";

  if (rawType === "guest") {
    const guestId = String(target.id ?? "").trim();
    if (!guestId) {
      return null;
    }
    return { type: "guest", id: guestId };
  }

  const normalized = normalizeCompanionTarget(target);
  if (!normalized) return null;

  if (normalized.type === "conference") {
    const conferenceId = Number(normalized.id);
    if (!Number.isFinite(conferenceId)) {
      return null;
    }
    return { type: "conference", id: conferenceId };
  }
  const userId = resolveUserIdFromTargetIdentity(normalized.id);
  if (!Number.isFinite(userId)) {
    return null;
  }

  return { type: "user", id: Number(userId) };
}

function normalizeRuntimeTalkTargets(targets) {
  if (!Array.isArray(targets)) {
    return [];
  }

  const normalizedTargets = [];
  const seen = new Set();
  for (const rawTarget of targets) {
    const target = normalizeRuntimeTalkTarget(rawTarget);
    if (!target) continue;
    const key = `${target.type}:${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedTargets.push(target);
  }

  return normalizedTargets;
}

function normalizeCompanionVisibleRuntimeTalkTarget(target) {
  const normalized = normalizeRuntimeTalkTarget(target);
  if (!normalized || normalized.type === "guest") {
    return null;
  }
  return normalized;
}

function normalizeCompanionVisibleRuntimeTalkTargets(targets) {
  if (!Array.isArray(targets)) {
    return [];
  }
  const normalizedTargets = [];
  const seen = new Set();
  for (const rawTarget of targets) {
    const target = normalizeCompanionVisibleRuntimeTalkTarget(rawTarget);
    if (!target) continue;
    const key = `${target.type}:${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedTargets.push(target);
  }
  return normalizedTargets;
}

function isLiveTalkProducerAppData(appData) {
  const type = typeof appData?.type === "string" ? appData.type.trim().toLowerCase() : "";
  return type === "talk" || type === "user" || type === "conference" || type === "guest";
}

function getPeerTalkProducers(peer, { includePaused = false } = {}) {
  if (!isOperatorPeer(peer)) {
    return [];
  }

  return Array.from(peer.producers.values()).filter((producer) => (
    producer
    && (includePaused || !producer.paused)
    && isLiveTalkProducerAppData(producer.appData)
  ));
}

function getPeerActiveTalkProducers(peer) {
  return getPeerTalkProducers(peer);
}

function getPeerActiveTalkTargets(peer) {
  if (peer?.pttTalking) {
    return normalizeRuntimeTalkTargets(peer.activeTalkTargets)
      .filter((target) => isTalkTargetAllowedForPeer(peer, target));
  }

  const activeProducers = getPeerActiveTalkProducers(peer);
  if (activeProducers.length === 0) {
    return [];
  }

  const hasGenericTalkProducer = activeProducers.some((producer) => (
    String(producer?.appData?.type || "").trim().toLowerCase() === "talk"
  ));

  if (hasGenericTalkProducer) {
    return normalizeRuntimeTalkTargets(peer.activeTalkTargets)
      .filter((target) => isTalkTargetAllowedForPeer(peer, target));
  }

  return normalizeRuntimeTalkTargets(
    activeProducers.map((producer) => ({
      type: producer?.appData?.type,
      id: producer?.appData?.id,
    }))
  ).filter((target) => isTalkTargetAllowedForPeer(peer, target));
}

function getPeerActiveTalkInfo(peer) {
  if (!isOperatorPeer(peer)) {
    return null;
  }

  if (peer.pttTalking) {
    const targets = getPeerActiveTalkTargets(peer);
    if (targets.length === 0) {
      return null;
    }
    return {
      target: targets[0],
      targets,
      at: Number(peer.pttStartedAt) || Date.now(),
    };
  }

  const activeProducers = getPeerActiveTalkProducers(peer);
  if (activeProducers.length === 0) {
    return null;
  }

  let latestAt = 0;
  for (const producer of activeProducers) {
    const startedAt = Number(producer.__startedAt);
    const at = Number.isFinite(startedAt) ? startedAt : Date.now();
    if (at >= latestAt) latestAt = at;
  }

  const targets = getPeerActiveTalkTargets(peer);
  if (targets.length === 0) {
    return null;
  }

  return {
    target: targets[0] || null,
    targets,
    at: latestAt || Date.now(),
  };
}

function resolveAddressedUserIdsForTarget(target, speakerUserId) {
  if (!target) {
    return [];
  }

  if (target.type === "user") {
    const targetUserId = resolveUserIdFromTargetIdentity(target.id);
    if (!Number.isFinite(targetUserId) || Number(targetUserId) === Number(speakerUserId)) {
      return [];
    }
    return [Number(targetUserId)];
  }

  if (target.type === "conference") {
    const conferenceId = Number(target.id);
    if (!Number.isFinite(conferenceId)) {
      return [];
    }

    if (areMultipleProductionsEnabled()) {
      const activeMembers = new Set();
      for (const peer of peers.values()) {
        if (!isPeerMemberOfConference(peer, conferenceId)) continue;
        const userId = peer.kind === "guest" ? peer.guestProfileUserId : peer.userId;
        const numericUserId = Number(userId);
        if (Number.isFinite(numericUserId) && numericUserId !== Number(speakerUserId)) {
          activeMembers.add(numericUserId);
        }
      }
      return Array.from(activeMembers);
    }

    const primaryProductionId = getPrimaryProduction()?.id ?? null;
    return Array.from(new Set(
      (primaryProductionId === null ? [] : getProductionUsersForConference(conferenceId, primaryProductionId))
        .map((member) => Number(member?.id))
        .filter((userId) => Number.isFinite(userId) && Number(userId) !== Number(speakerUserId))
    ));
  }

  return [];
}

function resolveAddressedUserIdsForTargets(targets, speakerUserId) {
  const recipientUserIds = new Set();
  for (const target of normalizeRuntimeTalkTargets(targets)) {
    for (const userId of resolveAddressedUserIdsForTarget(target, speakerUserId)) {
      recipientUserIds.add(Number(userId));
    }
  }
  return Array.from(recipientUserIds);
}

function getRecipientKeyForPeer(peer) {
  if (isPersistentUserPeer(peer)) {
    return `user:${Number(peer.userId)}`;
  }
  if (peer?.kind === "guest" && peer.guestId) {
    return `guest:${String(peer.guestId)}`;
  }
  return null;
}

function getRecipientKeyForUserId(userId) {
  const numericUserId = Number(userId);
  return Number.isFinite(numericUserId) ? `user:${numericUserId}` : null;
}

function isPeerMemberOfConference(peer, conferenceId) {
  const numericConferenceId = Number(conferenceId);
  if (!Number.isFinite(numericConferenceId) || !isOperatorPeer(peer)) {
    return false;
  }
  return getEffectiveConferencesForPeer(peer)
    .some((conference) => Number(conference?.id) === numericConferenceId);
}

function arePeersInSameActiveProduction(firstPeer, secondPeer) {
  return arePeersInSameActiveProductionScope(
    firstPeer,
    secondPeer,
    areMultipleProductionsEnabled()
  );
}

function isTalkTargetAllowedForPeer(peer, target) {
  if (!target || !isOperatorPeer(peer)) return false;
  if (target.type !== "conference") return true;
  if (!isPeerMemberOfConference(peer, target.id)) return false;
  if (!areMultipleProductionsEnabled() || peer.productionId == null) return true;

  const userId = peer.kind === "guest" ? peer.guestProfileUserId : peer.userId;
  return getProductionTargets(userId, peer.productionId).some((candidate) => (
    candidate?.targetType === "conference"
    && Number(candidate?.targetId) === Number(target.id)
    && candidate.canTalk !== false
  ));
}

function resolveRecipientPeersForTarget(target, speakerSocketId) {
  if (!target) return [];
  const recipients = [];
  const seen = new Set();
  const speakerPeer = peers.get(speakerSocketId);

  const addRecipient = (socketId, peer) => {
    if (
      !socketId
      || socketId === speakerSocketId
      || !isOperatorPeer(peer)
      || !canRouteTargetBetweenPeers(
        target,
        speakerPeer,
        peer,
        areMultipleProductionsEnabled()
      )
      || seen.has(socketId)
    ) {
      return;
    }
    seen.add(socketId);
    recipients.push({ socketId, peer });
  };

  if (target.type === "user") {
    const found = findUserPeerByUserId(target.id);
    addRecipient(found?.socketId, found?.peer);
    return recipients;
  }

  if (target.type === "guest") {
    const found = findGuestPeerByGuestId(target.id);
    addRecipient(found?.socketId, found?.peer);
    return recipients;
  }

  if (target.type === "conference") {
    for (const [socketId, peer] of peers) {
      if (isPeerMemberOfConference(peer, target.id)) {
        addRecipient(socketId, peer);
      }
    }
  }

  return recipients;
}

function buildSpeakerReplyTarget(speakerPeer, activeTarget) {
  if (speakerPeer?.kind === "guest" && speakerPeer.guestId) {
    return {
      replyTargetType: "guest",
      replyTargetId: String(speakerPeer.guestId),
    };
  }

  if (isPersistentUserPeer(speakerPeer)) {
    const speakerUserId = Number(speakerPeer.userId);
    if (activeTarget?.type === "conference") {
      return {
        replyTargetType: "conference",
        replyTargetId: Number(activeTarget.id),
      };
    }
    return {
      replyTargetType: "user",
      replyTargetId: speakerUserId,
    };
  }

  return {};
}

function buildAddressedEntry(target, speakerPeer, fromName, at) {
  if (!target || !isOperatorPeer(speakerPeer)) {
    return null;
  }
  const speakerReplyTarget = buildSpeakerReplyTarget(speakerPeer, target);
  const fromUserId = isPersistentUserPeer(speakerPeer) ? Number(speakerPeer.userId) : null;
  const fromGuestId = speakerPeer.kind === "guest" ? String(speakerPeer.guestId || "") : null;

  if (target.type === "user") {
    return {
      fromUserId,
      fromGuestId,
      fromName: fromName || null,
      targetType: fromGuestId ? "guest" : "user",
      targetId: fromGuestId || fromUserId,
      ...speakerReplyTarget,
      at,
    };
  }

  if (target.type === "guest") {
    return {
      fromUserId,
      fromGuestId,
      fromName: fromName || null,
      targetType: fromGuestId ? "guest" : "user",
      targetId: fromGuestId || fromUserId,
      ...speakerReplyTarget,
      at,
    };
  }

  if (target.type === "conference") {
    const conferenceId = Number(target.id);
    if (!Number.isFinite(conferenceId)) {
      return null;
    }

    return {
      fromUserId,
      fromGuestId,
      fromName: fromName || null,
      targetType: "conference",
      targetId: conferenceId,
      ...speakerReplyTarget,
      at,
    };
  }

  return null;
}

function mergeAddressedNowEntry(targetMap, targetUserId, entry) {
  const key = String(targetUserId || "");
  if (!key || !entry) {
    return;
  }

  let list = targetMap.get(key);
  if (!list) {
    list = [];
    targetMap.set(key, list);
  }

  const speakerKey = entry.fromGuestId
    ? `guest:${entry.fromGuestId}`
    : Number.isFinite(Number(entry.fromUserId))
    ? Number(entry.fromUserId)
    : String(entry.fromName || "").trim().toLowerCase();
  const entryKey = `${entry.targetType}:${entry.targetId}:${speakerKey}`;
  const existingIndex = list.findIndex((candidate) => (
    `${candidate.targetType}:${candidate.targetId}:${
      candidate?.fromGuestId
        ? `guest:${candidate.fromGuestId}`
        : Number.isFinite(Number(candidate?.fromUserId))
        ? Number(candidate.fromUserId)
        : String(candidate?.fromName || "").trim().toLowerCase()
    }` === entryKey
  ));

  if (existingIndex === -1) {
    list.push(entry);
    return;
  }

  const existing = list[existingIndex];
  if (Number(entry.at) >= Number(existing?.at || 0)) {
    list[existingIndex] = entry;
  }
}

function setReplyEntry(targetMap, targetUserId, entry) {
  const key = String(targetUserId || "");
  if (!key || !entry) {
    return;
  }

  const existing = targetMap.get(key);
  if (!existing || Number(entry.at) >= Number(existing?.at || 0)) {
    targetMap.set(key, entry);
  }
}

function rememberIncomingReplyEntry(targetUserId, entry) {
  const userId = Number(targetUserId);
  if (!Number.isFinite(userId) || !entry) {
    return;
  }

  const state = ensureCompanionUserState(userId);
  const existing = state.lastIncomingReplyEntry;
  if (!existing || Number(entry.at) >= Number(existing?.at || 0)) {
    state.lastIncomingReplyEntry = entry;
    state.updatedAt = Date.now();
  }
}

function buildIncomingTalkStateSnapshot() {
  const addressedNowByRecipient = new Map();
  const replyTargetByRecipient = new Map();

  for (const [speakerSocketId, peer] of peers) {
    if (!isOperatorPeer(peer)) continue;
    const speakerUserId = isPersistentUserPeer(peer) ? Number(peer.userId) : null;
    const base = speakerUserId !== null ? ensureCompanionUserState(speakerUserId, peer?.name || null) : null;
    const activeTalk = getPeerActiveTalkInfo(peer);
    const speakerName = peer?.name || base?.userName || (speakerUserId !== null ? `User ${speakerUserId}` : "Guest");

    const activeTargets = Array.isArray(activeTalk?.targets) ? activeTalk.targets : [];
    const activeAt = Number.isFinite(Number(activeTalk?.at))
      ? Number(activeTalk.at)
      : Number(base?.updatedAt) || Date.now();

    if (activeTargets.length > 0) {
      for (const activeTarget of activeTargets) {
        if (!isTalkTargetAllowedForPeer(peer, activeTarget)) continue;
        const activeEntry = buildAddressedEntry(activeTarget, peer, speakerName, activeAt);
        if (!activeEntry) continue;
        const addressedPeers = resolveRecipientPeersForTarget(activeTarget, speakerSocketId);
        for (const addressedPeer of addressedPeers) {
          const recipientKey = getRecipientKeyForPeer(addressedPeer.peer);
          if (!recipientKey) continue;
          const canReply = activeEntry.replyTargetType !== "conference"
            || isTalkTargetAllowedForPeer(addressedPeer.peer, {
              type: "conference",
              id: activeEntry.replyTargetId,
            });
          const recipientEntry = { ...activeEntry, canReply };
          mergeAddressedNowEntry(addressedNowByRecipient, recipientKey, recipientEntry);
          setReplyEntry(replyTargetByRecipient, recipientKey, recipientEntry);
          if (isPersistentUserPeer(addressedPeer.peer)) {
            rememberIncomingReplyEntry(addressedPeer.peer.userId, recipientEntry);
          }
        }
      }
    }
  }

  for (const user of getCompanionAddressableUsers()) {
    const userId = Number(user?.id);
    if (!Number.isFinite(userId)) {
      continue;
    }

    const base = ensureCompanionUserState(userId, user?.name || null);
    if (base.lastIncomingReplyEntry) {
      setReplyEntry(replyTargetByRecipient, getRecipientKeyForUserId(userId), base.lastIncomingReplyEntry);
    }
  }

  return {
    addressedNowByRecipient,
    replyTargetByRecipient,
  };
}

function buildIncomingTalkStateForUser(userId, snapshot = null) {
  const normalizedUserId = Number(userId);
  const recipientKey = getRecipientKeyForUserId(normalizedUserId);
  return buildIncomingTalkStateForRecipientKey(recipientKey, snapshot);
}

function buildIncomingTalkStateForRecipientKey(recipientKey, snapshot = null) {
  const activeSnapshot = snapshot || buildIncomingTalkStateSnapshot();
  const addressedNow = recipientKey && Array.isArray(activeSnapshot?.addressedNowByRecipient?.get(recipientKey))
    ? [...activeSnapshot.addressedNowByRecipient.get(recipientKey)]
    : [];
  addressedNow.sort((left, right) => Number(right?.at || 0) - Number(left?.at || 0));

  return {
    addressedNow,
    replyTarget: recipientKey ? activeSnapshot?.replyTargetByRecipient?.get(recipientKey) || null : null,
  };
}

function sanitizeCompanionIncomingEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (entry.targetType !== "user" && entry.targetType !== "conference") {
    return null;
  }
  const targetId = Number(entry.targetId);
  if (!Number.isFinite(targetId)) {
    return null;
  }
  return {
    targetType: entry.targetType,
    targetId,
    fromUserId: Number.isFinite(Number(entry.fromUserId)) ? Number(entry.fromUserId) : null,
    fromName: entry.fromName || null,
    at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : 0,
  };
}

function sanitizeCompanionIncomingTalkState(state) {
  const addressedNow = (Array.isArray(state?.addressedNow) ? state.addressedNow : [])
    .map(sanitizeCompanionIncomingEntry)
    .filter(Boolean);
  return {
    addressedNow,
    replyTarget: sanitizeCompanionIncomingEntry(state?.replyTarget),
  };
}

function parseCompanionWaitMs(raw) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return COMPANION_DEFAULT_WAIT_MS;
  }
  return Math.min(COMPANION_MAX_WAIT_MS, Math.max(100, Math.round(parsed)));
}

function resolveLegacyAllConferenceId() {
  const legacy = (getAllConferences() || []).find((conference) => (
    String(conference?.name || '').trim().toLowerCase() === 'all'
  ));
  const id = Number(legacy?.id);
  return Number.isFinite(id) ? id : null;
}

function normalizeTalkCommandInput(input = {}) {
  let { action, targetType = "conference", targetId = null, inputKey = null } = input || {};

  if (!["press", "release", "lock-toggle"].includes(action)) {
    return { ok: false, status: 400, error: "action must be press, release, or lock-toggle" };
  }

  const normalizedType = typeof targetType === "string" ? targetType.trim().toLowerCase() : "conference";
  targetType = normalizedType;

  if (targetType === "reply") {
    targetId = undefined;
  } else {
    const isLegacyAllTarget = targetType === "all" || targetType === "global";
    if (isLegacyAllTarget) {
      const allConferenceId = resolveLegacyAllConferenceId();
      if (allConferenceId === null) {
        return {
          ok: false,
          status: 404,
          error: "Conference 'All' not found. Create a conference and select it explicitly.",
        };
      }
      targetType = "conference";
      targetId = allConferenceId;
    }

    if (targetType === "conference" || targetType === "user") {
      const numericTargetId = Number(targetId);
      if (!Number.isFinite(numericTargetId)) {
        const errorLabel = targetType === "conference" ? "conference" : "user";
        return { ok: false, status: 400, error: `Invalid ${errorLabel} id` };
      }
      targetId = numericTargetId;
    } else {
      return { ok: false, status: 400, error: "targetType must be conference, user, or reply" };
    }
  }

  const normalizedInputKey = typeof inputKey === "string" ? inputKey.trim() : "";
  const payload = targetType === "reply"
    ? { action, targetType }
    : { action, targetType, targetId };
  if (normalizedInputKey) {
    payload.inputKey = normalizedInputKey;
  }

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

function findFeedPeerByFeedId(feedId) {
  const key = String(feedId);
  for (const [socketId, peer] of peers) {
    if (peer?.kind === "feed" && peer.feedId != null && String(peer.feedId) === key) {
      return { socketId, peer };
    }
  }
  return null;
}

function disconnectUserPeerForLogout({ userId = null, socketId = null } = {}) {
  const normalizedUserId = Number(userId);
  const hasUserId = Number.isFinite(normalizedUserId);
  const normalizedSocketId =
    typeof socketId === "string" && socketId.trim() ? socketId.trim() : null;

  let target = null;
  if (normalizedSocketId) {
    const peer = peers.get(normalizedSocketId);
    if (!peer || peer.kind !== "user") {
      return false;
    }
    if (hasUserId && String(peer.userId) !== String(normalizedUserId)) {
      return false;
    }
    target = { socketId: normalizedSocketId, peer };
  }

  if (!target && hasUserId) {
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
  return getPeerActiveTalkInfo(peer)?.target || null;
}

function ensureCompanionUserState(userId, fallbackName = null) {
  const key = String(userId);
  let state = companionUserState.get(key);
  if (!state) {
    const persistedTargetAudioStates = getUserTargetAudioStates(userId);
    state = {
      userId,
      userName: fallbackName || null,
      online: false,
      socketId: null,
      talking: false,
      talkLocked: false,
      currentTarget: null,
      currentTargets: [],
      lastTarget: null,
      lastTargets: [],
      lastIncomingReplyEntry: null,
      targetAudioStates: persistedTargetAudioStates,
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

function buildCompanionUserState(userId, fallbackName = null, incomingSnapshot = null, productionId = null) {
  const base = ensureCompanionUserState(userId, fallbackName);
  const found = findUserPeerByUserId(userId);
  const peer = found?.peer || null;
  const socketId = found?.socketId || null;
  const activeTalkInfo = peer ? getPeerActiveTalkInfo(peer) : null;
  const activeRuntimeTargets = Array.isArray(activeTalkInfo?.targets) ? activeTalkInfo.targets : [];
  const activeTargets = normalizeCompanionVisibleRuntimeTalkTargets(activeRuntimeTargets);
  const activeTarget = normalizeCompanionVisibleRuntimeTalkTarget(activeTalkInfo?.target) || activeTargets[0] || null;
  const currentTarget = activeTarget || null;
  const talking = Boolean(found && activeTargets.length > 0);
  const resolvedName = peer?.name || base.userName || fallbackName || null;
  const lastTargets = normalizeCompanionVisibleRuntimeTalkTargets(base.lastTargets);
  const lastTarget = normalizeCompanionVisibleRuntimeTalkTarget(base.lastTarget) || lastTargets[0] || currentTarget || null;
  const incomingTalkState = sanitizeCompanionIncomingTalkState(buildIncomingTalkStateForUser(userId, incomingSnapshot));
  const tally = getTallyState(productionId);

  return {
    userId,
    name: resolvedName,
    socketId,
    online: Boolean(found),
    talking,
    talkLocked: Boolean(base.talkLocked && found),
    currentTarget: talking ? currentTarget : null,
    currentTargets: talking ? activeTargets : [],
    lastTarget,
    lastTargets: lastTargets.length > 0 ? lastTargets : (lastTarget ? [lastTarget] : []),
    lastSpokeAt: base.lastSpokeAt || null,
    cutCamera: Boolean(resolvedName && tally.pgmUser === resolvedName),
    previewCamera: Boolean(resolvedName && tally.prvUser === resolvedName),
    lastCommandId: base.lastCommandId || null,
    lastCommandResult: base.lastCommandResult || null,
    targetAudioStates: normalizeCompanionTargetAudioStates(base.targetAudioStates),
    addressedNow: incomingTalkState.addressedNow,
    replyTarget: incomingTalkState.replyTarget,
    updatedAt: base.updatedAt || null,
  };
}

function buildOperatorTargetsForUser(userId, productionId = null) {
  const numericProductionId = productionId === null || productionId === undefined || productionId === ""
    ? Number(getPrimaryProduction()?.id)
    : Number(productionId);
  if (Number.isFinite(numericProductionId)) {
    if (!Number.isFinite(numericProductionId) || !isUserInProduction(userId, numericProductionId)) {
      const error = new Error("User is not a member of this production");
      error.statusCode = 403;
      throw error;
    }
  }

  const targets = Number.isFinite(numericProductionId)
    ? (getProductionTargets(userId, numericProductionId) || [])
    : [];

  return targets.map((target) => {
    if (target?.targetType !== "conference") {
      return target;
    }

    const conferenceId = Number(target.targetId);
    const members = Number.isFinite(conferenceId)
      ? (Number.isFinite(numericProductionId)
        ? getProductionUsersForConference(conferenceId, numericProductionId)
        : []
      ).map((member) => ({
        userId: Number(member.id),
        name: member.name || String(member.id),
      }))
      : [];

    return {
      ...target,
      canTalk: target.canTalk !== false && Number(target.canTalk) !== 0,
      members,
    };
  });
}

function filterSystemInternalTargets(targets = []) {
  return Array.isArray(targets) ? targets : [];
}

function isCompanionAddressableUser(user) {
  return Boolean(user && !user.is_superadmin && !user.is_guest_profile);
}

function isCompanionAddressableUserId(userId) {
  const user = getUserById(userId);
  return isCompanionAddressableUser(user);
}

function getCompanionAddressableUsers() {
  return getAllUsers().filter(isCompanionAddressableUser);
}

function buildCompanionSnapshot(productionId = null) {
  const incomingSnapshot = buildIncomingTalkStateSnapshot();
  const productionMemberIds = productionId === null
    ? null
    : new Set(getProductionMembers(productionId).map((member) => Number(member.id)));
  const users = getCompanionAddressableUsers()
    .filter((user) => productionMemberIds === null || productionMemberIds.has(Number(user.id)))
    .map((user) => ({
    id: user.id,
    name: user.name,
    state: buildCompanionUserState(user.id, user.name, incomingSnapshot, productionId),
  }));

  return {
    version: 1,
    serverTime: new Date().toISOString(),
    cutCameraUser: getTallyState(productionId).pgmUser,
    previewCameraUser: getTallyState(productionId).prvUser,
    tally: {
      productionId,
      ...getTallyState(productionId),
    },
    users,
    conferences: productionId === null ? getAllConferences() : getProductionConferences(productionId),
    feeds: productionId === null ? getAllFeeds() : getProductionFeeds(productionId),
    production: productionId === null ? null : getProductionById(productionId),
  };
}

function buildCompanionSnapshotForAuth(auth, productionId = null) {
  return {
    ...buildCompanionSnapshot(productionId),
    scope: buildCompanionAuthScope(auth),
  };
}

function emitCompanionEvent(event, payload = {}) {
  if (!companionNamespace) return;
  for (const socket of companionNamespace.sockets.values()) {
    const productionId = socket.data?.productionId ?? null;
    if (productionId === null) {
      socket.emit(event, payload);
      continue;
    }
    const userId = Number(payload?.userId ?? payload?.state?.userId ?? payload?.state?.id);
    if (Number.isFinite(userId) && !isUserInProduction(userId, productionId)) continue;
    socket.emit(event, payload);
  }
}

function emitCompanionUserState(userId, reason = "state-updated", fallbackName = null, incomingSnapshot = null) {
  if (!isCompanionAddressableUserId(userId)) return;
  if (!companionNamespace) return;
  for (const socket of companionNamespace.sockets.values()) {
    const productionId = socket.data?.productionId ?? getDefaultTallyProductionId();
    if (productionId !== null && !isUserInProduction(userId, productionId)) continue;
    socket.emit("user-state", {
      reason,
      at: new Date().toISOString(),
      state: buildCompanionUserState(userId, fallbackName, incomingSnapshot, productionId),
    });
  }
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
  const activeTalkInfo = getPeerActiveTalkInfo(peer);
  const activeRuntimeTargets = Array.isArray(activeTalkInfo?.targets) ? activeTalkInfo.targets : [];
  const activeTargets = normalizeCompanionVisibleRuntimeTalkTargets(activeRuntimeTargets);
  const activeTarget = normalizeCompanionVisibleRuntimeTalkTarget(activeTalkInfo?.target) || activeTargets[0] || null;
  const patch = {
    userName: peer.name || null,
    online: true,
    socketId: peer.socket?.id || null,
    talking: activeTargets.length > 0,
    currentTarget: activeTarget,
    currentTargets: activeTargets,
  };
  if (activeTarget) {
    patch.lastTarget = activeTarget;
    patch.lastTargets = activeTargets;
  } else {
    patch.talkLocked = false;
    patch.lastSpokeAt = Date.now();
  }
  updateCompanionUserState(peer.userId, patch, { reason, fallbackName: peer.name || null });
}

function emitClientIncomingTalkState(peer, reason = "incoming-talk-state", incomingSnapshot = null) {
  if (!isOperatorPeer(peer)) {
    return;
  }
  const recipientKey = getRecipientKeyForPeer(peer);
  if (!recipientKey) return;

  peer.socket.emit("incoming-talk-state", {
    reason,
    at: new Date().toISOString(),
    state: {
      userId: isPersistentUserPeer(peer) ? Number(peer.userId) : null,
      guestId: peer.kind === "guest" ? String(peer.guestId || "") : null,
      ...buildIncomingTalkStateForRecipientKey(recipientKey, incomingSnapshot),
    },
  });
}

function broadcastRuntimeUserStates(reason = "runtime-state-changed") {
  const incomingSnapshot = buildIncomingTalkStateSnapshot();

  for (const [, peer] of peers) {
    if (!isOperatorPeer(peer)) {
      continue;
    }
    emitClientIncomingTalkState(peer, reason, incomingSnapshot);
  }

  for (const user of getCompanionAddressableUsers()) {
    emitCompanionUserState(user.id, reason, user.name, incomingSnapshot);
  }
  scheduleAdminStatusBroadcast(reason);
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
const RTC_PORT_RANGE = resolveActiveRtcPortRange(loadRuntimeConfig() || {});

// Tally is transient and scoped to the active production.
const tallyState = createTallyStateStore();

function getDefaultTallyProductionId() {
  return getPrimaryProduction()?.id ?? null;
}

function getTallyState(productionId = null) {
  return tallyState.get(productionId ?? getDefaultTallyProductionId());
}

function buildPeerTallyState(peer) {
  const productionId = peer?.productionId ?? getDefaultTallyProductionId();
  const state = getTallyState(productionId);
  return {
    productionId,
    pgm: Boolean(peer?.name && peer.name === state.pgmUser),
    prv: Boolean(peer?.name && peer.name === state.prvUser),
  };
}

function emitPeerTallyState(peer) {
  if (peer?.socket && isOperatorPeer(peer)) {
    peer.socket.emit("cut-camera", buildPeerTallyState(peer));
  }
}

function emitProductionTallyState(productionId) {
  for (const peer of peers.values()) {
    if (!isOperatorPeer(peer)) continue;
    if (String(peer.productionId ?? "") !== String(productionId ?? "")) continue;
    emitPeerTallyState(peer);
  }
}

function emitCompanionTallyEvent(productionId, payload) {
  if (!companionNamespace) return;
  for (const socket of companionNamespace.sockets.values()) {
    if (String(socket.data?.productionId ?? "") !== String(productionId ?? "")) continue;
    socket.emit("cut-camera", payload);
  }
}

// === GET ===
app.get("/users", requireAdmin, (req, res) => {
  res.json(getAllUsers());
});

function getResolvedUserAudioSettings(userId) {
  const config = loadRuntimeConfig() || {};
  return resolveUserAudioSettings(
    getUserAudioSettings(userId) || {},
    resolveDefaultClientSettings(config.defaultClientSettings)
  );
}

function getUserAudioSettingTargets(userId) {
  const productions = getEnabledProductionsForUser(userId);
  const source = productions.length
    ? productions.flatMap((production) => getProductionTargets(userId, production.id))
    : getUserTargets(userId);
  const unique = new Map();
  source
    .filter((target) => ['user', 'conference'].includes(target.targetType) && target.canTalk !== false)
    .forEach((target) => unique.set(`${target.targetType}:${target.targetId}`, {
      id: Number(target.targetId),
      type: target.targetType,
      name: target.name,
    }));
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}

app.get('/admin/users/:id/audio-settings', requireAdmin, (req, res) => {
  const user = getUserById(req.params.id);
  if (!user || user.is_superadmin || user.is_guest_profile) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({
    settings: getResolvedUserAudioSettings(user.id),
    targets: getUserAudioSettingTargets(user.id),
    configuredAsBridge: Boolean(user.bridge_enabled),
  });
});

app.put('/admin/users/:id/audio-settings', requireAdmin, (req, res) => {
  try {
    const user = getUserById(req.params.id);
    if (!user || user.is_superadmin || user.is_guest_profile) {
      return res.status(404).json({ error: 'User not found' });
    }
    const settings = normalizeUserAudioSettings(req.body?.settings, { strict: true });
    updateUserAudioSettings(user.id, settings);
    const resolved = getResolvedUserAudioSettings(user.id);
    findUserPeerByUserId(user.id)?.peer?.socket?.emit('user-audio-settings-updated', { settings: resolved });
    res.json({ ok: true, settings: resolved });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Invalid audio settings' });
  }
});

app.get("/conferences", requireAdmin, (req, res) => {
  res.json(getAllConferences());
});

app.get("/feeds", requireAdmin, (req, res) => {
  res.json(getAllFeeds());
});

app.get("/users/:id/conferences", requireAdmin, (req, res) => {
  try {
    const productionId = getSingleProductionMembershipScope();
    const conferences = getProductionConferencesForUser(req.params.id, productionId);
    res.json(conferences);
  } catch (err) {
    console.error(err);
    res.status(err?.statusCode || 500).json({ error: err.message || "Internal server error" });
  }
});

app.get('/conferences/:id/users', requireAdmin, (req, res) => {
  const confId = req.params.id;
  try {
    const productionId = getSingleProductionMembershipScope();
    const users = getProductionUsersForConference(confId, productionId);
    res.json(users);
  } catch (err) {
    console.error(`[ERROR] fetching users for conference ${confId}:`, err);
    res.status(err?.statusCode || 500).json({ error: err.message });
  }
});


app.get('/users/:id/targets', (req, res) => {
  try {
    const includeMemberships = ["1", "true", "yes", "on"].includes(
      String(req.query?.includeMemberships || "").trim().toLowerCase()
    );
    const productionId = areMultipleProductionsEnabled()
      ? (req.query?.productionId ?? null)
      : (getPrimaryProduction()?.id ?? null);
    if (productionId !== null && productionId !== undefined && productionId !== "") {
      if (!isUserInProduction(req.params.id, productionId)) {
        return res.status(403).json({ error: "User is not a member of this production" });
      }
    }
    const targets = includeMemberships
      ? buildOperatorTargetsForUser(req.params.id, productionId)
      : productionId === null || productionId === undefined || productionId === ""
        ? getUserTargets(req.params.id)
        : getProductionTargets(req.params.id, productionId);
    res.json(targets);
  } catch (err) {
    res.status(err?.statusCode || 500).json({ error: err.message });
  }
});

app.get('/users/:id/productions', (req, res) => {
  try {
    const user = getUserById(req.params.id);
    if (!user || user.is_superadmin) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(getEnabledProductionsForUser(req.params.id).map(({ id, name }) => ({ id, name })));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load productions' });
  }
});

app.get("/guest/targets", (req, res) => {
  try {
    const settings = resolveGuestLoginSettings(loadRuntimeConfig() || {}, { createProfile: false });
    if (!settings.enabled || !settings.profileUserId) {
      return res.status(403).json({ error: "Guest login is disabled" });
    }
    res.json(buildOperatorTargetsForUser(settings.profileUserId, req.query?.productionId ?? null));
  } catch (err) {
    console.error("Guest targets error:", err);
    res.status(500).json({ error: err.message || "Failed to load guest targets" });
  }
});

function buildLoginIdentity(user, kind = "user") {
  const productions = kind === "user" || kind === "guest"
    ? getEnabledProductionsForUser(user.id).map(({ id, name }) => ({ id, name }))
    : [];
  const storedUser = kind === "user" ? getUserById(user.id) : null;
  return {
    id: user.id,
    name: user.name,
    kind,
    productions,
    configuredAsBridge: kind === "user" && Boolean(storedUser?.bridge_enabled),
  };
}

function buildBrowserSessionIdentity(result) {
  const browserSession = result?.session;
  if (!browserSession) return null;

  if (browserSession.kind === "user") {
    const user = getUserById(browserSession.userId);
    if (!user || user.is_guest_profile) return null;
    return buildLoginIdentity(user);
  }

  if (browserSession.kind === "feed") {
    const feed = getFeedById(browserSession.feedId);
    if (!feed) return null;
    return { id: feed.id, name: feed.name, kind: "feed" };
  }

  return null;
}

// === POST ===
app.get("/login/options", (req, res) => {
  try {
    const settings = resolveGuestLoginSettings(loadRuntimeConfig() || {}, { createProfile: false });
    res.json({
      appVersion: SERVER_APP_VERSION,
      guestLogin: {
        enabled: settings.enabled,
        label: settings.profileName || "Guest",
      },
      sso: {
        enabled: PROXY_SSO_CONFIG.enabled,
      },
    });
  } catch (err) {
    console.error("Login options error:", err);
    res.json({
      appVersion: SERVER_APP_VERSION,
      guestLogin: { enabled: false, label: "Guest" },
      sso: { enabled: PROXY_SSO_CONFIG.enabled },
    });
  }
});

app.get("/login/session", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const result = getBrowserSession(req);
  const identity = buildBrowserSessionIdentity(result);
  if (!identity) {
    if (result?.token) browserSessions.revoke(result.token);
    res.clearCookie(BROWSER_SESSION_COOKIE, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
    });
    return res.sendStatus(204);
  }
  return res.json(identity);
});

app.post("/login/sso", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const resolved = resolveProxySsoIdentity(req, PROXY_SSO_CONFIG);
  if (resolved.status !== "authenticated") {
    return res.sendStatus(204);
  }

  // Identity matching is deliberately exact. There is no implicit account
  // creation and privileged/Guest profiles cannot be entered through SSO.
  const user = getUserByName(resolved.identity);
  if (!user || user.is_guest_profile || user.is_superadmin) {
    clearBrowserSession(req, res);
    console.warn(`[SSO] No eligible Talktome user for identity ${JSON.stringify(resolved.identity)}`);
    return res.sendStatus(204);
  }

  const currentSession = getBrowserSession(req);
  if (currentSession?.token) browserSessions.revoke(currentSession.token);
  createUserBrowserSession(res, user, "trusted-header");
  console.log(`[SSO] Login successful for user: ${user.name}`);
  return res.json(buildLoginIdentity(user));
});

app.post("/login", (req, res) => {
  console.log("trying to login");
  const { name, password } = req.body;

  try {
    const user = verifyUser(name, password);
    if (user) {
      if (user.is_guest_profile) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      console.log("Login successful for user:", user.name);
      createUserBrowserSession(res, user);
      return res.json(buildLoginIdentity(user));
    }

    const feed = verifyFeed(name, password);
    if (feed) {
      console.log("Login successful for feed:", feed.name);
      createFeedBrowserSession(res, feed);
      return res.json({ id: feed.id, name: feed.name, kind: "feed" });
    }

    console.warn("Login failed for:", name);
    return res.status(401).json({ error: "Invalid credentials" });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/login/token", (req, res) => {
  try {
    const user = getUserByLoginToken(req.body?.token);
    if (user) {
      console.log("Login URL used for user:", user.name);
      res.setHeader("Cache-Control", "no-store");
      createUserBrowserSession(res, user, "login-token");
      return res.json(buildLoginIdentity(user));
    }

    const feed = getFeedByLoginToken(req.body?.token);
    if (!feed) return res.status(401).json({ error: "Invalid or expired login link" });
    console.log("Login URL used for feed:", feed.name);
    res.setHeader("Cache-Control", "no-store");
    createFeedBrowserSession(res, feed, "login-token");
    return res.json(buildLoginIdentity(feed, "feed"));
  } catch (err) {
    console.error("Login URL error:", err);
    return res.status(500).json({ error: "Login link failed" });
  }
});

app.post("/login/guest", (req, res) => {
  try {
    const settings = resolveGuestLoginSettings(loadRuntimeConfig() || {}, { createProfile: true, persist: true });
    if (!settings.enabled || !settings.profileUserId) {
      return res.status(403).json({ error: "Guest login is disabled" });
    }

    const requestedName = normalizeGuestDisplayName(req.body?.name);
    const shortId = crypto.randomBytes(2).toString("hex").toUpperCase();
    const name = requestedName || `${settings.profileName || "Guest"} ${shortId}`;
    return res.json({
      kind: "guest",
      guestId: crypto.randomUUID(),
      guestProfileUserId: settings.profileUserId,
      name,
      productions: getEnabledProductionsForUser(settings.profileUserId).map(({ id, name: productionName }) => ({
        id,
        name: productionName,
      })),
    });
  } catch (err) {
    console.error("Guest login error:", err);
    return res.status(500).json({ error: "Guest login failed" });
  }
});

app.get("/api/v1/health", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    appVersion: SERVER_APP_VERSION,
    serverStartedAt: new Date(SERVER_STARTED_AT).toISOString(),
  });
});

app.post("/admin/login", (req, res) => {
  const { name, password } = req.body || {};
  if (!name || !password) {
    return res.status(400).json({ error: "Name and password are required" });
  }

  try {
    const user = verifyUser(name, password);
    if (!user || user.is_guest_profile) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const productionAdminOf = getProductionsForUser(user.id).filter((production) => production.isAdmin);
    if (!user.is_admin && productionAdminOf.length === 0) {
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
      isAdmin: !!user.is_admin,
      isGlobalAdmin: !!user.is_admin,
      isSuperadmin: !!user.is_superadmin,
      mustChangePassword: !!user.admin_must_change,
      productionAdminOf: productionAdminOf.map(({ id, name: productionName }) => ({ id, name: productionName })),
    });
  } catch (err) {
    console.error("Admin login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/admin/logout", requireAdminSession, (req, res) => {
  if (req.adminToken) {
    closeAdminStatusStreamsForToken(req.adminToken, "logged-out");
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
  const productionAdminOf = user
    ? getProductionsForUser(user.id).filter((production) => production.isAdmin)
    : [];
  if (!user || (!user.is_admin && productionAdminOf.length === 0)) {
    adminSessions.delete(result.token);
    res.clearCookie("admin_session", { httpOnly: true, sameSite: "lax", secure: true });
    return res.status(401).json({ error: "Not authenticated" });
  }

  return res.json({
    id: user.id,
    name: user.name,
    isAdmin: !!user.is_admin,
    isGlobalAdmin: !!user.is_admin,
    isSuperadmin: !!user.is_superadmin,
    mustChangePassword: !!user.admin_must_change,
    productionAdminOf: productionAdminOf.map(({ id, name: productionName }) => ({ id, name: productionName })),
  });
});

app.get("/admin/productions", requireAdminSession, (req, res) => {
  try {
    const productions = req.adminSession.isGlobalAdmin
      ? getAllProductions()
      : getProductionsForUser(req.adminSession.userId)
        .filter((production) => production.isAdmin)
        .map(({ isAdmin, ...production }) => production);
    res.json(productions);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to load productions" });
  }
});

app.post("/admin/productions", requireAdmin, (req, res) => {
  try {
    const id = createProduction(req.body?.name);
    res.status(201).json(getProductionById(id));
  } catch (err) {
    const conflict = String(err?.message || "").includes("already exists");
    res.status(conflict ? 409 : 400).json({ error: err.message || "Failed to create production" });
  }
});

app.get("/admin/productions/:productionId", requireProductionManager, (req, res) => {
  try {
    const members = getProductionMembers(req.productionId);
    const conferences = getProductionConferences(req.productionId);
    const feeds = getProductionFeeds(req.productionId);
    const targets = {};
    members.forEach((member) => {
      targets[String(member.id)] = getProductionTargets(member.id, req.productionId);
    });
    res.json({
      production: getProductionById(req.productionId),
      members,
      conferences,
      feeds,
      targets,
      catalog: {
        users: getAllUsers()
          .filter((user) => !user.is_superadmin)
          .map((user) => ({ id: user.id, name: user.name, is_guest_profile: user.is_guest_profile })),
        conferences: getAllConferences(),
        feeds: getAllFeeds().map((feed) => ({ id: feed.id, name: feed.name })),
      },
      permissions: {
        globalAdmin: Boolean(req.adminSession.isGlobalAdmin),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to load production" });
  }
});

app.put("/admin/productions/:productionId/conferences/:conferenceId", requireProductionManager, (req, res) => {
  try {
    setProductionConference(req.productionId, req.params.conferenceId);
    res.sendStatus(204);
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to add conference to production" });
  }
});

app.delete("/admin/productions/:productionId/conferences/:conferenceId", requireProductionManager, (req, res) => {
  try {
    removeProductionConference(req.productionId, req.params.conferenceId);
    notifyConferenceMembersChanged(req.params.conferenceId);
    res.sendStatus(204);
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to remove conference from production" });
  }
});

app.put("/admin/productions/:productionId/feeds/:feedId", requireProductionManager, (req, res) => {
  try {
    setProductionFeed(req.productionId, req.params.feedId);
    res.sendStatus(204);
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to add feed to production" });
  }
});

app.delete("/admin/productions/:productionId/feeds/:feedId", requireProductionManager, (req, res) => {
  try {
    removeProductionFeed(req.productionId, req.params.feedId);
    reconcileAllProducerRecipients();
    res.sendStatus(204);
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to remove feed from production" });
  }
});

app.put("/admin/productions/:productionId/conferences/:conferenceId/users/:userId", requireProductionManager, (req, res) => {
  try {
    setProductionConferenceMembership(
      req.productionId,
      req.params.userId,
      req.params.conferenceId
    );
    notifyTargetChange(req.params.userId);
    notifyConferenceMembersChanged(req.params.conferenceId);
    res.sendStatus(204);
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to update conference membership" });
  }
});

app.delete("/admin/productions/:productionId/conferences/:conferenceId/users/:userId", requireProductionManager, (req, res) => {
  try {
    removeProductionConferenceMembership(
      req.productionId,
      req.params.userId,
      req.params.conferenceId
    );
    notifyTargetChange(req.params.userId);
    notifyConferenceMembersChanged(req.params.conferenceId);
    res.sendStatus(204);
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to update conference membership" });
  }
});

app.put("/admin/productions/:productionId", requireAdmin, (req, res) => {
  try {
    if (!updateProductionName(req.params.productionId, req.body?.name)) {
      return res.status(404).json({ error: "Production not found" });
    }
    notifyAvailableProductionsChanged();
    res.json(getProductionById(req.params.productionId));
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to update production" });
  }
});

app.delete("/admin/productions/:productionId", requireAdmin, (req, res) => {
  try {
    if (!deleteProduction(req.params.productionId)) {
      return res.status(404).json({ error: "Production not found" });
    }
    tallyState.remove(req.params.productionId);
    resetPeersUsingProduction(req.params.productionId);
    notifyAvailableProductionsChanged();
    res.sendStatus(204);
  } catch (err) {
    const lastProduction = err.message === "The last production cannot be deleted";
    res.status(lastProduction ? 409 : 500).json({ error: err.message || "Failed to delete production" });
  }
});

app.put("/admin/productions/:productionId/users/:userId", requireProductionManager, (req, res) => {
  try {
    const requestedAdmin = Boolean(req.body?.isAdmin);
    if (requestedAdmin && !req.adminSession.isGlobalAdmin) {
      return res.status(403).json({ error: "Only global admins can assign production admins" });
    }
    const existing = getProductionMembers(req.productionId)
      .find((member) => Number(member.id) === Number(req.params.userId));
    const isAdmin = req.adminSession.isGlobalAdmin
      ? requestedAdmin
      : Boolean(existing?.isProductionAdmin);
    setProductionUser(req.productionId, req.params.userId, { isAdmin });
    notifyAvailableProductionsChanged(req.params.userId);
    notifyTargetChange(req.params.userId);
    res.sendStatus(204);
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to update production member" });
  }
});

app.delete("/admin/productions/:productionId/users/:userId", requireProductionManager, (req, res) => {
  try {
    const existing = getProductionMembers(req.productionId)
      .find((member) => Number(member.id) === Number(req.params.userId));
    if (!req.adminSession.isGlobalAdmin && existing?.isProductionAdmin) {
      return res.status(403).json({ error: "Only global admins can remove production admins" });
    }
    removeProductionUser(req.productionId, req.params.userId);
    resetPeersUsingProduction(req.productionId, req.params.userId);
    notifyAvailableProductionsChanged(req.params.userId);
    notifyTargetChange(req.params.userId);
    res.sendStatus(204);
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to remove production member" });
  }
});

app.post("/admin/productions/:productionId/users/:userId/targets", requireProductionManager, (req, res) => {
  try {
    addProductionTarget(
      req.productionId,
      req.params.userId,
      req.body?.targetType,
      req.body?.targetId
    );
    notifyTargetChange(req.params.userId);
    if (req.body?.targetType === "conference") {
      notifyConferenceMembersChanged(req.body?.targetId);
    }
    res.sendStatus(204);
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to add production target" });
  }
});

app.put("/admin/productions/:productionId/users/:userId/targets/conference/:targetId", requireProductionManager, (req, res) => {
  try {
    if (req.body?.mode !== "listen-only") {
      return res.status(400).json({ error: "Unsupported conference target mode" });
    }
    setProductionConferenceListenOnly(
      req.productionId,
      req.params.userId,
      req.params.targetId
    );
    notifyTargetChange(req.params.userId);
    notifyConferenceMembersChanged(req.params.targetId);
    res.sendStatus(204);
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to update conference target" });
  }
});

app.delete("/admin/productions/:productionId/users/:userId/targets/:type/:targetId", requireProductionManager, (req, res) => {
  try {
    removeProductionTarget(
      req.productionId,
      req.params.userId,
      req.params.type,
      req.params.targetId
    );
    notifyTargetChange(req.params.userId);
    if (req.params.type === "conference") {
      notifyConferenceMembersChanged(req.params.targetId);
    }
    res.sendStatus(204);
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to remove production target" });
  }
});

app.put("/admin/productions/:productionId/users/:userId/targets/order", requireProductionManager, (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items) return res.status(400).json({ error: "items array required" });
  try {
    updateProductionTargetOrder(req.productionId, req.params.userId, items);
    notifyTargetChange(req.params.userId);
    res.sendStatus(204);
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to reorder production targets" });
  }
});

app.get("/admin/api-key", requireAdmin, (req, res) => {
  res.json({ apiKey: companionApiKey });
});

app.post("/admin/api-key/regenerate", requireAdmin, (req, res) => {
  try {
    const apiKey = regenerateCompanionApiKey();
    res.json({ apiKey });
  } catch (err) {
    console.error(`[COMPANION] Failed to regenerate API key: ${err.message}`);
    res.status(err.statusCode || 500).json({
      error: err.message || "Failed to regenerate API key",
    });
  }
});

function statusIsoTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : null;
}

function statusRemoteAddress(socket) {
  const rawAddress = socket?.handshake?.address
    || socket?.request?.socket?.remoteAddress
    || null;
  return typeof rawAddress === "string"
    ? rawAddress.replace(/^::ffff:/, "")
    : null;
}

function describeStatusClient(socket) {
  const userAgent = String(socket?.handshake?.headers?.["user-agent"] || "");
  if (!userAgent) return "Unknown client";

  let browser = "Browser";
  if (/EdgiOS|Edg\//i.test(userAgent)) browser = "Edge";
  else if (/CriOS|Chrome\//i.test(userAgent)) browser = "Chrome";
  else if (/FxiOS|Firefox\//i.test(userAgent)) browser = "Firefox";
  else if (/Safari\//i.test(userAgent)) browser = "Safari";

  let platform = "";
  if (/iPhone/i.test(userAgent)) platform = "iPhone";
  else if (/iPad/i.test(userAgent)) platform = "iPad";
  else if (/Android/i.test(userAgent)) platform = "Android";
  else if (/Windows/i.test(userAgent)) platform = "Win";
  else if (/Macintosh|Mac OS X/i.test(userAgent)) platform = "macOS";
  else if (/Linux/i.test(userAgent)) platform = "Linux";

  return platform ? `${platform} ${browser}` : browser;
}

function normalizeBridgePlatform(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "macos" || normalized === "darwin" || normalized === "mac") return "macos";
  if (normalized === "windows" || normalized === "win32" || normalized === "win") return "windows";
  if (normalized === "linux") return "linux";
  return "unknown";
}

function describeBridgeStatusClient(platform, host) {
  const normalizedPlatform = normalizeBridgePlatform(platform);
  if (normalizedPlatform === "macos") return "macOS Bridge";
  if (normalizedPlatform === "windows") return "Win Bridge";
  if (normalizedPlatform === "linux") return "Linux Bridge";

  const normalizedHost = String(host || "").toLowerCase();
  if (normalizedHost.includes("coreaudio")) return "macOS Bridge";
  if (normalizedHost.includes("wasapi") || normalizedHost.includes("asio")) return "Win Bridge";
  if (normalizedHost.includes("alsa") || normalizedHost.includes("pulse") || normalizedHost.includes("jack")) {
    return "Linux Bridge";
  }
  return "Bridge";
}

function bridgeInventoryHasAssignment(bridge, direction, assignment) {
  const deviceId = String(assignment?.deviceId || "");
  if (!deviceId) return false;
  const leftChannel = Number(assignment?.leftChannel);
  const rightChannel = Number(assignment?.rightChannel);
  const requiredChannel = Math.max(leftChannel, rightChannel);
  const devices = Array.isArray(bridge?.inventory?.devices) ? bridge.inventory.devices : [];
  const device = devices.find((entry) => (
    entry.direction === direction
    && String(entry.id || "") === deviceId
  ));
  if (!device) return false;
  if (!Number.isInteger(leftChannel) || !Number.isInteger(rightChannel)) return false;
  if (leftChannel < 1 || rightChannel < 1) return false;
  const maxChannels = Number(device.max_channels ?? device.maxChannels ?? 0);
  return maxChannels >= requiredChannel;
}

function buildBridgeDeviceIssues(bridge, users = [], feeds = []) {
  if (!bridge?.id || bridge.stale) return [];
  const bridgeId = String(bridge.id);
  const issues = [];

  for (const user of users) {
    if (!user.bridge_enabled || String(user.bridge_device || "") !== bridgeId) continue;
    const inputOk = bridgeInventoryHasAssignment(bridge, "input", {
      deviceId: user.bridge_input_device,
      leftChannel: user.bridge_input_left_channel,
      rightChannel: user.bridge_input_right_channel,
    });
    const outputOk = bridgeInventoryHasAssignment(bridge, "output", {
      deviceId: user.bridge_output_device,
      leftChannel: user.bridge_output_left_channel,
      rightChannel: user.bridge_output_right_channel,
    });
    if (!inputOk) issues.push(`${user.name}: input device missing`);
    if (!outputOk) issues.push(`${user.name}: output device missing`);
  }

  for (const feed of feeds) {
    if (!feed.bridge_enabled || String(feed.bridge_device || "") !== bridgeId) continue;
    const inputOk = bridgeInventoryHasAssignment(bridge, "input", {
      deviceId: feed.bridge_input_device,
      leftChannel: feed.bridge_input_left_channel,
      rightChannel: feed.bridge_input_right_channel,
    });
    if (!inputOk) issues.push(`${feed.name}: input device missing`);
  }

  return issues;
}

const BROWSER_MEDIA_STATS_STALE_MS = 15_000;

function normalizeBrowserMediaStats(payload = {}) {
  const roundTripMs = Number(payload?.roundTripMs);
  const packetLossPercent = Number(payload?.packetLossPercent);
  const normalized = {};

  if (Number.isFinite(roundTripMs) && roundTripMs >= 0 && roundTripMs <= 60_000) {
    normalized.roundTripMs = Math.round(roundTripMs);
  }
  if (Number.isFinite(packetLossPercent) && packetLossPercent >= 0 && packetLossPercent <= 100) {
    normalized.packetLossPercent = Math.round(packetLossPercent * 10) / 10;
  }
  for (const key of [
    "jitterMs",
    "jitterBufferMs",
    "packetsLost",
    "packetsReceived",
    "packetsDiscarded",
    "concealedSamples",
    "concealmentEvents",
  ]) {
    const value = Number(payload?.[key]);
    if (Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) {
      normalized[key] = Math.round(value);
    }
  }

  if (Array.isArray(payload?.streams)) {
    normalized.streams = payload.streams.slice(0, 50).map((stream = {}) => {
      const normalizedStream = {};
      for (const key of ["consumerId", "producerId", "streamKey", "targetKey", "type"]) {
        if (typeof stream?.[key] === "string" && stream[key].trim()) {
          normalizedStream[key] = stream[key].trim().slice(0, 160);
        }
      }
      for (const key of [
        "jitterMs",
        "jitterBufferMs",
        "packetsLost",
        "packetsReceived",
        "packetsDiscarded",
        "concealedSamples",
        "concealmentEvents",
      ]) {
        const value = Number(stream?.[key]);
        if (Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) {
          normalizedStream[key] = Math.round(value);
        }
      }
      const streamLossPercent = Number(stream?.packetLossPercent);
      if (Number.isFinite(streamLossPercent) && streamLossPercent >= 0 && streamLossPercent <= 100) {
        normalizedStream.packetLossPercent = Math.round(streamLossPercent * 10) / 10;
      }
      return normalizedStream;
    }).filter((stream) => stream.consumerId || stream.producerId || stream.streamKey);
  }

  return Object.keys(normalized).length ? normalized : null;
}

function logBrowserMediaStats(peer, socketId, stats) {
  const now = Date.now();
  const previous = peer.browserMediaStats || null;
  const delta = (key) => previous ? Math.max(0, Number(stats[key] || 0) - Number(previous[key] || 0)) : 0;
  const lostDelta = delta("packetsLost");
  const discardedDelta = delta("packetsDiscarded");
  const concealedSamplesDelta = delta("concealedSamples");
  const concealmentEventsDelta = delta("concealmentEvents");
  const previousStreams = new Map(
    (Array.isArray(previous?.streams) ? previous.streams : [])
      .map((stream) => [stream.consumerId || stream.producerId || stream.streamKey, stream])
  );
  const streamProblems = (Array.isArray(stats.streams) ? stats.streams : []).map((stream) => {
    const key = stream.consumerId || stream.producerId || stream.streamKey;
    const previousStream = previousStreams.get(key) || null;
    const streamDelta = (field) => (
      previousStream
        ? Math.max(0, Number(stream[field] || 0) - Number(previousStream[field] || 0))
        : 0
    );
    return {
      stream,
      lostDelta: streamDelta("packetsLost"),
      discardedDelta: streamDelta("packetsDiscarded"),
      concealedSamplesDelta: streamDelta("concealedSamples"),
      concealmentEventsDelta: streamDelta("concealmentEvents"),
    };
  }).filter((entry) => (
    entry.lostDelta > 0
    || entry.discardedDelta > 0
    || entry.concealmentEventsDelta > 0
  ));
  const hasNewProblem = (
    lostDelta > 0
    || discardedDelta > 0
    || concealmentEventsDelta > 0
    || streamProblems.length > 0
  );
  const periodicLogDue = !peer.lastMediaDiagnosticsLogAt || now - peer.lastMediaDiagnosticsLogAt >= 30_000;
  if (!hasNewProblem && !periodicLogDue) return;

  const timestamp = new Date(now).toISOString();
  const label = `${peer.kind || "client"}:${peer.userId ?? peer.feedId ?? peer.name ?? socketId}`;
  const prefix = hasNewProblem ? "[MEDIA][WEBRTC][LOSS]" : "[MEDIA][WEBRTC][STATS]";
  const method = hasNewProblem ? console.warn : console.log;
  method(
    `${prefix} ${timestamp} ${label} socket=${socketId} `
    + `rttMs=${stats.roundTripMs ?? "unknown"} jitterMs=${stats.jitterMs ?? "unknown"} `
    + `jitterBufferMs=${stats.jitterBufferMs ?? "unknown"} lossPct=${stats.packetLossPercent ?? "unknown"} `
    + `packets=recv:${stats.packetsReceived ?? 0},lost:${stats.packetsLost ?? 0}(+${lostDelta}),`
    + `discarded:${stats.packetsDiscarded ?? 0}(+${discardedDelta}) `
    + `concealment=events:${stats.concealmentEvents ?? 0}(+${concealmentEventsDelta}),`
    + `samples:${stats.concealedSamples ?? 0}(+${concealedSamplesDelta},~${Math.round(concealedSamplesDelta / 48)}ms)`
  );
  for (const problem of streamProblems) {
    const stream = problem.stream;
    console.warn(
      `[MEDIA][WEBRTC][SOURCE-LOSS] ${timestamp} ${label} socket=${socketId} `
      + `type=${stream.type || "unknown"} target=${stream.targetKey || "unknown"} `
      + `producer=${stream.producerId || "unknown"} consumer=${stream.consumerId || "unknown"} `
      + `jitterMs=${stream.jitterMs ?? "unknown"} jitterBufferMs=${stream.jitterBufferMs ?? "unknown"} `
      + `lossPct=${stream.packetLossPercent ?? "unknown"} `
      + `packets=recv:${stream.packetsReceived ?? 0},lost:${stream.packetsLost ?? 0}(+${problem.lostDelta}),`
      + `discarded:${stream.packetsDiscarded ?? 0}(+${problem.discardedDelta}) `
      + `concealment=events:${stream.concealmentEvents ?? 0}(+${problem.concealmentEventsDelta}),`
      + `samples:${stream.concealedSamples ?? 0}(+${problem.concealedSamplesDelta},`
      + `~${Math.round(problem.concealedSamplesDelta / 48)}ms)`
    );
  }
  peer.lastMediaDiagnosticsLogAt = now;
}

function getFreshBrowserMediaStats(peer, now = Date.now()) {
  const stats = peer?.browserMediaStats;
  if (!stats || now - Number(stats.reportedAt || 0) > BROWSER_MEDIA_STATS_STALE_MS) return null;
  return {
    roundTripMs: Number.isFinite(stats.roundTripMs) ? stats.roundTripMs : null,
    packetLossPercent: Number.isFinite(stats.packetLossPercent) ? stats.packetLossPercent : null,
  };
}

function buildAdminStatusTalkTargets(targets, usersById, conferencesById) {
  return normalizeRuntimeTalkTargets(targets).map((target) => {
    if (target.type === "user") {
      return {
        ...target,
        name: usersById.get(String(target.id))?.name || `User ${target.id}`,
      };
    }
    if (target.type === "conference") {
      return {
        ...target,
        name: conferencesById.get(String(target.id))?.name || `Conference ${target.id}`,
      };
    }
    if (target.type === "guest") {
      return {
        ...target,
        name: findGuestPeerByGuestId(target.id)?.peer?.name || "Guest",
      };
    }
    return target;
  });
}

function buildAdminStatusSnapshot() {
  const now = Date.now();
  const multipleProductionsEnabled = areMultipleProductionsEnabled();
  const allUsers = getAllUsers();
  const allFeeds = getAllFeeds();
  const allConferences = getAllConferences();
  const productionsById = multipleProductionsEnabled
    ? new Map(getAllProductions().map((production) => [String(production.id), production]))
    : new Map();
  const usersById = new Map(allUsers.map((user) => [String(user.id), user]));
  const conferencesById = new Map(allConferences.map((conference) => [String(conference.id), conference]));
  const users = allUsers
    .filter((user) => !user.is_superadmin && !user.is_guest_profile)
    .map((user) => {
      const found = findUserPeerByUserId(user.id);
      const peer = found?.peer || null;
      const online = Boolean(peer);
      const isBridge = Boolean(peer?.isBridgePeer);
      const activeTargets = peer ? getPeerActiveTalkTargets(peer) : [];
      const talkTargets = buildAdminStatusTalkTargets(activeTargets, usersById, conferencesById);
      const activeProduction = online && multipleProductionsEnabled && peer.productionId != null
        ? productionsById.get(String(peer.productionId)) || null
        : null;
      const bridge = isBridge
        ? bridgeRegistry.get(String(peer.bridgeId)) || null
        : null;
      const networkStats = online && !isBridge ? getFreshBrowserMediaStats(peer, now) : null;

      return {
        id: Number(user.id),
        name: user.name,
        online,
        talking: online && activeTargets.length > 0,
        talkTargets,
        activeProduction: activeProduction
          ? { id: Number(activeProduction.id), name: activeProduction.name }
          : null,
        connectionType: online ? (isBridge ? "bridge" : "browser") : null,
        configuredAsBridge: Boolean(user.bridge_enabled),
        bridgeName: bridge?.name || (isBridge ? peer.bridgeId : null),
        connectedAt: online ? statusIsoTimestamp(peer.connectedAt) : null,
        lastOnlineAt: user.last_online_at || null,
        client: online
          ? (isBridge
              ? `${describeBridgeStatusClient(bridge?.platform, bridge?.host)}: ${bridge?.name || peer.bridgeId || "unknown"}`
              : describeStatusClient(peer.socket))
          : null,
        remoteAddress: online && !isBridge ? statusRemoteAddress(peer.socket) : null,
        networkStats,
      };
    });

  const feeds = allFeeds.map((feed) => {
    const found = findFeedPeerByFeedId(feed.id);
    const peer = found?.peer || null;
    const online = Boolean(peer);
    const isBridge = Boolean(peer?.isBridgePeer);
    const bridge = isBridge
      ? bridgeRegistry.get(String(peer.bridgeId)) || null
      : null;
    const networkStats = online && !isBridge ? getFreshBrowserMediaStats(peer, now) : null;

    return {
      id: Number(feed.id),
      name: feed.name,
      online,
      connectionType: online ? (isBridge ? "bridge" : "browser") : null,
      configuredAsBridge: Boolean(feed.bridge_enabled),
      bridgeName: bridge?.name || (isBridge ? peer.bridgeId : null),
      connectedAt: online ? statusIsoTimestamp(peer.connectedAt) : null,
      lastSeenAt: online ? statusIsoTimestamp(peer.lastSeenAt || peer.connectedAt) : null,
      client: online
        ? (isBridge
            ? `${describeBridgeStatusClient(bridge?.platform, bridge?.host)}: ${bridge?.name || peer.bridgeId || "unknown"}`
            : describeStatusClient(peer.socket))
        : null,
      remoteAddress: online && !isBridge ? statusRemoteAddress(peer.socket) : null,
      networkStats,
    };
  });

  const bridges = getBridgeRegistrySnapshot().map((bridge) => {
    const devices = Array.isArray(bridge.inventory?.devices) ? bridge.inventory.devices : [];
    const deviceIssues = buildBridgeDeviceIssues(bridge, allUsers, allFeeds);
    return {
      id: bridge.id,
      name: bridge.name,
      platform: bridge.platform,
      host: bridge.host,
      online: !bridge.stale,
      stale: bridge.stale,
      connectedAt: bridge.connectedAt,
      lastSeenAt: bridge.lastSeenAt,
      remoteAddress: bridge.remoteAddress,
      client: describeBridgeStatusClient(bridge.platform, bridge.host),
      inventory: bridge.inventory,
      deviceMissing: deviceIssues.length > 0,
      deviceIssues,
      inputDevices: devices.filter((device) => device.direction === "input").length,
      outputDevices: devices.filter((device) => device.direction === "output").length,
    };
  });

  const companionSockets = companionNamespace?.sockets
    ? [...companionNamespace.sockets.values()]
    : [];
  const companions = companionSockets.map((socket) => {
    const auth = socket.data?.companionAuth || {};
    const fallbackName = auth.type === "session" && auth.userName
      ? `Companion for ${auth.userName}`
      : `Companion ${String(socket.id).slice(0, 8)}`;
    return {
      id: socket.id,
      name: socket.data?.instanceName || fallbackName,
      online: isCompanionSocketOnline(socket, now),
      authType: auth.type || "unknown",
      scope: auth.type === "api-key" ? "Global API key" : (auth.userName || "User session"),
      userId: auth.userId ?? null,
      connectedAt: statusIsoTimestamp(socket.data?.connectedAt),
      lastSeenAt: statusIsoTimestamp(socket.data?.lastSeenAt || socket.data?.connectedAt),
      remoteAddress: statusRemoteAddress(socket),
      client: describeStatusClient(socket),
    };
  });

  const livePeers = [...peers.values()];
  return {
    appVersion: SERVER_APP_VERSION,
    generatedAt: new Date(now).toISOString(),
    serverStartedAt: statusIsoTimestamp(SERVER_STARTED_AT),
    runningInContainer: isRunningInContainer(),
    restartSupported: isServerRestartSupported(),
    multipleProductionsEnabled,
    users,
    feeds,
    bridges,
    companions,
    summary: {
      usersOnline: users.filter((user) => user.online).length,
      usersTotal: users.length,
      feedsOnline: feeds.filter((feed) => feed.online).length,
      feedsTotal: feeds.length,
      bridgesOnline: bridges.filter((bridge) => bridge.online).length,
      bridgesTotal: bridges.length,
      companionsOnline: companions.filter((companion) => companion.online).length,
      guestsOnline: livePeers.filter((peer) => peer.kind === "guest" && peer.guestId).length,
    },
  };
}

app.get("/admin/status", requireAdmin, (req, res) => {
  res.json(buildAdminStatusSnapshot());
});

async function forceStopUserTransmission(userId) {
  const found = findUserPeerByUserId(userId);
  if (!found?.peer) return null;

  const { socketId, peer } = found;
  const talkProducers = getPeerTalkProducers(peer, { includePaused: true });
  const appleRecipientUserIds = [...new Set(talkProducers.flatMap((producer) => (
    Array.isArray(producer?.__applePttRecipientUserIds) ? producer.__applePttRecipientUserIds : []
  )))];
  const result = await stopPeerTransmission(peer, talkProducers);

  for (const producer of talkProducers) {
    producer.__applePttRecipientUserIds = [];
    if (String(producer?.appData?.type || "").trim().toLowerCase() === "talk") {
      syncProducerRecipients({ producer, speakerSocketId: socketId });
    }
  }

  try {
    peer.socket?.emit("force-stop-transmission", {
      reason: "admin-stop-transmission",
      at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn(`[ADMIN] Failed to notify user ${userId} about stopped transmission:`, error?.message || error);
  }

  syncPeerCompanionState(peer, { reason: "admin-stop-transmission" });
  broadcastRuntimeUserStates("admin-stop-transmission");
  void sendApplePttServiceUpdate({
    recipientUserIds: appleRecipientUserIds,
    reason: "admin-stop-transmission",
  }).catch((error) => {
    console.warn("[APPLE-PTT] Failed to send forced-stop update:", error?.message || error);
  });

  return result;
}

app.post("/admin/users/:id/stop-transmission", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Invalid user id" });
  }

  const user = getUserById(userId);
  if (!user || user.is_superadmin || user.is_guest_profile) {
    return res.status(404).json({ error: "User not found" });
  }

  try {
    const result = await forceStopUserTransmission(userId);
    if (!result) {
      return res.status(409).json({ error: "User is not online" });
    }
    if (result.errors.length > 0) {
      console.error(`[ADMIN] Failed to stop all transmission producers for user ${userId}`, result.errors);
      return res.status(500).json({ error: "Failed to stop all active transmission producers" });
    }
    console.log(
      `[ADMIN] Stopped transmission for user ${userId} (${user.name}); `
      + `paused=${result.pausedProducerCount}, closed=${result.closedProducerCount}`
    );
    return res.json({
      ok: true,
      stopped: result.hadActiveTransmission,
      pausedProducerCount: result.pausedProducerCount,
      closedProducerCount: result.closedProducerCount,
    });
  } catch (error) {
    console.error(`[ADMIN] Failed to stop transmission for user ${userId}:`, error);
    return res.status(500).json({ error: "Failed to stop transmission" });
  }
});

app.post("/admin/restart", requireAdmin, requireSuperAdmin, (req, res) => {
  if (!isServerRestartSupported()) {
    return res.status(409).json({ error: "Server restart is not available for unmanaged command-line starts" });
  }
  if (containerRestartScheduled) {
    return res.status(409).json({ error: "A server restart is already in progress" });
  }

  res.status(202).json({ restarting: true });
  restartServerProcess();
});

app.get("/admin/status/events", requireAdmin, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  req.socket?.setTimeout?.(0);

  const stream = {
    res,
    token: req.adminToken,
    heartbeat: null,
  };
  adminStatusStreams.add(stream);
  res.write("retry: 3000\n\n");
  writeAdminStatusEvent(stream, "status", {
    reason: "initial",
    snapshot: buildAdminStatusSnapshot(),
  });

  stream.heartbeat = setInterval(() => {
    const session = adminSessions.get(stream.token);
    if (!session || session.expiresAt <= Date.now()) {
      closeAdminStatusStreamsForToken(stream.token);
      return;
    }
    try {
      res.write(": heartbeat\n\n");
    } catch {
      adminStatusStreams.delete(stream);
      clearInterval(stream.heartbeat);
    }
  }, 25_000);

  req.on("close", () => {
    adminStatusStreams.delete(stream);
    clearInterval(stream.heartbeat);
  });
});

app.get("/admin/bridges", requireAdmin, (req, res) => {
  res.json({ bridges: getBridgeRegistrySnapshot() });
});

app.get("/admin/settings/mdns", requireAdmin, (req, res) => {
  const config = loadRuntimeConfig() || {};
  const defaultHost = isRunningInContainer() ? "off" : "intercom.local";
  const configuredHost = normalizeMdnsSetting(config.mdnsHost) || defaultHost;
  const activeHost = mdnsHostname || "off";

  res.json({
    mdnsHost: configuredHost,
    activeMdnsHost: activeHost,
    restartRequired: configuredHost !== activeHost,
    configPath: getConfigPath(),
    runningInContainer: isRunningInContainer(),
  });
});

function buildHttpsConnectUrl(host) {
  if (typeof host !== "string") return "";
  const trimmed = host.trim();
  if (!trimmed) return "";
  return `https://${trimmed}:${HTTPS_PORT}`;
}

function getFirstForwardedValue(value) {
  if (Array.isArray(value)) {
    return getFirstForwardedValue(value[0]);
  }
  if (typeof value !== "string") return "";
  return value.split(",")[0].trim();
}

function resolveConfiguredAdminPublicConnectUrl() {
  return normalizeConnectUrl(
    process.env.TALKTOME_PUBLIC_URL || process.env.PUBLIC_URL
  );
}

function resolveAdminRequestConnectUrl(req) {
  const forwardedHost = getFirstForwardedValue(req?.headers?.["x-forwarded-host"]);
  const host = forwardedHost || getFirstForwardedValue(req?.headers?.host);
  if (!host) return "";

  const forwardedProto = getFirstForwardedValue(req?.headers?.["x-forwarded-proto"]);
  const proto = forwardedProto || (req?.socket?.encrypted ? "https" : "http");
  if (!["http", "https"].includes(proto)) return "";

  return normalizeConnectUrl(`${proto}://${host}`);
}

function resolvePreferredAdminQrIpAddress(activeAddress) {
  const candidates = [];
  const seen = new Set();

  const addCandidate = (value) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push(trimmed);
  };

  addCandidate(activeAddress);
  getStartupHosts().forEach(addCandidate);
  getLocalIPv4Addresses().forEach(addCandidate);

  return candidates.find(isLikelyIPv4Address) || null;
}

async function buildAdminMediaNetworkQrPayload(activeAddress, req = null) {
  const qrUrl = resolveAdminConnectUrl(activeAddress, req);
  const configuredPublicConnectUrl = resolveConfiguredAdminPublicConnectUrl();
  const requestConnectUrl = resolveAdminRequestConnectUrl(req);
  const qrIpAddress = resolvePreferredAdminQrIpAddress(activeAddress);
  const publicConnectUrl = configuredPublicConnectUrl || requestConnectUrl;
  const activeMdnsHost = mdnsHostname || "off";
  const mdnsUrl = mdnsHostname ? buildHttpsConnectUrl(mdnsHostname) : "";

  let qrCodeDataUrl = null;
  if (qrUrl) {
    try {
      qrCodeDataUrl = await QRCode.toDataURL(qrUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 640,
        color: {
          dark: "#0f172a",
          light: "#ffffff",
        },
      });
    } catch (error) {
      console.warn("[ADMIN] Failed to generate media network QR code:", error?.message || error);
    }
  }

  return {
    httpsPort: HTTPS_PORT,
    activeMdnsHost,
    qrIpAddress,
    publicConnectUrl: publicConnectUrl || null,
    qrUrl: qrUrl || null,
    mdnsUrl: mdnsUrl || null,
    qrCodeDataUrl,
  };
}

function resolveAdminConnectUrl(activeAddress, req = null) {
  const qrIpAddress = resolvePreferredAdminQrIpAddress(activeAddress);
  const configuredPublicConnectUrl = resolveConfiguredAdminPublicConnectUrl();
  const requestConnectUrl = resolveAdminRequestConnectUrl(req);
  const adapterConnectUrl = buildHttpsConnectUrl(qrIpAddress);
  return selectAdminQrUrl({
    configuredUrl: configuredPublicConnectUrl,
    requestUrl: requestConnectUrl,
    adapterUrl: adapterConnectUrl,
  });
}

app.get("/admin/settings/media-network", requireAdmin, async (req, res) => {
  const config = loadRuntimeConfig() || {};
  const saved = resolveSavedMediaNetworkConfig(config);
  const active = resolveTransportAnnouncedAddress();
  const environmentOverride = active.source === "env";
  const restartRequired = environmentOverride
    ? false
    : (
      saved.mode !== active.mode
      || (saved.mode === "interface" && saved.interfaceName !== active.interfaceName)
      || (saved.mode === "manual" && saved.announcedAddress !== (active.announcedAddress || ""))
    );
  const qrPayload = await buildAdminMediaNetworkQrPayload(active.announcedAddress, req);

  res.json({
    mediaNetworkMode: saved.mode,
    mediaInterfaceName: saved.interfaceName,
    mediaAnnouncedAddress: saved.announcedAddress,
    activeMediaNetworkMode: active.mode,
    activeMediaInterfaceName: active.interfaceName,
    activeAnnouncedAddress: active.announcedAddress,
    activeRtcAddresses: getActiveRtcAddresses(active),
    activeResolutionError: active.error,
    mediaNetworkWarning: buildMediaNetworkRequestWarning(active, req),
    requestLocalAddress: normalizeSocketAddress(req.socket?.localAddress) || null,
    availableInterfaces: getAvailableMediaNetworkInterfaces(),
    restartRequired,
    environmentOverride,
    runningInContainer: isRunningInContainer(),
    configPath: getConfigPath(),
    ...qrPayload,
  });
});

app.get("/admin/settings/rtc-ports", requireAdmin, (req, res) => {
  const config = loadRuntimeConfig() || {};
  const saved = resolveSavedRtcPortRange(config);
  const environmentOverride = RTC_PORT_RANGE.source === "env";

  res.json({
    rtcPortStart: saved.start,
    rtcPortCount: saved.count,
    rtcPortEnd: saved.end,
    activeRtcPortStart: RTC_PORT_RANGE.start,
    activeRtcPortCount: RTC_PORT_RANGE.count,
    activeRtcPortEnd: RTC_PORT_RANGE.end,
    restartRequired: environmentOverride
      ? false
      : saved.start !== RTC_PORT_RANGE.start || saved.count !== RTC_PORT_RANGE.count,
    environmentOverride,
    configPath: getConfigPath(),
  });
});

app.get("/admin/settings/guest-login", requireAdmin, (req, res) => {
  try {
    const config = loadRuntimeConfig() || {};
    const settings = resolveGuestLoginSettings(config, { createProfile: true, persist: true });
    res.json({
      enabled: settings.enabled,
      profileUserId: settings.profileUserId,
      profileName: settings.profileName,
      configPath: getConfigPath(),
    });
  } catch (err) {
    console.error("Error loading guest login setting:", err);
    res.status(500).json({ error: "Failed to load guest login setting" });
  }
});

app.get("/admin/settings/default-client", requireAdmin, (req, res) => {
  const config = loadRuntimeConfig() || {};
  res.json({
    settings: resolveDefaultClientSettings(config.defaultClientSettings),
    configured: Object.prototype.hasOwnProperty.call(config, "defaultClientSettings"),
    configPath: getConfigPath(),
  });
});

app.get("/admin/settings/multiple-productions", requireAdminSession, (req, res) => {
  const primaryProduction = getPrimaryProduction();
  res.json({
    enabled: areMultipleProductionsEnabled(),
    configurable: Boolean(req.adminSession.isGlobalAdmin),
    primaryProductionId: primaryProduction?.id ?? null,
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
      runningInContainer: isRunningInContainer(),
    });
  } catch (err) {
    console.error("Error saving mDNS setting:", err);
    return res.status(500).json({ error: "Failed to save mDNS setting" });
  }
});

app.put("/admin/settings/media-network", requireAdmin, (req, res) => {
  const nextMode = normalizeMediaNetworkMode(req.body?.mediaNetworkMode);
  if (!nextMode) {
    return res.status(400).json({ error: "Invalid media network mode" });
  }

  const nextInterfaceName = normalizeMediaInterfaceName(req.body?.mediaInterfaceName);
  const nextAnnouncedAddress = normalizeMediaAnnouncedAddress(req.body?.mediaAnnouncedAddress);
  if (nextMode === "interface" && !nextInterfaceName) {
    return res.status(400).json({ error: "Please choose a network adapter" });
  }
  if (nextMode === "manual" && !nextAnnouncedAddress) {
    return res.status(400).json({ error: "Please enter a manual IP address or hostname" });
  }

  const currentConfig = loadRuntimeConfig() || {};
  const updatedConfig = {
    ...currentConfig,
    mediaNetworkMode: nextMode,
  };
  if (nextMode === "interface") {
    updatedConfig.mediaInterfaceName = nextInterfaceName;
    delete updatedConfig.mediaAnnouncedAddress;
  } else if (nextMode === "manual") {
    updatedConfig.mediaAnnouncedAddress = nextAnnouncedAddress;
    delete updatedConfig.mediaInterfaceName;
  } else {
    delete updatedConfig.mediaInterfaceName;
    delete updatedConfig.mediaAnnouncedAddress;
  }

  try {
    const configPath = saveRuntimeConfig(updatedConfig);
    const active = resolveTransportAnnouncedAddress();
    const environmentOverride = active.source === "env";
    return res.json({
      mediaNetworkMode: nextMode,
      mediaInterfaceName: nextMode === "interface" ? nextInterfaceName : "",
      mediaAnnouncedAddress: nextMode === "manual" ? nextAnnouncedAddress : "",
      activeMediaNetworkMode: active.mode,
      activeMediaInterfaceName: active.interfaceName,
      activeAnnouncedAddress: active.announcedAddress,
      activeRtcAddresses: getActiveRtcAddresses(active),
      activeResolutionError: active.error,
      availableInterfaces: getAvailableMediaNetworkInterfaces(),
      restartRequired: !environmentOverride,
      environmentOverride,
      runningInContainer: isRunningInContainer(),
      configPath,
    });
  } catch (err) {
    console.error("Error saving media network setting:", err);
    return res.status(500).json({ error: "Failed to save media network setting" });
  }
});

app.put("/admin/settings/rtc-ports", requireAdmin, (req, res) => {
  const nextRange = normalizeRtcPortRange(req.body?.rtcPortStart, req.body?.rtcPortCount);
  if (nextRange.error) {
    return res.status(400).json({ error: nextRange.error });
  }

  const currentConfig = loadRuntimeConfig() || {};
  const updatedConfig = {
    ...currentConfig,
    rtcPortStart: nextRange.start,
    rtcPortCount: nextRange.count,
  };

  try {
    const configPath = saveRuntimeConfig(updatedConfig);
    const environmentOverride = RTC_PORT_RANGE.source === "env";
    return res.json({
      rtcPortStart: nextRange.start,
      rtcPortCount: nextRange.count,
      rtcPortEnd: nextRange.end,
      activeRtcPortStart: RTC_PORT_RANGE.start,
      activeRtcPortCount: RTC_PORT_RANGE.count,
      activeRtcPortEnd: RTC_PORT_RANGE.end,
      restartRequired: !environmentOverride && (
        nextRange.start !== RTC_PORT_RANGE.start ||
        nextRange.count !== RTC_PORT_RANGE.count
      ),
      environmentOverride,
      configPath,
    });
  } catch (err) {
    console.error("Error saving RTC port setting:", err);
    return res.status(500).json({ error: "Failed to save RTC port setting" });
  }
});

app.put("/admin/settings/guest-login", requireAdmin, (req, res) => {
  const enabled = req.body?.enabled === true;

  try {
    const currentConfig = loadRuntimeConfig() || {};
    const profile = getOrCreateGuestProfile();
    addEntityToPrimaryProductionWhenSingle("user", profile.id);
    const updatedConfig = {
      ...currentConfig,
      guestLogin: {
        ...(currentConfig.guestLogin && typeof currentConfig.guestLogin === "object" ? currentConfig.guestLogin : {}),
        enabled,
        profileUserId: profile.id,
      },
    };
    const configPath = saveRuntimeConfig(updatedConfig);
    return res.json({
      enabled,
      profileUserId: profile.id,
      profileName: profile.name,
      configPath,
    });
  } catch (err) {
    console.error("Error saving guest login setting:", err);
    return res.status(500).json({ error: "Failed to save guest login setting" });
  }
});

app.put("/admin/settings/default-client", requireAdmin, (req, res) => {
  try {
    const settings = normalizeConfiguredDefaultClientSettings(req.body, { strict: true });
    const currentConfig = loadRuntimeConfig() || {};
    const updatedConfig = {
      ...currentConfig,
      defaultClientSettings: settings,
    };
    const configPath = saveRuntimeConfig(updatedConfig);
    return res.json({
      settings: resolveDefaultClientSettings(settings),
      configured: true,
      configPath,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Invalid default client settings" });
  }
});

app.put("/admin/settings/multiple-productions", requireAdmin, (req, res) => {
  if (typeof req.body?.enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be boolean" });
  }
  const enabled = req.body?.enabled === true;
  try {
    const currentConfig = loadRuntimeConfig() || {};
    const configPath = saveRuntimeConfig({
      ...currentConfig,
      multipleProductions: enabled,
    });
    if (!enabled) {
      const primaryProductionId = getPrimaryProduction()?.id ?? null;
      for (const peer of peers.values()) {
        if (!isOperatorPeer(peer)) continue;
        const hadDifferentProduction = String(peer.productionId ?? "") !== String(primaryProductionId ?? "");
        peer.productionId = primaryProductionId;
        if (hadDifferentProduction) {
          peer.socket.emit("active-production-reset", {
            productionId: primaryProductionId,
            reason: "multiple-productions-disabled",
          });
        }
        peer.socket.emit("user-targets-updated");
        peer.socket.emit("conference-list", getEffectiveConferencesForPeer(peer));
        peer.socket.emit("conference-members-updated", { conferenceId: null });
        emitPeerTallyState(peer);
      }
      reconcileAllProducerRecipients();
      broadcastRuntimeUserStates("multiple-productions-disabled");
    }
    notifyAvailableProductionsChanged();
    return res.json({ enabled, configurable: true, configPath });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to save production mode" });
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

      if (
        Object.prototype.hasOwnProperty.call(bundle.serverConfig, "mediaNetworkMode")
        || Object.prototype.hasOwnProperty.call(bundle.serverConfig, "mediaInterfaceName")
        || Object.prototype.hasOwnProperty.call(bundle.serverConfig, "mediaAnnouncedAddress")
      ) {
        const importedMediaConfig = resolveSavedMediaNetworkConfig(bundle.serverConfig);
        nextConfig.mediaNetworkMode = importedMediaConfig.mode;
        if (importedMediaConfig.mode === "interface") {
          nextConfig.mediaInterfaceName = importedMediaConfig.interfaceName;
          delete nextConfig.mediaAnnouncedAddress;
        } else if (importedMediaConfig.mode === "manual") {
          nextConfig.mediaAnnouncedAddress = importedMediaConfig.announcedAddress;
          delete nextConfig.mediaInterfaceName;
        } else {
          delete nextConfig.mediaInterfaceName;
          delete nextConfig.mediaAnnouncedAddress;
        }
      }

      if (
        Object.prototype.hasOwnProperty.call(bundle.serverConfig, "rtcPortStart")
        || Object.prototype.hasOwnProperty.call(bundle.serverConfig, "rtcPortCount")
      ) {
        const importedRtcRange = normalizeRtcPortRange(
          bundle.serverConfig.rtcPortStart,
          bundle.serverConfig.rtcPortCount,
          resolveSavedRtcPortRange(nextConfig)
        );
        if (importedRtcRange.error) {
          return res.status(400).json({ error: `Config file contains an invalid RTC port range: ${importedRtcRange.error}` });
        }
        nextConfig.rtcPortStart = importedRtcRange.start;
        nextConfig.rtcPortCount = importedRtcRange.count;
      }

      if (bundle.serverConfig.guestLogin && typeof bundle.serverConfig.guestLogin === "object") {
        const importedGuestProfileId = Number(bundle.serverConfig.guestLogin.profileUserId);
        nextConfig.guestLogin = {
          enabled: bundle.serverConfig.guestLogin.enabled === true,
          profileUserId: Number.isFinite(importedGuestProfileId) ? importedGuestProfileId : null,
        };
      }

      if (Object.prototype.hasOwnProperty.call(bundle.serverConfig, "defaultClientSettings")) {
        try {
          nextConfig.defaultClientSettings = normalizeConfiguredDefaultClientSettings(
            bundle.serverConfig.defaultClientSettings,
            { strict: true }
          );
        } catch (error) {
          return res.status(400).json({
            error: `Config file contains invalid default client settings: ${error.message}`,
          });
        }
      }

      if (Object.prototype.hasOwnProperty.call(bundle.serverConfig, "multipleProductions")) {
        nextConfig.multipleProductions = bundle.serverConfig.multipleProductions === true;
      }
    }

    importDatabaseSnapshot(bundle.database);
    if (nextConfig.guestLogin && typeof nextConfig.guestLogin === "object") {
      const configuredGuestProfile = Number.isFinite(Number(nextConfig.guestLogin.profileUserId))
        ? getUserById(Number(nextConfig.guestLogin.profileUserId))
        : null;
      if (!configuredGuestProfile?.is_guest_profile) {
        const fallbackGuestProfile = getOrCreateGuestProfile();
        nextConfig.guestLogin.profileUserId = fallbackGuestProfile.id;
      }
    }
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
    if (!user || user.is_guest_profile) {
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
      productions: getEnabledProductionsForUser(user.id).map(({ id, name: productionName }) => ({
        id,
        name: productionName,
      })),
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

app.put("/admin/password", requireAdminSession, (req, res) => {
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
  if (user.is_guest_profile) {
    return res.status(403).json({ error: "Guest profile cannot be an admin account" });
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

async function createAdminLoginLinkPayload(kind, id, req, includeQrCode = false) {
  const active = resolveTransportAnnouncedAddress();
  const connectUrl = resolveAdminConnectUrl(active.announcedAddress, req);
  let token = null;
  let loginUrl = "";

  if (kind === "feed") {
    token = createFeedLoginToken(id);
    loginUrl = buildLoginUrl(connectUrl, token);
  } else {
    const user = getUserById(id);
    if (!user) throw new Error("User not found");

    if (user.is_guest_profile) {
      const guestSettings = resolveGuestLoginSettings(loadRuntimeConfig() || {}, { createProfile: false });
      if (!guestSettings.enabled || String(guestSettings.profileUserId) !== String(user.id)) {
        throw new Error("Guest login is disabled");
      }
      loginUrl = buildGuestLoginUrl(connectUrl);
    } else {
      token = createUserLoginToken(id);
      loginUrl = buildLoginUrl(connectUrl, token);
    }
  }
  let qrCodeDataUrl = null;

  if (includeQrCode && loginUrl) {
    qrCodeDataUrl = await QRCode.toDataURL(loginUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 640,
      color: {
        dark: "#0f172a",
        light: "#ffffff",
      },
    });
  }

  return { token, loginUrl: loginUrl || null, qrCodeDataUrl };
}

app.post("/admin/users/:id/login-link", requireAdmin, async (req, res) => {
  try {
    const payload = await createAdminLoginLinkPayload(
      "user",
      req.params.id,
      req,
      req.query?.qr === "1"
    );
    res.setHeader("Cache-Control", "no-store");
    return res.json(payload);
  } catch (err) {
    const status = err.message === "User not found" ? 404 : 400;
    return res.status(status).json({ error: err.message || "Failed to create login link" });
  }
});

app.post("/admin/feeds/:id/login-link", requireAdmin, async (req, res) => {
  try {
    const payload = await createAdminLoginLinkPayload(
      "feed",
      req.params.id,
      req,
      req.query?.qr === "1"
    );
    res.setHeader("Cache-Control", "no-store");
    return res.json(payload);
  } catch (err) {
    const status = err.message === "Feed not found" ? 404 : 400;
    return res.status(status).json({ error: err.message || "Failed to create login link" });
  }
});

app.post("/users", requireAdmin, (req, res) => {
  const { name, password } = req.body;
  try {
    const id = createUser(name, password);
    addEntityToPrimaryProductionWhenSingle("user", id);
    scheduleAdminStatusBroadcast("user-created");
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
    addEntityToPrimaryProductionWhenSingle("conference", id);
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
    addEntityToPrimaryProductionWhenSingle("feed", id);
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
  try {
    const productionId = getSingleProductionMembershipScope();
    setProductionConferenceMembership(productionId, req.params.userId, req.params.conferenceId);
    notifyTargetChange(req.params.userId);
    notifyConferenceMembersChanged(req.params.conferenceId, req.params.userId);
    broadcastRuntimeUserStates("conference-membership-added");
    res.sendStatus(204);
  } catch (err) {
    res.status(err?.statusCode || 400).json({ error: err.message || "Failed to add conference member" });
  }
});


app.post('/users/:id/targets', requireAdmin, (req, res) => {
  const { targetType, targetId } = req.body;
  try {
    const productionId = getSingleProductionMembershipScope();
    addProductionTarget(productionId, req.params.id, targetType, targetId);
    notifyTargetChange(req.params.id);
    if (targetType === 'conference') {
      notifyConferenceMembersChanged(targetId, req.params.id);
      broadcastRuntimeUserStates("conference-membership-added");
    }
    res.sendStatus(204);
  } catch (err) {
    console.error('Error in add-target:', err);
    res.status(err?.statusCode || 400).json({ error: err.message || 'Failed to add target' });
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
    const productionId = getSingleProductionMembershipScope();
    updateProductionTargetOrder(productionId, req.params.id, normalized);
    notifyTargetChange(req.params.id);
    res.sendStatus(204);
  } catch (err) {
    console.error('Failed to update target order:', err);
    res.status(err?.statusCode || 400).json({ error: err.message || 'Failed to reorder targets' });
  }
});

app.get("/api/v1/companion/config", requireCompanionApiKey, (req, res) => {
  const availableProductions = !areMultipleProductionsEnabled()
    ? []
    : hasCompanionGlobalAccess(req.companionAuth)
      ? getAllProductions().map(({ id, name }) => ({ id, name }))
      : getEnabledProductionsForUser(req.companionAuth.userId).map(({ id, name }) => ({ id, name }));
  res.json({
    version: 1,
    auth: {
      type: "api-key-or-session-token",
      header: "x-api-key",
      alternative: "Authorization: Bearer <api-key-or-session-token>",
      loginEndpoint: "/api/v1/companion/auth/login",
    },
    scope: buildCompanionAuthScope(req.companionAuth),
    productions: availableProductions,
    realtime: {
      transport: "socket.io",
      namespace: "/companion",
      events: ["snapshot", "user-state", "command-result", "cut-camera"],
    },
  });
});

app.get("/api/v1/companion/state", requireCompanionApiKey, (req, res) => {
  try {
    const productionId = resolveCompanionProduction(req.companionAuth, req.query?.productionId);
    res.json(buildCompanionSnapshotForAuth(req.companionAuth, productionId));
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.get("/api/v1/companion/users", requireCompanionApiKey, (req, res) => {
  let productionId = null;
  try {
    productionId = resolveCompanionProduction(req.companionAuth, req.query?.productionId);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
  const memberIds = productionId === null
    ? null
    : new Set(getProductionMembers(productionId).map((member) => Number(member.id)));
  const allUsers = getCompanionAddressableUsers()
    .filter((user) => memberIds === null || memberIds.has(Number(user.id)))
    .map((user) => ({
      id: user.id,
      name: user.name,
      state: buildCompanionUserState(user.id, user.name, null, productionId),
    }));

  if (!hasCompanionGlobalAccess(req.companionAuth)) {
    const ownUserId = Number(req.companionAuth?.userId);
    const ownRows = allUsers.filter((row) => Number(row.id) === ownUserId);
    return res.json(ownRows);
  }

  res.json(allUsers);
});

app.get("/api/v1/companion/conferences", requireCompanionApiKey, (req, res) => {
  try {
    const productionId = resolveCompanionProduction(req.companionAuth, req.query?.productionId);
    res.json(productionId === null ? getAllConferences() : getProductionConferences(productionId));
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.get("/api/v1/companion/feeds", requireCompanionApiKey, (req, res) => {
  try {
    const productionId = resolveCompanionProduction(req.companionAuth, req.query?.productionId);
    res.json(productionId === null ? getAllFeeds() : getProductionFeeds(productionId));
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.use("/api/v1/bridge", allowBridgeCors);

app.post("/api/v1/bridge/announce", requireBridgeApiAuth, (req, res) => {
  const body = req.body || {};
  const inventory = sanitizeBridgeInventory(body.inventory || {});
  const id = normalizeBridgeId(body.bridgeId || body.id);
  if (!canBridgeAuthAccessBridge(req.bridgeApiAuth, id)) {
    return res.status(403).json({ error: "Bridge registration requires global API key access or this bridge token" });
  }
  const name = normalizeBridgeRegistryText(body.bridgeName || body.name, id);
  const platform = normalizeBridgePlatform(body.platform);
  const now = Date.now();
  const previousEntry = bridgeRegistry.get(id);
  const previousOnline = previousEntry && now - Number(previousEntry.lastSeenAtMs || 0) <= BRIDGE_REGISTRY_STALE_MS;
  const firstSeenAtMs = previousOnline
    ? Number(previousEntry.firstSeenAtMs || previousEntry.lastSeenAtMs || now)
    : now;
  const remoteAddress = normalizeBridgeRegistryText(resolveBridgeRequestIp(req), null);
  if (previousEntry?.staleTimer) clearTimeout(previousEntry.staleTimer);
  const storedToken = bridgeTokenStore.get(id)?.token || "";
  const bridgeToken = previousEntry?.token || storedToken || generateBridgeToken();
  const bridgeTokenEntry = {
    token: bridgeToken,
    tokenHash: hashBridgeToken(bridgeToken),
    createdAt: bridgeTokenStore.get(id)?.createdAt || new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
  bridgeTokenStore.set(id, bridgeTokenEntry);
  saveBridgeTokenStore();
  const entry = {
    id,
    name,
    platform,
    inventory,
    remoteAddress,
    token: bridgeToken,
    tokenHash: bridgeTokenEntry.tokenHash,
    firstSeenAtMs,
    firstSeenAtIso: new Date(firstSeenAtMs).toISOString(),
    lastSeenAtMs: now,
    lastSeenAtIso: new Date(now).toISOString(),
    staleTimer: null,
  };
  entry.staleTimer = setTimeout(() => {
    scheduleAdminStatusBroadcast("bridge-stale");
  }, BRIDGE_REGISTRY_STALE_MS + 100);
  bridgeRegistry.set(id, entry);
  scheduleAdminStatusBroadcast("bridge-announced");

  res.json({
    bridge: serializeBridgeRegistryEntry(entry, now),
    bridgeToken,
    config: buildBridgeRuntimeConfig(id),
  });
});

app.get("/api/v1/bridge/:bridgeId/config", requireBridgeApiAuth, (req, res) => {
  if (!canBridgeAuthAccessBridge(req.bridgeApiAuth, req.params.bridgeId)) {
    return res.status(403).json({ error: "Bridge config requires global API key access or this bridge token" });
  }
  res.json(buildBridgeRuntimeConfig(req.params.bridgeId));
});

app.put("/api/v1/bridge/:bridgeId/ports/:kind/:id", requireBridgeApiAuth, (req, res) => {
  const bridgeId = normalizeBridgeId(req.params.bridgeId);
  if (!canBridgeAuthAccessBridge(req.bridgeApiAuth, bridgeId)) {
    return res.status(403).json({ error: "Bridge port updates require access to this bridge" });
  }

  const kind = String(req.params.kind || "").trim().toLowerCase();
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId < 1) {
    return res.status(400).json({ error: "Invalid bridge port id" });
  }

  const config = {
    ...(req.body || {}),
    enabled: true,
    bridgeDevice: bridgeId,
  };

  try {
    if (kind === "user") {
      const user = getUserById(targetId);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.is_guest_profile) {
        return res.status(403).json({ error: "Guest profile cannot be a bridge endpoint" });
      }
      if (user.is_superadmin) {
        return res.status(403).json({ error: "Superadmin cannot be a bridge endpoint" });
      }
      const updated = updateUserBridgeEndpoint(targetId, config);
      if (!updated) return res.status(404).json({ error: "User not found" });
      scheduleAdminStatusBroadcast("bridge-endpoint-updated");
      return res.json(buildBridgeRuntimeConfig(bridgeId));
    }

    if (kind === "feed") {
      const feed = getAllFeeds().find((entry) => Number(entry.id) === targetId);
      if (!feed) return res.status(404).json({ error: "Feed not found" });
      const updated = updateFeedBridgeEndpoint(targetId, config);
      if (!updated) return res.status(404).json({ error: "Feed not found" });
      scheduleAdminStatusBroadcast("bridge-feed-endpoint-updated");
      return res.json(buildBridgeRuntimeConfig(bridgeId));
    }

    return res.status(400).json({ error: "Bridge port kind must be user or feed" });
  } catch (err) {
    const message = String(err?.message || "Invalid bridge endpoint config");
    if (
      message.includes("channel") ||
      message.includes("required") ||
      message.toLowerCase().includes("production") ||
      message.toLowerCase().includes("trigger") ||
      message.includes("Invalid user id") ||
      message.includes("Invalid feed id")
    ) {
      return res.status(400).json({ error: message });
    }
    console.error("Error updating bridge port endpoint:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/v1/bridge/sessions", requireBridgeApiAuth, (req, res) => {
  if (!canBridgeAuthAccessBridge(req.bridgeApiAuth, req.body?.bridgeId)) {
    return res.status(403).json({ error: "Bridge sessions require global API key access or this bridge token" });
  }
  try {
    const session = createBridgeControlSession({
      bridgeId: req.body?.bridgeId,
      userId: req.body?.userId,
      feedId: req.body?.feedId,
      portId: req.body?.portId,
      remoteAddress: resolveBridgeRequestIp(req),
    });
    res.json({
      sessionId: session.id,
      port: session.port,
    });
  } catch (error) {
    res.status(400).json({ error: error?.message || "Failed to create bridge session" });
  }
});

app.delete(
  "/api/v1/bridge/sessions/:sessionId",
  requireBridgeApiAuth,
  requireBridgeControlSession,
  (req, res) => {
    const reason = typeof req.body?.reason === "string" && req.body.reason.trim()
      ? req.body.reason.trim().slice(0, 300)
      : "bridge-session-client-stop";
    closeBridgeControlSession(req.bridgeSession.id, reason);
    res.json({ ok: true });
  }
);

app.post(
  "/api/v1/bridge/sessions/:sessionId/heartbeat",
  requireBridgeApiAuth,
  requireBridgeControlSession,
  (req, res) => {
    logBridgeMediaDiagnostics(req.bridgeSession, req.body?.mediaDiagnostics);
    for (const entry of Array.isArray(req.body?.lifecycleEvents) ? req.body.lifecycleEvents.slice(-20) : []) {
      const event = typeof entry?.event === "string" ? entry.event.trim().slice(0, 80) : "unknown";
      const detail = typeof entry?.detail === "string" ? entry.detail.trim().slice(0, 500) : "";
      if (!event) continue;
      console.log(
        `[MEDIA][BRIDGE][LIFECYCLE] ${req.bridgeSession.bridgeId}/${req.bridgeSession.kind}:`
        + `${req.bridgeSession.userId ?? req.bridgeSession.feedId} event=${JSON.stringify(event)}`
        + (detail ? ` detail=${JSON.stringify(detail)}` : "")
      );
    }
    res.json({ ok: true });
  }
);

app.get(
  "/api/v1/bridge/sessions/:sessionId/events",
  requireBridgeApiAuth,
  requireBridgeControlSession,
  (req, res) => {
    const events = req.bridgeSession.events.splice(0, 100);
    res.json({ events });
  }
);

app.get(
  "/api/v1/bridge/sessions/:sessionId/events/stream",
  requireBridgeApiAuth,
  requireBridgeControlSession,
  (req, res) => {
    const session = req.bridgeSession;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    req.socket?.setTimeout?.(0);

    const stream = {
      res,
      heartbeat: null,
    };
    session.eventStreams.add(stream);
    res.write("retry: 1000\n\n");

    const queuedEvents = session.events.splice(0, 100);
    for (const event of queuedEvents) {
      writeSseEvent(res, "bridge-event", event);
    }

    stream.heartbeat = setInterval(() => {
      if (session.closed) {
        clearInterval(stream.heartbeat);
        session.eventStreams.delete(stream);
        try {
          res.end();
        } catch {}
        return;
      }
      try {
        res.write(": heartbeat\n\n");
        // The Bridge keeps this SSE stream in its native process. Its webview
        // heartbeat may be throttled while the app is hidden, but a writable
        // native stream still proves that this control session is alive.
        session.lastSeenAt = Date.now();
      } catch {
        session.eventStreams.delete(stream);
        clearInterval(stream.heartbeat);
      }
    }, 25_000);

    res.on("close", () => {
      session.eventStreams.delete(stream);
      clearInterval(stream.heartbeat);
      if (shouldCloseBridgeSessionAfterEventStreamClose(session)) {
        closeBridgeControlSession(session.id, "bridge-event-stream-disconnected");
      }
    });
  }
);

app.get(
  "/api/v1/bridge/sessions/:sessionId/active-producers",
  requireBridgeApiAuth,
  requireBridgeControlSession,
  (req, res) => {
    res.json({
      producers: listActiveProducersForPeer(req.bridgePeer, req.bridgeSession.id),
    });
  }
);

app.post(
  "/api/v1/bridge/sessions/:sessionId/plain-send-transport",
  requireBridgeApiAuth,
  requireBridgeControlSession,
  async (req, res) => {
    try {
      if (!router) return res.status(503).json({ error: "Router not initialized" });
      const peer = req.bridgePeer;
      const mediaRoute = resolveTransportAnnouncedAddress();
      if (mediaRoute.error || !mediaRoute.announcedAddress) {
        return res.status(500).json({ error: mediaRoute.error || "No announced media IP" });
      }
      const mediaAddress = selectMediaRouteAddress(mediaRoute, req.socket?.localAddress);
      if (peer.plainSendTransport && !peer.plainSendTransport.closed) {
        try {
          peer.plainSendTransport.close();
        } catch {}
      }
      const transport = await router.createPlainTransport({
        listenIp: {
          ip: "0.0.0.0",
          announcedIp: mediaAddress,
        },
        rtcpMux: true,
        comedia: true,
      });
      peer.plainSendTransport = transport;
      transport.observer.on("close", () => {
        if (peer.plainSendTransport === transport) peer.plainSendTransport = null;
      });
      res.json({
        id: transport.id,
        ip: mediaAddress,
        port: transport.tuple.localPort,
        protocol: transport.tuple.protocol,
        payloadType: GATEWAY_OPUS_PAYLOAD_TYPE,
        ssrc: GATEWAY_OPUS_SSRC
          + (req.bridgePeer.kind === "feed"
            ? 10000 + Number(req.bridgePeer.feedId || 0)
            : Number(req.bridgePeer.userId || 0)),
      });
    } catch (error) {
      res.status(500).json({ error: error?.message || "Failed to create plain send transport" });
    }
  }
);

app.post(
  "/api/v1/bridge/sessions/:sessionId/producers",
  requireBridgeApiAuth,
  requireBridgeControlSession,
  async (req, res) => {
    try {
      const peer = req.bridgePeer;
      const transport = peer.plainSendTransport;
      if (!transport || transport.closed) {
        return res.status(409).json({ error: "Plain send transport not ready" });
      }
      const producerAppData = peer.kind === "feed"
        ? { type: "feed", id: Number(peer.feedId) }
        : { type: "talk" };
      const producerCname = peer.kind === "feed"
        ? `talktome-bridge-feed-${peer.feedId}`
        : `talktome-bridge-${peer.userId}`;
      for (const [existingId, existing] of peer.producers.entries()) {
        const existingType = String(existing?.appData?.type || "");
        const isSameProducerKind = peer.kind === "feed"
          ? existingType === "feed" && String(existing?.appData?.id) === String(peer.feedId)
          : existingType === "talk";
        if (isSameProducerKind) {
          try {
            existing.close();
          } catch {}
          peer.producers.delete(existingId);
        }
      }
      const payloadType = Number(req.body?.payloadType || GATEWAY_OPUS_PAYLOAD_TYPE);
      const fallbackSsrc = GATEWAY_OPUS_SSRC + (
        peer.kind === "feed" ? 10000 + Number(peer.feedId || 0) : Number(peer.userId || 0)
      );
      const ssrc = Number(req.body?.ssrc || fallbackSsrc);
      const producer = await transport.produce({
        kind: "audio",
        rtpParameters: buildGatewayAudioRtpParameters({
          payloadType,
          ssrc,
          cname: producerCname,
          stereo: true,
        }),
        appData: producerAppData,
      });
      attachProducerMediaDiagnostics(
        producer,
        `bridge:${req.bridgeSession.bridgeId}/${req.bridgeSession.kind}:${req.bridgeSession.userId ?? req.bridgeSession.feedId}`
      );
      producer.__startedAt = Date.now();
      peer.producers.set(producer.id, producer);
      producer.__recipientDeliveries = new Map();
      producer.observer.on("pause", () => {
        syncPeerCompanionState(peer, { reason: "bridge-producer-paused" });
        broadcastRuntimeUserStates("bridge-producer-paused");
      });
      producer.observer.on("resume", () => {
        producer.__startedAt = Date.now();
        announceProducerToRecipients({
          producerId: producer.id,
          appData: producer.appData,
          speakerSocketId: req.bridgeSession.id,
          forceAnnounce: true,
        });
        syncPeerCompanionState(peer, { reason: "bridge-producer-resumed" });
        broadcastRuntimeUserStates("bridge-producer-resumed");
      });
      producer.on("transportclose", () => {
        peer.producers.delete(producer.id);
      });
      if (peer.kind === "feed") {
        announceProducerToRecipients({
          producerId: producer.id,
          appData: producer.appData,
          speakerSocketId: req.bridgeSession.id,
        });
        syncPeerCompanionState(peer, { reason: "bridge-feed-producer-started" });
        broadcastRuntimeUserStates("bridge-feed-producer-started");
      } else {
        await producer.pause();
      }
      res.json({ id: producer.id });
    } catch (error) {
      res.status(500).json({ error: error?.message || "Failed to create bridge producer" });
    }
  }
);

app.post(
  "/api/v1/bridge/sessions/:sessionId/producers/:producerId/:action",
  requireBridgeApiAuth,
  requireBridgeControlSession,
  async (req, res) => {
    const producer = req.bridgePeer.producers.get(req.params.producerId);
    if (!producer) return res.status(404).json({ error: "Producer not found" });
    try {
      if (req.params.action === "pause") {
        await producer.pause();
      } else if (req.params.action === "resume") {
        await producer.resume();
      } else {
        return res.status(400).json({ error: "Action must be pause or resume" });
      }
      res.json({ ok: true, paused: producer.paused });
    } catch (error) {
      res.status(500).json({ error: error?.message || "Failed to change producer state" });
    }
  }
);

app.post(
  "/api/v1/bridge/sessions/:sessionId/talk-state",
  requireBridgeApiAuth,
  requireBridgeControlSession,
  (req, res) => {
    const peer = req.bridgePeer;
    if (peer.kind !== "user") {
      return res.status(400).json({ error: "Talk state is only supported for user bridge sessions" });
    }
    const targets = normalizeRuntimeTalkTargets(req.body?.targets);
    const talking = Boolean(req.body?.talking && targets.length > 0);
    peer.activeTalkTargets = talking ? targets : [];
    peer.pttTalking = talking;
    peer.pttStartedAt = talking ? (peer.pttStartedAt || Date.now()) : 0;
    updateCompanionUserState(peer.userId, {
      userName: peer.name,
      online: true,
      socketId: req.bridgeSession.id,
      talking,
      talkLocked: Boolean(req.body?.lockActive),
      currentTarget: talking ? targets[0] : null,
      currentTargets: talking ? targets : [],
      lastTarget: targets[0] || undefined,
      lastTargets: targets.length ? targets : undefined,
    }, {
      reason: "bridge-talk-state",
      fallbackName: peer.name,
    });
    if (talking) {
      for (const producer of getPeerActiveTalkProducers(peer)) {
        syncProducerRecipients({ producer, speakerSocketId: req.bridgeSession.id });
      }
    }
    syncPeerCompanionState(peer, { reason: "bridge-talk-state" });
    broadcastRuntimeUserStates("bridge-talk-state");
    res.json({ ok: true, talking, targets });
  }
);

app.post(
  "/api/v1/bridge/sessions/:sessionId/command-result",
  requireBridgeApiAuth,
  requireBridgeControlSession,
  (req, res) => {
    if (req.bridgePeer.kind !== "user") {
      return res.status(400).json({ error: "Command results are only supported for user bridge sessions" });
    }
    const payload = req.body || {};
    const commandId = typeof payload.commandId === "string" ? payload.commandId : null;
    if (commandId) {
      const result = {
        commandId,
        userId: req.bridgePeer.userId,
        userName: req.bridgePeer.name,
        socketId: req.bridgeSession.id,
        ok: Boolean(payload.ok),
        action: payload.action || null,
        targetType: payload.targetType || null,
        targetId: payload.targetId ?? null,
        reason: payload.reason || null,
        at: new Date().toISOString(),
      };
      updateCompanionUserState(req.bridgePeer.userId, {
        lastCommandId: commandId,
        lastCommandResult: result.ok ? "ok" : (result.reason || "failed"),
      }, {
        reason: "bridge-command-result",
        fallbackName: req.bridgePeer.name,
      });
      result.state = buildCompanionUserState(req.bridgePeer.userId, req.bridgePeer.name);
      settleCompanionPendingCommand(commandId, result);
      emitCompanionEvent("command-result", result);
    }
    res.json({ ok: true });
  }
);

app.post(
  "/api/v1/bridge/sessions/:sessionId/consumers",
  requireBridgeApiAuth,
  requireBridgeControlSession,
  async (req, res) => {
    try {
      if (req.bridgePeer.kind !== "user") {
        return res.status(400).json({ error: "Bridge consumers are only supported for user bridge sessions" });
      }
      if (!router) return res.status(503).json({ error: "Router not initialized" });
      const producerId = String(req.body?.producerId || "");
      // New Bridge clients establish the return path from their reserved UDP
      // receive port. Keep the explicit target fallback for older clients.
      const useRtpHandshake = req.body?.rtpHandshake === true;
      const targetPort = Number(req.body?.port);
      const targetIp = useRtpHandshake ? "" : resolveBridgeRequestIp(req);
      if (
        !producerId
        || (!useRtpHandshake && (
          !targetIp
          || !Number.isInteger(targetPort)
          || targetPort < 1
          || targetPort > 65535
        ))
      ) {
        return res.status(400).json({ error: "Invalid bridge consumer target" });
      }
      let producerPeerId = null;
      for (const [peerId, peer] of peers) {
        if (peer.producers.has(producerId)) {
          producerPeerId = peerId;
          break;
        }
      }
      if (!producerPeerId) return res.status(404).json({ error: "Producer not found" });
      if (!router.canConsume({ producerId, rtpCapabilities: router.rtpCapabilities })) {
        return res.status(409).json({ error: "Cannot consume producer" });
      }
      const mediaRoute = useRtpHandshake ? resolveTransportAnnouncedAddress() : null;
      if (useRtpHandshake && (mediaRoute?.error || !mediaRoute?.announcedAddress)) {
        return res.status(500).json({ error: mediaRoute?.error || "No announced media IP" });
      }
      const mediaAddress = useRtpHandshake
        ? selectMediaRouteAddress(mediaRoute, req.socket?.localAddress)
        : "";
      const transport = await router.createPlainTransport({
        listenIp: useRtpHandshake
          ? { ip: "0.0.0.0", announcedIp: mediaAddress }
          : { ip: "0.0.0.0" },
        rtcpMux: true,
        comedia: useRtpHandshake,
      });
      if (!useRtpHandshake) {
        await transport.connect({ ip: targetIp, port: targetPort });
      }
      const consumer = await transport.consume({
        producerId,
        rtpCapabilities: router.rtpCapabilities,
        paused: true,
      });
      consumer.__plainTransport = transport;
      consumer.__bridgeRtpHandshakeRequired = useRtpHandshake;
      req.bridgePeer.consumers.set(consumer.id, consumer);
      if (useRtpHandshake) {
        transport.on("tuple", (tuple) => {
          console.log(
            `[BRIDGE][RTP] Learned return path ${tuple.remoteIp}:${tuple.remotePort} `
            + `for consumer ${consumer.id}`
          );
        });
        console.log(
          `[BRIDGE][RTP] Waiting for return-path handshake on `
          + `${mediaAddress}:${transport.tuple.localPort} for consumer ${consumer.id}`
        );
      }
      const cleanup = () => {
        req.bridgePeer?.consumers.delete(consumer.id);
        try {
          if (!transport.closed) transport.close();
        } catch {}
      };
      consumer.on("transportclose", cleanup);
      consumer.on("producerclose", () => {
        cleanup();
        queueBridgeControlEvent(req.bridgeSession, "consumer-closed", {
          consumerId: consumer.id,
          producerId,
        });
      });
      res.json({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        transport: useRtpHandshake ? {
          ip: mediaAddress,
          port: transport.tuple.localPort,
          protocol: transport.tuple.protocol,
          rtcpMux: true,
          comedia: true,
        } : null,
      });
    } catch (error) {
      res.status(500).json({ error: error?.message || "Failed to create bridge consumer" });
    }
  }
);

app.post(
  "/api/v1/bridge/sessions/:sessionId/consumers/:consumerId/resume",
  requireBridgeApiAuth,
  requireBridgeControlSession,
  async (req, res) => {
    const consumer = req.bridgePeer.consumers.get(req.params.consumerId);
    if (!consumer) return res.status(404).json({ error: "Consumer not found" });
    try {
      if (consumer.__bridgeRtpHandshakeRequired) {
        await waitForBridgeRtpHandshake(consumer.__plainTransport);
      }
      await consumer.resume();
      res.json({ ok: true });
    } catch (error) {
      const status = error?.code === "BRIDGE_RTP_HANDSHAKE_TIMEOUT" ? 504 : 500;
      console.warn(`[BRIDGE][RTP] Failed to resume consumer ${consumer.id}:`, error?.message || error);
      res.status(status).json({ error: error?.message || "Failed to resume bridge consumer" });
    }
  }
);

app.delete(
  "/api/v1/bridge/sessions/:sessionId/consumers/:consumerId",
  requireBridgeApiAuth,
  requireBridgeControlSession,
  (req, res) => {
    const consumer = req.bridgePeer.consumers.get(req.params.consumerId);
    if (consumer) {
      const transport = consumer.__plainTransport;
      try {
        consumer.close();
      } catch {}
      req.bridgePeer.consumers.delete(consumer.id);
      try {
        if (transport && !transport.closed) transport.close();
      } catch {}
    }
    res.json({ ok: true });
  }
);

app.get("/api/v1/companion/users/:id/targets", requireCompanionApiKey, (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) {
    return res.status(400).json({ error: "Invalid user id" });
  }
  if (!isCompanionAddressableUserId(userId)) {
    return res.status(404).json({ error: "User not found" });
  }
  if (!canCompanionControlUser(req.companionAuth, userId)) {
    return res.status(403).json({ error: "Companion session cannot access this user" });
  }
  try {
    const productionId = resolveCompanionProduction(req.companionAuth, req.query?.productionId);
    if (productionId !== null && !isUserInProduction(userId, productionId)) {
      return res.status(403).json({ error: "User is not a member of this production" });
    }
    const targets = productionId === null
      ? getUserTargets(userId)
      : getProductionTargets(userId, productionId);
    res.json(targets);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post("/api/v1/client/logout", (req, res) => {
  clearBrowserSession(req, res);
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const userId = Number(body.userId);
  const socketId = typeof body.socketId === "string" ? body.socketId : null;

  if (!Number.isFinite(userId)) {
    return res.sendStatus(204);
  }

  const disconnected = socketId
    ? disconnectUserPeerForLogout({ userId, socketId })
    : false;

  // Fallback: if no live peer was found, reflect offline immediately for companion.
  if (
    !disconnected
    && !socketId
    && !findUserPeerByUserId(userId)
    && isCompanionAddressableUserId(userId)
  ) {
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
        currentTargets: [],
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
    scheduleAdminStatusBroadcast("user-renamed");
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
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.is_guest_profile) {
      return res.status(403).json({ error: 'Guest profile does not use a password' });
    }

    const updated = updateUserPassword(req.params.id, password.trim());
    if (!updated) return res.status(404).json({ error: 'User not found' });
    res.sendStatus(204);
  } catch (err) {
    console.error('Error updating password:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/users/:id/bridge-endpoint', requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  try {
    const user = getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.is_guest_profile) {
      return res.status(403).json({ error: 'Guest profile cannot be a bridge endpoint' });
    }
    if (user.is_superadmin) {
      return res.status(403).json({ error: 'Superadmin cannot be a bridge endpoint' });
    }

    const updated = updateUserBridgeEndpoint(userId, req.body || {});
    if (!updated) return res.status(404).json({ error: 'User not found' });
    scheduleAdminStatusBroadcast("bridge-endpoint-updated");
    res.sendStatus(204);
  } catch (err) {
    const message = String(err?.message || 'Invalid bridge endpoint config');
    if (
      message.includes('channel') ||
      message.includes('required') ||
      message.toLowerCase().includes('production') ||
      message.includes('Invalid user id')
    ) {
      return res.status(400).json({ error: message });
    }
    console.error('Error updating bridge endpoint:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/feeds/:id/bridge-endpoint', requireAdmin, (req, res) => {
  const feedId = Number(req.params.id);
  if (!Number.isInteger(feedId) || feedId < 1) {
    return res.status(400).json({ error: 'Invalid feed id' });
  }

  try {
    const feed = getAllFeeds().find((entry) => Number(entry.id) === feedId);
    if (!feed) return res.status(404).json({ error: 'Feed not found' });

    const updated = updateFeedBridgeEndpoint(feedId, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Feed not found' });
    scheduleAdminStatusBroadcast("bridge-feed-endpoint-updated");
    res.sendStatus(204);
  } catch (err) {
    const message = String(err?.message || 'Invalid bridge endpoint config');
    if (
      message.includes('channel') ||
      message.includes('required') ||
      message.toLowerCase().includes('production') ||
      message.includes('Invalid feed id')
    ) {
      return res.status(400).json({ error: message });
    }
    console.error('Error updating feed bridge endpoint:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Rename conference
app.put('/conferences/:id', requireAdmin, (req, res) => {
  const { name } = req.body;
  try {
    const success = updateConferenceName(req.params.id, name);
    if (!success) return res.status(404).json({ error: 'Conference not found' });
    notifyConferenceMembersChanged(req.params.id);
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
    const productionId = getSingleProductionMembershipScope();
    removeProductionConferenceMembership(productionId, req.params.userId, req.params.conferenceId);
    notifyTargetChange(req.params.userId);
    notifyConferenceMembersChanged(req.params.conferenceId, req.params.userId);
    broadcastRuntimeUserStates("conference-membership-removed");
    res.sendStatus(204);
  } catch (err) {
    console.error(err);
    res.status(err?.statusCode || 500).json({ error: err.message || "Internal server error" });
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
    if (user.is_guest_profile) {
      return res.status(403).json({ error: "Guest profile cannot be deleted" });
    }
    deleteUser(req.params.id);
    notifyConferenceMembersChanged(null);
    scheduleAdminStatusBroadcast("user-deleted");
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
  try {
    deleteConference(req.params.id);
    notifyConferenceMembersChanged(req.params.id);
    broadcastRuntimeUserStates("conference-deleted");
    res.sendStatus(204);
  } catch (err) {
    console.error('Error deleting conference:', err);
    res.status(500).json({ error: err?.message || "Failed to delete conference" });
  }
});

app.delete("/users/:id/targets/:type/:tid", requireAdmin, (req, res) => {
  try {
    const productionId = getSingleProductionMembershipScope();
    removeProductionTarget(productionId, req.params.id, req.params.type, req.params.tid);
    notifyTargetChange(req.params.id);
    if (req.params.type === 'conference') {
      notifyConferenceMembersChanged(req.params.tid, req.params.id);
      broadcastRuntimeUserStates("conference-membership-removed");
    }
    res.sendStatus(204);
  } catch (err) {
    res.status(err?.statusCode || 400).json({ error: err.message || 'Failed to remove target' });
  }
});

function notifyTargetChange(userId) {
  const idStr = String(userId);
  for (const [, peer] of peers) {
    if (
      (peer.kind === "user" && String(peer.userId) === idStr) ||
      (peer.kind === "guest" && String(peer.guestProfileUserId) === idStr)
    ) {
      peer.socket.emit('user-targets-updated');
    }
  }
  if (isCompanionAddressableUserId(userId)) {
    emitCompanionEvent("user-targets-updated", {
      at: new Date().toISOString(),
      userId: Number(userId),
    });
  }
  reconcileAllProducerRecipients();
}

function notifyConferenceMembersChanged(conferenceId, excludedProfileUserId = null) {
  const numericConferenceId = conferenceId == null ? null : Number(conferenceId);
  const excludedId = excludedProfileUserId == null ? null : String(excludedProfileUserId);
  for (const peer of peers.values()) {
    if (!isOperatorPeer(peer)) continue;
    const profileUserId = peer.kind === "guest" ? peer.guestProfileUserId : peer.userId;
    if (excludedId !== null && String(profileUserId) === excludedId) continue;
    peer.socket.emit('conference-members-updated', {
      conferenceId: numericConferenceId !== null && Number.isFinite(numericConferenceId)
        ? numericConferenceId
        : null,
    });
  }
  reconcileAllProducerRecipients();
}

function resetPeersUsingProduction(productionId, userId = null) {
  const productionKey = String(productionId);
  const userKey = userId == null ? null : String(userId);
  for (const peer of peers.values()) {
    if (!isOperatorPeer(peer) || String(peer.productionId ?? "") !== productionKey) continue;
    const profileUserId = peer.kind === "guest" ? peer.guestProfileUserId : peer.userId;
    if (userKey !== null && String(profileUserId) !== userKey) continue;
    const fallbackProduction = getProductionsForUser(profileUserId)[0] || null;
    peer.productionId = fallbackProduction?.id ?? null;
    peer.socket.emit("active-production-reset", {
      productionId: peer.productionId,
      reason: "production-access-removed",
    });
    peer.socket.emit("user-targets-updated");
    peer.socket.emit("conference-list", getEffectiveConferencesForPeer(peer));
    peer.socket.emit("conference-members-updated", { conferenceId: null });
    emitPeerTallyState(peer);
  }
  reconcileAllProducerRecipients();
}

function notifyAvailableProductionsChanged(userId = null) {
  const userKey = userId == null ? null : String(userId);
  for (const peer of peers.values()) {
    if (!isOperatorPeer(peer)) continue;
    const profileUserId = peer.kind === "guest" ? peer.guestProfileUserId : peer.userId;
    if (userKey !== null && String(profileUserId) !== userKey) continue;
    peer.socket.emit("available-productions-updated", {
      productions: getEnabledProductionsForUser(profileUserId).map(({ id, name }) => ({ id, name })),
    });
  }
}


// Create a self-signed certificate if none exists yet.
// Keep certificates in the per-user app data directory (writable across platforms).
const certDir = path.join(getDataDir(), "certs");
const keyPath = path.join(certDir, "key.pem");
const certPath = path.join(certDir, "cert.pem");

if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
}

function isLikelyIPv4Address(value) {
  return typeof value === "string" && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value.trim());
}

function buildSelfSignedTlsCertificate() {
  const configuredPublicIp = typeof process.env.PUBLIC_IP === "string"
    ? process.env.PUBLIC_IP.trim()
    : "";
  const hostnames = new Set(["localhost"]);
  const ipAddresses = new Set(["127.0.0.1"]);

  const maybeAddHostOrIp = (value) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (isLikelyIPv4Address(trimmed)) {
      ipAddresses.add(trimmed);
      return;
    }
    hostnames.add(trimmed);
  };

  maybeAddHostOrIp(mdnsHostname);
  maybeAddHostOrIp(os.hostname());
  maybeAddHostOrIp(configuredPublicIp);
  getLocalIPv4Addresses().forEach((address) => maybeAddHostOrIp(address));

  const preferredCommonName =
    (configuredPublicIp && configuredPublicIp.trim()) ||
    mdnsHostname ||
    os.hostname() ||
    "localhost";

  const altNames = [
    ...Array.from(hostnames).map((value) => ({ type: 2, value })),
    ...Array.from(ipAddresses).map((ip) => ({ type: 7, ip })),
  ];

  return selfsigned.generate(
    [{ name: "commonName", value: preferredCommonName }],
    {
      // A 4096-bit key is needlessly expensive for the locally trusted,
      // self-signed certificate.  On slower Windows machines node-forge
      // creates it synchronously and the first launch looks like a hung app
      // for tens of seconds.  2048-bit RSA remains broadly compatible with
      // browsers while making first-run certificate creation near-instant.
      keySize: 2048,
      days: 365,
      algorithm: "sha256",
      extensions: [
        { name: "basicConstraints", cA: false },
        {
          name: "keyUsage",
          digitalSignature: true,
          keyEncipherment: true,
        },
        {
          name: "extKeyUsage",
          serverAuth: true,
        },
        {
          name: "subjectAltName",
          altNames,
        },
      ],
    }
  );
}

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  const pems = buildSelfSignedTlsCertificate();
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
installHttpRedirectOnHttpsPort(server, {
  httpsPort: HTTPS_PORT,
  fallbackHost: mdnsHostname || "localhost",
});
const io = socketIO(server, { serveClient: false });

companionNamespace = io.of("/companion");
companionNamespace.use((socket, next) => {
  const candidate = extractCompanionApiKeyFromSocket(socket);
  const auth = resolveCompanionAuth(candidate);
  if (!candidate || !auth) {
    return next(new Error("unauthorized"));
  }
  try {
    const requestedProduction = socket.handshake?.auth?.productionId
      ?? socket.handshake?.query?.productionId
      ?? null;
    socket.data.productionId = resolveCompanionProduction(auth, requestedProduction);
    socket.data.companionAuth = auth;
  } catch (err) {
    return next(new Error(err.message || "production access denied"));
  }
  next();
});
companionNamespace.on("connection", (socket) => {
  socket.data.connectedAt = Date.now();
  markCompanionSocketSeen(socket);
  const announcedName = socket.handshake?.auth?.instanceName
    || socket.handshake?.auth?.clientName
    || socket.handshake?.auth?.name;
  socket.data.instanceName = typeof announcedName === "string" && announcedName.trim()
    ? announcedName.trim().slice(0, 120)
    : null;
  socket.onAny(() => {
    markCompanionSocketSeen(socket);
  });
  socket.conn?.on?.("packet", () => {
    markCompanionSocketSeen(socket);
  });
  scheduleAdminStatusBroadcast("companion-connected");
  socket.emit("snapshot", buildCompanionSnapshotForAuth(
    socket.data?.companionAuth || null,
    socket.data?.productionId ?? null
  ));
  socket.on("request-snapshot", () => {
    markCompanionSocketSeen(socket);
    socket.emit("snapshot", buildCompanionSnapshotForAuth(
      socket.data?.companionAuth || null,
      socket.data?.productionId ?? null
    ));
  });
  socket.on("disconnect", () => {
    clearCompanionStatusTimer(socket);
    scheduleAdminStatusBroadcast("companion-disconnected");
  });
});

app.post("/cut-camera", (req, res) => {
  const { user } = req.body;
  if (typeof user !== "string") {
    return res.status(400).json({ error: "user must be provided" });
  }

  let bus;
  let productionId;
  try {
    bus = normalizeTallyBus(req.body?.bus);
    productionId = resolveCompanionProduction({ type: "api-key" }, req.body?.productionId);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message });
  }

  const nextUser = user.trim() || null;
  if (nextUser) {
    const matchedUser = getUserByName(nextUser);
    if (!isCompanionAddressableUser(matchedUser)) {
      return res.status(404).json({ error: "User not found" });
    }
    if (productionId !== null && !isUserInProduction(matchedUser.id, productionId)) {
      return res.status(400).json({ error: "User is not a member of this production" });
    }
  }

  console.log(`[TALLY] ${bus.toUpperCase()} request for ${nextUser || "off"} in production ${productionId}`);
  const updated = tallyState.set(productionId, bus, nextUser);
  emitProductionTallyState(productionId);

  const payload = {
    at: new Date().toISOString(),
    productionId,
    bus,
    previousUser: updated.previousUser,
    user: updated.user,
    pgmUser: updated.pgmUser,
    prvUser: updated.prvUser,
  };
  emitCompanionTallyEvent(productionId, payload);

  if (updated.previousUser !== updated.user) {
    const touchedNames = new Set([updated.previousUser, updated.user].filter(Boolean));
    if (touchedNames.size) {
      const allUsers = getAllUsers();
      allUsers.forEach((u) => {
        if (touchedNames.has(u.name) && (productionId === null || isUserInProduction(u.id, productionId))) {
          emitCompanionUserState(u.id, "cut-camera-changed", u.name);
        }
      });
    }
  }

  res.json(payload);
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

  const preferredTransportAddress = resolveTransportAnnouncedAddress();
  if (preferredTransportAddress.mode === "interface" && preferredTransportAddress.announcedAddress) {
    return [preferredTransportAddress.announcedAddress];
  }

  if (isRunningInContainer()) {
    return [];
  }

  return Array.from(new Set(getLocalIPv4Addresses()));
}

function isRunningInContainer() {
  if (process.env.TALKTOME_RUNNING_IN_CONTAINER === "1") return true;
  if (fs.existsSync("/.dockerenv")) return true;

  try {
    const cgroup = fs.readFileSync("/proc/1/cgroup", "utf8");
    return /docker|containerd|kubepods|podman/i.test(cgroup);
  } catch {
    return false;
  }
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

const http = require("http");

function getHttpsRedirectHost(req) {
  const rawHost = String(req.headers.host || "").trim();
  const bracketedIpv6 = rawHost.match(/^(\[[0-9a-f:.]+\])(?::\d+)?$/i);
  if (bracketedIpv6) return bracketedIpv6[1];
  const hostname = rawHost.match(/^([a-z0-9.-]+)(?::\d+)?$/i);
  return hostname?.[1] || mdnsHostname || "localhost";
}

function redirectToHttps(req, res) {
  const host = getHttpsRedirectHost(req);
  res.writeHead(301, {
    Connection: "close",
    Location: `https://${host}:${HTTPS_PORT}${req.url}`,
  });
  res.end();
}

// Optional dedicated HTTP → HTTPS redirect server
if (HTTP_PORT !== null) {
  const redirectServer = http.createServer(redirectToHttps);

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
const GATEWAY_OPUS_PAYLOAD_TYPE = 100;
const GATEWAY_OPUS_SSRC = 11111111;

function buildGatewayAudioRtpParameters({
  payloadType = GATEWAY_OPUS_PAYLOAD_TYPE,
  ssrc = GATEWAY_OPUS_SSRC,
  cname = "talktome-radio-gateway",
  stereo = false,
} = {}) {
  return {
    codecs: [
      {
        mimeType: "audio/opus",
        payloadType,
        clockRate: 48000,
        channels: 2,
        parameters: {
          "sprop-stereo": stereo ? 1 : 0,
          ...(stereo ? { stereo: 1 } : {}),
        },
        rtcpFeedback: [],
      },
    ],
    encodings: [{ ssrc }],
    rtcp: {
      cname,
      reducedSize: true,
      mux: true,
    },
  };
}

function attachProducerMediaDiagnostics(producer, label) {
  if (!producer?.on) return;
  let previousScore = null;
  producer.on("score", (scores = []) => {
    const compact = (Array.isArray(scores) ? scores : []).map((entry) => ({
      ssrc: entry?.ssrc ?? null,
      score: entry?.score ?? null,
    }));
    const serialized = JSON.stringify(compact);
    if (serialized === previousScore) return;
    previousScore = serialized;
    const degraded = compact.some((entry) => Number(entry.score) < 10);
    const method = degraded ? console.warn : console.log;
    method(
      `[MEDIA][RTP][PRODUCER-SCORE] ${new Date().toISOString()} ${label} `
      + `producer=${producer.id} scores=${serialized}`
    );
  });
}

function attachWebRtcTransportDiagnostics(socketId, direction, transport) {
  if (!transport?.on) return;
  const log = (event, state, extra = "") => {
    console.log(
      `[MEDIA][WEBRTC][SERVER-TRANSPORT] ${new Date().toISOString()} socket=${socketId} `
      + `direction=${direction} transport=${transport.id} event=${event} state=${state || "unknown"}`
      + (extra ? ` ${extra}` : "")
    );
  };
  transport.on("icestatechange", (state) => log("ice-state", state));
  transport.on("iceselectedtuplechange", (tuple) => log(
    "ice-selected-tuple",
    transport.iceState,
    `tuple=${tuple?.protocol || "unknown"}:${tuple?.remoteIp || "unknown"}:${tuple?.remotePort || "unknown"}`
  ));
  transport.on("dtlsstatechange", (state) => log("dtls-state", state));
  transport.observer?.on?.("close", () => log("close", "closed"));
}

function queueBridgeControlEvent(session, event, payload = {}) {
  if (!session || session.closed) return;
  const relevantEvents = new Set([
    "new-producer",
    "producer-closed",
    "consumer-closed",
    "incoming-talk-state",
    "api-talk-command",
    "api-target-audio-command",
    "session-kicked",
  ]);
  if (!relevantEvents.has(event)) return;
  const entry = {
    id: crypto.randomUUID(),
    event,
    payload,
    at: new Date().toISOString(),
  };
  const deliveredStreams = writeBridgeControlEventToStreams(session, entry);
  if (deliveredStreams > 0) return;

  session.events.push(entry);
  if (session.events.length > 250) {
    session.events.splice(0, session.events.length - 250);
  }
}

function writeSseEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeBridgeControlEventToStreams(session, entry) {
  if (!session?.eventStreams?.size) return 0;
  let delivered = 0;
  for (const stream of [...session.eventStreams]) {
    try {
      writeSseEvent(stream.res, "bridge-event", entry);
      delivered += 1;
    } catch {
      session.eventStreams.delete(stream);
      clearInterval(stream.heartbeat);
    }
  }
  return delivered;
}

function closeBridgeControlSession(sessionId, reason = "bridge-session-closed") {
  const session = bridgeControlSessions.get(String(sessionId));
  if (!session || session.closed) return false;
  const sessionAgeMs = Math.max(0, Date.now() - Number(session.createdAt || Date.now()));
  console.log(
    `[MEDIA][BRIDGE][SESSION] close ${session.bridgeId}/${session.kind}:${session.userId ?? session.feedId} `
    + `id=${session.id} reason=${JSON.stringify(String(reason))} ageMs=${sessionAgeMs} `
    + `producer=${session.peer?.producers?.size || 0}`
  );
  session.closed = true;
  for (const stream of [...(session.eventStreams || [])]) {
    try {
      writeSseEvent(stream.res, "session-closed", { reason });
      stream.res.end();
    } catch {}
    clearInterval(stream.heartbeat);
  }
  session.eventStreams?.clear();

  const peer = peers.get(session.id);
  const disconnectedUserId = peer?.userId ?? null;
  const disconnectedUserName = peer?.name || null;
  if (peer) {
    for (const producer of peer.producers.values()) {
      try {
        producer.close();
      } catch {}
    }
    for (const consumer of peer.consumers.values()) {
      try {
        consumer.close();
      } catch {}
      try {
        if (consumer.__plainTransport && !consumer.__plainTransport.closed) {
          consumer.__plainTransport.close();
        }
      } catch {}
    }
    try {
      if (peer.plainSendTransport && !peer.plainSendTransport.closed) {
        peer.plainSendTransport.close();
      }
    } catch {}
  }

  peers.delete(session.id);
  bridgeControlSessions.delete(session.id);

  if (disconnectedUserId !== null && !findUserPeerByUserId(disconnectedUserId)) {
    updateUserLastOnline(disconnectedUserId);
    updateCompanionUserState(disconnectedUserId, {
      userName: disconnectedUserName,
      online: false,
      socketId: null,
      talking: false,
      talkLocked: false,
      currentTarget: null,
      currentTargets: [],
      targetAudioStates: [],
      lastSpokeAt: Date.now(),
    }, {
      reason,
      fallbackName: disconnectedUserName,
    });
    failPendingCommandsForUser(disconnectedUserId, reason);
  }

  emitUserListToOperators();
  broadcastRuntimeUserStates(reason);
  return true;
}

function createBridgeControlSession({ bridgeId, userId = null, feedId = null, portId = null, remoteAddress = null }) {
  const config = buildBridgeRuntimeConfig(bridgeId);
  const normalizedPortId = typeof portId === "string" && portId.trim() ? portId.trim() : null;
  const numericUserId = userId !== null && userId !== undefined ? Number(userId) : null;
  const numericFeedId = feedId !== null && feedId !== undefined ? Number(feedId) : null;
  const port = config.ports.find((entry) => {
    if (normalizedPortId) return String(entry.id) === normalizedPortId;
    if (Number.isFinite(numericUserId)) {
      return entry.kind === "user" && Number(entry.userId) === numericUserId;
    }
    if (Number.isFinite(numericFeedId)) {
      return entry.kind === "feed" && Number(entry.feedId) === numericFeedId;
    }
    return false;
  });
  if (!port) {
    throw new Error("Bridge endpoint is not configured for this bridge");
  }

  const isFeedPort = port.kind === "feed";
  const existing = isFeedPort
    ? findFeedPeerByFeedId(port.feedId)
    : findUserPeerByUserId(port.userId);
  if (existing) {
    try {
      existing.peer?.socket?.emit("session-kicked", {
        reason: "bridge-session-replaced",
      });
    } catch {}
    const existingBridgeSession = bridgeControlSessions.get(existing.socketId);
    if (existingBridgeSession) {
      closeBridgeControlSession(existing.socketId, "bridge-session-replaced");
    } else {
      try {
        existing.peer?.socket?.disconnect(true);
      } catch {}
    }
  }

  const entityType = isFeedPort ? "feed" : "user";
  const entityId = isFeedPort ? Number(port.feedId) : Number(port.userId);
  const id = `bridge:${normalizeBridgeId(bridgeId)}:${entityType}:${entityId}:${crypto.randomUUID()}`;
  const session = {
    id,
    bridgeId: normalizeBridgeId(bridgeId),
    kind: entityType,
    userId: isFeedPort ? null : Number(port.userId),
    feedId: isFeedPort ? Number(port.feedId) : null,
    productionId: null,
    port,
    events: [],
    eventStreams: new Set(),
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    closed: false,
  };
  const registryEntry = bridgeRegistry.get(session.bridgeId);
  const normalizedRemoteAddress = normalizeBridgeRegistryText(remoteAddress, null);
  if (registryEntry && normalizedRemoteAddress) {
    registryEntry.remoteAddress = normalizedRemoteAddress;
  }
  const virtualSocket = {
    id,
    emit(event, payload) {
      const eventPayload = event === "new-producer" && payload?.peerId && payload?.producerId
        ? buildBridgeProducerPayload(payload.peerId, payload.producerId, payload.appData)
        : payload;
      queueBridgeControlEvent(session, event, eventPayload);
      return true;
    },
    disconnect() {
      closeBridgeControlSession(id, "bridge-session-disconnected");
    },
  };
  const peer = {
    socket: virtualSocket,
    userId: isFeedPort ? null : Number(port.userId),
    feedId: isFeedPort ? Number(port.feedId) : null,
    guestId: null,
    guestProfileUserId: null,
    name: port.label,
    kind: entityType,
    productionId: null,
    consumers: new Map(),
    producers: new Map(),
    activeTalkTargets: [],
    pttTalking: false,
    pttStartedAt: 0,
    plainSendTransport: null,
    isBridgePeer: true,
    bridgeId: session.bridgeId,
    connectedAt: session.createdAt,
  };
  session.peer = peer;
  bridgeControlSessions.set(id, session);
  peers.set(id, peer);
  console.log(
    `[MEDIA][BRIDGE][SESSION] open ${session.bridgeId}/${session.kind}:${session.userId ?? session.feedId} `
    + `id=${session.id} port=${session.port.id}`
  );

  if (!isFeedPort) {
    updateUserLastOnline(peer.userId);
    updateCompanionUserState(peer.userId, {
      userName: peer.name,
      online: true,
      socketId: id,
      targetAudioStates: getUserTargetAudioStates(peer.userId),
    }, {
      reason: "bridge-user-online",
      fallbackName: peer.name,
    });
    syncPeerCompanionState(peer, { reason: "bridge-user-online" });
  }
  emitUserListToOperators();
  broadcastRuntimeUserStates(isFeedPort ? "bridge-feed-online" : "bridge-user-online");
  return session;
}

function requireBridgeControlSession(req, res, next) {
  const session = bridgeControlSessions.get(String(req.params.sessionId || ""));
  if (!session || session.closed) {
    return res.status(404).json({ error: "Bridge session not found" });
  }
  if (!canBridgeAuthAccessBridge(req.bridgeApiAuth, session.bridgeId)) {
    return res.status(403).json({ error: "Bridge session requires global API key access or this bridge token" });
  }
  session.lastSeenAt = Date.now();
  req.bridgeSession = session;
  req.bridgePeer = peers.get(session.id) || null;
  if (!req.bridgePeer) {
    closeBridgeControlSession(session.id, "bridge-peer-missing");
    return res.status(410).json({ error: "Bridge peer is no longer available" });
  }
  next();
}

function finiteDiagnosticCounter(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function logBridgeMediaDiagnostics(session, payload) {
  const input = payload?.input && typeof payload.input === "object" ? payload.input : null;
  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  const label = `${session.bridgeId}/${session.kind}:${session.userId ?? session.feedId}`;
  const previousOutputs = session.mediaOutputDiagnostics || {};
  const nextOutputs = Object.create(null);
  for (const output of Array.isArray(payload?.outputs) ? payload.outputs : []) {
    const streamId = String(output?.streamId || "unknown").slice(0, 160);
    const warningCount = finiteDiagnosticCounter(output?.ffmpegWarningCount);
    const previousWarningCount = finiteDiagnosticCounter(previousOutputs[streamId]?.ffmpegWarningCount);
    const warningDelta = Math.max(0, warningCount - previousWarningCount);
    const lastWarning = typeof output?.lastFfmpegWarning === "string"
      ? output.lastFfmpegWarning.trim().slice(0, 500)
      : "";
    if (warningDelta > 0) {
      console.warn(
        `[MEDIA][BRIDGE][FFMPEG] ${timestamp} ${label} output=${streamId} `
        + `warnings=+${warningDelta}/${warningCount}`
        + (lastWarning ? ` last=${JSON.stringify(lastWarning)}` : "")
      );
    }
    nextOutputs[streamId] = {
      ffmpegWarningCount: warningCount,
      decodedFrames: finiteDiagnosticCounter(output?.decodedFrames),
    };
  }
  session.mediaOutputDiagnostics = nextOutputs;
  if (!input) return;

  const current = {
    capturedFrames: finiteDiagnosticCounter(input.capturedFrames),
    droppedChunks: finiteDiagnosticCounter(input.droppedChunks),
    droppedFrames: finiteDiagnosticCounter(input.droppedFrames),
    ffmpegWarningCount: finiteDiagnosticCounter(input.ffmpegWarningCount),
    rmsDb: Number.isFinite(Number(input.rmsDb)) ? Number(input.rmsDb) : null,
    lastFfmpegWarning: typeof input.lastFfmpegWarning === "string"
      ? input.lastFfmpegWarning.trim().slice(0, 500)
      : "",
    reportedAt: now,
  };
  const previous = session.mediaDiagnostics || null;

  if (previous) {
    const droppedChunksDelta = Math.max(0, current.droppedChunks - previous.droppedChunks);
    const droppedFramesDelta = Math.max(0, current.droppedFrames - previous.droppedFrames);
    const warningDelta = Math.max(0, current.ffmpegWarningCount - previous.ffmpegWarningCount);
    if (droppedChunksDelta > 0 || droppedFramesDelta > 0) {
      console.warn(
        `[MEDIA][BRIDGE][DROP] ${timestamp} ${label} `
        + `chunks=+${droppedChunksDelta}/${current.droppedChunks} `
        + `frames=+${droppedFramesDelta}/${current.droppedFrames}`
      );
    }
    if (warningDelta > 0) {
      console.warn(
        `[MEDIA][BRIDGE][FFMPEG] ${timestamp} ${label} warnings=+${warningDelta}/${current.ffmpegWarningCount}`
        + (current.lastFfmpegWarning ? ` last=${JSON.stringify(current.lastFfmpegWarning)}` : "")
      );
    }
    if (current.capturedFrames === previous.capturedFrames && now - previous.reportedAt >= 5_000) {
      console.warn(`[MEDIA][BRIDGE][STALL] ${timestamp} ${label} capturedFrames=${current.capturedFrames}`);
    }
  }

  if (!session.lastMediaHealthLogAt || now - session.lastMediaHealthLogAt >= 60_000) {
    console.log(
      `[MEDIA][BRIDGE][HEALTH] ${timestamp} ${label} capturedFrames=${current.capturedFrames} `
      + `droppedChunks=${current.droppedChunks} droppedFrames=${current.droppedFrames} `
      + `ffmpegWarnings=${current.ffmpegWarningCount} rmsDb=${current.rmsDb ?? "unknown"}`
    );
    session.lastMediaHealthLogAt = now;
  }
  session.mediaDiagnostics = current;
}

function resolveBridgeRequestIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return normalizeSocketAddress(forwarded || req.socket?.remoteAddress);
}

function waitForBridgeRtpHandshake(transport) {
  const currentTuple = transport?.tuple;
  if (currentTuple?.remoteIp && currentTuple?.remotePort) {
    return Promise.resolve(currentTuple);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      transport?.off?.("tuple", onTuple);
      transport?.observer?.off?.("close", onClose);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onTuple = (tuple) => {
      if (tuple?.remoteIp && tuple?.remotePort) finish(resolve, tuple);
    };
    const onClose = () => {
      finish(reject, new Error("Bridge RTP transport closed before the handshake completed"));
    };

    transport?.on?.("tuple", onTuple);
    transport?.observer?.on?.("close", onClose);
    const tupleAfterListeners = transport?.tuple;
    if (tupleAfterListeners?.remoteIp && tupleAfterListeners?.remotePort) {
      finish(resolve, tupleAfterListeners);
      return;
    }
    timer = setTimeout(() => {
      const error = new Error(
        "Bridge RTP handshake timed out. Check the server announced media address and UDP RTC port forwarding."
      );
      error.code = "BRIDGE_RTP_HANDSHAKE_TIMEOUT";
      finish(reject, error);
    }, BRIDGE_RTP_HANDSHAKE_TIMEOUT_MS);
  });
}

function buildBridgeProducerPayload(peerId, producerId, appData, { retainOnly = false } = {}) {
  const speakerPeer = peers.get(peerId);
  return {
    peerId,
    producerId,
    appData,
    retainOnly: Boolean(retainOnly),
    speakerUserId: speakerPeer?.userId ?? speakerPeer?.guestProfileUserId ?? null,
    speakerName: speakerPeer?.name || null,
    speakerKind: speakerPeer?.kind || null,
  };
}

function listActiveProducersForPeer(peer, peerId) {
  if (!peer || peer.kind === "feed") return [];
  const response = [];
  let conferenceIds = null;
  let feedIds = null;
  const loadConferenceIds = () => {
    if (conferenceIds !== null) return conferenceIds;
    conferenceIds = new Set(
      getEffectiveConferencesForPeer(peer).map((conference) => String(conference.id))
    );
    return conferenceIds;
  };
  const loadFeedIds = () => {
    if (feedIds !== null) return feedIds;
    feedIds = new Set(getEffectiveFeedIdsForPeer(peer).map((id) => String(id)));
    return feedIds;
  };

  for (const [otherPeerId, otherPeer] of peers) {
    if (otherPeerId === peerId) continue;
    for (const [producerId, producer] of otherPeer.producers) {
      if (!producer || producer.closed) continue;
      const appData = producer.appData;
      const type = String(appData?.type || "").trim().toLowerCase();
      let activeDelivery = null;

      if (!producer.paused) {
        if (type === "feed" && loadFeedIds().has(String(appData.id))) {
          activeDelivery = { recipientSocketId: peerId, appData };
        } else if (type === "conference" && loadConferenceIds().has(String(appData.id))) {
          activeDelivery = { recipientSocketId: peerId, appData };
        } else if (["user", "talk", "guest"].includes(type)) {
          activeDelivery = resolveProducerRecipientDeliveries({
            appData,
            speakerSocketId: otherPeerId,
          }).find((candidate) => candidate.recipientSocketId === peerId) || null;
        }
      }

      const reconciliationDelivery = resolveProducerReconciliationDelivery({
        producer,
        recipientSocketId: peerId,
        activeDelivery,
      });
      if (!reconciliationDelivery?.appData) continue;
      response.push(buildBridgeProducerPayload(
        otherPeerId,
        producerId,
        reconciliationDelivery.appData,
        { retainOnly: reconciliationDelivery.retainOnly }
      ));
    }
  }
  return response;
}

const bridgeControlSessionCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - BRIDGE_CONTROL_SESSION_STALE_MS;
  for (const session of bridgeControlSessions.values()) {
    if (session.lastSeenAt < cutoff) {
      closeBridgeControlSession(session.id, "bridge-session-timeout");
    }
  }
}, 5_000);
bridgeControlSessionCleanupTimer.unref?.();

function warnIfDockerAnnouncedIpLooksInternal(announcedIp) {
  if (process.env.PUBLIC_IP) return;
  if (!fs.existsSync("/.dockerenv")) return;
  if (typeof announcedIp !== "string") return;
  if (!/^172\.(1[6-9]|2\d|3[0-1])\./.test(announcedIp.trim())) return;

  console.warn(
    `[TRANSPORT][WARN] Auto-detected announced IP ${announcedIp} looks like a Docker-internal bridge address. ` +
    `WebRTC media will usually fail from outside the container. Set PUBLIC_IP to the host/LAN IP and publish RTC ports ${RTC_PORT_RANGE.start}-${RTC_PORT_RANGE.end}, ` +
    `or use --network host on Linux.`
  );
}

const mediaReadyPromise = (async () => {
  console.log("[INIT] Starting mediasoup worker");
  try {
    worker = await mediasoup.createWorker({
      rtcMinPort: RTC_PORT_RANGE.start,
      rtcMaxPort: RTC_PORT_RANGE.end,
      logLevel: "warn",
      logTags: ["info", "ice", "dtls", "rtp", "srtp", "rtcp"],
    });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    // 0xC0000135 is Windows' STATUS_DLL_NOT_FOUND.  Keep this diagnostic
    // close to the actual cause; the mediasoup error otherwise only exposes
    // the opaque decimal exit code from its child process.
    if (process.platform === "win32" && /(?:3221225781|c0000135)/i.test(message)) {
      console.error(
        "[INIT] mediasoup worker could not load a required Windows runtime DLL " +
        "(0xC0000135). Reinstall Talktome; the installer must include the Microsoft Visual C++ runtime."
      );
    }
    throw err;
  }
  console.log("[INIT] Worker created with PID:", worker.pid);
  console.log(`[INIT] RTC ports: ${RTC_PORT_RANGE.start}-${RTC_PORT_RANGE.end}`);
  console.log(
    CLIENT_ICE_CONFIG.iceServers.length > 0
      ? `[INIT] Browser ICE: ${CLIENT_ICE_CONFIG.iceServers.length} configured server(s), policy ${CLIENT_ICE_CONFIG.iceTransportPolicy}`
      : "[INIT] Browser ICE: direct connection candidates"
  );

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
    guestId: peer.guestId ?? null,
    guestProfileUserId: peer.guestProfileUserId ?? null,
    kind: peer.kind ?? (peer.userId ? "user" : peer.feedId ? "feed" : "guest"),
    name: peer.name || null
  }));
}

function resolveApplePttRecipientUserIds({ type, targetId, targets = null, speakerSocketId }) {
  const recipientUserIds = new Set();
  const speakerPeer = peers.get(speakerSocketId);
  const speakerUserId = speakerPeer?.userId != null ? Number(speakerPeer.userId) : null;

  if (type === "talk") {
    const resolvedTargets = Array.isArray(targets)
      ? normalizeRuntimeTalkTargets(targets)
      : getPeerActiveTalkTargets(speakerPeer);
    for (const userId of resolveAddressedUserIdsForTargets(resolvedTargets, speakerUserId)) {
      recipientUserIds.add(Number(userId));
    }
  } else if (type === "user") {
    const targetUserId = resolveUserIdFromTargetIdentity(targetId);
    if (Number.isFinite(targetUserId)) {
      recipientUserIds.add(Number(targetUserId));
    }
  } else if (type === "conference") {
    for (const userId of resolveAddressedUserIdsForTarget(
      { type: "conference", id: targetId },
      speakerUserId
    )) {
      recipientUserIds.add(Number(userId));
    }
  } else if (type === "feed") {
    if (areMultipleProductionsEnabled()) {
      for (const peer of peers.values()) {
        if (!isOperatorPeer(peer)) continue;
        if (!getEffectiveFeedIdsForPeer(peer).some((id) => String(id) === String(targetId))) continue;
        const userId = peer.kind === "guest" ? peer.guestProfileUserId : peer.userId;
        if (Number.isFinite(Number(userId))) recipientUserIds.add(Number(userId));
      }
    } else {
      const listeners = getUsersForFeed(targetId) || [];
      for (const listener of listeners) {
        recipientUserIds.add(Number(listener.user_id));
      }
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
  return trimmed || "Talktome";
}

function resolveProducerRecipientDeliveriesForTargets({ targets, speakerSocketId }) {
  const deliveries = [];
  const seenRecipients = new Set();
  const speakerPeer = peers.get(speakerSocketId);

  for (const target of normalizeRuntimeTalkTargets(targets)) {
    if (!isTalkTargetAllowedForPeer(speakerPeer, target)) {
      continue;
    }
    const recipients = resolveRecipientPeersForTarget(target, speakerSocketId);
    for (const { socketId: recipientSocketId } of recipients) {
      if (!recipientSocketId || seenRecipients.has(recipientSocketId)) continue;
      seenRecipients.add(recipientSocketId);
      const appData = target.type === "conference"
        ? { type: "conference", id: Number(target.id) }
        : target.type === "guest"
          ? { type: "guest", id: String(target.id), targetPeer: recipientSocketId }
          : { type: "user", id: Number(target.id), targetPeer: recipientSocketId };
      deliveries.push({ recipientSocketId, appData });
    }
  }

  return deliveries;
}

function resolveProducerRecipientDeliveries({ appData, speakerSocketId }) {
  const type = typeof appData?.type === "string" ? appData.type.trim().toLowerCase() : "";
  const targetId = appData?.id;

  if (type === "talk") {
    const speakerPeer = peers.get(speakerSocketId);
    return resolveProducerRecipientDeliveriesForTargets({
      targets: speakerPeer?.activeTalkTargets || [],
      speakerSocketId,
    });
  }

  if (type === "user" || type === "conference" || type === "guest") {
    return resolveProducerRecipientDeliveriesForTargets({
      targets: [{ type, id: targetId }],
      speakerSocketId,
    });
  }

  if (type === "feed") {
    const deliveries = [];
    const speakerPeer = peers.get(speakerSocketId);
    for (const [sid, peer] of peers) {
      if (sid === speakerSocketId) continue;
      if (!isOperatorPeer(peer)) continue;
      if (!arePeersInSameActiveProduction(speakerPeer, peer)) continue;
      const feedIds = new Set(getEffectiveFeedIdsForPeer(peer).map((id) => String(id)));
      if (feedIds.has(String(targetId))) {
        deliveries.push({
          recipientSocketId: sid,
          appData: { ...appData },
        });
      }
    }
    return deliveries;
  }

  return [];
}

function closeProducerConsumersForRecipient({ producerId, recipientSocketId }) {
  const recipientPeer = peers.get(recipientSocketId);
  if (!recipientPeer) return;

  for (const consumer of Array.from(recipientPeer.consumers.values())) {
    if (String(consumer?.producerId || "") !== String(producerId)) {
      continue;
    }
    try {
      consumer.close();
      recipientPeer.consumers.delete(consumer.id);
      recipientPeer.socket?.emit("consumer-closed", { consumerId: consumer.id });
    } catch (error) {
      console.warn(`[ROUTE] Failed to close consumer ${consumer?.id} for producer ${producerId}:`, error?.message || error);
    }
  }
}

function getProducerRoutingTargets(producer, speakerPeer) {
  const type = String(producer?.appData?.type || "").trim().toLowerCase();
  if (type === "talk") {
    return normalizeRuntimeTalkTargets(speakerPeer?.activeTalkTargets || []);
  }
  if (["user", "conference", "guest"].includes(type)) {
    return normalizeRuntimeTalkTargets([{ type, id: producer?.appData?.id }]);
  }
  return [];
}

function buildConferenceRoutingDiagnostics(targets, speakerSocketId) {
  return targets
    .filter((target) => target?.type === "conference")
    .map((target) => ({
      conferenceId: Number(target.id),
      activePeers: Array.from(peers.entries())
        .filter(([socketId, peer]) => socketId !== speakerSocketId && isOperatorPeer(peer))
        .map(([socketId, peer]) => ({
          socketId,
          kind: peer.kind || null,
          userId: peer.userId ?? null,
          guestProfileUserId: peer.guestProfileUserId ?? null,
          productionId: peer.productionId ?? null,
          recognizedMember: isPeerMemberOfConference(peer, target.id),
        })),
    }));
}

function warnIfActiveProducerHasNoRecipients({ producer, speakerSocketId, speakerPeer, deliveries }) {
  if (!producer || producer.paused || deliveries.length > 0) return;
  const targets = getProducerRoutingTargets(producer, speakerPeer);
  if (targets.length === 0) return;

  console.warn(`[ROUTE][WARN] Active producer ${producer.id} has no recipients ${JSON.stringify({
    speaker: {
      socketId: speakerSocketId,
      kind: speakerPeer?.kind || null,
      userId: speakerPeer?.userId ?? null,
      guestProfileUserId: speakerPeer?.guestProfileUserId ?? null,
      productionId: speakerPeer?.productionId ?? null,
    },
    targets,
    conferences: buildConferenceRoutingDiagnostics(targets, speakerSocketId),
  })}`);
}

function syncProducerRecipients({ producer, speakerSocketId, forceAnnounce = false }) {
  if (!producer) return [];

  const speakerPeer = peers.get(speakerSocketId);

  const deliveries = resolveProducerRecipientDeliveries({
    appData: producer.appData,
    speakerSocketId,
  });
  warnIfActiveProducerHasNoRecipients({
    producer,
    speakerSocketId,
    speakerPeer,
    deliveries,
  });
  const previousDeliveries = producer.__recipientDeliveries instanceof Map
    ? producer.__recipientDeliveries
    : new Map();
  const nextDeliveries = new Map(
    deliveries.map((delivery) => [delivery.recipientSocketId, delivery.appData])
  );

  for (const [recipientSocketId, previousAppData] of previousDeliveries.entries()) {
    const nextAppData = nextDeliveries.get(recipientSocketId);
    const deliveryChanged = producerDeliveryChanged(previousAppData, nextAppData);
    if (!deliveryChanged) continue;
    closeProducerConsumersForRecipient({ producerId: producer.id, recipientSocketId });
  }

  for (const [recipientSocketId, nextAppData] of nextDeliveries.entries()) {
    const previousAppData = previousDeliveries.get(recipientSocketId);
    if (!shouldAnnounceProducerDelivery({
      previousAppData,
      nextAppData,
      forceAnnounce,
    })) continue;
    const recipientPeer = peers.get(recipientSocketId);
    if (!recipientPeer?.socket) continue;
    recipientPeer.socket.emit("new-producer", {
      peerId: speakerSocketId,
      speakerUserId: speakerPeer?.userId ?? null,
      producerId: producer.id,
      appData: nextAppData,
    });
  }

  producer.__recipientDeliveries = nextDeliveries;
  return deliveries;
}

function reconcileAllProducerRecipients({ forceAnnounce = false } = {}) {
  for (const [speakerSocketId, speakerPeer] of peers) {
    for (const producer of speakerPeer?.producers?.values?.() || []) {
      if (!producer || producer.closed) continue;
      syncProducerRecipients({ producer, speakerSocketId, forceAnnounce });
    }
  }
}

function announceProducerToRecipients({
  producerId,
  appData,
  speakerSocketId,
  forceAnnounce = false,
}) {
  const speakerPeer = peers.get(speakerSocketId);
  const producer = speakerPeer?.producers?.get(producerId) || null;
  if (!producer) return [];
  return syncProducerRecipients({
    producer,
    speakerSocketId,
    forceAnnounce,
  }).map((delivery) => delivery.recipientSocketId);
}

async function sendApplePttSpeakerStarted({ type, targetId, targets = null, speakerSocketId, reason }) {
  if (!applePttPushService.isConfigured()) {
    return [];
  }

  const recipientUserIds = resolveApplePttRecipientUserIds({ type, targetId, targets, speakerSocketId });
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

function emitUserListToOperators() {
  const userList = getUserList();
  for (const peer of peers.values()) {
    if (!isOperatorPeer(peer)) continue;
    try {
      peer.socket.emit("user-list", userList);
    } catch (err) {
      console.warn("[SIGNAL] Failed to emit user-list to operator:", err?.message || err);
    }
  }
  scheduleAdminStatusBroadcast("peer-list-changed");
}

io.on("connection", (socket) => {
  socket.on("connection-health", (acknowledge) => {
    if (typeof acknowledge === "function") acknowledge(true);
  });
  console.log(`[CONN] Client connected: ${socket.id}`);
  peers.set(socket.id, {
    socket,
    userId:   null,
    feedId:   null,
    guestId:  null,
    guestProfileUserId: null,
    name:     null,
    kind:     "guest",
    productionId: null,
    consumers: new Map(),
    producers: new Map(),
    activeTalkTargets: [],
    pttTalking: false,
    pttStartedAt: 0,
    connectedAt: null,
  });

  // Emit lists
  socket.emit("conference-list", getAllConferences());

  socket.on("media-network-stats", (payload = {}) => {
    const peer = peers.get(socket.id);
    if (!peer || peer.isBridgePeer || (peer.kind !== "user" && peer.kind !== "feed")) return;

    const stats = normalizeBrowserMediaStats(payload);
    if (!stats) return;
    logBrowserMediaStats(peer, socket.id, stats);
    peer.browserMediaStats = {
      ...stats,
      reportedAt: Date.now(),
    };
    scheduleAdminStatusBroadcast("browser-media-stats-updated");
  });

  socket.on("media-transport-event", (payload = {}) => {
    const peer = peers.get(socket.id);
    const direction = ["send", "receive"].includes(payload?.direction) ? payload.direction : "unknown";
    const event = String(payload?.event || "unknown").slice(0, 80);
    const state = String(payload?.state || "unknown").slice(0, 80);
    const detail = typeof payload?.detail === "string" ? payload.detail.trim().slice(0, 500) : "";
    const label = `${peer?.kind || "client"}:${peer?.userId ?? peer?.feedId ?? peer?.name ?? socket.id}`;
    console.log(
      `[MEDIA][WEBRTC][TRANSPORT] ${new Date().toISOString()} ${label} socket=${socket.id} `
      + `direction=${direction} event=${event} state=${state}`
      + (detail ? ` detail=${JSON.stringify(detail)}` : "")
    );
  });

  socket.on("register-user", ({ id, name, kind = "user", force = false, guestProfileUserId = null, productionId = null } = {}, callback) => {
    const peer = peers.get(socket.id);
    if (!peer) {
      if (typeof callback === "function") callback({ error: "Peer not registered" });
      return;
    }

    const normalizedKind = kind === "feed" ? "feed" : kind === "guest" ? "guest" : "user";
    const numericId = Number(id);
    let effectiveId = Number.isFinite(numericId) ? numericId : id;
    let effectiveName = name;

    if (normalizedKind === "user" || normalizedKind === "feed") {
      const browserSession = getBrowserSessionFromCookieHeader(socket.handshake?.headers?.cookie || "");
      const expectedKind = browserSession?.session?.kind;
      const expectedId = normalizedKind === "user"
        ? browserSession?.session?.userId
        : browserSession?.session?.feedId;
      const browserSessionMatches = expectedKind === normalizedKind
        && String(expectedId) === String(effectiveId);
      const companionAuth = resolveCompanionAuth(extractCompanionApiKeyFromSocket(socket));
      const apiCredentialMatches = !!companionAuth && (
        companionAuth.type === "api-key"
        || (
          normalizedKind === "user"
          && companionAuth.userId != null
          && String(companionAuth.userId) === String(effectiveId)
        )
      );
      if (!browserSessionMatches && !apiCredentialMatches) {
        if (typeof callback === "function") {
          callback({ error: "Authenticated identity does not match registration" });
        }
        return;
      }

      const identity = normalizedKind === "user"
        ? getUserById(effectiveId)
        : getFeedById(effectiveId);
      if (!identity || (normalizedKind === "user" && identity.is_guest_profile)) {
        if (typeof callback === "function") callback({ error: "Authenticated account no longer exists" });
        return;
      }
      effectiveId = identity.id;
      effectiveName = identity.name;
    }

    let activeProductionId = null;
    try {
      if (normalizedKind === "user") {
        activeProductionId = normalizeActiveProductionId(productionId, effectiveId);
      } else if (normalizedKind === "guest") {
        const guestSettings = resolveGuestLoginSettings(loadRuntimeConfig() || {}, { createProfile: false });
        activeProductionId = normalizeActiveProductionId(productionId, guestSettings.profileUserId);
      }
    } catch (error) {
      if (typeof callback === "function") callback({ error: error.message || "Production access denied" });
      return;
    }

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

      peer.name = effectiveName;
      peer.kind = normalizedKind;
      peer.userId = effectiveId;
      peer.feedId = null;
      peer.guestId = null;
      peer.guestProfileUserId = null;
      peer.productionId = activeProductionId;
      console.log(`[USER] Registered operator ${effectiveName} (${effectiveId}) on socket ${socket.id}`);
      emitPeerTallyState(peer);
    } else if (normalizedKind === "feed") {
      const existingFeed = Array.from(peers.entries()).find(([sid, p]) => (
        sid !== socket.id
        && p?.kind === "feed"
        && p?.feedId != null
        && String(p.feedId) === String(effectiveId)
      ));

      if (existingFeed) {
        const [, existingPeer] = existingFeed;
        try {
          existingPeer?.socket?.emit("session-kicked", {
            reason: "duplicate-feed-login",
            bySocketId: socket.id,
          });
        } catch {}
        try {
          existingPeer?.socket?.disconnect(true);
        } catch {}
      }

      peer.name = effectiveName;
      peer.kind = normalizedKind;
      peer.feedId = effectiveId;
      peer.userId = null;
      peer.guestId = null;
      peer.guestProfileUserId = null;
      peer.productionId = null;
      console.log(`[USER] Registered feed ${effectiveName} (${effectiveId}) on socket ${socket.id}`);
    } else {
      const settings = resolveGuestLoginSettings(loadRuntimeConfig() || {}, { createProfile: false });
      const requestedProfileId = Number(guestProfileUserId);
      if (!settings.enabled || !settings.profileUserId) {
        if (typeof callback === "function") callback({ error: "Guest login is disabled" });
        return;
      }
      if (Number.isFinite(requestedProfileId) && Number(requestedProfileId) !== Number(settings.profileUserId)) {
        if (typeof callback === "function") callback({ error: "Invalid guest profile" });
        return;
      }
      const guestId = String(id || crypto.randomUUID()).trim();
      peer.name = normalizeGuestDisplayName(name) || settings.profileName || "Guest";
      peer.kind = "guest";
      peer.userId = null;
      peer.feedId = null;
      peer.guestId = guestId;
      peer.guestProfileUserId = settings.profileUserId;
      peer.productionId = activeProductionId;
      console.log(`[USER] Registered guest ${peer.name} (${guestId}) on socket ${socket.id}`);
    }

    peer.connectedAt = Date.now();
    emitUserListToOperators();

    if (normalizedKind === "user" && peer.userId !== null && peer.userId !== undefined) {
      updateUserLastOnline(peer.userId);
      const persistedTargetAudioStates = getUserTargetAudioStates(peer.userId);
      updateCompanionUserState(peer.userId, {
        userName: peer.name || null,
        online: true,
        socketId: socket.id,
        targetAudioStates: persistedTargetAudioStates,
      }, {
        reason: "user-online",
        fallbackName: peer.name || null,
      });
      syncPeerCompanionState(peer, { reason: "register-user" });
    }

    if (normalizedKind === "user") {
      broadcastRuntimeUserStates("register-user");
    }

    if (normalizedKind === "feed") {
      socket.emit("conference-list", []);
    } else {
      socket.emit("conference-list", getEffectiveConferencesForPeer(peer));
    }

    if (typeof callback === "function") {
      const profileUserId = normalizedKind === "guest" ? peer.guestProfileUserId : peer.userId;
      callback({
        ok: true,
        productionId: peer.productionId ?? null,
        productions: profileUserId == null
          ? []
          : getEnabledProductionsForUser(profileUserId).map(({ id, name: productionName }) => ({
            id,
            name: productionName,
          })),
        targetAudioStates: normalizedKind === "user" && peer.userId != null
          ? getUserTargetAudioStates(peer.userId)
          : [],
        userAudioSettings: normalizedKind === "user" && peer.userId != null
          && Object.keys(getUserAudioSettings(peer.userId) || {}).length
          ? getResolvedUserAudioSettings(peer.userId)
          : null,
      });
    }
  });

  socket.on("set-active-production", ({ productionId = null } = {}, callback = () => {}) => {
    const peer = peers.get(socket.id);
    if (!isOperatorPeer(peer)) {
      callback({ ok: false, error: "Peer not registered" });
      return;
    }
    const userId = peer.kind === "guest" ? peer.guestProfileUserId : peer.userId;
    try {
      peer.productionId = normalizeActiveProductionId(productionId, userId);
      emitPeerTallyState(peer);
      socket.emit("conference-list", getEffectiveConferencesForPeer(peer));
      socket.emit("conference-members-updated", { conferenceId: null });
      reconcileAllProducerRecipients({ forceAnnounce: true });
      broadcastRuntimeUserStates("active-production-changed");
      callback({ ok: true, productionId: peer.productionId });
    } catch (error) {
      callback({ ok: false, error: error.message || "Production access denied" });
    }
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

    const channel = getOrCreateApplePttChannelForUser(peer.userId, "Talktome");
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

    replaceUserTargetAudioStates(peer.userId, states);
    updateCompanionUserState(peer.userId, {
      userName: peer.name || null,
      targetAudioStates: getUserTargetAudioStates(peer.userId),
    }, {
      reason,
      fallbackName: peer.name || null,
    });
  });

  socket.on('user-audio-settings-update', ({ settings } = {}, callback = () => {}) => {
    const peer = peers.get(socket.id);
    if (!peer || peer.kind !== 'user' || peer.userId == null) {
      return callback({ ok: false, error: 'Peer not registered' });
    }
    try {
      const normalized = normalizeUserAudioSettings(settings, { strict: true });
      updateUserAudioSettings(peer.userId, normalized);
      callback({ ok: true, settings: getResolvedUserAudioSettings(peer.userId) });
    } catch (error) {
      callback({ ok: false, error: error.message || 'Invalid audio settings' });
    }
  });

  socket.on("ptt-state", (payload = {}) => {
    const peer = peers.get(socket.id);
    if (!isOperatorPeer(peer)) {
      return;
    }
    if (!isPersistentUserPeer(peer)) {
      return;
    }

    const patch = {
      userName: peer.name || null,
      online: true,
      socketId: socket.id,
    };

    if (typeof payload.lockActive === "boolean") {
      patch.talkLocked = payload.lockActive;
    }

    const normalizedTargets = normalizeRuntimeTalkTargets(payload.targets);
    const wasTalking = Boolean(peer.pttTalking);
    peer.pttTalking = Boolean(payload.talking && normalizedTargets.length > 0);
    if (peer.pttTalking) {
      peer.activeTalkTargets = normalizedTargets;
      if (!wasTalking) {
        peer.pttStartedAt = Date.now();
      }
    } else {
      peer.pttStartedAt = 0;
    }

    if (normalizedTargets.length > 0) {
      patch.lastTargets = normalizedTargets;
    }

    const normalizedTarget = normalizeRuntimeTalkTarget(payload.target);
    if (normalizedTarget) {
      patch.lastTarget = normalizedTarget;
    } else if (normalizedTargets.length > 0) {
      patch.lastTarget = normalizedTargets[0];
    }

    updateCompanionUserState(peer.userId, patch, {
      reason: "ptt-state",
      fallbackName: peer.name || null,
    });
    broadcastRuntimeUserStates("ptt-state");
  });

  socket.on("talk-targets-updated", async (payload = {}) => {
    const peer = peers.get(socket.id);
    if (!isOperatorPeer(peer)) {
      return;
    }

    const normalizedTargets = normalizeRuntimeTalkTargets(payload.targets);
    peer.activeTalkTargets = normalizedTargets;

    if (isPersistentUserPeer(peer)) {
      const patch = {
        userName: peer.name || null,
        online: true,
        socketId: socket.id,
      };
      if (normalizedTargets.length > 0) {
        patch.lastTarget = normalizedTargets[0];
        patch.lastTargets = normalizedTargets;
      }

      updateCompanionUserState(peer.userId, patch, {
        reason: "talk-targets-updated",
        fallbackName: peer.name || null,
      });
    }

    const talkProducers = getPeerTalkProducers(peer, { includePaused: true }).filter((producer) => (
      String(producer?.appData?.type || "").trim().toLowerCase() === "talk"
    ));
    if (talkProducers.length === 0) {
      return;
    }

    if (normalizedTargets.length > 0) {
      talkProducers.forEach((producer) => {
        syncProducerRecipients({ producer, speakerSocketId: socket.id });
      });
    }

    const activeTalkProducers = getPeerActiveTalkProducers(peer)
      .filter((producer) => String(producer?.appData?.type || "").trim().toLowerCase() === "talk");

    if (isPersistentUserPeer(peer) && activeTalkProducers.length > 0 && normalizedTargets.length > 0) {
      try {
        const recipientUserIds = await sendApplePttSpeakerStarted({
          type: "talk",
          targets: normalizedTargets,
          speakerSocketId: socket.id,
          reason: "talk-targets-updated",
        });
        activeTalkProducers.forEach((producer) => {
          producer.__applePttRecipientUserIds = recipientUserIds;
        });
      } catch (error) {
        console.warn("[PTT] Failed to update Apple PTT recipients for talk-targets-updated:", error?.message || error);
      }
    }

    syncPeerCompanionState(peer, { reason: "talk-targets-updated" });
    broadcastRuntimeUserStates("talk-targets-updated");
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

    const normalizedTarget = normalizeRuntimeTalkTarget(payload.target);
    const patch = {
      userName: peer.name || null,
      lastCommandId: commandId,
      lastCommandResult: resultPayload.ok ? "ok" : (resultPayload.reason || "failed"),
    };
    if (typeof payload.lockActive === "boolean") {
      patch.talkLocked = payload.lockActive;
    }
    const normalizedTargets = normalizeRuntimeTalkTargets(payload.targets);
    if (normalizedTargets.length > 0) {
      patch.lastTargets = normalizedTargets;
    }
    if (normalizedTarget) {
      patch.lastTarget = normalizedTarget;
    } else if (normalizedTargets.length > 0) {
      patch.lastTarget = normalizedTargets[0];
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
    if (!isOperatorPeer(peer)) {
      return callback([]);
    }

    const response = [];
    let conferenceIds = null;
    let feedIds = null;

    const loadConferenceIds = () => {
      if (conferenceIds !== null) {
        return conferenceIds;
      }
      const memberships = getEffectiveConferencesForPeer(peer);
      conferenceIds = new Set(
        memberships.map((conf) => String(conf.id))
      );
      return conferenceIds;
    };

    const loadFeedIds = () => {
      if (feedIds !== null) {
        return feedIds;
      }
      feedIds = new Set(getEffectiveFeedIdsForPeer(peer).map((id) => String(id)));
      return feedIds;
    };

    for (const [otherSocketId, otherPeer] of peers) {
      if (otherSocketId === socket.id) continue;

      for (const [producerId, producer] of otherPeer.producers) {
        if (!producer || producer.closed) continue;
        const appData = producer?.appData;
        if (!appData || typeof appData !== "object") continue;
        const type = String(appData.type || "").trim().toLowerCase();
        let activeDelivery = null;

        if (!producer.paused && type === "feed") {
          const feedId = appData.id;
          if (feedId == null) continue;
          const membership = loadFeedIds();
          if (membership.has(String(feedId))) {
            activeDelivery = { recipientSocketId: socket.id, appData };
          }
        } else if (!producer.paused && type === "conference") {
          const confId = appData.id;
          if (confId == null) continue;
          const membership = loadConferenceIds();
          if (membership.has(String(confId))) {
            activeDelivery = { recipientSocketId: socket.id, appData };
          }
        } else if (!producer.paused && (type === "user" || type === "talk")) {
          const deliveries = resolveProducerRecipientDeliveries({ appData, speakerSocketId: otherSocketId });
          activeDelivery = deliveries.find((candidate) => candidate.recipientSocketId === socket.id) || null;
        } else if (!producer.paused && type === "guest") {
          const deliveries = resolveProducerRecipientDeliveries({ appData, speakerSocketId: otherSocketId });
          activeDelivery = deliveries.find((candidate) => candidate.recipientSocketId === socket.id) || null;
        }

        const reconciliationDelivery = resolveProducerReconciliationDelivery({
          producer,
          recipientSocketId: socket.id,
          activeDelivery,
        });
        if (!reconciliationDelivery?.appData) continue;
        response.push({
          peerId: otherSocketId,
          speakerUserId: otherPeer?.userId ?? null,
          producerId,
          appData: reconciliationDelivery.appData,
          retainOnly: Boolean(reconciliationDelivery.retainOnly),
        });
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

  socket.on("producer-close", ({ producerId } = {}, callback = () => {}) => {
    console.log(
        `[SIGNAL] producer-close received from client ${socket.id} for producer ${producerId}`
    );

    const peer     = peers.get(socket.id);
    const producer = peer?.producers.get(producerId);
    if (!producer) {
      console.warn(`[SIGNAL] No producer found with ID ${producerId}.`);
      callback({ ok: false, error: "Producer not found" });
      return;
    }

    // Read the appData so the client knows which tile it was
    const { appData } = producer;

    // 2. Close the producer and clean up internal state
    producer.close();
    peer.producers.delete(producerId);
    syncPeerCompanionState(peer, { reason: "producer-close" });
    broadcastRuntimeUserStates("producer-close");

    // 3. Broadcast to all other clients immediately, including appData
    socket.broadcast.emit("producer-closed", {
      peerId:     socket.id,
      speakerUserId: peer?.userId ?? null,
      producerId,
      appData
    });

    console.log(`[SIGNAL] producer-closed an alle anderen gesendet`);
    callback({ ok: true });
  });

  socket.on("pause-producer", async ({ producerId } = {}, callback = () => {}) => {
    const peer = peers.get(socket.id);
    const producer = peer?.producers.get(producerId);
    if (!producer) {
      callback({ error: "Producer not found" });
      return;
    }

    try {
      await producer.pause();
      console.log(
        `[SIGNAL] pause-producer ok socket=${socket.id} user=${peer.userId ?? peer.guestProfileUserId ?? "unknown"} `
        + `producer=${producer.id} type=${producer.appData?.type || "unknown"}`
      );
      callback({ ok: true });
    } catch (error) {
      console.error("[SIGNAL] pause-producer failed:", error);
      callback({ error: error?.message || "pause-producer failed" });
    }
  });

  socket.on("resume-producer", async ({ producerId } = {}, callback = () => {}) => {
    const peer = peers.get(socket.id);
    const producer = peer?.producers.get(producerId);
    if (!producer) {
      callback({ error: "Producer not found" });
      return;
    }

    try {
      await producer.resume();
      console.log(
        `[SIGNAL] resume-producer ok socket=${socket.id} user=${peer.userId ?? peer.guestProfileUserId ?? "unknown"} `
        + `producer=${producer.id} type=${producer.appData?.type || "unknown"}`
      );
      callback({ ok: true });
    } catch (error) {
      console.error("[SIGNAL] resume-producer failed:", error);
      callback({ error: error?.message || "resume-producer failed" });
    }
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
      emitUserListToOperators();
      if (peer.kind === "user" && peer.userId !== null && peer.userId !== undefined) {
        broadcastRuntimeUserStates("register-name");
      }
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
      if (!router) {
        return callback({ error: "Media router is not ready, try again" });
      }
      const mediaRoute = resolveTransportAnnouncedAddress();
      if (mediaRoute.error || !mediaRoute.announcedAddress) {
        console.error("[TRANSPORT] No usable announced IP:", mediaRoute.error || "unknown media network error");
        return callback({ error: mediaRoute.error || "No usable announced IP available" });
      }

      if (mediaRoute.mode === "auto" && mediaRoute.interfaceName) {
        console.log(`[TRANSPORT] Auto-detected RTC addresses: ${getActiveRtcAddresses(mediaRoute).join(", ")}`);
      } else if (mediaRoute.mode === "interface") {
        console.log(`[TRANSPORT] Using configured interface: ${mediaRoute.interfaceName}`);
      }
      console.log(`[TRANSPORT] Offering RTC address(es): ${getActiveRtcAddresses(mediaRoute).join(", ")}`);
      warnIfDockerAnnouncedIpLooksInternal(mediaRoute.announcedAddress);

      const transport = await router.createWebRtcTransport({
        listenInfos: buildWebRtcListenInfos({ mediaRoute, env: process.env }),
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        // Additional debugging
        enableSctp: false,
        numSctpStreams: { OS: 0, MIS: 0 },
        initialAvailableOutgoingBitrate: 600000,
      });

      peers.get(socket.id).sendTransport = transport;
      attachWebRtcTransportDiagnostics(socket.id, "send", transport);
      console.log(`[TRANSPORT] Send transport created: ${transport.id}`);
      console.log(`[TRANSPORT] ICE Candidates:`, transport.iceCandidates);

      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
        ...CLIENT_ICE_CONFIG,
      });
    } catch (error) {
      console.error("[TRANSPORT] Error creating send transport:", error);
      callback({ error: error.message });
    }
  });

  socket.on("create-recv-transport", async (_, callback) => {
    console.log(`[TRANSPORT] Client ${socket.id} requests recv transport`);
    try {
      if (!router) {
        return callback({ error: "Media router is not ready, try again" });
      }
      const mediaRoute = resolveTransportAnnouncedAddress();
      if (mediaRoute.error || !mediaRoute.announcedAddress) {
        console.error("[TRANSPORT] No usable announced IP:", mediaRoute.error || "unknown media network error");
        return callback({ error: mediaRoute.error || "No usable announced IP available" });
      }

      if (mediaRoute.mode === "auto" && mediaRoute.interfaceName) {
        console.log(`[TRANSPORT] Auto-detected RTC addresses: ${getActiveRtcAddresses(mediaRoute).join(", ")}`);
      } else if (mediaRoute.mode === "interface") {
        console.log(`[TRANSPORT] Using configured interface: ${mediaRoute.interfaceName}`);
      }
      console.log(`[TRANSPORT] Offering RTC address(es): ${getActiveRtcAddresses(mediaRoute).join(", ")}`);
      warnIfDockerAnnouncedIpLooksInternal(mediaRoute.announcedAddress);

      const transport = await router.createWebRtcTransport({
        listenInfos: buildWebRtcListenInfos({ mediaRoute, env: process.env }),
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        enableSctp: false,
        numSctpStreams: { OS: 0, MIS: 0 },
        initialAvailableOutgoingBitrate: 600000,
      });

      peers.get(socket.id).recvTransport = transport;
      attachWebRtcTransportDiagnostics(socket.id, "receive", transport);
      console.log(`[TRANSPORT] Recv transport created: ${transport.id}`);
      console.log(`[TRANSPORT] ICE Candidates:`, transport.iceCandidates);

      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
        ...CLIENT_ICE_CONFIG,
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

  socket.on("create-plain-send-transport", async (_, callback = () => {}) => {
    console.log(`[GATEWAY] Client ${socket.id} requests plain send transport`);
    try {
      if (!router) {
        return callback({ error: "Router not initialized, try again" });
      }

      const peer = peers.get(socket.id);
      if (!peer) {
        return callback({ error: "Peer not registered" });
      }

      const mediaRoute = resolveTransportAnnouncedAddress();
      if (mediaRoute.error || !mediaRoute.announcedAddress) {
        console.error("[GATEWAY] No usable announced IP:", mediaRoute.error || "unknown media network error");
        return callback({ error: mediaRoute.error || "No usable announced IP available" });
      }
      const mediaAddress = selectMediaRouteAddress(
        mediaRoute,
        socket.request?.socket?.localAddress || socket.conn?.transport?.socket?.localAddress
      );

      if (peer.plainSendTransport && !peer.plainSendTransport.closed) {
        try {
          peer.plainSendTransport.close();
        } catch {}
      }

      const transport = await router.createPlainTransport({
        listenIp: {
          ip: "0.0.0.0",
          announcedIp: mediaAddress,
        },
        rtcpMux: true,
        comedia: true,
      });

      peer.plainSendTransport = transport;
      transport.observer.on("close", () => {
        if (peer.plainSendTransport === transport) {
          peer.plainSendTransport = null;
        }
      });

      callback({
        id: transport.id,
        ip: mediaAddress,
        port: transport.tuple.localPort,
        protocol: transport.tuple.protocol,
        rtcpMux: true,
        comedia: true,
        payloadType: GATEWAY_OPUS_PAYLOAD_TYPE,
        ssrc: GATEWAY_OPUS_SSRC,
      });
    } catch (error) {
      console.error("[GATEWAY] Error creating plain send transport:", error);
      callback({ error: error.message });
    }
  });

  socket.on("produce-plain", async ({ kind = "audio", appData, rtpParameters } = {}, callback = () => {}) => {
    console.log(`[GATEWAY] Client ${socket.id} wants to produce plain ${kind}`, appData);
    try {
      const peer = peers.get(socket.id);
      if (!peer) {
        return callback({ error: "Peer not registered" });
      }

      const transport = peer.plainSendTransport;
      if (!transport || transport.closed) {
        return callback({ error: "Plain send transport not ready" });
      }

      const { type, id: targetId } = appData || {};
      const validTypes = ["talk", "user", "conference", "guest", "feed"];
      const requiresTargetId = type !== "talk";
      if (!type || !validTypes.includes(type) || (requiresTargetId && !targetId)) {
        return callback({
          error: "Invalid appData: expected routing metadata for talk, user, conference, guest, or feed.",
        });
      }

      if (peer.kind === "feed") {
        if (type !== "feed" || peer.feedId === null || String(peer.feedId) !== String(targetId)) {
          return callback({ error: "Feeds can only produce their assigned feed" });
        }
      }

      const existingPlainProducers = Array.from(peer.producers.values()).filter((existingProducer) => (
        existingProducer?.appData?.type === type
        && String(existingProducer?.appData?.id) === String(targetId)
      ));
      for (const existingProducer of existingPlainProducers) {
        try {
          existingProducer.close();
        } catch (closeError) {
          console.warn(`[GATEWAY] Failed to close previous plain producer ${existingProducer?.id}:`, closeError);
        }
      }

      const producer = await transport.produce({
        kind,
        rtpParameters: rtpParameters || buildGatewayAudioRtpParameters(),
        appData,
      });
      attachProducerMediaDiagnostics(producer, `plain:${peer.kind}:${peer.userId ?? peer.feedId ?? socket.id}`);

      producer.__startedAt = Date.now();
      peer.producers.set(producer.id, producer);
      syncPeerCompanionState(peer, { reason: "plain-produce-started" });
      broadcastRuntimeUserStates("plain-produce-started");

      callback({ id: producer.id });

      announceProducerToRecipients({
        producerId: producer.id,
        appData,
        speakerSocketId: socket.id,
      });

      producer.observer.on("pause", () => {
        syncPeerCompanionState(peer, { reason: "plain-produce-paused" });
        broadcastRuntimeUserStates("plain-produce-paused");
      });

      producer.observer.on("resume", () => {
        producer.__startedAt = Date.now();
        syncPeerCompanionState(peer, { reason: "plain-produce-resumed" });
        broadcastRuntimeUserStates("plain-produce-resumed");
        announceProducerToRecipients({
          producerId: producer.id,
          appData,
          speakerSocketId: socket.id,
          forceAnnounce: true,
        });
      });

      producer.on("close", () => {
        peer.producers.delete(producer.id);
        syncPeerCompanionState(peer, { reason: "plain-produce-closed" });
        broadcastRuntimeUserStates("plain-produce-closed");
        socket.broadcast.emit("producer-closed", {
          peerId: socket.id,
          speakerUserId: peer?.userId ?? null,
          producerId: producer.id,
          appData,
        });
      });

      producer.on("transportclose", () => {
        peer.producers.delete(producer.id);
        syncPeerCompanionState(peer, { reason: "plain-produce-transport-closed" });
        broadcastRuntimeUserStates("plain-produce-transport-closed");
      });
    } catch (error) {
      console.error("[GATEWAY] Plain produce error:", error);
      callback({ error: error.message });
    }
  });

  socket.on("consume-plain", async ({ producerId, ip, port, rtpCapabilities } = {}, callback = () => {}) => {
    console.log(`[GATEWAY] Client ${socket.id} wants plain consume producer ${producerId} to ${ip}:${port}`);
    try {
      if (!router) {
        return callback({ error: "Router not initialized, try again" });
      }

      const peer = peers.get(socket.id);
      if (!peer) {
        return callback({ error: "Peer not registered" });
      }

      const targetIp = String(ip || "").trim();
      const targetPort = Number(port);
      if (!targetIp || !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
        return callback({ error: "Invalid plain consume target ip/port" });
      }

      let producerPeer = null;
      for (const [peerId, candidatePeer] of peers) {
        if (candidatePeer.producers.has(producerId)) {
          producerPeer = peerId;
          break;
        }
      }
      if (!producerPeer) {
        return callback({ error: "Producer not found" });
      }

      const capabilities = rtpCapabilities || router.rtpCapabilities;
      if (!router.canConsume({ producerId, rtpCapabilities: capabilities })) {
        return callback({ error: "Cannot consume" });
      }

      const transport = await router.createPlainTransport({
        listenIp: { ip: "0.0.0.0" },
        rtcpMux: true,
        comedia: false,
      });
      await transport.connect({ ip: targetIp, port: targetPort });

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities: capabilities,
        paused: true,
      });
      consumer.__plainTransport = transport;
      peer.consumers.set(consumer.id, consumer);

      const cleanup = () => {
        peer.consumers.delete(consumer.id);
        try {
          if (!transport.closed) transport.close();
        } catch {}
      };

      consumer.on("transportclose", cleanup);
      consumer.on("producerclose", () => {
        cleanup();
        socket.emit("consumer-closed", { consumerId: consumer.id, producerId });
      });

      callback({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (error) {
      console.error("[GATEWAY] Plain consume error:", error);
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
        const validTypes = ["talk", "user", "conference", "guest", "feed"];
        const requiresTargetId = type !== "talk";

        if (
            !type ||
            !validTypes.includes(type) ||
            (requiresTargetId && !targetId)
        ) {
          console.warn("[PRODUCE] Invalid appData:", appData);
          return callback({
            error:
                "Invalid appData: For 'talk', 'user', 'conference', 'guest', or 'feed', valid routing metadata must be provided.",
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

          if (type === "feed") {
            const existingFeedProducers = Array.from(peer.producers.values()).filter((existingProducer) => (
              existingProducer?.appData?.type === "feed"
              && String(existingProducer?.appData?.id) === String(targetId)
            ));
            for (const existingProducer of existingFeedProducers) {
              try {
                existingProducer.close();
              } catch (closeError) {
                console.warn(`[PRODUCE] Failed to close previous feed producer ${existingProducer?.id}:`, closeError);
              }
            }
          }

          const producer = await transport.produce({
            kind,
            rtpParameters,
            appData,
          });
          attachProducerMediaDiagnostics(producer, `webrtc:${peer.kind}:${peer.userId ?? peer.feedId ?? socket.id}`);

          producer.__startedAt = Date.now();
          peer.producers.set(producer.id, producer);
          syncPeerCompanionState(peer, { reason: "produce-started" });
          broadcastRuntimeUserStates("produce-started");
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
          const initialRecipientSocketIds = announceProducerToRecipients({
            producerId: producer.id,
            appData,
            speakerSocketId: socket.id,
          });
          console.log(
            `[ROUTE] Announced producer ${producer.id} for ${type} ${targetId ?? ""} `
            + `recipients=${initialRecipientSocketIds.length}`
          );

          const applePttRecipientUserIds = await sendApplePttSpeakerStarted({
            type,
            targetId,
            targets: type === "talk" ? getPeerActiveTalkTargets(peer) : null,
            speakerSocketId: socket.id,
            reason: "producer-started",
          });
          //----------------------------------------------------------------
          // 4️⃣  Cleanup listener
          //----------------------------------------------------------------
          producer.appData = appData;  // store once
          producer.__applePttRecipientUserIds = applePttRecipientUserIds;
          producer.observer.on("pause", () => {
            syncPeerCompanionState(peer, { reason: "produce-paused" });
            broadcastRuntimeUserStates("produce-paused");
          });
          producer.observer.on("resume", () => {
            producer.__startedAt = Date.now();
            syncPeerCompanionState(peer, { reason: "produce-resumed" });
            broadcastRuntimeUserStates("produce-resumed");
            const resumedRecipientSocketIds = announceProducerToRecipients({
              producerId: producer.id,
              appData,
              speakerSocketId: socket.id,
              forceAnnounce: true,
            });
            console.log(
              `[ROUTE] Re-announced resumed producer ${producer.id} for ${type} ${targetId ?? ""} `
              + `recipients=${resumedRecipientSocketIds.length}`
            );
            void sendApplePttSpeakerStarted({
              type,
              targetId,
              targets: type === "talk" ? getPeerActiveTalkTargets(peer) : null,
              speakerSocketId: socket.id,
              reason: "producer-resumed",
            }).then((recipientUserIds) => {
              producer.__applePttRecipientUserIds = recipientUserIds;
            }).catch((error) => {
              console.warn("[PRODUCE] Failed to send Apple PTT resume update:", error?.message || error);
            });
          });

          producer.on("close", () => {
            peer.producers.delete(producer.id);
            if (type === "talk" && getPeerActiveTalkProducers(peer).length === 0) {
              peer.activeTalkTargets = [];
            }
            syncPeerCompanionState(peer, { reason: "produce-closed" });
            broadcastRuntimeUserStates("produce-closed");
            socket.broadcast.emit("producer-closed", {
              peerId:     socket.id,
              speakerUserId: peer?.userId ?? null,
              producerId: producer.id,
              appData     // included now
            });
          });


          producer.on("transportclose", () => {
            peer.producers.delete(producer.id);
            if (type === "talk" && getPeerActiveTalkProducers(peer).length === 0) {
              peer.activeTalkTargets = [];
            }
            syncPeerCompanionState(peer, { reason: "produce-transport-closed" });
            broadcastRuntimeUserStates("produce-transport-closed");
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
      const peer = peers.get(socket.id);
      if (!peer) {
        return callback({ error: "Peer not registered" });
      }

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

      const transport = peer.recvTransport;
      if (!transport) {
        return callback({ error: "Receive transport not ready" });
      }

      const existingConsumers = Array.from(peer.consumers.values()).filter((candidate) => (
        candidate
        && !candidate.closed
        && !candidate.__plainTransport
        && String(candidate.producerId || "") === String(producerId)
      ));
      for (const existingConsumer of existingConsumers) {
        console.warn(
          `[CONSUME] Replacing stale duplicate consumer ${existingConsumer.id} for ${socket.id} `
          + `and producer ${producerId}`
        );
        try {
          existingConsumer.close();
        } catch {}
        peer.consumers.delete(existingConsumer.id);
      }

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });

      peer.consumers.set(consumer.id, consumer);
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

  socket.on("close-consumer", ({ consumerId } = {}, callback = () => {}) => {
    console.log(`[CONSUME] Client ${socket.id} closing consumer ${consumerId}`);
    try {
      const peer = peers.get(socket.id);
      const consumer = peer?.consumers.get(consumerId);
      if (consumer) {
        const plainTransport = consumer.__plainTransport || null;
        try {
          consumer.close();
        } catch {}
        peer.consumers.delete(consumer.id);
        try {
          if (plainTransport && !plainTransport.closed) plainTransport.close();
        } catch {}
      }
      callback({ ok: true });
    } catch (error) {
      console.error("[CONSUME] Close error:", error);
      callback({ error: error.message });
    }
  });

  socket.on("disconnect", (reason) => {
    const peer = peers.get(socket.id);
    console.log(
      `[CONN] Client disconnected: ${socket.id} reason=${JSON.stringify(reason || "unknown")} `
      + `peer=${peer?.kind || "unknown"}:${peer?.userId ?? peer?.feedId ?? peer?.name ?? "unknown"} `
      + `send=${peer?.sendTransport?.connectionState || "none"} `
      + `receive=${peer?.recvTransport?.connectionState || "none"}`
    );
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
      const replacementPeer = findUserPeerByUserId(disconnectedUserId);
      if (!replacementPeer) {
        updateUserLastOnline(disconnectedUserId);
        updateCompanionUserState(disconnectedUserId, {
          userName: disconnectedUserName,
          online: false,
          socketId: null,
          talking: false,
          talkLocked: false,
          currentTarget: null,
          currentTargets: [],
          targetAudioStates: [],
          lastSpokeAt: Date.now(),
        }, {
          reason: "user-offline",
          fallbackName: disconnectedUserName,
        });
        failPendingCommandsForUser(disconnectedUserId, "user-disconnected");
      }
    }

    emitUserListToOperators();
    broadcastRuntimeUserStates("user-disconnected");
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

function logHttpsServerReady() {
  const startupHosts = getStartupHosts();
  const configuredPublicIp = typeof process.env.PUBLIC_IP === "string"
    ? process.env.PUBLIC_IP.trim()
    : "";
  const runningInContainer = isRunningInContainer();
  const mediaRoute = resolveTransportAnnouncedAddress();
  console.log(`🔒 HTTPS Server running on port ${HTTPS_PORT}`);
  if (startupHosts.length > 0) {
    console.log("📍 Access via:");
    startupHosts.forEach((host) => {
      console.log(`   https://${host}:${HTTPS_PORT}`);
    });
    console.log("🛠️ Administration via:");
    startupHosts.forEach((host) => {
      console.log(`   https://${host}:${HTTPS_PORT}/admin`);
    });
  }
  if (runningInContainer) {
    console.log("");
    console.log("🐳 Docker note:");
    console.log("   Open the Docker host address in your browser, not the container IP.");
    if (configuredPublicIp) {
      console.log(`   From other devices: use https://${configuredPublicIp}:${HTTPS_PORT}`);
    } else {
      console.log("   Use the LAN IP or DNS name of the host machine.");
      console.log("   Set PUBLIC_IP to print an explicit access URL here.");
    }
  }
  console.log("");
  if (mediaRoute.error) {
    console.warn(`🎛️ Media network: ${mediaRoute.error}`);
  } else if (mediaRoute.mode === "interface") {
    console.log(`🎛️ Media network: ${mediaRoute.interfaceName} → ${mediaRoute.announcedAddress}`);
  } else if (mediaRoute.mode === "manual") {
    console.log(`🎛️ Media network: manual → ${mediaRoute.announcedAddress}`);
  } else if (mediaRoute.announcedAddress) {
    const routes = (mediaRoute.interfaces || [])
      .map((entry) => `${entry.name} → ${entry.address}`)
      .join(", ");
    console.log(`🎛️ Media network: automatic → ${routes || mediaRoute.announcedAddress}`);
  }
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
}

function startHttpsServer() {
  server.listen(HTTPS_PORT, logHttpsServerReady);
}

mediaReadyPromise.then(startHttpsServer).catch((error) => {
  const message = error?.stack || error?.message || String(error);
  console.error(`[INIT] mediasoup initialization failed: ${message}`);
  try {
    worker?.close();
  } catch {}
  process.exitCode = 1;
  setImmediate(() => process.exit(1));
});
