import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionConflictError } from '../auth/errors';
import { HTTP_REQUEST_TIMEOUT_MS } from '../auth/http';
import type { MediaEngine } from '../media/engine';
import type { OperatorIdentity, Production } from '../protocol';
import { PANEL_AUDIO_DEFAULTS } from '../protocol/remotePanel';
import { SignalingConnectCancelledError } from '../signaling/client';
import { SessionController } from './sessionController';
import { initialState, useSessionStore } from './state';

const mocks = vi.hoisted(() => ({ registration: {} as Record<string, unknown>, entered: vi.fn(), connect: vi.fn<() => Promise<string>>(), order: [] as string[] }));
vi.mock('react-native', () => ({ AppState: { currentState: 'active' }, Platform: { OS: 'android' } }));
vi.mock('expo-modules-core', () => ({ requireNativeModule: () => { throw new Error('No device'); } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null), setItemAsync: vi.fn(async () => {}), deleteItemAsync: vi.fn(async () => {}) }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) } }));
vi.mock('../audio/session', () => ({ audioSessionAvailable: () => false, playConnectionCue: vi.fn() }));
vi.mock('../ble/native', () => ({ startBleNative: vi.fn() }));
vi.mock('./backgroundCoordinator', () => ({ BackgroundCoordinator: class { syncPresence() {} } }));
vi.mock('./mediaCoordinator', () => ({ MediaCoordinator: class {
  constructor(private c: SessionController) {}
  async enterOperator(production: Production | null) {
    mocks.entered(production); useSessionStore.setState({ operatorReady: true, productionId: production?.id ?? null });
    await this.c.remotePanel.operatorReady();
  }
  async rebuildMediaAfterReconnect() { mocks.order.push('rebuild'); await this.c.remotePanel.operatorReady(); }
  async applyTargetAudioStates() {}
  async applyStoppedFeedKeys() {}
  async setOperatorAudio() { mocks.order.push('restore-audio'); }
  syncFeedDucking() {}
} }));
vi.mock('../signaling/client', async importOriginal => ({ ...await importOriginal<object>(), SignalingClient: class {
  handlers = {}; socketId = 'new-socket'; connected = true;
  disconnect() {}
  async connect() { return mocks.connect(); }
  async register() { return mocks.registration; }
  async setActiveProduction(id: number | null) { mocks.order.push(`announce:${id}`); return id ?? 1; }
  emitPanelReport() {}
  emitTargetAudioSnapshot() {}
  async saveUserAudioSettings() { return { ok: true }; }
} }));

const controllers: SessionController[] = [];
beforeEach(() => {
  mocks.entered.mockClear(); mocks.order = [];
  mocks.connect.mockReset().mockResolvedValue('new-socket');
  useSessionStore.setState({ ...initialState, serverAddress: 'https://example.test', activeProfileId: 'profile', productionId: 7, productionName: 'Studio', productions: [{ id: 7, name: 'Studio' }, { id: 8, name: 'Field' }] });
  mocks.registration = { ok: true, productionId: 8, productions: [{ id: 7, name: 'Studio' }, { id: 8, name: 'Field' }], panelSettings: { revision: 2, storage: { 'activeProduction:1': '8' } }, userAudioSettings: PANEL_AUDIO_DEFAULTS };
});
afterEach(() => { controllers.splice(0).forEach(c => {
  c.remotePanel.reset();
  (c as unknown as { clientStatusReporter: { stop(): void } | null }).clientStatusReporter?.stop();
}); });
const identity: OperatorIdentity = { kind: 'user', id: 1, name: 'Me', productions: [{ id: 7, name: 'Studio' }, { id: 8, name: 'Field' }] };
function fixture({ serverDefaults = false } = {}) {
  const c = new SessionController(); controllers.push(c);
  vi.spyOn(c, 'persistCurrentProfile').mockResolvedValue();
  const internal = c as unknown as { finishIdentity(identity: OperatorIdentity, force: boolean): Promise<boolean>; refreshServerClientDefaults(): Promise<void>; handleReconnect(): Promise<void> };
  if (!serverDefaults) vi.spyOn(internal, 'refreshServerClientDefaults').mockResolvedValue();
  return { c, internal };
}

describe('panel registration in the native session', () => {
  it('cancels an unreachable profile immediately and ignores its late reply after a new attempt', async () => {
    vi.useFakeTimers();
    let reply!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise(resolve => { reply = resolve; }));
    vi.stubGlobal('fetch', fetchImpl);
    const { c } = fixture();
    const profile = {
      id: 'offline', serverAddress: 'https://192.168.1.250', username: 'Guest', rememberPassword: false,
      guest: { guestId: 'g-1', guestProfileUserId: 1, name: 'Guest' },
    };
    useSessionStore.setState({ profiles: [profile] });
    try {
      const first = c.connectProfile(profile.id);
      await vi.advanceTimersByTimeAsync(1);
      c.cancelProfileConnection();
      expect(useSessionStore.getState()).toMatchObject({ status: 'idle', error: null, identity: null });
      expect(fetchImpl.mock.calls[0]![1]!.signal!.aborted).toBe(true);
      const lateReply = reply;
      const second = c.connectProfile(profile.id);
      await vi.advanceTimersByTimeAsync(1);
      await first;
      lateReply(new Response(JSON.stringify({ ok: true })));
      await vi.advanceTimersByTimeAsync(1);
      expect(useSessionStore.getState()).toMatchObject({ status: 'connecting', error: null, identity: null });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(mocks.connect).not.toHaveBeenCalled();
      c.cancelProfileConnection();
      await second;
      expect(useSessionStore.getState().status).toBe('idle');
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('returns an unreachable IP to Profiles after the HTTP deadline without attempting login', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchImpl);
    const { c } = fixture();
    const profile = {
      id: 'offline', serverAddress: 'https://192.168.1.250', username: 'Guest', rememberPassword: false,
      guest: { guestId: 'g-1', guestProfileUserId: 1, name: 'Guest' },
    };
    useSessionStore.setState({ profiles: [profile] });
    try {
      const connecting = c.connectProfile(profile.id);
      await vi.advanceTimersByTimeAsync(1);
      expect(useSessionStore.getState().status).toBe('connecting');
      await vi.advanceTimersByTimeAsync(HTTP_REQUEST_TIMEOUT_MS);
      await connecting;
      expect(useSessionStore.getState()).toMatchObject({
        status: 'idle', identity: null, operatorReady: false, addingProfile: false, profiles: [profile],
        error: expect.stringContaining('did not respond in time'),
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(String(fetchImpl.mock.calls[0]![0])).toContain('/api/v1/health');
      expect(mocks.connect).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('clears a partial identity after profile startup fails so navigation can leave the spinner', async () => {
    const { c } = fixture();
    const profile = {
      id: 'partial', serverAddress: 'https://example.test', username: 'Guest', rememberPassword: false,
      guest: { guestId: 'g-1', guestProfileUserId: 1, name: 'Guest' },
    };
    useSessionStore.setState({ profiles: [profile] });
    vi.spyOn(c, 'loginGuest').mockImplementation(async () => {
      useSessionStore.setState({ status: 'connecting', identity, operatorReady: false });
      throw new Error('Startup failed');
    });
    const teardown = vi.spyOn(c as unknown as { teardownSession(): Promise<void> }, 'teardownSession').mockResolvedValue();
    await c.connectProfile(profile.id);
    expect(teardown).toHaveBeenCalledOnce();
    expect(useSessionStore.getState()).toMatchObject({ status: 'idle', identity: null, operatorReady: false, error: 'Startup failed' });
  });

  it('keeps the QR token when retrying after a session conflict', async () => {
    const { c } = fixture();
    const token = 'qr-token-for-regression';
    const tokenLogin = vi.fn(async (_token: string) => identity);
    const passwordLogin = vi.fn();
    const internal = c as unknown as {
      prepareHttp(server: string): void;
      probeAndHealth(): Promise<void>;
      attachSessionCookie(server: string): Promise<void>;
    };
    vi.spyOn(internal, 'prepareHttp').mockImplementation(() => {
      c.api = { loginToken: tokenLogin, login: passwordLogin } as unknown as NonNullable<typeof c.api>;
    });
    vi.spyOn(internal, 'probeAndHealth').mockResolvedValue();
    vi.spyOn(internal, 'attachSessionCookie').mockResolvedValue();
    mocks.registration = { conflict: true, existing: { name: identity.name } };
    await expect(c.loginWithToken({ serverAddress: 'https://example.test', token })).rejects.toBeInstanceOf(SessionConflictError);
    expect(c.rememberedPassword()).toBe('');
    mocks.registration = { ok: true };
    await c.takeOver();
    expect(tokenLogin.mock.calls).toEqual([[token], [token]]);
    expect(passwordLogin).not.toHaveBeenCalled();
    expect(vi.mocked(c.persistCurrentProfile)).toHaveBeenCalledWith(token);
    expect(useSessionStore.getState().operatorReady).toBe(true);
  });

  it('inherits the big main button default until the user explicitly changes it', async () => {
    const { c, internal } = fixture({ serverDefaults: true });
    c.api = { defaultClientSettings: async () => ({ bigMainButton: true }) } as unknown as NonNullable<typeof c.api>;
    vi.spyOn(c as unknown as { persistLayout(): void }, 'persistLayout').mockImplementation(() => {});
    await internal.refreshServerClientDefaults();
    expect(useSessionStore.getState().bigMainButton).toBe(true);
    c.setBigMainButton(false);
    await internal.refreshServerClientDefaults();
    expect(useSessionStore.getState().bigMainButton).toBe(false);
  });

  it('honors the production selected remotely while the phone was offline', async () => {
    const { internal } = fixture(); await internal.finishIdentity(identity, false);
    expect(mocks.entered).toHaveBeenCalledWith({ id: 8, name: 'Field' });
    expect(mocks.order[0]).toBe('restore-audio');
  });

  it('keeps remembered production selection on older servers', async () => {
    mocks.registration = { ok: true }; const { c, internal } = fixture(); await internal.finishIdentity(identity, false);
    expect(mocks.entered).toHaveBeenCalledWith({ id: 7, name: 'Studio' }); expect(c.remotePanel.audioProfile).toBeUndefined();
  });

  it('uses the assigned production list from registration, including a primary Default', async () => {
    mocks.registration = { ...mocks.registration, productionId: 1, productions: [{ id: 1, name: 'Default' }], panelSettings: { revision: 3, storage: { 'activeProduction:1': '1' } } };
    const { internal } = fixture(); await internal.finishIdentity(identity, false);
    expect(mocks.entered).toHaveBeenCalledWith({ id: 1, name: 'Default' });
  });

  it('enters the only assigned production without offering an unassigned Default', async () => {
    mocks.registration = { ok: true, productions: [{ id: 9, name: 'AppReview' }], panelSettings: { revision: 3, storage: {} } };
    const { internal } = fixture(); await internal.finishIdentity(identity, false);
    expect(mocks.entered).toHaveBeenCalledWith({ id: 9, name: 'AppReview' });
  });

  it('does not restore an unassigned production from stale panel settings', async () => {
    useSessionStore.setState({ productionId: 99, productionName: 'Removed' });
    mocks.registration = { ...mocks.registration, productionId: 99, panelSettings: { revision: 3, storage: { 'activeProduction:1': '99' } } };
    const { internal } = fixture(); await internal.finishIdentity(identity, false);
    expect(mocks.entered).not.toHaveBeenCalled();
    expect(useSessionStore.getState().status).toBe('choose-production');
  });

  it('maps a remembered legacy Default to an assigned production', async () => {
    useSessionStore.setState({ productionId: null, productionName: 'Default' });
    mocks.registration = { ok: true };
    const { internal } = fixture(); await internal.finishIdentity(identity, false);
    expect(mocks.entered).toHaveBeenCalledWith({ id: 7, name: 'Studio' });
  });

  it('stops old media before restoring settings and re-announces the server-selected production on reconnect', async () => {
    const { c, internal } = fixture(); await internal.finishIdentity(identity, false);
    useSessionStore.setState({ productionId: 7 });
    c.media = { stop: vi.fn(async () => { mocks.order.push('stop-old-media'); }), applyTalkOpusProfile: vi.fn(async () => { throw new Error('Old producer must never be touched'); }) } as unknown as MediaEngine;
    mocks.order = []; await internal.handleReconnect();
    expect(mocks.order).toEqual(['stop-old-media', 'restore-audio', 'announce:8', 'rebuild']);
    expect(useSessionStore.getState().productionId).toBe(8); expect(c.media).toBeNull();
  });

  it('ignores stale connection and reconnect reports from a replaced signaling client', async () => {
    const { c, internal } = fixture();
    await internal.finishIdentity(identity, false);
    const previous = c.signaling!;
    await internal.finishIdentity(identity, false);
    const reconnect = vi.spyOn(internal, 'handleReconnect').mockResolvedValue();
    const healthy = useSessionStore.getState();

    previous.handlers.onStateChange?.({ status: 'failed', message: 'timeout' });
    previous.handlers.onReconnect?.('old-socket');

    expect(useSessionStore.getState()).toBe(healthy);
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('silently ends a cancelled login without changing its successful replacement', async () => {
    const { internal } = fixture();
    let cancel!: (error: Error) => void;
    mocks.connect.mockImplementationOnce(() => new Promise<string>((_resolve, reject) => { cancel = reject; }));
    const oldAttempt = internal.finishIdentity(identity, false);
    expect(await internal.finishIdentity(identity, false)).toBe(true);
    const healthy = useSessionStore.getState();

    cancel(new SignalingConnectCancelledError());

    expect(await oldAttempt).toBe(false);
    expect(useSessionStore.getState()).toBe(healthy);
    expect(mocks.entered).toHaveBeenCalledOnce();
  });
});
