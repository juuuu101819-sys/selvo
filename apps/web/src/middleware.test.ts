import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';
import { PROTECTED_DASHBOARD_PATHS } from './lib/protected-routes';
import { SESSION_COOKIE } from './lib/session-cookie';
import { SESSION_UNAUTHENTICATED_CODE, SESSION_UNAUTHENTICATED_MESSAGE } from './lib/session-gate';

const VALID_LOOKING = `mds_${'B'.repeat(43)}`;

function jsonRequest(path: string, cookie?: string): NextRequest {
  const headers = new Headers({ accept: 'application/json' });
  if (cookie !== undefined) {
    headers.set('cookie', `${SESSION_COOKIE}=${cookie}`);
  }
  return new NextRequest(`http://127.0.0.1:43117${path}`, { headers });
}

describe('dashboard middleware (PA-M13)', () => {
  it.each([...PROTECTED_DASHBOARD_PATHS])(
    'returns 401 JSON for %s with no cookie',
    async (path) => {
      const response = await middleware(jsonRequest(path));
      expect(response.status).toBe(401);
      const body = (await response.json()) as {
        error: { code: string; message: string; details: Record<string, unknown> };
      };
      expect(body.error.code).toBe(SESSION_UNAUTHENTICATED_CODE);
      expect(body.error.message).toBe(SESSION_UNAUTHENTICATED_MESSAGE);
      expect(body.error.details).toEqual({});
    },
  );

  it.each([...PROTECTED_DASHBOARD_PATHS])(
    'returns 401 JSON for %s with a tampered cookie',
    async (path) => {
      const tampered = 'not-a-session';
      const response = await middleware(jsonRequest(path, tampered));
      expect(response.status).toBe(401);
      const text = await response.text();
      expect(text).not.toContain(tampered);
      expect(text.toLowerCase()).not.toMatch(/expired|malformed|missing/);
      expect(JSON.parse(text).error.message).toBe(SESSION_UNAUTHENTICATED_MESSAGE);
    },
  );

  it('lets a verified session through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
    try {
      const response = await middleware(jsonRequest('/dashboard', VALID_LOOKING));
      expect(response.status).toBe(200);
      expect(response.headers.get('x-middleware-next') ?? response.headers.get('x-nextjs-rewrite')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
