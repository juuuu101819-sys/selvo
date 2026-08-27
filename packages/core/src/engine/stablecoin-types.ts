import type { ConversionKind } from '../domain/conversion.js';
import type { ChainMetadata } from '../domain/chain.js';
import type { ProviderCategory } from '../domain/provider-catalog.js';
import type { PlatformMode, ProviderLicensing } from '../domain/provider.js';
import type { ProviderFailure } from '../domain/route.js';
import type { SettlementEstimate, SlippageModel } from '../domain/quote.js';
import type { RailFamily, RailType } from '../domain/rail.js';
import type { AssetAmount } from '../money/asset-amount.js';
import type { Decimal } from '../money/index.js';
import type { StablecoinConversionKind } from '../domain/stablecoin.js';

export interface StablecoinQuoteRequest {
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly requestedAt: string;
}

export interface StablecoinRoute {
  readonly routeId: string;
  readonly rank: number;
  readonly recommended: boolean;
  readonly conversionKind: StablecoinConversionKind;
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
  readonly providerFee: AssetAmount;
  readonly networkFee: AssetAmount;
  readonly slippage: {
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
  readonly privateKeysGenerated: false;
  readonly executable: false;
  readonly delegateExecution: false;
}

export interface StablecoinRouting {
  readonly routingId: string;
  readonly organizationId: string | null;
  readonly createdAt: string;
  readonly mode: PlatformMode;
  readonly stablecoinRoutingEngineVersion: string;
  readonly conversionKind: ConversionKind;
  readonly aiUsed: false;
  readonly custody: false;
  readonly connectedToMainnet: false;
  readonly walletsCreated: false;
  readonly privateKeysGenerated: false;
  readonly executable: false;
  readonly delegateExecution: false;
  readonly request: StablecoinQuoteRequest;
  readonly routes: readonly StablecoinRoute[];
  readonly recommendedRoute: StablecoinRoute | null;
  readonly providerFailures: readonly ProviderFailure[];
  readonly explanation: string;
}
