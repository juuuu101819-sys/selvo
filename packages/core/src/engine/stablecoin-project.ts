import { chainMetadata } from '../domain/chain.js';
import {
  chainOfAsset,
  isStablecoinConversionKind,
  type StablecoinConversionKind,
} from '../domain/stablecoin.js';
import { ValidationError } from '../errors/index.js';
import { formatDecimal } from '../money/index.js';
import type { PricedMultiRailRoute } from './routing-types.js';
import type { StablecoinRoute } from './stablecoin-types.js';

export function projectStablecoinRoute(
  priced: PricedMultiRailRoute,
  rank: number,
  recommended: boolean,
): StablecoinRoute {
  if (!isStablecoinConversionKind(priced.conversionKind)) {
    throw new ValidationError(
      `Cannot project a ${priced.conversionKind} quote onto the stablecoin routing layer.`,
      { conversionKind: priced.conversionKind },
    );
  }
  const conversionKind: StablecoinConversionKind = priced.conversionKind;
  const sourceChain = chainOfAsset(priced.sendAmount.asset);
  const destinationChain = chainOfAsset(priced.deliveredAmount.asset);
  const settlementChain = destinationChain ?? sourceChain;

  return {
    routeId: priced.routeId,
    rank,
    recommended,
    conversionKind,
    asset: {
      source: priced.sendAmount.asset,
      destination: priced.deliveredAmount.asset,
    },
    chain: {
      source: sourceChain,
      destination: destinationChain,
      settlement: settlementChain,
    },
    price: {
      indicated: priced.indicatedRate,
      mid: priced.midMarketRate,
    },
    providerFee: priced.breakdown.providerFee,
    networkFee: priced.breakdown.networkFee,
    slippage: {
      bps: priced.slippageBps,
      model: priced.slippage,
    },
    liquidity: {
      availableDepthMinorUnits: priced.quote.liquidity.availableDepthMinorUnits,
      venue: priced.quote.liquidity.venue,
      chain: chainMetadata(priced.quote.liquidity.chainId) ?? settlementChain,
    },
    estimatedSettlementTime: priced.settlement,
    expiration: priced.quote.expiresAt,
    estimatedReceiveAmount: priced.deliveredAmount,
    estimatedCost: priced.totalCost,
    totalCostBps: priced.totalCostBps,
    hops: priced.hops,
    provider: {
      id: priced.provider.id,
      name: priced.provider.name,
      rail: priced.rail,
      railFamily: priced.railFamily,
      category: priced.category,
      licensing: priced.provider.licensing,
    },
    explanation: explainStablecoinRoute(priced, recommended),
    custody: false,
    connectedToMainnet: false,
    walletsCreated: false,
    privateKeysGenerated: false,
    executable: false,
    delegateExecution: false,
  };
}

export function explainStablecoinRoute(
  priced: PricedMultiRailRoute,
  recommended: boolean,
): string {
  const lead = recommended ? 'Recommended. ' : '';
  return (
    `${lead}${priced.conversionKind.replaceAll('_', ' ')} via ${priced.provider.name}. ` +
    `Price ${formatDecimal(priced.indicatedRate)} ${priced.deliveredAmount.asset} per 1 ` +
    `${priced.sendAmount.asset} (mid ${formatDecimal(priced.midMarketRate)}). ` +
    `Indicative cost ${formatDecimal(priced.totalCostBps)} bps. ` +
    'Meridian does not custody the stablecoin, connect to mainnet, create a wallet or hold a key. ' +
    'Settlement is delegated to the provider when that capability exists; it is not executed here.'
  );
}

export function explainStablecoinRouting(
  source: string,
  destination: string,
  routeCount: number,
): string {
  if (routeCount === 0) {
    return `No stablecoin provider quoted ${source} → ${destination}.`;
  }
  return (
    `Quoted ${String(routeCount)} stablecoin route${routeCount === 1 ? '' : 's'} ` +
    `${source} → ${destination}. Ranked by indicative cost, then settlement time. ` +
    'No model is used. No wallet is created.'
  );
}
