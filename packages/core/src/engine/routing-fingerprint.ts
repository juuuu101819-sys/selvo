import { ROUTING_ENGINE_VERSION } from './routing-config.js';
import {
  capabilitiesFromRouting,
  fingerprintableRoutingSnapshot,
  snapshotFromRouting,
  type RoutingComparisonSnapshot,
} from './routing-snapshot.js';
import type { FinancialProviderRegistry } from './financial-registry.js';
import type { MultiRailRouting } from './routing-types.js';
import type { RailType } from '../domain/rail.js';
import { fingerprint } from '../reproducibility/index.js';

export function captureRoutingFingerprint(
  routing: MultiRailRouting,
  rails: readonly RailType[] | null,
  registry: FinancialProviderRegistry,
): {
  readonly snapshot: RoutingComparisonSnapshot;
  readonly fingerprint: string;
  readonly rankedRouteIds: readonly string[];
} {
  const snapshot = snapshotFromRouting(
    routing,
    rails,
    routing.pricingRules,
    capabilitiesFromRouting(routing, registry),
  );
  return {
    snapshot,
    fingerprint: fingerprint(fingerprintableRoutingSnapshot(snapshot)),
    rankedRouteIds: routing.routes.map((route) => route.routeId),
  };
}

export { ROUTING_ENGINE_VERSION };
