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
import type { MultiRailRouting, ScoredMultiRailRoute } from '../engine/routing-types.js';
import { AssetAmount, Money, type Decimal } from '../money/index.js';
import type { FinancialProvider, NormalizedQuote } from '../ports/financial-provider.js';
import type {
  AppliedFeeDto,
  ComparisonDto,
  ComparisonInsightsDto,
  CostBreakdownDto,
  FinancialProviderDto,
  MultiRailRouteDto,
  MultiRailRoutingDto,
  NormalizedQuoteDto,
  ProviderFailureDto,
  ReplayResultDto,
  RouteDto,
} from './dto.js';

const BPS_DECIMAL_PLACES = 4;
const PERCENT_DECIMAL_PLACES = 4;

export function serializeComparison(comparison: RouteComparison): ComparisonDto {
  return {
    comparisonId: comparison.comparisonId,
    organizationId: comparison.snapshot.organizationId,
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
    divergence: result.divergence,
    originalFingerprint: result.originalFingerprint,
    replayedFingerprint: result.replayedFingerprint,
    originalEngineVersion: result.originalEngineVersion,
    replayEngineVersion: result.replayEngineVersion,
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
    spreadBps: fixed(route.spreadBps, BPS_DECIMAL_PLACES),
    slippageBps: fixed(route.slippageBps, BPS_DECIMAL_PLACES),
    reliabilityScore: route.reliabilityScore.toFixed(),
    riskScore: fixed(route.riskScore, 6),
    liquidityHeadroom: route.liquidityHeadroom === null ? null : fixed(route.liquidityHeadroom, 6),
    platformPricing: {
      ruleId: route.platformPricing.ruleId,
      markupBps: route.platformPricing.markupBps.toFixed(),
      discountBps: route.platformPricing.discountBps.toFixed(),
      flatFee: route.platformPricing.flatFee?.toJSON() ?? null,
    },
    settlement: { ...route.settlement },
    breakdown: serializeBreakdown(route.breakdown),
    score: route.score.toFixed(2),
    scoreComponents: {
      cost: fixed(route.scoreComponents.cost, 6),
      speed: fixed(route.scoreComponents.speed, 6),
      reliability: fixed(route.scoreComponents.reliability, 6),
      slippage: fixed(route.scoreComponents.slippage, 6),
      liquidity: fixed(route.scoreComponents.liquidity, 6),
      risk: fixed(route.scoreComponents.risk, 6),
    },
  };
}

function serializeBreakdown(breakdown: CostBreakdown): CostBreakdownDto {
  return {
    appliedFees: breakdown.appliedFees.map(serializeAppliedFee),
    sourceFeeCost: breakdown.sourceFeeCost.toJSON(),
    platformFeeCost: breakdown.platformFeeCost.toJSON(),
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
    chargedBy: fee.chargedBy,
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

export function serializeNormalizedQuote(quote: NormalizedQuote): NormalizedQuoteDto {
  return {
    providerId: quote.providerId,
    timestamp: quote.timestamp,
    expiresAt: quote.expiresAt,
    quoteReference: quote.quoteReference,
    conversionKind: quote.conversionKind,
    sourceAsset: quote.sourceAsset,
    targetAsset: quote.targetAsset,
    amountMinorUnits: quote.amountMinorUnits,
    indicatedRate: quote.indicatedRate,
    midMarketRate: quote.midMarketRate,
    fees: quote.fees.map((fee) => ({ ...fee })),
    settlement: quote.settlement,
    liquidity: quote.liquidity,
    slippage: { kind: quote.slippage.kind },
    reliabilityScore: quote.reliabilityScore,
    executable: false,
    chainId: quote.chainId,
    metadata: quote.metadata,
  };
}

export function serializeFinancialProvider(provider: FinancialProvider): FinancialProviderDto {
  const capabilities = provider.getCapabilities();
  return {
    id: provider.descriptor.id,
    name: provider.descriptor.name,
    rail: provider.descriptor.rail,
    railLabel: RAIL_REGISTRY[provider.descriptor.rail].label,
    category: capabilities.category,
    features: [...capabilities.features],
    conversionKinds: [...capabilities.conversionKinds],
    licensing: provider.descriptor.licensing,
    description: provider.descriptor.description,
    supportedAssets: provider.getSupportedAssets().map((asset) => asset.code),
    supportedCurrencies: [...provider.getSupportedCurrencies()],
  };
}

/** Derived percentages are rounded for presentation only; the authoritative figure is the Money. */
function fixed(value: Decimal, decimalPlaces: number): string {
  return value.toDecimalPlaces(decimalPlaces).toFixed();
}

export function serializeMultiRailRouting(result: MultiRailRouting): MultiRailRoutingDto {
  const routes = result.routes.map(serializeMultiRailRoute);
  const recommended = result.recommendedRoute === null ? null : serializeMultiRailRoute(result.recommendedRoute);
  return {
    routingId: result.routingId,
    organizationId: result.organizationId,
    createdAt: result.createdAt,
    mode: result.mode,
    routingEngineVersion: result.routingEngineVersion,
    aiUsed: false,
    request: {
      sourceAsset: result.request.sourceAsset,
      destinationAsset: result.request.destinationAsset,
      amount: AssetAmount.ofMinorUnits(
        result.request.sourceAsset,
        result.request.amountMinorUnits,
      ).toJSON(),
      requestedAt: result.request.requestedAt,
    },
    scoringWeights: result.scoringWeights,
    routes,
    recommendedRoute: recommended,
    routeScore: result.routeScore === null ? null : fixed(result.routeScore, 2),
    estimatedCost: result.estimatedCost === null ? null : result.estimatedCost.toJSON(),
    estimatedReceiveAmount:
      result.estimatedReceiveAmount === null ? null : result.estimatedReceiveAmount.toJSON(),
    estimatedSettlementTime: result.estimatedSettlementTime,
    routeExplanation: result.routeExplanation,
    plannedRoutes: result.plannedRoutes.map((route) => ({ ...route })),
    providerFailures: result.providerFailures.map(serializeFailure),
  };
}

export function serializeMultiRailRoute(route: ScoredMultiRailRoute): MultiRailRouteDto {
  return {
    routeId: route.routeId,
    rank: route.rank,
    recommended: route.recommended,
    available: true,
    hops: [...route.hops],
    provider: {
      id: route.provider.id,
      name: route.provider.name,
      rail: route.rail,
      railLabel: RAIL_REGISTRY[route.rail].label,
      category: route.category,
      railFamily: route.railFamily,
      licensing: route.provider.licensing,
      pricingVersion: route.provider.pricingVersion,
    },
    conversionKind: route.conversionKind,
    sendAmount: route.sendAmount.toJSON(),
    estimatedReceiveAmount: route.deliveredAmount.toJSON(),
    estimatedCost: route.totalCost.toJSON(),
    benchmarkAmount: route.benchmarkAmount.toJSON(),
    indicatedRate: route.indicatedRate.toFixed(),
    midMarketRate: route.midMarketRate.toFixed(),
    slippageAdjustedRate: route.slippageAdjustedRate.toFixed(),
    effectiveRate: route.effectiveRate.toFixed(),
    totalCostBps: fixed(route.totalCostBps, BPS_DECIMAL_PLACES),
    spreadBps: fixed(route.spreadBps, BPS_DECIMAL_PLACES),
    slippageBps: fixed(route.slippageBps, BPS_DECIMAL_PLACES),
    liquidityHeadroom: route.liquidityHeadroom === null ? null : route.liquidityHeadroom.toFixed(),
    reliabilityScore: route.reliabilityScore.toFixed(),
    settlementConfidence: route.settlementConfidence.toFixed(),
    estimatedSettlementTime: route.settlement,
    breakdown: {
      appliedFees: route.breakdown.appliedFees.map((fee) => ({
        code: fee.code,
        label: fee.label,
        side: fee.side,
        kind: fee.kind,
        bucket: fee.bucket,
        chargedBy: fee.chargedBy,
        asset: fee.asset,
        amount: fee.amount.toJSON(),
        rateBps: fee.rateBps === null ? null : fee.rateBps.toFixed(),
      })),
      providerFee: route.breakdown.providerFee.toJSON(),
      platformFee: route.breakdown.platformFee.toJSON(),
      networkFee: route.breakdown.networkFee.toJSON(),
      gasFee: route.breakdown.gasFee.toJSON(),
      spreadCost: route.breakdown.spreadCost.toJSON(),
      slippageCost: route.breakdown.slippageCost.toJSON(),
      roundingAdjustment: route.breakdown.roundingAdjustment.toJSON(),
      totalCost: route.breakdown.totalCost.toJSON(),
    },
    compliance: { ...route.compliance, jurisdictions: [...route.compliance.jurisdictions] },
    routeScore: fixed(route.routeScore, 2),
    scoreComponents: {
      cost: route.scoreComponents.cost.toFixed(),
      speed: route.scoreComponents.speed.toFixed(),
      liquidity: route.scoreComponents.liquidity.toFixed(),
      reliability: route.scoreComponents.reliability.toFixed(),
      settlementConfidence: route.scoreComponents.settlementConfidence.toFixed(),
    },
    routeExplanation: route.routeExplanation,
    executable: false,
  };
}
