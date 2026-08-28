import { OnboardingIncompleteError, type OnboardingSnapshot } from '@meridian/core';

/**
 * Licensed-provider quotes (and any future real execution) require completed onboarding.
 * Sandbox exploration is intentionally not gated.
 */
export function assertLicensedQuoteEligibility(
  productionLocked: boolean,
  snapshot: OnboardingSnapshot | null,
): void {
  if (!productionLocked) {
    return;
  }
  if (snapshot !== null && snapshot.realTransactionEligible) {
    return;
  }
  throw new OnboardingIncompleteError({
    kybStatus: snapshot?.kybStatus ?? 'unverified',
    pricingConfigured: snapshot?.pricingConfigured ?? false,
    kybVendor: 'manual_review',
    executionImplemented: false,
  });
}
