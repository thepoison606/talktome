const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/client'), 'utf8');

function fixture() {
  let finish, fail;
  const pending = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const original = [{ targetType: 'user', targetId: 2, name: 'Pat' }];
  const frames = [];
  const context = vm.createContext({
    canEditTargets: () => true, remotePanel: null,
    session: { userId: 1, productionId: '7' }, activeSettingsView: 'arrange',
    arrangeTargetsLoadGeneration: 0, arrangeTargetsDraft: original, arrangeTargetsSaved: original,
    arrangeTargetsForUserId: 1, arrangeTargetsForProductionId: '7', addTargetsList: { hidden: false },
    clearArrangeTargetsDrag() {}, setArrangeTargetsMessage() {},
    renderArrangeTargets() { frames.push(JSON.stringify(context.arrangeTargetsDraft)); },
    fetchJSON: () => pending,
  });
  const start = source.indexOf('  async function loadArrangeTargets()');
  const end = source.indexOf('  loadArrangeTargetsHandler =', start);
  vm.runInContext(source.slice(start, end), context);
  return { context, finish, fail, frames, original };
}

test('target refresh keeps the current list and add picker visible until replacement data arrives', async () => {
  const f = fixture();
  const refresh = f.context.loadArrangeTargets();
  assert.equal(f.context.arrangeTargetsDraft, f.original);
  assert.equal(f.context.addTargetsList.hidden, false);
  assert.equal(f.frames.length, 0, 'No empty intermediate frame during the request');
  const next = [{ targetType: 'feed', targetId: 4, name: 'Program' }];
  f.finish(next); assert.equal(await refresh, true);
  assert.deepEqual(f.frames, [JSON.stringify(next)]);
  assert.equal(f.context.addTargetsList.hidden, true);
});

test('a failed target refresh retains the previous menu instead of flashing an empty view', async () => {
  const f = fixture(); const refresh = f.context.loadArrangeTargets();
  f.fail(new Error('Network unavailable')); assert.equal(await refresh, false);
  assert.equal(f.context.arrangeTargetsDraft, f.original);
  assert.equal(f.context.addTargetsList.hidden, false);
  assert.equal(f.frames.length, 0);
});

test('switching production clears old targets and ignores a response from the old scope', async () => {
  const f = fixture(); f.context.session.productionId = '8';
  const refresh = f.context.loadArrangeTargets();
  assert.deepEqual(f.frames, ['[]']);
  assert.equal(f.context.addTargetsList.hidden, true);
  f.context.session.productionId = '9';
  f.finish(f.original); assert.equal(await refresh, false);
  assert.deepEqual(f.frames, ['[]']);
});

test('saving a target change disables existing controls without rebuilding them during the request', async () => {
  const f = fixture(); let respond; let busyUpdates = 0, reloads = 0;
  Object.assign(f.context, {
    allowTargetAddRemove: true, arrangeTargetsSaving: false,
    updateArrangeTargetsBusy() { busyUpdates++; },
    fetch: () => new Promise(resolve => { respond = resolve; }),
    loadArrangeTargets: async () => { reloads++; },
  });
  const start = source.indexOf('  async function changeSelectedTarget(');
  const end = source.indexOf("  addTargetsButton?.addEventListener('click'", start);
  vm.runInContext(source.slice(start, end), f.context);
  const save = f.context.changeSelectedTarget('remove', f.original[0]);
  assert.equal(busyUpdates, 1); assert.equal(f.frames.length, 0);
  assert.equal(f.context.addTargetsList.hidden, false);
  respond({ ok: true, json: async () => ({ ok: true }) }); await save;
  assert.equal(reloads, 1); assert.equal(f.context.arrangeTargetsSaving, false);
});
