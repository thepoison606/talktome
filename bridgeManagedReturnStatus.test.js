const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('bridge-client/src/app.js', 'utf8');
const start = source.indexOf('function getManagedIncomingSpeakerNames(');
const end = source.indexOf('function renderManagedAssignmentControls(', start);
const context = vm.createContext({ Date });
vm.runInContext(source.slice(start, end), context);

test('retained decoder does not keep the Bridge speaking status active', () => {
  const output = {
    speakerName: 'Alice',
    decodedFrames: 48_000,
    lastDecodedAt: Date.now(),
    startedAt: Date.now() - 2_000,
  };
  const session = {
    addressedNow: [],
    outputs: new Map([['producer-1', output]]),
  };

  assert.equal(context.formatManagedReturnPathStatus(session), 'No active incoming talk');

  session.addressedNow = [{ fromName: 'Alice' }];
  assert.equal(context.formatManagedReturnPathStatus(session), 'Alice speaking, receiving audio');

  output.lastDecodedAt = Date.now() - 2_000;
  assert.equal(context.formatManagedReturnPathStatus(session), 'Alice speaking, waiting for RTP audio');

  session.addressedNow = [];
  output.appData = { type: 'feed', id: 1 };
  assert.equal(context.formatManagedReturnPathStatus(session), 'Alice speaking, waiting for RTP audio');
});
