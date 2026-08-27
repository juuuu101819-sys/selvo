/**
 * Quote expiration, as the UI reasons about it.
 *
 * Pure functions over `(expiresAt, nowMs)` rather than logic buried in a component, so the states a
 * customer can see — live, expiring, expired — are unit-testable without rendering anything, and the
 * component layer is reduced to a clock tick plus markup.
 */

export type QuoteExpiryState =
  | { readonly state: 'live'; readonly remainingMs: number }
  | { readonly state: 'expiring'; readonly remainingMs: number }
  | { readonly state: 'expired'; readonly expiredForMs: number }
  | { readonly state: 'no_expiry' };

/**
 * Below this remaining lifetime a quote is presented as "expiring", so the customer is warned
 * before the price disappears rather than at the moment it does.
 *
 * Twenty seconds, not sixty: the shortest-lived sandbox rail quotes with a 60-second TTL, and a
 * threshold equal to a rail's whole lifetime would mean its quotes are born in the warning state —
 * a warning that is always on is a warning nobody reads.
 */
export const EXPIRING_THRESHOLD_MS = 20_000;

export function classifyQuoteExpiry(expiresAt: string | null, nowMs: number): QuoteExpiryState {
  if (expiresAt === null) {
    return { state: 'no_expiry' };
  }

  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) {
    // An unreadable expiry is treated as expired: the safe direction for a price is to stop
    // trusting it, never to show it as live for an unknown amount of time.
    return { state: 'expired', expiredForMs: 0 };
  }

  const remainingMs = expiresMs - nowMs;
  if (remainingMs <= 0) {
    return { state: 'expired', expiredForMs: -remainingMs };
  }
  if (remainingMs <= EXPIRING_THRESHOLD_MS) {
    return { state: 'expiring', remainingMs };
  }
  return { state: 'live', remainingMs };
}

/**
 * The soonest expiry across a comparison's routes.
 *
 * The comparison as a whole is only as fresh as its shortest-lived quote: once one route's price is
 * gone, the ranking the customer is looking at was computed against a price nobody can get.
 */
export function earliestExpiry(expiries: readonly (string | null)[]): string | null {
  let earliest: number | null = null;
  for (const expiresAt of expiries) {
    if (expiresAt === null) {
      continue;
    }
    const ms = Date.parse(expiresAt);
    if (Number.isNaN(ms)) {
      continue;
    }
    if (earliest === null || ms < earliest) {
      earliest = ms;
    }
  }
  return earliest === null ? null : new Date(earliest).toISOString();
}

/** Renders remaining time the way a countdown reads: `4:07`, `0:32`, or `1h 12m` for long TTLs. */
export function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
