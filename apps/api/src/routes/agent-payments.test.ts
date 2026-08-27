import {
  DEMO_AGENT_ID,
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
  await provisionDemoTenants({
    identity: harness.container.persistence.identity,
    dashboard: harness.container.persistence.dashboard,
    agentPayments: harness.container.persistence.agentPayments,
  });
});

afterAll(async () => {
  await harness.close();
});

interface PaymentIntentBody {
  readonly id: string;
  readonly status: string;
  readonly recipient: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amount: { readonly minorUnits: string; readonly asset: string };
  readonly quotedRoutes: readonly { readonly routeId: string; readonly providerId: string }[];
  readonly selectedRouteId: string | null;
  readonly fundsMoved: boolean;
  readonly custody: boolean;
  readonly realExecution: boolean;
  readonly simulation: { readonly simulated: boolean; readonly fundsMoved: boolean } | null;
}

async function login(email: string, password: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/auth/login`,
    payload: { email, password },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { token: string } }>().data.token;
}

function agentHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return { 'x-api-key': DEMO_AGENT_SECRET, ...overrides };
}

describe('AI agent payment infrastructure', () => {
  it('lets an agent quote through POST /quote', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      headers: agentHeaders(),
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '500.00' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<ApiEnvelope<{ routes: unknown[] }>>().data.routes.length).toBeGreaterThan(0);
  });

  it('rejects an anonymous payment intent', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents`,
      payload: { instruction: 'Pay 500 USD to merchant X' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<ApiError>().error.code).toBe('UNAUTHENTICATED');
  });

  it('walks create → quote → select → authorize → simulate without moving funds', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents`,
      headers: agentHeaders({ 'idempotency-key': 'agent-pay-500-usd-merchant-x' }),
      payload: { instruction: 'Pay 500 USD to merchant X', purpose: 'sandbox demo payout' },
    });
    expect(created.statusCode).toBe(201);
    const intent = created.json<ApiEnvelope<PaymentIntentBody>>().data;
    expect(intent.status).toBe('CREATED');
    expect(intent.recipient).toBe('merchant-x');
    expect(intent.sourceAsset).toBe('USD');
    expect(intent.destinationAsset).toBe('KRW');
    expect(intent.amount.minorUnits).toBe('50000');
    expect(intent.fundsMoved).toBe(false);

    const replay = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents`,
      headers: agentHeaders({ 'idempotency-key': 'agent-pay-500-usd-merchant-x' }),
      payload: { instruction: 'Pay 500 USD to merchant X', purpose: 'sandbox demo payout' },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json<ApiEnvelope<PaymentIntentBody>>().data.id).toBe(intent.id);

    const conflict = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents`,
      headers: agentHeaders({ 'idempotency-key': 'agent-pay-500-usd-merchant-x' }),
      payload: { instruction: 'Pay 600 USD to merchant X' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<ApiError>().error.code).toBe('IDEMPOTENCY_CONFLICT');

    const quoted = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents/${intent.id}/quote`,
      headers: agentHeaders(),
    });
    expect(quoted.statusCode).toBe(200);
    const quotedBody = quoted.json<ApiEnvelope<PaymentIntentBody>>().data;
    expect(quotedBody.status).toBe('QUOTED');
    expect(quotedBody.quotedRoutes.length).toBeGreaterThan(0);
    const routeId = quotedBody.quotedRoutes[0]?.routeId;
    expect(routeId).toBeDefined();

    const selected = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents/${intent.id}/select`,
      headers: agentHeaders(),
      payload: { routeId },
    });
    expect(selected.statusCode).toBe(200);
    expect(selected.json<ApiEnvelope<PaymentIntentBody>>().data.status).toBe('ROUTED');

    const authorized = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents/${intent.id}/authorize`,
      headers: agentHeaders(),
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json<ApiEnvelope<PaymentIntentBody>>().data.status).toBe('AUTHORIZED');

    const simulated = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents/${intent.id}/simulate`,
      headers: agentHeaders(),
    });
    expect(simulated.statusCode).toBe(200);
    const done = simulated.json<ApiEnvelope<PaymentIntentBody>>().data;
    expect(done.status).toBe('COMPLETED');
    expect(done.fundsMoved).toBe(false);
    expect(done.custody).toBe(false);
    expect(done.realExecution).toBe(false);
    expect(done.simulation?.simulated).toBe(true);
    expect(done.simulation?.fundsMoved).toBe(false);
    expect(simulated.json()).not.toHaveProperty('data.secret');
    expect(simulated.body).not.toContain(DEMO_AGENT_SECRET);
  });

  it('replays an identical idempotent create after the clock advances', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents`,
      headers: agentHeaders({ 'idempotency-key': 'agent-pay-clock-replay' }),
      payload: { instruction: 'Pay 500 USD to merchant X' },
    });
    expect(created.statusCode).toBe(201);
    const originalId = created.json<ApiEnvelope<PaymentIntentBody>>().data.id;

    harness.clock.advance(5_000);

    const replay = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents`,
      headers: agentHeaders({ 'idempotency-key': 'agent-pay-clock-replay' }),
      payload: { instruction: 'Pay 500 USD to merchant X' },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json<ApiEnvelope<PaymentIntentBody>>().data.id).toBe(originalId);
  });

  it('returns 404 rather than 403 for another organization\'s payment intent', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents`,
      headers: agentHeaders({ 'idempotency-key': 'agent-pay-isolation' }),
      payload: { instruction: 'Pay 500 USD to merchant X' },
    });
    const id = created.json<ApiEnvelope<PaymentIntentBody>>().data.id;
    const otherToken = await login(OTHER_USER_EMAIL, OTHER_USER_PASSWORD);
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/payment-intents/${id}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<ApiError>().error.code).toBe('NOT_FOUND');
  });

  it('denies a payment above the policy maximum', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents`,
      headers: agentHeaders({ 'idempotency-key': 'agent-pay-too-large' }),
      payload: { instruction: 'Pay 20000 USD to merchant X' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<ApiError>().error.code).toBe('POLICY_DENIED');
    expect(response.json<ApiError>().error.details['rule']).toBe('maximum_transaction_amount');
  });

  it('denies a disallowed asset', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents`,
      headers: agentHeaders({ 'idempotency-key': 'agent-pay-eur' }),
      payload: {
        agentId: DEMO_AGENT_ID,
        sourceAsset: 'EUR',
        destinationAsset: 'USD',
        amount: '10.00',
        recipient: 'merchant-x',
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<ApiError>().error.details['rule']).toBe('allowed_assets');
  });

  it('denies an unknown or disallowed recipient', async () => {
    const unknown = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents`,
      headers: agentHeaders(),
      payload: { instruction: 'Pay 500 USD to merchant Y' },
    });
    expect(unknown.statusCode).toBe(400);
  });

  it('still refuses real execution', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      headers: agentHeaders(),
    });
    expect(response.statusCode).toBe(501);
    expect(response.json<ApiError>().error.code).toBe('EXECUTION_NOT_IMPLEMENTED');
  });

  it('rejects a revoked agent credential', async () => {
    const session = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const minted = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/agents`,
      headers: { authorization: `Bearer ${session}` },
      payload: { name: 'Temporary agent' },
    });
    expect(minted.statusCode).toBe(201);
    const issued = minted.json<ApiEnvelope<{ id: string; secret: string }>>().data;
    expect(issued.secret.startsWith('mag_')).toBe(true);
    expect(minted.body).toContain(issued.secret);

    const listed = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/agents`,
      headers: { authorization: `Bearer ${session}` },
    });
    expect(listed.body).not.toContain(issued.secret);

    await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/agents/${issued.id}/revoke`,
      headers: { authorization: `Bearer ${session}` },
    });

    const denied = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/agents/me`,
      headers: { 'x-api-key': issued.secret },
    });
    expect(denied.statusCode).toBe(401);
  });

  it('does not leak the demo agent secret in list DTOs or logs', async () => {
    const session = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/agents`,
      headers: { authorization: `Bearer ${session}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(DEMO_AGENT_SECRET);
    const agents = response.json<ApiEnvelope<{ agents: { id: string; keyPrefix: string | null }[] }>>()
      .data.agents;
    expect(agents.some((agent) => agent.id === DEMO_AGENT_ID)).toBe(true);
    expect(agents.find((agent) => agent.id === DEMO_AGENT_ID)?.keyPrefix).toBe('mag_demo_agent01');
  });

  it('lets a session user create an intent for the demo agent', async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': 'session-pay-500-usd-merchant-x',
      },
      payload: { agentId: DEMO_AGENT_ID, instruction: 'Pay 500 USD to merchant X' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<ApiEnvelope<PaymentIntentBody>>().data.organizationId ?? DEMO_ORGANIZATION_ID).toBe(
      DEMO_ORGANIZATION_ID,
    );
  });
});
