import type { Decimal, Money, Rate } from '../money/index.js';
import type { PlatformPricing } from './platform-pricing.js';
import type { FeeComponent, FeeSide } from './fees.js';
import type { ProviderDescriptor } from './provider.js';
import type { ProviderQuote, SettlementEstimate } from './quote.js';
import type { RailType } from './rail.js';

/** Who levies a charge. Kept distinct from `side` so a platform markup is never mistaken for a
 * provider charge when a customer disputes a number. */
export type FeeCharger = 'provider' | 'platform';

/** A fee component after it has been resolved to a concrete amount for this transfer. */
export interface AppliedFee {
  readonly code: string;
  readonly label: string;
  readonly side: FeeSide;
  readonly kind: FeeComponent['kind'];
  readonly chargedBy: FeeCharger;
  readonly amount: Money;
  /** Populated for proportional fees so the customer can see the rate that was applied. */
  readonly rateBps: Decimal | null;
  /** True when a configured floor or cap changed the computed amount. */
  readonly capped: boolean;
}

/**
 * Where the money went, in destination-currency terms.
 *
 * The components reconcile exactly to `totalCost`: source-side fees are valued at the mid-market
 * rate (their opportunity cost), the FX spread and slippage are valued on the converted notional,
 * and `roundingAdjustment` absorbs sub-minor-unit residue so the breakdown always balances.
 */
export interface CostBreakdown {
  readonly appliedFees: readonly AppliedFee[];
  /** Provider source-side fees expressed in the destination currency at the mid-market rate. */
  readonly sourceFeeCost: Money;
  /**
   * The platform's own charge, valued the same way and reported separately.
   *
   * Separate from `sourceFeeCost` because a customer is entitled to see what Meridian took as
   * distinct from what the provider took, and because netting the two would make the platform's
   * margin unauditable.
   */
  readonly platformFeeCost: Money;
  readonly destinationFeeCost: Money;
  /** Cost of the gap between the mid-market rate and the offered rate. */
  readonly fxSpreadCost: Money;
  /** Cost of the expected execution slippage, where the rail has any. */
  readonly slippageCost: Money;
  readonly roundingAdjustment: Money;
  readonly totalCost: Money;
}

/** One candidate route, fully priced. Every figure is derived from the provider's primitives. */
export interface PricedRoute {
  /** Deterministic within a comparison: `"<providerId>:<rail>"`. */
  readonly routeId: string;
  readonly provider: ProviderDescriptor;
  readonly rail: RailType;
  readonly quote: ProviderQuote;
  readonly sendAmount: Money;
  /** What the beneficiary receives after every fee, the spread and slippage. */
  readonly deliveredAmount: Money;
  /** What the beneficiary would receive at mid-market with zero costs. The cost benchmark. */
  readonly benchmarkAmount: Money;
  readonly midMarketRate: Rate;
  readonly offeredRate: Rate;
  /** Offered rate after the slippage haircut. */
  readonly slippageAdjustedRate: Rate;
  /** Realised all-in rate: delivered / sent. */
  readonly effectiveRate: Rate;
  /** `benchmarkAmount - deliveredAmount`, in the destination currency. */
  readonly totalCost: Money;
  readonly totalCostBps: Decimal;
  /** Provider spread over mid-market actually applied, after any negotiated discount. */
  readonly spreadBps: Decimal;
  readonly slippageBps: Decimal;
  readonly breakdown: CostBreakdown;
  readonly settlement: SettlementEstimate;
  readonly reliabilityScore: Decimal;
  /** The commercial terms applied, so a customer-specific price can be explained later. */
  readonly platformPricing: PlatformPricing;
  /**
   * Disclosed depth as a multiple of the requested notional, or `null` where the rail has no
   * meaningful depth to publish.
   */
  readonly liquidityHeadroom: Decimal | null;
  /** Counterparty and settlement risk, normalised to `0`..`1` where 1 is safest. */
  readonly riskScore: Decimal;
}

/** The normalised `0`..`1` inputs behind a route's score, exposed so a ranking can be explained. */
export interface ScoreComponents {
  readonly cost: Decimal;
  readonly speed: Decimal;
  readonly reliability: Decimal;
  readonly slippage: Decimal;
  readonly liquidity: Decimal;
  readonly risk: Decimal;
}

export interface ScoredRoute extends PricedRoute {
  /** Composite score, `0`..`100`, higher is better. */
  readonly score: Decimal;
  readonly scoreComponents: ScoreComponents;
  /** 1-based position after ranking. */
  readonly rank: number;
  readonly recommended: boolean;
}

/** A provider that failed to quote. The comparison degrades rather than failing outright. */
export interface ProviderFailure {
  readonly providerId: string;
  readonly rail: RailType | null;
  readonly code: string;
  readonly message: string;
  readonly failedAt: string;
}
