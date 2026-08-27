import { describe, expect, it } from 'vitest';
import { buildDemoFinancialGraph } from './demo-graph.js';
import { discoverPaths } from './path-finder.js';
import { GRAPH_NODE_KINDS } from './types.js';

describe('buildDemoFinancialGraph', () => {
  const graph = buildDemoFinancialGraph();

  it('includes every node kind in the closed set', () => {
    const kinds = new Set(graph.nodes.map((node) => node.kind));
    expect([...GRAPH_NODE_KINDS].every((kind) => kinds.has(kind))).toBe(true);
  });

  it('discovers USD → FX Provider → KRW as a one-hop path', () => {
    const result = discoverPaths(graph, {
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      constraints: { maxHops: 1 },
    });
    const fx = result.paths.find((path) => path.providers.includes('sandbox-veridian-payments'));
    expect(fx?.hops).toBe(1);
    expect(fx?.nodes.map((node) => node.kind)).toEqual(['FIAT', 'FX_PROVIDER', 'FIAT']);
    expect(fx?.executable).toBe(false);
  });

  it('discovers USD → Helios → USDC → Helios → KRW as a two-hop path', () => {
    const result = discoverPaths(graph, {
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      constraints: { maxHops: 2 },
    });
    const ramp = result.paths.find(
      (path) =>
        path.hops === 2 &&
        path.assets.join('→') === 'USD→USDC→KRW' &&
        path.providers.every((id) => id === 'demo-helios-ramp'),
    );
    expect(ramp).toBeDefined();
    expect(ramp?.nodes.map((node) => node.kind)).toEqual([
      'FIAT',
      'SETTLEMENT_PROVIDER',
      'STABLECOIN',
      'SETTLEMENT_PROVIDER',
      'FIAT',
    ]);
  });

  it('discovers USD → USDC → USDT → KRW as a three-hop path', () => {
    const result = discoverPaths(graph, {
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      constraints: { maxHops: 3 },
    });
    const composed = result.paths.find((path) => path.assets.join('→') === 'USD→USDC→USDT→KRW');
    expect(composed).toBeDefined();
    expect(composed?.hops).toBe(3);
    expect(composed?.providers[0]).toBe('demo-helios-ramp');
    expect(['demo-meridian-pool', 'demo-horizon-aggregator']).toContain(composed?.providers[1]);
    expect(composed?.providers[2]).toBe('demo-peninsula-settlement');
    expect(result.aiUsed).toBe(false);
  });
});
