const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../src/server/serverCore'), 'utf8');

function fixture(kind) {
  const target = { id: 7, name: 'Before' };
  const events = new Map();
  const peers = new Map();
  for (const [key, fields] of Object.entries({
    renamed: { kind, userId: 7, feedId: 7 },
    otherProduction: { kind: 'user', userId: 8, productionId: 20 },
    secondSession: { kind, userId: 7, feedId: 7 },
    guest: { kind: 'guest', guestProfileUserId: 7, name: 'Visitor', productionId: 30 },
    otherKind: { kind: kind === 'user' ? 'feed' : 'user', userId: 7, feedId: 7 },
  })) {
    events.set(key, []);
    peers.set(key, { name: 'Before', ...fields, socket: { emit: (...args) => events.get(key).push(args) } });
  }
  const routes = new Map(), companion = [], panels = [], reasons = [], lists = [];
  let outcome = true;
  const update = (_id, name) => {
    if (outcome instanceof Error) throw outcome;
    if (outcome) target.name = name.trim();
    return outcome;
  };
  const context = {
    app: { put: (path, _auth, handler) => routes.set(path, handler) }, requireAdmin() {},
    updateUserName: update, updateFeedName: update,
    getUserById: () => target, getFeedById: () => target, peers,
    isOperatorPeer: peer => ['user', 'guest'].includes(peer.kind),
    getCompanionAddressableUsers: () => [{ id: 7 }, { id: 8 }],
    emitCompanionEvent: (...args) => companion.push(args),
    remotePanels: { publish: id => panels.push(id) },
    emitUserListToOperators: () => lists.push([...peers.values()].map(peer => peer.name)),
    broadcastRuntimeUserStates: reason => reasons.push(reason),
  };
  const helperStart = source.indexOf('function notifyTargetRenamed(');
  vm.runInNewContext(source.slice(helperStart, source.indexOf('function notifyTargetChange(', helperStart)), context);
  const routeStart = source.indexOf(`app.put(${kind === 'user' ? '"/users/:id"' : "'/feeds/:id'"}`);
  const routeEnd = source.indexOf('\napp.put(', routeStart + 1);
  vm.runInNewContext(source.slice(routeStart, routeEnd), context);
  function rename(name = 'After') {
    const res = { code: null, status(code) { this.code = code; return this; }, json() {}, sendStatus(code) { this.code = code; } };
    routes.get(kind === 'user' ? '/users/:id' : '/feeds/:id')({ params: { id: '7' }, body: { name } }, res);
    return res.code;
  }
  return { rename, peers, events, companion, panels, reasons, lists, setOutcome: next => { outcome = next; } };
}

for (const kind of ['user', 'feed']) {
  test(`${kind} rename refreshes operator sessions across productions, guests, panels and companions`, () => {
    const f = fixture(kind);
    assert.equal(f.rename('  After  '), 204);
    assert.equal(f.peers.get('renamed').name, 'After');
    assert.equal(f.peers.get('secondSession').name, 'After');
    assert.equal(f.peers.get('otherKind').name, 'Before');
    assert.equal(f.peers.get('guest').name, 'Visitor');
    for (const [key, peer] of f.peers) {
      assert.equal(f.events.get(key).length, ['user', 'guest'].includes(peer.kind) ? 1 : 0);
      if (f.events.get(key).length) assert.deepEqual(f.events.get(key)[0], ['user-targets-updated']);
    }
    assert.deepEqual(f.panels, [7, 8]);
    assert.deepEqual(f.companion.map(([event, payload]) => [event, payload.userId]), [['user-targets-updated', 7], ['user-targets-updated', 8]]);
    assert.deepEqual(f.reasons, [`${kind}-renamed`]);
    assert.equal(f.lists[0][0], 'After');
  });

  test(`${kind} rename does not announce missing or conflicting targets`, () => {
    for (const [outcome, status] of [[false, 404], [new Error('UNIQUE constraint failed'), 409]]) {
      const f = fixture(kind);
      f.setOutcome(outcome);
      assert.equal(f.rename(), status);
      assert.equal(f.peers.get('renamed').name, 'Before');
      assert.equal([...f.events.values()].flat().length, 0);
      assert.equal(f.companion.length, 0);
      assert.equal(f.panels.length, 0);
      assert.equal(f.lists.length, 0);
    }
  });
}
