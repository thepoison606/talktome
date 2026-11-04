/* Optional browser-only feed video. Kept separate from the intercom audio graph. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TalktomeFeedVideo = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CAMERA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="12" height="14" rx="2"/><path d="m15 10 6-4v12l-6-4z"/></svg>';
  const isVideo = payload => payload?.kind != null
    ? payload.kind === 'video' : payload?.appData?.mediaKind === 'video';
  const keyFor = payload => payload?.appData?.type === 'feed' ? `feed-${payload.appData.id}` : null;

  function createController({ socket, getSession, getDevice, getSendTransport, getRecvTransport,
    isStreaming, isStopped, onLayoutChange, enabled = true,
    document: doc = globalThis.document, mediaDevices = globalThis.navigator?.mediaDevices,
    makeStream = tracks => new MediaStream(tracks) }) {
    const feeds = new Map();
    const select = doc.getElementById('feed-video-source');
    const preview = doc.getElementById('feed-video-preview');
    const senderStatus = doc.getElementById('feed-video-status');
    let cameraStream = null, videoProducer = null, sendGeneration = 0;
    let selectedCamera = ''; // Intentionally off after each page load; never silently enable a camera.
    let receiveGeneration = 0;
    const earlyClosedConsumers = new Set();
    const closeRemote = id => { if (id && socket.connected) socket.emit('close-consumer', { consumerId: id }, () => {}); };
    const request = (event, payload) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 8000);
      socket.emit(event, payload, result => {
        clearTimeout(timer);
        if (result?.error || (event === 'consume' && !result?.id)) reject(new Error(result?.error || `${event} failed`));
        else resolve(result || {});
      });
    });
    const setSenderStatus = text => { if (senderStatus) senderStatus.textContent = text; };

    async function refreshCameras() {
      if (!select || !enabled) return;
      try {
        const devices = await mediaDevices?.enumerateDevices?.() || [];
        select.replaceChildren();
        for (const [value, label] of [['', 'Off — audio only'], ['default', 'Default camera'],
          ...devices.filter(d => d.kind === 'videoinput' && d.deviceId)
            .map((d, i) => [d.deviceId, d.label || `Camera ${i + 1}`])]) {
          const option = doc.createElement('option');
          option.value = value; option.textContent = label; select.appendChild(option);
        }
        // Keep an unplugged selection visible, so it is never silently replaced.
        if (selectedCamera && !Array.from(select.options).some(o => o.value === selectedCamera)) {
          const option = doc.createElement('option'); option.value = selectedCamera;
          option.textContent = 'Selected camera (unavailable)'; select.appendChild(option);
        }
        select.value = selectedCamera;
      } catch (error) { setSenderStatus(`Camera list unavailable: ${error.message}`); }
    }

    function stopSending() {
      sendGeneration++;
      const previous = videoProducer; videoProducer = null;
      if (previous) {
        if (socket.connected) socket.emit('producer-close', { producerId: previous.id }, () => {});
        try { previous.close(); } catch {}
      }
      cameraStream?.getTracks().forEach(track => track.stop()); cameraStream = null;
      if (preview) { preview.srcObject = null; preview.hidden = true; }
      setSenderStatus(selectedCamera ? 'Camera selected — starts with the feed' : 'Audio only');
    }

    async function startSending() {
      stopSending();
      if (!enabled || !selectedCamera || getSession()?.kind !== 'feed' || !isStreaming()) return;
      const generation = sendGeneration;
      let captured = null;
      try {
        if (!getDevice()?.canProduce('video')) throw new Error('This browser or server does not support video');
        setSenderStatus('Starting camera…');
        captured = await mediaDevices.getUserMedia({ audio: false, video: {
          width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 },
          frameRate: { ideal: 15, max: 15 },
          ...(selectedCamera !== 'default' ? { deviceId: { exact: selectedCamera } } : {}),
        } });
        if (generation !== sendGeneration || !isStreaming()) { captured.getTracks().forEach(t => t.stop()); return; }
        cameraStream = captured;
        const track = captured.getVideoTracks()[0];
        if (!track) throw new Error('No camera video track available');
        const created = await getSendTransport().produce({ track, stopTracks: false,
          encodings: [{ maxBitrate: 1200000, maxFramerate: 15 }],
          appData: { type: 'feed', id: getSession().feedId },
        });
        if (generation !== sendGeneration || !isStreaming()) {
          if (socket.connected) socket.emit('producer-close', { producerId: created.id }, () => {});
          created.close(); captured.getTracks().forEach(t => t.stop()); return;
        }
        videoProducer = created;
        if (preview) {
          preview.srcObject = captured; preview.hidden = false;
          preview.play().catch(() => {});
        }
        const ended = () => {
          if (videoProducer !== created) return;
          stopSending(); setSenderStatus('Camera stopped — audio continues. Select a camera to retry.');
        };
        created.on('trackended', ended);
        created.on('transportclose', ended);
        setSenderStatus('Camera live');
        refreshCameras();
      } catch (error) {
        captured?.getTracks().forEach(t => t.stop());
        if (generation === sendGeneration) {
          stopSending(); setSenderStatus(`Video unavailable — audio continues: ${error.message}`);
        }
      }
    }

    function closeReception(state) {
      state.token++;
      state.pending = false;
      const consumer = state.consumer; state.consumer = null;
      if (consumer) { closeRemote(consumer.id); try { consumer.close(); } catch {} }
      if (state.video) { state.video.pause(); state.video.srcObject = null; }
    }
    function shouldReceive(state) {
      return enabled && state.expanded && state.payload && !isStopped(state.key)
        && state.row?.isConnected && !state.row.classList.contains('layer-hidden')
        && !doc.hidden && getRecvTransport() && !getRecvTransport().closed;
    }
    function render(state) {
      if (!state.row) return;
      const available = Boolean(state.payload);
      state.button.hidden = !available;
      state.button.setAttribute('aria-expanded', String(state.expanded && available));
      state.button.title = state.expanded ? 'Hide video' : 'Show video';
      state.button.setAttribute('aria-label', `${state.button.title}: ${state.name}`);
      state.panel.hidden = !available || !state.expanded;
      state.row.classList.toggle('feed-video-expanded', available && state.expanded);
      state.message.textContent = state.error || (isStopped(state.key) ? 'Feed stopped' : state.consumer ? '' : 'Connecting video…');
      state.message.hidden = !state.message.textContent;
    }
    async function receive(state) {
      if (!shouldReceive(state) || state.consumer || state.pending) return;
      state.pending = true; state.error = ''; render(state);
      const token = state.token, generation = receiveGeneration;
      const payload = state.payload, transport = getRecvTransport();
      let consumer = null, params = null;
      const current = () => generation === receiveGeneration && token === state.token
        && state.payload?.producerId === payload.producerId && shouldReceive(state);
      try {
        params = await request('consume', { producerId: payload.producerId, rtpCapabilities: getDevice().rtpCapabilities });
        if (!current() || earlyClosedConsumers.delete(params.id)) { closeRemote(params.id); return; }
        if (params.kind !== 'video') throw new Error('Expected a video stream');
        consumer = await transport.consume(params);
        if (!current() || earlyClosedConsumers.delete(consumer.id)) { closeRemote(consumer.id); consumer.close(); return; }
        state.consumer = consumer;
        state.video.srcObject = makeStream([consumer.track]);
        await request('resume-consumer', { consumerId: consumer.id });
        if (!current()) return;
        consumer.resume();
        state.video.play().catch(() => {
          if (current() && state.consumer === consumer) { state.error = 'Tap the video to play'; render(state); }
        });
        consumer.on('transportclose', () => {
          if (state.consumer === consumer) { closeReception(state); render(state); }
        });
      } catch (error) {
        if (consumer) { closeRemote(consumer.id); try { consumer.close(); } catch {} }
        else if (params?.id) closeRemote(params.id);
        if (token === state.token && generation === receiveGeneration) {
          state.consumer = null; state.error = `Video unavailable: ${error.message}`;
        }
      } finally {
        if (token === state.token && generation === receiveGeneration) { state.pending = false; render(state); }
      }
    }
    function syncVisibility() {
      for (const state of feeds.values()) {
        if (shouldReceive(state)) receive(state);
        else if (state.consumer || state.pending) closeReception(state);
        render(state);
      }
    }
    function attachTarget(row, key, name) {
      if (!enabled) return;
      let state = feeds.get(key);
      if (!state) {
        state = { key, token: 0, expanded: false, payload: null, consumer: null, pending: false };
        feeds.set(key, state);
      }
      state.row = row; state.name = name;
      if (!state.button) {
        state.button = doc.createElement('button'); state.button.type = 'button';
        state.button.className = 'feed-video-toggle'; state.button.innerHTML = CAMERA_ICON;
        state.button.addEventListener('pointerdown', event => event.stopPropagation());
        state.button.addEventListener('click', event => {
          event.stopPropagation(); state.expanded = !state.expanded; state.error = '';
          render(state); onLayoutChange(key); syncVisibility();
        });
        state.panel = doc.createElement('div'); state.panel.className = 'feed-video-panel';
        state.panel.id = `${key}-video`;
        state.button.setAttribute('aria-controls', state.panel.id);
        state.video = doc.createElement('video');
        state.video.autoplay = true; state.video.muted = true; state.video.defaultMuted = true; state.video.playsInline = true;
        state.video.setAttribute('playsinline', '');
        state.video.setAttribute('aria-label', `Video: ${name}`);
        state.video.addEventListener('click', () => {
          state.video.play().then(() => { state.error = ''; render(state); }).catch(() => {});
        });
        state.message = doc.createElement('span'); state.message.setAttribute('role', 'status');
        state.panel.append(state.video, state.message);
      }
      row.querySelector('.target-label-row').appendChild(state.button);
      row.prepend(state.panel); render(state);
    }
    function announce(payload) {
      if (!isVideo(payload)) return false;
      const key = keyFor(payload);
      if (!enabled || !key) return true;
      let state = feeds.get(key);
      if (!state) {
        state = { key, token: 0, expanded: false, payload: null, consumer: null, pending: false };
        feeds.set(key, state);
      }
      const changed = state.payload?.producerId !== payload.producerId;
      if (changed) closeReception(state);
      state.payload = payload; render(state);
      if (changed && state.expanded && state.row?.isConnected) onLayoutChange();
      syncVisibility(); return true;
    }
    function removeProducer(producerId) {
      for (const state of feeds.values()) {
        if (state.payload?.producerId !== producerId) continue;
        closeReception(state); state.payload = null; render(state); onLayoutChange(); return true;
      }
      return false;
    }
    function reconcile(payloads) {
      const ids = new Set(payloads.filter(isVideo).map(p => p.producerId));
      for (const state of feeds.values()) {
        if (state.payload && !ids.has(state.payload.producerId)) removeProducer(state.payload.producerId);
      }
    }
    function pruneTargets(allowedKeys) {
      for (const [key, state] of feeds) {
        if (allowedKeys.has(key)) continue;
        closeReception(state); feeds.delete(key);
      }
    }
    function resetReceiving() {
      receiveGeneration++;
      earlyClosedConsumers.clear();
      for (const state of feeds.values()) {
        closeReception(state); state.payload = null; render(state);
      }
      onLayoutChange();
    }
    function consumerClosed(id) {
      for (const state of feeds.values()) {
        if (state.consumer?.id !== id) continue;
        closeReception(state); render(state); return true;
      }
      if (id) {
        earlyClosedConsumers.add(id);
        if (earlyClosedConsumers.size > 128) earlyClosedConsumers.delete(earlyClosedConsumers.values().next().value);
      }
      return false;
    }
    if (select) {
      select.disabled = !enabled || !mediaDevices?.getUserMedia;
      select.addEventListener('change', () => {
        selectedCamera = select.value;
        if (isStreaming()) startSending(); else stopSending();
      });
      refreshCameras();
    }
    mediaDevices?.addEventListener?.('devicechange', refreshCameras);
    doc.addEventListener('visibilitychange', syncVisibility);
    return { startSending, stopSending, attachTarget, announce, removeProducer, reconcile,
      pruneTargets, syncVisibility, resetReceiving, consumerClosed,
      hasExpanded: () => Array.from(feeds.values()).some(s => s.payload && s.expanded && s.row?.isConnected) };
  }
  return { createController, isVideo, keyFor };
});
