import type { ProviderCapabilityProfile } from '../domain/provider-catalog.js';
import type { FinancialProviderRegistry } from './financial-registry.js';
import type { PlatformPricingRule } from '../domain/platform-pricing.js';
import type { ProviderDescriptor } from '../domain/provider.js';
import type { PlatformMode } from '../domain/provider.js';
import type { ProviderFailure } from '../domain/route.js';
import type { RailType } from '../domain/rail.js';
import type { NormalizedQuote } from '../ports/financial-provider.js';
import { ROUTING_ENGINE_VERSION, type SerializedRoutingWeights } from './routing-config.js';
import type { MultiRailRouting, RoutingRequest } from './routing-types.js';

export const ROUTING_COMPARISON_SNAPSHOT_KIND = 'multi_rail' as const;
export const ROUTING_COMPARISON_SNAPSHOT_VERSION = 1 as const;

/**
 * Everything needed to re-price and re-rank a `/comparisons` document produced by MultiRailRouter.
 *
 * Quotes are stored as received. Replay runs {@link MultiRailCostEngine} + {@link MultiRailScorer}
 * and never calls {@link RouteComparisonService}.
 */
export interface RoutingComparisonSnapshot {
  readonly snapshotKind: typeof ROUTING_COMPARISON_SNAPSHOT_KIND;
  readonly snapshotVersion: typeof ROUTING_COMPARISON_SNAPSHOT_VERSION;
  readonly engineVersion: typeof ROUTING_ENGINE_VERSION;
  readonly mode: PlatformMode;
  readonly organizationId: string | null;
  readonly routingId: string;
  readonly request: RoutingRequest & { readonly rails: readonly RailType[] | null };
  readonly pricingRules: readonly PlatformPricingRule[];
  readonly weights: SerializedRoutingWeights;
  readonly quotes: readonly NormalizedQuote[];
  readonly providers: readonly ProviderDescriptor[];
  readonly capabilities: Readonly<Record<string, ProviderCapabilityProfile>>;
  readonly providerFailures: readonly ProviderFailure[];
}

export function isRoutingComparisonSnapshot(value: unknown): value is RoutingComparisonSnapshot {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as { readonly snapshotKind?: unknown; readonly engineVersion?: unknown };
  return (
    record.snapshotKind === ROUTING_COMPARISON_SNAPSHOT_KIND &&
    record.engineVersion === ROUTING_ENGINE_VERSION
  );
}

export function snapshotFromRouting(
  routing: MultiRailRouting,
  rails: readonly RailType[] | null,
  pricingRules: readonly PlatformPricingRule[],
  capabilities: Readonly<Record<string, ProviderCapabilityProfile>>,
): RoutingComparisonSnapshot {
  const providers = sortById(
    routing.routes.map((route) => route.provider),
    (provider) => provider.id,
  );
  const quotes = sortById(
    routing.routes.map((route) => route.quote),
    (quote) => quote.providerId,
  );
  return {
    snapshotKind: ROUTING_COMPARISON_SNAPSHOT_KIND,
    snapshotVersion: ROUTING_COMPARISON_SNAPSHOT_VERSION,
    engineVersion: ROUTING_ENGINE_VERSION,
    mode: routing.mode,
    organizationId: routing.organizationId,
    routingId: routing.routingId,
    request: {
      sourceAsset: routing.request.sourceAsset,
      destinationAsset: routing.request.destinationAsset,
      amountMinorUnits: routing.request.amountMinorUnits,
      requestedAt: routing.request.requestedAt,
      rails,
    },
    pricingRules,
    weights: routing.scoringWeights,
    quotes,
    providers,
    capabilities,
    providerFailures: routing.providerFailures,
  };
}

function sortById<T>(items: readonly T[], key: (item: T) => string): readonly T[] {
  return [...items].sort((left, right) => key(left).localeCompare(key(right), 'en'));
}

/** Capability profiles as they were at ranking time. Live registry first; route metadata as fallback. */
export function capabilitiesFromRouting(
  routing: MultiRailRouting,
  registry: FinancialProviderRegistry,
): Readonly<Record<string, ProviderCapabilityProfile>> {
  const capabilities: Record<string, ProviderCapabilityProfile> = {};
  for (const route of routing.routes) {
    const live = registry.get(route.provider.id);
    capabilities[route.provider.id] =
      live?.getCapabilities() ?? {
        category: route.category,
        features: [],
        conversionKinds: [route.conversionKind],
        rails: [route.rail],
      };
  }
  return capabilities;
}

/**
 * Canonical fingerprint input. `routingId` is a per-request identity, not part of the calculation.
 */
export function fingerprintableRoutingSnapshot(
  snapshot: RoutingComparisonSnapshot,
): Omit<RoutingComparisonSnapshot, 'routingId'> {
  return {
    snapshotKind: snapshot.snapshotKind,
    snapshotVersion: snapshot.snapshotVersion,
    engineVersion: snapshot.engineVersion,
    mode: snapshot.mode,
    organizationId: snapshot.organizationId,
    request: snapshot.request,
    pricingRules: snapshot.pricingRules,
    weights: snapshot.weights,
    quotes: snapshot.quotes,
    providers: snapshot.providers,
    capabilities: snapshot.capabilities,
    providerFailures: snapshot.providerFailures,
  };
}
