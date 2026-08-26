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
  readonly amount: MoneyJson;
  readonly rateBps: string | null;
  readonly capped: boolean;
}

export interface CostBreakdownDto {
  readonly appliedFees: readonly AppliedFeeDto[];
  readonly sourceFeeCost: MoneyJson;
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
  readonly slippageBps: string;
  readonly reliabilityScore: string;
  readonly settlement: SettlementDto;
  readonly breakdown: CostBreakdownDto;
  readonly score: string;
  readonly scoreComponents: {
    readonly cost: string;
    readonly speed: string;
    readonly reliability: string;
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
  };
}

export interface ReplayResultDto {
  readonly comparisonId: string;
  readonly reproducible: boolean;
  readonly originalFingerprint: string;
  readonly replayedFingerprint: string;
  readonly replayedAt: string;
  readonly comparison: ComparisonDto;
}
