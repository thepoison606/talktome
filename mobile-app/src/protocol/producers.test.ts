import { describe, expect, it } from 'vitest';

import { isFeedVideoProducer, parseActiveProducer, parseActiveProducers } from './producers';

describe('parseActiveProducer', () => {
  it('maps a server-rewritten user delivery', () => {
    expect(
      parseActiveProducer({
        peerId: 'sock-1',
        speakerUserId: 9,
        producerId: 'prod-1',
        appData: { type: 'user', id: 4, targetPeer: 'sock-me' },
      }),
    ).toMatchObject({
      peerId: 'sock-1',
      producerId: 'prod-1',
      route: { kind: 'directUser', targetPeerId: 'sock-me' },
    });
  });

  it('accepts type talk instead of dropping it', () => {
    expect(
      parseActiveProducer({
        peerId: 'sock-1',
        producerId: 'prod-2',
        appData: { type: 'talk' },
      })?.route,
    ).toEqual({ kind: 'talk' });
  });

  it('parses a snapshot list', () => {
    expect(
      parseActiveProducers([
        { peerId: 'a', producerId: '1', appData: { type: 'conference', id: 2 } },
        { peerId: 'b' },
      ]),
    ).toHaveLength(1);
  });
});


it('retains the media kind so video never becomes an audio consumer', () => {
  const base = { peerId: 'feed', producerId: 'v', appData: { type: 'feed', id: 1, mediaKind: 'video' } };
  expect(isFeedVideoProducer(parseActiveProducer({ ...base, kind: 'video' })!)).toBe(true);
  expect(isFeedVideoProducer(parseActiveProducer(base)!)).toBe(true);
  expect(isFeedVideoProducer(parseActiveProducer({ ...base, kind: 'audio' })!)).toBe(false);
  expect(isFeedVideoProducer(parseActiveProducer({ ...base, kind: 'video', appData: { type: 'talk' } })!)).toBe(false);
});
