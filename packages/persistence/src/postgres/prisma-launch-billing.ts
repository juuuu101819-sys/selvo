import {
  PersistenceError,
  isCollectionAttemptStatus,
  isCollectionConfirmationSource,
  isMeteredEndpoint,
  isBillingCollectionMode,
  isSubscriptionTier,
  type CollectionAttempt,
  type CollectionStore,
  type ConfirmCollectionInput,
  type MeteredEndpoint,
  type OrganizationSubscription,
  type RecordCollectionAttemptInput,
  type SubscriptionStore,
  type UsageCounter,
  type UsageMeterStore,
} from '@meridian/core';
import { Prisma, type PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

/**
 * PostgreSQL stores for usage metering, subscriptions, and collection (§18.1, §18.5).
 */

export class PrismaUsageMeterStore implements UsageMeterStore {
  constructor(private readonly client: PrismaClient) {}

  /**
   * Increment one counter.
   *
   * A single upsert against the `(organization, period, endpoint)` unique key rather than a
   * read-modify-write, so concurrent requests from the same customer cannot lose increments — and
   * so the meter costs one statement on a path that runs on every billable call.
   */
  async increment(input: {
    readonly organizationId: string;
    readonly periodStart: string;
    readonly endpoint: MeteredEndpoint;
    readonly occurredAt: string;
  }): Promise<void> {
    const occurredAt = new Date(input.occurredAt);
    try {
      await this.client.usageCounter.upsert({
        where: {
          organizationId_periodStart_endpoint: {
            organizationId: input.organizationId,
            periodStart: new Date(input.periodStart),
            endpoint: input.endpoint,
          },
        },
        create: {
          id: randomUUID(),
          organizationId: input.organizationId,
          periodStart: new Date(input.periodStart),
          endpoint: input.endpoint,
          callCount: new Prisma.Decimal(1),
          firstCallAt: occurredAt,
          lastCallAt: occurredAt,
        },
        update: {
          callCount: { increment: new Prisma.Decimal(1) },
          lastCallAt: occurredAt,
        },
      });
    } catch (error) {
      throw new PersistenceError('Failed to record API usage.', {}, { cause: error });
    }
  }

  async listCounters(input: {
    readonly periodStart: string;
    readonly organizationId?: string;
  }): Promise<readonly UsageCounter[]> {
    try {
      const rows = await this.client.usageCounter.findMany({
        where: {
          periodStart: new Date(input.periodStart),
          ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
        },
        orderBy: [{ organizationId: 'asc' }, { endpoint: 'asc' }],
      });
      return rows
        .filter((row) => isMeteredEndpoint(row.endpoint))
        .map((row) => ({
          organizationId: row.organizationId,
          periodStart: row.periodStart.toISOString(),
          endpoint: row.endpoint as MeteredEndpoint,
          callCount: row.callCount.toFixed(0),
          firstCallAt: row.firstCallAt.toISOString(),
          lastCallAt: row.lastCallAt.toISOString(),
        }));
    } catch (error) {
      throw new PersistenceError('Failed to read API usage.', {}, { cause: error });
    }
  }
}

export class PrismaSubscriptionStore implements SubscriptionStore {
  constructor(private readonly client: PrismaClient) {}

  async findSubscription(organizationId: string): Promise<OrganizationSubscription | null> {
    try {
      const row = await this.client.organizationSubscription.findUnique({
        where: { organizationId },
      });
      return row === null ? null : toSubscription(row);
    } catch (error) {
      throw new PersistenceError('Failed to read the subscription.', {}, { cause: error });
    }
  }

  async listSubscriptions(): Promise<readonly OrganizationSubscription[]> {
    try {
      const rows = await this.client.organizationSubscription.findMany({
        orderBy: { organizationId: 'asc' },
      });
      return rows.map(toSubscription);
    } catch (error) {
      throw new PersistenceError('Failed to list subscriptions.', {}, { cause: error });
    }
  }

  async upsertSubscription(
    input: OrganizationSubscription,
  ): Promise<OrganizationSubscription> {
    const flatFee =
      input.flatDecisionFeeMinorUnits === null
        ? null
        : new Prisma.Decimal(input.flatDecisionFeeMinorUnits);
    try {
      const row = await this.client.organizationSubscription.upsert({
        where: { organizationId: input.organizationId },
        create: {
          id: randomUUID(),
          organizationId: input.organizationId,
          tier: input.tier,
          currency: input.currency,
          startedAt: new Date(input.startedAt),
          cancelledAt: input.cancelledAt === null ? null : new Date(input.cancelledAt),
          flatDecisionFeeMinorUnits: flatFee,
        },
        update: {
          tier: input.tier,
          currency: input.currency,
          startedAt: new Date(input.startedAt),
          cancelledAt: input.cancelledAt === null ? null : new Date(input.cancelledAt),
          flatDecisionFeeMinorUnits: flatFee,
        },
      });
      return toSubscription(row);
    } catch (error) {
      throw new PersistenceError('Failed to save the subscription.', {}, { cause: error });
    }
  }
}

export class PrismaCollectionStore implements CollectionStore {
  constructor(private readonly client: PrismaClient) {}

  /**
   * Insert an attempt, or return the stored one for this key.
   *
   * The unique index on `idempotency_key` is the arbiter. A concurrent second attempt loses on
   * insert and is resolved to the winner's row, so two simultaneous collect requests produce one
   * charge rather than racing in application code.
   */
  async beginAttempt(input: RecordCollectionAttemptInput): Promise<{
    readonly attempt: CollectionAttempt;
    readonly created: boolean;
  }> {
    const existing = await this.findAttemptByKey(input.idempotencyKey);
    if (existing !== null) {
      return { attempt: existing, created: false };
    }
    try {
      const row = await this.client.collectionAttempt.create({
        data: {
          id: input.id,
          invoiceId: input.invoiceId,
          organizationId: input.organizationId,
          idempotencyKey: input.idempotencyKey,
          mode: input.mode,
          status: input.status,
          currency: input.currency,
          amountMinorUnits: new Prisma.Decimal(input.amountMinorUnits),
          processorKind: input.processorKind,
          createdAt: new Date(input.createdAt),
          updatedAt: new Date(input.createdAt),
        },
      });
      return { attempt: toAttempt(row), created: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.findAttemptByKey(input.idempotencyKey);
        if (winner !== null) {
          return { attempt: winner, created: false };
        }
      }
      throw new PersistenceError('Failed to record the collection attempt.', {}, { cause: error });
    }
  }

  async findAttemptByKey(idempotencyKey: string): Promise<CollectionAttempt | null> {
    try {
      const row = await this.client.collectionAttempt.findUnique({ where: { idempotencyKey } });
      return row === null ? null : toAttempt(row);
    } catch (error) {
      throw new PersistenceError('Failed to read the collection attempt.', {}, { cause: error });
    }
  }

  async listAttemptsForInvoice(invoiceId: string): Promise<readonly CollectionAttempt[]> {
    try {
      const rows = await this.client.collectionAttempt.findMany({
        where: { invoiceId },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(toAttempt);
    } catch (error) {
      throw new PersistenceError('Failed to list collection attempts.', {}, { cause: error });
    }
  }

  /**
   * Record a confirmed payment and recognize the revenue it paid for, in one transaction.
   *
   * This is the only write path that may set `revenue_recognition = 'collected'`. It also stamps
   * the processor reference onto every snapshot the invoice billed, which is what the revenue
   * lifecycle resolver requires before it will report `REALIZED_REVENUE` — and which it will still
   * refuse to honour for a non-production origin.
   */
  async confirmAttempt(input: ConfirmCollectionInput): Promise<CollectionAttempt> {
    try {
      const confirmed = await this.client.$transaction(async (tx) => {
        const attempt = await tx.collectionAttempt.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (attempt === null) {
          throw new PersistenceError('No collection attempt for this idempotency key.', {
            idempotencyKey: input.idempotencyKey,
          });
        }
        // A processor can deliver the same webhook twice. Confirming again must be a no-op, not a
        // second promotion that looks like a second payment.
        if (attempt.status === 'succeeded') {
          return attempt;
        }
        if (attempt.mode !== 'LIVE') {
          throw new PersistenceError(
            'A RECORD_ONLY collection attempt cannot be confirmed: no money was requested.',
            { idempotencyKey: input.idempotencyKey, mode: attempt.mode },
          );
        }
        const confirmedAt = new Date(input.confirmedAt);
        const updated = await tx.collectionAttempt.update({
          where: { idempotencyKey: input.idempotencyKey },
          data: {
            status: 'succeeded',
            processorReference: input.processorReference,
            processorKind: input.processorKind,
            confirmationSource: input.confirmationSource,
            failureReason: null,
            updatedAt: confirmedAt,
            confirmedAt,
          },
        });
        await tx.invoice.update({
          where: { id: attempt.invoiceId },
          data: {
            collectionStatus: 'collected',
            // The invoice now stands in LIVE: money was requested and confirmed against it. An
            // invoice issued while the platform was still RECORD_ONLY can be collected later, but
            // it must stop describing itself as record-only once it has been.
            collectionMode: 'LIVE',
            collectionReference: input.processorReference,
          },
        });
        const lines = await tx.invoiceLine.findMany({
          where: { invoiceId: attempt.invoiceId, monetizationEventId: { not: null } },
          select: { monetizationEventId: true },
        });
        const snapshotIds = lines
          .map((line) => line.monetizationEventId)
          .filter((id): id is string => id !== null);
        if (snapshotIds.length > 0) {
          await tx.monetizationEvent.updateMany({
            where: { id: { in: snapshotIds } },
            data: {
              revenueRecognition: 'collected',
              collectionReference: input.processorReference,
            },
          });
          // Realization is claimed only where the other two facts already hold. The database
          // CHECK constraints would reject anything else, but filtering here means a
          // simulated-origin snapshot on a collected invoice stays capped at ATTRIBUTED instead
          // of failing the whole transaction.
          await tx.monetizationEvent.updateMany({
            where: {
              id: { in: snapshotIds },
              originEnv: 'PRODUCTION',
              settlementFinality: 'provider_confirmed',
            },
            data: { realizedRevenue: true },
          });
        }
        return updated;
      });
      return toAttempt(confirmed);
    } catch (error) {
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError('Failed to confirm the collection.', {}, { cause: error });
    }
  }

  async failAttempt(input: {
    readonly idempotencyKey: string;
    readonly failureReason: string;
    readonly failedAt: string;
  }): Promise<CollectionAttempt> {
    try {
      const attempt = await this.client.collectionAttempt.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (attempt === null) {
        throw new PersistenceError('No collection attempt for this idempotency key.', {
          idempotencyKey: input.idempotencyKey,
        });
      }
      if (attempt.status === 'succeeded') {
        return toAttempt(attempt);
      }
      const updated = await this.client.collectionAttempt.update({
        where: { idempotencyKey: input.idempotencyKey },
        data: {
          status: 'failed',
          failureReason: input.failureReason,
          updatedAt: new Date(input.failedAt),
        },
      });
      return toAttempt(updated);
    } catch (error) {
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError('Failed to record the collection failure.', {}, { cause: error });
    }
  }
}

function toSubscription(row: {
  readonly organizationId: string;
  readonly tier: string;
  readonly currency: string;
  readonly startedAt: Date;
  readonly cancelledAt: Date | null;
  readonly flatDecisionFeeMinorUnits: { toFixed(decimalPlaces?: number): string } | null;
}): OrganizationSubscription {
  return {
    organizationId: row.organizationId,
    // An unreadable tier reads as `free`: no base fee and no quota is the fail-closed answer,
    // because guessing a paid tier would invoice a customer for a plan they may not hold.
    tier: isSubscriptionTier(row.tier) ? row.tier : 'free',
    currency: row.currency,
    startedAt: row.startedAt.toISOString(),
    cancelledAt: row.cancelledAt === null ? null : row.cancelledAt.toISOString(),
    flatDecisionFeeMinorUnits:
      row.flatDecisionFeeMinorUnits === null ? null : row.flatDecisionFeeMinorUnits.toFixed(0),
  };
}

function toAttempt(row: {
  readonly id: string;
  readonly invoiceId: string;
  readonly organizationId: string;
  readonly idempotencyKey: string;
  readonly mode: string;
  readonly status: string;
  readonly currency: string;
  readonly amountMinorUnits: { toFixed(decimalPlaces?: number): string };
  readonly processorReference: string | null;
  readonly processorKind: string | null;
  readonly confirmationSource: string | null;
  readonly failureReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly confirmedAt: Date | null;
}): CollectionAttempt {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    organizationId: row.organizationId,
    idempotencyKey: row.idempotencyKey,
    mode: isBillingCollectionMode(row.mode) ? row.mode : 'RECORD_ONLY',
    // An unrecognizable status reads as `failed` rather than `succeeded`: an unreadable row must
    // never be the basis for claiming money was received.
    status: isCollectionAttemptStatus(row.status) ? row.status : 'failed',
    currency: row.currency,
    amountMinorUnits: row.amountMinorUnits.toFixed(0),
    processorReference: row.processorReference,
    processorKind: row.processorKind,
    confirmationSource: isCollectionConfirmationSource(row.confirmationSource)
      ? row.confirmationSource
      : null,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    confirmedAt: row.confirmedAt === null ? null : row.confirmedAt.toISOString(),
  };
}
