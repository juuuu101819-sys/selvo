import type { Invoice, InvoiceLine } from '../domain/billing.js';
import type { MonetizationEvent } from '../domain/monetization.js';

export interface IssueInvoiceInput {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly organizationId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;
  readonly subtotalMinorUnits: string;
  readonly taxMinorUnits: '0';
  readonly totalMinorUnits: string;
  readonly issuedAt: string;
  readonly issuedByActor: string;
  readonly lines: readonly Omit<InvoiceLine, 'invoiceId'>[];
}

/**
 * Persistence for invoices and the unscoped monetization reads billing needs.
 *
 * Dashboard remains org-scoped. Ops billing lists events across tenants for a period.
 */
export interface BillingStore {
  listEventsInPeriod(input: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly organizationId?: string;
  }): Promise<readonly MonetizationEvent[]>;
  findInvoiceByPeriod(input: {
    readonly organizationId: string;
    readonly periodStart: string;
    readonly currency: string;
  }): Promise<Invoice | null>;
  getInvoice(invoiceId: string): Promise<Invoice | null>;
  getInvoiceForOrganization(organizationId: string, invoiceId: string): Promise<Invoice | null>;
  listInvoicesForOrganization(
    organizationId: string,
    options?: { readonly limit?: number },
  ): Promise<readonly Invoice[]>;
  listInvoicesForPeriod(periodStart: string): Promise<readonly Invoice[]>;
  /**
   * Atomically insert the invoice and lines, and mark the referenced snapshots `invoiced`.
   * Callers must have already checked the period unique key. Implementations must not write
   * `collected` or `realizedRevenue: true`.
   */
  issueInvoice(input: IssueInvoiceInput): Promise<Invoice>;
}
