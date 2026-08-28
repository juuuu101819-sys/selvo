import { cookies } from 'next/headers';
import { SESSION_COOKIE, resolveSessionCookieSecurity } from '@/lib/session-cookie';

export { SESSION_COOKIE, safeDashboardPath } from '@/lib/session-cookie';

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function writeSessionCookie(token: string, expiresAt: string): Promise<void> {
  const store = await cookies();
  const security = resolveSessionCookieSecurity();
  store.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: security.httpOnly,
    sameSite: security.sameSite,
    path: '/',
    secure: security.secure,
    expires: new Date(expiresAt),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
