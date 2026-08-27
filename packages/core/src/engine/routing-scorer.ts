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
import { explainRoute } from './routing-explanation.js';

const ONE = new Dec(1);
const HUNDRED = new Dec(100);
const SCORE_DECIMAL_PLACES = 2;

/**
 * Ranks priced multi-rail routes with a transparent weighted score.
 *
 * Deterministic: no randomness, no clock, no I/O, no model. The same candidate set and weights
 * always produce the same ranking. Cost and speed are min-max normalised across the set (lower is
 * better). Liquidity, reliability and settlement confidence are absolute 0..1 scores.
 */
export class MultiRailScorer {
  constructor(private readonly weights: RoutingWeights) {}

  score(routes: readonly PricedMultiRailRoute[]): readonly ScoredMultiRailRoute[] {
    if (routes.length === 0) {
      return [];
    }

    const costRange = range(routes.map((route) => route.totalCostBps));
    const speedRange = range(routes.map((route) => new Dec(route.settlement.p50Seconds)));

    const scored = routes.map((route): Omit<ScoredMultiRailRoute, 'rank' | 'recommended'> => {
      const components: RoutingScoreComponents = {
        cost: normaliseLowerIsBetter(route.totalCostBps, costRange),
        speed: normaliseLowerIsBetter(new Dec(route.settlement.p50Seconds), speedRange),
        liquidity: liquidityScore(route.liquidityHeadroom),
        reliability: clampUnit(route.reliabilityScore),
        settlementConfidence: clampUnit(route.settlementConfidence),
      };

      const weighted = ROUTING_SCORING_FACTORS.reduce(
        (total, factor) => total.plus(components[factor].times(this.weights[factor])),
        new Dec(0),
      );

      return {
        ...route,
        routeScore: weighted.times(HUNDRED).toDecimalPlaces(SCORE_DECIMAL_PLACES, Rounding.HALF_UP),
        scoreComponents: components,
        routeExplanation: '',
      };
    });

    const ranked = [...scored].sort(compareRoutes);
    const withRank: ScoredMultiRailRoute[] = ranked.map((route, index) => ({
      ...route,
      rank: index + 1,
      recommended: index === 0,
      routeExplanation: '',
    }));

    return withRank.map((route) => ({
      ...route,
      routeExplanation: explainRoute(route, withRank, this.weights),
    }));
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

function liquidityScore(headroom: Decimal | null): Decimal {
  if (headroom === null) {
    return ONE;
  }
  return clampUnit(headroom.div(LIQUIDITY_COMFORT_MULTIPLE));
}

function clampUnit(value: Decimal): Decimal {
  if (value.lessThan(0)) return new Dec(0);
  if (value.greaterThan(ONE)) return ONE;
  return value;
}

function compareRoutes(
  left: Omit<ScoredMultiRailRoute, 'rank' | 'recommended'>,
  right: Omit<ScoredMultiRailRoute, 'rank' | 'recommended'>,
): number {
  const byScore = right.routeScore.comparedTo(left.routeScore);
  if (byScore !== 0) return byScore;

  const byCost = left.totalCostBps.comparedTo(right.totalCostBps);
  if (byCost !== 0) return byCost;

  const bySpeed = left.settlement.p50Seconds - right.settlement.p50Seconds;
  if (bySpeed !== 0) return bySpeed;

  return left.routeId.localeCompare(right.routeId, 'en');
}
