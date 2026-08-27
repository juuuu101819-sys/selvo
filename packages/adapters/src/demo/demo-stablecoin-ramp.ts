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
  isCurrencyCode,
} from '@meridian/core';
import { addSeconds, invertRate } from './demo-time.js';

const PROFILE: ProviderCapabilityProfile = {
  category: 'stablecoin',
  features: ['stablecoin', 'settlement', 'on_off_ramp'],
  conversionKinds: ['fiat_stablecoin', 'stablecoin_fiat'],
  rails: ['stablecoin_settlement'],
};

/** USDC per 1 unit of fiat (on-ramp offered rate). */
const ON_RAMP: Readonly<Record<string, string>> = {
  USD: '0.9994',
  EUR: '1.0840',
  GBP: '1.2680',
};

const SETTLEMENT: SettlementEstimate = {
  p50Seconds: 900,
  p95Seconds: 3_600,
  businessDaysOnly: false,
  cutoffUtc: null,
  notes: 'Licensed partner on/off-ramp. Indicative; Meridian never holds the stablecoin.',
};

/**
 * Demo licensed-style stablecoin ramp.
 *
 * Quotes fiat ↔ USDC, including a demo USDC ↔ KRW off-ramp so the multi-rail
 * router can price Route C's last mile. It does not mint, burn, custody or pay out.
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
      'Demo fiat ↔ USDC on/off-ramp. Indicative quotes only; settlement is delegated to a licensed partner.',
    pricingVersion: 'demo-ramp-1',
  };

  getCapabilities(): ProviderCapabilityProfile {
    return PROFILE;
  }

  getSupportedAssets(): readonly AssetDefinition[] {
    return ['USD', 'EUR', 'GBP', 'KRW', 'USDC']
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
        availableDepthMinorUnits: null,
        venue: this.descriptor.name,
        chainId: assetDefinition(request.targetAsset).chainId,
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
      availableDepthMinorUnits: null,
      venue: this.descriptor.name,
      chainId: assetDefinition(
        request.targetAsset === 'USDC' ? request.targetAsset : request.sourceAsset,
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
  if (source === 'USDC' && target === 'KRW') {
    return KRW_OFF_RAMP.offered;
  }
  if (source === 'KRW' && target === 'USDC') {
    return invertRate(KRW_OFF_RAMP.offered);
  }
  if (target === 'USDC' && isCurrencyCode(source)) {
    return ON_RAMP[source] ?? null;
  }
  if (source === 'USDC' && isCurrencyCode(target)) {
    const onRamp = ON_RAMP[target];
    return onRamp === undefined
      ? null
      : new Dec(1).div(new Dec(onRamp)).toSignificantDigits(12).toFixed();
  }
  return null;
}

function midOf(source: string, target: string): string {
  if (source === 'USDC' && target === 'KRW') {
    return KRW_OFF_RAMP.mid;
  }
  if (source === 'KRW' && target === 'USDC') {
    return invertRate(KRW_OFF_RAMP.mid);
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

const KRW_OFF_RAMP = { offered: '1374.2', mid: '1380' } as const;

const KRW_SETTLEMENT: SettlementEstimate = {
  p50Seconds: 1_200,
  p95Seconds: 3_600,
  businessDaysOnly: false,
  cutoffUtc: null,
  notes: 'Demo USDC → KRW off-ramp via a licensed partner. Indicative; Meridian never holds USDC.',
};
