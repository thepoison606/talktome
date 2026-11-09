const assert = require('node:assert/strict');
const test = require('node:test');
const {
  arePeersInSameActiveProduction,
  canRouteTargetBetweenPeers,
} = require('../src/server/productionRouting');

const productionA = { productionId: 1 };
const productionB = { productionId: 2 };

test('conference audio crosses active production boundaries', () => {
  assert.equal(
    canRouteTargetBetweenPeers({ type: 'conference', id: 4 }, productionA, productionB, true),
    true,
  );
});

test('direct user audio reaches the same identity across active productions', () => {
  assert.equal(
    canRouteTargetBetweenPeers({ type: 'user', id: 4 }, productionA, productionB, true),
    true,
  );
  assert.equal(
    canRouteTargetBetweenPeers({ type: 'user', id: 4 }, productionA, productionA, true),
    true,
  );
});

test('global peers without a production remain routable', () => {
  assert.equal(arePeersInSameActiveProduction({ productionId: null }, productionB, true), true);
});

test('guest session targets retain their production boundary', () => {
  assert.equal(canRouteTargetBetweenPeers({ type: 'guest', id: 'session' }, productionA, productionB, true), false);
});
