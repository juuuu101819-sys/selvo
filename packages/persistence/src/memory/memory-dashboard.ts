import {
  aggregateMonetization,
  takeKeysetPage,
  type CostPoint,
  type DashboardMetrics,
  type DashboardProviderUsage,
  type DashboardQuote,
  type DashboardRepository,
  type DashboardTransaction,
  type ListCursor,
  type MonetizationEvent,
  type MonetizationReport,
  type RecordTransactionInput,
  type VolumePoint,
  withResolvedLifecycle,
} from '@meridian/core';
import {
  aggregateCostByDay,
  aggregateMetrics,
  aggregateProviderUsage,
  aggregateVolumeByDay,
} from '../dashboard/aggregate.js';

const DEFAULT_LIMIT = 50;

/**
 * In-process dashboard store.
 *
 * Every public method takes `organizationId` and filters by it before aggregating. A missed filter
 * here would leak one tenant's quotes to another, so the tests assert the negative case directly.
 */
export class InMemoryDashboardRepository implements DashboardRepository {
  private readonly quotes = new Map<string, DashboardQuote>();
  private readonly transactions = new Map<string, DashboardTransaction>();

  constructor(private readonly monetization: Map<string, MonetizationEvent> = new Map()) {}

  metrics(organizationId: string): Promise<DashboardMetrics> {
    return Promise.resolve(
      aggregateMetrics(this.quotesFor(organizationId), this.transactionsFor(organizationId)),
    );
  }

  volumeByDay(organizationId: string, days: number): Promise<readonly VolumePoint[]> {
    return Promise.resolve(
      aggregateVolumeByDay(this.transactionsFor(organizationId), days, Date.now()),
    );
  }

  costByDay(organizationId: string, days: number): Promise<readonly CostPoint[]> {
    return Promise.resolve(aggregateCostByDay(this.quotesFor(organizationId), days, Date.now()));
  }

  quotesByProvider(organizationId: string): Promise<readonly DashboardProviderUsage[]> {
    return Promise.resolve(aggregateProviderUsage(this.quotesFor(organizationId)));
  }

  listQuotes(
    organizationId: string,
    options: { readonly limit?: number; readonly after?: ListCursor } = {},
  ): Promise<readonly DashboardQuote[]> {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const page = takeKeysetPage(
      this.quotesFor(organizationId),
      { limit, ...(options.after === undefined ? {} : { after: options.after }) },
      (quote) => ({ sortAt: quote.quotedAt, id: quote.id }),
    );
    return Promise.resolve(page.map((quote) => structuredClone(quote)));
  }

  getQuote(organizationId: string, quoteId: string): Promise<DashboardQuote | null> {
    const quote = this.quotes.get(quoteId);
    if (quote === undefined || quote.organizationId !== organizationId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(structuredClone(quote));
  }

  listTransactions(
    organizationId: string,
    options: { readonly limit?: number; readonly after?: ListCursor } = {},
  ): Promise<readonly DashboardTransaction[]> {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const page = takeKeysetPage(
      this.transactionsFor(organizationId),
      { limit, ...(options.after === undefined ? {} : { after: options.after }) },
      (row) => ({ sortAt: row.createdAt, id: row.id }),
    );
    return Promise.resolve(page.map((row) => structuredClone(row)));
  }

  getTransaction(organizationId: string, id: string): Promise<DashboardTransaction | null> {
    const row = this.transactions.get(id);
    if (row === undefined || row.organizationId !== organizationId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(structuredClone(row));
  }

  recordTransaction(input: RecordTransactionInput): Promise<void> {
    const existing = this.transactions.get(input.id);
    this.transactions.set(input.id, {
      ...input,
      quoteCount: existing?.quoteCount ?? 0,
    });
    return Promise.resolve();
  }

  recordQuote(input: DashboardQuote): Promise<void> {
    this.quotes.set(input.id, structuredClone(input));
    const request = this.transactions.get(input.transactionRequestId);
    if (request !== undefined && request.organizationId === input.organizationId) {
      this.transactions.set(input.transactionRequestId, {
        ...request,
        quoteCount: request.quoteCount + 1,
        selectedQuoteId: input.isRecommended ? input.id : request.selectedQuoteId,
      });
    }
    return Promise.resolve();
  }

  recordMonetizationEvent(event: MonetizationEvent): Promise<void> {
    const existing = this.monetization.get(event.id);
    const recognition =
      existing?.revenueRecognition ?? event.revenueRecognition ?? 'unrealized';
    this.monetization.set(
      event.id,
      withResolvedLifecycle({
        ...event,
        fundsMoved: false,
        custody: false,
        realExecution: false,
        revenueRecognition: recognition,
        // Realization survives a re-record only while its preconditions still hold; the resolver
        // below is what decides whether the claim stands.
        realizedRevenue: existing?.realizedRevenue ?? event.realizedRevenue,
        collectionReference: existing?.collectionReference ?? event.collectionReference,
        invoiceId: existing?.invoiceId ?? event.invoiceId ?? null,
      }),
    );
    return Promise.resolve();
  }

  getMonetizationEvent(organizationId: string, id: string): Promise<MonetizationEvent | null> {
    const event = this.monetization.get(id);
    if (event === undefined || event.organizationId !== organizationId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(structuredClone(event));
  }

  listMonetizationEvents(
    organizationId: string,
    options: { readonly limit?: number } = {},
  ): Promise<readonly MonetizationEvent[]> {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const ordered = [...this.monetization.values()]
      .filter((event) => event.organizationId === organizationId)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, limit)
      .map((event) => structuredClone(event));
    return Promise.resolve(ordered);
  }

  revenue(
    organizationId: string,
    options: { readonly gainShareActive?: boolean } = {},
  ): Promise<MonetizationReport> {
    const events = [...this.monetization.values()].filter(
      (event) => event.organizationId === organizationId,
    );
    return Promise.resolve(
      aggregateMonetization(events, {
        organizationId,
        gainShareActive: options.gainShareActive ?? false,
      }),
    );
  }

  private quotesFor(organizationId: string): DashboardQuote[] {
    return [...this.quotes.values()].filter((quote) => quote.organizationId === organizationId);
  }

  private transactionsFor(organizationId: string): DashboardTransaction[] {
    return [...this.transactions.values()].filter((row) => row.organizationId === organizationId);
  }
}
