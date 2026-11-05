const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = require('./helpers/projectRoot');
const source = fs.readFileSync(path.join(root, 'public/client.js'), 'utf8');
const start = source.indexOf('  function emitRegisterUser(');
const end = source.indexOf('  let activeRegistrationPromise', start);
assert(start >= 0 && end > start);

function registration({ sessionKind = 'anonymous', response } = {}) {
  const permissions = [], requests = [];
  const context = vm.createContext({
    setTimeout, clearTimeout, remotePanel: null,
    session: { kind: sessionKind },
    feedVideo: { setAllowed: value => permissions.push(value) },
    socket: { emit(event, payload, acknowledge) { requests.push({ event, payload }); acknowledge(response); } },
  });
  vm.runInContext(source.slice(start, end), context);
  return { permissions, requests, run: payload => context.emitRegisterUser(payload) };
}

test('fresh feed login applies video permission before the anonymous session is replaced', async () => {
  const h = registration({ response: { ok: true, allowFeedVideo: true } });
  await h.run({ kind: 'feed', id: '7', name: 'PGM' });
  assert.deepEqual(h.permissions, [true]);
  assert.equal(h.requests[0].payload.feedVideo, true);
});

test('feed reconnection applies permission changes, including explicit denial', async () => {
  const h = registration({ sessionKind: 'feed', response: { ok: true, allowFeedVideo: false } });
  await h.run({ kind: 'feed', id: '7' });
  assert.deepEqual(h.permissions, [false]);
});

test('failed feed login and operator registration do not change feed publishing permission', async () => {
  for (const [payload, response] of [
    [{ kind: 'feed', id: '7' }, { error: 'Access denied' }],
    [{ kind: 'user', id: '1' }, { ok: true, allowFeedVideo: false }],
  ]) {
    const h = registration({ response });
    await h.run(payload);
    assert.deepEqual(h.permissions, []);
  }
});
