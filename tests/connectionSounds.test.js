const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConnectionSounds } = require('../public/connectionSounds');

test('connection sounds are cached, deduplicated and silent on initial connection', async () => {
  const played = [];
  let loads = 0;
  const ctx = {
    state: 'running', destination: {},
    decodeAudioData: async (bytes) => bytes,
    createBufferSource: () => ({ connect() {}, disconnect() {}, stop() {}, start() { played.push(this.buffer); } }),
  };
  const sounds = createConnectionSounds(() => ctx, async () => {
    loads++;
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
  });
  await sounds.prepare();
  sounds.reconnected();
  assert.equal(played.length, 0);
  sounds.disconnected();
  sounds.disconnected();
  assert.equal(played.length, 1);
  sounds.reconnected();
  sounds.reconnected();
  assert.equal(played.length, 2);
  assert.equal(loads, 2);
  ctx.state = 'suspended';
  sounds.disconnected();
  assert.equal(played.length, 2);
});

test('missing audio never breaks connection handling', async () => {
  const sounds = createConnectionSounds(() => null, async () => { throw new Error('offline'); });
  await sounds.prepare();
  sounds.disconnected();
  sounds.reconnected();
});

test('a later touch resumes an interrupted context without replaying stale sounds', async () => {
  let resumes = 0;
  let played = 0;
  let decodes = 0;
  const ctx = {
    state: 'suspended', destination: {},
    resume() { resumes++; this.state = 'running'; return Promise.resolve(); },
    async decodeAudioData(bytes) { decodes++; return bytes; },
    createBufferSource: () => ({
      connect() {}, disconnect() {}, stop() {}, start() { played++; },
    }),
  };
  const sounds = createConnectionSounds(() => ctx, async () => ({
    ok: true, arrayBuffer: async () => new ArrayBuffer(1),
  }));
  const first = sounds.prepare();
  assert.equal(resumes, 1, 'resume must run synchronously in the gesture');
  await Promise.all([first, sounds.prepare(), sounds.prepare()]);
  assert.equal(decodes, 2, 'overlapping touch/click events share decodes');
  ctx.state = 'interrupted';
  sounds.disconnected();
  assert.equal(played, 0);
  await sounds.prepare();
  assert.equal(resumes, 2);
  assert.equal(played, 0, 'no delayed loss announcement after the next touch');
  sounds.reconnected();
  assert.equal(played, 1);
  assert.equal(decodes, 2);
});
