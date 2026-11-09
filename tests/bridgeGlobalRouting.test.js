const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = require('./helpers/projectRoot');
const { canRouteTargetBetweenPeers } = require('../src/server/productionRouting');
const source = fs.readFileSync(path.join(root, 'src/server/serverCore.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function load(context, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert(a >= 0 && b > a);
  vm.runInContext(source.slice(a, b), context);
}

test('Bridge routes are global, projected read-only, and never overwrite manual membership', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talktome-global-bridge-'));
  try {
    execFileSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const db = require('./src/server/dbHandler');
      const raw = require('./src/server/db');
      const wire = Number(db.createUser('Wire', 'test-password'));
      const bob = Number(db.createUser('Bob', 'test-password'));
      const remote = Number(db.createUser('Remote only', 'test-password'));
      const conf = Number(db.createConference('Global conference'));
      const first = db.createProduction('First'), second = db.createProduction('Second');
      for (const p of [first, second]) { db.setProductionUser(p, wire); db.setProductionConference(p, conf); }
      db.setProductionUser(first, bob);
      db.addProductionTarget(first, wire, 'user', bob);
      db.setProductionConferenceListenOnly(first, wire, conf);
      // No matrix membership is required to select a global Bridge destination.
      const targets = [{type:'conference',id:conf},{type:'user',id:bob},{type:'user',id:remote}];
      assert(db.getBridgeTargetsForUser(wire).some(t => t.targetId === remote && t.targetType === 'user'));
      assert(!db.getBridgeTargetsForUser(wire).some(t => t.targetType === 'user' && t.targetId === wire));
      db.updateUserBridgeEndpoint(wire, {enabled:true,bridgeDevice:'wire',triggerMode:'always-on',triggerTargets:targets});
      const one = db.getProductionTargets(wire, first), two = db.getProductionTargets(wire, second);
      assert.equal(one.find(t => t.targetType === 'conference').canTalk, true);
      assert.equal(one.find(t => t.targetType === 'conference').manualAssigned, true);
      assert.equal(two.find(t => t.targetType === 'conference').manualAssigned, false);
      assert(two.every(t => t.bridgeManaged));
      assert(!two.some(t => t.targetType === 'user')); // Never add entities to other productions.
      assert.equal(raw.prepare('SELECT can_talk FROM production_user_conference WHERE production_id=? AND user_id=?').get(first,wire).can_talk,0);
      assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM production_user_conference WHERE production_id=? AND user_id=?').get(second,wire).n,0);
      assert.throws(() => db.removeProductionTarget(first,wire,'user',bob), e => e.statusCode === 409);
      assert.throws(() => db.setProductionConferenceListenOnly(second,wire,conf), /Configured by Bridge/);
      assert.throws(() => db.removeProductionConferenceMembership(second,wire,conf), /Configured by Bridge/);
      assert(db.getAllConfiguredUsersForConference(conf).some(u => u.id === wire));
      assert(db.getBridgePanelTargetsForUser(wire).some(t => t.targetId === remote && t.targetType === 'user'));
      db.mergeUserTargetAudioStates(wire,[{targetType:'conference',targetId:conf,muted:true,volume:0.4}]);
      assert(db.getUserTargetAudioStates(wire).some(t => t.targetType==='conference' && t.targetId===conf && t.muted));
      const snapshot = db.exportDatabaseSnapshot(); db.importDatabaseSnapshot(snapshot);
      assert.equal(db.getConfiguredBridgeTargetsForUser(wire).length,3);
      db.updateUserBridgeEndpoint(wire,{enabled:true,bridgeDevice:'wire',triggerMode:'external',triggerTargets:targets});
      assert.equal(db.getConfiguredBridgeTargetsForUser(wire).length,0);
      assert.equal(db.getProductionTargets(wire,first).find(t => t.targetType==='conference').canTalk,false);
      assert(db.getProductionTargets(wire,first).some(t => t.targetType==='user' && t.targetId===bob));
      assert.equal(db.getProductionTargets(wire,second).length,0);
      db.updateUserBridgeEndpoint(wire,{enabled:true,bridgeDevice:'wire',triggerMode:'audio-level',triggerTargets:targets});
      db.deleteUser(remote); db.deleteConference(conf);
      assert.deepEqual(db.getConfiguredBridgeTargetsForUser(wire).map(t=>t.targetId),[bob]);
      db.updateUserBridgeEndpoint(wire,{enabled:false});
      assert.equal(db.getConfiguredBridgeTargetsForUser(wire).length,0);
    `], { cwd: root, env: { ...process.env, TALKTOME_DATA_DIR: dir }, stdio: 'pipe' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('actual recipient routing supports cross-production replies, global Bridge return audio and one delivery per listener', () => {
  const alice = {kind:'user',userId:1,productionId:11,name:'Alice'};
  const bob = {kind:'user',userId:2,productionId:22,name:'Bob'};
  const wire = {kind:'user',userId:3,productionId:null,isBridgePeer:true};
  const peers = new Map([['alice',alice],['bob',bob],['wire',wire]]);
  const context = vm.createContext({ peers, Map, Set, Number, String,
    areMultipleProductionsEnabled: () => true, canRouteTargetBetweenPeers,
    getProductionsForUser: () => [], getProductionConferencesForUser: () => [],
    getConfiguredBridgeTargetsForUser: () => [{targetType:'conference',targetId:7,name:'Wire bus'}],
    getEffectiveConferencesForUser: () => [{id:7,canTalk:true}],
    getProductionTargets: () => [{targetType:'conference',targetId:7,canTalk:true}],
    findUserPeerByUserId: id => [...peers].map(([socketId,peer])=>({socketId,peer})).find(x=>x.peer.userId===Number(id)),
    normalizeRuntimeTalkTargets: targets => targets,
  });
  load(context,'function getEffectiveConferencesForPeer(', 'function getEffectiveFeedIdsForPeer(');
  load(context,'function isOperatorPeer(', 'function findGuestPeerByGuestId(');
  load(context,'function isPeerMemberOfConference(', 'function buildSpeakerReplyTarget(');
  load(context,'function buildSpeakerReplyTarget(', 'function buildAddressedEntry(');
  load(context,'function resolveProducerRecipientDeliveriesForTargets(', 'function resolveProducerRecipientDeliveries(');
  const deliver = (speaker,targets) => plain(context.resolveProducerRecipientDeliveriesForTargets({speakerSocketId:speaker,targets}));
  assert.equal(deliver('alice',[{type:'user',id:2}])[0].recipientSocketId,'bob');
  const reply = plain(context.buildSpeakerReplyTarget(alice,{type:'user',id:2}));
  assert.deepEqual(reply,{replyTargetType:'user',replyTargetId:1});
  assert.equal(deliver('bob',[{type:reply.replyTargetType,id:reply.replyTargetId}])[0].recipientSocketId,'alice');
  assert(deliver('alice',[{type:'conference',id:7}]).some(x=>x.recipientSocketId==='wire'));
  assert.equal(deliver('wire',[{type:'user',id:2},{type:'conference',id:7}]).filter(x=>x.recipientSocketId==='bob').length,1);
});

test('saving global Bridge targets through either API refreshes live routing and old/new conference membership', () => {
  const handlers = new Map(), events = [];
  let targets;
  const context = vm.createContext({
    app: { put: (route, _auth, handler) => handlers.set(route, handler) },
    requireAdmin() {}, requireBridgeApiAuth() {},
    normalizeBridgeId: id => id, canBridgeAuthAccessBridge: () => true,
    getUserById: id => ({ id }),
    getConfiguredBridgeTargetsForUser: () => targets,
    updateUserBridgeEndpoint: (id, body) => {
      assert.equal(id, 5);
      targets = body.triggerTargets.map(t => ({ targetType:t.type, targetId:t.id }));
      return true;
    },
    notifyTargetChange: id => events.push(['targets', id]),
    notifyConferenceMembersChanged: id => events.push(['conference', id]),
    scheduleAdminStatusBroadcast: event => events.push(['status', event]),
    buildBridgeRuntimeConfig: () => ({ ports: [] }),
    console,
  });
  load(context, 'function notifyBridgeTargetsChanged(', 'function notifyTargetChange(');
  load(context, 'app.put("/api/v1/bridge/:bridgeId/ports/:kind/:id",', 'app.post("/api/v1/bridge/sessions",');
  load(context, "app.put('/users/:id/bridge-endpoint',", "app.put('/feeds/:id/bridge-endpoint',");
  for (const [route, handler] of handlers) {
    events.length = 0;
    targets = [{targetType:'conference',targetId:7}];
    let status = 200;
    handler({ params: {id:'5',kind:'user',bridgeId:'wire'},
      body:{triggerTargets:[{type:'conference',id:9}]} }, {
      status(code) { status=code; return this; },
      sendStatus(code) { status=code; }, json() {},
    });
    assert(status === 200 || status === 204, route);
    assert.deepEqual(events, [
      ['targets',5], ['conference',7], ['conference',9], ['status','bridge-endpoint-updated'],
    ], route);
  }
});
