import { describe, expect, it } from 'vitest';
import type { PlatformPricingRule, PricedRoute } from '../domain/index.js';
import { InvalidAmountError, InvalidProviderQuoteError } from '../errors/index.js';
import { Dec, Money, Rate } from '../money/index.js';
import {
  buildProviderDescriptor,
  buildProviderQuote,
  buildQuoteRequest,
} from '../testing/index.js';
import { RouteCostEngine } from './cost-engine.js';
import { defaultScoringWeights, parseScoringWeights } from './engine-config.js';
import { selectPricingRule, toPlatformPricing } from './platform-pricing.js';
import { RouteScorer } from './route-scorer.js';

const engine = new RouteCostEngine();
const descriptor = buildProviderDescriptor();
const HUNDRED_THOUSAND_USD = '10000000';

function pricingRule(overrides: Partial<PlatformPricingRule> = {}): PlatformPricingRule {
  return {
    id: 'rule-1',
    organizationId: 'org-1',
    sourceCurrency: null,
    targetCurrency: null,
    rail: null,
    providerId: null,
    markupBps: '0',
    discountBps: '0',
    platformFeeMinorUnits: '0',
    feeCurrency: null,
    priority: 0,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    ...overrides,
  };
}

function price(
  options: {
    quote?: Parameters<typeof buildProviderQuote>[0];
    request?: Parameters<typeof buildQuoteRequest>[0];
    rule?: PlatformPricingRule | null;
  } = {},
): PricedRoute {
  const request = buildQuoteRequest({
    amountMinorUnits: HUNDRED_THOUSAND_USD,
    ...options.request,
  });
  const quote = buildProviderQuote({
    midMarketRate: '1300',
    offeredRate: '1300',
    ...options.quote,
  });
  const platformPricing = toPlatformPricing(options.rule ?? null, {
    sourceCurrency: request.sourceCurrency,
    midMarketRate: Rate.of(request.sourceCurrency, request.targetCurrency, quote.midMarketRate),
  });

  return engine.price(request, quote, descriptor, { platformPricing });
}

/** The breakdown is a decomposition, not an estimate: it must always sum to the total. */
function expectBreakdownToReconcile(route: PricedRoute): void {
  const { breakdown } = route;
  const attributed = Money.sum(route.totalCost.currency, [
    breakdown.sourceFeeCost,
    breakdown.platformFeeCost,
    breakdown.destinationFeeCost,
    breakdown.fxSpreadCost,
    breakdown.slippageCost,
    breakdown.roundingAdjustment,
  ]);
  expect(attributed.minorUnits).toBe(route.totalCost.minorUnits);
}

describe('platform fee', () => {
  it('charges nothing when the organization has no terms', () => {
    const route = price();

    expect(route.platformPricing.ruleId).toBeNull();
    expect(route.breakdown.platformFeeCost.isZero()).toBe(true);
    expect(route.breakdown.appliedFees).toHaveLength(0);
  });

  it('takes a markup as an explicit fee rather than inside the rate', () => {
    const route = price({ rule: pricingRule({ markupBps: '8' }) });

    // 8 bps of USD 100,000 is USD 80.00.
    const markup = route.breakdown.appliedFees.find((fee) => fee.code === 'platform_markup');
    expect(markup).toMatchObject({ chargedBy: 'platform', side: 'source', rateBps: new Dec('8') });
    expect(markup?.amount.toJSON().minorUnits).toBe('8000');

    // The rate the customer gets is untouched: the platform's take is visible, not embedded.
    expect(route.offeredRate.value.toFixed()).toBe('1300');
    expectBreakdownToReconcile(route);
  });

  it('reports the platform charge separately from the provider’s', () => {
    const route = price({
      quote: {
        fees: {
          components: [
            {
              kind: 'fixed',
              code: 'wire',
              label: 'Wire',
              side: 'source',
              currency: 'USD',
              amountMinorUnits: '2500',
            },
          ],
        },
      },
      rule: pricingRule({ markupBps: '8' }),
    });

    // Netting the two would make the platform's margin unauditable.
    expect(route.breakdown.sourceFeeCost.toJSON().minorUnits).toBe('32500');
    expect(route.breakdown.platformFeeCost.toJSON().minorUnits).toBe('104000');
    expectBreakdownToReconcile(route);
  });

  it('adds a flat platform fee', () => {
    const route = price({
      rule: pricingRule({ platformFeeMinorUnits: '1500', feeCurrency: 'USD' }),
    });

    const flat = route.breakdown.appliedFees.find((fee) => fee.code === 'platform_fee');
    expect(flat).toMatchObject({ chargedBy: 'platform', kind: 'fixed' });
    expect(flat?.amount.toJSON().minorUnits).toBe('1500');
    expectBreakdownToReconcile(route);
  });

  it('charges both a markup and a flat fee when the terms specify both', () => {
    const route = price({
      rule: pricingRule({ markupBps: '5', platformFeeMinorUnits: '1000', feeCurrency: 'USD' }),
    });

    // 5 bps of 100,000 is 50.00, plus a flat 10.00.
    expect(route.breakdown.platformFeeCost.toJSON().minorUnits).toBe('78000');
    expectBreakdownToReconcile(route);
  });

  it('reduces the delivered amount by exactly the platform take', () => {
    const without = price();
    const with_ = price({ rule: pricingRule({ markupBps: '8' }) });

    const difference =
      BigInt(without.deliveredAmount.minorUnits) - BigInt(with_.deliveredAmount.minorUnits);
    // USD 80.00 at 1300 is KRW 104,000.
    expect(difference).toBe(104_000n);
  });

  it('applies a negotiated discount by narrowing the provider’s spread', () => {
    const quoted = { midMarketRate: '1300', offeredRate: '1290.64' }; // 72 bps
    const without = price({ quote: quoted });
    const with_ = price({ quote: quoted, rule: pricingRule({ discountBps: '12' }) });

    expect(without.spreadBps.toDecimalPlaces(2).toFixed()).toBe('72');
    expect(with_.spreadBps.toDecimalPlaces(2).toFixed()).toBe('60');
    // A better rate means more delivered.
    expect(with_.deliveredAmount.greaterThan(without.deliveredAmount)).toBe(true);
    expectBreakdownToReconcile(with_);
  });

  it('lets a discount and a markup coexist, each doing its own job', () => {
    const route = price({
      quote: { midMarketRate: '1300', offeredRate: '1290.64' },
      rule: pricingRule({ discountBps: '12', markupBps: '8' }),
    });

    expect(route.spreadBps.toDecimalPlaces(2).toFixed()).toBe('60');
    expect(route.breakdown.platformFeeCost.isPositive()).toBe(true);
    expectBreakdownToReconcile(route);
  });

  it('resolves the applicable rule per route, so rails can be priced differently', () => {
    const rules = [
      pricingRule({ id: 'default', markupBps: '10' }),
      pricingRule({ id: 'stablecoin', rail: 'stablecoin_settlement', markupBps: '4' }),
    ];

    const forBank = selectPricingRule(rules, {
      organizationId: 'org-1',
      sourceCurrency: 'USD',
      targetCurrency: 'KRW',
      rail: 'bank_fx',
      providerId: 'p',
      at: '2026-03-01T00:00:00.000Z',
    });
    const forCoin = selectPricingRule(rules, {
      organizationId: 'org-1',
      sourceCurrency: 'USD',
      targetCurrency: 'KRW',
      rail: 'stablecoin_settlement',
      providerId: 'p',
      at: '2026-03-01T00:00:00.000Z',
    });

    expect(forBank?.id).toBe('default');
    expect(forCoin?.id).toBe('stablecoin');
  });
});

describe('liquidity and risk metrics', () => {
  it('reports no headroom where the rail publishes no depth', () => {
    expect(price().liquidityHeadroom).toBeNull();
  });

  it('expresses disclosed depth as a multiple of the notional', () => {
    const route = price({
      quote: { liquidity: { availableDepthMinorUnits: '30000000' } },
    });

    // USD 300,000 of depth against a USD 100,000 order.
    expect(route.liquidityHeadroom?.toFixed()).toBe('3');
  });

  it('scores neutrally when a provider supplies no risk signals', () => {
    expect(price().riskScore.toFixed()).toBe('0.75');
  });

  it('scores a low-risk, low-settlement-risk provider at the top', () => {
    const route = price({
      quote: { risk: { jurisdictionRisk: 'low', settlementRiskBps: '0' } },
    });

    expect(route.riskScore.toFixed()).toBe('1');
  });

  /**
   * Combined multiplicatively so a serious concern on either signal cannot be averaged away by a
   * clean score on the other.
   */
  it('compounds jurisdiction and settlement risk rather than averaging them', () => {
    const route = price({
      quote: { risk: { jurisdictionRisk: 'high', settlementRiskBps: '2000' } },
    });

    // 0.6 for a high-risk jurisdiction, times 0.8 for 2,000 bps of settlement risk.
    expect(route.riskScore.toFixed(4)).toBe('0.4800');
  });

  it('scores each signal neutrally when only one is supplied', () => {
    const route = price({
      quote: { risk: { jurisdictionRisk: 'low', settlementRiskBps: null } },
    });

    expect(route.riskScore.toFixed()).toBe('0.75');
  });
});

describe('edge cases', () => {
  it('rejects a zero amount', () => {
    expect(() => price({ request: { amountMinorUnits: '0' } })).toThrow(InvalidAmountError);
  });

  it('rejects a negative amount', () => {
    expect(() => price({ request: { amountMinorUnits: '-10000' } })).toThrow(InvalidAmountError);
  });

  describe('a very large amount', () => {
    // IDR-scale notional, past 2^53, where a float or a JS number would lose digits.
    const huge = '90071992547409930000';

    it('prices without losing precision', () => {
      const route = price({ request: { amountMinorUnits: huge } });

      expect(route.sendAmount.minorUnits).toBe(BigInt(huge));
      expect(route.deliveredAmount.isPositive()).toBe(true);
      expectBreakdownToReconcile(route);
    });

    it('keeps the cost proportionate rather than overflowing', () => {
      const small = price({
        quote: { midMarketRate: '1300', offeredRate: '1290.64' },
        request: { amountMinorUnits: HUNDRED_THOUSAND_USD },
      });
      const large = price({
        quote: { midMarketRate: '1300', offeredRate: '1290.64' },
        request: { amountMinorUnits: huge },
      });

      // Cost in basis points is scale-invariant for a pure spread.
      expect(large.totalCostBps.toDecimalPlaces(6).toFixed()).toBe(
        small.totalCostBps.toDecimalPlaces(6).toFixed(),
      );
    });

    it('applies a platform markup at scale exactly', () => {
      const route = price({
        request: { amountMinorUnits: huge },
        rule: pricingRule({ markupBps: '10' }),
      });

      const markup = route.breakdown.appliedFees.find((fee) => fee.code === 'platform_markup');
      // 10 bps of the notional, computed on integers throughout.
      expect(markup?.amount.minorUnits).toBe(BigInt(huge) / 1000n);
    });
  });

  it('rejects an unsupported currency in the quote', () => {
    expect(() => price({ quote: { targetCurrency: 'JPY' } })).toThrow(InvalidProviderQuoteError);
  });

  it('rejects a quote whose fees exceed the amount, provider or platform', () => {
    expect(() =>
      price({
        request: { amountMinorUnits: '100000' },
        rule: pricingRule({ platformFeeMinorUnits: '100000', feeCurrency: 'USD' }),
      }),
    ).toThrow(InvalidAmountError);
  });

  describe('an extremely high spread', () => {
    it('prices a punitive spread rather than rejecting it', () => {
      // 5,000 bps: half the value taken in the rate. Implausible commercially, but a provider is
      // entitled to quote it and the platform's job is to expose it, not to hide it.
      const route = price({ quote: { midMarketRate: '1300', offeredRate: '650' } });

      expect(route.totalCostBps.toDecimalPlaces(0).toFixed()).toBe('5000');
      expect(route.deliveredAmount.isPositive()).toBe(true);
      expectBreakdownToReconcile(route);
    });

    it('ranks a punitive spread last rather than discarding it', () => {
      const scorer = new RouteScorer(defaultScoringWeights());
      const routes = [
        price({ quote: { providerId: 'fair', midMarketRate: '1300', offeredRate: '1290' } }),
        price({ quote: { providerId: 'punitive', midMarketRate: '1300', offeredRate: '650' } }),
      ];

      const scored = scorer.score(routes);
      expect(scored[0]?.quote.providerId).toBe('fair');
      expect(scored.at(-1)?.quote.providerId).toBe('punitive');
      // Still surfaced, so a customer can see what they were being offered.
      expect(scored).toHaveLength(2);
    });

    it('rejects a rate so bad it delivers nothing at all', () => {
      // A spread that consumes the entire notional leaves no benchmark to measure against.
      expect(() =>
        price({
          quote: {
            sourceCurrency: 'KRW',
            targetCurrency: 'USD',
            midMarketRate: '0.00074',
            offeredRate: '0.00073',
          },
          request: { sourceCurrency: 'KRW', targetCurrency: 'USD', amountMinorUnits: '1' },
        }),
      ).toThrow(InvalidAmountError);
    });
  });

  describe('identical provider quotes', () => {
    const identical = ['alpha', 'bravo', 'charlie'].map((providerId) =>
      price({ quote: { providerId, midMarketRate: '1300', offeredRate: '1290' } }),
    );

    it('scores them identically', () => {
      const scored = new RouteScorer(defaultScoringWeights()).score(identical);
      const scores = scored.map((route) => route.score.toFixed());

      expect(new Set(scores).size).toBe(1);
    });

    it('ranks them in a stable, deterministic order', () => {
      const scorer = new RouteScorer(defaultScoringWeights());
      const forward = scorer.score(identical).map((route) => route.routeId);
      const reversed = scorer.score([...identical].reverse()).map((route) => route.routeId);

      expect(reversed).toEqual(forward);
      expect(forward).toEqual(['alpha:bank_fx', 'bravo:bank_fx', 'charlie:bank_fx']);
    });

    it('still names exactly one recommendation', () => {
      const scored = new RouteScorer(defaultScoringWeights()).score(identical);

      expect(scored.filter((route) => route.recommended)).toHaveLength(1);
      expect(scored[0]?.recommended).toBe(true);
    });
  });

  it('handles a single candidate without dividing by a zero span', () => {
    const scored = new RouteScorer(
      parseScoringWeights({ cost: '0.5', speed: '0.5', reliability: '0' }),
    ).score([price()]);

    expect(scored).toHaveLength(1);
    expect(scored[0]?.score.toFixed()).toBe('100');
  });

  it('returns nothing for an empty candidate set rather than failing', () => {
    expect(new RouteScorer(defaultScoringWeights()).score([])).toEqual([]);
  });
});

describe('determinism', () => {
  /**
   * The engine takes no clock, no randomness and no I/O. Pricing the same inputs twice must give
   * byte-identical output, which is what makes a stored comparison replayable.
   */
  it('produces identical output for identical input', () => {
    const first = price({ rule: pricingRule({ markupBps: '8', discountBps: '3' }) });
    const second = price({ rule: pricingRule({ markupBps: '8', discountBps: '3' }) });

    expect(second.deliveredAmount.minorUnits).toBe(first.deliveredAmount.minorUnits);
    expect(second.totalCost.minorUnits).toBe(first.totalCost.minorUnits);
    expect(second.totalCostBps.toFixed()).toBe(first.totalCostBps.toFixed());
    expect(second.spreadBps.toFixed()).toBe(first.spreadBps.toFixed());
  });

  it('scores identically regardless of candidate order', () => {
    const routes = [
      price({ quote: { providerId: 'a', offeredRate: '1290' } }),
      price({ quote: { providerId: 'b', offeredRate: '1295' } }),
      price({ quote: { providerId: 'c', offeredRate: '1280' } }),
    ];
    const scorer = new RouteScorer(defaultScoringWeights());

    const forward = scorer.score(routes);
    const shuffled = scorer.score([routes[2], routes[0], routes[1]] as PricedRoute[]);

    expect(shuffled.map((route) => route.routeId)).toEqual(forward.map((route) => route.routeId));
    expect(shuffled.map((route) => route.score.toFixed())).toEqual(
      forward.map((route) => route.score.toFixed()),
    );
  });
});
