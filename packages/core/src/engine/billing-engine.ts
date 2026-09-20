import {
  BILLING_CADENCE,
  invoiceCollectionRollup,
  type BillingRunResult,
  type DraftInvoice,
  type DraftInvoiceLine,
  type ReconciliationCurrencyRow,
  type ReconciliationReport,
  type Invoice,
} from '../domain/billing.js';
import type { BillingCollectionMode } from '../domain/collection.js';
import type { MonetizationEvent } from '../domain/monetization.js';
import {
  DEFAULT_SUBSCRIPTION_TIERS,
  type OrganizationSubscription,
  type SubscriptionTierCatalog,
} from '../domain/subscription.js';
import { rollupUsage, type UsageRollup } from '../domain/usage-metering.js';
import { InvalidAmountError, ValidationError } from '../errors/index.js';
import type { AuditLogger } from '../ports/audit.js';
import type {
  BillingStore,
  IssueInvoiceInput,
  SubscriptionStore,
  UsageMeterStore,
} from '../ports/billing.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import {
  composeDraftInvoice,
  flatDecisionLines,
  meteredCallLine,
  subscriptionPeriodLine,
} from './billing-lines.js';

const MONTH_START = /^(\d{4})-(\d{2})-01T00:00:00\.000Z$/;

export interface BillingRunDependencies {
  readonly store: BillingStore;
  readonly auditLogger: AuditLogger;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** Tier assignments. Omitted means no subscription lines are billed. */
  readonly subscriptions?: SubscriptionStore | undefined;
  /** API call counters. Omitted means no metered lines are billed. */
  readonly usage?: UsageMeterStore | undefined;
  readonly tierCatalog?: SubscriptionTierCatalog | undefined;
  /**
   * Mode the resulting invoices are stamped with. Defaults to `RECORD_ONLY`, so a caller that
   * forgets to pass it produces invoices that were never sent to a processor rather than invoices
   * that claim they were.
   */
  readonly collectionMode?: BillingCollectionMode | undefined;
}

export interface BillingRunInput {
  readonly periodStart: string;
  readonly organizationId?: string;
  readonly actor: string;
  readonly requestId: string | null;
}

/**
 * True when a persisted snapshot is eligible to appear on a new invoice.
 *
 * Route views (`route_quote`) are never billed — invariant ②. Zero platform-revenue rows are
 * skipped. Already-invoiced or collected rows are skipped (idempotency).
 */
export function isBillableSnapshot(event: MonetizationEvent): boolean {
  if (event.revenueRecognition !== 'unrealized') {
    return false;
  }
  if (event.invoiceId !== null) {
    return false;
  }
  if (parseMinor(event.platformRevenueMinorUnits, 'platformRevenueMinorUnits') <= 0n) {
    return false;
  }
  return (
    event.economicStage === 'execution_intent' || event.transactionType === 'enterprise_subscription'
  );
}

/** Billable shape ignoring recognition status — used by reconciliation. */
export function isBillableShape(event: MonetizationEvent): boolean {
  if (parseMinor(event.platformRevenueMinorUnits, 'platformRevenueMinorUnits') <= 0n) {
    return false;
  }
  return (
    event.economicStage === 'execution_intent' || event.transactionType === 'enterprise_subscription'
  );
}

export function utcMonthWindow(periodStart: string): {
  readonly periodStart: string;
  readonly periodEnd: string;
} {
  const match = MONTH_START.exec(periodStart);
  if (match === null) {
    throw new ValidationError(
      'periodStart must be the first instant of a UTC calendar month (YYYY-MM-01T00:00:00.000Z).',
      { periodStart },
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new ValidationError('periodStart month must be 01–12.', { periodStart });
  }
  const startMs = Date.UTC(year, month - 1, 1);
  const endMs = Date.UTC(year, month, 1);
  const normalized = new Date(startMs).toISOString();
  if (normalized !== periodStart) {
    throw new ValidationError(
      'periodStart must be the first instant of a UTC calendar month (YYYY-MM-01T00:00:00.000Z).',
      { periodStart },
    );
  }
  return { periodStart, periodEnd: new Date(endMs).toISOString() };
}

export function invoiceNumberFor(input: {
  readonly organizationId: string;
  readonly periodStart: string;
  readonly currency: string;
}): string {
  const yearMonth = input.periodStart.slice(0, 7).replace('-', '');
  const org = input.organizationId.replaceAll(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  return `INV-${yearMonth}-${org}-${input.currency}`;
}

/**
 * Build an invoice draft for one organization and currency.
 *
 * Snapshot revenue is copied, never recomputed, so the invoice cannot disagree with the quote the
 * customer saw. Subscription and metered lines are added only when `subscription` and `usage` are
 * supplied and only on the invoice whose currency matches the tier, since one invoice carries one
 * currency.
 */
export function draftInvoiceFromSnapshots(input: {
  readonly organizationId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;
  readonly events: readonly MonetizationEvent[];
  readonly subscription?: OrganizationSubscription | undefined;
  readonly usage?: UsageRollup | undefined;
  readonly tierCatalog?: SubscriptionTierCatalog | undefined;
}): DraftInvoice {
  for (const event of input.events) {
    if (event.organizationId !== input.organizationId) {
      throw new ValidationError('Cannot bill a snapshot onto another organization invoice.', {
        eventId: event.id,
        eventOrganizationId: event.organizationId,
        invoiceOrganizationId: input.organizationId,
      });
    }
    if (event.currency !== input.currency) {
      throw new ValidationError('Cannot mix currencies on one invoice.', {
        eventId: event.id,
        eventCurrency: event.currency,
        invoiceCurrency: input.currency,
      });
    }
  }

  const periodLines: DraftInvoiceLine[] = [];
  const subscription = input.subscription;
  if (subscription !== undefined && subscription.currency === input.currency) {
    const base = subscriptionPeriodLine({
      subscription,
      periodStart: input.periodStart,
      catalog: input.tierCatalog,
    });
    if (base !== null) {
      periodLines.push(base);
    }
    if (input.usage !== undefined) {
      const metered = meteredCallLine({
        rollup: input.usage,
        subscription,
        catalog: input.tierCatalog,
      });
      if (metered !== null) {
        periodLines.push(metered);
      }
    }
  }

  return composeDraftInvoice({
    organizationId: input.organizationId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    currency: input.currency,
    lines: [...periodLines, ...flatDecisionLines(input.events)],
  });
}

export function reconcilePeriod(input: {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly events: readonly MonetizationEvent[];
  readonly invoices: readonly Invoice[];
}): ReconciliationReport {
  // Only snapshot-derived lines are counted. Subscription and metered lines bill a period, so
  // they have no snapshot to reconcile against and cannot be double-billed this way.
  const billedCounts = new Map<string, number>();
  for (const invoice of input.invoices) {
    for (const line of invoice.lines) {
      if (line.monetizationEventId === null) {
        continue;
      }
      billedCounts.set(line.monetizationEventId, (billedCounts.get(line.monetizationEventId) ?? 0) + 1);
    }
  }
  const billedSnapshotIds = [...billedCounts.keys()].sort();
  const currencies = new Set<string>();
  for (const event of input.events) {
    currencies.add(event.currency);
  }
  for (const invoice of input.invoices) {
    currencies.add(invoice.currency);
  }

  const byCurrency: ReconciliationCurrencyRow[] = [...currencies]
    .sort()
    .map((currency) => {
      const events = input.events.filter((event) => event.currency === currency);
      const invoices = input.invoices.filter((invoice) => invoice.currency === currency);
      const quoted = sumMinor(
        events.map((event) => event.platformRevenueMinorUnits),
        'platformRevenueMinorUnits',
      );
      const billableEvents = events.filter(isBillableShape);
      const billable = sumMinor(
        billableEvents.map((event) => event.platformRevenueMinorUnits),
        'platformRevenueMinorUnits',
      );
      const invoiced = sumMinor(
        invoices.map((invoice) => invoice.totalMinorUnits),
        'totalMinorUnits',
      );
      const collected = sumMinor(
        invoices
          .filter((invoice) => invoice.collectionStatus === 'collected')
          .map((invoice) => invoice.totalMinorUnits),
        'totalMinorUnits',
      );
      const unbilledEvents = billableEvents.filter((event) => event.revenueRecognition === 'unrealized');
      const unbilled = sumMinor(
        unbilledEvents.map((event) => event.platformRevenueMinorUnits),
        'platformRevenueMinorUnits',
      );
      const duplicateBilledSnapshotIds = [...billedCounts.entries()]
        .filter(([eventId, count]) => count > 1 && events.some((event) => event.id === eventId))
        .map(([eventId]) => eventId)
        .sort();
      const invoicedSnapshotCount = invoices.reduce((count, invoice) => count + invoice.lines.length, 0);
      return {
        currency,
        quotedEventCount: events.length,
        quotedPlatformRevenueMinorUnits: quoted,
        billableEventCount: billableEvents.length,
        billablePlatformRevenueMinorUnits: billable,
        invoicedSnapshotCount,
        invoicedPlatformRevenueMinorUnits: invoiced,
        collectedPlatformRevenueMinorUnits: collected,
        unbilledBillableCount: unbilledEvents.length,
        unbilledBillableMinorUnits: unbilled,
        duplicateBilledSnapshotIds,
      };
    });

  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    cadence: BILLING_CADENCE,
    collectionStatus: invoiceCollectionRollup(input.invoices),
    taxCalculation: 'deferred',
    issuerLegalEntity: 'unconfirmed',
    billedSnapshotIds,
    byCurrency,
  };
}

export async function runMonthlyBilling(
  deps: BillingRunDependencies,
  input: BillingRunInput,
): Promise<BillingRunResult> {
  const { periodStart, periodEnd } = utcMonthWindow(input.periodStart);
  const events = await deps.store.listEventsInPeriod({
    periodStart,
    periodEnd,
    ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
  });

  const groups = new Map<string, MonetizationEvent[]>();
  const orgIds = new Set<string>();
  for (const event of events) {
    orgIds.add(event.organizationId);
    if (!isBillableSnapshot(event)) {
      continue;
    }
    const key = `${event.organizationId}\0${event.currency}`;
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }

  if (input.organizationId !== undefined) {
    orgIds.add(input.organizationId);
  }

  const { subscriptions, usageByOrg } = await loadPeriodSubscriptions(deps, {
    periodStart,
    ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
  });
  // A subscribed organization is billed for the period even if it routed nothing: the base fee
  // buys platform access, not decisions. Its invoice is keyed on the tier currency.
  for (const [organizationId, subscription] of subscriptions) {
    orgIds.add(organizationId);
    groups.set(`${organizationId}\0${subscription.currency}`, [
      ...(groups.get(`${organizationId}\0${subscription.currency}`) ?? []),
    ]);
  }

  const invoices: Invoice[] = [];
  const createdInvoiceIds: string[] = [];
  const reusedInvoiceIds: string[] = [];
  const billedOrgs = new Set<string>();

  const keys = [...groups.keys()].sort();
  for (const key of keys) {
    const group = groups.get(key) ?? [];
    const [organizationId, currency] = splitGroupKey(key);
    const existing = await deps.store.findInvoiceByPeriod({
      organizationId,
      periodStart,
      currency,
    });
    if (existing !== null) {
      billedOrgs.add(organizationId);
      invoices.push(existing);
      reusedInvoiceIds.push(existing.id);
      continue;
    }
    const subscription = subscriptions.get(organizationId);
    const draft = draftInvoiceFromSnapshots({
      organizationId,
      periodStart,
      periodEnd,
      currency,
      events: group,
      ...(subscription === undefined ? {} : { subscription }),
      ...(usageByOrg.get(organizationId) === undefined
        ? {}
        : { usage: usageByOrg.get(organizationId) }),
      ...(deps.tierCatalog === undefined ? {} : { tierCatalog: deps.tierCatalog }),
    });
    // An organization on the free tier with no billable decisions has nothing to be invoiced for.
    // Issuing a zero-line invoice would be noise the customer has to read and dismiss.
    if (draft.lines.length === 0) {
      continue;
    }
    billedOrgs.add(organizationId);
    const invoiceId = deps.ids.generate('inv');
    const issued: IssueInvoiceInput = {
      id: invoiceId,
      invoiceNumber: invoiceNumberFor({
        organizationId: draft.organizationId,
        periodStart: draft.periodStart,
        currency: draft.currency,
      }),
      organizationId: draft.organizationId,
      periodStart: draft.periodStart,
      periodEnd: draft.periodEnd,
      currency: draft.currency,
      collectionMode: deps.collectionMode ?? 'RECORD_ONLY',
      subtotalMinorUnits: draft.subtotalMinorUnits,
      taxMinorUnits: '0',
      totalMinorUnits: draft.totalMinorUnits,
      issuedAt: deps.clock.nowIso(),
      issuedByActor: input.actor,
      lines: draft.lines.map((line) => ({
        id: deps.ids.generate('inl'),
        monetizationEventId: line.monetizationEventId,
        eventClass: line.eventClass,
        description: line.description,
        quantity: line.quantity,
        platformRevenueMinorUnits: line.platformRevenueMinorUnits,
        economicStage: line.economicStage,
        transactionType: line.transactionType,
        revenueSource: line.revenueSource,
        occurredAt: line.occurredAt,
      })),
    };
    const invoice = await deps.store.issueInvoice(issued);
    invoices.push(invoice);
    createdInvoiceIds.push(invoice.id);
    await recordBillingAudit(deps, input, invoice);
  }

  for (const orgId of orgIds) {
    const currencies = new Set(
      events.filter((event) => event.organizationId === orgId).map((event) => event.currency),
    );
    for (const currency of currencies) {
      const existing = await deps.store.findInvoiceByPeriod({
        organizationId: orgId,
        periodStart,
        currency,
      });
      if (existing !== null && !invoices.some((invoice) => invoice.id === existing.id)) {
        invoices.push(existing);
        reusedInvoiceIds.push(existing.id);
        billedOrgs.add(orgId);
      }
    }
  }

  const skippedOrganizationIds = [...orgIds]
    .filter((orgId) => !billedOrgs.has(orgId) && !invoices.some((invoice) => invoice.organizationId === orgId))
    .sort();

  return {
    periodStart,
    periodEnd,
    cadence: BILLING_CADENCE,
    invoices: invoices.sort(
      (left, right) =>
        left.organizationId.localeCompare(right.organizationId) ||
        left.currency.localeCompare(right.currency),
    ),
    createdInvoiceIds,
    reusedInvoiceIds,
    skippedOrganizationIds,
  };
}

function splitGroupKey(key: string): [string, string] {
  const separator = key.indexOf('\0');
  return [key.slice(0, separator), key.slice(separator + 1)];
}

/**
 * Load the tier assignments and usage rollups for a period.
 *
 * Both stores are optional so that an environment which has not adopted subscriptions still bills
 * decision fees. Free-tier rows are dropped here rather than downstream: with a zero base, a zero
 * quota and a zero overage price there is nothing for them to contribute.
 */
async function loadPeriodSubscriptions(
  deps: BillingRunDependencies,
  input: { readonly periodStart: string; readonly organizationId?: string },
): Promise<{
  readonly subscriptions: Map<string, OrganizationSubscription>;
  readonly usageByOrg: Map<string, UsageRollup>;
}> {
  const subscriptions = new Map<string, OrganizationSubscription>();
  const usageByOrg = new Map<string, UsageRollup>();
  if (deps.subscriptions === undefined) {
    return { subscriptions, usageByOrg };
  }

  const catalog = deps.tierCatalog ?? DEFAULT_SUBSCRIPTION_TIERS;
  const rows =
    input.organizationId === undefined
      ? await deps.subscriptions.listSubscriptions()
      : [await deps.subscriptions.findSubscription(input.organizationId)].filter(
          (row): row is OrganizationSubscription => row !== null,
        );

  for (const row of rows) {
    if (row.cancelledAt !== null && row.cancelledAt <= input.periodStart) {
      continue;
    }
    const definition = catalog[row.tier];
    if (
      definition.monthlyBaseMinorUnits === '0' &&
      definition.overagePerCallMinorUnits === '0'
    ) {
      continue;
    }
    subscriptions.set(row.organizationId, row);
  }

  if (deps.usage === undefined || subscriptions.size === 0) {
    return { subscriptions, usageByOrg };
  }

  const { periodEnd } = utcMonthWindow(input.periodStart);
  const counters = await deps.usage.listCounters({
    periodStart: input.periodStart,
    ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
  });
  for (const organizationId of subscriptions.keys()) {
    usageByOrg.set(
      organizationId,
      rollupUsage({
        organizationId,
        periodStart: input.periodStart,
        periodEnd,
        counters: counters.filter((counter) => counter.organizationId === organizationId),
      }),
    );
  }
  return { subscriptions, usageByOrg };
}

async function recordBillingAudit(
  deps: BillingRunDependencies,
  input: BillingRunInput,
  invoice: Invoice,
): Promise<void> {
  const snapshotIds = invoice.lines
    .map((line) => line.monetizationEventId)
    .filter((id): id is string => id !== null);
  const chargeClasses = [...new Set(invoice.lines.map((line) => line.eventClass))].sort();
  await deps.auditLogger.record({
    type: 'billing.invoice.issued',
    actor: input.actor,
    requestId: input.requestId,
    comparisonId: null,
    providerId: null,
    organizationId: invoice.organizationId,
    payload: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      currency: invoice.currency,
      subtotalMinorUnits: invoice.subtotalMinorUnits,
      taxMinorUnits: invoice.taxMinorUnits,
      totalMinorUnits: invoice.totalMinorUnits,
      collectionStatus: invoice.collectionStatus,
      collectionMode: invoice.collectionMode,
      chargeClasses,
      issuerLegalEntity: invoice.issuerLegalEntity,
      taxCalculation: invoice.taxCalculation,
      snapshotIds,
      actorKind: input.actor === 'system' ? 'system' : 'operator',
    },
  });
  await deps.auditLogger.record({
    type: 'billing.revenue.recognized',
    actor: input.actor,
    requestId: input.requestId,
    comparisonId: null,
    providerId: null,
    organizationId: invoice.organizationId,
    payload: {
      invoiceId: invoice.id,
      from: 'unrealized',
      to: 'invoiced',
      realizedRevenue: false,
      collected: false,
      snapshotIds,
      actorKind: input.actor === 'system' ? 'system' : 'operator',
    },
  });
}

function parseMinor(raw: string, field: string): bigint {
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new InvalidAmountError(`Billing ${field} must be an integer string.`, {
      field,
      value: raw,
    });
  }
  return BigInt(raw.trim());
}

function sumMinor(values: readonly string[], field: string): string {
  let total = 0n;
  for (const value of values) {
    const amount = parseMinor(value, field);
    if (amount < 0n) {
      throw new InvalidAmountError(`Billing ${field} must be non-negative.`, { field, value });
    }
    total += amount;
  }
  return total.toString();
}
