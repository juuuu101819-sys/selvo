import type { Decimal, Money } from '../money/index.js';
import type { CurrencyCode } from '../money/currency.js';
import type { ProviderId } from './provider.js';
import type { RailType } from './rail.js';

/**
 * One negotiated commercial term for an organization.
 *
 * Modelled as overlapping rules resolved by priority rather than a single rate per customer, because
 * real B2B pricing is negotiated per corridor and per rail: a customer may have a blanket markup, a
 * keener term on their highest-volume corridor, and a different one again on a specific provider.
 *
 * `effectiveFrom`/`effectiveTo` make a repricing an insert rather than an update, so a quote issued
 * last quarter can always be explained by the terms that applied when it was issued.
 */
export interface PlatformPricingRule {
  readonly id: string;
  readonly organizationId: string;
  /** Narrowing filters. `null` means "any". */
  readonly sourceCurrency: CurrencyCode | null;
  readonly targetCurrency: CurrencyCode | null;
  readonly rail: RailType | null;
  readonly providerId: ProviderId | null;
  /** The platform's take, in basis points of the send notional. */
  readonly markupBps: string;
  /** Discount off the provider's spread, in basis points, negotiated for this customer. */
  readonly discountBps: string;
  /** Flat platform charge, in minor units of `feeCurrency`. */
  readonly platformFeeMinorUnits: string;
  readonly feeCurrency: CurrencyCode | null;
  /** Highest wins when several rules match. */
  readonly priority: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

/** The commercial terms that actually applied to one route, after resolution. */
export interface PlatformPricing {
  /** The rule that won, or `null` when the organization has no applicable terms. */
  readonly ruleId: string | null;
  readonly markupBps: Decimal;
  readonly discountBps: Decimal;
  /** Flat charge, already denominated in a currency the corridor can value. */
  readonly flatFee: Money | null;
}

export interface PricingCriteria {
  readonly organizationId: string;
  readonly sourceCurrency: CurrencyCode;
  readonly targetCurrency: CurrencyCode;
  readonly rail: RailType;
  readonly providerId: ProviderId;
  /** Instant the terms are evaluated at, so a historical quote resolves historical terms. */
  readonly at: string;
}
