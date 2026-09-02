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

interface CatalogPayload {
  readonly defiRoutingEngineVersion: string;
  readonly venueKinds: readonly string[];
  readonly custody: boolean;
  readonly connectedToMainnet: boolean;
  readonly walletsConnected: boolean;
  readonly swapSubmitted: boolean;
  readonly executable: boolean;
  readonly pools: readonly { readonly id: string; readonly custodiedByPlatform: boolean }[];
  readonly venues: readonly {
    readonly id: string;
    readonly venueKind: string;
    readonly chains: readonly { readonly connected: boolean; readonly rpcUrl: null }[];
  }[];
  readonly chains: readonly { readonly id: string; readonly connected: boolean; readonly name: string }[];
}

interface RoutePayload {
  readonly defiRoutingEngineVersion: string;
  readonly conversionKind: string;
  readonly comparedFamilies: readonly string[];
  readonly swapSubmitted: boolean;
  readonly executable: boolean;
  readonly walletsConnected: boolean;
  readonly privateKeysGenerated: boolean;
  readonly custody: boolean;
  readonly connectedToMainnet: boolean;
  readonly recommendedExecutionRoute: {
    readonly routeId: string;
    readonly executable: boolean;
    readonly swapSubmitted: boolean;
  } | null;
  readonly routes: readonly {
    readonly routeKind: string;
    readonly venueKind: string | null;
    readonly asset: { readonly source: string; readonly destination: string };
    readonly price: { readonly indicated: string };
    readonly swapFee: { readonly asset: string };
    readonly networkFee: { readonly asset: string };
    readonly estimatedSlippage: { readonly bps: string };
    readonly liquidity: { readonly availableDepthMinorUnits: string | null };
    readonly estimatedSettlementTime: { readonly p50Seconds: number };
    readonly expiration: string | null;
    readonly provider: { readonly id: string; readonly category: string };
    readonly executable: boolean;
  }[];
}

async function quote(payload: Record<string, unknown>) {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/defi-routes',
    payload,
  });
  return { status: response.statusCode, body: response.json<ApiEnvelope<RoutePayload> | ApiError>() };
}

describe('GET /api/v1/defi-liquidity', () => {
  it('lists demo pools and disconnected chain metadata', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/defi-liquidity' });
    expect(response.statusCode).toBe(200);
    const data = response.json<ApiEnvelope<CatalogPayload>>().data;
    expect(data.defiRoutingEngineVersion).toBe('1.0.0');
    expect(data.venueKinds).toEqual(['dex', 'amm', 'aggregator']);
    expect(data.pools.map((pool) => pool.id).sort()).toEqual(['ETH/USDC', 'ETH/USDT', 'USDC/USDT']);
    expect(data.pools.every((pool) => pool.custodiedByPlatform === false)).toBe(true);
    expect(data.venues.map((venue) => venue.venueKind).sort()).toEqual([
      'aggregator',
      'amm',
      'dex',
    ]);
    expect(data.venues.every((venue) => venue.chains.every((chain) => chain.connected === false))).toBe(
      true,
    );
    expect(data.chains.some((chain) => chain.name === 'Arbitrum')).toBe(true);
    expect(data.chains.some((chain) => chain.name === 'Solana')).toBe(true);
    expect(data.chains.every((chain) => chain.connected === false)).toBe(true);
    expect(data.custody).toBe(false);
    expect(data.swapSubmitted).toBe(false);
    expect(data.walletsConnected).toBe(false);
    expect(data.executable).toBe(false);
  });
});

describe('POST /api/v1/defi-routes', () => {
  it('compares DEX, AMM and aggregator on USDC → USDT', async () => {
    const { status, body } = await quote({
      sourceAsset: 'USDC',
      destinationAsset: 'USDT',
      amount: '10000',
    });
    expect(status).toBe(201);
    const data = (body as ApiEnvelope<RoutePayload>).data;
    expect(data.defiRoutingEngineVersion).toBe('1.0.0');
    expect(data.conversionKind).toBe('stablecoin_stablecoin');
    expect(data.comparedFamilies).toEqual(['defi']);
    expect(data.routes.map((item) => item.routeKind).sort()).toEqual(['aggregator', 'amm', 'dex']);
    expect(data.recommendedExecutionRoute?.executable).toBe(false);
    expect(data.recommendedExecutionRoute?.swapSubmitted).toBe(false);
    expect(data.routes.every((item) => item.executable === false)).toBe(true);
    const sample = data.routes[0];
    expect(sample?.swapFee.asset).toBe('USDT');
    expect(sample?.networkFee.asset).toBe('USDT');
    expect(sample?.estimatedSlippage.bps).toMatch(/^\d/);
    expect(sample?.liquidity.availableDepthMinorUnits).not.toBeNull();
    expect(sample?.estimatedSettlementTime.p50Seconds).toBeGreaterThan(0);
    expect(sample?.expiration).toMatch(/Z$/);
    expect(data.walletsConnected).toBe(false);
    expect(data.privateKeysGenerated).toBe(false);
    expect(data.custody).toBe(false);
    expect(data.connectedToMainnet).toBe(false);
  });

  it('quotes ETH → USDC and ETH → USDT on demo pools', async () => {
    const usdc = await quote({ sourceAsset: 'ETH', destinationAsset: 'USDC', amount: '1' });
    expect(usdc.status).toBe(201);
    const usdcData = (usdc.body as ApiEnvelope<RoutePayload>).data;
    expect(usdcData.conversionKind).toBe('crypto_stablecoin');
    expect(usdcData.routes.some((item) => item.provider.id === 'demo-ridgeline-dex')).toBe(true);
    expect(usdcData.routes.some((item) => item.provider.id === 'demo-meridian-pool')).toBe(true);

    const usdt = await quote({ sourceAsset: 'ETH', targetAsset: 'USDT', amount: '1' });
    expect(usdt.status).toBe(201);
    expect((usdt.body as ApiEnvelope<RoutePayload>).data.conversionKind).toBe('crypto_stablecoin');
  });

  it('compares traditional FX and stablecoin settlement on USD → KRW', async () => {
    const { status, body } = await quote({
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amount: '100000.00',
    });
    expect(status).toBe(201);
    const data = (body as ApiEnvelope<RoutePayload>).data;
    expect(data.comparedFamilies).toEqual(['stablecoin', 'traditional']);
    expect(data.routes.some((item) => item.routeKind === 'traditional')).toBe(true);
    expect(data.routes.some((item) => item.routeKind === 'stablecoin')).toBe(true);
    expect(data.routes.every((item) => item.venueKind === null)).toBe(true);
    expect(data.executable).toBe(false);
  });

  it('quotes a stablecoin ramp on USD → USDC when no DEX prices fiat', async () => {
    const { status, body } = await quote({
      sourceAsset: 'USD',
      destinationAsset: 'USDC',
      amount: '10000.00',
    });
    expect(status).toBe(201);
    const data = (body as ApiEnvelope<RoutePayload>).data;
    expect(data.comparedFamilies).toEqual(['stablecoin']);
    expect(data.routes[0]?.provider.id).toBe('demo-helios-ramp');
  });

  it('rejects execute flags, keys and wallets', async () => {
    const { status, body } = await quote({
      sourceAsset: 'USDC',
      destinationAsset: 'USDT',
      amount: '10000',
      execute: true,
      privateKey: '0xabc',
      wallet: '0xdef',
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
