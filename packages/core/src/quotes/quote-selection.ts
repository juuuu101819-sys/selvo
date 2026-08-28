import { QuoteExpiredError } from '../errors/index.js';

/**
 * Rejects a route selection or execution-intent when the quoted price is no longer usable.
 *
 * Fail-closed: a missing expiry is treated as unusable. The caller must re-quote rather than
 * proceed on stale pricing — a stale quote misrepresents the cost the take-rate is computed from.
 */
export function assertSelectionQuoteFresh(input: {
  readonly nowIso: string;
  readonly quoteExpiresAt: string | null;
  readonly selectedExpiresAt?: string | null | undefined;
  readonly routeId?: string | undefined;
}): void {
  const expired =
    hasExpired(input.quoteExpiresAt, input.nowIso) ||
    (input.selectedExpiresAt !== undefined && hasExpired(input.selectedExpiresAt, input.nowIso));

  if (!expired) {
    return;
  }

  throw new QuoteExpiredError(
    'The selected route quote has expired. Request a new quote.',
    {
      requoteRequired: true,
      quoteExpiresAt: input.quoteExpiresAt,
      selectedExpiresAt: input.selectedExpiresAt ?? null,
      routeId: input.routeId ?? null,
    },
  );
}

function hasExpired(expiresAt: string | null, nowIso: string): boolean {
  if (expiresAt === null) {
    return true;
  }
  return expiresAt <= nowIso;
}
