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

describe('GET /v1/providers', () => {
  it('lists wrapped comparison rails plus demo ramp and DeFi adapters', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/providers' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      data: { providers: { id: string; category: string; features: string[] }[] };
    }>();
    const ids = body.data.providers.map((provider) => provider.id).sort();
    expect(ids).toEqual(
      expect.arrayContaining([
        'sandbox-northgate-bank',
        'sandbox-veridian-payments',
        'sandbox-solstice-settlement',
        'sandbox-meridian-liquidity',
        'demo-helios-ramp',
        'demo-meridian-pool',
        'demo-horizon-aggregator',
      ]),
    );
    expect(body.data.providers).toHaveLength(7);
  });
});

describe('POST /v1/provider-quotes', () => {
  it('returns a fiat → fiat quote from a wrapped bank', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/provider-quotes',
      payload: {
        providerId: 'sandbox-northgate-bank',
        sourceAsset: 'USD',
        targetAsset: 'KRW',
        amount: '100000.00',
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<ApiEnvelope<{ conversionKind: string; executable: boolean }>>();
    expect(body.data.conversionKind).toBe('fiat_fiat');
    expect(body.data.executable).toBe(false);
  });

  it('returns a fiat → stablecoin quote from the demo ramp', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/provider-quotes',
      payload: {
        providerId: 'demo-helios-ramp',
        sourceAsset: 'USD',
        targetAsset: 'USDC',
        amount: '1000.00',
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<
      ApiEnvelope<{ conversionKind: string; executable: boolean; sourceAsset: string }>
    >();
    expect(body.data.conversionKind).toBe('fiat_stablecoin');
    expect(body.data.executable).toBe(false);
    expect(body.data.sourceAsset).toBe('USD');
  });

  it('returns a read-only USDC → ETH quote from the demo AMM', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/provider-quotes',
      payload: {
        providerId: 'demo-meridian-pool',
        sourceAsset: 'USDC',
        targetAsset: 'ETH',
        amount: '10000.00',
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<
      ApiEnvelope<{ conversionKind: string; executable: boolean; chainId: string | null }>
    >();
    expect(body.data.conversionKind).toBe('stablecoin_crypto');
    expect(body.data.executable).toBe(false);
    expect(body.data.chainId).toBe('eip155:1');
  });

  it('rejects an execute flag rather than honouring it', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/provider-quotes',
      payload: {
        providerId: 'demo-meridian-pool',
        sourceAsset: 'USDC',
        targetAsset: 'ETH',
        amount: '1',
        execute: true,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiError>().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a private key field', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/provider-quotes',
      payload: {
        providerId: 'demo-meridian-pool',
        sourceAsset: 'USDC',
        targetAsset: 'ETH',
        amount: '1',
        privateKey: '0xabc',
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('does not add DeFi quotes to the comparison engine', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/comparisons',
      payload: { sourceCurrency: 'USD', targetCurrency: 'KRW', amount: '100000.00' },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<ApiEnvelope<{ routes: { provider: { rail: string } }[] }>>();
    expect(body.data.routes).toHaveLength(4);
    expect(body.data.routes.map((route) => route.provider.rail)).not.toContain('dex_liquidity');
  });
});
