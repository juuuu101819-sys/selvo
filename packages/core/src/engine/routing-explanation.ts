import { Dec, type Decimal, Rounding } from '../money/index.js';
import type { RoutingWeights } from './routing-config.js';
import { serializeRoutingWeights } from './routing-config.js';
import type { ScoredMultiRailRoute } from './routing-types.js';

/**
 * Builds a deterministic, human-readable explanation of why a route ranked where it did.
 *
 * This is a template over the score components. It is not a model output. The same route set and
 * weights always produce the same string.
 */
export function explainRoute(
  route: ScoredMultiRailRoute,
  all: readonly ScoredMultiRailRoute[],
  weights: RoutingWeights,
): string {
  const serialized = serializeRoutingWeights(weights);
  const parts: string[] = [];

  parts.push(
    `${route.provider.name} scores ${route.routeScore.toFixed(2)} / 100 using weights ` +
      `cost ${percent(serialized.cost)}, speed ${percent(serialized.speed)}, ` +
      `liquidity ${percent(serialized.liquidity)}, reliability ${percent(serialized.reliability)}, ` +
      `settlement confidence ${percent(serialized.settlementConfidence)}.`,
  );

  parts.push(`Path: ${route.hops.join(' → ')}.`);

  parts.push(
    `Cost component ${component(route.scoreComponents.cost)} ` +
      `(all-in ${route.totalCostBps.toDecimalPlaces(2).toFixed()} bps versus mid-market; ` +
      `estimated receive ${route.deliveredAmount.toString()} after provider, platform, ` +
      `network and gas fees).`,
  );
  parts.push(
    `Speed component ${component(route.scoreComponents.speed)} ` +
      `(median settlement ${formatSeconds(route.settlement.p50Seconds)}` +
      `${route.settlement.businessDaysOnly ? ', business days only' : ''}).`,
  );
  parts.push(
    `Liquidity component ${component(route.scoreComponents.liquidity)}` +
      `${
        route.liquidityHeadroom === null
          ? ' (no published depth — treated as unconstrained).'
          : ` (disclosed depth ${route.liquidityHeadroom.toDecimalPlaces(2).toFixed()}× the notional).`
      }`,
  );
  parts.push(
    `Reliability component ${component(route.scoreComponents.reliability)} ` +
      `(provider score ${route.reliabilityScore.toDecimalPlaces(3).toFixed()}).`,
  );
  parts.push(
    `Settlement confidence ${component(route.scoreComponents.settlementConfidence)} ` +
      `(p50 ${formatSeconds(route.settlement.p50Seconds)}, ` +
      `p95 ${formatSeconds(route.settlement.p95Seconds)}` +
      `${route.settlement.cutoffUtc === null ? '' : `, cutoff ${route.settlement.cutoffUtc} UTC`}).`,
  );

  const cheapest = pickBy(all, (left, right) => left.totalCostBps.lessThan(right.totalCostBps));
  const fastest = pickBy(
    all,
    (left, right) => left.settlement.p50Seconds < right.settlement.p50Seconds,
  );
  if (cheapest.routeId === route.routeId) {
    parts.push('Lowest all-in cost in this set.');
  }
  if (fastest.routeId === route.routeId) {
    parts.push('Fastest median settlement in this set.');
  }
  if (route.recommended) {
    parts.push(
      'Recommended because the weighted score is highest. Ties break on cost, then speed, then route id.',
    );
  }

  parts.push(
    `Rail family: ${route.railFamily}. Conversion: ${route.conversionKind}. ` +
      'No rail family is assumed to be cheaper. ' +
      'Figures are computed by the routing engine from provider quotes. No model is used.',
  );

  return parts.join(' ');
}

export function explainRecommendation(route: ScoredMultiRailRoute | null): string {
  if (route === null) {
    return 'No route was available to recommend.';
  }
  return route.routeExplanation;
}

function percent(weight: string): string {
  return `${new Dec(weight).times(100).toDecimalPlaces(0).toFixed()}%`;
}

function component(value: Decimal): string {
  return value.toDecimalPlaces(2).toFixed();
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) {
    const minutes = new Dec(seconds).div(60).toDecimalPlaces(0, Rounding.HALF_UP).toFixed();
    return `${minutes} min`;
  }
  if (seconds < 86_400) {
    const hours = new Dec(seconds).div(3_600).toDecimalPlaces(0, Rounding.HALF_UP).toFixed();
    return `${hours} h`;
  }
  const days = new Dec(seconds).div(86_400);
  if (days.equals(new Dec(1))) return '1 day';
  const places = days.lessThan(10) ? 1 : 0;
  return `${days.toDecimalPlaces(places, Rounding.HALF_UP).toFixed()} days`;
}

function pickBy(
  routes: readonly ScoredMultiRailRoute[],
  better: (left: ScoredMultiRailRoute, right: ScoredMultiRailRoute) => boolean,
): ScoredMultiRailRoute {
  return routes.reduce((best, route) => (better(route, best) ? route : best));
}
