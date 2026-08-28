import { DEMO_AGENT_SECRET } from '@meridian/core';
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

describe('PA-H09 — expired route selection requires a re-quote', () => {
  it('rejects selecting a quoted route after the quote has expired', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents`,
      headers: { 'x-api-key': DEMO_AGENT_SECRET, 'idempotency-key': 'h09-expired-select' },
      payload: { instruction: 'Pay 500 USD to merchant X', purpose: 'freshness rejection' },
    });
    expect(created.statusCode).toBe(201);
    const intentId = created.json<ApiEnvelope<{ id: string }>>().data.id;

    const quoted = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents/${intentId}/quote`,
      headers: { 'x-api-key': DEMO_AGENT_SECRET },
    });
    expect(quoted.statusCode).toBe(200);
    const routeId = quoted.json<
      ApiEnvelope<{ quotedRoutes: readonly { routeId: string }[] }>
    >().data.quotedRoutes[0]?.routeId;
    expect(routeId).toBeDefined();

    harness.clock.advance(10 * 60_000);

    const selected = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents/${intentId}/select`,
      headers: { 'x-api-key': DEMO_AGENT_SECRET },
      payload: { routeId },
    });
    expect(selected.statusCode).toBe(409);
    const error = selected.json<ApiError>().error;
    expect(error.code).toBe('QUOTE_EXPIRED');
    expect(error.details['requoteRequired']).toBe(true);
    expect(error.message.toLowerCase()).toContain('new quote');
  });
});
