import { describe, expect, it } from 'vitest';
import { QuoteExpiredError, StaleQuoteError, ValidationError } from '../errors/index.js';
import type { ProviderQuoteEnvelope } from '../ports/provider-adapter.js';
import {
  DEFAULT_FRESHNESS_POLICY,
  assertQuoteUsable,
  assessQuoteFreshness,
  isQuoteUsable,
  type FreshnessPolicy,
} from './quote-freshness.js';

const NOW = Date.parse('2026-03-01T12:00:00.000Z');

function quote(overrides: Partial<ProviderQuoteEnvelope> = {}): ProviderQuoteEnvelope {
  return {
    providerId: 'demo-fx-provider',
    timestamp: '2026-03-01T12:00:00.000Z',
    expiresAt: '2026-03-01T12:02:00.000Z',
    quoteReference: 'ref-1',
    ...overrides,
  };
}

const policy: FreshnessPolicy = {
  maxAgeMs: 60_000,
  clockSkewToleranceMs: 5_000,
  expiryGuardMs: 1_000,
};

describe('assessQuoteFreshness', () => {
  it('accepts a quote issued now with time left on its expiry', () => {
    const freshness = assessQuoteFreshness(quote(), NOW, policy);

    expect(freshness).toEqual({ state: 'fresh', ageMs: 0, usableForMs: 119_000 });
  });

  it('accepts a quote within both the freshness bound and its expiry', () => {
    const freshness = assessQuoteFreshness(quote(), NOW + 30_000, policy);

    expect(freshness.state).toBe('fresh');
  });

  describe('expiry', () => {
    it('reports a quote past its stated expiry as expired', () => {
      const freshness = assessQuoteFreshness(quote(), NOW + 121_000, policy);

      expect(freshness).toMatchObject({ state: 'expired' });
    });

    /**
     * A price with 200ms left is not usable by the time it has been priced, ranked and rendered, so
     * counting it as live would show the customer something they cannot act on.
     *
     * Uses a short-lived quote so the guard is what decides the verdict; a quote near a distant
     * expiry would trip the freshness bound first and prove nothing about the guard.
     */
    const shortLived = quote({ expiresAt: '2026-03-01T12:00:02.000Z' });

    it('treats a quote inside the expiry guard as already expired', () => {
      // 1.5s in: 500ms of stated life left, inside the 1s guard.
      expect(assessQuoteFreshness(shortLived, NOW + 1_500, policy).state).toBe('expired');
    });

    it('still accepts a quote just outside the guard', () => {
      // 0.5s in: 1.5s of stated life left, outside the guard.
      expect(assessQuoteFreshness(shortLived, NOW + 500, policy).state).toBe('fresh');
    });

    it('reports expiry ahead of staleness, since a withdrawn price is more definitive', () => {
      // Older than the 60s freshness bound *and* past its expiry.
      const old = quote({
        timestamp: '2026-03-01T11:55:00.000Z',
        expiresAt: '2026-03-01T11:57:00.000Z',
      });

      expect(assessQuoteFreshness(old, NOW, policy).state).toBe('expired');
    });
  });

  describe('staleness', () => {
    /**
     * A provider stamping a ten-minute TTL on an FX price is making a statement about its own risk
     * appetite, not about how long the market stays still.
     */
    it('rejects a quote older than the freshness bound even with a long provider TTL', () => {
      const longLived = quote({
        timestamp: '2026-03-01T11:58:00.000Z',
        expiresAt: '2026-03-01T12:10:00.000Z',
      });

      expect(assessQuoteFreshness(longLived, NOW, policy)).toEqual({
        state: 'stale',
        ageMs: 120_000,
        maxAgeMs: 60_000,
      });
    });

    it('accepts a quote exactly at the freshness bound', () => {
      const atBound = quote({
        timestamp: '2026-03-01T11:59:00.000Z',
        expiresAt: '2026-03-01T12:10:00.000Z',
      });

      expect(assessQuoteFreshness(atBound, NOW, policy).state).toBe('fresh');
    });
  });

  describe('clock skew', () => {
    it('tolerates a provider clock slightly ahead of ours', () => {
      const skewed = quote({ timestamp: '2026-03-01T12:00:03.000Z' });

      expect(assessQuoteFreshness(skewed, NOW, policy).state).toBe('fresh');
    });

    it('rejects a timestamp implausibly far in the future', () => {
      const skewed = quote({
        timestamp: '2026-03-01T12:05:00.000Z',
        expiresAt: '2026-03-01T12:07:00.000Z',
      });

      expect(assessQuoteFreshness(skewed, NOW, policy)).toEqual({
        state: 'clock_skewed',
        skewMs: 300_000,
      });
    });

    it('checks skew before anything else, since untrustworthy timestamps make age meaningless', () => {
      const skewedAndExpired = quote({
        timestamp: '2026-03-01T12:05:00.000Z',
        expiresAt: '2026-03-01T11:00:00.000Z',
      });

      expect(assessQuoteFreshness(skewedAndExpired, NOW, policy).state).toBe('clock_skewed');
    });
  });

  it('rejects an unparseable timestamp rather than guessing', () => {
    expect(() => assessQuoteFreshness(quote({ timestamp: 'yesterday' }), NOW, policy)).toThrow(
      ValidationError,
    );
    expect(() => assessQuoteFreshness(quote({ expiresAt: 'soon' }), NOW, policy)).toThrow(
      ValidationError,
    );
  });

  it('defaults to a two-minute freshness bound', () => {
    expect(DEFAULT_FRESHNESS_POLICY.maxAgeMs).toBe(120_000);
    expect(DEFAULT_FRESHNESS_POLICY.expiryGuardMs).toBeGreaterThan(0);
  });
});

describe('isQuoteUsable', () => {
  it('is true only for a fresh quote', () => {
    expect(isQuoteUsable(quote(), NOW, policy)).toBe(true);
    expect(isQuoteUsable(quote(), NOW + 200_000, policy)).toBe(false);
  });
});

describe('assertQuoteUsable', () => {
  it('passes a fresh quote', () => {
    expect(() => assertQuoteUsable(quote(), NOW, policy)).not.toThrow();
  });

  /**
   * Expiry and staleness raise different errors because they call for different responses: an
   * expired price means ask again, whereas a persistently stale one means the feed is lagging and
   * re-asking will return the same thing.
   */
  it('raises QuoteExpiredError past the expiry', () => {
    expect(() => assertQuoteUsable(quote(), NOW + 200_000, policy)).toThrow(QuoteExpiredError);
  });

  it('raises StaleQuoteError beyond the freshness bound', () => {
    const longLived = quote({
      timestamp: '2026-03-01T11:58:00.000Z',
      expiresAt: '2026-03-01T12:10:00.000Z',
    });

    expect(() => assertQuoteUsable(longLived, NOW, policy)).toThrow(StaleQuoteError);
  });

  it('raises StaleQuoteError on implausible clock skew', () => {
    const skewed = quote({
      timestamp: '2026-03-01T12:05:00.000Z',
      expiresAt: '2026-03-01T12:07:00.000Z',
    });

    expect(() => assertQuoteUsable(skewed, NOW, policy)).toThrow(StaleQuoteError);
  });

  it('names the provider and the timings in the error, so the cause is diagnosable', () => {
    try {
      assertQuoteUsable(quote(), NOW + 200_000, policy);
      expect.unreachable('expected the quote to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(QuoteExpiredError);
      expect((error as QuoteExpiredError).details).toMatchObject({
        providerId: 'demo-fx-provider',
        expiresAt: '2026-03-01T12:02:00.000Z',
      });
    }
  });
});
