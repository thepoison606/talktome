import { FeedVideoReceiver } from './feedVideoReceiver';
import { isFeedVideoProducer } from '../protocol/producers';
import { Device } from 'mediasoup-client';
import type { Consumer, Producer, Transport } from 'mediasoup-client/types';
import { mediaDevices, MediaStream } from 'react-native-webrtc';

import type { SignalingClient } from '../signaling/client';
import {
  describeIceCandidateError,
  IDLE_MEDIA_CONNECTION,
  type MediaConnectionSnapshot,
} from '../session/connectionHealth';
import {
  normalizeAudioPreference,
  playbackGain,
  type TargetAudioPreference,
} from '../protocol/audioPreference';
import type { ActiveProducer, IceServer, TalkTarget } from '../protocol/types';
import {
  EMPTY_CONFERENCE_LISTEN,
  conferenceMemberGain,
  type ConferenceListenState,
} from '../session/conferenceListen';
import {
  DEFAULT_OPERATOR_AUDIO,
  feedDuckingFactor,
  shouldDuckFeeds,
  type OperatorAudioSettings,
} from '../session/operatorAudio';
import {
  applyConsumerBudget,
  MAX_RESUMED_CONSUMERS,
  producerTargetKey,
  shouldReplaceRemoteConsumer,
  type ConsumerPriorityContext,
} from './consumerBudget';
import { STANDARD_OPUS, talkGumConstraints, type OpusProfile } from './opus';
import { summarizeNetworkReports, type MediaNetworkStats } from './networkStats';

type RemoteConsumer = {
  producer: ActiveProducer;
  consumer: Consumer;
  stream: MediaStream;
  resumed: boolean;
};

export class MediaEngine {
  private device: Device | null = null;
  private sendTransport: Transport | null = null;
  private recvTransport: Transport | null = null;
  private localStream: MediaStream | null = null;
  private talkProducer: Producer | null = null;
  private warmTalkPromise: Promise<void> | null = null;
  private mediaGeneration = 0;
  private talkGeneration = 0;
  private remotes = new Map<string, RemoteConsumer>();
  private iceOverride: IceServer[] = [];
  private audioPreferences: Record<string, TargetAudioPreference> = {};
  private stoppedFeedKeys = new Set<string>();
  private conferenceListen: ConferenceListenState = EMPTY_CONFERENCE_LISTEN;
  private operatorAudio: OperatorAudioSettings = DEFAULT_OPERATOR_AUDIO;
  private talkOpus: OpusProfile = STANDARD_OPUS;
  private talking = false;
  private incomingAddressed = false;
  overBudget = false;
  lastMediaEvent = '';
  onConnectionChange: (() => void) | null = null;
  private sendConnectionState = IDLE_MEDIA_CONNECTION.send;
  private recvConnectionState = IDLE_MEDIA_CONNECTION.receive;
  private sendIceGatheringState = IDLE_MEDIA_CONNECTION.sendIce;
  private recvIceGatheringState = IDLE_MEDIA_CONNECTION.receiveIce;
  private iceError: string | null = null;
  private work: Promise<void> = Promise.resolve();

  private feedVideos: FeedVideoReceiver;
  private videoProducers: ActiveProducer[] = [];
  private visibleVideoKeys: string[] = [];
  onVideoChange: (() => void) | null = null;

  constructor(private readonly signaling: SignalingClient) {
    this.feedVideos = new FeedVideoReceiver(signaling);
    this.feedVideos.onChange = () => this.onVideoChange?.();
  }

  get feedVideoSnapshot() { return this.feedVideos.snapshot; }

  setFeedVideoTargets(keys: string[]): void {
    this.visibleVideoKeys = keys;
    this.syncFeedVideos();
  }

  private syncFeedVideos(): void {
    this.feedVideos.sync(this.videoProducers,
      this.visibleVideoKeys.filter(key => !this.stoppedFeedKeys.has(key)),
      this.recvTransport, this.device?.rtpCapabilities);
  }

  async networkStats(): Promise<MediaNetworkStats> {
    const generation = this.mediaGeneration;
    const transports = [this.sendTransport, this.recvTransport].filter((transport): transport is Transport => Boolean(transport && !transport.closed));
    const reports = await Promise.allSettled(transports.map(transport => transport.getStats()));
    if (generation !== this.mediaGeneration) return { roundTripMs: null, packetLossPercent: null };
    return summarizeNetworkReports(reports.flatMap(report => report.status === 'fulfilled' ? [report.value] : []));
  }

  setIceOverride(servers: IceServer[]): void {
    this.iceOverride = servers;
  }

  /** Must be set before warmTalkProducer creates the talk producer. */
  setTalkOpusProfile(profile: OpusProfile): void {
    this.talkOpus = profile;
  }

  async start(): Promise<void> {
    await this.stop();

    const rtpCapabilities = await this.signaling.getRouterRtpCapabilities();
    const device = new Device();
    await device.load({ routerRtpCapabilities: rtpCapabilities as never });
    this.device = device;

    const sendOptions = await this.signaling.createSendTransport();
    const recvOptions = await this.signaling.createRecvTransport();

    this.sendTransport = device.createSendTransport({
      id: sendOptions.id,
      iceParameters: sendOptions.iceParameters as never,
      iceCandidates: sendOptions.iceCandidates as never,
      dtlsParameters: sendOptions.dtlsParameters as never,
      iceServers: [...sendOptions.iceServers, ...this.iceOverride],
      iceTransportPolicy: sendOptions.iceTransportPolicy,
    });
    this.recvTransport = device.createRecvTransport({
      id: recvOptions.id,
      iceParameters: recvOptions.iceParameters as never,
      iceCandidates: recvOptions.iceCandidates as never,
      dtlsParameters: recvOptions.dtlsParameters as never,
      iceServers: [...recvOptions.iceServers, ...this.iceOverride],
      iceTransportPolicy: recvOptions.iceTransportPolicy,
    });

    this.sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.signaling.connectSendTransport(dtlsParameters).then(() => callback()).catch(errback);
    });
    this.recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.signaling.connectRecvTransport(dtlsParameters).then(() => callback()).catch(errback);
    });
    this.sendTransport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
      this.signaling
        .produce(kind, rtpParameters, appData)
        .then((id) => callback({ id }))
        .catch(errback);
    });
    this.bindTransportStatus(this.sendTransport, 'send');
    this.bindTransportStatus(this.recvTransport, 'receive');
  }

  async warmTalkProducer(): Promise<void> {
    if (this.warmTalkPromise) return this.warmTalkPromise;
    if (this.talkProducer && !this.talkProducer.closed) return;
    const pending = this.createWarmTalkProducer();
    this.warmTalkPromise = pending;
    try { await pending; }
    finally { if (this.warmTalkPromise === pending) this.warmTalkPromise = null; }
  }

  private async createWarmTalkProducer(): Promise<void> {
    const transport = this.sendTransport;
    if (!transport) throw new Error('Send transport is not ready.');
    const generation = this.mediaGeneration;
    const stream = await mediaDevices.getUserMedia(talkGumConstraints(this.operatorAudio) as never) as MediaStream;
    try {
      if (generation !== this.mediaGeneration || transport !== this.sendTransport) throw new Error('Media session changed.');
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('Microphone did not return an audio track.');
      const producer = await transport.produce({ track: track as never, ...this.talkOpus, appData: { type: 'talk' } });
      if (generation !== this.mediaGeneration || transport !== this.sendTransport) {
        producer.close();
        throw new Error('Media session changed.');
      }
      this.localStream = stream;
      this.talkProducer = producer;
      producer.pause();
      await this.signaling.pauseProducer(producer.id);
    } catch (error) {
      if (this.localStream !== stream) stream.getTracks().forEach(track => track.stop());
      throw error;
    }
  }

  async startTalking(targets: TalkTarget[], lockActive = false,
    currentState?: () => { targets: TalkTarget[]; lockActive: boolean }): Promise<void> {
    const generation = this.talkGeneration;
    await this.warmTalkProducer();
    if (generation !== this.talkGeneration) return;
    if (currentState) ({ targets, lockActive } = currentState());
    if (!targets.length) return;
    const producer = this.talkProducer;
    if (!producer || producer.closed) throw new Error('Talk producer is not ready.');
    const alreadyLive = !producer.paused;
    if (!alreadyLive) {
      this.signaling.emitTalkTargetsUpdated('talk-targets-starting', targets);
      producer.resume();
      await this.signaling.resumeProducer(producer.id);
      if (generation !== this.talkGeneration || producer !== this.talkProducer || producer.paused) return;
      if (currentState) ({ targets, lockActive } = currentState());
      if (!targets.length) return;
      this.signaling.emitTalkTargetsUpdated('talk-targets-started', targets);
    } else {
      this.signaling.emitTalkTargetsUpdated('talk-targets-updated', targets);
    }
    this.signaling.emitPttState({ talking: true, lockActive, target: targets[0] ?? null, targets,
      reason: alreadyLive ? 'talk-targets-updated' : 'talk-started' });
  }

  async applyTalkOpusProfile(profile: OpusProfile,
    currentState: () => { targets: TalkTarget[]; lockActive: boolean }): Promise<void> {
    if (JSON.stringify(profile) === JSON.stringify(this.talkOpus)) return;
    const generation = this.mediaGeneration;
    await this.warmTalkPromise;
    if (generation !== this.mediaGeneration) throw new Error('Media session changed.');
    this.talkOpus = profile;
    const producer = this.talkProducer;
    if (!producer || producer.closed || !this.sendTransport) return;
    this.talkGeneration++;
    producer.pause();
    producer.close();
    this.talkProducer = null;
    this.localStream?.getTracks().forEach(track => track.stop());
    this.localStream = null;
    await this.signaling.closeProducer(producer.id);
    if (generation !== this.mediaGeneration) throw new Error('Media session changed.');
    await this.warmTalkProducer();
    const state = currentState();
    if (state.targets.length) await this.startTalking(state.targets, state.lockActive, currentState);
  }

  syncTalkTargets(targets: TalkTarget[], lockActive: boolean): void {
    this.signaling.emitTalkTargetsUpdated('talk-targets-updated', targets);
    this.signaling.emitPttState({
      talking: targets.length > 0,
      lockActive,
      target: targets[0] ?? null,
      targets,
      reason: 'talk-targets-updated',
    });
  }

  async stopTalking(): Promise<void> {
    this.talkGeneration++;
    const producer = this.talkProducer;
    this.signaling.emitTalkTargetsUpdated('talk-targets-cleared', []);
    if (producer && !producer.closed) {
      producer.pause();
      try {
        await this.signaling.pauseProducer(producer.id);
      } catch {
        // Socket may already be gone.
      }
    }
    this.signaling.emitPttState({
      talking: false,
      lockActive: false,
      target: null,
      targets: [],
      reason: 'talk-stopped',
    });
  }

  async consumeProducer(producer: ActiveProducer, ctx: ConsumerPriorityContext = {}): Promise<void> {
    if (isFeedVideoProducer(producer)) {
      this.videoProducers = [...this.videoProducers.filter(item => item.producerId !== producer.producerId), producer];
      this.syncFeedVideos();
      return;
    }
    await this.serialize(() => this.consumeProducerLocked(producer, ctx));
  }

  async dropProducer(producerId: string): Promise<void> {
    this.videoProducers = this.videoProducers.filter(item => item.producerId !== producerId);
    this.syncFeedVideos();
    await this.serialize(() => this.dropProducerLocked(producerId));
  }

  async dropConsumer(consumerId: string): Promise<void> {
    this.feedVideos.dropConsumer(consumerId);
    await this.serialize(() => this.dropConsumerLocked(consumerId));
  }

  async syncProducers(producers: ActiveProducer[], ctx: ConsumerPriorityContext = {}): Promise<void> {
    this.videoProducers = producers.filter(isFeedVideoProducer);
    this.syncFeedVideos();
    producers = producers.filter(item => !isFeedVideoProducer(item));
    await this.serialize(async () => {
      const wanted = new Set(producers.map((item) => item.producerId));
      for (const producerId of [...this.remotes.keys()]) {
        if (!wanted.has(producerId)) {
          await this.dropProducerLocked(producerId);
        }
      }
      for (const producer of producers) {
        await this.consumeProducerLocked(producer, ctx);
      }
      await this.applyBudget(ctx);
    });
  }

  get activeRemoteCount(): number {
    return [...this.remotes.values()].filter((item) => item.resumed).length;
  }

  get speakingTargetKeys(): string[] {
    const keys = new Set<string>();
    for (const remote of this.remotes.values()) {
      if (remote.resumed) {
        keys.add(producerTargetKey(remote.producer));
      }
    }
    return [...keys];
  }

  mediaDebugLine(): string {
    const routes = [...this.remotes.values()]
      .map((item) => `${producerTargetKey(item.producer)}${item.resumed ? '' : ' (paused)'}`)
      .join(', ');
    const tracked = this.remotes.size;
    const resumed = this.activeRemoteCount;
    const last = this.lastMediaEvent ? ` Last: ${this.lastMediaEvent}` : '';
    return `${resumed} live / ${tracked} tracked${routes ? ` — ${routes}` : ''}.${last}`;
  }

  connectionSnapshot(): MediaConnectionSnapshot {
    return {
      send: this.sendConnectionState,
      receive: this.recvConnectionState,
      sendIce: this.sendIceGatheringState,
      receiveIce: this.recvIceGatheringState,
      iceError: this.iceError,
      mediaReady: Boolean(this.device && this.sendTransport && this.recvTransport),
    };
  }

  setAudioPreferences(preferences: Record<string, TargetAudioPreference>): void {
    this.audioPreferences = preferences;
    this.applyAllTrackGain();
  }

  setConferenceListen(state: ConferenceListenState): void {
    this.conferenceListen = state;
    this.applyAllTrackGain();
  }

  setOperatorAudio(settings: OperatorAudioSettings): void {
    this.operatorAudio = settings;
    this.applyAllTrackGain();
  }

  setDuckingActive(input: { talking: boolean; incomingAddressed: boolean }): void {
    this.talking = input.talking;
    this.incomingAddressed = input.incomingAddressed;
    this.applyAllTrackGain();
  }

  async applyCaptureSettings(settings: OperatorAudioSettings): Promise<void> {
    this.operatorAudio = settings;
    const producer = this.talkProducer;
    if (!this.sendTransport || !producer || producer.closed) return;
    const generation = this.mediaGeneration;
    const stream = await mediaDevices.getUserMedia(talkGumConstraints(settings) as never) as MediaStream;
    try {
      if (generation !== this.mediaGeneration || producer !== this.talkProducer || producer.closed) throw new Error('Media session changed.');
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('Microphone did not return an audio track.');
      await producer.replaceTrack({ track: track as never });
      if (generation !== this.mediaGeneration || producer !== this.talkProducer || producer.closed) throw new Error('Media session changed.');
      this.localStream?.getTracks().forEach(item => item.stop());
      this.localStream = stream;
    } catch (error) {
      stream.getTracks().forEach(item => item.stop());
      throw error;
    }
  }

  captureDebug(): {
    label: string;
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
    autoGainControl?: boolean;
  } {
    const track = this.localStream?.getAudioTracks()[0] as
      | { label?: string; getSettings?: () => Record<string, unknown> }
      | undefined;
    const settings = track?.getSettings?.() ?? {};
    return {
      label: typeof track?.label === 'string' && track.label ? track.label : 'Microphone',
      echoCancellation:
        typeof settings.echoCancellation === 'boolean' ? settings.echoCancellation : undefined,
      noiseSuppression:
        typeof settings.noiseSuppression === 'boolean' ? settings.noiseSuppression : undefined,
      autoGainControl:
        typeof settings.autoGainControl === 'boolean' ? settings.autoGainControl : undefined,
    };
  }

  async setStoppedFeedKeys(keys: string[], ctx: ConsumerPriorityContext = {}): Promise<void> {
    this.stoppedFeedKeys = new Set(keys);
    this.syncFeedVideos();
    await this.serialize(async () => {
      await this.applyBudget(ctx);
    });
  }

  async stop(): Promise<void> {
    this.mediaGeneration++;
    this.videoProducers = [];
    this.feedVideos.stop();
    this.talkGeneration++;
    await this.serialize(async () => {
      for (const producerId of [...this.remotes.keys()]) {
        await this.dropProducerLocked(producerId);
      }
    });
    if (this.talkProducer) {
      try {
        this.talkProducer.close();
      } catch {
        // ignore
      }
      this.talkProducer = null;
    }
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    try {
      this.sendTransport?.close();
    } catch {
      // ignore
    }
    try {
      this.recvTransport?.close();
    } catch {
      // ignore
    }
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    this.overBudget = false;
    this.lastMediaEvent = '';
    this.resetConnectionState();
  }

  private bindTransportStatus(transport: Transport, direction: 'send' | 'receive'): void {
    const apply = (connected = false) => {
      if (direction === 'send' && transport !== this.sendTransport) {
        return;
      }
      if (direction === 'receive' && transport !== this.recvTransport) {
        return;
      }
      if (connected) {
        this.iceError = null;
      }
      if (direction === 'send') {
        this.sendConnectionState = transport.connectionState || 'new';
        this.sendIceGatheringState = transport.iceGatheringState || 'new';
      } else {
        this.recvConnectionState = transport.connectionState || 'new';
        this.recvIceGatheringState = transport.iceGatheringState || 'new';
      }
      this.onConnectionChange?.();
    };
    apply();
    transport.on('connectionstatechange', (state) => {
      apply(state === 'connected');
    });
    transport.on('icegatheringstatechange', () => {
      apply();
    });
    transport.on('icecandidateerror', (event) => {
      if (direction === 'send' && transport !== this.sendTransport) {
        return;
      }
      if (direction === 'receive' && transport !== this.recvTransport) {
        return;
      }
      this.iceError = describeIceCandidateError(event);
      this.onConnectionChange?.();
    });
  }

  private resetConnectionState(): void {
    this.sendConnectionState = IDLE_MEDIA_CONNECTION.send;
    this.recvConnectionState = IDLE_MEDIA_CONNECTION.receive;
    this.sendIceGatheringState = IDLE_MEDIA_CONNECTION.sendIce;
    this.recvIceGatheringState = IDLE_MEDIA_CONNECTION.receiveIce;
    this.iceError = null;
  }

  private applyAllTrackGain(): void {
    for (const remote of this.remotes.values()) {
      this.applyTrackGain(remote.producer);
    }
  }

  private applyTrackGain(producer: ActiveProducer): void {
    const remote = this.remotes.get(producer.producerId);
    const track = remote?.stream.getAudioTracks()[0] as { _setVolume?: (volume: number) => void } | undefined;
    const preference = normalizeAudioPreference(this.audioPreferences[producerTargetKey(producer)]);
    const memberGain =
      producer.route.kind === 'conference'
        ? conferenceMemberGain(this.conferenceListen, producer.route.id, producer.speakerUserId)
        : 1;
    track?._setVolume?.(playbackGain(preference) * memberGain * this.feedDuckingGain(producer));
  }

  private feedDuckingGain(producer: ActiveProducer): number {
    if (producer.route.kind !== 'feed') {
      return 1;
    }
    if (
      !shouldDuckFeeds({
        dimSelf: this.operatorAudio.feedDimSelf,
        dimIncoming: this.operatorAudio.feedDimIncoming,
        talking: this.talking,
        incomingAddressed: this.incomingAddressed,
      })
    ) {
      return 1;
    }
    return feedDuckingFactor(this.operatorAudio.feedDimDb);
  }

  private serialize(work: () => Promise<void>): Promise<void> {
    const run = this.work.then(work, work);
    this.work = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async consumeProducerLocked(
    producer: ActiveProducer,
    ctx: ConsumerPriorityContext,
  ): Promise<void> {
    if (!this.device || !this.recvTransport) {
      throw new Error('Receive transport is not ready.');
    }
    if (producer.peerId === this.signaling.socketId) {
      return;
    }

    const existing = this.remotes.get(producer.producerId);
    if (existing) {
      if (
        !shouldReplaceRemoteConsumer(
          { producer: existing.producer, closed: existing.consumer.closed },
          producer,
        )
      ) {
        existing.producer = producer;
        return;
      }
      this.lastMediaEvent = `replace ${producerTargetKey(existing.producer)} → ${producerTargetKey(producer)}`;
      await this.dropProducerLocked(producer.producerId);
    }

    try {
      const params = await this.signaling.consume(producer.producerId, this.device.rtpCapabilities);
      const consumer = await this.recvTransport.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind as 'audio' | 'video',
        rtpParameters: params.rtpParameters as never,
      });

      const stream = new MediaStream();
      stream.addTrack(consumer.track as never);
      this.remotes.set(producer.producerId, { producer, consumer, stream, resumed: false });
      this.lastMediaEvent = `consume ${producerTargetKey(producer)} ${consumer.id.slice(0, 8)}`;
      this.applyTrackGain(producer);
      await this.applyBudget(ctx);
    } catch (error) {
      this.lastMediaEvent = `consume failed ${producerTargetKey(producer)}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      throw error;
    }
  }

  private async dropProducerLocked(producerId: string): Promise<void> {
    const remote = this.remotes.get(producerId);
    if (!remote) {
      return;
    }
    this.remotes.delete(producerId);
    try {
      remote.consumer.close();
    } catch {
      // already closed
    }
    try {
      await this.signaling.closeConsumer(remote.consumer.id);
    } catch {
      // socket may already have closed it
    }
  }

  private async dropConsumerLocked(consumerId: string): Promise<void> {
    for (const [producerId, remote] of this.remotes) {
      if (remote.consumer.id === consumerId) {
        this.lastMediaEvent = `server closed ${producerTargetKey(remote.producer)}`;
        this.remotes.delete(producerId);
        try {
          remote.consumer.close();
        } catch {
          // already closed
        }
        return;
      }
    }
  }

  private async applyBudget(ctx: ConsumerPriorityContext): Promise<void> {
    const decision = applyConsumerBudget(
      [...this.remotes.values()].map((item) => item.producer),
      ctx,
      MAX_RESUMED_CONSUMERS,
    );
    this.overBudget = decision.overBudget;

    const resumeIds = new Set(
      decision.resume
        .filter((item) => !this.stoppedFeedKeys.has(producerTargetKey(item)))
        .map((item) => item.producerId),
    );
    for (const [producerId, remote] of this.remotes) {
      if (resumeIds.has(producerId)) {
        if (!remote.resumed) {
          remote.consumer.resume();
          await this.signaling.resumeConsumer(remote.consumer.id);
          remote.resumed = true;
        }
      } else if (remote.resumed) {
        remote.consumer.pause();
        remote.resumed = false;
      }
    }
  }
}
