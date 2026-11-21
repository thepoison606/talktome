const assert = require('node:assert/strict');
const test = require('node:test');
const { canUserRearrangeTargets, validateCompleteTargetOrder } = require('../src/server/targetOrdering');
const fs = require('node:fs');
const vm = require('node:vm');

test('target rearrange inherits the default until explicitly overridden per user', () => {
  const user = { id: 1, allow_target_rearrange: null };
  assert.equal(canUserRearrangeTargets(user), true);
  assert.equal(canUserRearrangeTargets(user, { allowTargetRearrange: false }), false);
  assert.equal(canUserRearrangeTargets({ ...user, allow_target_rearrange: 0 }, { allowTargetRearrange: true }), false);
  assert.equal(canUserRearrangeTargets({ ...user, allow_target_rearrange: 1 }, { allowTargetRearrange: false }), true);
  assert.equal(canUserRearrangeTargets(null), false);
  assert.equal(canUserRearrangeTargets({ ...user, is_guest_profile: 1, allow_target_rearrange: 1 }), false);
  assert.equal(canUserRearrangeTargets({ ...user, is_superadmin: 1, allow_target_rearrange: 1 }), false);
});

test('client order endpoint rejects a disabled user before changing target order', () => {
  const source = fs.readFileSync(require.resolve('../src/server/serverCore'), 'utf8');
  const start = source.indexOf("app.put('/api/v1/client/targets/order'");
  const end = source.indexOf('app.get(\'/users/:id/productions\'', start);
  let handler;
  let saved = false;
  let defaults = { allowTargetRearrange: false };
  const user = { id: 1, allow_target_rearrange: null };
  const context = vm.createContext({
    app: { put: (route, callback) => { handler = callback; } },
    getBrowserSession: () => ({ session: { kind: 'user', userId: 1 } }),
    getUserById: () => user,
    isTargetRearrangeAllowed: user => canUserRearrangeTargets(user, defaults),
    areMultipleProductionsEnabled: () => false,
    getPrimaryProduction: () => ({ id: 1 }),
    isUserInProduction: () => true,
    getProductionTargets: () => available,
    validateCompleteTargetOrder,
    updateProductionTargetOrder: () => { saved = true; },
    notifyTargetChange() {},
  });
  vm.runInContext(source.slice(start, end), context);
  let status;
  const response = { status(code) { status = code; return this; }, json() {} };
  const request = { body: { items: available } };
  handler(request, response);
  assert.equal(status, 403);
  assert.equal(saved, false);
  user.allow_target_rearrange = 1;
  status = 200;
  handler(request, response);
  assert.equal(status, 200);
  assert.equal(saved, true);
  defaults = { allowTargetRearrange: true };
  user.allow_target_rearrange = 0;
  saved = false;
  handler(request, response);
  assert.equal(status, 403);
  assert.equal(saved, false);
});

test('the target editor stays available for colors when rearranging is revoked', () => {
  const source = fs.readFileSync(require.resolve('../public/client'), 'utf8');
  const start = source.indexOf('let allowTargetRearrange = false;');
  const end = source.indexOf('let feedInputProcessingEnabled', start);
  const context = vm.createContext({
    session: { kind: 'user' }, remotePanel: null,
    arrangeTargetsOpenButton: { hidden: true }, activeSettingsView: 'main',
    setActiveSettingsView(view) { context.activeSettingsView = view; },
  });
  vm.runInContext(source.slice(start, end), context);
  context.applyTargetRearrangePermission(true);
  assert.equal(context.arrangeTargetsOpenButton.hidden, false);
  context.activeSettingsView = 'arrange';
  context.applyTargetRearrangePermission(false);
  assert.equal(context.canArrangeTargets(), false);
  assert.equal(context.arrangeTargetsOpenButton.hidden, false);
  assert.equal(context.activeSettingsView, 'arrange');
  context.session.kind = 'guest';
  context.applyTargetRearrangePermission(false);
  assert.equal(context.arrangeTargetsOpenButton.hidden, true);
  assert.equal(context.activeSettingsView, 'main');
  context.session.kind = 'user';
  context.remotePanel = {};
  context.applyTargetRearrangePermission(false);
  assert.equal(context.arrangeTargetsOpenButton.hidden, false);
});

const available = [
  { targetType: 'user', targetId: 2 },
  { targetType: 'conference', targetId: 5 },
  { targetType: 'feed', targetId: 8 },
];

test('a user can save a complete order of their assigned targets', () => {
  assert.deepEqual(validateCompleteTargetOrder([
    { targetType: 'feed', targetId: 8 },
    { targetType: 'user', targetId: 2 },
    { targetType: 'conference', targetId: 5 },
  ], available), [
    { targetType: 'feed', targetId: 8 },
    { targetType: 'user', targetId: 2 },
    { targetType: 'conference', targetId: 5 },
  ]);
});

test('a user cannot add, remove or duplicate targets while reordering', () => {
  assert.throws(() => validateCompleteTargetOrder(available.slice(0, 2), available), { statusCode: 409 });
  assert.throws(() => validateCompleteTargetOrder([
    available[0], available[1], { targetType: 'user', targetId: 99 },
  ], available), { statusCode: 409 });
  assert.throws(() => validateCompleteTargetOrder([
    available[0], available[1], available[1],
  ], available), { statusCode: 409 });
  assert.throws(() => validateCompleteTargetOrder([
    available[0], available[1], { targetType: 'feed', targetId: 0 },
  ], available), { statusCode: 400 });
});
