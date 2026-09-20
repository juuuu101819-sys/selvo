import {
  assertNoDoubleCharge,
  type BillableAction,
  type BillableEventClass,
} from '../domain/billable-event.js';
import type { DraftInvoice, DraftInvoiceLine } from '../domain/billing.js';
import type { MonetizationEvent } from '../domain/monetization.js';
import {
  DEFAULT_SUBSCRIPTION_TIERS,
  parseTierAmount,
  tierDefinition,
  type OrganizationSubscription,
  type SubscriptionTierCatalog,
} from '../domain/subscription.js';
import {
  METERED_ENDPOINT_LABELS,
  parseCallCount,
  type UsageRollup,
} from '../domain/usage-metering.js';
import { InvalidAmountError, ValidationError } from '../errors/index.js';

/**
 * Builds the three kinds of invoice line and asserts they do not overlap (§18.4, §18.6).
 *
 * Kept separate from {@link runMonthlyBilling} because the interesting property here is
 * arithmetic, not orchestration: each function takes plain values and returns a line, so the
 * no-double-charge and size-independence rules can be tested without a store or a clock.
 */

/** Synthetic stage for lines that bill a period rather than one routed decision. */
const PERIOD_STAGE = 'billing_period';

export interface SubscriptionLineInput {
  readonly subscription: OrganizationSubscription;
  readonly periodStart: string;
  readonly catalog?: SubscriptionTierCatalog | undefined;
}

/**
 * The monthly base fee for the org's tier.
 *
 * Returns null for a zero base (the `free` tier), because a $0.00 line on an invoice is noise,
 * not transparency.
 */
export function subscriptionPeriodLine(input: SubscriptionLineInput): DraftInvoiceLine | null {
  const catalog = input.catalog ?? DEFAULT_SUBSCRIPTION_TIERS;
  const definition = tierDefinition(catalog, input.subscription.tier);
  const base = parseTierAmount(definition.monthlyBaseMinorUnits, 'monthlyBaseMinorUnits');
  if (base === 0n) {
    return null;
  }
  return {
    monetizationEventId: null,
    eventClass: 'SUBSCRIPTION_PERIOD',
    description: `${definition.tier} plan — platform access for ${input.periodStart.slice(0, 7)}`,
    quantity: '1',
    platformRevenueMinorUnits: base.toString(),
    economicStage: PERIOD_STAGE,
    transactionType: 'enterprise_subscription',
    revenueSource: 'enterprise_api_subscription',
    occurredAt: input.periodStart,
  };
}

export interface MeteredLineInput {
  readonly rollup: UsageRollup;
  readonly subscription: OrganizationSubscription;
  readonly catalog?: SubscriptionTierCatalog | undefined;
}

export interface MeteredOverage {
  readonly totalCalls: bigint;
  readonly includedCalls: bigint;
  readonly billableCalls: bigint;
  readonly unitPriceMinorUnits: bigint;
  readonly amountMinorUnits: bigint;
}

/**
 * Split a period's calls into the quota the tier includes and the overage that is charged.
 *
 * Exposed separately from {@link meteredCallLine} so the usage dashboard can show a customer how
 * close they are to their quota using the same arithmetic that will bill them.
 */
export function meteredOverage(input: MeteredLineInput): MeteredOverage {
  const catalog = input.catalog ?? DEFAULT_SUBSCRIPTION_TIERS;
  const definition = tierDefinition(catalog, input.subscription.tier);
  const totalCalls = parseCallCount(input.rollup.totalCalls, 'totalCalls');
  const includedCalls = parseCallCount(definition.includedCalls, 'includedCalls');
  const unitPriceMinorUnits = parseTierAmount(
    definition.overagePerCallMinorUnits,
    'overagePerCallMinorUnits',
  );
  const billableCalls = totalCalls > includedCalls ? totalCalls - includedCalls : 0n;
  return {
    totalCalls,
    includedCalls,
    billableCalls,
    unitPriceMinorUnits,
    amountMinorUnits: billableCalls * unitPriceMinorUnits,
  };
}

/**
 * One line for all calls beyond the included quota.
 *
 * Deliberately a single line rather than one per endpoint: the quota is shared across endpoints,
 * so attributing the overage to a particular surface would require picking an arbitrary order.
 * The per-endpoint counts stay visible in {@link UsageRollup} and on the usage report.
 */
export function meteredCallLine(input: MeteredLineInput): DraftInvoiceLine | null {
  const overage = meteredOverage(input);
  if (overage.amountMinorUnits === 0n) {
    return null;
  }
  const surfaces = input.rollup.byEndpoint
    .map((row) => `${METERED_ENDPOINT_LABELS[row.endpoint]} ${row.callCount}`)
    .join(', ');
  return {
    monetizationEventId: null,
    eventClass: 'METERED_CALL',
    description:
      `${overage.billableCalls.toString()} API calls beyond the ` +
      `${overage.includedCalls.toString()} included in the ${input.subscription.tier} plan` +
      (surfaces === '' ? '' : ` (${surfaces})`),
    quantity: overage.billableCalls.toString(),
    platformRevenueMinorUnits: overage.amountMinorUnits.toString(),
    economicStage: PERIOD_STAGE,
    transactionType: 'enterprise_subscription',
    revenueSource: 'enterprise_api_subscription',
    occurredAt: input.rollup.periodStart,
  };
}

/**
 * One line per billable routing decision, copying the revenue already recorded on the snapshot.
 *
 * The amount is read from the snapshot rather than recomputed, so the invoice cannot disagree with
 * what the customer was quoted. Whether that recorded amount was allowed to include a percentage
 * of notional was decided at quote time by the pricing-shape admission (§18.3).
 */
export function flatDecisionLines(
  events: readonly MonetizationEvent[],
): readonly DraftInvoiceLine[] {
  return events.map((event) => ({
    monetizationEventId: event.id,
    eventClass: 'FLAT_DECISION' as const,
    description: `Routing decision ${event.routeId ?? event.id}`,
    quantity: '1',
    platformRevenueMinorUnits: event.platformRevenueMinorUnits,
    economicStage: event.economicStage,
    transactionType: event.transactionType,
    revenueSource: event.revenueSource,
    occurredAt: event.occurredAt,
  }));
}

/** The action each class is charged for, used to assert the taxonomy does not overlap. */
const ACTION_FOR_CLASS: Readonly<Record<BillableEventClass, BillableAction>> = {
  SUBSCRIPTION_PERIOD: 'subscription.period',
  METERED_CALL: 'quote.read',
  FLAT_DECISION: 'decision.execution_intent',
};

export interface ComposeDraftInvoiceInput {
  readonly organizationId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;
  readonly lines: readonly DraftInvoiceLine[];
}

/**
 * Assemble lines into a draft invoice, refusing an overlapping taxonomy.
 *
 * At most one line per charge class reaches an invoice for a given period, and each class is
 * checked against the action it is allowed to bill. A code path that produced both a metered
 * charge and a decision fee for the same request fails here rather than on the customer's bill.
 */
export function composeDraftInvoice(input: ComposeDraftInvoiceInput): DraftInvoice {
  const classCounts = new Map<BillableEventClass, number>();
  for (const line of input.lines) {
    classCounts.set(line.eventClass, (classCounts.get(line.eventClass) ?? 0) + 1);
  }
  for (const periodClass of ['SUBSCRIPTION_PERIOD', 'METERED_CALL'] as const) {
    const count = classCounts.get(periodClass) ?? 0;
    if (count > 1) {
      throw new ValidationError(
        `An invoice may carry at most one ${periodClass} line per period; found ${count.toString()}.`,
        { organizationId: input.organizationId, periodStart: input.periodStart, count },
      );
    }
  }
  assertNoDoubleCharge(
    [...classCounts.keys()].map((eventClass) => ({
      action: ACTION_FOR_CLASS[eventClass],
      eventClass,
    })),
  );

  const seenEventIds = new Set<string>();
  for (const line of input.lines) {
    if (line.monetizationEventId === null) {
      continue;
    }
    if (seenEventIds.has(line.monetizationEventId)) {
      throw new ValidationError('One monetization snapshot must not be billed twice.', {
        monetizationEventId: line.monetizationEventId,
      });
    }
    seenEventIds.add(line.monetizationEventId);
  }

  const subtotal = sumMinor(input.lines.map((line) => line.platformRevenueMinorUnits));
  return {
    organizationId: input.organizationId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    currency: input.currency,
    subtotalMinorUnits: subtotal,
    taxMinorUnits: '0',
    totalMinorUnits: subtotal,
    lines: input.lines,
  };
}

function sumMinor(values: readonly string[]): string {
  let total = 0n;
  for (const value of values) {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new InvalidAmountError('Invoice line amounts must be non-negative integer strings.', {
        value,
      });
    }
    total += BigInt(trimmed);
  }
  return total.toString();
}
