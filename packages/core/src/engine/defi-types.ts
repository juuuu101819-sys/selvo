import type { ConversionKind } from '../domain/conversion.js';
import type { ChainMetadata } from '../domain/chain.js';
import type { DeFiRouteKind, DeFiVenueKind } from '../domain/defi-liquidity.js';
import type { ProviderCategory } from '../domain/provider-catalog.js';
import type { PlatformMode, ProviderLicensing } from '../domain/provider.js';
import type { ProviderFailure } from '../domain/route.js';
import type { SettlementEstimate, SlippageModel } from '../domain/quote.js';
import type { RailFamily, RailType } from '../domain/rail.js';
import type { AssetAmount } from '../money/asset-amount.js';
import type { Decimal } from '../money/index.js';

export interface DefiQuoteRequest {
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly requestedAt: string;
}

export interface DefiRoute {
  readonly routeId: string;
  readonly rank: number;
  readonly recommended: boolean;
  readonly routeKind: DeFiRouteKind;
  readonly venueKind: DeFiVenueKind | null;
  readonly conversionKind: ConversionKind;
  readonly asset: {
    readonly source: string;
    readonly destination: string;
  };
  readonly chain: {
    readonly source: ChainMetadata | null;
    readonly destination: ChainMetadata | null;
    readonly settlement: ChainMetadata | null;
  };
  readonly price: {
    readonly indicated: Decimal;
    readonly mid: Decimal;
  };
  readonly swapFee: AssetAmount;
  readonly networkFee: AssetAmount;
  readonly estimatedSlippage: {
    readonly bps: Decimal;
    readonly model: SlippageModel;
  };
  readonly liquidity: {
    readonly availableDepthMinorUnits: string | null;
    readonly venue: string | null;
    readonly chain: ChainMetadata | null;
  };
  readonly estimatedSettlementTime: SettlementEstimate;
  readonly expiration: string | null;
  readonly estimatedReceiveAmount: AssetAmount;
  readonly estimatedCost: AssetAmount;
  readonly totalCostBps: Decimal;
  readonly hops: readonly string[];
  readonly provider: {
    readonly id: string;
    readonly name: string;
    readonly rail: RailType;
    readonly railFamily: RailFamily;
    readonly category: ProviderCategory;
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

export interface DefiRouting {
  readonly routingId: string;
  readonly organizationId: string | null;
  readonly createdAt: string;
  readonly mode: PlatformMode;
  readonly defiRoutingEngineVersion: string;
  readonly conversionKind: ConversionKind;
  readonly aiUsed: false;
  readonly custody: false;
  readonly connectedToMainnet: false;
  readonly walletsCreated: false;
  readonly walletsConnected: false;
  readonly privateKeysGenerated: false;
  readonly swapSubmitted: false;
  readonly executable: false;
  readonly delegateExecution: false;
  readonly request: DefiQuoteRequest;
  readonly routes: readonly DefiRoute[];
  readonly recommendedRoute: DefiRoute | null;
  /** Same as `recommendedRoute`. Named so callers do not mistake a quote for a submitted swap. */
  readonly recommendedExecutionRoute: DefiRoute | null;
  readonly comparedFamilies: readonly ('defi' | 'stablecoin' | 'traditional')[];
  readonly providerFailures: readonly ProviderFailure[];
  readonly explanation: string;
}
