/**
 * Transport security for the public web origin.
 *
 * TLS terminates at the reverse proxy (see docs/DEPLOYMENT.md). This process never reads
 * X-Forwarded-Proto — that header is spoofable and must not decide cookie Secure or redirects.
 *
 * HSTS is attached when the deploy is production-shaped. Playwright's HTTP server sets
 * NODE_ENV=production with COOKIE_SECURE=false and PLATFORM_MODE unset, so it stays plaintext.
 */
export const HSTS_HEADER_VALUE = 'max-age=31536000; includeSubDomains';

export function shouldAttachHsts(env: NodeJS.ProcessEnv = process.env): boolean {
  const platformMode = env['PLATFORM_MODE'] ?? 'sandbox';
  const nodeEnv = env['NODE_ENV'] ?? 'development';
  const cookieSecureRaw = env['COOKIE_SECURE'];

  if (platformMode === 'production') {
    return true;
  }
  return nodeEnv === 'production' && cookieSecureRaw !== 'false';
}
