"use strict";

function normalizeProducerType(producer) {
  return String(producer?.appData?.type || "").trim().toLowerCase();
}

function buildProducerDeliverySignature(appData = {}) {
  return [
    appData?.type || "",
    appData?.id ?? "",
    appData?.targetPeer || "",
  ].join(":");
}

function producerDeliveryChanged(previousAppData, nextAppData) {
  return (
    !previousAppData
    || !nextAppData
    || buildProducerDeliverySignature(previousAppData) !== buildProducerDeliverySignature(nextAppData)
  );
}

function shouldAnnounceProducerDelivery({
  previousAppData,
  nextAppData,
  forceAnnounce = false,
} = {}) {
  return Boolean(
    nextAppData
    && (forceAnnounce || producerDeliveryChanged(previousAppData, nextAppData))
  );
}

function getRetainedTalkDelivery(producer, recipientSocketId) {
  if (
    !producer
    || producer.closed
    || normalizeProducerType(producer) !== "talk"
    || !(producer.__recipientDeliveries instanceof Map)
  ) {
    return null;
  }

  const appData = producer.__recipientDeliveries.get(recipientSocketId);
  if (!appData || typeof appData !== "object") return null;
  return { recipientSocketId, appData };
}

function resolveProducerReconciliationDelivery({
  producer,
  recipientSocketId,
  activeDelivery = null,
} = {}) {
  if (!producer || producer.closed || !recipientSocketId) return null;

  // Paused producers are not active. Only a previously delivered dynamic talk
  // producer may be retained so an existing consumer survives the PTT pause.
  if (producer.paused) {
    const retainedDelivery = getRetainedTalkDelivery(producer, recipientSocketId);
    return retainedDelivery
      ? { ...retainedDelivery, retainOnly: true }
      : null;
  }

  if (activeDelivery?.appData) {
    return {
      recipientSocketId,
      appData: activeDelivery.appData,
      retainOnly: false,
    };
  }

  // The client clears talk targets immediately before the pause reaches the
  // server. Retain the prior delivery during that short signaling transition.
  const retainedDelivery = getRetainedTalkDelivery(producer, recipientSocketId);
  return retainedDelivery
    ? { ...retainedDelivery, retainOnly: true }
    : null;
}

module.exports = {
  getRetainedTalkDelivery,
  producerDeliveryChanged,
  resolveProducerReconciliationDelivery,
  shouldAnnounceProducerDelivery,
};
