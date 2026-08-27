import type { JsonObject } from '../domain/json.js';
import type { SettlementEstimate } from '../domain/quote.js';
import type { CurrencyCode } from '../money/currency.js';
import type {
  ProviderAdapter,
  ProviderContext,
  ProviderFee,
  ProviderQuoteEnvelope,
} from './provider-adapter.js';

export interface FXQuoteRequest {
  readonly baseCurrency: CurrencyCode;
  readonly quoteCurrency: CurrencyCode;
  /** Notional in integer minor units of `baseCurrency`. Size affects the price a desk will show. */
  readonly amountMinorUnits: string;
}

/**
 * A provider's price for converting one currency into another.
 *
 * The shape is deliberately close to what a real FX API returns: a rate, a charge, when it was made
 * and when it stops being good. What it does *not* contain is a total cost, a ranking or a
 * recommendation — those are derived by the routing engine from these primitives, so that every
 * route in a comparison is measured the same way and no provider can define its own notion of cheap.
 */
export interface FXQuote extends ProviderQuoteEnvelope {
  readonly baseCurrency: CurrencyCode;
  readonly quoteCurrency: CurrencyCode;
  /** Offered rate: units of `quoteCurrency` per one unit of `baseCurrency`, exact decimal string. */
  readonly rate: string;
  /**
   * The mid-market rate the provider observed, where it discloses one.
   *
   * Null is common and not a defect — many providers quote only their own price. The platform then
   * takes the benchmark from a {@link MarketDataProvider} instead, which is the more trustworthy
   * source anyway.
   */
  readonly midMarketRate: string | null;
  /** The provider's own charge. Null when it prices entirely inside the spread. */
  readonly providerFee: ProviderFee | null;
  /** Any further charges, such as a correspondent or beneficiary credit fee. */
  readonly additionalFees: readonly ProviderFee[];
  /** Echo of the requested notional, so a quote can be matched to what was asked. */
  readonly amountMinorUnits: string;
  readonly settlement: SettlementEstimate;
  readonly metadata: JsonObject;
}

/**
 * A counterparty that will convert currency: a bank FX desk, a broker, a payment institution's
 * in-house desk.
 */
export interface FXProvider extends ProviderAdapter {
  readonly capability: 'fx';
  /** Corridor coverage and notional limits. Cheap, synchronous. */
  supports(request: FXQuoteRequest): boolean;
  getFXQuote(request: FXQuoteRequest, context: ProviderContext): Promise<FXQuote>;
}
