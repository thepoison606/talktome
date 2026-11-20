const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const PROJECT_ROOT = require('./helpers/projectRoot');

const client = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'client.js'), 'utf8');
const bindTalkPointer = client.slice(client.indexOf('  function bindTalkPointer('), client.indexOf('  async function handleTalk('));

function bindButton({ tapToLockEnabled = true, locked = false, main = false, leftHand = false } = {}) {
  const callbacks = new Map();
  const events = [];
  const target = { type: 'conference', id: 1 };
  const activeTalkPointers = new Map();
  const button = {
    addEventListener(type, handler) { callbacks.set(type, handler); },
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  const selected = main && locked ? { type: 'conference', id: 2 } : target;
  vm.runInNewContext(`${bindTalkPointer}\nbindTalkPointer(button, button, () => selected, { reply: main });`, {
    button, selected, main, activeTalkPointers, tapToLockEnabled, remotePanel: null,
    isOperatorSession: () => true,
    isTalkTargetLocked: (value) => locked && value === target,
    getActiveTalkLockEntries: () => locked ? [{ target, button }] : [],
    resolveLiveTalkTarget: (value) => value,
    setReplyButtonActive() {},
    hasActiveTalkLocks: () => false,
    didReachSlideToLockThreshold: (x, start) => leftHand ? x - start >= 42 : start - x >= 42,
    handleTalk(event, pressedTarget) { activeTalkPointers.set(event.pointerId, pressedTarget); events.push('press'); },
    handleStopTalking(event) { activeTalkPointers.delete(event.pointerId); events.push('release'); },
    activateTalkLock(lockedTarget) { assert.equal(lockedTarget, target); events.push('lock'); },
    removeTalkLock(lockedTarget) { assert.equal(lockedTarget, target); events.push('unlock'); },
  });
  return {
    events,
    fire(type, timeStamp = 0, { pointerId = 1, clientX = 100, clientY = 100 } = {}) {
      callbacks.get(type)({ type, timeStamp, pointerId, clientX, clientY, button: 0, preventDefault() {}, stopPropagation() {} });
    },
  };
}

test('web PTT locks a short tap on release while keeping a longer press momentary', () => {
  for (const [time, expected] of [[299, ['press', 'lock', 'release']], [300, ['press', 'release']]]) {
    const { events, fire } = bindButton();
    fire('pointerdown');
    fire('pointerup', 100, { pointerId: 2 });
    assert.deepEqual(events, ['press']);
    fire('pointerup', time);
    assert.deepEqual(events, expected);
  }
});

test('Main slides in the configured direction, even when only release reaches the threshold', () => {
  for (const leftHand of [false, true]) {
    const { events, fire } = bindButton({ main: true, leftHand, tapToLockEnabled: false });
    fire('pointerdown');
    fire('pointermove', 100, { clientX: leftHand ? 120 : 80 });
    fire('pointerup', 400, { clientX: leftHand ? 145 : 55 });
    assert.deepEqual(events, ['press', 'lock', 'release']);
  }
});

test('pressing a locked Main button unlocks its original target when Reply changed', () => {
  const { events, fire } = bindButton({ main: true, locked: true });
  fire('pointerdown');
  fire('pointerup', 100);
  assert.deepEqual(events, ['unlock']);
});

test('web PTT ignores cancelled and moved taps, keeps swipe, and unlocks on the next press', () => {
  for (const { settings, move, end, expected } of [
    { end: 'pointercancel', expected: ['press', 'release'] },
    { move: { clientY: 120 }, expected: ['press', 'release'] },
    { settings: { tapToLockEnabled: false }, expected: ['press', 'release'] },
    { settings: { tapToLockEnabled: false }, move: { clientX: 50 }, expected: ['press', 'lock', 'release'] },
    { settings: { locked: true }, expected: ['unlock'] },
  ]) {
    const { events, fire } = bindButton(settings);
    fire('pointerdown');
    if (move) fire('pointermove', 50, move);
    fire(end ?? 'pointerup', 100);
    assert.deepEqual(events, expected);
  }
});
