const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const projectRoot = require('./helpers/projectRoot');
const source = fs.readFileSync(path.join(projectRoot, 'bridge-client/src/app.js'), 'utf8');

function setup() {
  const key = 'user:7';
  const drafts = new Map(), revisions = new Map(), edits = new Map();
  const rendered = [], requests = [];
  const assignment = () => ({ deviceId: 'device', leftChannel: 1, rightChannel: 1 });
  const draft = { input: assignment(), output: assignment(), trigger: { mode: 'external', targets: [] } };
  const context = {
    managedBridgeConfig: { bridgeId: 'bridge', ports: [{ kind: 'user', id: 7 }] },
    localStorage: { getItem: () => '' }, STORAGE_KEYS: { bridgeId: 'bridge-id' },
    managedPortDrafts: drafts, managedPortDraftRevisions: revisions, managedPortEditStates: edits,
    bridgePortKey: () => key, bridgePortTargetId: port => port.id,
    getManagedPortElement: () => ({}), bridgePortHasOutput: () => true,
    updateManagedPortDraftFromElement() { drafts.set(key, draft); revisions.set(key, 1); },
    bridgeTalkTrigger: require('../public/bridgeTalkTrigger'),
    MANAGED_LEVEL_TRIGGER_DEFAULT_THRESHOLD_DB: -45,
    renderManagedBridgePorts() { rendered.push({ ...edits.get(key) }); },
    suppressWindowFocusHide: async () => {},
    bridgeApi: async (...args) => { requests.push(args); return {}; },
    reconcileManagedBridgeConfig: async () => {},
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function validateManagedPortAssignment('), source.indexOf('function scheduleManagedPortAutoSave(')), context);
  return { context, key, draft, drafts, edits, rendered, requests };
}

for (const [name, invalidate, message] of [
  ['input channel', draft => { draft.input.leftChannel = null; }, 'Input channel is required'],
  ['output device', draft => { draft.output.deviceId = ''; }, 'Output device is required'],
  ['talk targets', draft => { draft.trigger.mode = 'audio-level'; }, 'Select at least one talk target'],
]) {
  test(`Bridge autosave displays ${name} validation errors and preserves the draft`, async () => {
    const state = setup();
    invalidate(state.draft);
    await assert.rejects(state.context.saveManagedBridgePort(state.key), { message });
    assert.equal(state.requests.length, 0);
    assert.equal(state.drafts.get(state.key), state.draft);
    assert.equal(state.edits.get(state.key).dirty, true);
    assert.equal(state.rendered.at(-1).error, message);
    assert.equal(state.rendered.at(-1).saving, undefined);
  });
}

test('Bridge autosave retries a corrected draft and clears the error only after saving', async () => {
  const state = setup();
  state.draft.input.leftChannel = null;
  await assert.rejects(state.context.saveManagedBridgePort(state.key));
  state.draft.input.leftChannel = 1;
  await state.context.saveManagedBridgePort(state.key);
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0][1], '/api/v1/bridge/bridge/ports/user/7');
  assert.equal(state.requests[0][2].inputDevice, 'device');
  assert.equal(state.drafts.has(state.key), false);
  assert.equal(state.edits.has(state.key), false);
});

test('Bridge autosave preserves input and reports a rejected server write', async () => {
  const state = setup();
  state.context.bridgeApi = async () => { throw new Error('Server unavailable'); };
  await assert.rejects(state.context.saveManagedBridgePort(state.key), /Server unavailable/);
  assert.equal(state.drafts.get(state.key), state.draft);
  assert.equal(state.rendered.at(-1).error, 'Server unavailable');
  assert.equal(state.rendered.at(-1).dirty, true);
});
