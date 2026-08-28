import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { PROTECTED_DASHBOARD_PATHS } from './protected-routes';
import {
  decideDashboardAccess,
  evaluateSessionCookie,
  looksLikeSessionToken,
  SESSION_UNAUTHENTICATED_CODE,
  SESSION_UNAUTHENTICATED_MESSAGE,
  unauthenticatedErrorBody,
} from './session-gate';

const DASHBOARD_APP_DIR = fileURLToPath(new URL('../app/dashboard', import.meta.url));

function collectPageRoutes(dir: string, urlPrefix: string): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const segment = entry.startsWith('[') && entry.endsWith(']') ? 'agt_example' : entry;
      routes.push(...collectPageRoutes(full, `${urlPrefix}/${segment}`));
      continue;
    }
    if (entry === 'page.tsx') {
      routes.push(urlPrefix === '' ? '/dashboard' : urlPrefix);
    }
  }
  return routes;
}

const VALID_LOOKING = `mds_${'A'.repeat(43)}`;
const TAMPERED_COOKIES = ['not-a-session', 'mk_live_not_a_session_token', 'mds_short', 'garbage-value'];

describe('looksLikeSessionToken', () => {
  it('accepts mds_ base64url tokens and rejects everything else', () => {
    expect(looksLikeSessionToken(VALID_LOOKING)).toBe(true);
    expect(looksLikeSessionToken('mds_abc-DEF_0123456789abcdefghijklmnopqrstuv')).toBe(true);
    expect(looksLikeSessionToken('')).toBe(false);
    expect(looksLikeSessionToken('mds_')).toBe(false);
    expect(looksLikeSessionToken('not-a-session')).toBe(false);
    expect(looksLikeSessionToken('mk_live_abc12399999999999999999999')).toBe(false);
  });
});

describe('PA-M13 session gate', () => {
  it('lists every dashboard page.tsx as a protected route', () => {
    const fromDisk = collectPageRoutes(DASHBOARD_APP_DIR, '/dashboard').sort();
    expect([...PROTECTED_DASHBOARD_PATHS].slice().sort()).toEqual(fromDisk);
  });

  it.each([...PROTECTED_DASHBOARD_PATHS])(
    'rejects %s with no cookie as a 401 DTO',
    async (pathname) => {
      const fetchImpl = vi.fn();
      const decision = await decideDashboardAccess({
        pathname,
        cookieValue: undefined,
        origin: 'http://127.0.0.1:43117',
        requestId: 'req_missing',
        fetchImpl,
        headers: { accept: 'application/json' },
      });
      expect(decision).toEqual({
        kind: 'unauthorized',
        body: unauthenticatedErrorBody('req_missing'),
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it.each([...PROTECTED_DASHBOARD_PATHS])(
    'rejects %s with a tampered cookie as the same 401 DTO',
    async (pathname) => {
      const fetchImpl = vi.fn();
      for (const cookieValue of TAMPERED_COOKIES) {
        const decision = await decideDashboardAccess({
          pathname,
          cookieValue,
          origin: 'http://127.0.0.1:43117',
          requestId: 'req_tampered',
          fetchImpl,
          headers: { accept: 'application/json' },
        });
        expect(decision.kind).toBe('unauthorized');
        if (decision.kind === 'unauthorized') {
          expect(decision.body.error.code).toBe(SESSION_UNAUTHENTICATED_CODE);
          expect(decision.body.error.message).toBe(SESSION_UNAUTHENTICATED_MESSAGE);
          expect(decision.body.error.details).toEqual({});
          expect(JSON.stringify(decision.body)).not.toContain(cookieValue);
          expect(JSON.stringify(decision.body).toLowerCase()).not.toMatch(
            /expired|malformed|missing|invalid token/,
          );
        }
      }
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('does not distinguish an API-rejected (expired) cookie from a missing one', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const expired = await decideDashboardAccess({
      pathname: '/dashboard',
      cookieValue: VALID_LOOKING,
      origin: 'http://127.0.0.1:43117',
      requestId: 'req_expired',
      fetchImpl,
      headers: { accept: 'application/json' },
    });
    const missing = await decideDashboardAccess({
      pathname: '/dashboard',
      cookieValue: undefined,
      origin: 'http://127.0.0.1:43117',
      requestId: 'req_expired',
      fetchImpl,
      headers: { accept: 'application/json' },
    });
    expect(expired).toEqual(missing);
    expect(JSON.stringify(expired).toLowerCase()).not.toMatch(/expired|malformed/);
  });

  it('fails closed when the API cannot be reached', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      evaluateSessionCookie({ cookieValue: VALID_LOOKING, fetchImpl }),
    ).resolves.toBe(false);
  });

  it('allows a cookie the API accepts', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const decision = await decideDashboardAccess({
      pathname: '/dashboard/quotes',
      cookieValue: VALID_LOOKING,
      origin: 'http://127.0.0.1:43117',
      requestId: 'req_ok',
      fetchImpl,
      headers: { accept: 'application/json' },
    });
    expect(decision).toEqual({ kind: 'next' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/auth\/me$/);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${VALID_LOOKING}`);
  });

  it('redirects HTML navigations to sign-in without leaking a rejection reason', async () => {
    const decision = await decideDashboardAccess({
      pathname: '/dashboard/quotes',
      cookieValue: undefined,
      origin: 'http://127.0.0.1:43117',
      requestId: 'req_html',
      headers: { accept: 'text/html', fetchMode: 'navigate' },
    });
    expect(decision.kind).toBe('redirect');
    if (decision.kind === 'redirect') {
      expect(decision.location).toContain('/login?next=%2Fdashboard%2Fquotes');
      expect(decision.location.toLowerCase()).not.toMatch(/expired|malformed|missing/);
    }
  });
});
