import type {
  AppliedFee,
  ChainMetadata,
  ComparisonInsights,
  CostBreakdown,
  ProviderFailure,
  ReplayResult,
  RouteComparison,
  ScoredRoute,
} from '../domain/index.js';
import type { MonetizationEvent, MonetizationReport } from '../domain/monetization.js';
import type { BillingRunResult, Invoice, ReconciliationReport } from '../domain/billing.js';
import {
  ASSET_REGISTRY,
  CHAIN_REGISTRY,
  DEFI_POOL_REGISTRY,
  DEFI_VENUE_KINDS,
  RAIL_REGISTRY,
  STABLECOIN_CONVERSION_KINDS,
  STABLECOIN_REGISTRY,
} from '../domain/index.js';
import { DEFI_ROUTING_ENGINE_VERSION } from '../engine/defi-config.js';
import type { DefiRoute, DefiRouting } from '../engine/defi-types.js';
import { STABLECOIN_ROUTING_ENGINE_VERSION } from '../engine/stablecoin-config.js';
import type { MultiRailRouting, ScoredMultiRailRoute } from '../engine/routing-types.js';
import type { QuoteFreshnessView } from '../quotes/quote-freshness.js';
import { priceRouteMonetization } from '../engine/monetization-engine.js';
import type { StablecoinRoute, StablecoinRouting } from '../engine/stablecoin-types.js';
import {
  GRAPH_ENGINE_VERSION,
  isAssetNode,
  type FinancialRouteGraph,
  type GraphEdge,
  type GraphNode,
  type GraphPath,
  type GraphSearch,
} from '../graph/index.js';
import { AssetAmount, CURRENCY_REGISTRY, Money, formatDecimal, type Decimal } from '../money/index.js';
import type {
  AgentWalletReference,
  Merchant,
  PaymentIntent,
  PaymentPolicy,
  PublicAgent,
} from '../domain/agent-payments.js';
import type {
  AgentDashboardDetail,
  AgentDashboardSummary,
  AgentPolicyViolation,
  AgentSpendingSnapshot,
} from '../domain/agent-dashboard.js';
import type { StructuredNlPaymentIntent } from '../domain/nl-intent.js';
import type { NlRouteResult } from '../engine/nl-routing-service.js';
import type { ExecutionIntent } from '../ports/execution-intent.js';
import type { FinancialProvider, NormalizedQuote } from '../ports/financial-provider.js';
import { isDeFiLiquiditySource } from '../ports/defi-liquidity.js';
import type {
  AppliedFeeDto,
  ChainMetadataDto,
  ComparisonDto,
  ComparisonInsightsDto,
  CostBreakdownDto,
  AssetCatalogEntryDto,
  CurrencyCatalogEntryDto,
  DefiCatalogDto,
  DefiRouteDto,
  DefiRoutingDto,
  ExecutionIntentDto,
  IssuedAgentDto,
  MerchantDto,
  PaymentIntentDto,
  PaymentPolicyDto,
  PublicAgentDto,
  AgentWalletReferenceDto,
  StructuredNlPaymentIntentDto,
  NlRouteResultDto,
  FinancialProviderDto,
  FinancialQuoteDto,
  GraphEdgeDto,
  GraphNodeDto,
  GraphPathDto,
  GraphSearchDto,
  MultiRailRouteDto,
  MultiRailRoutingDto,
  NormalizedQuoteDto,
  ProviderFailureDto,
  ReplayResultDto,
  QuoteFreshnessDto,
  RouteDto,
  RouteGraphDto,
  RouteSearchDto,
  StablecoinCatalogDto,
  StablecoinRouteDto,
  StablecoinRoutingDto,
  StablecoinSlippageDto,
  MonetizationReportDto,
  MonetizationEventDto,
  InvoiceDto,
  BillingRunResultDto,
  ReconciliationReportDto,
  AgentDashboardDetailDto,
  AgentDashboardSummaryDto,
  AgentPolicyViolationDto,
  AgentSpendingSnapshotDto,
  PreferredRouteRowDto,
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

function serializeQuoteFreshness(view: QuoteFreshnessView): QuoteFreshnessDto {
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
      freshness: null,
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

export function serializeMultiRailRouting(
  result: MultiRailRouting,
  extras: { readonly fingerprint: string },
): MultiRailRoutingDto {
  const routes = result.routes.map(serializeMultiRailRoute);
  const recommended = result.recommendedRoute === null ? null : serializeMultiRailRoute(result.recommendedRoute);
  return {
    routingId: result.routingId,
    organizationId: result.organizationId,
    createdAt: result.createdAt,
    mode: result.mode,
    routingEngineVersion: result.routingEngineVersion,
    aiUsed: false,
    fingerprint: extras.fingerprint,
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
    objectiveSource: result.objectiveSource,
    objectiveBounds: result.objectiveBounds,
    railHealth: result.railHealth.map((item) => ({
      providerId: item.providerId,
      rail: item.rail,
      state: item.state,
      liquidityState: item.liquidityState,
      deprioritized: item.deprioritized,
      reason: item.reason,
    })),
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
    monetization: serializeRouteMonetization(result),
  };
}

function serializeRouteMonetization(result: MultiRailRouting): MultiRailRoutingDto['monetization'] {
  const route = result.recommendedRoute;
  if (route === null) {
    return null;
  }
  const priced = priceRouteMonetization(route);
  return {
    eventType: 'ROUTE_QUOTE',
    stage: 'route_quote',
    realizedRevenue: false,
    fundsMoved: false,
    custody: false,
    realExecution: false,
    routeId: route.routeId,
    quoteId: result.routingId,
    providerId: route.provider.id,
    providerName: route.provider.name,
    currency: route.sendAmount.asset,
    asset: route.sendAmount.asset,
    tpvMinorUnits: priced.tpvMinorUnits,
    providerCostMinorUnits: priced.providerCostMinorUnits,
    platformFeeMinorUnits: priced.platformRevenueMinorUnits,
    partnerCommissionMinorUnits: priced.partnerCommissionMinorUnits,
    grossMarginMinorUnits: priced.grossProfitMinorUnits,
    takeRateBps: priced.takeRateBps,
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
    quoteFreshness: serializeQuoteFreshness(route.quoteFreshness),
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
      liquidityFee: route.breakdown.liquidityFee.toJSON(),
      surchargeFee: route.breakdown.surchargeFee.toJSON(),
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
      finality: route.scoreComponents.finality.toFixed(),
      fxRate: route.scoreComponents.fxRate.toFixed(),
      slippage: route.scoreComponents.slippage.toFixed(),
      liquidity: route.scoreComponents.liquidity.toFixed(),
      compliance: route.scoreComponents.compliance.toFixed(),
    },
    routeExplanation: route.routeExplanation,
    railHealth: {
      state: route.railHealth.state,
      liquidityState: route.railHealth.liquidityState,
      deprioritized: route.railHealth.deprioritized,
      reason: route.railHealth.reason,
    },
    bestExecution: {
      selected: route.bestExecution.selected,
      rank: route.bestExecution.rank,
      competingRouteCount: route.bestExecution.competingRouteCount,
      rationale: route.bestExecution.rationale,
      rationaleHash: route.bestExecution.rationaleHash,
      alternatives: route.bestExecution.alternatives.map((item) => ({ ...item })),
    },
    executable: false,
  };
}

export function serializeRouteGraph(graph: FinancialRouteGraph): RouteGraphDto {
  return {
    graphEngineVersion: GRAPH_ENGINE_VERSION,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    nodes: graph.nodes.map(serializeGraphNode),
    edges: graph.edges.map(serializeGraphEdge),
    executable: false,
  };
}

export function serializeGraphSearch(search: GraphSearch): GraphSearchDto {
  const paths = search.discovery.paths.map((path, index) =>
    serializeGraphPath(path, index, search.discovery.recommendedPath?.pathId ?? null),
  );
  const recommended = search.discovery.recommendedPath;
  return {
    searchId: search.searchId,
    organizationId: search.organizationId,
    createdAt: search.createdAt,
    mode: search.mode,
    graphEngineVersion: search.discovery.graphEngineVersion,
    aiUsed: false,
    executable: false,
    request: {
      sourceAsset: search.discovery.sourceAsset,
      destinationAsset: search.discovery.destinationAsset,
    },
    constraints: { ...search.discovery.constraints },
    paths,
    recommendedPath:
      recommended === null ? null : serializeGraphPath(recommended, 0, recommended.pathId),
    rejections: search.discovery.rejections.map((rejection) => ({ ...rejection })),
    explanation: search.discovery.explanation,
  };
}

function serializeGraphPath(
  path: GraphPath,
  rankIndex: number,
  recommendedId: string | null,
): GraphPathDto {
  return {
    pathId: path.pathId,
    hops: path.hops,
    rank: rankIndex + 1,
    recommended: path.pathId === recommendedId,
    nodes: path.nodes.map(serializeGraphNode),
    edges: path.edges.map(serializeGraphEdge),
    assets: [...path.assets],
    providers: [...path.providers],
    totalCostBps: formatDecimal(path.totalCostBps),
    minLiquidityMinorUnits:
      path.minLiquidityMinorUnits === null ? null : path.minLiquidityMinorUnits.toString(),
    minLiquidityAsset: path.minLiquidityAsset,
    explanation: path.explanation,
    executable: false,
  };
}

function serializeGraphNode(node: GraphNode): GraphNodeDto {
  if (isAssetNode(node)) {
    return {
      id: node.id,
      kind: node.kind,
      label: node.label,
      asset: node.asset,
      providerId: null,
      available: null,
    };
  }
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    asset: null,
    providerId: node.providerId,
    available: node.available,
  };
}

function serializeGraphEdge(edge: GraphEdge): GraphEdgeDto {
  return {
    id: edge.id,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    viaNodeId: edge.viaNodeId,
    providerId: edge.providerId,
    conversionKind: edge.conversionKind,
    available: edge.available,
    costBps: formatDecimal(edge.costBps),
    liquidityMinorUnits:
      edge.liquidityMinorUnits === null ? null : edge.liquidityMinorUnits.toString(),
    liquidityAsset: edge.liquidityAsset,
    complianceEligible: edge.complianceEligible,
    executable: false,
  };
}

export function serializeStablecoinCatalog(): StablecoinCatalogDto {
  return {
    stablecoinRoutingEngineVersion: STABLECOIN_ROUTING_ENGINE_VERSION,
    conversionKinds: [...STABLECOIN_CONVERSION_KINDS],
    custody: false,
    connectedToMainnet: false,
    walletsCreated: false,
    privateKeysGenerated: false,
    executable: false,
    delegateExecution: false,
    stablecoins: Object.values(STABLECOIN_REGISTRY)
      .sort((left, right) => left.code.localeCompare(right.code, 'en'))
      .map((definition) => ({
        code: definition.code,
        name: definition.name,
        exponent: definition.exponent,
        pegCurrency: definition.pegCurrency,
        issuer: definition.issuer,
        defaultChain: serializeChainMetadata(CHAIN_REGISTRY[definition.defaultChainId]),
        chains: definition.chains.map((entry) => ({
          ...serializeChainMetadata(CHAIN_REGISTRY[entry.chainId]),
          status: entry.status,
        })),
        custodiedByPlatform: false as const,
      })),
    chains: Object.values(CHAIN_REGISTRY).map(serializeChainMetadata),
    explanation:
      'Demo USDC and USDT. Adding a stablecoin is a registry row plus adapter rates — routing ' +
      'does not switch on ticker. Meridian never holds the token, connects to a chain, or creates a wallet.',
  };
}

export function serializeStablecoinRouting(result: StablecoinRouting): StablecoinRoutingDto {
  const routes = result.routes.map(serializeStablecoinRoute);
  return {
    routingId: result.routingId,
    organizationId: result.organizationId,
    createdAt: result.createdAt,
    mode: result.mode,
    stablecoinRoutingEngineVersion: result.stablecoinRoutingEngineVersion,
    conversionKind: result.conversionKind,
    aiUsed: false,
    custody: false,
    connectedToMainnet: false,
    walletsCreated: false,
    privateKeysGenerated: false,
    executable: false,
    delegateExecution: false,
    request: {
      sourceAsset: result.request.sourceAsset,
      destinationAsset: result.request.destinationAsset,
      amount: AssetAmount.ofMinorUnits(
        result.request.sourceAsset,
        result.request.amountMinorUnits,
      ).toJSON(),
      requestedAt: result.request.requestedAt,
    },
    routes,
    recommendedRoute: result.recommendedRoute === null ? null : serializeStablecoinRoute(result.recommendedRoute),
    providerFailures: result.providerFailures.map(serializeFailure),
    explanation: result.explanation,
  };
}

export function serializeStablecoinRoute(route: StablecoinRoute): StablecoinRouteDto {
  return {
    routeId: route.routeId,
    rank: route.rank,
    recommended: route.recommended,
    conversionKind: route.conversionKind,
    asset: { ...route.asset },
    chain: {
      source: serializeOptionalChain(route.chain.source),
      destination: serializeOptionalChain(route.chain.destination),
      settlement: serializeOptionalChain(route.chain.settlement),
    },
    price: {
      indicated: route.price.indicated.toFixed(),
      mid: route.price.mid.toFixed(),
    },
    providerFee: route.providerFee.toJSON(),
    networkFee: route.networkFee.toJSON(),
    slippage: serializeStablecoinSlippage(route.slippage),
    liquidity: {
      availableDepthMinorUnits: route.liquidity.availableDepthMinorUnits,
      venue: route.liquidity.venue,
      chain: serializeOptionalChain(route.liquidity.chain),
    },
    estimatedSettlementTime: route.estimatedSettlementTime,
    expiration: route.expiration,
    estimatedReceiveAmount: route.estimatedReceiveAmount.toJSON(),
    estimatedCost: route.estimatedCost.toJSON(),
    totalCostBps: fixed(route.totalCostBps, BPS_DECIMAL_PLACES),
    hops: [...route.hops],
    provider: {
      id: route.provider.id,
      name: route.provider.name,
      rail: route.provider.rail,
      railLabel: RAIL_REGISTRY[route.provider.rail].label,
      category: route.provider.category,
      railFamily: route.provider.railFamily,
      licensing: route.provider.licensing,
    },
    explanation: route.explanation,
    custody: false,
    connectedToMainnet: false,
    walletsCreated: false,
    privateKeysGenerated: false,
    executable: false,
    delegateExecution: false,
  };
}

function serializeStablecoinSlippage(slippage: StablecoinRoute['slippage']): StablecoinSlippageDto {
  if (slippage.model.kind === 'none') {
    return { bps: fixed(slippage.bps, BPS_DECIMAL_PLACES), model: { kind: 'none' } };
  }
  return {
    bps: fixed(slippage.bps, BPS_DECIMAL_PLACES),
    model: {
      kind: 'tiered',
      notionalCurrency: slippage.model.notionalCurrency,
      tiers: slippage.model.tiers.map((tier) => ({
        upToNotionalMinorUnits: tier.upToNotionalMinorUnits,
        bps: tier.bps,
      })),
    },
  };
}

function serializeOptionalChain(chain: ChainMetadata | null): ChainMetadataDto | null {
  return chain === null ? null : serializeChainMetadata(chain);
}

function serializeChainMetadata(chain: ChainMetadata): ChainMetadataDto {
  return {
    id: chain.id,
    namespace: chain.namespace,
    reference: chain.reference,
    name: chain.name,
    nativeAsset: chain.nativeAsset,
    testnet: chain.testnet,
    quoting: chain.quoting,
    connected: false,
    rpcUrl: null,
  };
}

export function serializeDefiCatalog(providers: readonly FinancialProvider[]): DefiCatalogDto {
  const venues = providers
    .filter(isDeFiLiquiditySource)
    .sort((left, right) => left.descriptor.id.localeCompare(right.descriptor.id, 'en'))
    .map((venue) => ({
      id: venue.descriptor.id,
      name: venue.descriptor.name,
      venueKind: venue.venueKind,
      tokens: venue.getSupportedTokens().map((asset) => asset.code),
      chains: venue.getSupportedChains().map(serializeChainMetadata),
    }));
  return {
    defiRoutingEngineVersion: DEFI_ROUTING_ENGINE_VERSION,
    venueKinds: [...DEFI_VENUE_KINDS],
    custody: false,
    connectedToMainnet: false,
    walletsCreated: false,
    walletsConnected: false,
    privateKeysGenerated: false,
    swapSubmitted: false,
    executable: false,
    delegateExecution: false,
    pools: DEFI_POOL_REGISTRY.map((pool) => ({
      id: pool.id,
      baseAsset: pool.baseAsset,
      quoteAsset: pool.quoteAsset,
      defaultChain: serializeChainMetadata(CHAIN_REGISTRY[pool.defaultChainId]),
      status: pool.status,
      custodiedByPlatform: false as const,
    })),
    venues,
    chains: Object.values(CHAIN_REGISTRY).map(serializeChainMetadata),
    explanation:
      'Demo DEX, AMM and aggregator venues for USDC/USDT, ETH/USDC and ETH/USDT. ' +
      'When a stablecoin ramp or traditional FX desk can price the same pair, those quotes are ' +
      'ranked together. Adding a chain is a registry row — the engine does not switch on Ethereum, ' +
      'Base, Arbitrum or Solana. Meridian never submits a swap, connects a wallet or holds a key.',
  };
}

export function serializeDefiRouting(result: DefiRouting): DefiRoutingDto {
  const routes = result.routes.map(serializeDefiRoute);
  const recommended = result.recommendedRoute === null ? null : serializeDefiRoute(result.recommendedRoute);
  return {
    routingId: result.routingId,
    organizationId: result.organizationId,
    createdAt: result.createdAt,
    mode: result.mode,
    defiRoutingEngineVersion: result.defiRoutingEngineVersion,
    conversionKind: result.conversionKind,
    aiUsed: false,
    custody: false,
    connectedToMainnet: false,
    walletsCreated: false,
    walletsConnected: false,
    privateKeysGenerated: false,
    swapSubmitted: false,
    executable: false,
    delegateExecution: false,
    request: {
      sourceAsset: result.request.sourceAsset,
      destinationAsset: result.request.destinationAsset,
      amount: AssetAmount.ofMinorUnits(
        result.request.sourceAsset,
        result.request.amountMinorUnits,
      ).toJSON(),
      requestedAt: result.request.requestedAt,
    },
    routes,
    recommendedRoute: recommended,
    recommendedExecutionRoute:
      result.recommendedExecutionRoute === null
        ? null
        : serializeDefiRoute(result.recommendedExecutionRoute),
    comparedFamilies: [...result.comparedFamilies],
    providerFailures: result.providerFailures.map(serializeFailure),
    explanation: result.explanation,
  };
}

export function serializeDefiRoute(route: DefiRoute): DefiRouteDto {
  return {
    routeId: route.routeId,
    rank: route.rank,
    recommended: route.recommended,
    routeKind: route.routeKind,
    venueKind: route.venueKind,
    conversionKind: route.conversionKind,
    asset: { ...route.asset },
    chain: {
      source: serializeOptionalChain(route.chain.source),
      destination: serializeOptionalChain(route.chain.destination),
      settlement: serializeOptionalChain(route.chain.settlement),
    },
    price: {
      indicated: route.price.indicated.toFixed(),
      mid: route.price.mid.toFixed(),
    },
    swapFee: route.swapFee.toJSON(),
    networkFee: route.networkFee.toJSON(),
    estimatedSlippage: serializeStablecoinSlippage(route.estimatedSlippage),
    liquidity: {
      availableDepthMinorUnits: route.liquidity.availableDepthMinorUnits,
      venue: route.liquidity.venue,
      chain: serializeOptionalChain(route.liquidity.chain),
    },
    estimatedSettlementTime: route.estimatedSettlementTime,
    expiration: route.expiration,
    estimatedReceiveAmount: route.estimatedReceiveAmount.toJSON(),
    estimatedCost: route.estimatedCost.toJSON(),
    totalCostBps: fixed(route.totalCostBps, BPS_DECIMAL_PLACES),
    hops: [...route.hops],
    provider: {
      id: route.provider.id,
      name: route.provider.name,
      rail: route.provider.rail,
      railLabel: RAIL_REGISTRY[route.provider.rail].label,
      category: route.provider.category,
      railFamily: route.provider.railFamily,
      licensing: route.provider.licensing,
    },
    explanation: route.explanation,
    custody: false,
    connectedToMainnet: false,
    walletsCreated: false,
    walletsConnected: false,
    privateKeysGenerated: false,
    swapSubmitted: false,
    executable: false,
    delegateExecution: false,
  };
}

export function serializeFinancialQuote(
  routing: MultiRailRouting,
  requestId: string,
  extras: { readonly fingerprint: string },
): FinancialQuoteDto {
  const routes = routing.routes.map(serializeMultiRailRoute);
  const recommended =
    routing.recommendedRoute === null ? null : serializeMultiRailRoute(routing.recommendedRoute);
  return {
    requestId,
    routes,
    recommendedRoute: recommended,
    quoteExpiresAt: earliestQuoteExpiry(routing.routes),
    fingerprint: extras.fingerprint,
    routingId: routing.routingId,
  };
}

function earliestQuoteExpiry(routes: readonly ScoredMultiRailRoute[]): string | null {
  let earliest: string | null = null;
  for (const route of routes) {
    const expiresAt = route.quote.expiresAt;
    if (earliest === null || expiresAt < earliest) {
      earliest = expiresAt;
    }
  }
  return earliest;
}

export function serializeRouteSearch(input: {
  readonly requestId: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly graph: GraphSearch;
  readonly matchingProviders: readonly FinancialProvider[];
}): RouteSearchDto {
  return {
    requestId: input.requestId,
    sourceAsset: input.sourceAsset,
    destinationAsset: input.destinationAsset,
    graph: serializeGraphSearch(input.graph),
    matchingProviders: input.matchingProviders.map(serializeFinancialProvider),
    executable: false,
  };
}

export function serializeExecutionIntent(intent: ExecutionIntent): ExecutionIntentDto {
  return {
    id: intent.id,
    organizationId: intent.organizationId,
    requestId: intent.requestId,
    routeId: intent.routeId,
    sourceAsset: intent.sourceAsset,
    destinationAsset: intent.destinationAsset,
    amountMinorUnits: intent.amountMinorUnits,
    status: 'recorded',
    executable: false,
    submitted: false,
    quoteExpiresAt: intent.quoteExpiresAt,
    createdAt: intent.createdAt,
  };
}

export function serializeAssetCatalog(): readonly AssetCatalogEntryDto[] {
  return Object.values(ASSET_REGISTRY)
    .map((asset) => ({
      code: asset.code,
      kind: asset.kind,
      decimals: asset.exponent,
      displayName: asset.name,
      networks: asset.chainId === null ? [] : [asset.chainId],
    }))
    .sort((left, right) => left.code.localeCompare(right.code, 'en'));
}

export function serializeCurrencyCatalog(): readonly CurrencyCatalogEntryDto[] {
  return Object.values(CURRENCY_REGISTRY)
    .map((currency) => ({
      code: currency.code,
      decimals: currency.exponent,
      name: currency.name,
    }))
    .sort((left, right) => left.code.localeCompare(right.code, 'en'));
}

export function serializePaymentIntent(intent: PaymentIntent): PaymentIntentDto {
  return {
    id: intent.id,
    organizationId: intent.organizationId,
    agentId: intent.agentId,
    sourceAsset: intent.sourceAsset,
    destinationAsset: intent.destinationAsset,
    amount: AssetAmount.ofMinorUnits(intent.sourceAsset, intent.amountMinorUnits).toJSON(),
    recipient: intent.recipient,
    purpose: intent.purpose,
    routePreference: intent.routePreference,
    maxFeeBps: intent.maxFeeBps,
    expiresAt: intent.expiresAt,
    status: intent.status,
    quotedRoutes: intent.quotedRoutes.map((route) => ({ ...route })),
    quoteExpiresAt: intent.quoteExpiresAt,
    selectedRouteId: intent.selectedRouteId,
    authorizedAt: intent.authorizedAt,
    simulatedAt: intent.simulatedAt,
    simulation: intent.simulation,
    failureReason: intent.failureReason,
    fundsMoved: false,
    custody: false,
    realExecution: false,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
  };
}

export function serializePublicAgent(agent: PublicAgent): PublicAgentDto {
  return {
    id: agent.id,
    organizationId: agent.organizationId,
    name: agent.name,
    status: agent.status,
    createdAt: agent.createdAt,
    keyPrefix: agent.keyPrefix,
    scopes: [...agent.scopes],
    credentialExpiresAt: agent.credentialExpiresAt,
    credentialRevokedAt: agent.credentialRevokedAt,
    executionAuthorized: agent.executionAuthorized,
    executionAuthorizedAt: agent.executionAuthorizedAt,
    executionAuthorizedByActor: agent.executionAuthorizedByActor,
    executionAgreementReference: agent.executionAgreementReference,
  };
}

export function serializeIssuedAgent(agent: PublicAgent, secret: string): IssuedAgentDto {
  return { ...serializePublicAgent(agent), secret };
}

export function serializeWalletReference(reference: AgentWalletReference): AgentWalletReferenceDto {
  return {
    id: reference.id,
    organizationId: reference.organizationId,
    agentId: reference.agentId,
    kind: reference.kind,
    label: reference.label,
    externalRef: reference.externalRef,
    controlledByPlatform: false,
    createdAt: reference.createdAt,
  };
}

export function serializeMerchant(merchant: Merchant): MerchantDto {
  return {
    id: merchant.id,
    organizationId: merchant.organizationId,
    name: merchant.name,
    recipientCode: merchant.recipientCode,
    settlementAsset: merchant.settlementAsset,
    status: merchant.status,
    createdAt: merchant.createdAt,
  };
}

export function serializePaymentPolicy(policy: PaymentPolicy): PaymentPolicyDto {
  return {
    id: policy.id,
    organizationId: policy.organizationId,
    agentId: policy.agentId,
    maxTransactionAmountMinorUnits: policy.maxTransactionAmountMinorUnits,
    allowedAssets: [...policy.allowedAssets],
    allowedRecipientCodes: [...policy.allowedRecipientCodes],
    allowedProviderIds: [...policy.allowedProviderIds],
    allowedChainIds: [...policy.allowedChainIds],
    allowedCountryCodes: [...policy.allowedCountryCodes],
    maxFeeBps: policy.maxFeeBps,
    maxSlippageBps: policy.maxSlippageBps,
    minRouteScore: policy.minRouteScore,
    minLiquidityHeadroom: policy.minLiquidityHeadroom,
    dailySpendingLimitMinorUnits: policy.dailySpendingLimitMinorUnits,
    dailySpendingAsset: policy.dailySpendingAsset,
    preferredRoutePreference: policy.preferredRoutePreference,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
  };
}

export function serializeNlInterpretation(
  intent: StructuredNlPaymentIntent,
  financialsComputedBy: 'routing_engine' | null,
): StructuredNlPaymentIntentDto {
  return {
    amount: { ...intent.amount },
    sourceAsset: intent.sourceAsset,
    destinationAsset: intent.destinationAsset,
    recipient: intent.recipient,
    optimizationPreference: intent.optimizationPreference,
    instruction: intent.instruction,
    interpreter: 'deterministic_parser',
    aiUsed: false,
    financialsComputedBy,
    didNotCompute: [...intent.didNotCompute],
  };
}

export function serializeNlRouteResult(result: NlRouteResult): NlRouteResultDto {
  return {
    interpretation: serializeNlInterpretation(result.interpretation, 'routing_engine'),
    paymentIntent: serializePaymentIntent(result.paymentIntent),
    selectedRoute:
      result.selectedRoute === null ? null : { ...result.selectedRoute },
    executionIntent: serializeExecutionIntent(result.executionIntent),
    pipelineCompleted: [...result.pipelineCompleted],
    interpreter: 'deterministic_parser',
    aiUsed: false,
    financialsComputedBy: 'routing_engine',
    didNotCompute: [...result.didNotCompute],
    fundsMoved: false,
    custody: false,
    realExecution: false,
    executable: false,
    submitted: false,
  };
}

export function serializeMonetizationReport(report: MonetizationReport): MonetizationReportDto {
  return {
    summary: { ...report.summary },
    byRail: report.byRail.map((row) => ({ ...row })),
    byProvider: report.byProvider.map((row) => ({ ...row })),
    byCurrency: report.byCurrency.map((row) => ({ ...row })),
    byAsset: report.byAsset.map((row) => ({ ...row })),
    byOrganization: report.byOrganization.map((row) => ({ ...row })),
    byAgent: report.byAgent.map((row) => ({ ...row })),
    byTransactionType: report.byTransactionType.map((row) => ({ ...row })),
    byRevenueSource: report.byRevenueSource.map((row) => ({ ...row })),
    byDate: report.byDate.map((row) => ({ ...row })),
    events: report.events.map(serializeMonetizationEvent),
    workedExample: { ...report.workedExample },
    fundsMoved: false,
  };
}

function serializeMonetizationEvent(event: MonetizationEvent): MonetizationEventDto {
  return {
    id: event.id,
    organizationId: event.organizationId,
    occurredAt: event.occurredAt,
    transactionType: event.transactionType,
    revenueSource: event.revenueSource,
    rail: event.rail,
    providerId: event.providerId,
    providerName: event.providerName,
    currency: event.currency,
    asset: event.asset,
    destinationAsset: event.destinationAsset,
    agentId: event.agentId,
    tpvMinorUnits: event.tpvMinorUnits,
    providerCostMinorUnits: event.providerCostMinorUnits,
    platformRevenueMinorUnits: event.platformRevenueMinorUnits,
    partnerCommissionMinorUnits: event.partnerCommissionMinorUnits,
    grossProfitMinorUnits: event.grossProfitMinorUnits,
    takeRateBps: event.takeRateBps,
    fundsMoved: false,
    custody: false,
    realExecution: false,
    routeId: event.routeId,
    quoteId: event.quoteId,
    economicStage: event.economicStage,
    realizedRevenue: false,
    revenueRecognition: event.revenueRecognition,
    invoiceId: event.invoiceId,
  };
}

export function serializeInvoice(invoice: Invoice): InvoiceDto {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    organizationId: invoice.organizationId,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    currency: invoice.currency,
    status: 'issued',
    collectionStatus: 'uncollected',
    issuerLegalEntity: 'unconfirmed',
    taxCalculation: 'deferred',
    subtotalMinorUnits: invoice.subtotalMinorUnits,
    taxMinorUnits: '0',
    totalMinorUnits: invoice.totalMinorUnits,
    issuedAt: invoice.issuedAt,
    issuedByActor: invoice.issuedByActor,
    realizedRevenue: false,
    collected: false,
    lines: invoice.lines.map((line) => ({ ...line })),
  };
}

export function serializeBillingRunResult(result: BillingRunResult): BillingRunResultDto {
  return {
    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
    cadence: 'utc_calendar_month',
    invoices: result.invoices.map(serializeInvoice),
    createdInvoiceIds: [...result.createdInvoiceIds],
    reusedInvoiceIds: [...result.reusedInvoiceIds],
    skippedOrganizationIds: [...result.skippedOrganizationIds],
  };
}

export function serializeReconciliationReport(
  report: ReconciliationReport,
): ReconciliationReportDto {
  return {
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    cadence: 'utc_calendar_month',
    collectionStatus: 'deferred',
    taxCalculation: 'deferred',
    issuerLegalEntity: 'unconfirmed',
    billedSnapshotIds: [...report.billedSnapshotIds],
    byCurrency: report.byCurrency.map((row) => ({
      ...row,
      collectedPlatformRevenueMinorUnits: '0',
      duplicateBilledSnapshotIds: [...row.duplicateBilledSnapshotIds],
    })),
  };
}

export function serializeAgentDashboardSummary(
  summary: AgentDashboardSummary,
): AgentDashboardSummaryDto {
  return {
    agentId: summary.agentId,
    name: summary.name,
    status: summary.status,
    createdAt: summary.createdAt,
    transactionCount: summary.transactionCount,
    completedCount: summary.completedCount,
    failedCount: summary.failedCount,
    quotedCount: summary.quotedCount,
    policyViolationCount: summary.policyViolationCount,
    paymentVolumeMinorUnits: summary.paymentVolumeMinorUnits,
    currency: summary.currency,
    exponent: summary.exponent,
    averageFeeBps: summary.averageFeeBps,
    routeSuccessRatePercent: summary.routeSuccessRatePercent,
    preferredRoute:
      summary.preferredRoute === null ? null : serializePreferredRoute(summary.preferredRoute),
    dailySpentMinorUnits: summary.dailySpentMinorUnits,
    dailyLimitMinorUnits: summary.dailyLimitMinorUnits,
    fundsMoved: false,
    custody: false,
    executionAuthorized: summary.executionAuthorized,
    executionAuthorizedAt: summary.executionAuthorizedAt,
    executionAuthorizedByActor: summary.executionAuthorizedByActor,
    executionAgreementReference: summary.executionAgreementReference,
  };
}

export function serializeAgentDashboardDetail(
  detail: AgentDashboardDetail,
): AgentDashboardDetailDto {
  return {
    summary: serializeAgentDashboardSummary(detail.summary),
    spending: detail.spending === null ? null : serializeAgentSpendingSnapshot(detail.spending),
    preferredRoutes: detail.preferredRoutes.map(serializePreferredRoute),
    violations: detail.violations.map(serializeAgentPolicyViolation),
    fundsMoved: false,
    custody: false,
    walletsGenerated: false,
    privateKeysHeld: false,
  };
}

export function serializeAgentSpendingSnapshot(
  spending: AgentSpendingSnapshot,
): AgentSpendingSnapshotDto {
  return {
    asset: spending.asset,
    exponent: spending.exponent,
    dailyLimitMinorUnits: spending.dailyLimitMinorUnits,
    dailySpentMinorUnits: spending.dailySpentMinorUnits,
    dailyRemainingMinorUnits: spending.dailyRemainingMinorUnits,
    maxTransactionMinorUnits: spending.maxTransactionMinorUnits,
    preferredRoutePreference: spending.preferredRoutePreference,
  };
}

export function serializeAgentPolicyViolation(
  violation: AgentPolicyViolation,
): AgentPolicyViolationDto {
  return {
    eventId: violation.eventId,
    occurredAt: violation.occurredAt,
    agentId: violation.agentId,
    rule: violation.rule,
    message: violation.message,
    paymentIntentId: violation.paymentIntentId,
  };
}

function serializePreferredRoute(row: {
  readonly providerId: string;
  readonly providerName: string;
  readonly rail: string;
  readonly intentCount: number;
}): PreferredRouteRowDto {
  return {
    providerId: row.providerId,
    providerName: row.providerName,
    rail: row.rail,
    intentCount: row.intentCount,
  };
}
