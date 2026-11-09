import type { Consumer, Transport } from 'mediasoup-client/types';
import { MediaStream } from 'react-native-webrtc';
import type { ActiveProducer } from '../protocol';
import { isFeedVideoProducer } from '../protocol/producers';
import type { SignalingClient } from '../signaling/client';

export type FeedVideoSnapshot = Record<string, { streamURL?: string; error?: string }>;
type Remote = { consumer: Consumer; stream: MediaStream; key: string; transport: Transport };
type Request = { producer: ActiveProducer; key: string; transport: Transport; capabilities: unknown };

/** Lazy video receivers, deliberately independent of the intercom's audio budget/queue. */
export class FeedVideoReceiver {
  private wanted = new Map<string, Request>();
  private remotes = new Map<string, Remote>();
  private errors: FeedVideoSnapshot = {};
  private work = Promise.resolve();
  private retry: ReturnType<typeof setTimeout> | null = null;
  private epoch = 0;
  private earlyClosed = new Set<string>();
  onChange: (() => void) | null = null;

  constructor(private signaling: SignalingClient) {}

  get snapshot(): FeedVideoSnapshot {
    const result = { ...this.errors };
    for (const remote of this.remotes.values()) result[remote.key] = { streamURL: remote.stream.toURL() };
    return result;
  }

  sync(producers: ActiveProducer[], visibleKeys: string[], transport: Transport | null, capabilities: unknown): void {
    const visible = new Set(visibleKeys);
    const wanted = new Map<string, Request>();
    if (transport && !transport.closed) for (const producer of producers) {
      if (!isFeedVideoProducer(producer) || producer.route.kind !== 'feed') continue;
      const key = `feed-${producer.route.id}`;
      if (visible.has(key) && ![...wanted.values()].some(item => item.key === key)) {
        wanted.set(producer.producerId, { producer, key, transport, capabilities });
      }
    }
    this.wanted = wanted;
    this.errors = {};
    // Release immediately, even if another consume request is still in flight.
    for (const [id, remote] of this.remotes) {
      if (wanted.get(id)?.transport !== remote.transport || remote.consumer.closed) { this.remotes.delete(id); this.close(remote); }
    }
    if (!wanted.size && this.retry) { clearTimeout(this.retry); this.retry = null; }
    this.onChange?.();
    this.work = this.work.then(() => this.reconcile(), () => this.reconcile());
  }

  dropConsumer(id: string): void {
    this.earlyClosed.add(id);
    if (this.earlyClosed.size > 128) this.earlyClosed.delete(this.earlyClosed.values().next().value!);
    for (const [producerId, remote] of this.remotes) {
      if (remote.consumer.id === id) {
        this.remotes.delete(producerId); this.wanted.delete(producerId); this.close(remote); this.onChange?.();
      }
    }
  }

  stop(): void {
    this.epoch++;
    this.wanted.clear();
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    for (const remote of this.remotes.values()) this.close(remote);
    this.remotes.clear(); this.errors = {}; this.onChange?.();
  }

  private current(id: string, request: Request, epoch: number): boolean {
    const wanted = this.wanted.get(id);
    return epoch === this.epoch && wanted?.transport === request.transport &&
      wanted.key === request.key && !request.transport.closed;
  }

  private async reconcile(): Promise<void> {
    const epoch = this.epoch;
    for (const [id, request] of this.wanted) {
      if (this.remotes.has(id) || !this.current(id, request, epoch)) continue;
      let consumer: Consumer | undefined;
      let stream: MediaStream | undefined;
      let consumerId: string | undefined;
      try {
        const params = await this.signaling.consume(id, request.capabilities);
        consumerId = params.id;
        if (!this.current(id, request, epoch)) { this.closeServer(consumerId); continue; }
        if (params.kind !== 'video') throw new Error('Expected a video track');
        consumer = await request.transport.consume({
          id: params.id, producerId: params.producerId, kind: 'video', rtpParameters: params.rtpParameters as never,
          streamId: request.key,
        });
        if (!this.current(id, request, epoch)) { consumer.close(); this.closeServer(consumerId); continue; }
        stream = new MediaStream(); stream.addTrack(consumer.track as never);
        consumer.resume();
        await this.signaling.resumeConsumer(consumer.id);
        if (!this.current(id, request, epoch) || consumer.closed || this.earlyClosed.has(consumerId)) {
          consumer.close(); stream.release(); this.closeServer(consumerId); continue;
        }
        this.remotes.set(id, { consumer, stream, key: request.key, transport: request.transport });
        delete this.errors[request.key]; this.onChange?.();
      } catch {
        consumer?.close(); stream?.release();
        if (consumerId) this.closeServer(consumerId);
        if (this.current(id, request, epoch)) {
          this.errors[request.key] = { error: 'Video unavailable. Retrying…' };
          this.onChange?.(); this.scheduleRetry();
        }
      } finally {
        if (consumerId) { this.earlyClosed.delete(consumerId); }
      }
    }
  }

  private scheduleRetry(): void {
    if (this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.work = this.work.then(() => this.reconcile(), () => this.reconcile());
    }, 5000);
  }

  private closeServer(id: string): void {
    void this.signaling.closeConsumer(id).catch(() => undefined);
  }

  private close(remote: Remote): void {
    remote.consumer.close(); remote.stream.release(); this.closeServer(remote.consumer.id);
  }
}
