export {
  SNAPSHOT_VERSION,
  type ComparisonInsights,
  type ComparisonSnapshot,
  type ReplayDivergence,
  type ReplayResult,
  type RouteComparison,
} from './comparison.js';
export {
  EMPTY_FEE_SCHEDULE,
  type FeeComponent,
  type FeeSchedule,
  type FeeSide,
  type FixedFeeComponent,
  type ProportionalFeeComponent,
} from './fees.js';
export type { JsonObject, JsonPrimitive, JsonValue } from './json.js';
export type { PlatformPricing, PlatformPricingRule, PricingCriteria } from './platform-pricing.js';
export {
  PLATFORM_MODES,
  PROVIDER_LICENSING,
  type PlatformMode,
  type ProviderDescriptor,
  type ProviderId,
  type ProviderLicensing,
} from './provider.js';
export type {
  NoSlippageModel,
  ProviderQuote,
  QuoteRequest,
  SettlementEstimate,
  SlippageModel,
  TieredSlippageModel,
} from './quote.js';
export {
  RAIL_REGISTRY,
  RAIL_TYPES,
  isRailType,
  type RailDefinition,
  type RailType,
} from './rail.js';
export type {
  AppliedFee,
  CostBreakdown,
  FeeCharger,
  PricedRoute,
  ProviderFailure,
  ScoreComponents,
  ScoredRoute,
} from './route.js';
