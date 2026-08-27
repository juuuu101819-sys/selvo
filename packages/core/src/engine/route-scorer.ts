import type { PricedRoute, ScoreComponents, ScoredRoute } from '../domain/index.js';
import { Dec, type Decimal, Rounding } from '../money/index.js';
import {
  LIQUIDITY_COMFORT_MULTIPLE,
  SCORING_FACTORS,
  type ScoringWeights,
} from './engine-config.js';

const ONE = new Dec(1);
const HUNDRED = new Dec(100);
const SCORE_DECIMAL_PLACES = 2;

/**
 * Ranks priced routes with a transparent weighted score.
 *
 * Deterministic by construction: no randomness, no clock, no I/O, and a total ordering that does not
 * depend on the order provider responses arrived in. The same candidate set and weights always
 * produce the same ranking, on any machine.
 *
 * Two families of factor, normalised differently on purpose:
 *
 *   * **Relative** — cost, speed and slippage are min-max normalised across the candidate set,
 *     because the question a user is asking is "which of these is best", not "is this good in the
 *     abstract". A corridor where every route costs 200 bps should still produce a clear winner.
 *   * **Absolute** — reliability, liquidity and risk arrive on their own `0`..`1` scales and are used
 *     directly. Min-max normalising reliability would make three highly reliable providers look as
 *     though one of them were unreliable, which is worse than useless: it would actively mislead.
 *
 * Speed scores on the median settlement time, matching the figure shown in the UI. The 95th
 * percentile is carried through for display so a route with a long tail is still visible.
 */
export class RouteScorer {
  constructor(private readonly weights: ScoringWeights) {}

  score(routes: readonly PricedRoute[]): readonly ScoredRoute[] {
    if (routes.length === 0) {
      return [];
    }

    const costRange = range(routes.map((route) => route.totalCostBps));
    const speedRange = range(routes.map((route) => new Dec(route.settlement.p50Seconds)));
    const slippageRange = range(routes.map((route) => route.slippageBps));

    const scored = routes.map((route): Omit<ScoredRoute, 'rank' | 'recommended'> => {
      const components: ScoreComponents = {
        cost: normaliseLowerIsBetter(route.totalCostBps, costRange),
        speed: normaliseLowerIsBetter(new Dec(route.settlement.p50Seconds), speedRange),
        reliability: clampUnit(route.reliabilityScore),
        slippage: normaliseLowerIsBetter(route.slippageBps, slippageRange),
        liquidity: liquidityScore(route.liquidityHeadroom),
        risk: clampUnit(route.riskScore),
      };

      const weighted = SCORING_FACTORS.reduce(
        (total, factor) => total.plus(components[factor].times(this.weights[factor])),
        new Dec(0),
      );

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
 * Maps a lower-is-better metric onto `0`..`1` where 1 is the best in the set.
 *
 * When every candidate ties, the span is zero and there is no meaningful ordering; every route gets
 * the neutral value 1 rather than a division by zero, so the remaining weighted factors decide the
 * ranking. That is what makes a set of identical quotes rank deterministically instead of
 * arbitrarily.
 */
function normaliseLowerIsBetter(value: Decimal, bounds: Range): Decimal {
  const span = bounds.max.minus(bounds.min);
  if (span.isZero()) {
    return ONE;
  }
  return clampUnit(bounds.max.minus(value).div(span));
}

/**
 * Scores disclosed depth against the notional.
 *
 * Absolute rather than relative: cover is a question about the order, not about the other providers.
 * Two times cover is full marks — a provider that can only just fill the order is a real execution
 * risk even though it technically can, so one-times cover should not score as ideal.
 *
 * `null` means the rail publishes no depth, which is the norm for bank FX and payout networks and is
 * not a deficiency. It scores as unconstrained; penalising it would mark down an entire class of
 * provider for a concept that does not apply to them.
 */
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

/**
 * Total order over routes.
 *
 * Score decides; ties fall through to cost, then median settlement time, then route id. The final
 * tiebreak guarantees the ranking never depends on the order provider responses happened to arrive
 * in, which is a prerequisite for reproducibility and the reason identical quotes rank stably.
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
