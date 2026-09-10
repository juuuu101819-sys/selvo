import { isDashboardPath } from '@/i18n/pathname';

/** httpOnly cookie holding the API session token. Never readable from client JavaScript. */
export const SESSION_COOKIE = 'meridian_session';

export type SessionCookieSameSite = 'lax';

export interface SessionCookieSecurity {
  readonly httpOnly: true;
  readonly sameSite: SessionCookieSameSite;
  readonly secure: boolean;
}

/**
 * Session cookie flags (PA-M12).
 *
 * SameSite=Lax is the product choice: login is a same-site POST from this origin; Strict would
 * break a user following an email link into `/dashboard` after an existing session. Cross-site
 * POST cannot use this cookie (Lax).
 *
 * Secure is required when PLATFORM_MODE=production and cannot be disabled. NODE_ENV=production
 * defaults Secure on unless COOKIE_SECURE=false is set for HTTP test servers (Playwright). Request
 * headers such as X-Forwarded-Proto are never consulted.
 */
export function resolveSessionCookieSecurity(
  env: NodeJS.ProcessEnv = process.env,
): SessionCookieSecurity {
  const platformMode = env['PLATFORM_MODE'] ?? 'sandbox';
  const nodeEnv = env['NODE_ENV'] ?? 'development';
  const cookieSecureRaw = env['COOKIE_SECURE'];

  if (platformMode === 'production' && cookieSecureRaw === 'false') {
    throw new Error(
      'COOKIE_SECURE=false is not allowed when PLATFORM_MODE=production. Session cookies must set Secure.',
    );
  }

  const secure =
    platformMode === 'production' ||
    cookieSecureRaw === 'true' ||
    (nodeEnv === 'production' && cookieSecureRaw !== 'false');

  if (platformMode === 'production' && !secure) {
    throw new Error(
      'PLATFORM_MODE=production requires the session cookie Secure flag. Refusing to start with a weakened cookie.',
    );
  }

  return { httpOnly: true, sameSite: 'lax', secure };
}

/**
 * Only dashboard paths are valid post-login redirects, so a crafted `next` query cannot send the
 * browser to an external origin. Locale prefixes (`/ko/dashboard`) are kept when they are real
 * app locales; everything else collapses to `/dashboard`.
 */
export function safeDashboardPath(next: string | null | undefined): string {
  if (next === undefined || next === null || next === '') {
    return '/dashboard';
  }
  if (next.startsWith('//') || next.includes('\\') || next.includes('://')) {
    return '/dashboard';
  }
  if (!isDashboardPath(next)) {
    return '/dashboard';
  }
  return next;
}
