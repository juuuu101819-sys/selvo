import {
  chainsForDeFiVenue,
  UnsupportedCorridorError,
  type ChainMetadata,
  type LiquidityInfo,
  type NormalizedFee,
  type NormalizedQuoteRequest,
  type ProviderContext,
  type SlippageModel,
} from '@meridian/core';

export function requireNamedFee(
  fees: readonly NormalizedFee[],
  code: string,
  source: string,
  target: string,
): NormalizedFee {
  const fee = fees.find((item) => item.code === code);
  if (fee === undefined) {
    throw new UnsupportedCorridorError(source, target);
  }
  return fee;
}

export async function liquidityFromQuote(
  getQuote: (
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ) => Promise<{ readonly liquidity: LiquidityInfo }>,
  request: NormalizedQuoteRequest,
  context: ProviderContext,
): Promise<LiquidityInfo> {
  return (await getQuote(request, context)).liquidity;
}

export async function slippageFromQuote(
  getQuote: (
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ) => Promise<{ readonly slippage: SlippageModel }>,
  request: NormalizedQuoteRequest,
  context: ProviderContext,
): Promise<SlippageModel> {
  return (await getQuote(request, context)).slippage;
}

export function supportedDefiChains(): readonly ChainMetadata[] {
  return chainsForDeFiVenue();
}
