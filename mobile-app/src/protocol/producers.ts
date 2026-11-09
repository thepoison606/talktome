// Derived from talktome-apple SignalingClient.parseActiveProducer @ 004d6e76
// by Daniel Jocher. Recipient appData is rewritten by the server (talk → user /
// conference / guest); we also accept type "talk" instead of dropping it.

import type { ActiveProducer, ActiveProducerRoute } from './types';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function parseActiveProducer(payload: unknown): ActiveProducer | null {
  const item = asRecord(payload);
  if (!item) {
    return null;
  }

  const peerId = asString(item.peerId);
  const producerId = asString(item.producerId);
  if (!peerId || !producerId) {
    return null;
  }

  const appData = asRecord(item.appData) ?? {};
  const type = typeof appData.type === 'string' ? appData.type.trim().toLowerCase() : '';
  const route = routeFromAppData(type, appData);

  return {
    peerId,
    producerId,
    ...(item.kind === 'audio' || item.kind === 'video' ? { kind: item.kind } : {}),
    speakerUserId: asNumber(item.speakerUserId) ?? null,
    appData,
    route,
  };
}

export function parseActiveProducers(payload: unknown): ActiveProducer[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.map(parseActiveProducer).filter((item): item is ActiveProducer => item !== null);
}

function routeFromAppData(type: string, appData: Record<string, unknown>): ActiveProducerRoute {
  switch (type) {
    case 'user':
      return {
        kind: 'directUser',
        targetPeerId: asString(appData.targetPeer) ?? asString(appData.id),
      };
    case 'conference': {
      const id = asNumber(appData.id);
      return id === undefined ? { kind: 'unknown', type } : { kind: 'conference', id };
    }
    case 'feed': {
      const id = asNumber(appData.id);
      return id === undefined ? { kind: 'unknown', type } : { kind: 'feed', id };
    }
    case 'guest':
      return { kind: 'guest', id: String(appData.id ?? '') };
    case 'talk':
      return { kind: 'talk' };
    default:
      return { kind: 'unknown', type: type || 'unknown' };
  }
}

export function activeFeedKeysFromProducers(producers: ActiveProducer[]): string[] {
  const keys = new Set<string>();
  for (const producer of producers) {
    if (producer.route.kind === 'feed') {
      keys.add(`feed-${producer.route.id}`);
    }
  }
  return [...keys];
}

/** Older servers omit kind. Only explicitly advertised feed video is treated as video. */
export function isFeedVideoProducer(producer: ActiveProducer): boolean {
  return producer.route.kind === 'feed' && (producer.kind === 'video' ||
    (producer.kind == null && producer.appData.mediaKind === 'video'));
}
