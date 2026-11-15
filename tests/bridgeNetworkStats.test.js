const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const server = fs.readFileSync('src/server/serverCore.js', 'utf8');
const start = server.indexOf('function isFreshBridgeNetworkMetric(');
const end = server.indexOf('function buildAdminStatusTalkTargets(', start);
const bridgeControlSessions = new Map();
const context = vm.createContext({ bridgeControlSessions, BRIDGE_NETWORK_STATS_STALE_MS: 30_000 });
vm.runInContext(server.slice(start, end), context);

test('Bridge status aggregates only fresh session stats and weights loss by packet count', () => {
  const now = Date.now();
  bridgeControlSessions.clear();
  bridgeControlSessions.set('a', {
    bridgeId: 'bridge-1',
    networkStats: { roundTripMs: 20, packetsReceived: 90, packetsLost: 10, reportedAt: now },
  });
  bridgeControlSessions.set('b', {
    bridgeId: 'bridge-1',
    networkStats: { roundTripMs: 40, packetsReceived: 900, packetsLost: 0, reportedAt: now },
  });
  bridgeControlSessions.set('stale', {
    bridgeId: 'bridge-1',
    networkStats: { roundTripMs: 999, packetsReceived: 1, packetsLost: 99, reportedAt: now - 31_000 },
  });
  bridgeControlSessions.set('other', {
    bridgeId: 'bridge-2',
    networkStats: { roundTripMs: 500, packetsReceived: 1, packetsLost: 99, reportedAt: now },
  });

  const aggregate = context.getBridgeAggregateNetworkStats('bridge-1', now);
  assert.equal(aggregate.roundTripMs, 30);
  assert.equal(aggregate.packetLossPercent, 1);
  assert.equal(context.getFreshBridgeNetworkStats(bridgeControlSessions.get('stale'), now), null);
});

test('Bridge input RTP stats ignore negative loss corrections encoded as unsigned integers', async () => {
  const peer = {
    producers: new Map([['audio', {
      kind: 'audio',
      closed: false,
      getStats: async () => [{ type: 'inbound-rtp', packetCount: 100, packetsLost: 4294967281 }],
    }]]),
  };
  const stats = await context.collectBridgeInputPacketStats(peer);
  assert.equal(stats.packetsReceived, 100);
  assert.equal(stats.packetsLost, 0);
});

test('signed RTP loss corrections still produce a usable zero-loss measurement', async () => {
  const peer = {
    producers: new Map([['audio', {
      kind: 'audio', closed: false,
      getStats: async () => [{ type: 'inbound-rtp', packetCount: 100, packetsLost: -15 }],
    }]]),
  };
  const packetStats = await context.collectBridgeInputPacketStats(peer);
  assert.equal(packetStats.packetsReceived, 100);
  assert.equal(packetStats.packetsLost, 0);
  const session = {};
  context.recordBridgeNetworkStats(session, null, packetStats);
  assert.equal(context.getFreshBridgeNetworkStats(session).packetLossPercent, 0);
});

test('native and WebView heartbeats retain each metric only until its own measurement expires', () => {
  const now = Date.now();
  const session = { bridgeId: 'bridge-1' };
  bridgeControlSessions.clear();
  bridgeControlSessions.set('a', session);
  context.recordBridgeNetworkStats(session, { roundTripMs: 4 }, { packetsReceived: 99, packetsLost: 1 }, now);
  // Older native clients omit networkStats while their health reporter keeps running.
  context.recordBridgeNetworkStats(session, null, { packetsReceived: 199, packetsLost: 1 }, now + 10_000);
  assert.equal(context.getFreshBridgeNetworkStats(session, now + 10_000).roundTripMs, 4);
  assert.equal(context.getBridgeAggregateNetworkStats('bridge-1', now + 10_000).roundTripMs, 4);
  context.recordBridgeNetworkStats(session, null, { packetsReceived: 299, packetsLost: 1 }, now + 31_000);
  assert.equal(context.getFreshBridgeNetworkStats(session, now + 31_000).roundTripMs, null);
  assert.equal(context.getBridgeAggregateNetworkStats('bridge-1', now + 31_000).roundTripMs, null);
  assert.equal(context.getFreshBridgeNetworkStats(session, now + 31_000).packetLossPercent, 0.3);
  // A network measurement must not extend the lifetime of the last audio measurement.
  context.recordBridgeNetworkStats(session, { roundTripMs: 7 }, null, now + 62_000);
  assert.equal(context.getFreshBridgeNetworkStats(session, now + 62_000).roundTripMs, 7);
  assert.equal(context.getFreshBridgeNetworkStats(session, now + 62_000).packetLossPercent, null);
  assert.equal(context.getBridgeAggregateNetworkStats('bridge-1', now + 62_000).packetLossPercent, null);
});

test('a bridge without audio packets does not claim zero packet loss', () => {
  const session = {};
  context.recordBridgeNetworkStats(session, { roundTripMs: 4 }, { packetsReceived: 0, packetsLost: 0 });
  assert.equal(context.getFreshBridgeNetworkStats(session).packetLossPercent, null);
});

test('missing Bridge network values render as unavailable', () => {
  const admin = fs.readFileSync('public/admin.js', 'utf8');
  const formatStart = admin.indexOf('function formatStatusLatency(');
  const formatEnd = admin.indexOf('function syncStopTransmissionButtons(', formatStart);
  const formatters = vm.createContext({});
  vm.runInContext(admin.slice(formatStart, formatEnd), formatters);
  assert.equal(formatters.formatStatusLatency({ roundTripMs: null }), '-');
  assert.equal(formatters.formatStatusPacketLoss({ packetLossPercent: null }), '-');
  assert.equal(formatters.formatStatusLatency({ roundTripMs: 24.8 }), '25 ms');
  assert.equal(formatters.formatStatusPacketLoss({ packetLossPercent: 1.25 }), '1.3%');
});

test('an idle Bridge port displays its own instance loss without borrowing another Bridge', () => {
  const now=Date.now();bridgeControlSessions.clear();
  const own={bridgeId:'bridge-1'};
  context.recordBridgeNetworkStats(own,{roundTripMs:4},null,now);
  const feed={bridgeId:'bridge-1'};
  context.recordBridgeNetworkStats(feed,{roundTripMs:8},{packetsReceived:99,packetsLost:1},now);
  bridgeControlSessions.set('own',own);bridgeControlSessions.set('feed',feed);
  const status=context.getBridgePortNetworkStats('bridge-1',own,now);
  assert.equal(status.roundTripMs,4);assert.equal(status.packetLossPercent,1);assert.equal(status.packetLossScope,'bridge');
  assert.equal(context.getBridgePortNetworkStats('bridge-2',own,now).packetLossPercent,null);
  context.recordBridgeNetworkStats(own,null,{packetsReceived:100,packetsLost:0},now);
  assert.equal(context.getBridgePortNetworkStats('bridge-1',own,now).packetLossScope,'port');
  assert.equal(context.getBridgePortNetworkStats('bridge-1',own,now).packetLossPercent,0);
});

test('receive-only ports count receiver-reported loss, not unacknowledged sent packets', async () => {
  const consumer=stats=>({kind:'audio',getStats:async()=>[stats]});
  const peer={consumers:new Map([['rx',consumer({type:'outbound-rtp',packetCount:100,packetsLost:3,roundTripTime:1})]])};
  const stats=await context.collectBridgeInputPacketStats(peer);
  assert.equal(stats.packetsReceived,97);assert.equal(stats.packetsLost,3);
  peer.consumers.set('rx',consumer({type:'outbound-rtp',packetCount:100,packetsLost:0,roundTripTime:0}));
  assert.equal(await context.collectBridgeInputPacketStats(peer),null);
});

test('Bridge endpoints expose the connection address and fresh network type',()=>{
  const {getBridgeRemoteAddress,getBridgeDeviceStatus}=require('../src/server/bridgeDeviceStatus');const now=Date.now();
  const bridge={remoteAddress:'127.0.0.1'};
  assert.equal(getBridgeRemoteAddress(bridge,null),'127.0.0.1');
  assert.equal(getBridgeDeviceStatus(bridge,null,now).networkType,'local');
  bridge.deviceStatus={status:{networkType:'wifi'},reportedAt:now};
  const session={remoteAddress:'192.168.178.166'};
  assert.equal(getBridgeRemoteAddress(bridge,session),'192.168.178.166');
  assert.equal(getBridgeDeviceStatus(bridge,session,now).networkType,'wifi');
  assert.equal(getBridgeDeviceStatus({...bridge,remoteAddress:'192.168.178.166'},session,now+31000),null);
});
