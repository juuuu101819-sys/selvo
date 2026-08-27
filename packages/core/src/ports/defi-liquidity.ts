import type { AssetDefinition } from '../domain/asset.js';
import type { ChainMetadata } from '../domain/chain.js';
import type { DeFiVenueKind } from '../domain/defi-liquidity.js';
import type { SlippageModel } from '../domain/quote.js';
import type { FinancialProvider, LiquidityInfo, NormalizedFee, NormalizedQuote, NormalizedQuoteRequest } from './financial-provider.js';
import type { ProviderContext } from './provider-adapter.js';

/**
 * Normalised DeFi liquidity source: DEX, AMM or aggregator.
 *
 * Distinct from {@link DexLiquidityProvider} (`getDepth`) and from {@link FinancialProvider}
 * (the catalog façade). A venue implements this *and* `FinancialProvider` so the catalog can
 * rank it next to a stablecoin ramp or an FX desk without the engine knowing which it is.
 *
 * Implementations MUST NOT hold a key, connect a customer wallet, take custody, or submit a swap.
 * `getQuote().executable` is always false.
 */
export interface DeFiLiquiditySource extends FinancialProvider {
  readonly venueKind: DeFiVenueKind;
  getQuote(request: NormalizedQuoteRequest, context: ProviderContext): Promise<NormalizedQuote>;
  getLiquidity(request: NormalizedQuoteRequest, context: ProviderContext): Promise<LiquidityInfo>;
  getSwapFee(request: NormalizedQuoteRequest, context: ProviderContext): Promise<NormalizedFee>;
  getEstimatedSlippage(
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ): Promise<SlippageModel>;
  getNetworkFee(request: NormalizedQuoteRequest, context: ProviderContext): Promise<NormalizedFee>;
  getSupportedTokens(): readonly AssetDefinition[];
  getSupportedChains(): readonly ChainMetadata[];
}

export function isDeFiLiquiditySource(provider: FinancialProvider): provider is DeFiLiquiditySource {
  return (
    'venueKind' in provider &&
    (provider.venueKind === 'dex' || provider.venueKind === 'amm' || provider.venueKind === 'aggregator')
  );
}
