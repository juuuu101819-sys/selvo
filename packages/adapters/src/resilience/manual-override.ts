import type { RoutingOverrideRecord } from '@meridian/core';

/**
 * In-process view of operator kill-switch rows.
 *
 * Hydrated from {@link RoutingOverrideStore} at process start. Engage/release update this map
 * and the store together. Unlike {@link ProviderCircuitBreaker}, there is no cooldown and no
 * half-open probe — an override stays engaged until an operator releases it.
 */
export class ManualOverrideRegistry {
  private readonly active = new Map<string, RoutingOverrideRecord>();

  hydrate(records: readonly RoutingOverrideRecord[]): void {
    this.active.clear();
    for (const record of records) {
      if (record.releasedAt === null) {
        this.active.set(record.targetKey, record);
      }
    }
  }

  engage(record: RoutingOverrideRecord): void {
    this.active.set(record.targetKey, record);
  }

  release(targetKey: string): void {
    this.active.delete(targetKey);
  }

  isProviderExcluded(
    providerId: string,
    request: { readonly sourceAsset: string; readonly targetAsset: string },
  ): boolean {
    if (this.active.has(`provider:${providerId}`)) {
      return true;
    }
    const corridorKey = `corridor:${request.sourceAsset.toUpperCase()}|${request.targetAsset.toUpperCase()}`;
    return this.active.has(corridorKey);
  }

  snapshot(): readonly RoutingOverrideRecord[] {
    return [...this.active.values()].sort((left, right) =>
      left.targetKey.localeCompare(right.targetKey, 'en'),
    );
  }
}
