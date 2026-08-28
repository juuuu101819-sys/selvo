import type { KybStatus, OnboardingSnapshot } from '../domain/onboarding.js';
import type { OrganizationRole } from './identity.js';

export interface OrganizationInviteRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: OrganizationRole;
  readonly tokenHash: string;
  readonly tokenPrefix: string;
  readonly expiresAt: string;
  readonly acceptedAt: string | null;
  readonly createdByActor: string;
}

export interface CreateOrganizationInviteInput {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: OrganizationRole;
  readonly tokenHash: string;
  readonly tokenPrefix: string;
  readonly expiresAt: string;
  readonly createdByActor: string;
}

export interface InsertNegotiatedPricingInput {
  readonly id: string;
  readonly organizationId: string;
  readonly markupBps: string;
  readonly discountBps: string;
  readonly platformFeeMinorUnits: string;
  readonly feeCurrency: string | null;
  readonly sourceCurrency: string | null;
  readonly targetCurrency: string | null;
  readonly rail: string | null;
  readonly notes: string | null;
  readonly effectiveFrom: string;
}

export interface OnboardingStore {
  createInvite(input: CreateOrganizationInviteInput): Promise<void>;
  findValidInviteByTokenHash(
    tokenHash: string,
    nowIso: string,
  ): Promise<OrganizationInviteRecord | null>;
  markInviteAccepted(id: string, nowIso: string): Promise<boolean>;
  submitKyb(
    organizationId: string,
    nowIso: string,
  ): Promise<{ readonly previous: KybStatus; readonly next: KybStatus } | null>;
  reviewKyb(input: {
    readonly organizationId: string;
    readonly status: Extract<KybStatus, 'verified' | 'rejected'>;
    readonly reason: string;
    readonly actor: string;
    readonly nowIso: string;
  }): Promise<KybStatus | null>;
  hasActivePricing(organizationId: string, atIso: string): Promise<boolean>;
  insertNegotiatedPricing(input: InsertNegotiatedPricingInput): Promise<void>;
  snapshot(
    organizationId: string,
    atIso: string,
    licensedProviderConfigured: boolean,
  ): Promise<OnboardingSnapshot | null>;
}
