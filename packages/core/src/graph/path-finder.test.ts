import { describe, expect, it } from 'vitest';
import { conversionKindOf } from '../domain/conversion.js';
import { formatDecimal } from '../money/index.js';
import {
  FinancialRouteGraph,
  buildAssetNode,
  buildConversionEdge,
  buildVenueNode,
} from './graph.js';
import { discoverPaths } from './path-finder.js';
import type { GraphEdge, GraphVenueNode } from './types.js';

function edge(input: {
  readonly from: string;
  readonly to: string;
  readonly via: GraphVenueNode;
  readonly costBps: string;
  readonly available?: boolean;
  readonly complianceEligible?: boolean;
  readonly liquidityMinorUnits?: bigint | null;
  readonly liquidityAsset?: string;
}): GraphEdge {
  return buildConversionEdge({
    fromAsset: input.from,
    toAsset: input.to,
    via: input.via,
    conversionKind: conversionKindOf(input.from, input.to),
    costBps: input.costBps,
    available: input.available,
    complianceEligible: input.complianceEligible,
    liquidityMinorUnits: input.liquidityMinorUnits,
    liquidityAsset: input.liquidityAsset,
  });
}

/**
 * Fixture covering every required search behaviour without depending on the product demo graph.
 *
 * USD → FX → KRW                         one hop
 * USD → Ramp → USDC → DEX → KRW          two hop
 * USD → Ramp → USDC → AMM → USDT → Off   three hop
 * plus unavailable, expensive, thin, and cyclic extras
 */
function fixtureGraph(): FinancialRouteGraph {
  const usd = buildAssetNode('USD', 'FIAT');
  const krw = buildAssetNode('KRW', 'FIAT');
  const usdc = buildAssetNode('USDC', 'STABLECOIN');
  const usdt = buildAssetNode('USDT', 'STABLECOIN');
  const eur = buildAssetNode('EUR', 'FIAT');

  const fx = buildVenueNode({ providerId: 'fx', kind: 'FX_PROVIDER', label: 'FX Desk' });
  const ramp = buildVenueNode({
    providerId: 'ramp',
    kind: 'SETTLEMENT_PROVIDER',
    label: 'Ramp',
  });
  const dex = buildVenueNode({ providerId: 'dex', kind: 'DEX', label: 'DEX' });
  const amm = buildVenueNode({ providerId: 'amm', kind: 'AMM', label: 'AMM' });
  const offramp = buildVenueNode({
    providerId: 'offramp',
    kind: 'SETTLEMENT_PROVIDER',
    label: 'Off-ramp',
  });
  const bank = buildVenueNode({ providerId: 'bank', kind: 'BANK', label: 'Expensive Bank' });
  const thinPool = buildVenueNode({
    providerId: 'thin',
    kind: 'LIQUIDITY_POOL',
    label: 'Thin Pool',
  });
  const down = buildVenueNode({
    providerId: 'down',
    kind: 'PAYMENT_PROVIDER',
    label: 'Down Provider',
    available: false,
  });

  return FinancialRouteGraph.create(
    [usd, krw, usdc, usdt, eur, fx, ramp, dex, amm, offramp, bank, thinPool, down],
    [
      edge({ from: 'USD', to: 'KRW', via: fx, costBps: '20', liquidityMinorUnits: 1_000_000_000n }),
      edge({ from: 'USD', to: 'USDC', via: ramp, costBps: '18', liquidityMinorUnits: 500_000_000n }),
      edge({ from: 'USDC', to: 'KRW', via: dex, costBps: '10', liquidityMinorUnits: 200_000_000n }),
      edge({ from: 'USDC', to: 'USDT', via: amm, costBps: '8', liquidityMinorUnits: 100_000_000n }),
      edge({ from: 'USDT', to: 'KRW', via: offramp, costBps: '45', liquidityMinorUnits: 80_000_000n }),
      edge({ from: 'USDC', to: 'USD', via: ramp, costBps: '18', liquidityMinorUnits: 500_000_000n }),
      edge({
        from: 'USD',
        to: 'EUR',
        via: fx,
        costBps: '12',
        available: false,
        liquidityMinorUnits: 1_000_000_000n,
      }),
      edge({
        from: 'USD',
        to: 'KRW',
        via: bank,
        costBps: '500',
        liquidityMinorUnits: 2_000_000_000n,
      }),
      edge({
        from: 'USDC',
        to: 'KRW',
        via: thinPool,
        costBps: '15',
        liquidityMinorUnits: 1_000n,
        liquidityAsset: 'USDC',
      }),
      edge({
        from: 'EUR',
        to: 'KRW',
        via: down,
        costBps: '30',
        liquidityMinorUnits: 1_000_000_000n,
      }),
    ],
  );
}

function assetsOf(path: { readonly assets: readonly string[] }): string {
  return path.assets.join('→');
}

describe('discoverPaths', () => {
  const graph = fixtureGraph();

  it('finds a one-hop route USD → FX → KRW', () => {
    const result = discoverPaths(graph, {
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      constraints: { maxHops: 1 },
    });

    expect(result.aiUsed).toBe(false);
    expect(result.executable).toBe(false);
    expect(result.paths.length).toBeGreaterThanOrEqual(1);
    const oneHop = result.paths.filter((path) => path.hops === 1);
    expect(oneHop.map(assetsOf)).toContain('USD→KRW');
    const viaFx = oneHop.find((path) => path.providers.includes('fx'));
    expect(viaFx).toBeDefined();
    expect(viaFx?.nodes.map((node) => node.kind)).toEqual(['FIAT', 'FX_PROVIDER', 'FIAT']);
    expect(viaFx?.executable).toBe(false);
    expect(formatDecimal(viaFx!.totalCostBps)).toBe('20');
    expect(result.recommendedPath?.providers).toContain('fx');
  });

  it('finds a two-hop route USD → USDC → KRW', () => {
    const result = discoverPaths(graph, {
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      constraints: { maxHops: 2 },
    });

    const twoHop = result.paths.filter((path) => path.hops === 2);
    expect(twoHop.map(assetsOf)).toContain('USD→USDC→KRW');
    const viaDex = twoHop.find((path) => path.providers.includes('dex'));
    expect(viaDex?.nodes.map((node) => node.kind)).toEqual([
      'FIAT',
      'SETTLEMENT_PROVIDER',
      'STABLECOIN',
      'DEX',
      'FIAT',
    ]);
    expect(formatDecimal(viaDex!.totalCostBps)).toBe('28');
  });

  it('finds a three-hop route USD → USDC → USDT → KRW', () => {
    const result = discoverPaths(graph, {
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      constraints: { maxHops: 3 },
    });

    const threeHop = result.paths.filter((path) => path.hops === 3);
    expect(threeHop.map(assetsOf)).toContain('USD→USDC→USDT→KRW');
    const composed = threeHop.find((path) => path.providers.join('→') === 'ramp→amm→offramp');
    expect(composed).toBeDefined();
    expect(formatDecimal(composed!.totalCostBps)).toBe('71');
    expect(composed?.nodes.map((node) => node.kind)).toEqual([
      'FIAT',
      'SETTLEMENT_PROVIDER',
      'STABLECOIN',
      'AMM',
      'STABLECOIN',
      'SETTLEMENT_PROVIDER',
      'FIAT',
    ]);
  });

  it('does not traverse an unavailable edge', () => {
    const result = discoverPaths(graph, {
      sourceAsset: 'USD',
      destinationAsset: 'EUR',
      constraints: { maxHops: 4 },
    });

    expect(result.paths).toHaveLength(0);
    expect(result.recommendedPath).toBeNull();
    expect(result.rejections.some((rejection) => rejection.reason === 'UNAVAILABLE_EDGE')).toBe(
      true,
    );
    expect(result.explanation).toMatch(/No path from USD to EUR/);
  });

  it('prunes a high-cost route against maxExpectedCostBps', () => {
    const result = discoverPaths(graph, {
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      constraints: { maxHops: 1, maxExpectedCostBps: '100' },
    });

    expect(result.paths.every((path) => !path.providers.includes('bank'))).toBe(true);
    expect(result.paths.some((path) => path.providers.includes('fx'))).toBe(true);
    expect(result.rejections.some((rejection) => rejection.reason === 'HIGH_COST')).toBe(true);

    const blocked = discoverPaths(graph, {
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      constraints: { maxHops: 1, maxExpectedCostBps: '15' },
    });
    expect(blocked.paths).toHaveLength(0);
    expect(blocked.rejections.some((rejection) => rejection.reason === 'HIGH_COST')).toBe(true);
  });

  it('prunes an insufficient-liquidity edge', () => {
    const result = discoverPaths(graph, {
      sourceAsset: 'USDC',
      destinationAsset: 'KRW',
      constraints: {
        maxHops: 1,
        minLiquidityMinorUnits: '10000',
        liquidityAsset: 'USDC',
      },
    });

    expect(result.paths.every((path) => !path.providers.includes('thin'))).toBe(true);
    expect(result.paths.some((path) => path.providers.includes('dex'))).toBe(true);
    expect(result.rejections.some((rejection) => rejection.reason === 'INSUFFICIENT_LIQUIDITY')).toBe(
      true,
    );

    const blocked = discoverPaths(graph, {
      sourceAsset: 'USDC',
      destinationAsset: 'KRW',
      constraints: {
        maxHops: 1,
        minLiquidityMinorUnits: '1000000000',
        liquidityAsset: 'USDC',
      },
    });
    expect(blocked.paths).toHaveLength(0);
    expect(blocked.rejections.some((rejection) => rejection.reason === 'INSUFFICIENT_LIQUIDITY')).toBe(
      true,
    );
  });

  it('prevents circular routes from looping or being returned', () => {
    const result = discoverPaths(graph, {
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      constraints: { maxHops: 8 },
    });

    expect(result.rejections.some((rejection) => rejection.reason === 'CYCLE')).toBe(true);
    for (const path of result.paths) {
      const assets = path.assets;
      expect(new Set(assets).size).toBe(assets.length);
      expect(`|${assets.join('|')}|`).not.toContain('|USD|USDC|USD|');
    }
    expect(result.paths.some((path) => path.hops > 3)).toBe(false);
  });

  it('respects a supported-assets allow-list', () => {
    const fiatOnly = discoverPaths(graph, {
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      constraints: { maxHops: 3, supportedAssets: ['USD', 'KRW'] },
    });
    expect(fiatOnly.paths.every((path) => path.hops === 1)).toBe(true);
    expect(fiatOnly.rejections.some((rejection) => rejection.reason === 'UNSUPPORTED_ASSET')).toBe(
      true,
    );
  });

  it('skips an unavailable venue even when its edge is marked available', () => {
    const result = discoverPaths(graph, {
      sourceAsset: 'EUR',
      destinationAsset: 'KRW',
      constraints: { maxHops: 1 },
    });
    expect(result.paths).toHaveLength(0);
    expect(result.rejections.some((rejection) => rejection.reason === 'PROVIDER_UNAVAILABLE')).toBe(
      true,
    );
  });
});
