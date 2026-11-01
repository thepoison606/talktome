import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import { SignalingClient } from './client';
import { PANEL_AUDIO_DEFAULTS, type PanelClientReport } from '../protocol/remotePanel';

function fixture() {
  const listeners = new Map<string, (...args: any[]) => void>();
  const socket = { connected: true, on: (event: string, listener: (...args: any[]) => void) => listeners.set(event, listener), volatile: { emit: vi.fn() }, emit: vi.fn() };
  const client = new SignalingClient('https://example.test', () => ({}), 'android');
  const internal = client as unknown as { socket: Socket; bindPersistentHandlers(socket: Socket): void };
  internal.socket = socket as unknown as Socket; internal.bindPersistentHandlers(internal.socket);
  return { client, socket, listeners };
}
const report: PanelClientReport = { revision: 1, storage: {}, audioStates: [], runtime: { devices: [], inputDeviceId: '', outputDeviceId: '', outputSupported: false, talking: false, targets: [], lockedTargets: [] } };

describe('mobile panel signaling', () => {
  it('handles Companion API talk events and returns their command result reliably', async () => {
    const f = fixture();
    const command = { commandId: 'companion-1', action: 'press', targetType: 'user', targetId: 9 };
    f.client.handlers.onApiTalkCommand = vi.fn(async () => ({ ok: true }));
    await f.listeners.get('api-talk-command')!(command);
    expect(f.client.handlers.onApiTalkCommand).toHaveBeenCalledWith(command);
    expect(f.socket.emit).toHaveBeenCalledWith('api-talk-command-result', { ...command, ok: true, reason: null });
    f.client.handlers.onApiTalkCommand = async () => { throw new Error('Microphone unavailable'); };
    await f.listeners.get('api-talk-command')!(command);
    expect(f.socket.emit).toHaveBeenLastCalledWith('api-talk-command-result', expect.objectContaining({ commandId: 'companion-1', ok: false, reason: 'Microphone unavailable' }));
  });

  it('queues both diagnostic reports on polling while connected, and skips outages', () => {
    const f = fixture();
    const device = { batteryPercent: 15, charging: true, networkType: 'wifi' };
    const stats = { roundTripMs: 12, packetLossPercent: 0.5 };
    f.client.reportDeviceStatus(device); f.client.reportMediaNetworkStats(stats);
    expect(f.socket.emit).toHaveBeenNthCalledWith(1, 'client-device-status', device);
    expect(f.socket.emit).toHaveBeenNthCalledWith(2, 'media-network-stats', stats);
    expect(f.socket.volatile.emit).not.toHaveBeenCalled();
    f.socket.connected = false; f.socket.emit.mockClear();
    f.client.reportDeviceStatus(device); f.client.reportMediaNetworkStats(stats);
    expect(f.socket.emit).not.toHaveBeenCalled();
  });
  it('acknowledges only after native application completes, including its state report', async () => {
    const f = fixture(); let finish!: () => void;
    f.client.handlers.onPanelCommand = () => new Promise(resolve => { finish = () => resolve({ ok: true, report }); });
    const ack = vi.fn(); f.listeners.get('panel-command')!({ kind: 'order' }, ack);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function')); expect(ack).not.toHaveBeenCalled(); finish();
    await vi.waitFor(() => expect(ack).toHaveBeenCalledWith({ ok: true, report }));
  });

  it('acknowledges handler failures and an unavailable native session', async () => {
    const f = fixture(); const ack = vi.fn(); f.client.handlers.onPanelCommand = async () => { throw new Error('microphone denied'); };
    f.listeners.get('panel-command')!({}, ack); await vi.waitFor(() => expect(ack).toHaveBeenCalledWith({ ok: false, error: 'microphone denied' }));
    f.client.handlers.onPanelCommand = undefined; f.listeners.get('panel-command')!({}, ack);
    await vi.waitFor(() => expect(ack).toHaveBeenLastCalledWith({ ok: false, error: 'Mobile panel control is not ready.' }));
  });

  it('emits volatile revisioned state while connected and does not queue it during outages', async () => {
    const f = fixture(); f.client.emitPanelReport(report); f.client.emitTargetAudioSnapshot([], 1);
    expect(f.socket.volatile.emit).toHaveBeenCalledWith('panel-client-state', report);
    expect(f.socket.volatile.emit).toHaveBeenCalledWith('target-audio-state-snapshot', { states: [], revision: 1, reason: 'mobile-panel-state' });
    f.socket.connected = false; f.socket.volatile.emit.mockClear(); f.client.emitPanelReport(report); f.client.emitTargetAudioSnapshot([], 1);
    expect(f.socket.volatile.emit).not.toHaveBeenCalled();
    await expect(f.client.saveUserAudioSettings(PANEL_AUDIO_DEFAULTS, 1)).rejects.toThrow('not connected');
  });

  it('forwards state requests and server audio-setting notifications', () => {
    const f = fixture(); f.client.handlers.onPanelStateRequest = vi.fn(); f.client.handlers.onUserAudioSettingsUpdated = vi.fn();
    f.listeners.get('panel-state-request')!(); f.listeners.get('user-audio-settings-updated')!({ settings: PANEL_AUDIO_DEFAULTS });
    expect(f.client.handlers.onPanelStateRequest).toHaveBeenCalledOnce(); expect(f.client.handlers.onUserAudioSettingsUpdated).toHaveBeenCalledWith(PANEL_AUDIO_DEFAULTS);
  });
});
