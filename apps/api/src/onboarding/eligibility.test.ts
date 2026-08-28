import { describe, expect, it } from 'vitest';
import { OnboardingIncompleteError } from '@meridian/core';
import { buildOnboardingSnapshot } from '@meridian/core';
import { assertLicensedQuoteEligibility } from './eligibility.js';

describe('assertLicensedQuoteEligibility', () => {
  const incomplete = buildOnboardingSnapshot({
    organizationId: 'org_x',
    kybStatus: 'unverified',
    kybReason: null,
    kybReviewedAt: null,
    pricingConfigured: false,
    apiKeyIssued: false,
    licensedProviderConfigured: false,
  });
  const complete = buildOnboardingSnapshot({
    organizationId: 'org_x',
    kybStatus: 'verified',
    kybReason: 'manual review',
    kybReviewedAt: '2026-03-01T09:00:00.000Z',
    pricingConfigured: true,
    apiKeyIssued: true,
    licensedProviderConfigured: false,
  });

  it('allows sandbox exploration without KYB or pricing', () => {
    expect(() => assertLicensedQuoteEligibility(false, incomplete)).not.toThrow();
  });

  it('blocks production-locked quotes until KYB and pricing are complete', () => {
    expect(() => assertLicensedQuoteEligibility(true, incomplete)).toThrow(OnboardingIncompleteError);
    expect(() => assertLicensedQuoteEligibility(true, null)).toThrow(OnboardingIncompleteError);
  });

  it('allows production-locked quotes only when eligible', () => {
    expect(() => assertLicensedQuoteEligibility(true, complete)).not.toThrow();
  });
});
