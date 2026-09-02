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
  readonly stablecoinRoutingEngineVersion: string;
  readonly conversionKinds: readonly string[];
  readonly custody: boolean;
  readonly connectedToMainnet: boolean;
  readonly walletsCreated: boolean;
  readonly privateKeysGenerated: boolean;
  readonly executable: boolean;
  readonly delegateExecution: boolean;
  readonly stablecoins: readonly {
    readonly code: string;
    readonly custodiedByPlatform: boolean;
    readonly defaultChain: { readonly id: string; readonly connected: boolean; readonly rpcUrl: null };
  }[];
  readonly chains: readonly {
    readonly id: string;
    readonly connected: boolean;
    readonly rpcUrl: null;
    readonly quoting: string;
  }[];
}

interface RoutePayload {
  readonly stablecoinRoutingEngineVersion: string;
  readonly conversionKind: string;
  readonly aiUsed: boolean;
  readonly custody: boolean;
  readonly connectedToMainnet: boolean;
  readonly walletsCreated: boolean;
  readonly privateKeysGenerated: boolean;
  readonly executable: boolean;
  readonly delegateExecution: boolean;
  readonly routes: readonly {
    readonly asset: { readonly source: string; readonly destination: string };
    readonly chain: {
      readonly source: { readonly id: string; readonly connected: boolean } | null;
      readonly destination: { readonly id: string; readonly connected: boolean } | null;
    };
    readonly price: { readonly indicated: string; readonly mid: string };
    readonly providerFee: { readonly asset: string; readonly minorUnits: string };
    readonly networkFee: { readonly asset: string; readonly minorUnits: string };
    readonly slippage: { readonly bps: string; readonly model: { readonly kind: string } };
    readonly liquidity: { readonly availableDepthMinorUnits: string | null };
    readonly estimatedSettlementTime: { readonly p50Seconds: number };
    readonly expiration: string | null;
    readonly conversionKind: string;
    readonly provider: { readonly id: string };
    readonly executable: boolean;
    readonly custody: boolean;
    readonly connectedToMainnet: boolean;
  }[];
  readonly recommendedRoute: { readonly routeId: string } | null;
}

async function quote(payload: Record<string, unknown>) {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/stablecoin-routes',
    payload,
  });
  return { status: response.statusCode, body: response.json<ApiEnvelope<RoutePayload> | ApiError>() };
}

describe('GET /api/v1/stablecoins', () => {
  it('lists USDC and USDT with disconnected chain metadata', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/stablecoins' });
    expect(response.statusCode).toBe(200);
    const data = response.json<ApiEnvelope<CatalogPayload>>().data;
    expect(data.stablecoinRoutingEngineVersion).toBe('1.0.0');
    expect(data.conversionKinds).toEqual([
      'fiat_stablecoin',
      'stablecoin_fiat',
      'stablecoin_stablecoin',
    ]);
    expect(data.stablecoins.map((item) => item.code)).toEqual(['USDC', 'USDT']);
    expect(data.stablecoins.every((item) => item.custodiedByPlatform === false)).toBe(true);
    expect(data.stablecoins.every((item) => item.defaultChain.connected === false)).toBe(true);
    expect(data.stablecoins.every((item) => item.defaultChain.rpcUrl === null)).toBe(true);
    expect(data.chains.every((chain) => chain.connected === false && chain.rpcUrl === null)).toBe(
      true,
    );
    expect(data.custody).toBe(false);
    expect(data.connectedToMainnet).toBe(false);
    expect(data.walletsCreated).toBe(false);
    expect(data.privateKeysGenerated).toBe(false);
    expect(data.executable).toBe(false);
  });
});

describe('POST /api/v1/stablecoin-routes', () => {
  it('quotes FIAT → STABLECOIN (USD → USDC) with the required quote fields', async () => {
    const { status, body } = await quote({
      sourceAsset: 'USD',
      destinationAsset: 'USDC',
      amount: '10000.00',
    });
    expect(status).toBe(201);
    const data = (body as ApiEnvelope<RoutePayload>).data;
    expect(data.conversionKind).toBe('fiat_stablecoin');
    expect(data.stablecoinRoutingEngineVersion).toBe('1.0.0');
    expect(data.aiUsed).toBe(false);
    expect(data.custody).toBe(false);
    expect(data.connectedToMainnet).toBe(false);
    expect(data.walletsCreated).toBe(false);
    expect(data.privateKeysGenerated).toBe(false);
    expect(data.executable).toBe(false);
    expect(data.delegateExecution).toBe(false);
    const route = data.routes[0];
    expect(route?.asset).toEqual({ source: 'USD', destination: 'USDC' });
    expect(route?.chain.destination?.id).toBe('eip155:1');
    expect(route?.chain.destination?.connected).toBe(false);
    expect(route?.price.indicated).toMatch(/^\d/);
    expect(route?.providerFee.asset).toBe('USDC');
    expect(route?.networkFee.asset).toBe('USDC');
    expect(route?.slippage.bps).toMatch(/^\d/);
    expect(route?.liquidity.availableDepthMinorUnits).not.toBeNull();
    expect(route?.estimatedSettlementTime.p50Seconds).toBeGreaterThan(0);
    expect(route?.expiration).toMatch(/Z$/);
    expect(route?.provider.id).toBe('demo-helios-ramp');
    expect(route?.executable).toBe(false);
    expect(route?.custody).toBe(false);
    expect(route?.connectedToMainnet).toBe(false);
  });

  it('quotes STABLECOIN → FIAT (USDC → USD and USDT → USD)', async () => {
    const usdc = await quote({ sourceAsset: 'USDC', destinationAsset: 'USD', amount: '10000' });
    expect(usdc.status).toBe(201);
    const usdcData = (usdc.body as ApiEnvelope<RoutePayload>).data;
    expect(usdcData.conversionKind).toBe('stablecoin_fiat');
    expect(usdcData.routes[0]?.asset).toEqual({ source: 'USDC', destination: 'USD' });

    const usdt = await quote({ sourceAsset: 'USDT', targetAsset: 'USD', amount: '10000' });
    expect(usdt.status).toBe(201);
    const usdtData = (usdt.body as ApiEnvelope<RoutePayload>).data;
    expect(usdtData.conversionKind).toBe('stablecoin_fiat');
    expect(usdtData.routes[0]?.asset).toEqual({ source: 'USDT', destination: 'USD' });
    expect(usdtData.routes[0]?.chain.source?.id).toBe('eip155:1');
  });

  it('quotes STABLECOIN → STABLECOIN (USDC → USDT)', async () => {
    const { status, body } = await quote({
      sourceAsset: 'USDC',
      destinationAsset: 'USDT',
      amount: '10000',
    });
    expect(status).toBe(201);
    const data = (body as ApiEnvelope<RoutePayload>).data;
    expect(data.conversionKind).toBe('stablecoin_stablecoin');
    expect(data.routes.map((item) => item.provider.id).sort()).toEqual([
      'demo-horizon-aggregator',
      'demo-meridian-pool',
      'demo-ridgeline-dex',
    ]);
    expect(data.routes.every((item) => item.asset.destination === 'USDT')).toBe(true);
  });

  it('quotes USDC → KRW on the demo off-ramp', async () => {
    const { status, body } = await quote({
      sourceAsset: 'USDC',
      destinationAsset: 'KRW',
      amount: '100000',
    });
    expect(status).toBe(201);
    const data = (body as ApiEnvelope<RoutePayload>).data;
    expect(data.conversionKind).toBe('stablecoin_fiat');
    expect(data.routes[0]?.provider.id).toBe('demo-helios-ramp');
    expect(data.routes[0]?.price.indicated).toBe('1374.2');
  });

  it('quotes USD → USDT from the Helios rate table', async () => {
    const { status, body } = await quote({
      sourceAsset: 'USD',
      destinationAsset: 'USDT',
      amount: '10000.00',
    });
    expect(status).toBe(201);
    const data = (body as ApiEnvelope<RoutePayload>).data;
    expect(data.conversionKind).toBe('fiat_stablecoin');
    expect(data.routes[0]?.price.indicated).toBe('0.9992');
  });

  it('refuses a crypto corridor and a fiat corridor', async () => {
    const crypto = await quote({ sourceAsset: 'USDC', destinationAsset: 'ETH', amount: '1000' });
    expect(crypto.status).toBe(400);
    expect((crypto.body as ApiError).error.code).toBe('VALIDATION_ERROR');

    const fiat = await quote({ sourceAsset: 'USD', destinationAsset: 'KRW', amount: '1000.00' });
    expect(fiat.status).toBe(400);
    expect((fiat.body as ApiError).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 422 for USDT → KRW, which no demo provider prices', async () => {
    const { status, body } = await quote({
      sourceAsset: 'USDT',
      destinationAsset: 'KRW',
      amount: '1000',
    });
    expect(status).toBe(422);
    expect((body as ApiError).error.code).toBe('UNSUPPORTED_CORRIDOR');
  });

  it('rejects organizationId, execute flags and keys', async () => {
    const { status, body } = await quote({
      sourceAsset: 'USD',
      destinationAsset: 'USDC',
      amount: '10000.00',
      organizationId: 'org_other',
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
