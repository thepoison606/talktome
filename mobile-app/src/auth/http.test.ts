import { afterEach, describe, expect, it, vi } from 'vitest';
import { HTTP_REQUEST_TIMEOUT_MS, HttpRequestTimeoutError, TalkToMeHttp } from './http';

afterEach(() => vi.useRealTimers());

function fixture(fetchImpl: typeof fetch, retryLocalNetworkErrors = false) {
  const setCookies = vi.fn();
  const http = new TalkToMeHttp({
    baseUrl: 'https://192.168.1.10', getCookies: () => ({}), setCookies,
    fetchImpl, retryLocalNetworkErrors,
  });
  return { http, setCookies };
}

describe('HTTP request deadline', () => {
  it.each([false, true])('bounds an unresponsive native request (LAN retry: %s) and ignores late cookies', async retry => {
    vi.useFakeTimers();
    let reply!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise(resolve => { reply = resolve; }));
    const { http, setCookies } = fixture(fetchImpl, retry);
    const failed = expect(http.request('/api/v1/health')).rejects.toBeInstanceOf(HttpRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(HTTP_REQUEST_TIMEOUT_MS);
    await failed;
    expect(fetchImpl.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    reply(new Response('{}', { headers: { 'set-cookie': 'talktome_session=stale' } }));
    await vi.runAllTimersAsync();
    expect(setCookies).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves caller cancellation even when fetch ignores abort', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const { http } = fixture(fetchImpl);
    const controller = new AbortController();
    const failed = expect(http.request('/login/options', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await failed;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up the deadline on success', async () => {
    vi.useFakeTimers();
    const { http } = fixture(vi.fn<typeof fetch>().mockResolvedValue(new Response('{}')));
    expect((await http.request('/api/v1/health')).ok).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
