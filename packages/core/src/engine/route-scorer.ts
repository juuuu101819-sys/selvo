import type { PricedRoute, ScoreComponents, ScoredRoute } from '../domain/index.js';
import { Dec, type Decimal, Rounding } from '../money/index.js';
import type { ScoringWeights } from './engine-config.js';

const ONE = new Dec(1);
const HUNDRED = new Dec(100);
const SCORE_DECIMAL_PLACES = 2;

/**
 * Ranks priced routes with a transparent weighted score.
 *
 * Cost and speed are min-max normalised across the candidate set, so a score answers "how good is
 * this route among the alternatives we found", which is the question the user actually asked.
 * Reliability arrives already on an absolute 0..1 scale and is used directly — normalising it
 * would make a set of three highly reliable providers look as though one of them were unreliable.
 *
 * Speed scores on the median (p50) settlement time, matching the figure shown in the UI. The p95
 * is carried through for display so a route with a long tail is still visible to the user.
 */
export class RouteScorer {
  constructor(private readonly weights: ScoringWeights) {}

  score(routes: readonly PricedRoute[]): readonly ScoredRoute[] {
    if (routes.length === 0) {
      return [];
    }

    const costs = routes.map((route) => route.totalCostBps);
    const speeds = routes.map((route) => new Dec(route.settlement.p50Seconds));
    const costRange = range(costs);
    const speedRange = range(speeds);

    const scored = routes.map((route): Omit<ScoredRoute, 'rank' | 'recommended'> => {
      const components: ScoreComponents = {
        cost: normaliseLowerIsBetter(route.totalCostBps, costRange),
        speed: normaliseLowerIsBetter(new Dec(route.settlement.p50Seconds), speedRange),
        reliability: clampUnit(route.reliabilityScore),
      };

      const weighted = components.cost
        .times(this.weights.cost)
        .plus(components.speed.times(this.weights.speed))
        .plus(components.reliability.times(this.weights.reliability));

      return {
        ...route,
        score: weighted.times(HUNDRED).toDecimalPlaces(SCORE_DECIMAL_PLACES, Rounding.HALF_UP),
        scoreComponents: components,
      };
    });

    const ranked = [...scored].sort(compareRoutes);

    return ranked.map((route, index) => ({
      ...route,
      rank: index + 1,
      recommended: index === 0,
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

/**
 * Maps a lower-is-better metric onto 0..1 where 1 is the best in the set.
 *
 * When every candidate ties, the span is zero and there is no meaningful ordering; every route
 * gets the neutral value 1 rather than a division by zero, so the remaining weighted components
 * decide the ranking.
 */
function normaliseLowerIsBetter(value: Decimal, bounds: Range): Decimal {
  const span = bounds.max.minus(bounds.min);
  if (span.isZero()) {
    return ONE;
  }
  return clampUnit(bounds.max.minus(value).div(span));
}

function clampUnit(value: Decimal): Decimal {
  if (value.lessThan(0)) return new Dec(0);
  if (value.greaterThan(ONE)) return ONE;
  return value;
}

/**
 * Total order over routes. Score decides; ties fall through to cost, then median settlement time,
 * then provider id. The final tiebreak guarantees the ranking never depends on the order provider
 * responses happened to arrive in, which is a prerequisite for reproducibility.
 */
function compareRoutes(
  left: Omit<ScoredRoute, 'rank' | 'recommended'>,
  right: Omit<ScoredRoute, 'rank' | 'recommended'>,
): number {
  const byScore = right.score.comparedTo(left.score);
  if (byScore !== 0) return byScore;

  const byCost = left.totalCostBps.comparedTo(right.totalCostBps);
  if (byCost !== 0) return byCost;

  const bySpeed = left.settlement.p50Seconds - right.settlement.p50Seconds;
  if (bySpeed !== 0) return bySpeed;

  return left.routeId.localeCompare(right.routeId, 'en');
}
