import { describe, expect, it } from 'vitest';
import { defaultProfileForRail } from '../domain/provider-catalog.js';
import type { PlatformPricingRule } from '../domain/platform-pricing.js';
import { simulationPricingShapeAdmission } from '../domain/pricing-shape.js';
import { AssetAmount } from '../money/asset-amount.js';
import { Dec } from '../money/index.js';
import {
  FixedClock,
  SequentialIdGenerator,
  StaticPlatformPricingResolver,
  noopLogger,
  type AuditEvent,
  type AuditEventInput,
  type AuditLogger,
  type FinancialProvider,
  type NormalizedQuoteRequest,
  type ProviderContext,
  type ProviderHealth,
} from '../ports/index.js';
import { bindNormalizedQuoteToRequest, buildNormalizedQuote, buildProviderDescriptor } from '../testing/index.js';
import { priceRouteMonetization } from './monetization-engine.js';
import { FinancialProviderRegistry } from './financial-registry.js';
import { MultiRailCostEngine } from './routing-cost.js';
import { MultiRailRouter } from './routing-engine.js';
import { defaultRoutingWeights } from './routing-config.js';
import type { PricedMultiRailRoute } from './routing-types.js';

class RecordingAuditLogger implements AuditLogger {
  readonly events: AuditEvent[] = [];
  private sequence = 0;

  record(input: AuditEventInput): Promise<AuditEvent> {
    this.sequence += 1;
    const event: AuditEvent = {
      ...input,
      eventId: `evt_${this.sequence}`,
      occurredAt: '2026-01-01T00:00:00.000Z',
    };
    this.events.push(event);
    return Promise.resolve(event);
  }
}

class StubFinancialProvider implements FinancialProvider {
  readonly capability = 'financial' as const;
  readonly descriptor;

  constructor(
    descriptor: Parameters<typeof buildProviderDescriptor>[0],
    private readonly quote: ReturnType<typeof buildNormalizedQuote>,
    private readonly source: string,
    private readonly target: string,
  ) {
    this.descriptor = buildProviderDescriptor(descriptor);
  }

  getCapabilities() {
    return defaultProfileForRail(this.descriptor.rail);
  }

  getSupportedAssets() {
    return [];
  }

  getSupportedCurrencies() {
    return [];
  }

  supportsNormalized(request: NormalizedQuoteRequest): boolean {
    return request.sourceAsset === this.source && request.targetAsset === this.target;
  }

  async getQuote(request: NormalizedQuoteRequest, _context: ProviderContext) {
    await Promise.resolve();
    return bindNormalizedQuoteToRequest(this.quote, request);
  }

  async getSettlementEstimate(request: NormalizedQuoteRequest, context: ProviderContext) {
    return (await this.getQuote(request, context)).settlement;
  }

  async getFees(request: NormalizedQuoteRequest, context: ProviderContext) {
    return (await this.getQuote(request, context)).fees;
  }

  async getLiquidityInfo(request: NormalizedQuoteRequest, context: ProviderContext) {
    return (await this.getQuote(request, context)).liquidity;
  }

  probe(context: ProviderContext): Promise<ProviderHealth> {
    return Promise.resolve({
      providerId: this.descriptor.id,
      state: 'up',
      checkedAt: context.clock.nowIso(),
      latencyMs: 0,
      detail: 'stub',
    });
  }
}

function pricingRule(overrides: Partial<PlatformPricingRule> = {}): PlatformPricingRule {
  return {
    id: 'rule-take-10',
    organizationId: 'org_fees',
    sourceCurrency: null,
    targetCurrency: null,
    rail: null,
    providerId: null,
    markupBps: '10',
    discountBps: '0',
    platformFeeMinorUnits: '0',
    feeCurrency: null,
    priority: 0,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    ...overrides,
  };
}

function router(providers: readonly FinancialProvider[]): MultiRailRouter {
  return new MultiRailRouter({
    mode: 'sandbox',
    registry: FinancialProviderRegistry.create('sandbox', providers),
    costEngine: new MultiRailCostEngine(),
    defaultWeights: defaultRoutingWeights(),
    clock: new FixedClock('2026-03-01T09:00:00.000Z'),
    ids: new SequentialIdGenerator(),
    auditLogger: new RecordingAuditLogger(),
    logger: noopLogger,
    providerTimeoutMs: 1_000,
    pricingResolver: new StaticPlatformPricingResolver([pricingRule()]),
    // This suite is about take-rate arithmetic, so it runs with the ad-valorem shape admitted.
    // Whether the shape may be charged at all is decided by §18.3 and covered in
    // routing-pricing-shapes.test.ts.
    pricingShapes: () => ALL_SHAPES_ADMITTED,
  });
}

const ALL_SHAPES_ADMITTED = simulationPricingShapeAdmission();

const USD_NOTIONAL = '10000000';

function attributed(route: PricedMultiRailRoute): AssetAmount {
  const dest = route.totalCost.asset;
  return AssetAmount.sum(dest, [
    route.breakdown.providerFee,
    route.breakdown.platformFee,
    route.breakdown.networkFee,
    route.breakdown.gasFee,
    route.breakdown.liquidityFee,
    route.breakdown.surchargeFee,
    route.breakdown.spreadCost,
    route.breakdown.slippageCost,
    route.breakdown.roundingAdjustment,
  ]);
}

describe('PA-H10 — platform fee across non-fiat corridors', () => {
  it('A. applies the same take-rate once on fiat-only and stablecoin-assisted routes', async () => {
    const fiat = await router([
      new StubFinancialProvider(
        { id: 'bank', name: 'Bank', rail: 'bank_fx' },
        buildNormalizedQuote({
          providerId: 'bank',
          indicatedRate: '1300',
          midMarketRate: '1300',
        }),
        'USD',
        'KRW',
      ),
    ]).evaluate({
      organizationId: 'org_fees',
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amountMinorUnits: USD_NOTIONAL,
      weights: null,
      actor: 'test',
      requestId: 'req_fiat',
    });

    const stable = await router([
      new StubFinancialProvider(
        { id: 'solstice', name: 'Solstice', rail: 'stablecoin_settlement' },
        buildNormalizedQuote({
          providerId: 'solstice',
          indicatedRate: '1300',
          midMarketRate: '1300',
          intermediaryAsset: 'USDC',
        }),
        'USD',
        'KRW',
      ),
    ]).evaluate({
      organizationId: 'org_fees',
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amountMinorUnits: USD_NOTIONAL,
      weights: null,
      actor: 'test',
      requestId: 'req_stable',
    });

    const fiatPlatform = fiat.routes[0]?.breakdown.platformFee.minorUnits;
    const stablePlatform = stable.routes[0]?.breakdown.platformFee.minorUnits;
    expect(fiatPlatform).toBe(stablePlatform);
    expect(fiat.routes[0]?.hops.length).toBe(3);
    expect(stable.routes[0]?.hops.length).toBe(4);
    expect(fiat.routes[0]?.platformCharge.markupBps.toFixed()).toBe('10');
    expect(stable.routes[0]?.platformCharge.markupBps.toFixed()).toBe('10');
  });

  it('B. prices per-leg DeFi costs while applying platform fee once', () => {
    const engine = new MultiRailCostEngine();
    const route = engine.price(
      buildNormalizedQuote({
        providerId: 'amm',
        sourceAsset: 'ETH',
        targetAsset: 'USDC',
        conversionKind: 'crypto_stablecoin',
        amountMinorUnits: '1000000000000000000',
        indicatedRate: '3500',
        midMarketRate: '3500',
        hops: ['ETH', 'Pool A', 'WETH', 'Pool B', 'USDC'],
        fees: [
          {
            code: 'hop1_gas',
            label: 'Leg 1 gas',
            side: 'destination',
            kind: 'fixed',
            asset: 'USDC',
            amountMinorUnits: '100000',
            rateBps: null,
          },
          {
            code: 'hop2_gas',
            label: 'Leg 2 gas',
            side: 'destination',
            kind: 'fixed',
            asset: 'USDC',
            amountMinorUnits: '200000',
            rateBps: null,
          },
          {
            code: 'hop1_liquidity',
            label: 'Leg 1 pool fee',
            side: 'source',
            kind: 'proportional',
            asset: 'ETH',
            amountMinorUnits: null,
            rateBps: '5',
          },
          {
            code: 'hop2_liquidity',
            label: 'Leg 2 pool fee',
            side: 'source',
            kind: 'proportional',
            asset: 'ETH',
            amountMinorUnits: null,
            rateBps: '5',
          },
        ],
      }),
      buildProviderDescriptor({ id: 'amm', name: 'Amm', rail: 'dex_liquidity' }),
      defaultProfileForRail('dex_liquidity'),
      {
        ruleId: 'rule-take-10',
        markupBps: new Dec(10),
        discountBps: new Dec(0),
        flatFee: null,
        surcharge: null,
      },
    );

    expect(route.hops).toHaveLength(5);
    expect(route.breakdown.gasFee.minorUnits).toBe(300_000n);
    expect(route.breakdown.liquidityFee.isPositive()).toBe(true);
    expect(route.breakdown.appliedFees.filter((fee) => fee.code === 'platform_markup')).toHaveLength(
      1,
    );
    expect(route.platformCharge.markupBps.toFixed()).toBe('10');
  });

  it('C. 1-leg and 3-leg economically equivalent routes have the same platform fee', () => {
    const engine = new MultiRailCostEngine();
    const charge = {
      ruleId: 'rule-take-10',
      markupBps: new Dec(10),
      discountBps: new Dec(0),
      flatFee: null,
      surcharge: null,
    };
    const one = engine.price(
      buildNormalizedQuote({
        hops: ['USD', 'Bank', 'KRW'],
        indicatedRate: '1300',
        midMarketRate: '1300',
      }),
      buildProviderDescriptor({ id: 'one', rail: 'bank_fx' }),
      defaultProfileForRail('bank_fx'),
      charge,
    );
    const three = engine.price(
      buildNormalizedQuote({
        hops: ['USD', 'Ramp', 'USDC', 'DEX', 'KRW'],
        indicatedRate: '1300',
        midMarketRate: '1300',
      }),
      buildProviderDescriptor({ id: 'three', rail: 'stablecoin_settlement' }),
      defaultProfileForRail('stablecoin_settlement'),
      charge,
    );

    expect(one.hops).toHaveLength(3);
    expect(three.hops).toHaveLength(5);
    expect(one.breakdown.platformFee.minorUnits).toBe(three.breakdown.platformFee.minorUnits);
  });

  it('D. a configured DeFi surcharge is separately identifiable', () => {
    const engine = new MultiRailCostEngine();
    const route = engine.price(
      buildNormalizedQuote({
        sourceAsset: 'ETH',
        targetAsset: 'USDC',
        conversionKind: 'crypto_stablecoin',
        amountMinorUnits: '1000000000000000000',
        indicatedRate: '3500',
        midMarketRate: '3500',
      }),
      buildProviderDescriptor({ id: 'amm', rail: 'dex_liquidity' }),
      defaultProfileForRail('dex_liquidity'),
      {
        ruleId: 'rule-defi',
        markupBps: new Dec(10),
        discountBps: new Dec(0),
        flatFee: null,
        surcharge: {
          code: 'defi_surcharge',
          label: 'DeFi infrastructure surcharge',
          rateBps: new Dec(3),
        },
      },
    );

    const surcharge = route.breakdown.appliedFees.find((fee) => fee.code === 'defi_surcharge');
    expect(surcharge).toBeDefined();
    expect(surcharge?.bucket).toBe('surcharge');
    expect(route.breakdown.surchargeFee.isPositive()).toBe(true);
    expect(route.breakdown.platformFee.isPositive()).toBe(true);
    expect(route.breakdown.surchargeFee.minorUnits).not.toBe(route.breakdown.platformFee.minorUnits);
  });

  it('E. total route monetization reconciles with Decimal-safe arithmetic', () => {
    const engine = new MultiRailCostEngine();
    const route = engine.price(
      buildNormalizedQuote({ indicatedRate: '1290', midMarketRate: '1300' }),
      buildProviderDescriptor(),
      defaultProfileForRail('bank_fx'),
      {
        ruleId: 'rule-take-10',
        markupBps: new Dec(10),
        discountBps: new Dec(0),
        flatFee: null,
        surcharge: null,
      },
    );
    expect(attributed(route).minorUnits).toBe(route.totalCost.minorUnits);
  });

  it('F. 6-decimal stablecoins and 18-decimal assets do not drift', () => {
    const engine = new MultiRailCostEngine();
    const usdc = engine.price(
      buildNormalizedQuote({
        sourceAsset: 'USDC',
        targetAsset: 'USDT',
        conversionKind: 'stablecoin_stablecoin',
        amountMinorUnits: '1000000000',
        indicatedRate: '0.9996',
        midMarketRate: '1',
      }),
      buildProviderDescriptor({ id: 'ramp', rail: 'stablecoin_settlement' }),
      defaultProfileForRail('stablecoin_settlement'),
      {
        ruleId: 'rule-take-10',
        markupBps: new Dec(10),
        discountBps: new Dec(0),
        flatFee: null,
        surcharge: null,
      },
    );
    const eth = engine.price(
      buildNormalizedQuote({
        sourceAsset: 'ETH',
        targetAsset: 'USDC',
        conversionKind: 'crypto_stablecoin',
        amountMinorUnits: '1000000000000000000',
        indicatedRate: '3500',
        midMarketRate: '3500',
      }),
      buildProviderDescriptor({ id: 'amm', rail: 'dex_liquidity' }),
      defaultProfileForRail('dex_liquidity'),
      {
        ruleId: 'rule-take-10',
        markupBps: new Dec(10),
        discountBps: new Dec(0),
        flatFee: null,
        surcharge: null,
      },
    );

    expect(usdc.sendAmount.exponent).toBe(6);
    expect(eth.sendAmount.exponent).toBe(18);
    expect(attributed(usdc).minorUnits).toBe(usdc.totalCost.minorUnits);
    expect(attributed(eth).minorUnits).toBe(eth.totalCost.minorUnits);
    expect(usdc.breakdown.platformFee.minorUnits).toBeGreaterThan(0n);
    expect(eth.breakdown.platformFee.minorUnits).toBeGreaterThan(0n);
  });

  it('G. repeated calculation is deterministic and does not compound platform fees', () => {
    const engine = new MultiRailCostEngine();
    const charge = {
      ruleId: 'rule-take-10',
      markupBps: new Dec(10),
      discountBps: new Dec(0),
      flatFee: null,
      surcharge: null,
    };
    const quote = buildNormalizedQuote({ indicatedRate: '1290', midMarketRate: '1300' });
    const first = engine.price(quote, buildProviderDescriptor(), defaultProfileForRail('bank_fx'), charge);
    const second = engine.price(quote, buildProviderDescriptor(), defaultProfileForRail('bank_fx'), charge);
    expect(second.breakdown.platformFee.minorUnits).toBe(first.breakdown.platformFee.minorUnits);
    expect(second.deliveredAmount.minorUnits).toBe(first.deliveredAmount.minorUnits);
    const scored = {
      ...first,
      rank: 1,
      recommended: true,
      routeScore: first.totalCostBps,
      scoreComponents: {
        cost: first.totalCostBps,
        speed: first.totalCostBps,
        finality: first.settlementConfidence,
        fxRate: first.totalCostBps,
        slippage: first.slippageBps,
        liquidity: first.totalCostBps,
        compliance: first.totalCostBps,
      },
      routeExplanation: 'test',
    };
    const once = priceRouteMonetization(scored as never);
    const twice = priceRouteMonetization(scored);
    expect(twice.platformRevenueMinorUnits).toBe(once.platformRevenueMinorUnits);
    expect(BigInt(once.platformRevenueMinorUnits) + BigInt(once.partnerCommissionMinorUnits)).toBe(
      BigInt(once.grossRevenueMinorUnits) + BigInt(once.partnerCommissionMinorUnits),
    );
    expect(BigInt(once.platformRevenueMinorUnits)).toBe(
      BigInt(once.partnerCommissionMinorUnits) + BigInt(once.grossProfitMinorUnits),
    );
  });
});
