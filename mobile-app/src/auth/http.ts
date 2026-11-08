import { applySetCookieHeaders, cookieHeader, readSetCookieHeaders, type CookieMap } from './cookieJar';
import { fetchWithLocalNetworkRetry } from './localNetworkRetry';

// Includes the iOS LAN permission retries (10.5 seconds in total).
export const HTTP_REQUEST_TIMEOUT_MS = 15_000;

export class HttpRequestTimeoutError extends Error {
  constructor() {
    super('The server did not respond in time. Check the server address and network connection, then try again.');
    this.name = 'HttpRequestTimeoutError';
  }
}

export type HttpClientOptions = {
  baseUrl: string;
  getCookies: () => CookieMap;
  setCookies: (next: CookieMap) => void;
  fetchImpl?: typeof fetch;
  retryLocalNetworkErrors?: boolean;
  signal?: AbortSignal;
};

export class TalkToMeHttp {
  constructor(private readonly options: HttpClientOptions) {}

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const headers = new Headers(init.headers);
    const cookie = cookieHeader(this.options.getCookies());
    if (cookie && !headers.has('Cookie')) {
      headers.set('Cookie', cookie);
    }

    const request: RequestInit = {
      ...init,
      // iOS appends supplied Cookie headers to native cookies when credentials
      // are included. Use our explicit jar alone once it contains a cookie.
      credentials: init.credentials ?? (headers.has('Cookie') ? 'omit' : 'include'),
      headers,
    };
    const url = joinUrl(this.options.baseUrl, path);
    const controller = new AbortController();
    const abort = () => controller.abort(init.signal?.reason);
    const abortSession = () => controller.abort(this.options.signal?.reason);
    init.signal?.addEventListener('abort', abort, { once: true });
    this.options.signal?.addEventListener('abort', abortSession, { once: true });
    if (init.signal?.aborted) abort();
    if (this.options.signal?.aborted) abortSession();
    request.signal = controller.signal;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason ?? new Error('Request cancelled.'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
      timer = setTimeout(() => controller.abort(new HttpRequestTimeoutError()), HTTP_REQUEST_TIMEOUT_MS);
    });
    try {
      if (controller.signal.aborted) return await cancelled;
      // Race explicitly: a native networking implementation may not settle fetch
      // promptly after abort. Late replies must not update the session cookie jar.
      const response = await Promise.race([
        this.options.retryLocalNetworkErrors
          ? fetchWithLocalNetworkRetry(fetchImpl, url, request)
          : fetchImpl(url, request),
        cancelled,
      ]);
      const next = applySetCookieHeaders(this.options.getCookies(), readSetCookieHeaders(response.headers));
      this.options.setCookies(next);
      return response;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', abort);
      this.options.signal?.removeEventListener('abort', abortSession);
      controller.signal.removeEventListener('abort', onAbort);
    }
  }
}

export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export async function readJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
