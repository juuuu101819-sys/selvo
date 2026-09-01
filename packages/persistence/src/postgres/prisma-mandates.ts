import {
  PersistenceError,
  isMandateFormat,
  isMandateStatus,
  type MandateCorridor,
  type MandateScope,
  type MandateStore,
  type StoredMandate,
  type X402Challenge,
} from '@meridian/core';
import { Prisma, type PrismaClient } from '@prisma/client';

export class PrismaMandateStore implements MandateStore {
  constructor(private readonly client: PrismaClient) {}

  async save(row: StoredMandate): Promise<StoredMandate> {
    try {
      const stored = await this.client.mandate.create({ data: toData(row) });
      return fromRow(stored);
    } catch (error) {
      throw new PersistenceError('Failed to store mandate.', {}, { cause: error });
    }
  }

  async findById(id: string, organizationId: string): Promise<StoredMandate | null> {
    try {
      const row = await this.client.mandate.findFirst({ where: { id, organizationId } });
      return row === null ? null : fromRow(row);
    } catch (error) {
      throw new PersistenceError('Failed to load mandate.', {}, { cause: error });
    }
  }

  async listVerified(
    organizationId: string,
    agentId: string,
    nowIso: string,
  ): Promise<readonly StoredMandate[]> {
    try {
      const rows = await this.client.mandate.findMany({
        where: {
          organizationId,
          agentId,
          status: 'verified',
          expiresAt: { gt: new Date(nowIso) },
        },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(fromRow);
    } catch (error) {
      throw new PersistenceError('Failed to list mandates.', {}, { cause: error });
    }
  }

  async revoke(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly actor: string;
    readonly nowIso: string;
  }): Promise<StoredMandate | null> {
    try {
      const existing = await this.client.mandate.findFirst({
        where: { id: input.id, organizationId: input.organizationId },
      });
      if (existing === null) {
        return null;
      }
      if (existing.status === 'revoked') {
        return fromRow(existing);
      }
      const row = await this.client.mandate.update({
        where: { id: existing.id },
        data: {
          status: 'revoked',
          revokedAt: new Date(input.nowIso),
          revokedByActor: input.actor,
        },
      });
      return fromRow(row);
    } catch (error) {
      throw new PersistenceError('Failed to revoke mandate.', {}, { cause: error });
    }
  }

  async saveChallenge(challenge: X402Challenge): Promise<X402Challenge> {
    try {
      const row = await this.client.mandateX402Challenge.create({
        data: {
          id: challenge.id,
          organizationId: challenge.organizationId,
          agentId: challenge.agentId,
          nonce: challenge.nonce,
          scope: challenge.scope as unknown as Prisma.InputJsonValue,
          expiresAt: new Date(challenge.expiresAt),
          createdAt: new Date(challenge.createdAt),
        },
      });
      return fromChallenge(row);
    } catch (error) {
      throw new PersistenceError('Failed to store x402 challenge.', {}, { cause: error });
    }
  }

  async findChallenge(id: string, organizationId: string): Promise<X402Challenge | null> {
    try {
      const row = await this.client.mandateX402Challenge.findFirst({
        where: { id, organizationId },
      });
      return row === null ? null : fromChallenge(row);
    } catch (error) {
      throw new PersistenceError('Failed to load x402 challenge.', {}, { cause: error });
    }
  }

  async deleteChallenge(id: string, organizationId: string): Promise<void> {
    try {
      await this.client.mandateX402Challenge.deleteMany({ where: { id, organizationId } });
    } catch (error) {
      throw new PersistenceError('Failed to delete x402 challenge.', {}, { cause: error });
    }
  }
}

function toData(row: StoredMandate): Prisma.MandateUncheckedCreateInput {
  return {
    id: row.id,
    organizationId: row.organizationId,
    agentId: row.agentId,
    format: row.format,
    status: row.status,
    spendCapMinorUnits: new Prisma.Decimal(row.scope.spendCapMinorUnits),
    spendCapAsset: row.scope.spendCapAsset,
    allowedCorridors: row.scope.allowedCorridors as unknown as Prisma.InputJsonValue,
    allowedCurrencies: [...row.scope.allowedCurrencies],
    allowedBeneficiaries: [...row.scope.allowedBeneficiaries],
    issuer: row.issuer,
    expiresAt: new Date(row.expiresAt),
    payloadHash: row.payloadHash,
    payload: row.payload,
    boundCredentialPrefix: row.boundCredentialPrefix,
    verifiedAt: new Date(row.verifiedAt),
    revokedAt: row.revokedAt === null ? null : new Date(row.revokedAt),
    revokedByActor: row.revokedByActor,
    createdAt: new Date(row.createdAt),
  };
}

function fromRow(row: {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly format: string;
  readonly status: string;
  readonly spendCapMinorUnits: Prisma.Decimal;
  readonly spendCapAsset: string;
  readonly allowedCorridors: Prisma.JsonValue;
  readonly allowedCurrencies: string[];
  readonly allowedBeneficiaries: string[];
  readonly issuer: string;
  readonly expiresAt: Date;
  readonly payloadHash: string;
  readonly payload: Prisma.JsonValue;
  readonly boundCredentialPrefix: string | null;
  readonly verifiedAt: Date;
  readonly revokedAt: Date | null;
  readonly revokedByActor: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}): StoredMandate {
  if (!isMandateFormat(row.format) || !isMandateStatus(row.status)) {
    throw new PersistenceError('Stored mandate has an unknown format or status.', {
      format: row.format,
      status: row.status,
    });
  }
  const payload = row.payload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new PersistenceError('Stored mandate payload is not a JSON object.', {});
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    agentId: row.agentId,
    format: row.format,
    status: row.status,
    scope: {
      spendCapMinorUnits: row.spendCapMinorUnits.toFixed(0),
      spendCapAsset: row.spendCapAsset,
      allowedCorridors: parseCorridors(row.allowedCorridors),
      allowedCurrencies: row.allowedCurrencies,
      allowedBeneficiaries: row.allowedBeneficiaries,
    },
    issuer: row.issuer,
    expiresAt: row.expiresAt.toISOString(),
    payloadHash: row.payloadHash,
    payload: payload as StoredMandate['payload'],
    boundCredentialPrefix: row.boundCredentialPrefix,
    verifiedAt: row.verifiedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedByActor: row.revokedByActor,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseCorridors(value: Prisma.JsonValue): readonly MandateCorridor[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const corridors: MandateCorridor[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const source = entry['source'];
    const destination = entry['destination'];
    if (typeof source === 'string' && typeof destination === 'string') {
      corridors.push({ source, destination });
    }
  }
  return corridors;
}

function fromChallenge(row: {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly nonce: string;
  readonly scope: Prisma.JsonValue;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}): X402Challenge {
  return {
    id: row.id,
    organizationId: row.organizationId,
    agentId: row.agentId,
    nonce: row.nonce,
    scope: row.scope as unknown as MandateScope,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
