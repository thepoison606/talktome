import { describe, expect, it } from 'vitest';

import { TalkToMeHttp } from './http';
import { ApiClient } from './apiClient';
import { FeedLoginNotSupportedError, InvalidCredentialsError } from './errors';
import type { CookieMap } from './cookieJar';

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  };
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function clientWith(fetchImpl: typeof fetch, cookies: CookieMap = {}) {
  let jar = cookies;
  const http = new TalkToMeHttp({
    baseUrl: 'https://intercom.local',
    getCookies: () => jar,
    setCookies: (next) => {
      jar = next;
    },
    fetchImpl,
  });
  return { client: new ApiClient(http), getCookies: () => jar };
}

describe('ApiClient', () => {
  it('loads the production target catalog and sends scoped add/remove changes', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const { client } = clientWith(mockFetch((url, init) => {
      calls.push({ url, init });
      if (url.includes('/available')) return jsonResponse(200, [{ targetType: 'feed', targetId: 4, name: 'Program', canTalk: false }]);
      return jsonResponse(200, { ok: true });
    }));
    expect(await client.fetchAvailableTargets(7)).toEqual([expect.objectContaining({ type: 'feed', id: 4, label: 'Program', canTalk: false })]);
    expect(calls[0]!.url).toBe('https://intercom.local/api/v1/client/targets/available?productionId=7');
    for (const action of ['add', 'remove'] as const) {
      await client.editTargetSelection(7, action, 'feed', 4);
      expect(calls.at(-1)!.url).toBe('https://intercom.local/api/v1/client/targets/selection');
      expect(JSON.parse(String(calls.at(-1)!.init?.body))).toEqual({ productionId: 7, action, targetType: 'feed', targetId: 4 });
    }
  });

  it('surfaces permission rejection instead of silently adding a target', async () => {
    const { client } = clientWith(mockFetch(() => jsonResponse(403, { error: 'User cannot add or remove targets' })));
    await expect(client.fetchAvailableTargets(7)).rejects.toMatchObject({ statusCode: 403 });
    await expect(client.editTargetSelection(7, 'add', 'user', 2)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('posts credentials to /login and stores the session cookie', async () => {
    const { client, getCookies } = clientWith(
      mockFetch(async (url, init) => {
        expect(url).toBe('https://intercom.local/login');
        expect(init?.method).toBe('POST');
        expect(init?.credentials).toBe('include');
        expect(JSON.parse(String(init?.body))).toEqual({ name: 'alice', password: 'secret' });
        return jsonResponse(
          200,
          {
            id: 5,
            name: 'alice',
            kind: 'user',
            productions: [{ id: 2, name: 'Test-von-Adi' }],
          },
          { 'set-cookie': 'talktome_session=cookie-1; HttpOnly; Secure' },
        );
      }),
    );

    const identity = await client.login('alice', 'secret');
    expect(identity).toEqual({
      id: 5,
      name: 'alice',
      kind: 'user',
      productions: [{ id: 2, name: 'Test-von-Adi' }],
    });
    expect(getCookies().talktome_session).toBe('cookie-1');
  });

  it('maps 401 to invalid credentials', async () => {
    const { client } = clientWith(
      mockFetch(async () => jsonResponse(401, { error: 'Invalid credentials' })),
    );
    await expect(client.login('alice', 'wrong')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rejects feed logins', async () => {
    const { client } = clientWith(
      mockFetch(async () => jsonResponse(200, { id: 1, name: 'program', kind: 'feed' })),
    );
    await expect(client.login('program', 'secret')).rejects.toBeInstanceOf(FeedLoginNotSupportedError);
  });

  it('posts a login token to /login/token', async () => {
    const { client, getCookies } = clientWith(
      mockFetch(async (url, init) => {
        expect(url).toBe('https://intercom.local/login/token');
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ token: 'abcDEF1234567890' });
        return jsonResponse(
          200,
          { id: 5, name: 'alice', kind: 'user', productions: [] },
          { 'set-cookie': 'talktome_session=cookie-2; HttpOnly; Secure' },
        );
      }),
    );

    await expect(client.loginToken('abcDEF1234567890')).resolves.toEqual({
      id: 5,
      name: 'alice',
      kind: 'user',
      productions: [],
    });
    expect(getCookies().talktome_session).toBe('cookie-2');
  });

  it('maps an invalid login token to invalid credentials', async () => {
    const { client } = clientWith(
      mockFetch(async () => jsonResponse(401, { error: 'Invalid or expired login link' })),
    );
    await expect(client.loginToken('nope')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('decodes the targets grid', async () => {
    const { client } = clientWith(
      mockFetch(async (url) => {
        expect(url).toBe('https://intercom.local/users/7/targets?includeMemberships=1');
        return jsonResponse(200, [
          { targetType: 'user', targetId: 11, name: 'Stage Left' },
          { targetType: 'conference', targetId: 2, name: 'All', canTalk: false },
          { targetType: 'feed', targetId: 5, name: 'Program' },
        ]);
      }),
    );

    await expect(client.fetchTargets(7)).resolves.toEqual([
      { type: 'user', id: 11, label: 'Stage Left', canTalk: true },
      { type: 'conference', id: 2, label: 'All', canTalk: false, members: [] },
      { type: 'feed', id: 5, label: 'Program', canTalk: true },
    ]);
  });

  it('posts guest login without a session cookie', async () => {
    const { client, getCookies } = clientWith(
      mockFetch(async (url, init) => {
        expect(url).toBe('https://intercom.local/login/guest');
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ name: 'Visitor' });
        return jsonResponse(200, {
          kind: 'guest',
          guestId: 'g-1',
          guestProfileUserId: 4,
          name: 'Visitor',
          productions: [{ id: 2, name: 'Show' }],
        });
      }),
    );

    await expect(client.loginGuest('Visitor')).resolves.toEqual({
      id: 'g-1',
      name: 'Visitor',
      kind: 'guest',
      guestId: 'g-1',
      guestProfileUserId: 4,
      productions: [{ id: 2, name: 'Show' }],
    });
    expect(getCookies()).toEqual({});
  });

  it('loads guest targets from /guest/targets', async () => {
    const { client } = clientWith(
      mockFetch(async (url) => {
        expect(url).toBe('https://intercom.local/guest/targets?productionId=2');
        return jsonResponse(200, [{ targetType: 'conference', targetId: 1, name: 'All' }]);
      }),
    );
    await expect(client.fetchGuestTargets(2)).resolves.toEqual([
      { type: 'conference', id: 1, label: 'All', canTalk: true, members: [] },
    ]);
  });

  it('passes productionId when a production is selected', async () => {
    const { client } = clientWith(
      mockFetch(async (url) => {
        expect(url).toBe(
          'https://intercom.local/users/7/targets?includeMemberships=1&productionId=2',
        );
        return jsonResponse(200, []);
      }),
    );
    await expect(client.fetchTargets(7, 2)).resolves.toEqual([]);
  });

  it('saves target order without duplicating the native iOS session cookie', async () => {
    const sessionCookie = 'talktome_session=order-session';
    let nativeCookie = '';
    const items = [
      { targetType: 'conference', targetId: 2 },
      { targetType: 'user', targetId: 11 },
    ];
    const { client } = clientWith(
      mockFetch((url, init) => {
        if (url.endsWith('/login')) {
          nativeCookie = sessionCookie;
          return jsonResponse(
            200,
            { id: 7, name: 'alice', kind: 'user', productions: [] },
            { 'set-cookie': `${sessionCookie}; Path=/; HttpOnly; Secure` },
          );
        }
        expect(url).toBe('https://intercom.local/api/v1/client/targets/order');
        expect(init?.method).toBe('PUT');
        expect(JSON.parse(String(init?.body))).toEqual({ productionId: 3, items });
        // RCTNetworking loads native cookies, then uses NSMutableURLRequest.addValue
        // for supplied headers. Cookie values are joined with a comma, not replaced.
        const cookie = [
          init?.credentials === 'omit' ? '' : nativeCookie,
          new Headers(init?.headers).get('Cookie'),
        ].filter(Boolean).join(',');
        return cookie === sessionCookie
          ? jsonResponse(200, { ok: true })
          : jsonResponse(401, { error: 'User login required' });
      }),
    );

    await client.login('alice', 'secret');
    await expect(client.saveTargetOrder(3, items)).resolves.toBeUndefined();
  });

  it.each([
    [401, 'User login required', 'The server did not recognize your login. Disconnect and sign in again.'],
    [403, 'User cannot arrange targets', 'This account cannot arrange targets.'],
    [403, 'User is not a member of this production', 'This account is not assigned to the selected production.'],
    [403, 'Forbidden', 'The server did not allow changing the target order.'],
  ])('explains a target order rejection (%s, %s)', async (status, error, message) => {
    const { client } = clientWith(mockFetch(() => jsonResponse(status, { error })));
    await expect(client.saveTargetOrder(3, [])).rejects.toMatchObject({ message, statusCode: status });
  });

  it('hides a raw server failure from the operator', async () => {
    const { client } = clientWith(
      mockFetch(async () =>
        jsonResponse(500, {
          error: 'SQLITE_ERROR: no such table\n    at Server (/app/server.js:10:1)',
        }),
      ),
    );
    await expect(client.fetchTargets(7)).rejects.toThrow('The server could not complete the request.');
  });

  it('keeps a short human server message', async () => {
    const { client } = clientWith(
      mockFetch(async () => jsonResponse(409, { error: 'This user is already signed in.' })),
    );
    await expect(client.fetchTargets(7)).rejects.toThrow('This user is already signed in.');
  });
});
