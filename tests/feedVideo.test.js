const test = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../public/feedVideo');
const tick = () => new Promise(resolve => setImmediate(resolve));

// Minimal DOM/media boundaries keep tests independent of a webcam or browser vendor.
function element(tag = 'div') {
  const listeners = {}, classes = new Set();
  return { tag, children: [], hidden: false, isConnected: true, attributes: {}, options: [], value: '',
    classList: { contains: key => classes.has(key), toggle: (key, yes) => yes ? classes.add(key) : classes.delete(key), add: key => classes.add(key), remove: key => classes.delete(key) },
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(key, fn) { listeners[key] = fn; },
    dispatch(key) { return listeners[key]?.({ stopPropagation() {} }); },
    append(...items) { items.forEach(item => this.appendChild(item)); },
    appendChild(item) { this.children.push(item); if (tag === 'select') this.options.push(item); },
    prepend(item) { this.children.unshift(item); }, replaceChildren() { this.children = []; this.options = []; },
    play() { this.played = true; return Promise.resolve(); }, pause() { this.played = false; },
  };
}
function harness({ deferConsume = false, deferCamera = false, denyCamera = false } = {}) {
  const events = [], consumers = [], tracks = [], sends = [], callbacks = {};
  const nodes = Object.fromEntries(['feed-video-source', 'feed-video-preview', 'feed-video-status'].map(id => [id, element(id.includes('source') ? 'select' : 'video')]));
  const doc = { hidden: false, getElementById: id => nodes[id], createElement: element,
    addEventListener: (event, fn) => { callbacks[event] = fn; } };
  let stopped = false, streaming = false, cameraResolve, consumeResolve;
  const socket = { connected: true, emit(event, data, done) {
    events.push({ event, data });
    if (event === 'consume') {
      const result = { id: `c${events.length}`, producerId: data.producerId, kind: 'video', rtpParameters: {} };
      if (deferConsume) consumeResolve = () => done(result); else done(result);
    } else done?.(event === 'resume-consumer' ? undefined : { ok: true });
  } };
  const recv = { closed: false, async consume(params) {
    const consumer = { ...params, track: {}, on() {}, resume() {}, close() { this.closed = true; } };
    consumers.push(consumer); return consumer;
  } };
  const send = { async produce(options) {
    const listeners = {};
    const producer = { id: `p${sends.length}`, options, on: (event, fn) => { listeners[event] = fn; },
      close() { this.closed = true; }, ended: () => listeners.trackended() };
    sends.push(producer); return producer;
  } };
  const makeCamera = () => {
    const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track);
    return { getTracks: () => [track], getVideoTracks: () => [track] };
  };
  const mediaDevices = { enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'camera1', label: 'Webcam' }],
    async getUserMedia(options) {
      assert.equal(options.audio, false);
      if (denyCamera) throw new Error('Permission denied');
      if (deferCamera) return new Promise(resolve => { cameraResolve = () => resolve(makeCamera()); });
      return makeCamera();
    } };
  const controller = createController({ socket, getSession: () => ({ kind: 'feed', feedId: 7 }),
    getDevice: () => ({ canProduce: () => true, rtpCapabilities: {} }),
    getSendTransport: () => send, getRecvTransport: () => recv,
    isStreaming: () => streaming, isStopped: () => stopped, onLayoutChange() {},
    document: doc, mediaDevices, makeStream: items => ({ items }),
  });
  const row = element(); const icon = element(); row.querySelector = () => icon;
  let button; icon.replaceWith = replacement => { button = replacement; };
  controller.attachTarget(row, 'feed-7', 'Program');
  const panel = row.children[0];
  const payload = { producerId: 'v1', kind: 'video', appData: { type: 'feed', id: 7 } };
  return { controller, events, consumers, row, button, panel, payload, doc, nodes, tracks, sends,
    setStopped(value) { stopped = value; controller.syncVisibility(); },
    setStreaming(value) { streaming = value; },
    selectCamera: async value => { nodes['feed-video-source'].value = value; await nodes['feed-video-source'].dispatch('change'); await tick(); },
    cameraReady: () => cameraResolve(), consumeReady: () => consumeResolve(),
    visibility: hidden => { doc.hidden = hidden; callbacks.visibilitychange(); },
  };
}

test('advertising a feed does not receive video until expanded; audio controls stay below', async () => {
  const h = harness(); await tick();
  assert.equal(h.button.textContent, '🎧');
  assert(h.controller.announce(h.payload));
  assert.equal(h.button.textContent, '🎥'); assert.equal(h.button.attributes.role, 'button'); assert(h.panel.hidden); assert.equal(h.events.length, 0);
  h.button.dispatch('click'); await tick();
  assert.equal(h.events.filter(e => e.event === 'consume').length, 1);
  assert.equal(h.events.filter(e => e.event === 'resume-consumer').length, 1);
  assert(!h.panel.hidden); assert.equal(h.row.children[0], h.panel);
  assert(h.row.classList.contains('feed-video-expanded'));
  h.button.dispatch('click'); assert(h.consumers[0].closed); assert(h.panel.hidden);
});

test('Stop, hidden layers and background release video; resuming consumes again', async () => {
  const h = harness(); h.controller.announce(h.payload); h.button.dispatch('click'); await tick();
  h.setStopped(true); assert(h.consumers[0].closed);
  h.setStopped(false); await tick(); assert.equal(h.consumers.length, 2);
  h.row.classList.add('layer-hidden'); h.controller.syncVisibility(); assert(h.consumers[1].closed);
  h.row.classList.remove('layer-hidden'); h.controller.syncVisibility(); await tick();
  h.visibility(true); assert(h.consumers[2].closed);
  h.visibility(false); await tick(); assert.equal(h.consumers.length, 4);
  h.controller.resetReceiving(); assert(h.consumers[3].closed); assert.equal(h.button.textContent, '🎧');
});

test('collapsing while subscription is pending closes the eventual server consumer', async () => {
  const h = harness({ deferConsume: true });
  h.controller.announce(h.payload); h.button.dispatch('click'); await tick();
  h.button.dispatch('click'); h.consumeReady(); await tick();
  assert.equal(h.consumers.length, 0);
  assert(h.events.some(e => e.event === 'close-consumer'));
});

test('producer replacement, lost announcements, target removal and rerenders do not retain stale video', async () => {
  const h = harness(); h.controller.announce(h.payload); h.button.dispatch('click'); await tick();
  h.controller.announce({ ...h.payload, producerId: 'v2' }); await tick();
  assert(h.consumers[0].closed); assert.equal(h.consumers.length, 2);
  const row = element(); const icon = element(); icon.replaceWith = () => {}; row.querySelector = () => icon;
  h.controller.attachTarget(row, 'feed-7', 'Program');
  assert.equal(row.children[0], h.panel); // reuse the playing element, not a competing consumer
  h.controller.syncVisibility(); await tick(); assert.equal(h.consumers.length, 2);
  h.controller.reconcile([]); assert(h.consumers[1].closed); assert.equal(h.button.textContent, '🎧');
  h.controller.pruneTargets(new Set()); assert.equal(h.controller.hasExpanded(), false);
});

test('camera is off by default, independently produced, and stopped with the feed', async () => {
  const h = harness(); await tick(); h.setStreaming(true);
  await h.controller.startSending(); assert.equal(h.sends.length, 0);
  await h.selectCamera('camera1'); assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0].options.appData.type, 'feed');
  assert.equal(h.sends[0].options.encodings[0].maxBitrate, 1200000);
  assert(!h.nodes['feed-video-preview'].hidden);
  h.controller.stopSending(); assert(h.sends[0].closed); assert(h.tracks.every(t => t.stopped));
  assert(h.nodes['feed-video-preview'].hidden);
});

test('denied camera access leaves audio running and reports a recoverable video error', async () => {
  const h = harness({ denyCamera: true }); await tick(); h.setStreaming(true);
  await h.selectCamera('default');
  assert.match(h.nodes['feed-video-status'].textContent, /audio continues: Permission denied/);
  assert.equal(h.sends.length, 0);
});

test('stopping during camera permission closes late tracks instead of silently starting video', async () => {
  const h = harness({ deferCamera: true }); await tick(); h.setStreaming(true);
  await h.selectCamera('default'); h.setStreaming(false); h.controller.stopSending();
  h.cameraReady(); await tick();
  assert.equal(h.sends.length, 0); assert(h.tracks.every(t => t.stopped));
});

test('duplicate availability updates while consume is pending do not cancel or duplicate the subscription', async () => {
  const h = harness({ deferConsume: true });
  h.controller.announce(h.payload); h.button.dispatch('click'); await tick();
  h.controller.announce({ ...h.payload }); h.consumeReady(); await tick();
  assert.equal(h.consumers.length, 1); assert(!h.consumers[0].closed);
  assert.equal(h.events.filter(e => e.event === 'consume').length, 1);
});

test('a consumer closed before its acknowledgement is not attached to the player', async () => {
  const h = harness({ deferConsume: true });
  h.controller.announce(h.payload); h.button.dispatch('click'); await tick();
  h.controller.consumerClosed('c1'); h.consumeReady(); await tick();
  assert.equal(h.consumers.length, 0);
});
