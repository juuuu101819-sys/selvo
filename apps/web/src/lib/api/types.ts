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
    readonly defiQuotes: boolean;
    readonly defiExecution: boolean;
  };
  readonly execution: {
    readonly implemented: boolean;
    readonly delegated: boolean;
    readonly statusCode: number;
    readonly reason: string;
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

export interface AuthMeDto {
  readonly kind: string;
  readonly role: string | null;
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
  readonly revokedAt: string | null;
}

export interface DashboardSettingsDto {
  readonly organization: SessionOrganizationDto | null;
  readonly members: readonly PublicMemberDto[];
  readonly apiKeys: readonly PublicApiKeyDto[];
  readonly role: string | null;
}
