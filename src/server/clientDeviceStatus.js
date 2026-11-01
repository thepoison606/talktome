const STALE_MS = 30_000;
const OUTPUT_KINDS = new Set(['speaker', 'receiver', 'bluetooth', 'wired', 'usb', 'other']);
const NETWORK_TYPES = new Set(['wifi', 'cellular', 'ethernet', 'vpn', 'bluetooth', 'none', 'other']);
function normalizeClientDeviceStatus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const output = value.audioOutput;
  const label = typeof output?.label === 'string' ? output.label.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 120) : '';
  return {
    audioOutput: label ? { label, kind: OUTPUT_KINDS.has(output.kind) ? output.kind : 'other' } : null,
    batteryPercent: typeof value.batteryPercent === 'number' && Number.isFinite(value.batteryPercent)
      && value.batteryPercent >= 0 && value.batteryPercent <= 100 ? Math.round(value.batteryPercent) : null,
    charging: typeof value.charging === 'boolean' ? value.charging : null,
    networkType: NETWORK_TYPES.has(value.networkType) ? value.networkType : null,
  };
}
function getFreshClientDeviceStatus(peer, now = Date.now()) {
  const report = peer?.deviceStatus;
  if (!report || !Number.isFinite(report.reportedAt) || now - report.reportedAt > STALE_MS) return null;
  return report.status;
}
function recordClientDeviceStatus(peer, payload, now = Date.now()) {
  // Reject anonymous/pre-login sockets and virtual Bridge peers.
  if (!peer?.connectedAt || peer.isBridgePeer || !['user', 'feed', 'guest'].includes(peer.kind)) return false;
  const status = normalizeClientDeviceStatus(payload);
  if (!status) return false;
  if (peer.deviceStatus && now - peer.deviceStatus.reportedAt < 1000) return false;
  peer.deviceStatus = { status, reportedAt: now };
  return true;
}
module.exports = { normalizeClientDeviceStatus, getFreshClientDeviceStatus, recordClientDeviceStatus };
