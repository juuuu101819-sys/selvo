import type { BillableEventClass } from './billable-event.js';
import type { BillingCollectionMode } from './collection.js';

/**
 * Platform-fee invoicing. Amounts are integer minor-unit strings. Totals are summed with bigint.
 *
 * An invoice carries three kinds of line, one per billable class (§18.6): the subscription base,
 * metered call overage, and per-decision fees copied from monetization snapshots. Snapshot-derived
 * lines copy `platformRevenueMinorUnits` as recorded; they never recompute take-rate or call
 * `priceRouteMonetization`.
 *
 * An issued invoice is not cash received. `realizedRevenue` on a snapshot stays false until a
 * processor confirms collection and `revenueRecognition` becomes `collected` — see
 * {@link BillingCollectionMode} and GO_LIVE_CHECKLIST.md#billing-collection.
 */

export const INVOICE_STATUSES = ['issued'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * Whether an invoice has been paid.
 *
 * `collected` is only reachable through a confirmed processor outcome in `LIVE` mode. A
 * `RECORD_ONLY` run leaves every invoice `uncollected` no matter how many times it runs.
 */
export const INVOICE_COLLECTION_STATUSES = ['uncollected', 'collected'] as const;
export type InvoiceCollectionStatus = (typeof INVOICE_COLLECTION_STATUSES)[number];

export const INVOICE_ISSUER_LEGAL_ENTITY = 'unconfirmed' as const;
export type InvoiceIssuerLegalEntity = typeof INVOICE_ISSUER_LEGAL_ENTITY;

export const INVOICE_TAX_CALCULATION = 'deferred' as const;
export type InvoiceTaxCalculation = typeof INVOICE_TAX_CALCULATION;

export const BILLING_CADENCE = 'utc_calendar_month' as const;

/**
 * Snapshots that may appear on an invoice.
 *
 * There is no route-selection HTTP surface. `route_quote` is a route view and is never billed.
 * `execution_intent` is a recorded route choice (funds still do not move). `enterprise_subscription`
 * is a contracted API fee with TPV 0.
 */
export const BILLABLE_ECONOMIC_STAGES = ['execution_intent'] as const;

export function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return typeof value === 'string' && (INVOICE_STATUSES as readonly string[]).includes(value);
}

export function isInvoiceCollectionStatus(value: unknown): value is InvoiceCollectionStatus {
  return (
    typeof value === 'string' && (INVOICE_COLLECTION_STATUSES as readonly string[]).includes(value)
  );
}

export interface InvoiceLine {
  readonly id: string;
  readonly invoiceId: string;
  /**
   * Snapshot this line bills, for `FLAT_DECISION` lines. Null for subscription and metered lines,
   * which are derived from the period rather than from one routed decision.
   */
  readonly monetizationEventId: string | null;
  /** The one charge class this line belongs to (§18.6). */
  readonly eventClass: BillableEventClass;
  /** Customer-facing description. What the line is for, in the customer's terms. */
  readonly description: string;
  /** Units billed: 1 for a subscription period, the overage call count for metered lines. */
  readonly quantity: string;
  readonly platformRevenueMinorUnits: string;
  readonly economicStage: string;
  readonly transactionType: string;
  readonly revenueSource: string;
  readonly occurredAt: string;
}

export interface Invoice {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly organizationId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;
  readonly status: InvoiceStatus;
  readonly collectionStatus: InvoiceCollectionStatus;
  /**
   * Mode this invoice currently stands in, not merely the mode it was issued under.
   *
   * Issued invoices start in the platform's mode at issue time, so a `RECORD_ONLY` invoice has
   * never been sent to a processor. A later confirmed collection moves the invoice to `LIVE`
   * alongside `collectionStatus = 'collected'` — an invoice that has been paid must not keep
   * describing itself as record-only.
   */
  readonly collectionMode: BillingCollectionMode;
  /** Processor reference proving payment, once collected. Never a payment credential. */
  readonly collectionReference: string | null;
  readonly issuerLegalEntity: InvoiceIssuerLegalEntity;
  readonly taxCalculation: InvoiceTaxCalculation;
  readonly subtotalMinorUnits: string;
  readonly taxMinorUnits: '0';
  readonly totalMinorUnits: string;
  readonly issuedAt: string;
  readonly issuedByActor: string;
  readonly lines: readonly InvoiceLine[];
}

export interface DraftInvoiceLine {
  readonly monetizationEventId: string | null;
  readonly eventClass: BillableEventClass;
  readonly description: string;
  readonly quantity: string;
  readonly platformRevenueMinorUnits: string;
  readonly economicStage: string;
  readonly transactionType: string;
  readonly revenueSource: string;
  readonly occurredAt: string;
}

export interface DraftInvoice {
  readonly organizationId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;
  readonly subtotalMinorUnits: string;
  readonly taxMinorUnits: '0';
  readonly totalMinorUnits: string;
  readonly lines: readonly DraftInvoiceLine[];
}

/**
 * Collection state of a set of invoices.
 *
 * `deferred` is the launch value and the only one a `RECORD_ONLY` run can produce. The other two
 * exist so that a report covering collected invoices cannot keep describing itself as deferred:
 * §18.2 forbids a label that outlives the fact it describes, and a hardcoded `'deferred'` is such
 * a label the moment the §18.5 gate opens.
 */
export const INVOICE_COLLECTION_ROLLUPS = ['deferred', 'partially_collected', 'collected'] as const;
export type InvoiceCollectionRollup = (typeof INVOICE_COLLECTION_ROLLUPS)[number];

export function isInvoiceCollectionRollup(value: unknown): value is InvoiceCollectionRollup {
  return (
    typeof value === 'string' && (INVOICE_COLLECTION_ROLLUPS as readonly string[]).includes(value)
  );
}

/**
 * Collection state across invoices, derived from the invoices themselves.
 *
 * An empty set is `deferred`: nothing has been collected, which is the same thing a reader needs
 * to know as when nothing has been collected yet.
 */
export function invoiceCollectionRollup(
  invoices: readonly Pick<Invoice, 'collectionStatus'>[],
): InvoiceCollectionRollup {
  const collected = invoices.filter((invoice) => invoice.collectionStatus === 'collected').length;
  if (collected === 0) {
    return 'deferred';
  }
  return collected === invoices.length ? 'collected' : 'partially_collected';
}

export interface ReconciliationCurrencyRow {
  readonly currency: string;
  readonly quotedEventCount: number;
  readonly quotedPlatformRevenueMinorUnits: string;
  readonly billableEventCount: number;
  readonly billablePlatformRevenueMinorUnits: string;
  readonly invoicedSnapshotCount: number;
  readonly invoicedPlatformRevenueMinorUnits: string;
  /**
   * Total of invoices a processor confirmed payment for, in minor units.
   *
   * Derived from `collectionStatus`, not pinned to zero: a constant here would mean the one report
   * an operator uses to check collection could never disagree with the launch state.
   */
  readonly collectedPlatformRevenueMinorUnits: string;
  readonly unbilledBillableCount: number;
  readonly unbilledBillableMinorUnits: string;
  readonly duplicateBilledSnapshotIds: readonly string[];
}

export interface ReconciliationReport {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly cadence: typeof BILLING_CADENCE;
  readonly collectionStatus: InvoiceCollectionRollup;
  readonly taxCalculation: InvoiceTaxCalculation;
  readonly issuerLegalEntity: InvoiceIssuerLegalEntity;
  readonly billedSnapshotIds: readonly string[];
  readonly byCurrency: readonly ReconciliationCurrencyRow[];
}

export interface BillingRunResult {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly cadence: typeof BILLING_CADENCE;
  readonly invoices: readonly Invoice[];
  readonly createdInvoiceIds: readonly string[];
  readonly reusedInvoiceIds: readonly string[];
  readonly skippedOrganizationIds: readonly string[];
}
