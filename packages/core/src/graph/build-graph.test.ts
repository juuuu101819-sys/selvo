import { describe, expect, it } from 'vitest';
import { buildFinancialRouteGraph } from './build-graph.js';
import { venueNodeId } from './ids.js';

describe('buildFinancialRouteGraph', () => {
  it('returns the demo topology when demo adapters are included', () => {
    const graph = buildFinancialRouteGraph({ includeDemoAdapters: true });
    expect(graph.nodes.some((node) => node.kind === 'FIAT')).toBe(true);
    expect(graph.venueNode('demo-peninsula-settlement')).not.toBeNull();
    expect(graph.venueNode('sandbox-northgate-bank')).not.toBeNull();
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  it('returns an empty graph when demo adapters are off and no licensed metadata is configured', () => {
    const graph = buildFinancialRouteGraph({
      includeDemoAdapters: false,
      licensedVenueMetadata: [],
    });
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.size).toEqual({ nodes: 0, edges: 0 });
  });

  it('does not fall back to demo nodes when licensed metadata is omitted', () => {
    const graph = buildFinancialRouteGraph({ includeDemoAdapters: false });
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.venueNode('demo-peninsula-settlement')).toBeNull();
    expect(graph.venueNode('sandbox-northgate-bank')).toBeNull();
  });

  it('builds only the supplied licensed venue metadata when demo adapters are off', () => {
    const graph = buildFinancialRouteGraph({
      includeDemoAdapters: false,
      licensedVenueMetadata: [
        {
          providerId: 'licensed-test-desk',
          label: 'Test Desk',
          kind: 'BANK',
          edges: [
            { fromAsset: 'USD', toAsset: 'EUR', costBps: '11', liquidityMinorUnits: '1000000000' },
            { fromAsset: 'EUR', toAsset: 'USD', costBps: '11', liquidityMinorUnits: '900000000' },
          ],
        },
      ],
    });

    expect(graph.nodes.map((node) => node.id).sort()).toEqual(
      ['asset:EUR', 'asset:USD', venueNodeId('licensed-test-desk')].sort(),
    );
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.every((edge) => edge.providerId === 'licensed-test-desk')).toBe(true);
    expect(graph.edges.every((edge) => edge.executable === false)).toBe(true);
    expect(graph.venueNode('demo-peninsula-settlement')).toBeNull();
    expect(graph.venueNode('sandbox-northgate-bank')).toBeNull();
    expect(graph.venueNode('licensed-test-desk')?.kind).toBe('BANK');
  });
});
