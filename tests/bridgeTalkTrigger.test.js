const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = require('./helpers/projectRoot');
const trigger = require('../public/bridgeTalkTrigger');
const source = fs.readFileSync(path.join(root, 'bridge-client/src/app.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function load(context, start, end) {
  assert.ok(source.includes(start), start);
  assert.ok(source.includes(end), end);
  vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
}

function runtime(mode = 'always-on') {
  let now = 1000;
  const calls = [];
  const targets = [{ type: 'user', id: 2 }, { type: 'conference', id: 3 }];
  const port = { id: 'user-1', kind: 'user', userId: 1, input: {}, trigger: { mode, targets, thresholdDb: -45 }, triggerTargets: targets };
  const session = { port, signature: 'same', ready: true, starting: false, inputReady: true,
    producerId: 'p1', sessionId: 's1', inputStreamId: 'user-1:input', targets: [], talking: false,
    outputs: new Map(), targetAudioStates: new Map(), lifecycleEvents: [] };
  const context = vm.createContext({
    bridgeTalkTrigger: trigger, Map, Set, Date: { now: () => now },
    MANAGED_LEVEL_TRIGGER_DEFAULT_THRESHOLD_DB: -45,
    MANAGED_LEVEL_TRIGGER_MIN_THRESHOLD_DB: -120, MANAGED_LEVEL_TRIGGER_MAX_THRESHOLD_DB: -10,
    MANAGED_LEVEL_TRIGGER_ATTACK_MS: 100, MANAGED_LEVEL_TRIGGER_RELEASE_MS: 300,
    managedLevelTriggerRunning: false, managedLevelTriggerStartedAt: 0,
    managedSessions: new Map([['user-1', session]]), managedBridgeConfig: {}, managedAudioPopover: null,
    invoke: async () => ({ inputStreamStats: [{ streamId: session.inputStreamId, rmsDb: context.rmsDb, capturedFrames: 100 }] }),
    rmsDb: -20, auditManagedNativeMediaStatus: async () => {}, updateManagedInputLevelDisplay() {},
    renderManagedBridgePorts() {}, recordManagedLifecycle() {}, refreshManagedInputLevelsDuringTransition() {},
    bridgeApi: async (method, url, body) => { calls.push({ method, url, body: plain(body) }); return {}; },
    managedSessionPath: (session, suffix) => `/sessions/${session.sessionId}${suffix}`,
    setManagedSessionError(session, error) { session.error = error.message; },
    sendManagedCommandResult: async () => {},
    bridgePortKey: port => port.id, bridgePortSignature: () => 'same', syncManagedPortAudioLevels: async () => {},
  });
  load(context, 'function resolveBridgeCommandTargets(', 'function getManagedInputLevelMap(');
  load(context, 'function getManagedInputLevelMap(', 'function updateManagedInputLevelDisplay(');
  load(context, 'async function performManagedTalkState(', 'function getManagedPanelReport(');
  load(context, 'async function processManagedLevelTriggers(', 'function createManagedSession(');
  load(context, 'async function reconcileManagedBridgeConfig(', 'async function refreshManagedInventoryOnly(');
  return { context, session, targets, calls, advance: ms => { now += ms; } };
}

test('old single targets survive while an explicit empty list clears them', () => {
  const old = { type: 'conference', id: 7 };
  assert.deepEqual(trigger.fromTrigger({ target: old }), [old]);
  assert.deepEqual(trigger.fromTrigger({ target: old, targets: [] }), []);
  assert.deepEqual(trigger.targets('[{"type":"user","id":2}]'), [{ type: 'user', id: 2 }]);
  assert.deepEqual(trigger.targets([old, old]), [old]);
  assert.throws(() => trigger.targets([{ type: 'feed', id: 1 }], null, { strict: true }), /valid users or conferences/);
  assert.throws(() => trigger.targets('[]', null, { strict: true }), /array/);
});

test('Always on opens all targets without an audio threshold and does not repeatedly resume', async () => {
  const { context, session, targets, calls } = runtime();
  context.rmsDb = -120;
  await context.processManagedLevelTriggers();
  assert.equal(session.talking, true);
  assert.deepEqual(plain(session.targets), targets);
  assert.equal(calls.filter(call => call.url.endsWith('/resume')).length, 1);
  await context.processManagedLevelTriggers();
  assert.equal(calls.filter(call => call.url.endsWith('/resume')).length, 1);
});

test('Always on waits for recovered input and is restored in a newly registered session', async () => {
  const { context, session, targets, calls } = runtime();
  session.inputReady = false;
  session.producerId = null;
  await context.ensureManagedAlwaysOn(session);
  assert.equal(calls.length, 0);
  session.inputReady = true;
  session.producerId = 'replacement';
  await context.ensureManagedAlwaysOn(session);
  assert.equal(session.talking, true);
  assert.deepEqual(plain(session.targets), targets);
  const next = { ...session, sessionId: 'reconnected', producerId: 'p2', talking: false, targets: [], talkStateQueue: Promise.resolve() };
  await context.ensureManagedAlwaysOn(next);
  assert.equal(next.talking, true);
  assert.ok(calls.some(call => call.url === '/sessions/reconnected/talk-state'));
});

test('Bridge startup, server reconnect and actual input teardown/restart restore Always on', async () => {
  const { context, session, calls, targets } = runtime();
  load(context, 'function createManagedSession(', 'async function reconcileManagedBridgeConfig(');
  load(context, 'async function stopManagedInputPath(', 'async function auditManagedSessionDevices(');
  let registrations = 0;
  let producers = 0;
  context.bridgeApi = async (method, url, body) => {
    calls.push({ method, url, body: plain(body || {}) });
    if (url === '/api/v1/bridge/sessions') return { sessionId: `session-${++registrations}` };
    if (url.endsWith('/producers')) return { id: `producer-${++producers}` };
    return {};
  };
  Object.assign(context, {
    currentInventory: null, getManagedOutputUnavailableReason: () => null,
    getManagedAudioLevel: () => ({ gainDb: 0, muted: false }),
    buildProducerRtpParameters: () => ({ payloadType: 100, ssrc: 1234 }),
    clearManagedInputError() {}, setManagedInputError(s, e) { s.inputError = e.message; },
    bridgePortHasPersistentNetworkOutput: () => false, bridgePortHasOutput: () => false,
    startManagedEventStream: async () => {}, stopManagedEventStream() {},
    normalizeManagedTargetAudioState: () => null,
    managedBridgeConfig: { bridgeId: 'test-bridge' },
  });
  context.managedSessions.clear();
  await context.startManagedSession(session.port);
  const live = context.managedSessions.get('user-1');
  assert.equal(live.sessionId, 'session-1');
  assert.equal(live.talking, true);
  assert.deepEqual(plain(live.targets), targets);
  await context.stopManagedInputPath(live, 'device-unplugged');
  assert.equal(live.talking, false);
  assert.equal(live.inputReady, false);
  await context.startManagedInputPath(live, { reason: 'device-returned' });
  assert.equal(live.talking, true);
  assert.equal(live.producerId, 'producer-2');
  await context.startManagedSession(live.port, { reuse: true, reason: 'server-reconnected' });
  assert.equal(live.sessionId, 'session-2');
  assert.equal(live.talking, true);
  assert.deepEqual(plain(live.targets), targets);
});

test('manual release keeps the always-on base; input teardown can suspend it', async () => {
  const { context, session, targets } = runtime();
  await context.ensureManagedAlwaysOn(session);
  await context.applyManagedTalkState(session, { talking: true, targets: [{ type: 'user', id: 9 }], source: 'panel' });
  assert.equal(session.targets.length, 3);
  await context.applyManagedTalkState(session, { talking: false, targets: [] });
  assert.deepEqual(plain(session.targets), targets);
  assert.equal(session.talking, true);
  await context.applyManagedTalkState(session, { talking: false, targets: [], preserveAlwaysOn: false });
  assert.equal(session.talking, false);
});

test('queued automatic requests cannot reopen a microphone after disabling the mode', async () => {
  const { context, session, calls } = runtime();
  let release;
  session.talkStateQueue = new Promise(resolve => { release = resolve; });
  const pending = context.applyManagedTalkState(session, { talking: true, targets: session.port.trigger.targets, source: 'always-on' });
  session.port = { ...session.port, trigger: { mode: 'external', targets: [] } };
  release();
  assert.equal(await pending, false);
  assert.equal(calls.length, 0);
});

test('live target edits replace the old always-on group and disabling stops it', async () => {
  const { context, session } = runtime();
  await context.ensureManagedAlwaysOn(session);
  const target = { type: 'user', id: 5 };
  const nextPort = { ...session.port, trigger: { mode: 'always-on', targets: [target] }, triggerTargets: [target] };
  await context.reconcileManagedBridgeConfig({ ports: [nextPort] });
  assert.deepEqual(plain(session.targets), [target]);
  await context.reconcileManagedBridgeConfig({ ports: [{ ...nextPort, trigger: { mode: 'external', targets: [] } }] });
  assert.equal(session.talking, false);
});

test('a failed automatic release is retried even after changing to External mode', async () => {
  const { context, session, advance } = runtime();
  await context.ensureManagedAlwaysOn(session);
  const api = context.bridgeApi;
  let fail = true;
  context.bridgeApi = async (...args) => {
    if (fail && args[1].endsWith('/pause')) { fail = false; throw new Error('temporary failure'); }
    return api(...args);
  };
  await context.reconcileManagedBridgeConfig({ ports: [{ ...session.port, trigger: { mode: 'external', targets: [] } }] });
  assert.equal(session.automaticReleaseRequired, true);
  advance(1100);
  await context.processManagedLevelTriggers();
  assert.equal(session.talking, false);
  assert.equal(session.automaticReleaseRequired, false);
  assert.equal(session.error, null);
});

test('Audio level activates and releases the entire group together', async () => {
  const { context, session, targets, advance } = runtime('audio-level');
  await context.processManagedLevelTriggers();
  advance(110);
  await context.processManagedLevelTriggers();
  assert.equal(session.talking, true);
  assert.deepEqual(plain(session.targets), targets);
  context.rmsDb = -90;
  advance(10);
  await context.processManagedLevelTriggers();
  advance(310);
  await context.processManagedLevelTriggers();
  assert.equal(session.talking, false);
});

test('External API / Companion uses command targets even when automatic targets were previously saved', async () => {
  const { context, session } = runtime('external');
  await context.handleManagedTalkCommand(session, { action: 'press', targetType: 'user', targetId: 99 });
  assert.deepEqual(plain(session.targets), [{ type: 'user', id: 99 }]);
  assert.deepEqual(plain(context.getManagedTriggerTargets(session.port)), []);
  await context.handleManagedTalkCommand(session, { action: 'release' });
  assert.equal(session.talking, false);
  session.replyTarget = { type: 'user', id: 100 };
  await context.handleManagedTalkCommand(session, { action: 'press', targetType: 'reply' });
  assert.deepEqual(plain(session.targets), [{ type: 'user', id: 100 }]);
});

test('revoked targets are not reopened by an automatic trigger', async () => {
  const { context, session, calls } = runtime();
  session.port.triggerTargets = [];
  await context.ensureManagedAlwaysOn(session);
  assert.equal(calls.length, 0);
});

test('saves, validates and backs up target groups, and migrates old single-target databases', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'talktome-bridge-trigger-'));
  function run(script) {
    execFileSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const db = require('./src/server/dbHandler');
      const raw = require('./src/server/db');
      const trigger = require('./public/bridgeTalkTrigger');
      ${script}
    `], { cwd: root, env: { ...process.env, TALKTOME_DATA_DIR: dataDir }, stdio: 'pipe' });
  }
  try {
    run(`
      const user = Number(db.createUser('Wire', 'test-password'));
      const listener = Number(db.createUser('Listener', 'test-password'));
      const conference = Number(db.createConference('Regie'));
      const production = db.createProduction('Show');
      db.setProductionUser(production, user); db.setProductionUser(production, listener);
      db.setProductionConference(production, conference);
      db.addProductionTarget(production, user, 'user', listener);
      db.addProductionTarget(production, user, 'conference', conference);
      const targets = [{ type: 'user', id: listener }, { type: 'conference', id: conference }];
      const config = { enabled: true, bridgeDevice: 'bridge', triggerMode: 'always-on', triggerTargets: targets };
      db.updateUserBridgeEndpoint(user, config);
      const row = db.getBridgeEndpointsForDevice('bridge')[0];
      assert.equal(row.trigger_mode, 'always-on');
      assert.deepEqual(trigger.targets(row.trigger_targets), targets);
      assert.deepEqual(trigger.targets(db.getUserById(user).bridge_trigger_targets), targets);
      assert.throws(() => db.updateUserBridgeEndpoint(user, { ...config, triggerTargets: [] }), /at least one/);
      assert.throws(() => db.updateUserBridgeEndpoint(user, { ...config, triggerTargets: [{type:'user', id:99999}] }), /unavailable/);
      assert.throws(() => db.updateUserBridgeEndpoint(user, { ...config, triggerTargets: [{type:'feed', id:1}] }), /valid users or conferences/);
      const snapshot = db.exportDatabaseSnapshot();
      db.importDatabaseSnapshot(snapshot);
      assert.deepEqual(trigger.targets(db.getUserById(user).bridge_trigger_targets), targets);
      // Old backups did not include a target list.
      delete snapshot.userBridgeEndpoints[0].trigger_targets;
      snapshot.userBridgeEndpoints[0].trigger_mode = 'audio-level';
      db.importDatabaseSnapshot(snapshot);
      assert.deepEqual(trigger.targets(db.getUserById(user).bridge_trigger_targets), [targets[0]]);
      // Simulate an existing installation before the new column was added.
      raw.exec('ALTER TABLE user_bridge_endpoints DROP COLUMN trigger_targets');
      raw.close();
    `);
    run(`
      const row = db.getBridgeEndpointsForDevice('bridge')[0];
      assert.equal(row.trigger_targets, null);
      const listener = db.getAllUsers().find(user => user.name === 'Listener').id;
      assert.deepEqual(trigger.targets(row.trigger_targets, { type: row.trigger_target_type, id: row.trigger_target_id }), [{type:'user', id:listener}]);
      db.updateUserBridgeEndpoint(row.user_id, {enabled: true, bridgeDevice:'bridge', triggerMode:'audio-level', triggerTargetType:row.trigger_target_type, triggerTargetId:row.trigger_target_id});
      assert.deepEqual(trigger.targets(db.getBridgeEndpointsForDevice('bridge')[0].trigger_targets), [{type:'user', id:listener}]);
    `);
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});
