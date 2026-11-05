// Derived from talktome-apple SocketIOSignalingClient @ 004d6e76 by Daniel Jocher.
// Uses socket.io-client. RN WebSocket extraHeaders are unreliable, so the handshake
// starts on HTTP polling (browser parity) with an explicit Cookie header.

import { io, type Socket } from 'socket.io-client';
import type { PanelAudioSettings, PanelAudioState, PanelClientReport, PanelCommandResult } from '../protocol/remotePanel';

import { cookieHeader, type CookieMap } from '../auth/cookieJar';
import { parseIncomingTalkState } from '../protocol/incomingTalk';
import { SocketEvent } from '../protocol/events';
import { parseActiveProducer, parseActiveProducers } from '../protocol/producers';
import { parseProductionId, parseProductions, type Production } from '../protocol/productions';
import { parseCameraTally, type CameraTallyState } from '../protocol/tally';
import type { NativeClientVersion } from '../protocol/clientVersion';
import { normalizeTalkTargets } from '../protocol/talkTargets';
import type {
  ActiveProducer,
  IncomingTalkState,
  IceServer,
  IceTransportPolicy,
  OperatorIdentity,
  PeerSession,
  RegisterUserConflict,
  RegisterUserResponse,
  SessionKickInfo,
  SignalingTalkTarget,
  TalkTarget,
  WebRTCTransportOptions,
} from '../protocol/types';

export type SignalingHandlers = {
  onApiTalkCommand?: (command: unknown) => Promise<PanelCommandResult>;
  onApiTargetAudioCommand?: (command: unknown) => Promise<PanelCommandResult>;
  onPanelCommand?: (command: unknown) => Promise<PanelCommandResult>;
  onTargetEditPermissions?: (permissions: { allowTargetRearrange: boolean; allowTargetAddRemove: boolean }) => void;
  onPanelStateRequest?: () => void;
  onUserAudioSettingsUpdated?: (settings: unknown) => void;
  onStateChange?: (state: SignalingConnectionState) => void;
  onReconnect?: (socketId?: string) => void;
  onUserList?: (peers: PeerSession[]) => void;
  onSessionKicked?: (info: SessionKickInfo) => void;
  onTargetsUpdated?: () => void;
  onConferenceMembersUpdated?: (conferenceId?: number | null) => void;
  onIncomingTalkState?: (state: IncomingTalkState) => void;
  onForceStopTransmission?: () => void;
  onProducerStarted?: (producer: ActiveProducer) => void;
  onProducerClosed?: (producer: ActiveProducer) => void;
  onConsumerClosed?: (consumerId: string) => void;
  onCameraTally?: (tally: CameraTallyState) => void;
  onActiveProductionReset?: (productionId: number | null) => void;
  onAvailableProductionsUpdated?: (productions: Production[]) => void;
};

export type SignalingConnectionState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'connected'; socketId?: string }
  | { status: 'failed'; message: string };

const ACK_TIMEOUT_MS = 8000;
/** TalkToMe 1.5.0+ `set-active-production`. Short so unknown servers fail fast. */
export const SET_ACTIVE_PRODUCTION_ACK_MS = 2500;

export class SignalingConnectCancelledError extends Error {
  constructor() {
    super('The Socket.IO connection attempt was cancelled.');
    this.name = 'SignalingConnectCancelledError';
  }
}

export function cookieExtraHeaders(cookies: CookieMap): Record<string, string> {
  const cookie = cookieHeader(cookies);
  return cookie ? { Cookie: cookie } : {};
}

export function signalingSocketOptions(cookies: CookieMap) {
  const extraHeaders = cookieExtraHeaders(cookies);
  return {
    path: '/socket.io/',
    // Polling-only: RN WebSocket extraHeaders are unreliable, and SameSite=Lax
    // cookies are not auto-attached from a native app. Cookie goes on HTTP polling.
    transports: ['polling'] as ['polling'],
    upgrade: false,
    withCredentials: false,
    autoConnect: false,
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    extraHeaders,
    transportOptions: {
      polling: { extraHeaders },
    },
    auth: undefined as undefined,
  };
}

export function registerUserPayload(
  identity: OperatorIdentity,
  force = false,
  productionId?: number | null,
  platform?: string,
  version?: NativeClientVersion,
) {
  return {
    id: String(identity.kind === 'guest' ? (identity.guestId ?? identity.id) : identity.id),
    name: identity.name,
    kind: identity.kind,
    guestProfileUserId: identity.guestProfileUserId ?? null,
    productionId: productionId ?? null,
    force,
    clientType: platform === 'ios' ? 'ios-app' : platform === 'android' ? 'android-app' : null,
    ...(version ?? {}),
  };
}

export class SignalingClient {
  private socket: Socket | null = null;
  private hasEverConnected = false;
  private awaitingInitialConnect = false;
  private cancelConnect: (() => void) | null = null;
  handlers: SignalingHandlers = {};

  reportDeviceStatus(status: unknown): void {
    // Native sessions use HTTP polling. Volatile back-to-back emits drop the
    // second report while the first POST is in flight. Queue both only while
    // connected; the guard still prevents collecting reports during outages.
    if (this.socket?.connected) this.socket.emit('client-device-status', status);
  }

  reportMediaNetworkStats(stats: unknown): void {
    if (this.socket?.connected) this.socket.emit('media-network-stats', stats);
  }

  constructor(
    private readonly baseUrl: string,
    private readonly getCookies: () => CookieMap,
    private readonly platform: string,
    private readonly version: NativeClientVersion = { clientVersion: null, clientBuild: null },
  ) {}

  get socketId(): string | undefined {
    return this.socket?.id;
  }

  get connected(): boolean {
    return this.socket?.connected === true;
  }

  /** TalkToMe 1.5.6. Volatile so an outage cannot queue a reply that clears the warning. */
  emitConnectionHealth(timeoutMs: number, onReply: (error: unknown, reply: unknown) => void): void {
    const socket = this.socket;
    if (!socket) {
      onReply(new Error('disconnected'), null);
      return;
    }
    socket.volatile.timeout(timeoutMs).emit('connection-health', (error: unknown, reply: unknown) => {
      onReply(error, reply);
    });
  }

  async connect(): Promise<string> {
    this.disconnect();
    this.awaitingInitialConnect = true;
    this.handlers.onStateChange?.({ status: 'connecting' });

    const socket = io(this.baseUrl, signalingSocketOptions(this.getCookies()));
    this.socket = socket;
    this.bindPersistentHandlers(socket);

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        fail('timeout', new Error('The Socket.IO connection timed out.'));
      }, 10_000);

      const onConnect = () => {
        if (settled || this.socket !== socket) return;
        settled = true;
        cleanup();
        this.awaitingInitialConnect = false;
        this.hasEverConnected = true;
        this.handlers.onStateChange?.({ status: 'connected', socketId: socket.id });
        resolve(socket.id ?? '');
      };

      const onError = (error: Error) => {
        fail(error.message, new Error(`Socket.IO connection failed: ${error.message}`));
      };

      const fail = (message: string, error: Error) => {
        if (settled || this.socket !== socket) return;
        settled = true;
        cleanup();
        this.awaitingInitialConnect = false;
        // A rejected initial attempt must not keep reconnecting in the background.
        this.closeSocket();
        this.handlers.onStateChange?.({ status: 'failed', message });
        reject(error);
      };

      const cancel = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new SignalingConnectCancelledError());
      };

      const cleanup = () => {
        clearTimeout(timeout);
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
        if (this.cancelConnect === cancel) this.cancelConnect = null;
      };

      this.cancelConnect = cancel;
      socket.on('connect', onConnect);
      socket.on('connect_error', onError);
      socket.connect();
    });
  }

  disconnect(): void {
    this.cancelConnect?.();
    this.closeSocket();
    this.awaitingInitialConnect = false;
    this.hasEverConnected = false;
    this.handlers.onStateChange?.({ status: 'disconnected' });
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.removeAllListeners();
    socket?.disconnect();
  }

  async register(
    identity: OperatorIdentity,
    force = false,
    productionId?: number | null,
  ): Promise<RegisterUserResponse> {
    return this.emitAck<RegisterUserResponse>(
      SocketEvent.registerUser,
      { ...registerUserPayload(identity, force, productionId, this.platform, this.version), feedVideo: true },
    );
  }

  async setActiveProduction(productionId: number | null): Promise<number | null> {
    const payload = await this.emitAck<{ ok?: boolean; productionId?: unknown; error?: string }>(
      SocketEvent.setActiveProduction,
      { productionId },
      SET_ACTIVE_PRODUCTION_ACK_MS,
    );
    if (payload && payload.ok === false) {
      throw new Error(payload.error || 'Unable to change production');
    }
    const next = payload?.productionId;
    if (typeof next === 'number' && Number.isFinite(next)) {
      return next;
    }
    if (typeof next === 'string' && next.trim() !== '') {
      const parsed = Number(next);
      return Number.isFinite(parsed) ? parsed : productionId;
    }
    return productionId;
  }

  async requestActiveProducers(): Promise<ActiveProducer[]> {
    const payload = await this.emitAck<unknown>(SocketEvent.requestActiveProducers);
    return parseActiveProducers(payload);
  }

  async getRouterRtpCapabilities(): Promise<unknown> {
    return this.emitAck(SocketEvent.getRouterRtpCapabilities);
  }

  async createSendTransport(): Promise<WebRTCTransportOptions> {
    return parseTransportOptions(await this.emitAck<Record<string, unknown>>(SocketEvent.createSendTransport, null));
  }

  async createRecvTransport(): Promise<WebRTCTransportOptions> {
    return parseTransportOptions(await this.emitAck<Record<string, unknown>>(SocketEvent.createRecvTransport, null));
  }

  async connectSendTransport(dtlsParameters: unknown): Promise<void> {
    await this.emitAck(SocketEvent.connectSendTransport, { dtlsParameters });
  }

  async connectRecvTransport(dtlsParameters: unknown): Promise<void> {
    await this.emitAck(SocketEvent.connectRecvTransport, { dtlsParameters });
  }

  async produce(kind: string, rtpParameters: unknown, appData: unknown): Promise<string> {
    const response = await this.emitAck<{ id?: string; error?: string }>(SocketEvent.produce, {
      kind,
      rtpParameters,
      appData,
    });
    if (!response?.id) {
      throw new Error(response?.error || 'produce failed');
    }
    return response.id;
  }

  async pauseProducer(producerId: string): Promise<void> {
    await this.emitAck(SocketEvent.pauseProducer, { producerId });
  }

  async resumeProducer(producerId: string): Promise<void> {
    await this.emitAck(SocketEvent.resumeProducer, { producerId });
  }

  async closeProducer(producerId: string): Promise<void> {
    await this.emitAck(SocketEvent.producerClose, { producerId });
  }

  async consume(producerId: string, rtpCapabilities: unknown): Promise<{
    id: string;
    producerId: string;
    kind: string;
    rtpParameters: unknown;
  }> {
    const response = await this.emitAck<{
      id?: string;
      producerId?: string;
      kind?: string;
      rtpParameters?: unknown;
      error?: string;
    }>(SocketEvent.consume, { producerId, rtpCapabilities });
    if (!response?.id || !response.producerId || !response.kind || !response.rtpParameters) {
      throw new Error(response?.error || 'consume failed');
    }
    return {
      id: response.id,
      producerId: response.producerId,
      kind: response.kind,
      rtpParameters: response.rtpParameters,
    };
  }

  async resumeConsumer(consumerId: string): Promise<void> {
    await this.emitAck(SocketEvent.resumeConsumer, { consumerId });
  }

  async closeConsumer(consumerId: string): Promise<void> {
    await this.emitAck(SocketEvent.closeConsumer, { consumerId });
  }

  emitTalkTargetsUpdated(reason: string, targets: TalkTarget[]): void {
    const normalized = normalizeTalkTargets(targets);
    this.socket?.emit(SocketEvent.talkTargetsUpdated, { reason, targets: normalized });
  }

  emitPttState(input: {
    talking: boolean;
    lockActive: boolean;
    target: TalkTarget | null;
    targets: TalkTarget[];
    reason?: string;
  }): void {
    const targets = normalizeTalkTargets(input.targets);
    const target: SignalingTalkTarget | undefined = input.target
      ? normalizeTalkTargets([input.target])[0]
      : targets[0];
    this.socket?.emit(SocketEvent.pttState, {
      talking: input.talking,
      lockActive: input.lockActive,
      target: target ?? null,
      targets,
      reason: input.reason,
    });
  }

  emitPanelReport(report: PanelClientReport): void {
    if (this.socket?.connected) this.socket.volatile.emit(SocketEvent.panelClientState, report);
  }

  emitTargetAudioSnapshot(states: PanelAudioState[], revision: number): void {
    if (this.socket?.connected) this.socket.volatile.emit(SocketEvent.targetAudioStateSnapshot, {
      states, revision, reason: 'mobile-panel-state',
    });
  }

  saveUserAudioSettings(settings: PanelAudioSettings, revision: number): Promise<{ ok?: boolean }> {
    return this.emitAck(SocketEvent.userAudioSettingsUpdate, { settings, revision });
  }

  async logout(): Promise<void> {
    try {
      await this.emitAck(SocketEvent.userLogout);
    } catch {
      // Server may already have dropped the socket.
    }
  }

  private bindPersistentHandlers(socket: Socket): void {
    const bindApiCommand = (event: string, handler: 'onApiTalkCommand' | 'onApiTargetAudioCommand') => socket.on(event, async (value: unknown = {}) => {
      const command = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      let result: PanelCommandResult;
      try {
        result = this.handlers[handler]
          ? await this.handlers[handler]!(command)
          : { ok: false, error: 'Mobile session is not ready.' };
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      if (this.socket === socket && socket.connected) socket.emit(`${event}-result`, {
        commandId: command.commandId ?? null,
        action: command.action, targetType: command.targetType, targetId: command.targetId,
        ok: result.ok, reason: result.ok ? null : result.error,
      });
    });
    bindApiCommand('api-talk-command', 'onApiTalkCommand');
    bindApiCommand('api-target-audio-command', 'onApiTargetAudioCommand');
    socket.on('target-rearrange-permission-updated', ({ allowed, allowTargetAddRemove } = {}) => {
      this.handlers.onTargetEditPermissions?.({ allowTargetRearrange: allowed === true, allowTargetAddRemove: allowTargetAddRemove === true });
    });
    socket.on('connect', () => {
      if (this.socket !== socket || this.awaitingInitialConnect) return;
      this.handlers.onStateChange?.({ status: 'connected', socketId: socket.id });
      if (this.hasEverConnected) {
        this.handlers.onReconnect?.(socket.id);
      }
    });

    socket.on('disconnect', (reason) => {
      if (this.socket !== socket) return;
      this.handlers.onStateChange?.({ status: 'disconnected' });
      if (reason && reason !== 'io client disconnect') {
        this.handlers.onStateChange?.({ status: 'failed', message: String(reason) });
      }
    });

    socket.on(SocketEvent.panelCommand, (payload: unknown, acknowledge?: (result: PanelCommandResult) => void) => {
      const handler = this.handlers.onPanelCommand;
      const result = handler ? Promise.resolve().then(() => handler(payload))
        : Promise.resolve({ ok: false, error: 'Mobile panel control is not ready.' });
      void result.catch(error => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
        .then(response => { if (typeof acknowledge === 'function') acknowledge(response); });
    });
    socket.on(SocketEvent.panelStateRequest, () => this.handlers.onPanelStateRequest?.());
    socket.on(SocketEvent.userAudioSettingsUpdated, (payload) => {
      const settings = payload && typeof payload === 'object' ? (payload as { settings?: unknown }).settings : undefined;
      this.handlers.onUserAudioSettingsUpdated?.(settings);
    });

    socket.on(SocketEvent.userList, (payload) => {
      this.handlers.onUserList?.(parsePeerSessions(payload));
    });
    socket.on(SocketEvent.userTargetsUpdated, () => {
      this.handlers.onTargetsUpdated?.();
    });
    socket.on(SocketEvent.conferenceMembersUpdated, (payload) => {
      const record = payload && typeof payload === 'object' ? (payload as { conferenceId?: unknown }) : {};
      const conferenceId = Number(record.conferenceId);
      this.handlers.onConferenceMembersUpdated?.(Number.isFinite(conferenceId) ? conferenceId : null);
    });
    socket.on(SocketEvent.incomingTalkState, (payload) => {
      const state = parseIncomingTalkState(payload);
      if (state) {
        this.handlers.onIncomingTalkState?.(state);
      }
    });
    socket.on(SocketEvent.newProducer, (payload) => {
      const producer = parseActiveProducer(payload);
      if (producer) {
        this.handlers.onProducerStarted?.(producer);
      }
    });
    socket.on(SocketEvent.producerClosed, (payload) => {
      const producer = parseActiveProducer(payload);
      if (producer) {
        this.handlers.onProducerClosed?.(producer);
      }
    });
    socket.on(SocketEvent.consumerClosed, (payload) => {
      const record = payload && typeof payload === 'object' ? (payload as { consumerId?: unknown }) : {};
      if (typeof record.consumerId === 'string' && record.consumerId) {
        this.handlers.onConsumerClosed?.(record.consumerId);
      }
    });
    socket.on(SocketEvent.forceStopTransmission, () => {
      this.handlers.onForceStopTransmission?.();
    });
    socket.on(SocketEvent.sessionKicked, (payload) => {
      const record = payload && typeof payload === 'object' ? (payload as SessionKickInfo) : {};
      this.handlers.onSessionKicked?.(record);
    });
    socket.on(SocketEvent.cutCamera, (payload) => {
      this.handlers.onCameraTally?.(parseCameraTally(payload));
    });
    socket.on(SocketEvent.activeProductionReset, (payload) => {
      const record = payload && typeof payload === 'object' ? (payload as { productionId?: unknown }) : {};
      this.handlers.onActiveProductionReset?.(parseProductionId(record.productionId));
    });
    socket.on(SocketEvent.availableProductionsUpdated, (payload) => {
      const record = payload && typeof payload === 'object' ? (payload as { productions?: unknown }) : {};
      this.handlers.onAvailableProductionsUpdated?.(parseProductions(record.productions));
    });
  }

  private emitAck<T>(event: string, payload?: unknown, timeoutMs = ACK_TIMEOUT_MS): Promise<T> {
    const socket = this.socket;
    if (!socket?.connected) {
      return Promise.reject(new Error('Socket.IO is not connected yet.'));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error(`${event} timed out.`));
      }, timeoutMs);

      const ack = (response: T) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (response && typeof response === 'object' && 'error' in response && (response as { error?: string }).error) {
          reject(new Error(String((response as { error?: string }).error)));
          return;
        }
        resolve(response);
      };

      if (payload === undefined) {
        socket.emit(event, ack);
      } else {
        socket.emit(event, payload, ack);
      }
    });
  }
}

export function parseTransportOptions(payload: Record<string, unknown> | null | undefined): WebRTCTransportOptions {
  if (!payload || typeof payload.id !== 'string') {
    throw new Error('Transport response is missing an id.');
  }

  const iceServers = Array.isArray(payload.iceServers) ? (payload.iceServers as IceServer[]) : [];
  const policy = payload.iceTransportPolicy;
  const iceTransportPolicy: IceTransportPolicy | undefined =
    policy === 'relay' || policy === 'all' ? policy : undefined;

  return {
    id: payload.id,
    iceParameters: payload.iceParameters,
    iceCandidates: Array.isArray(payload.iceCandidates) ? payload.iceCandidates : [],
    dtlsParameters: payload.dtlsParameters,
    iceServers,
    iceTransportPolicy,
  };
}

function parsePeerSessions(payload: unknown): PeerSession[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const row = item as Record<string, unknown>;
    if (typeof row.socketId !== 'string') {
      return [];
    }
    const kind = row.kind === 'user' || row.kind === 'feed' || row.kind === 'guest' ? row.kind : 'guest';
    return [
      {
        socketId: row.socketId,
        userId: typeof row.userId === 'number' ? row.userId : undefined,
        feedId: typeof row.feedId === 'number' ? row.feedId : undefined,
        kind,
        name: typeof row.name === 'string' ? row.name : undefined,
      },
    ];
  });
}

export function isRegisterConflict(response: RegisterUserResponse): response is {
  conflict: true;
  existing?: RegisterUserConflict;
} {
  return 'conflict' in response && response.conflict === true;
}

export function isRegisterOk(response: RegisterUserResponse): response is { ok: true } {
  return 'ok' in response && response.ok === true;
}
