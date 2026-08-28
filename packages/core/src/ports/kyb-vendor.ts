import { PersistenceError } from '../errors/index.js';
import type { KybStatus } from '../domain/onboarding.js';

/**
 * Pluggable KYB vendor. Manual review is the interim implementation: submit never auto-approves.
 * A vendor timeout or error must fail closed (leave the org unverified / pending) — never verified.
 */
export interface KybSubmissionResult {
  readonly vendorId: string;
  readonly status: Extract<KybStatus, 'pending'>;
}

export interface KybVendor {
  readonly id: string;
  submitForReview(input: {
    readonly organizationId: string;
    readonly countryCode: string;
  }): Promise<KybSubmissionResult>;
}

export class ManualReviewKybVendor implements KybVendor {
  readonly id = 'manual_review';

  submitForReview(): Promise<KybSubmissionResult> {
    return Promise.resolve({ vendorId: this.id, status: 'pending' });
  }
}

/** Test double: vendor errors must never become a verified decision. */
export class FailingKybVendor implements KybVendor {
  readonly id = 'failing_test_vendor';

  submitForReview(): Promise<KybSubmissionResult> {
    return Promise.reject(
      new PersistenceError('KYB vendor unavailable. The organization was not auto-approved.'),
    );
  }
}
