import type { QuotedRouteOption } from '../domain/agent-payments.js';
import { assetExponent } from '../domain/asset.js';
import {
  DEFAULT_PARTNER_COMMISSION_BPS,
  MONETIZATION_WORKED_EXAMPLE,
  REVENUE_SOURCE_LABELS,
  revenueSourceForRail,
  type MonetizationBreakdownRow,
  type MonetizationEvent,
  type MonetizationReport,
  type MonetizationTotals,
  type MonetizationTransactionType,
  type RevenueSource,
} from '../domain/monetization.js';
import { isRailType } from '../domain/rail.js';
import type { ScoredRoute } from '../domain/route.js';
import { InvalidAmountError } from '../errors/index.js';
import {
  CURRENCY_REGISTRY,
  Dec,
  Rounding,
  bpsToRatio,
  formatDecimal,
  isCurrencyCode,
  ratioToBps,
  toDecimal,
} from '../money/index.js';

export interface MonetizationPriceInput {
  readonly tpvMinorUnits: string;
  readonly providerCostMinorUnits: string;
  readonly platformRevenueMinorUnits: string;
  /** Share of platform revenue paid to a partner. Defaults to {@link DEFAULT_PARTNER_COMMISSION_BPS}. */
  readonly partnerCommissionBps?: string | undefined;
  /** Explicit partner payout. When set, overrides the bps share. */
  readonly partnerCommissionMinorUnits?: string | undefined;
}

export interface MonetizationComputation {
  readonly tpvMinorUnits: string;
  readonly grossRevenueMinorUnits: string;
  readonly providerCostMinorUnits: string;
  readonly platformRevenueMinorUnits: string;
  readonly partnerCommissionMinorUnits: string;
  readonly grossProfitMinorUnits: string;
  readonly takeRateBps: string | null;
  readonly aiUsed: false;
}

/**
 * Multi-rail monetization engine.
 *
 * Extends the existing fee split (provider vs platform) with partner commission, take rate, and
 * gross profit. Arithmetic is Decimal/`bigint` only. TPV of zero (subscriptions) yields a null
 * take rate rather than a divide-by-zero.
 *
 * Identity:
 *
 * ```text
 *   grossRevenue     = platformRevenue
 *   partnerCommission = min(platformRevenue × commissionBps, platformRevenue)
 *   grossProfit      = platformRevenue − partnerCommission
 *   takeRateBps      = platformRevenue / TPV × 10_000   (null when TPV is 0)
 * ```
 */
export function priceMonetization(input: MonetizationPriceInput): MonetizationComputation {
  const tpv = parseMinor(input.tpvMinorUnits, 'tpvMinorUnits');
  const providerCost = parseMinor(input.providerCostMinorUnits, 'providerCostMinorUnits');
  const platformRevenue = parseMinor(
    input.platformRevenueMinorUnits,
    'platformRevenueMinorUnits',
  );
  if (tpv < 0n || providerCost < 0n || platformRevenue < 0n) {
    throw new InvalidAmountError('Monetization amounts must be non-negative minor units.', {
      tpvMinorUnits: input.tpvMinorUnits,
      providerCostMinorUnits: input.providerCostMinorUnits,
      platformRevenueMinorUnits: input.platformRevenueMinorUnits,
    });
  }

  const commission = resolveCommission(platformRevenue, input);
  const profit = platformRevenue - commission;
  const takeRateBps = takeRate(platformRevenue, tpv);

  return {
    tpvMinorUnits: tpv.toString(),
    grossRevenueMinorUnits: platformRevenue.toString(),
    providerCostMinorUnits: providerCost.toString(),
    platformRevenueMinorUnits: platformRevenue.toString(),
    partnerCommissionMinorUnits: commission.toString(),
    grossProfitMinorUnits: profit.toString(),
    takeRateBps,
    aiUsed: false,
  };
}

export function buildMonetizationEvent(
  input: MonetizationPriceInput & {
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
  },
): MonetizationEvent {
  const priced = priceMonetization(input);
  return {
    id: input.id,
    organizationId: input.organizationId,
    occurredAt: input.occurredAt,
    transactionType: input.transactionType,
    revenueSource: input.revenueSource,
    rail: input.rail,
    providerId: input.providerId,
    providerName: input.providerName,
    currency: input.currency,
    asset: input.asset,
    destinationAsset: input.destinationAsset,
    agentId: input.agentId,
    tpvMinorUnits: priced.tpvMinorUnits,
    providerCostMinorUnits: priced.providerCostMinorUnits,
    platformRevenueMinorUnits: priced.platformRevenueMinorUnits,
    partnerCommissionMinorUnits: priced.partnerCommissionMinorUnits,
    grossProfitMinorUnits: priced.grossProfitMinorUnits,
    takeRateBps: priced.takeRateBps,
    fundsMoved: false,
    custody: false,
    realExecution: false,
  };
}

export function convertDestMinorToSource(input: {
  readonly destMinorUnits: string;
  readonly destAsset: string;
  readonly sourceAsset: string;
  readonly midMarketRate: string;
}): string {
  if (input.destAsset === input.sourceAsset) {
    return parseMinor(input.destMinorUnits, 'destMinorUnits').toString();
  }
  const destExp = assetExponent(input.destAsset);
  const sourceExp = assetExponent(input.sourceAsset);
  const destMajor = toDecimal(input.destMinorUnits).div(new Dec(10).pow(destExp));
  const sourceMajor = destMajor.div(toDecimal(input.midMarketRate));
  const sourceMinor = sourceMajor.times(new Dec(10).pow(sourceExp));
  return sourceMinor.toDecimalPlaces(0, Rounding.HALF_UP).toFixed(0);
}

export function aggregateMonetization(
  events: readonly MonetizationEvent[],
  options: { readonly organizationId?: string | undefined } = {},
): MonetizationReport {
  const scoped =
    options.organizationId === undefined
      ? events
      : events.filter((event) => event.organizationId === options.organizationId);
  const reporting = reportingCurrency(scoped);
  const comparable = scoped.filter((event) => event.currency === reporting.currency);

  return {
    summary: totalsOf(comparable, reporting.currency, reporting.exponent),
    byRail: breakdown(comparable, (event) => event.rail ?? 'none', (event) => event.rail ?? 'None'),
    byProvider: breakdown(
      comparable,
      (event) => event.providerId ?? 'none',
      (event) => event.providerName ?? event.providerId ?? 'None',
    ),
    byCurrency: breakdown(scoped, (event) => event.currency, (event) => event.currency),
    byAsset: breakdown(scoped, (event) => event.asset, (event) => event.asset),
    byOrganization: breakdown(
      scoped,
      (event) => event.organizationId,
      (event) => event.organizationId,
    ),
    byAgent: breakdown(
      comparable.filter((event) => event.agentId !== null),
      (event) => event.agentId ?? 'none',
      (event) => event.agentId ?? 'None',
    ),
    byTransactionType: breakdown(
      comparable,
      (event) => event.transactionType,
      (event) => transactionTypeLabel(event.transactionType),
    ),
    byRevenueSource: [
      ...breakdown(
        comparable,
        (event) => event.revenueSource,
        (event) => REVENUE_SOURCE_LABELS[event.revenueSource],
      ),
      partnerPayoutRow(comparable),
    ].filter((row) => row.eventCount > 0 || row.key === 'partner_referral_commission'),
    byDate: breakdown(
      comparable,
      (event) => event.occurredAt.slice(0, 10),
      (event) => event.occurredAt.slice(0, 10),
    ),
    events: scoped,
    workedExample: MONETIZATION_WORKED_EXAMPLE,
    fundsMoved: false,
  };
}

function resolveCommission(platformRevenue: bigint, input: MonetizationPriceInput): bigint {
  if (input.partnerCommissionMinorUnits !== undefined) {
    const explicit = parseMinor(
      input.partnerCommissionMinorUnits,
      'partnerCommissionMinorUnits',
    );
    if (explicit < 0n) {
      throw new InvalidAmountError('Partner commission must be non-negative.', {
        partnerCommissionMinorUnits: input.partnerCommissionMinorUnits,
      });
    }
    return explicit > platformRevenue ? platformRevenue : explicit;
  }
  const bps = toDecimal(input.partnerCommissionBps ?? DEFAULT_PARTNER_COMMISSION_BPS);
  if (bps.isNegative()) {
    throw new InvalidAmountError('Partner commission bps must be non-negative.', {
      partnerCommissionBps: input.partnerCommissionBps ?? DEFAULT_PARTNER_COMMISSION_BPS,
    });
  }
  const computed = toDecimal(platformRevenue.toString())
    .times(bpsToRatio(bps))
    .toDecimalPlaces(0, Rounding.DOWN);
  const asInt = BigInt(computed.toFixed(0));
  return asInt > platformRevenue ? platformRevenue : asInt;
}

function takeRate(platformRevenue: bigint, tpv: bigint): string | null {
  if (tpv === 0n) {
    return null;
  }
  return formatDecimal(ratioToBps(toDecimal(platformRevenue.toString()).div(toDecimal(tpv.toString()))), 4);
}

function parseMinor(raw: string, field: string): bigint {
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new InvalidAmountError(`Monetization ${field} must be an integer string.`, {
      field,
      value: raw,
    });
  }
  return BigInt(raw.trim());
}

function reportingCurrency(events: readonly MonetizationEvent[]): {
  readonly currency: string;
  readonly exponent: number;
} {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.currency, (counts.get(event.currency) ?? 0) + 1);
  }
  let best = 'USD';
  let bestCount = -1;
  for (const [currency, count] of counts) {
    if (count > bestCount || (count === bestCount && currency < best)) {
      best = currency;
      bestCount = count;
    }
  }
  return { currency: best, exponent: exponentOf(best) };
}

function exponentOf(currency: string): number {
  if (isCurrencyCode(currency)) {
    return CURRENCY_REGISTRY[currency].exponent;
  }
  return assetExponent(currency);
}

function totalsOf(
  events: readonly MonetizationEvent[],
  currency: string,
  exponent: number,
): MonetizationTotals {
  let tpv = 0n;
  let provider = 0n;
  let platform = 0n;
  let partner = 0n;
  let profit = 0n;
  for (const event of events) {
    tpv += BigInt(event.tpvMinorUnits);
    provider += BigInt(event.providerCostMinorUnits);
    platform += BigInt(event.platformRevenueMinorUnits);
    partner += BigInt(event.partnerCommissionMinorUnits);
    profit += BigInt(event.grossProfitMinorUnits);
  }
  return {
    eventCount: events.length,
    tpvMinorUnits: tpv.toString(),
    grossRevenueMinorUnits: platform.toString(),
    providerCostMinorUnits: provider.toString(),
    platformRevenueMinorUnits: platform.toString(),
    partnerCommissionMinorUnits: partner.toString(),
    grossProfitMinorUnits: profit.toString(),
    takeRateBps: takeRate(platform, tpv),
    currency,
    exponent,
  };
}

function breakdown(
  events: readonly MonetizationEvent[],
  keyOf: (event: MonetizationEvent) => string,
  labelOf: (event: MonetizationEvent) => string,
): readonly MonetizationBreakdownRow[] {
  const groups = new Map<string, MonetizationEvent[]>();
  const labels = new Map<string, string>();
  for (const event of events) {
    const key = keyOf(event);
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
    if (!labels.has(key)) {
      labels.set(key, labelOf(event));
    }
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const summed = totalsOf(list, list[0]?.currency ?? 'USD', exponentOf(list[0]?.currency ?? 'USD'));
      return {
        key,
        label: labels.get(key) ?? key,
        eventCount: summed.eventCount,
        tpvMinorUnits: summed.tpvMinorUnits,
        grossRevenueMinorUnits: summed.grossRevenueMinorUnits,
        providerCostMinorUnits: summed.providerCostMinorUnits,
        platformRevenueMinorUnits: summed.platformRevenueMinorUnits,
        partnerCommissionMinorUnits: summed.partnerCommissionMinorUnits,
        grossProfitMinorUnits: summed.grossProfitMinorUnits,
        takeRateBps: summed.takeRateBps,
      };
    })
    .sort((left, right) => {
      const byRevenue = BigInt(right.platformRevenueMinorUnits) - BigInt(left.platformRevenueMinorUnits);
      if (byRevenue !== 0n) {
        return byRevenue > 0n ? 1 : -1;
      }
      return left.key.localeCompare(right.key);
    });
}

function partnerPayoutRow(events: readonly MonetizationEvent[]): MonetizationBreakdownRow {
  let payout = 0n;
  for (const event of events) {
    payout += BigInt(event.partnerCommissionMinorUnits);
  }
  return {
    key: 'partner_referral_commission',
    label: REVENUE_SOURCE_LABELS.partner_referral_commission,
    eventCount: events.filter((event) => BigInt(event.partnerCommissionMinorUnits) > 0n).length,
    tpvMinorUnits: '0',
    grossRevenueMinorUnits: '0',
    providerCostMinorUnits: '0',
    platformRevenueMinorUnits: '0',
    partnerCommissionMinorUnits: payout.toString(),
    grossProfitMinorUnits: payout === 0n ? '0' : `-${payout.toString()}`,
    takeRateBps: null,
  };
}

/**
 * Attribute platform/provider fees on a recommended fiat comparison route.
 *
 * Provider cost is source + destination provider fees, valued in the send asset. FX spread and
 * slippage stay in the cost engine — they are not platform revenue.
 */
export function monetizationFromRecommendedFiatRoute(input: {
  readonly comparisonId: string;
  readonly organizationId: string;
  readonly occurredAt: string;
  readonly route: Pick<
    ScoredRoute,
    'provider' | 'rail' | 'sendAmount' | 'midMarketRate' | 'breakdown'
  >;
  readonly destinationAsset: string;
}): MonetizationEvent {
  const sourceAsset = input.route.sendAmount.currency;
  const midMarketRate = input.route.midMarketRate.value.toFixed();
  const providerDest = input.route.breakdown.sourceFeeCost.add(
    input.route.breakdown.destinationFeeCost,
  );
  return buildMonetizationEvent({
    id: `mon_cmp_${input.comparisonId}`,
    organizationId: input.organizationId,
    occurredAt: input.occurredAt,
    transactionType: 'fiat_comparison',
    revenueSource: revenueSourceForRail(input.route.rail),
    rail: input.route.rail,
    providerId: input.route.provider.id,
    providerName: input.route.provider.name,
    currency: sourceAsset,
    asset: sourceAsset,
    destinationAsset: input.destinationAsset,
    agentId: null,
    tpvMinorUnits: input.route.sendAmount.minorUnits.toString(),
    providerCostMinorUnits: convertDestMinorToSource({
      destMinorUnits: providerDest.minorUnits.toString(),
      destAsset: providerDest.currency,
      sourceAsset,
      midMarketRate,
    }),
    platformRevenueMinorUnits: convertDestMinorToSource({
      destMinorUnits: input.route.breakdown.platformFeeCost.minorUnits.toString(),
      destAsset: input.route.breakdown.platformFeeCost.currency,
      sourceAsset,
      midMarketRate,
    }),
  });
}

/** Attribute the recommended quoted agent-payment route. Always `ai_agent_payment_fee`. */
export function monetizationFromQuotedAgentRoute(input: {
  readonly paymentIntentId: string;
  readonly organizationId: string;
  readonly occurredAt: string;
  readonly agentId: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly route: QuotedRouteOption;
}): MonetizationEvent {
  return buildMonetizationEvent({
    id: `mon_${input.paymentIntentId}`,
    organizationId: input.organizationId,
    occurredAt: input.occurredAt,
    transactionType: 'agent_payment',
    revenueSource: 'ai_agent_payment_fee',
    rail: isRailType(input.route.rail) ? input.route.rail : null,
    providerId: input.route.providerId,
    providerName: input.route.providerName,
    currency: input.sourceAsset,
    asset: input.sourceAsset,
    destinationAsset: input.destinationAsset,
    agentId: input.agentId,
    tpvMinorUnits: input.amountMinorUnits,
    providerCostMinorUnits: input.route.providerFeeMinorUnits ?? '0',
    platformRevenueMinorUnits: input.route.platformFeeMinorUnits ?? '0',
  });
}

function transactionTypeLabel(type: MonetizationTransactionType): string {
  switch (type) {
    case 'fiat_comparison':
      return 'Fiat comparison';
    case 'multi_rail_quote':
      return 'Multi-rail quote';
    case 'agent_payment':
      return 'AI agent payment';
    case 'enterprise_subscription':
      return 'Enterprise subscription';
  }
}
