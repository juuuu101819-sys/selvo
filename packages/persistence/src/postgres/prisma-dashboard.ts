import type {
  CostPoint,
  DashboardMetrics,
  DashboardProviderUsage,
  DashboardQuote,
  DashboardRepository,
  DashboardTransaction,
  MonetizationEvent,
  MonetizationReport,
  MonetizationTransactionType,
  RecordTransactionInput,
  RevenueSource,
  VolumePoint,
  ListCursor,
} from '@meridian/core';
import {
  PersistenceError,
  aggregateMonetization,
  isMonetizationTransactionType,
  isRevenueSource,
} from '@meridian/core';
import { monetizationLifecycleFields } from './monetization-lifecycle.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import { descKeysetWhere } from './keyset.js';
import {
  aggregateCostByDay,
  aggregateMetrics,
  aggregateProviderUsage,
  aggregateVolumeByDay,
} from '../dashboard/aggregate.js';

const DEFAULT_LIMIT = 50;

export class PrismaDashboardRepository implements DashboardRepository {
  constructor(private readonly client: PrismaClient) {}

  async metrics(organizationId: string): Promise<DashboardMetrics> {
    const [quotes, transactions] = await this.loadOrg(organizationId);
    return aggregateMetrics(quotes, transactions);
  }

  async volumeByDay(organizationId: string, days: number): Promise<readonly VolumePoint[]> {
    const transactions = await this.loadTransactions(organizationId);
    return aggregateVolumeByDay(transactions, days, Date.now());
  }

  async costByDay(organizationId: string, days: number): Promise<readonly CostPoint[]> {
    const quotes = await this.loadQuotes(organizationId);
    return aggregateCostByDay(quotes, days, Date.now());
  }

  async quotesByProvider(organizationId: string): Promise<readonly DashboardProviderUsage[]> {
    const quotes = await this.loadQuotes(organizationId);
    return aggregateProviderUsage(quotes);
  }

  async listQuotes(
    organizationId: string,
    options: { readonly limit?: number; readonly after?: ListCursor } = {},
  ): Promise<readonly DashboardQuote[]> {
    const rows = await this.query(() =>
      this.client.quote.findMany({
        where: {
          organizationId,
          ...descKeysetWhere(options.after, 'quotedAt', 'id'),
        },
        include: { provider: true },
        orderBy: [{ quotedAt: 'desc' }, { id: 'desc' }],
        take: options.limit ?? DEFAULT_LIMIT,
      }),
    );
    return rows.map(toQuote);
  }

  async getQuote(organizationId: string, quoteId: string): Promise<DashboardQuote | null> {
    const row = await this.query(() =>
      this.client.quote.findFirst({
        where: { id: quoteId, organizationId },
        include: { provider: true },
      }),
    );
    return row === null ? null : toQuote(row);
  }

  async listTransactions(
    organizationId: string,
    options: { readonly limit?: number; readonly after?: ListCursor } = {},
  ): Promise<readonly DashboardTransaction[]> {
    const rows = await this.query(() =>
      this.client.transactionRequest.findMany({
        where: {
          organizationId,
          ...descKeysetWhere(options.after, 'createdAt', 'id'),
        },
        include: { _count: { select: { quotes: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: options.limit ?? DEFAULT_LIMIT,
      }),
    );
    return rows.map(toTransaction);
  }

  async getTransaction(organizationId: string, id: string): Promise<DashboardTransaction | null> {
    const row = await this.query(() =>
      this.client.transactionRequest.findFirst({
        where: { id, organizationId },
        include: { _count: { select: { quotes: true } } },
      }),
    );
    return row === null ? null : toTransaction(row);
  }

  async recordTransaction(input: RecordTransactionInput): Promise<void> {
    try {
      await this.client.transactionRequest.upsert({
        where: { id: input.id },
        create: {
          id: input.id,
          organizationId: input.organizationId,
          reference: input.reference,
          sourceCurrency: input.sourceCurrency,
          targetCurrency: input.targetCurrency,
          amountMinorUnits: new Prisma.Decimal(input.amountMinorUnits),
          status: input.status as never,
          selectedQuoteId: input.selectedQuoteId,
          createdAt: new Date(input.createdAt),
        },
        update: {
          status: input.status as never,
          selectedQuoteId: input.selectedQuoteId,
        },
      });
    } catch (error) {
      throw new PersistenceError(
        'Failed to persist the transaction request.',
        {},
        { cause: error },
      );
    }
  }

  async recordQuote(input: DashboardQuote): Promise<void> {
    try {
      await this.client.quote.upsert({
        where: { id: input.id },
        create: {
          id: input.id,
          organizationId: input.organizationId,
          transactionRequestId: input.transactionRequestId,
          providerId: input.providerId,
          status: input.status as never,
          quotedAt: new Date(input.quotedAt),
          expiresAt: new Date(input.expiresAt),
          sourceCurrency: input.sourceCurrency,
          targetCurrency: input.targetCurrency,
          amountMinorUnits: new Prisma.Decimal(input.amountMinorUnits),
          midMarketRate: new Prisma.Decimal('1'),
          exchangeRate: new Prisma.Decimal('1'),
          effectiveRate: new Prisma.Decimal('1'),
          spreadBps: new Prisma.Decimal('0'),
          totalFeeMinorUnits: new Prisma.Decimal('0'),
          totalCostMinorUnits: new Prisma.Decimal(input.totalCostMinorUnits),
          totalCostBps: new Prisma.Decimal(input.totalCostBps),
          estimatedReceiveMinorUnits: new Prisma.Decimal(input.estimatedReceiveMinorUnits),
          benchmarkReceiveMinorUnits: new Prisma.Decimal(input.benchmarkReceiveMinorUnits),
          settlementP50Seconds: input.settlementP50Seconds,
          settlementP95Seconds: input.settlementP50Seconds,
          isRecommended: input.isRecommended,
          rank: input.rank,
          score: input.score === null ? null : new Prisma.Decimal(input.score),
          pricingVersion: 'dashboard',
        },
        update: {
          isRecommended: input.isRecommended,
          rank: input.rank,
        },
      });
    } catch (error) {
      throw new PersistenceError('Failed to persist the quote.', {}, { cause: error });
    }
  }

  async recordMonetizationEvent(event: MonetizationEvent): Promise<void> {
    try {
      await this.client.monetizationEvent.upsert({
        where: { id: event.id },
        create: {
          id: event.id,
          organizationId: event.organizationId,
          occurredAt: new Date(event.occurredAt),
          transactionType: event.transactionType,
          revenueSource: event.revenueSource,
          rail: event.rail,
          providerId: event.providerId,
          providerName: event.providerName,
          currency: event.currency,
          asset: event.asset,
          destinationAsset: event.destinationAsset,
          agentId: event.agentId,
          tpvMinorUnits: new Prisma.Decimal(event.tpvMinorUnits),
          providerCostMinorUnits: new Prisma.Decimal(event.providerCostMinorUnits),
          platformRevenueMinorUnits: new Prisma.Decimal(event.platformRevenueMinorUnits),
          partnerCommissionMinorUnits: new Prisma.Decimal(event.partnerCommissionMinorUnits),
          grossProfitMinorUnits: new Prisma.Decimal(event.grossProfitMinorUnits),
          takeRateBps: event.takeRateBps === null ? null : new Prisma.Decimal(event.takeRateBps),
          fundsMoved: false,
          custody: false,
          realExecution: false,
          routeId: event.routeId,
          quoteId: event.quoteId,
          economicStage: event.economicStage,
          realizedRevenue: event.realizedRevenue,
          revenueRecognition: event.revenueRecognition,
          originEnv: event.originEnv,
          settlementFinality: event.settlementFinality,
          collectionReference: event.collectionReference,
          invoiceId: event.invoiceId,
        },
        update: {
          occurredAt: new Date(event.occurredAt),
          transactionType: event.transactionType,
          revenueSource: event.revenueSource,
          rail: event.rail,
          providerId: event.providerId,
          providerName: event.providerName,
          currency: event.currency,
          asset: event.asset,
          destinationAsset: event.destinationAsset,
          agentId: event.agentId,
          tpvMinorUnits: new Prisma.Decimal(event.tpvMinorUnits),
          providerCostMinorUnits: new Prisma.Decimal(event.providerCostMinorUnits),
          platformRevenueMinorUnits: new Prisma.Decimal(event.platformRevenueMinorUnits),
          partnerCommissionMinorUnits: new Prisma.Decimal(event.partnerCommissionMinorUnits),
          grossProfitMinorUnits: new Prisma.Decimal(event.grossProfitMinorUnits),
          takeRateBps: event.takeRateBps === null ? null : new Prisma.Decimal(event.takeRateBps),
          fundsMoved: false,
          custody: false,
          realExecution: false,
          routeId: event.routeId,
          quoteId: event.quoteId,
          economicStage: event.economicStage,
          realizedRevenue: event.realizedRevenue,
          originEnv: event.originEnv,
          settlementFinality: event.settlementFinality,
          collectionReference: event.collectionReference,
        },
      });
    } catch (error) {
      throw new PersistenceError('Failed to persist the monetization event.', {}, { cause: error });
    }
  }

  async getMonetizationEvent(organizationId: string, id: string): Promise<MonetizationEvent | null> {
    const row = await this.query(() =>
      this.client.monetizationEvent.findFirst({ where: { id, organizationId } }),
    );
    return row === null ? null : toMonetizationEvent(row);
  }

  async listMonetizationEvents(
    organizationId: string,
    options: { readonly limit?: number } = {},
  ): Promise<readonly MonetizationEvent[]> {
    const rows = await this.query(() =>
      this.client.monetizationEvent.findMany({
        where: { organizationId },
        orderBy: { occurredAt: 'desc' },
        take: options.limit ?? DEFAULT_LIMIT,
      }),
    );
    return rows.map(toMonetizationEvent);
  }

  async revenue(
    organizationId: string,
    options: { readonly gainShareActive?: boolean } = {},
  ): Promise<MonetizationReport> {
    const rows = await this.query(() =>
      this.client.monetizationEvent.findMany({
        where: { organizationId },
        orderBy: { occurredAt: 'desc' },
      }),
    );
    return aggregateMonetization(rows.map(toMonetizationEvent), {
      organizationId,
      gainShareActive: options.gainShareActive ?? false,
    });
  }

  private async loadOrg(
    organizationId: string,
  ): Promise<readonly [readonly DashboardQuote[], readonly DashboardTransaction[]]> {
    const [quotes, transactions] = await Promise.all([
      this.loadQuotes(organizationId),
      this.loadTransactions(organizationId),
    ]);
    return [quotes, transactions];
  }

  private async loadQuotes(organizationId: string): Promise<DashboardQuote[]> {
    const rows = await this.query(() =>
      this.client.quote.findMany({
        where: { organizationId },
        include: { provider: true },
      }),
    );
    return rows.map(toQuote);
  }

  private async loadTransactions(organizationId: string): Promise<DashboardTransaction[]> {
    const rows = await this.query(() =>
      this.client.transactionRequest.findMany({
        where: { organizationId },
        include: { _count: { select: { quotes: true } } },
      }),
    );
    return rows.map(toTransaction);
  }

  private async query<TResult>(run: () => Promise<TResult>): Promise<TResult> {
    try {
      return await run();
    } catch (error) {
      throw new PersistenceError('Failed to read dashboard records.', {}, { cause: error });
    }
  }
}

function toQuote(row: {
  id: string;
  organizationId: string;
  transactionRequestId: string;
  providerId: string;
  status: string;
  sourceCurrency: string;
  targetCurrency: string;
  amountMinorUnits: { toFixed(places?: number): string };
  totalCostMinorUnits: { toFixed(places?: number): string };
  totalCostBps: { toFixed(places?: number): string };
  estimatedReceiveMinorUnits: { toFixed(places?: number): string };
  benchmarkReceiveMinorUnits: { toFixed(places?: number): string };
  settlementP50Seconds: number;
  quotedAt: Date;
  expiresAt: Date;
  isRecommended: boolean;
  rank: number | null;
  score: { toFixed(places?: number): string } | null;
  provider: { name: string; rail: string };
}): DashboardQuote {
  return {
    id: row.id,
    organizationId: row.organizationId,
    transactionRequestId: row.transactionRequestId,
    providerId: row.providerId,
    providerName: row.provider.name,
    rail: row.provider.rail,
    status: row.status,
    sourceCurrency: row.sourceCurrency,
    targetCurrency: row.targetCurrency,
    amountMinorUnits: row.amountMinorUnits.toFixed(0),
    totalCostMinorUnits: row.totalCostMinorUnits.toFixed(0),
    totalCostBps: row.totalCostBps.toFixed(4),
    estimatedReceiveMinorUnits: row.estimatedReceiveMinorUnits.toFixed(0),
    benchmarkReceiveMinorUnits: row.benchmarkReceiveMinorUnits.toFixed(0),
    settlementP50Seconds: row.settlementP50Seconds,
    quotedAt: row.quotedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    isRecommended: row.isRecommended,
    rank: row.rank,
    score: row.score?.toFixed(2) ?? null,
  };
}

function toTransaction(row: {
  id: string;
  organizationId: string;
  reference: string | null;
  sourceCurrency: string;
  targetCurrency: string;
  amountMinorUnits: { toFixed(places?: number): string };
  status: string;
  selectedQuoteId: string | null;
  createdAt: Date;
  _count: { quotes: number };
}): DashboardTransaction {
  return {
    id: row.id,
    organizationId: row.organizationId,
    reference: row.reference,
    sourceCurrency: row.sourceCurrency,
    targetCurrency: row.targetCurrency,
    amountMinorUnits: row.amountMinorUnits.toFixed(0),
    status: row.status,
    selectedQuoteId: row.selectedQuoteId,
    createdAt: row.createdAt.toISOString(),
    quoteCount: row._count.quotes,
  };
}

function toMonetizationEvent(row: {
  readonly id: string;
  readonly organizationId: string;
  readonly occurredAt: Date;
  readonly transactionType: string;
  readonly revenueSource: string;
  readonly rail: string | null;
  readonly providerId: string | null;
  readonly providerName: string | null;
  readonly currency: string;
  readonly asset: string;
  readonly destinationAsset: string | null;
  readonly agentId: string | null;
  readonly tpvMinorUnits: { toFixed(decimalPlaces?: number): string };
  readonly providerCostMinorUnits: { toFixed(decimalPlaces?: number): string };
  readonly platformRevenueMinorUnits: { toFixed(decimalPlaces?: number): string };
  readonly partnerCommissionMinorUnits: { toFixed(decimalPlaces?: number): string };
  readonly grossProfitMinorUnits: { toFixed(decimalPlaces?: number): string };
  readonly takeRateBps: { toFixed(decimalPlaces?: number): string } | null;
  readonly routeId: string | null;
  readonly quoteId: string | null;
  readonly economicStage: string;
  readonly revenueRecognition?: string;
  readonly originEnv?: string;
  readonly settlementFinality?: string;
  readonly collectionReference?: string | null;
  readonly realizedRevenue?: boolean;
  readonly invoiceId?: string | null;
}): MonetizationEvent {
  const transactionType: MonetizationTransactionType = isMonetizationTransactionType(
    row.transactionType,
  )
    ? row.transactionType
    : 'fiat_comparison';
  const revenueSource: RevenueSource = isRevenueSource(row.revenueSource)
    ? row.revenueSource
    : 'traditional_fx_routing_fee';
  return {
    id: row.id,
    organizationId: row.organizationId,
    occurredAt: row.occurredAt.toISOString(),
    transactionType,
    revenueSource,
    rail: row.rail,
    providerId: row.providerId,
    providerName: row.providerName,
    currency: row.currency,
    asset: row.asset,
    destinationAsset: row.destinationAsset,
    agentId: row.agentId,
    tpvMinorUnits: row.tpvMinorUnits.toFixed(0),
    providerCostMinorUnits: row.providerCostMinorUnits.toFixed(0),
    platformRevenueMinorUnits: row.platformRevenueMinorUnits.toFixed(0),
    partnerCommissionMinorUnits: row.partnerCommissionMinorUnits.toFixed(0),
    grossProfitMinorUnits: row.grossProfitMinorUnits.toFixed(0),
    takeRateBps: row.takeRateBps === null ? null : row.takeRateBps.toFixed(4),
    fundsMoved: false,
    custody: false,
    realExecution: false,
    routeId: row.routeId,
    quoteId: row.quoteId,
    ...monetizationLifecycleFields(row),
    invoiceId: row.invoiceId ?? null,
  };
}
