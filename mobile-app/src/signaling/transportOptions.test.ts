import { describe, expect, it } from 'vitest';

import { SESSION_COOKIE_NAME } from '../auth/cookieJar';
import {
  cookieExtraHeaders,
  parseTransportOptions,
  registerUserPayload,
  signalingSocketOptions,
} from './client';

describe('parseTransportOptions', () => {
  it('keeps server iceServers and iceTransportPolicy', () => {
    const options = parseTransportOptions({
      id: 'tr-1',
      iceParameters: { usernameFragment: 'u', password: 'p' },
      iceCandidates: [{ foundation: '1' }],
      dtlsParameters: { fingerprints: [] },
      iceServers: [{ urls: 'turn:turn.example:3478' }],
      iceTransportPolicy: 'relay',
    });

    expect(options.iceServers).toEqual([{ urls: 'turn:turn.example:3478' }]);
    expect(options.iceTransportPolicy).toBe('relay');
  });

  it('defaults a missing ICE list to empty instead of dropping the field', () => {
    const options = parseTransportOptions({
      id: 'tr-2',
      iceParameters: {},
      iceCandidates: [],
      dtlsParameters: {},
    });
    expect(options.iceServers).toEqual([]);
    expect(options.iceTransportPolicy).toBeUndefined();
  });
});

describe('signaling handshake', () => {
  it('starts on polling so the session cookie can travel', () => {
    const options = signalingSocketOptions({ [SESSION_COOKIE_NAME]: 'cookie-1' });
    expect(options.transports).toEqual(['polling']);
    expect(options.upgrade).toBe(false);
    expect(options.withCredentials).toBe(false);
    expect(options.forceNew).toBe(true);
    expect(options.extraHeaders).toEqual({ Cookie: `${SESSION_COOKIE_NAME}=cookie-1` });
    expect(options.transportOptions.polling.extraHeaders).toEqual(options.extraHeaders);
  });

  it('omits Cookie rather than sending an empty header that would wipe native cookies', () => {
    expect(cookieExtraHeaders({})).toEqual({});
  });

  it('registers with a string id like the production web client', () => {
    expect(
      registerUserPayload({ id: 5, name: 'adi', kind: 'user' }, false),
    ).toEqual({
      id: '5',
      name: 'adi',
      kind: 'user',
      guestProfileUserId: null,
      productionId: null,
      force: false,
      clientType: null,
    });
  });

  it('registers guests with the profile user id and guest UUID', () => {
    expect(
      registerUserPayload(
        {
          id: 'guest-uuid',
          name: 'Visitor',
          kind: 'guest',
          guestId: 'guest-uuid',
          guestProfileUserId: 9,
        },
        false,
      ),
    ).toEqual({
      id: 'guest-uuid',
      name: 'Visitor',
      kind: 'guest',
      guestProfileUserId: 9,
      productionId: null,
      force: false,
      clientType: null,
    });
  });

  it('registers the selected production like the web client', () => {
    expect(
      registerUserPayload({ id: 5, name: 'adi', kind: 'user' }, false, 4),
    ).toMatchObject({ productionId: 4 });
  });

  it('identifies native iOS and Android registrations', () => {
    const identity = { id: 5, name: 'adi', kind: 'user' } as const;
    expect(registerUserPayload(identity, false, null, 'ios').clientType).toBe('ios-app');
    expect(registerUserPayload(identity, false, null, 'android').clientType).toBe('android-app');
  });

  it('includes native version and build metadata without changing the identity', () => {
    expect(registerUserPayload({ id: 5, name: 'adi', kind: 'user' }, false, 4, 'ios', {
      clientVersion: '1.5.20', clientBuild: '70',
    })).toMatchObject({ id: '5', productionId: 4, clientType: 'ios-app', clientVersion: '1.5.20', clientBuild: '70' });
  });
});
