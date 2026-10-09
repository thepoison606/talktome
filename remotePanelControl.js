const path = require('node:path');
const { normalizeStorage, mergeStorage } = require('./public/remotePanelState');
const { validateCompleteTargetOrder } = require('./targetOrdering');
const { normalize: normalizeAudioSettings } = require('./public/userAudioSettings');

function installRemotePanelControl(deps) {
  const { app, io, publicDir, requireAdmin, getAdminSession, getUserById,
    findUserPeerByUserId, getUserList, getEnabledProductionsForUser, getPrimaryProduction,
    buildOperatorTargetsForUser, getBridgeTargetsForUser, buildIncomingTalkStateForUser,
    getUserTargetAudioStates, mergeUserTargetAudioStates, getUserPanelSettings, updateUserPanelSettings,
    getResolvedUserAudioSettings, updateUserAudioSettings, updateProductionTargetOrder, notifyTargetChange,
  } = deps;
  const namespace = io.of('/panel');
  const reports = new Map();
  const queues = new Map();
  const validUser = id => {
    const user = getUserById(id);
    if (!Number.isInteger(Number(id)) || Number(id) <= 0 || !user || user.is_superadmin || user.is_guest_profile) {
      throw new Error('User not found');
    }
    return user;
  };
  const authorized = socket => Boolean(getAdminSession({ headers: socket.handshake.headers })?.session?.isGlobalAdmin);
  const savedSettings = userId => {
    const settings = getUserPanelSettings(userId);
    return {
      revision: Number(settings.revision) || 0, storage: normalizeStorage(settings.storage || {}, userId),
      ...(settings.pendingProductionId ? { pendingProductionId: Number(settings.pendingProductionId) } : {}),
    };
  };
  function snapshot(userId) {
    const user = validUser(userId);
    const found = findUserPeerByUserId(userId);
    const settings = savedSettings(userId);
    const productions = getEnabledProductionsForUser(userId).map(({ id, name }) => ({ id, name }));
    const preferred = Number(settings.storage[`activeProduction:${userId}`]);
    const primaryId = getPrimaryProduction()?.id;
    const fallbackProductionId = productions[0]?.id ?? (primaryId && deps.isUserInProduction?.(userId, primaryId) ? primaryId : null);
    const productionId = found?.peer?.productionId ?? (productions.some(p => Number(p.id) === preferred)
      ? preferred : fallbackProductionId);
    const isBridge = Boolean(found?.peer?.isBridgePeer);
    const report = reports.get(Number(userId));
    const fresh = Boolean(found && report?.socketId === found.socketId && Date.now() - report.at < 10000);
    return {
      userId: Number(userId), name: user.name, online: Boolean(found), clientConnected: fresh,
      connectionType: isBridge ? 'bridge' : 'browser', productionId,
      productions, productionName: productions.find(p => Number(p.id) === Number(productionId))?.name || null,
      targets: isBridge ? getBridgeTargetsForUser(userId) : productionId == null ? [] : buildOperatorTargetsForUser(userId, productionId),
      users: getUserList(), settings: getResolvedUserAudioSettings(userId),
      targetAudioStates: getUserTargetAudioStates(userId), panelSettings: settings,
      incomingTalkState: found ? buildIncomingTalkStateForUser(userId) : { addressedNow: [], replyTarget: null },
      runtime: fresh ? report.runtime : null,
    };
  }
  function publish(userId) {
    for (const socket of namespace.sockets.values()) {
      if (socket.data.userId !== Number(userId)) continue;
      if (!authorized(socket)) { socket.disconnect(true); continue; }
      try { socket.emit('panel-state', snapshot(userId)); }
      catch (error) { socket.emit('panel-error', { error: error.message }); }
    }
  }
  function report(peer, payload = {}) {
    if (peer?.kind !== 'user' || !peer.userId) return;
    const settings = savedSettings(peer.userId);
    // A report sent before an admin change must not overwrite that change.
    if (Number(payload.revision || 0) !== settings.revision) return;
    const storage = normalizeStorage(payload.storage || {}, peer.userId);
    if (JSON.stringify(storage) !== JSON.stringify(settings.storage)) {
      updateUserPanelSettings(peer.userId, { ...settings, storage });
    }
    if (Array.isArray(payload.audioStates)) {
      const current = new Map(getUserTargetAudioStates(peer.userId).map(state => [`${state.targetType}:${state.targetId}`, state]));
      const changed = payload.audioStates.filter(state => {
        const previous = current.get(`${state.targetType}:${state.targetId}`);
        return !previous || previous.volume !== state.volume || previous.muted !== state.muted;
      });
      if (changed.length) {
        mergeUserTargetAudioStates(peer.userId, changed);
        deps.targetAudioChanged?.(peer.userId);
      }
    }
    const runtime = payload.runtime || {};
    const devices = Array.isArray(runtime.devices) ? runtime.devices.slice(0, 64).map(device => ({
      kind: ['audioinput', 'audiooutput'].includes(device.kind) ? device.kind : '',
      deviceId: String(device.deviceId || '').slice(0, 512), label: String(device.label || '').slice(0, 128),
    })).filter(device => device.kind) : [];
    reports.set(Number(peer.userId), {
      socketId: peer.socket.id, at: Date.now(), runtime: {
        devices, inputDeviceId: String(runtime.inputDeviceId || '').slice(0, 512),
        outputDeviceId: String(runtime.outputDeviceId || '').slice(0, 512),
        outputSupported: Boolean(runtime.outputSupported),
        talking: Boolean(runtime.talking), targets: Array.isArray(runtime.targets) ? runtime.targets.slice(0, 64) : [],
        lockedTargets: Array.isArray(runtime.lockedTargets) ? runtime.lockedTargets.slice(0, 64) : [],
        micLevel: String(runtime.micLevel || '-inf dB').slice(0, 24),
        micMeterWidth: Math.max(0, Math.min(100, Number(runtime.micMeterWidth) || 0)),
      },
    });
    publish(peer.userId);
  }
  function enqueue(userId, action) {
    const previous = queues.get(userId) || Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    queues.set(userId, next);
    next.finally(() => { if (queues.get(userId) === next) queues.delete(userId); }).catch(() => {});
    return next;
  }
  async function send(peer, command) {
    if (!peer) return { ok: true, offline: true };
    if (peer.isBridgePeer) {
      return deps.sendBridgeCommand(peer, command);
    }
    return new Promise(resolve => {
      peer.socket.timeout(5000).emit('panel-command', command, (error, result) => {
        resolve(error ? { ok: false, error: 'Client did not confirm the change' } : result || { ok: false, error: 'Client did not confirm the change' });
      });
    });
  }
  async function execute(socket, command = {}) {
    if (!authorized(socket)) throw new Error('Admin login required');
    const userId = socket.data.userId;
    validUser(userId);
    const state = snapshot(userId);
    const peer = findUserPeerByUserId(userId)?.peer;
    let settings = savedSettings(userId);
    const kind = command.kind;
    const target = state.targets.find(t => t.targetType === command.targetType && Number(t.targetId) === Number(command.targetId));
    const outgoing = { ...command };
    if (kind === 'talk') {
      if (!peer) throw new Error('Client is offline');
      if (!['press', 'release', 'lock', 'unlock', 'stop'].includes(command.action)) throw new Error('Invalid talk action');
      if (!['release', 'stop'].includes(command.action) && command.targetType !== 'reply' && (!target || target.canTalk === false)) {
        throw new Error('Talk target not assigned');
      }
      const inputKey = String(command.inputKey ?? 'main').slice(0, 128);
      outgoing.inputKey = `panel:${socket.id}:${inputKey}`;
      if (command.action === 'press') socket.data.heldInputs.add(inputKey);
      if (command.action === 'release') socket.data.heldInputs.delete(inputKey);
    } else if (kind === 'target-audio') {
      if (!target) throw new Error('Audio target not assigned');
      const existing = state.targetAudioStates.find(t => t.targetType === command.targetType && Number(t.targetId) === Number(command.targetId))
        || { targetType: command.targetType, targetId: Number(command.targetId), volume: 0.9, muted: false };
      if ('volume' in command && (typeof command.volume !== 'number' || !Number.isFinite(command.volume) || command.volume < 0 || command.volume > 1)) throw new Error('Invalid volume');
      if ('muted' in command && typeof command.muted !== 'boolean') throw new Error('Invalid mute state');
      const audio = { ...existing, ...('volume' in command ? { volume: command.volume } : {}), ...('muted' in command ? { muted: command.muted } : {}) };
      mergeUserTargetAudioStates(userId, [audio]);
      deps.targetAudioChanged?.(userId);
      outgoing.audio = audio;
    } else if (kind === 'audio-settings') {
      outgoing.settings = normalizeAudioSettings(command.settings, { strict: true });
      updateUserAudioSettings(userId, outgoing.settings);
    } else if (kind === 'preferences') {
      const patch = normalizeStorage(command.patch, userId, { strict: true });
      settings.storage = mergeStorage(settings.storage, patch);
    } else if (kind === 'production') {
      if (!state.productions.some(p => Number(p.id) === Number(command.productionId))) throw new Error('Production not assigned');
      settings.storage[`activeProduction:${userId}`] = String(command.productionId);
      if (!peer) settings.pendingProductionId = Number(command.productionId);
    } else if (kind === 'order') {
      outgoing.items = validateCompleteTargetOrder(command.items, state.targets);
      updateProductionTargetOrder(state.productionId, userId, outgoing.items);
      notifyTargetChange(userId);
    } else throw new Error('Unsupported panel action');
    if (kind !== 'talk') {
      settings.revision++;
      updateUserPanelSettings(userId, settings);
    }
    outgoing.panelSettings = settings;
    const result = await send(peer, outgoing);
    if (kind === 'talk' && command.action === 'press' && !result.ok) {
      socket.data.heldInputs.delete(String(command.inputKey ?? 'main').slice(0, 128));
      await send(peer, { kind: 'talk', action: 'release', inputKey: outgoing.inputKey });
    }
    if (result.report) report(peer, result.report);
    publish(userId);
    return { ...result, report: undefined, state: snapshot(userId) };
  }
  app.get('/panel', requireAdmin, (req, res) => {
    try { validUser(Number(req.query.userId)); res.sendFile(path.join(publicDir, 'index.html')); }
    catch (error) { res.status(404).send(error.message); }
  });
  namespace.use((socket, next) => next(authorized(socket) ? undefined : new Error('Admin login required')));
  namespace.on('connection', socket => {
    socket.data.heldInputs = new Set();
    let timer = null;
    socket.on('connection-health', ack => { if (authorized(socket) && typeof ack === 'function') ack(true); });
    socket.on('panel-watch', ({ userId } = {}, ack = () => {}) => {
      try {
        if (!authorized(socket)) throw new Error('Admin login required');
        validUser(userId);
        if (socket.data.userId && socket.data.userId !== Number(userId)) throw new Error('Open another tab to control another user');
        socket.data.userId = Number(userId);
        const refresh = () => {
          if (!authorized(socket)) return socket.disconnect(true);
          findUserPeerByUserId(userId)?.peer?.socket?.emit('panel-state-request');
          publish(userId);
        };
        clearInterval(timer);
        timer = setInterval(refresh, 2000);
        timer.unref?.();
        refresh();
        ack({ ok: true });
      } catch (error) { ack({ ok: false, error: error.message }); }
    });
    socket.on('panel-command', (command, ack = () => {}) => {
      if (!socket.data.userId) return ack({ ok: false, error: 'No user selected' });
      enqueue(socket.data.userId, () => execute(socket, command)).then(ack, error => ack({ ok: false, error: error.message }));
    });
    socket.on('disconnect', () => {
      clearInterval(timer);
      if (!socket.data.userId) return;
      // Release only this panel's held PTT inputs; local holds and locks survive.
      enqueue(socket.data.userId, async () => {
        const peer = findUserPeerByUserId(socket.data.userId)?.peer;
        for (const key of socket.data.heldInputs) {
          await send(peer, { kind: 'talk', action: 'release', inputKey: `panel:${socket.id}:${key}` });
        }
        socket.data.heldInputs.clear();
      }).catch(() => {});
    });
  });
  return { report, publish, snapshot, savedSettings };
}
module.exports = { installRemotePanelControl };
