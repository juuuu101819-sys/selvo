import { describe, expect, it } from 'vitest';
import { defaultProfileForRail } from '../domain/provider-catalog.js';
import { UnsupportedCorridorError } from '../errors/index.js';
import {
  FixedClock,
  SequentialIdGenerator,
  noopLogger,
  type AuditEvent,
  type AuditEventInput,
  type AuditLogger,
  type FinancialProvider,
  type NormalizedQuoteRequest,
  type PlatformPricingResolver,
  type ProviderContext,
  type ProviderHealth,
} from '../ports/index.js';
import { bindNormalizedQuoteToRequest, buildNormalizedQuote, buildProviderDescriptor } from '../testing/index.js';
import { FinancialProviderRegistry } from './financial-registry.js';
import { MultiRailCostEngine } from './routing-cost.js';
import { MultiRailRouter } from './routing-engine.js';
import { defaultRoutingWeights } from './routing-config.js';
import { ExecutionPartnerRegistry } from './execution-partner-registry.js';
import { ALWAYS_OPEN_HOURS, type ExecutionPartner } from '../ports/execution-partner.js';

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
    private readonly quote: ReturnType<typeof buildNormalizedQuote> | null,
    private readonly source: string,
    private readonly target: string,
    private readonly preserveQuoteTimes = false,
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
    if (this.quote === null || !this.supportsNormalized(request)) {
      throw new UnsupportedCorridorError(request.sourceAsset, request.targetAsset);
    }
    if (this.preserveQuoteTimes) {
      return { ...this.quote, amountMinorUnits: request.amountMinorUnits };
    }
    return bindNormalizedQuoteToRequest(
      { ...this.quote, amountMinorUnits: request.amountMinorUnits },
      request,
    );
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

function router(
  providers: readonly FinancialProvider[],
  options: {
    readonly clock?: FixedClock;
    readonly pricingResolver?: PlatformPricingResolver;
    readonly executionPartners?: ExecutionPartnerRegistry;
  } = {},
): MultiRailRouter {
  return new MultiRailRouter({
    mode: 'sandbox',
    registry: FinancialProviderRegistry.create('sandbox', providers),
    costEngine: new MultiRailCostEngine(),
    defaultWeights: defaultRoutingWeights(),
    clock: options.clock ?? new FixedClock('2026-03-01T09:00:00.000Z'),
    ids: new SequentialIdGenerator(),
    auditLogger: new RecordingAuditLogger(),
    logger: noopLogger,
    providerTimeoutMs: 1_000,
    ...(options.pricingResolver === undefined ? {} : { pricingResolver: options.pricingResolver }),
    ...(options.executionPartners === undefined ? {} : { executionPartners: options.executionPartners }),
  });
}

describe('MultiRailRouter', () => {
  it('returns ranked routes, a recommendation and an explanation', async () => {
    const result = await router([
      new StubFinancialProvider(
        { id: 'bank', name: 'Northgate Bank', rail: 'bank_fx' },
        buildNormalizedQuote({
          providerId: 'bank',
          indicatedRate: '1290',
          settlement: { p50Seconds: 86_400, p95Seconds: 172_800, businessDaysOnly: true },
        }),
        'USD',
        'KRW',
      ),
      new StubFinancialProvider(
        { id: 'fx', name: 'Veridian Payments', rail: 'payment_institution' },
        buildNormalizedQuote({
          providerId: 'fx',
          indicatedRate: '1294',
          settlement: { p50Seconds: 7_200, p95Seconds: 14_400 },
        }),
        'USD',
        'KRW',
      ),
    ]).evaluate({
      organizationId: 'org_demo',
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amountMinorUnits: '10000000',
      weights: null,
      actor: 'test',
      requestId: 'req_1',
    });

    expect(result.aiUsed).toBe(false);
    expect(result.routingEngineVersion).toBe('1.0.0');
    expect(result.routes.length).toBe(2);
    expect(result.recommendedRoute?.recommended).toBe(true);
    expect(result.routeScore).not.toBeNull();
    expect(result.estimatedCost).not.toBeNull();
    expect(result.estimatedReceiveAmount).not.toBeNull();
    expect(result.estimatedSettlementTime).not.toBeNull();
    expect(result.routeExplanation).toContain('No model is used');
    expect(result.plannedRoutes[0]?.hops).toEqual(['USD', 'Stablecoin', 'DEX liquidity', 'KRW']);
  });

  it('is deterministic for the same input', async () => {
    const instance = router([
      new StubFinancialProvider(
        { id: 'bank', name: 'Bank', rail: 'bank_fx' },
        buildNormalizedQuote({ providerId: 'bank', indicatedRate: '1290' }),
        'USD',
        'KRW',
      ),
    ]);
    const first = await instance.evaluate({
      organizationId: null,
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amountMinorUnits: '10000000',
      weights: null,
      actor: 'test',
      requestId: 'req_1',
    });
    const second = await instance.evaluate({
      organizationId: null,
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amountMinorUnits: '10000000',
      weights: null,
      actor: 'test',
      requestId: 'req_2',
    });
    expect(second.routes[0]?.routeScore.toFixed()).toBe(first.routes[0]?.routeScore.toFixed());
    expect(second.routes[0]?.deliveredAmount.minorUnits).toBe(
      first.routes[0]?.deliveredAmount.minorUnits,
    );
    expect(second.routeExplanation).toBe(first.routeExplanation);
  });

  it('excludes a DEX quote past its short expiry while ranking a still-valid FX quote', async () => {
    const clock = new FixedClock('2026-03-01T12:00:45.000Z');
    const result = await router(
      [
        new StubFinancialProvider(
          { id: 'dex', name: 'Amm Pool', rail: 'dex_liquidity' },
          buildNormalizedQuote({
            providerId: 'dex',
            timestamp: '2026-03-01T12:00:00.000Z',
            expiresAt: '2026-03-01T12:00:30.000Z',
            indicatedRate: '1298',
          }),
          'USD',
          'KRW',
          true,
        ),
        new StubFinancialProvider(
          { id: 'bank', name: 'Northgate Bank', rail: 'bank_fx' },
          buildNormalizedQuote({
            providerId: 'bank',
            timestamp: '2026-03-01T12:00:00.000Z',
            expiresAt: '2026-03-01T12:02:00.000Z',
            indicatedRate: '1290',
          }),
          'USD',
          'KRW',
          true,
        ),
      ],
      { clock },
    ).evaluate({
      organizationId: null,
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amountMinorUnits: '10000000',
      weights: null,
      actor: 'test',
      requestId: 'req_freshness',
    });

    expect(result.routes.map((route) => route.provider.id)).toEqual(['bank']);
    expect(result.providerFailures.some((failure) => failure.providerId === 'dex')).toBe(true);
    expect(result.providerFailures.find((failure) => failure.providerId === 'dex')?.code).toBe(
      'QUOTE_EXPIRED',
    );
  });

  it('records quote age in comparison metadata for tradfi, stablecoin, and DeFi rails', async () => {
    const clock = new FixedClock('2026-03-01T12:00:08.000Z');
    const result = await router(
      [
        new StubFinancialProvider(
          { id: 'bank', name: 'Northgate Bank', rail: 'bank_fx' },
          buildNormalizedQuote({
            providerId: 'bank',
            timestamp: '2026-03-01T12:00:00.000Z',
            expiresAt: '2026-03-01T12:02:00.000Z',
          }),
          'USD',
          'KRW',
          true,
        ),
        new StubFinancialProvider(
          { id: 'solstice', name: 'Solstice', rail: 'stablecoin_settlement' },
          buildNormalizedQuote({
            providerId: 'solstice',
            timestamp: '2026-03-01T12:00:03.000Z',
            expiresAt: '2026-03-01T12:00:48.000Z',
            intermediaryAsset: 'USDC',
          }),
          'USD',
          'KRW',
          true,
        ),
        new StubFinancialProvider(
          { id: 'dex', name: 'Amm Pool', rail: 'dex_liquidity' },
          buildNormalizedQuote({
            providerId: 'dex',
            timestamp: '2026-03-01T12:00:06.000Z',
            expiresAt: '2026-03-01T12:00:18.000Z',
          }),
          'USD',
          'KRW',
          true,
        ),
      ],
      { clock },
    ).evaluate({
      organizationId: null,
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amountMinorUnits: '10000000',
      weights: null,
      actor: 'test',
      requestId: 'req_ages',
    });

    const ages = Object.fromEntries(
      result.routes.map((route) => [route.provider.id, route.quoteFreshness]),
    );
    expect(ages['bank']?.ageMs).toBe(8_000);
    expect(ages['bank']?.ageSeconds).toBe('8');
    expect(ages['bank']?.state).toBe('fresh');
    expect(ages['solstice']?.ageMs).toBe(5_000);
    expect(ages['solstice']?.ageSeconds).toBe('5');
    expect(ages['dex']?.ageMs).toBe(2_000);
    expect(ages['dex']?.ageSeconds).toBe('2');
    expect(result.routes.every((route) => route.quote.timestamp && route.quote.expiresAt)).toBe(
      true,
    );
  });

  it('excludes a financial provider whose linked execution partner cannot cover the corridor', async () => {
    const mismatch: ExecutionPartner = {
      kind: 'sandbox_mock',
      descriptor: buildProviderDescriptor({ id: 'sandbox-partner-yen-only' }),
      capabilities: {
        partnerId: 'sandbox-partner-yen-only',
        kind: 'sandbox_mock',
        rail: 'bank_fx',
        quotedProviderId: 'restricted-bank',
        corridors: [{ source: 'JPY', destination: 'INR' }],
        currencies: ['JPY', 'INR'],
        minAmountMinorUnits: '0',
        maxAmountMinorUnits: '100000000000',
        maxAmountAsset: 'JPY',
        operatingHours: ALWAYS_OPEN_HOURS,
        licenses: ['sandbox_mock'],
        sandbox: true,
        live: false,
      },
      quote: () => Promise.reject(new Error('unused')),
      dispatchInstruction: () => Promise.reject(new Error('unused')),
      getExecutionStatus: () => Promise.reject(new Error('unused')),
      handleWebhook: () => Promise.reject(new Error('unused')),
    };

    const result = await router(
      [
        new StubFinancialProvider(
          { id: 'restricted-bank', name: 'Restricted Bank', rail: 'bank_fx' },
          buildNormalizedQuote({ providerId: 'restricted-bank' }),
          'USD',
          'KRW',
        ),
        new StubFinancialProvider(
          { id: 'open-bank', name: 'Open Bank', rail: 'bank_fx' },
          buildNormalizedQuote({ providerId: 'open-bank', indicatedRate: '1294' }),
          'USD',
          'KRW',
        ),
      ],
      { executionPartners: ExecutionPartnerRegistry.create([mismatch], { liveEnabled: false }) },
    ).evaluate({
      organizationId: 'org_demo',
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amountMinorUnits: '10000000',
      weights: null,
      actor: 'test',
      requestId: 'req_cap',
    });

    expect(result.routes.map((route) => route.provider.id)).toEqual(['open-bank']);
  });
});
