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

export interface RailDto {
  readonly type: string;
  readonly label: string;
  readonly description: string;
  readonly status: 'available' | 'planned';
}

export interface MetaDto {
  readonly mode: string;
  readonly engineVersion: string;
  readonly capabilities: {
    readonly compareRoutes: boolean;
    readonly executeTransactions: boolean;
    readonly custodyFunds: boolean;
    readonly holdCryptoAssets: boolean;
    readonly issueStablecoins: boolean;
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
