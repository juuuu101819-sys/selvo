import type {
  AppliedFee,
  ComparisonInsights,
  CostBreakdown,
  ProviderFailure,
  ReplayResult,
  RouteComparison,
  ScoredRoute,
} from '../domain/index.js';
import { RAIL_REGISTRY } from '../domain/index.js';
import { Money, type Decimal } from '../money/index.js';
import type {
  AppliedFeeDto,
  ComparisonDto,
  ComparisonInsightsDto,
  CostBreakdownDto,
  ProviderFailureDto,
  ReplayResultDto,
  RouteDto,
} from './dto.js';

const BPS_DECIMAL_PLACES = 4;
const PERCENT_DECIMAL_PLACES = 4;

export function serializeComparison(comparison: RouteComparison): ComparisonDto {
  return {
    comparisonId: comparison.comparisonId,
    createdAt: comparison.createdAt,
    mode: comparison.mode,
    engineVersion: comparison.engineVersion,
    fingerprint: comparison.fingerprint,
    request: {
      sourceCurrency: comparison.request.sourceCurrency,
      targetCurrency: comparison.request.targetCurrency,
      amount: Money.ofMinorUnits(
        comparison.request.sourceCurrency,
        comparison.request.amountMinorUnits,
      ).toJSON(),
      rails: comparison.request.rails === null ? null : [...comparison.request.rails],
      requestedAt: comparison.request.requestedAt,
    },
    routes: comparison.routes.map(serializeRoute),
    recommendedRouteId: comparison.recommendedRouteId,
    insights: comparison.insights === null ? null : serializeInsights(comparison.insights),
    providerFailures: comparison.providerFailures.map(serializeFailure),
    scoringWeights: comparison.snapshot.weights,
  };
}

export function serializeReplayResult(result: ReplayResult): ReplayResultDto {
  return {
    comparisonId: result.comparisonId,
    reproducible: result.reproducible,
    originalFingerprint: result.originalFingerprint,
    replayedFingerprint: result.replayedFingerprint,
    replayedAt: result.replayedAt,
    comparison: serializeComparison(result.comparison),
  };
}

export function serializeRoute(route: ScoredRoute): RouteDto {
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
      quotedAt: route.quote.quotedAt,
      expiresAt: route.quote.expiresAt,
      quoteReference: route.quote.quoteReference,
      pricingVersion: route.quote.pricingVersion,
      intermediaryAsset: route.quote.intermediaryAsset,
    },
    sendAmount: route.sendAmount.toJSON(),
    deliveredAmount: route.deliveredAmount.toJSON(),
    benchmarkAmount: route.benchmarkAmount.toJSON(),
    midMarketRate: route.midMarketRate.toJSON(),
    offeredRate: route.offeredRate.toJSON(),
    slippageAdjustedRate: route.slippageAdjustedRate.toJSON(),
    effectiveRate: route.effectiveRate.toJSON(),
    totalCost: route.totalCost.toJSON(),
    totalCostBps: fixed(route.totalCostBps, BPS_DECIMAL_PLACES),
    totalCostPercent: fixed(route.totalCostBps.div(100), PERCENT_DECIMAL_PLACES),
    slippageBps: fixed(route.slippageBps, BPS_DECIMAL_PLACES),
    reliabilityScore: route.reliabilityScore.toFixed(),
    settlement: { ...route.settlement },
    breakdown: serializeBreakdown(route.breakdown),
    score: route.score.toFixed(2),
    scoreComponents: {
      cost: fixed(route.scoreComponents.cost, 6),
      speed: fixed(route.scoreComponents.speed, 6),
      reliability: fixed(route.scoreComponents.reliability, 6),
    },
  };
}

function serializeBreakdown(breakdown: CostBreakdown): CostBreakdownDto {
  return {
    appliedFees: breakdown.appliedFees.map(serializeAppliedFee),
    sourceFeeCost: breakdown.sourceFeeCost.toJSON(),
    destinationFeeCost: breakdown.destinationFeeCost.toJSON(),
    fxSpreadCost: breakdown.fxSpreadCost.toJSON(),
    slippageCost: breakdown.slippageCost.toJSON(),
    roundingAdjustment: breakdown.roundingAdjustment.toJSON(),
    totalCost: breakdown.totalCost.toJSON(),
  };
}

function serializeAppliedFee(fee: AppliedFee): AppliedFeeDto {
  return {
    code: fee.code,
    label: fee.label,
    side: fee.side,
    kind: fee.kind,
    amount: fee.amount.toJSON(),
    rateBps: fee.rateBps === null ? null : fee.rateBps.toFixed(),
    capped: fee.capped,
  };
}

function serializeInsights(insights: ComparisonInsights): ComparisonInsightsDto {
  return {
    cheapestRouteId: insights.cheapestRouteId,
    fastestRouteId: insights.fastestRouteId,
    mostExpensiveRouteId: insights.mostExpensiveRouteId,
    savingsVsMostExpensive: insights.savingsVsMostExpensive.toJSON(),
    savingsVsMostExpensiveBps: fixed(insights.savingsVsMostExpensiveBps, BPS_DECIMAL_PLACES),
    savingsVsBankFx: insights.savingsVsBankFx === null ? null : insights.savingsVsBankFx.toJSON(),
  };
}

function serializeFailure(failure: ProviderFailure): ProviderFailureDto {
  return { ...failure };
}

/** Derived percentages are rounded for presentation only; the authoritative figure is the Money. */
function fixed(value: Decimal, decimalPlaces: number): string {
  return value.toDecimalPlaces(decimalPlaces).toFixed();
}
