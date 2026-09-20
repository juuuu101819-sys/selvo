import type { CollectionConfirmationSource } from '../domain/collection.js';

/**
 * Adapter for collecting a platform-fee invoice through a payment processor.
 *
 * Non-custodial by construction: the processor holds the payment method and moves the money, and
 * the only thing that comes back is a reference. Implementations must use the processor's
 * tokenization or hosted-payment flow and must never accept, log, or persist a card number, a
 * bank account number, or any other raw credential — {@link CollectionRequest} has nowhere to put
 * one, which is deliberate.
 */
export interface CollectionRequest {
  readonly invoiceId: string;
  readonly organizationId: string;
  readonly currency: string;
  readonly amountMinorUnits: string;
  /**
   * Processor-side token for the organization's stored payment method. An opaque reference issued
   * by the processor, never a credential.
   */
  readonly paymentMethodToken: string;
  /** Passed to the processor so a retry of this charge is deduplicated on their side too. */
  readonly idempotencyKey: string;
}

/**
 * Result of asking a processor to collect.
 *
 * `confirmed` is the load-bearing field. It must be true only when the processor has affirmatively
 * reported a completed payment — an accepted request, a queued charge, or a 200 with a pending
 * status is `confirmed: false`. "The API call didn't error" is not collection (§18.5).
 */
export interface CollectionOutcome {
  readonly confirmed: boolean;
  readonly processorReference: string | null;
  readonly confirmationSource: CollectionConfirmationSource | null;
  readonly failureReason: string | null;
}

export interface PlatformFeeCollector {
  /** Identifies the processor in audit records. Never a secret. */
  readonly kind: string;
  /** Whether this adapter can actually collect. False for every stub. */
  readonly collectionEnabled: boolean;
  collect(request: CollectionRequest): Promise<CollectionOutcome>;
}

/**
 * Fail-closed default. Registered whenever no processor is contracted.
 *
 * Returns an unconfirmed outcome rather than throwing, so a `LIVE` run against an unconfigured
 * deployment records a failed attempt with a readable reason instead of a stack trace — and, more
 * importantly, never reports a success it cannot substantiate.
 */
export class DeferredPlatformFeeCollector implements PlatformFeeCollector {
  readonly kind = 'deferred';
  readonly collectionEnabled = false;

  collect(): Promise<CollectionOutcome> {
    return Promise.resolve({
      confirmed: false,
      processorReference: null,
      confirmationSource: null,
      failureReason:
        'No payment processor is contracted. Collection requires a confirmed legal entity, ' +
        'tax handling, and a processor agreement, none of which this codebase invents.',
    });
  }
}
