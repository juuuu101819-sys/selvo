import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session-cookie';

/**
 * Presence check only. Validity is decided by the API: a stale cookie still reaches /dashboard,
 * which then asks the user to sign in again rather than treating an unreadable token as anonymous.
 */
export function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.next();
  }
  if (request.cookies.get(SESSION_COOKIE)?.value) {
    return NextResponse.next();
  }
  const login = new URL('/login', request.url);
  login.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/dashboard', '/dashboard/:path*'],
};
