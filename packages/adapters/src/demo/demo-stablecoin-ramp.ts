import {
  ASSET_REGISTRY,
  Dec,
  UnsupportedCorridorError,
  assetDefinition,
  conversionKindOf,
  isStablecoinAsset,
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
  isCurrencyCode,
} from '@meridian/core';
import { addSeconds, invertRate } from './demo-time.js';

const PROFILE: ProviderCapabilityProfile = {
  category: 'stablecoin',
  features: ['stablecoin', 'settlement', 'on_off_ramp'],
  conversionKinds: ['fiat_stablecoin', 'stablecoin_fiat'],
  rails: ['stablecoin_settlement'],
};

/** Offered units of stablecoin per 1 unit of fiat. Keyed by stablecoin, then fiat — not by ticker in control flow. */
const ON_RAMP: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  USDC: { USD: '0.9994', EUR: '1.0840', GBP: '1.2680' },
  USDT: { USD: '0.9992', EUR: '1.0836', GBP: '1.2675' },
};

const KRW_OFF_RAMP: Readonly<Record<string, { readonly offered: string; readonly mid: string }>> = {
  USDC: { offered: '1374.2', mid: '1380' },
};

const SETTLEMENT: SettlementEstimate = {
  p50Seconds: 900,
  p95Seconds: 3_600,
  businessDaysOnly: false,
  cutoffUtc: null,
  notes: 'Licensed partner on/off-ramp. Indicative; Meridian never holds the stablecoin.',
};

const KRW_SETTLEMENT: SettlementEstimate = {
  p50Seconds: 1_200,
  p95Seconds: 3_600,
  businessDaysOnly: false,
  cutoffUtc: null,
  notes: 'Demo USDC → KRW off-ramp via a licensed partner. Indicative; Meridian never holds USDC.',
};

/**
 * Demo licensed-style stablecoin ramp.
 *
 * Quotes fiat ↔ registered stablecoins (USDC and USDT today). Coverage is a rate table, not a
 * branch in the routing engine: adding a stablecoin is a registry row plus a table row. It does
 * not mint, burn, custody or pay out.
 */
export class DemoStablecoinRampProvider implements FinancialProvider {
  readonly capability = 'financial' as const;
  readonly descriptor: ProviderDescriptor = {
    id: 'demo-helios-ramp',
    name: 'Helios Ramp',
    rail: 'stablecoin_settlement',
    licensing: 'unlicensed_sandbox',
    modes: ['sandbox'],
    jurisdictions: ['*'],
    description:
      'Demo fiat ↔ USDC/USDT on/off-ramp. Indicative quotes only; settlement is delegated to a licensed partner.',
    pricingVersion: 'demo-ramp-1',
  };

  getCapabilities(): ProviderCapabilityProfile {
    return PROFILE;
  }

  getSupportedAssets(): readonly AssetDefinition[] {
    return ['USD', 'EUR', 'GBP', 'KRW', 'USDC', 'USDT']
      .map((code) => ASSET_REGISTRY[code])
      .filter((asset): asset is AssetDefinition => asset !== undefined);
  }

  getSupportedCurrencies(): readonly CurrencyCode[] {
    return ['EUR', 'GBP', 'KRW', 'USD'];
  }

  supportsNormalized(request: NormalizedQuoteRequest): boolean {
    return rateOf(request.sourceAsset, request.targetAsset) !== null;
  }

  async getQuote(
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ): Promise<NormalizedQuote> {
    await Promise.resolve();
    const rate = rateOf(request.sourceAsset, request.targetAsset);
    if (rate === null) {
      throw new UnsupportedCorridorError(request.sourceAsset, request.targetAsset);
    }
    const now = context.clock.nowIso();
    const fees: NormalizedFee[] = [
      {
        code: 'ramp_spread',
        label: 'On/off-ramp spread',
        side: 'source',
        kind: 'proportional',
        asset: request.sourceAsset,
        amountMinorUnits: null,
        rateBps: '6',
      },
      networkFeeOf(request.targetAsset),
    ];
    return {
      providerId: this.descriptor.id,
      timestamp: now,
      expiresAt: addSeconds(now, 120),
      quoteReference: `ramp_${request.sourceAsset}_${request.targetAsset}`,
      conversionKind: conversionKindOf(request.sourceAsset, request.targetAsset),
      sourceAsset: request.sourceAsset,
      targetAsset: request.targetAsset,
      amountMinorUnits: request.amountMinorUnits,
      indicatedRate: rate,
      midMarketRate: midOf(request.sourceAsset, request.targetAsset),
      fees,
      settlement: settlementOf(request.sourceAsset, request.targetAsset),
      liquidity: {
        availableDepthMinorUnits: '20000000000000',
        venue: this.descriptor.name,
        chainId: assetDefinition(
          isStablecoinAsset(request.targetAsset) ? request.targetAsset : request.sourceAsset,
        ).chainId,
      },
      slippage: { kind: 'none' },
      reliabilityScore: '0.982',
      executable: false,
      chainId: assetDefinition(request.targetAsset).chainId,
      metadata: { pricingVersion: this.descriptor.pricingVersion, mintOrBurn: false },
    };
  }

  async getSettlementEstimate(
    request: NormalizedQuoteRequest,
    _context: ProviderContext,
  ): Promise<SettlementEstimate> {
    await Promise.resolve();
    if (!this.supportsNormalized(request)) {
      throw new UnsupportedCorridorError(request.sourceAsset, request.targetAsset);
    }
    return settlementOf(request.sourceAsset, request.targetAsset);
  }

  async getFees(
    request: NormalizedQuoteRequest,
    _context: ProviderContext,
  ): Promise<readonly NormalizedFee[]> {
    await Promise.resolve();
    if (!this.supportsNormalized(request)) {
      throw new UnsupportedCorridorError(request.sourceAsset, request.targetAsset);
    }
    return [
      {
        code: 'ramp_spread',
        label: 'On/off-ramp spread',
        side: 'source',
        kind: 'proportional',
        asset: request.sourceAsset,
        amountMinorUnits: null,
        rateBps: '6',
      },
      networkFeeOf(request.targetAsset),
    ];
  }

  async getLiquidityInfo(
    request: NormalizedQuoteRequest,
    _context: ProviderContext,
  ): Promise<LiquidityInfo> {
    await Promise.resolve();
    if (!this.supportsNormalized(request)) {
      throw new UnsupportedCorridorError(request.sourceAsset, request.targetAsset);
    }
    return {
      availableDepthMinorUnits: '20000000000000',
      venue: this.descriptor.name,
      chainId: assetDefinition(
        isStablecoinAsset(request.targetAsset) ? request.targetAsset : request.sourceAsset,
      ).chainId,
    };
  }

  probe(context: ProviderContext): Promise<ProviderHealth> {
    return Promise.resolve({
      providerId: this.descriptor.id,
      state: 'up',
      checkedAt: context.clock.nowIso(),
      latencyMs: 0,
      detail: 'demo ramp',
    });
  }
}

function rateOf(source: string, target: string): string | null {
  const krw = krwRate(source, target);
  if (krw !== null) {
    return krw;
  }
  if (isStablecoinAsset(target) && isCurrencyCode(source)) {
    return ON_RAMP[target]?.[source] ?? null;
  }
  if (isStablecoinAsset(source) && isCurrencyCode(target)) {
    const onRamp = ON_RAMP[source]?.[target];
    return onRamp === undefined
      ? null
      : new Dec(1).div(new Dec(onRamp)).toSignificantDigits(12).toFixed();
  }
  return null;
}

function krwRate(source: string, target: string): string | null {
  if (target === 'KRW' && isStablecoinAsset(source)) {
    return KRW_OFF_RAMP[source]?.offered ?? null;
  }
  if (source === 'KRW' && isStablecoinAsset(target)) {
    const offered = KRW_OFF_RAMP[target]?.offered;
    return offered === undefined ? null : invertRate(offered);
  }
  return null;
}

function midOf(source: string, target: string): string {
  if (target === 'KRW' && isStablecoinAsset(source)) {
    return KRW_OFF_RAMP[source]?.mid ?? rateOf(source, target) ?? '1';
  }
  if (source === 'KRW' && isStablecoinAsset(target)) {
    const mid = KRW_OFF_RAMP[target]?.mid;
    return mid === undefined ? (rateOf(source, target) ?? '1') : invertRate(mid);
  }
  if (source === 'USD' || target === 'USD') {
    return '1';
  }
  return rateOf(source, target) ?? '1';
}

function settlementOf(source: string, target: string): SettlementEstimate {
  if (source === 'KRW' || target === 'KRW') {
    return KRW_SETTLEMENT;
  }
  return SETTLEMENT;
}

function networkFeeOf(target: string): NormalizedFee {
  const exponent = assetDefinition(target).exponent;
  const amount = target === 'KRW' ? '150' : new Dec(10).pow(exponent).times('0.01').toFixed(0);
  return {
    code: 'network',
    label: 'Partner network fee',
    side: 'destination',
    kind: 'fixed',
    asset: target,
    amountMinorUnits: amount,
    rateBps: null,
  };
}
