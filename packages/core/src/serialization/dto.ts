import type { FeeSide, PlatformMode, ProviderLicensing, RailType } from '../domain/index.js';
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

export interface RouteQuoteDto {
  readonly providerId: string;
  readonly quotedAt: string;
  readonly expiresAt: string | null;
  readonly quoteReference: string | null;
  readonly pricingVersion: string;
  readonly intermediaryAsset: string | null;
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
    readonly slippage: string;
    readonly liquidity: string;
    readonly risk: string;
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
    readonly slippage: string;
    readonly liquidity: string;
    readonly risk: string;
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
  readonly bucket: 'provider' | 'platform' | 'network' | 'gas' | 'other';
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
}
