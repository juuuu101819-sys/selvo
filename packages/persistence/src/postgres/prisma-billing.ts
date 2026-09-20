import {
  PersistenceError,
  isBillableEventClass,
  isBillingCollectionMode,
  isInvoiceCollectionStatus,
  isInvoiceStatus,
  isMonetizationTransactionType,
  isRevenueSource,
  type BillingStore,
  type Invoice,
  type InvoiceLine,
  type IssueInvoiceInput,
  type ListCursor,
  type MonetizationEvent,
  type MonetizationTransactionType,
  type RevenueSource,
} from '@meridian/core';
import { Prisma, type PrismaClient } from '@prisma/client';
import { descKeysetWhere } from './keyset.js';
import { monetizationLifecycleFields } from './monetization-lifecycle.js';

const DEFAULT_LIMIT = 50;

export class PrismaBillingStore implements BillingStore {
  constructor(private readonly client: PrismaClient) {}

  async listEventsInPeriod(input: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly organizationId?: string;
  }): Promise<readonly MonetizationEvent[]> {
    const rows = await this.query(() =>
      this.client.monetizationEvent.findMany({
        where: {
          occurredAt: {
            gte: new Date(input.periodStart),
            lt: new Date(input.periodEnd),
          },
          ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
        },
        orderBy: [{ organizationId: 'asc' }, { occurredAt: 'asc' }],
      }),
    );
    return rows.map(toMonetizationEvent);
  }

  async findInvoiceByPeriod(input: {
    readonly organizationId: string;
    readonly periodStart: string;
    readonly currency: string;
  }): Promise<Invoice | null> {
    const row = await this.query(() =>
      this.client.invoice.findUnique({
        where: {
          organizationId_periodStart_currency: {
            organizationId: input.organizationId,
            periodStart: new Date(input.periodStart),
            currency: input.currency,
          },
        },
        include: { lines: { orderBy: { occurredAt: 'asc' } } },
      }),
    );
    return row === null ? null : toInvoice(row);
  }

  async getInvoice(invoiceId: string): Promise<Invoice | null> {
    const row = await this.query(() =>
      this.client.invoice.findUnique({
        where: { id: invoiceId },
        include: { lines: { orderBy: { occurredAt: 'asc' } } },
      }),
    );
    return row === null ? null : toInvoice(row);
  }

  async getInvoiceForOrganization(
    organizationId: string,
    invoiceId: string,
  ): Promise<Invoice | null> {
    const row = await this.query(() =>
      this.client.invoice.findFirst({
        where: { id: invoiceId, organizationId },
        include: { lines: { orderBy: { occurredAt: 'asc' } } },
      }),
    );
    return row === null ? null : toInvoice(row);
  }

  async listInvoicesForOrganization(
    organizationId: string,
    options: { readonly limit?: number; readonly after?: ListCursor } = {},
  ): Promise<readonly Invoice[]> {
    const rows = await this.query(() =>
      this.client.invoice.findMany({
        where: {
          organizationId,
          ...descKeysetWhere(options.after, 'issuedAt', 'id'),
        },
        include: { lines: { orderBy: { occurredAt: 'asc' } } },
        orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
        take: options.limit ?? DEFAULT_LIMIT,
      }),
    );
    return rows.map(toInvoice);
  }

  async listInvoicesForPeriod(periodStart: string): Promise<readonly Invoice[]> {
    const rows = await this.query(() =>
      this.client.invoice.findMany({
        where: { periodStart: new Date(periodStart) },
        include: { lines: { orderBy: { occurredAt: 'asc' } } },
        orderBy: [{ organizationId: 'asc' }, { currency: 'asc' }],
      }),
    );
    return rows.map(toInvoice);
  }

  async issueInvoice(input: IssueInvoiceInput): Promise<Invoice> {
    try {
      const created = await this.client.$transaction(async (tx) => {
        const invoice = await tx.invoice.create({
          data: {
            id: input.id,
            invoiceNumber: input.invoiceNumber,
            organizationId: input.organizationId,
            periodStart: new Date(input.periodStart),
            periodEnd: new Date(input.periodEnd),
            currency: input.currency,
            status: 'issued',
            collectionStatus: 'uncollected',
            collectionMode: input.collectionMode,
            collectionReference: null,
            issuerLegalEntity: 'unconfirmed',
            taxCalculation: 'deferred',
            subtotalMinorUnits: new Prisma.Decimal(input.subtotalMinorUnits),
            taxMinorUnits: new Prisma.Decimal('0'),
            totalMinorUnits: new Prisma.Decimal(input.totalMinorUnits),
            issuedAt: new Date(input.issuedAt),
            issuedByActor: input.issuedByActor,
            lines: {
              create: input.lines.map((line) => ({
                id: line.id,
                monetizationEventId: line.monetizationEventId,
                eventClass: line.eventClass,
                description: line.description,
                quantity: new Prisma.Decimal(line.quantity),
                platformRevenueMinorUnits: new Prisma.Decimal(line.platformRevenueMinorUnits),
                economicStage: line.economicStage,
                transactionType: line.transactionType,
                revenueSource: line.revenueSource,
                occurredAt: new Date(line.occurredAt),
              })),
            },
          },
          include: { lines: { orderBy: { occurredAt: 'asc' } } },
        });
        // Only the decision lines reference a snapshot; subscription and metered lines bill a
        // period, so there is nothing for them to move from `unrealized` to `invoiced`.
        const snapshotIds = input.lines
          .map((line) => line.monetizationEventId)
          .filter((id): id is string => id !== null);
        if (snapshotIds.length > 0) {
          const updated = await tx.monetizationEvent.updateMany({
            where: {
              id: { in: snapshotIds },
              revenueRecognition: 'unrealized',
              invoiceId: null,
            },
            data: {
              revenueRecognition: 'invoiced',
              invoiceId: input.id,
              realizedRevenue: false,
            },
          });
          if (updated.count !== snapshotIds.length) {
            throw new PersistenceError('Could not mark every billed snapshot as invoiced.', {
              expected: snapshotIds.length,
              updated: updated.count,
              invoiceId: input.id,
            });
          }
        }
        return invoice;
      });
      return toInvoice(created);
    } catch (error) {
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError('Failed to issue the invoice.', {}, { cause: error });
    }
  }

  private async query<TResult>(run: () => Promise<TResult>): Promise<TResult> {
    try {
      return await run();
    } catch (error) {
      throw new PersistenceError('Failed to read billing records.', {}, { cause: error });
    }
  }
}

function toInvoice(row: {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly organizationId: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly currency: string;
  readonly status: string;
  readonly collectionStatus: string;
  readonly collectionMode?: string;
  readonly collectionReference?: string | null;
  readonly issuerLegalEntity: string;
  readonly taxCalculation: string;
  readonly subtotalMinorUnits: { toFixed(decimalPlaces?: number): string };
  readonly taxMinorUnits: { toFixed(decimalPlaces?: number): string };
  readonly totalMinorUnits: { toFixed(decimalPlaces?: number): string };
  readonly issuedAt: Date;
  readonly issuedByActor: string;
  readonly lines: readonly {
    readonly id: string;
    readonly invoiceId: string;
    readonly monetizationEventId: string | null;
    readonly eventClass?: string;
    readonly description?: string;
    readonly quantity?: { toFixed(decimalPlaces?: number): string };
    readonly platformRevenueMinorUnits: { toFixed(decimalPlaces?: number): string };
    readonly economicStage: string;
    readonly transactionType: string;
    readonly revenueSource: string;
    readonly occurredAt: Date;
  }[];
}): Invoice {
  const lines: InvoiceLine[] = row.lines.map((line) => ({
    id: line.id,
    invoiceId: line.invoiceId,
    monetizationEventId: line.monetizationEventId,
    // A row written before the charge classes existed was copied from a routed decision, which is
    // exactly FLAT_DECISION.
    eventClass: isBillableEventClass(line.eventClass) ? line.eventClass : 'FLAT_DECISION',
    description: line.description ?? '',
    quantity: line.quantity?.toFixed(0) ?? '1',
    platformRevenueMinorUnits: line.platformRevenueMinorUnits.toFixed(0),
    economicStage: line.economicStage,
    transactionType: line.transactionType,
    revenueSource: line.revenueSource,
    occurredAt: line.occurredAt.toISOString(),
  }));
  const collectionStatus = isInvoiceCollectionStatus(row.collectionStatus)
    ? row.collectionStatus
    : 'uncollected';
  const collectionReference = row.collectionReference ?? null;
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    organizationId: row.organizationId,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    currency: row.currency,
    status: isInvoiceStatus(row.status) ? row.status : 'issued',
    // Collection is only claimed when the reference that proves it is present. An unreadable or
    // half-written row reads as uncollected rather than as money received.
    collectionStatus: collectionReference === null ? 'uncollected' : collectionStatus,
    collectionMode: isBillingCollectionMode(row.collectionMode) ? row.collectionMode : 'RECORD_ONLY',
    collectionReference,
    issuerLegalEntity: 'unconfirmed',
    taxCalculation: 'deferred',
    subtotalMinorUnits: row.subtotalMinorUnits.toFixed(0),
    taxMinorUnits: '0',
    totalMinorUnits: row.totalMinorUnits.toFixed(0),
    issuedAt: row.issuedAt.toISOString(),
    issuedByActor: row.issuedByActor,
    lines,
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
  readonly revenueRecognition: string;
  readonly originEnv?: string;
  readonly settlementFinality?: string;
  readonly collectionReference?: string | null;
  readonly realizedRevenue?: boolean;
  readonly invoiceId: string | null;
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
    invoiceId: row.invoiceId,
  };
}
