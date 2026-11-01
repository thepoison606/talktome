const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { updatePeerMediaTransportStatus, resetPeerMediaTransportStatus, describePeerMediaStatus } = require('../src/server/mediaStatus');

function fixture() {
  const peer = { kind: 'user', userId: 7 };
  const broadcasts = [];
  let handler;
  const server = vm.createContext({
    peers: new Map([['socket', peer]]),
    socket: { id: 'socket', on(event, callback) { assert.equal(event, 'media-transport-event'); handler = callback; } },
    updatePeerMediaTransportStatus,
    scheduleAdminStatusBroadcast(reason) { broadcasts.push(reason); },
    console: { log() {} },
  });
  const serverSource = fs.readFileSync(require.resolve('../src/server/serverCore'), 'utf8');
  vm.runInContext(serverSource.slice(
    serverSource.indexOf('  socket.on("media-transport-event"'),
    serverSource.indexOf('  socket.on("register-user"'),
  ), server);
  const browser = vm.createContext({
    remotePanel: false, socket: { connected: true, emit(event, payload) { handler(payload); } },
    sendTransport: null, recvTransport: null,
    mediaConnectionState: { heartbeatInterrupted: false, send: 'idle', receive: 'idle' },
    session: { name: 'Camera' }, sessionResetInProgress: false,
    connectionSounds: { disconnected() {}, reconnected() {} }, renderMediaConnectionStatus() {},
  });
  const clientSource = fs.readFileSync(require.resolve('../public/client'), 'utf8');
  vm.runInContext(clientSource.slice(
    clientSource.indexOf('  function describeIceCandidateError('),
    clientSource.indexOf('  function renderMediaConnectionStatus('),
  ), browser);
  vm.runInContext(clientSource.slice(
    clientSource.indexOf('  function reportMediaTransportEvent('),
    clientSource.indexOf('  function setSessionDisplay('),
  ), browser);
  function transport(direction) {
    const property = direction === 'send' ? 'sendTransport' : 'recvTransport';
    const value = new EventEmitter();
    value.id = `${direction}-${broadcasts.length}`;
    value.connectionState = 'new';
    peer[property] = { id: value.id, iceState: 'new', dtlsState: 'new' };
    resetPeerMediaTransportStatus(peer, direction);
    browser[property] = value;
    browser.bindMediaTransportStatus(value, direction);
    return value;
  }
  return { peer, browser, broadcasts, transport, handler, status: () => describePeerMediaStatus(peer) };
}

test('blocked WebRTC is visible even while signaling remains online, then recovers', () => {
  const f = fixture();
  const send = f.transport('send');
  f.transport('receive'); // An unused transport stays new, not failed.
  assert.equal(f.status().state, 'ready');
  send.emit('connectionstatechange', 'connecting');
  assert.equal(f.status().label, 'Media connecting');
  send.emit('connectionstatechange', 'failed');
  assert.equal(f.browser.socket.connected, true);
  assert.equal(f.status().label, 'Media failed');
  assert.equal(f.status().send.state, 'failed');
  assert.equal(f.broadcasts.at(-1), 'client-media-state-updated');
  send.emit('connectionstatechange', 'connected');
  assert.equal(f.status().state, 'connected');
  send.emit('connectionstatechange', 'disconnected');
  assert.equal(f.status().label, 'Media interrupted');
  send.emit('connectionstatechange', 'connected');
  assert.equal(f.status().state, 'connected');
});

test('receive failure takes precedence over a connected or talking sender', () => {
  const f = fixture();
  f.transport('send').emit('connectionstatechange', 'connected');
  const receive = f.transport('receive');
  receive.emit('connectionstatechange', 'failed');
  assert.equal(f.status().state, 'failed');
  receive.emit('connectionstatechange', 'connected');
  assert.equal(f.status().state, 'connected');
});

test('replaced transports and delayed events cannot retain an old failure', () => {
  const f = fixture();
  const old = f.transport('send');
  old.emit('connectionstatechange', 'failed');
  f.transport('send');
  assert.equal(f.status().state, 'ready');
  old.emit('connectionstatechange', 'failed');
  f.handler({ direction: 'send', event: 'connection-state', state: 'failed', transportId: old.id });
  assert.equal(f.status().state, 'ready');
  f.browser.sendTransport = null;
  f.browser.recvTransport = null;
  f.handler({ direction: 'send', event: 'ice-gathering-state', state: 'gathering' });
  f.browser.resetMediaConnectionState();
  assert.equal(f.status().state, 'idle');
});

test('ICE warnings are bounded and cleared when the affected transport recovers', () => {
  const f = fixture();
  const send = f.transport('send');
  send.emit('icecandidateerror', { errorCode: 701, errorText: 'x'.repeat(1000) });
  assert.equal(f.status().state, 'warning');
  assert.equal(f.status().send.iceError.length, 500);
  send.emit('connectionstatechange', 'connected');
  assert.equal(f.status().send.iceError, null);
  assert.equal(f.status().state, 'connected');
});

test('invalid reports are ignored, identical reports do not rebroadcast, and panels send no audio state', () => {
  const f = fixture();
  f.transport('send');
  const count = f.broadcasts.length;
  for (const payload of [null, {}, { direction: 'bad', event: 'connection-state', state: 'failed' },
    { direction: 'send', event: 'connection-state', state: '<script>' },
    { direction: 'send', event: 'bad', state: 'failed' }]) f.handler(payload);
  f.handler({ direction: 'send', event: 'connection-state', state: 'new' });
  assert.equal(f.broadcasts.length, count);
  f.browser.remotePanel = true;
  f.browser.reportMediaTransportEvent('send', 'connection-state', 'failed');
  assert.equal(f.broadcasts.length, count);
});

test('older and native clients use server transport states; bridges and offline peers do not claim WebRTC health', () => {
  const peer = { kind: 'user', sendTransport: { id: 'send', dtlsState: 'connected', iceState: 'completed' } };
  assert.equal(describePeerMediaStatus(peer).state, 'connected');
  peer.sendTransport.iceState = 'disconnected';
  assert.equal(describePeerMediaStatus(peer).state, 'interrupted');
  peer.sendTransport.dtlsState = 'failed';
  assert.equal(describePeerMediaStatus(peer).state, 'failed');
  peer.sendTransport.dtlsState = 'new';
  peer.sendTransport.iceState = 'new';
  assert.equal(updatePeerMediaTransportStatus(peer, { direction: 'send', event: 'connection-state', state: 'failed' }), true);
  assert.equal(describePeerMediaStatus(peer).state, 'failed');
  assert.equal(describePeerMediaStatus(null), null);
  assert.equal(describePeerMediaStatus({ isBridgePeer: true }), null);
});

test('server ICE/DTLS changes broadcast status, while events from replaced transports are ignored', () => {
  const source = fs.readFileSync(require.resolve('../src/server/serverCore'), 'utf8');
  const transport = new EventEmitter();
  transport.observer = new EventEmitter();
  const peer = { sendTransport: transport };
  const broadcasts = [];
  const context = vm.createContext({
    peers: new Map([['socket', peer]]), console: { log() {} },
    scheduleAdminStatusBroadcast(reason) { broadcasts.push(reason); },
  });
  vm.runInContext(source.slice(source.indexOf('function attachWebRtcTransportDiagnostics('), source.indexOf('function queueBridgeControlEvent(')), context);
  context.attachWebRtcTransportDiagnostics('socket', 'send', transport);
  transport.iceState = 'disconnected';
  transport.emit('icestatechange', 'disconnected');
  assert.equal(describePeerMediaStatus(peer).state, 'interrupted');
  transport.dtlsState = 'failed';
  transport.emit('dtlsstatechange', 'failed');
  assert.equal(describePeerMediaStatus(peer).state, 'failed');
  assert.equal(broadcasts.length, 2);
  peer.sendTransport = {};
  transport.observer.emit('close');
  assert.equal(broadcasts.length, 2);
});

test('admin snapshots expose user/feed media health while preserving signaling online counts', () => {
  const source = fs.readFileSync(require.resolve('../src/server/serverCore'), 'utf8');
  const peer = { kind: 'user', userId: 1, mediaTransportStates: { send: { connectionState: 'failed' } } };
  const feed = { kind: 'feed', feedId: 2, mediaTransportStates: { receive: { connectionState: 'disconnected' } } };
  const context = vm.createContext({
    areMultipleProductionsEnabled: () => false,
    getAllUsers: () => [{ id: 1, name: 'Camera' }, { id: 3, name: 'Offline' }],
    getAllFeeds: () => [{ id: 2, name: 'Music' }], getAllConferences: () => [],
    findUserPeerByUserId: id => id === 1 ? { peer } : null,
    findFeedPeerByFeedId: () => ({ peer: feed }), getPeerActiveTalkTargets: () => [],
    normalizeRuntimeTalkTargets: () => [], getFreshBrowserMediaStats: () => null,
    getFreshClientDeviceStatus: () => null,
    statusIsoTimestamp: () => null, describeStatusClient: () => 'Browser', statusRemoteAddress: () => '127.0.0.1',
    describePeerMediaStatus, companionUserState: new Map(), getBridgeRegistrySnapshot: () => [],
    companionNamespace: null, peers: new Map([['user', peer], ['feed', feed]]),
    SERVER_APP_VERSION: 'test', SERVER_STARTED_AT: 0,
    isRunningInContainer: () => false, isServerRestartSupported: () => false, WEB_ACCESS: {},
  });
  vm.runInContext(source.slice(source.indexOf('function buildAdminStatusTalkTargets('), source.indexOf('app.get("/admin/status"')), context);
  const snapshot = context.buildAdminStatusSnapshot();
  assert.equal(snapshot.users[0].online, true);
  assert.equal(snapshot.users[0].mediaStatus.state, 'failed');
  assert.equal(snapshot.users[1].online, false);
  assert.equal(snapshot.users[1].mediaStatus, null);
  assert.equal(snapshot.feeds[0].mediaStatus.state, 'interrupted');
  assert.equal(snapshot.summary.usersOnline, 1);
  assert.equal(snapshot.summary.feedsOnline, 1);
});

test('admin renders media failures before talk activity and escapes diagnostic text', () => {
  const source = fs.readFileSync(require.resolve('../public/admin'), 'utf8');
  const context = vm.createContext({ escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;') });
  vm.runInContext(source.slice(source.indexOf('const STATUS_TALKING_PULSE_MS'), source.indexOf('function formatStatusTalkTargetLabel')), context);
  const mediaStatus = { state: 'failed', label: 'Media failed', send: { state: 'connected' }, receive: { state: 'failed', iceError: '"><script>' } };
  const html = context.statusIndicatorHtml({ online: true, talking: true, talkingLabel: '→ Director', mediaStatus });
  assert.match(html, /is-failed/);
  assert.match(html, /Media failed/);
  assert.match(html, /Signaling: online/);
  assert.match(html, /Receive media: failed/);
  assert.match(html, /&quot;>&lt;script>/);
  assert.doesNotMatch(html, /is-talking|<script>/);
  assert.match(context.statusIndicatorHtml({ online: false, mediaStatus }), /Offline/);
  assert.doesNotMatch(context.statusIndicatorHtml({ online: false, mediaStatus }), /Media failed|is-failed/);
  for (const state of ['interrupted', 'connecting', 'warning']) {
    assert.match(context.statusIndicatorHtml({ online: true, mediaStatus: { ...mediaStatus, state } }), /is-warning/);
  }
  assert.match(context.statusIndicatorHtml({ online: true, talking: true, mediaStatus: { ...mediaStatus, state: 'connected', label: 'Media connected' } }), /is-talking/);
});
