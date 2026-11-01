import { AppState, Platform } from 'react-native';

import { ApiClient } from '../auth/apiClient';
import type { CookieMap } from '../auth/cookieJar';
import { SessionConflictError, SessionCookieUnavailableError, TlsUntrustedError } from '../auth/errors';
import { TalkToMeHttp } from '../auth/http';
import { LocalNetworkUnavailableError } from '../auth/localNetworkRetry';
import { hasSessionCookie, readNativeCookies } from '../auth/nativeCookies';
import {
  requiresBrowserSessionCookie,
  supportsActiveProduction,
  supportsServerHeartbeat,
} from '../auth/serverCapabilities';
import type { MediaEngine } from '../media/engine';
import {
  EMPTY_CAMERA_TALLY,
  parseProductions,
  talkTargetIdentity,
  type ActiveProducer,
  type OperatorIdentity,
  type Production,
  type TargetAudioPreference,
  type TalkTarget,
} from '../protocol';
import { audioSessionAvailable, playConnectionCue } from '../audio/session';
import { hasSystemRoutePicker } from '../audio/routes';
import { isLikelyLocalHost, parseServerAddress } from '../servers/parseServerAddress';
import { looksLikeTlsFailure } from '../servers/tlsFailure';
import { pinMatches } from '../servers/tlsPins';
import {
  hydrateTlsPins,
  probeServerCertificate,
  rememberTlsPin,
  storedPinForHost,
} from '../servers/tlsTrust';
import { isRegisterConflict, isRegisterOk, SignalingClient, SignalingConnectCancelledError } from '../signaling/client';
import { stopForegroundService } from '../background/foregroundService';
import { startBleNative } from '../ble/native';
import { loadBlePreferences } from '../ble/preferences';
import type { BleTargetSelection } from '../ble/target';
import type { PttButton } from '../hardware/events';
import { slideToLockHint } from '../talk/slideToLock';
import { loadAudioPreferences } from './audioPrefs';
import { loadConferenceListen } from './conferenceListen';
import {
  loadOperatorAudioOverrides,
  resolveOperatorAudio,
  type OperatorAudioSettings,
} from './operatorAudio';
import type { ServerClientDefaults } from '../protocol/clientDefaults';
import { readNativeClientVersion } from '../protocol/clientVersion';
import { readNativeDeviceStatus } from '../protocol/deviceStatus';
import { createClientStatusReporter } from './clientStatusReporter';
import {
  loadProfileBundle,
  passwordForProfile,
  profileCanAutoConnect,
  profileIdentity,
  removeProfile,
  savePasswordForProfile,
  saveProfileBundle,
  upsertProfile,
  type SavedProfile,
} from './remembered';
import { canAnnounceConnectionRecovery, createConnectionCues, transportReportsLoss } from './connectionCues';
import { normalizeWatchTargetKeys } from '../watch/selection';
import { mainButtonStorageKey } from './mainButton';
import { targetOrderPayload } from './targetOrder';
import { createServerHeartbeat } from './serverHeartbeat';
import { BackgroundCoordinator } from './backgroundCoordinator';
import { RemotePanelCoordinator } from './remotePanelCoordinator';
import { parsePanelSettings, positiveId } from '../protocol/remotePanel';
import { talkOpusProfile } from '../media/opus';
import { MediaCoordinator } from './mediaCoordinator';
import { TalkCoordinator } from './talkCoordinator';
import {
  bleFieldsFromSelection,
  initialState,
  useSessionStore,
  type SessionUiState,
} from './state';

/**
 * The one operator runtime instance (`session`). Owns shared mutable session
 * state (signaling, media engine, talk target arrays, PTT join gate) and
 * composes the talk, media, and background coordinators. UI code only talks
 * to this façade via `session` from `./store`.
 */
export class SessionController {
  private cookies: CookieMap = {};
  private serverAppVersion: string | undefined;
  private http: TalkToMeHttp | null = null;
  private pendingPassword?: string;
  private pendingLoginToken = false;
  private reconnecting = false;
  private reconnectFailures = 0;
  /** Intentional logout, pause, or profile leave. Suppresses connection tones. */
  private sessionEnding = false;
  private heartbeat: { stop: () => void } | null = null;
  private readonly connectionCues = createConnectionCues((cue) => {
    if (useSessionStore.getState().operatorAudio.playConnectionSounds) {
      void playConnectionCue(cue);
    }
  });

  // Shared mutable fields used across coordinators.
  api: ApiClient | null = null;
  signaling: SignalingClient | null = null;
  media: MediaEngine | null = null;
  lastSocketId?: string;
  talkingTargets: TalkTarget[] = [];
  lockedTargets: TalkTarget[] = [];
  overrideFrom: TalkTarget[] | null = null;
  liveProducers = new Map<string, ActiveProducer>();
  fgsSync: Promise<void> = Promise.resolve();

  // Server-configured client defaults (1.4.4+) and per-key explicit choices.
  // Explicit choices always beat server defaults, like the web client.
  serverClientDefaults: ServerClientDefaults = {};
  operatorAudioOverrides: Partial<OperatorAudioSettings> = {};
  private leftHandedExplicit = false;
  private bigMainButtonExplicit = false;
  private clientStatusReporter: ReturnType<typeof createClientStatusReporter> | null = null;
  private lockMultipleTargetsExplicit = false;

  readonly talk = new TalkCoordinator(this);
  readonly mediaCoordinator = new MediaCoordinator(this);
  readonly background = new BackgroundCoordinator(this);
  readonly remotePanel = new RemotePanelCoordinator({
    state: () => useSessionStore.getState(),
    subscribe: listener => useSessionStore.subscribe(listener),
    defaultAudioProfile: () => this.serverClientDefaults.audioProfile ?? 'standard',
    applyAudioSettings: async settings => {
      this.setLeftHanded(settings.leftHandMode);
      this.setLockMultipleTargets(settings.lockMultipleTargets);
      await this.mediaCoordinator.setOperatorAudio({
        feedDimDb: settings.dimAmountDb, feedDimSelf: settings.dimFeedsWhileSpeaking,
        feedDimIncoming: settings.dimWhenAddressed, playConnectionSounds: settings.playConnectionSounds,
        echoCancellation: settings.audioAutoProcessing, noiseSuppression: settings.audioAutoProcessing,
        autoGainControl: settings.audioAutoProcessing,
      });
      await this.media?.applyTalkOpusProfile(talkOpusProfile(settings.audioProfile), () => ({
        targets: this.talkingTargets, lockActive: this.overrideFrom === null && this.lockedTargets.length > 0,
      }));
    },
    applyAudioStates: (states, replace) => this.mediaCoordinator.applyTargetAudioStates(states, replace),
    applyConferenceListen: state => this.talk.applyConferenceListen(state),
    applyStoppedFeeds: keys => this.mediaCoordinator.applyStoppedFeedKeys(keys),
    applyMainButtons: async mainButtonTargets => {
      useSessionStore.setState({ mainButtonTargets });
      this.background.syncPresence();
      await this.persistCurrentProfile();
    },
    systemAudioRouting: Platform.OS === 'ios' && hasSystemRoutePicker(),
    selectAudioRoute: id => this.mediaCoordinator.selectAudioDevice(id),
    selectProduction: async id => {
      const production = useSessionStore.getState().productions.find(item => item.id === id);
      if (!production) throw new Error('Production is not assigned.');
      await this.mediaCoordinator.enterOperator(production);
    },
    refreshTargets: () => this.mediaCoordinator.refreshTargets(),
    press: (key, target) => this.talk.pressRemote(key, target),
    release: key => this.talk.releaseRemote(key),
    lock: target => this.talk.lockRemote(target),
    unlock: target => this.talk.unlockRemote(target),
    stopTalk: () => this.talk.unlockTalk(),
    discardRemoteHolds: () => this.talk.discardRemoteHolds(),
    report: report => this.signaling?.emitPanelReport(report),
    audioSnapshot: (states, revision) => this.signaling?.emitTargetAudioSnapshot(states, revision),
    saveAudioSettings: (settings, revision) => this.signaling?.saveUserAudioSettings(settings, revision) ?? Promise.resolve({ ok: false }),
  });

  async hydrate(): Promise<void> {
    const [bundle, audioPreferences, blePreferences, conferenceListen, operatorAudioOverrides] = await Promise.all([
      loadProfileBundle(),
      loadAudioPreferences(),
      loadBlePreferences(),
      loadConferenceListen(),
      loadOperatorAudioOverrides(Platform.OS),
      hydrateTlsPins(),
    ]);
    this.operatorAudioOverrides = operatorAudioOverrides;
    this.leftHandedExplicit = typeof bundle.leftHanded === 'boolean';
    this.bigMainButtonExplicit = typeof bundle.bigMainButton === 'boolean';
    this.lockMultipleTargetsExplicit = typeof bundle.lockMultipleTargets === 'boolean';
    const last = bundle.profiles.find((item) => item.id === bundle.lastProfileId) ?? bundle.profiles[0] ?? null;
    useSessionStore.setState({
      hydrated: true,
      profiles: bundle.profiles,
      activeProfileId: last?.id ?? null,
      serverAddress: last?.serverAddress ?? '',
      username: last?.username ?? '',
      rememberPassword: last?.rememberPassword ?? true,
      allowInsecureLocalTLS: last?.allowInsecureLocalTLS ?? false,
      productionId: last?.productionId ?? null,
      productionName: last?.productionName ?? null,
      leftHanded: bundle.leftHanded ?? false,
      lockMultipleTargets: bundle.lockMultipleTargets ?? false,
      edgeTalkAffordance: bundle.edgeTalkAffordance !== false,
      mainButtonTargets: bundle.mainButtonTargets ?? {},
      watchTargetSelections: bundle.watchTargetSelections ?? {},
      bigMainButton: bundle.bigMainButton === true,
      audioSessionAvailable: audioSessionAvailable(),
      capabilityReason: this.background.capabilityReason({
        audioSessionAvailable: audioSessionAvailable(),
      }),
      audioPreferences,
      conferenceListen,
      operatorAudio: resolveOperatorAudio(operatorAudioOverrides),
      ...this.mediaCoordinator.audioDeviceFields(),
      ...bleFieldsFromSelection(blePreferences.target, blePreferences.shortPressLocksTalk),
      bleBindings: blePreferences.devices,
      bleFocusedDeviceId: blePreferences.devices[0]?.id ?? '',
      bleReleaseTimeoutMs: blePreferences.releaseTimeoutMs,
    });
    this.pendingPassword = last ? await passwordForProfile(last.id) : undefined;
    this.pendingLoginToken = Boolean(last?.loginToken);
    this.background.bindHardware();
    void startBleNative()
      .then((state) => this.background.publishBleState(state))
      .catch(() => {
        this.background.publishBleState({ kind: 'idle' });
      });
    void this.background.startPttHardwareTransports();
    if (last?.serverAddress) {
      void this.refreshLoginOptions(last.serverAddress);
    }
    if (bundle.profiles.length === 1 && last && profileCanAutoConnect(last, this.pendingPassword)) {
      try {
        await this.connectProfile(last.id);
      } catch {
        useSessionStore.setState({ paused: false, addingProfile: false, status: 'idle' });
      }
    }
  }

  rememberedPassword(): string {
    if (this.pendingLoginToken) {
      return '';
    }
    return this.pendingPassword ?? '';
  }

  async refreshLoginOptions(serverAddress = useSessionStore.getState().serverAddress): Promise<void> {
    if (!serverAddress.trim()) {
      useSessionStore.setState({ loginOptions: null });
      return;
    }
    try {
      this.prepareHttp(serverAddress);
      const loginOptions = await this.api?.loginOptions();
      useSessionStore.setState({
        loginOptions: loginOptions ?? { guestLogin: { enabled: false, label: 'Guest' }, sso: { enabled: false } },
      });
    } catch {
      useSessionStore.setState({
        loginOptions: { guestLogin: { enabled: false, label: 'Guest' }, sso: { enabled: false } },
      });
    }
  }

  async login(input: {
    serverAddress: string;
    username: string;
    password: string;
    rememberPassword: boolean;
    force?: boolean;
  }): Promise<void> {
    this.pendingPassword = input.password;
    this.pendingLoginToken = false;
    this.beginConnect(input.serverAddress, input.username, input.rememberPassword);
    await this.probeAndHealth();
    useSessionStore.setState({ statusMessage: 'Signing in…' });
    const identity = await this.requireApi().login(input.username, input.password);
    await this.attachSessionCookie(input.serverAddress);
    if (!(await this.finishIdentity(identity, input.force === true))) return;
    await this.persistCurrentProfile(input.password);
  }

  async loginWithToken(input: {
    serverAddress: string;
    token: string;
    rememberPassword?: boolean;
    force?: boolean;
  }): Promise<void> {
    this.pendingPassword = input.token;
    this.pendingLoginToken = true;
    this.beginConnect(input.serverAddress, useSessionStore.getState().username, input.rememberPassword ?? true);
    await this.probeAndHealth();
    useSessionStore.setState({ statusMessage: 'Signing in with login link…' });
    const identity = await this.requireApi().loginToken(input.token);
    useSessionStore.setState({ username: identity.name });
    await this.attachSessionCookie(input.serverAddress);
    if (!(await this.finishIdentity(identity, input.force === true))) return;
    await this.persistCurrentProfile(input.token);
  }

  async loginGuest(input: { serverAddress: string; displayName?: string; force?: boolean }): Promise<void> {
    this.pendingLoginToken = false;
    this.beginConnect(input.serverAddress, input.displayName ?? useSessionStore.getState().username, false);
    await this.probeAndHealth();
    useSessionStore.setState({ statusMessage: 'Signing in as guest…' });
    const identity = await this.requireApi().loginGuest(input.displayName);
    if (!(await this.finishIdentity(identity, input.force === true))) return;
    await this.persistCurrentProfile();
  }

  async acceptCertificateAndRetry(kind: 'user' | 'guest' = 'user'): Promise<void> {
    const pending = useSessionStore.getState().pendingCertificate;
    if (!pending) {
      return;
    }
    await rememberTlsPin({ hostname: pending.hostname, sha256: pending.sha256 });
    useSessionStore.setState({ pendingCertificate: null, error: null });
    const state = useSessionStore.getState();
    if (kind === 'guest') {
      await this.loginGuest({ serverAddress: state.serverAddress, displayName: state.username });
      return;
    }
    if (this.pendingLoginToken) {
      await this.loginWithToken({
        serverAddress: state.serverAddress,
        token: this.pendingPassword ?? '',
        rememberPassword: state.rememberPassword,
      });
      return;
    }
    await this.login({
      serverAddress: state.serverAddress,
      username: state.username,
      password: this.pendingPassword ?? '',
      rememberPassword: state.rememberPassword,
    });
  }

  async selectProduction(production: Production | null): Promise<void> {
    try {
      await this.mediaCoordinator.enterOperator(production);
    } catch (error) {
      useSessionStore.setState({
        status: 'choose-production',
        operatorReady: false,
        cameraTally: EMPTY_CAMERA_TALLY,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Tell TalkToMe 1.5+ which production this socket hears. Older servers ignore
   * the extra register field; unknown versions get a short ack timeout.
   */
  async announceActiveProduction(productionId: number | null): Promise<void> {
    const signaling = this.signaling;
    if (!signaling) {
      return;
    }
    const supported = supportsActiveProduction(this.serverAppVersion);
    if (supported === false) {
      return;
    }
    try {
      this.remotePanel.noteProduction(await signaling.setActiveProduction(productionId));
    } catch (error) {
      if (supported === true) {
        throw error;
      }
    }
  }

  reopenProductionPicker(): void {
    if ((useSessionStore.getState().productions ?? []).length === 0) {
      return;
    }
    useSessionStore.setState({
      operatorReady: false,
      status: 'choose-production',
      statusMessage: 'Choose a production',
    });
  }

  async takeOver(): Promise<void> {
    const state = useSessionStore.getState();
    if (state.identity?.kind === 'guest') {
      await this.loginGuest({
        serverAddress: state.serverAddress,
        displayName: state.identity.name,
        force: true,
      });
      return;
    }
    if (this.pendingLoginToken) {
      await this.loginWithToken({
        serverAddress: state.serverAddress,
        token: this.pendingPassword ?? '',
        rememberPassword: state.rememberPassword,
        force: true,
      });
      return;
    }
    await this.login({
      serverAddress: state.serverAddress,
      username: state.username,
      password: this.pendingPassword ?? '',
      rememberPassword: state.rememberPassword,
      force: true,
    });
  }

  async logout(statusMessage = 'Signed out.'): Promise<void> {
    await this.persistCurrentProfile();
    await this.teardownSession();
    this.applyDisconnectedState({ paused: false, addingProfile: false, statusMessage });
  }

  async disconnect(): Promise<void> {
    await this.persistCurrentProfile();
    await this.teardownSession();
    this.applyDisconnectedState({
      paused: true,
      addingProfile: false,
      status: 'paused',
      statusMessage: 'Disconnected.',
    });
  }

  async leaveToProfiles(): Promise<void> {
    await this.persistCurrentProfile();
    await this.teardownSession();
    this.applyDisconnectedState({ paused: false, addingProfile: false, statusMessage: '' });
  }

  openProfilePicker(): void {
    useSessionStore.setState({ paused: false, addingProfile: false, status: 'idle', error: null });
  }

  startAddProfile(options?: { openScanner?: boolean }): void {
    useSessionStore.setState({
      paused: false,
      addingProfile: true,
      openLoginScanner: Boolean(options?.openScanner),
      serverAddress: '',
      username: '',
      rememberPassword: true,
      productionId: null,
      productionName: null,
      error: null,
      conflictName: undefined,
      status: 'idle',
      statusMessage: '',
    });
    this.pendingPassword = undefined;
    this.pendingLoginToken = false;
  }

  cancelAddProfile(): void {
    const last = useSessionStore.getState().profiles.find((item) => item.id === useSessionStore.getState().activeProfileId);
    useSessionStore.setState({
      addingProfile: false,
      serverAddress: last?.serverAddress ?? useSessionStore.getState().profiles[0]?.serverAddress ?? '',
      username: last?.username ?? useSessionStore.getState().profiles[0]?.username ?? '',
    });
  }

  async connectProfile(profileId: string): Promise<void> {
    const profile = useSessionStore.getState().profiles.find((item) => item.id === profileId);
    if (!profile) {
      throw new Error('Profile not found.');
    }
    const password = await passwordForProfile(profile.id);
    this.pendingPassword = password;
    this.pendingLoginToken = Boolean(profile.loginToken);
    useSessionStore.setState({
      activeProfileId: profile.id,
      paused: false,
      addingProfile: false,
      serverAddress: profile.serverAddress,
      username: profile.username,
      rememberPassword: profile.rememberPassword,
      allowInsecureLocalTLS: Boolean(profile.allowInsecureLocalTLS),
      productionId: profile.productionId ?? null,
      productionName: profile.productionName ?? null,
      error: null,
    });
    try {
      if (profile.guest) {
        await this.loginGuest({
          serverAddress: profile.serverAddress,
          displayName: profile.guest.name,
        });
        return;
      }
      if (!password) {
        useSessionStore.setState({ addingProfile: true, status: 'idle' });
        return;
      }
      if (profile.loginToken) {
        await this.loginWithToken({
          serverAddress: profile.serverAddress,
          token: password,
          rememberPassword: profile.rememberPassword,
        });
        return;
      }
      await this.login({
        serverAddress: profile.serverAddress,
        username: profile.username,
        password,
        rememberPassword: profile.rememberPassword,
      });
    } catch (error) {
      if (error instanceof SessionConflictError) {
        useSessionStore.setState({
          addingProfile: true,
          status: 'idle',
          conflictName: error.existing?.name,
          error: null,
        });
        return;
      }
      if (error instanceof TlsUntrustedError) {
        useSessionStore.setState({ addingProfile: true, status: 'idle' });
        return;
      }
      useSessionStore.setState({
        status: 'idle',
        paused: false,
        addingProfile: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async reconnectLastProfile(): Promise<void> {
    const id = useSessionStore.getState().activeProfileId ?? useSessionStore.getState().profiles[0]?.id;
    if (!id) {
      this.startAddProfile();
      return;
    }
    await this.connectProfile(id);
  }

  async removeSavedProfile(profileId: string): Promise<void> {
    const state = useSessionStore.getState();
    const next = await removeProfile(profileId, {
      profiles: state.profiles,
      lastProfileId: state.activeProfileId,
      ...this.layoutBundleFields(state),
    });
    const fallback = next.profiles.find((item) => item.id === next.lastProfileId) ?? next.profiles[0];
    useSessionStore.setState({
      profiles: next.profiles,
      activeProfileId: next.lastProfileId,
      ...(state.activeProfileId === profileId
        ? {
            serverAddress: fallback?.serverAddress ?? '',
            username: fallback?.username ?? '',
          }
        : {}),
    });
  }

  noteTransportConnection(): void {
    const state = useSessionStore.getState();
    if (this.sessionEnding || !state.identity) {
      return;
    }
    if (transportReportsLoss(state.sendTransportState, state.recvTransportState)) {
      this.connectionCues.noteDisconnected();
      return;
    }
    if (state.sendTransportState === 'connected' || state.recvTransportState === 'connected') {
      this.announceConnectionRecovery();
    }
  }

  private noteUnexpectedDisconnect(): void {
    if (this.sessionEnding || !useSessionStore.getState().identity) {
      return;
    }
    this.connectionCues.noteDisconnected();
  }

  private announceConnectionRecovery(): void {
    const state = useSessionStore.getState();
    if (
      !canAnnounceConnectionRecovery({
        ending: this.sessionEnding,
        signedIn: Boolean(state.identity),
        socketConnected: this.signaling?.connected === true,
        heartbeatInterrupted: state.serverHeartbeatInterrupted,
        send: state.sendTransportState,
        receive: state.recvTransportState,
      })
    ) {
      return;
    }
    this.connectionCues.noteReconnected();
  }

  private onServerHeartbeat(interrupted: boolean): void {
    useSessionStore.setState({ serverHeartbeatInterrupted: interrupted });
    if (this.sessionEnding || !useSessionStore.getState().identity) {
      return;
    }
    if (interrupted) {
      this.connectionCues.noteDisconnected();
      return;
    }
    this.announceConnectionRecovery();
  }

  noteConnectionCueBackground(background: boolean): void {
    this.connectionCues.setBackground(background);
  }

  private stopServerHeartbeat(): void {
    this.heartbeat?.stop();
    this.heartbeat = null;
  }

  private syncServerHeartbeat(): void {
    this.stopServerHeartbeat();
    const signaling = this.signaling;
    if (!signaling?.connected || !supportsServerHeartbeat(this.serverAppVersion) || this.sessionEnding) {
      if (useSessionStore.getState().serverHeartbeatInterrupted) {
        useSessionStore.setState({ serverHeartbeatInterrupted: false });
      }
      return;
    }
    const heartbeat = createServerHeartbeat(
      {
        get connected() {
          return signaling.connected;
        },
        emitHealth: (timeoutMs, onReply) => signaling.emitConnectionHealth(timeoutMs, onReply),
      },
      (interrupted) => this.onServerHeartbeat(interrupted),
      { isPaused: () => AppState.currentState !== 'active' },
    );
    this.heartbeat = heartbeat;
    heartbeat.start();
  }

  private async teardownSession(): Promise<void> {
    this.clientStatusReporter?.stop();
    this.clientStatusReporter = null;
    this.sessionEnding = true;
    this.remotePanel.reset();
    this.stopServerHeartbeat();
    this.connectionCues.reset();
    const identity = useSessionStore.getState().identity;
    try {
      await this.talk.unlockTalk();
    } catch {
      // ignore
    }
    try {
      await this.media?.stop();
    } catch {
      // ignore
    }
    try {
      await this.signaling?.logout();
    } catch {
      // ignore
    }
    try {
      await this.api?.logout(identity?.id, this.signaling?.socketId);
    } catch {
      // ignore
    }
    this.signaling?.disconnect();
    this.media = null;
    this.signaling = null;
    this.api = null;
    this.http = null;
    this.cookies = {};
    this.talkingTargets = [];
    this.lockedTargets = [];
    this.overrideFrom = null;
    this.liveProducers = new Map();
    this.background.resetBleAccessorySession();
    await this.background.teardownAudioSession();
    await stopForegroundService();
  }

  private applyDisconnectedState(input: {
    paused: boolean;
    addingProfile: boolean;
    status?: SessionUiState['status'];
    statusMessage: string;
  }): void {
    const next = useSessionStore.getState();
    useSessionStore.setState({
      ...initialState,
      hydrated: true,
      serverAddress: next.serverAddress,
      username: next.username,
      rememberPassword: next.rememberPassword,
      allowInsecureLocalTLS: next.allowInsecureLocalTLS,
      leftHanded: next.leftHanded,
      lockMultipleTargets: next.lockMultipleTargets,
      edgeTalkAffordance: next.edgeTalkAffordance,
      mainButtonTargets: next.mainButtonTargets,
      watchTargetSelections: next.watchTargetSelections,
      bigMainButton: next.bigMainButton,
      productionId: next.productionId,
      productionName: next.productionName,
      profiles: next.profiles,
      activeProfileId: next.activeProfileId,
      paused: input.paused,
      addingProfile: input.addingProfile,
      conferenceListen: next.conferenceListen,
      loginOptions: next.loginOptions,
      audioPreferences: next.audioPreferences,
      bleKind: next.bleKind,
      bleName: next.bleName,
      bleMessage: next.bleMessage,
      bleScanning: next.bleScanning,
      bleDevices: next.bleDevices,
      bleBindings: next.bleBindings,
      bleFocusedDeviceId: next.bleFocusedDeviceId,
      bleReleaseTimeoutMs: next.bleReleaseTimeoutMs,
      bleShortPressLocks: next.bleShortPressLocks,
      bleTargetKind: next.bleTargetKind,
      bleTargetType: next.bleTargetType,
      bleTargetId: next.bleTargetId,
      bleTargetLabel: next.bleTargetLabel,
      pttHardwareLog: next.pttHardwareLog,
      bondedSerialDevices: next.bondedSerialDevices,
      fgsAvailable: next.fgsAvailable,
      audioSessionAvailable: next.audioSessionAvailable,
      status: input.status ?? 'idle',
      statusMessage: input.statusMessage,
    });
    this.background.syncPresence();
  }

  async persistCurrentProfile(password = this.pendingPassword): Promise<void> {
    const state = useSessionStore.getState();
    if (!state.serverAddress.trim() || !state.username.trim()) {
      await saveProfileBundle({
        profiles: state.profiles,
        lastProfileId: state.activeProfileId,
        ...this.layoutBundleFields(state),
      });
      return;
    }
    const id = profileIdentity(state.serverAddress, state.username);
    const existing = state.profiles.find((item) => item.id === id);
    const guest =
      state.identity?.kind === 'guest'
        ? {
            guestId: String(state.identity.guestId ?? state.identity.id),
            guestProfileUserId: state.identity.guestProfileUserId ?? 0,
            name: state.identity.name,
          }
        : existing?.guest;
    const saved: SavedProfile = {
      id,
      serverAddress: state.serverAddress,
      username: state.username,
      rememberPassword: state.rememberPassword,
      allowInsecureLocalTLS: state.allowInsecureLocalTLS,
      productionId: state.operatorReady ? state.productionId : (existing?.productionId ?? state.productionId),
      productionName: state.operatorReady ? state.productionName : (existing?.productionName ?? state.productionName),
      guest,
      loginToken: guest ? undefined : this.pendingLoginToken || undefined,
    };
    const profiles = upsertProfile(state.profiles, saved);
    useSessionStore.setState({ profiles, activeProfileId: id, addingProfile: false });
    await saveProfileBundle({
      profiles,
      lastProfileId: id,
      ...this.layoutBundleFields(state),
    });
    if (state.rememberPassword && password) {
      await savePasswordForProfile(id, password);
    } else if (!state.rememberPassword) {
      await savePasswordForProfile(id, undefined);
    }
  }

  /** Persist layout prefs; unset values stay undefined so server defaults apply. */
  private layoutBundleFields(state: SessionUiState) {
    return {
      leftHanded: this.leftHandedExplicit ? state.leftHanded : undefined,
      lockMultipleTargets: this.lockMultipleTargetsExplicit ? state.lockMultipleTargets : undefined,
      edgeTalkAffordance: state.edgeTalkAffordance,
      mainButtonTargets: state.mainButtonTargets,
      watchTargetSelections: state.watchTargetSelections,
      bigMainButton: this.bigMainButtonExplicit ? state.bigMainButton : undefined,
    };
  }

  setLeftHanded(leftHanded: boolean): void {
    this.leftHandedExplicit = true;
    useSessionStore.setState({ leftHanded, statusMessage: slideToLockHint(leftHanded) });
    this.persistLayout();
  }

  setLockMultipleTargets(lockMultipleTargets: boolean): void {
    this.lockMultipleTargetsExplicit = true;
    useSessionStore.setState({ lockMultipleTargets });
    if (!lockMultipleTargets) {
      void this.talk.collapseToSingleLock();
    }
    this.persistLayout();
  }

  setBigMainButton(bigMainButton: boolean): void {
    this.bigMainButtonExplicit = true;
    useSessionStore.setState({ bigMainButton });
    this.persistLayout();
  }

  setMainButtonTarget(identity: string): void {
    const state = useSessionStore.getState();
    const key = mainButtonStorageKey(state.activeProfileId, state.productionId);
    const mainButtonTargets = { ...state.mainButtonTargets };
    const trimmed = identity.trim();
    if (trimmed) {
      mainButtonTargets[key] = trimmed;
    } else {
      delete mainButtonTargets[key];
    }
    useSessionStore.setState({ mainButtonTargets });
    this.persistLayout();
    this.background.syncPresence();
  }

  setWatchTargets(keys: string[] | null): void {
    const state = useSessionStore.getState();
    const scope = mainButtonStorageKey(state.activeProfileId, state.productionId);
    const watchTargetSelections = { ...state.watchTargetSelections };
    if (keys === null) delete watchTargetSelections[scope];
    else watchTargetSelections[scope] = normalizeWatchTargetKeys(keys);
    useSessionStore.setState({ watchTargetSelections });
    this.persistLayout();
    this.background.syncPresence();
  }

  setEdgeTalkAffordance(edgeTalkAffordance: boolean): void {
    useSessionStore.setState({ edgeTalkAffordance });
    this.persistLayout();
  }

  persistLayout(): void {
    void this.persistCurrentProfile();
  }

  private bindSignaling(signaling: SignalingClient): void {
    signaling.handlers = {
      onTargetEditPermissions: permissions => useSessionStore.setState(permissions),
      onPanelCommand: command => this.remotePanel.handleCommand(command),
      onApiTalkCommand: command => this.remotePanel.handleCompanionTalk(command),
      onApiTargetAudioCommand: command => this.remotePanel.handleCompanionAudio(command),
      onPanelStateRequest: () => this.remotePanel.publish(),
      onUserAudioSettingsUpdated: settings => {
        void this.remotePanel.handleCommand({ kind: 'audio-settings', settings }).then(result => {
          if (!result.ok) useSessionStore.setState({ audioNotice: result.error || 'Unable to apply remote audio settings.' });
        });
      },
      onStateChange: (state) => {
        if (this.signaling !== signaling) return;
        if (state.status === 'connected') {
          useSessionStore.setState({
            signalingStatus: 'connected',
            signalingLabel: `connected ${state.socketId ?? ''}`.trim(),
          });
          this.syncServerHeartbeat();
        } else if (state.status === 'connecting') {
          useSessionStore.setState({
            signalingStatus: 'connecting',
            signalingLabel: 'reconnecting',
          });
        } else if (state.status === 'failed') {
          this.remotePanel.disconnected();
          useSessionStore.setState({
            signalingStatus: 'failed',
            signalingLabel: `failed: ${state.message}`,
          });
          this.stopServerHeartbeat();
          this.noteUnexpectedDisconnect();
        } else {
          useSessionStore.setState({
            signalingStatus: 'disconnected',
            signalingLabel: 'disconnected',
          });
          this.remotePanel.disconnected();
          this.stopServerHeartbeat();
        }
      },
      onReconnect: () => {
        if (this.signaling !== signaling) return;
        void this.handleReconnect();
      },
      onUserList: (peers) => {
        useSessionStore.setState({ peers });
        this.background.syncPresence();
      },
      onSessionKicked: (info) => {
        const message =
          info.reason === 'duplicate-login'
            ? 'This session was disconnected because another login took over.'
            : 'The session was disconnected by the server.';
        void this.logout(message);
      },
      onTargetsUpdated: () => {
        void this.mediaCoordinator.refreshTargets();
      },
      onConferenceMembersUpdated: () => {
        void this.mediaCoordinator.refreshTargets();
      },
      onForceStopTransmission: () => {
        // An admin stopped this client's transmission; drop talk and locks.
        void this.talk.unlockTalk().then(() => {
          useSessionStore.setState({ statusMessage: 'Transmission stopped by the server.' });
        });
      },
      onIncomingTalkState: (incoming) => {
        useSessionStore.setState({ incoming });
        this.talk.refreshReplyTarget();
        this.background.syncPresence();
        this.mediaCoordinator.syncFeedDucking();
      },
      onProducerStarted: (producer) => {
        this.mediaCoordinator.rememberLiveProducer(producer);
        void this.mediaCoordinator.consumeIfVisible(producer);
      },
      onProducerClosed: (producer) => {
        this.mediaCoordinator.forgetLiveProducer(producer.producerId);
        void this.media?.dropProducer(producer.producerId).then(() => {
          this.mediaCoordinator.publishMediaSnapshot();
        });
      },
      onConsumerClosed: (consumerId) => {
        void this.media?.dropConsumer(consumerId).then(() => {
          this.mediaCoordinator.publishMediaSnapshot();
        });
      },
      onCameraTally: (tally) => {
        useSessionStore.setState({ cameraTally: tally });
      },
      onActiveProductionReset: (productionId) => {
        void this.handleActiveProductionReset(productionId);
      },
      onAvailableProductionsUpdated: (productions) => {
        const currentId = useSessionStore.getState().productionId;
        const active = productions.find((item) => item.id === currentId);
        useSessionStore.setState({
          productions,
          productionName: active?.name ?? useSessionStore.getState().productionName,
        });
      },
    };
  }

  private async handleActiveProductionReset(productionId: number | null): Promise<void> {
    const productions = useSessionStore.getState().productions;
    const production =
      productionId == null ? null : (productions.find((item) => item.id === productionId) ?? {
        id: productionId,
        name: 'Production',
      });
    if (!useSessionStore.getState().operatorReady) {
      useSessionStore.setState({
        productionId,
        productionName: production?.name ?? (productions.length > 0 ? 'Default' : null),
        cameraTally: EMPTY_CAMERA_TALLY,
      });
      return;
    }
    try {
      await this.talk.unlockTalk();
      await this.mediaCoordinator.enterOperator(production);
    } catch (error) {
      useSessionStore.setState({
        status: 'choose-production',
        operatorReady: false,
        cameraTally: EMPTY_CAMERA_TALLY,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleReconnect(): Promise<void> {
    if (this.reconnecting) {
      return;
    }
    this.reconnecting = true;
    useSessionStore.setState({ statusMessage: 'Reconnecting…' });
    try {
      const identity = useSessionStore.getState().identity;
      if (!identity || !this.signaling) {
        return;
      }
      let register = await this.signaling.register(
        identity,
        false,
        useSessionStore.getState().productionId,
      );
      if (isRegisterConflict(register)) {
        const sameStaleSocket =
          Boolean(this.lastSocketId) && register.existing?.socketId === this.lastSocketId;
        if (!sameStaleSocket) {
          await this.logout('Could not re-register after reconnect.');
          return;
        }
        register = await this.signaling.register(
          identity,
          true,
          useSessionStore.getState().productionId,
        );
      }
      if (!isRegisterOk(register) && identity.kind === 'user' && this.pendingPassword) {
        await this.reauthenticateUser();
        this.reconnectFailures = 0;
        return;
      }
      if (!isRegisterOk(register)) {
        await this.logout('Could not re-register after reconnect.');
        return;
      }
      useSessionStore.setState({ allowTargetRearrange: register.allowTargetRearrange !== false, allowTargetAddRemove: register.allowTargetAddRemove === true });
      if (parsePanelSettings(register.panelSettings)) {
        const productions = Array.isArray(register.productions) ? parseProductions(register.productions) : useSessionStore.getState().productions;
        const productionId = positiveId(register.productionId);
        const production = productions.find(item => item.id === productionId);
        useSessionStore.setState({ productions, productionId: production?.id ?? null, productionName: production?.name ?? null });
      }
      // The old transports belong to the previous socket. Restore preferences
      // into state before rebuilding, without sending commands for old producers.
      try { await this.media?.stop(); } catch { /* Already disconnected. */ }
      this.media = null;
      await this.remotePanel.restoreRegistration(register);
      await this.announceActiveProduction(useSessionStore.getState().productionId);
      await this.mediaCoordinator.rebuildMediaAfterReconnect();
      this.reconnectFailures = 0;
      this.announceConnectionRecovery();
    } catch (error) {
      if (useSessionStore.getState().identity?.kind === 'user' && this.pendingPassword) {
        try {
          await this.reauthenticateUser();
          this.reconnectFailures = 0;
          return;
        } catch {
          // fall through
        }
      }
      this.reconnectFailures += 1;
      useSessionStore.setState({
        error: error instanceof Error ? error.message : String(error),
        statusMessage:
          this.reconnectFailures >= 3
            ? 'Reconnect failed. Sign in again from the session menu.'
            : 'Reconnect failed. Retrying…',
      });
    } finally {
      this.reconnecting = false;
    }
  }

  private async reauthenticateUser(): Promise<void> {
    const state = useSessionStore.getState();
    if (this.pendingLoginToken) {
      await this.loginWithToken({
        serverAddress: state.serverAddress,
        token: this.pendingPassword ?? '',
        rememberPassword: state.rememberPassword,
        force: true,
      });
      return;
    }
    await this.login({
      serverAddress: state.serverAddress,
      username: state.username,
      password: this.pendingPassword ?? '',
      rememberPassword: state.rememberPassword,
      force: true,
    });
  }

  private beginConnect(serverAddress: string, username: string, rememberPassword: boolean): void {
    this.sessionEnding = false;
    useSessionStore.setState({
      status: 'connecting',
      error: null,
      conflictName: undefined,
      pendingCertificate: null,
      statusMessage: 'Contacting server…',
      serverAddress,
      username,
      rememberPassword,
    });
    this.prepareHttp(serverAddress);
  }

  private async attachSessionCookie(serverAddress: string): Promise<void> {
    const parsed = parseServerAddress(serverAddress);
    const nativeCookies = await readNativeCookies(parsed.baseUrl);
    this.cookies = { ...this.cookies, ...nativeCookies };
    if (requiresBrowserSessionCookie(this.serverAppVersion) && !hasSessionCookie(this.cookies)) {
      throw new SessionCookieUnavailableError();
    }
  }

  private prepareHttp(serverAddress: string): void {
    const parsed = parseServerAddress(serverAddress);
    this.cookies = {};
    this.serverAppVersion = undefined;
    useSessionStore.setState({ serverAppVersion: null });
    this.http = new TalkToMeHttp({
      baseUrl: parsed.baseUrl,
      retryLocalNetworkErrors: Platform.OS === 'ios',
      getCookies: () => this.cookies,
      setCookies: (next) => {
        this.cookies = next;
      },
    });
    this.api = new ApiClient(this.http);
  }

  private async probeAndHealth(): Promise<void> {
    const state = useSessionStore.getState();
    const parsed = parseServerAddress(state.serverAddress);
    const hostname = new URL(parsed.baseUrl).hostname;
    try {
      const health = await this.requireApi().health();
      this.serverAppVersion = health.appVersion;
      useSessionStore.setState({ serverAppVersion: health.appVersion ?? null });
    } catch (error) {
      if (error instanceof LocalNetworkUnavailableError) throw error;
      if (!looksLikeTlsFailure(error)) {
        useSessionStore.setState({
          statusMessage: 'Health check failed; trying login anyway.',
        });
        return;
      }

      let probe = null;
      if (state.allowInsecureLocalTLS) {
        try {
          probe = await probeServerCertificate(parsed.baseUrl);
        } catch {
          probe = null;
        }
      }

      if (probe) {
        const known = storedPinForHost(probe.hostname);
        if (pinMatches(known, probe.sha256)) {
          useSessionStore.setState({
            statusMessage: 'Health check failed; pinned certificate is already trusted. Trying login.',
          });
          return;
        }
        useSessionStore.setState({
          status: 'idle',
          pendingCertificate: probe,
          error: null,
          statusMessage: 'This certificate is not in the system trust store.',
        });
        throw new TlsUntrustedError(hostname, isLikelyLocalHost(hostname));
      }

      throw new TlsUntrustedError(hostname, isLikelyLocalHost(hostname));
    }
  }

  private async finishIdentity(identity: OperatorIdentity, force: boolean): Promise<boolean> {
    this.clientStatusReporter?.stop();
    this.clientStatusReporter = null;
    const parsed = parseServerAddress(useSessionStore.getState().serverAddress);
    this.signaling?.disconnect();
    const signaling = new SignalingClient(parsed.baseUrl, () => this.cookies, Platform.OS, readNativeClientVersion());
    this.signaling = signaling;
    this.bindSignaling(signaling);

    useSessionStore.setState({ statusMessage: 'Connecting signaling…' });
    try {
      await signaling.connect();
    } catch (error) {
      // Replacing or ending a pending login is silent and must not persist it.
      if (error instanceof SignalingConnectCancelledError) return false;
      throw error;
    }
    if (this.signaling !== signaling) return false;
    let productions = Array.isArray(identity.productions) ? identity.productions : [];
    const rememberedProductionId = useSessionStore.getState().productionId;
    const rememberedProductionName = useSessionStore.getState().productionName;
    const registerProductionId =
      productions.length === 0 || productions.some((item) => item.id === rememberedProductionId)
        ? rememberedProductionId
        : null;
    const register = await signaling.register(identity, force, registerProductionId);
    if (this.signaling !== signaling) return false;

    if (isRegisterConflict(register)) {
      signaling.disconnect();
      this.signaling = null;
      useSessionStore.setState({
        status: 'idle',
        conflictName: register.existing?.name,
        statusMessage: '',
      });
      throw new SessionConflictError(register.existing);
    }
    if (!isRegisterOk(register)) {
      const message = 'error' in register ? register.error : 'register-user failed';
      if (typeof message === 'string' && /authenticated identity does not match/i.test(message)) {
        throw new SessionCookieUnavailableError();
      }
      throw new Error(message);
    }

    useSessionStore.setState({ allowTargetRearrange: register.allowTargetRearrange !== false, allowTargetAddRemove: register.allowTargetAddRemove === true });
    const panelSettings = parsePanelSettings(register.panelSettings);
    if (panelSettings && Array.isArray(register.productions)) productions = parseProductions(register.productions);
    this.lastSocketId = signaling.socketId;
    await this.refreshServerClientDefaults();
    if (this.signaling !== signaling) return false;
    useSessionStore.setState({
      identity,
      productions,
      productionId: null,
      productionName: null,
      operatorReady: false,
      signalingStatus: 'connected',
      signalingLabel: 'connected',
    });

    await this.remotePanel.restoreRegistration(register);
    if (this.signaling !== signaling) return false;
    this.clientStatusReporter = createClientStatusReporter({
      connected: () => this.signaling === signaling && signaling.connected,
      collect: async () => {
        const media = this.media;
        const [deviceStatus, stats] = await Promise.all([
          readNativeDeviceStatus(),
          media?.networkStats().catch(() => null) ?? Promise.resolve(null),
        ]);
        return { deviceStatus, stats: media === this.media ? stats : null };
      },
      publish: (value) => {
        const report = value as { deviceStatus: unknown; stats: unknown };
        signaling.reportDeviceStatus(report.deviceStatus);
        if (report.stats) signaling.reportMediaNetworkStats(report.stats);
      },
    });
    const serverSelectedProduction = panelSettings?.storage[`activeProduction:${identity.id}`]
      ? productions.find(item => item.id === positiveId(register.productionId)) : undefined;

    if (productions.length > 0) {
      const remembered = serverSelectedProduction ?? productions.find((item) => item.id === rememberedProductionId);
      if (remembered) {
        await this.mediaCoordinator.enterOperator(remembered);
        this.announceConnectionRecovery();
        return true;
      }
      if (productions.length === 1 || (rememberedProductionId == null && rememberedProductionName?.trim().toLowerCase() === 'default')) {
        await this.mediaCoordinator.enterOperator(productions[0]!);
        this.announceConnectionRecovery();
        return true;
      }
      useSessionStore.setState({
        status: 'choose-production',
        statusMessage: 'Choose a production',
      });
      this.announceConnectionRecovery();
      return true;
    }

    await this.mediaCoordinator.enterOperator(null);
    this.announceConnectionRecovery();
    return true;
  }

  requireApi(): ApiClient {
    if (!this.api) {
      throw new Error('Not signed in.');
    }
    return this.api;
  }

  /**
   * Pulls the admin-configured client defaults (server 1.4.4+) and applies
   * them to every setting the user has not explicitly changed on this device.
   */
  private async refreshServerClientDefaults(): Promise<void> {
    this.serverClientDefaults = (await this.api?.defaultClientSettings()) ?? {};
    const defaults = this.serverClientDefaults;
    const operatorAudio = resolveOperatorAudio(this.operatorAudioOverrides, defaults);
    useSessionStore.setState({ operatorAudio });
    this.media?.setOperatorAudio(operatorAudio);
    if (!this.leftHandedExplicit && typeof defaults.leftHandMode === 'boolean') {
      useSessionStore.setState({ leftHanded: defaults.leftHandMode });
    }
    if (!this.bigMainButtonExplicit) {
      useSessionStore.setState({ bigMainButton: defaults.bigMainButton === true });
    }
    if (!this.lockMultipleTargetsExplicit && typeof defaults.lockMultipleTargets === 'boolean') {
      useSessionStore.setState({ lockMultipleTargets: defaults.lockMultipleTargets });
    }
  }

  // Talk façade.
  canTalkTo(target: TalkTarget): boolean {
    return this.talk.canTalkTo(target);
  }

  async pressTalk(target: TalkTarget, inputKey?: string): Promise<void> {
    await this.talk.pressTalk(target, inputKey);
  }

  async lockTalk(target: TalkTarget): Promise<void> {
    await this.talk.lockTalk(target);
  }

  async releaseTalk(target?: TalkTarget, inputKey?: string): Promise<void> {
    await this.talk.releaseTalk(target, inputKey);
  }

  async pressReply(): Promise<void> {
    await this.talk.pressReply();
  }

  async lockReply(): Promise<void> {
    await this.talk.lockReply();
  }

  replyTalkTarget(): TalkTarget | null {
    return this.talk.replyTalkTarget();
  }

  async pressMainButton(): Promise<void> {
    await this.talk.pressMainButton();
  }

  async lockMainButton(): Promise<void> {
    await this.talk.lockMainButton();
  }

  async availableTargets(): Promise<TalkTarget[]> {
    return this.requireApi().fetchAvailableTargets(useSessionStore.getState().productionId);
  }

  async editTargetSelection(target: TalkTarget, action: 'add' | 'remove'): Promise<void> {
    const state = useSessionStore.getState();
    if (state.identity?.kind !== 'user' || !state.allowTargetAddRemove) throw new Error('This account cannot add or remove targets.');
    const profileId = state.activeProfileId, productionId = state.productionId;
    if (action === 'remove' && state.talkingTargetKeys.includes(talkTargetIdentity(target))) await this.talk.unlockTalk();
    await this.requireApi().editTargetSelection(productionId, action, target.type, Number(target.id));
    if (profileId === useSessionStore.getState().activeProfileId && productionId === useSessionStore.getState().productionId) await this.mediaCoordinator.refreshTargets();
  }

  async saveTargetOrder(next: TalkTarget[]): Promise<void> {
    const previous = useSessionStore.getState().targets;
    useSessionStore.setState({ targets: next });
    try {
      await this.requireApi().saveTargetOrder(useSessionStore.getState().productionId, targetOrderPayload(next));
    } catch (error) {
      useSessionStore.setState({ targets: previous });
      await this.mediaCoordinator.refreshTargets().catch(() => undefined);
      throw error;
    }
    await this.mediaCoordinator.refreshTargets().catch(() => undefined);
  }

  async toggleCurrentTalk(): Promise<void> {
    await this.talk.toggleCurrentTalk();
  }

  handleTalkUrl(url: string): void {
    this.talk.handleTalkUrl(url);
  }

  setConferenceMemberListening(conferenceId: number | string, userId: number, listening: boolean): void {
    this.talk.setConferenceMemberListening(conferenceId, userId, listening);
  }

  setConferenceMemberLevel(conferenceId: number | string, userId: number, level: number): void {
    this.talk.setConferenceMemberLevel(conferenceId, userId, level);
  }

  // Media façade.
  audioPreference(target: TalkTarget): TargetAudioPreference {
    return this.mediaCoordinator.audioPreference(target);
  }

  setTargetVolume(target: TalkTarget, volume: number): void {
    this.mediaCoordinator.setTargetVolume(target, volume);
  }

  toggleTargetMuted(target: TalkTarget): void {
    this.mediaCoordinator.toggleTargetMuted(target);
  }

  toggleFeedReception(target: TalkTarget): void {
    this.mediaCoordinator.toggleFeedReception(target);
  }

  setOperatorAudio(patch: Partial<OperatorAudioSettings>): void {
    void this.mediaCoordinator.setOperatorAudio(patch).catch(error => {
      useSessionStore.setState({ audioNotice: error instanceof Error ? error.message : String(error) });
    });
  }

  async selectAudioDevice(id: string): Promise<void> {
    await this.mediaCoordinator.selectAudioDevice(id);
  }

  refreshAudioDevices(): void {
    this.mediaCoordinator.refreshAudioDevices();
  }

  // Background façade.
  bluetoothButtonCandidates(): TalkTarget[] {
    return this.background.bluetoothButtonCandidates();
  }

  bluetoothButtonSelection(deviceId?: string, button?: PttButton): BleTargetSelection {
    return this.background.bluetoothButtonSelection(deviceId, button);
  }

  setBluetoothButtonTarget(selection: BleTargetSelection, deviceId?: string, button?: PttButton): void {
    this.background.setBluetoothButtonTarget(selection, deviceId, button);
  }

  setRotaryRetargetsPtt1(deviceId: string, enabled: boolean): void {
    this.background.setRotaryRetargetsPtt1(deviceId, enabled);
  }

  setBluetoothButtonShortPressLocks(enabled: boolean): void {
    this.background.setBluetoothButtonShortPressLocks(enabled);
  }

  cycleBluetoothReleaseTimeout(): void {
    this.background.cycleBluetoothReleaseTimeout();
  }

  focusBluetoothAccessory(deviceId: string): void {
    this.background.focusBluetoothAccessory(deviceId);
  }

  async beginButtonPairing(): Promise<void> {
    await this.background.beginButtonPairing();
  }

  async cancelButtonPairing(): Promise<void> {
    await this.background.cancelButtonPairing();
  }

  async connectBluetoothButton(): Promise<void> {
    await this.background.connectBluetoothButton();
  }

  async connectKnownBluetoothAccessory(deviceId: string): Promise<void> {
    await this.background.connectKnownBluetoothAccessory(deviceId);
  }

  async disconnectBluetoothButton(deviceId?: string): Promise<void> {
    await this.background.disconnectBluetoothButton(deviceId);
  }

  async probeSerialAccessory(deviceId: string): Promise<void> {
    await this.background.probeSerialAccessory(deviceId);
  }

  removeBluetoothAccessory(deviceId: string): void {
    this.background.removeBluetoothAccessory(deviceId);
  }

  async openBatteryEducation(): Promise<void> {
    await this.background.openBatteryEducation();
  }
}
