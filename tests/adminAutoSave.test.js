const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../public/adminAutoSave');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('autosave serializes writes and coalesces newer edits without applying stale responses', async () => {
  const writes = [], applied = [], release = [];
  const saver = create({ savedMs: 0, render() {},
    save: (key, value) => { writes.push([key, value]); return new Promise(resolve => release.push(resolve)); },
    onSaved: (key, value) => applied.push([key, value]),
  });
  saver.request('settings', () => 1);
  saver.request('settings', () => 2);
  saver.request('settings', () => 3);
  saver.request('tone', () => 400);
  assert.deepEqual(writes, [['settings', 1]]);
  release.shift()(); await tick();
  assert.deepEqual(applied, []);
  assert.deepEqual(writes[1], ['settings', 3]);
  release.shift()(); await tick();
  release.shift()(); await tick();
  assert.deepEqual(applied, [['settings', 3], ['tone', 400]]);
  assert.equal(saver.busy, false);
});

test('failed writes retain a retry that reads the latest input', async () => {
  let value = 2, fail = true, feedback, writes = [];
  const saver = create({ savedMs: 0, render: (text, retry) => { feedback = { text, retry }; },
    save: async (_key, input) => { writes.push(input); if (fail) throw new Error('Offline'); },
  });
  saver.request('gain', () => value); await tick();
  assert.equal(saver.hasError('gain'), true);
  assert.match(feedback.text, /Offline/);
  value = 4; fail = false; feedback.retry(); await tick();
  assert.deepEqual(writes, [2, 4]);
  assert.equal(saver.hasError('gain'), false);
});

test('invalid edits cancel queued values and do not get cleared by an older successful write', async () => {
  let release;
  const writes = [];
  const saver = create({ savedMs: 0, render() {}, save: (_key, value) => {
    writes.push(value); return new Promise(resolve => { release = resolve; });
  } });
  saver.request('route', () => 'old');
  saver.request('route', () => 'queued');
  saver.request('route', () => { throw new Error('Choose a channel'); });
  release(); await tick();
  assert.deepEqual(writes, ['old']);
  assert.equal(saver.hasError('route'), true);
});
