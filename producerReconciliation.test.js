const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getRetainedTalkDelivery,
  producerDeliveryChanged,
  resolveProducerReconciliationDelivery,
  shouldAnnounceProducerDelivery,
} = require("./producerReconciliation");

const recipientSocketId = "recipient-1";
const deliveryAppData = { type: "user", id: 6, targetPeer: recipientSocketId };

function createProducer(overrides = {}) {
  return {
    id: "producer-1",
    closed: false,
    paused: false,
    appData: { type: "talk" },
    __recipientDeliveries: new Map([[recipientSocketId, deliveryAppData]]),
    ...overrides,
  };
}

test("keeps an existing dynamic talk delivery while its producer is paused", () => {
  const producer = createProducer({ paused: true });

  assert.deepEqual(
    resolveProducerReconciliationDelivery({ producer, recipientSocketId }),
    {
      recipientSocketId,
      appData: deliveryAppData,
      retainOnly: true,
    }
  );
});

test("does not expose paused static producers as active or retained", () => {
  for (const type of ["user", "conference", "guest", "feed"]) {
    const producer = createProducer({
      paused: true,
      appData: { type, id: 1 },
    });

    assert.equal(
      resolveProducerReconciliationDelivery({
        producer,
        recipientSocketId,
        activeDelivery: { recipientSocketId, appData: producer.appData },
      }),
      null
    );
  }
});

test("does not turn a never-delivered paused talk producer into an active delivery", () => {
  const producer = createProducer({
    paused: true,
    __recipientDeliveries: new Map(),
  });

  assert.equal(
    resolveProducerReconciliationDelivery({
      producer,
      recipientSocketId,
      activeDelivery: { recipientSocketId, appData: deliveryAppData },
    }),
    null
  );
});

test("returns an unpaused current delivery as active", () => {
  const producer = createProducer();
  const activeDelivery = {
    recipientSocketId,
    appData: { type: "conference", id: 3 },
  };

  assert.deepEqual(
    resolveProducerReconciliationDelivery({
      producer,
      recipientSocketId,
      activeDelivery,
    }),
    {
      recipientSocketId,
      appData: activeDelivery.appData,
      retainOnly: false,
    }
  );
});

test("retains a talk delivery during the target-clear to pause transition", () => {
  const producer = createProducer({ paused: false });

  assert.deepEqual(
    resolveProducerReconciliationDelivery({ producer, recipientSocketId }),
    {
      recipientSocketId,
      appData: deliveryAppData,
      retainOnly: true,
    }
  );
});

test("does not retain closed, unrelated, or never-delivered talk producers", () => {
  assert.equal(
    getRetainedTalkDelivery(createProducer({ closed: true }), recipientSocketId),
    null
  );
  assert.equal(
    getRetainedTalkDelivery(createProducer(), "recipient-2"),
    null
  );
  assert.equal(
    getRetainedTalkDelivery(
      createProducer({ __recipientDeliveries: new Map() }),
      recipientSocketId
    ),
    null
  );
});

test("detects changed routing metadata and forces a resume announcement", () => {
  assert.equal(
    producerDeliveryChanged(deliveryAppData, { ...deliveryAppData }),
    false
  );
  assert.equal(
    producerDeliveryChanged(deliveryAppData, { ...deliveryAppData, id: 7 }),
    true
  );
  assert.equal(
    shouldAnnounceProducerDelivery({
      previousAppData: deliveryAppData,
      nextAppData: { ...deliveryAppData },
      forceAnnounce: false,
    }),
    false
  );
  assert.equal(
    shouldAnnounceProducerDelivery({
      previousAppData: deliveryAppData,
      nextAppData: { ...deliveryAppData },
      forceAnnounce: true,
    }),
    true
  );
});
