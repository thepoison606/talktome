const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('public/client.js', 'utf8');
function setup() {
  const storage = new Map();
  const context = vm.createContext({
    session: { kind: 'user', productionId: '1' },
    getOperatorProfileUserId: () => 7,
    clientLocalStorage: { getItem: key => storage.get(key) },
    lastTarget: { type: 'user', id: 9, label: 'Reply user' },
    buildTalkTargetDescriptors: () => [
      { kind: 'reply', identity: 'reply' },
      { kind: 'target', identity: 'conference:2', target: { type: 'conference', id: 2 }, label: 'All' },
    ],
  });
  for (const name of ['getMainButtonStorageKey', 'getConfiguredMainButtonIdentity', 'getMainButtonTarget']) {
    const start = source.indexOf(`  function ${name}(`);
    const end = source.indexOf('\n  }', start) + 4;
    assert.ok(start >= 0 && end > start);
    vm.runInContext(source.slice(start, end), context);
  }
  return { context, storage };
}

test('main button defaults to dynamic reply', () => {
  const { context } = setup();
  assert.equal(context.getMainButtonTarget().id, 9);
  context.lastTarget = null;
  assert.equal(context.getMainButtonTarget(), null);
});

test('configured main target is independent of incoming reply', () => {
  const { context, storage } = setup();
  storage.set(context.getMainButtonStorageKey(), 'conference:2');
  context.lastTarget = null;
  assert.equal(context.getMainButtonTarget().id, 2);
  assert.equal(context.getMainButtonTarget().label, 'All');
});

test('removed or unauthorized target never falls back to another recipient', () => {
  const { context, storage } = setup();
  storage.set(context.getMainButtonStorageKey(), 'conference:99');
  assert.equal(context.getMainButtonTarget(), null);
});

test('main button choice is scoped by profile and production', () => {
  const { context, storage } = setup();
  storage.set(context.getMainButtonStorageKey(), 'conference:2');
  context.session.productionId = '2';
  assert.equal(context.getMainButtonTarget().id, 9);
  context.session.productionId = '1';
  assert.equal(context.getMainButtonTarget().id, 2);
  context.session.kind = 'guest';
  assert.equal(context.getMainButtonTarget().id, 9);
});

test('unavailable browser storage preserves reply mode', () => {
  const { context } = setup();
  context.clientLocalStorage.getItem = () => { throw new Error('denied'); };
  assert.equal(context.getMainButtonTarget().id, 9);
});
