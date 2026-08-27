import {
  Dec,
  FixedClock,
  InvalidAmountError,
  ProviderError,
  ProviderTimeoutError,
  QuoteExpiredError,
  StaleQuoteError,
  UnsupportedCorridorError,
  UnsupportedCurrencyError,
  ValidationError,
  assessQuoteFreshness,
  noopLogger,
  type CurrencyCode,
  type FXQuoteRequest,
  type MarketDataProvider,
  type MarketRate,
  type MarketRateRequest,
  type ProviderContext,
  type ProviderDescriptor,
} from '@meridian/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryQuoteRecorder } from '../recording/in-memory-quote-recorder.js';
import { withResilientFX } from '../resilience/decorators.js';
import type { ResiliencePolicy } from '../resilience/policy.js';
import { createSandboxAdapters } from '../sandbox/index.js';
import { DemoFXProvider } from './demo-fx-provider.js';
import { DemoMarketDataProvider } from './demo-market-data-provider.js';

const QUOTED_AT = '2026-03-01T12:00:00.000Z';

let clock: FixedClock;
let context: ProviderContext;
let recorder: InMemoryQuoteRecorder;

beforeEach(() => {
  clock = new FixedClock(QUOTED_AT);
  recorder = new InMemoryQuoteRecorder();
  context = { clock, logger: noopLogger, requestId: 'req-1', signal: undefined };
});

function marketData(): DemoMarketDataProvider {
  return new DemoMarketDataProvider({ rates: createSandboxAdapters().rates });
}

function provider(overrides: Partial<Parameters<typeof DemoFXProvider>[0]> = {}): DemoFXProvider {
  return new DemoFXProvider({ marketData: marketData(), ...overrides });
}

function request(
  base: CurrencyCode,
  quoteCurrency: CurrencyCode,
  amountMinorUnits: string,
): FXQuoteRequest {
  return { baseCurrency: base, quoteCurrency, amountMinorUnits };
}

/** The three corridors the brief calls out, with a realistic notional for each. */
const CORRIDORS = [
  { base: 'USD', quote: 'KRW', amount: '10000000', label: 'USD 100,000 to KRW' },
  { base: 'USD', quote: 'EUR', amount: '10000000', label: 'USD 100,000 to EUR' },
  { base: 'EUR', quote: 'JPY', amount: '5000000', label: 'EUR 50,000 to JPY' },
] as const;

describe('DemoFXProvider', () => {
  describe('a valid quote', () => {
    it.each(CORRIDORS)('prices $label', async ({ base, quote, amount }) => {
      const fx = provider();
      const result = await fx.getFXQuote(request(base, quote, amount), context);

      expect(result).toMatchObject({
        providerId: 'demo-fx-provider',
        baseCurrency: base,
        quoteCurrency: quote,
        amountMinorUnits: amount,
        timestamp: QUOTED_AT,
      });

      // Rule 11 and 12: attributable and timestamped, with a stated expiry.
      expect(result.expiresAt).toBe('2026-03-01T12:02:00.000Z');
      expect(result.quoteReference).toMatch(/^demofx-[0-9a-f]{12}$/);

      // The offered rate is the mid less the configured spread, so it must be strictly worse.
      const mid = new Dec(result.midMarketRate ?? '0');
      const offered = new Dec(result.rate);
      expect(offered.lessThan(mid)).toBe(true);
      expect(offered.greaterThan(0)).toBe(true);
    });

    it.each(CORRIDORS)(
      'applies exactly the configured spread on $label',
      async ({ base, quote, amount }) => {
        const fx = provider({ spreadBps: '50' });
        const result = await fx.getFXQuote(request(base, quote, amount), context);

        const mid = new Dec(result.midMarketRate ?? '0');
        const expected = mid.times(new Dec(1).minus(new Dec('50').div(10_000)));
        expect(new Dec(result.rate).toFixed(18)).toBe(expected.toFixed(18));
      },
    );

    it('reports the benchmark it priced against, so the spread is visible not inferred', async () => {
      const result = await provider().getFXQuote(request('USD', 'KRW', '10000000'), context);

      expect(result.midMarketRate).not.toBeNull();
      expect(result.metadata['marketDataProviderId']).toBe('demo-market-data');
      expect(result.metadata['marketDataSource']).toContain('sandbox-reference');
    });

    it('itemises its charges rather than folding them into the rate', async () => {
      const result = await provider().getFXQuote(request('USD', 'KRW', '10000000'), context);

      expect(result.providerFee).toMatchObject({
        code: 'fx_transfer_fee',
        side: 'source',
        currency: 'USD',
        amountMinorUnits: '800',
      });
      expect(result.additionalFees[0]).toMatchObject({
        code: 'fx_commission',
        rateBps: '12',
        // 12 bps of USD 100,000 is USD 120.00.
        amountMinorUnits: '12000',
      });
    });

    it('charges a fixed fee in the base currency at its own exponent', async () => {
      // The yen has no minor unit, so a flat fee of 8 is 8 yen, not 800.
      const result = await provider({ flatFeeBase: '8' }).getFXQuote(
        request('JPY', 'USD', '5000000'),
        context,
      );

      expect(result.providerFee).toMatchObject({ currency: 'JPY', amountMinorUnits: '8' });
    });

    it('returns no fee when the provider prices entirely in the spread', async () => {
      const result = await provider({ flatFeeBase: '0', commissionBps: '0' }).getFXQuote(
        request('USD', 'EUR', '10000000'),
        context,
      );

      expect(result.providerFee).toBeNull();
      expect(result.additionalFees).toEqual([]);
    });

    it('states no total cost, ranking or recommendation', async () => {
      const result = await provider().getFXQuote(request('USD', 'KRW', '10000000'), context);

      // Those are the routing engine's to derive from these primitives.
      expect(result).not.toHaveProperty('totalCost');
      expect(result).not.toHaveProperty('score');
      expect(result).not.toHaveProperty('rank');
      expect(result).not.toHaveProperty('recommended');
    });

    it('is deterministic: identical inputs give an identical reference and rate', async () => {
      const fx = provider();
      const first = await fx.getFXQuote(request('USD', 'KRW', '10000000'), context);
      const second = await fx.getFXQuote(request('USD', 'KRW', '10000000'), context);

      expect(second.quoteReference).toBe(first.quoteReference);
      expect(second.rate).toBe(first.rate);
    });

    it('issues a different reference for a different notional', async () => {
      const fx = provider();
      const first = await fx.getFXQuote(request('USD', 'KRW', '10000000'), context);
      const second = await fx.getFXQuote(request('USD', 'KRW', '20000000'), context);

      expect(second.quoteReference).not.toBe(first.quoteReference);
    });
  });

  describe('an expired quote', () => {
    it.each(CORRIDORS)(
      'is detected once its TTL has passed on $label',
      async ({ base, quote, amount }) => {
        const fx = provider({ quoteTtlSeconds: 60 });
        const result = await fx.getFXQuote(request(base, quote, amount), context);

        const atIssue = clock.nowMs();
        expect(assessQuoteFreshness(result, atIssue).state).toBe('fresh');
        expect(assessQuoteFreshness(result, atIssue + 61_000).state).toBe('expired');
      },
    );

    it('is rejected by the resilience wrapper rather than returned', async () => {
      // A clock that jumps past the TTL between issuing and checking.
      const jumping = new FixedClock(QUOTED_AT);
      const fx = withResilientFX(provider({ quoteTtlSeconds: 1 }), {
        clock: {
          nowIso: () => jumping.nowIso(),
          nowMs: () => {
            const now = jumping.nowMs();
            jumping.advance(5_000);
            return now;
          },
        },
        logger: noopLogger,
        recorder,
        sleep: () => Promise.resolve(),
        random: () => 0.5,
      });

      await expect(fx.getFXQuote(request('USD', 'KRW', '10000000'), context)).rejects.toThrow(
        QuoteExpiredError,
      );
    });

    it('still records a quote that arrived but was unusable', async () => {
      const jumping = new FixedClock(QUOTED_AT);
      const fx = withResilientFX(provider({ quoteTtlSeconds: 1 }), {
        clock: {
          nowIso: () => jumping.nowIso(),
          nowMs: () => {
            const now = jumping.nowMs();
            jumping.advance(5_000);
            return now;
          },
        },
        logger: noopLogger,
        recorder,
        sleep: () => Promise.resolve(),
      });

      await expect(fx.getFXQuote(request('USD', 'KRW', '10000000'), context)).rejects.toThrow();

      const records = await recorder.list();
      expect(records).toHaveLength(1);
      expect(records[0]?.outcome).toBe('quoted');
    });

    it('is treated as stale when older than the freshness bound despite a long TTL', async () => {
      const fx = withResilientFX(
        provider({ quoteTtlSeconds: 3_600 }),
        {
          clock: {
            nowIso: () => clock.nowIso(),
            // Reports a time well after the quote was issued, but inside its hour-long TTL.
            nowMs: () => clock.nowMs() + 600_000,
          },
          logger: noopLogger,
          recorder,
        },
        { freshness: { maxAgeMs: 120_000, clockSkewToleranceMs: 5_000, expiryGuardMs: 1_000 } },
      );

      await expect(fx.getFXQuote(request('USD', 'KRW', '10000000'), context)).rejects.toThrow(
        StaleQuoteError,
      );
    });
  });

  describe('an invalid currency', () => {
    it('rejects a code outside the registry', async () => {
      const fx = provider();

      await expect(
        fx.getFXQuote(request('XXX' as CurrencyCode, 'KRW', '10000000'), context),
      ).rejects.toThrow(UnsupportedCurrencyError);
      await expect(
        fx.getFXQuote(request('USD', 'ZZZ' as CurrencyCode, '10000000'), context),
      ).rejects.toThrow(UnsupportedCurrencyError);
    });

    it('rejects a same-currency pair, which is not a conversion', async () => {
      await expect(
        provider().getFXQuote(request('USD', 'USD', '10000000'), context),
      ).rejects.toThrow(ValidationError);
    });

    it('reports an unsupported corridor separately from an unknown currency', async () => {
      // CLP is a real currency the reference dataset covers, but this provider's limits exclude the
      // notional, which is a different problem with a different remedy.
      await expect(
        provider({ minAmount: '1000000' }).getFXQuote(request('USD', 'CLP', '100'), context),
      ).rejects.toThrow(UnsupportedCorridorError);
    });

    it('declines rather than throwing when asked whether it supports a bad pair', () => {
      const fx = provider();

      expect(fx.supports(request('XXX' as CurrencyCode, 'KRW', '10000000'))).toBe(false);
      expect(fx.supports(request('USD', 'USD', '10000000'))).toBe(false);
      expect(fx.supports(request('USD', 'KRW', '10000000'))).toBe(true);
    });

    it('rejects a malformed amount', async () => {
      const fx = provider();

      await expect(fx.getFXQuote(request('USD', 'KRW', '-100'), context)).rejects.toThrow(
        InvalidAmountError,
      );
      await expect(fx.getFXQuote(request('USD', 'KRW', '1.5'), context)).rejects.toThrow(
        InvalidAmountError,
      );
    });

    it('rejects a notional outside the provider limits', async () => {
      const fx = provider({ minAmount: '1000', maxAmount: '50000' });

      await expect(fx.getFXQuote(request('USD', 'KRW', '100'), context)).rejects.toThrow(
        UnsupportedCorridorError,
      );
      await expect(fx.getFXQuote(request('USD', 'KRW', '900000000'), context)).rejects.toThrow(
        UnsupportedCorridorError,
      );
    });
  });

  describe('provider failure', () => {
    it('propagates a market data failure rather than inventing a rate', async () => {
      const broken = failingMarketData(new ProviderError('demo-market-data', 'feed unavailable'));

      await expect(
        provider({ marketData: broken }).getFXQuote(request('USD', 'KRW', '10000000'), context),
      ).rejects.toThrow(ProviderError);
    });

    /**
     * Substituting the offered rate for a missing benchmark would report every route as costing
     * nothing, which is the most dangerous wrong answer this system could give.
     */
    it('fails rather than fall back when the benchmark is unusable', async () => {
      const zeroed = stubMarketData({ rate: '0' });

      await expect(
        provider({ marketData: zeroed }).getFXQuote(request('USD', 'KRW', '10000000'), context),
      ).rejects.toThrow(ProviderError);
    });

    it.each(CORRIDORS)(
      'retries a transient failure and recovers on $label',
      async ({ base, quote, amount }) => {
        let attempts = 0;
        const flaky = failingMarketData(new ProviderError('demo-market-data', 'transient'), () => {
          attempts += 1;
          return attempts < 2;
        });

        const fx = withResilientFX(provider({ marketData: flaky }), {
          clock,
          logger: noopLogger,
          recorder,
          sleep: () => Promise.resolve(),
          random: () => 0.5,
        });

        const result = await fx.getFXQuote(request(base, quote, amount), context);
        expect(result.baseCurrency).toBe(base);
        expect(attempts).toBe(2);
      },
    );

    it('gives up after the configured attempts and records each one', async () => {
      const broken = failingMarketData(new ProviderError('demo-market-data', 'down'));
      const fx = withResilientFX(
        provider({ marketData: broken }),
        { clock, logger: noopLogger, recorder, sleep: () => Promise.resolve(), random: () => 0.5 },
        { policy: shortPolicy },
      );

      await expect(fx.getFXQuote(request('USD', 'KRW', '10000000'), context)).rejects.toThrow(
        ProviderError,
      );

      const records = await recorder.list();
      expect(records).toHaveLength(shortPolicy.retry.maxAttempts);
      expect(records.every((record) => record.outcome === 'failed')).toBe(true);
    });

    it('does not retry an invalid currency, which would return the same answer', async () => {
      let calls = 0;
      const counting = stubMarketData({ rate: '1385.42' }, () => {
        calls += 1;
      });
      const fx = withResilientFX(
        provider({ marketData: counting }),
        { clock, logger: noopLogger, recorder, sleep: () => Promise.resolve() },
        { policy: shortPolicy },
      );

      await expect(
        fx.getFXQuote(request('XXX' as CurrencyCode, 'KRW', '10000000'), context),
      ).rejects.toThrow(UnsupportedCurrencyError);
      expect(calls).toBe(0);
    });
  });

  describe('timeout', () => {
    it.each(CORRIDORS)(
      'times out a hanging market data feed on $label',
      async ({ base, quote, amount }) => {
        const hanging = hangingMarketData();
        const fx = withResilientFX(
          provider({ marketData: hanging }),
          {
            clock,
            logger: noopLogger,
            recorder,
            sleep: () => Promise.resolve(),
            random: () => 0.5,
          },
          {
            policy: {
              timeoutMs: 20,
              retry: { ...shortPolicy.retry, maxAttempts: 1 },
              overallTimeoutMs: 200,
            },
          },
        );

        await expect(fx.getFXQuote(request(base, quote, amount), context)).rejects.toThrow(
          ProviderTimeoutError,
        );
      },
    );

    it('records the timeout against the provider', async () => {
      const fx = withResilientFX(
        provider({ marketData: hangingMarketData() }),
        { clock, logger: noopLogger, recorder, sleep: () => Promise.resolve() },
        {
          policy: {
            timeoutMs: 20,
            retry: { ...shortPolicy.retry, maxAttempts: 1 },
            overallTimeoutMs: 200,
          },
        },
      );

      await expect(fx.getFXQuote(request('USD', 'KRW', '10000000'), context)).rejects.toThrow();

      const records = await recorder.list();
      expect(records[0]).toMatchObject({
        providerId: 'demo-fx-provider',
        operation: 'getFXQuote',
        outcome: 'failed',
      });
      expect(records[0]?.error?.code).toBe('PROVIDER_TIMEOUT');
    });

    it('aborts the attempt so the adapter can stop work', async () => {
      let aborted = false;
      const observing = hangingMarketData((signal) => {
        signal?.addEventListener('abort', () => {
          aborted = true;
        });
      });

      const fx = withResilientFX(
        provider({ marketData: observing }),
        { clock, logger: noopLogger, recorder, sleep: () => Promise.resolve() },
        {
          policy: {
            timeoutMs: 20,
            retry: { ...shortPolicy.retry, maxAttempts: 1 },
            overallTimeoutMs: 200,
          },
        },
      );

      await expect(fx.getFXQuote(request('USD', 'KRW', '10000000'), context)).rejects.toThrow();
      expect(aborted).toBe(true);
    });
  });

  describe('health', () => {
    it('reports its own health as its benchmark feed’s health', async () => {
      const health = await provider().probe?.(context);

      expect(health).toMatchObject({ providerId: 'demo-fx-provider', state: 'up' });
      expect(health?.detail).toContain('market data');
    });
  });
});

const shortPolicy: ResiliencePolicy = {
  timeoutMs: 50,
  retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 2, backoffMultiplier: 2, jitter: 0 },
  overallTimeoutMs: 1_000,
};

const STUB_DESCRIPTOR: ProviderDescriptor = {
  id: 'demo-market-data',
  name: 'Stub Market Data',
  rail: 'bank_fx',
  licensing: 'unlicensed_sandbox',
  modes: ['sandbox'],
  jurisdictions: ['*'],
  description: 'Test double.',
  pricingVersion: 'stub-1',
};

function stubMarketData(overrides: Partial<MarketRate>, onCall?: () => void): MarketDataProvider {
  return {
    capability: 'market_data',
    descriptor: STUB_DESCRIPTOR,
    supports: () => true,
    getMarketRate: (request: MarketRateRequest, ctx: ProviderContext) => {
      onCall?.();
      return Promise.resolve({
        providerId: STUB_DESCRIPTOR.id,
        baseCurrency: request.baseCurrency,
        quoteCurrency: request.quoteCurrency,
        rate: '1385.42',
        bid: null,
        ask: null,
        timestamp: ctx.clock.nowIso(),
        expiresAt: new Date(ctx.clock.nowMs() + 30_000).toISOString(),
        quoteReference: null,
        source: 'stub',
        metadata: {},
        ...overrides,
      });
    },
  };
}

/** Fails until `recover` says otherwise, so a retry can be observed to actually help. */
function failingMarketData(
  error: Error,
  shouldFail: () => boolean = () => true,
): MarketDataProvider {
  const healthy = stubMarketData({});
  return {
    ...healthy,
    getMarketRate: (request, ctx) =>
      shouldFail() ? Promise.reject(error) : healthy.getMarketRate(request, ctx),
  };
}

/** Never settles, so the per-attempt timeout is what ends the call. */
function hangingMarketData(
  onSignal?: (signal: AbortSignal | undefined) => void,
): MarketDataProvider {
  const healthy = stubMarketData({});
  return {
    ...healthy,
    getMarketRate: (_request, ctx) => {
      onSignal?.(ctx.signal);
      return new Promise(() => undefined);
    },
  };
}
