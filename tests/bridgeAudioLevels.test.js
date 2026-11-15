const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const PROJECT_ROOT = require('./helpers/projectRoot');
const audioLevels = require('../public/bridgeAudioLevels');

test('port audio levels validate ranges and preserve mute independently of gain', () => {
  assert.deepEqual(audioLevels.normalize(), { input: { gainDb: 0, muted: false }, output: { gainDb: 0, muted: false } });
  assert.equal(audioLevels.linearGain({ gainDb: 0, muted: false }), 1);
  assert.equal(audioLevels.linearGain({ gainDb: 12, muted: true }), 0);
  for (const direction of ['input', 'output']) {
    for (const gainDb of [-40, 25, 40]) {
      assert.equal(audioLevels.normalizeLevel({ gainDb }, direction, { strict: true }).gainDb, gainDb);
    }
  }
  for (const [direction, value] of [['input', 41], ['input', -41], ['output', 41], ['output', -41]]) {
    assert.throws(() => audioLevels.normalizeLevel({ gainDb: value }, direction, { strict: true }), /gain/);
  }
  assert.throws(() => audioLevels.normalizeLevel({ gainDb: '6' }, 'input', { strict: true }), /gain/);
  assert.throws(() => audioLevels.normalizeLevel({ muted: 'false' }, 'input', { strict: true }), /boolean/);
});

test('bridge levels survive routing updates, database restart and backup restore', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'talktome-bridge-levels-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const run = script => execFileSync(process.execPath, ['-e', script], {
    cwd: PROJECT_ROOT, env: { ...process.env, TALKTOME_DATA_DIR: dataDir }, encoding: 'utf8',
  });
  const setup = `const assert = require('node:assert/strict'); const db = require('./src/server/dbHandler');`;
  run(`${setup}
    const user = Number(db.createUser('Port', 'test-password'));
    const other = Number(db.createUser('Other', 'test-password'));
    const feed = Number(db.createFeed('Feed', 'test-password'));
    const routing = { enabled: true, bridgeDevice: 'bridge-test' };
    db.updateUserBridgeEndpoint(user, routing);
    db.updateUserBridgeEndpoint(other, routing);
    db.updateFeedBridgeEndpoint(feed, routing);
    db.updateBridgePortAudioLevel('user', user, 'input', { gainDb: 6, muted: false });
    db.updateBridgePortAudioLevel('user', user, 'output', { gainDb: -12, muted: true });
    db.updateBridgePortAudioLevel('feed', feed, 'input', { gainDb: -3, muted: true });
    db.updateUserBridgeEndpoint(user, routing);
    assert.equal(db.getBridgePortAudioLevels('user', user).input.gainDb, 6);
    assert.equal(db.getBridgePortAudioLevels('user', other).input.gainDb, 0);
    assert.throws(() => db.updateBridgePortAudioLevel('feed', feed, 'output', { gainDb: 1 }), /no output/);
    const snapshot = db.exportDatabaseSnapshot();
    db.updateBridgePortAudioLevel('user', user, 'input', { gainDb: 0 });
    db.importDatabaseSnapshot(snapshot);
  `);
  run(`${setup}
    const user = db.getAllUsers().find(user => user.name === 'Port').id;
    const feed = db.getAllFeeds().find(feed => feed.name === 'Feed').id;
    assert.deepEqual(db.getBridgePortAudioLevels('user', user), { input: { gainDb: 6, muted: false }, output: { gainDb: -12, muted: true } });
    assert.deepEqual(db.getBridgePortAudioLevels('feed', feed).input, { gainDb: -3, muted: true });
    const legacy = db.exportDatabaseSnapshot();
    legacy.userBridgeEndpoints.forEach(row => delete row.audio_levels);
    db.importDatabaseSnapshot(legacy);
    assert.equal(db.getBridgePortAudioLevels('user', user).input.gainDb, 0);
  `);
});

test('bridge level API checks token ownership and port assignment before saving', () => {
  const source = fs.readFileSync(require.resolve('../src/server/serverCore'), 'utf8');
  let route;
  let saves = 0;
  const auth = () => {};
  const context = vm.createContext({
    app: { put: (path, middleware, handler) => { assert.equal(middleware, auth); route = handler; } },
    requireBridgeApiAuth: auth, normalizeBridgeId: value => value,
    canBridgeAuthAccessBridge: (auth, id) => auth === id,
    buildBridgeRuntimeConfig: () => ({ ports: [{ kind: 'user', userId: 7 }] }),
    updateBridgePortAudioLevel: (kind, id, direction, value) => { saves++; return { [direction]: audioLevels.normalizeLevel(value, direction, { strict: true }) }; },
  });
  const start = source.indexOf("app.put('/api/v1/bridge/:bridgeId/ports/:kind/:id/levels/:direction'");
  vm.runInContext(source.slice(start, source.indexOf('app.put("/api/v1/bridge/:bridgeId/ports/:kind/:id"', start)), context);
  let status;
  const response = { status(value) { status = value; return this; }, json() {} };
  const request = { params: { bridgeId: 'a', kind: 'user', id: '7', direction: 'input' }, bridgeApiAuth: 'b', body: { gainDb: 6 } };
  route(request, response);
  assert.equal(status, 403);
  request.bridgeApiAuth = 'a'; request.params.id = '8';
  route(request, response);
  assert.equal(status, 404);
  assert.equal(saves, 0);
  request.params.id = '7'; request.body.gainDb = 41;
  route(request, response);
  assert.equal(status, 400);
  request.body.gainDb = 40; status = 200;
  route(request, response);
  assert.equal(status, 200);
});

function clientLevelFixture() {
  const source = fs.readFileSync(path.join(PROJECT_ROOT, 'bridge-client/src/app.js'), 'utf8');
  const native = [];
  const saves = [];
  const edits = new Map();
  const port = { id: 'user-7', kind: 'user', userId: 7 };
  const context = vm.createContext({
    audioLevels, managedAudioEdits: edits, managedBridgeConfig: { bridgeId: 'a', ports: [port] },
    bridgePortKey: port => port.id, bridgePortTargetId: port => port.userId,
    getManagedPortElement: () => null, setTimeout: () => 1, clearTimeout() {},
    invoke: async (command, { request }) => { native.push({ command, gainDb: request.level.gainDb }); },
    bridgeApi: async (method, route, level) => { saves.push({ ...level }); return { audioLevels: { input: level } }; },
  });
  vm.runInContext(source.slice(source.indexOf('function audioEditKey('), source.indexOf('function renderManagedAssignmentControls(')), context);
  return { context, port, edits, native, saves };
}

test('drag changes apply in order and save the final port gain without a stream restart', async () => {
  const { context, port, edits, native, saves } = clientLevelFixture();
  context.changeManagedAudioLevel(port, 'input', { gainDb: 6, muted: false });
  context.changeManagedAudioLevel(port, 'input', { gainDb: 12, muted: false });
  await context.persistManagedAudioLevel(port, 'input');
  assert.deepEqual(native.map(row => row.gainDb), [6, 12]);
  assert.equal(native.every(row => row.command === 'set_bridge_port_audio_level'), true);
  assert.deepEqual(saves, [{ gainDb: 12, muted: false, noiseSuppression: false }]);
  assert.equal(edits.get('user-7:input').dirty, false);
});

test('an older save response cannot replace a newer edit or the other direction', async () => {
  const { context, port, edits } = clientLevelFixture();
  let finishFirst;
  const firstResponse = new Promise(resolve => { finishFirst = resolve; });
  context.bridgeApi = async (method, route, level) => route.endsWith('/input')
    ? firstResponse
    : { audioLevels: { input: { gainDb: 0, muted: false }, output: level } };
  context.changeManagedAudioLevel(port, 'input', { gainDb: 6, muted: false });
  const pending = context.persistManagedAudioLevel(port, 'input');
  await edits.get('user-7:input').nativePromise;
  context.changeManagedAudioLevel(port, 'input', { gainDb: 12, muted: false });
  context.changeManagedAudioLevel(port, 'output', { gainDb: -3, muted: false });
  await context.persistManagedAudioLevel(port, 'output');
  finishFirst({ audioLevels: { input: { gainDb: 6, muted: false }, output: { gainDb: 0, muted: false } } });
  await pending;
  assert.equal(context.getManagedAudioLevel(port, 'input').gainDb, 12);
  assert.equal(edits.get('user-7:input').dirty, true);
  assert.equal(context.getManagedAudioLevel(port, 'output').gainDb, -3);
});

test('a failed native update stays unsaved and can be retried with the same value', async () => {
  const { context, port, edits, saves } = clientLevelFixture();
  context.invoke = async () => { throw new Error('Native command failed'); };
  context.changeManagedAudioLevel(port, 'input', { gainDb: 6, muted: false });
  await context.persistManagedAudioLevel(port, 'input');
  assert.equal(saves.length, 0);
  assert.equal(edits.get('user-7:input').dirty, true);
  assert.match(edits.get('user-7:input').error, /Native command failed/);
  context.invoke = async () => {};
  context.changeManagedAudioLevel(port, 'input', { gainDb: 6, muted: false });
  await context.persistManagedAudioLevel(port, 'input');
  assert.equal(saves.length, 1);
  assert.equal(edits.get('user-7:input').dirty, false);
});
