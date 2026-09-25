const assert = require('node:assert/strict');
const test = require('node:test');
const { validateCompleteTargetOrder } = require('./targetOrdering');

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
