const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const { normalizeClientVersion, normalizeClientBuild } = require('../src/server/statusClient');
const serverSource = fs.readFileSync(require.resolve('../src/server/serverCore'), 'utf8');

test('client metadata accepts release and development versions and rejects unsafe or oversized values', () => {
  for (const version of ['1.5.20', '1.5.20-rc.1', '1.5.20+abc123']) assert.equal(normalizeClientVersion(version), version);
  for (const value of [undefined, {}, '', '<script>', 'a'.repeat(65), '1.0\nother']) assert.equal(normalizeClientVersion(value), null);
  assert.equal(normalizeClientBuild(70), '70');
  assert.equal(normalizeClientBuild(' 70 '), '70');
  assert.equal(normalizeClientBuild('70.1'), '70.1');
  for (const value of [-1, 1.5, {}, 'unknown', '1'.repeat(33)]) assert.equal(normalizeClientBuild(value), null);
});

test('status snapshots retain versions separately for mobile clients and their Bridge endpoints', () => {
  const bridge = { id: 'bridge-1', name: 'Studio Bridge', clientVersion: '1.5.20', inventory: { devices: [] } };
  const peersByUser = new Map([
    [1, { clientType: 'ios-app', clientVersion: '1.0.0', clientBuild: '40', connectedAt: Date.now(), socket: {} }],
    [2, { isBridgePeer: true, bridgeId: bridge.id, connectedAt: Date.now() }],
    [3, { clientType: 'android-app', connectedAt: Date.now(), socket: {} }],
  ]);
  const context = vm.createContext({
    areMultipleProductionsEnabled: () => false,
    getAllUsers: () => [1, 2, 3, 4].map(id => ({ id, name: `User ${id}` })),
    getAllFeeds: () => [], getAllConferences: () => [],
    findUserPeerByUserId: id => peersByUser.has(id) ? { peer: peersByUser.get(id), socketId: `socket-${id}` } : null,
    getPeerActiveTalkTargets: () => [], normalizeRuntimeTalkTargets: value => value,
    bridgeRegistry: new Map([[bridge.id, bridge]]),
    getBridgeRegistrySnapshot: () => [bridge],
    getFreshBridgeNetworkStats: () => null, getFreshBrowserMediaStats: () => null,
    getBridgeAggregateNetworkStats: () => null, buildBridgeDeviceIssues: () => [],
    bridgeControlSessions: new Map(), describePeerMediaStatus: () => 'Connected',
    describeBridgeStatusClient: () => 'Bridge macOS', describeStatusClient: (_socket, type) => type,
    statusRemoteAddress: () => null, statusIsoTimestamp: () => null,
    getFreshClientDeviceStatus: () => null,
    companionNamespace: null, peers: new Map(), WEB_ACCESS: {},
    SERVER_APP_VERSION: '1.5.20', SERVER_STARTED_AT: 0,
    isRunningInContainer: () => false, isServerRestartSupported: () => false,
  });
  vm.runInContext(serverSource.slice(serverSource.indexOf('function buildAdminStatusTalkTargets('), serverSource.indexOf('app.get("/admin/status"')), context);
  const snapshot = context.buildAdminStatusSnapshot();
  assert.equal(snapshot.users[0].clientVersion, '1.0.0');
  assert.equal(snapshot.users[0].clientBuild, '40');
  assert.equal(snapshot.users[1].clientVersion, '1.5.20');
  assert.equal(snapshot.users[1].clientBuild, null);
  assert.equal(snapshot.bridges[0].clientVersion, '1.5.20');
  assert.equal(snapshot.users[2].clientVersion, null);
  assert.equal(snapshot.users[3].clientVersion, null);
});

test('Bridge registry snapshots preserve the announced binary version', () => {
  const context = vm.createContext({ BRIDGE_REGISTRY_STALE_MS: 60_000 });
  vm.runInContext(serverSource.slice(serverSource.indexOf('function serializeBridgeRegistryEntry('), serverSource.indexOf('function getBridgeRegistrySnapshot(')), context);
  assert.equal(context.serializeBridgeRegistryEntry({ inventory: {}, clientVersion: '1.5.20', lastSeenAtMs: Date.now() }).clientVersion, '1.5.20');
  assert.equal(context.serializeBridgeRegistryEntry({ inventory: {} }).clientVersion, null);
});

test('version cells are single-line text and keep a dash for old clients', () => {
  const source = fs.readFileSync(require.resolve('../public/admin'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function formatStatusClientVersion('), source.indexOf('function renderAdminStatus(')), context);
  assert.equal(context.formatStatusClientVersion({ clientVersion: '1.0.0', clientBuild: '40' }), 'v1.0.0 (40)');
  assert.equal(context.formatStatusClientVersion({ clientVersion: '1.5.20' }), 'v1.5.20');
  assert.equal(context.formatStatusClientVersion({}), '-');
});
