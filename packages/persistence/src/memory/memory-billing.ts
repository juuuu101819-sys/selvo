import {
  PersistenceError,
  takeKeysetPage,
  type BillingStore,
  type Invoice,
  type IssueInvoiceInput,
  type ListCursor,
  type MonetizationEvent,
  withResolvedLifecycle,
} from '@meridian/core';

const DEFAULT_LIMIT = 50;

/**
 * In-process billing store. Shares the monetization map with the dashboard so an issued invoice
 * immediately updates snapshot recognition.
 */
export class InMemoryBillingStore implements BillingStore {
  private readonly invoices = new Map<string, Invoice>();

  constructor(private readonly events: Map<string, MonetizationEvent>) {}

  listEventsInPeriod(input: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly organizationId?: string;
  }): Promise<readonly MonetizationEvent[]> {
    const rows = [...this.events.values()].filter((event) => {
      if (event.occurredAt < input.periodStart || event.occurredAt >= input.periodEnd) {
        return false;
      }
      return input.organizationId === undefined || event.organizationId === input.organizationId;
    });
    return Promise.resolve(rows.map((event) => structuredClone(event)));
  }

  findInvoiceByPeriod(input: {
    readonly organizationId: string;
    readonly periodStart: string;
    readonly currency: string;
  }): Promise<Invoice | null> {
    const found = [...this.invoices.values()].find(
      (invoice) =>
        invoice.organizationId === input.organizationId &&
        invoice.periodStart === input.periodStart &&
        invoice.currency === input.currency,
    );
    return Promise.resolve(found === undefined ? null : structuredClone(found));
  }

  getInvoice(invoiceId: string): Promise<Invoice | null> {
    const found = this.invoices.get(invoiceId);
    return Promise.resolve(found === undefined ? null : structuredClone(found));
  }

  getInvoiceForOrganization(organizationId: string, invoiceId: string): Promise<Invoice | null> {
    const found = this.invoices.get(invoiceId);
    if (found === undefined || found.organizationId !== organizationId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(structuredClone(found));
  }

  listInvoicesForOrganization(
    organizationId: string,
    options: { readonly limit?: number; readonly after?: ListCursor } = {},
  ): Promise<readonly Invoice[]> {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const page = takeKeysetPage(
      [...this.invoices.values()].filter((invoice) => invoice.organizationId === organizationId),
      { limit, ...(options.after === undefined ? {} : { after: options.after }) },
      (invoice) => ({ sortAt: invoice.issuedAt, id: invoice.id }),
    );
    return Promise.resolve(page.map((invoice) => structuredClone(invoice)));
  }

  listInvoicesForPeriod(periodStart: string): Promise<readonly Invoice[]> {
    return Promise.resolve(
      [...this.invoices.values()]
        .filter((invoice) => invoice.periodStart === periodStart)
        .sort(
          (left, right) =>
            left.organizationId.localeCompare(right.organizationId) ||
            left.currency.localeCompare(right.currency),
        )
        .map((invoice) => structuredClone(invoice)),
    );
  }

  issueInvoice(input: IssueInvoiceInput): Promise<Invoice> {
    for (const existing of this.invoices.values()) {
      if (
        existing.organizationId === input.organizationId &&
        existing.periodStart === input.periodStart &&
        existing.currency === input.currency
      ) {
        return Promise.reject(
          new PersistenceError('An invoice already exists for this organization, period, and currency.', {
            organizationId: input.organizationId,
            periodStart: input.periodStart,
            currency: input.currency,
          }),
        );
      }
    }
    // Subscription and metered lines bill a period and reference no snapshot, so only the
    // decision lines are checked for double billing.
    for (const line of input.lines) {
      const monetizationEventId = line.monetizationEventId;
      if (monetizationEventId === null) {
        continue;
      }
      const snapshot = this.events.get(monetizationEventId);
      if (snapshot === undefined) {
        return Promise.reject(
          new PersistenceError('Invoice line references an unknown monetization snapshot.', {
            monetizationEventId,
          }),
        );
      }
      if (snapshot.revenueRecognition !== 'unrealized' || snapshot.invoiceId !== null) {
        return Promise.reject(
          new PersistenceError('Monetization snapshot is already billed.', {
            monetizationEventId,
          }),
        );
      }
      for (const invoice of this.invoices.values()) {
        if (invoice.lines.some((existing) => existing.monetizationEventId === monetizationEventId)) {
          return Promise.reject(
            new PersistenceError('Monetization snapshot is already billed.', {
              monetizationEventId,
            }),
          );
        }
      }
    }

    const invoice: Invoice = {
      id: input.id,
      invoiceNumber: input.invoiceNumber,
      organizationId: input.organizationId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      currency: input.currency,
      status: 'issued',
      collectionStatus: 'uncollected',
      collectionMode: input.collectionMode,
      collectionReference: null,
      issuerLegalEntity: 'unconfirmed',
      taxCalculation: 'deferred',
      subtotalMinorUnits: input.subtotalMinorUnits,
      taxMinorUnits: '0',
      totalMinorUnits: input.totalMinorUnits,
      issuedAt: input.issuedAt,
      issuedByActor: input.issuedByActor,
      lines: input.lines.map((line) => ({
        ...line,
        invoiceId: input.id,
      })),
    };
    this.invoices.set(invoice.id, invoice);
    for (const line of invoice.lines) {
      const monetizationEventId = line.monetizationEventId;
      if (monetizationEventId === null) {
        continue;
      }
      const snapshot = this.events.get(monetizationEventId);
      if (snapshot !== undefined) {
        this.events.set(
          monetizationEventId,
          withResolvedLifecycle({
            ...snapshot,
            revenueRecognition: 'invoiced',
            invoiceId: invoice.id,
            realizedRevenue: false,
          }),
        );
      }
    }
    return Promise.resolve(structuredClone(invoice));
  }

  /**
   * Mark an invoice collected and promote the snapshots it billed.
   *
   * Called only by {@link InMemoryCollectionStore} after a processor confirmation. The collection
   * reference is written onto every snapshot on the invoice, which is what lets the revenue
   * lifecycle resolver reach `REALIZED_REVENUE` — and, for a non-production origin, what it will
   * still refuse to do.
   */
  markCollected(input: {
    readonly invoiceId: string;
    readonly collectionReference: string;
  }): Invoice | null {
    const invoice = this.invoices.get(input.invoiceId);
    if (invoice === undefined) {
      return null;
    }
    const collected: Invoice = {
      ...invoice,
      collectionStatus: 'collected',
      // See {@link Invoice.collectionMode}: the field records the mode the invoice currently
      // stands in, so an invoice issued under RECORD_ONLY that is later collected reads as LIVE.
      collectionMode: 'LIVE',
      collectionReference: input.collectionReference,
    };
    this.invoices.set(collected.id, collected);
    for (const line of collected.lines) {
      const monetizationEventId = line.monetizationEventId;
      if (monetizationEventId === null) {
        continue;
      }
      const snapshot = this.events.get(monetizationEventId);
      if (snapshot === undefined) {
        continue;
      }
      this.events.set(
        monetizationEventId,
        withResolvedLifecycle({
          ...snapshot,
          revenueRecognition: 'collected',
          collectionReference: input.collectionReference,
          invoiceId: collected.id,
          realizedRevenue: true,
        }),
      );
    }
    return structuredClone(collected);
  }
}
