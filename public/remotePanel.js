(function (root) {
  function create() {
    if (location.pathname !== '/panel') return null;
    const userId = Number(new URLSearchParams(location.search).get('userId'));
    const socket = io('/panel', { autoConnect: false, reconnectionDelay: 500, reconnectionDelayMax: 5000 });
    let applying = false;
    let pendingPatch = {};
    let patchTimer = null;
    let pendingCommands = 0;
    let feedbackUntil = 0;
    let queue = Promise.resolve();
    const heldInputs = new Map();
    const panel = {
      socket, userId, state: null, heldInputs,
      get applying() { return applying; },
      get busy() { return pendingCommands > 0 || Object.keys(pendingPatch).length > 0; },
      apply(callback) {
        applying = true;
        try {
          const result = callback();
          if (result?.then) return result.finally(() => { applying = false; });
          applying = false;
          return result;
        } catch (error) { applying = false; throw error; }
      },
      preferenceChanged(key, value) {
        if (applying || !panel.state || !TalktomeRemotePanelState.isPreferenceKey(key, userId)) return;
        pendingPatch[key] = value;
        clearTimeout(patchTimer);
        patchTimer = setTimeout(() => {
          const patch = pendingPatch;
          pendingPatch = {};
          panel.command({ kind: 'preferences', patch });
        }, 120);
      },
      command(command) {
        pendingCommands++;
        panel.status('Applying…');
        const promise = queue.then(() => new Promise((resolve) => {
          if (!socket.connected) return resolve({ ok: false, error: 'Server disconnected' });
          socket.timeout(8000).emit('panel-command', command, (error, result) => {
            resolve(error ? { ok: false, error: 'Client did not confirm the change' } : result || { ok: false });
          });
        })).then((result) => {
          pendingCommands--;
          feedbackUntil = Date.now() + 4000;
          panel.status(result.ok ? result.message || (result.offline ? 'Offline · saved for reconnect' : 'Applied') : result.error || 'Change failed', !result.ok);
          panel.needsRefresh = true;
          if (result.state) panel.receive(result.state);
          return result;
        });
        queue = promise.catch(() => {});
        return promise;
      },
      status(text, error = false) {
        const label = document.getElementById('remote-panel-status');
        if (label) { label.textContent = text; label.classList.toggle('is-error', error); }
      },
      receive(state) {
        if (panel.state && state.panelSettings.revision < panel.state.panelSettings.revision) return;
        panel.state = state;
        panel.onState?.(state);
        if (!pendingCommands && Date.now() > feedbackUntil) panel.status(state.online ? state.clientConnected ? 'Client online' : 'Waiting for client state…' : 'Client offline');
      },
      start(onState) {
        panel.onState = onState;
        socket.on('panel-state', panel.receive);
        socket.on('panel-error', result => panel.status(result.error, true));
        socket.on('connect', () => {
          socket.emit('panel-watch', { userId }, (result = {}) => {
            if (!result.ok) panel.status(result.error || 'Unable to open panel', true);
          });
        });
        socket.on('disconnect', () => panel.status('Server disconnected', true));
        socket.on('connect_error', error => panel.status(error.message || 'Admin login required', true));
        socket.connect();
      },
    };
    return panel;
  }
  root.TalktomeRemotePanel = { create };
})(window);
