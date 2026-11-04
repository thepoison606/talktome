import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { connectionHealth } from '../session/connectionHealth';
import { createConnectionCues } from '../session/connectionCues';
import { SignalingClient, SignalingConnectCancelledError, type SignalingConnectionState } from './client';

const mocks = vi.hoisted(() => ({ io: vi.fn() }));
vi.mock('socket.io-client', () => ({ io: mocks.io }));

class FakeSocket extends EventEmitter {
  connected = false;
  id = 'test-socket';
  connect = vi.fn();
  disconnect = vi.fn(() => { this.connected = false; });

  serverConnect() {
    this.connected = true;
    this.emit('connect');
  }
}

const sockets: FakeSocket[] = [];
const clients: SignalingClient[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  mocks.io.mockImplementation(() => {
    const socket = new FakeSocket();
    socket.id = `socket-${sockets.length + 1}`;
    sockets.push(socket);
    return socket;
  });
});
afterEach(() => {
  clients.splice(0).forEach(client => client.disconnect());
  sockets.length = 0;
  vi.useRealTimers();
  vi.clearAllMocks();
});

function client() {
  const signaling = new SignalingClient('https://example.test', () => ({}), 'ios');
  clients.push(signaling);
  return signaling;
}

describe('signaling connection lifecycle', () => {
  it('cancels a pending attempt immediately and clears its timeout on disconnect', async () => {
    const signaling = client();
    const stateChanged = vi.fn();
    signaling.handlers.onStateChange = stateChanged;
    const pending = signaling.connect().catch(error => error);

    signaling.disconnect();

    expect(await pending).toBeInstanceOf(SignalingConnectCancelledError);
    expect(vi.getTimerCount()).toBe(0);
    expect(sockets[0]!.disconnect).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stateChanged.mock.calls.some(([state]) => state.status === 'failed')).toBe(false);
  });

  it('keeps a replacement session healthy and silent after the old timeout deadline', async () => {
    let status: SignalingConnectionState['status'] = 'disconnected';
    const play = vi.fn();
    const cues = createConnectionCues(play);
    const onStateChange = (state: SignalingConnectionState) => {
      status = state.status;
      if (status === 'failed') cues.noteDisconnected();
    };
    const old = client();
    old.handlers.onStateChange = onStateChange;
    const oldAttempt = old.connect().catch(error => error);
    old.disconnect();

    const current = client();
    current.handlers.onStateChange = onStateChange;
    const currentAttempt = current.connect();
    sockets[1]!.serverConnect();
    await currentAttempt;
    await vi.advanceTimersByTimeAsync(15_000);

    expect(await oldAttempt).toBeInstanceOf(SignalingConnectCancelledError);
    expect(current.connected).toBe(true);
    expect(connectionHealth({ signaling: status, send: 'connected', receive: 'connected' }).shortLabel).toBe('OK');
    expect(play).not.toHaveBeenCalled();
  });

  it('ignores already queued events from a socket replaced on the same client', async () => {
    const signaling = client();
    const firstAttempt = signaling.connect().catch(error => error);
    const oldConnect = sockets[0]!.listeners('connect');
    const oldDisconnect = sockets[0]!.listeners('disconnect');
    const oldError = sockets[0]!.listeners('connect_error');
    const stateChanged = vi.fn();
    const reconnected = vi.fn();
    signaling.handlers = { onStateChange: stateChanged, onReconnect: reconnected };

    const secondAttempt = signaling.connect();
    sockets[1]!.serverConnect();
    await secondAttempt;
    stateChanged.mockClear();
    oldConnect.forEach(listener => listener());
    oldDisconnect.forEach(listener => listener('transport error'));
    oldError.forEach(listener => listener(new Error('old error')));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await firstAttempt).toBeInstanceOf(SignalingConnectCancelledError);
    expect(signaling.connected).toBe(true);
    expect(stateChanged).not.toHaveBeenCalled();
    expect(reconnected).not.toHaveBeenCalled();
  });

  it.each(['timeout', 'connect_error'])('reports a real initial %s and stops its socket', async failure => {
    const signaling = client();
    const stateChanged = vi.fn();
    signaling.handlers.onStateChange = stateChanged;
    const pending = signaling.connect().catch(error => error);
    const socket = sockets[0]!;
    const queuedConnect = socket.listeners('connect');

    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(10_000);
    else socket.emit('connect_error', new Error('network failure'));

    expect((await pending).message).toBe(failure === 'timeout'
      ? 'The Socket.IO connection timed out.' : 'Socket.IO connection failed: network failure');
    expect(stateChanged).toHaveBeenLastCalledWith({ status: 'failed', message: failure === 'timeout' ? 'timeout' : 'network failure' });
    expect(socket.disconnect).toHaveBeenCalledOnce();
    expect(signaling.connected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    stateChanged.mockClear();
    queuedConnect.forEach(listener => listener());
    expect(stateChanged).not.toHaveBeenCalled();
  });

  it('still reconnects automatically after an established connection drops', async () => {
    const signaling = client();
    const stateChanged = vi.fn();
    const reconnected = vi.fn();
    signaling.handlers = { onStateChange: stateChanged, onReconnect: reconnected };
    const pending = signaling.connect();
    sockets[0]!.serverConnect();
    expect(await pending).toBe('socket-1');
    expect(reconnected).not.toHaveBeenCalled();
    expect(stateChanged.mock.calls.filter(([state]) => state.status === 'connected')).toHaveLength(1);

    sockets[0]!.connected = false;
    sockets[0]!.emit('disconnect', 'transport close');
    expect(stateChanged).toHaveBeenLastCalledWith({ status: 'failed', message: 'transport close' });
    sockets[0]!.serverConnect();
    expect(reconnected).toHaveBeenCalledExactlyOnceWith('socket-1');
    expect(signaling.connected).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stateChanged).toHaveBeenLastCalledWith({ status: 'connected', socketId: 'socket-1' });
  });
});


describe('feed video capability', () => {
  it.each(['ios', 'android'])('advertises optional video reception on %s registration', async platform => {
    const signaling = new SignalingClient('https://example.test', () => ({}), platform);
    clients.push(signaling);
    const pending = signaling.connect(); sockets[0]!.serverConnect(); await pending;
    let registration: Record<string, unknown> | undefined;
    sockets[0]!.on('register-user', (payload, callback) => { registration = payload; callback({ ok: true }); });
    await signaling.register({ id: 1, name: 'Viewer', kind: 'user' }, false, 2);
    expect(registration).toMatchObject({ feedVideo: true, productionId: 2, clientType: `${platform}-app` });
  });
});
