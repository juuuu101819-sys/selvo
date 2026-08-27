import type { JsonObject } from '../domain/json.js';
import type { SettlementEstimate, SlippageModel } from '../domain/quote.js';
import type { CurrencyCode } from '../money/currency.js';
import type {
  ProviderAdapter,
  ProviderContext,
  ProviderFee,
  ProviderQuoteEnvelope,
} from './provider-adapter.js';

export interface LiquidityQuoteRequest {
  readonly baseCurrency: CurrencyCode;
  readonly quoteCurrency: CurrencyCode;
  readonly amountMinorUnits: string;
}

/**
 * A wholesale desk's principal price, together with what it costs to trade in size.
 *
 * The distinguishing feature of a liquidity venue is that the price depends on the notional: a
 * quote that is keen at 50,000 may be poor at 5,000,000, and beyond the top of book the fill slips.
 * So this contract carries a slippage model rather than a single figure, and the engine applies it
 * at the requested size.
 */
export interface LiquidityQuote extends ProviderQuoteEnvelope {
  readonly baseCurrency: CurrencyCode;
  readonly quoteCurrency: CurrencyCode;
  readonly rate: string;
  readonly midMarketRate: string | null;
  readonly providerFee: ProviderFee | null;
  readonly additionalFees: readonly ProviderFee[];
  readonly amountMinorUnits: string;
  /** Expected execution slippage as a function of notional. */
  readonly slippage: SlippageModel;
  /** Notional the desk will fill at this price, in minor units of `baseCurrency`. */
  readonly availableDepthMinorUnits: string | null;
  readonly settlement: SettlementEstimate;
  readonly metadata: JsonObject;
}

export interface LiquidityProvider extends ProviderAdapter {
  readonly capability: 'liquidity';
  supports(request: LiquidityQuoteRequest): boolean;
  getLiquidityQuote(
    request: LiquidityQuoteRequest,
    context: ProviderContext,
  ): Promise<LiquidityQuote>;
}
