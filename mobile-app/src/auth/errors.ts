export class ApiClientError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
  }
}

export class InvalidCredentialsError extends ApiClientError {
  constructor(message = 'The username or password is incorrect.') {
    super(message, 401);
    this.name = 'InvalidCredentialsError';
  }
}

export class FeedLoginNotSupportedError extends ApiClientError {
  constructor() {
    super('Feed sign-in is not possible from the mobile app.');
    this.name = 'FeedLoginNotSupportedError';
  }
}

export class SessionCookieUnavailableError extends Error {
  constructor() {
    super(
      'Signed in, but TalkToMe 1.2.1+ did not store a talktome_session cookie for signaling. Older servers (1.1.x) do not use that cookie.',
    );
    this.name = 'SessionCookieUnavailableError';
  }
}

export class SessionConflictError extends Error {
  readonly existing?: { socketId?: string; name?: string };

  constructor(existing?: { socketId?: string; name?: string }) {
    const who = existing?.name ? ` (${existing.name})` : '';
    super(`This user is already signed in${who}. Take over that session?`);
    this.name = 'SessionConflictError';
    this.existing = existing;
  }
}

const MAX_OPERATOR_SERVER_TEXT = 160;

function isOperatorSafeServerText(text: string): boolean {
  if (!text || text.length > MAX_OPERATOR_SERVER_TEXT) {
    return false;
  }
  if (/[\r\n<>]/.test(text)) {
    return false;
  }
  if (/\b(exception|stack|sqlite|syntax error|sqlstate|traceback)\b/i.test(text)) {
    return false;
  }
  if (/\bat\s+\S+\s*\(/.test(text)) {
    return false;
  }
  return !/\b(select|insert|update|delete)\b[\s\S]{0,80}\b(from|into|set|where)\b/i.test(text);
}

/** Operator-facing text for a failed HTTP response. Never prefixes the raw body. */
export function operatorFacingServerMessage(status: number, serverText: unknown): string {
  if (status === 401 || status === 403) {
    return 'The username or password is incorrect.';
  }
  if (status >= 500) {
    return 'The server could not complete the request.';
  }
  if (typeof serverText === 'string' && isOperatorSafeServerText(serverText.trim())) {
    return serverText.trim();
  }
  return 'The server rejected the request.';
}

export class TlsUntrustedError extends Error {
  constructor() {
    super('Could not verify this server certificate. Check the server address and certificate.');
    this.name = 'TlsUntrustedError';
  }
}
