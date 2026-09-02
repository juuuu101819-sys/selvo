import { regionsForCorridor, type RoutingOverrideRecord } from '@meridian/core';

/**
 * In-process view of operator kill-switch rows.
 *
 * Hydrated from {@link RoutingOverrideStore} at process start. Engage/release update this map
 * and the store together. Unlike {@link ProviderCircuitBreaker}, there is no cooldown and no
 * half-open probe — an override stays engaged until an operator releases it.
 *
 * Region keys (`region:KR`) fail-close every corridor that touches that licensing region.
 * See `GO_LIVE_CHECKLIST.md`.
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

  isRegionEngaged(region: string): boolean {
    return this.active.has(`region:${region.trim().toUpperCase()}`);
  }

  engagedRegions(): readonly string[] {
    return [...this.active.values()]
      .filter((row) => row.kind === 'region' && row.region !== null)
      .map((row) => row.region as string)
      .sort();
  }

  isProviderExcluded(
    providerId: string,
    request: { readonly sourceAsset: string; readonly targetAsset: string },
  ): boolean {
    if (this.active.has(`provider:${providerId}`)) {
      return true;
    }
    const corridorKey = `corridor:${request.sourceAsset.toUpperCase()}|${request.targetAsset.toUpperCase()}`;
    if (this.active.has(corridorKey)) {
      return true;
    }
    return regionsForCorridor(request.sourceAsset, request.targetAsset).some((region) =>
      this.isRegionEngaged(region),
    );
  }

  snapshot(): readonly RoutingOverrideRecord[] {
    return [...this.active.values()].sort((left, right) =>
      left.targetKey.localeCompare(right.targetKey, 'en'),
    );
  }
}
