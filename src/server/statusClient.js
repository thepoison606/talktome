const { requestClientAddress } = require("./webAccess");

const REGISTERED_CLIENT_LABELS = Object.freeze({
  "ios-app": "iOS App",
  "android-app": "Android App",
  "headless": "Headless",
});

function normalizeClientVersion(value) {
  if (typeof value !== 'string') return null;
  const version = value.trim();
  return /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/.test(version) ? version : null;
}

function normalizeClientBuild(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) value = String(value);
  return typeof value === 'string' && /^[0-9][0-9.]{0,31}$/.test(value.trim()) ? value.trim() : null;
}

function normalizeRegisteredClientType(value) {
  const type = typeof value === "string" ? value.trim().toLowerCase() : "";
  return Object.hasOwn(REGISTERED_CLIENT_LABELS, type) ? type : null;
}

function describeStatusClient(socket, registeredClientType = null) {
  const clientType = normalizeRegisteredClientType(registeredClientType);
  if (clientType) return REGISTERED_CLIENT_LABELS[clientType];

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

function statusRemoteAddress(socket, access) {
  return requestClientAddress({
    socket: { remoteAddress: socket?.request?.socket?.remoteAddress || socket?.handshake?.address },
    headers: socket?.request?.headers || socket?.handshake?.headers || {},
  }, access);
}

module.exports = { normalizeRegisteredClientType, normalizeClientVersion, normalizeClientBuild, describeStatusClient, statusRemoteAddress };
