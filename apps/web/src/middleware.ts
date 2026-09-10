import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from '@/i18n/routing';
import { isDashboardPath } from '@/i18n/pathname';
import { alignLoopbackRewrite, isSamePathLocation } from '@/i18n/rewrite-host';
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
  const intlResponse = applyNextIntlHostFix(request, handleI18nRouting(request));

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

/**
 * Keep next-intl's `/` → `/en` rewrite on the same loopback host the client used.
 * Next 16 otherwise turns a localhost rewrite into `Location: /` when the request is 127.0.0.1.
 */
export function applyNextIntlHostFix(request: NextRequest, response: NextResponse): NextResponse {
  const incomingHost = request.headers.get('host');
  const rewrite = response.headers.get('x-middleware-rewrite');
  if (incomingHost && rewrite) {
    const aligned = alignLoopbackRewrite(rewrite, incomingHost);
    if (aligned !== rewrite) {
      response.headers.set('x-middleware-rewrite', aligned);
    }
  }

  const location = response.headers.get('location');
  if (
    location !== null &&
    response.status >= 300 &&
    response.status < 400 &&
    isSamePathLocation(location, request.nextUrl)
  ) {
    const headers = new Headers(response.headers);
    headers.delete('location');
    return new NextResponse(response.body, { status: 200, headers });
  }

  return response;
}

export const runtime = 'nodejs';

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
