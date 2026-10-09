const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const express = require('express');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const { installRemotePanelControl } = require('./remotePanelControl');
const panelState = require('./public/remotePanelState');

async function fixture(t) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  const clients = [];
  const settings = new Map();
  const audio = new Map();
  const peers = new Map();
  const commands = [];
  const user = { id: 7, name: 'Camera' };
  const productions = [{ id: 1, name: 'Show' }];
  const behavior = { failPress: false };
  const targets = [{ targetType: 'user', targetId: 8, name: 'Director' }, { targetType: 'conference', targetId: 4, name: 'Crew', canTalk: true }];
  const getAdminSession = req => req.headers.cookie === 'admin_session=test-admin' ? { session: { isGlobalAdmin: true } } : null;
  const control = installRemotePanelControl({
    app, io, publicDir: path.join(__dirname, 'public'),
    getAdminSession, requireAdmin: (req, res, next) => getAdminSession(req) ? next() : res.sendStatus(401),
    getUserById: id => Number(id) === 7 ? user : null,
    findUserPeerByUserId: id => peers.get(Number(id)) || null,
    getUserList: () => [], getEnabledProductionsForUser: () => productions,
    isUserInProduction: (userId, productionId) => Number(userId) === 7 && Number(productionId) === 1,
    getPrimaryProduction: () => ({ id: 1 }), buildOperatorTargetsForUser: () => targets,
    getBridgeTargetsForUser: () => targets, buildIncomingTalkStateForUser: () => ({ addressedNow: [], replyTarget: null }),
    getUserTargetAudioStates: id => audio.get(Number(id)) || [],
    mergeUserTargetAudioStates(id, rows) {
      const current = new Map((audio.get(id) || []).map(row => [`${row.targetType}:${row.targetId}`, row]));
      rows.forEach(row => current.set(`${row.targetType}:${row.targetId}`, row));
      audio.set(id, [...current.values()]);
    },
    getUserPanelSettings: id => settings.get(Number(id)) || {},
    updateUserPanelSettings: (id, value) => settings.set(Number(id), structuredClone(value)),
    getResolvedUserAudioSettings: () => ({}), updateUserAudioSettings() {}, updateProductionTargetOrder() {}, notifyTargetChange() {},
  });
  io.on('connection', socket => {
    const peer = { kind: 'user', userId: 7, socket, productionId: 1 };
    peers.set(7, { socketId: socket.id, peer });
    socket.on('disconnect', () => peers.delete(7));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { clients.forEach(socket => socket.disconnect()); await new Promise(resolve => io.close(resolve)); });
  async function openPanel(cookie = 'admin_session=test-admin') {
    const socket = connect(`${url}/panel`, { extraHeaders: { cookie }, reconnection: false, forceNew: true });
    clients.push(socket);
    await once(socket, 'connect');
    assert.equal((await socket.emitWithAck('panel-watch', { userId: 7 })).ok, true);
    return socket;
  }
  async function openUser() {
    const socket = connect(url, { reconnection: false, forceNew: true });
    clients.push(socket);
    await once(socket, 'connect');
    socket.on('panel-command', (command, ack) => {
      commands.push(command);
      if (behavior.failPress && command.action === 'press') return ack({ ok: false, error: 'Microphone unavailable' });
      ack({ ok: true, report: { revision: command.panelSettings?.revision || 0, storage: command.panelSettings?.storage || {}, runtime: {} } });
    });
    return socket;
  }
  return { app, url, control, settings, audio, peers, commands, openPanel, openUser, clients, productions, behavior };
}

test('panel namespace and HTML require an admin session', async t => {
  const f = await fixture(t);
  const socket = connect(`${f.url}/panel`, { reconnection: false, forceNew: true });
  f.clients.push(socket);
  const [error] = await once(socket, 'connect_error');
  assert.match(error.message, /Admin login required/);
  assert.equal((await fetch(`${f.url}/panel?userId=7`)).status, 401);
  assert.equal((await fetch(`${f.url}/panel?userId=7`, { headers: { cookie: 'admin_session=test-admin' } })).status, 200);
});

test('offline absolute audio changes persist without deleting other targets', async t => {
  const f = await fixture(t);
  f.audio.set(7, [{ targetType: 'conference', targetId: 4, muted: false, volume: 0.2 }]);
  const panel = await f.openPanel();
  const result = await panel.emitWithAck('panel-command', { kind: 'target-audio', targetType: 'user', targetId: 8, volume: 0.7, muted: true });
  assert.equal(result.ok, true);
  assert.equal(result.offline, true);
  assert.equal(f.audio.get(7).length, 2);
  assert.deepEqual(f.audio.get(7).find(row => row.targetType === 'user'), { targetType: 'user', targetId: 8, volume: 0.7, muted: true });
  assert.equal(result.state.panelSettings.revision, 1);
});

test('panel commands cannot control an unassigned target or write another user preferences', async t => {
  const f = await fixture(t);
  const panel = await f.openPanel();
  assert.equal((await panel.emitWithAck('panel-command', { kind: 'target-audio', targetType: 'user', targetId: 99, volume: 1 })).ok, false);
  assert.equal((await panel.emitWithAck('panel-command', { kind: 'preferences', patch: { 'mainButtonTarget:user:99:1': 'user:8' } })).ok, false);
  assert.equal((await panel.emitWithAck('panel-command', { kind: 'target-audio', targetType: 'user', targetId: 8, volume: -1 })).ok, false);
  assert.equal(f.settings.size, 0);
});

test('remote changes are acknowledged by the existing user socket and stale reports are ignored', async t => {
  const f = await fixture(t);
  await f.openUser();
  const originalPeer = f.peers.get(7).peer;
  f.control.report(originalPeer, { revision: 0, storage: { 'mainButtonTarget:user:7:1': 'user:8' }, runtime: {} });
  const panel = await f.openPanel();
  const result = await panel.emitWithAck('panel-command', { kind: 'preferences', patch: { 'conferenceMemberLevels:user:7': '{"4":{"8":0.3}}' } });
  assert.equal(result.ok, true);
  assert.equal(f.commands.length, 1);
  assert.equal(f.peers.size, 1, 'the panel must not register as another user');
  assert.equal(f.peers.get(7).peer, originalPeer);
  f.control.report(originalPeer, { revision: 0, storage: {}, runtime: {} });
  assert.equal(f.settings.get(7).storage['mainButtonTarget:user:7:1'], 'user:8');
  assert.equal(f.settings.get(7).storage['conferenceMemberLevels:user:7'], '{"4":{"8":0.3}}');
});

test('closing a panel releases only its held PTT inputs', async t => {
  const f = await fixture(t);
  await f.openUser();
  const panel = await f.openPanel();
  assert.equal((await panel.emitWithAck('panel-command', { kind: 'talk', action: 'press', targetType: 'user', targetId: 8, inputKey: 'pointer:1' })).ok, true);
  const inputKey = f.commands[0].inputKey;
  assert.match(inputKey, /^panel:/);
  panel.disconnect();
  for (let i = 0; i < 20 && f.commands.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.commands[1].action, 'release');
  assert.equal(f.commands[1].inputKey, inputKey);
});

test('remote preference storage is isolated and validates data', () => {
  const local = panelState.createStorage();
  const remote = panelState.createStorage();
  local.setItem('mainButtonTarget:user:7:1', 'user:8');
  assert.equal(remote.getItem('mainButtonTarget:user:7:1'), null);
  assert.throws(() => panelState.normalizeStorage({ 'conferenceMemberLevels:user:7': 'not-json' }, 7, { strict: true }));
  assert.deepEqual(panelState.mergeStorage({ a: '1', b: '2' }, { a: null, c: '3' }), { b: '2', c: '3' });
});


test('a lock command does not create an untracked held input and unrelated releases preserve local PTT', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'public/client.js'), 'utf8');
  let handler;
  const holds = new Map([['local-pointer', { type: 'user', id: 'director' }]]);
  const starts = [];
  const stops = [];
  const context = vm.createContext({
    remotePanel: null, session: { kind: 'user' },
    socket: { on: (event, callback) => { handler = callback; } },
    applyClientPanelSettings: async () => {}, resolveApiTalkTarget: () => ({ type: 'user', id: 'director' }),
    findTalkButtonForTarget: () => ({}), activateTalkLock() {},
    handleTalk: async event => starts.push(event), handleStopTalking: event => stops.push(event),
    collectClientPanelReport: () => ({}), reportClientPanelState() {}, activeTalkPointers: holds,
  });
  const start = source.indexOf("  socket.on('panel-command', async");
  const end = source.indexOf('  // Signaling Events', start);
  vm.runInContext(source.slice(start, end), context);
  let result;
  await handler({ kind: 'talk', action: 'lock', inputKey: 'panel:socket:main' }, value => { result = value; });
  assert.equal(result.ok, true);
  assert.equal(starts[0].talkInputKey, undefined, 'a persistent lock must not add a second held pointer');
  await handler({ kind: 'talk', action: 'release', inputKey: 'panel:socket:1' }, value => { result = value; });
  assert.equal(result.ok, true);
  assert.equal(stops.length, 0);
  assert.equal(holds.has('local-pointer'), true);
});

test('panel preferences and partial target updates survive database restart and backup restore', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'talktome-panel-db-'));
  const dbPath = require.resolve('./dbHandler');
  const prepare = `
    const assert = require('node:assert/strict');
    const db = require(${JSON.stringify(dbPath)});
    const id = db.createUser('Remote camera', 'camera-password');
    db.updateUserPanelSettings(id, { revision: 12, storage: { ['conferenceMemberLevels:user:' + id]: '{"4":{"8":0.3}}' } });
    db.mergeUserTargetAudioStates(id, [{ targetType: 'user', targetId: 8, volume: 0.7, muted: true }]);
    db.mergeUserTargetAudioStates(id, [{ targetType: 'conference', targetId: 4, volume: 0.2, muted: false }]);
    const backup = db.exportDatabaseSnapshot();
    db.importDatabaseSnapshot(backup);
    assert.equal(db.getUserPanelSettings(id).revision, 12);
    assert.equal(db.getUserTargetAudioStates(id).length, 2);
  `;
  const restore = `
    const assert = require('node:assert/strict');
    const db = require(${JSON.stringify(dbPath)});
    const user = db.getAllUsers().find(user => user.name === 'Remote camera');
    const state = db.getUserPanelSettings(user.id);
    assert.equal(state.revision, 12);
    assert.equal(JSON.parse(state.storage['conferenceMemberLevels:user:' + user.id])[4][8], 0.3);
    assert.equal(db.getUserTargetAudioStates(user.id).find(target => target.targetType === 'user').muted, true);
  `;
  try {
    for (const script of [prepare, restore]) execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, TALKTOME_DATA_DIR: dataDir }, stdio: 'pipe',
    });
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});


test('offline single-production panels retain their assigned targets', async t => {
  const f = await fixture(t);
  f.productions.length = 0; // Production chooser is hidden in single-production mode.
  const panel = await f.openPanel();
  const result = await panel.emitWithAck('panel-command', { kind: 'target-audio', targetType: 'user', targetId: 8, volume: 0.4 });
  assert.equal(result.ok, true);
  assert.equal(result.state.productionId, 1);
  assert.equal(result.state.targets.length, 2);
});

test('a failed press is released so delayed microphone access cannot leave PTT active', async t => {
  const f = await fixture(t);
  await f.openUser();
  f.behavior.failPress = true;
  const panel = await f.openPanel();
  const result = await panel.emitWithAck('panel-command', { kind: 'talk', action: 'press', targetType: 'user', targetId: 8, inputKey: '1' });
  assert.equal(result.ok, false);
  assert.equal(f.commands[1].action, 'release');
  assert.equal(f.commands[1].inputKey, f.commands[0].inputKey);
});


test('Bridge receive controls honor conference member levels, exclusions and stopped feeds', () => {
  const source = fs.readFileSync(path.join(__dirname, 'bridge-client/src/app.js'), 'utf8');
  const start = source.indexOf('function getManagedPanelOutputState(');
  const end = source.indexOf('function getManagedRetryDelay(', start);
  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end), context);
  const session = { port: { userId: 7 }, panelSettings: { storage: {
    'conferenceListenExclusions:user:7': '{"4":[8]}',
    'conferenceMemberLevels:user:7': '{"4":{"9":0.25}}',
    'stoppedFeeds:user:7': '{"feed-3":true}',
  } } };
  const base = { volume: 0.8, muted: false };
  const conference = speakerUserId => ({ appData: { type: 'conference', id: 4 }, speakerUserId });
  assert.equal(context.getManagedPanelOutputState(session, conference(8), base).muted, true);
  assert.equal(context.getManagedPanelOutputState(session, conference(9), base).volume, 0.2);
  assert.equal(context.getManagedPanelOutputState(session, conference(10), base).volume, 0.8);
  assert.equal(context.getManagedPanelOutputState(session, { appData: { type: 'feed', id: 3 } }, base).muted, true);
  assert.equal(base.volume, 0.8);
});

test('Bridge Companion release preserves panel holds and cannot restore a released Companion target', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'bridge-client/src/app.js'), 'utf8');
  const start = source.indexOf('async function applyManagedCompanionTalkState(');
  const end = source.indexOf('async function handleManagedEvent(', start);
  const context = vm.createContext({
    resolveBridgeCommandTargets: (session, command) => [{ type: command.targetType, id: command.targetId }],
    applyManagedTalkState: async (session, state) => {
      session.talking = state.talking; session.targets = state.targets;
      session.lockActive = state.lockActive || false; session.talkSource = state.talking ? state.source || 'external' : null;
    },
    sendManagedCommandResult: async () => {}, renderManagedBridgePorts() {},
  });
  vm.runInContext(source.slice(start, end), context);
  const session = { port: { kind: 'user', userId: 7 }, inputReady: true, producerId: 'input', targetAudioStates: new Map(), talking: false, targets: [], lockActive: false };
  const command = (action, targetId, inputKey) => ({ action, targetType: 'conference', targetId, inputKey, kind: 'talk' });
  await context.handleManagedTalkCommand(session, command('press', 4, 'companion:button'));
  await context.handleManagedPanelCommand(session, command('press', 5, 'panel:button'));
  assert.deepEqual(Array.from(session.targets, target => target.id), [4, 5]);
  await context.handleManagedTalkCommand(session, command('release', 4, 'companion:button'));
  assert.deepEqual(Array.from(session.targets, target => target.id), [5]);
  await context.handleManagedPanelCommand(session, command('release', 5, 'panel:button'));
  assert.equal(session.talking, false);
  await context.handleManagedPanelCommand(session, command('press', 5, 'panel:button'));
  assert.deepEqual(Array.from(session.targets, target => target.id), [5], 'a previously released Companion input must not return');
});

test('Bridge panel release restores an existing Companion lock without claiming its input', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'bridge-client/src/app.js'), 'utf8');
  const start = source.indexOf('async function applyManagedCompanionTalkState(');
  const end = source.indexOf('async function handleManagedEvent(', start);
  const context = vm.createContext({
    resolveBridgeCommandTargets: (session, command) => [{ type: command.targetType, id: command.targetId }],
    applyManagedTalkState: async (session, state) => {
      session.talking = state.talking; session.targets = state.targets;
      session.lockActive = state.lockActive || false; session.talkSource = state.talking ? state.source || 'external' : null;
    },
    sendManagedCommandResult: async () => {}, renderManagedBridgePorts() {},
  });
  vm.runInContext(source.slice(start, end), context);
  const session = { port: { kind: 'user', userId: 7 }, inputReady: true, producerId: 'input', targetAudioStates: new Map(), talking: false, targets: [], lockActive: false };
  const command = (action, targetId, inputKey) => ({ action, targetType: 'conference', targetId, inputKey, kind: 'talk' });
  await context.handleManagedTalkCommand(session, command('lock-toggle', 4));
  await context.handleManagedPanelCommand(session, command('press', 5, 'panel:button'));
  await context.handleManagedPanelCommand(session, command('release', 5, 'panel:button'));
  assert.equal(session.lockActive, true);
  assert.equal(session.talkSource, 'external');
  assert.deepEqual(Array.from(session.targets, target => target.id), [4]);
  await context.handleManagedTalkCommand(session, command('lock-toggle', 4));
  assert.equal(session.talking, false);
});
