/* Transport adapter only: rendering, hotkeys, gestures and menus are the
   server Webclient's public/client.js and public/remotePanel.js. */
(function (root) {
  'use strict';
  const handlers = new Map();
  const held = new Map();
  const inputPrefix = `local-panel:${root.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}:`;
  let connected = false, timer = null, pending = false;
  let visible = !root.parent?.document?.body?.dataset?.view || root.parent.document.body.dataset.view === 'remote';
  const target = key => {
    if (!key) return null;
    const [kind, id] = Object.entries(key)[0];
    return { targetType: kind.toLowerCase(), targetId: Number(id) };
  };
  function stateOf(result) {
    const snap = result.snapshot;
    const report = result.report || { storage: {}, revision: 0, runtime: {} };
    const users = new Map();
    const user = (id, name, online) => users.set(Number(id), {
      userId: Number(id), name, socketId: online ? `headless-user:${id}` : null,
      kind: 'user', online: Boolean(online),
    });
    const targets = (snap.targets || []).map(item => {
      const identity = target(item.key);
      if (identity.targetType === 'user') user(identity.targetId, item.name, item.online);
      const members = (item.members || []).map(member => {
        user(member.user_id, member.name, member.online);
        return { userId: member.user_id, name: member.name };
      });
      return { ...identity, name: item.name, canTalk: item.can_talk, members };
    });
    const addressed = (identity, name) => identity ? {
      ...identity, fromName: name || '', canReply: true,
      replyTargetType: identity.targetType, replyTargetId: identity.targetId,
    } : null;
    const online = ['ready', 'registered'].includes(snap.connection) && !snap.server_not_responding;
    return {
      userId: snap.user_id, name: snap.user_name, online, clientConnected: true,
      connectionType: 'headless', productionId: snap.production,
      productions: snap.productions || [],
      productionName: (snap.productions || []).find(p => String(p.id) === String(snap.production))?.name || null,
      targets, users: [...users.values()], settings: result.settings || {},
      targetAudioStates: (snap.targets || []).map(item => ({ ...target(item.key), volume: item.volume, muted: item.muted })),
      panelSettings: { revision: report.revision || 0, storage: report.storage || {} },
      runtime: report.runtime,
      activeFeedKeys: (snap.targets || []).filter(item => item.key.Feed != null && item.online).map(item => `feed-${item.key.Feed}`),
      incomingTalkState: {
        addressedNow: (snap.incoming || []).map(item => addressed(target(item.target), item.from_name)).filter(Boolean),
        replyTarget: addressed(target(snap.reply_target), snap.reply_name),
      },
      capabilities: { rearrangeTargets: false },
    };
  }
  function fire(event, ...args) { for (const handler of handlers.get(event) || []) handler(...args); }
  async function request(command) {
    const response = await fetch('/api/local-panel', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
    });
    if (!response.ok) throw new Error(response.status === 401 ? 'Headless login required' : `Headless request failed (${response.status})`);
    return response.json();
  }
  function receive(result) {
    if (!result.snapshot) return;
    fire('panel-state', stateOf(result));
  }
  async function poll() {
    if (pending || !connected || !visible) return;
    pending = true;
    try { receive(await request({ kind: 'snapshot' })); }
    catch (error) { fire('panel-error', { error: error.message }); }
    finally { pending = false; }
  }
  function releaseHeld() {
    for (const command of held.values()) {
      const release = { ...command, action: 'release' };
      // keepalive also covers closing the containing admin tab.
      fetch('/api/local-panel', { method: 'POST', credentials: 'same-origin', keepalive: true,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(release) }).catch(() => {});
    }
    held.clear();
  }
  const socket = {
    get connected() { return connected; },
    on(event, handler) { const list = handlers.get(event) || []; list.push(handler); handlers.set(event, list); return socket; },
    onAny() { return socket; },
    off(event, handler) { handlers.set(event, (handlers.get(event) || []).filter(h => h !== handler)); return socket; },
    timeout() { return socket; },
    emit(event, command, acknowledge) {
      if (event === 'panel-watch') { acknowledge?.({ ok: true }); void poll(); return socket; }
      if (event !== 'panel-command') { if (typeof acknowledge === 'function') acknowledge({ ok: true }); return socket; }
      const outgoing = { ...command };
      if (outgoing.kind === 'talk') {
        outgoing.inputKey = inputPrefix + (outgoing.inputKey || 'main');
        if (outgoing.action === 'press') held.set(outgoing.inputKey, outgoing);
        if (outgoing.action === 'release') held.delete(outgoing.inputKey);
      }
      request(outgoing).then(result => {
        // remotePanel.js applies state after its own command queue is idle.
        acknowledge?.(null, { ...result, state: result.snapshot ? stateOf(result) : undefined });
      }).catch(error => acknowledge?.(null, { ok: false, error: error.message }));
      return socket;
    },
    connect() {
      if (connected) return socket;
      connected = true; fire('connect'); timer = setInterval(poll, 250); return socket;
    },
    disconnect() { releaseHeld(); connected = false; clearInterval(timer); fire('disconnect'); return socket; },
  };
  socket.io = { on() {} };
  socket.volatile = socket;
  root.addEventListener('blur', releaseHeld);
  root.addEventListener('pagehide', releaseHeld);
  root.document?.addEventListener('visibilitychange', () => { if (root.document.hidden) releaseHeld(); });
  root.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== root.parent) return;
    if (event.data?.type === 'headless-panel-hidden') { visible = false; releaseHeld(); }
    if (event.data?.type === 'headless-panel-visibility') {
      visible = Boolean(event.data.visible);
      if (visible) void poll(); else releaseHeld();
    }
  });
  root.TalktomeLocalPanel = { socket, close() {
    releaseHeld();
    if (root.frameElement) root.frameElement.dataset.userId = '';
    if (root.parent === root) location.replace('/#status');
    else root.parent.location.hash = 'status';
  }, stateOf };
})(window);
