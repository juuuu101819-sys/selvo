import { describe, expect, it } from 'vitest';
import { resolveSessionCookieSecurity, safeDashboardPath } from './session-cookie';

describe('safeDashboardPath', () => {
  it('defaults to the overview', () => {
    expect(safeDashboardPath(undefined)).toBe('/dashboard');
    expect(safeDashboardPath('')).toBe('/dashboard');
  });

  it('allows nested dashboard routes', () => {
    expect(safeDashboardPath('/dashboard/quotes')).toBe('/dashboard/quotes');
  });

  it('rejects open redirects', () => {
    expect(safeDashboardPath('https://evil.example')).toBe('/dashboard');
    expect(safeDashboardPath('//evil.example')).toBe('/dashboard');
    expect(safeDashboardPath('/login')).toBe('/dashboard');
  });
});

describe('PA-M12 session cookie security', () => {
  it('sets Secure, HttpOnly and SameSite=Lax in PLATFORM_MODE=production', () => {
    expect(
      resolveSessionCookieSecurity({
        PLATFORM_MODE: 'production',
        NODE_ENV: 'production',
      }),
    ).toEqual({ httpOnly: true, sameSite: 'lax', secure: true });
  });

  it('fails closed when production tries to disable Secure', () => {
    expect(() =>
      resolveSessionCookieSecurity({
        PLATFORM_MODE: 'production',
        NODE_ENV: 'production',
        COOKIE_SECURE: 'false',
      }),
    ).toThrow(/COOKIE_SECURE=false is not allowed/);
  });

  it('does not omit Secure because of a spoofed X-Forwarded-Proto header', () => {
    const security = resolveSessionCookieSecurity({
      PLATFORM_MODE: 'production',
      NODE_ENV: 'production',
      HTTP_X_FORWARDED_PROTO: 'http',
      X_FORWARDED_PROTO: 'http',
    });
    expect(security.secure).toBe(true);
    expect(security.httpOnly).toBe(true);
    expect(security.sameSite).toBe('lax');
  });

  it('defaults Secure on for NODE_ENV=production unless COOKIE_SECURE=false (HTTP e2e)', () => {
    expect(resolveSessionCookieSecurity({ NODE_ENV: 'production' }).secure).toBe(true);
    expect(
      resolveSessionCookieSecurity({ NODE_ENV: 'production', COOKIE_SECURE: 'false' }).secure,
    ).toBe(false);
  });
});
