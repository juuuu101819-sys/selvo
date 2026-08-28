import {
  PersistenceError,
  buildOnboardingSnapshot,
  type CreateOrganizationInviteInput,
  type InsertNegotiatedPricingInput,
  type KybStatus,
  type OnboardingSnapshot,
  type OnboardingStore,
  type OrganizationInviteRecord,
  type OrganizationRole,
} from '@meridian/core';
import type { PrismaClient } from '@prisma/client';

export class PrismaOnboardingStore implements OnboardingStore {
  constructor(private readonly client: PrismaClient) {}

  async createInvite(input: CreateOrganizationInviteInput): Promise<void> {
    try {
      await this.client.organizationInvite.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          email: input.email,
          role: input.role,
          tokenHash: input.tokenHash,
          tokenPrefix: input.tokenPrefix,
          expiresAt: new Date(input.expiresAt),
          createdByActor: input.createdByActor,
        },
      });
    } catch (error) {
      throw new PersistenceError('Failed to create an organization invite.', {}, { cause: error });
    }
  }

  async findValidInviteByTokenHash(
    tokenHash: string,
    nowIso: string,
  ): Promise<OrganizationInviteRecord | null> {
    const row = await this.client.organizationInvite.findUnique({ where: { tokenHash } });
    if (row === null || row.acceptedAt !== null || row.expiresAt.toISOString() <= nowIso) {
      return null;
    }
    return toInvite(row);
  }

  async markInviteAccepted(id: string, nowIso: string): Promise<boolean> {
    const result = await this.client.organizationInvite.updateMany({
      where: { id, acceptedAt: null },
      data: { acceptedAt: new Date(nowIso) },
    });
    return result.count > 0;
  }

  async submitKyb(
    organizationId: string,
    nowIso: string,
  ): Promise<{ readonly previous: KybStatus; readonly next: KybStatus } | null> {
    const org = await this.client.organization.findUnique({ where: { id: organizationId } });
    if (org === null) {
      return null;
    }
    if (org.kybStatus !== 'unverified') {
      throw new PersistenceError('KYB can only be submitted from unverified.', {
        kybStatus: org.kybStatus,
      });
    }
    const result = await this.client.organization.updateMany({
      where: { id: organizationId, kybStatus: 'unverified' },
      data: { kybStatus: 'pending', kybReason: null, kybReviewedAt: new Date(nowIso) },
    });
    if (result.count === 0) {
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
    const result = await this.client.organization.updateMany({
      where: { id: input.organizationId },
      data: {
        kybStatus: input.status,
        kybReason: input.reason,
        kybReviewedAt: new Date(input.nowIso),
        kybReviewedByActor: input.actor,
      },
    });
    return result.count > 0 ? input.status : null;
  }

  async hasActivePricing(organizationId: string, atIso: string): Promise<boolean> {
    const at = new Date(atIso);
    const count = await this.client.customerPricing.count({
      where: {
        organizationId,
        status: 'active',
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
    });
    return count > 0;
  }

  async insertNegotiatedPricing(input: InsertNegotiatedPricingInput): Promise<void> {
    try {
      await this.client.customerPricing.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          markupBps: input.markupBps,
          discountBps: input.discountBps,
          platformFeeMinorUnits: input.platformFeeMinorUnits,
          feeCurrency: input.feeCurrency,
          sourceCurrency: input.sourceCurrency,
          targetCurrency: input.targetCurrency,
          rail: input.rail === null ? null : (input.rail as never),
          notes: input.notes,
          priority: 0,
          status: 'active',
          effectiveFrom: new Date(input.effectiveFrom),
        },
      });
    } catch (error) {
      throw new PersistenceError('Failed to insert negotiated customer pricing.', {}, { cause: error });
    }
  }

  async snapshot(
    organizationId: string,
    atIso: string,
    licensedProviderConfigured: boolean,
  ): Promise<OnboardingSnapshot | null> {
    const org = await this.client.organization.findUnique({ where: { id: organizationId } });
    if (org === null) {
      return null;
    }
    const [pricingConfigured, keyCount] = await Promise.all([
      this.hasActivePricing(organizationId, atIso),
      this.client.apiKey.count({
        where: { organizationId, revokedAt: null },
      }),
    ]);
    return buildOnboardingSnapshot({
      organizationId,
      kybStatus: org.kybStatus,
      kybReason: org.kybReason,
      kybReviewedAt: org.kybReviewedAt?.toISOString() ?? null,
      pricingConfigured,
      apiKeyIssued: keyCount > 0,
      licensedProviderConfigured,
    });
  }
}

function toInvite(row: {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
  tokenHash: string;
  tokenPrefix: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdByActor: string;
}): OrganizationInviteRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    role: row.role,
    tokenHash: row.tokenHash,
    tokenPrefix: row.tokenPrefix,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    createdByActor: row.createdByActor,
  };
}
