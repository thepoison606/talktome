const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const server = fs.readFileSync('serverCore.js', 'utf8');
const start = server.indexOf('function getFreshBridgeNetworkStats(');
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
