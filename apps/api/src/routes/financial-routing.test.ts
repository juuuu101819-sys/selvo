import {
  DEMO_ORGANIZATION_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  OTHER_ORGANIZATION_ID,
  hashSecret,
} from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from './index.js';
import { createTestHarness, type ApiError, type TestHarness } from '../testing/harness.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
  await provisionDemoTenants({
    identity: harness.container.persistence.identity,
    dashboard: harness.container.persistence.dashboard,
  });
});

afterAll(async () => {
  await harness.close();
});

async function login(email: string, password: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/auth/login`,
    payload: { email, password },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { token: string } }>().data.token;
}

describe('GET /api/v1/assets', () => {
  it('lists registry assets including fiat, stablecoins and crypto', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/assets`,
    });
    expect(response.statusCode).toBe(200);
    const assets = response.json<{
      data: { assets: { code: string; kind: string; decimals: number }[] };
    }>().data.assets;
    expect(assets.map((asset) => asset.code)).toEqual(
      expect.arrayContaining(['USD', 'KRW', 'USDC', 'ETH']),
    );
    expect(assets.find((asset) => asset.code === 'USDC')?.kind).toBe('stablecoin');
    expect(assets.find((asset) => asset.code === 'ETH')?.decimals).toBe(18);
  });
});

describe('GET /api/v1/currencies', () => {
  it('lists ISO currencies with minor-unit decimals', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/currencies`,
    });
    expect(response.statusCode).toBe(200);
    const currencies = response.json<{
      data: { currencies: { code: string; decimals: number; name: string }[] };
    }>().data.currencies;
    expect(currencies.find((currency) => currency.code === 'KRW')?.decimals).toBe(0);
    expect(currencies.find((currency) => currency.code === 'USD')?.decimals).toBe(2);
  });
});

describe('POST /api/v1/quote', () => {
  const quoteBody = {
    sourceAsset: 'USD',
    destinationAsset: 'KRW',
    amount: '100000.00',
  };

  it('rejects an anonymous caller', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      payload: quoteBody,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<ApiError>().error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an anonymous caller that claims an organization', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      payload: { ...quoteBody, organizationId: DEMO_ORGANIZATION_ID },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns ranked routes and a quote expiry for a session user', async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...quoteBody, organizationId: DEMO_ORGANIZATION_ID },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{
      data: {
        requestId: string;
        routes: { routeId: string; executable: boolean }[];
        recommendedRoute: { routeId: string } | null;
        quoteExpiresAt: string | null;
      };
      meta: { requestId: string };
    }>();
    expect(body.data.requestId).toBe(body.meta.requestId);
    expect(body.data.routes.length).toBeGreaterThan(0);
    expect(body.data.recommendedRoute).not.toBeNull();
    expect(body.data.quoteExpiresAt).toMatch(/Z$/);
    expect(body.data.routes.every((route) => route.executable === false)).toBe(true);
  });

  it('rejects a claimed organization that does not match the principal', async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...quoteBody, organizationId: OTHER_ORGANIZATION_ID },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<ApiError>().error.code).toBe('FORBIDDEN');
  });

  it('rejects an API key that lacks quote:read', async () => {
    const secret = 'mk_noroutequote1_secretvalue';
    await harness.container.persistence.identity.createApiKey({
      id: 'key_no_quote',
      organizationId: DEMO_ORGANIZATION_ID,
      keyPrefix: secret.slice(0, 16),
      secretHash: hashSecret(secret),
      label: 'routes only',
      createdAt: harness.clock.nowIso(),
      scopes: ['route:read'],
      expiresAt: null,
    });
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      headers: { 'x-api-key': secret },
      payload: quoteBody,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<ApiError>().error.code).toBe('FORBIDDEN');
  });
});

describe('POST /api/v1/routes/search', () => {
  it('discovers graph paths without running a second quote engine', async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes/search`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceAsset: 'USD', destinationAsset: 'USDC' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      data: {
        executable: boolean;
        graph: { graphEngineVersion: string; paths: unknown[] };
        matchingProviders: { id: string }[];
      };
    }>().data;
    expect(body.executable).toBe(false);
    expect(body.graph.graphEngineVersion).toBe('1.0.0');
    expect(body.matchingProviders.length).toBeGreaterThan(0);
  });
});
