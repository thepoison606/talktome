import type { PanelAudioState } from '../protocol/remotePanel';
import { AppState, Platform } from 'react-native';

import { MediaEngine } from '../media/engine';
import { talkOpusProfile } from '../media/opus';
import {
  filterProducersToVisibleTargets,
  producerMatchesVisibleTargets,
} from '../media/visibleProducers';
import {
  activeFeedKeysFromProducers,
  isFeedVideoProducer,
  defaultAudioPreference,
  EMPTY_CAMERA_TALLY,
  normalizeAudioPreference,
  talkTargetIdentity,
  type ActiveProducer,
  type OperatorIdentity,
  type Production,
  type TargetAudioPreference,
  type TalkTarget,
} from '../protocol';
import {
  activateForIntercom,
  audioSessionAvailable,
  setWebRTCAudioEnabled,
} from '../audio/session';
import { shouldPrepareAudioForMedia } from '../audio/policy';
import { restoreSavedAudioRoute, normalizeAudioRouteId, readAudioRouteSnapshot, selectAudioRoute, type AudioRouteSnapshot } from '../audio/routes';
import { saveAudioPreferences } from './audioPrefs';
import {
  resolveOperatorAudio,
  saveOperatorAudioOverrides,
  type OperatorAudioSettings,
} from './operatorAudio';
import { HOLD_HINT, useSessionStore } from './state';
import { IDLE_MEDIA_CONNECTION } from './connectionHealth';
import type { SessionController } from './sessionController';

/** Operator media lifecycle: MediaEngine, consumers, audio prep, devices, and preferences. */
export class MediaCoordinator {
  private visibleVideoKeys: string[] = [];
  constructor(private readonly c: SessionController) {}

  setVisibleFeedVideos(keys: string[]): void {
    this.visibleVideoKeys = keys;
    this.c.media?.setFeedVideoTargets(keys);
  }

  private bindVideoReceiver(): void {
    if (!this.c.media) return;
    this.c.media.onVideoChange = () => useSessionStore.setState({ feedVideos: this.c.media?.feedVideoSnapshot ?? {} });
    this.c.media.setFeedVideoTargets(this.visibleVideoKeys);
  }

  async enterOperator(production: Production | null): Promise<void> {
    const identity = useSessionStore.getState().identity;
    const signaling = this.c.signaling;
    if (!identity || !this.c.api || !signaling) {
      throw new Error('Not signed in.');
    }

    useSessionStore.setState({
      status: 'connecting',
      statusMessage: 'Loading targets…',
      error: null,
      cameraTally: EMPTY_CAMERA_TALLY,
    });

    await this.c.talk.unlockTalk();
    await this.c.announceActiveProduction(production?.id ?? null);

    const targets = await this.loadTargets(identity, production?.id ?? null);
    useSessionStore.setState({
      productionId: production?.id ?? null,
      productionName: production?.name ?? (useSessionStore.getState().productions.length > 0 ? 'Default' : null),
      targets,
    });

    if (!this.c.media) {
      this.c.media = new MediaEngine(signaling);
      this.c.media.onConnectionChange = () => this.publishMediaSnapshot();
      this.bindVideoReceiver();
      this.c.media.setTalkOpusProfile(talkOpusProfile(this.c.remotePanel.audioProfile ?? this.c.serverClientDefaults.audioProfile));
      this.c.media.setAudioPreferences(useSessionStore.getState().audioPreferences);
      this.c.media.setConferenceListen(useSessionStore.getState().conferenceListen);
      this.c.media.setOperatorAudio(useSessionStore.getState().operatorAudio);
      this.syncFeedDucking();
      useSessionStore.setState({ statusMessage: 'Starting media…' });
      await this.prepareAudioForMedia();
      await this.selectSavedAudioRoute();
      await this.c.media.start();
      try {
        await this.c.media.warmTalkProducer();
      } catch (error) {
        useSessionStore.setState({
          statusMessage: `Microphone not ready: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      this.publishCaptureDebug();
    } else {
      this.c.media.setAudioPreferences(useSessionStore.getState().audioPreferences);
      this.c.media.setConferenceListen(useSessionStore.getState().conferenceListen);
      this.c.media.setOperatorAudio(useSessionStore.getState().operatorAudio);
      this.syncFeedDucking();
    }

    await this.c.media.setStoppedFeedKeys(useSessionStore.getState().stoppedFeedKeys, this.consumerContext());
    const producers = await signaling.requestActiveProducers();
    await this.syncHeardAudio(producers);

    useSessionStore.setState({
      status: 'ready',
      operatorReady: true,
      talking: false,
      talkLocked: false,
      talkingTargetKeys: [],
      lockedTargetKeys: [],
      statusMessage: HOLD_HINT,
    });
    this.c.talk.refreshReplyTarget();
    await this.c.background.syncAudioSession(AppState.currentState);
    await this.c.background.syncForegroundService();
    await this.c.persistCurrentProfile();
    this.c.background.syncPresence();
    await this.c.remotePanel.operatorReady();
  }

  async rebuildMediaAfterReconnect(): Promise<void> {
    const signaling = this.c.signaling;
    if (!signaling) {
      return;
    }
    this.c.lastSocketId = signaling.socketId;
    const locked = useSessionStore.getState().talkLocked;
    const resumeTargets = locked ? this.c.lockedTargets : [];
    try {
      await this.c.media?.stop();
    } catch {
      // ignore
    }
    this.c.media = new MediaEngine(signaling);
    this.c.media.onConnectionChange = () => this.publishMediaSnapshot();
    this.bindVideoReceiver();
    this.c.media.setTalkOpusProfile(talkOpusProfile(this.c.remotePanel.audioProfile ?? this.c.serverClientDefaults.audioProfile));
    this.c.media.setAudioPreferences(useSessionStore.getState().audioPreferences);
    this.c.media.setConferenceListen(useSessionStore.getState().conferenceListen);
    this.c.media.setOperatorAudio(useSessionStore.getState().operatorAudio);
    await this.prepareAudioForMedia();
    await this.c.media.start();
    await this.c.media.warmTalkProducer();
    await this.c.media.setStoppedFeedKeys(useSessionStore.getState().stoppedFeedKeys, this.consumerContext());
    await this.refreshTargets();
    await this.c.background.syncAudioSession(AppState.currentState);
    await this.c.background.syncForegroundService();
    if (resumeTargets.length > 0) {
      await this.c.background.prepareAudioForTalk();
      this.c.talkingTargets = resumeTargets;
      this.c.overrideFrom = null;
      await this.c.media.startTalking(resumeTargets, true);
      this.c.talk.publishTalkState(true);
    }
    useSessionStore.setState({
      status: useSessionStore.getState().operatorReady ? 'ready' : useSessionStore.getState().status,
      statusMessage: resumeTargets.length > 0 ? useSessionStore.getState().statusMessage : 'Reconnected.',
    });
    await this.c.remotePanel.operatorReady();
  }

  async refreshTargets(): Promise<void> {
    const identity = useSessionStore.getState().identity;
    if (!identity || !this.c.api) {
      return;
    }
    const targets = await this.loadTargets(identity, useSessionStore.getState().productionId);
    useSessionStore.setState({ targets });
    this.c.talk.refreshReplyTarget();
    await this.resyncHeardAudio();
  }

  private async loadTargets(identity: OperatorIdentity, productionId: number | null): Promise<TalkTarget[]> {
    if (identity.kind === 'guest') {
      return this.c.requireApi().fetchGuestTargets(productionId);
    }
    return this.c.requireApi().fetchTargets(Number(identity.id), productionId);
  }

  audioPreference(target: TalkTarget): TargetAudioPreference {
    return (
      useSessionStore.getState().audioPreferences[talkTargetIdentity(target)] ?? defaultAudioPreference()
    );
  }

  async applyTargetAudioStates(states: PanelAudioState[], replace: boolean): Promise<void> {
    const audioPreferences = replace ? {} : { ...useSessionStore.getState().audioPreferences };
    for (const state of states) {
      audioPreferences[talkTargetIdentity({ type: state.targetType, id: state.targetId })] = normalizeAudioPreference(state);
    }
    useSessionStore.setState({ audioPreferences });
    this.c.media?.setAudioPreferences(audioPreferences);
    await saveAudioPreferences(audioPreferences);
  }

  setTargetVolume(target: TalkTarget, volume: number): void {
    this.updateAudioPreference(target, { volume });
  }

  toggleTargetMuted(target: TalkTarget): void {
    const current = this.audioPreference(target);
    this.updateAudioPreference(target, { muted: !current.muted });
  }

  toggleFeedReception(target: TalkTarget): void {
    if (target.type !== 'feed') {
      return;
    }
    const key = talkTargetIdentity(target);
    const current = new Set(useSessionStore.getState().stoppedFeedKeys);
    if (current.has(key)) {
      current.delete(key);
    } else {
      current.add(key);
    }
    void this.applyStoppedFeedKeys([...current]);
  }

  async applyStoppedFeedKeys(stoppedFeedKeys: string[]): Promise<void> {
    useSessionStore.setState({ stoppedFeedKeys });
    this.c.background.syncPresence();
    await this.c.media?.setStoppedFeedKeys(stoppedFeedKeys, this.consumerContext());
    this.publishMediaSnapshot();
  }

  private updateAudioPreference(target: TalkTarget, patch: Partial<TargetAudioPreference>): void {
    const key = talkTargetIdentity(target);
    const next = {
      ...useSessionStore.getState().audioPreferences,
      [key]: normalizeAudioPreference({
        ...this.audioPreference(target),
        ...patch,
      }),
    };
    useSessionStore.setState({ audioPreferences: next });
    this.c.media?.setAudioPreferences(next);
    void saveAudioPreferences(next);
  }

  async setOperatorAudio(patch: Partial<OperatorAudioSettings>): Promise<void> {
    // Every key the user touches becomes an explicit choice that outlives
    // server-configured defaults, matching the web client's precedence.
    const previous = useSessionStore.getState().operatorAudio;
    this.c.operatorAudioOverrides = { ...this.c.operatorAudioOverrides, ...patch };
    const operatorAudio = resolveOperatorAudio(this.c.operatorAudioOverrides, this.c.serverClientDefaults);
    useSessionStore.setState({ operatorAudio });
    this.c.media?.setOperatorAudio(operatorAudio);
    this.syncFeedDucking();
    await saveOperatorAudioOverrides(this.c.operatorAudioOverrides);
    if (
      previous.echoCancellation !== operatorAudio.echoCancellation ||
      previous.noiseSuppression !== operatorAudio.noiseSuppression ||
      previous.autoGainControl !== operatorAudio.autoGainControl
    ) {
      await this.c.media?.applyCaptureSettings(operatorAudio);
      this.publishCaptureDebug();
    }
  }

  async selectAudioDevice(id: string): Promise<void> {
    id = normalizeAudioRouteId(id);
    const snapshot = await selectAudioRoute(id);
    this.publishAudioDevices(snapshot);
    if (snapshot.currentId !== id && !snapshot.routes.some(route => route.id === id && route.selected)) {
      throw new Error('The device could not select this audio route.');
    }
    await this.setOperatorAudio({ audioRouteId: id });
  }

  refreshAudioDevices(): void {
    this.publishAudioDevices();
    this.publishCaptureDebug();
  }

  syncFeedDucking(): void {
    const state = useSessionStore.getState();
    this.c.media?.setDuckingActive({
      talking: state.talking,
      incomingAddressed: state.incoming.addressedNow.length > 0,
    });
  }

  audioDeviceFields(snapshot = readAudioRouteSnapshot()) {
    return {
      audioRoutes: snapshot.routes,
      audioInputLabel: snapshot.inputLabel,
      audioOutputLabel: snapshot.outputLabel,
      audioVoiceProcessing: snapshot.voiceProcessing,
    };
  }

  publishAudioDevices(snapshot?: AudioRouteSnapshot): void {
    useSessionStore.setState(this.audioDeviceFields(snapshot));
  }

  private async selectSavedAudioRoute(): Promise<void> {
    const id = useSessionStore.getState().operatorAudio.audioRouteId;
    this.publishAudioDevices(await restoreSavedAudioRoute(id));
  }

  private publishCaptureDebug(): void {
    const capture = this.c.media?.captureDebug();
    useSessionStore.setState({
      captureMicLabel: capture?.label ?? 'Microphone',
      captureEchoCancellation: capture?.echoCancellation ?? null,
      captureNoiseSuppression: capture?.noiseSuppression ?? null,
      captureAutoGainControl: capture?.autoGainControl ?? null,
    });
  }

  publishMediaSnapshot(): void {
    const connection = this.c.media?.connectionSnapshot() ?? IDLE_MEDIA_CONNECTION;
    useSessionStore.setState({
      overBudget: this.c.media?.overBudget ?? false,
      activeRemoteCount: this.c.media?.activeRemoteCount ?? 0,
      speakingTargetKeys: this.c.media?.speakingTargetKeys ?? [],
      mediaDebug: this.c.media?.mediaDebugLine() ?? '',
      sendTransportState: connection.send,
      recvTransportState: connection.receive,
      sendIceState: connection.sendIce,
      recvIceState: connection.receiveIce,
      mediaIceError: connection.iceError,
      mediaReady: connection.mediaReady,
    });
    this.c.noteTransportConnection();
  }

  rememberLiveProducer(producer: ActiveProducer): void {
    this.c.liveProducers.set(producer.producerId, producer);
    this.publishActiveFeeds();
  }

  async consumeIfVisible(producer: ActiveProducer): Promise<void> {
    if (!producerMatchesVisibleTargets(producer, useSessionStore.getState().targets)) {
      this.publishMediaSnapshot();
      return;
    }
    try {
      await this.c.media?.consumeProducer(producer, this.consumerContext());
      if (useSessionStore.getState().audioNotice) {
        useSessionStore.setState({ audioNotice: '' });
      }
    } catch {
      // Keep the session; the next producer event or resync will retry.
      useSessionStore.setState({
        audioNotice: 'A live feed could not be opened. TalkToMe will retry.',
      });
    } finally {
      this.publishMediaSnapshot();
    }
  }

  forgetLiveProducer(producerId: string): void {
    this.c.liveProducers.delete(producerId);
    this.publishActiveFeeds();
  }

  replaceLiveProducers(producers: ActiveProducer[]): void {
    this.c.liveProducers = new Map(producers.map((producer) => [producer.producerId, producer]));
    this.publishActiveFeeds();
  }

  heardProducers(producers = [...this.c.liveProducers.values()]): ActiveProducer[] {
    return filterProducersToVisibleTargets(producers, useSessionStore.getState().targets);
  }

  async syncHeardAudio(producers: ActiveProducer[]): Promise<void> {
    this.replaceLiveProducers(producers);
    await this.c.media?.syncProducers(this.heardProducers(producers), this.consumerContext());
    if (useSessionStore.getState().audioNotice) {
      useSessionStore.setState({ audioNotice: '' });
    }
    this.publishMediaSnapshot();
  }

  async resyncHeardAudio(): Promise<void> {
    const signaling = this.c.signaling;
    if (signaling) {
      try {
        const producers = await signaling.requestActiveProducers();
        await this.syncHeardAudio(producers);
        return;
      } catch {
        // Fall through and filter whatever we already track.
      }
    }
    await this.c.media?.syncProducers(this.heardProducers(), this.consumerContext());
    this.publishMediaSnapshot();
  }

  private publishActiveFeeds(): void {
    useSessionStore.setState({
      activeFeedKeys: activeFeedKeysFromProducers(this.heardProducers()),
      videoFeedKeys: activeFeedKeysFromProducers(this.heardProducers().filter(isFeedVideoProducer)),
    });
    this.c.background.syncPresence();
  }

  consumerContext() {
    const state = useSessionStore.getState();
    return {
      talkTargetKey: state.talkingTargetKeys[0] ?? null,
      lockedTargetKey: state.lockedTargetKeys[0] ?? null,
    };
  }

  private async prepareAudioForMedia(): Promise<void> {
    if (!shouldPrepareAudioForMedia({ platform: Platform.OS })) {
      return;
    }
    const active = await activateForIntercom();
    if (active) {
      await setWebRTCAudioEnabled(true);
    }
    useSessionStore.setState({
      audioSessionAvailable: audioSessionAvailable(),
      audioSessionActive: active,
      capabilityReason: this.c.background.capabilityReason({
        audioSessionAvailable: audioSessionAvailable(),
        audioSessionActive: active,
      }),
    });
  }
}
