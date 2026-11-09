const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../headless-client/src/web/assets/local-panel.js'), 'utf8');
function adapter(id = 'one') {
  const requests = [], events = new Map();
  const snapshot = {
    user_id: 84, user_name: 'Camera', production: '1', productions: [{ id: '1', name: 'Live' }],
    connection: 'ready', targets: [{ key: { User: 5 }, name: 'Director', can_talk: true, online: true, volume: .8, muted: false, members: [] },
      { key: { Conference: 7 }, name: 'Crew', can_talk: true, online: true, volume: .9, members: [{ user_id: 8, name: 'Camera 2', online: true }] },
      { key: { Feed: 9 }, name: 'PGM', can_talk: false, online: true, volume: 1, members: [] }],
    incoming: [], reply_target: { Conference: 7 }, reply_name: 'Crew',
  };
  const result = { ok: true, snapshot, report: { revision: 3, storage: {}, runtime: { targets: [], lockedTargets: [] } }, settings: {} };
  const window = { crypto: { randomUUID: () => id }, parent: {}, document: { addEventListener() {} },
    addEventListener(event, fn) { events.set(event, fn); } };
  const context = vm.createContext({ window, location: { origin: 'http://headless', hash: '' }, setInterval() {}, clearInterval() {},
    fetch: async (url, options) => { requests.push({ url, ...options, command: JSON.parse(options.body) }); return { ok: true, json: async () => result }; } });
  vm.runInContext(source, context);
  return { panel: window.TalktomeLocalPanel, requests, events, snapshot, result, window };
}
test('local adapter supplies the shared panel contract with offline gating and conference members', () => {
  const f = adapter();
  let state = f.panel.stateOf(f.result);
  assert.equal(state.name, 'Camera');
  assert.equal(state.online, true);
  assert.equal(state.targets[1].members[0].userId, 8);
  assert.equal(state.users.find(user => user.userId === 5).socketId, 'headless-user:5');
  assert.equal(state.activeFeedKeys[0], 'feed-9');
  assert.equal(state.targetAudioStates[0].volume, .8);
  assert.equal(state.incomingTalkState.replyTarget.targetId, 7);
  f.snapshot.server_not_responding = true;
  state = f.panel.stateOf(f.result);
  assert.equal(state.online, false);
});
test('local talk inputs are isolated per browser and are released when the admin tab is hidden', async () => {
  const one = adapter('one'), two = adapter('two');
  const command = { kind: 'talk', action: 'press', targetType: 'conference', targetId: 7, inputKey: 'main' };
  const send = f => new Promise(resolve => f.panel.socket.timeout(8000).emit('panel-command', command, (_, result) => resolve(result)));
  assert.equal((await send(one)).ok, true);
  await send(two);
  assert.notEqual(one.requests[0].command.inputKey, two.requests[0].command.inputKey);
  one.events.get('message')({ origin: 'http://headless', source: one.window.parent, data: { type: 'headless-panel-hidden' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(one.requests[1].command.action, 'release');
  assert.equal(one.requests[1].command.inputKey, one.requests[0].command.inputKey);
  assert.equal(one.requests[1].keepalive, true);
  assert.equal(two.requests.length, 1);
});
test('a normal release removes the pending hold so leaving the page does not release it twice', async () => {
  const f = adapter();
  const send = action => new Promise(resolve => f.panel.socket.emit('panel-command', { kind: 'talk', action, inputKey: 'main', targetType: 'user', targetId: 5 }, () => resolve()));
  await send('press'); await send('release');
  f.events.get('pagehide')();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].command.inputKey, f.requests[1].command.inputKey);
});
