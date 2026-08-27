import { chainMetadata } from '../domain/chain.js';
import { chainOfAsset } from '../domain/stablecoin.js';
import type { DeFiRouteKind, DeFiVenueKind } from '../domain/defi-liquidity.js';
import { formatDecimal } from '../money/index.js';
import { isDeFiLiquiditySource } from '../ports/defi-liquidity.js';
import type { FinancialProvider } from '../ports/financial-provider.js';
import type { PricedMultiRailRoute } from './routing-types.js';
import type { DefiRoute } from './defi-types.js';

export function defiRouteKindOf(provider: FinancialProvider): DeFiRouteKind {
  if (isDeFiLiquiditySource(provider)) {
    return provider.venueKind;
  }
  return provider.getCapabilities().category === 'stablecoin' ? 'stablecoin' : 'traditional';
}

export function venueKindOf(provider: FinancialProvider): DeFiVenueKind | null {
  return isDeFiLiquiditySource(provider) ? provider.venueKind : null;
}

export function projectDefiRoute(
  priced: PricedMultiRailRoute,
  provider: FinancialProvider,
  rank: number,
  recommended: boolean,
): DefiRoute {
  const sourceChain = chainOfAsset(priced.sendAmount.asset);
  const destinationChain = chainOfAsset(priced.deliveredAmount.asset);
  const settlementChain = destinationChain ?? sourceChain;
  const routeKind = defiRouteKindOf(provider);

  return {
    routeId: priced.routeId,
    rank,
    recommended,
    routeKind,
    venueKind: venueKindOf(provider),
    conversionKind: priced.conversionKind,
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
    swapFee: priced.breakdown.providerFee,
    networkFee: priced.breakdown.networkFee,
    estimatedSlippage: {
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
    explanation: explainDefiRoute(priced, routeKind, recommended),
    custody: false,
    connectedToMainnet: false,
    walletsCreated: false,
    walletsConnected: false,
    privateKeysGenerated: false,
    swapSubmitted: false,
    executable: false,
    delegateExecution: false,
  };
}

export function explainDefiRoute(
  priced: PricedMultiRailRoute,
  routeKind: DeFiRouteKind,
  recommended: boolean,
): string {
  const lead = recommended ? 'Recommended execution route (not submitted). ' : '';
  return (
    `${lead}${routeKind} via ${priced.provider.name}. ` +
    `Price ${formatDecimal(priced.indicatedRate)} ${priced.deliveredAmount.asset} per 1 ` +
    `${priced.sendAmount.asset}. Indicative cost ${formatDecimal(priced.totalCostBps)} bps. ` +
    'Meridian does not submit a swap, connect a wallet, hold an asset or store a key.'
  );
}

export function explainDefiRouting(
  source: string,
  destination: string,
  routeCount: number,
  families: readonly string[],
): string {
  if (routeCount === 0) {
    return `No DEX, AMM, aggregator, stablecoin or traditional venue quoted ${source} → ${destination}.`;
  }
  const familyList = families.length === 0 ? 'available venues' : families.join(', ');
  return (
    `Quoted ${String(routeCount)} route${routeCount === 1 ? '' : 's'} ${source} → ${destination} ` +
    `across ${familyList}. Ranked by indicative cost, then settlement time. ` +
    'No swap is submitted. No model is used.'
  );
}
