/* Optional browser-only feed video. Kept separate from the intercom audio graph. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TalktomeFeedVideo = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const isVideo = payload => payload?.kind != null
    ? payload.kind === 'video' : payload?.appData?.mediaKind === 'video';
  const keyFor = payload => payload?.appData?.type === 'feed' ? `feed-${payload.appData.id}` : null;

  function createController({ socket, getSession, getDevice, getSendTransport, getRecvTransport,
    isStreaming, isStopped, onLayoutChange, enabled = true,
    document: doc = globalThis.document, mediaDevices = globalThis.navigator?.mediaDevices,
    makeStream = tracks => new MediaStream(tracks) }) {
    const feeds = new Map();
    const sourceButton = doc.getElementById('feed-video-source');
    const cameraPicker = doc.getElementById('feed-camera-picker');
    const cameraChoices = doc.getElementById('feed-camera-picker-list');
    const cameraPickerStatus = doc.getElementById('feed-camera-picker-status');
    const preview = doc.getElementById('feed-video-preview');
    const senderStatus = doc.getElementById('feed-video-status');
    let cameraStream = null, videoProducer = null, sendGeneration = 0;
    let selectedCamera = ''; // Intentionally off after each page load; never silently enable a camera.
    let cameras = [], pickerGeneration = 0, pickerBusy = false, cameraProbe = null;
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

    function updateSourceLabel() {
      if (sourceButton) sourceButton.textContent = !selectedCamera ? 'Off — audio only'
        : selectedCamera === 'default' ? 'Default camera'
        : cameras.find(camera => camera.deviceId === selectedCamera)?.label || 'Selected camera (unavailable)';
    }

    function renderCameraChoices({ cameraAccess = true } = {}) {
      if (!cameraChoices) return;
      cameraChoices.replaceChildren();
      const options = [['', 'Off — audio only'], ...(cameraAccess ? [['default', 'Default camera'],
        ...cameras.map((camera, index) => [camera.deviceId, camera.label || `Camera ${index + 1}`])] : [])];
      let activeChoice;
      for (const [value, label] of options) {
        const option = doc.createElement('button'); option.type = 'button'; option.value = value;
        option.textContent = label; option.setAttribute('aria-pressed', String(value === selectedCamera));
        option.addEventListener('click', () => {
          selectedCamera = value; updateSourceLabel(); cameraPicker.close();
          if (isStreaming()) startSending(); else stopSending();
        });
        cameraChoices.appendChild(option);
        if (value === selectedCamera) activeChoice = option;
      }
      activeChoice?.focus?.();
    }

    async function refreshCameras() {
      if (!sourceButton || !enabled) return;
      const devices = await mediaDevices?.enumerateDevices?.() || [];
      const discovered = devices.filter(device => device.kind === 'videoinput' && device.deviceId);
      // Safari may hide labels again when the temporary permission probe ends.
      // Keep the full snapshot while this chooser remains open.
      if (!cameraPicker?.open || discovered.some(camera => camera.label) || !cameras.some(camera => camera.label)) cameras = discovered;
      updateSourceLabel();
      if (cameraPicker?.open && !pickerBusy) renderCameraChoices();
    }

    async function openCameraPicker() {
      if (!enabled || sourceButton.disabled || getSession()?.kind !== 'feed' || cameraPicker.open) return;
      const generation = ++pickerGeneration;
      pickerBusy = true; cameraChoices.replaceChildren();
      cameraPickerStatus.textContent = 'Loading cameras…';
      cameraPicker.showModal();
      let probe;
      const current = () => generation === pickerGeneration && cameraPicker.open;
      try {
        await refreshCameras();
        if (!current()) return;
        // Safari intentionally withholds the real list until camera access is
        // granted. Probe only after opening this chooser, never at page load,
        // and never publish the probe as the feed's video source.
        if (!cameraStream && !cameras.some(camera => camera.label)) {
          cameraPickerStatus.textContent = 'Allow camera access to see the available cameras…';
          probe = await mediaDevices.getUserMedia({ audio: false, video: true });
          if (!current()) return;
          cameraProbe = probe;
          await refreshCameras();
        }
        if (!current()) return;
        cameraPickerStatus.textContent = cameras.length ? '' : 'No cameras found.';
        renderCameraChoices();
      } catch (error) {
        if (current()) {
          cameraPickerStatus.textContent = `Camera access unavailable: ${error.message}`;
          renderCameraChoices({ cameraAccess: false });
        }
      } finally {
        probe?.getTracks().forEach(track => track.stop());
        if (cameraProbe === probe) cameraProbe = null;
        if (generation === pickerGeneration) pickerBusy = false;
      }
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
        refreshCameras().catch(() => {});
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
      state.button.textContent = available ? '🎥' : '🎧';
      state.button.setAttribute('role', available ? 'button' : 'img');
      state.button.tabIndex = available ? 0 : -1;
      if (available) state.button.setAttribute('aria-expanded', String(state.expanded));
      else state.button.removeAttribute('aria-expanded');
      state.button.title = available ? (state.expanded ? 'Hide video' : 'Show video') : 'Audio feed';
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
        state.button = doc.createElement('div');
        state.button.className = 'feed-icon feed-video-toggle';
        state.button.addEventListener('pointerdown', event => event.stopPropagation());
        const toggleVideo = event => {
          event.stopPropagation();
          if (!state.payload) return;
          state.expanded = !state.expanded; state.error = '';
          render(state); onLayoutChange(key); syncVisibility();
        };
        state.button.addEventListener('click', toggleVideo);
        state.button.addEventListener('keydown', event => {
          if (state.payload && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault(); toggleVideo(event);
          }
        });
        state.panel = doc.createElement('div'); state.panel.className = 'feed-video-panel';
        state.panel.id = `${key}-video`;
        state.button.setAttribute('aria-controls', state.panel.id);
        state.video = doc.createElement('video');
        state.video.autoplay = true; state.video.muted = true; state.video.defaultMuted = true; state.video.playsInline = true;
        state.video.setAttribute('playsinline', '');
        state.video.setAttribute('aria-label', `Video: ${name}`);
        const syncPictureSize = () => {
          const ratio = state.video.videoWidth / state.video.videoHeight;
          if (!Number.isFinite(ratio) || ratio <= 0 || ratio === state.aspectRatio) return;
          state.aspectRatio = ratio;
          state.panel.style.setProperty('--feed-video-aspect', String(ratio));
          onLayoutChange();
        };
        state.video.addEventListener('loadedmetadata', syncPictureSize);
        state.video.addEventListener('resize', syncPictureSize);
        state.video.addEventListener('click', () => {
          state.video.play().then(() => { state.error = ''; render(state); }).catch(() => {});
        });
        state.message = doc.createElement('span'); state.message.setAttribute('role', 'status');
        state.panel.append(state.video, state.message);
      }
      row.querySelector('.feed-icon').replaceWith(state.button);
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
    if (sourceButton) {
      sourceButton.disabled = !enabled || !mediaDevices?.getUserMedia;
      sourceButton.addEventListener('click', openCameraPicker);
      doc.getElementById('feed-camera-picker-close')?.addEventListener('click', () => cameraPicker.close());
      cameraPicker?.addEventListener('close', () => {
        pickerGeneration++; pickerBusy = false;
        cameraProbe?.getTracks().forEach(track => track.stop()); cameraProbe = null;
        sourceButton.focus?.();
      });
      refreshCameras().catch(() => {});
    }
    mediaDevices?.addEventListener?.('devicechange', () => refreshCameras().catch(() => {}));
    doc.addEventListener('visibilitychange', syncVisibility);
    return { startSending, stopSending, attachTarget, announce, removeProducer, reconcile,
      pruneTargets, syncVisibility, resetReceiving, consumerClosed,
      hasExpanded: () => Array.from(feeds.values()).some(s => s.payload && s.expanded && s.row?.isConnected) };
  }
  return { createController, isVideo, keyFor };
});
