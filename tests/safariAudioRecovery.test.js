const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = require('./helpers/projectRoot');
const source = fs.readFileSync(path.join(root, 'public/client.js'), 'utf8');
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Missing client source section: ${start}`);
  return source.slice(from, to);
}

test('all microphone and feed profiles omit obsolete RTP dtx while retaining Opus settings', () => {
  const profiles = vm.runInNewContext(`${section('const QUALITY_PROFILES =', 'const defaultVolume =')}
    ${section('const FEED_PROFILE =', 'function createAnonymousSession(')}
    [...Object.values(QUALITY_PROFILES), FEED_PROFILE]`);
  assert.equal(profiles.length, 4);
  for (const profile of profiles) {
    assert.equal(profile.codecOptions.opusDtx, 0);
    for (const encoding of profile.encodings) {
      assert.equal(Object.hasOwn(encoding, 'dtx'), false, `${profile.label}: Safari rejects boolean RTP dtx`);
      assert(encoding.maxBitrate > 0);
    }
  }
});

function receiveHarness({ hidden = false, stopped = false, muted = false, blockedPlayback = false, holdResumeAck = false } = {}) {
  const events = [];
  const errors = [];
  const audioElements = new Map();
  const feedAudioElements = new Map();
  const peerConsumers = new Map();
  const targetStreamMap = new Map();
  const pendingIncomingConsumeKeys = new Set();
  const stoppedFeedKeys = new Set(stopped ? ['feed-7'] : []);
  const mutedPeers = new Set(muted ? ['feed-7'] : []);
  const waitingForPackets = [];
  let resumed = false;
  let acknowledgeResume = null;
  const ctx = {
    state: 'interrupted',
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    async resume() { events.push('context-resume'); this.state = 'running'; },
  };
  function audio() {
    return {
      paused: true, setAttribute() {},
      play() {
        events.push('play');
        this.paused = false;
        if (blockedPlayback) return new Promise(() => {});
        // Safari can wait for the first packet before resolving play().
        return resumed ? Promise.resolve() : new Promise(resolve => waitingForPackets.push(resolve));
      },
    };
  }
  const consumer = {
    id: 'consumer-1', track: { readyState: 'live', addEventListener() {} },
    rtpReceiver: {}, on() {}, pause() { events.push('local-pause'); },
  };
  const context = {
    console: { info() {}, warn() {}, error(...args) { errors.push(args); } },
    performance, setTimeout, clearTimeout,
    feedVideo: { announce: () => false, reconcile() {} },
    session: { kind: 'user', userId: 1 }, cachedUsers: [], device: { rtpCapabilities: {} },
    socket: { id: 'listener', connected: true, emit(event, data, done) {
      events.push(event);
      if (event === 'consume') done({ id: consumer.id, producerId: 'bridge-feed' });
      else {
        if (event === 'resume-consumer') {
          resumed = true;
          waitingForPackets.splice(0).forEach(resolve => resolve());
        }
        if (holdResumeAck) acknowledgeResume = () => done({});
        else done({});
      }
    } },
    recvTransport: { async consume() { return consumer; } },
    audioElements, peerConsumers, targetStreamMap, pendingIncomingConsumeKeys,
    feedAudioElements, confAudioElements: new Map(), audioEntryMap: new WeakMap(),
    activeFeedKeys: new Set(), stoppedFeedKeys, mutedPeers,
    defaultVolume: .9, isiOS: true, isSafariBrowser: true, isAndroidBrowser: false,
    preferredOutputDeviceId: '', micPrimed: false, micTrack: null,
    document: { createElement: audio },
    MediaStream: class { constructor(tracks) { this.tracks = tracks; } getAudioTracks() { return this.tracks; } },
    makeStreamKey: (target, producer) => `${target}::${producer}`,
    takeEarlyClosedStream: () => false, takeEarlyClosedConsumer: () => false,
    logReceiveDiagnostic() {}, closeConsumerOnServer() {},
    shouldUseAdaptivePlainReceivePlayback: () => hidden,
    shouldUseAdaptiveReceivePlayback: () => true,
    shouldUseFeedPlaybackBus: () => true,
    shouldUsePersistentRemotePlaybackBus: () => false,
    ensureFeedPlaybackBus: () => ({ ctx, inputNode: {} }),
    ensureAudioContext: () => ctx,
    resumeAudioContextIfNeeded: context => context.resume(),
    getStoredVolume: () => .65, supportsAudioOutputSelection: () => false,
    enforcePitchLock() {}, attachPlaybackAudioDiagnostics() {}, appendPlaybackAudioElement() {},
    logRemoteAudioPlaybackDecision() {}, syncIncomingLevelMeters() {}, updateSpeakerHighlight() {},
    registerStreamKey(key, streamKey) { targetStreamMap.set(key, new Set([streamKey])); },
    isFeedKey: key => key.startsWith('feed-'), isOperatorSession: () => true,
    setFeedEntryLevel(entry, level) { entry.lastAppliedLevel = level; },
    muteFeedEntry(entry) { entry.lastAppliedLevel = 0; },
    applyFeedDucking() {}, attemptPlayAudio: element => element.play(),
  };
  const consume = vm.runInNewContext(`${section('  async function consumeProducerPayload(', '  async function processPendingProducers(')}
    consumeProducerPayload`, context);
  return {
    events, errors, ctx, audioElements, pendingIncomingConsumeKeys,
    acknowledge: () => acknowledgeResume(),
    consume: () => consume({ peerId: 'bridge', producerId: 'bridge-feed', appData: { type: 'feed', id: 7 } }),
  };
}

async function settle(promise) {
  return Promise.race([promise.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 40))]);
}

for (const hidden of [true, false]) {
  test(`feed subscription resumes before waiting for Safari playback (${hidden ? 'background' : 'foreground'})`, async () => {
    const h = receiveHarness({ hidden });
    assert.equal(await settle(h.consume()), true, 'play() waiting for data must not deadlock the paused consumer');
    assert.deepEqual(h.errors, []);
    assert(h.events.indexOf('resume-consumer') < h.events.indexOf('play'));
    assert.equal(h.pendingIncomingConsumeKeys.size, 0);
    assert.equal(h.audioElements.size, 1);
    if (!hidden) assert.equal(h.ctx.state, 'running', 'interrupted feed AudioContext must resume');
  });
}

test('unresolved playback after an app switch cannot block producer reconciliation', async () => {
  const h = receiveHarness({ hidden: true, blockedPlayback: true });
  assert.equal(await settle(h.consume()), true);
  assert.deepEqual(h.errors, []);
  assert(h.events.includes('resume-consumer'));
  assert.equal(h.pendingIncomingConsumeKeys.size, 0);
});

test('foreground feed recovery preserves a feed intentionally stopped by the listener', async () => {
  const h = receiveHarness({ stopped: true, blockedPlayback: true });
  assert.equal(await settle(h.consume()), true);
  assert.deepEqual(h.errors, []);
  assert(h.events.includes('pause-consumer'));
  assert(!h.events.includes('resume-consumer'));
  assert.equal([...h.audioElements.values()][0].lastAppliedLevel, 0);
});


test('a visibility change while resuming cannot restart a disposed feed element', async () => {
  const h = receiveHarness({ holdResumeAck: true });
  const pending = h.consume();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.audioElements.size, 1);
  h.audioElements.clear(); // The visibility handoff disposed the old entry.
  h.acknowledge();
  await pending;
  assert.deepEqual(h.errors, []);
  assert(!h.events.includes('play'));
  assert.equal(h.pendingIncomingConsumeKeys.size, 0);
});

test('foreground reconciliation requested during an older sync runs after it finishes', async () => {
  let releaseFirstConsume;
  let requests = 0;
  let consumes = 0;
  const context = {
    console, setTimeout, clearTimeout, queueMicrotask,
    feedVideo: { announce: () => false, reconcile() {} },
    activeProducersSyncInFlight: false, activeProducersSyncRequested: false,
    mediaInitialized: true, isOperatorSession: () => true,
    audioElements: new Map(), peerConsumers: new Map(), targetStreamMap: new Map(),
    targetKeyFromProducerPayload: () => 'feed-7',
    streamKeyFromProducerPayload: () => 'feed-7::bridge-feed',
    logReceiveDiagnostic() {},
    socket: { connected: true, emit(event, done) {
      assert.equal(event, 'request-active-producers');
      requests += 1;
      done([{ producerId: 'bridge-feed' }]);
    } },
    handleIncomingProducer: async () => {
      consumes += 1;
      if (consumes === 1) await new Promise(resolve => { releaseFirstConsume = resolve; });
    },
  };
  const request = vm.runInNewContext(`${section('  async function requestActiveProducers(', '  function startActiveProducerSync(')}
    requestActiveProducers`, context);
  const first = request();
  await new Promise(resolve => setImmediate(resolve));
  await request(); // The tab returns while the previous feed is still being consumed.
  releaseFirstConsume();
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 2);
  assert.equal(consumes, 2);
  assert.equal(context.activeProducersSyncInFlight, false);
});
