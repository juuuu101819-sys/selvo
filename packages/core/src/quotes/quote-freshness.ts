import { QuoteExpiredError, StaleQuoteError, ValidationError } from '../errors/index.js';
import { Dec } from '../money/decimal.js';
import type { ProviderQuoteEnvelope } from '../ports/provider-adapter.js';

export interface FreshnessPolicy {
  /**
   * How old a quote may be before the platform stops trusting it, regardless of the provider's own
   * expiry.
   *
   * Distinct from expiry on purpose: a provider that stamps a ten-minute TTL on an FX price is
   * making a commercial statement about its own risk appetite, not a statement about how long the
   * market stays still. Holding a separate, usually shorter, freshness bound is what stops a
   * comparison being built from prices the market has already moved past.
   */
  readonly maxAgeMs: number;
  /**
   * Tolerance for a provider clock running ahead of ours.
   *
   * Small skew between two systems is normal and is not a reason to reject a price. Beyond this,
   * a future timestamp means something is genuinely wrong and the quote is not trusted.
   */
  readonly clockSkewToleranceMs: number;
  /**
   * Treat a quote as expired this long before its stated expiry.
   *
   * A price that expires in 200ms is not usable by the time it has been ranked and rendered, so
   * counting it as live would show the customer something they cannot act on.
   */
  readonly expiryGuardMs: number;
}

export const DEFAULT_FRESHNESS_POLICY: FreshnessPolicy = {
  maxAgeMs: 120_000,
  clockSkewToleranceMs: 5_000,
  expiryGuardMs: 1_000,
};

export type QuoteFreshness =
  | {
      readonly state: 'fresh';
      readonly ageMs: number;
      /** Milliseconds until the stated expiry, less the guard. */
      readonly usableForMs: number;
    }
  | {
      readonly state: 'stale';
      readonly ageMs: number;
      readonly maxAgeMs: number;
    }
  | {
      readonly state: 'expired';
      readonly ageMs: number;
      /** How long ago it expired, counting the guard. */
      readonly expiredForMs: number;
    }
  | {
      readonly state: 'clock_skewed';
      /** How far ahead of us the provider's clock appears to be. */
      readonly skewMs: number;
    };

/**
 * Classifies a quote's usability at a given instant.
 *
 * Returns a verdict rather than throwing, so a caller that wants to degrade — dropping one stale
 * route from a comparison instead of failing the whole request — can do that, while a caller that
 * needs a usable price can call {@link assertQuoteUsable}.
 *
 * The checks are ordered by severity: clock skew first, because if the timestamps cannot be trusted
 * then neither age nor expiry means anything; then expiry, because a provider withdrawing its price
 * is more definitive than our own freshness preference.
 */
export function assessQuoteFreshness(
  quote: Pick<ProviderQuoteEnvelope, 'timestamp' | 'expiresAt'>,
  nowMs: number,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): QuoteFreshness {
  const quotedAtMs = parseInstant(quote.timestamp, 'timestamp');
  const expiresAtMs = parseInstant(quote.expiresAt, 'expiresAt');

  const ageMs = nowMs - quotedAtMs;
  if (ageMs < -policy.clockSkewToleranceMs) {
    return { state: 'clock_skewed', skewMs: -ageMs };
  }

  const expiredForMs = nowMs - (expiresAtMs - policy.expiryGuardMs);
  if (expiredForMs >= 0) {
    return { state: 'expired', ageMs, expiredForMs };
  }

  if (ageMs > policy.maxAgeMs) {
    return { state: 'stale', ageMs, maxAgeMs: policy.maxAgeMs };
  }

  return { state: 'fresh', ageMs: Math.max(ageMs, 0), usableForMs: -expiredForMs };
}

/**
 * Client-visible freshness of one quote at a given instant.
 *
 * `ageSeconds` is a decimal string so clients never see a binary float for a figure they will
 * compare across rails.
 */
export interface QuoteFreshnessView {
  readonly quotedAt: string;
  readonly expiresAt: string;
  readonly ageMs: number;
  readonly ageSeconds: string;
  readonly maxAgeMs: number;
  readonly state: QuoteFreshness['state'];
  readonly usableForMs: number | null;
}

export function quoteFreshnessView(
  quote: Pick<ProviderQuoteEnvelope, 'timestamp' | 'expiresAt'>,
  nowMs: number,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): QuoteFreshnessView {
  const freshness = assessQuoteFreshness(quote, nowMs, policy);
  const quotedAtMs = parseInstant(quote.timestamp, 'timestamp');
  const ageMs =
    freshness.state === 'clock_skewed' ? nowMs - quotedAtMs : Math.max(freshness.ageMs, 0);
  const maxAgeMs = freshness.state === 'stale' ? freshness.maxAgeMs : policy.maxAgeMs;
  const usableForMs = freshness.state === 'fresh' ? freshness.usableForMs : null;
  return {
    quotedAt: quote.timestamp,
    expiresAt: quote.expiresAt,
    ageMs,
    ageSeconds: new Dec(ageMs).div(1_000).toFixed(),
    maxAgeMs,
    state: freshness.state,
    usableForMs,
  };
}

export function isQuoteUsable(
  quote: Pick<ProviderQuoteEnvelope, 'timestamp' | 'expiresAt'>,
  nowMs: number,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): boolean {
  return assessQuoteFreshness(quote, nowMs, policy).state === 'fresh';
}

/**
 * Throws unless the quote is usable now.
 *
 * Expiry and staleness raise different errors because they call for different responses: an expired
 * price means ask the provider again, whereas a persistently stale one means the integration or the
 * feed is lagging and re-asking will not help.
 */
export function assertQuoteUsable(
  quote: ProviderQuoteEnvelope,
  nowMs: number,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): void {
  const freshness = assessQuoteFreshness(quote, nowMs, policy);

  switch (freshness.state) {
    case 'fresh':
      return;
    case 'expired':
      throw new QuoteExpiredError(
        `Quote from "${quote.providerId}" expired ${freshness.expiredForMs}ms ago.`,
        {
          providerId: quote.providerId,
          timestamp: quote.timestamp,
          expiresAt: quote.expiresAt,
          expiredForMs: freshness.expiredForMs,
        },
      );
    case 'stale':
      throw new StaleQuoteError(
        `Quote from "${quote.providerId}" is ${freshness.ageMs}ms old, beyond the ` +
          `${freshness.maxAgeMs}ms freshness limit.`,
        {
          providerId: quote.providerId,
          timestamp: quote.timestamp,
          ageMs: freshness.ageMs,
          maxAgeMs: freshness.maxAgeMs,
        },
      );
    case 'clock_skewed':
      throw new StaleQuoteError(
        `Quote from "${quote.providerId}" is timestamped ${freshness.skewMs}ms in the future, ` +
          'beyond the tolerated clock skew.',
        {
          providerId: quote.providerId,
          timestamp: quote.timestamp,
          skewMs: freshness.skewMs,
        },
      );
  }
}

function parseInstant(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new ValidationError(`Quote ${field} is not a valid instant: "${value}".`, {
      field,
      value,
    });
  }
  return parsed;
}
