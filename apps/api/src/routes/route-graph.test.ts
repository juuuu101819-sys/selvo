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

interface GraphPayload {
  readonly graphEngineVersion: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly executable: boolean;
  readonly nodes: readonly { readonly id: string; readonly kind: string }[];
  readonly edges: readonly { readonly id: string; readonly executable: boolean }[];
}

interface PathPayload {
  readonly graphEngineVersion: string;
  readonly aiUsed: boolean;
  readonly executable: boolean;
  readonly paths: readonly {
    readonly hops: number;
    readonly assets: readonly string[];
    readonly providers: readonly string[];
    readonly totalCostBps: string;
    readonly executable: boolean;
    readonly nodes: readonly { readonly kind: string; readonly label: string }[];
  }[];
  readonly recommendedPath: { readonly hops: number; readonly explanation: string } | null;
  readonly rejections: readonly { readonly reason: string }[];
  readonly explanation: string;
}

async function search(payload: Record<string, unknown>) {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/route-graph/paths',
    payload,
  });
  return {
    status: response.statusCode,
    body: response.json<ApiEnvelope<PathPayload> | ApiError>(),
  };
}

describe('GET /api/v1/route-graph', () => {
  it('returns the demo topology with every node kind and no executable edges', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/route-graph' });
    expect(response.statusCode).toBe(200);
    const body = response.json<ApiEnvelope<GraphPayload>>();
    expect(body.data.graphEngineVersion).toBe('1.0.0');
    expect(body.data.executable).toBe(false);
    expect(body.data.nodeCount).toBeGreaterThanOrEqual(15);
    expect(body.data.edgeCount).toBeGreaterThanOrEqual(20);
    expect(body.data.edges.every((edge) => edge.executable === false)).toBe(true);
    const kinds = new Set(body.data.nodes.map((node) => node.kind));
    for (const kind of [
      'FIAT',
      'STABLECOIN',
      'CRYPTO_ASSET',
      'BANK',
      'FX_PROVIDER',
      'PAYMENT_PROVIDER',
      'DEX',
      'AMM',
      'LIQUIDITY_POOL',
      'SETTLEMENT_PROVIDER',
    ]) {
      expect(kinds.has(kind)).toBe(true);
    }
  });
});

describe('POST /api/v1/route-graph/paths', () => {
  it('finds a one-hop USD → FX → KRW path', async () => {
    const { status, body } = await search({
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      constraints: { maxHops: 1 },
    });
    expect(status).toBe(201);
    const data = (body as ApiEnvelope<PathPayload>).data;
    expect(data.aiUsed).toBe(false);
    expect(data.executable).toBe(false);
    expect(data.graphEngineVersion).toBe('1.0.0');
    expect(data.paths.some((path) => path.hops === 1 && path.assets.join('→') === 'USD→KRW')).toBe(
      true,
    );
    expect(
      data.paths.some((path) => path.providers.includes('sandbox-veridian-payments')),
    ).toBe(true);
  });

  it('finds a two-hop USD → USDC → KRW path', async () => {
    const { status, body } = await search({
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      constraints: { maxHops: 2 },
    });
    expect(status).toBe(201);
    const data = (body as ApiEnvelope<PathPayload>).data;
    expect(
      data.paths.some(
        (path) => path.hops === 2 && path.assets.join('→') === 'USD→USDC→KRW',
      ),
    ).toBe(true);
  });

  it('finds a three-hop USD → USDC → USDT → KRW path', async () => {
    const { status, body } = await search({
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      constraints: { maxHops: 3 },
    });
    expect(status).toBe(201);
    const data = (body as ApiEnvelope<PathPayload>).data;
    const composed = data.paths.find((path) => path.assets.join('→') === 'USD→USDC→USDT→KRW');
    expect(composed?.hops).toBe(3);
    expect(composed?.executable).toBe(false);
    expect(composed?.providers[2]).toBe('demo-peninsula-settlement');
  });

  it('returns no path when every edge is pruned by cost', async () => {
    const { status, body } = await search({
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      constraints: { maxHops: 1, maxExpectedCostBps: '1' },
    });
    expect(status).toBe(201);
    const data = (body as ApiEnvelope<PathPayload>).data;
    expect(data.paths).toHaveLength(0);
    expect(data.rejections.some((rejection) => rejection.reason === 'HIGH_COST')).toBe(true);
  });

  it('rejects execute flags, keys and organizationId', async () => {
    const { status, body } = await search({
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      organizationId: 'org_other',
      execute: true,
      privateKey: '0xabc',
    });
    expect(status).toBe(400);
    expect((body as ApiError).error.code).toBe('VALIDATION_ERROR');
  });

  it('ranks POST /comparisons with MultiRailRouter 1.0.0', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons',
      payload: { sourceCurrency: 'USD', targetCurrency: 'KRW', amount: '100000.00' },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<ApiEnvelope<{ routes: unknown[]; engineVersion: string }>>();
    expect(body.data.routes.length).toBeGreaterThanOrEqual(3);
    expect(body.data.engineVersion).toBe('2.0.0');
  });
});
