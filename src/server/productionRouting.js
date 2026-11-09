function arePeersInSameActiveProduction(firstPeer, secondPeer, multipleProductionsEnabled) {
  if (!multipleProductionsEnabled) return true;
  if (
    firstPeer?.productionId === null
    || firstPeer?.productionId === undefined
    || firstPeer?.productionId === ''
    || secondPeer?.productionId === null
    || secondPeer?.productionId === undefined
    || secondPeer?.productionId === ''
  ) {
    return true;
  }
  const firstProductionId = Number(firstPeer?.productionId);
  const secondProductionId = Number(secondPeer?.productionId);
  if (!Number.isFinite(firstProductionId) || !Number.isFinite(secondProductionId)) return true;
  return firstProductionId === secondProductionId;
}

function canRouteTargetBetweenPeers(target, firstPeer, secondPeer, multipleProductionsEnabled) {
  // User identities and conferences are global; only guest/session targets keep production scope.
  if (['user', 'conference'].includes(String(target?.type || '').toLowerCase())) return true;
  return arePeersInSameActiveProduction(firstPeer, secondPeer, multipleProductionsEnabled);
}

module.exports = {
  arePeersInSameActiveProduction,
  canRouteTargetBetweenPeers,
};
