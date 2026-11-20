const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const { sanitizePortReport, endpointIssues } = require('../src/server/bridgePortStatus');
const source = fs.readFileSync('src/server/serverCore.js', 'utf8');

test('long native audio device IDs survive inventory and database reload without truncation', t => {
  const sharedPrefix = `DeviceId(CoreAudio, "${'usb:interface:'.repeat(20)}`;
  const inputDevice = `${sharedPrefix}input")`;
  const outputDevice = `${sharedPrefix}output")`;
  const ctx = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function normalizeBridgeRegistryText('), source.indexOf('function serializeBridgeRegistryEntry(')), ctx);
  const inventory = ctx.sanitizeBridgeInventory({ devices: [
    { id: inputDevice, direction: 'input' }, { id: outputDevice, direction: 'output' },
  ] });
  assert.equal(inventory.devices[0].id, inputDevice);
  assert.equal(inventory.devices[1].id, outputDevice);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'talktome-bridge-device-id-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const run = script => execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const db = require('./src/server/dbHandler');
    const [inputDevice, outputDevice] = process.argv.slice(1);
    ${script}
  `, inputDevice, outputDevice], { env: { ...process.env, TALKTOME_DATA_DIR: dataDir } });
  run(`
    const user = Number(db.createUser('Port', 'test-password'));
    const feed = Number(db.createFeed('Feed', 'test-password'));
    const route = { enabled: true, bridgeDevice: 'bridge-test', inputDevice, inputLeftChannel: 1, inputRightChannel: 1 };
    db.updateUserBridgeEndpoint(user, { ...route, outputDevice, outputLeftChannel: 2, outputRightChannel: 2 });
    db.updateFeedBridgeEndpoint(feed, route);
  `);
  run(`
    const [user] = db.getBridgeEndpointsForDevice('bridge-test');
    const [feed] = db.getFeedBridgeEndpointsForDevice('bridge-test');
    assert.equal(user.input_device, inputDevice);
    assert.equal(user.output_device, outputDevice);
    assert.equal(feed.input_device, inputDevice);
  `);
});

test('port diagnostics sanitize remote values and distinguish intentional silence from missing devices', () => {
  const row = { bridge_input_device: 'bridge:none', bridge_output_device: 'speaker', bridge_output_left_channel: 1, bridge_output_right_channel: 2 };
  const bridge = { inventory: { devices: [{ id: 'speaker', direction: 'output', max_channels: 2 }] } };
  assert.deepEqual(endpointIssues(row, bridge, 'user'), []);
  assert.deepEqual(endpointIssues({ ...row, bridge_input_device: 'unplugged' }, bridge, 'user'), ['input device missing']);
  assert.deepEqual(endpointIssues({ bridge_input_device: 'bridge:none' }, bridge, 'feed'), []);
  const report = sanitizePortReport({ error: 'a'.repeat(2000), input: { rmsDb: NaN, peakDb: 999 } });
  assert.equal(report.error.length, 1000);
  assert.equal(report.input.rmsDb, -120);
  assert.equal(report.input.peakDb, 40);
});

function fixture() {
  const routes = new Map(), registry = new Map([['bridge-1', { lastSeenAtMs: Date.now() }]]);
  const reports = new Map(), tones = new Map();
  const ports = [{ kind: 'user', userId: 7 }, { kind: 'feed', feedId: 9 }];
  const saved = [];
  const ctx = vm.createContext({
    app: Object.fromEntries(['get','post','put'].map(method => [method, (path, ...handlers) => routes.set(`${method} ${path}`, handlers.at(-1))])),
    requireAdmin() {}, requireBridgeApiAuth() {}, canBridgeAuthAccessBridge: (auth,id) => auth === id,
    bridgeRegistry: registry, bridgePortReports: reports, bridgeTestTones: tones,
    buildBridgeRuntimeConfig: () => ({ ports }), sanitizePortReport, normalizeClientDeviceStatus: require('../src/server/clientDeviceStatus').normalizeClientDeviceStatus,
    getUserById: id => id === 7 ? { id, bridge_enabled: true, bridge_device: 'bridge-1' } : null,
    getAllFeeds: () => [{ id:9, bridge_enabled: true, bridge_device: 'bridge-1' }],
    getBridgePortAudioLevels: () => ({ input: { gainDb: 0, muted:false } }),
    updateBridgePortAudioLevel: (...args) => { saved.push(args); return {}; },
    buildBridgePortStatus: () => ({}), touchBridgePresence() {}, disconnectBridge() {},
    BRIDGE_REGISTRY_STALE_MS: 15000, scheduleAdminStatusBroadcast() {},
  });
  vm.runInContext(source.slice(source.indexOf("app.post('/api/v1/bridge/:bridgeId/status'"), source.indexOf('app.get("/api/v1/bridge/:bridgeId/config"')), ctx);
  const call = (route, req) => {
    const res = { code:200, status(n) { this.code=n;return this; }, sendStatus(n) { this.code=n;return this; }, json(body) { this.body=body;return this; } };
    routes.get(route)(req,res);return res;
  };
  return { call, tones, reports, registry, saved };
}

test('Bridge reports are scoped to its assigned ports and cannot revive a disconnected instance', () => {
  const f = fixture(); const route = 'post /api/v1/bridge/:bridgeId/status';
  const req = { params:{bridgeId:'bridge-1'}, bridgeApiAuth:'bridge-1', body:{ports:{'user:7':{error:'input unavailable'},'feed:9':{state:'Connected'},'user:99':{error:'spoof'}}} };
  assert.equal(f.call(route,{...req,bridgeApiAuth:'other'}).code,403);
  assert.equal(f.call(route,req).code,200);
  assert.equal(f.reports.size,2); assert.equal(f.reports.get('user:7').status.error,'input unavailable');
  f.registry.get('bridge-1').disconnected=true;
  assert.equal(f.call(route,req).code,410);
});

test('admin tone validation rejects arbitrary frequencies and offline starts, but always allows stop', () => {
  const f=fixture();const route='put /admin/bridge/ports/:kind/:id/tone';
  const req={params:{kind:'user',id:'7'},body:{frequency:400}};
  assert.equal(f.call(route,req).code,200);assert.equal(f.tones.get('bridge-1:user:7'),400);
  assert.equal(f.call(route,{...req,body:{frequency:123}}).code,400);
  f.registry.get('bridge-1').lastSeenAtMs=0;
  assert.equal(f.call(route,{...req,body:{frequency:1000}}).code,409);
  assert.equal(f.call(route,{...req,body:{frequency:0}}).code,200);assert.equal(f.tones.size,0);
  assert.equal(f.call(route,{...req,params:{kind:'user',id:'99'}}).code,404);
});

test('port status stays attached to its endpoint and Quit clears only that Bridge immediately', () => {
  const registry=new Map([['bridge-1',{id:'bridge-1',lastSeenAtMs:Date.now(),inventory:{devices:[]}}],['bridge-2',{id:'bridge-2',lastSeenAtMs:Date.now()}]]);
  const reports=new Map([['user:7',{bridgeId:'bridge-1',at:Date.now(),status:{error:'Input format unsupported',input:{rmsDb:-18}}}]]);
  const tones=new Map([['bridge-1:user:7',400],['bridge-2:feed:9',1000]]);
  const sessions=new Map([['a',{id:'a',bridgeId:'bridge-1'}],['b',{id:'b',bridgeId:'bridge-2'}]]);
  const closed=[];
  const ctx=vm.createContext({bridgeRegistry:registry,bridgePortReports:reports,bridgeTestTones:tones,bridgeControlSessions:sessions,
    endpointIssues,BRIDGE_REGISTRY_STALE_MS:15000,clearTimeout,setTimeout,
    serializeBridgeRegistryEntry:(entry,now)=>({...entry,stale:now-entry.lastSeenAtMs>15000}),
    closeBridgeControlSession:id=>closed.push(id),scheduleAdminStatusBroadcast() {},
  });
  vm.runInContext(source.slice(source.indexOf('function buildBridgePortStatus('),source.indexOf('const BROWSER_MEDIA_STATS_STALE_MS')),ctx);
  const status=ctx.buildBridgePortStatus({id:7,bridge_enabled:true,bridge_device:'bridge-1',bridge_input_device:'bridge:none',bridge_output_device:'bridge:none'},'user');
  assert.equal(status.error,'Input format unsupported');assert.equal(status.input.rmsDb,-18);assert.equal(status.issues.length,0);
  ctx.disconnectBridge('bridge-1');
  assert.deepEqual(closed,['a']);assert.equal(registry.get('bridge-1').disconnected,true);
  assert.equal(tones.has('bridge-1:user:7'),false);assert.equal(tones.has('bridge-2:feed:9'),true);
  ctx.touchBridgePresence('bridge-1');assert.equal(registry.get('bridge-1').lastSeenAtMs,0);
});

test('local Bridge test tone is restricted to its own assigned ports', () => {
  const f=fixture();const route='put /api/v1/bridge/:bridgeId/ports/:kind/:id/tone';
  const req={params:{bridgeId:'bridge-1',kind:'user',id:'7'},bridgeApiAuth:'bridge-1',body:{frequency:1000}};
  assert.equal(f.call(route,req).code,200);assert.equal(f.tones.get('bridge-1:user:7'),1000);
  assert.equal(f.call(route,{...req,bridgeApiAuth:'other'}).code,403);
  assert.equal(f.call(route,{...req,params:{...req.params,id:'99'}}).code,404);
  assert.equal(f.call(route,{...req,body:{frequency:50}}).code,400);
  assert.equal(f.call(route,{...req,body:{frequency:0}}).code,200);assert.equal(f.tones.size,0);
});

test('Bridge network reports are authenticated and keep the connection type without guessing', () => {
  const f=fixture();const route='post /api/v1/bridge/:bridgeId/status';
  const req={params:{bridgeId:'bridge-1'},bridgeApiAuth:'bridge-1',body:{deviceStatus:{networkType:'wifi'}}};
  assert.equal(f.call(route,{...req,bridgeApiAuth:'other'}).code,403);
  assert.equal(f.registry.get('bridge-1').deviceStatus,undefined);
  assert.equal(f.call(route,req).code,200);
  assert.equal(f.registry.get('bridge-1').deviceStatus.status.networkType,'wifi');
});

test('admin diagnostics show the detailed missing-device error once and retain other problems', () => {
  const admin=fs.readFileSync('public/admin.js','utf8');const ctx=vm.createContext({});
  vm.runInContext(admin.slice(admin.indexOf('function bridgePortProblems('),admin.indexOf('function statusIndicatorHtml(')),ctx);
  const error='Input device missing: omt:recv:6d614cf679d9bfb2';
  assert.deepEqual(Array.from(ctx.bridgePortProblems({error,issues:['input device missing','output device missing']})),[error,'output device missing']);
  assert.deepEqual(Array.from(ctx.bridgePortProblems({error:'Input device missing',issues:['input device missing']})),['Input device missing']);
  assert.deepEqual(Array.from(ctx.bridgePortProblems({error:'Audio format unsupported',issues:['input device missing']})),['Audio format unsupported','input device missing']);
});
