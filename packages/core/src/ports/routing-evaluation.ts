import type { RoutingComparisonSnapshot } from '../engine/routing-snapshot.js';

export const ROUTING_EVALUATION_SURFACES = ['routes', 'quote'] as const;
export type RoutingEvaluationSurface = (typeof ROUTING_EVALUATION_SURFACES)[number];

/**
 * Persisted MultiRailRouter ranking (PA-M10).
 *
 * Snapshot is replay input, not a public DTO. `surface` keeps billed `/quote` replay off the
 * public `/routes` response shape (no monetization field on quote replay).
 */
export interface StoredRoutingEvaluation {
  readonly routingId: string;
  readonly fingerprint: string;
  readonly engineVersion: string;
  readonly surface: RoutingEvaluationSurface;
  readonly organizationId: string | null;
  readonly createdAt: string;
  readonly rankedRouteIds: readonly string[];
  readonly snapshot: RoutingComparisonSnapshot;
}

export interface RoutingEvaluationRepository {
  save(evaluation: StoredRoutingEvaluation): Promise<void>;
  findById(routingId: string): Promise<StoredRoutingEvaluation | null>;
}
