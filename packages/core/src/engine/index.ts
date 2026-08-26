export {
  RouteComparisonService,
  type ComparisonInput,
  type RouteComparisonServiceDependencies,
} from './comparison-service.js';
export { RouteCostEngine } from './cost-engine.js';
export {
  DEFAULT_SCORING_WEIGHTS,
  ENGINE_VERSION,
  defaultScoringWeights,
  parseScoringWeights,
  serializeScoringWeights,
  type ScoringWeights,
  type ScoringWeightsInput,
  type SerializedScoringWeights,
} from './engine-config.js';
export { ProviderRegistry, type RegistryExclusion } from './provider-registry.js';
export { assertValidProviderQuote } from './quote-validation.js';
export { RouteScorer } from './route-scorer.js';
