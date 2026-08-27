import { conversionKindOf } from '../domain/conversion.js';
import {
  FinancialRouteGraph,
  buildAssetNode,
  buildConversionEdge,
  buildVenueNode,
} from './graph.js';
import type { GraphAssetNode, GraphEdge, GraphVenueNode } from './types.js';

/**
 * Demo financial-route graph.
 *
 * Topology is static indicative metadata — not live quotes. Peninsula Settlement exists only on
 * this graph so `USD → USDC → USDT → KRW` can be discovered without teaching Helios to quote
 * USDT → KRW (which would change the multi-rail quote engine).
 *
 * Mapping:
 * - Northgate Bank → BANK
 * - Veridian Payments → FX_PROVIDER
 * - Solstice Settlement → PAYMENT_PROVIDER
 * - Aperture Liquidity → LIQUIDITY_POOL
 * - Helios Ramp → SETTLEMENT_PROVIDER
 * - Meridian Pool → AMM
 * - Horizon Aggregator → DEX
 * - Peninsula Settlement → SETTLEMENT_PROVIDER (USDT off-ramp, graph-only)
 */
export function buildDemoFinancialGraph(): FinancialRouteGraph {
  const assets: GraphAssetNode[] = [
    buildAssetNode('USD', 'FIAT', 'US dollar'),
    buildAssetNode('EUR', 'FIAT', 'Euro'),
    buildAssetNode('GBP', 'FIAT', 'Pound sterling'),
    buildAssetNode('KRW', 'FIAT', 'South Korean won'),
    buildAssetNode('USDC', 'STABLECOIN', 'USD Coin'),
    buildAssetNode('USDT', 'STABLECOIN', 'Tether USD'),
    buildAssetNode('ETH', 'CRYPTO_ASSET', 'Ether'),
  ];

  const northgate = buildVenueNode({
    providerId: 'sandbox-northgate-bank',
    kind: 'BANK',
    label: 'Northgate Bank',
  });
  const veridian = buildVenueNode({
    providerId: 'sandbox-veridian-payments',
    kind: 'FX_PROVIDER',
    label: 'Veridian Payments',
  });
  const solstice = buildVenueNode({
    providerId: 'sandbox-solstice-settlement',
    kind: 'PAYMENT_PROVIDER',
    label: 'Solstice Settlement',
  });
  const aperture = buildVenueNode({
    providerId: 'sandbox-meridian-liquidity',
    kind: 'LIQUIDITY_POOL',
    label: 'Aperture Liquidity',
  });
  const helios = buildVenueNode({
    providerId: 'demo-helios-ramp',
    kind: 'SETTLEMENT_PROVIDER',
    label: 'Helios Ramp',
  });
  const pool = buildVenueNode({
    providerId: 'demo-meridian-pool',
    kind: 'AMM',
    label: 'Meridian Pool',
  });
  const horizon = buildVenueNode({
    providerId: 'demo-horizon-aggregator',
    kind: 'DEX',
    label: 'Horizon Aggregator',
  });
  const peninsula = buildVenueNode({
    providerId: 'demo-peninsula-settlement',
    kind: 'SETTLEMENT_PROVIDER',
    label: 'Peninsula Settlement',
  });

  const venues: GraphVenueNode[] = [
    northgate,
    veridian,
    solstice,
    aperture,
    helios,
    pool,
    horizon,
    peninsula,
  ];

  const edges: GraphEdge[] = [];

  const fiatVenues: { venue: GraphVenueNode; majorBps: string; krwBps: string; usdLiq: bigint }[] =
    [
      { venue: northgate, majorBps: '18', krwBps: '72', usdLiq: 5_000_000_000n },
      { venue: veridian, majorBps: '12', krwBps: '48', usdLiq: 2_000_000_000n },
      { venue: solstice, majorBps: '8', krwBps: '34', usdLiq: 1_500_000_000n },
      { venue: aperture, majorBps: '10', krwBps: '38', usdLiq: 8_000_000_000n },
    ];

  for (const { venue, majorBps, krwBps, usdLiq } of fiatVenues) {
    addPair(edges, 'USD', 'EUR', venue, majorBps, usdLiq);
    addPair(edges, 'USD', 'GBP', venue, majorBps, usdLiq);
    addPair(edges, 'EUR', 'GBP', venue, majorBps, usdLiq);
    addPair(edges, 'USD', 'KRW', venue, krwBps, usdLiq);
    addPair(edges, 'EUR', 'KRW', venue, krwBps, usdLiq);
    addPair(edges, 'GBP', 'KRW', venue, krwBps, usdLiq);
  }

  // Helios: fiat ↔ USDC and USDC ↔ KRW. Not USDT — that would change live ramp quotes.
  addPair(edges, 'USD', 'USDC', helios, '18', 20_000_000_000000n);
  addPair(edges, 'EUR', 'USDC', helios, '22', 8_000_000_000000n);
  addPair(edges, 'GBP', 'USDC', helios, '24', 6_000_000_000000n);
  addPair(edges, 'USDC', 'KRW', helios, '42', 15_000_000_000000n);

  addPair(edges, 'USDC', 'USDT', pool, '8', 5_000_000_000000n);
  addPair(edges, 'ETH', 'USDC', pool, '30', 2_000_000_000000000000n);
  addPair(edges, 'ETH', 'USDT', pool, '32', 1_500_000_000000000000n);

  addPair(edges, 'USDC', 'USDT', horizon, '12', 9_000_000_000000n);
  addPair(edges, 'ETH', 'USDC', horizon, '25', 3_000_000_000000000000n);
  addPair(edges, 'ETH', 'USDT', horizon, '26', 2_500_000_000000000000n);
  // Indicative composite: crypto → fiat. The reverse is not a normalised conversion kind.
  addDirected(edges, 'ETH', 'USD', horizon, '40', 1_000_000_000000000000n);

  addPair(edges, 'USDT', 'KRW', peninsula, '45', 8_000_000_000000n);

  return FinancialRouteGraph.create([...assets, ...venues], edges);
}

function addDirected(
  edges: GraphEdge[],
  from: string,
  to: string,
  via: GraphVenueNode,
  costBps: string,
  liquidityMinorUnits: bigint,
): void {
  edges.push(
    buildConversionEdge({
      fromAsset: from,
      toAsset: to,
      via,
      conversionKind: conversionKindOf(from, to),
      costBps,
      liquidityMinorUnits,
      liquidityAsset: from,
    }),
  );
}

function addPair(
  edges: GraphEdge[],
  left: string,
  right: string,
  via: GraphVenueNode,
  costBps: string,
  liquidityMinorUnits: bigint,
): void {
  addDirected(edges, left, right, via, costBps, liquidityMinorUnits);
  addDirected(edges, right, left, via, costBps, liquidityMinorUnits);
}
