import { RAIL_REGISTRY, type RailType } from '../domain/rail.js';
import { isCurrencyCode } from '../money/currency.js';
import { Dec, Money, Rate, type MoneyJson, type RateJson } from '../money/index.js';
import { ValidationError } from '../errors/index.js';
import type {
  AppliedFeeDto,
  ComparisonDto,
  ComparisonInsightsDto,
  CostBreakdownDto,
  QuoteFreshnessDto,
  RouteDto,
} from '../serialization/dto.js';
import type { QuoteFreshnessView } from '../quotes/quote-freshness.js';
import type { ScoringWeightsInput } from './engine-config.js';
import type { RoutingWeightsInput } from './routing-config.js';
import type { MultiRailRouting, ScoredMultiRailRoute } from './routing-types.js';

const BPS_DECIMAL_PLACES = 4;
const PERCENT_DECIMAL_PLACES = 4;

export function routingWeightsFromComparisonInput(
  input: ScoringWeightsInput | null,
): RoutingWeightsInput | null {
  if (input === null) {
    return null;
  }
  return {
    cost: toWeightString(input.cost),
    speed: toWeightString(input.speed),
    reliability: toWeightString(input.reliability),
    liquidity: toWeightString(input.liquidity ?? '0'),
    settlementConfidence: '0',
  };
}

function toWeightString(value: string | { toFixed(): string } | bigint): string {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return value.toFixed();
}

export function serializeComparisonFromRouting(input: {
  readonly comparisonId: string;
  readonly fingerprint: string;
  readonly rails: readonly RailType[] | null;
  readonly routing: MultiRailRouting;
}): ComparisonDto {
  const { routing, comparisonId, fingerprint, rails } = input;
  const routes = routing.routes.map(serializeRouteFromMultiRail);
  return {
    comparisonId,
    organizationId: routing.organizationId,
    createdAt: routing.createdAt,
    mode: routing.mode,
    engineVersion: routing.routingEngineVersion,
    fingerprint,
    request: {
      sourceCurrency: routing.request.sourceAsset,
      targetCurrency: routing.request.destinationAsset,
      amount: moneyFromMinor(routing.request.sourceAsset, routing.request.amountMinorUnits),
      rails: rails === null ? null : [...rails],
      requestedAt: routing.request.requestedAt,
    },
    routes,
    recommendedRouteId: routing.recommendedRoute?.routeId ?? null,
    insights: insightsFromRoutes(routes, routing.routes),
    providerFailures: routing.providerFailures.map((failure) => ({ ...failure })),
    scoringWeights: {
      cost: routing.scoringWeights.cost,
      speed: routing.scoringWeights.speed,
      reliability: routing.scoringWeights.reliability,
      liquidity: routing.scoringWeights.liquidity,
      settlementConfidence: routing.scoringWeights.settlementConfidence,
    },
  };
}

function serializeRouteFromMultiRail(route: ScoredMultiRailRoute): RouteDto {
  const source = route.sendAmount.asset;
  const dest = route.deliveredAmount.asset;
  const fromMeta = route.quote.metadata['intermediaryAsset'];
  const intermediary = typeof fromMeta === 'string' ? fromMeta : null;

  return {
    routeId: route.routeId,
    rank: route.rank,
    recommended: route.recommended,
    provider: {
      id: route.provider.id,
      name: route.provider.name,
      rail: route.rail,
      railLabel: RAIL_REGISTRY[route.rail].label,
      licensing: route.provider.licensing,
      pricingVersion: route.provider.pricingVersion,
    },
    quote: {
      providerId: route.quote.providerId,
      quotedAt: route.quote.timestamp,
      expiresAt: route.quote.expiresAt,
      quoteReference: route.quote.quoteReference,
      pricingVersion: route.provider.pricingVersion,
      intermediaryAsset: intermediary,
      freshness: freshnessDto(route.quoteFreshness),
    },
    sendAmount: moneyFromAsset(route.sendAmount.asset, route.sendAmount.minorUnits.toString()),
    deliveredAmount: moneyFromAsset(
      route.deliveredAmount.asset,
      route.deliveredAmount.minorUnits.toString(),
    ),
    benchmarkAmount: moneyFromAsset(
      route.benchmarkAmount.asset,
      route.benchmarkAmount.minorUnits.toString(),
    ),
    midMarketRate: rateFrom(source, dest, route.midMarketRate.toFixed()),
    offeredRate: rateFrom(source, dest, route.indicatedRate.toFixed()),
    slippageAdjustedRate: rateFrom(source, dest, route.slippageAdjustedRate.toFixed()),
    effectiveRate: rateFrom(source, dest, route.effectiveRate.toFixed()),
    totalCost: moneyFromAsset(route.totalCost.asset, route.totalCost.minorUnits.toString()),
    totalCostBps: route.totalCostBps.toDecimalPlaces(BPS_DECIMAL_PLACES).toFixed(),
    totalCostPercent: route.totalCostBps.div(100).toDecimalPlaces(PERCENT_DECIMAL_PLACES).toFixed(),
    spreadBps: route.spreadBps.toDecimalPlaces(BPS_DECIMAL_PLACES).toFixed(),
    slippageBps: route.slippageBps.toDecimalPlaces(BPS_DECIMAL_PLACES).toFixed(),
    reliabilityScore: route.reliabilityScore.toFixed(),
    riskScore: route.settlementConfidence.toDecimalPlaces(6).toFixed(),
    liquidityHeadroom: route.liquidityHeadroom === null ? null : route.liquidityHeadroom.toFixed(),
    platformPricing: {
      ruleId: route.platformCharge.ruleId,
      markupBps: route.platformCharge.markupBps.toFixed(),
      discountBps: route.platformCharge.discountBps.toFixed(),
      flatFee: null,
    },
    settlement: { ...route.settlement },
    breakdown: breakdownFromRouting(route),
    score: route.routeScore.toFixed(2),
    scoreComponents: {
      cost: route.scoreComponents.cost.toDecimalPlaces(6).toFixed(),
      speed: route.scoreComponents.speed.toDecimalPlaces(6).toFixed(),
      reliability: route.scoreComponents.reliability.toDecimalPlaces(6).toFixed(),
      liquidity: route.scoreComponents.liquidity.toDecimalPlaces(6).toFixed(),
      settlementConfidence: route.scoreComponents.settlementConfidence.toDecimalPlaces(6).toFixed(),
    },
  };
}

function freshnessDto(view: QuoteFreshnessView): QuoteFreshnessDto {
  return {
    quotedAt: view.quotedAt,
    expiresAt: view.expiresAt,
    ageMs: view.ageMs,
    ageSeconds: view.ageSeconds,
    maxAgeMs: view.maxAgeMs,
    state: view.state,
    usableForMs: view.usableForMs,
  };
}

function breakdownFromRouting(route: ScoredMultiRailRoute): CostBreakdownDto {
  const dest = route.totalCost.asset;
  const destinationFee = route.breakdown.networkFee
    .add(route.breakdown.gasFee)
    .add(route.breakdown.liquidityFee);
  return {
    appliedFees: route.breakdown.appliedFees.map(
      (fee): AppliedFeeDto => ({
        code: fee.code,
        label: fee.label,
        side: fee.side,
        kind: fee.kind,
        chargedBy: fee.chargedBy,
        amount: moneyFromAsset(fee.amount.asset, fee.amount.minorUnits.toString()),
        rateBps: fee.rateBps === null ? null : fee.rateBps.toFixed(),
        capped: false,
      }),
    ),
    sourceFeeCost: moneyFromAsset(dest, route.breakdown.providerFee.minorUnits.toString()),
    platformFeeCost: moneyFromAsset(dest, route.breakdown.platformFee.minorUnits.toString()),
    destinationFeeCost: moneyFromAsset(dest, destinationFee.minorUnits.toString()),
    fxSpreadCost: moneyFromAsset(dest, route.breakdown.spreadCost.minorUnits.toString()),
    slippageCost: moneyFromAsset(dest, route.breakdown.slippageCost.minorUnits.toString()),
    roundingAdjustment: moneyFromAsset(
      dest,
      route.breakdown.roundingAdjustment.minorUnits.toString(),
    ),
    totalCost: moneyFromAsset(dest, route.breakdown.totalCost.minorUnits.toString()),
  };
}

function insightsFromRoutes(
  dtoRoutes: readonly RouteDto[],
  routes: readonly ScoredMultiRailRoute[],
): ComparisonInsightsDto | null {
  const recommended = routes[0];
  if (recommended === undefined || dtoRoutes[0] === undefined) {
    return null;
  }
  const cheapest = pickBy(routes, (left, right) => left.totalCost.lessThan(right.totalCost));
  const fastest = pickBy(routes, (left, right) => left.settlement.p50Seconds < right.settlement.p50Seconds);
  const mostExpensive = pickBy(routes, (left, right) => left.totalCost.greaterThan(right.totalCost));
  const savings = mostExpensive.totalCost.subtract(recommended.totalCost);
  const benchmark = recommended.benchmarkAmount.toDecimal();
  const bankBaseline = routes
    .filter((route) => route.rail === 'bank_fx')
    .reduce<ScoredMultiRailRoute | null>(
      (best, route) =>
        best === null || route.totalCost.lessThan(best.totalCost) ? route : best,
      null,
    );
  const dest = recommended.totalCost.asset;
  return {
    cheapestRouteId: cheapest.routeId,
    fastestRouteId: fastest.routeId,
    mostExpensiveRouteId: mostExpensive.routeId,
    savingsVsMostExpensive: moneyFromAsset(dest, savings.minorUnits.toString()),
    savingsVsMostExpensiveBps: benchmark.isZero()
      ? new Dec(0).toDecimalPlaces(BPS_DECIMAL_PLACES).toFixed()
      : savings.toDecimal().div(benchmark).times(10_000).toDecimalPlaces(BPS_DECIMAL_PLACES).toFixed(),
    savingsVsBankFx:
      bankBaseline === null
        ? null
        : moneyFromAsset(
            dest,
            bankBaseline.totalCost.subtract(recommended.totalCost).minorUnits.toString(),
          ),
  };
}

function pickBy(
  items: readonly ScoredMultiRailRoute[],
  isBetter: (left: ScoredMultiRailRoute, right: ScoredMultiRailRoute) => boolean,
): ScoredMultiRailRoute {
  const first = items[0];
  if (first === undefined) {
    throw new ValidationError('Cannot select from an empty route set.', {});
  }
  return items.slice(1).reduce(
    (best, candidate) => (isBetter(candidate, best) ? candidate : best),
    first,
  );
}

function moneyFromMinor(asset: string, minorUnits: string): MoneyJson {
  return moneyFromAsset(asset, minorUnits);
}

function moneyFromAsset(asset: string, minorUnits: string): MoneyJson {
  if (!isCurrencyCode(asset)) {
    throw new ValidationError(
      `Comparison DTO requires an ISO currency; received asset "${asset}".`,
      { asset },
    );
  }
  return Money.ofMinorUnits(asset, minorUnits).toJSON();
}

function rateFrom(base: string, quote: string, value: string): RateJson {
  if (!isCurrencyCode(base) || !isCurrencyCode(quote)) {
    throw new ValidationError('Comparison DTO rates require ISO currencies.', { base, quote });
  }
  return Rate.of(base, quote, value).toJSON();
}
