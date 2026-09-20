import type { Invoice, InvoiceLine } from '../domain/billing.js';
import type {
  BillingCollectionMode,
  CollectionAttempt,
  CollectionAttemptStatus,
  CollectionConfirmationSource,
} from '../domain/collection.js';
import type { MonetizationEvent } from '../domain/monetization.js';
import type { OrganizationSubscription } from '../domain/subscription.js';
import type { MeteredEndpoint, UsageCounter } from '../domain/usage-metering.js';
import type { ListCursor } from '../pagination/cursor.js';

export interface IssueInvoiceInput {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly organizationId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;
  readonly collectionMode: BillingCollectionMode;
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
    options?: { readonly limit?: number; readonly after?: ListCursor },
  ): Promise<readonly Invoice[]>;
  listInvoicesForPeriod(periodStart: string): Promise<readonly Invoice[]>;
  /**
   * Atomically insert the invoice and lines, and mark the referenced snapshots `invoiced`.
   * Callers must have already checked the period unique key. Implementations must not write
   * `collected` or `realizedRevenue: true`.
   */
  issueInvoice(input: IssueInvoiceInput): Promise<Invoice>;
}

/**
 * Per-organization API call counters (§18.1).
 *
 * `increment` is the hot path: it runs on every metered request, so implementations should use a
 * single upsert rather than a read-modify-write.
 */
export interface UsageMeterStore {
  increment(input: {
    readonly organizationId: string;
    readonly periodStart: string;
    readonly endpoint: MeteredEndpoint;
    readonly occurredAt: string;
  }): Promise<void>;
  listCounters(input: {
    readonly periodStart: string;
    readonly organizationId?: string;
  }): Promise<readonly UsageCounter[]>;
}

/** Subscription tier assignments. An organization with no row is on the `free` tier. */
export interface SubscriptionStore {
  findSubscription(organizationId: string): Promise<OrganizationSubscription | null>;
  listSubscriptions(): Promise<readonly OrganizationSubscription[]>;
  upsertSubscription(input: OrganizationSubscription): Promise<OrganizationSubscription>;
}

export interface RecordCollectionAttemptInput {
  readonly id: string;
  readonly invoiceId: string;
  readonly organizationId: string;
  readonly idempotencyKey: string;
  readonly mode: BillingCollectionMode;
  readonly status: CollectionAttemptStatus;
  readonly currency: string;
  readonly amountMinorUnits: string;
  readonly processorKind: string | null;
  readonly createdAt: string;
}

export interface ConfirmCollectionInput {
  readonly idempotencyKey: string;
  readonly processorReference: string;
  readonly processorKind: string;
  readonly confirmationSource: CollectionConfirmationSource;
  readonly confirmedAt: string;
}

/**
 * Persistence for collection attempts and the realization they permit.
 *
 * The idempotency key is the unique key, which is what makes a retry safe: {@link beginAttempt}
 * returns the stored attempt instead of inserting a second one.
 */
export interface CollectionStore {
  /**
   * Insert an attempt, or return the existing attempt for this idempotency key untouched.
   * `created` distinguishes the two so a caller can tell a fresh attempt from a replay.
   */
  beginAttempt(input: RecordCollectionAttemptInput): Promise<{
    readonly attempt: CollectionAttempt;
    readonly created: boolean;
  }>;
  findAttemptByKey(idempotencyKey: string): Promise<CollectionAttempt | null>;
  listAttemptsForInvoice(invoiceId: string): Promise<readonly CollectionAttempt[]>;
  /**
   * Record a confirmed processor success and, in the same transaction, mark the invoice
   * `collected` and set `revenueRecognition: 'collected'` plus the collection reference on every
   * snapshot it billed. This is the only write path that may enable `REALIZED_REVENUE`.
   */
  confirmAttempt(input: ConfirmCollectionInput): Promise<CollectionAttempt>;
  failAttempt(input: {
    readonly idempotencyKey: string;
    readonly failureReason: string;
    readonly failedAt: string;
  }): Promise<CollectionAttempt>;
}
