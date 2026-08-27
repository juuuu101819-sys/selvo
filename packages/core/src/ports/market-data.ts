import type { JsonObject } from '../domain/json.js';
import type { CurrencyCode } from '../money/currency.js';
import type {
  ProviderAdapter,
  ProviderContext,
  ProviderQuoteEnvelope,
} from './provider-adapter.js';

export interface MarketRateRequest {
  readonly baseCurrency: CurrencyCode;
  readonly quoteCurrency: CurrencyCode;
}

/**
 * A mid-market observation for one currency pair.
 *
 * This is the benchmark the whole cost model hangs on: every route's all-in cost is measured against
 * mid-market, so a wrong or stale mid rate mis-states every comparison that used it. That is why the
 * observation carries its own provenance — which feed, as of when, valid until when — rather than
 * being a bare number.
 */
export interface MarketRate extends ProviderQuoteEnvelope {
  readonly baseCurrency: CurrencyCode;
  readonly quoteCurrency: CurrencyCode;
  /** Units of `quoteCurrency` per one unit of `baseCurrency`, as an exact decimal string. */
  readonly rate: string;
  /** Bid and ask where the feed publishes them, so a spread can be observed rather than assumed. */
  readonly bid: string | null;
  readonly ask: string | null;
  /** Human-readable description of the feed, e.g. a dataset version or a vendor name. */
  readonly source: string;
  readonly metadata: JsonObject;
}

/**
 * A source of mid-market reference rates.
 *
 * Separate from {@link FXProvider} on purpose. A market data feed says what the market is; an FX
 * provider says what it will deal at. Conflating them is how a platform ends up measuring a
 * provider's cost against that same provider's own rate, which makes every route look free.
 */
export interface MarketDataProvider extends ProviderAdapter {
  readonly capability: 'market_data';
  /** Pairs this feed covers. Cheap, synchronous. */
  supports(request: MarketRateRequest): boolean;
  getMarketRate(request: MarketRateRequest, context: ProviderContext): Promise<MarketRate>;
}
