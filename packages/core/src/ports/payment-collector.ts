/**
 * Adapter for collecting platform fees against an issued invoice.
 *
 * No processor is confirmed. This port exists so a future adapter can be wired without changing
 * billing generation. This phase never stores card or bank credentials.
 */
export interface PlatformFeeCollector {
  readonly kind: string;
  readonly collectionEnabled: boolean;
}

/**
 * Fail-closed stub. Collection is a business/legal decision (legal entity, tax, payment mechanism)
 * and is explicitly deferred. Calling `collect` never marks an invoice paid.
 */
export class DeferredPlatformFeeCollector implements PlatformFeeCollector {
  readonly kind = 'deferred';
  readonly collectionEnabled = false;

  collect(): never {
    throw new Error(
      'Platform fee collection is deferred until a legal entity, tax handling, and payment mechanism are confirmed outside this codebase.',
    );
  }
}
