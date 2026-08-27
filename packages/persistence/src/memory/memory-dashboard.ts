import type {
  CostPoint,
  DashboardMetrics,
  DashboardProviderUsage,
  DashboardQuote,
  DashboardRepository,
  DashboardTransaction,
  RecordTransactionInput,
  VolumePoint,
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
    options: { readonly limit?: number } = {},
  ): Promise<readonly DashboardQuote[]> {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const ordered = this.quotesFor(organizationId)
      .sort((left, right) => right.quotedAt.localeCompare(left.quotedAt))
      .slice(0, limit)
      .map((quote) => structuredClone(quote));
    return Promise.resolve(ordered);
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
    options: { readonly limit?: number } = {},
  ): Promise<readonly DashboardTransaction[]> {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const ordered = this.transactionsFor(organizationId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((row) => structuredClone(row));
    return Promise.resolve(ordered);
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

  private quotesFor(organizationId: string): DashboardQuote[] {
    return [...this.quotes.values()].filter((quote) => quote.organizationId === organizationId);
  }

  private transactionsFor(organizationId: string): DashboardTransaction[] {
    return [...this.transactions.values()].filter((row) => row.organizationId === organizationId);
  }
}
