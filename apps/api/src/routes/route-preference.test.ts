import {
  DEMO_AGENT_ID,
  DEMO_AGENT_POLICY,
  DEMO_AGENT_SECRET,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
} from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from './index.js';
import { createTestHarness, type ApiError, type ApiEnvelope, type TestHarness } from '../testing/harness.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
  await provisionDemoTenants(
    {
      identity: harness.container.persistence.identity,
      dashboard: harness.container.persistence.dashboard,
      agentPayments: harness.container.persistence.agentPayments,
      auditLog: harness.container.persistence.auditLog,
    },
    { nowIso: harness.clock.nowIso() },
  );
});

afterAll(async () => {
  await harness.close();
});

interface QuotedIntent {
  readonly id: string;
  readonly status: string;
  readonly quotedRoutes: readonly {
    readonly routeId: string;
    readonly providerId: string;
    readonly recommended: boolean;
  }[];
}

async function login(): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/auth/login`,
    payload: { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { token: string } }>().data.token;
}

async function restoreDemoPolicy(token: string): Promise<void> {
  const response = await harness.app.inject({
    method: 'PATCH',
    url: `${API_V1_PREFIX}/dashboard/agents/${DEMO_AGENT_ID}/policies`,
    headers: { authorization: `Bearer ${token}` },
      payload: {
      allowedProviderIds: [...DEMO_AGENT_POLICY.allowedProviderIds],
      allowedChainIds: [...DEMO_AGENT_POLICY.allowedChainIds],
      allowedCountryCodes: [...DEMO_AGENT_POLICY.allowedCountryCodes],
      maxFeeBps: DEMO_AGENT_POLICY.maxFeeBps,
      maxSlippageBps: DEMO_AGENT_POLICY.maxSlippageBps,
      minRouteScore: DEMO_AGENT_POLICY.minRouteScore,
      minLiquidityHeadroom: DEMO_AGENT_POLICY.minLiquidityHeadroom,
      maxTransactionAmountMinorUnits: DEMO_AGENT_POLICY.maxTransactionAmountMinorUnits,
      dailySpendingLimitMinorUnits: DEMO_AGENT_POLICY.dailySpendingLimitMinorUnits,
      preferredRoutePreference: DEMO_AGENT_POLICY.preferredRoutePreference,
    },
  });
  expect(response.statusCode).toBe(200);
}

/** Open chain/fee/slippage caps so more catalog providers survive policy filtering. */
async function widenRankingPolicy(token: string, allowedProviderIds: readonly string[]): Promise<void> {
  const response = await harness.app.inject({
    method: 'PATCH',
    url: `${API_V1_PREFIX}/dashboard/agents/${DEMO_AGENT_ID}/policies`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      allowedProviderIds: [...allowedProviderIds],
      allowedChainIds: ['*'],
      allowedCountryCodes: ['*'],
      maxFeeBps: '5000',
      maxSlippageBps: '5000',
      minRouteScore: '0',
      minLiquidityHeadroom: '0',
      maxTransactionAmountMinorUnits: '20000000',
      dailySpendingLimitMinorUnits: '20000000',
      preferredRoutePreference: 'lowest_cost',
    },
  });
  expect(response.statusCode).toBe(200);
}

async function createAndQuote(idempotencyKey: string): Promise<{
  readonly statusCode: number;
  readonly body: QuotedIntent | null;
  readonly error: ApiError['error'] | null;
}> {
  const created = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/payment-intents`,
    headers: { 'x-api-key': DEMO_AGENT_SECRET, 'idempotency-key': idempotencyKey },
    payload: {
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amount: '100000.00',
      recipient: 'merchant-x',
    },
  });
  if (created.statusCode !== 201) {
    return {
      statusCode: created.statusCode,
      body: null,
      error: created.json<ApiError>().error,
    };
  }
  const id = created.json<ApiEnvelope<{ id: string }>>().data.id;
  const quoted = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/payment-intents/${id}/quote`,
    headers: { 'x-api-key': DEMO_AGENT_SECRET },
  });
  if (quoted.statusCode !== 200) {
    return {
      statusCode: quoted.statusCode,
      body: null,
      error: quoted.json<ApiError>().error,
    };
  }
  return {
    statusCode: quoted.statusCode,
    body: quoted.json<ApiEnvelope<QuotedIntent>>().data,
    error: null,
  };
}

describe('PA-M11 route preference and provider allowlist enforcement', () => {
  const catalogProviders = [
    'sandbox-veridian-payments',
    'sandbox-solstice-settlement',
    'sandbox-northgate-bank',
    'sandbox-meridian-liquidity',
  ] as const;

  it('excludes a provider that is not on the policy allowlist (denylist by omission)', async () => {
    const token = await login();
    await widenRankingPolicy(token, catalogProviders);

    const baseline = await createAndQuote('pref-allowlist-baseline');
    expect(baseline.statusCode).toBe(200);
    const baselineProviders = [
      ...new Set(baseline.body?.quotedRoutes.map((route) => route.providerId) ?? []),
    ];
    expect(baselineProviders.length).toBeGreaterThan(1);
    const excluded = baselineProviders[0];
    const remaining = baselineProviders.slice(1);
    expect(excluded).toBeDefined();

    await widenRankingPolicy(token, remaining);
    const quoted = await createAndQuote('pref-allowlist-denylist');
    expect(quoted.statusCode).toBe(200);
    const providers = quoted.body?.quotedRoutes.map((route) => route.providerId) ?? [];
    expect(providers.length).toBeGreaterThan(0);
    expect(providers).not.toContain(excluded);
    expect(remaining.some((id) => providers.includes(id))).toBe(true);

    await restoreDemoPolicy(token);
  });

  it('returns POLICY_DENIED with allowed_providers when the allowlist matches nothing', async () => {
    const token = await login();
    await widenRankingPolicy(token, []);

    const quoted = await createAndQuote('pref-empty-allowlist');
    expect(quoted.statusCode).toBe(403);
    expect(quoted.error?.code).toBe('POLICY_DENIED');
    expect(quoted.error?.details['rule']).toBe('allowed_providers');
    expect(quoted.error?.details['allowedRouteCount']).toBe(0);
    expect(quoted.error?.details['failClosed']).toBe(true);

    await restoreDemoPolicy(token);
  });

  it('returns POLICY_DENIED with allowed_providers when the allowlist names no configured provider', async () => {
    const token = await login();
    await widenRankingPolicy(token, ['provider-that-does-not-exist']);

    const quoted = await createAndQuote('pref-nonmatching-allowlist');
    expect(quoted.statusCode).toBe(403);
    expect(quoted.error?.code).toBe('POLICY_DENIED');
    expect(quoted.error?.details['rule']).toBe('allowed_providers');
    expect(quoted.error?.details['allowedRouteCount']).toBe(0);

    await restoreDemoPolicy(token);
  });

  it('rejects selecting a non-recommended route when preferredRoutePreference is set', async () => {
    const token = await login();
    await widenRankingPolicy(token, catalogProviders);

    const quoted = await createAndQuote('pref-select-off-recommendation');
    expect(quoted.statusCode).toBe(200);
    const routes = quoted.body?.quotedRoutes ?? [];
    const recommended = routes.find((route) => route.recommended);
    const other = routes.find((route) => !route.recommended);
    expect(recommended).toBeDefined();
    expect(other).toBeDefined();

    const denied = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents/${quoted.body?.id}/select`,
      headers: { 'x-api-key': DEMO_AGENT_SECRET },
      payload: { routeId: other?.routeId },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json<ApiError>().error.code).toBe('POLICY_DENIED');
    expect(denied.json<ApiError>().error.details['rule']).toBe('preferred_route_preference');

    const allowed = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents/${quoted.body?.id}/select`,
      headers: { 'x-api-key': DEMO_AGENT_SECRET },
      payload: { routeId: recommended?.routeId },
    });
    expect(allowed.statusCode).toBe(200);

    await restoreDemoPolicy(token);
  });
});
