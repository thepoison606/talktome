const NO_RTP_TIMEOUT_MS = 8000;
const SAMPLE_STALE_MS = 10000;
const samples = new WeakMap();

function getStatus(producer, now = Date.now()) {
  const sample = samples.get(producer);
  if (producer.closed || producer.paused || !sample || sample.startedAt !== producer.__startedAt
      || now - sample.checkedAt > SAMPLE_STALE_MS) return null;
  return sample.status;
}

async function sampleFeedProducer(producer, now = Date.now()) {
  if (producer.closed || producer.paused) return false;
  const startedAt = producer.__startedAt;
  const previous = samples.get(producer);
  let stats;
  try {
    stats = await producer.getStats();
  } catch {
    if (!previous || now - previous.checkedAt <= SAMPLE_STALE_MS) return false;
    samples.delete(producer);
    return previous.status === 'missing';
  }
  if (producer.closed || producer.paused || producer.__startedAt !== startedAt) return false;

  const continuous = previous?.startedAt === startedAt && now - previous.checkedAt <= SAMPLE_STALE_MS;
  // A producer that has never received RTP has no inbound stream stats yet.
  const packets = stats.reduce((count, entry) => (
    entry.type === 'inbound-rtp' ? count + entry.packetCount : count
  ), 0);
  if (!Number.isSafeInteger(packets) || packets < 0) return false;

  let lastProgressAt;
  if (continuous && packets === previous.packets) {
    lastProgressAt = previous.lastProgressAt;
  } else {
    lastProgressAt = packets > 0 || continuous ? now : startedAt ?? now;
  }
  const status = now - lastProgressAt >= NO_RTP_TIMEOUT_MS ? 'missing' : null;
  samples.set(producer, { startedAt, checkedAt: now, packets, lastProgressAt, status });
  return status !== (previous?.status ?? null);
}

function describeFeedRtp(peer, now) {
  if (!peer) return { missingRtp: [], mediaPorts: [] };
  const missingRtp = [];
  const mediaPorts = [];
  for (const kind of ['audio', 'video']) {
    const producers = [...peer.producers.values()].filter(producer => !producer.closed && producer.kind === kind);
    const transport = peer.isBridgePeer
      ? kind === 'audio' ? peer.plainSendTransport : peer.plainVideoSendTransport
      : peer.sendTransport;
    if (peer.isBridgePeer && producers.some(producer => getStatus(producer, now) === 'missing')) {
      missingRtp.push(kind);
    }
    if (!transport || transport.closed || (!peer.isBridgePeer && producers.length === 0)) continue;
    const tuple = peer.isBridgePeer ? transport.tuple : transport.iceSelectedTuple;
    if (tuple?.localPort) {
      mediaPorts.push({ kind, protocol: tuple.protocol, port: tuple.localPort });
    }
  }
  return { missingRtp, mediaPorts };
}

module.exports = { describeFeedRtp, sampleFeedProducer };
