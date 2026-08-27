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
  'ETH/USDC': { offered: '3488', mid: '3500' },
  'USDC/ETH': { offered: invertRate('3488'), mid: invertRate('3500') },
  'ETH/USDT': { offered: '3486', mid: '3498' },
  'USDT/ETH': { offered: invertRate('3486'), mid: invertRate('3498') },
  'USDC/USDT': { offered: '0.9995', mid: '1' },
  'USDT/USDC': { offered: '0.9997', mid: '1' },
};

const PROFILE: ProviderCapabilityProfile = {
  category: 'defi',
  features: ['defi', 'swap', 'on_chain', 'dex'],
  conversionKinds: ['stablecoin_stablecoin', 'stablecoin_crypto', 'crypto_stablecoin'],
  rails: ['dex_liquidity'],
};

const SETTLEMENT: SettlementEstimate = {
  p50Seconds: 15,
  p95Seconds: 75,
  businessDaysOnly: false,
  cutoffUtc: null,
  notes: 'Indicative order-book fill. Meridian does not submit the swap or connect a wallet.',
};

/**
 * Demo order-book DEX. Read-only quotes for USDC/USDT, ETH/USDC and ETH/USDT.
 *
 * Distinct from the AMM (constant-product) and the aggregator. No keys, no swaps, no custody.
 */
export class DemoDexProvider implements DeFiLiquiditySource {
  readonly capability = 'financial' as const;
  readonly venueKind: DeFiVenueKind = 'dex';
  readonly descriptor: ProviderDescriptor = {
    id: 'demo-ridgeline-dex',
    name: 'Ridgeline DEX',
    rail: 'dex_liquidity',
    licensing: 'unlicensed_sandbox',
    modes: ['sandbox'],
    jurisdictions: ['*'],
    description:
      'Demo order-book DEX. Read-only quotes for USDC/USDT and ETH pairs. No swaps are submitted.',
    pricingVersion: 'demo-dex-1',
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
      quoteReference: `dex_${request.sourceAsset}_${request.targetAsset}`,
      conversionKind: conversionKindOf(request.sourceAsset, request.targetAsset),
      sourceAsset: request.sourceAsset,
      targetAsset: request.targetAsset,
      amountMinorUnits: request.amountMinorUnits,
      indicatedRate: pair.offered,
      midMarketRate: pair.mid,
      fees: [...dexFees(request.sourceAsset, request.targetAsset)],
      settlement: SETTLEMENT,
      liquidity: depthOf(request.sourceAsset),
      slippage: { kind: 'none' },
      reliabilityScore: '0.954',
      executable: false,
      chainId: assetDefinition(request.sourceAsset).chainId,
      metadata: {
        venue: 'dex',
        holdPrivateKeys: false,
        submitTransaction: false,
        connectWallet: false,
      },
    };
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
    return requireNamedFee(fees, 'dex_fee', request.sourceAsset, request.targetAsset);
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
    return [...dexFees(request.sourceAsset, request.targetAsset)];
  }

  async getLiquidityInfo(
    request: NormalizedQuoteRequest,
    _context: ProviderContext,
  ): Promise<LiquidityInfo> {
    await Promise.resolve();
    this.assertSupported(request);
    return depthOf(request.sourceAsset);
  }

  probe(context: ProviderContext): Promise<ProviderHealth> {
    return Promise.resolve({
      providerId: this.descriptor.id,
      state: 'up',
      checkedAt: context.clock.nowIso(),
      latencyMs: 0,
      detail: 'demo dex',
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
  const depth = new Dec(10).pow(exponent).times(3_000_000);
  return {
    availableDepthMinorUnits: depth.toFixed(0),
    venue: 'Ridgeline DEX',
    chainId: assetDefinition(source).chainId,
  };
}

function dexFees(source: string, target: string): readonly NormalizedFee[] {
  return [
    {
      code: 'dex_fee',
      label: 'DEX taker fee',
      side: 'source',
      kind: 'proportional',
      asset: source,
      amountMinorUnits: null,
      rateBps: '8',
    },
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
    return '18000000000000';
  }
  const exponent = assetDefinition(asset).exponent;
  return new Dec(10).pow(exponent).times('0.06').toFixed(0);
}
