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
  type ProviderContext,
  type ProviderHealth,
} from '../ports/index.js';
import { buildNormalizedQuote, buildProviderDescriptor } from '../testing/index.js';
import { FinancialProviderRegistry } from './financial-registry.js';
import { MultiRailCostEngine } from './routing-cost.js';
import { MultiRailRouter } from './routing-engine.js';
import { defaultRoutingWeights } from './routing-config.js';

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
    return { ...this.quote, amountMinorUnits: request.amountMinorUnits };
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
});
