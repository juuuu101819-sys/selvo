import {
  Dec,
  FixedClock,
  ProviderError,
  ProviderRegistry,
  RepositoryAuditLogger,
  RouteComparisonService,
  RouteCostEngine,
  assertValidProviderQuote,
  buildQuoteRequest,
  defaultScoringWeights,
  noopLogger,
  uuidIdGenerator,
  type CurrencyCode,
  type FXProvider,
  type MarketDataProvider,
  type AuditEvent,
  type ComparisonRepository,
  type ProviderContext,
  type StoredComparison,
} from '@meridian/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { DemoFXProvider } from '../demo/demo-fx-provider.js';
import { DemoMarketDataProvider } from '../demo/demo-market-data-provider.js';
import { createSandboxAdapters } from '../sandbox/index.js';
import { FXRouteProvider } from './fx-route-provider.js';

let clock: FixedClock;
let context: ProviderContext;
let marketData: MarketDataProvider;
let fx: FXProvider;

beforeEach(() => {
  clock = new FixedClock('2026-03-01T12:00:00.000Z');
  context = { clock, logger: noopLogger, requestId: 'req-1', signal: undefined };
  marketData = new DemoMarketDataProvider({ rates: createSandboxAdapters().rates });
  fx = new DemoFXProvider({ marketData });
});

const CORRIDORS = [
  { source: 'USD', target: 'KRW', amount: '10000000' },
  { source: 'USD', target: 'EUR', amount: '10000000' },
  { source: 'EUR', target: 'JPY', amount: '5000000' },
] as const;

describe('FXRouteProvider', () => {
  it('presents an FX provider to the engine as a route provider', () => {
    const route = new FXRouteProvider({ fx, marketData });

    expect(route.capability).toBe('route');
    expect(route.descriptor.id).toBe('demo-fx-provider');
  });

  it.each(CORRIDORS)(
    'produces a quote the engine accepts for $source to $target',
    async ({ source, target, amount }) => {
      const route = new FXRouteProvider({ fx, marketData });
      const request = buildQuoteRequest({
        sourceCurrency: source as CurrencyCode,
        targetCurrency: target as CurrencyCode,
        amountMinorUnits: amount,
      });

      const quote = await route.fetchQuote(request, context);

      // The engine's own validator is the real test of whether the mapping is correct.
      expect(() => assertValidProviderQuote(quote, request)).not.toThrow();
      expect(quote.midMarketRate).not.toBe(quote.offeredRate);
    },
  );

  it.each(CORRIDORS)(
    'prices through the engine for $source to $target',
    async ({ source, target, amount }) => {
      const route = new FXRouteProvider({ fx, marketData });
      const request = buildQuoteRequest({
        sourceCurrency: source as CurrencyCode,
        targetCurrency: target as CurrencyCode,
        amountMinorUnits: amount,
      });

      const priced = new RouteCostEngine().price(
        request,
        await route.fetchQuote(request, context),
        route.descriptor,
      );

      expect(priced.deliveredAmount.isPositive()).toBe(true);
      expect(priced.totalCost.isPositive()).toBe(true);
      // 35 bps of spread plus a flat fee and 12 bps of commission: comfortably under 1%.
      expect(priced.totalCostBps.greaterThan(35)).toBe(true);
      expect(priced.totalCostBps.lessThan(100)).toBe(true);
    },
  );

  it('maps a basis-point charge to a proportional fee, so the engine applies it to the notional', async () => {
    const route = new FXRouteProvider({ fx, marketData });
    const request = buildQuoteRequest({ amountMinorUnits: '10000000' });
    const quote = await route.fetchQuote(request, context);

    const commission = quote.fees.components.find((fee) => fee.code === 'fx_commission');
    expect(commission).toMatchObject({ kind: 'proportional', rateBps: '12' });

    const flat = quote.fees.components.find((fee) => fee.code === 'fx_transfer_fee');
    expect(flat).toMatchObject({ kind: 'fixed', currency: 'USD' });
  });

  it('reports no slippage, because an FX desk quotes a firm rate', async () => {
    const route = new FXRouteProvider({ fx, marketData });
    const quote = await route.fetchQuote(buildQuoteRequest(), context);

    expect(quote.slippage).toEqual({ kind: 'none' });
  });

  describe('the mid-market benchmark', () => {
    it('prefers an independent feed over the provider’s disclosed mid', async () => {
      const route = new FXRouteProvider({ fx, marketData });
      const quote = await route.fetchQuote(buildQuoteRequest(), context);

      expect(quote.raw['midMarketRateSource']).toBe('market_data');
      expect(quote.raw['marketDataProviderId']).toBe('demo-market-data');
    });

    it('falls back to the provider’s disclosed mid when no feed is configured', async () => {
      const route = new FXRouteProvider({ fx });
      const quote = await route.fetchQuote(buildQuoteRequest(), context);

      expect(quote.raw['midMarketRateSource']).toBe('provider_disclosed');
      expect(new Dec(quote.midMarketRate).greaterThan(new Dec(quote.offeredRate))).toBe(true);
    });

    /**
     * Substituting the offered rate for a missing benchmark would report every route as costing
     * nothing — the most dangerous wrong answer this system could give — so it is a hard failure.
     */
    it('fails when there is no benchmark at all', async () => {
      const silent: FXProvider = {
        ...fx,
        getFXQuote: async (request, ctx) => ({
          ...(await fx.getFXQuote(request, ctx)),
          midMarketRate: null,
        }),
      };

      await expect(
        new FXRouteProvider({ fx: silent }).fetchQuote(buildQuoteRequest(), context),
      ).rejects.toThrow(ProviderError);
    });
  });

  it('delegates eligibility to the underlying provider', () => {
    const route = new FXRouteProvider({ fx, marketData });

    expect(route.supports(buildQuoteRequest({ amountMinorUnits: '10000000' }))).toBe(true);
    // Below the demo provider's minimum notional.
    expect(route.supports(buildQuoteRequest({ amountMinorUnits: '1' }))).toBe(false);
  });

  it('reports health from the provider it wraps', async () => {
    const route = new FXRouteProvider({ fx, marketData });
    const health = await route.probe?.(context);

    expect(health?.state).toBe('up');
  });
});

describe('an end-to-end comparison over the capability interfaces', () => {
  /**
   * The point of this test is what it does *not* require: the engine prices a provider assembled
   * from a market data feed and an FX counterparty without knowing either exists. No engine code
   * changed to make this work.
   */
  it('ranks a bridged FX provider alongside the dataset rails', async () => {
    const sandbox = createSandboxAdapters();
    const bridged = new FXRouteProvider({
      fx: new DemoFXProvider({
        marketData,
        providerId: 'demo-fx-bridged',
        providerName: 'Demo FX (bridged)',
      }),
      marketData,
    });

    const service = new RouteComparisonService({
      mode: 'sandbox',
      registry: ProviderRegistry.create('sandbox', [...sandbox.providers, bridged]),
      costEngine: new RouteCostEngine(),
      defaultWeights: defaultScoringWeights(),
      clock,
      ids: uuidIdGenerator,
      auditLogger: new RepositoryAuditLogger({
        // A local fake rather than the persistence package: the adapters package has no business
        // depending on a storage driver, even in a test.
        repository: {
          append: () => Promise.resolve(),
          listByComparison: () => Promise.resolve([] as readonly AuditEvent[]),
          list: () => Promise.resolve([] as readonly AuditEvent[]),
        },
        clock,
        ids: uuidIdGenerator,
        logger: noopLogger,
      }),
      comparisons: new CollectingComparisonRepository(),
      logger: noopLogger,
      providerTimeoutMs: 2_000,
    });

    const comparison = await service.compare({
      sourceCurrency: 'USD',
      targetCurrency: 'KRW',
      amountMinorUnits: '10000000',
      rails: null,
      weights: null,
      idempotencyKey: null,
      actor: 'test',
      requestId: 'req-1',
    });

    const ids = comparison.routes.map((route) => route.provider.id);
    expect(ids).toContain('demo-fx-bridged');
    expect(comparison.routes).toHaveLength(5);
    expect(comparison.providerFailures).toEqual([]);

    // Ranked on the same basis as every other route, with no special casing.
    const bridgedRoute = comparison.routes.find((route) => route.provider.id === 'demo-fx-bridged');
    expect(bridgedRoute?.totalCostBps.greaterThan(0)).toBe(true);
    expect(bridgedRoute?.score.greaterThanOrEqualTo(0)).toBe(true);
  });
});

/** Minimal in-test repository, so this suite needs no storage driver. */
class CollectingComparisonRepository implements ComparisonRepository {
  readonly saved: StoredComparison[] = [];

  save(comparison: StoredComparison): Promise<void> {
    this.saved.push(comparison);
    return Promise.resolve();
  }

  findById(comparisonId: string): Promise<StoredComparison | null> {
    return Promise.resolve(this.saved.find((item) => item.comparisonId === comparisonId) ?? null);
  }

  findByIdempotencyKey(): Promise<StoredComparison | null> {
    return Promise.resolve(null);
  }

  list(): Promise<readonly StoredComparison[]> {
    return Promise.resolve([...this.saved].reverse());
  }
}
