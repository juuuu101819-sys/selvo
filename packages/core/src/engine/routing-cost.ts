import type { ProviderCapabilityProfile } from '../domain/provider-catalog.js';
import type { ProviderDescriptor } from '../domain/provider.js';
import type { SettlementEstimate, SlippageModel } from '../domain/quote.js';
import { categoryOfRail } from '../domain/provider-catalog.js';
import { familyOf } from '../domain/rail.js';
import { InvalidAmountError, InvalidProviderQuoteError } from '../errors/index.js';
import {
  Dec,
  type Decimal,
  Rounding,
  type RoundingMode,
  bpsToRatio,
  ratioToBps,
  toDecimal,
} from '../money/index.js';
import { AssetAmount } from '../money/asset-amount.js';
import type { NormalizedFee, NormalizedQuote } from '../ports/financial-provider.js';
import type { QuoteFreshnessView } from '../quotes/quote-freshness.js';
import { quoteFreshnessView, DEFAULT_FRESHNESS_POLICY } from '../quotes/quote-freshness.js';
import { spreadBpsOf } from './platform-pricing.js';
import type {
  ComplianceEligibility,
  PricedMultiRailRoute,
  RoutedAppliedFee,
  RoutingCostBreakdown,
  RoutingFeeBucket,
  RoutingPlatformCharge,
} from './routing-types.js';

const USD_PEGGED = new Set(['USD', 'USDC', 'USDT']);

export type { RoutingConfiguredSurcharge, RoutingPlatformCharge } from './routing-types.js';

export const NO_ROUTING_PLATFORM_CHARGE: RoutingPlatformCharge = {
  ruleId: null,
  markupBps: new Dec(0),
  discountBps: new Dec(0),
  flatFee: null,
  surcharge: null,
};

function defaultQuoteFreshness(quote: NormalizedQuote): QuoteFreshnessView {
  return quoteFreshnessView(quote, Date.parse(quote.timestamp), DEFAULT_FRESHNESS_POLICY);
}

/**
 * Prices one normalised quote against the mid-market benchmark.
 *
 * Same identity as {@link RouteCostEngine}:
 *
 * ```text
 *   benchmark = send × mid
 *   delivered = ((send − sourceFees − platformFees) × indicatedRate × (1 − slippage)) − destFees
 *   totalCost = benchmark − delivered
 * ```
 *
 * Asset-aware: USDC and ETH are first-class, not stuffed into ISO currency codes. Pure: no I/O,
 * no clock, no model.
 */
export class MultiRailCostEngine {
  price(
    quote: NormalizedQuote,
    provider: ProviderDescriptor,
    capabilities: ProviderCapabilityProfile,
    platform: RoutingPlatformCharge = NO_ROUTING_PLATFORM_CHARGE,
    freshness: QuoteFreshnessView | null = null,
  ): PricedMultiRailRoute {
    const source = quote.sourceAsset;
    const dest = quote.targetAsset;
    const sendAmount = AssetAmount.ofMinorUnits(source, quote.amountMinorUnits);
    if (!sendAmount.isPositive()) {
      throw new InvalidAmountError('Send amount must be greater than zero.', {
        amountMinorUnits: quote.amountMinorUnits,
      });
    }

    const indicatedRate = toDecimal(quote.indicatedRate);
    if (!indicatedRate.isFinite() || indicatedRate.lessThanOrEqualTo(0)) {
      throw new InvalidProviderQuoteError(
        quote.providerId,
        'indicatedRate must be a positive finite decimal',
        { indicatedRate: quote.indicatedRate },
      );
    }

    const midMarketRate = toDecimal(quote.midMarketRate ?? quote.indicatedRate);
    if (!midMarketRate.isFinite() || midMarketRate.lessThanOrEqualTo(0)) {
      throw new InvalidProviderQuoteError(
        quote.providerId,
        'midMarketRate must be a positive finite decimal',
        { midMarketRate: quote.midMarketRate },
      );
    }

    const quotedSpreadBps = spreadBpsOf(midMarketRate, indicatedRate);
    const spreadBps = quotedSpreadBps.minus(platform.discountBps);
    const offeredRate = platform.discountBps.isZero()
      ? indicatedRate
      : midMarketRate.times(new Dec(1).minus(bpsToRatio(spreadBps)));

    const benchmarkAmount = applyRate(sendAmount, dest, midMarketRate, Rounding.DOWN);
    if (!benchmarkAmount.isPositive()) {
      throw new InvalidAmountError(
        'Send amount is too small to produce a non-zero benchmark in the destination asset.',
        { sendAmount: sendAmount.toString(), destinationAsset: dest },
      );
    }

    const sourceFees = applyFees({
      fees: quote.fees,
      side: 'source',
      base: sendAmount,
      quote,
      midMarketRate,
    });
    const platformFees = applyPlatformFees(platform, sendAmount);
    const convertible = sendAmount.subtract(sourceFees.total).subtract(platformFees.total);
    if (!convertible.isPositive()) {
      throw new InvalidAmountError(
        `Fees meet or exceed the ${sendAmount.toString()} send amount.`,
        {
          providerId: quote.providerId,
          sendAmount: sendAmount.toJSON(),
        },
      );
    }

    const slippageBps = resolveSlippageBps(quote.slippage, sendAmount, quote, midMarketRate);
    const slippageRetention = new Dec(1).minus(bpsToRatio(slippageBps));
    if (slippageRetention.lessThanOrEqualTo(0)) {
      throw new InvalidProviderQuoteError(
        quote.providerId,
        'slippage of 10,000 bps or more would consume the entire notional',
        { slippageBps: slippageBps.toFixed() },
      );
    }
    const slippageAdjustedRate = offeredRate.times(slippageRetention);
    const grossConverted = applyRate(convertible, dest, slippageAdjustedRate, Rounding.DOWN);

    const destinationFees = applyFees({
      fees: quote.fees,
      side: 'destination',
      base: grossConverted,
      quote,
      midMarketRate,
    });
    const deliveredAmount = grossConverted.subtract(destinationFees.total);
    if (deliveredAmount.isNegative()) {
      throw new InvalidAmountError(
        `Destination fees exceed the converted amount of ${grossConverted.toString()}.`,
        { providerId: quote.providerId },
      );
    }

    const totalCost = benchmarkAmount.subtract(deliveredAmount);
    const totalCostBps = ratioToBps(totalCost.toDecimal().div(benchmarkAmount.toDecimal()));
    const applied = [...sourceFees.fees, ...platformFees.fees, ...destinationFees.fees];
    const breakdown = buildBreakdown({
      dest,
      applied,
      convertible,
      midMarketRate,
      offeredRate,
      slippageAdjustedRate,
      totalCost,
    });

    const reliabilityScore = toDecimal(quote.reliabilityScore);
    const hops = hopsOf(quote, provider);
    const railFamily = familyOf(provider.rail);
    const category = capabilities.category;

    return {
      routeId: `${quote.providerId}:${provider.rail}`,
      available: true,
      hops,
      provider,
      rail: provider.rail,
      railFamily,
      category,
      conversionKind: quote.conversionKind,
      quote,
      quoteFreshness: freshness ?? defaultQuoteFreshness(quote),
      platformCharge: platform,
      sendAmount,
      deliveredAmount,
      benchmarkAmount,
      indicatedRate: offeredRate,
      midMarketRate,
      slippageAdjustedRate,
      effectiveRate: effectiveRateOf(sendAmount, deliveredAmount),
      totalCost,
      totalCostBps,
      spreadBps,
      slippageBps,
      liquidityHeadroom: liquidityHeadroom(quote, sendAmount),
      reliabilityScore,
      settlementConfidence: settlementConfidenceOf(quote.settlement),
      settlement: quote.settlement,
      slippage: quote.slippage,
      breakdown,
      compliance: complianceOf(quote, provider, capabilities),
    };
  }
}

/**
 * How confident the engine is that settlement will land inside the published window.
 *
 * Distinct from speed: a slow bank with a tight p50/p95 band and a cutoff can outscore a fast
 * venue whose 95th percentile is many times its median. Absolute tail (p95 − p50) is used rather
 * than the ratio, so a 12s/60s DEX quote is not punished relative to a 1-day/2-day bank wire.
 *
 *   tightness = clamp(1 − (p95 − p50) / 2 days, 0, 1)
 *   confidence = tightness × (cutoff ? 1 : 0.92) × (business-days-only ? 0.88 : 1)
 */
export function settlementConfidenceOf(settlement: SettlementEstimate): Decimal {
  const tail = Math.max(settlement.p95Seconds - settlement.p50Seconds, 0);
  const twoDays = 2 * 86_400;
  const tightness = clampUnit(new Dec(1).minus(new Dec(tail).div(twoDays)));
  const cutoffFactor = settlement.cutoffUtc === null ? new Dec('0.92') : new Dec(1);
  const calendarFactor = settlement.businessDaysOnly ? new Dec('0.88') : new Dec(1);
  return clampUnit(tightness.times(cutoffFactor).times(calendarFactor));
}

export function hopsOf(quote: NormalizedQuote, provider: ProviderDescriptor): readonly string[] {
  const hopsMeta = quote.metadata['hops'];
  if (Array.isArray(hopsMeta) && hopsMeta.every((hop) => typeof hop === 'string')) {
    return hopsMeta;
  }
  const intermediary = quote.metadata['intermediaryAsset'];
  if (typeof intermediary === 'string' && intermediary.trim() !== '') {
    return [quote.sourceAsset, provider.name, intermediary, quote.targetAsset];
  }
  return [quote.sourceAsset, provider.name, quote.targetAsset];
}

function applyRate(
  amount: AssetAmount,
  destAsset: string,
  rate: Decimal,
  rounding: RoundingMode,
): AssetAmount {
  return AssetAmount.fromDecimal(destAsset, amount.toDecimal().times(rate), rounding);
}

function effectiveRateOf(send: AssetAmount, delivered: AssetAmount): Decimal {
  if (send.isZero()) {
    throw new InvalidAmountError('Cannot compute an effective rate from a zero send amount.', {});
  }
  return delivered.toDecimal().div(send.toDecimal());
}

function applyFees(input: {
  fees: readonly NormalizedFee[];
  side: 'source' | 'destination';
  base: AssetAmount;
  quote: NormalizedQuote;
  midMarketRate: Decimal;
}): { fees: readonly RoutedAppliedFee[]; total: AssetAmount } {
  const { fees, side, base, quote, midMarketRate } = input;
  const applied: RoutedAppliedFee[] = [];

  for (const fee of fees) {
    if (fee.side !== side) {
      continue;
    }
    const bucket = bucketOf(fee);
    const chargedBy = bucket === 'platform' ? 'platform' : 'provider';

    if (fee.kind === 'fixed') {
      if (fee.amountMinorUnits === null) {
        throw new InvalidProviderQuoteError(
          quote.providerId,
          `fixed fee "${fee.code}" is missing amountMinorUnits`,
        );
      }
      const declared = AssetAmount.ofMinorUnits(fee.asset, fee.amountMinorUnits);
      applied.push({
        code: fee.code,
        label: fee.label,
        side,
        kind: 'fixed',
        bucket,
        chargedBy,
        asset: base.asset,
        amount: convertWithinQuote({
          amount: declared,
          targetAsset: base.asset,
          quote,
          midMarketRate,
        }),
        rateBps: null,
      });
      continue;
    }

    if (fee.rateBps === null) {
      throw new InvalidProviderQuoteError(
        quote.providerId,
        `proportional fee "${fee.code}" is missing rateBps`,
      );
    }
    const rateBps = toDecimal(fee.rateBps);
    applied.push({
      code: fee.code,
      label: fee.label,
      side,
      kind: 'proportional',
      bucket,
      chargedBy,
      asset: base.asset,
      amount: base.multiplyByRatio(bpsToRatio(rateBps), Rounding.HALF_UP),
      rateBps,
    });
  }

  return {
    fees: applied,
    total: AssetAmount.sum(
      base.asset,
      applied.map((fee) => fee.amount),
    ),
  };
}

function applyPlatformFees(
  platform: RoutingPlatformCharge,
  sendAmount: AssetAmount,
): { fees: readonly RoutedAppliedFee[]; total: AssetAmount } {
  const applied: RoutedAppliedFee[] = [];

  if (!platform.markupBps.isZero()) {
    applied.push({
      code: 'platform_markup',
      label: 'Meridian platform fee',
      side: 'source',
      kind: 'proportional',
      bucket: 'platform',
      chargedBy: 'platform',
      asset: sendAmount.asset,
      amount: sendAmount.multiplyByRatio(bpsToRatio(platform.markupBps), Rounding.HALF_UP),
      rateBps: platform.markupBps,
    });
  }

  if (platform.flatFee !== null && !platform.flatFee.isZero()) {
    const flat =
      platform.flatFee.asset === sendAmount.asset
        ? platform.flatFee
        : AssetAmount.fromDecimal(sendAmount.asset, platform.flatFee.toDecimal(), Rounding.HALF_UP);
    applied.push({
      code: 'platform_flat',
      label: 'Meridian platform flat fee',
      side: 'source',
      kind: 'fixed',
      bucket: 'platform',
      chargedBy: 'platform',
      asset: sendAmount.asset,
      amount: flat,
      rateBps: null,
    });
  }

  if (platform.surcharge !== null && !platform.surcharge.rateBps.isZero()) {
    applied.push({
      code: platform.surcharge.code,
      label: platform.surcharge.label,
      side: 'source',
      kind: 'proportional',
      bucket: 'surcharge',
      chargedBy: 'platform',
      asset: sendAmount.asset,
      amount: sendAmount.multiplyByRatio(bpsToRatio(platform.surcharge.rateBps), Rounding.HALF_UP),
      rateBps: platform.surcharge.rateBps,
    });
  }

  return {
    fees: applied,
    total: AssetAmount.sum(
      sendAmount.asset,
      applied.map((fee) => fee.amount),
    ),
  };
}

function convertWithinQuote(input: {
  amount: AssetAmount;
  targetAsset: string;
  quote: NormalizedQuote;
  midMarketRate: Decimal;
}): AssetAmount {
  const { amount, targetAsset, quote, midMarketRate } = input;
  if (amount.asset === targetAsset) {
    return amount;
  }
  if (amount.asset === quote.sourceAsset && targetAsset === quote.targetAsset) {
    return applyRate(amount, targetAsset, midMarketRate, Rounding.HALF_UP);
  }
  if (amount.asset === quote.targetAsset && targetAsset === quote.sourceAsset) {
    return applyRate(amount, targetAsset, new Dec(1).div(midMarketRate), Rounding.HALF_UP);
  }
  if (USD_PEGGED.has(amount.asset) && USD_PEGGED.has(targetAsset)) {
    return AssetAmount.fromDecimal(targetAsset, amount.toDecimal(), Rounding.HALF_UP);
  }
  // ETH → USDC with a USD slippage notional: convert along the quoted pair, then peg.
  if (USD_PEGGED.has(targetAsset)) {
    if (amount.asset === quote.sourceAsset && USD_PEGGED.has(quote.targetAsset)) {
      const alongQuote = applyRate(amount, quote.targetAsset, midMarketRate, Rounding.HALF_UP);
      return convertWithinQuote({ ...input, amount: alongQuote });
    }
    if (amount.asset === quote.targetAsset && USD_PEGGED.has(quote.sourceAsset)) {
      const alongQuote = applyRate(
        amount,
        quote.sourceAsset,
        new Dec(1).div(midMarketRate),
        Rounding.HALF_UP,
      );
      return convertWithinQuote({ ...input, amount: alongQuote });
    }
  }
  throw new InvalidProviderQuoteError(
    quote.providerId,
    `fee is denominated in ${amount.asset}, which is outside the quoted corridor`,
    { asset: amount.asset, requiredAsset: targetAsset },
  );
}

function resolveSlippageBps(
  model: SlippageModel,
  sendAmount: AssetAmount,
  quote: NormalizedQuote,
  midMarketRate: Decimal,
): Decimal {
  if (model.kind === 'none') {
    return new Dec(0);
  }

  const notional = convertWithinQuote({
    amount: sendAmount,
    targetAsset: model.notionalCurrency,
    quote,
    midMarketRate,
  });

  for (const tier of model.tiers) {
    if (tier.upToNotionalMinorUnits === null) {
      return toDecimal(tier.bps);
    }
    if (notional.minorUnits <= BigInt(tier.upToNotionalMinorUnits)) {
      return toDecimal(tier.bps);
    }
  }

  throw new InvalidProviderQuoteError(
    quote.providerId,
    'no slippage tier covers the requested notional',
    { notional: notional.toJSON() },
  );
}

function liquidityHeadroom(quote: NormalizedQuote, sendAmount: AssetAmount): Decimal | null {
  const depth = quote.liquidity.availableDepthMinorUnits;
  if (depth == null || sendAmount.isZero()) {
    return null;
  }
  return new Dec(depth).div(new Dec(sendAmount.minorUnits.toString()));
}

function buildBreakdown(input: {
  dest: string;
  applied: readonly RoutedAppliedFee[];
  convertible: AssetAmount;
  midMarketRate: Decimal;
  offeredRate: Decimal;
  slippageAdjustedRate: Decimal;
  totalCost: AssetAmount;
}): RoutingCostBreakdown {
  const {
    dest,
    applied,
    convertible,
    midMarketRate,
    offeredRate,
    slippageAdjustedRate,
    totalCost,
  } = input;

  const toDest = (amount: AssetAmount): AssetAmount =>
    amount.asset === dest ? amount : applyRate(amount, dest, midMarketRate, Rounding.HALF_UP);

  const sumBucket = (bucket: RoutingFeeBucket): AssetAmount =>
    AssetAmount.sum(
      dest,
      applied.filter((fee) => fee.bucket === bucket).map((fee) => toDest(fee.amount)),
    );

  const platformFeeCost = sumBucket('platform');
  const surchargeFee = sumBucket('surcharge');
  const networkFee = sumBucket('network');
  const gasFee = sumBucket('gas');
  const liquidityFee = sumBucket('liquidity');
  const providerOnly = AssetAmount.sum(dest, [
    sumBucket('provider'),
    sumBucket('other'),
  ]);

  const spreadCost = AssetAmount.fromDecimal(
    dest,
    convertible.toDecimal().times(midMarketRate.minus(offeredRate)),
    Rounding.HALF_UP,
  );
  const slippageCost = AssetAmount.fromDecimal(
    dest,
    convertible.toDecimal().times(offeredRate.minus(slippageAdjustedRate)),
    Rounding.HALF_UP,
  );

  const attributed = AssetAmount.sum(dest, [
    providerOnly,
    platformFeeCost,
    surchargeFee,
    networkFee,
    gasFee,
    liquidityFee,
    spreadCost,
    slippageCost,
  ]);

  return {
    appliedFees: applied,
    providerFee: providerOnly,
    platformFee: platformFeeCost,
    networkFee,
    gasFee,
    liquidityFee,
    surchargeFee,
    spreadCost,
    slippageCost,
    roundingAdjustment: totalCost.subtract(attributed),
    totalCost,
  };
}

function bucketOf(fee: NormalizedFee): RoutingFeeBucket {
  const code = fee.code.toLowerCase();
  if (code.includes('gas')) return 'gas';
  if (code.includes('network')) return 'network';
  if (code.includes('surcharge')) return 'surcharge';
  if (code.includes('platform')) return 'platform';
  if (
    code.includes('liquidity') ||
    code.includes('dex') ||
    code.includes('amm') ||
    code.includes('pool')
  ) {
    return 'liquidity';
  }
  if (
    code.includes('provider') ||
    code.includes('ramp') ||
    code.includes('aggregator') ||
    code.includes('spread') ||
    code.includes('fee')
  ) {
    return 'provider';
  }
  return 'other';
}

function complianceOf(
  quote: NormalizedQuote,
  provider: ProviderDescriptor,
  capabilities: ProviderCapabilityProfile,
): ComplianceEligibility {
  const kycRequired =
    capabilities.features.includes('on_off_ramp') || provider.licensing === 'licensed_partner';
  return {
    eligible: true,
    conversionKind: quote.conversionKind,
    railFamily: familyOf(provider.rail),
    category: capabilities.category ?? categoryOfRail(provider.rail),
    licensing: provider.licensing,
    jurisdictions: provider.jurisdictions,
    kycRequired,
    sanctionsScreeningRequired: capabilities.category !== 'defi',
    executable: false,
    notes:
      'Indicative only. Meridian does not execute, custody, or hold keys. Settlement is delegated ' +
      'to a licensed or authorized provider when that capability exists.',
  };
}

function clampUnit(value: Decimal): Decimal {
  if (value.lessThan(0)) return new Dec(0);
  if (value.greaterThan(1)) return new Dec(1);
  return value;
}
