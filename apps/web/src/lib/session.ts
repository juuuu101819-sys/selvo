import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/session-cookie';

export { SESSION_COOKIE, safeDashboardPath } from '@/lib/session-cookie';

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function writeSessionCookie(token: string, expiresAt: string): Promise<void> {
  const store = await cookies();
  store.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // Local development and Playwright both serve over HTTP. Production HTTPS should set
    // COOKIE_SECURE=true rather than inferring from NODE_ENV — Playwright's web server runs as
    // production against http://127.0.0.1.
    secure: process.env.COOKIE_SECURE === 'true',
    expires: new Date(expiresAt),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
