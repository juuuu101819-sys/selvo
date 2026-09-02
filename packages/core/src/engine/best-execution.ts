import { hashCanonical } from '../mandates/scope.js';
import type { RoutingWeights } from './routing-config.js';
import { serializeRoutingWeights } from './routing-config.js';
import type {
  BestExecutionAttestation,
  ScoredMultiRailRoute,
} from './routing-types.js';
import type { RailHealthObservation } from './rail-health.js';
import { explainRoute } from './routing-explanation.js';

const MAX_ALTERNATIVES = 3;

/**
 * Builds the structured best-execution attestation after ranking.
 *
 * Pure: same candidate set, weights and health always produce the same rationale and hash.
 */
export function attestBestExecution(
  route: Omit<ScoredMultiRailRoute, 'routeExplanation' | 'bestExecution'>,
  all: readonly Omit<ScoredMultiRailRoute, 'routeExplanation' | 'bestExecution'>[],
  weights: RoutingWeights,
): BestExecutionAttestation {
  const scored = all as readonly ScoredMultiRailRoute[];
  const current = route as ScoredMultiRailRoute;
  const rationale = explainRoute(current, scored, weights);
  const alternatives = scored
    .filter((candidate) => candidate.routeId !== route.routeId)
    .slice(0, MAX_ALTERNATIVES)
    .map((candidate) => ({
      routeId: candidate.routeId,
      providerId: candidate.provider.id,
      rank: candidate.rank,
      whyNotSelected: whyNotSelected(current, candidate),
    }));

  const unsigned = {
    selected: route.recommended,
    rank: route.rank,
    competingRouteCount: all.length,
    objectiveWeights: serializeRoutingWeights(weights),
    rationale,
    alternatives,
    railHealth: {
      state: route.railHealth.state,
      liquidityState: route.railHealth.liquidityState,
      deprioritized: route.railHealth.deprioritized,
      excluded: false as const,
    },
    constraintsSatisfied: constraintsSatisfied(route.railHealth),
  };

  return {
    ...unsigned,
    rationaleHash: hashCanonical(unsigned),
  };
}

function whyNotSelected(
  recommended: ScoredMultiRailRoute,
  other: ScoredMultiRailRoute,
): string {
  const parts: string[] = [];
  if (other.routeScore.lessThan(recommended.routeScore)) {
    parts.push(
      `lower weighted score (${other.routeScore.toFixed(2)} vs ${recommended.routeScore.toFixed(2)})`,
    );
  }
  if (other.totalCostBps.greaterThan(recommended.totalCostBps)) {
    parts.push('higher all-in cost');
  }
  if (other.settlement.p50Seconds > recommended.settlement.p50Seconds) {
    parts.push('slower median settlement');
  }
  if (other.railHealth.deprioritized && !recommended.railHealth.deprioritized) {
    parts.push(`rail ${other.railHealth.state}/${other.railHealth.liquidityState}`);
  }
  if (parts.length === 0) {
    parts.push('tie-break order (cost, then speed, then route id)');
  }
  return parts.join('; ');
}

function constraintsSatisfied(health: RailHealthObservation): readonly string[] {
  const items = ['compliance_eligible', 'indicative_only', 'non_custodial'];
  if (health.state !== 'down') {
    items.push('rail_admitted');
  }
  if (health.liquidityState !== 'dry') {
    items.push('liquidity_not_dry');
  }
  return items;
}
