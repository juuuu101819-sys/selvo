import {
  DEMO_ORGANIZATION_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  OTHER_ORGANIZATION_ID,
  OTHER_USER_EMAIL,
  OTHER_USER_PASSWORD,
} from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from '../routes/index.js';
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

describe('organization authorization', () => {
  it('rejects dashboard access without a credential', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/metrics`,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<ApiError>().error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an unknown email with the same error as a wrong password', async () => {
    const unknown = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/login`,
      payload: { email: 'nobody@example.invalid', password: DEMO_USER_PASSWORD },
    });
    const wrong = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/login`,
      payload: { email: DEMO_USER_EMAIL, password: 'definitely-wrong-pass' },
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json<ApiError>().error.message).toBe(wrong.json<ApiError>().error.message);
  });

  it('never echoes a password back', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/login`,
      payload: { email: DEMO_USER_EMAIL, password: 'definitely-wrong-pass' },
    });
    expect(response.body).not.toContain('definitely-wrong-pass');
  });

  it('lets the demo user see only their organization metrics', async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/metrics`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      data: { metrics: { quoteCount: number; successfulRouteRequests: number } };
    }>();
    expect(body.data.metrics.quoteCount).toBeGreaterThan(0);
    expect(body.data.metrics.successfulRouteRequests).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain(OTHER_ORGANIZATION_ID);
    expect(JSON.stringify(body)).not.toContain('OTHER-SHOULD-NOT-LEAK');
  });

  it("does not list another organization's quotes", async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/quotes`,
      headers: { authorization: `Bearer ${token}` },
    });
    const ids = response
      .json<{ data: { quotes: { id: string; organizationId: string; reference?: string }[] } }>()
      .data.quotes.map((quote) => quote.id);
    expect(ids).not.toContain('qte_other_secret');
    expect(ids.some((id) => id.startsWith('qte_demo_'))).toBe(true);
    for (const quote of response.json<{ data: { quotes: { organizationId: string }[] } }>().data
      .quotes) {
      expect(quote.organizationId).toBe(DEMO_ORGANIZATION_ID);
    }
  });

  it("returns 404, not 403, for another organization's quote id", async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/quotes/qte_other_secret`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<ApiError>().error.code).toBe('NOT_FOUND');
    expect(response.body).not.toContain('OTHER-SHOULD-NOT-LEAK');
  });

  it("returns 404 for another organization's transaction", async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/transactions/txr_other_secret`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it('lets the other organization see its own secret request and not the demo ones', async () => {
    const token = await login(OTHER_USER_EMAIL, OTHER_USER_PASSWORD);
    const listed = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/transactions`,
      headers: { authorization: `Bearer ${token}` },
    });
    const refs = listed
      .json<{ data: { transactions: { id: string; reference: string | null }[] } }>()
      .data.transactions.map((row) => row.reference);
    expect(refs).toContain('OTHER-SHOULD-NOT-LEAK');
    expect(refs).not.toContain('DEMO-PO-4417');

    const leaked = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/quotes/qte_demo_0_0`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(leaked.statusCode).toBe(404);
  });

  it('does not expose another organization in settings members', async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/settings`,
      headers: { authorization: `Bearer ${token}` },
    });
    const body = response.json<{
      data: { organization: { id: string }; members: { email: string }[] };
    }>();
    expect(body.data.organization.id).toBe(DEMO_ORGANIZATION_ID);
    expect(body.data.members.map((member) => member.email)).toEqual([DEMO_USER_EMAIL]);
    expect(JSON.stringify(body)).not.toContain(OTHER_USER_EMAIL);
  });

  it('scopes a service API key to its organization', async () => {
    const secret = 'mk_testkey123456_supersecretvalue';
    await harness.container.persistence.identity.createApiKey({
      id: 'key_demo_test',
      organizationId: DEMO_ORGANIZATION_ID,
      keyPrefix: secret.slice(0, 16),
      secretHash: (await import('@meridian/core')).hashSecret(secret),
      label: 'CI',
      createdAt: '2026-03-01T09:00:00.000Z',
      scopes: ['quote:read', 'route:read', 'transaction:create'],
      expiresAt: null,
    });

    const ok = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/quotes/qte_demo_0_0`,
      headers: { 'x-api-key': secret },
    });
    expect(ok.statusCode).toBe(200);

    const denied = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/quotes/qte_other_secret`,
      headers: { 'x-api-key': secret },
    });
    expect(denied.statusCode).toBe(404);
  });

  it('revokes a session on logout so the token cannot be reused', async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const logout = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/logout`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logout.statusCode).toBe(200);
    const again = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/metrics`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(again.statusCode).toBe(401);
  });

  it('still serves the public comparison page anonymously', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/comparisons`,
      payload: { sourceCurrency: 'USD', targetCurrency: 'KRW', amount: '100000.00' },
    });
    expect(response.statusCode).toBe(201);
  });
});
