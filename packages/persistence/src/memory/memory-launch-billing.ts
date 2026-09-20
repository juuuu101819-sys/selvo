import {
  PersistenceError,
  parseCallCount,
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
import type { InMemoryBillingStore } from './memory-billing.js';

/**
 * In-process stores for usage metering, subscriptions, and collection attempts (§18.1, §18.5).
 *
 * These mirror the Postgres behaviour the tests depend on, in particular the idempotency-key
 * uniqueness that makes a collection retry safe. Where the memory driver would let a second
 * attempt through, a bug would pass its tests and fail in production, so the uniqueness is
 * enforced here too rather than assumed.
 */

export class InMemoryUsageMeterStore implements UsageMeterStore {
  private readonly counters = new Map<string, UsageCounter>();

  increment(input: {
    readonly organizationId: string;
    readonly periodStart: string;
    readonly endpoint: MeteredEndpoint;
    readonly occurredAt: string;
  }): Promise<void> {
    const key = `${input.organizationId}\0${input.periodStart}\0${input.endpoint}`;
    const existing = this.counters.get(key);
    if (existing === undefined) {
      this.counters.set(key, {
        organizationId: input.organizationId,
        periodStart: input.periodStart,
        endpoint: input.endpoint,
        callCount: '1',
        firstCallAt: input.occurredAt,
        lastCallAt: input.occurredAt,
      });
      return Promise.resolve();
    }
    this.counters.set(key, {
      ...existing,
      callCount: (parseCallCount(existing.callCount) + 1n).toString(),
      lastCallAt: input.occurredAt,
    });
    return Promise.resolve();
  }

  listCounters(input: {
    readonly periodStart: string;
    readonly organizationId?: string;
  }): Promise<readonly UsageCounter[]> {
    return Promise.resolve(
      [...this.counters.values()]
        .filter(
          (counter) =>
            counter.periodStart === input.periodStart &&
            (input.organizationId === undefined ||
              counter.organizationId === input.organizationId),
        )
        .map((counter) => ({ ...counter })),
    );
  }
}

export class InMemorySubscriptionStore implements SubscriptionStore {
  private readonly rows = new Map<string, OrganizationSubscription>();

  findSubscription(organizationId: string): Promise<OrganizationSubscription | null> {
    const found = this.rows.get(organizationId);
    return Promise.resolve(found === undefined ? null : { ...found });
  }

  listSubscriptions(): Promise<readonly OrganizationSubscription[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .sort((left, right) => left.organizationId.localeCompare(right.organizationId))
        .map((row) => ({ ...row })),
    );
  }

  upsertSubscription(input: OrganizationSubscription): Promise<OrganizationSubscription> {
    this.rows.set(input.organizationId, { ...input });
    return Promise.resolve({ ...input });
  }
}

export class InMemoryCollectionStore implements CollectionStore {
  private readonly attempts = new Map<string, CollectionAttempt>();

  constructor(private readonly billing: InMemoryBillingStore) {}

  beginAttempt(input: RecordCollectionAttemptInput): Promise<{
    readonly attempt: CollectionAttempt;
    readonly created: boolean;
  }> {
    const existing = this.attempts.get(input.idempotencyKey);
    if (existing !== undefined) {
      return Promise.resolve({ attempt: { ...existing }, created: false });
    }
    const attempt: CollectionAttempt = {
      id: input.id,
      invoiceId: input.invoiceId,
      organizationId: input.organizationId,
      idempotencyKey: input.idempotencyKey,
      mode: input.mode,
      status: input.status,
      currency: input.currency,
      amountMinorUnits: input.amountMinorUnits,
      processorReference: null,
      processorKind: input.processorKind,
      confirmationSource: null,
      failureReason: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      confirmedAt: null,
    };
    this.attempts.set(attempt.idempotencyKey, attempt);
    return Promise.resolve({ attempt: { ...attempt }, created: true });
  }

  findAttemptByKey(idempotencyKey: string): Promise<CollectionAttempt | null> {
    const found = this.attempts.get(idempotencyKey);
    return Promise.resolve(found === undefined ? null : { ...found });
  }

  listAttemptsForInvoice(invoiceId: string): Promise<readonly CollectionAttempt[]> {
    return Promise.resolve(
      [...this.attempts.values()]
        .filter((attempt) => attempt.invoiceId === invoiceId)
        .map((attempt) => ({ ...attempt })),
    );
  }

  confirmAttempt(input: ConfirmCollectionInput): Promise<CollectionAttempt> {
    const attempt = this.attempts.get(input.idempotencyKey);
    if (attempt === undefined) {
      return Promise.reject(
        new PersistenceError('No collection attempt for this idempotency key.', {
          idempotencyKey: input.idempotencyKey,
        }),
      );
    }
    // Confirming twice must be a no-op rather than a second promotion: a processor can deliver
    // the same webhook more than once, and that must not look like a second payment.
    if (attempt.status === 'succeeded') {
      return Promise.resolve({ ...attempt });
    }
    const confirmed: CollectionAttempt = {
      ...attempt,
      status: 'succeeded',
      processorReference: input.processorReference,
      processorKind: input.processorKind,
      confirmationSource: input.confirmationSource,
      failureReason: null,
      updatedAt: input.confirmedAt,
      confirmedAt: input.confirmedAt,
    };
    this.attempts.set(confirmed.idempotencyKey, confirmed);
    this.billing.markCollected({
      invoiceId: confirmed.invoiceId,
      collectionReference: input.processorReference,
    });
    return Promise.resolve({ ...confirmed });
  }

  failAttempt(input: {
    readonly idempotencyKey: string;
    readonly failureReason: string;
    readonly failedAt: string;
  }): Promise<CollectionAttempt> {
    const attempt = this.attempts.get(input.idempotencyKey);
    if (attempt === undefined) {
      return Promise.reject(
        new PersistenceError('No collection attempt for this idempotency key.', {
          idempotencyKey: input.idempotencyKey,
        }),
      );
    }
    if (attempt.status === 'succeeded') {
      return Promise.resolve({ ...attempt });
    }
    const failed: CollectionAttempt = {
      ...attempt,
      status: 'failed',
      failureReason: input.failureReason,
      updatedAt: input.failedAt,
    };
    this.attempts.set(failed.idempotencyKey, failed);
    return Promise.resolve({ ...failed });
  }
}
