import type { ConversionKind } from '../domain/conversion.js';
import type { PlatformPricingRule } from '../domain/platform-pricing.js';
import type { ProviderCategory } from '../domain/provider-catalog.js';
import type { ProviderDescriptor, ProviderLicensing } from '../domain/provider.js';
import type { ProviderFailure } from '../domain/route.js';
import type { SettlementEstimate, SlippageModel } from '../domain/quote.js';
import type { RailFamily, RailType } from '../domain/rail.js';
import type { PlatformMode } from '../domain/provider.js';
import type { Decimal } from '../money/index.js';
import type { AssetAmount } from '../money/asset-amount.js';
import type { NormalizedQuote } from '../ports/financial-provider.js';
import type { QuoteFreshnessView } from '../quotes/quote-freshness.js';
import type {
  RoutingObjectiveSource,
  RoutingScoringFactor,
  SerializedObjectiveWeightBounds,
  SerializedRoutingWeights,
} from './routing-config.js';
import type { LiquidityState, RailHealthObservation, RailHealthState } from './rail-health.js';

export type RoutingFeeBucket =
  | 'provider'
  | 'platform'
  | 'network'
  | 'gas'
  | 'liquidity'
  | 'surcharge'
  | 'other';

export interface RoutedAppliedFee {
  readonly code: string;
  readonly label: string;
  readonly side: 'source' | 'destination';
  readonly kind: 'fixed' | 'proportional';
  readonly bucket: RoutingFeeBucket;
  readonly chargedBy: 'provider' | 'platform';
  readonly asset: string;
  readonly amount: AssetAmount;
  readonly rateBps: Decimal | null;
}

export interface RoutingCostBreakdown {
  readonly appliedFees: readonly RoutedAppliedFee[];
  readonly providerFee: AssetAmount;
  readonly platformFee: AssetAmount;
  readonly networkFee: AssetAmount;
  readonly gasFee: AssetAmount;
  readonly liquidityFee: AssetAmount;
  /** Configured DeFi/cross-chain surcharge, never implied by hop count. */
  readonly surchargeFee: AssetAmount;
  readonly spreadCost: AssetAmount;
  readonly slippageCost: AssetAmount;
  readonly roundingAdjustment: AssetAmount;
  readonly totalCost: AssetAmount;
}

export interface ComplianceEligibility {
  readonly eligible: true;
  readonly conversionKind: ConversionKind;
  readonly railFamily: RailFamily;
  readonly category: ProviderCategory;
  readonly licensing: ProviderLicensing;
  readonly jurisdictions: readonly string[];
  readonly kycRequired: boolean;
  readonly sanctionsScreeningRequired: boolean;
  /** Always false: this engine never executes. */
  readonly executable: false;
  readonly notes: string;
}

export interface PlannedRoute {
  readonly id: string;
  readonly hops: readonly string[];
  readonly status: 'planned';
  readonly explanation: string;
}

export interface RoutingConfiguredSurcharge {
  readonly code: string;
  readonly label: string;
  readonly rateBps: Decimal;
}

export interface RoutingPlatformCharge {
  readonly ruleId: string | null;
  readonly markupBps: Decimal;
  readonly discountBps: Decimal;
  readonly flatFee: AssetAmount | null;
  readonly surcharge: RoutingConfiguredSurcharge | null;
}

export interface PricedMultiRailRoute {
  readonly routeId: string;
  readonly available: true;
  readonly hops: readonly string[];
  readonly provider: ProviderDescriptor;
  readonly rail: RailType;
  readonly railFamily: RailFamily;
  readonly category: ProviderCategory;
  readonly conversionKind: ConversionKind;
  readonly quote: NormalizedQuote;
  readonly quoteFreshness: QuoteFreshnessView;
  readonly platformCharge: RoutingPlatformCharge;
  readonly sendAmount: AssetAmount;
  readonly deliveredAmount: AssetAmount;
  readonly benchmarkAmount: AssetAmount;
  readonly indicatedRate: Decimal;
  readonly midMarketRate: Decimal;
  readonly slippageAdjustedRate: Decimal;
  readonly effectiveRate: Decimal;
  readonly totalCost: AssetAmount;
  readonly totalCostBps: Decimal;
  readonly spreadBps: Decimal;
  readonly slippageBps: Decimal;
  readonly liquidityHeadroom: Decimal | null;
  readonly reliabilityScore: Decimal;
  readonly settlementConfidence: Decimal;
  readonly settlement: SettlementEstimate;
  readonly slippage: SlippageModel;
  readonly breakdown: RoutingCostBreakdown;
  readonly compliance: ComplianceEligibility;
}

export interface RoutingScoreComponents {
  readonly cost: Decimal;
  readonly speed: Decimal;
  readonly finality: Decimal;
  readonly fxRate: Decimal;
  readonly slippage: Decimal;
  readonly liquidity: Decimal;
  readonly compliance: Decimal;
}

export interface BestExecutionAlternative {
  readonly routeId: string;
  readonly providerId: string;
  readonly rank: number;
  readonly whyNotSelected: string;
}

/**
 * Deterministic record of why this path is (or is not) the recommended route among the
 * admitted candidate set. Hashes and catalog ids only — no beneficiary or account data.
 */
export interface BestExecutionAttestation {
  readonly selected: boolean;
  readonly rank: number;
  readonly competingRouteCount: number;
  readonly objectiveWeights: SerializedRoutingWeights;
  readonly rationale: string;
  readonly rationaleHash: string;
  readonly alternatives: readonly BestExecutionAlternative[];
  readonly railHealth: {
    readonly state: RailHealthState;
    readonly liquidityState: LiquidityState;
    readonly deprioritized: boolean;
    readonly excluded: false;
  };
  readonly constraintsSatisfied: readonly string[];
}

export interface ScoredMultiRailRoute extends PricedMultiRailRoute {
  readonly rank: number;
  readonly recommended: boolean;
  readonly routeScore: Decimal;
  readonly scoreComponents: RoutingScoreComponents;
  readonly routeExplanation: string;
  readonly railHealth: RailHealthObservation;
  readonly bestExecution: BestExecutionAttestation;
}

export interface RoutingRequest {
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly requestedAt: string;
}

export interface MultiRailRouting {
  readonly routingId: string;
  readonly organizationId: string | null;
  readonly createdAt: string;
  readonly mode: PlatformMode;
  readonly routingEngineVersion: string;
  readonly aiUsed: false;
  readonly request: RoutingRequest;
  readonly scoringWeights: SerializedRoutingWeights;
  readonly objectiveSource: RoutingObjectiveSource;
  readonly objectiveBounds: SerializedObjectiveWeightBounds;
  readonly railHealth: readonly RailHealthObservation[];
  readonly routes: readonly ScoredMultiRailRoute[];
  readonly recommendedRoute: ScoredMultiRailRoute | null;
  readonly routeScore: Decimal | null;
  readonly estimatedCost: AssetAmount | null;
  readonly estimatedReceiveAmount: AssetAmount | null;
  readonly estimatedSettlementTime: SettlementEstimate | null;
  readonly routeExplanation: string;
  readonly plannedRoutes: readonly PlannedRoute[];
  readonly providerFailures: readonly ProviderFailure[];
  /** Commercial terms captured for replay. Not serialised on the public DTO. */
  readonly pricingRules: readonly PlatformPricingRule[];
}

export const ROUTING_SCORE_FACTORS: readonly RoutingScoringFactor[] = [
  'cost',
  'speed',
  'finality',
  'fxRate',
  'slippage',
  'liquidity',
  'compliance',
];
