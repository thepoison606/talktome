const { getFreshClientDeviceStatus } = require('./clientDeviceStatus');

function getBridgeRemoteAddress(bridge, session) {
  return session?.remoteAddress || bridge?.remoteAddress || null;
}
function getBridgeDeviceStatus(bridge, session, now = Date.now()) {
  const reported = getFreshClientDeviceStatus(bridge, now);
  const address = String(getBridgeRemoteAddress(bridge, session) || '').replace(/^::ffff:/, '');
  const local = address === '::1' || /^127\./.test(address);
  return reported || (local ? { networkType: 'local' } : null);
}
module.exports = { getBridgeRemoteAddress, getBridgeDeviceStatus };
