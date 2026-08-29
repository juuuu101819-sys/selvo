import type { RoutingOverrideRecord, RoutingOverrideStore } from '@meridian/core';

/**
 * In-process operator kill-switch rows. Released rows stay so audit history is reconstructable.
 */
export class InMemoryRoutingOverrideStore implements RoutingOverrideStore {
  private readonly byId = new Map<string, RoutingOverrideRecord>();

  listActive(): Promise<readonly RoutingOverrideRecord[]> {
    return Promise.resolve(
      [...this.byId.values()]
        .filter((row) => row.releasedAt === null)
        .sort((left, right) => left.targetKey.localeCompare(right.targetKey, 'en'))
        .map((row) => structuredClone(row)),
    );
  }

  engage(record: RoutingOverrideRecord): Promise<RoutingOverrideRecord> {
    const active = [...this.byId.values()].find(
      (row) => row.targetKey === record.targetKey && row.releasedAt === null,
    );
    if (active !== undefined) {
      const updated: RoutingOverrideRecord = {
        ...active,
        reason: record.reason,
        engagedAt: record.engagedAt,
        engagedByActor: record.engagedByActor,
        providerId: record.providerId,
        sourceAsset: record.sourceAsset,
        targetAsset: record.targetAsset,
        kind: record.kind,
      };
      this.byId.set(active.id, updated);
      return Promise.resolve(structuredClone(updated));
    }
    this.byId.set(record.id, structuredClone(record));
    return Promise.resolve(structuredClone(record));
  }

  release(input: {
    readonly targetKey: string;
    readonly releasedAt: string;
    readonly releasedByActor: string;
    readonly releaseReason: string;
  }): Promise<RoutingOverrideRecord | null> {
    const active = [...this.byId.values()].find(
      (row) => row.targetKey === input.targetKey && row.releasedAt === null,
    );
    if (active === undefined) {
      return Promise.resolve(null);
    }
    const updated: RoutingOverrideRecord = {
      ...active,
      releasedAt: input.releasedAt,
      releasedByActor: input.releasedByActor,
      releaseReason: input.releaseReason,
    };
    this.byId.set(active.id, updated);
    return Promise.resolve(structuredClone(updated));
  }
}
