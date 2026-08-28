import {
  DEMO_ORGANIZATION_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  PolicyDeniedError,
} from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from './index.js';
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

async function login(): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/auth/login`,
    payload: { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { token: string } }>().data.token;
}

async function mintAgent(name: string): Promise<{ readonly id: string; readonly secret: string }> {
  const token = await login();
  const minted = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/agents`,
    headers: { authorization: `Bearer ${token}` },
    payload: { name },
  });
  expect(minted.statusCode).toBe(201);
  return minted.json<ApiEnvelope<{ id: string; secret: string }>>().data;
}

interface QuotedIntent {
  readonly id: string;
  readonly routeId: string;
}

async function quotePay400(secret: string, idempotencyKey: string): Promise<QuotedIntent> {
  const created = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/payment-intents`,
    headers: { 'x-api-key': secret, 'idempotency-key': idempotencyKey },
    payload: { instruction: 'Pay 400 USD to merchant X' },
  });
  expect(created.statusCode).toBe(201);
  const id = created.json<ApiEnvelope<{ id: string }>>().data.id;
  const quoted = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/payment-intents/${id}/quote`,
    headers: { 'x-api-key': secret },
  });
  expect(quoted.statusCode).toBe(200);
  const body = quoted.json<
    ApiEnvelope<{ id: string; quotedRoutes: readonly { routeId: string }[] }>
  >().data;
  const routeId = body.quotedRoutes[0]?.routeId;
  expect(routeId).toBeDefined();
  return { id: body.id, routeId: routeId as string };
}

describe('PA-H03 Policy Engine is mandatory on spend-committing transitions', () => {
  it('rejects createIntent when no payment policy exists', async () => {
    const now = harness.clock.nowIso();
    const agentId = 'agt_pah03_nopolicy';
    await harness.container.persistence.agentPayments.createAgent({
      id: agentId,
      organizationId: DEMO_ORGANIZATION_ID,
      name: 'No policy agent',
      createdAt: now,
    });

    await expect(
      harness.container.agentPayments.createIntent({
        organizationId: DEMO_ORGANIZATION_ID,
        actorAgentId: agentId,
        bodyAgentId: undefined,
        instruction: 'Pay 400 USD to merchant X',
        sourceAsset: undefined,
        destinationAsset: undefined,
        amount: undefined,
        recipient: undefined,
        purpose: undefined,
        routePreference: null,
        maxFeeBps: null,
        expiresAt: undefined,
        idempotencyKey: null,
        actor: 'test',
        requestId: 'req_nopolicy',
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED', details: { rule: 'policy_required' } });
  });

  it('rejects select, authorize, gate, HTTP execution-intents, and NL route without a passing policy', async () => {
    const issued = await mintAgent('PA-H03 gate agent');
    const token = await login();
    const quoted = await quotePay400(issued.secret, 'pah03-quote-1');

    const tightened = await harness.app.inject({
      method: 'PATCH',
      url: `${API_V1_PREFIX}/dashboard/agents/${issued.id}/policies`,
      headers: { authorization: `Bearer ${token}` },
      payload: { allowedAssets: ['KRW'] },
    });
    expect(tightened.statusCode).toBe(200);

    const selectDenied = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents/${quoted.id}/select`,
      headers: { 'x-api-key': issued.secret },
      payload: { routeId: quoted.routeId },
    });
    expect(selectDenied.statusCode).toBe(403);
    expect(selectDenied.json<ApiError>().error.code).toBe('POLICY_DENIED');

    await expect(
      harness.container.agentPayments.selectRoute({
        organizationId: DEMO_ORGANIZATION_ID,
        agentId: issued.id,
        paymentIntentId: quoted.id,
        routeId: quoted.routeId,
        actor: 'test',
        requestId: 'req_select_denied',
      }),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    await expect(
      harness.container.agentPayments.authorizeIntent({
        organizationId: DEMO_ORGANIZATION_ID,
        agentId: issued.id,
        paymentIntentId: quoted.id,
        actor: 'test',
        requestId: 'req_auth_denied',
      }),
    ).rejects.toMatchObject({ name: 'ValidationError' });

    await expect(
      harness.container.agentPayments.gateExecutionIntent({
        organizationId: DEMO_ORGANIZATION_ID,
        agentId: issued.id,
        paymentIntentId: quoted.id,
        actor: 'test',
        requestId: 'req_gate_denied',
      }),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    const nl = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/agent/route`,
      headers: { 'x-api-key': issued.secret, 'idempotency-key': 'pah03-nl-denied' },
      payload: { instruction: 'Pay 400 USD to merchant X' },
    });
    expect(nl.statusCode).toBe(403);
    expect(nl.json<ApiError>().error.code).toBe('POLICY_DENIED');
  });
});

describe('PA-H04 daily spend reservation is atomic across concurrent selects', () => {
  it('admits only the subset of parallel intents that fit under the daily limit, repeatedly', async () => {
    const rounds = 6;
    for (let round = 0; round < rounds; round += 1) {
      const issued = await mintAgent(`PA-H04 reservation ${round}`);
      const token = await login();
      const limited = await harness.app.inject({
        method: 'PATCH',
        url: `${API_V1_PREFIX}/dashboard/agents/${issued.id}/policies`,
        headers: { authorization: `Bearer ${token}` },
        payload: { dailySpendingLimitMinorUnits: '100000' },
      });
      expect(limited.statusCode).toBe(200);

      const quoted: QuotedIntent[] = [];
      for (let index = 0; index < 5; index += 1) {
        quoted.push(await quotePay400(issued.secret, `pah04-r${round}-i${index}`));
      }

      const results = await Promise.all(
        quoted.map((intent) =>
          harness.container.agentPayments
            .selectRoute({
              organizationId: DEMO_ORGANIZATION_ID,
              agentId: issued.id,
              paymentIntentId: intent.id,
              routeId: intent.routeId,
              actor: 'test',
              requestId: `req_pah04_r${round}_${intent.id}`,
            })
            .then(
              (routed) => ({ ok: true as const, status: routed.status }),
              (error: unknown) => ({ ok: false as const, error }),
            ),
        ),
      );

      const succeeded = results.filter((result) => result.ok);
      const denied = results.filter((result) => !result.ok);
      expect(succeeded).toHaveLength(2);
      expect(denied).toHaveLength(3);
      expect(succeeded.every((result) => result.status === 'ROUTED')).toBe(true);
      for (const result of denied) {
        expect(result.error).toBeInstanceOf(PolicyDeniedError);
        expect((result.error as PolicyDeniedError).details['rule']).toBe('daily_spending_limit');
      }

      const reserved = await harness.container.persistence.agentPayments.sumDailySpending({
        organizationId: DEMO_ORGANIZATION_ID,
        agentId: issued.id,
        asset: 'USD',
        fromInclusive: '2026-03-01T00:00:00.000Z',
        toExclusive: '2026-03-02T00:00:00.000Z',
        statuses: ['ROUTED', 'POLICY_APPROVED', 'SIMULATION_PENDING', 'SIMULATION_COMPLETED'],
      });
      expect(reserved).toBe('80000');
    }
  }, 60_000);
});
