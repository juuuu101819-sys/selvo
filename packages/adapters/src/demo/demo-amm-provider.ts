import {
  ASSET_REGISTRY,
  Dec,
  UnsupportedCorridorError,
  assetDefinition,
  conversionKindOf,
  type AssetDefinition,
  type CurrencyCode,
  type DeFiLiquiditySource,
  type DeFiVenueKind,
  type DexDepthQuote,
  type DexDepthRequest,
  type LiquidityInfo,
  type NormalizedFee,
  type NormalizedQuote,
  type NormalizedQuoteRequest,
  type ProviderCapabilityProfile,
  type ProviderContext,
  type ProviderDescriptor,
  type ProviderHealth,
  type SettlementEstimate,
  type SlippageModel,
} from '@meridian/core';
import { addSeconds, invertRate } from './demo-time.js';
import {
  liquidityFromQuote,
  requireNamedFee,
  slippageFromQuote,
  supportedDefiChains,
} from './defi-source.js';

interface PairRate {
  readonly offered: string;
  readonly mid: string;
}

const PAIRS: Readonly<Record<string, PairRate>> = {
  'ETH/USDC': { offered: '3492', mid: '3500' },
  'USDC/ETH': { offered: invertRate('3492'), mid: invertRate('3500') },
  'ETH/USDT': { offered: '3490', mid: '3498' },
  'USDT/ETH': { offered: invertRate('3490'), mid: invertRate('3498') },
  'USDC/USDT': { offered: '0.9996', mid: '1' },
  'USDT/USDC': { offered: '0.9998', mid: '1' },
};

const PROFILE: ProviderCapabilityProfile = {
  category: 'defi',
  features: ['defi', 'swap', 'on_chain', 'stablecoin', 'amm'],
  conversionKinds: ['stablecoin_stablecoin', 'stablecoin_crypto', 'crypto_stablecoin'],
  rails: ['dex_liquidity'],
};

const SETTLEMENT: SettlementEstimate = {
  p50Seconds: 12,
  p95Seconds: 60,
  businessDaysOnly: false,
  cutoffUtc: null,
  notes: 'Indicative on-chain confirmation time. Meridian does not submit the swap.',
};

const POOL_FEE: NormalizedFee = {
  code: 'pool_fee',
  label: 'AMM pool fee',
  side: 'source',
  kind: 'proportional',
  asset: 'USDC',
  amountMinorUnits: null,
  rateBps: '5',
};

/**
 * Demo AMM. Read-only depth and quotes. No keys, no swaps, no custody.
 */
export class DemoAmmProvider implements DeFiLiquiditySource {
  readonly capability = 'financial' as const;
  readonly venueKind: DeFiVenueKind = 'amm';
  readonly descriptor: ProviderDescriptor = {
    id: 'demo-meridian-pool',
    name: 'Meridian Pool',
    rail: 'dex_liquidity',
    licensing: 'unlicensed_sandbox',
    modes: ['sandbox'],
    jurisdictions: ['*'],
    description:
      'Demo constant-product AMM. Read-only quotes for stablecoin and ETH pairs. No swaps are submitted.',
    pricingVersion: 'demo-amm-1',
  };

  getCapabilities(): ProviderCapabilityProfile {
    return PROFILE;
  }

  getSupportedAssets(): readonly AssetDefinition[] {
    return ['ETH', 'USDC', 'USDT']
      .map((code) => ASSET_REGISTRY[code])
      .filter((asset): asset is AssetDefinition => asset !== undefined);
  }

  getSupportedCurrencies(): readonly CurrencyCode[] {
    return [];
  }

  getSupportedTokens(): readonly AssetDefinition[] {
    return this.getSupportedAssets();
  }

  getSupportedChains() {
    return supportedDefiChains();
  }

  supportsNormalized(request: NormalizedQuoteRequest): boolean {
    return pairOf(request.sourceAsset, request.targetAsset) !== undefined;
  }

  supportsDepth(request: DexDepthRequest): boolean {
    return pairOf(request.baseAsset, request.quoteAsset) !== undefined;
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
      quoteReference: `amm_${request.sourceAsset}_${request.targetAsset}`,
      conversionKind: conversionKindOf(request.sourceAsset, request.targetAsset),
      sourceAsset: request.sourceAsset,
      targetAsset: request.targetAsset,
      amountMinorUnits: request.amountMinorUnits,
      indicatedRate: pair.offered,
      midMarketRate: pair.mid,
      fees: [...ammFees(request.sourceAsset, request.targetAsset)],
      settlement: SETTLEMENT,
      liquidity: depthOf(request.sourceAsset),
      slippage: {
        kind: 'tiered',
        notionalCurrency: 'USD',
        tiers: [
          { upToNotionalMinorUnits: '10000000', bps: '4' },
          { upToNotionalMinorUnits: null, bps: '18' },
        ],
      },
      reliabilityScore: '0.961',
      executable: false,
      chainId: assetDefinition(request.sourceAsset).chainId,
      metadata: {
        venue: 'amm',
        holdPrivateKeys: false,
        submitTransaction: false,
      },
    };
  }

  async getDepth(request: DexDepthRequest, context: ProviderContext): Promise<DexDepthQuote> {
    await Promise.resolve();
    const pair = pairOf(request.baseAsset, request.quoteAsset);
    if (pair === undefined) {
      throw new UnsupportedCorridorError(request.baseAsset, request.quoteAsset);
    }
    const now = context.clock.nowIso();
    return {
      providerId: this.descriptor.id,
      timestamp: now,
      expiresAt: addSeconds(now, 30),
      quoteReference: `depth_${request.baseAsset}_${request.quoteAsset}`,
      baseAsset: request.baseAsset,
      quoteAsset: request.quoteAsset,
      chainId: request.chainId ?? assetDefinition(request.baseAsset).chainId,
      midMarketRate: pair.mid,
      indicatedRate: pair.offered,
      availableDepthMinorUnits: depthOf(request.baseAsset).availableDepthMinorUnits,
      venue: this.descriptor.name,
      metadata: { holdPrivateKeys: false, submitTransaction: false },
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
    return [...ammFees(request.sourceAsset, request.targetAsset)];
  }

  async getLiquidityInfo(
    request: NormalizedQuoteRequest,
    _context: ProviderContext,
  ): Promise<LiquidityInfo> {
    await Promise.resolve();
    this.assertSupported(request);
    return depthOf(request.sourceAsset);
  }

  async getLiquidity(
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ): Promise<LiquidityInfo> {
    return liquidityFromQuote((inner, ctx) => this.getQuote(inner, ctx), request, context);
  }

  async getSwapFee(
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ): Promise<NormalizedFee> {
    const fees = await this.getFees(request, context);
    return requireNamedFee(fees, 'pool_fee', request.sourceAsset, request.targetAsset);
  }

  async getEstimatedSlippage(
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ): Promise<SlippageModel> {
    return slippageFromQuote((inner, ctx) => this.getQuote(inner, ctx), request, context);
  }

  async getNetworkFee(
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ): Promise<NormalizedFee> {
    const fees = await this.getFees(request, context);
    return requireNamedFee(fees, 'gas', request.sourceAsset, request.targetAsset);
  }

  probe(context: ProviderContext): Promise<ProviderHealth> {
    return Promise.resolve({
      providerId: this.descriptor.id,
      state: 'up',
      checkedAt: context.clock.nowIso(),
      latencyMs: 0,
      detail: 'demo amm',
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

function depthOf(source: string): LiquidityInfo {
  const exponent = assetDefinition(source).exponent;
  const depth = new Dec(10).pow(exponent).times(5_000_000);
  return {
    availableDepthMinorUnits: depth.toFixed(0),
    venue: 'Meridian Pool',
    chainId: assetDefinition(source).chainId,
  };
}

function ammFees(source: string, target: string): readonly NormalizedFee[] {
  return [
    { ...POOL_FEE, asset: source },
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

function gasMinorUnits(asset: string): string {
  if (asset === 'ETH') {
    return '20000000000000';
  }
  const exponent = assetDefinition(asset).exponent;
  return new Dec(10).pow(exponent).times('0.05').toFixed(0);
}
