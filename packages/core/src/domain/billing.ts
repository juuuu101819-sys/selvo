/**
 * Platform-fee invoicing. Amounts are integer minor-unit strings. Totals are summed with bigint.
 *
 * Invoices copy `platformRevenueMinorUnits` from existing monetization snapshots. They never
 * recompute take-rate or call `priceRouteMonetization`.
 *
 * Payment collection is deferred: an issued invoice is not cash received. `realizedRevenue` on a
 * snapshot stays false until `revenueRecognition` is `collected`, which this phase never writes.
 */

export const INVOICE_STATUSES = ['issued'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_COLLECTION_STATUSES = ['uncollected'] as const;
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
  readonly monetizationEventId: string;
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
  readonly monetizationEventId: string;
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

export interface ReconciliationCurrencyRow {
  readonly currency: string;
  readonly quotedEventCount: number;
  readonly quotedPlatformRevenueMinorUnits: string;
  readonly billableEventCount: number;
  readonly billablePlatformRevenueMinorUnits: string;
  readonly invoicedSnapshotCount: number;
  readonly invoicedPlatformRevenueMinorUnits: string;
  readonly collectedPlatformRevenueMinorUnits: '0';
  readonly unbilledBillableCount: number;
  readonly unbilledBillableMinorUnits: string;
  readonly duplicateBilledSnapshotIds: readonly string[];
}

export interface ReconciliationReport {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly cadence: typeof BILLING_CADENCE;
  readonly collectionStatus: 'deferred';
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
