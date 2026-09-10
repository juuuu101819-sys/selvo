import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from '@/i18n/routing';
import { isDashboardPath } from '@/i18n/pathname';
import { decideDashboardAccess } from '@/lib/session-gate';
import { SESSION_COOKIE } from '@/lib/session-cookie';

const handleI18nRouting = createIntlMiddleware(routing);

/**
 * Locale negotiation first, then the dashboard session gate (PA-M13).
 *
 * Invalid dashboard cookies still produce either a locale-preserving login redirect or a PA-M03
 * 401 — never a reason that distinguishes missing vs expired.
 */
export async function middleware(request: NextRequest) {
  const intlResponse = handleI18nRouting(request);
  const location = intlResponse.headers.get('location');
  if (location !== null && intlResponse.status >= 300 && intlResponse.status < 400) {
    return intlResponse;
  }

  if (!isDashboardPath(request.nextUrl.pathname)) {
    return intlResponse;
  }

  const decision = await decideDashboardAccess({
    pathname: request.nextUrl.pathname,
    cookieValue: request.cookies.get(SESSION_COOKIE)?.value,
    origin: request.nextUrl.origin,
    requestId: crypto.randomUUID(),
    apiBaseUrl: process.env.API_BASE_URL,
    headers: {
      accept: request.headers.get('accept'),
      rsc: request.headers.get('rsc'),
      fetchMode: request.headers.get('sec-fetch-mode'),
    },
  });

  if (decision.kind === 'next') {
    return intlResponse;
  }
  if (decision.kind === 'redirect') {
    return NextResponse.redirect(decision.location);
  }
  return NextResponse.json(decision.body, { status: 401 });
}

export const runtime = 'nodejs';

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
