const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('./bridge-client/src/app.js'), 'utf8');

function bridgeFunction(start, end, globals) {
  const context = vm.createContext(globals);
  vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
  return context;
}

test('failed startup announce still schedules a connection retry', async () => {
  let retryStarted = 0;
  let announceCalls = 0;
  const context = bridgeFunction('async function refreshDevices()', 'addPortButton?.addEventListener', {
    invoke: async (command) => command === 'list_audio_devices'
      ? { host: 'PC', devices: [] }
      : {},
    withTimeout: (promise) => promise,
    AUDIO_INVENTORY_TIMEOUT_MS: 10_000,
    AUDIO_STATUS_TIMEOUT_MS: 5_000,
    refreshButton: { disabled: false, textContent: '' },
    connectionStatus: { textContent: '' },
    deviceList: { innerHTML: '' },
    localPortList: null,
    serverUrlInput: { value: 'https://example.com' },
    getBridgeCredential: () => 'token',
    currentInventory: null,
    managedInventoryWatchRetryAt: 0,
    renderInventory(inventory) { context.currentInventory = inventory; },
    renderBridgeStatus() {}, renderPortStatuses() {},
    renderNdiStatus() {}, renderOmtStatus() {},
    announceBridge: async () => {
      announceCalls += 1;
      throw new Error('network offline');
    },
    isServerOfflineError: () => true,
    setServerConnectionState() {}, setBridgeConnectionError() {},
    startManagedConnectionRetry() { retryStarted += 1; },
    console: { warn() {}, error() {} },
  });

  await context.refreshDevices();
  assert.equal(announceCalls, 1);
  assert.equal(retryStarted, 1);
});

test('retry can register a Bridge without a saved ID once the network returns', async () => {
  let bridgeId = '';
  let announceCalls = 0;
  const requestedPaths = [];
  const states = [];
  const context = bridgeFunction('async function syncManagedBridge()', 'async function watchManagedInventory()', {
    managedSyncRunning: false,
    isBridgeSettingsControlFocused: () => false,
    serverUrlInput: { value: 'https://example.com' },
    getBridgeCredential: () => 'token',
    localStorage: { getItem: () => bridgeId },
    STORAGE_KEYS: { bridgeId: 'bridgeId' },
    async announceBridge() {
      announceCalls += 1;
      if (announceCalls === 1) throw new Error('network offline');
      bridgeId = 'new-bridge-id';
    },
    setServerConnectionState(state) { states.push(state); },
    async auditManagedSessionDevices() {},
    async auditManagedNativeMediaStatus() {},
    async bridgeApi(method, path) {
      requestedPaths.push([method, path]);
      return { ports: [] };
    },
    async reconcileManagedBridgeConfig() {},
    async heartbeatManagedSessions() {},
    connectionStatus: { textContent: '' },
    managedSessions: new Map(),
    isServerOfflineError: (error) => /offline/.test(error.message),
    renderManagedBridgePorts() {},
  });

  await context.syncManagedBridge();
  assert.equal(context.managedSyncRunning, false);
  await context.syncManagedBridge();
  assert.equal(announceCalls, 2);
  assert.deepEqual(requestedPaths, [['GET', '/api/v1/bridge/new-bridge-id/config']]);
  assert.equal(context.connectionStatus.textContent, 'Announced');
  assert.deepEqual(states, ['disconnected', 'connected']);
});
