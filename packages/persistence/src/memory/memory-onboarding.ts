import {
  PersistenceError,
  buildOnboardingSnapshot,
  type CreateOrganizationInviteInput,
  type IdentityStore,
  type InsertNegotiatedPricingInput,
  type KybStatus,
  type OnboardingSnapshot,
  type OnboardingStore,
  type OrganizationInviteRecord,
} from '@meridian/core';

interface StoredPricing {
  readonly organizationId: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

/**
 * In-process onboarding store. KYB state lives on {@link IdentityStore} organization rows.
 */
export class InMemoryOnboardingStore implements OnboardingStore {
  private readonly invitesByHash = new Map<string, OrganizationInviteRecord>();
  private readonly pricing: StoredPricing[] = [];

  constructor(private readonly identity: IdentityStore) {}

  createInvite(input: CreateOrganizationInviteInput): Promise<void> {
    this.invitesByHash.set(input.tokenHash, {
      id: input.id,
      organizationId: input.organizationId,
      email: input.email,
      role: input.role,
      tokenHash: input.tokenHash,
      tokenPrefix: input.tokenPrefix,
      expiresAt: input.expiresAt,
      acceptedAt: null,
      createdByActor: input.createdByActor,
    });
    return Promise.resolve();
  }

  findValidInviteByTokenHash(
    tokenHash: string,
    nowIso: string,
  ): Promise<OrganizationInviteRecord | null> {
    const invite = this.invitesByHash.get(tokenHash);
    if (invite === undefined || invite.acceptedAt !== null || invite.expiresAt <= nowIso) {
      return Promise.resolve(null);
    }
    return Promise.resolve(structuredClone(invite));
  }

  markInviteAccepted(id: string, nowIso: string): Promise<boolean> {
    for (const [hash, invite] of this.invitesByHash) {
      if (invite.id === id && invite.acceptedAt === null) {
        this.invitesByHash.set(hash, { ...invite, acceptedAt: nowIso });
        return Promise.resolve(true);
      }
    }
    return Promise.resolve(false);
  }

  async submitKyb(
    organizationId: string,
    nowIso: string,
  ): Promise<{ readonly previous: KybStatus; readonly next: KybStatus } | null> {
    const org = await this.identity.findOrganization(organizationId);
    if (org === null) {
      return null;
    }
    if (org.kybStatus !== 'unverified') {
      throw new PersistenceError('KYB can only be submitted from unverified.', {
        kybStatus: org.kybStatus,
      });
    }
    const updated = await this.identity.updateOrganizationKyb(organizationId, {
      kybStatus: 'pending',
      kybReason: null,
      kybReviewedAt: nowIso,
      kybReviewedByActor: null,
    });
    if (!updated) {
      return null;
    }
    return { previous: 'unverified', next: 'pending' };
  }

  async reviewKyb(input: {
    readonly organizationId: string;
    readonly status: Extract<KybStatus, 'verified' | 'rejected'>;
    readonly reason: string;
    readonly actor: string;
    readonly nowIso: string;
  }): Promise<KybStatus | null> {
    const org = await this.identity.findOrganization(input.organizationId);
    if (org === null) {
      return null;
    }
    const updated = await this.identity.updateOrganizationKyb(input.organizationId, {
      kybStatus: input.status,
      kybReason: input.reason,
      kybReviewedAt: input.nowIso,
      kybReviewedByActor: input.actor,
    });
    return updated ? input.status : null;
  }

  hasActivePricing(organizationId: string, atIso: string): Promise<boolean> {
    const found = this.pricing.some(
      (row) =>
        row.organizationId === organizationId &&
        row.effectiveFrom <= atIso &&
        (row.effectiveTo === null || row.effectiveTo > atIso),
    );
    return Promise.resolve(found);
  }

  insertNegotiatedPricing(input: InsertNegotiatedPricingInput): Promise<void> {
    this.pricing.push({
      organizationId: input.organizationId,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
    });
    return Promise.resolve();
  }

  async snapshot(
    organizationId: string,
    atIso: string,
    licensedProviderConfigured: boolean,
  ): Promise<OnboardingSnapshot | null> {
    const org = await this.identity.findOrganization(organizationId);
    if (org === null) {
      return null;
    }
    const apiKeys = await this.identity.listApiKeys(organizationId);
    const apiKeyIssued = apiKeys.some((key) => key.revokedAt === null);
    const pricingConfigured = await this.hasActivePricing(organizationId, atIso);
    return buildOnboardingSnapshot({
      organizationId,
      kybStatus: org.kybStatus,
      kybReason: org.kybReason,
      kybReviewedAt: org.kybReviewedAt,
      pricingConfigured,
      apiKeyIssued,
      licensedProviderConfigured,
    });
  }
}
