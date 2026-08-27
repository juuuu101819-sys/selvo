import type { AssetDefinition } from '../domain/asset.js';
import type { ConversionKind } from '../domain/conversion.js';
import type { JsonObject } from '../domain/json.js';
import type { ProviderCapabilityProfile } from '../domain/provider-catalog.js';
import type { SettlementEstimate, SlippageModel } from '../domain/quote.js';
import type { CurrencyCode } from '../money/currency.js';
import type {
  ProviderAdapter,
  ProviderContext,
  ProviderQuoteEnvelope,
} from './provider-adapter.js';

/**
 * A transfer described in assets rather than ISO currencies.
 *
 * Fiat codes (`USD`) and on-chain tickers (`USDC`, `ETH`) are both assets. The comparison engine
 * never sees this request; it remains a `QuoteRequest` of ISO currencies.
 */
export interface NormalizedQuoteRequest {
  readonly sourceAsset: string;
  readonly targetAsset: string;
  /** Integer minor units of `sourceAsset`, as a string. */
  readonly amountMinorUnits: string;
  readonly requestedAt: string;
}

export interface NormalizedFee {
  readonly code: string;
  readonly label: string;
  readonly side: 'source' | 'destination';
  readonly kind: 'fixed' | 'proportional';
  readonly asset: string;
  readonly amountMinorUnits: string | null;
  readonly rateBps: string | null;
}

export interface LiquidityInfo {
  readonly availableDepthMinorUnits: string | null;
  readonly venue: string | null;
  readonly chainId: string | null;
}

/**
 * A price that can represent any conversion kind the catalog knows about.
 *
 * Deliberately primitives, not a ranked result: no total cost, no recommendation. `executable` is
 * always false — this platform does not swap, ramp, or pay out.
 */
export interface NormalizedQuote extends ProviderQuoteEnvelope {
  readonly conversionKind: ConversionKind;
  readonly sourceAsset: string;
  readonly targetAsset: string;
  readonly amountMinorUnits: string;
  /** Units of `targetAsset` per one unit of `sourceAsset`. */
  readonly indicatedRate: string;
  readonly midMarketRate: string | null;
  readonly fees: readonly NormalizedFee[];
  readonly settlement: SettlementEstimate;
  readonly liquidity: LiquidityInfo;
  readonly slippage: SlippageModel;
  /** Historical settlement success rate, `0`..`1`, as a decimal string. */
  readonly reliabilityScore: string;
  /** Always false. Meridian never holds keys or submits a transaction. */
  readonly executable: false;
  readonly chainId: string | null;
  readonly metadata: JsonObject;
}

/**
 * Multi-rail provider contract.
 *
 * Existing `FXProvider` / `PaymentProvider` / `LiquidityProvider` / `RouteProvider` ports stay.
 * This is the common façade they (and DeFi depth adapters) can present so a caller does not have
 * to know which rail family it is talking to in order to ask for a quote.
 *
 * Implementations MUST NOT hold private keys, control wallets, take custody, or submit on-chain
 * or fiat payments.
 */
export interface FinancialProvider extends ProviderAdapter {
  readonly capability: 'financial';
  getCapabilities(): ProviderCapabilityProfile;
  getSupportedAssets(): readonly AssetDefinition[];
  getSupportedCurrencies(): readonly CurrencyCode[];
  supportsNormalized(request: NormalizedQuoteRequest): boolean;
  getQuote(request: NormalizedQuoteRequest, context: ProviderContext): Promise<NormalizedQuote>;
  getSettlementEstimate(
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ): Promise<SettlementEstimate>;
  getFees(request: NormalizedQuoteRequest, context: ProviderContext): Promise<readonly NormalizedFee[]>;
  getLiquidityInfo(request: NormalizedQuoteRequest, context: ProviderContext): Promise<LiquidityInfo>;
}
