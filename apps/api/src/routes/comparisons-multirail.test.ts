import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComparisonDto, MultiRailRoutingDto } from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestHarness,
  type ApiEnvelope,
  type TestHarness,
} from '../testing/harness.js';

const here = dirname(fileURLToPath(import.meta.url));

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});

afterAll(async () => {
  await harness.close();
});

const USD_100K = { sourceCurrency: 'USD', targetCurrency: 'KRW', amount: '100000.00' };

describe('PA-H05 — /comparisons uses MultiRailRouter only', () => {
  it('does not reference RouteComparisonService from the HTTP handler or container', () => {
    const handler = readFileSync(resolve(here, 'comparisons.ts'), 'utf8');
    const container = readFileSync(resolve(here, '../container.ts'), 'utf8');
    expect(handler).not.toContain('RouteComparisonService');
    expect(handler).not.toContain('serializeComparison(');
    expect(handler).toContain('container.comparisons.compare');
    expect(container).not.toContain('RouteComparisonService');
    expect(container).toContain('ComparisonRoutingService');
  });

  it('returns the same ranking and pricing as POST /routes for a fixed fixture', async () => {
    const comparisonResponse = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons',
      payload: USD_100K,
    });
    const routesResponse = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/routes',
      payload: {
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '100000.00',
      },
    });

    expect(comparisonResponse.statusCode).toBe(201);
    expect(routesResponse.statusCode).toBe(201);

    const comparison = comparisonResponse.json<ApiEnvelope<ComparisonDto>>().data;
    const routed = routesResponse.json<ApiEnvelope<MultiRailRoutingDto>>().data;

    expect(comparison.engineVersion).toBe('2.0.0');
    expect(routed.routingEngineVersion).toBe('2.0.0');
    expect(comparison.engineVersion).toBe(routed.routingEngineVersion);

    const comparisonRank = comparison.routes.map((route) => ({
      providerId: route.provider.id,
      rank: route.rank,
      totalCostBps: route.totalCostBps,
      totalCostMinorUnits: route.totalCost.minorUnits,
    }));
    const routedRank = routed.routes.map((route) => ({
      providerId: route.provider.id,
      rank: route.rank,
      totalCostBps: route.totalCostBps,
      totalCostMinorUnits: route.estimatedCost.minorUnits,
    }));
    expect(comparisonRank).toEqual(routedRank);
  });

  it('returns identical ranking and pricing for two identical comparison requests', async () => {
    const first = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons',
      payload: USD_100K,
    });
    const second = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons',
      payload: USD_100K,
    });
    const a = first.json<ApiEnvelope<ComparisonDto>>().data;
    const b = second.json<ApiEnvelope<ComparisonDto>>().data;
    expect(a.routes.map((route) => [route.provider.id, route.rank, route.totalCost.minorUnits])).toEqual(
      b.routes.map((route) => [route.provider.id, route.rank, route.totalCost.minorUnits]),
    );
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});
