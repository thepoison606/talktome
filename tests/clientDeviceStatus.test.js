const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { normalizeClientDeviceStatus, recordClientDeviceStatus, getFreshClientDeviceStatus } = require('../src/server/clientDeviceStatus');
const { browserNetworkType, createReporter } = require('../public/clientDeviceStatus');

test('device reports validate hardware values without inventing defaults', () => {
  assert.equal(normalizeClientDeviceStatus(null), null);
  assert.equal(normalizeClientDeviceStatus([]), null);
  assert.deepEqual(normalizeClientDeviceStatus({ audioOutput: { label: ' AirPods\n', kind: 'bluetooth' }, batteryPercent: 0, charging: true, networkType: 'wifi' }), {
    audioOutput: { label: 'AirPods', kind: 'bluetooth' }, batteryPercent: 0, charging: true, networkType: 'wifi',
  });
  for (const value of [null, '30', -1, 101, Infinity, NaN]) {
    assert.equal(normalizeClientDeviceStatus({ batteryPercent: value }).batteryPercent, null);
  }
  assert.deepEqual(normalizeClientDeviceStatus({ charging: 'yes', networkType: '4g' }), {
    audioOutput: null, batteryPercent: null, charging: null, networkType: null,
  });
  assert.equal(normalizeClientDeviceStatus({ audioOutput: { label: 'a'.repeat(500), kind: 'invalid' } }).audioOutput.label.length, 120);
});

test('device reports require a registered client, expire and replace outdated values', () => {
  for (const peer of [null, { kind: 'guest' }, { kind: 'user', connectedAt: 1, isBridgePeer: true }]) {
    assert.equal(recordClientDeviceStatus(peer, {}, 1000), false);
  }
  const peer = { kind: 'user', connectedAt: 1 };
  assert.equal(recordClientDeviceStatus(peer, { batteryPercent: 15, charging: false }, 1000), true);
  assert.equal(recordClientDeviceStatus(peer, {}, 1500), false);
  assert.equal(getFreshClientDeviceStatus(peer, 31000).batteryPercent, 15);
  assert.equal(getFreshClientDeviceStatus(peer, 31001), null);
  assert.equal(recordClientDeviceStatus(peer, { charging: true }, 32000), true);
  assert.equal(getFreshClientDeviceStatus(peer, 32000).batteryPercent, null);
  assert.equal(getFreshClientDeviceStatus(peer, 32000).charging, true);
});

test('missing media measurements stay unavailable while real zero loss is accepted', () => {
  const source = fs.readFileSync(require.resolve('../src/server/serverCore'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function normalizeBrowserMediaStats('), source.indexOf('function logBrowserMediaStats(')), context);
  assert.equal(context.normalizeBrowserMediaStats({ roundTripMs: null, packetLossPercent: null }), null);
  assert.equal(context.normalizeBrowserMediaStats({ roundTripMs: 12, packetLossPercent: 0 }).packetLossPercent, 0);
});

test('battery shows a charging bolt instead of a low-battery warning while plugged in', () => {
  const source = fs.readFileSync(require.resolve('../public/admin'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function formatStatusAudioOutput('), source.indexOf('function renderAdminStatus(')), context);
  assert.equal(context.statusBatteryHtml(null), '-');
  assert.match(context.statusBatteryHtml({ batteryPercent: 20, charging: false }), /is-low/);
  assert.match(context.statusBatteryHtml({ batteryPercent: 10, charging: false }), /is-critical/);
  const charging = context.statusBatteryHtml({ batteryPercent: 10, charging: true });
  assert.match(charging, /Charging/);
  assert.match(charging, /M12 1 7 7/);
  assert.doesNotMatch(charging, /is-low|is-critical/);
  assert.equal(context.formatStatusAudioOutput({ audioOutput: { kind: 'bluetooth', label: 'AirPods' } }), 'Bluetooth · AirPods');
  assert.equal(context.formatStatusNetwork({ networkType: 'wifi' }), 'Wi-Fi');
  assert.equal(context.formatStatusNetwork({}), '-');
});

test('browser speed estimates do not masquerade as cellular connections', () => {
  assert.equal(browserNetworkType({ effectiveType: '4g' }, true), null);
  assert.equal(browserNetworkType({ type: 'wifi', effectiveType: '4g' }, true), 'wifi');
  assert.equal(browserNetworkType(null, false), 'none');
});

test('browser output reporting reads actual media sinks and respects unavailable sink APIs', async () => {
  const source = fs.readFileSync(require.resolve('../public/client'), 'utf8');
  const start = source.indexOf('  const audioElements = new Map();');
  const context = vm.createContext({
    sharedAudioContext: { state: 'running', sinkId: 'usb' }, remotePlaybackBus: null,
    navigator: { mediaDevices: { enumerateDevices: async () => [{ kind: 'audiooutput', deviceId: 'usb', label: 'USB Audio' }] } },
  });
  vm.runInContext('let readActiveAudioOutput;\n' + source.slice(start, source.indexOf('  const audioEntryMap', start)), context);
  assert.equal((await vm.runInContext('readActiveAudioOutput()', context)).label, 'USB Audio');
  context.sharedAudioContext = { state: 'running' };
  assert.equal(await vm.runInContext('readActiveAudioOutput()', context), null);
  context.sharedAudioContext = { state: 'running', sinkId: '' };
  assert.equal((await vm.runInContext('readActiveAudioOutput()', context)).label, 'System default');
  vm.runInContext("audioElements.set('stream', {audio:{sinkId:'usb'}})", context);
  assert.equal((await vm.runInContext('readActiveAudioOutput()', context)).label, 'Multiple outputs');
});

function browserFixture(navigator) {
  const environment = new EventTarget();
  Object.assign(environment, { navigator, document: new EventTarget(), setTimeout, clearTimeout, setInterval, clearInterval });
  const reports = [];
  const socket = { connected: true, volatile: { emit: (event, value) => reports.push({ event, value }) } };
  return { environment, socket, reports };
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

test('unsupported browser APIs and output failures preserve the other diagnostics', async () => {
  const f = browserFixture({ onLine: true });
  const reporter = createReporter({ ...f, isActive: () => true, readOutput: () => { throw new Error('No sink API'); } });
  try {
    await flush();
    assert.deepEqual(f.reports[0].value, { audioOutput: null, batteryPercent: null, charging: null, networkType: null });
  } finally { reporter.stop(); }
});

test('browser charging and network changes update reports, and stop removes listeners', async () => {
  const battery = Object.assign(new EventTarget(), { level: 0.15, charging: false });
  const connection = Object.assign(new EventTarget(), { type: 'wifi' });
  const f = browserFixture({ connection, onLine: true, getBattery: async () => battery });
  const reporter = createReporter({ ...f, isActive: () => true, readOutput: async () => ({ kind: 'other', label: 'USB Audio' }) });
  try {
    await flush(); await reporter.report();
    assert.equal(f.reports.at(-1).value.batteryPercent, 15);
    battery.charging = true; battery.dispatchEvent(new Event('chargingchange')); await flush();
    assert.equal(f.reports.at(-1).value.charging, true);
    connection.type = 'cellular'; connection.dispatchEvent(new Event('change')); await flush();
    assert.equal(f.reports.at(-1).value.networkType, 'cellular');
    reporter.stop(); const count = f.reports.length;
    battery.dispatchEvent(new Event('levelchange')); connection.dispatchEvent(new Event('change')); await flush();
    assert.equal(f.reports.length, count);
  } finally { reporter.stop(); }
});

test('a stopped or disconnected browser never publishes a delayed device report', async () => {
  for (const disconnect of [false, true]) {
    const f = browserFixture({ onLine: true });
    let finish;
    const reporter = createReporter({ ...f, isActive: () => true, readOutput: () => new Promise(resolve => { finish = resolve; }) });
    await flush();
    if (disconnect) f.socket.connected = false; else reporter.stop();
    finish(null); await flush(); reporter.stop();
    assert.equal(f.reports.length, 0);
  }
});
