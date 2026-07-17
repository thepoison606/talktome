const net = require("net");

const ICE_URL_SCHEMES = new Set(["stun", "stuns", "turn", "turns"]);

function readFirstEnvironmentValue(env, names) {
  for (const name of names) {
    const value = typeof env?.[name] === "string" ? env[name].trim() : "";
    if (value) return value;
  }
  return "";
}

function normalizeIceUrl(value) {
  const url = String(value ?? "").trim();
  if (!url) throw new Error("ICE server URLs must not be empty.");

  const separator = url.indexOf(":");
  const scheme = separator > 0 ? url.slice(0, separator).toLowerCase() : "";
  if (!ICE_URL_SCHEMES.has(scheme)) {
    throw new Error(`Unsupported ICE server URL "${url}". Use stun:, stuns:, turn: or turns:.`);
  }
  return url;
}

function normalizeIceServer(value, index = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`ICE server ${index + 1} must be an object.`);
  }

  const rawUrls = Array.isArray(value.urls) ? value.urls : [value.urls];
  if (rawUrls.length === 0 || rawUrls[0] === undefined) {
    throw new Error(`ICE server ${index + 1} is missing "urls".`);
  }

  const urls = rawUrls.map(normalizeIceUrl);
  const normalized = {
    urls: Array.isArray(value.urls) ? urls : urls[0],
  };

  if (value.username !== undefined) {
    if (typeof value.username !== "string") {
      throw new Error(`ICE server ${index + 1} username must be a string.`);
    }
    normalized.username = value.username;
  }
  if (value.credential !== undefined) {
    if (typeof value.credential !== "string") {
      throw new Error(`ICE server ${index + 1} credential must be a string.`);
    }
    normalized.credential = value.credential;
  }

  return normalized;
}

function parseIceServersJson(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`TALKTOME_ICE_SERVERS_JSON is not valid JSON: ${error.message}`);
  }

  const servers = Array.isArray(parsed) ? parsed : [parsed];
  return servers.map(normalizeIceServer);
}

function parseTurnShorthand(env) {
  const rawUrls = readFirstEnvironmentValue(env, [
    "TALKTOME_TURN_URLS",
    "TALKTOME_TURN_URL",
    "TURN_URLS",
    "TURN_URL",
  ]);
  if (!rawUrls) return [];

  const urls = rawUrls
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(normalizeIceUrl);

  if (urls.length === 0) {
    throw new Error("TALKTOME_TURN_URLS/TURN_URLS does not contain a usable URL.");
  }

  const username = readFirstEnvironmentValue(env, ["TALKTOME_TURN_USERNAME", "TURN_USERNAME"]);
  const credential = readFirstEnvironmentValue(env, [
    "TALKTOME_TURN_CREDENTIAL",
    "TALKTOME_TURN_PASSWORD",
    "TURN_CREDENTIAL",
    "TURN_PASSWORD",
  ]);

  if (Boolean(username) !== Boolean(credential)) {
    throw new Error("TURN username and credential must either both be configured or both be omitted.");
  }

  return [normalizeIceServer({
    urls: urls.length === 1 ? urls[0] : urls,
    ...(username ? { username, credential } : {}),
  })];
}

function resolveClientIceConfig(env = process.env) {
  const json = readFirstEnvironmentValue(env, ["TALKTOME_ICE_SERVERS_JSON"]);
  const iceServers = json ? parseIceServersJson(json) : parseTurnShorthand(env);
  const rawPolicy = readFirstEnvironmentValue(env, ["TALKTOME_ICE_TRANSPORT_POLICY"]);
  const iceTransportPolicy = rawPolicy ? rawPolicy.toLowerCase() : "all";

  if (!["all", "relay"].includes(iceTransportPolicy)) {
    throw new Error('TALKTOME_ICE_TRANSPORT_POLICY must be either "all" or "relay".');
  }
  if (iceTransportPolicy === "relay") {
    const hasTurnServer = iceServers.some((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some((url) => /^turns?:/i.test(url));
    });
    if (!hasTurnServer) {
      throw new Error('TALKTOME_ICE_TRANSPORT_POLICY="relay" requires at least one turn: or turns: URL.');
    }
  }

  return { iceServers, iceTransportPolicy };
}

function buildWebRtcListenInfos({ mediaRoute, env = process.env } = {}) {
  const announcedAddress = String(mediaRoute?.announcedAddress ?? "").trim();
  if (!announcedAddress) {
    throw new Error("A WebRTC announced address is required.");
  }

  const internalIp = readFirstEnvironmentValue(env, ["TALKTOME_MEDIA_INTERNAL_IP"]);
  if (internalIp && net.isIP(internalIp) === 0) {
    throw new Error("TALKTOME_MEDIA_INTERNAL_IP must be a bindable IPv4 or IPv6 address.");
  }

  const ip = internalIp || "0.0.0.0";
  const exposeInternalIp = Boolean(internalIp && internalIp !== announcedAddress);
  return ["udp", "tcp"].map((protocol) => ({
    protocol,
    ip,
    announcedAddress,
    ...(exposeInternalIp ? { exposeInternalIp: true } : {}),
  }));
}

module.exports = {
  buildWebRtcListenInfos,
  normalizeIceServer,
  resolveClientIceConfig,
};
