import { Dec, type Decimal, Rounding } from '../money/index.js';
import { LIQUIDITY_COMFORT_MULTIPLE } from './engine-config.js';
import {
  ROUTING_SCORING_FACTORS,
  type RoutingWeights,
} from './routing-config.js';
import type {
  PricedMultiRailRoute,
  RoutingScoreComponents,
  ScoredMultiRailRoute,
} from './routing-types.js';
import { attestBestExecution } from './best-execution.js';
import {
  healthByProvider,
  healthMultiplier,
  isDownObservation,
  type RailHealthObservation,
} from './rail-health.js';
import { observeRoute } from './rail-health.js';

const ONE = new Dec(1);
const HUNDRED = new Dec(100);
const SCORE_DECIMAL_PLACES = 2;

export interface MultiRailScoreOptions {
  readonly health?: readonly RailHealthObservation[];
  readonly observedAt?: string;
}

/**
 * Ranks priced multi-rail routes with a transparent multi-objective score.
 *
 * Deterministic: no randomness, no clock, no I/O, no model. The same candidate set, weights and
 * rail-health snapshot always produce the same ranking.
 *
 * Down rails are excluded (failover). Degraded or dry/thin rails stay in the set but have their
 * weighted score multiplied by a published penalty.
 */
export class MultiRailScorer {
  constructor(private readonly weights: RoutingWeights) {}

  score(
    routes: readonly PricedMultiRailRoute[],
    options: MultiRailScoreOptions = {},
  ): readonly ScoredMultiRailRoute[] {
    if (routes.length === 0) {
      return [];
    }

    const observedAt = options.observedAt ?? '1970-01-01T00:00:00.000Z';
    const provided = healthByProvider(options.health ?? []);
    const health = new Map<string, RailHealthObservation>();
    for (const route of routes) {
      health.set(
        route.provider.id,
        provided.get(route.provider.id) ?? observeRoute(route, null, undefined, observedAt),
      );
    }

    const admitted = routes.filter((route) => !isDownObservation(health.get(route.provider.id)));
    if (admitted.length === 0) {
      return [];
    }

    const costRange = range(admitted.map((route) => route.totalCostBps));
    const speedRange = range(admitted.map((route) => new Dec(route.settlement.p50Seconds)));
    const fxRange = range(admitted.map((route) => route.indicatedRate));
    const slipRange = range(admitted.map((route) => route.slippageBps));

    const scored = admitted.map((route): Omit<ScoredMultiRailRoute, 'rank' | 'recommended' | 'routeExplanation' | 'bestExecution'> => {
      const observation = health.get(route.provider.id);
      if (observation === undefined) {
        throw new Error(`Missing rail-health observation for "${route.provider.id}".`);
      }
      const components: RoutingScoreComponents = {
        cost: normaliseLowerIsBetter(route.totalCostBps, costRange),
        speed: normaliseLowerIsBetter(new Dec(route.settlement.p50Seconds), speedRange),
        finality: clampUnit(route.settlementConfidence),
        fxRate: normaliseHigherIsBetter(route.indicatedRate, fxRange),
        slippage: normaliseLowerIsBetter(route.slippageBps, slipRange),
        liquidity: liquidityScore(route.liquidityHeadroom),
        compliance: complianceScore(route),
      };

      const weighted = ROUTING_SCORING_FACTORS.reduce(
        (total, factor) => total.plus(components[factor].times(this.weights[factor])),
        new Dec(0),
      );
      const adjusted = weighted.times(healthMultiplier(observation));

      return {
        ...route,
        railHealth: observation,
        routeScore: adjusted.times(HUNDRED).toDecimalPlaces(SCORE_DECIMAL_PLACES, Rounding.HALF_UP),
        scoreComponents: components,
      };
    });

    const ranked = [...scored].sort(compareRoutes);
    const withRank = ranked.map((route, index) => ({
      ...route,
      rank: index + 1,
      recommended: index === 0,
      routeExplanation: '',
      bestExecution: placeholderAttestation(),
    }));

    return withRank.map((route) => {
      const attestation = attestBestExecution(route, withRank, this.weights);
      return {
        ...route,
        routeExplanation: attestation.rationale,
        bestExecution: attestation,
      };
    });
  }
}

interface Range {
  readonly min: Decimal;
  readonly max: Decimal;
}

function range(values: readonly Decimal[]): Range {
  return values.reduce<Range>(
    (accumulator, value) => ({
      min: Dec.min(accumulator.min, value),
      max: Dec.max(accumulator.max, value),
    }),
    { min: values[0] ?? new Dec(0), max: values[0] ?? new Dec(0) },
  );
}

function normaliseLowerIsBetter(value: Decimal, bounds: Range): Decimal {
  const span = bounds.max.minus(bounds.min);
  if (span.isZero()) {
    return ONE;
  }
  return clampUnit(bounds.max.minus(value).div(span));
}

function normaliseHigherIsBetter(value: Decimal, bounds: Range): Decimal {
  const span = bounds.max.minus(bounds.min);
  if (span.isZero()) {
    return ONE;
  }
  return clampUnit(value.minus(bounds.min).div(span));
}

function liquidityScore(headroom: Decimal | null): Decimal {
  if (headroom === null) {
    return ONE;
  }
  return clampUnit(headroom.div(LIQUIDITY_COMFORT_MULTIPLE));
}

function complianceScore(route: PricedMultiRailRoute): Decimal {
  let score = new Dec('0.55');
  if (route.compliance.licensing === 'licensed_partner') {
    score = score.plus('0.25');
  } else if (route.compliance.licensing === 'internal_model') {
    score = score.plus('0.15');
  } else {
    score = score.plus('0.10');
  }
  if (route.compliance.kycRequired) {
    score = score.plus('0.08');
  }
  if (route.compliance.sanctionsScreeningRequired) {
    score = score.plus('0.07');
  }
  if (!route.compliance.eligible) {
    return new Dec(0);
  }
  return clampUnit(score);
}

function clampUnit(value: Decimal): Decimal {
  if (value.lessThan(0)) return new Dec(0);
  if (value.greaterThan(ONE)) return ONE;
  return value;
}

function compareRoutes(
  left: Omit<ScoredMultiRailRoute, 'rank' | 'recommended' | 'routeExplanation' | 'bestExecution'>,
  right: Omit<ScoredMultiRailRoute, 'rank' | 'recommended' | 'routeExplanation' | 'bestExecution'>,
): number {
  if (left.railHealth.deprioritized !== right.railHealth.deprioritized) {
    return left.railHealth.deprioritized ? 1 : -1;
  }
  const byScore = right.routeScore.comparedTo(left.routeScore);
  if (byScore !== 0) return byScore;

  const byCost = left.totalCostBps.comparedTo(right.totalCostBps);
  if (byCost !== 0) return byCost;

  const bySpeed = left.settlement.p50Seconds - right.settlement.p50Seconds;
  if (bySpeed !== 0) return bySpeed;

  return left.routeId.localeCompare(right.routeId, 'en');
}

function placeholderAttestation(): ScoredMultiRailRoute['bestExecution'] {
  return {
    selected: false,
    rank: 0,
    competingRouteCount: 0,
    objectiveWeights: {
      cost: '0',
      speed: '0',
      finality: '0',
      fxRate: '0',
      slippage: '0',
      liquidity: '0',
      compliance: '0',
    },
    rationale: '',
    rationaleHash: '',
    alternatives: [],
    railHealth: {
      state: 'up',
      liquidityState: 'unknown',
      deprioritized: false,
      excluded: false,
    },
    constraintsSatisfied: [],
  };
}
