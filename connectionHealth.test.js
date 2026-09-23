const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConnectionHealth } = require('./public/connectionHealth');

function setup() {
  let time = 0;
  let tick;
  const replies = [];
  const changes = [];
  const socket = {
    connected: true,
    get volatile() { return this; },
    timeout(ms) { assert.equal(ms, 2000); return this; },
    emit(event, callback) {
      assert.equal(event, 'connection-health');
      replies.push(callback);
    },
  };
  const health = createConnectionHealth(socket, (value) => changes.push(value), {
    now: () => time,
    schedule(callback, delay) { assert.equal(delay, 500); tick = callback; return 1; },
    cancel() { tick = null; },
  });
  return { health, socket, replies, changes, advance(ms) { time += ms; tick?.(); } };
}

test('silent loss warns after two seconds, once, and a fresh reply clears it', () => {
  const f = setup();
  f.health.start();
  f.replies[0](null, true);
  for (let i = 0; i < 3; i++) f.advance(500);
  assert.deepEqual(f.changes, []);
  f.advance(500);
  assert.deepEqual(f.changes, [true]);
  f.advance(500);
  assert.deepEqual(f.changes, [true]);
  f.replies.at(-1)(null, true);
  assert.deepEqual(f.changes, [true, false]);
  f.advance(2000);
  assert.deepEqual(f.changes, [true, false, true]);
});

test('healthy replies keep the connection healthy indefinitely', () => {
  const f = setup();
  f.health.start();
  for (let i = 0; i < 100; i++) {
    f.replies.at(-1)(null, true);
    f.advance(500);
  }
  assert.deepEqual(f.changes, []);
});

test('expired, failed and invalid replies cannot clear the warning', () => {
  const f = setup();
  f.health.start();
  f.advance(2000);
  f.replies[0](null, true);
  f.replies.at(-1)(new Error('timeout'));
  f.replies.at(-1)(null, false);
  assert.deepEqual(f.changes, [true]);
});

test('stop cancels polling and replies from an earlier connection are ignored', () => {
  const f = setup();
  f.health.start();
  const previousReply = f.replies[0];
  f.socket.connected = false;
  f.health.stop();
  f.advance(500);
  assert.equal(f.replies.length, 1);
  f.socket.connected = true;
  f.health.start();
  f.advance(1500);
  previousReply(null, true);
  f.advance(500);
  assert.deepEqual(f.changes, [true]);
  f.replies.at(-1)(null, true);
  assert.deepEqual(f.changes, [true, false]);
});
