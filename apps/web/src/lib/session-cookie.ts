/** httpOnly cookie holding the API session token. Never readable from client JavaScript. */
export const SESSION_COOKIE = 'meridian_session';

/**
 * Only dashboard paths are valid post-login redirects, so a crafted `next` query cannot send the
 * browser to an external origin.
 */
export function safeDashboardPath(next: string | null | undefined): string {
  if (next === undefined || next === null || next === '') {
    return '/dashboard';
  }
  if (!next.startsWith('/dashboard')) {
    return '/dashboard';
  }
  if (next.startsWith('//') || next.includes('\\') || next.includes('://')) {
    return '/dashboard';
  }
  return next;
}
