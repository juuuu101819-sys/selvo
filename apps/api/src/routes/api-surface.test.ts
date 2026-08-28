import { DEMO_USER_EMAIL, DEMO_USER_PASSWORD } from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from './index.js';
import { API_SURFACE_CONTRACT } from '../openapi/catalog.js';
import { createTestHarness, type ApiError, type ApiEnvelope, type TestHarness } from '../testing/harness.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
  await provisionDemoTenants({
    identity: harness.container.persistence.identity,
    dashboard: harness.container.persistence.dashboard,
    agentPayments: harness.container.persistence.agentPayments,
    auditLog: harness.container.persistence.auditLog,
  });
});

afterAll(async () => {
  await harness.close();
});

interface PublicRoutePayload {
  readonly routingId: string;
  readonly monetization: {
    readonly eventType: string;
    readonly stage: string;
    readonly realizedRevenue: boolean;
    readonly fundsMoved: boolean;
  } | null;
  readonly quoteExpiresAt?: unknown;
}

interface AuthenticatedQuotePayload {
  readonly requestId: string;
  readonly routes: readonly unknown[];
  readonly recommendedRoute: unknown;
  readonly quoteExpiresAt: string | null;
  readonly monetization?: unknown;
}

describe('PA-M05 public vs authenticated quote surfaces', () => {
  it('publishes the surface contract on GET /meta', async () => {
    const response = await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}/meta` });
    expect(response.statusCode).toBe(200);
    const surfaces = response.json<{
      data: {
        apiSurfaces: {
          openapi: string;
          publicDiscovery: string;
          authenticatedBilled: string;
          public: { method: string; path: string }[];
          authenticated: { method: string; path: string }[];
        };
      };
    }>().data.apiSurfaces;
    expect(surfaces.openapi).toBe(API_SURFACE_CONTRACT.openapiPath);
    expect(surfaces.public.some((route) => route.path === '/api/v1/routes' && route.method === 'POST')).toBe(
      true,
    );
    expect(surfaces.authenticated.some((route) => route.path === '/api/v1/quote' && route.method === 'POST')).toBe(
      true,
    );
    expect(surfaces.public.some((route) => route.path === '/api/v1/quote')).toBe(false);
  });

  it('rejects anonymous POST /quote and accepts anonymous POST /routes', async () => {
    const body = { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '100000.00' };
    const quote = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      payload: body,
    });
    expect(quote.statusCode).toBe(401);
    expect(quote.json<ApiError>().error.code).toBe('UNAUTHENTICATED');

    const search = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes/search`,
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW' },
    });
    expect(search.statusCode).toBe(401);

    const routes = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes`,
      payload: body,
    });
    expect(routes.statusCode).toBe(201);
    const publicBody = routes.json<ApiEnvelope<PublicRoutePayload>>().data;
    expect(publicBody.monetization).not.toBeNull();
    expect(publicBody.monetization?.eventType).toBe('ROUTE_QUOTE');
    expect(publicBody.monetization?.stage).toBe('route_quote');
    expect(publicBody.monetization?.realizedRevenue).toBe(false);
    expect(publicBody.monetization?.fundsMoved).toBe(false);
    expect(publicBody).not.toHaveProperty('quoteExpiresAt');
  });

  it('returns an org-scoped billed quote shape that does not leak as a public payload', async () => {
    const login = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/login`,
      payload: { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD },
    });
    expect(login.statusCode).toBe(201);
    const token = login.json<{ data: { token: string } }>().data.token;

    const quoted = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '100000.00' },
    });
    expect(quoted.statusCode).toBe(201);
    const billed = quoted.json<ApiEnvelope<AuthenticatedQuotePayload>>().data;
    expect(billed.quoteExpiresAt).toEqual(expect.any(String));
    expect(billed.routes.length).toBeGreaterThan(0);
    expect(billed).not.toHaveProperty('monetization');
    expect(JSON.stringify(billed)).not.toContain('realizedRevenue');
    expect(JSON.stringify(billed)).not.toContain('takeRateBps');
    expect(JSON.stringify(billed)).not.toContain('grossMarginMinorUnits');
  });
});
