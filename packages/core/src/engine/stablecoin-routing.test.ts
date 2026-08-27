import { describe, expect, it } from 'vitest';
import { defaultProfileForRail } from '../domain/provider-catalog.js';
import { UnsupportedCorridorError, ValidationError } from '../errors/index.js';
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
import { StablecoinRouter } from './stablecoin-routing.js';

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

class StubRamp implements FinancialProvider {
  readonly capability = 'financial' as const;
  readonly descriptor;

  constructor(
    private readonly source: string,
    private readonly target: string,
    private readonly indicatedRate: string,
    id = 'ramp',
  ) {
    this.descriptor = buildProviderDescriptor({
      id,
      name: 'Demo Ramp',
      rail: 'stablecoin_settlement',
    });
  }

  getCapabilities() {
    return defaultProfileForRail('stablecoin_settlement');
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
    if (!this.supportsNormalized(request)) {
      throw new UnsupportedCorridorError(request.sourceAsset, request.targetAsset);
    }
    return buildNormalizedQuote({
      providerId: this.descriptor.id,
      sourceAsset: this.source,
      targetAsset: this.target,
      conversionKind: this.source === 'USD' ? 'fiat_stablecoin' : 'stablecoin_fiat',
      indicatedRate: this.indicatedRate,
      midMarketRate: '1',
      amountMinorUnits: request.amountMinorUnits,
      fees: [
        {
          code: 'ramp',
          label: 'Ramp fee',
          side: 'source',
          kind: 'proportional',
          asset: this.source,
          amountMinorUnits: null,
          rateBps: '6',
        },
      ],
      liquidityDepth: '5000000000000',
    });
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

class StubPool implements FinancialProvider {
  readonly capability = 'financial' as const;
  readonly descriptor = buildProviderDescriptor({
    id: 'pool',
    name: 'Demo Pool',
    rail: 'dex_liquidity',
  });

  getCapabilities() {
    return defaultProfileForRail('dex_liquidity');
  }

  getSupportedAssets() {
    return [];
  }

  getSupportedCurrencies() {
    return [];
  }

  supportsNormalized(request: NormalizedQuoteRequest): boolean {
    return request.sourceAsset === 'USDC' && request.targetAsset === 'USDT';
  }

  async getQuote(request: NormalizedQuoteRequest, _context: ProviderContext) {
    await Promise.resolve();
    if (!this.supportsNormalized(request)) {
      throw new UnsupportedCorridorError(request.sourceAsset, request.targetAsset);
    }
    return buildNormalizedQuote({
      providerId: 'pool',
      sourceAsset: 'USDC',
      targetAsset: 'USDT',
      conversionKind: 'stablecoin_stablecoin',
      indicatedRate: '0.9996',
      midMarketRate: '1',
      amountMinorUnits: request.amountMinorUnits,
      slippage: {
        kind: 'tiered',
        notionalCurrency: 'USD',
        tiers: [{ upToNotionalMinorUnits: null, bps: '4' }],
      },
      liquidityDepth: '8000000000000',
    });
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

function router(providers: readonly FinancialProvider[]): StablecoinRouter {
  return new StablecoinRouter({
    mode: 'sandbox',
    registry: FinancialProviderRegistry.create('sandbox', providers),
    costEngine: new MultiRailCostEngine(),
    clock: new FixedClock('2026-05-01T09:00:00.000Z'),
    ids: new SequentialIdGenerator(),
    auditLogger: new RecordingAuditLogger(),
    logger: noopLogger,
    providerTimeoutMs: 1_000,
  });
}

describe('StablecoinRouter', () => {
  it('quotes FIAT → STABLECOIN with the stablecoin quote fields and no custody', async () => {
    const result = await router([new StubRamp('USD', 'USDC', '0.9994')]).evaluate({
      organizationId: 'org_demo',
      sourceAsset: 'USD',
      destinationAsset: 'USDC',
      amountMinorUnits: '10000000',
      actor: 'test',
      requestId: 'req_1',
    });

    expect(result.conversionKind).toBe('fiat_stablecoin');
    expect(result.stablecoinRoutingEngineVersion).toBe('1.0.0');
    expect(result.custody).toBe(false);
    expect(result.connectedToMainnet).toBe(false);
    expect(result.walletsCreated).toBe(false);
    expect(result.privateKeysGenerated).toBe(false);
    expect(result.executable).toBe(false);
    expect(result.aiUsed).toBe(false);
    const route = result.recommendedRoute;
    expect(route?.asset).toEqual({ source: 'USD', destination: 'USDC' });
    expect(route?.chain.destination?.id).toBe('eip155:1');
    expect(route?.chain.destination?.connected).toBe(false);
    expect(route?.price.indicated.toFixed()).toBe('0.9994');
    expect(route?.providerFee.asset).toBe('USDC');
    expect(route?.networkFee.asset).toBe('USDC');
    expect(route?.slippage.bps).toBeDefined();
    expect(route?.liquidity.availableDepthMinorUnits).toBe('5000000000000');
    expect(route?.estimatedSettlementTime.p50Seconds).toBeGreaterThan(0);
    expect(route?.expiration).toBe('2026-01-01T00:02:00.000Z');
  });

  it('quotes STABLECOIN → FIAT', async () => {
    const result = await router([new StubRamp('USDT', 'USD', '0.9991')]).evaluate({
      organizationId: null,
      sourceAsset: 'USDT',
      destinationAsset: 'USD',
      amountMinorUnits: '1000000',
      actor: 'test',
      requestId: 'req_2',
    });
    expect(result.conversionKind).toBe('stablecoin_fiat');
    expect(result.routes[0]?.asset).toEqual({ source: 'USDT', destination: 'USD' });
    expect(result.routes[0]?.chain.source?.id).toBe('eip155:1');
  });

  it('quotes STABLECOIN → STABLECOIN without hardcoding USDC vs USDT in the engine', async () => {
    const result = await router([new StubPool()]).evaluate({
      organizationId: null,
      sourceAsset: 'USDC',
      destinationAsset: 'USDT',
      amountMinorUnits: '10000000',
      actor: 'test',
      requestId: 'req_3',
    });
    expect(result.conversionKind).toBe('stablecoin_stablecoin');
    expect(result.routes[0]?.asset).toEqual({ source: 'USDC', destination: 'USDT' });
    expect(result.routes[0]?.slippage.model.kind).toBe('tiered');
  });

  it('refuses fiat → fiat and crypto pairs', async () => {
    const instance = router([new StubRamp('USD', 'USDC', '0.9994')]);
    await expect(
      instance.evaluate({
        organizationId: null,
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amountMinorUnits: '10000000',
        actor: 'test',
        requestId: 'req_4',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      instance.evaluate({
        organizationId: null,
        sourceAsset: 'USDC',
        destinationAsset: 'ETH',
        amountMinorUnits: '1000000',
        actor: 'test',
        requestId: 'req_5',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
