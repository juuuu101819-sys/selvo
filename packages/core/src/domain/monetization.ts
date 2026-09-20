import type { RailType } from './rail.js';
import type {
  RevenueLifecycleState,
  RevenueOriginEnv,
  SettlementFinalityState,
} from './revenue-lifecycle.js';

/**
 * How Meridian earns on a priced route. Closed set: adding a source is a product decision.
 *
 * These are attributed fees on quoted (and, for agents, simulated) activity. They are not
 * settlements. The platform never collects in custody.
 */
export const REVENUE_SOURCES = [
  'traditional_fx_routing_fee',
  'payment_routing_fee',
  'stablecoin_routing_fee',
  'defi_routing_fee',
  'liquidity_routing_fee',
  'partner_referral_commission',
  'enterprise_api_subscription',
  'ai_agent_payment_fee',
  'enterprise_volume_pricing',
] as const;
export type RevenueSource = (typeof REVENUE_SOURCES)[number];

export const MONETIZATION_TRANSACTION_TYPES = [
  'fiat_comparison',
  'multi_rail_quote',
  'agent_payment',
  'enterprise_subscription',
] as const;
export type MonetizationTransactionType = (typeof MONETIZATION_TRANSACTION_TYPES)[number];

/**
 * Funnel stage of an economic record.
 *
 * This is the record's position in the quote-to-settlement funnel. It is an *input* to the
 * lifecycle state, never the answer on its own: sandbox orchestration may write
 * `economicStage: 'settled'` after a mock partner reports settlement, which is attribution and
 * not cash. Ask {@link resolveRevenueLifecycle} whether revenue is realized — reading this field
 * alone is what previously let a mock inflate a "realized revenue" total.
 */
export const ECONOMIC_STAGES = [
  'route_quote',
  'route_selected',
  'execution_intent',
  'settled',
] as const;
export type EconomicStage = (typeof ECONOMIC_STAGES)[number];

/** 25% of platform revenue — the $50 partner payout on a $200 routing fee. */
export const DEFAULT_PARTNER_COMMISSION_BPS = '2500';

export const REVENUE_SOURCE_LABELS: Readonly<Record<RevenueSource, string>> = {
  traditional_fx_routing_fee: 'Traditional FX routing fee',
  payment_routing_fee: 'Payment routing fee',
  stablecoin_routing_fee: 'Stablecoin routing fee',
  defi_routing_fee: 'DeFi routing fee',
  liquidity_routing_fee: 'Liquidity routing fee',
  partner_referral_commission: 'Partner referral commission',
  enterprise_api_subscription: 'Enterprise API subscription',
  ai_agent_payment_fee: 'AI agent payment fee',
  enterprise_volume_pricing: 'Enterprise volume pricing',
};

const RAIL_REVENUE_SOURCE: Readonly<Record<RailType, RevenueSource>> = {
  bank_fx: 'traditional_fx_routing_fee',
  payment_institution: 'payment_routing_fee',
  stablecoin_settlement: 'stablecoin_routing_fee',
  liquidity_provider: 'liquidity_routing_fee',
  dex_liquidity: 'defi_routing_fee',
  treasury_product: 'traditional_fx_routing_fee',
};

export function isRevenueSource(value: unknown): value is RevenueSource {
  return typeof value === 'string' && (REVENUE_SOURCES as readonly string[]).includes(value);
}

export function isMonetizationTransactionType(
  value: unknown,
): value is MonetizationTransactionType {
  return (
    typeof value === 'string' && (MONETIZATION_TRANSACTION_TYPES as readonly string[]).includes(value)
  );
}

export function isEconomicStage(value: unknown): value is EconomicStage {
  return typeof value === 'string' && (ECONOMIC_STAGES as readonly string[]).includes(value);
}

/**
 * Platform-fee revenue recognition on a quoted snapshot.
 *
 * `unrealized` — attributed, not invoiced.
 * `invoiced` — copied onto an issued invoice. Not cash received.
 * `collected` — confirmed payment against that invoice. Only a collection processor's confirmed
 * success signal writes this; "the request did not error" is not collection.
 */
export const REVENUE_RECOGNITION_STATUSES = ['unrealized', 'invoiced', 'collected'] as const;
export type RevenueRecognitionStatus = (typeof REVENUE_RECOGNITION_STATUSES)[number];

export function isRevenueRecognitionStatus(value: unknown): value is RevenueRecognitionStatus {
  return (
    typeof value === 'string' &&
    (REVENUE_RECOGNITION_STATUSES as readonly string[]).includes(value)
  );
}

export function revenueSourceForRail(rail: RailType): RevenueSource {
  return RAIL_REVENUE_SOURCE[rail];
}

/**
 * One priced monetization event.
 *
 * Amounts are integer minor units of `currency`. `takeRateBps` is Decimal text. `fundsMoved` is
 * always false: this platform attributes economics, it does not hold or move funds.
 *
 * `lifecycleState` is the authoritative answer to "what is this number" and is always derived
 * from the other fields by {@link resolveRevenueLifecycle}, never set independently.
 */
export interface MonetizationEvent {
  readonly id: string;
  readonly organizationId: string;
  readonly occurredAt: string;
  readonly transactionType: MonetizationTransactionType;
  readonly revenueSource: RevenueSource;
  readonly rail: string | null;
  readonly providerId: string | null;
  readonly providerName: string | null;
  readonly currency: string;
  readonly asset: string;
  readonly destinationAsset: string | null;
  readonly agentId: string | null;
  readonly tpvMinorUnits: string;
  readonly providerCostMinorUnits: string;
  readonly platformRevenueMinorUnits: string;
  readonly partnerCommissionMinorUnits: string;
  readonly grossProfitMinorUnits: string;
  readonly takeRateBps: string | null;
  readonly fundsMoved: false;
  readonly custody: false;
  readonly realExecution: false;
  readonly routeId: string | null;
  readonly quoteId: string | null;
  readonly economicStage: EconomicStage;
  /**
   * True only when this record has been collected against a provider-confirmed settlement in
   * production. Guarded by {@link assertRealizationClaimSupported} on write and by the
   * `monetization_events_realized_*` database constraints.
   */
  readonly realizedRevenue: boolean;
  readonly revenueRecognition: RevenueRecognitionStatus;
  /** Environment that produced these economics. Only PRODUCTION may realize. */
  readonly originEnv: RevenueOriginEnv;
  /** Whether a provider confirmed settlement finality, or only a simulation reported it. */
  readonly settlementFinality: SettlementFinalityState;
  /** Processor reference proving collection. Required for realization. */
  readonly collectionReference: string | null;
  /** Derived lifecycle state. The only field a reader should trust for "is this cash". */
  readonly lifecycleState: RevenueLifecycleState;
  readonly invoiceId: string | null;
}

export interface MonetizationTotals {
  readonly eventCount: number;
  readonly tpvMinorUnits: string;
  readonly grossRevenueMinorUnits: string;
  readonly providerCostMinorUnits: string;
  readonly platformRevenueMinorUnits: string;
  readonly partnerCommissionMinorUnits: string;
  readonly grossProfitMinorUnits: string;
  readonly takeRateBps: string | null;
  readonly currency: string;
  readonly exponent: number;
  /** Platform revenue in QUOTED_REVENUE. A priced quote, no commitment. */
  readonly quotedRevenueMinorUnits: string;
  /** Platform revenue in EXPECTED_REVENUE. Route selected or execution intent recorded. */
  readonly expectedRevenueMinorUnits: string;
  /** Platform revenue in ATTRIBUTED_REVENUE. Settled or invoiced, not collected. */
  readonly attributedRevenueMinorUnits: string;
  /**
   * Platform revenue in REALIZED_REVENUE — the only total recognizable as cash.
   *
   * Requires a production origin, provider-confirmed finality, `collected` recognition, and a
   * collection reference. This previously summed `economicStage === 'settled'`, which a sandbox
   * mock could write; it is now derived from {@link resolveRevenueLifecycle}.
   */
  readonly realizedRevenueMinorUnits: string;
  /** Platform revenue on snapshots that have been invoiced or collected. */
  readonly invoicedRevenueMinorUnits: string;
  /** Platform revenue on snapshots with `revenueRecognition: collected`. */
  readonly collectedRevenueMinorUnits: string;
  /**
   * Platform revenue on `settled`-stage events regardless of origin. Reported separately so a
   * simulated settlement is visible without being counted as realized.
   */
  readonly settledStageRevenueMinorUnits: string;
  /** Platform revenue whose origin is not PRODUCTION, and therefore can never realize. */
  readonly simulatedOriginRevenueMinorUnits: string;
}

export interface MonetizationBreakdownRow {
  readonly key: string;
  readonly label: string;
  readonly eventCount: number;
  readonly tpvMinorUnits: string;
  readonly grossRevenueMinorUnits: string;
  readonly providerCostMinorUnits: string;
  readonly platformRevenueMinorUnits: string;
  readonly partnerCommissionMinorUnits: string;
  readonly grossProfitMinorUnits: string;
  readonly takeRateBps: string | null;
  /**
   * How much of this row is REALIZED_REVENUE. Present on every row so no breakdown figure can be
   * read as cash without the cash number sitting beside it.
   */
  readonly realizedRevenueMinorUnits: string;
}

export interface MonetizationReport {
  readonly summary: MonetizationTotals;
  readonly byRail: readonly MonetizationBreakdownRow[];
  readonly byProvider: readonly MonetizationBreakdownRow[];
  readonly byCurrency: readonly MonetizationBreakdownRow[];
  readonly byAsset: readonly MonetizationBreakdownRow[];
  readonly byOrganization: readonly MonetizationBreakdownRow[];
  readonly byAgent: readonly MonetizationBreakdownRow[];
  readonly byTransactionType: readonly MonetizationBreakdownRow[];
  readonly byRevenueSource: readonly MonetizationBreakdownRow[];
  readonly byDate: readonly MonetizationBreakdownRow[];
  /** Revenue split by §18.2 lifecycle state. Always present, one row per state with activity. */
  readonly byLifecycleState: readonly MonetizationBreakdownRow[];
  /** Revenue split by originating environment, so simulated economics stay visibly separate. */
  readonly byOriginEnv: readonly MonetizationBreakdownRow[];
  readonly events: readonly MonetizationEvent[];
  readonly workedExample: MonetizationWorkedExample;
  /**
   * Whether the gain-share shape was admitted when this report was built (§18.3).
   *
   * False means every partner commission figure in the report is zero by gate, not by arithmetic,
   * and consumers must not present a partner payout line at all.
   */
  readonly gainShareActive: boolean;
  readonly fundsMoved: false;
}

/** Canonical identity from the product brief, in USD minor units. */
export interface MonetizationWorkedExample {
  readonly tpvMinorUnits: string;
  readonly providerCostMinorUnits: string;
  readonly platformRevenueMinorUnits: string;
  readonly partnerCommissionMinorUnits: string;
  readonly grossProfitMinorUnits: string;
  readonly takeRateBps: string;
  readonly currency: string;
  readonly description: string;
}

export const MONETIZATION_WORKED_EXAMPLE: MonetizationWorkedExample = {
  tpvMinorUnits: '10000000',
  providerCostMinorUnits: '30000',
  platformRevenueMinorUnits: '20000',
  partnerCommissionMinorUnits: '5000',
  grossProfitMinorUnits: '15000',
  takeRateBps: '20',
  currency: 'USD',
  description:
    'A $100,000 transaction: $300 provider cost, $200 platform routing fee, $50 partner commission, $150 net platform contribution (20 bps take rate).',
};

/**
 * The same identity with the gain-share leg removed.
 *
 * Served whenever gain share is not admitted. The example is documentation of how the engine
 * splits a fee, and documentation that shows a $50 partner commission while no commission can be
 * charged describes a different product than the one running.
 */
export const MONETIZATION_WORKED_EXAMPLE_WITHOUT_GAIN_SHARE: MonetizationWorkedExample = {
  tpvMinorUnits: '10000000',
  providerCostMinorUnits: '30000',
  platformRevenueMinorUnits: '20000',
  partnerCommissionMinorUnits: '0',
  grossProfitMinorUnits: '20000',
  takeRateBps: '20',
  currency: 'USD',
  description:
    'A $100,000 transaction: $300 provider cost, $200 platform routing fee, $200 net platform contribution (20 bps take rate). Gain-share pricing is disabled, so no partner commission is charged.',
};
