import type { Decimal, Money, Rate } from '../money/index.js';
import type { FeeComponent, FeeSide } from './fees.js';
import type { ProviderDescriptor } from './provider.js';
import type { ProviderQuote, SettlementEstimate } from './quote.js';
import type { RailType } from './rail.js';

/** A fee component after it has been resolved to a concrete amount for this transfer. */
export interface AppliedFee {
  readonly code: string;
  readonly label: string;
  readonly side: FeeSide;
  readonly kind: FeeComponent['kind'];
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
  /** Source-side fees expressed in the destination currency at the mid-market rate. */
  readonly sourceFeeCost: Money;
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
  readonly slippageBps: Decimal;
  readonly breakdown: CostBreakdown;
  readonly settlement: SettlementEstimate;
  readonly reliabilityScore: Decimal;
}

/** The normalised `0`..`1` inputs behind a route's score, exposed so a ranking can be explained. */
export interface ScoreComponents {
  readonly cost: Decimal;
  readonly speed: Decimal;
  readonly reliability: Decimal;
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
