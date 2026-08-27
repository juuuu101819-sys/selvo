import type { JsonObject } from '../domain/json.js';
import type { ProviderAdapter, ProviderContext, ProviderQuoteEnvelope } from './provider-adapter.js';

/**
 * Read-only on-chain depth.
 *
 * This port exists so a future DEX/AMM/aggregator adapter has a place to hang without teaching the
 * routing engine about pools, chains or wallets. Implementations MUST NOT:
 *
 * - hold or request a private key
 * - sign or submit a transaction
 * - wrap, unwrap, bridge or swap
 * - take custody of an asset
 *
 * A sandbox AMM adapter is registered on the *financial provider catalog*, not as a
 * `RouteProvider`. Depth quoting is read-only. DeFi execution is out of scope.
 */
export interface DexDepthRequest {
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly amountMinorUnits: string;
  readonly chainId: string | null;
}

export interface DexDepthQuote extends ProviderQuoteEnvelope {
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly chainId: string | null;
  readonly midMarketRate: string | null;
  readonly indicatedRate: string;
  readonly availableDepthMinorUnits: string | null;
  readonly venue: string;
  readonly metadata: JsonObject;
}

export interface DexLiquidityProvider extends ProviderAdapter {
  readonly capability: 'dex_liquidity';
  supports(request: DexDepthRequest): boolean;
  getDepth(request: DexDepthRequest, context: ProviderContext): Promise<DexDepthQuote>;
}
