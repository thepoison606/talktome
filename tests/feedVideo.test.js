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
    showModal() { this.open = true; }, close() { this.open = false; listeners.close?.(); }, focus() {},
  };
}
function harness({ deferConsume = false, deferTransport = false, deferCamera = false, denyCamera = false, permissionGated = false, allowed = true } = {}) {
  const events = [], consumers = [], tracks = [], sends = [], callbacks = {}, cameraRequests = [], videoTransports = [];
  let consumerCount = 0;
  let cameraPermission = !permissionGated;
  const nodes = Object.fromEntries(['feed-video-source', 'feed-video-preview', 'feed-video-status', 'feed-camera-picker', 'feed-camera-picker-list', 'feed-camera-picker-status', 'feed-camera-picker-close'].map(id => [id, element()]));
  const doc = { hidden: false, getElementById: id => nodes[id], createElement: element,
    addEventListener: (event, fn) => { callbacks[event] = fn; },
    defaultView: { addEventListener: (event, fn) => { callbacks[event] = fn; } } };
  let stopped = false, streaming = false, cameraResolve, consumeResolve, transportResolve;
  const socket = { connected: true, emit(event, data, done) {
    events.push({ event, data });
    if (event === 'consume') {
      const result = { id: `c${++consumerCount}`, producerId: data.producerId, kind: 'video', rtpParameters: {} };
      if (deferConsume) consumeResolve = () => done(result); else done(result);
    } else if (event === 'create-video-recv-transport') {
      const complete = () => done({ id: `video-transport-${videoTransports.length + 1}` });
      if (deferTransport) transportResolve = complete; else complete();
    }
    else done?.(event === 'resume-consumer' ? undefined : { ok: true });
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
    cameraPermission = true;
    const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track);
    return { getTracks: () => [track], getVideoTracks: () => [track] };
  };
  const mediaDevices = { enumerateDevices: async () => cameraPermission
      ? [{ kind: 'videoinput', deviceId: 'camera1', label: 'Webcam' }, { kind: 'videoinput', deviceId: 'camera2', label: 'USB Camera' }]
      : [{ kind: 'videoinput', deviceId: '', label: '' }],
    async getUserMedia(options) {
      assert.equal(options.audio, false); cameraRequests.push(options);
      if (denyCamera) throw new Error('Permission denied');
      if (deferCamera) return new Promise(resolve => { cameraResolve = () => resolve(makeCamera()); });
      return makeCamera();
    } };
  const device = { canProduce: () => true, rtpCapabilities: {}, createRecvTransport(params) {
    const transport = { id: params.id, closed: false, on() {}, consume: params => recv.consume(params), close() { this.closed = true; } };
    videoTransports.push(transport); return transport;
  } };
  const controller = createController({ socket, getSession: () => ({ kind: 'feed', feedId: 7 }),
    getDevice: () => device,
    getSendTransport: () => send, getRecvTransport: () => recv,
    isStreaming: () => streaming, isStopped: () => stopped, onLayoutChange() {},
    document: doc, mediaDevices, makeStream: items => ({ items }),
  });
  controller.setAllowed(allowed);
  const row = element(); const icon = element(); row.querySelector = () => icon;
  let button; icon.replaceWith = replacement => { button = replacement; };
  controller.attachTarget(row, 'feed-7', 'Program');
  const panel = row.children[0];
  const payload = { producerId: 'v1', kind: 'video', appData: { type: 'feed', id: 7 } };
  return { controller, events, consumers, row, button, panel, payload, doc, nodes, tracks, sends, cameraRequests, videoTransports, recv, callbacks,
    setStopped(value) { stopped = value; controller.syncVisibility(); },
    setStreaming(value) { streaming = value; },
    openCameraPicker: () => nodes['feed-video-source'].dispatch('click'),
    selectCamera: async value => {
      await nodes['feed-video-source'].dispatch('click');
      const option = nodes['feed-camera-picker-list'].children.find(option => option.value === value);
      assert(option, `Camera option ${value} is available`);
      option.dispatch('click'); await tick();
    },
    transportReady: () => transportResolve(), cameraReady: () => cameraResolve(), consumeReady: () => consumeResolve(),
    visibility: hidden => { doc.hidden = hidden; callbacks.visibilitychange(); },
  };
}

test('advertising a feed does not receive video until expanded; audio controls stay below', async () => {
  const h = harness(); await tick();
  assert.equal(h.button.textContent, '🎧');
  assert(h.controller.announce(h.payload));
  assert.equal(h.button.textContent, '📺'); assert.equal(h.button.attributes.role, 'button'); assert(h.panel.hidden); assert.equal(h.events.length, 0);
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

test('Safari first opening requests permission and shows every camera without publishing a default source', async () => {
  const h = harness({ permissionGated: true }); await tick(); h.setStreaming(true);
  assert.equal(h.cameraRequests.length, 0, 'do not request camera permission at page load');
  await h.openCameraPicker();
  assert(h.nodes['feed-camera-picker'].open);
  assert.deepEqual(h.nodes['feed-camera-picker-list'].children.map(option => option.value), ['', 'default', 'camera1', 'camera2']);
  assert.equal(h.sends.length, 0, 'permission probe must never be broadcast');
  assert.equal(h.nodes['feed-video-source'].textContent, 'Off — audio only');
  assert(h.tracks.every(track => track.stopped), 'release the temporary permission probe');
  const usb = h.nodes['feed-camera-picker-list'].children.find(option => option.value === 'camera2');
  usb.dispatch('click'); await tick();
  assert.equal(h.sends.length, 1);
  assert.equal(h.cameraRequests[1].video.deviceId.exact, 'camera2');
  assert.equal(h.nodes['feed-camera-picker'].open, false);
});

test('closing the chooser while permission is pending stops late camera tracks', async () => {
  const h = harness({ permissionGated: true, deferCamera: true }); await tick();
  const opening = h.openCameraPicker(); await tick();
  h.nodes['feed-camera-picker-close'].dispatch('click'); h.cameraReady();
  await opening; await tick();
  assert(h.tracks.every(track => track.stopped)); assert.equal(h.sends.length, 0);
  assert.equal(h.nodes['feed-camera-picker'].open, false);
});

test('camera chooser permission denial keeps audio-only selection and offers Off', async () => {
  const h = harness({ permissionGated: true, denyCamera: true }); await tick();
  await h.openCameraPicker();
  assert.match(h.nodes['feed-camera-picker-status'].textContent, /Permission denied/);
  assert.deepEqual(h.nodes['feed-camera-picker-list'].children.map(option => option.value), ['']);
  assert.equal(h.sends.length, 0); assert.equal(h.nodes['feed-video-source'].textContent, 'Off — audio only');
});

test('disabled feeds cannot request camera access; revoking permission closes video but keeps the selection', async () => {
  const h = harness({ allowed: false }); h.setStreaming(true);
  await h.openCameraPicker(); await h.controller.startSending();
  assert.equal(h.cameraRequests.length, 0); assert.equal(h.sends.length, 0);
  assert.equal(h.nodes['feed-video-source'].disabled, true);
  h.controller.setAllowed(true); await h.selectCamera('camera1');
  assert.equal(h.sends.length, 1);
  h.controller.setAllowed(false);
  assert(h.tracks.every(track => track.stopped)); assert(h.sends[0].closed);
  assert.match(h.nodes['feed-video-status'].textContent, /disabled by administrator/);
  h.controller.setAllowed(true); await tick();
  assert.equal(h.sends.length, 2);
});

test('revoking permission during camera permission closes late tracks without producing video', async () => {
  const h = harness({ deferCamera: true }); h.setStreaming(true);
  await h.selectCamera('default'); h.controller.setAllowed(false);
  h.cameraReady(); await tick(); assert(h.tracks.every(track => track.stopped));
  assert.equal(h.sends.length, 0);
});


test('background and pagehide release only the dedicated video connection and detach the picture', async () => {
  const h = harness(); h.controller.announce(h.payload); h.button.dispatch('click'); await tick();
  assert.equal(h.videoTransports.length, 1);
  assert(h.events.filter(e => e.event === 'consume').every(e => e.data.transportId === h.videoTransports[0].id));
  const video = h.panel.children[0];
  video.pause = () => assert.equal(video.srcObject, null, 'detach before pausing Safari playback');
  h.visibility(true);
  assert.equal(h.videoTransports[0].closed, true);
  assert.equal(h.recv.closed, false, 'the audio connection must survive');
  assert(h.events.some(e => e.event === 'close-video-recv-transport'));
  h.visibility(false); await tick();
  assert.equal(h.videoTransports.length, 2); assert.equal(h.consumers.length, 2);
  h.callbacks.pagehide();
  assert(h.videoTransports[1].closed); assert.equal(h.recv.closed, false);
  h.callbacks.pageshow(); await tick();
  assert.equal(h.videoTransports.length, 3);
  h.setStopped(true); h.visibility(true); h.visibility(false); await tick();
  assert.equal(h.videoTransports.length, 3, 'a manually stopped feed stays stopped');
});


test('locking while a video connection is pending discards the late video transport without touching audio', async () => {
  const h = harness({ deferTransport: true });
  h.controller.announce(h.payload); h.button.dispatch('click'); await tick();
  h.visibility(true);
  h.transportReady(); await tick();
  assert.equal(h.videoTransports.length, 0);
  assert.equal(h.consumers.length, 0);
  assert(h.events.some(e => e.event === 'close-video-recv-transport' && e.data.transportId));
  assert.equal(h.recv.closed, false);
  h.visibility(false); await tick(); h.transportReady(); await tick();
  assert.equal(h.videoTransports.length, 1); assert.equal(h.consumers.length, 1);
});
