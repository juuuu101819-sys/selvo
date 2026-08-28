import { NextResponse, type NextRequest } from 'next/server';
import { decideDashboardAccess } from '@/lib/session-gate';
import { SESSION_COOKIE } from '@/lib/session-cookie';

/**
 * Single session gate for every `/dashboard` route (PA-M13).
 *
 * Presence, format, expiry, and API validity are decided here. Handlers must not re-implement a
 * weaker cookie check. Invalid cookies produce either a login redirect (document navigation) or
 * a PA-M03 401 (programmatic JSON) — never a reason that distinguishes missing vs expired.
 */
export async function middleware(request: NextRequest) {
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
    return NextResponse.next();
  }
  if (decision.kind === 'redirect') {
    return NextResponse.redirect(decision.location);
  }
  return NextResponse.json(decision.body, { status: 401 });
}

export const runtime = 'nodejs';

export const config = {
  matcher: ['/dashboard', '/dashboard/:path*'],
};
