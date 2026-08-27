import {
  DEMO_AGENT_ID,
  DEMO_AGENT_POLICY,
  DEMO_AGENT_SECRET,
  DEMO_ORGANIZATION_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  OTHER_USER_EMAIL,
  OTHER_USER_PASSWORD,
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

async function login(email: string, password: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/auth/login`,
    payload: { email, password },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { token: string } }>().data.token;
}

interface AgentSummary {
  readonly agentId: string;
  readonly paymentVolumeMinorUnits: string;
  readonly transactionCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly averageFeeBps: string | null;
  readonly routeSuccessRatePercent: string | null;
  readonly policyViolationCount: number;
  readonly dailySpentMinorUnits: string;
  readonly dailyLimitMinorUnits: string | null;
  readonly fundsMoved: boolean;
  readonly custody: boolean;
  readonly preferredRoute: { readonly providerId: string } | null;
}

describe('AI agent financial dashboard', () => {
  it('rejects the list without a credential', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/agents`,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<ApiError>().error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the demo agent identity and hides the other organization', async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/agents`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<
      ApiEnvelope<{
        agents: readonly AgentSummary[];
        fundsMoved: boolean;
        custody: boolean;
        walletsGenerated: boolean;
        privateKeysHeld: boolean;
      }>
    >().data;
    expect(body.fundsMoved).toBe(false);
    expect(body.custody).toBe(false);
    expect(body.walletsGenerated).toBe(false);
    expect(body.privateKeysHeld).toBe(false);
    expect(body.agents).toHaveLength(1);
    const demo = body.agents[0];
    expect(demo?.agentId).toBe(DEMO_AGENT_ID);
    expect(demo?.paymentVolumeMinorUnits).toBe('425000');
    expect(demo?.transactionCount).toBe(5);
    expect(demo?.completedCount).toBe(3);
    expect(demo?.failedCount).toBe(1);
    expect(demo?.averageFeeBps).toBe('42.5000');
    expect(demo?.routeSuccessRatePercent).toBe('75.0');
    expect(demo?.policyViolationCount).toBe(1);
    expect(demo?.dailySpentMinorUnits).toBe('50000');
    expect(demo?.dailyLimitMinorUnits).toBe(DEMO_AGENT_POLICY.dailySpendingLimitMinorUnits);
    expect(demo?.preferredRoute?.providerId).toBe('sandbox-veridian-payments');
    expect(demo?.fundsMoved).toBe(false);
    expect(demo?.custody).toBe(false);
    expect(JSON.stringify(body)).not.toContain('99999900');
    expect(JSON.stringify(body)).not.toContain('agt_other_secret');
    expect(JSON.stringify(body)).not.toContain('evt_other_policy_secret');
  });

  it('returns 404, not 403, for another organization\'s agent', async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/agents/agt_other_secret`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<ApiError>().error.code).toBe('NOT_FOUND');
    expect(response.body).not.toContain('99999900');
  });

  it('surfaces spending limits, preferred routes and the policy denial on the detail page', async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/agents/${DEMO_AGENT_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<
      ApiEnvelope<{
        summary: AgentSummary;
        spending: {
          dailyLimitMinorUnits: string;
          dailySpentMinorUnits: string;
          dailyRemainingMinorUnits: string;
          maxTransactionMinorUnits: string;
        } | null;
        preferredRoutes: readonly { readonly providerId: string; readonly intentCount: number }[];
        violations: readonly { readonly eventId: string; readonly rule: string }[];
        fundsMoved: boolean;
        custody: boolean;
        walletsGenerated: boolean;
        privateKeysHeld: boolean;
      }>
    >().data;
    expect(body.fundsMoved).toBe(false);
    expect(body.custody).toBe(false);
    expect(body.walletsGenerated).toBe(false);
    expect(body.privateKeysHeld).toBe(false);
    expect(body.summary.paymentVolumeMinorUnits).toBe('425000');
    expect(body.spending?.maxTransactionMinorUnits).toBe('100000');
    expect(body.spending?.dailyLimitMinorUnits).toBe('1000000');
    expect(body.spending?.dailySpentMinorUnits).toBe('50000');
    expect(body.spending?.dailyRemainingMinorUnits).toBe('950000');
    expect(body.preferredRoutes[0]?.intentCount).toBe(3);
    expect(body.violations.some((row) => row.eventId === 'evt_demo_policy_max_amount')).toBe(true);
    expect(body.violations.some((row) => row.eventId === 'evt_other_policy_secret')).toBe(false);
  });

  it('lists payment history without the other organization\'s secret intent', async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/agents/${DEMO_AGENT_ID}/payments`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<
      ApiEnvelope<{
        payments: readonly { readonly id: string; readonly fundsMoved: boolean }[];
        fundsMoved: boolean;
      }>
    >().data;
    expect(body.fundsMoved).toBe(false);
    const ids = body.payments.map((row) => row.id);
    expect(ids).toContain('pay_demo_completed_500');
    expect(ids).toContain('pay_demo_failed_policy');
    expect(ids).not.toContain('pay_other_secret');
    expect(body.payments.every((row) => row.fundsMoved === false)).toBe(true);
  });

  it('lets a session user update allow-lists and route preference', async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `${API_V1_PREFIX}/dashboard/agents/${DEMO_AGENT_ID}/policies`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        allowedAssets: ['USD', 'KRW'],
        allowedProviderIds: ['sandbox-solstice-settlement'],
        allowedRecipientCodes: ['merchant-x'],
        preferredRoutePreference: 'fastest',
        dailySpendingLimitMinorUnits: '2000000',
        maxTransactionAmountMinorUnits: '150000',
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<
      ApiEnvelope<{
        policy: {
          allowedAssets: readonly string[];
          allowedProviderIds: readonly string[];
          preferredRoutePreference: string | null;
          dailySpendingLimitMinorUnits: string;
          maxTransactionAmountMinorUnits: string;
        } | null;
        fundsMoved: boolean;
        walletsGenerated: boolean;
        privateKeysHeld: boolean;
      }>
    >().data;
    expect(body.policy?.allowedAssets).toEqual(['USD', 'KRW']);
    expect(body.policy?.allowedProviderIds).toEqual(['sandbox-solstice-settlement']);
    expect(body.policy?.preferredRoutePreference).toBe('fastest');
    expect(body.policy?.dailySpendingLimitMinorUnits).toBe('2000000');
    expect(body.policy?.maxTransactionAmountMinorUnits).toBe('150000');
    expect(body.fundsMoved).toBe(false);
    expect(body.walletsGenerated).toBe(false);
    expect(body.privateKeysHeld).toBe(false);
    const events = await harness.auditEvents();
    expect(
      events.some(
        (event) =>
          event.type === 'payment.policy.updated' &&
          event.payload['agentId'] === DEMO_AGENT_ID &&
          event.organizationId === DEMO_ORGANIZATION_ID,
      ),
    ).toBe(true);

    await harness.app.inject({
      method: 'PATCH',
      url: `${API_V1_PREFIX}/dashboard/agents/${DEMO_AGENT_ID}/policies`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        allowedAssets: [...DEMO_AGENT_POLICY.allowedAssets],
        allowedProviderIds: [...DEMO_AGENT_POLICY.allowedProviderIds],
        allowedRecipientCodes: [...DEMO_AGENT_POLICY.allowedRecipientCodes],
        preferredRoutePreference: 'lowest_cost',
        dailySpendingLimitMinorUnits: DEMO_AGENT_POLICY.dailySpendingLimitMinorUnits,
        maxTransactionAmountMinorUnits: DEMO_AGENT_POLICY.maxTransactionAmountMinorUnits,
      },
    });
  });

  it('forbids an agent credential from patching policy', async () => {
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `${API_V1_PREFIX}/dashboard/agents/${DEMO_AGENT_ID}/policies`,
      headers: { 'x-api-key': DEMO_AGENT_SECRET },
      payload: { preferredRoutePreference: 'fastest' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<ApiError>().error.code).toBe('FORBIDDEN');
  });

  it('lets the other organization see only its own secret volume', async () => {
    const token = await login(OTHER_USER_EMAIL, OTHER_USER_PASSWORD);
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/agents`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<ApiEnvelope<{ agents: readonly AgentSummary[] }>>().data;
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]?.agentId).toBe('agt_other_secret');
    expect(body.agents[0]?.paymentVolumeMinorUnits).toBe('99999900');
    expect(JSON.stringify(body)).not.toContain('pay_demo_completed_500');
    expect(JSON.stringify(body)).not.toContain(DEMO_AGENT_ID);
  });
});
