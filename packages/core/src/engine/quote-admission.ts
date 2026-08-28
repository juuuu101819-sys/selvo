import type { RailType } from '../domain/rail.js';
import { ValidationError } from '../errors/index.js';
import type { NormalizedQuote } from '../ports/financial-provider.js';
import { freshnessPolicyForRail } from '../quotes/rail-freshness.js';
import {
  assertQuoteUsable,
  quoteFreshnessView,
  type QuoteFreshnessView,
} from '../quotes/quote-freshness.js';

/**
 * Admits a normalised quote into ranking, or throws.
 *
 * Every rail must present `timestamp` and `expiresAt`. A quote past `expiresAt` or older than the
 * rail's configured max-age is excluded by the caller (turned into a per-provider failure), never
 * ranked as if it were still live.
 */
export function admitNormalizedQuote(
  quote: NormalizedQuote,
  rail: RailType,
  nowMs: number,
): QuoteFreshnessView {
  if (typeof quote.timestamp !== 'string' || quote.timestamp.trim() === '') {
    throw new ValidationError('Quote timestamp is required.', {
      providerId: quote.providerId,
      field: 'timestamp',
    });
  }
  if (typeof quote.expiresAt !== 'string' || quote.expiresAt.trim() === '') {
    throw new ValidationError('Quote expiresAt is required.', {
      providerId: quote.providerId,
      field: 'expiresAt',
    });
  }

  const policy = freshnessPolicyForRail(rail);
  assertQuoteUsable(quote, nowMs, policy);
  return quoteFreshnessView(quote, nowMs, policy);
}
