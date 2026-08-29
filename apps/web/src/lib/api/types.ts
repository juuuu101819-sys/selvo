/**
 * The Meridian API contract, as the web app consumes it.
 *
 * Declared here rather than imported from `@meridian/core` on purpose: the web app is a separate
 * deployable that talks to the API over HTTP, so it should depend on the published wire contract
 * and not on the server's internals. If these drift from the API, the API's own integration tests
 * are the ones that should fail.
 */

export interface MoneyJson {
  /** Authoritative value: an exact integer count of the currency's minor units. */
  readonly minorUnits: string;
  readonly currency: string;
  readonly decimal: string;
  readonly exponent: number;
}

export interface RateJson {
  readonly base: string;
  readonly quote: string;
  readonly value: string;
  readonly pair: string;
}

export type FeeSide = 'source' | 'destination';

export interface AppliedFeeDto {
  readonly code: string;
  readonly label: string;
  readonly side: FeeSide;
  readonly kind: 'fixed' | 'proportional';
  readonly chargedBy: 'provider' | 'platform';
  readonly amount: MoneyJson;
  readonly rateBps: string | null;
  readonly capped: boolean;
}

export interface CostBreakdownDto {
  readonly appliedFees: readonly AppliedFeeDto[];
  readonly sourceFeeCost: MoneyJson;
  /** The platform's own charge, reported apart from the provider's so neither hides in the other. */
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

export interface RouteDto {
  readonly routeId: string;
  readonly rank: number;
  readonly recommended: boolean;
  readonly provider: {
    readonly id: string;
    readonly name: string;
    readonly rail: string;
    readonly railLabel: string;
    readonly licensing: string;
    readonly pricingVersion: string;
  };
  readonly quote: {
    readonly providerId: string;
    readonly quotedAt: string;
    readonly expiresAt: string | null;
    readonly quoteReference: string | null;
    readonly pricingVersion: string;
    readonly intermediaryAsset: string | null;
    readonly freshness: {
      readonly quotedAt: string;
      readonly expiresAt: string;
      readonly ageMs: number;
      readonly ageSeconds: string;
      readonly maxAgeMs: number;
      readonly state: string;
      readonly usableForMs: number | null;
    } | null;
  };
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
  readonly slippageBps: string;
  readonly reliabilityScore: string;
  readonly settlement: SettlementDto;
  readonly breakdown: CostBreakdownDto;
  readonly score: string;
  readonly scoreComponents: {
    readonly cost: string;
    readonly speed: string;
    readonly reliability: string;
    readonly liquidity?: string;
    readonly settlementConfidence?: string;
    readonly slippage?: string;
    readonly risk?: string;
  };
}

export interface ComparisonDto {
  readonly comparisonId: string;
  readonly createdAt: string;
  readonly mode: string;
  readonly engineVersion: string;
  readonly fingerprint: string;
  readonly request: {
    readonly sourceCurrency: string;
    readonly targetCurrency: string;
    readonly amount: MoneyJson;
    readonly rails: readonly string[] | null;
    readonly requestedAt: string;
  };
  readonly routes: readonly RouteDto[];
  readonly recommendedRouteId: string | null;
  readonly insights: {
    readonly cheapestRouteId: string;
    readonly fastestRouteId: string;
    readonly mostExpensiveRouteId: string;
    readonly savingsVsMostExpensive: MoneyJson;
    readonly savingsVsMostExpensiveBps: string;
    readonly savingsVsBankFx: MoneyJson | null;
  } | null;
  readonly providerFailures: readonly {
    readonly providerId: string;
    readonly rail: string | null;
    readonly code: string;
    readonly message: string;
  }[];
  readonly scoringWeights: {
    readonly cost: string;
    readonly speed: string;
    readonly reliability: string;
    readonly liquidity?: string;
    readonly settlementConfidence?: string;
    readonly slippage?: string;
    readonly risk?: string;
  };
}

export interface ReplayResultDto {
  readonly comparisonId: string;
  readonly reproducible: boolean;
  readonly originalFingerprint: string;
  readonly replayedFingerprint: string;
  readonly replayedAt: string;
}

export interface CurrencyDto {
  readonly code: string;
  readonly exponent: number;
  readonly name: string;
}

export interface RailFamilyDto {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly status: 'available' | 'planned';
}

export interface PipelineStageDto {
  readonly id: string;
  readonly label: string;
  readonly status: 'available' | 'planned';
}

export interface InteractionModelDto {
  readonly id: string;
  readonly payer: string;
  readonly payee: string;
  readonly label: string;
  readonly status: 'available' | 'planned';
}

export interface RailDto {
  readonly type: string;
  readonly family: string;
  readonly label: string;
  readonly description: string;
  readonly status: 'available' | 'planned';
}

export interface MetaDto {
  readonly mode: string;
  readonly engineVersion: string;
  readonly routingEngineVersion?: string;
  readonly graphEngineVersion?: string;
  readonly stablecoinRoutingEngineVersion?: string;
  readonly defiRoutingEngineVersion?: string;
  readonly product: {
    readonly kind: string;
    readonly name: string;
    readonly positioning: string;
    readonly scope: readonly string[];
    readonly customers: readonly string[];
    readonly notFor: readonly string[];
  };
  readonly pipeline: readonly PipelineStageDto[];
  readonly railFamilies: readonly RailFamilyDto[];
  readonly interactionModels: readonly InteractionModelDto[];
  readonly capabilities: {
    readonly compareRoutes: boolean;
    readonly executeTransactions: boolean;
    readonly delegateExecution: boolean;
    readonly custodyFunds: boolean;
    readonly holdCryptoAssets: boolean;
    readonly holdPrivateKeys: boolean;
    readonly controlCustomerWallets: boolean;
    readonly operateAsPrincipal: boolean;
    readonly issueStablecoins: boolean;
    readonly agentPayments: boolean;
    readonly agentPaymentSimulation?: boolean;
    readonly agentNaturalLanguageRouting?: boolean;
    readonly defiQuotes: boolean;
    readonly defiExecution: boolean;
    readonly multiRailRouting: boolean;
    readonly routeGraph: boolean;
    readonly stablecoinRouting: boolean;
    readonly defiLiquidityRouting: boolean;
    readonly financialRoutingApi?: boolean;
    readonly paymentPolicyEngine?: boolean;
    readonly executionIntents?: boolean;
    readonly multiRailMonetization?: boolean;
    readonly agentFinancialDashboard?: boolean;
    readonly b2bOnboarding?: boolean;
  };
  readonly execution: {
    readonly implemented: boolean;
    readonly delegated: boolean;
    readonly statusCode: number;
    readonly reason: string;
  };
  readonly productionGates?: {
    readonly routingAvailable: boolean;
    readonly executionAvailable: boolean;
  };
  readonly pricing: {
    readonly datasetVersion: string;
    readonly referenceRatesVersion: string;
    readonly referenceRatesAsOf: string;
  } | null;
  readonly defaultScoringWeights: {
    readonly cost: string;
    readonly speed: string;
    readonly reliability: string;
  };
  readonly providers: readonly {
    readonly id: string;
    readonly name: string;
    readonly rail: string;
    readonly railLabel: string;
    readonly licensing: string;
    readonly description: string;
  }[];
  readonly rails: readonly RailDto[];
  readonly currencies: readonly CurrencyDto[];
  readonly assets?: readonly {
    readonly code: string;
    readonly kind: string;
    readonly exponent: number;
    readonly name: string;
    readonly chainId: string | null;
  }[];
  readonly providerCatalog?: {
    readonly categories: readonly string[];
    readonly providers: readonly {
      readonly id: string;
      readonly name: string;
      readonly category: string;
      readonly features: readonly string[];
    }[];
  };
  readonly stablecoins?: readonly string[];
  readonly chains?: readonly {
    readonly id: string;
    readonly name: string;
    readonly quoting: string;
    readonly connected: false;
    readonly rpcUrl: null;
  }[];
}

export interface Envelope<TData> {
  readonly data: TData;
  readonly meta: {
    readonly mode: string;
    readonly disclaimer: string;
    readonly requestId: string;
  };
}

export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details: Record<string, unknown>;
    readonly requestId: string;
  };
}

/** A failure the UI can render, distinguishing a rejected request from an unreachable API. */
export interface ApiFailure {
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;
}

export type ApiResult<TData> =
  | { readonly ok: true; readonly data: TData; readonly disclaimer: string }
  | { readonly ok: false; readonly failure: ApiFailure };

export interface SessionUserDto {
  readonly id: string | null;
  readonly email: string | null;
  readonly displayName: string;
}

export interface SessionOrganizationDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly countryCode: string;
}

export interface LoginDto {
  readonly token: string;
  readonly expiresAt: string;
  readonly user: { readonly id: string; readonly email: string; readonly displayName: string };
  readonly organization: SessionOrganizationDto;
  readonly role: string;
}

export interface MfaChallengeDto {
  readonly mfaRequired: true;
  readonly challengeToken: string;
  readonly expiresAt: string;
}

export function isMfaChallenge(data: object): data is MfaChallengeDto {
  return 'mfaRequired' in data && (data as { mfaRequired?: unknown }).mfaRequired === true;
}

export interface AuthMeDto {
  readonly kind: string;
  readonly role: string | null;
  readonly scopes?: readonly string[];
  readonly user: SessionUserDto;
  readonly organization: SessionOrganizationDto;
}

export interface VolumeByCurrencyDto {
  readonly currency: string;
  readonly exponent: number;
  readonly minorUnits: string;
  readonly requestCount: number;
}

export interface SavingsByCurrencyDto {
  readonly currency: string;
  readonly exponent: number;
  readonly minorUnits: string;
}

export interface DashboardMetricsDto {
  readonly totalQuotedVolume: readonly VolumeByCurrencyDto[];
  readonly estimatedSavings: readonly SavingsByCurrencyDto[];
  readonly quoteCount: number;
  readonly successfulRouteRequests: number;
  readonly averageRouteCostBps: string | null;
  readonly averageSettlementP50Seconds: number | null;
}

export interface VolumePointDto {
  readonly date: string;
  readonly currency: string;
  readonly minorUnits: string;
  readonly requestCount: number;
}

export interface CostPointDto {
  readonly date: string;
  readonly averageCostBps: string;
  readonly quoteCount: number;
}

export interface DashboardProviderUsageDto {
  readonly providerId: string;
  readonly providerName: string;
  readonly rail: string;
  readonly quoteCount: number;
  readonly recommendedCount: number;
  readonly averageCostBps: string | null;
  readonly averageSettlementP50Seconds: number | null;
}

export interface DashboardMetricsPayload {
  readonly metrics: DashboardMetricsDto;
  readonly charts: {
    readonly volumeByDay: readonly VolumePointDto[];
    readonly costByDay: readonly CostPointDto[];
    readonly providers: readonly DashboardProviderUsageDto[];
  };
}

export interface DashboardQuoteDto {
  readonly id: string;
  readonly organizationId: string;
  readonly transactionRequestId: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly rail: string;
  readonly status: string;
  readonly sourceCurrency: string;
  readonly targetCurrency: string;
  readonly amountMinorUnits: string;
  readonly totalCostMinorUnits: string;
  readonly totalCostBps: string;
  readonly estimatedReceiveMinorUnits: string;
  readonly benchmarkReceiveMinorUnits: string;
  readonly settlementP50Seconds: number;
  readonly quotedAt: string;
  readonly expiresAt: string;
  readonly isRecommended: boolean;
  readonly rank: number | null;
  readonly score: string | null;
}

export interface DashboardTransactionDto {
  readonly id: string;
  readonly organizationId: string;
  readonly reference: string | null;
  readonly sourceCurrency: string;
  readonly targetCurrency: string;
  readonly amountMinorUnits: string;
  readonly status: string;
  readonly selectedQuoteId: string | null;
  readonly createdAt: string;
  readonly quoteCount: number;
}

export interface PublicMemberDto {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: string;
  readonly status: string;
}

export interface PublicApiKeyDto {
  readonly id: string;
  readonly keyPrefix: string;
  readonly label: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string | null;
  readonly scopes: readonly string[];
  readonly revokedAt: string | null;
}

export type KybStatusDto = 'unverified' | 'pending' | 'verified' | 'rejected';

export interface OnboardingStepDto {
  readonly id: 'organization' | 'kyb' | 'pricing' | 'api_key';
  readonly label: string;
  readonly complete: boolean;
  readonly status: string;
}

/** Live onboarding checklist. Completeness is backend state, not a client-side progress fake. */
export interface OnboardingSnapshotDto {
  readonly mode: 'sales_assisted_invite_only';
  readonly kybVendor: 'manual_review';
  readonly pricingModel: 'negotiated_customer_pricing_rules';
  readonly organizationId: string;
  readonly organizationCreated: true;
  readonly kybStatus: KybStatusDto;
  readonly kybReason: string | null;
  readonly kybReviewedAt: string | null;
  readonly pricingConfigured: boolean;
  readonly apiKeyIssued: boolean;
  readonly realTransactionEligible: boolean;
  readonly licensedProviderConfigured: boolean;
  readonly steps: readonly OnboardingStepDto[];
}

export interface AcceptInviteDto {
  readonly organizationId: string;
  readonly email: string;
  readonly accepted: true;
}

export interface KybSubmitDto {
  readonly kybStatus: KybStatusDto;
  readonly vendorId: string;
}

export interface DashboardSettingsDto {
  readonly organization: SessionOrganizationDto | null;
  readonly members: readonly PublicMemberDto[];
  readonly apiKeys: readonly PublicApiKeyDto[];
  readonly role: string | null;
  readonly auth?: {
    readonly requireMfaForPrivilegedRoles: boolean;
    readonly oidc: {
      readonly configured: boolean;
      readonly enabled: boolean;
      readonly issuer: string | null;
      readonly clientId: string | null;
      readonly redirectUri: string | null;
      readonly hasClientSecret: boolean;
    };
  };
}

export interface MfaStatusDto {
  readonly enrolled: boolean;
  readonly remainingRecoveryCodes: number;
}

export interface MfaEnrollDto {
  readonly secret: string;
  readonly otpauthUrl: string;
  readonly issuer: string;
}

export interface MfaConfirmDto {
  readonly enrolled: boolean;
  readonly recoveryCodes: readonly string[];
}

export interface OrgAuthSettingsDto {
  readonly requireMfaForPrivilegedRoles: boolean;
  readonly oidc: NonNullable<DashboardSettingsDto['auth']>['oidc'];
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
  readonly invoicedRevenueMinorUnits: string;
  readonly collectedRevenueMinorUnits: string;
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
  readonly revenueRecognition: string;
  readonly invoiceId: string | null;
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

export interface InvoiceLineDto {
  readonly id: string;
  readonly invoiceId: string;
  readonly monetizationEventId: string;
  readonly platformRevenueMinorUnits: string;
  readonly economicStage: string;
  readonly transactionType: string;
  readonly revenueSource: string;
  readonly occurredAt: string;
}

export interface InvoiceDto {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly organizationId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;
  readonly status: 'issued';
  readonly collectionStatus: 'uncollected';
  readonly issuerLegalEntity: 'unconfirmed';
  readonly taxCalculation: 'deferred';
  readonly subtotalMinorUnits: string;
  readonly taxMinorUnits: '0';
  readonly totalMinorUnits: string;
  readonly issuedAt: string;
  readonly issuedByActor: string;
  readonly realizedRevenue: false;
  readonly collected: false;
  readonly lines: readonly InvoiceLineDto[];
}

export interface DashboardInvoicesPayload {
  readonly invoices: readonly InvoiceDto[];
  readonly collectionStatus: 'deferred';
}

export interface AssetAmountJson {
  readonly asset: string;
  readonly minorUnits: string;
  readonly decimal: string;
  readonly exponent: number;
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
    readonly rail: string;
    readonly railLabel: string;
    readonly category: string;
    readonly railFamily: string;
    readonly licensing: string;
  };
  readonly conversionKind: string;
  readonly sendAmount: AssetAmountJson;
  readonly estimatedReceiveAmount: AssetAmountJson;
  readonly estimatedCost: AssetAmountJson;
  readonly totalCostBps: string;
  readonly indicatedRate: string;
  readonly midMarketRate: string;
  readonly reliabilityScore: string;
  readonly settlementConfidence: string;
  readonly estimatedSettlementTime: SettlementDto;
  readonly quoteFreshness?: {
    readonly quotedAt: string;
    readonly expiresAt: string;
    readonly ageMs: number;
    readonly ageSeconds: string;
    readonly maxAgeMs: number;
    readonly state: string;
    readonly usableForMs: number | null;
  };
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
  readonly breakdown: {
    readonly providerFee: AssetAmountJson;
    readonly platformFee: AssetAmountJson;
    readonly networkFee: AssetAmountJson;
    readonly gasFee: AssetAmountJson;
    readonly liquidityFee?: AssetAmountJson;
    readonly surchargeFee?: AssetAmountJson;
    readonly spreadCost: AssetAmountJson;
    readonly slippageCost: AssetAmountJson;
  };
  readonly compliance: {
    readonly eligible: boolean;
    readonly kycRequired: boolean;
    readonly executable: false;
    readonly notes: string;
  };
}

export interface MultiRailRoutingDto {
  readonly routingId: string;
  readonly routingEngineVersion: string;
  readonly aiUsed: false;
  readonly fingerprint: string;
  readonly routes: readonly MultiRailRouteDto[];
  readonly recommendedRoute: MultiRailRouteDto | null;
  readonly routeScore: string | null;
  readonly estimatedCost: AssetAmountJson | null;
  readonly estimatedReceiveAmount: AssetAmountJson | null;
  readonly estimatedSettlementTime: SettlementDto | null;
  readonly routeExplanation: string;
  readonly plannedRoutes: readonly {
    readonly hops: readonly string[];
    readonly status: string;
    readonly explanation: string;
  }[];
  readonly scoringWeights: {
    readonly cost: string;
    readonly speed: string;
    readonly liquidity: string;
    readonly reliability: string;
    readonly settlementConfidence: string;
  };
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

export interface GraphSearchDto {
  readonly searchId: string;
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
  readonly rejections: readonly { readonly reason: string; readonly detail: string }[];
  readonly explanation: string;
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
  readonly providerFee: AssetAmountJson;
  readonly networkFee: AssetAmountJson;
  readonly slippage: {
    readonly bps: string;
    readonly model: { readonly kind: string };
  };
  readonly liquidity: {
    readonly availableDepthMinorUnits: string | null;
    readonly venue: string | null;
    readonly chain: ChainMetadataDto | null;
  };
  readonly estimatedSettlementTime: SettlementDto;
  readonly expiration: string | null;
  readonly estimatedReceiveAmount: AssetAmountJson;
  readonly estimatedCost: AssetAmountJson;
  readonly totalCostBps: string;
  readonly hops: readonly string[];
  readonly provider: {
    readonly id: string;
    readonly name: string;
    readonly rail: string;
    readonly railLabel: string;
    readonly category: string;
    readonly railFamily: string;
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
  readonly stablecoinRoutingEngineVersion: string;
  readonly conversionKind: string;
  readonly aiUsed: false;
  readonly custody: false;
  readonly connectedToMainnet: false;
  readonly walletsCreated: false;
  readonly privateKeysGenerated: false;
  readonly executable: false;
  readonly delegateExecution: false;
  readonly routes: readonly StablecoinRouteDto[];
  readonly recommendedRoute: StablecoinRouteDto | null;
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
  readonly swapFee: AssetAmountJson;
  readonly networkFee: AssetAmountJson;
  readonly estimatedSlippage: {
    readonly bps: string;
    readonly model: { readonly kind: string };
  };
  readonly liquidity: {
    readonly availableDepthMinorUnits: string | null;
    readonly venue: string | null;
    readonly chain: ChainMetadataDto | null;
  };
  readonly estimatedSettlementTime: SettlementDto;
  readonly expiration: string | null;
  readonly estimatedReceiveAmount: AssetAmountJson;
  readonly estimatedCost: AssetAmountJson;
  readonly totalCostBps: string;
  readonly hops: readonly string[];
  readonly provider: {
    readonly id: string;
    readonly name: string;
    readonly rail: string;
    readonly railLabel: string;
    readonly category: string;
    readonly railFamily: string;
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
  readonly routes: readonly DefiRouteDto[];
  readonly recommendedRoute: DefiRouteDto | null;
  readonly recommendedExecutionRoute: DefiRouteDto | null;
  readonly comparedFamilies: readonly string[];
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
  readonly routingId: string;
  readonly fingerprint: string;
  readonly routes: readonly MultiRailRouteDto[];
  readonly recommendedRoute: MultiRailRouteDto | null;
  readonly quoteExpiresAt: string | null;
}

export interface RouteSearchDto {
  readonly requestId: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly graph: GraphSearchDto;
  readonly matchingProviders: readonly { readonly id: string; readonly name: string }[];
  readonly executable: false;
}

export interface AssetCatalogEntryDto {
  readonly code: string;
  readonly kind: string;
  readonly decimals: number;
  readonly displayName: string;
  readonly networks: readonly string[];
}

export interface CurrencyCatalogEntryDto {
  readonly code: string;
  readonly decimals: number;
  readonly name: string;
}

export interface IssuedApiKeyDto extends PublicApiKeyDto {
  readonly secret: string;
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

export interface QuotedRouteOptionDto {
  readonly routeId: string;
  readonly rank: number;
  readonly recommended: boolean;
  readonly providerId: string;
  readonly providerName: string;
  readonly rail: string;
  readonly totalCostBps: string;
  readonly expiresAt: string | null;
  readonly routeScore?: string | null;
  readonly slippageBps?: string | null;
  readonly liquidityHeadroom?: string | null;
  readonly chainId?: string | null;
  readonly jurisdictions?: readonly string[];
  readonly platformFeeMinorUnits?: string | null;
  readonly providerFeeMinorUnits?: string | null;
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
  readonly amount: AssetAmountJson;
  readonly recipient: string;
  readonly purpose: string;
  readonly routePreference: string | null;
  readonly maxFeeBps: string | null;
  readonly expiresAt: string;
  readonly status: string;
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

export interface AgentWalletReferenceDto {
  readonly id: string;
  readonly agentId: string;
  readonly kind: string;
  readonly label: string;
  readonly externalRef: string;
  readonly controlledByPlatform: false;
}

export interface MerchantDto {
  readonly id: string;
  readonly name: string;
  readonly recipientCode: string;
  readonly settlementAsset: string;
  readonly status: string;
}

export interface PaymentPolicyDto {
  readonly id: string;
  readonly agentId: string;
  readonly maxTransactionAmountMinorUnits: string;
  readonly allowedAssets: readonly string[];
  readonly allowedRecipientCodes: readonly string[];
  readonly allowedProviderIds: readonly string[];
  readonly allowedChainIds?: readonly string[];
  readonly allowedCountryCodes?: readonly string[];
  readonly maxFeeBps: string;
  readonly maxSlippageBps?: string;
  readonly minRouteScore?: string;
  readonly minLiquidityHeadroom?: string;
  readonly dailySpendingLimitMinorUnits: string;
  readonly dailySpendingAsset: string;
  readonly preferredRoutePreference?: string | null;
}

export interface StructuredNlPaymentIntentDto {
  readonly amount: AssetAmountJson;
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

export interface NlInterpretDto {
  readonly interpretation: StructuredNlPaymentIntentDto;
  readonly pipelineCompleted: readonly string[];
  readonly aiUsed: false;
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
  readonly availableRecipients: readonly { readonly code: string; readonly name: string }[];
  readonly routePreferences: readonly string[];
  readonly fundsMoved: false;
  readonly custody: false;
  readonly walletsGenerated: false;
  readonly privateKeysHeld: false;
}

export interface AgentDashboardListDto {
  readonly agents: readonly AgentDashboardSummaryDto[];
  readonly fundsMoved: false;
  readonly custody: false;
  readonly walletsGenerated: false;
  readonly privateKeysHeld: false;
}

export interface AgentPaymentHistoryDto {
  readonly payments: readonly PaymentIntentDto[];
  readonly fundsMoved: false;
  readonly custody: false;
}

