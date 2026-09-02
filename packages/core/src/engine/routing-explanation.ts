import { Dec, type Decimal, Rounding } from '../money/index.js';
import type { RoutingWeights } from './routing-config.js';
import { serializeRoutingWeights } from './routing-config.js';
import type { ScoredMultiRailRoute } from './routing-types.js';

/**
 * Builds a deterministic, human-readable explanation of why a route ranked where it did.
 *
 * This is a template over the score components and rail health. It is not a model output.
 */
export function explainRoute(
  route: ScoredMultiRailRoute,
  all: readonly ScoredMultiRailRoute[],
  weights: RoutingWeights,
): string {
  const serialized = serializeRoutingWeights(weights);
  const parts: string[] = [];

  parts.push(
    `${route.provider.name} scores ${route.routeScore.toFixed(2)} / 100 using objective weights ` +
      `cost ${percent(serialized.cost)}, speed ${percent(serialized.speed)}, ` +
      `finality ${percent(serialized.finality)}, fxRate ${percent(serialized.fxRate)}, ` +
      `slippage ${percent(serialized.slippage)}, liquidity ${percent(serialized.liquidity)}, ` +
      `compliance ${percent(serialized.compliance)}.`,
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
    `Finality component ${component(route.scoreComponents.finality)} ` +
      `(settlement confidence ${route.settlementConfidence.toDecimalPlaces(3).toFixed()}; ` +
      `p95 ${formatSeconds(route.settlement.p95Seconds)}).`,
  );
  parts.push(
    `FX-rate component ${component(route.scoreComponents.fxRate)} ` +
      `(indicated ${route.indicatedRate.toFixed()} versus mid ${route.midMarketRate.toFixed()}).`,
  );
  parts.push(
    `Slippage component ${component(route.scoreComponents.slippage)} ` +
      `(${route.slippageBps.toDecimalPlaces(2).toFixed()} bps).`,
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
    `Compliance component ${component(route.scoreComponents.compliance)} ` +
      `(licensing ${route.compliance.licensing}; executable false).`,
  );
  parts.push(
    `Rail health ${route.railHealth.state}/${route.railHealth.liquidityState}` +
      `${route.railHealth.deprioritized ? ' (deprioritized)' : ''}` +
      ` because ${route.railHealth.reason}.`,
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

  const excluded = all.length;
  if (route.recommended) {
    parts.push(
      `Best execution among ${excluded} admitted path${excluded === 1 ? '' : 's'}: ` +
        'the weighted multi-objective score is highest after rail-health and liquidity ' +
        'adjustments. Ties break on cost, then speed, then route id. Down rails are excluded ' +
        'and failed over. No model is used.',
    );
  } else {
    parts.push(
      `Not recommended: ${excluded} admitted paths were scored; this path is rank ${route.rank}. ` +
        'No model is used.',
    );
  }

  parts.push(
    `Rail family: ${route.railFamily}. Conversion: ${route.conversionKind}. ` +
      'No rail family is assumed to be cheaper. ' +
      'Figures are computed by the routing engine from provider quotes.',
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
