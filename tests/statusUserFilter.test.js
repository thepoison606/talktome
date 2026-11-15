const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const admin = fs.readFileSync(require.resolve('../public/admin'), 'utf8');
const context = vm.createContext({});
vm.runInContext(admin.slice(admin.indexOf('function filterStatusUsers('), admin.indexOf('function setStatusUserFilterOpen(')), context);

const users = [
  { id: 1, name: 'Régié', online: true, productionIds: [10, 20], activeProduction: { id: 20 } },
  { id: 2, name: 'Camera A', online: false, productionIds: [10] },
  { id: 3, name: 'Camera B', online: true, productionIds: [20] },
  { id: 4, name: 'Unassigned', online: false, productionIds: [] },
];
const ids = (filters) => Array.from(context.filterStatusUsers(users, filters), (user) => user.id);

test('status production filter includes assigned offline users and members active elsewhere', () => {
  assert.deepEqual(ids({ productionId: '10' }), [1, 2]);
  assert.deepEqual(ids({ productionId: '20' }), [1, 3]);
  assert.deepEqual(ids({ productionId: '30' }), []);
  assert.deepEqual(ids({ productionId: '' }), [1, 2, 3, 4]);
});

test('status production filtering handles numeric IDs without changing source rows', () => {
  const original = JSON.stringify(users);
  assert.deepEqual(ids({ productionId: 10 }), [1, 2]);
  assert.deepEqual(ids(), [1, 2, 3, 4]);
  assert.equal(JSON.stringify(users), original);
});

test('status snapshots supply production choices and memberships independently of online state', () => {
  const source = fs.readFileSync(require.resolve('../src/server/serverCore'), 'utf8');
  let membershipReads = 0;
  const server = vm.createContext({
    areMultipleProductionsEnabled: () => true,
    buildBridgePortStatus: () => null,
    getAllUsers: () => [{ id: 1, name: 'Camera A' }, { id: 2, name: 'Camera B' }],
    getAllFeeds: () => [], getAllConferences: () => [],
    getAllProductions: () => [{ id: 10, name: 'Stage A' }, { id: 20, name: 'Empty production' }],
    getAllProductionMemberships: () => {
      membershipReads += 1;
      return [{ user_id: 1, production_id: 10 }];
    },
    findUserPeerByUserId: () => null, getBridgeRegistrySnapshot: () => [],
    normalizeRuntimeTalkTargets: (targets) => targets,
    statusIsoTimestamp: () => null, companionNamespace: null, peers: new Map(),
    SERVER_APP_VERSION: 'test', SERVER_STARTED_AT: 0,
    isRunningInContainer: () => false, isServerRestartSupported: () => false,
  });
  vm.runInContext(source.slice(source.indexOf('function buildAdminStatusTalkTargets('), source.indexOf('app.get("/admin/status"')), server);
  const snapshot = JSON.parse(JSON.stringify(server.buildAdminStatusSnapshot()));
  assert.equal(membershipReads, 1);
  assert.deepEqual(snapshot.productions, [{ id: 10, name: 'Stage A' }, { id: 20, name: 'Empty production' }]);
  assert.deepEqual(snapshot.users.map((user) => user.productionIds), [[10], []]);
  assert.equal(snapshot.summary.usersTotal, 2);
  assert.equal(snapshot.summary.usersOnline, 0);
});

test('production changes refresh admin status even without connected operator peers', () => {
  const source = fs.readFileSync(require.resolve('../src/server/serverCore'), 'utf8');
  const broadcasts = [];
  const server = vm.createContext({
    peers: new Map(),
    scheduleAdminStatusBroadcast: (reason) => broadcasts.push(reason),
  });
  const start = source.indexOf('function notifyAvailableProductionsChanged(');
  vm.runInContext(source.slice(start, source.indexOf('// Create a self-signed certificate', start)), server);
  server.notifyAvailableProductionsChanged();
  assert.deepEqual(broadcasts, ['productions-updated']);
});
