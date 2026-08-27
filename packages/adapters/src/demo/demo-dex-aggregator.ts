import {
  ASSET_REGISTRY,
  Dec,
  UnsupportedCorridorError,
  assetDefinition,
  conversionKindOf,
  type AssetDefinition,
  type CurrencyCode,
  type FinancialProvider,
  type LiquidityInfo,
  type NormalizedFee,
  type NormalizedQuote,
  type NormalizedQuoteRequest,
  type ProviderCapabilityProfile,
  type ProviderContext,
  type ProviderDescriptor,
  type ProviderHealth,
  type SettlementEstimate,
} from '@meridian/core';
import { addSeconds, invertRate } from './demo-time.js';

interface PairRate {
  readonly offered: string;
  readonly mid: string;
  readonly composite: boolean;
}

const PAIRS: Readonly<Record<string, PairRate>> = {
  'ETH/USDC': { offered: '3498', mid: '3500', composite: false },
  'USDC/ETH': { offered: invertRate('3498'), mid: invertRate('3500'), composite: false },
  'ETH/USDT': { offered: '3496', mid: '3498', composite: false },
  'USDT/ETH': { offered: invertRate('3496'), mid: invertRate('3498'), composite: false },
  'USDC/USDT': { offered: '0.9998', mid: '1', composite: false },
  'USDT/USDC': { offered: '0.9999', mid: '1', composite: false },
  // Indicative composite: crypto → fiat via a stablecoin. Not executed.
  'ETH/USD': { offered: '3493', mid: '3500', composite: true },
  'USD/ETH': { offered: invertRate('3493'), mid: invertRate('3500'), composite: true },
};

const PROFILE: ProviderCapabilityProfile = {
  category: 'defi',
  features: ['defi', 'swap', 'on_chain', 'stablecoin', 'aggregator'],
  conversionKinds: [
    'stablecoin_stablecoin',
    'stablecoin_crypto',
    'crypto_stablecoin',
    'crypto_fiat',
  ],
  rails: ['dex_liquidity'],
};

const SETTLEMENT: SettlementEstimate = {
  p50Seconds: 18,
  p95Seconds: 90,
  businessDaysOnly: false,
  cutoffUtc: null,
  notes: 'Indicative aggregator route. Meridian does not submit, wrap, bridge or swap.',
};

/**
 * Demo DEX aggregator. Read-only. Quotes a tighter AMM-style price and an indicative ETH → USD
 * composite so the normalised quote model can represent `crypto_fiat` without executing it.
 */
export class DemoDexAggregatorProvider implements FinancialProvider {
  readonly capability = 'financial' as const;
  readonly descriptor: ProviderDescriptor = {
    id: 'demo-horizon-aggregator',
    name: 'Horizon Aggregator',
    rail: 'dex_liquidity',
    licensing: 'unlicensed_sandbox',
    modes: ['sandbox'],
    jurisdictions: ['*'],
    description:
      'Demo DEX aggregator. Read-only comparison of on-chain venues. No keys, no swaps, no custody.',
    pricingVersion: 'demo-agg-1',
  };

  getCapabilities(): ProviderCapabilityProfile {
    return PROFILE;
  }

  getSupportedAssets(): readonly AssetDefinition[] {
    return ['ETH', 'USD', 'USDC', 'USDT']
      .map((code) => ASSET_REGISTRY[code])
      .filter((asset): asset is AssetDefinition => asset !== undefined);
  }

  getSupportedCurrencies(): readonly CurrencyCode[] {
    return ['USD'];
  }

  supportsNormalized(request: NormalizedQuoteRequest): boolean {
    return pairOf(request.sourceAsset, request.targetAsset) !== undefined;
  }

  async getQuote(
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ): Promise<NormalizedQuote> {
    await Promise.resolve();
    const pair = pairOf(request.sourceAsset, request.targetAsset);
    if (pair === undefined) {
      throw new UnsupportedCorridorError(request.sourceAsset, request.targetAsset);
    }
    const now = context.clock.nowIso();
    return {
      providerId: this.descriptor.id,
      timestamp: now,
      expiresAt: addSeconds(now, 30),
      quoteReference: `agg_${request.sourceAsset}_${request.targetAsset}`,
      conversionKind: conversionKindOf(request.sourceAsset, request.targetAsset),
      sourceAsset: request.sourceAsset,
      targetAsset: request.targetAsset,
      amountMinorUnits: request.amountMinorUnits,
      indicatedRate: pair.offered,
      midMarketRate: pair.mid,
      fees: [...aggregatorFees(request.sourceAsset, request.targetAsset)],
      settlement: SETTLEMENT,
      liquidity: {
        availableDepthMinorUnits: new Dec(10)
          .pow(assetDefinition(request.sourceAsset).exponent)
          .times(8_000_000)
          .toFixed(0),
        venue: this.descriptor.name,
        chainId: assetDefinition(request.sourceAsset).chainId,
      },
      slippage: { kind: 'none' },
      reliabilityScore: '0.968',
      executable: false,
      chainId: assetDefinition(request.sourceAsset).chainId,
      metadata: {
        venue: 'aggregator',
        composite: pair.composite,
        legs: pair.composite ? ['ETH-USDC', 'USDC-USD'] : ['direct'],
        holdPrivateKeys: false,
        submitTransaction: false,
      },
    };
  }

  async getSettlementEstimate(
    request: NormalizedQuoteRequest,
    _context: ProviderContext,
  ): Promise<SettlementEstimate> {
    await Promise.resolve();
    this.assertSupported(request);
    return SETTLEMENT;
  }

  async getFees(
    request: NormalizedQuoteRequest,
    _context: ProviderContext,
  ): Promise<readonly NormalizedFee[]> {
    await Promise.resolve();
    this.assertSupported(request);
    return [...aggregatorFees(request.sourceAsset, request.targetAsset)];
  }

  async getLiquidityInfo(
    request: NormalizedQuoteRequest,
    _context: ProviderContext,
  ): Promise<LiquidityInfo> {
    await Promise.resolve();
    this.assertSupported(request);
    return {
      availableDepthMinorUnits: new Dec(10)
        .pow(assetDefinition(request.sourceAsset).exponent)
        .times(8_000_000)
        .toFixed(0),
      venue: this.descriptor.name,
      chainId: assetDefinition(request.sourceAsset).chainId,
    };
  }

  probe(context: ProviderContext): Promise<ProviderHealth> {
    return Promise.resolve({
      providerId: this.descriptor.id,
      state: 'up',
      checkedAt: context.clock.nowIso(),
      latencyMs: 0,
      detail: 'demo aggregator',
    });
  }

  private assertSupported(request: NormalizedQuoteRequest): void {
    if (!this.supportsNormalized(request)) {
      throw new UnsupportedCorridorError(request.sourceAsset, request.targetAsset);
    }
  }
}

function pairOf(source: string, target: string): PairRate | undefined {
  return PAIRS[`${source}/${target}`];
}

function aggregatorFees(source: string, target: string): readonly NormalizedFee[] {
  return [
    aggregatorFee(source),
    {
      code: 'gas',
      label: 'Estimated network gas',
      side: 'destination',
      kind: 'fixed',
      asset: target,
      amountMinorUnits: gasMinorUnits(target),
      rateBps: null,
    },
  ];
}

function aggregatorFee(source: string): NormalizedFee {
  return {
    code: 'aggregator_fee',
    label: 'Aggregator routing fee',
    side: 'source',
    kind: 'proportional',
    asset: source,
    amountMinorUnits: null,
    rateBps: '3',
  };
}

function gasMinorUnits(asset: string): string {
  if (asset === 'ETH') {
    return '15000000000000';
  }
  const exponent = assetDefinition(asset).exponent;
  return new Dec(10).pow(exponent).times('0.04').toFixed(0);
}
