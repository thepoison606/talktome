const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createConnectionSounds } = require('./public/connectionSounds');

async function setup() {
  const played = [];
  const context = {
    state: 'running', destination: {},
    decodeAudioData: async (bytes) => bytes,
    createBufferSource: () => ({
      connect() {}, disconnect() {}, stop() {},
      start() { played.push(this.buffer); },
    }),
  };
  const sounds = createConnectionSounds(() => context, async () => ({
    ok: true, arrayBuffer: async () => new ArrayBuffer(1),
  }));
  await sounds.prepare();
  const scope = vm.createContext({
    sessionResetInProgress: false, session: { name: 'Test' },
    socket: { connected: true }, connectionSounds: sounds,
    mediaConnectionState: { heartbeatInterrupted: false, send: 'idle', receive: 'idle' },
    sendTransport: null, recvTransport: null,
    renderMediaConnectionStatus() {}, reportMediaTransportEvent() {},
  });
  const source = fs.readFileSync(require.resolve('./public/client.js'), 'utf8');
  // Exercise the actual browser handlers with transport events and cached audio.
  vm.runInContext(source.slice(
    source.indexOf('  function announceConnectionRecovery()'),
    source.indexOf('  function setSessionDisplay('),
  ), scope);
  function transport(direction, state = 'new') {
    const value = new EventEmitter();
    value.connectionState = state;
    scope[direction === 'send' ? 'sendTransport' : 'recvTransport'] = value;
    scope.bindMediaTransportStatus(value, direction);
    return value;
  }
  return { scope, sounds, played, transport };
}

test('heartbeat recovery plays once with an unused receive transport', async () => {
  const f = await setup();
  f.transport('send', 'connected');
  f.transport('receive');
  f.scope.announceConnectionRecovery();
  assert.equal(f.played.length, 0);
  f.sounds.disconnected();
  f.scope.mediaConnectionState.heartbeatInterrupted = true;
  f.scope.announceConnectionRecovery();
  assert.equal(f.played.length, 1);
  f.scope.mediaConnectionState.heartbeatInterrupted = false;
  f.scope.announceConnectionRecovery();
  f.scope.announceConnectionRecovery();
  assert.equal(f.played.length, 2);
});

test('replacement transports do not inherit old interruption flags', async () => {
  const f = await setup();
  const old = f.transport('receive', 'connected');
  old.emit('connectionstatechange', 'disconnected');
  f.scope.socket.connected = false;
  f.scope.resetMediaConnectionState();
  f.transport('send');
  f.transport('receive');
  f.scope.socket.connected = true;
  old.emit('connectionstatechange', 'failed');
  f.scope.announceConnectionRecovery();
  assert.equal(f.played.length, 2);
});

test('current media failure still blocks recovery until both directions recover', async () => {
  const f = await setup();
  const send = f.transport('send', 'connected');
  const receive = f.transport('receive', 'connected');
  send.emit('connectionstatechange', 'disconnected');
  receive.emit('connectionstatechange', 'failed');
  send.emit('connectionstatechange', 'connected');
  assert.equal(f.played.length, 1);
  receive.emit('connectionstatechange', 'connecting');
  f.scope.announceConnectionRecovery();
  assert.equal(f.played.length, 1);
  receive.emit('connectionstatechange', 'connected');
  assert.equal(f.played.length, 2);
});
