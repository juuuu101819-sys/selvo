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
      engineVersion: '2.0.0',
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
    const body = response.json<{
      data: {
        product: {
          kind: string;
          scope: string[];
          customers: string[];
          notFor: string[];
        };
        capabilities: Record<string, boolean>;
        execution: { implemented: boolean; delegated: boolean; statusCode: number };
        pipeline: { id: string; status: string }[];
        railFamilies: { id: string; status: string }[];
        rails: { type: string; family: string; status: string }[];
        interactionModels: { id: string; status: string }[];
        authentication: { economicActor: string };
      };
    }>().data;

    expect(body.product).toMatchObject({
      kind: 'global_non_custodial_financial_routing_hub',
      scope: expect.arrayContaining(['tradfi', 'stablecoin', 'defi']),
      customers: expect.arrayContaining(['businesses', 'ai_agents']),
      notFor: expect.arrayContaining(['custody', 'principal_trading']),
    });
    expect(body.capabilities).toEqual({
      compareRoutes: true,
      executeTransactions: false,
      delegateExecution: false,
      custodyFunds: false,
      holdCryptoAssets: false,
      holdPrivateKeys: false,
      controlCustomerWallets: false,
      operateAsPrincipal: false,
      issueStablecoins: false,
      agentPayments: true,
      agentPaymentSimulation: true,
      agentNaturalLanguageRouting: true,
      defiQuotes: true,
      defiExecution: false,
      multiRailRouting: true,
      routeGraph: true,
      stablecoinRouting: true,
      defiLiquidityRouting: true,
      financialRoutingApi: true,
      paymentPolicyEngine: true,
      executionIntents: true,
      multiRailMonetization: true,
    });
    expect(body.execution).toMatchObject({
      implemented: false,
      delegated: false,
      statusCode: 501,
    });
    expect(body.pipeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'discover', status: 'available' }),
        expect.objectContaining({ id: 'delegate', status: 'planned' }),
      ]),
    );
    expect(body.railFamilies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'tradfi', status: 'available' }),
        expect.objectContaining({ id: 'stablecoin', status: 'available' }),
        expect.objectContaining({ id: 'defi', status: 'planned' }),
      ]),
    );
    expect(body.rails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'bank_fx', family: 'tradfi', status: 'available' }),
        expect.objectContaining({
          type: 'stablecoin_settlement',
          family: 'stablecoin',
          status: 'available',
        }),
        expect.objectContaining({ type: 'dex_liquidity', family: 'defi', status: 'planned' }),
      ]),
    );
    expect(body.interactionModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'human_business', status: 'available' }),
        expect.objectContaining({ id: 'business_business', status: 'available' }),
        expect.objectContaining({ id: 'agent_business', status: 'available' }),
        expect.objectContaining({ id: 'agent_agent', status: 'planned' }),
      ]),
    );
    expect(body.authentication.economicActor).toBe('human');
  });

  it('publishes the DeFi liquidity routing engine version', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/meta' });
    const data = response.json<{
      data: { defiRoutingEngineVersion: string; capabilities: { defiLiquidityRouting: boolean } };
    }>().data;
    expect(data.defiRoutingEngineVersion).toBe('1.0.0');
    expect(data.capabilities.defiLiquidityRouting).toBe(true);
  });

  it('lists the registered providers with their licensing posture', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/meta' });
    const providers = response.json<{
      data: { providers: { id: string; rail: string; licensing: string }[] };
    }>().data.providers;

    expect(providers).toHaveLength(4);
    expect(providers.map((provider) => provider.rail)).not.toContain('dex_liquidity');
    expect(providers.map((provider) => provider.rail).sort()).toEqual([
      'bank_fx',
      'liquidity_provider',
      'payment_institution',
      'stablecoin_settlement',
    ]);
    expect(providers.every((provider) => provider.licensing === 'unlicensed_sandbox')).toBe(true);
  });

  it('publishes the multi-rail financial provider catalog without mixing it into comparison providers', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/meta' });
    const catalog = response.json<{
      data: {
        providerCatalog: {
          categories: string[];
          providers: { id: string; category: string; features: string[] }[];
        };
        assets: { code: string; kind: string }[];
      };
    }>().data;

    expect(catalog.providerCatalog.categories).toEqual(['traditional', 'stablecoin', 'defi']);
    expect(catalog.providerCatalog.providers).toHaveLength(8);
    expect(catalog.assets.map((asset) => asset.code)).toEqual(
      expect.arrayContaining(['USD', 'USDC', 'ETH']),
    );
    expect(catalog.assets.find((asset) => asset.code === 'USDC')?.kind).toBe('stablecoin');
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
