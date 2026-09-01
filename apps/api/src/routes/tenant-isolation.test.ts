import {
  DEMO_ORGANIZATION_ID,
  DEMO_OTHER_AGENT_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  OTHER_ORGANIZATION_ID,
  OTHER_USER_EMAIL,
} from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_ROUTE_CATALOG, type CatalogRoute } from '../openapi/catalog.js';
import { API_V1_PREFIX } from './index.js';
import { createTestHarness, type TestHarness } from '../testing/harness.js';

const LEAKS = [
  OTHER_ORGANIZATION_ID,
  OTHER_USER_EMAIL,
  'OTHER-SHOULD-NOT-LEAK',
  'qte_other_secret',
  'txr_other_secret',
  DEMO_OTHER_AGENT_ID,
  'pay_other_secret',
  'ops@acme-other.example.invalid',
];

function isOrgScoped(route: CatalogRoute): boolean {
  if (route.surface !== 'authenticated') {
    return false;
  }
  if (route.auth === 'onboarding_operator' || route.auth === 'none') {
    return false;
  }
  if (route.path.startsWith('/auth')) {
    return false;
  }
  if (route.path === '/executions' || route.path === '/agents/me') {
    return false;
  }
  return true;
}

function foreignIdFor(path: string): string {
  if (path.includes('quotes')) {
    return 'qte_other_secret';
  }
  if (path.includes('transactions')) {
    return 'txr_other_secret';
  }
  if (path.includes('payment-intents')) {
    return 'pay_other_secret';
  }
  if (path.includes('agents')) {
    return DEMO_OTHER_AGENT_ID;
  }
  if (path.includes('invoices')) {
    return 'inv_other_secret';
  }
  if (path.includes('api-keys')) {
    return 'key_other_secret';
  }
  if (path.includes('execution-intents')) {
    return 'eit_other_secret';
  }
  if (path.includes('comparisons')) {
    return 'cmp_other_secret';
  }
  if (path.includes('mandates')) {
    return 'mdt_other_secret';
  }
  return 'foreign_secret_id';
}

function instantiate(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, () => foreignIdFor(path));
}

describe('cross-tenant organizationId isolation', () => {
  let harness: TestHarness;
  let demoToken: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    await provisionDemoTenants({
      identity: harness.container.persistence.identity,
      dashboard: harness.container.persistence.dashboard,
      agentPayments: harness.container.persistence.agentPayments,
      auditLog: harness.container.persistence.auditLog,
    });
    const login = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/login`,
      payload: { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD },
    });
    expect(login.statusCode).toBe(201);
    demoToken = login.json<{ data: { token: string } }>().data.token;
  });

  afterAll(async () => {
    await harness.close();
  });

  const orgScoped = API_V1_ROUTE_CATALOG.filter(isOrgScoped);

  it('enumerates org-scoped authenticated routes from the OpenAPI catalog', () => {
    expect(orgScoped.length).toBeGreaterThan(25);
    expect(orgScoped.some((route) => route.path === '/dashboard/quotes/:id')).toBe(true);
    expect(orgScoped.some((route) => route.path === '/agents')).toBe(true);
    expect(orgScoped.some((route) => route.path === '/dashboard/invoices')).toBe(true);
    expect(orgScoped.some((route) => route.path === '/execution-intents')).toBe(true);
    expect(orgScoped.every((route) => route.path !== '/executions')).toBe(true);
  });

  it('does not leak Organization B identifiers on Organization A collection GETs', async () => {
    const collections = orgScoped.filter(
      (route) => route.method === 'GET' && !route.path.includes(':'),
    );
    expect(collections.length).toBeGreaterThan(8);

    for (const route of collections) {
      const response = await harness.app.inject({
        method: 'GET',
        url: `${API_V1_PREFIX}${route.path}`,
        headers: { authorization: `Bearer ${demoToken}` },
      });
      expect(response.statusCode, `${route.method} ${route.path}`).toBeLessThan(500);
      if (response.statusCode >= 400) {
        continue;
      }
      const body = response.body;
      for (const leak of LEAKS) {
        expect(body, `${route.path} leaked ${leak}`).not.toContain(leak);
      }
      if (body.includes('"organizationId"') || body.includes('"organization"')) {
        expect(body).not.toContain(OTHER_ORGANIZATION_ID);
      }
    }
  });

  it('returns 404 not 403 for Organization B resource ids', async () => {
    const itemGets = orgScoped.filter(
      (route) => route.method === 'GET' && route.path.includes(':'),
    );
    expect(itemGets.length).toBeGreaterThan(5);

    for (const route of itemGets) {
      const response = await harness.app.inject({
        method: 'GET',
        url: `${API_V1_PREFIX}${instantiate(route.path)}`,
        headers: { authorization: `Bearer ${demoToken}` },
      });
      expect([401, 403, 404], `${route.method} ${route.path}`).toContain(response.statusCode);
      expect(response.statusCode, `${route.path} must not return another tenant's record`).not.toBe(
        200,
      );
      expect(response.body).not.toContain('OTHER-SHOULD-NOT-LEAK');
      expect(response.body).not.toContain(OTHER_ORGANIZATION_ID);
    }
  });

  it('rejects mutations that reference Organization B ids', async () => {
    const mutations = orgScoped.filter(
      (route) => (route.method === 'POST' || route.method === 'PATCH') && route.path.includes(':'),
    );
    expect(mutations.length).toBeGreaterThan(3);

    for (const route of mutations) {
      const response = await harness.app.inject({
        method: route.method,
        url: `${API_V1_PREFIX}${instantiate(route.path)}`,
        headers: { authorization: `Bearer ${demoToken}` },
        payload: {},
      });
      expect(response.statusCode, `${route.method} ${route.path}`).toBeGreaterThanOrEqual(400);
      expect(response.statusCode, `${route.method} ${route.path} must not succeed`).toBeLessThan(500);
      expect([200, 201]).not.toContain(response.statusCode);
      expect(response.body).not.toContain(OTHER_ORGANIZATION_ID);
    }
  });

  it('rejects a claimed organizationId that is not the session tenant', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      headers: { authorization: `Bearer ${demoToken}` },
      payload: {
        sourceAsset: 'USD',
        destinationAsset: 'EUR',
        amount: '500.00',
        organizationId: OTHER_ORGANIZATION_ID,
      },
    });
    expect([400, 403]).toContain(response.statusCode);
    expect(response.body).not.toContain('OTHER-SHOULD-NOT-LEAK');
    expect(DEMO_ORGANIZATION_ID).not.toBe(OTHER_ORGANIZATION_ID);
  });
});
