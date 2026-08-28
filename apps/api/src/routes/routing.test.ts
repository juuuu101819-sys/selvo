import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestHarness,
  type ApiEnvelope,
  type ApiError,
  type TestHarness,
} from '../testing/harness.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});

afterAll(async () => {
  await harness.close();
});

interface RoutePayload {
  readonly routingEngineVersion: string;
  readonly aiUsed: boolean;
  readonly routes: readonly {
    readonly routeId: string;
    readonly recommended: boolean;
    readonly hops: readonly string[];
    readonly provider: { readonly id: string; readonly category: string; readonly railFamily: string };
    readonly conversionKind: string;
    readonly routeScore: string;
    readonly estimatedCost: { readonly asset: string; readonly minorUnits: string };
    readonly estimatedReceiveAmount: { readonly asset: string; readonly minorUnits: string };
    readonly estimatedSettlementTime: { readonly p50Seconds: number };
    readonly routeExplanation: string;
    readonly executable: boolean;
    readonly scoreComponents: {
      readonly cost: string;
      readonly speed: string;
      readonly liquidity: string;
      readonly reliability: string;
      readonly settlementConfidence: string;
    };
    readonly compliance: { readonly eligible: boolean; readonly executable: boolean };
  }[];
  readonly recommendedRoute: { readonly routeId: string; readonly routeExplanation: string } | null;
  readonly routeScore: string | null;
  readonly estimatedCost: { readonly asset: string } | null;
  readonly estimatedReceiveAmount: { readonly asset: string } | null;
  readonly estimatedSettlementTime: { readonly p50Seconds: number } | null;
  readonly routeExplanation: string;
  readonly plannedRoutes: readonly { readonly hops: readonly string[]; readonly status: string }[];
}

async function route(payload: Record<string, unknown>) {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/routes',
    payload,
  });
  return { status: response.statusCode, body: response.json<ApiEnvelope<RoutePayload> | ApiError>() };
}

describe('POST /api/v1/routes', () => {
  it('evaluates USD → KRW across traditional and stablecoin rails', async () => {
    const { status, body } = await route({
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amount: '100000.00',
    });
    expect(status).toBe(201);
    const data = (body as ApiEnvelope<RoutePayload>).data;
    expect(data.aiUsed).toBe(false);
    expect(data.routingEngineVersion).toBe('1.0.0');
    expect(data.routes.length).toBeGreaterThanOrEqual(3);
    const families = new Set(data.routes.map((item) => item.provider.railFamily));
    expect(families.has('tradfi')).toBe(true);
    expect(families.has('stablecoin')).toBe(true);
    expect(data.recommendedRoute).not.toBeNull();
    expect(data.routeScore).toMatch(/^\d+(\.\d+)?$/);
    expect(data.estimatedCost?.asset).toBe('KRW');
    expect(data.estimatedReceiveAmount?.asset).toBe('KRW');
    expect(data.estimatedSettlementTime?.p50Seconds).toBeGreaterThan(0);
    expect(data.routeExplanation).toContain('No model is used');
    expect(data.plannedRoutes[0]?.hops).toEqual(['USD', 'Stablecoin', 'DEX liquidity', 'KRW']);
    expect(data.routes.every((item) => item.executable === false)).toBe(true);
    const solstice = data.routes.find((item) => item.provider.id === 'sandbox-solstice-settlement');
    expect(solstice?.hops).toEqual(
      expect.arrayContaining(['USD', 'USDC', 'KRW']),
    );
  });

  it('evaluates USD → EUR without assuming one rail is cheapest', async () => {
    const { status, body } = await route({
      sourceAsset: 'USD',
      destinationAsset: 'EUR',
      amount: '100000.00',
    });
    expect(status).toBe(201);
    const data = (body as ApiEnvelope<RoutePayload>).data;
    expect(data.routes.length).toBeGreaterThanOrEqual(2);
    const scores = data.routes.map((item) => item.routeScore);
    expect(new Set(scores).size).toBeGreaterThan(1);
  });

  it('evaluates USD → USDC on the demo ramp', async () => {
    const { status, body } = await route({
      sourceAsset: 'USD',
      destinationAsset: 'USDC',
      amount: '10000.00',
    });
    expect(status).toBe(201);
    const data = (body as ApiEnvelope<RoutePayload>).data;
    expect(data.routes.some((item) => item.provider.id === 'demo-helios-ramp')).toBe(true);
    expect(data.routes.every((item) => item.conversionKind === 'fiat_stablecoin')).toBe(true);
    expect(data.estimatedReceiveAmount?.asset).toBe('USDC');
  });

  it('evaluates USDC → KRW on the demo off-ramp', async () => {
    const { status, body } = await route({
      sourceAsset: 'USDC',
      destinationAsset: 'KRW',
      amount: '100000',
    });
    expect(status).toBe(201);
    const data = (body as ApiEnvelope<RoutePayload>).data;
    expect(data.routes.some((item) => item.provider.id === 'demo-helios-ramp')).toBe(true);
    expect(data.routes.every((item) => item.conversionKind === 'stablecoin_fiat')).toBe(true);
    expect(data.estimatedReceiveAmount?.asset).toBe('KRW');
  });

  it('evaluates USDC → USDT on demo DeFi venues', async () => {
    const { status, body } = await route({
      sourceAsset: 'USDC',
      destinationAsset: 'USDT',
      amount: '10000',
    });
    expect(status).toBe(201);
    const data = (body as ApiEnvelope<RoutePayload>).data;
    expect(data.routes.map((item) => item.provider.id).sort()).toEqual([
      'demo-horizon-aggregator',
      'demo-meridian-pool',
      'demo-ridgeline-dex',
    ]);
    expect(data.routes.every((item) => item.conversionKind === 'stablecoin_stablecoin')).toBe(true);
    expect(data.routes.every((item) => item.provider.railFamily === 'defi')).toBe(true);
    expect(data.plannedRoutes).toEqual([]);
  });

  it('evaluates USDC → another stablecoin (USDT) with distinct economics', async () => {
    const { status, body } = await route({
      sourceAsset: 'USDC',
      targetAsset: 'USDT',
      amount: '25000',
    });
    expect(status).toBe(201);
    const data = (body as ApiEnvelope<RoutePayload>).data;
    expect(data.routes).toHaveLength(3);
    const costs = data.routes.map((item) => item.estimatedCost.minorUnits);
    expect(new Set(costs).size).toBeGreaterThan(1);
  });

  it('honours request scoring weights', async () => {
    const { status, body } = await route({
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amount: '100000.00',
      preferences: {
        weights: {
          cost: '0',
          speed: '1',
          liquidity: '0',
          reliability: '0',
          settlementConfidence: '0',
        },
      },
    });
    expect(status).toBe(201);
    const data = (body as ApiEnvelope<RoutePayload>).data;
    const fastest = [...data.routes].sort(
      (left, right) =>
        left.estimatedSettlementTime.p50Seconds - right.estimatedSettlementTime.p50Seconds,
    )[0];
    expect(data.recommendedRoute?.routeId).toBe(fastest?.routeId);
  });

  it('ranks POST /comparisons with the same MultiRailRouter as /routes', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons',
      payload: { sourceCurrency: 'USD', targetCurrency: 'KRW', amount: '100000.00' },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<ApiEnvelope<{ routes: unknown[]; engineVersion: string }>>();
    expect(body.data.routes.length).toBeGreaterThanOrEqual(3);
    expect(body.data.engineVersion).toBe('1.0.0');
  });

  it('rejects organizationId, execute flags and keys', async () => {
    const { status, body } = await route({
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amount: '100000.00',
      organizationId: 'org_other',
      execute: true,
      privateKey: '0xabc',
    });
    expect(status).toBe(400);
    expect((body as ApiError).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 422 for USDT → KRW, which no demo provider prices', async () => {
    const { status, body } = await route({
      sourceAsset: 'USDT',
      destinationAsset: 'KRW',
      amount: '1000',
    });
    expect(status).toBe(422);
    expect((body as ApiError).error.code).toBe('UNSUPPORTED_CORRIDOR');
  });
});
