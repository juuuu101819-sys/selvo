import { SESSION_COOKIE } from './session-cookie';

export { SESSION_COOKIE };

/** Same public code as the API PA-M03 DTO. */
export const SESSION_UNAUTHENTICATED_CODE = 'UNAUTHENTICATED';

/**
 * Safe client message. Missing, malformed, expired, and API-rejected cookies all produce this
 * wording so the response does not disclose why the cookie was refused.
 */
export const SESSION_UNAUTHENTICATED_MESSAGE = 'Sign in to continue.';

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:47311';
const SESSION_VERIFY_TIMEOUT_MS = 8_000;

/** Session tokens are `mds_` + base64url (A-Za-z0-9-_). */
const SESSION_TOKEN_PATTERN = /^mds_[A-Za-z0-9_-]{32,}$/;

export function looksLikeSessionToken(value: string): boolean {
  return SESSION_TOKEN_PATTERN.test(value);
}

export interface UnauthenticatedErrorBody {
  readonly error: {
    readonly code: typeof SESSION_UNAUTHENTICATED_CODE;
    readonly message: typeof SESSION_UNAUTHENTICATED_MESSAGE;
    readonly details: Record<string, never>;
    readonly requestId: string;
  };
}

export function unauthenticatedErrorBody(requestId: string): UnauthenticatedErrorBody {
  return {
    error: {
      code: SESSION_UNAUTHENTICATED_CODE,
      message: SESSION_UNAUTHENTICATED_MESSAGE,
      details: {},
      requestId,
    },
  };
}

export interface SessionGateHeaders {
  readonly accept?: string | null;
  readonly rsc?: string | null;
  readonly fetchMode?: string | null;
}

export interface EvaluateSessionInput {
  readonly cookieValue: string | undefined;
  readonly apiBaseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * True only when the cookie is a well-formed session token that the API currently accepts.
 *
 * Fail-closed: network errors, timeouts, and non-2xx `/auth/me` responses are treated as
 * unauthenticated. The boolean does not distinguish missing vs malformed vs expired.
 */
export async function evaluateSessionCookie(input: EvaluateSessionInput): Promise<boolean> {
  const value = input.cookieValue?.trim() ?? '';
  if (value === '' || !looksLikeSessionToken(value)) {
    return false;
  }
  return verifySessionWithApi(value, input);
}

async function verifySessionWithApi(
  token: string,
  input: EvaluateSessionInput,
): Promise<boolean> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = (input.apiBaseUrl ?? process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(
    /\/$/,
    '',
  );
  const timeoutMs = input.timeoutMs ?? SESSION_VERIFY_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(`${base}/api/v1/auth/me`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Browser document navigations (and RSC) redirect to sign-in. Programmatic JSON/fetch callers
 * receive the PA-M03 401 DTO. Neither path discloses why the cookie was rejected.
 */
export function wantsUnauthenticatedJson(headers: SessionGateHeaders): boolean {
  if (headers.rsc === '1') {
    return false;
  }
  if (headers.fetchMode === 'navigate') {
    return false;
  }
  const accept = headers.accept ?? '';
  return accept.includes('application/json') && !accept.includes('text/html');
}

export type DashboardAccessDecision =
  | { readonly kind: 'next' }
  | { readonly kind: 'redirect'; readonly location: string }
  | { readonly kind: 'unauthorized'; readonly body: UnauthenticatedErrorBody };

export interface DashboardAccessInput extends EvaluateSessionInput {
  readonly pathname: string;
  readonly requestId: string;
  readonly origin: string;
  readonly headers?: SessionGateHeaders;
}

export async function decideDashboardAccess(
  input: DashboardAccessInput,
): Promise<DashboardAccessDecision> {
  if (!input.pathname.startsWith('/dashboard')) {
    return { kind: 'next' };
  }
  const allowed = await evaluateSessionCookie(input);
  if (allowed) {
    return { kind: 'next' };
  }
  if (wantsUnauthenticatedJson(input.headers ?? {})) {
    return { kind: 'unauthorized', body: unauthenticatedErrorBody(input.requestId) };
  }
  const login = new URL('/login', input.origin);
  login.searchParams.set('next', input.pathname);
  return { kind: 'redirect', location: login.toString() };
}
