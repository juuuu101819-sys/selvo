/**
 * B2B onboarding eligibility (PHASE 31).
 *
 * Sales-assisted / invite-only until a self-service decision exists. KYB is a pluggable
 * fail-closed gate: unverified and rejected organizations may explore sandbox quotes and must not
 * be treated as eligible for licensed-provider quotes or any future real execution. Pricing is the
 * existing {@link CustomerPricing} / {@link PlatformPricingRule} negotiated-rule model — there is
 * no silent platform default rate.
 */

export const KYB_STATUSES = ['unverified', 'pending', 'verified', 'rejected'] as const;
export type KybStatus = (typeof KYB_STATUSES)[number];

export const ONBOARDING_MODE = 'sales_assisted_invite_only' as const;
export const KYB_VENDOR_ID = 'manual_review' as const;
export const PRICING_MODEL = 'negotiated_customer_pricing_rules' as const;

export const ONBOARDING_STEPS = ['organization', 'kyb', 'pricing', 'api_key'] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

export function isKybStatus(value: unknown): value is KybStatus {
  return typeof value === 'string' && (KYB_STATUSES as readonly string[]).includes(value);
}

export function isKybVerified(status: KybStatus): boolean {
  return status === 'verified';
}

/**
 * Licensed quotes and any future real execution require both a verified KYB decision and at least
 * one explicit, in-force CustomerPricing row. Zero take-rate is allowed only when that row exists
 * (an agreed zero, not a missing configuration).
 */
export function isRealTransactionEligible(input: {
  readonly kybStatus: KybStatus;
  readonly pricingConfigured: boolean;
}): boolean {
  return isKybVerified(input.kybStatus) && input.pricingConfigured;
}

export interface OnboardingStep {
  readonly id: OnboardingStepId;
  readonly label: string;
  readonly complete: boolean;
  readonly status: string;
}

export interface OnboardingSnapshot {
  readonly mode: typeof ONBOARDING_MODE;
  readonly kybVendor: typeof KYB_VENDOR_ID;
  readonly pricingModel: typeof PRICING_MODEL;
  readonly organizationId: string;
  readonly organizationCreated: true;
  readonly kybStatus: KybStatus;
  readonly kybReason: string | null;
  readonly kybReviewedAt: string | null;
  readonly pricingConfigured: boolean;
  readonly apiKeyIssued: boolean;
  readonly realTransactionEligible: boolean;
  readonly licensedProviderConfigured: boolean;
  readonly steps: readonly OnboardingStep[];
}

export function buildOnboardingSnapshot(input: {
  readonly organizationId: string;
  readonly kybStatus: KybStatus;
  readonly kybReason: string | null;
  readonly kybReviewedAt: string | null;
  readonly pricingConfigured: boolean;
  readonly apiKeyIssued: boolean;
  readonly licensedProviderConfigured: boolean;
}): OnboardingSnapshot {
  const realTransactionEligible = isRealTransactionEligible(input);
  return {
    mode: ONBOARDING_MODE,
    kybVendor: KYB_VENDOR_ID,
    pricingModel: PRICING_MODEL,
    organizationId: input.organizationId,
    organizationCreated: true,
    kybStatus: input.kybStatus,
    kybReason: input.kybReason,
    kybReviewedAt: input.kybReviewedAt,
    pricingConfigured: input.pricingConfigured,
    apiKeyIssued: input.apiKeyIssued,
    realTransactionEligible,
    licensedProviderConfigured: input.licensedProviderConfigured,
    steps: [
      {
        id: 'organization',
        label: 'Organization created',
        complete: true,
        status: 'complete',
      },
      {
        id: 'kyb',
        label: 'Know-your-business review',
        complete: input.kybStatus === 'verified',
        status: input.kybStatus,
      },
      {
        id: 'pricing',
        label: 'Contracted platform pricing',
        complete: input.pricingConfigured,
        status: input.pricingConfigured ? 'configured' : 'missing',
      },
      {
        id: 'api_key',
        label: 'Organization API key issued',
        complete: input.apiKeyIssued,
        status: input.apiKeyIssued ? 'issued' : 'none',
      },
    ],
  };
}

export const DEFAULT_KYB: {
  readonly kybStatus: 'unverified';
  readonly kybReason: null;
  readonly kybReviewedAt: null;
  readonly kybReviewedByActor: null;
} = {
  kybStatus: 'unverified',
  kybReason: null,
  kybReviewedAt: null,
  kybReviewedByActor: null,
};
