import type { QuotedRouteOption } from '../domain/agent-payments.js';
import { assetExponent } from '../domain/asset.js';
import {
  DEFAULT_PARTNER_COMMISSION_BPS,
  MONETIZATION_WORKED_EXAMPLE,
  MONETIZATION_WORKED_EXAMPLE_WITHOUT_GAIN_SHARE,
  REVENUE_SOURCE_LABELS,
  revenueSourceForRail,
  type MonetizationBreakdownRow,
  type MonetizationEvent,
  type MonetizationReport,
  type MonetizationTotals,
  type MonetizationTransactionType,
  type RevenueSource,
  type EconomicStage,
} from '../domain/monetization.js';
import {
  REVENUE_LIFECYCLE_LABELS,
  REVENUE_LIFECYCLE_STATES,
  assertRealizationClaimSupported,
  isSimulatedOrigin,
  resolveRevenueLifecycle,
  type RevenueLifecycleState,
  type RevenueOriginEnv,
  type SettlementFinalityState,
} from '../domain/revenue-lifecycle.js';
import { isRailType } from '../domain/rail.js';
import type { ScoredRoute } from '../domain/route.js';
import type { ScoredMultiRailRoute } from './routing-types.js';
import { InvalidAmountError } from '../errors/index.js';
import {
  CURRENCY_REGISTRY,
  Dec,
  Rounding,
  bpsToRatio,
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
  /**
   * Whether the gain-share shape is admitted (§18.3).
   *
   * Defaults to `false`, which zeroes partner commission entirely rather than computing it and
   * withholding the payout. Gain share is the highest-risk shape — a share of the customer's
   * outcome — so while it is off it must contribute nothing to attribution or reporting, not
   * merely go unpaid.
   */
  readonly gainShareActive?: boolean | undefined;
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
    readonly routeId?: string | null | undefined;
    readonly quoteId?: string | null | undefined;
    readonly economicStage?: EconomicStage | undefined;
    readonly revenueRecognition?: MonetizationEvent['revenueRecognition'] | undefined;
    readonly originEnv: RevenueOriginEnv;
    readonly settlementFinality?: SettlementFinalityState | undefined;
    readonly collectionReference?: string | null | undefined;
    readonly realizedRevenue?: boolean | undefined;
    readonly invoiceId?: string | null | undefined;
  },
): MonetizationEvent {
  const priced = priceMonetization(input);
  const lifecycleInput = {
    economicStage: input.economicStage ?? 'route_quote',
    revenueRecognition: input.revenueRecognition ?? 'unrealized',
    realizedRevenue: input.realizedRevenue ?? false,
    originEnv: input.originEnv,
    settlementFinality: input.settlementFinality ?? 'unsettled',
    collectionReference: input.collectionReference ?? null,
  };
  assertRealizationClaimSupported(lifecycleInput);
  const lifecycle = resolveRevenueLifecycle(lifecycleInput);
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
    routeId: input.routeId ?? null,
    quoteId: input.quoteId ?? null,
    economicStage: lifecycleInput.economicStage,
    realizedRevenue: lifecycleInput.realizedRevenue,
    revenueRecognition: lifecycleInput.revenueRecognition,
    originEnv: lifecycleInput.originEnv,
    settlementFinality: lifecycleInput.settlementFinality,
    collectionReference: lifecycleInput.collectionReference,
    lifecycleState: lifecycle.state,
    invoiceId: input.invoiceId ?? null,
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

/**
 * Build the revenue report for a set of events.
 *
 * `gainShareActive` defaults to `false` and gates the whole gain-share shape, not just its payout
 * (§18.3). While off, partner commission is zeroed on every row — summary, breakdowns, and the
 * event ledger alike — and the partner payout line disappears from `byRevenueSource`. Zeroing at
 * read time rather than trusting the stored column is what makes the gate retroactive: rows
 * written before the flag existed carry a 25% commission that was never contractually owed, and
 * reporting it would present an unauthorized shape as revenue.
 */
export function aggregateMonetization(
  events: readonly MonetizationEvent[],
  options: {
    readonly organizationId?: string | undefined;
    readonly gainShareActive?: boolean | undefined;
  } = {},
): MonetizationReport {
  const gainShareActive = options.gainShareActive === true;
  const inScope =
    options.organizationId === undefined
      ? events
      : events.filter((event) => event.organizationId === options.organizationId);
  const scoped = gainShareActive ? inScope : inScope.map(withoutGainShare);
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
      ...(gainShareActive ? [partnerPayoutRow(comparable)] : []),
    ].filter((row) => row.eventCount > 0 || row.key === 'partner_referral_commission'),
    byDate: breakdown(
      comparable,
      (event) => event.occurredAt.slice(0, 10),
      (event) => event.occurredAt.slice(0, 10),
    ),
    byLifecycleState: orderedByLifecycleState(
      breakdown(
        comparable,
        (event) => lifecycleStateOf(event),
        (event) => REVENUE_LIFECYCLE_LABELS[lifecycleStateOf(event)],
      ),
    ),
    byOriginEnv: breakdown(
      comparable,
      (event) => event.originEnv,
      (event) => event.originEnv,
    ),
    events: scoped,
    workedExample: gainShareActive
      ? MONETIZATION_WORKED_EXAMPLE
      : MONETIZATION_WORKED_EXAMPLE_WITHOUT_GAIN_SHARE,
    gainShareActive,
    fundsMoved: false,
  };
}

/**
 * Strip the gain-share shape from one event.
 *
 * Gross profit rises to the full platform revenue because an uncharged commission is not a cost:
 * leaving profit net of a payout that will not happen would understate the platform's position
 * just as badly as reporting the commission itself overstates the partner's.
 */
function withoutGainShare(event: MonetizationEvent): MonetizationEvent {
  if (event.partnerCommissionMinorUnits === '0') {
    return event;
  }
  return {
    ...event,
    partnerCommissionMinorUnits: '0',
    grossProfitMinorUnits: event.platformRevenueMinorUnits,
  };
}

function resolveCommission(platformRevenue: bigint, input: MonetizationPriceInput): bigint {
  if (input.gainShareActive !== true) {
    return 0n;
  }
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
  return ratioToBps(toDecimal(platformRevenue.toString()).div(toDecimal(tpv.toString()))).toFixed(4);
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
  let invoiced = 0n;
  let collected = 0n;
  let settledStage = 0n;
  let simulatedOrigin = 0n;
  const byState = new Map<RevenueLifecycleState, bigint>();
  for (const event of events) {
    const revenue = BigInt(event.platformRevenueMinorUnits);
    tpv += BigInt(event.tpvMinorUnits);
    provider += BigInt(event.providerCostMinorUnits);
    platform += revenue;
    partner += BigInt(event.partnerCommissionMinorUnits);
    profit += BigInt(event.grossProfitMinorUnits);
    const state = lifecycleStateOf(event);
    byState.set(state, (byState.get(state) ?? 0n) + revenue);
    if (event.revenueRecognition === 'invoiced' || event.revenueRecognition === 'collected') {
      invoiced += revenue;
    }
    if (event.revenueRecognition === 'collected') {
      collected += revenue;
    }
    if (event.economicStage === 'settled') {
      settledStage += revenue;
    }
    if (isSimulatedOrigin(event.originEnv)) {
      simulatedOrigin += revenue;
    }
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
    quotedRevenueMinorUnits: (byState.get('QUOTED_REVENUE') ?? 0n).toString(),
    expectedRevenueMinorUnits: (byState.get('EXPECTED_REVENUE') ?? 0n).toString(),
    attributedRevenueMinorUnits: (byState.get('ATTRIBUTED_REVENUE') ?? 0n).toString(),
    realizedRevenueMinorUnits: (byState.get('REALIZED_REVENUE') ?? 0n).toString(),
    invoicedRevenueMinorUnits: invoiced.toString(),
    collectedRevenueMinorUnits: collected.toString(),
    settledStageRevenueMinorUnits: settledStage.toString(),
    simulatedOriginRevenueMinorUnits: simulatedOrigin.toString(),
  };
}

/**
 * Lifecycle state of a persisted event.
 *
 * Re-derives rather than trusting the stored `lifecycleState`, so a row written by an older
 * revision or edited out of band cannot report itself as cash.
 */
export function lifecycleStateOf(event: MonetizationEvent): RevenueLifecycleState {
  return resolveRevenueLifecycle({
    economicStage: event.economicStage,
    revenueRecognition: event.revenueRecognition,
    realizedRevenue: event.realizedRevenue,
    originEnv: event.originEnv,
    settlementFinality: event.settlementFinality,
    collectionReference: event.collectionReference,
  }).state;
}

/**
 * Return the event with `lifecycleState` and `realizedRevenue` recomputed from its other fields.
 *
 * Any store that mutates recognition, finality, or the collection reference must pass the result
 * through here, otherwise the stored state would describe the row as it used to be. Coercing
 * `realizedRevenue` to the resolver's verdict is what stops a row from carrying a realization
 * claim its own fields do not support — the §18.2 rule that no field may read as cash while
 * holding quoted, expected, or attributed revenue.
 */
export function withResolvedLifecycle(event: MonetizationEvent): MonetizationEvent {
  const resolution = resolveRevenueLifecycle({
    economicStage: event.economicStage,
    revenueRecognition: event.revenueRecognition,
    realizedRevenue: event.realizedRevenue,
    originEnv: event.originEnv,
    settlementFinality: event.settlementFinality,
    collectionReference: event.collectionReference,
  });
  if (
    resolution.state === event.lifecycleState &&
    resolution.cashRecognizable === event.realizedRevenue
  ) {
    return event;
  }
  return {
    ...event,
    lifecycleState: resolution.state,
    realizedRevenue: resolution.cashRecognizable,
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
        realizedRevenueMinorUnits: summed.realizedRevenueMinorUnits,
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

/** Funnel order, not revenue order: a lifecycle breakdown reads as a progression. */
function orderedByLifecycleState(
  rows: readonly MonetizationBreakdownRow[],
): readonly MonetizationBreakdownRow[] {
  return [...rows].sort(
    (left, right) =>
      REVENUE_LIFECYCLE_STATES.indexOf(left.key as RevenueLifecycleState) -
      REVENUE_LIFECYCLE_STATES.indexOf(right.key as RevenueLifecycleState),
  );
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
    realizedRevenueMinorUnits: '0',
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
  readonly originEnv: RevenueOriginEnv;
  readonly gainShareActive?: boolean | undefined;
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
    routeId: input.route.provider.id,
    quoteId: input.comparisonId,
    economicStage: 'route_quote',
    originEnv: input.originEnv,
    gainShareActive: input.gainShareActive ?? false,
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

/**
 * Attribute (never settle) platform/provider fees on a multi-rail recommended route.
 *
 * Used by `/routes` and `/comparisons`. `economicStage` distinguishes discovery from an
 * execution-intent snapshot. Realized revenue stays false.
 */
export function monetizationFromMultiRailRoute(input: {
  readonly organizationId: string;
  readonly occurredAt: string;
  readonly routingId: string;
  readonly route: ScoredMultiRailRoute;
  readonly economicStage: EconomicStage;
  readonly eventId: string;
  readonly quoteId: string | null;
  readonly originEnv: RevenueOriginEnv;
  readonly settlementFinality?: SettlementFinalityState | undefined;
  readonly gainShareActive?: boolean | undefined;
}): MonetizationEvent {
  const priced = priceRouteMonetization(input.route);
  return buildMonetizationEvent({
    id: input.eventId,
    organizationId: input.organizationId,
    occurredAt: input.occurredAt,
    transactionType: 'multi_rail_quote',
    revenueSource: revenueSourceForRail(input.route.rail),
    rail: input.route.rail,
    providerId: input.route.provider.id,
    providerName: input.route.provider.name,
    currency: input.route.sendAmount.asset,
    asset: input.route.sendAmount.asset,
    destinationAsset: input.route.deliveredAmount.asset,
    agentId: null,
    routeId: input.route.routeId,
    quoteId: input.quoteId,
    economicStage: input.economicStage,
    originEnv: input.originEnv,
    settlementFinality: input.settlementFinality ?? 'unsettled',
    gainShareActive: input.gainShareActive ?? false,
    tpvMinorUnits: priced.tpvMinorUnits,
    providerCostMinorUnits: priced.providerCostMinorUnits,
    platformRevenueMinorUnits: priced.platformRevenueMinorUnits,
  });
}

/** Decimal-safe fee split for a scored multi-rail route. Display metadata, not realized revenue. */
export function priceRouteMonetization(route: ScoredMultiRailRoute): MonetizationComputation {
  const source = route.sendAmount.asset;
  const midMarketRate = route.midMarketRate.toFixed();
  return priceMonetization({
    tpvMinorUnits: route.sendAmount.minorUnits.toString(),
    providerCostMinorUnits: convertDestMinorToSource({
      destMinorUnits: route.breakdown.providerFee.minorUnits.toString(),
      destAsset: route.breakdown.providerFee.asset,
      sourceAsset: source,
      midMarketRate,
    }),
    platformRevenueMinorUnits: convertDestMinorToSource({
      destMinorUnits: route.breakdown.platformFee.minorUnits.toString(),
      destAsset: route.breakdown.platformFee.asset,
      sourceAsset: source,
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
  readonly originEnv: RevenueOriginEnv;
  readonly gainShareActive?: boolean | undefined;
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
    routeId: input.route.routeId ?? input.route.providerId,
    quoteId: input.paymentIntentId,
    economicStage: 'route_quote',
    originEnv: input.originEnv,
    gainShareActive: input.gainShareActive ?? false,
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
