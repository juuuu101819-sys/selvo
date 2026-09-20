import type { MonetizationEvent, MonetizationReport } from '../domain/monetization.js';
import type { ListCursor } from '../pagination/cursor.js';

/**
 * Organization-scoped dashboard projections.
 *
 * Every method takes `organizationId` as the first argument. Implementations must apply that filter
 * in the query itself, not after the fact on a larger result set — a missed WHERE clause is how
 * one tenant sees another's quotes.
 */

export interface DashboardQuote {
  readonly id: string;
  readonly organizationId: string;
  readonly transactionRequestId: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly rail: string;
  readonly status: string;
  readonly sourceCurrency: string;
  readonly targetCurrency: string;
  readonly amountMinorUnits: string;
  readonly totalCostMinorUnits: string;
  readonly totalCostBps: string;
  readonly estimatedReceiveMinorUnits: string;
  readonly benchmarkReceiveMinorUnits: string;
  readonly settlementP50Seconds: number;
  readonly quotedAt: string;
  readonly expiresAt: string;
  readonly isRecommended: boolean;
  readonly rank: number | null;
  readonly score: string | null;
}

export interface DashboardTransaction {
  readonly id: string;
  readonly organizationId: string;
  readonly reference: string | null;
  readonly sourceCurrency: string;
  readonly targetCurrency: string;
  readonly amountMinorUnits: string;
  readonly status: string;
  readonly selectedQuoteId: string | null;
  readonly createdAt: string;
  readonly quoteCount: number;
}

export interface DashboardProviderUsage {
  readonly providerId: string;
  readonly providerName: string;
  readonly rail: string;
  readonly quoteCount: number;
  readonly recommendedCount: number;
  readonly averageCostBps: string | null;
  readonly averageSettlementP50Seconds: number | null;
}

export interface VolumeByCurrency {
  readonly currency: string;
  readonly exponent: number;
  readonly minorUnits: string;
  readonly requestCount: number;
}

export interface SavingsByCurrency {
  readonly currency: string;
  readonly exponent: number;
  readonly minorUnits: string;
}

export interface DashboardMetrics {
  readonly totalQuotedVolume: readonly VolumeByCurrency[];
  readonly estimatedSavings: readonly SavingsByCurrency[];
  readonly quoteCount: number;
  readonly successfulRouteRequests: number;
  readonly averageRouteCostBps: string | null;
  readonly averageSettlementP50Seconds: number | null;
}

export interface VolumePoint {
  readonly date: string;
  readonly currency: string;
  readonly minorUnits: string;
  readonly requestCount: number;
}

export interface CostPoint {
  readonly date: string;
  readonly averageCostBps: string;
  readonly quoteCount: number;
}

export interface RecordTransactionInput {
  readonly id: string;
  readonly organizationId: string;
  readonly reference: string | null;
  readonly sourceCurrency: string;
  readonly targetCurrency: string;
  readonly amountMinorUnits: string;
  readonly status: string;
  readonly selectedQuoteId: string | null;
  readonly createdAt: string;
}

export interface DashboardRepository {
  metrics(organizationId: string): Promise<DashboardMetrics>;
  volumeByDay(organizationId: string, days: number): Promise<readonly VolumePoint[]>;
  costByDay(organizationId: string, days: number): Promise<readonly CostPoint[]>;
  quotesByProvider(organizationId: string): Promise<readonly DashboardProviderUsage[]>;
  listQuotes(
    organizationId: string,
    options?: { readonly limit?: number; readonly after?: ListCursor },
  ): Promise<readonly DashboardQuote[]>;
  getQuote(organizationId: string, quoteId: string): Promise<DashboardQuote | null>;
  listTransactions(
    organizationId: string,
    options?: { readonly limit?: number; readonly after?: ListCursor },
  ): Promise<readonly DashboardTransaction[]>;
  getTransaction(organizationId: string, id: string): Promise<DashboardTransaction | null>;
  recordTransaction(input: RecordTransactionInput): Promise<void>;
  recordQuote(input: DashboardQuote): Promise<void>;
  recordMonetizationEvent(event: MonetizationEvent): Promise<void>;
  getMonetizationEvent(organizationId: string, id: string): Promise<MonetizationEvent | null>;
  listMonetizationEvents(
    organizationId: string,
    options?: { readonly limit?: number },
  ): Promise<readonly MonetizationEvent[]>;
  /**
   * Revenue report for one organization.
   *
   * `gainShareActive` comes from the caller's pricing-shape admission rather than from the store,
   * because whether a shape may be reported is a configuration question the persistence layer
   * cannot answer. Omitting it fails closed: the gain-share shape is excluded.
   */
  revenue(
    organizationId: string,
    options?: { readonly gainShareActive?: boolean },
  ): Promise<MonetizationReport>;
}
