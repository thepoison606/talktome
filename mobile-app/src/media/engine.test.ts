import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transport } from 'mediasoup-client/types';
import type { SignalingClient } from '../signaling/client';
import { MediaEngine } from './engine';
import { OPUS_PROFILES } from './opus';
import { DEFAULT_OPERATOR_AUDIO } from '../session/operatorAudio';
const mocks = vi.hoisted(() => ({ getUserMedia: vi.fn() }));
vi.mock('react-native-webrtc', () => ({ mediaDevices: { getUserMedia: mocks.getUserMedia }, MediaStream: class {
  tracks: { kind?: string }[] = [];
  addTrack(track: { kind?: string }) { this.tracks.push(track); }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  toURL() { return 'video-stream'; }
  release() {}
} }));
vi.mock('mediasoup-client', () => ({ Device: class {} }));
const target = { type: 'conference', id: 1, label: 'A', canTalk: true } as const;

function fixture() {
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  const track = { stop: vi.fn() };
  mocks.getUserMedia.mockResolvedValue(stream);
  let nextId = 0;
  const producers: ReturnType<typeof producer>[] = [];
  function producer() { return { id: `p${nextId++}`, paused: true, closed: false, pause() { this.paused = true; }, resume: vi.fn(function(this: { paused: boolean }) { this.paused = false; }), close: vi.fn(function(this: { closed: boolean }) { this.closed = true; }), replaceTrack: vi.fn(async () => {}) }; }
  const transport = { produce: vi.fn(async () => { const result = producer(); producers.push(result); return result; }), close: vi.fn() };
  const signaling = { pauseProducer: vi.fn(async () => {}), resumeProducer: vi.fn(async () => {}), closeProducer: vi.fn(async () => {}), emitTalkTargetsUpdated: vi.fn(), emitPttState: vi.fn() };
  const engine = new MediaEngine(signaling as unknown as SignalingClient);
  (engine as unknown as { sendTransport: Transport }).sendTransport = transport as unknown as Transport;
  return { engine, stream, track, transport, signaling, producers };
}
beforeEach(() => { mocks.getUserMedia.mockReset(); });

describe('native panel media lifecycle', () => {
  it('keeps available receive stats when the other transport fails', async () => {
    const f = fixture();
    Object.assign(f.transport, { getStats: vi.fn().mockRejectedValue(new Error('Closed transport')) });
    (f.engine as unknown as { recvTransport: unknown }).recvTransport = {
      getStats: async () => new Map([['candidate', { type: 'candidate-pair', selected: true, currentRoundTripTime: 0.024 }]]),
    };
    expect(await f.engine.networkStats()).toMatchObject({ roundTripMs: 24, packetLossPercent: null });
  });

  it('discards network stats collected from a superseded media session', async () => {
    const f = fixture(); let finish!: (value: unknown) => void;
    Object.assign(f.transport, { getStats: () => new Promise(resolve => { finish = resolve; }) });
    const pending = f.engine.networkStats(); await f.engine.stop();
    finish(new Map([['candidate', { type: 'candidate-pair', selected: true, currentRoundTripTime: 0.024 }]]));
    expect(await pending).toEqual({ roundTripMs: null, packetLossPercent: null });
  });
  it('shares one microphone acquisition between concurrent talk inputs', async () => {
    const f = fixture(); await Promise.all([f.engine.startTalking([target]), f.engine.startTalking([target])]);
    expect(mocks.getUserMedia).toHaveBeenCalledOnce(); expect(f.transport.produce).toHaveBeenCalledOnce();
  });

  it('never resumes a released press after delayed microphone permission', async () => {
    const f = fixture(); let finish!: (value: unknown) => void; mocks.getUserMedia.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.engine.startTalking([target]); await f.engine.stopTalking(); finish(f.stream); await pending;
    expect(f.producers[0]!.resume).not.toHaveBeenCalled(); expect(f.signaling.emitPttState).toHaveBeenLastCalledWith(expect.objectContaining({ talking: false }));
  });

  it('reads the current owned targets after microphone warmup', async () => {
    const f = fixture(); let targets = [target]; let finish!: (value: unknown) => void;
    mocks.getUserMedia.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.engine.startTalking(targets, false, () => ({ targets, lockActive: false })); targets = []; finish(f.stream); await pending;
    expect(f.producers[0]!.resume).not.toHaveBeenCalled();
  });

  it('recreates the producer with the selected Opus profile and retains the current lock', async () => {
    const f = fixture(); await f.engine.startTalking([target], true);
    await f.engine.applyTalkOpusProfile(OPUS_PROFILES.low, () => ({ targets: [target], lockActive: true }));
    expect(f.producers[0]!.close).toHaveBeenCalledOnce(); expect(f.signaling.closeProducer).toHaveBeenCalledWith('p0');
    expect(f.transport.produce).toHaveBeenLastCalledWith(expect.objectContaining(OPUS_PROFILES.low));
    expect(f.signaling.emitPttState).toHaveBeenLastCalledWith(expect.objectContaining({ talking: true, lockActive: true, targets: [target] }));
  });

  it('does not restart Talk when the operator stops during profile replacement', async () => {
    const f = fixture(); await f.engine.startTalking([target]); let targets = [target]; let finish!: () => void;
    f.signaling.closeProducer.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.engine.applyTalkOpusProfile(OPUS_PROFILES.low, () => ({ targets, lockActive: false }));
    await vi.waitFor(() => expect(f.signaling.closeProducer).toHaveBeenCalled()); targets = []; await f.engine.stopTalking(); finish(); await pending;
    expect(f.producers[1]!.resume).not.toHaveBeenCalled();
  });

  it('cleans up a delayed microphone after the session is stopped', async () => {
    const f = fixture(); let finish!: (value: unknown) => void; mocks.getUserMedia.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.engine.warmTalkProducer(); await f.engine.stop(); finish(f.stream);
    await expect(pending).rejects.toThrow('Media session changed'); expect(f.track.stop).toHaveBeenCalledOnce(); expect(f.transport.produce).not.toHaveBeenCalled();
  });

  it('does not replace a closed producer with a late capture-settings result', async () => {
    const f = fixture(); await f.engine.warmTalkProducer(); const nextTrack = { stop: vi.fn() }; let finish!: (value: unknown) => void;
    mocks.getUserMedia.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.engine.applyCaptureSettings({ ...DEFAULT_OPERATOR_AUDIO, autoGainControl: false }); await f.engine.stop();
    finish({ getAudioTracks: () => [nextTrack], getTracks: () => [nextTrack] });
    await expect(pending).rejects.toThrow('Media session changed'); expect(nextTrack.stop).toHaveBeenCalledOnce(); expect(f.producers[0]!.replaceTrack).not.toHaveBeenCalled();
  });
});


describe('video and intercom isolation', () => {
  it('keeps playing audio when video is opened, hidden, or stopped', async () => {
    const f = fixture();
    const audio = { peerId: 'feed', producerId: 'audio', kind: 'audio' as const,
      route: { kind: 'feed' as const, id: 1 }, appData: { type: 'feed', id: 1 } };
    const video = { ...audio, producerId: 'video', kind: 'video' as const };
    const consumers = new Map<string, { id: string; closed: boolean; track: object; resume: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>();
    const recv = { closed: false, consume: vi.fn(async (params: { id: string; kind: string }) => {
      const consumer = { id: params.id, closed: false, track: { kind: params.kind, _setVolume: vi.fn() }, resume: vi.fn(), pause: vi.fn(), close: vi.fn() };
      consumers.set(params.id, consumer); return consumer;
    }) };
    Object.assign(f.signaling, { consume: vi.fn(async (id: string) => ({ id, producerId: id, kind: id, rtpParameters: {} })),
      resumeConsumer: vi.fn().mockResolvedValue(undefined), closeConsumer: vi.fn().mockResolvedValue(undefined) });
    Object.assign(f.engine, { device: { rtpCapabilities: {} }, recvTransport: recv });
    await f.engine.syncProducers([audio, video]);
    expect(consumers.size).toBe(1); expect(f.engine.activeRemoteCount).toBe(1);
    f.engine.setFeedVideoTargets(['feed-1']);
    await vi.waitFor(() => expect(f.engine.feedVideoSnapshot['feed-1']?.streamURL).toBe('video-stream'));
    expect(f.engine.activeRemoteCount).toBe(1); expect(f.engine.overBudget).toBe(false);
    expect(recv.consume.mock.calls.every(([params]) => (params as { streamId?: string }).streamId === 'feed-1')).toBe(true);
    f.engine.setFeedVideoTargets([]);
    expect(consumers.get('video')!.close).toHaveBeenCalledOnce();
    expect(consumers.get('audio')!.close).not.toHaveBeenCalled();
    expect(consumers.get('audio')!.pause).not.toHaveBeenCalled();
    f.engine.setFeedVideoTargets(['feed-1']);
    await vi.waitFor(() => expect(f.engine.feedVideoSnapshot['feed-1']?.streamURL).toBeTruthy());
    await f.engine.setStoppedFeedKeys(['feed-1']);
    expect(f.engine.feedVideoSnapshot).toEqual({}); expect(f.engine.activeRemoteCount).toBe(0);
    await f.engine.setStoppedFeedKeys([]);
    await vi.waitFor(() => expect(f.engine.feedVideoSnapshot['feed-1']?.streamURL).toBeTruthy());
    expect(f.engine.activeRemoteCount).toBe(1); await f.engine.stop();
  });
});
