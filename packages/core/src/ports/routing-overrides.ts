/**
 * Operator-engaged ranking exclusions (PHASE 38).
 *
 * Distinct from the automatic quote circuit breaker: these do not half-open after a cooldown.
 * They remain engaged until an operator releases them. Persistence survives process restart.
 * Exclusion still happens through `supportsNormalized === false`, the same choke point as PA-L04.
 */

export const ROUTING_OVERRIDE_KINDS = ['provider', 'corridor', 'region'] as const;
export type RoutingOverrideKind = (typeof ROUTING_OVERRIDE_KINDS)[number];

export type RoutingOverrideTarget =
  | { readonly kind: 'provider'; readonly providerId: string }
  | { readonly kind: 'corridor'; readonly sourceAsset: string; readonly targetAsset: string }
  | { readonly kind: 'region'; readonly region: string };

export interface RoutingOverrideRecord {
  readonly id: string;
  readonly targetKey: string;
  readonly kind: RoutingOverrideKind;
  readonly providerId: string | null;
  readonly sourceAsset: string | null;
  readonly targetAsset: string | null;
  readonly region: string | null;
  readonly reason: string;
  readonly engagedAt: string;
  readonly engagedByActor: string;
  readonly releasedAt: string | null;
  readonly releasedByActor: string | null;
  readonly releaseReason: string | null;
}

export function routingOverrideTargetKey(target: RoutingOverrideTarget): string {
  if (target.kind === 'provider') {
    return `provider:${target.providerId.trim()}`;
  }
  if (target.kind === 'region') {
    return `region:${target.region.trim().toUpperCase()}`;
  }
  return `corridor:${target.sourceAsset.trim().toUpperCase()}|${target.targetAsset.trim().toUpperCase()}`;
}

export interface RoutingOverrideStore {
  listActive(): Promise<readonly RoutingOverrideRecord[]>;
  engage(record: RoutingOverrideRecord): Promise<RoutingOverrideRecord>;
  release(input: {
    readonly targetKey: string;
    readonly releasedAt: string;
    readonly releasedByActor: string;
    readonly releaseReason: string;
  }): Promise<RoutingOverrideRecord | null>;
}
