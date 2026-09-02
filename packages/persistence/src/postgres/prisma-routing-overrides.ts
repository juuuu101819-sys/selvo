import { PersistenceError, type RoutingOverrideRecord, type RoutingOverrideStore } from '@meridian/core';
import type { PrismaClient } from '@prisma/client';

export class PrismaRoutingOverrideStore implements RoutingOverrideStore {
  constructor(private readonly client: PrismaClient) {}

  async listActive(): Promise<readonly RoutingOverrideRecord[]> {
    try {
      const rows = await this.client.routingManualOverride.findMany({
        where: { releasedAt: null },
        orderBy: { targetKey: 'asc' },
      });
      return rows.map(toRecord);
    } catch (error) {
      throw new PersistenceError('Failed to list routing overrides.', {}, { cause: error });
    }
  }

  async engage(record: RoutingOverrideRecord): Promise<RoutingOverrideRecord> {
    try {
      const active = await this.client.routingManualOverride.findFirst({
        where: { targetKey: record.targetKey, releasedAt: null },
      });
      if (active !== null) {
        const updated = await this.client.routingManualOverride.update({
          where: { id: active.id },
          data: {
            kind: record.kind,
            providerId: record.providerId,
            sourceAsset: record.sourceAsset,
            targetAsset: record.targetAsset,
            region: record.region,
            reason: record.reason,
            engagedAt: new Date(record.engagedAt),
            engagedByActor: record.engagedByActor,
          },
        });
        return toRecord(updated);
      }
      const created = await this.client.routingManualOverride.create({
        data: {
          id: record.id,
          targetKey: record.targetKey,
          kind: record.kind,
          providerId: record.providerId,
          sourceAsset: record.sourceAsset,
          targetAsset: record.targetAsset,
          region: record.region,
          reason: record.reason,
          engagedAt: new Date(record.engagedAt),
          engagedByActor: record.engagedByActor,
        },
      });
      return toRecord(created);
    } catch (error) {
      throw new PersistenceError('Failed to engage routing override.', {}, { cause: error });
    }
  }

  async release(input: {
    readonly targetKey: string;
    readonly releasedAt: string;
    readonly releasedByActor: string;
    readonly releaseReason: string;
  }): Promise<RoutingOverrideRecord | null> {
    try {
      const active = await this.client.routingManualOverride.findFirst({
        where: { targetKey: input.targetKey, releasedAt: null },
      });
      if (active === null) {
        return null;
      }
      const updated = await this.client.routingManualOverride.update({
        where: { id: active.id },
        data: {
          releasedAt: new Date(input.releasedAt),
          releasedByActor: input.releasedByActor,
          releaseReason: input.releaseReason,
        },
      });
      return toRecord(updated);
    } catch (error) {
      throw new PersistenceError('Failed to release routing override.', {}, { cause: error });
    }
  }
}

function toRecord(row: {
  id: string;
  targetKey: string;
  kind: string;
  providerId: string | null;
  sourceAsset: string | null;
  targetAsset: string | null;
  region: string | null;
  reason: string;
  engagedAt: Date;
  engagedByActor: string;
  releasedAt: Date | null;
  releasedByActor: string | null;
  releaseReason: string | null;
}): RoutingOverrideRecord {
  const kind = row.kind === 'corridor' ? 'corridor' : row.kind === 'region' ? 'region' : 'provider';
  return {
    id: row.id,
    targetKey: row.targetKey,
    kind,
    providerId: row.providerId,
    sourceAsset: row.sourceAsset,
    targetAsset: row.targetAsset,
    region: row.region,
    reason: row.reason,
    engagedAt: row.engagedAt.toISOString(),
    engagedByActor: row.engagedByActor,
    releasedAt: row.releasedAt?.toISOString() ?? null,
    releasedByActor: row.releasedByActor,
    releaseReason: row.releaseReason,
  };
}
