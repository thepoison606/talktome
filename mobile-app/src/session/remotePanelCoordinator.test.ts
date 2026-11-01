import { afterEach, describe, expect, it, vi } from 'vitest';
import { PANEL_AUDIO_DEFAULTS, type PanelAudioState, type PanelSettings } from '../protocol/remotePanel';
import { DEFAULT_OPERATOR_AUDIO } from './operatorAudio';
import { RemotePanelCoordinator, type PanelSessionState, type RemotePanelHost } from './remotePanelCoordinator';

const user = { type: 'user', id: 9, label: 'Pat', canTalk: true } as const;
const conference = { type: 'conference', id: 2, label: 'Stage', canTalk: true } as const;
const feed = { type: 'feed', id: 4, label: 'Program', canTalk: false } as const;
const guest = { type: 'guest', id: 'guest-socket', label: 'Guest', canTalk: true } as const;
const panels: RemotePanelCoordinator[] = [];
afterEach(() => { panels.splice(0).forEach(panel => panel.reset()); vi.useRealTimers(); });

function fixture() {
  let state: PanelSessionState = {
    identity: { kind: 'user', id: 1, name: 'Me' }, operatorReady: false, activeProfileId: 'server::me',
    productionId: 7, productions: [{ id: 7, name: 'Studio' }, { id: 8, name: 'Field' }], mainButtonTargets: {},
    audioPreferences: {}, conferenceListen: { excluded: {}, levels: {} }, stoppedFeedKeys: [],
    operatorAudio: { ...DEFAULT_OPERATOR_AUDIO }, leftHanded: false, lockMultipleTargets: false,
    audioSessionAvailable: true, audioRoutes: [{ id: 'speaker', label: 'Speaker', kind: 'speaker', selected: true }, { id: 'receiver', label: 'Phone', kind: 'receiver' }],
    talking: false, talkingTargetKeys: [], lockedTargetKeys: [], targets: [user, conference, feed], replyTarget: guest,
  };
  const listeners = new Set<(state: PanelSessionState, previous: PanelSessionState) => void>();
  const update = (patch: Partial<PanelSessionState>) => { const previous = state; state = { ...state, ...patch }; listeners.forEach(listener => listener(state, previous)); };
  const host: RemotePanelHost = {
    state: () => state,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    defaultAudioProfile: () => 'standard',
    applyAudioSettings: vi.fn(async settings => update({ leftHanded: settings.leftHandMode, lockMultipleTargets: settings.lockMultipleTargets, operatorAudio: { ...state.operatorAudio, feedDimDb: settings.dimAmountDb, feedDimSelf: settings.dimFeedsWhileSpeaking, feedDimIncoming: settings.dimWhenAddressed, playConnectionSounds: settings.playConnectionSounds, echoCancellation: settings.audioAutoProcessing, noiseSuppression: settings.audioAutoProcessing, autoGainControl: settings.audioAutoProcessing } })),
    applyAudioStates: vi.fn(async (states: PanelAudioState[], replace: boolean) => update({ audioPreferences: { ...(replace ? {} : state.audioPreferences), ...Object.fromEntries(states.map(item => [`${item.targetType}-${item.targetId}`, { volume: item.volume, muted: item.muted }])) } })),
    applyConferenceListen: vi.fn(async conferenceListen => update({ conferenceListen })),
    applyStoppedFeeds: vi.fn(async stoppedFeedKeys => update({ stoppedFeedKeys })),
    applyMainButtons: vi.fn(async mainButtonTargets => update({ mainButtonTargets })),
    selectAudioRoute: vi.fn(async id => update({ audioRoutes: state.audioRoutes.map(route => ({ ...route, selected: route.id === id })) })),
    selectProduction: vi.fn(async productionId => update({ productionId })), refreshTargets: vi.fn(async () => {}),
    press: vi.fn(async () => {}), release: vi.fn(async () => {}), lock: vi.fn(async () => {}), unlock: vi.fn(async () => {}), stopTalk: vi.fn(async () => {}), discardRemoteHolds: vi.fn(),
    report: vi.fn(), audioSnapshot: vi.fn(), saveAudioSettings: vi.fn(async () => ({ ok: true })),
  };
  const panel = new RemotePanelCoordinator(host); panels.push(panel);
  const register = async (settings: PanelSettings = { revision: 0, storage: {} }, extra: Record<string, unknown> = {}) => {
    await panel.restoreRegistration({ panelSettings: settings, productionId: 7, ...extra });
    update({ operatorReady: true }); await panel.operatorReady();
  };
  return { panel, host, update, register, state: () => state };
}

describe('native remote panel', () => {
  it('handles independent Companion holds, legacy Reply and lock toggles', async () => {
    const f = fixture(); await f.register();
    for (const inputKey of ['button-a', 'button-b']) {
      expect(await f.panel.handleCompanionTalk({ action: 'press', targetType: 'user', targetId: 9, inputKey })).toMatchObject({ ok: true });
      expect(f.host.press).toHaveBeenCalledWith(`panel:companion:${inputKey}`, user);
    }
    await f.panel.handleCompanionTalk({ action: 'release', targetType: 'user', targetId: 9, inputKey: 'button-a' });
    expect(f.host.release).toHaveBeenCalledWith('panel:companion:button-a');
    expect(f.host.stopTalk).not.toHaveBeenCalled();
    await f.panel.handleCompanionTalk({ action: 'press', targetType: 'reply' });
    await f.panel.handleCompanionTalk({ action: 'release', targetType: 'reply' });
    expect(f.host.press).toHaveBeenCalledWith('panel:companion:reply:', guest);
    expect(f.host.release).toHaveBeenCalledWith('panel:companion:reply:');
    f.host.lock = vi.fn(async () => f.update({ lockedTargetKeys: ['user-9'] }));
    await Promise.all([1, 2].map(() => f.panel.handleCompanionTalk({ action: 'lock-toggle', targetType: 'user', targetId: 9 })));
    expect(f.host.lock).toHaveBeenCalledOnce(); expect(f.host.unlock).toHaveBeenCalledWith(user);
    expect(await f.panel.handleCompanionTalk({ action: 'press', targetType: 'user', targetId: 999 })).toMatchObject({ ok: false });
  });

  it('cancels a Companion press released while microphone startup is pending', async () => {
    const f = fixture(); await f.register();
    let finish!: () => void;
    f.host.press = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = f.panel.handleCompanionTalk({ action: 'press', targetType: 'user', targetId: 9, inputKey: 'a' });
    await vi.waitFor(() => expect(f.host.press).toHaveBeenCalled());
    expect(await f.panel.handleCompanionTalk({ action: 'release', targetType: 'user', targetId: 9, inputKey: 'a' })).toMatchObject({ ok: true });
    expect(f.host.release).toHaveBeenCalledWith('panel:companion:a'); finish(); await pending;
  });

  it('restores server audio, conference, feed, main-button settings before reporting', async () => {
    const f = fixture();
    const storage = { 'conferenceListenExclusions:user:1': '{"2":[9]}', 'conferenceMemberLevels:user:1': '{"2":{"9":0.3}}', 'stoppedFeeds:user:1': '{"feed-4":true}', 'mainButtonTarget:user:1:7': 'conference-2', 'targetHotkeys:1:production:8': '{"user-9":"KeyA"}', 'mainButtonTarget:user:99:7': 'user-9' };
    await f.panel.restoreRegistration({ productionId: 7, panelSettings: { revision: 4, storage }, userAudioSettings: { ...PANEL_AUDIO_DEFAULTS, leftHandMode: true, audioProfile: 'low' }, targetAudioStates: [{ targetType: 'user', targetId: 9, volume: 0.4, muted: true }] });
    expect(f.host.report).not.toHaveBeenCalled();
    expect(f.state()).toMatchObject({ leftHanded: true, conferenceListen: { excluded: { '2': [9] }, levels: { '2': { '9': 0.3 } } }, stoppedFeedKeys: ['feed-4'], mainButtonTargets: { 'server::me:7': 'conference-2' }, audioPreferences: { 'user-9': { volume: 0.4, muted: true } } });
    f.update({ operatorReady: true }); await f.panel.operatorReady();
    expect(f.panel.report()).toMatchObject({ revision: 4, storage: { 'targetHotkeys:1:production:8': storage['targetHotkeys:1:production:8'] }, runtime: { outputSupported: true } });
    expect(f.panel.report()?.storage['mainButtonTarget:user:99:7']).toBeUndefined();
    expect(f.panel.audioProfile).toBe('low');
  });

  it('imports device preferences when the server has no saved panel state', async () => {
    const f = fixture(); f.update({ stoppedFeedKeys: ['feed-4'], mainButtonTargets: { 'server::me:7': 'user-9' } });
    await f.register();
    expect(f.host.applyStoppedFeeds).not.toHaveBeenCalled();
    expect(f.panel.report()?.storage).toMatchObject({ 'stoppedFeeds:user:1': '{"feed-4":true}', 'mainButtonTarget:user:1:7': 'user-9' });
    expect(f.host.saveAudioSettings).toHaveBeenCalledWith(expect.objectContaining({ audioProfile: 'standard', audioAutoProcessing: true }), 0);
  });

  it('defers main-button restoration until a new profile exists and maps primary production to native Default', async () => {
    const f = fixture(); f.update({ activeProfileId: null, productionId: null, productions: [] });
    await f.panel.restoreRegistration({ productionId: 7, panelSettings: { revision: 2, storage: { 'mainButtonTarget:user:1:7': 'user-9' } } });
    expect(f.host.applyMainButtons).not.toHaveBeenCalled();
    f.update({ activeProfileId: 'new-profile', operatorReady: true }); await f.panel.operatorReady();
    expect(f.state().mainButtonTargets['new-profile:default']).toBe('user-9');
    expect(f.panel.report()?.storage['mainButtonTarget:user:1:7']).toBe('user-9');
  });

  it('maps a legacy native Default selection to the actual primary production after startup', async () => {
    const f = fixture(); f.update({ productionId: null });
    await f.register({ revision: 2, storage: { 'mainButtonTarget:user:1:7': 'conference-2' } });
    expect(f.state().mainButtonTargets['server::me:default']).toBe('conference-2');
    expect(f.panel.report()?.storage['mainButtonTarget:user:1:7']).toBe('conference-2');
  });

  it('debounces local changes, preserves other productions, and keeps runtime fresh', async () => {
    vi.useFakeTimers(); const f = fixture();
    await f.register({ revision: 3, storage: { 'mainButtonTarget:user:1:8': 'conference-2' } });
    vi.mocked(f.host.report).mockClear();
    f.update({ audioPreferences: { 'user-9': { volume: 0.6, muted: true } }, talking: true, talkingTargetKeys: ['guest-guest-socket'] });
    f.update({ leftHanded: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(f.host.report).toHaveBeenCalledTimes(1);
    expect(f.panel.report()).toMatchObject({ storage: { 'mainButtonTarget:user:1:8': 'conference-2' }, audioStates: expect.arrayContaining([{ targetType: 'user', targetId: 9, volume: 0.6, muted: true }]), runtime: { targets: [{ type: 'guest', id: 'guest-socket' }] } });
    expect(f.host.saveAudioSettings).toHaveBeenLastCalledWith(expect.objectContaining({ leftHandMode: true }), 3);
    await vi.advanceTimersByTimeAsync(5000); expect(f.host.report).toHaveBeenCalledTimes(2);
  });

  it('uses the server revision, applies absolute audio commands, and rejects stale writes', async () => {
    const f = fixture(); await f.register();
    const command = { kind: 'target-audio', audio: { targetType: 'user', targetId: 9, volume: 0.5, muted: true }, panelSettings: { revision: 2, storage: {} } };
    expect(await f.panel.handleCommand(command)).toMatchObject({ ok: true, report: { revision: 2 } });
    expect(await f.panel.handleCommand(command)).toMatchObject({ ok: true });
    expect(f.state().audioPreferences['user-9']).toEqual({ volume: 0.5, muted: true });
    expect(await f.panel.handleCommand({ ...command, panelSettings: { revision: 1, storage: {} } })).toMatchObject({ ok: false, error: 'Stale panel command.' });
    expect(await f.panel.handleCommand({ ...command, audio: { ...command.audio, targetId: 999 } })).toMatchObject({ ok: false, error: 'Audio target is not assigned.' });
  });

  it('dispatches Talk, Reply, locks, production changes, and order refresh to the native host', async () => {
    const f = fixture(); await f.register();
    for (const action of ['press', 'release', 'lock', 'unlock', 'stop']) expect(await f.panel.handleCommand({ kind: 'talk', action, targetType: 'reply', inputKey: 'panel:a:main' })).toMatchObject({ ok: true });
    expect(f.host.press).toHaveBeenCalledWith('panel:a:main', guest); expect(f.host.lock).toHaveBeenCalledWith(guest);
    expect(f.host.release).toHaveBeenCalledWith('panel:a:main'); expect(f.host.unlock).toHaveBeenCalledWith(guest); expect(f.host.stopTalk).toHaveBeenCalled();
    expect(await f.panel.handleCommand({ kind: 'production', productionId: 8, panelSettings: { revision: 1, storage: { 'mainButtonTarget:user:1:8': 'user-9' } } })).toMatchObject({ ok: true });
    expect(f.host.selectProduction).toHaveBeenCalledWith(8);
    expect(await f.panel.handleCommand({ kind: 'order' })).toMatchObject({ ok: true }); expect(f.host.refreshTargets).toHaveBeenCalled();
    expect(await f.panel.handleCommand({ kind: 'production', productionId: 99 })).toMatchObject({ ok: false });
  });

  it('releases immediately while microphone preparation is pending', async () => {
    const f = fixture(); await f.register();
    let finish!: () => void; vi.mocked(f.host.press).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.panel.handleCommand({ kind: 'talk', action: 'press', targetType: 'user', targetId: 9, inputKey: 'panel:a:hold' });
    await vi.waitFor(() => expect(f.host.press).toHaveBeenCalled());
    expect(await f.panel.handleCommand({ kind: 'talk', action: 'release', inputKey: 'panel:a:hold' })).toMatchObject({ ok: true });
    expect(f.host.release).toHaveBeenCalledWith('panel:a:hold'); finish(); await pending;
  });

  it('cancels a press queued behind a slow settings command', async () => {
    const f = fixture(); await f.register(); let finish!: () => void;
    vi.mocked(f.host.applyAudioSettings).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const settings = f.panel.handleCommand({ kind: 'audio-settings', settings: PANEL_AUDIO_DEFAULTS });
    await vi.waitFor(() => expect(f.host.applyAudioSettings).toHaveBeenCalled());
    const press = f.panel.handleCommand({ kind: 'talk', action: 'press', targetType: 'user', targetId: 9, inputKey: 'panel:a:hold' });
    await f.panel.handleCommand({ kind: 'talk', action: 'release', inputKey: 'panel:a:hold' }); finish(); await settings; await press;
    expect(f.host.press).not.toHaveBeenCalled();
  });

  it('rejects unsupported native settings and foreign-user preferences with an actual-state report', async () => {
    const f = fixture(); await f.register();
    expect(await f.panel.handleCommand({ kind: 'audio-settings', settings: { ...PANEL_AUDIO_DEFAULTS, voiceTriggerEnabled: true } })).toMatchObject({ ok: false, error: expect.stringContaining('voiceTriggerEnabled'), report: { revision: 0 } });
    for (const patch of [{ 'targetHotkeys:1': '{}' }, { preferredAudioInputDeviceId: 'browser-mic' }, { 'stoppedFeeds:user:99': '{}' }]) expect(await f.panel.handleCommand({ kind: 'preferences', patch })).toMatchObject({ ok: false });
    expect(f.host.applyAudioSettings).not.toHaveBeenCalled();
  });

  it('selects available native routes, reports unavailable routes as failures, and ignores stale browser routes at registration', async () => {
    const f = fixture(); await f.register({ revision: 1, storage: { preferredAudioOutputDeviceId: 'browser-speaker' } });
    expect(f.host.selectAudioRoute).not.toHaveBeenCalled();
    expect(await f.panel.handleCommand({ kind: 'preferences', patch: { preferredAudioOutputDeviceId: 'receiver' }, panelSettings: { revision: 2, storage: { preferredAudioOutputDeviceId: 'receiver' } } })).toMatchObject({ ok: true, report: { runtime: { outputDeviceId: 'receiver' } } });
    expect(await f.panel.handleCommand({ kind: 'preferences', patch: { preferredAudioOutputDeviceId: 'unplugged' }, panelSettings: { revision: 3, storage: { preferredAudioOutputDeviceId: 'unplugged' } } })).toMatchObject({ ok: false });
    expect(await f.panel.handleCommand({ kind: 'preferences', patch: { preferredAudioOutputDeviceId: '' } })).toMatchObject({ ok: false });
  });

  it('restores a native output route after audio-session initialization', async () => {
    const f = fixture(); f.update({ audioSessionAvailable: false });
    await f.panel.restoreRegistration({ productionId: 7, panelSettings: { revision: 2, storage: { preferredAudioOutputDeviceId: 'receiver' } } });
    expect(f.host.selectAudioRoute).not.toHaveBeenCalled();
    f.update({ audioSessionAvailable: true, operatorReady: true }); await f.panel.operatorReady();
    expect(f.host.selectAudioRoute).toHaveBeenCalledWith('receiver'); expect(f.panel.report()?.runtime.outputDeviceId).toBe('receiver');
  });

  it('reports browser-only capture features as inactive after restoring browser settings', async () => {
    const f = fixture(); await f.register({ revision: 1, storage: {} }, { userAudioSettings: { ...PANEL_AUDIO_DEFAULTS, voiceTriggerEnabled: true, userInputGainDb: 30 } });
    expect(f.host.saveAudioSettings).toHaveBeenCalledWith(expect.objectContaining({ voiceTriggerEnabled: false, userInputGainDb: 18 }), 1);
  });

  it('does not buffer reports or accept commands after disconnect, and drops stale completion reports', async () => {
    const f = fixture(); await f.register(); let finish!: () => void;
    vi.mocked(f.host.refreshTargets).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.panel.handleCommand({ kind: 'order' }); await vi.waitFor(() => expect(f.host.refreshTargets).toHaveBeenCalled());
    f.panel.disconnected(); vi.mocked(f.host.report).mockClear(); finish();
    expect(await pending).toMatchObject({ ok: false, error: 'User session changed.' });
    f.panel.publish(true); expect(f.host.report).not.toHaveBeenCalled();
    expect(await f.panel.handleCommand({ kind: 'order' })).toMatchObject({ ok: false });
    await f.register(); expect(f.host.report).toHaveBeenCalled();
  });

  it('leaves older servers and guests alone', async () => {
    const f = fixture(); await f.panel.restoreRegistration({}); f.update({ operatorReady: true }); await f.panel.operatorReady();
    expect(f.panel.audioProfile).toBeUndefined(); expect(f.host.report).not.toHaveBeenCalled(); expect(f.host.saveAudioSettings).not.toHaveBeenCalled();
    f.update({ identity: { kind: 'guest', id: 'guest', name: 'Guest' } }); await f.register(); expect(f.host.report).not.toHaveBeenCalled();
  });
});


describe('iOS system-managed output', () => {
  it('does not restore saved panel outputs over the system-selected route', async () => {
    const f = fixture(); f.host.systemAudioRouting = true;
    f.update({ audioRoutes: [{ id: 'port:airpods', label: 'AirPods', kind: 'bluetooth', selected: true },
      { id: 'speaker', label: 'Speaker', kind: 'speaker', selected: false }] });
    await f.register({ revision: 3, storage: { preferredAudioOutputDeviceId: 'speaker' } });
    expect(f.host.selectAudioRoute).not.toHaveBeenCalled();
    expect(f.panel.report()?.runtime.outputDeviceId).toBe('port:airpods');
  });
  it('applies an explicit live route command but leaves output alone for unrelated preferences', async () => {
    const f = fixture(); f.host.systemAudioRouting = true;
    await f.register({ revision: 3, storage: { preferredAudioOutputDeviceId: 'receiver' } });
    expect(await f.panel.handleCommand({ kind: 'preferences', patch: { 'stoppedFeeds:user:1': '{}' } })).toMatchObject({ ok: true });
    expect(f.host.selectAudioRoute).not.toHaveBeenCalled();
    expect(await f.panel.handleCommand({ kind: 'preferences', patch: { preferredAudioOutputDeviceId: 'receiver' } })).toMatchObject({ ok: true });
    expect(f.host.selectAudioRoute).toHaveBeenCalledWith('receiver');
  });
});
