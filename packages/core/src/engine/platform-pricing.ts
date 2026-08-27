import type {
  PlatformPricing,
  PlatformPricingRule,
  PricingCriteria,
} from '../domain/platform-pricing.js';
import { InvalidAmountError } from '../errors/index.js';
import {
  type CurrencyCode,
  Dec,
  type Decimal,
  Money,
  type Rate,
  Rounding,
  bpsToRatio,
} from '../money/index.js';

export const NO_PLATFORM_PRICING: PlatformPricing = {
  ruleId: null,
  markupBps: new Dec(0),
  discountBps: new Dec(0),
  flatFee: null,
};

/**
 * Chooses which negotiated term applies to one route.
 *
 * Pure and total: the same rule set and criteria always select the same rule, on any machine, which
 * is what allows the selection to be replayed from a stored snapshot rather than re-queried against
 * commercial terms that may since have changed.
 *
 * Ordering, in sequence:
 *
 *   1. **Priority**, descending — the explicit lever an account manager sets.
 *   2. **Specificity**, descending — a corridor-specific term beats a blanket one at equal
 *      priority. Without this, whichever row happened to be created first would win, which is not a
 *      commercial decision anybody made.
 *   3. **Most recently effective**, descending — the latest repricing wins.
 *   4. **Rule id**, ascending — a final tiebreak so the result is a total order and never depends on
 *      the order rows came back from the database.
 */
export function selectPricingRule(
  rules: readonly PlatformPricingRule[],
  criteria: PricingCriteria,
): PlatformPricingRule | null {
  const atMs = Date.parse(criteria.at);
  const applicable = rules.filter((rule) => matches(rule, criteria, atMs));
  if (applicable.length === 0) {
    return null;
  }

  return [...applicable].sort(comparePricingRules)[0] ?? null;
}

function matches(rule: PlatformPricingRule, criteria: PricingCriteria, atMs: number): boolean {
  if (rule.organizationId !== criteria.organizationId) {
    return false;
  }
  if (Date.parse(rule.effectiveFrom) > atMs) {
    return false;
  }
  if (rule.effectiveTo !== null && Date.parse(rule.effectiveTo) <= atMs) {
    return false;
  }
  // A null narrowing field means "any", so it matches without constraining.
  if (rule.sourceCurrency !== null && rule.sourceCurrency !== criteria.sourceCurrency) {
    return false;
  }
  if (rule.targetCurrency !== null && rule.targetCurrency !== criteria.targetCurrency) {
    return false;
  }
  if (rule.rail !== null && rule.rail !== criteria.rail) {
    return false;
  }
  if (rule.providerId !== null && rule.providerId !== criteria.providerId) {
    return false;
  }
  return true;
}

function comparePricingRules(left: PlatformPricingRule, right: PlatformPricingRule): number {
  const byPriority = right.priority - left.priority;
  if (byPriority !== 0) return byPriority;

  const bySpecificity = specificity(right) - specificity(left);
  if (bySpecificity !== 0) return bySpecificity;

  const byEffective = Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom);
  if (byEffective !== 0) return byEffective;

  return left.id.localeCompare(right.id, 'en');
}

function specificity(rule: PlatformPricingRule): number {
  return [rule.sourceCurrency, rule.targetCurrency, rule.rail, rule.providerId].filter(
    (field) => field !== null,
  ).length;
}

/**
 * Resolves a rule into the terms the cost engine applies.
 *
 * A flat fee may be quoted in a currency that is not one of the corridor's legs. It is valued at the
 * mid-market rate, deliberately: converting it at the provider's offered rate would let the platform
 * charge hide a second spread inside its own fee.
 */
export function toPlatformPricing(
  rule: PlatformPricingRule | null,
  context: { readonly sourceCurrency: CurrencyCode; readonly midMarketRate: Rate },
): PlatformPricing {
  if (rule === null) {
    return NO_PLATFORM_PRICING;
  }

  const markupBps = new Dec(rule.markupBps);
  const discountBps = new Dec(rule.discountBps);
  if (markupBps.isNegative() || discountBps.isNegative()) {
    throw new InvalidAmountError('Platform markup and discount must be non-negative.', {
      ruleId: rule.id,
      markupBps: rule.markupBps,
      discountBps: rule.discountBps,
    });
  }

  return {
    ruleId: rule.id,
    markupBps,
    discountBps,
    flatFee: resolveFlatFee(rule, context),
  };
}

function resolveFlatFee(
  rule: PlatformPricingRule,
  context: { readonly sourceCurrency: CurrencyCode; readonly midMarketRate: Rate },
): Money | null {
  const declaredCurrency = rule.feeCurrency ?? context.sourceCurrency;
  const declared = Money.ofMinorUnits(declaredCurrency, rule.platformFeeMinorUnits);
  if (declared.isZero()) {
    return null;
  }
  if (declared.isNegative()) {
    throw new InvalidAmountError('Platform flat fee must not be negative.', {
      ruleId: rule.id,
      platformFeeMinorUnits: rule.platformFeeMinorUnits,
    });
  }

  if (declaredCurrency === context.sourceCurrency) {
    return declared;
  }

  const { midMarketRate } = context;
  if (declaredCurrency === midMarketRate.quote) {
    return midMarketRate.invert().applyTo(declared, Rounding.HALF_UP);
  }

  throw new InvalidAmountError(
    `Platform fee is denominated in ${declaredCurrency}, which is outside the ` +
      `${midMarketRate.pair} corridor and cannot be valued.`,
    { ruleId: rule.id, feeCurrency: declaredCurrency, corridor: midMarketRate.pair },
  );
}

/**
 * The spread the customer actually receives, after any negotiated discount.
 *
 * A discount can only improve a rate, never worsen it. A provider quoting above mid — a negative
 * spread, which happens on keenly priced corridors — keeps that advantage, and the discount is added
 * on top rather than clamped away.
 */
export function effectiveSpreadBps(quotedSpreadBps: Decimal, discountBps: Decimal): Decimal {
  return quotedSpreadBps.minus(discountBps);
}

/** Basis points of spread implied by a mid and an offered rate. */
export function spreadBpsOf(midMarketRate: Decimal, offeredRate: Decimal): Decimal {
  if (midMarketRate.isZero()) {
    return new Dec(0);
  }
  return midMarketRate.minus(offeredRate).div(midMarketRate).times(10_000);
}

/** Converts a basis-point figure to the retention ratio a rate is scaled by. */
export function retentionRatio(bps: Decimal): Decimal {
  return new Dec(1).minus(bpsToRatio(bps));
}
