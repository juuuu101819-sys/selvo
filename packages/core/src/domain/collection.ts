import { ValidationError } from '../errors/index.js';

/**
 * Invoice collection (§18.5).
 *
 * Two modes exist so that billing can ship before the company can legally take money. In
 * `RECORD_ONLY` the whole pipeline runs — usage is metered, invoices are computed and recorded —
 * and no processor is ever contacted. `LIVE` is the same pipeline with a contracted processor
 * attached. Moving between them is configuration plus a recorded legal determination, not a code
 * change, which is the point: the code is not what is unfinished.
 *
 * Collection is still non-custodial. The processor holds and moves the money; SELVO stores a
 * reference token and never sees a card or bank credential.
 */

export const BILLING_COLLECTION_MODES = ['RECORD_ONLY', 'LIVE'] as const;
export type BillingCollectionMode = (typeof BILLING_COLLECTION_MODES)[number];

export function isBillingCollectionMode(value: unknown): value is BillingCollectionMode {
  return (
    typeof value === 'string' && (BILLING_COLLECTION_MODES as readonly string[]).includes(value)
  );
}

/**
 * Lifecycle of one attempt to collect one invoice.
 *
 * `recorded` is the terminal state in `RECORD_ONLY`: the attempt happened, the amount is known,
 * and no money was requested. It is deliberately distinct from `succeeded` so a record-only run
 * can never be mistaken for a payment.
 */
export const COLLECTION_ATTEMPT_STATUSES = [
  'recorded',
  'pending',
  'succeeded',
  'failed',
] as const;
export type CollectionAttemptStatus = (typeof COLLECTION_ATTEMPT_STATUSES)[number];

export function isCollectionAttemptStatus(value: unknown): value is CollectionAttemptStatus {
  return (
    typeof value === 'string' &&
    (COLLECTION_ATTEMPT_STATUSES as readonly string[]).includes(value)
  );
}

/** How a success was established. "The API call did not error" is not on this list. */
export const COLLECTION_CONFIRMATION_SOURCES = [
  'processor_webhook',
  'processor_sync_confirmed',
  'operator_manual',
] as const;
export type CollectionConfirmationSource = (typeof COLLECTION_CONFIRMATION_SOURCES)[number];

export function isCollectionConfirmationSource(
  value: unknown,
): value is CollectionConfirmationSource {
  return (
    typeof value === 'string' &&
    (COLLECTION_CONFIRMATION_SOURCES as readonly string[]).includes(value)
  );
}

export interface CollectionAttempt {
  readonly id: string;
  readonly invoiceId: string;
  readonly organizationId: string;
  /**
   * Stable key for this invoice's collection. Unique in the store, so a retry finds the existing
   * attempt instead of creating a second charge.
   */
  readonly idempotencyKey: string;
  readonly mode: BillingCollectionMode;
  readonly status: CollectionAttemptStatus;
  readonly currency: string;
  readonly amountMinorUnits: string;
  /** Processor's own reference for the charge. Never a card or bank credential. */
  readonly processorReference: string | null;
  readonly processorKind: string | null;
  readonly confirmationSource: CollectionConfirmationSource | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly confirmedAt: string | null;
}

/**
 * Deterministic idempotency key for collecting an invoice.
 *
 * Derived from the invoice id alone, so a retry of a failed or interrupted attempt produces the
 * same key and is deduplicated. A key that included a timestamp or attempt counter would make
 * every retry a fresh charge, which is the failure this is meant to prevent.
 */
export function collectionIdempotencyKey(invoiceId: string): string {
  const trimmed = invoiceId.trim();
  if (trimmed === '') {
    throw new ValidationError('Invoice id is required to build a collection idempotency key.', {
      field: 'invoiceId',
    });
  }
  return `collect:invoice:${trimmed}`;
}

/** A confirmed processor outcome. The only thing that may promote revenue to collected. */
export interface CollectionConfirmation {
  readonly processorReference: string;
  readonly processorKind: string;
  readonly source: CollectionConfirmationSource;
  readonly confirmedAt: string;
}

/**
 * Validate a claimed confirmation.
 *
 * A confirmation without a processor reference is not a confirmation: §18.5 requires a collection
 * record, and 8-A requires one before `REALIZED_REVENUE`. Accepting a blank reference here would
 * make the whole realization chain unverifiable.
 */
export function parseCollectionConfirmation(raw: unknown): CollectionConfirmation {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('A collection confirmation object is required.', {});
  }
  const body = raw as Record<string, unknown>;
  const processorReference = requireText(body['processorReference'], 'processorReference');
  const processorKind = requireText(body['processorKind'], 'processorKind');
  const source = body['source'];
  if (!isCollectionConfirmationSource(source)) {
    throw new ValidationError(
      'Collection confirmation source must be a processor webhook, a confirmed processor response, or an operator confirmation with a reference.',
      { source, allowed: [...COLLECTION_CONFIRMATION_SOURCES] },
    );
  }
  const confirmedAt = requireText(body['confirmedAt'], 'confirmedAt');
  if (!Number.isFinite(Date.parse(confirmedAt))) {
    throw new ValidationError('confirmedAt must be an ISO-8601 instant.', { confirmedAt });
  }
  return { processorReference, processorKind, source, confirmedAt };
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`Collection confirmation field "${field}" is required.`, { field });
  }
  return value.trim();
}
