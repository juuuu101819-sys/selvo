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
export {
  ProviderRegistry,
  type ProviderRegistryOptions,
  type RegistryExclusion,
} from './provider-registry.js';
export {
  FinancialProviderRegistry,
  type FinancialRegistryExclusion,
} from './financial-registry.js';
export { assertValidProviderQuote } from './quote-validation.js';
export { RouteScorer } from './route-scorer.js';
export {
  DEFAULT_OBJECTIVE_WEIGHT_BOUNDS,
  DEFAULT_ROUTING_WEIGHTS,
  ROUTING_ENGINE_VERSION,
  ROUTING_SCORING_FACTORS,
  defaultRoutingWeights,
  parseRoutingWeights,
  serializeRoutingWeights,
  zeroedRoutingWeights,
  type ObjectiveWeightBound,
  type RoutingObjectiveSource,
  type RoutingScoringFactor,
  type RoutingWeights,
  type RoutingWeightsInput,
  type SerializedObjectiveWeightBounds,
  type SerializedRoutingWeights,
} from './routing-config.js';
export {
  DEGRADED_SCORE_MULTIPLIER,
  DRY_LIQUIDITY_SCORE_MULTIPLIER,
  MemoryRailHealthMonitor,
  RAIL_DEGRADED_RELIABILITY,
  RAIL_DOWN_RELIABILITY,
  RAIL_DRY_HEADROOM,
  RAIL_HEALTH_STATES,
  THIN_LIQUIDITY_SCORE_MULTIPLIER,
  healthMultiplier,
  observeRoute,
  type LiquidityState,
  type RailHealthMonitor,
  type RailHealthObservation,
  type RailHealthState,
} from './rail-health.js';
export { attestBestExecution } from './best-execution.js';
export {
  costDistribution,
  settlementTimeDistribution,
  simulateRoute,
  slippageDistribution,
  type RouteSimulation,
  type SimulationPercentiles,
} from './routing-simulation.js';
export {
  MultiRailCostEngine,
  NO_ROUTING_PLATFORM_CHARGE,
  settlementConfidenceOf,
  hopsOf,
} from './routing-cost.js';
export { admitNormalizedQuote } from './quote-admission.js';
export { MultiRailScorer } from './routing-scorer.js';
export { explainRecommendation, explainRoute } from './routing-explanation.js';
export {
  MultiRailRouter,
  plannedRoutesOf,
  type MultiRailRouterDependencies,
  type RoutingEngineInput,
} from './routing-engine.js';
export {
  isRoutingComparisonSnapshot,
  fingerprintableRoutingSnapshot,
  snapshotFromRouting,
  capabilitiesFromRouting,
  ROUTING_COMPARISON_SNAPSHOT_KIND,
  ROUTING_COMPARISON_SNAPSHOT_VERSION,
  type RoutingComparisonSnapshot,
} from './routing-snapshot.js';
export { captureRoutingFingerprint } from './routing-fingerprint.js';
export {
  RoutingEvaluationService,
  canAccessEvaluation,
  type RoutingEvaluationServiceDependencies,
  type RoutingReplayResult,
} from './routing-evaluation-service.js';
export {
  ComparisonRoutingService,
  type ComparisonRoutingServiceDependencies,
  type RoutingBackedComparison,
} from './comparison-routing-service.js';
export {
  routingWeightsFromComparisonInput,
  serializeComparisonFromRouting,
} from './comparison-from-routing.js';
export type {
  ComplianceEligibility,
  MultiRailRouting,
  PlannedRoute,
  PricedMultiRailRoute,
  RoutedAppliedFee,
  RoutingCostBreakdown,
  RoutingFeeBucket,
  RoutingPlatformCharge,
  RoutingRequest,
  RoutingScoreComponents,
  ScoredMultiRailRoute,
  BestExecutionAttestation,
  BestExecutionAlternative,
} from './routing-types.js';
export { STABLECOIN_ROUTING_ENGINE_VERSION } from './stablecoin-config.js';
export {
  explainStablecoinRoute,
  explainStablecoinRouting,
  projectStablecoinRoute,
} from './stablecoin-project.js';
export {
  StablecoinRouter,
  type StablecoinRouterDependencies,
  type StablecoinRoutingInput,
} from './stablecoin-routing.js';
export type {
  StablecoinQuoteRequest,
  StablecoinRoute,
  StablecoinRouting,
} from './stablecoin-types.js';
export { DEFI_ROUTING_ENGINE_VERSION } from './defi-config.js';
export { explainDefiRoute, explainDefiRouting, projectDefiRoute } from './defi-project.js';
export {
  DefiRouter,
  type DefiRouterDependencies,
  type DefiRoutingInput,
} from './defi-routing.js';
export type { DefiQuoteRequest, DefiRoute, DefiRouting } from './defi-types.js';
export {
  AgentPaymentService,
  type AgentPaymentServiceDependencies,
  type CreatePaymentIntentCommand,
} from './agent-payment-service.js';
export {
  aggregateMonetization,
  buildMonetizationEvent,
  convertDestMinorToSource,
  monetizationFromQuotedAgentRoute,
  monetizationFromRecommendedFiatRoute,
  monetizationFromMultiRailRoute,
  priceRouteMonetization,
  priceMonetization,
  type MonetizationComputation,
  type MonetizationPriceInput,
} from './monetization-engine.js';
export {
  draftInvoiceFromSnapshots,
  invoiceNumberFor,
  isBillableShape,
  isBillableSnapshot,
  reconcilePeriod,
  runMonthlyBilling,
  utcMonthWindow,
  type BillingRunDependencies,
  type BillingRunInput,
} from './billing-engine.js';
export {
  NlRoutingService,
  NL_INTERPRET_PIPELINE,
  NL_ROUTE_PIPELINE,
  type NlInterpretCommand,
  type NlRouteCommand,
  type NlRouteResult,
  type NlRoutingServiceDependencies,
} from './nl-routing-service.js';
export {
  SANDBOX_SIMULATION_RECEIPT,
  SANDBOX_SIMULATOR_PROVIDER_ID,
  simulateSandboxExecution,
} from './sandbox-simulator.js';
export {
  buildAgentDashboardDetail,
  summarizeAgentDashboard,
  violationFromAuditPayload,
} from './agent-dashboard.js';
export { MandateService, type MandateServiceDependencies } from './mandate-service.js';
export {
  ExecutionPartnerRegistry,
  type ExecutionPartnerExclusion,
  type ExecutionPartnerRegistryOptions,
} from './execution-partner-registry.js';
export {
  PartnerInstructionService,
  type DispatchPartnerInstructionCommand,
  type PartnerCatalogEntry,
  type PartnerInstructionPublic,
  type PartnerInstructionServiceDependencies,
} from './partner-instruction-service.js';
export {
  corridorAllowed,
  hashExecutionInstruction,
  hoursOpen,
  partnerSupportsRequest,
  type PartnerMatchRequest,
} from './partner-capability.js';
export {
  advanceSandboxSimulation,
  applySandboxWebhook,
  initialSandboxDispatch,
  type SandboxSimulationState,
} from './sandbox-partner-simulation.js';
export {
  partnerInstructionHmacPayload,
  sandboxPartnerHmacSecret,
  signPartnerInstructionHmac,
  type PartnerInstructionHmacPayload,
} from './instruction-hmac.js';
export { evaluateSandboxCompliance } from './execution-compliance.js';
export {
  ExecutionOrchestrationService,
  type CreateOrchestratedExecutionCommand,
  type ExecutionOrchestrationDependencies,
} from './execution-orchestration-service.js';
export {
  ExecutionReceiptService,
  buildExecutionReceiptPayload,
  type ExecutionReceiptServiceDependencies,
  type IssueExecutionReceiptInput,
} from './execution-receipt-service.js';
export {
  RECEIPT_VERIFICATION_DOCS,
  canonicalizeReceiptPayload,
  fingerprintPublicKeyPem,
  generateReceiptKeyPair,
  loadOrCreateReceiptSigningKey,
  publicKeyPemFromPrivate,
  signCanonicalReceipt,
  verifyCanonicalReceipt,
  verifyExecutionReceipt,
  type ReceiptKeyPair,
} from './receipt-signing.js';
export {
  RECONCILIATION_MISMATCH_KINDS,
  ReconciliationEngine,
  isReconciliationMismatchKind,
  reconcileExecution,
  type ReconciliationEngineDependencies,
  type ReconciliationMismatch,
  type ReconciliationMismatchKind,
} from './reconciliation-engine.js';
