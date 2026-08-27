import type {
  AppliedFee,
  CostBreakdown,
  FeeComponent,
  FeeSide,
  PlatformPricing,
  PricedRoute,
  ProviderDescriptor,
  ProviderQuote,
  QuoteRequest,
  SlippageModel,
} from '../domain/index.js';
import { InvalidAmountError, InvalidProviderQuoteError } from '../errors/index.js';
import {
  type CurrencyCode,
  Dec,
  type Decimal,
  Money,
  Rate,
  Rounding,
  bpsToRatio,
  ratioToBps,
} from '../money/index.js';
import { NEUTRAL_RISK_SCORE } from './engine-config.js';
import {
  NO_PLATFORM_PRICING,
  effectiveSpreadBps,
  retentionRatio,
  spreadBpsOf,
} from './platform-pricing.js';
import { assertValidProviderQuote } from './quote-validation.js';

export interface PricingOptions {
  /** Negotiated commercial terms for the organization, already resolved for this route. */
  readonly platformPricing?: PlatformPricing | undefined;
}

/**
 * Turns one provider's pricing primitives into a fully priced route.
 *
 * The engine is a pure function of `(request, quote, provider, options)`. It performs no I/O, reads
 * no clock and holds no state, which is what makes a comparison reproducible from a stored snapshot.
 *
 * Cost is measured against the **mid-market benchmark**, not against the provider's own rate:
 *
 * ```text
 *   benchmark = sendAmount x midMarketRate          (zero-cost reference)
 *   delivered = ((sendAmount - sourceFees) x offeredRate x (1 - slippage)) - destinationFees
 *   totalCost = benchmark - delivered
 * ```
 *
 * Anchoring on mid-market is the only way to compare a "zero fee" bank quote carrying a 90 bps
 * spread against a payment institution charging an explicit fee on a near-mid rate. Quoting cost
 * relative to each provider's own rate would make the most expensive route look free.
 */
export class RouteCostEngine {
  price(
    request: QuoteRequest,
    quote: ProviderQuote,
    provider: ProviderDescriptor,
    options: PricingOptions = {},
  ): PricedRoute {
    assertValidProviderQuote(quote, request);
    const platformPricing = options.platformPricing ?? NO_PLATFORM_PRICING;

    const source = request.sourceCurrency;
    const target = request.targetCurrency;
    const sendAmount = Money.ofMinorUnits(source, request.amountMinorUnits);
    if (!sendAmount.isPositive()) {
      throw new InvalidAmountError('Send amount must be greater than zero.', {
        amountMinorUnits: request.amountMinorUnits,
      });
    }

    const midMarketRate = Rate.of(source, target, quote.midMarketRate);
    const quotedRate = Rate.of(source, target, quote.offeredRate);

    // A negotiated discount improves the rate by narrowing the provider's spread. Applied before
    // anything else, because every downstream figure is derived from the rate the customer gets.
    const quotedSpreadBps = spreadBpsOf(midMarketRate.value, quotedRate.value);
    const spreadBps = effectiveSpreadBps(quotedSpreadBps, platformPricing.discountBps);
    const offeredRate = platformPricing.discountBps.isZero()
      ? quotedRate
      : Rate.of(source, target, midMarketRate.value.times(retentionRatio(spreadBps)));

    // 1. Mid-market benchmark: the cost-free reference every route is measured against.
    const benchmarkAmount = midMarketRate.applyTo(sendAmount, Rounding.DOWN);
    if (!benchmarkAmount.isPositive()) {
      throw new InvalidAmountError(
        'Send amount is too small to produce a non-zero benchmark in the destination currency.',
        { sendAmount: sendAmount.toString(), targetCurrency: target },
      );
    }

    // 2. Source-side fees reduce the notional that actually gets converted. The platform's own
    //    charge is computed separately from the provider's so the two never get netted together.
    const sourceFees = this.applyFees({
      components: quote.fees.components,
      side: 'source',
      base: sendAmount,
      providerId: quote.providerId,
      midMarketRate,
    });
    const platformFees = this.applyPlatformFees(platformPricing, sendAmount);
    const convertibleAmount = sendAmount.subtract(sourceFees.total).subtract(platformFees.total);
    if (!convertibleAmount.isPositive()) {
      throw new InvalidAmountError(
        `Fees of ${sourceFees.total.add(platformFees.total).toString()} meet or exceed the ` +
          `${sendAmount.toString()} send amount.`,
        {
          providerId: quote.providerId,
          sendAmount: sendAmount.toJSON(),
          providerFees: sourceFees.total.toJSON(),
          platformFees: platformFees.total.toJSON(),
        },
      );
    }

    // 3. Expected execution slippage, from the provider's tiered model at this notional.
    const slippageBps = this.resolveSlippageBps({
      model: quote.slippage,
      providerId: quote.providerId,
      sendAmount,
      midMarketRate,
    });
    const slippageRetention = new Dec(1).minus(bpsToRatio(slippageBps));
    if (slippageRetention.lessThanOrEqualTo(0)) {
      throw new InvalidProviderQuoteError(
        quote.providerId,
        'slippage of 10,000 bps or more would consume the entire notional',
        { slippageBps: slippageBps.toFixed() },
      );
    }
    const slippageAdjustedRate = offeredRate.scaleBy(slippageRetention);

    // 4. Convert, rounding down so a payout is never over-promised.
    const grossConverted = slippageAdjustedRate.applyTo(convertibleAmount, Rounding.DOWN);

    // 5. Destination-side fees are charged on the converted amount.
    const destinationFees = this.applyFees({
      components: quote.fees.components,
      side: 'destination',
      base: grossConverted,
      providerId: quote.providerId,
      midMarketRate,
    });
    const deliveredAmount = grossConverted.subtract(destinationFees.total);
    if (deliveredAmount.isNegative()) {
      throw new InvalidAmountError(
        `Provider "${quote.providerId}" destination fees of ${destinationFees.total.toString()} ` +
          `exceed the converted amount of ${grossConverted.toString()}.`,
        { providerId: quote.providerId },
      );
    }

    // 6. All-in cost against the benchmark.
    const totalCost = benchmarkAmount.subtract(deliveredAmount);
    const totalCostBps = ratioToBps(totalCost.toDecimal().div(benchmarkAmount.toDecimal()));

    const breakdown = this.buildBreakdown({
      target,
      appliedFees: [...sourceFees.fees, ...platformFees.fees, ...destinationFees.fees],
      sourceFeeTotal: sourceFees.total,
      platformFeeTotal: platformFees.total,
      destinationFeeTotal: destinationFees.total,
      convertibleAmount,
      midMarketRate,
      offeredRate,
      slippageAdjustedRate,
      totalCost,
    });

    return {
      routeId: `${quote.providerId}:${quote.rail}`,
      provider,
      rail: quote.rail,
      quote,
      sendAmount,
      deliveredAmount,
      benchmarkAmount,
      midMarketRate,
      offeredRate,
      slippageAdjustedRate,
      effectiveRate: Rate.effective(sendAmount, deliveredAmount),
      totalCost,
      totalCostBps,
      spreadBps,
      slippageBps,
      breakdown,
      settlement: quote.settlement,
      reliabilityScore: new Dec(quote.reliabilityScore),
      platformPricing,
      liquidityHeadroom: this.liquidityHeadroom(quote, sendAmount),
      riskScore: this.riskScore(quote),
    };
  }

  private applyFees(input: {
    components: readonly FeeComponent[];
    side: FeeSide;
    base: Money;
    providerId: string;
    midMarketRate: Rate;
  }): { fees: readonly AppliedFee[]; total: Money } {
    const { components, side, base, providerId, midMarketRate } = input;
    const fees: AppliedFee[] = [];

    for (const component of components) {
      if (component.side !== side) {
        continue;
      }

      if (component.kind === 'fixed') {
        const declared = Money.ofMinorUnits(component.currency, component.amountMinorUnits);
        fees.push({
          code: component.code,
          label: component.label,
          side,
          kind: 'fixed',
          chargedBy: 'provider',
          amount: this.convertWithinCorridor({
            amount: declared,
            targetCurrency: base.currency,
            midMarketRate,
            providerId,
            subject: `fee "${component.code}"`,
          }),
          rateBps: null,
          capped: false,
        });
        continue;
      }

      const computed = base.multiplyByRatio(bpsToRatio(component.rateBps), Rounding.HALF_UP);
      const floor =
        component.minAmountMinorUnits == null
          ? null
          : Money.ofMinorUnits(base.currency, component.minAmountMinorUnits);
      const cap =
        component.maxAmountMinorUnits == null
          ? null
          : Money.ofMinorUnits(base.currency, component.maxAmountMinorUnits);
      const bounded = computed.clamp(floor, cap);

      fees.push({
        code: component.code,
        label: component.label,
        side,
        kind: 'proportional',
        chargedBy: 'provider',
        amount: bounded,
        rateBps: new Dec(component.rateBps),
        capped: !bounded.equals(computed),
      });
    }

    return {
      fees,
      total: Money.sum(
        base.currency,
        fees.map((fee) => fee.amount),
      ),
    };
  }

  /**
   * Resolves the platform's own charge into fee components.
   *
   * Modelled as explicit fees rather than folded into the rate. A platform that takes its margin
   * inside the spread is doing exactly what this product exists to expose in other people's pricing,
   * so taking it visibly is the only defensible choice.
   */
  private applyPlatformFees(
    pricing: PlatformPricing,
    sendAmount: Money,
  ): { fees: readonly AppliedFee[]; total: Money } {
    const fees: AppliedFee[] = [];

    if (!pricing.markupBps.isZero()) {
      fees.push({
        code: 'platform_markup',
        label: 'Meridian platform fee',
        side: 'source',
        kind: 'proportional',
        chargedBy: 'platform',
        amount: sendAmount.multiplyByRatio(bpsToRatio(pricing.markupBps), Rounding.HALF_UP),
        rateBps: pricing.markupBps,
        capped: false,
      });
    }

    if (pricing.flatFee !== null && !pricing.flatFee.isZero()) {
      fees.push({
        code: 'platform_fee',
        label: 'Meridian transaction fee',
        side: 'source',
        kind: 'fixed',
        chargedBy: 'platform',
        amount: pricing.flatFee,
        rateBps: null,
        capped: false,
      });
    }

    return {
      fees,
      total: Money.sum(
        sendAmount.currency,
        fees.map((fee) => fee.amount),
      ),
    };
  }

  /**
   * Disclosed depth as a multiple of the requested notional.
   *
   * `null` where the provider published none. That is the common case and is not a defect: a bank's
   * FX desk or a payment institution's payout network has no order book. Absent depth means "not a
   * constraint", and the scorer treats it that way rather than penalising a rail for a concept that
   * does not apply to it.
   */
  private liquidityHeadroom(quote: ProviderQuote, sendAmount: Money): Decimal | null {
    const depth = quote.liquidity?.availableDepthMinorUnits;
    if (depth == null || sendAmount.isZero()) {
      return null;
    }
    return new Dec(depth).div(new Dec(sendAmount.minorUnits.toString()));
  }

  /**
   * Counterparty and settlement risk, normalised so 1 is safest.
   *
   * Two signals, combined multiplicatively so a serious concern on either cannot be averaged away by
   * a clean score on the other. A provider that supplies neither is scored neutrally: penalising
   * silence would rank an unmeasured provider below a measured mediocre one, which the platform has
   * no evidence for.
   */
  private riskScore(quote: ProviderQuote): Decimal {
    const risk = quote.risk;
    if (risk === undefined) {
      return NEUTRAL_RISK_SCORE;
    }

    const jurisdictionFactor =
      risk.jurisdictionRisk === null
        ? NEUTRAL_RISK_SCORE
        : JURISDICTION_RISK_FACTORS[risk.jurisdictionRisk];

    const settlementFactor =
      risk.settlementRiskBps === null
        ? NEUTRAL_RISK_SCORE
        : clampUnit(new Dec(1).minus(bpsToRatio(new Dec(risk.settlementRiskBps))));

    return clampUnit(jurisdictionFactor.times(settlementFactor));
  }

  /**
   * Re-denominates an amount into either leg of the corridor at the mid-market rate.
   *
   * Providers bill fixed fees in whichever currency they operate in, and express slippage
   * thresholds in whichever currency their liquidity is denominated in — neither is guaranteed to
   * match the side of the transfer it applies to. Mid-market is used deliberately: converting at
   * the offered rate would let a fee smuggle in a second, hidden spread.
   */
  private convertWithinCorridor(input: {
    amount: Money;
    targetCurrency: CurrencyCode;
    midMarketRate: Rate;
    providerId: string;
    subject: string;
  }): Money {
    const { amount, targetCurrency, midMarketRate, providerId, subject } = input;
    if (amount.currency === targetCurrency) {
      return amount;
    }
    if (amount.currency === midMarketRate.base && targetCurrency === midMarketRate.quote) {
      return midMarketRate.applyTo(amount, Rounding.HALF_UP);
    }
    if (amount.currency === midMarketRate.quote && targetCurrency === midMarketRate.base) {
      return midMarketRate.invert().applyTo(amount, Rounding.HALF_UP);
    }
    throw new InvalidProviderQuoteError(
      providerId,
      `${subject} is denominated in ${amount.currency}, which is outside the quoted corridor`,
      { currency: amount.currency, requiredCurrency: targetCurrency, corridor: midMarketRate.pair },
    );
  }

  private resolveSlippageBps(input: {
    model: SlippageModel;
    providerId: string;
    sendAmount: Money;
    midMarketRate: Rate;
  }): Decimal {
    const { model, providerId, sendAmount, midMarketRate } = input;
    if (model.kind === 'none') {
      return new Dec(0);
    }

    const notional = this.convertWithinCorridor({
      amount: sendAmount,
      targetCurrency: model.notionalCurrency,
      midMarketRate,
      providerId,
      subject: 'slippage notional',
    });

    for (const tier of model.tiers) {
      if (tier.upToNotionalMinorUnits === null) {
        return new Dec(tier.bps);
      }
      if (notional.minorUnits <= BigInt(tier.upToNotionalMinorUnits)) {
        return new Dec(tier.bps);
      }
    }

    // Unreachable for a validated model: the final tier is required to be unbounded.
    throw new InvalidProviderQuoteError(
      providerId,
      'no slippage tier covers the requested notional',
      { notional: notional.toJSON() },
    );
  }

  /**
   * Attributes the total cost to its causes, all valued in the destination currency.
   *
   * In exact arithmetic the components sum to `totalCost`. Each is independently rounded to minor
   * units, so a sub-unit residue can remain; `roundingAdjustment` carries it, which keeps the
   * breakdown a true decomposition rather than an approximation.
   */
  private buildBreakdown(input: {
    target: CurrencyCode;
    appliedFees: readonly AppliedFee[];
    sourceFeeTotal: Money;
    platformFeeTotal: Money;
    destinationFeeTotal: Money;
    convertibleAmount: Money;
    midMarketRate: Rate;
    offeredRate: Rate;
    slippageAdjustedRate: Rate;
    totalCost: Money;
  }): CostBreakdown {
    const {
      target,
      appliedFees,
      sourceFeeTotal,
      platformFeeTotal,
      destinationFeeTotal,
      convertibleAmount,
      midMarketRate,
      offeredRate,
      slippageAdjustedRate,
      totalCost,
    } = input;

    const notional = convertibleAmount.toDecimal();
    const sourceFeeCost = midMarketRate.applyTo(sourceFeeTotal, Rounding.HALF_UP);
    const platformFeeCost = midMarketRate.applyTo(platformFeeTotal, Rounding.HALF_UP);
    const fxSpreadCost = Money.fromDecimal(
      target,
      notional.times(midMarketRate.value.minus(offeredRate.value)),
      Rounding.HALF_UP,
    );
    const slippageCost = Money.fromDecimal(
      target,
      notional.times(offeredRate.value.minus(slippageAdjustedRate.value)),
      Rounding.HALF_UP,
    );

    const attributed = Money.sum(target, [
      sourceFeeCost,
      platformFeeCost,
      destinationFeeTotal,
      fxSpreadCost,
      slippageCost,
    ]);

    return {
      appliedFees,
      sourceFeeCost,
      platformFeeCost,
      destinationFeeCost: destinationFeeTotal,
      fxSpreadCost,
      slippageCost,
      roundingAdjustment: totalCost.subtract(attributed),
      totalCost,
    };
  }
}

/**
 * Jurisdiction risk factors.
 *
 * Explicit constants rather than a formula, because the mapping is a policy decision that a
 * compliance function owns and should be able to read without inferring it from arithmetic.
 */
const JURISDICTION_RISK_FACTORS: Readonly<Record<'low' | 'medium' | 'high', Decimal>> = {
  low: new Dec(1),
  medium: new Dec('0.85'),
  high: new Dec('0.6'),
};

function clampUnit(value: Decimal): Decimal {
  if (value.lessThan(0)) return new Dec(0);
  if (value.greaterThan(1)) return new Dec(1);
  return value;
}
