import type { RailType } from './rail.js';

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
    typeof value === 'string' &&
    (MONETIZATION_TRANSACTION_TYPES as readonly string[]).includes(value)
  );
}

export function revenueSourceForRail(rail: RailType): RevenueSource {
  return RAIL_REVENUE_SOURCE[rail];
}

/**
 * One priced (never settled) monetization event.
 *
 * Amounts are integer minor units of `currency`. `takeRateBps` is Decimal text. `fundsMoved` is
 * always false: this is a quote/simulation ledger, not a cash ledger.
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
  readonly events: readonly MonetizationEvent[];
  readonly workedExample: MonetizationWorkedExample;
  readonly fundsMoved: false;
}

/** Canonical identity from the product brief, in USD minor units. */
export interface MonetizationWorkedExample {
  readonly tpvMinorUnits: '10000000';
  readonly providerCostMinorUnits: '30000';
  readonly platformRevenueMinorUnits: '20000';
  readonly partnerCommissionMinorUnits: '5000';
  readonly grossProfitMinorUnits: '15000';
  readonly takeRateBps: '20';
  readonly currency: 'USD';
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
