import { describe, expect, it } from 'vitest';
import {
  buildOnboardingSnapshot,
  isKybVerified,
  isRealTransactionEligible,
} from './onboarding.js';

describe('onboarding eligibility', () => {
  it('defaults a new organization to unverified and ineligible', () => {
    expect(isKybVerified('unverified')).toBe(false);
    expect(
      isRealTransactionEligible({ kybStatus: 'unverified', pricingConfigured: false }),
    ).toBe(false);
  });

  it('does not treat KYB verified without explicit pricing as eligible', () => {
    expect(isRealTransactionEligible({ kybStatus: 'verified', pricingConfigured: false })).toBe(
      false,
    );
  });

  it('does not treat pricing without verified KYB as eligible', () => {
    expect(isRealTransactionEligible({ kybStatus: 'pending', pricingConfigured: true })).toBe(
      false,
    );
    expect(isRealTransactionEligible({ kybStatus: 'rejected', pricingConfigured: true })).toBe(
      false,
    );
  });

  it('requires verified KYB and configured pricing together', () => {
    expect(isRealTransactionEligible({ kybStatus: 'verified', pricingConfigured: true })).toBe(
      true,
    );
  });

  it('builds checklist steps from real backend state only', () => {
    const snapshot = buildOnboardingSnapshot({
      organizationId: 'org_new',
      kybStatus: 'pending',
      kybReason: null,
      kybReviewedAt: null,
      pricingConfigured: false,
      apiKeyIssued: false,
      licensedProviderConfigured: false,
    });
    expect(snapshot.organizationCreated).toBe(true);
    expect(snapshot.realTransactionEligible).toBe(false);
    expect(snapshot.licensedProviderConfigured).toBe(false);
    expect(snapshot.kybVendor).toBe('manual_review');
    expect(snapshot.mode).toBe('sales_assisted_invite_only');
    expect(snapshot.steps.map((step) => [step.id, step.complete])).toEqual([
      ['organization', true],
      ['kyb', false],
      ['pricing', false],
      ['api_key', false],
    ]);
  });
});
