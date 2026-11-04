import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Transport } from 'mediasoup-client/types';
import type { SignalingClient } from '../signaling/client';
import type { ActiveProducer } from '../protocol';
import { FeedVideoReceiver } from './feedVideoReceiver';

const mocks = vi.hoisted(() => ({ released: vi.fn() }));
vi.mock('react-native-webrtc', () => ({ MediaStream: class {
  addTrack() {} toURL() { return 'native-video'; } release() { mocks.released(); }
} }));
const video: ActiveProducer = { peerId: 'feed', producerId: 'v1', kind: 'video',
  route: { kind: 'feed', id: 1 }, appData: { type: 'feed', id: 1 } };
const audio: ActiveProducer = { ...video, producerId: 'a1', kind: 'audio' };
function setup() {
  const consumer = { id: 'c1', closed: false, track: {}, resume: vi.fn(), close: vi.fn() };
  const transport = { closed: false, consume: vi.fn().mockResolvedValue(consumer) };
  const signaling = { consume: vi.fn().mockResolvedValue({ id: 'c1', producerId: 'v1', kind: 'video', rtpParameters: {} }),
    resumeConsumer: vi.fn().mockResolvedValue(undefined), closeConsumer: vi.fn().mockResolvedValue(undefined) };
  const receiver = new FeedVideoReceiver(signaling as unknown as SignalingClient);
  const sync = (keys: string[], producers = [audio, video]) => receiver.sync(producers, keys, transport as unknown as Transport, {});
  return { consumer, transport, signaling, receiver, sync };
}
afterEach(() => { vi.useRealTimers(); mocks.released.mockClear(); });

describe('lazy native feed video', () => {
  it('consumes only expanded visible video, independently of feed audio', async () => {
    const f = setup(); f.sync([]); await Promise.resolve(); expect(f.signaling.consume).not.toHaveBeenCalled();
    f.sync(['feed-1']); await vi.waitFor(() => expect(f.receiver.snapshot['feed-1']?.streamURL).toBe('native-video'));
    expect(f.signaling.consume).toHaveBeenCalledTimes(1); expect(f.signaling.consume).toHaveBeenCalledWith('v1', {});
    f.sync([]); expect(f.receiver.snapshot).toEqual({}); expect(f.consumer.close).toHaveBeenCalledOnce();
    expect(mocks.released).toHaveBeenCalledOnce();
  });

  it('closes late server consumers when a feed is hidden before consume finishes', async () => {
    const f = setup(); let finish!: (value: unknown) => void;
    f.signaling.consume.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    f.sync(['feed-1']); await vi.waitFor(() => expect(f.signaling.consume).toHaveBeenCalled());
    f.sync([]); finish({ id: 'late', kind: 'video' });
    await vi.waitFor(() => expect(f.signaling.closeConsumer).toHaveBeenCalledWith('late'));
    expect(f.transport.consume).not.toHaveBeenCalled(); expect(f.receiver.snapshot).toEqual({});
  });

  it('never exposes a late resumed stream after disconnect', async () => {
    const f = setup(); let finish!: () => void;
    f.signaling.resumeConsumer.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    f.sync(['feed-1']); await vi.waitFor(() => expect(f.signaling.resumeConsumer).toHaveBeenCalled());
    f.receiver.stop(); finish(); await vi.waitFor(() => expect(f.consumer.close).toHaveBeenCalled());
    expect(f.receiver.snapshot).toEqual({}); expect(mocks.released).toHaveBeenCalledOnce();
  });

  it('handles a server close received while resume is pending', async () => {
    const f = setup(); let finish!: () => void;
    f.signaling.resumeConsumer.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    f.sync(['feed-1']); await vi.waitFor(() => expect(f.signaling.resumeConsumer).toHaveBeenCalled());
    f.receiver.dropConsumer('c1'); finish(); await vi.waitFor(() => expect(f.consumer.close).toHaveBeenCalled());
    expect(f.receiver.snapshot).toEqual({});
  });

  it('retries video failures without throwing into the intercom session', async () => {
    vi.useFakeTimers(); const f = setup();
    f.signaling.consume.mockRejectedValueOnce(new Error('Unavailable'));
    f.sync(['feed-1']); await vi.advanceTimersByTimeAsync(0);
    expect(f.receiver.snapshot['feed-1']?.error).toContain('Retrying');
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.receiver.snapshot['feed-1']?.streamURL).toBe('native-video'); f.receiver.stop();
  });

  it('releases a removed producer and keeps other advertised feeds lazy', async () => {
    const f = setup(); f.sync(['feed-1']);
    await vi.waitFor(() => expect(f.receiver.snapshot['feed-1']?.streamURL).toBeTruthy());
    f.sync(['feed-1'], [audio]); expect(f.receiver.snapshot).toEqual({});
    expect(f.consumer.close).toHaveBeenCalledOnce();
  });
});
