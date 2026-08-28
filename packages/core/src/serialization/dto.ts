import type { FeeSide, PaymentIntentStatus, PlatformMode, ProviderLicensing, RailType } from '../domain/index.js';
import type { MoneyJson, RateJson } from '../money/index.js';

/**
 * The wire contract.
 *
 * Deliberately separate from the domain model: `Money` and `Decimal` instances never cross the
 * boundary, every numeric value is either an integer or an exact decimal string, and the shape can
 * stay stable while the internals change. Clients depend on this, not on the engine.
 */

export interface AppliedFeeDto {
  readonly code: string;
  readonly label: string;
  readonly side: FeeSide;
  readonly kind: 'fixed' | 'proportional';
  /** Whether the provider or the platform levied this charge. */
  readonly chargedBy: 'provider' | 'platform';
  readonly amount: MoneyJson;
  readonly rateBps: string | null;
  readonly capped: boolean;
}

export interface CostBreakdownDto {
  readonly appliedFees: readonly AppliedFeeDto[];
  readonly sourceFeeCost: MoneyJson;
  readonly platformFeeCost: MoneyJson;
  readonly destinationFeeCost: MoneyJson;
  readonly fxSpreadCost: MoneyJson;
  readonly slippageCost: MoneyJson;
  readonly roundingAdjustment: MoneyJson;
  readonly totalCost: MoneyJson;
}

export interface SettlementDto {
  readonly p50Seconds: number;
  readonly p95Seconds: number;
  readonly businessDaysOnly: boolean;
  readonly cutoffUtc: string | null;
  readonly notes: string | null;
}

export interface RouteProviderDto {
  readonly id: string;
  readonly name: string;
  readonly rail: RailType;
  readonly railLabel: string;
  readonly licensing: ProviderLicensing;
  readonly pricingVersion: string;
}

export interface QuoteFreshnessDto {
  readonly quotedAt: string;
  readonly expiresAt: string;
  readonly ageMs: number;
  readonly ageSeconds: string;
  readonly maxAgeMs: number;
  readonly state: 'fresh' | 'stale' | 'expired' | 'clock_skewed';
  readonly usableForMs: number | null;
}

export interface RouteQuoteDto {
  readonly providerId: string;
  readonly quotedAt: string;
  readonly expiresAt: string | null;
  readonly quoteReference: string | null;
  readonly pricingVersion: string;
  readonly intermediaryAsset: string | null;
  readonly freshness: QuoteFreshnessDto | null;
}

export interface RouteDto {
  readonly routeId: string;
  readonly rank: number;
  readonly recommended: boolean;
  readonly provider: RouteProviderDto;
  readonly quote: RouteQuoteDto;
  readonly sendAmount: MoneyJson;
  readonly deliveredAmount: MoneyJson;
  readonly benchmarkAmount: MoneyJson;
  readonly midMarketRate: RateJson;
  readonly offeredRate: RateJson;
  readonly slippageAdjustedRate: RateJson;
  readonly effectiveRate: RateJson;
  readonly totalCost: MoneyJson;
  readonly totalCostBps: string;
  readonly totalCostPercent: string;
  readonly spreadBps: string;
  readonly slippageBps: string;
  readonly reliabilityScore: string;
  readonly riskScore: string;
  /** Disclosed depth as a multiple of the notional, or `null` where the rail publishes none. */
  readonly liquidityHeadroom: string | null;
  readonly platformPricing: {
    readonly ruleId: string | null;
    readonly markupBps: string;
    readonly discountBps: string;
    readonly flatFee: MoneyJson | null;
  };
  readonly settlement: SettlementDto;
  readonly breakdown: CostBreakdownDto;
  readonly score: string;
  readonly scoreComponents: {
    readonly cost: string;
    readonly speed: string;
    readonly reliability: string;
    readonly slippage?: string;
    readonly liquidity?: string;
    readonly risk?: string;
    readonly settlementConfidence?: string;
  };
}

export interface ComparisonRequestDto {
  readonly sourceCurrency: string;
  readonly targetCurrency: string;
  readonly amount: MoneyJson;
  readonly rails: readonly RailType[] | null;
  readonly requestedAt: string;
}

export interface ProviderFailureDto {
  readonly providerId: string;
  readonly rail: RailType | null;
  readonly code: string;
  readonly message: string;
  readonly failedAt: string;
}

export interface ComparisonInsightsDto {
  readonly cheapestRouteId: string;
  readonly fastestRouteId: string;
  readonly mostExpensiveRouteId: string;
  readonly savingsVsMostExpensive: MoneyJson;
  readonly savingsVsMostExpensiveBps: string;
  readonly savingsVsBankFx: MoneyJson | null;
}

export interface ComparisonDto {
  readonly comparisonId: string;
  readonly organizationId: string | null;
  readonly createdAt: string;
  readonly mode: PlatformMode;
  readonly engineVersion: string;
  readonly fingerprint: string;
  readonly request: ComparisonRequestDto;
  readonly routes: readonly RouteDto[];
  readonly recommendedRouteId: string | null;
  readonly insights: ComparisonInsightsDto | null;
  readonly providerFailures: readonly ProviderFailureDto[];
  readonly scoringWeights: {
    readonly cost: string;
    readonly speed: string;
    readonly reliability: string;
    readonly slippage?: string;
    readonly liquidity?: string;
    readonly risk?: string;
    readonly settlementConfidence?: string;
  };
}

export interface ReplayResultDto {
  readonly comparisonId: string;
  readonly reproducible: boolean;
  /** Why it diverged, when it did. */
  readonly divergence: 'fingerprint_mismatch' | 'engine_version_changed' | null;
  readonly originalFingerprint: string;
  readonly replayedFingerprint: string;
  readonly originalEngineVersion: string;
  readonly replayEngineVersion: string;
  readonly replayedAt: string;
  readonly comparison: ComparisonDto;
}

export interface NormalizedFeeDto {
  readonly code: string;
  readonly label: string;
  readonly side: 'source' | 'destination';
  readonly kind: 'fixed' | 'proportional';
  readonly asset: string;
  readonly amountMinorUnits: string | null;
  readonly rateBps: string | null;
}

export interface NormalizedQuoteDto {
  readonly providerId: string;
  readonly timestamp: string;
  readonly expiresAt: string;
  readonly quoteReference: string | null;
  readonly conversionKind: string;
  readonly sourceAsset: string;
  readonly targetAsset: string;
  readonly amountMinorUnits: string;
  readonly indicatedRate: string;
  readonly midMarketRate: string | null;
  readonly fees: readonly NormalizedFeeDto[];
  readonly settlement: SettlementDto;
  readonly liquidity: {
    readonly availableDepthMinorUnits: string | null;
    readonly venue: string | null;
    readonly chainId: string | null;
  };
  readonly slippage: { readonly kind: string };
  readonly reliabilityScore: string;
  readonly executable: false;
  readonly chainId: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface FinancialProviderDto {
  readonly id: string;
  readonly name: string;
  readonly rail: string;
  readonly railLabel: string;
  readonly category: string;
  readonly features: readonly string[];
  readonly conversionKinds: readonly string[];
  readonly licensing: ProviderLicensing;
  readonly description: string;
  readonly supportedAssets: readonly string[];
  readonly supportedCurrencies: readonly string[];
}

export interface AssetAmountDto {
  readonly asset: string;
  readonly minorUnits: string;
  readonly decimal: string;
  readonly exponent: number;
}

export interface RoutedAppliedFeeDto {
  readonly code: string;
  readonly label: string;
  readonly side: FeeSide;
  readonly kind: 'fixed' | 'proportional';
  readonly bucket: 'provider' | 'platform' | 'network' | 'gas' | 'liquidity' | 'surcharge' | 'other';
  readonly chargedBy: 'provider' | 'platform';
  readonly asset: string;
  readonly amount: AssetAmountDto;
  readonly rateBps: string | null;
}

export interface RoutingCostBreakdownDto {
  readonly appliedFees: readonly RoutedAppliedFeeDto[];
  readonly providerFee: AssetAmountDto;
  readonly platformFee: AssetAmountDto;
  readonly networkFee: AssetAmountDto;
  readonly gasFee: AssetAmountDto;
  readonly liquidityFee: AssetAmountDto;
  readonly surchargeFee: AssetAmountDto;
  readonly spreadCost: AssetAmountDto;
  readonly slippageCost: AssetAmountDto;
  readonly roundingAdjustment: AssetAmountDto;
  readonly totalCost: AssetAmountDto;
}

export interface ComplianceEligibilityDto {
  readonly eligible: true;
  readonly conversionKind: string;
  readonly railFamily: string;
  readonly category: string;
  readonly licensing: ProviderLicensing;
  readonly jurisdictions: readonly string[];
  readonly kycRequired: boolean;
  readonly sanctionsScreeningRequired: boolean;
  readonly executable: false;
  readonly notes: string;
}

export interface PlannedRouteDto {
  readonly id: string;
  readonly hops: readonly string[];
  readonly status: 'planned';
  readonly explanation: string;
}

export interface MultiRailRouteDto {
  readonly routeId: string;
  readonly rank: number;
  readonly recommended: boolean;
  readonly available: true;
  readonly hops: readonly string[];
  readonly provider: {
    readonly id: string;
    readonly name: string;
    readonly rail: RailType;
    readonly railLabel: string;
    readonly category: string;
    readonly railFamily: string;
    readonly licensing: ProviderLicensing;
    readonly pricingVersion: string;
  };
  readonly conversionKind: string;
  readonly sendAmount: AssetAmountDto;
  readonly estimatedReceiveAmount: AssetAmountDto;
  readonly estimatedCost: AssetAmountDto;
  readonly benchmarkAmount: AssetAmountDto;
  readonly indicatedRate: string;
  readonly midMarketRate: string;
  readonly slippageAdjustedRate: string;
  readonly effectiveRate: string;
  readonly totalCostBps: string;
  readonly spreadBps: string;
  readonly slippageBps: string;
  readonly liquidityHeadroom: string | null;
  readonly reliabilityScore: string;
  readonly settlementConfidence: string;
  readonly estimatedSettlementTime: SettlementDto;
  readonly quoteFreshness: QuoteFreshnessDto;
  readonly breakdown: RoutingCostBreakdownDto;
  readonly compliance: ComplianceEligibilityDto;
  readonly routeScore: string;
  readonly scoreComponents: {
    readonly cost: string;
    readonly speed: string;
    readonly liquidity: string;
    readonly reliability: string;
    readonly settlementConfidence: string;
  };
  readonly routeExplanation: string;
  readonly executable: false;
}

export interface GraphNodeDto {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly asset: string | null;
  readonly providerId: string | null;
  readonly available: boolean | null;
}

export interface GraphEdgeDto {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly viaNodeId: string;
  readonly providerId: string;
  readonly conversionKind: string;
  readonly available: boolean;
  readonly costBps: string;
  readonly liquidityMinorUnits: string | null;
  readonly liquidityAsset: string | null;
  readonly complianceEligible: boolean;
  readonly executable: false;
}

export interface RouteGraphDto {
  readonly graphEngineVersion: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly nodes: readonly GraphNodeDto[];
  readonly edges: readonly GraphEdgeDto[];
  readonly executable: false;
}

export interface GraphPathDto {
  readonly pathId: string;
  readonly hops: number;
  readonly rank: number;
  readonly recommended: boolean;
  readonly nodes: readonly GraphNodeDto[];
  readonly edges: readonly GraphEdgeDto[];
  readonly assets: readonly string[];
  readonly providers: readonly string[];
  readonly totalCostBps: string;
  readonly minLiquidityMinorUnits: string | null;
  readonly minLiquidityAsset: string | null;
  readonly explanation: string;
  readonly executable: false;
}

export interface GraphRejectionDto {
  readonly reason: string;
  readonly edgeId: string;
  readonly detail: string;
}

export interface GraphSearchDto {
  readonly searchId: string;
  readonly organizationId: string | null;
  readonly createdAt: string;
  readonly mode: PlatformMode;
  readonly graphEngineVersion: string;
  readonly aiUsed: false;
  readonly executable: false;
  readonly request: {
    readonly sourceAsset: string;
    readonly destinationAsset: string;
  };
  readonly constraints: {
    readonly maxHops: number;
    readonly maxExpectedCostBps: string | null;
    readonly minLiquidityMinorUnits: string | null;
    readonly liquidityAsset: string | null;
    readonly supportedAssets: readonly string[] | null;
  };
  readonly paths: readonly GraphPathDto[];
  readonly recommendedPath: GraphPathDto | null;
  readonly rejections: readonly GraphRejectionDto[];
  readonly explanation: string;
}

export interface MultiRailRoutingDto {
  readonly routingId: string;
  readonly organizationId: string | null;
  readonly createdAt: string;
  readonly mode: PlatformMode;
  readonly routingEngineVersion: string;
  readonly aiUsed: false;
  readonly request: {
    readonly sourceAsset: string;
    readonly destinationAsset: string;
    readonly amount: AssetAmountDto;
    readonly requestedAt: string;
  };
  readonly scoringWeights: {
    readonly cost: string;
    readonly speed: string;
    readonly liquidity: string;
    readonly reliability: string;
    readonly settlementConfidence: string;
  };
  readonly routes: readonly MultiRailRouteDto[];
  readonly recommendedRoute: MultiRailRouteDto | null;
  readonly routeScore: string | null;
  readonly estimatedCost: AssetAmountDto | null;
  readonly estimatedReceiveAmount: AssetAmountDto | null;
  readonly estimatedSettlementTime: SettlementDto | null;
  readonly routeExplanation: string;
  readonly plannedRoutes: readonly PlannedRouteDto[];
  readonly providerFailures: readonly ProviderFailureDto[];
  readonly monetization: RouteMonetizationDto | null;
}

export interface RouteMonetizationDto {
  readonly eventType: 'ROUTE_QUOTE';
  readonly stage: 'route_quote';
  readonly realizedRevenue: false;
  readonly fundsMoved: false;
  readonly custody: false;
  readonly realExecution: false;
  readonly routeId: string;
  readonly quoteId: string | null;
  readonly providerId: string;
  readonly providerName: string;
  readonly currency: string;
  readonly asset: string;
  readonly tpvMinorUnits: string;
  readonly providerCostMinorUnits: string;
  readonly platformFeeMinorUnits: string;
  readonly partnerCommissionMinorUnits: string;
  readonly grossMarginMinorUnits: string;
  readonly takeRateBps: string | null;
}

export interface ChainMetadataDto {
  readonly id: string;
  readonly namespace: string;
  readonly reference: string;
  readonly name: string;
  readonly nativeAsset: string | null;
  readonly testnet: boolean;
  readonly quoting: 'available' | 'planned';
  readonly connected: false;
  readonly rpcUrl: null;
}

export interface StablecoinSlippageDto {
  readonly bps: string;
  readonly model:
    | { readonly kind: 'none' }
    | {
        readonly kind: 'tiered';
        readonly notionalCurrency: string;
        readonly tiers: readonly {
          readonly upToNotionalMinorUnits: string | null;
          readonly bps: string;
        }[];
      };
}

export interface StablecoinRouteDto {
  readonly routeId: string;
  readonly rank: number;
  readonly recommended: boolean;
  readonly conversionKind: string;
  readonly asset: {
    readonly source: string;
    readonly destination: string;
  };
  readonly chain: {
    readonly source: ChainMetadataDto | null;
    readonly destination: ChainMetadataDto | null;
    readonly settlement: ChainMetadataDto | null;
  };
  readonly price: {
    readonly indicated: string;
    readonly mid: string;
  };
  readonly providerFee: AssetAmountDto;
  readonly networkFee: AssetAmountDto;
  readonly slippage: StablecoinSlippageDto;
  readonly liquidity: {
    readonly availableDepthMinorUnits: string | null;
    readonly venue: string | null;
    readonly chain: ChainMetadataDto | null;
  };
  readonly estimatedSettlementTime: SettlementDto;
  readonly expiration: string | null;
  readonly estimatedReceiveAmount: AssetAmountDto;
  readonly estimatedCost: AssetAmountDto;
  readonly totalCostBps: string;
  readonly hops: readonly string[];
  readonly provider: {
    readonly id: string;
    readonly name: string;
    readonly rail: RailType;
    readonly railLabel: string;
    readonly category: string;
    readonly railFamily: string;
    readonly licensing: ProviderLicensing;
  };
  readonly explanation: string;
  readonly custody: false;
  readonly connectedToMainnet: false;
  readonly walletsCreated: false;
  readonly privateKeysGenerated: false;
  readonly executable: false;
  readonly delegateExecution: false;
}

export interface StablecoinRoutingDto {
  readonly routingId: string;
  readonly organizationId: string | null;
  readonly createdAt: string;
  readonly mode: PlatformMode;
  readonly stablecoinRoutingEngineVersion: string;
  readonly conversionKind: string;
  readonly aiUsed: false;
  readonly custody: false;
  readonly connectedToMainnet: false;
  readonly walletsCreated: false;
  readonly privateKeysGenerated: false;
  readonly executable: false;
  readonly delegateExecution: false;
  readonly request: {
    readonly sourceAsset: string;
    readonly destinationAsset: string;
    readonly amount: AssetAmountDto;
    readonly requestedAt: string;
  };
  readonly routes: readonly StablecoinRouteDto[];
  readonly recommendedRoute: StablecoinRouteDto | null;
  readonly providerFailures: readonly ProviderFailureDto[];
  readonly explanation: string;
}

export interface StablecoinCatalogDto {
  readonly stablecoinRoutingEngineVersion: string;
  readonly conversionKinds: readonly string[];
  readonly custody: false;
  readonly connectedToMainnet: false;
  readonly walletsCreated: false;
  readonly privateKeysGenerated: false;
  readonly executable: false;
  readonly delegateExecution: false;
  readonly stablecoins: readonly {
    readonly code: string;
    readonly name: string;
    readonly exponent: number;
    readonly pegCurrency: string;
    readonly issuer: string;
    readonly defaultChain: ChainMetadataDto;
    readonly chains: readonly (ChainMetadataDto & { readonly status: 'available' | 'planned' })[];
    readonly custodiedByPlatform: false;
  }[];
  readonly chains: readonly ChainMetadataDto[];
  readonly explanation: string;
}

export interface DefiRouteDto {
  readonly routeId: string;
  readonly rank: number;
  readonly recommended: boolean;
  readonly routeKind: string;
  readonly venueKind: string | null;
  readonly conversionKind: string;
  readonly asset: {
    readonly source: string;
    readonly destination: string;
  };
  readonly chain: {
    readonly source: ChainMetadataDto | null;
    readonly destination: ChainMetadataDto | null;
    readonly settlement: ChainMetadataDto | null;
  };
  readonly price: {
    readonly indicated: string;
    readonly mid: string;
  };
  readonly swapFee: AssetAmountDto;
  readonly networkFee: AssetAmountDto;
  readonly estimatedSlippage: StablecoinSlippageDto;
  readonly liquidity: {
    readonly availableDepthMinorUnits: string | null;
    readonly venue: string | null;
    readonly chain: ChainMetadataDto | null;
  };
  readonly estimatedSettlementTime: SettlementDto;
  readonly expiration: string | null;
  readonly estimatedReceiveAmount: AssetAmountDto;
  readonly estimatedCost: AssetAmountDto;
  readonly totalCostBps: string;
  readonly hops: readonly string[];
  readonly provider: {
    readonly id: string;
    readonly name: string;
    readonly rail: RailType;
    readonly railLabel: string;
    readonly category: string;
    readonly railFamily: string;
    readonly licensing: ProviderLicensing;
  };
  readonly explanation: string;
  readonly custody: false;
  readonly connectedToMainnet: false;
  readonly walletsCreated: false;
  readonly walletsConnected: false;
  readonly privateKeysGenerated: false;
  readonly swapSubmitted: false;
  readonly executable: false;
  readonly delegateExecution: false;
}

export interface DefiRoutingDto {
  readonly routingId: string;
  readonly organizationId: string | null;
  readonly createdAt: string;
  readonly mode: PlatformMode;
  readonly defiRoutingEngineVersion: string;
  readonly conversionKind: string;
  readonly aiUsed: false;
  readonly custody: false;
  readonly connectedToMainnet: false;
  readonly walletsCreated: false;
  readonly walletsConnected: false;
  readonly privateKeysGenerated: false;
  readonly swapSubmitted: false;
  readonly executable: false;
  readonly delegateExecution: false;
  readonly request: {
    readonly sourceAsset: string;
    readonly destinationAsset: string;
    readonly amount: AssetAmountDto;
    readonly requestedAt: string;
  };
  readonly routes: readonly DefiRouteDto[];
  readonly recommendedRoute: DefiRouteDto | null;
  readonly recommendedExecutionRoute: DefiRouteDto | null;
  readonly comparedFamilies: readonly string[];
  readonly providerFailures: readonly ProviderFailureDto[];
  readonly explanation: string;
}

export interface DefiCatalogDto {
  readonly defiRoutingEngineVersion: string;
  readonly venueKinds: readonly string[];
  readonly custody: false;
  readonly connectedToMainnet: false;
  readonly walletsCreated: false;
  readonly walletsConnected: false;
  readonly privateKeysGenerated: false;
  readonly swapSubmitted: false;
  readonly executable: false;
  readonly delegateExecution: false;
  readonly pools: readonly {
    readonly id: string;
    readonly baseAsset: string;
    readonly quoteAsset: string;
    readonly defaultChain: ChainMetadataDto;
    readonly status: 'available' | 'planned';
    readonly custodiedByPlatform: false;
  }[];
  readonly venues: readonly {
    readonly id: string;
    readonly name: string;
    readonly venueKind: string;
    readonly tokens: readonly string[];
    readonly chains: readonly ChainMetadataDto[];
  }[];
  readonly chains: readonly ChainMetadataDto[];
  readonly explanation: string;
}

export interface FinancialQuoteDto {
  readonly requestId: string;
  readonly routes: readonly MultiRailRouteDto[];
  readonly recommendedRoute: MultiRailRouteDto | null;
  readonly quoteExpiresAt: string | null;
}

export interface RouteSearchDto {
  readonly requestId: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly graph: GraphSearchDto;
  readonly matchingProviders: readonly FinancialProviderDto[];
  readonly executable: false;
}

export interface ExecutionIntentDto {
  readonly id: string;
  readonly organizationId: string;
  readonly requestId: string;
  readonly routeId: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly status: 'recorded';
  readonly executable: false;
  readonly submitted: false;
  readonly quoteExpiresAt: string | null;
  readonly createdAt: string;
}

export interface AssetCatalogEntryDto {
  readonly code: string;
  readonly kind: 'fiat' | 'stablecoin' | 'crypto';
  readonly decimals: number;
  readonly displayName: string;
  readonly networks: readonly string[];
}

export interface CurrencyCatalogEntryDto {
  readonly code: string;
  readonly decimals: number;
  readonly name: string;
}

export interface QuotedRouteOptionDto {
  readonly routeId: string;
  readonly rank: number;
  readonly recommended: boolean;
  readonly providerId: string;
  readonly providerName: string;
  readonly rail: string;
  readonly totalCostBps: string;
  readonly expiresAt: string | null;
  readonly routeScore: string | null;
  readonly slippageBps: string | null;
  readonly liquidityHeadroom: string | null;
  readonly chainId: string | null;
  readonly jurisdictions: readonly string[];
  readonly platformFeeMinorUnits: string | null;
  readonly providerFeeMinorUnits: string | null;
}

export interface SimulatedExecutionReceiptDto {
  readonly simulationId: string;
  readonly simulated: true;
  readonly fundsMoved: false;
  readonly custody: false;
  readonly realExecution: false;
  readonly providerId: string;
  readonly occurredAt: string;
  readonly receipt: string;
}

export interface PaymentIntentDto {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amount: AssetAmountDto;
  readonly recipient: string;
  readonly purpose: string;
  readonly routePreference: string | null;
  readonly maxFeeBps: string | null;
  readonly expiresAt: string;
  readonly status: PaymentIntentStatus;
  readonly quotedRoutes: readonly QuotedRouteOptionDto[];
  readonly quoteExpiresAt: string | null;
  readonly selectedRouteId: string | null;
  readonly authorizedAt: string | null;
  readonly simulatedAt: string | null;
  readonly simulation: SimulatedExecutionReceiptDto | null;
  readonly failureReason: string | null;
  readonly fundsMoved: false;
  readonly custody: false;
  readonly realExecution: false;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PublicAgentDto {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly status: string;
  readonly createdAt: string;
  readonly keyPrefix: string | null;
  readonly scopes: readonly string[];
  readonly credentialExpiresAt: string | null;
  readonly credentialRevokedAt: string | null;
}

export interface IssuedAgentDto extends PublicAgentDto {
  readonly secret: string;
}

export interface AgentWalletReferenceDto {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly kind: string;
  readonly label: string;
  readonly externalRef: string;
  readonly controlledByPlatform: false;
  readonly createdAt: string;
}

export interface MerchantDto {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly recipientCode: string;
  readonly settlementAsset: string;
  readonly status: string;
  readonly createdAt: string;
}

export interface PaymentPolicyDto {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly maxTransactionAmountMinorUnits: string;
  readonly allowedAssets: readonly string[];
  readonly allowedRecipientCodes: readonly string[];
  readonly allowedProviderIds: readonly string[];
  readonly allowedChainIds: readonly string[];
  readonly allowedCountryCodes: readonly string[];
  readonly maxFeeBps: string;
  readonly maxSlippageBps: string;
  readonly minRouteScore: string;
  readonly minLiquidityHeadroom: string;
  readonly dailySpendingLimitMinorUnits: string;
  readonly dailySpendingAsset: string;
  readonly preferredRoutePreference: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StructuredNlPaymentIntentDto {
  readonly amount: AssetAmountDto;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly recipient: string;
  readonly optimizationPreference: string | null;
  readonly instruction: string;
  readonly interpreter: 'deterministic_parser';
  readonly aiUsed: false;
  readonly financialsComputedBy: 'routing_engine' | null;
  readonly didNotCompute: readonly string[];
}

export interface NlRouteResultDto {
  readonly interpretation: StructuredNlPaymentIntentDto;
  readonly paymentIntent: PaymentIntentDto;
  readonly selectedRoute: QuotedRouteOptionDto | null;
  readonly executionIntent: ExecutionIntentDto;
  readonly pipelineCompleted: readonly string[];
  readonly interpreter: 'deterministic_parser';
  readonly aiUsed: false;
  readonly financialsComputedBy: 'routing_engine';
  readonly didNotCompute: readonly string[];
  readonly fundsMoved: false;
  readonly custody: false;
  readonly realExecution: false;
  readonly executable: false;
  readonly submitted: false;
}

export interface MonetizationTotalsDto {
  readonly eventCount: number;
  readonly tpvMinorUnits: string;
  readonly grossRevenueMinorUnits: string;
  readonly providerCostMinorUnits: string;
  readonly platformRevenueMinorUnits: string;
  readonly partnerCommissionMinorUnits: string;
  readonly grossProfitMinorUnits: string;
  readonly takeRateBps: string | null;
  readonly currency: string;
  readonly exponent: number;
  readonly realizedRevenueMinorUnits: string;
}

export interface MonetizationBreakdownRowDto {
  readonly key: string;
  readonly label: string;
  readonly eventCount: number;
  readonly tpvMinorUnits: string;
  readonly grossRevenueMinorUnits: string;
  readonly providerCostMinorUnits: string;
  readonly platformRevenueMinorUnits: string;
  readonly partnerCommissionMinorUnits: string;
  readonly grossProfitMinorUnits: string;
  readonly takeRateBps: string | null;
}

export interface MonetizationEventDto {
  readonly id: string;
  readonly organizationId: string;
  readonly occurredAt: string;
  readonly transactionType: string;
  readonly revenueSource: string;
  readonly rail: string | null;
  readonly providerId: string | null;
  readonly providerName: string | null;
  readonly currency: string;
  readonly asset: string;
  readonly destinationAsset: string | null;
  readonly agentId: string | null;
  readonly tpvMinorUnits: string;
  readonly providerCostMinorUnits: string;
  readonly platformRevenueMinorUnits: string;
  readonly partnerCommissionMinorUnits: string;
  readonly grossProfitMinorUnits: string;
  readonly takeRateBps: string | null;
  readonly fundsMoved: false;
  readonly custody: false;
  readonly realExecution: false;
  readonly routeId: string | null;
  readonly quoteId: string | null;
  readonly economicStage: string;
  readonly realizedRevenue: false;
}

export interface MonetizationWorkedExampleDto {
  readonly tpvMinorUnits: string;
  readonly providerCostMinorUnits: string;
  readonly platformRevenueMinorUnits: string;
  readonly partnerCommissionMinorUnits: string;
  readonly grossProfitMinorUnits: string;
  readonly takeRateBps: string;
  readonly currency: string;
  readonly description: string;
}

export interface PreferredRouteRowDto {
  readonly providerId: string;
  readonly providerName: string;
  readonly rail: string;
  readonly intentCount: number;
}

export interface AgentPolicyViolationDto {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly agentId: string;
  readonly rule: string;
  readonly message: string;
  readonly paymentIntentId: string | null;
}

export interface AgentSpendingSnapshotDto {
  readonly asset: string;
  readonly exponent: number;
  readonly dailyLimitMinorUnits: string;
  readonly dailySpentMinorUnits: string;
  readonly dailyRemainingMinorUnits: string;
  readonly maxTransactionMinorUnits: string;
  readonly preferredRoutePreference: string | null;
}

export interface AgentDashboardSummaryDto {
  readonly agentId: string;
  readonly name: string;
  readonly status: string;
  readonly createdAt: string;
  readonly transactionCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly quotedCount: number;
  readonly policyViolationCount: number;
  readonly paymentVolumeMinorUnits: string;
  readonly currency: string;
  readonly exponent: number;
  readonly averageFeeBps: string | null;
  readonly routeSuccessRatePercent: string | null;
  readonly preferredRoute: PreferredRouteRowDto | null;
  readonly dailySpentMinorUnits: string;
  readonly dailyLimitMinorUnits: string | null;
  readonly fundsMoved: false;
  readonly custody: false;
}

export interface AgentDashboardDetailDto {
  readonly summary: AgentDashboardSummaryDto;
  readonly spending: AgentSpendingSnapshotDto | null;
  readonly preferredRoutes: readonly PreferredRouteRowDto[];
  readonly violations: readonly AgentPolicyViolationDto[];
  readonly fundsMoved: false;
  readonly custody: false;
  readonly walletsGenerated: false;
  readonly privateKeysHeld: false;
}

export interface AgentPolicyControlsDto {
  readonly policy: PaymentPolicyDto | null;
  readonly spending: AgentSpendingSnapshotDto | null;
  readonly violations: readonly AgentPolicyViolationDto[];
  readonly availableAssets: readonly string[];
  readonly availableProviders: readonly { readonly id: string; readonly name: string }[];
  readonly availableRecipients: readonly {
    readonly code: string;
    readonly name: string;
  }[];
  readonly routePreferences: readonly string[];
  readonly fundsMoved: false;
  readonly custody: false;
  readonly walletsGenerated: false;
  readonly privateKeysHeld: false;
}

export interface MonetizationReportDto {
  readonly summary: MonetizationTotalsDto;
  readonly byRail: readonly MonetizationBreakdownRowDto[];
  readonly byProvider: readonly MonetizationBreakdownRowDto[];
  readonly byCurrency: readonly MonetizationBreakdownRowDto[];
  readonly byAsset: readonly MonetizationBreakdownRowDto[];
  readonly byOrganization: readonly MonetizationBreakdownRowDto[];
  readonly byAgent: readonly MonetizationBreakdownRowDto[];
  readonly byTransactionType: readonly MonetizationBreakdownRowDto[];
  readonly byRevenueSource: readonly MonetizationBreakdownRowDto[];
  readonly byDate: readonly MonetizationBreakdownRowDto[];
  readonly events: readonly MonetizationEventDto[];
  readonly workedExample: MonetizationWorkedExampleDto;
  readonly fundsMoved: false;
}
