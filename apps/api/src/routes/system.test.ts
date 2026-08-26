import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness, type ApiError, type TestHarness } from '../testing/harness.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});

afterAll(async () => {
  await harness.close();
});

describe('GET /health', () => {
  it('reports the process as up, with its mode and engine version', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      mode: 'sandbox',
      engineVersion: '1.0.0',
    });
  });
});

describe('GET /ready', () => {
  it('reports readiness once the store is reachable', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ready',
      checks: { persistence: 'ok' },
      persistenceDriver: 'memory',
    });
  });
});

describe('GET /v1/meta', () => {
  it('declares what the platform will and will not do', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/meta' });

    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ data: { capabilities: Record<string, boolean> } }>().data.capabilities,
    ).toEqual({
      compareRoutes: true,
      executeTransactions: false,
      custodyFunds: false,
      holdCryptoAssets: false,
      issueStablecoins: false,
    });
  });

  it('lists the registered providers with their licensing posture', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/meta' });
    const providers = response.json<{
      data: { providers: { id: string; rail: string; licensing: string }[] };
    }>().data.providers;

    expect(providers).toHaveLength(4);
    expect(providers.map((provider) => provider.rail).sort()).toEqual([
      'bank_fx',
      'liquidity_provider',
      'payment_institution',
      'stablecoin_settlement',
    ]);
    expect(providers.every((provider) => provider.licensing === 'unlicensed_sandbox')).toBe(true);
  });

  it('publishes the pricing dataset version so a quote can be traced to its inputs', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/meta' });
    const pricing = response.json<{
      data: { pricing: { datasetVersion: string; referenceRatesVersion: string } };
    }>().data.pricing;

    expect(pricing.datasetVersion).toBe('sandbox-pricing-2026.02');
    expect(pricing.referenceRatesVersion).toBe('sandbox-reference-2026.02');
  });

  it('publishes the supported currencies with their minor-unit exponents', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/meta' });
    const currencies = response.json<{
      data: { currencies: { code: string; exponent: number }[] };
    }>().data.currencies;

    expect(currencies.find((currency) => currency.code === 'KRW')?.exponent).toBe(0);
    expect(currencies.find((currency) => currency.code === 'USD')?.exponent).toBe(2);
    expect(currencies.find((currency) => currency.code === 'KWD')?.exponent).toBe(3);
  });

  it('marks planned rails as planned rather than pretending to price them', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/meta' });
    const rails = response.json<{ data: { rails: { type: string; status: string }[] } }>().data
      .rails;

    expect(rails.find((rail) => rail.type === 'dex_liquidity')?.status).toBe('planned');
    expect(rails.find((rail) => rail.type === 'treasury_product')?.status).toBe('planned');
    expect(rails.find((rail) => rail.type === 'bank_fx')?.status).toBe('available');
  });
});

describe('unknown routes', () => {
  it('returns a structured 404', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json<ApiError>().error.code).toBe('NOT_FOUND');
    expect(response.json<ApiError>().error.message).toContain('/v1/nope');
  });
});
