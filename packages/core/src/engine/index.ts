export {
  RouteComparisonService,
  type ComparisonInput,
  type RouteComparisonServiceDependencies,
} from './comparison-service.js';
export { RouteCostEngine, type PricingOptions } from './cost-engine.js';
export {
  NO_PLATFORM_PRICING,
  effectiveSpreadBps,
  selectPricingRule,
  spreadBpsOf,
  toPlatformPricing,
} from './platform-pricing.js';
export {
  DEFAULT_SCORING_WEIGHTS,
  ENGINE_VERSION,
  LIQUIDITY_COMFORT_MULTIPLE,
  NEUTRAL_RISK_SCORE,
  SCORING_FACTORS,
  defaultScoringWeights,
  parseScoringWeights,
  serializeScoringWeights,
  type ScoringFactor,
  type ScoringWeights,
  type ScoringWeightsInput,
  type SerializedScoringWeights,
} from './engine-config.js';
export { ProviderRegistry, type RegistryExclusion } from './provider-registry.js';
export {
  FinancialProviderRegistry,
  type FinancialRegistryExclusion,
} from './financial-registry.js';
export { assertValidProviderQuote } from './quote-validation.js';
export { RouteScorer } from './route-scorer.js';
export {
  DEFAULT_ROUTING_WEIGHTS,
  ROUTING_ENGINE_VERSION,
  ROUTING_SCORING_FACTORS,
  defaultRoutingWeights,
  parseRoutingWeights,
  serializeRoutingWeights,
  type RoutingScoringFactor,
  type RoutingWeights,
  type RoutingWeightsInput,
  type SerializedRoutingWeights,
} from './routing-config.js';
export { MultiRailCostEngine, settlementConfidenceOf, hopsOf } from './routing-cost.js';
export { MultiRailScorer } from './routing-scorer.js';
export { explainRecommendation, explainRoute } from './routing-explanation.js';
export {
  MultiRailRouter,
  plannedRoutesOf,
  type MultiRailRouterDependencies,
  type RoutingEngineInput,
} from './routing-engine.js';
export type {
  ComplianceEligibility,
  MultiRailRouting,
  PlannedRoute,
  PricedMultiRailRoute,
  RoutedAppliedFee,
  RoutingCostBreakdown,
  RoutingFeeBucket,
  RoutingRequest,
  RoutingScoreComponents,
  ScoredMultiRailRoute,
} from './routing-types.js';
