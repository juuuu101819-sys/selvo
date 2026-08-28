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
import { DefiRouter } from './defi-routing.js';

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

class StubVenue implements FinancialProvider {
  readonly capability = 'financial' as const;
  readonly venueKind;
  readonly descriptor;

  constructor(
    private readonly source: string,
    private readonly target: string,
    private readonly indicatedRate: string,
    options: { readonly id: string; readonly name: string; readonly venueKind: 'dex' | 'amm' | 'aggregator' },
  ) {
    this.venueKind = options.venueKind;
    this.descriptor = buildProviderDescriptor({
      id: options.id,
      name: options.name,
      rail: 'dex_liquidity',
    });
  }

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
      conversionKind: this.source === 'ETH' ? 'crypto_stablecoin' : 'stablecoin_stablecoin',
      indicatedRate: this.indicatedRate,
      midMarketRate: this.source === 'ETH' ? '3500' : '1',
      amountMinorUnits: request.amountMinorUnits,
      timestamp: request.requestedAt,
      expiresAt: new Date(Date.parse(request.requestedAt) + 120_000).toISOString(),
      fees: [
        {
          code: 'swap',
          label: 'Swap fee',
          side: 'source',
          kind: 'proportional',
          asset: this.source,
          amountMinorUnits: null,
          rateBps: '5',
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

class StubFx implements FinancialProvider {
  readonly capability = 'financial' as const;
  readonly descriptor = buildProviderDescriptor({
    id: 'bank',
    name: 'Demo Bank',
    rail: 'bank_fx',
  });

  getCapabilities() {
    return defaultProfileForRail('bank_fx');
  }

  getSupportedAssets() {
    return [];
  }

  getSupportedCurrencies() {
    return [];
  }

  supportsNormalized(request: NormalizedQuoteRequest): boolean {
    return request.sourceAsset === 'USD' && request.targetAsset === 'KRW';
  }

  async getQuote(request: NormalizedQuoteRequest, _context: ProviderContext) {
    await Promise.resolve();
    if (!this.supportsNormalized(request)) {
      throw new UnsupportedCorridorError(request.sourceAsset, request.targetAsset);
    }
    return buildNormalizedQuote({
      providerId: this.descriptor.id,
      sourceAsset: 'USD',
      targetAsset: 'KRW',
      conversionKind: 'fiat_fiat',
      indicatedRate: '1380',
      midMarketRate: '1385',
      amountMinorUnits: request.amountMinorUnits,
      timestamp: request.requestedAt,
      expiresAt: new Date(Date.parse(request.requestedAt) + 120_000).toISOString(),
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

class StubRamp implements FinancialProvider {
  readonly capability = 'financial' as const;
  readonly descriptor = buildProviderDescriptor({
    id: 'ramp',
    name: 'Demo Ramp',
    rail: 'stablecoin_settlement',
  });

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
    return request.sourceAsset === 'USD' && request.targetAsset === 'KRW';
  }

  async getQuote(request: NormalizedQuoteRequest, _context: ProviderContext) {
    await Promise.resolve();
    return buildNormalizedQuote({
      providerId: this.descriptor.id,
      sourceAsset: 'USD',
      targetAsset: 'KRW',
      conversionKind: 'fiat_fiat',
      indicatedRate: '1382',
      midMarketRate: '1385',
      amountMinorUnits: request.amountMinorUnits,
      timestamp: request.requestedAt,
      expiresAt: new Date(Date.parse(request.requestedAt) + 120_000).toISOString(),
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

function router(providers: readonly FinancialProvider[]): DefiRouter {
  return new DefiRouter({
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

describe('DefiRouter', () => {
  it('ranks DEX, AMM and aggregator quotes for USDC → USDT without executing a swap', async () => {
    const result = await router([
      new StubVenue('USDC', 'USDT', '0.9995', { id: 'dex', name: 'DEX', venueKind: 'dex' }),
      new StubVenue('USDC', 'USDT', '0.9996', { id: 'amm', name: 'AMM', venueKind: 'amm' }),
      new StubVenue('USDC', 'USDT', '0.9998', { id: 'agg', name: 'Agg', venueKind: 'aggregator' }),
    ]).evaluate({
      organizationId: null,
      sourceAsset: 'USDC',
      destinationAsset: 'USDT',
      amountMinorUnits: '10000000',
      actor: 'test',
      requestId: 'req_1',
    });

    expect(result.defiRoutingEngineVersion).toBe('1.0.0');
    expect(result.conversionKind).toBe('stablecoin_stablecoin');
    expect(result.swapSubmitted).toBe(false);
    expect(result.executable).toBe(false);
    expect(result.walletsConnected).toBe(false);
    expect(result.privateKeysGenerated).toBe(false);
    expect(result.custody).toBe(false);
    expect(result.connectedToMainnet).toBe(false);
    expect(result.routes.map((route) => route.routeKind).sort()).toEqual([
      'aggregator',
      'amm',
      'dex',
    ]);
    expect(result.recommendedExecutionRoute?.routeId).toBe(result.recommendedRoute?.routeId);
    expect(result.recommendedExecutionRoute?.executable).toBe(false);
    expect(result.recommendedRoute?.swapFee.asset).toBe('USDT');
    expect(result.recommendedRoute?.networkFee.asset).toBe('USDT');
    expect(result.recommendedRoute?.estimatedSlippage.bps).toBeDefined();
    expect(result.recommendedRoute?.liquidity.availableDepthMinorUnits).toBe('5000000000000');
    expect(result.comparedFamilies).toEqual(['defi']);
  });

  it('quotes ETH → USDC on a DeFi venue', async () => {
    const result = await router([
      new StubVenue('ETH', 'USDC', '3492', { id: 'amm', name: 'AMM', venueKind: 'amm' }),
    ]).evaluate({
      organizationId: null,
      sourceAsset: 'ETH',
      destinationAsset: 'USDC',
      amountMinorUnits: '1000000000000000000',
      actor: 'test',
      requestId: 'req_2',
    });
    expect(result.conversionKind).toBe('crypto_stablecoin');
    expect(result.routes[0]?.asset).toEqual({ source: 'ETH', destination: 'USDC' });
    expect(result.routes[0]?.chain.destination?.id).toBe('eip155:1');
    expect(result.routes[0]?.chain.destination?.connected).toBe(false);
  });

  it('compares traditional FX and stablecoin ramps on USD → KRW when no DEX quotes the pair', async () => {
    const result = await router([new StubFx(), new StubRamp()]).evaluate({
      organizationId: 'org_demo',
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amountMinorUnits: '10000000',
      actor: 'test',
      requestId: 'req_3',
    });
    expect(result.comparedFamilies).toEqual(['stablecoin', 'traditional']);
    expect(result.routes.map((route) => route.routeKind).sort()).toEqual([
      'stablecoin',
      'traditional',
    ]);
    expect(result.routes.every((route) => route.venueKind === null)).toBe(true);
    expect(result.executable).toBe(false);
  });
});
