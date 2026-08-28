import {
  DEMO_ORGANIZATION_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
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

async function mintTransactionKey(id: string, secret: string): Promise<void> {
  await harness.container.persistence.identity.createApiKey({
    id,
    organizationId: DEMO_ORGANIZATION_ID,
    keyPrefix: secret.slice(0, 16),
    secretHash: hashSecret(secret),
    label: 'intents',
    createdAt: harness.clock.nowIso(),
    scopes: ['transaction:create'],
    expiresAt: null,
  });
}

const COMPLETED_PAYMENT_INTENT_ID = 'pay_demo_completed_500';
const QUOTED_PAYMENT_INTENT_ID = 'pay_demo_quoted_open';
const FAILED_PAYMENT_INTENT_ID = 'pay_demo_failed_policy';

const validBody = {
  requestId: 'req_quote_demo',
  routeId: 'rte_veridian_usd_krw',
  sourceAsset: 'USD',
  destinationAsset: 'KRW',
  amount: '500.00',
} as const;

describe('POST /api/v1/execution-intents', () => {
  it('rejects a session user because sessions never receive transaction:create', async () => {
    const token = await login();
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/execution-intents`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ...validBody, paymentIntentId: COMPLETED_PAYMENT_INTENT_ID },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<ApiError>().error.code).toBe('FORBIDDEN');
  });

  it('records an intent that is never executable or submitted after Policy Engine evaluation', async () => {
    const secret = 'mk_txcreatekey123_intentonly';
    await mintTransactionKey('key_tx_create', secret);

    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/execution-intents`,
      headers: { 'x-api-key': secret },
      payload: {
        ...validBody,
        paymentIntentId: COMPLETED_PAYMENT_INTENT_ID,
      },
    });
    expect(response.statusCode).toBe(201);
    const intent = response.json<{
      data: {
        status: string;
        executable: boolean;
        submitted: boolean;
        organizationId: string;
      };
    }>().data;
    expect(intent.status).toBe('recorded');
    expect(intent.executable).toBe(false);
    expect(intent.submitted).toBe(false);
    expect(intent.organizationId).toBe(DEMO_ORGANIZATION_ID);

    const listed = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/execution-intents`,
      headers: { 'x-api-key': secret },
    });
    expect(listed.statusCode).toBe(200);
    expect(
      listed.json<{ data: { intents: { status: string; executable: boolean }[] } }>().data.intents
        .length,
    ).toBeGreaterThan(0);
  });

  it('does not execute when a key has transaction:create', async () => {
    const secret = 'mk_txcreatekey123_intentonly';
    const intent = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/execution-intents`,
      headers: { 'x-api-key': secret },
      payload: {
        requestId: 'req_key',
        routeId: 'rte_veridian_usd_krw',
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '500.00',
        paymentIntentId: COMPLETED_PAYMENT_INTENT_ID,
      },
    });
    expect(intent.statusCode).toBe(201);
    expect(intent.json<{ data: { executable: boolean; submitted: boolean } }>().data).toMatchObject({
      executable: false,
      submitted: false,
    });

    const execution = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      headers: { 'x-api-key': secret },
    });
    expect(execution.statusCode).toBe(501);
    expect(execution.json<ApiError>().error.code).toBe('EXECUTION_NOT_IMPLEMENTED');
  });

  it('rejects a key without transaction:create', async () => {
    const secret = 'mk_nointentkey123_readonly';
    await harness.container.persistence.identity.createApiKey({
      id: 'key_no_intent',
      organizationId: DEMO_ORGANIZATION_ID,
      keyPrefix: secret.slice(0, 16),
      secretHash: hashSecret(secret),
      label: 'quotes',
      createdAt: harness.clock.nowIso(),
      scopes: ['quote:read'],
      expiresAt: null,
    });
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/execution-intents`,
      headers: { 'x-api-key': secret },
      payload: {
        requestId: 'req_denied',
        routeId: 'rte_demo',
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '10.00',
        paymentIntentId: COMPLETED_PAYMENT_INTENT_ID,
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects an execution intent whose quote has already expired before policy evaluation', async () => {
    const secret = 'mk_txcreatekey123_intentonly';
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/execution-intents`,
      headers: { 'x-api-key': secret },
      payload: {
        requestId: 'req_expired_quote',
        routeId: 'rte_northgate',
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '100000.00',
        quoteExpiresAt: '2026-03-01T08:59:59.000Z',
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<ApiError>().error.code).toBe('QUOTE_EXPIRED');
    expect(response.json<ApiError>().error.details['quoteExpiresAt']).toBe(
      '2026-03-01T08:59:59.000Z',
    );

    const events = await harness.auditEvents();
    expect(
      events.some(
        (event) =>
          event.type === 'execution.intent.rejected' &&
          event.payload['reason'] === 'QUOTE_EXPIRED' &&
          event.payload['executable'] === false &&
          event.payload['submitted'] === false &&
          event.payload['fundsMoved'] === false,
      ),
    ).toBe(true);

    const listed = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/execution-intents`,
      headers: { 'x-api-key': secret },
    });
    expect(listed.statusCode).toBe(200);
    const intents = listed.json<{ data: { intents: { requestId: string }[] } }>().data.intents;
    expect(intents.some((intent) => intent.requestId === 'req_expired_quote')).toBe(false);
  });

  it('records an execution intent when the quote is still fresh and policy has passed', async () => {
    const secret = 'mk_txcreatekey123_intentonly';
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/execution-intents`,
      headers: { 'x-api-key': secret },
      payload: {
        requestId: 'req_fresh_quote',
        routeId: 'rte_veridian_usd_krw',
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '500.00',
        quoteExpiresAt: '2026-03-01T09:15:00.000Z',
        paymentIntentId: COMPLETED_PAYMENT_INTENT_ID,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<{ data: { quoteExpiresAt: string | null; executable: boolean } }>().data)
      .toMatchObject({
        quoteExpiresAt: '2026-03-01T09:15:00.000Z',
        executable: false,
      });
  });

  it('rejects recording without a payment intent so the Policy Engine cannot be skipped', async () => {
    const secret = 'mk_txcreatekey123_intentonly';
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/execution-intents`,
      headers: { 'x-api-key': secret },
      payload: {
        requestId: 'req_no_policy',
        routeId: 'rte_veridian_usd_krw',
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '500.00',
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<ApiError>().error.code).toBe('POLICY_DENIED');
    expect(response.json<ApiError>().error.details['rule']).toBe('policy_required');
  });

  it('rejects a quoted payment intent that has not passed the execution policy gate', async () => {
    const secret = 'mk_txcreatekey123_intentonly';
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/execution-intents`,
      headers: { 'x-api-key': secret },
      payload: {
        requestId: 'req_quoted_bypass',
        routeId: 'rte_veridian_usd_krw',
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '250.00',
        paymentIntentId: QUOTED_PAYMENT_INTENT_ID,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<ApiError>().error.code).toBe('POLICY_DENIED');
  });

  it('rejects a failed payment intent that never passed policy', async () => {
    const secret = 'mk_txcreatekey123_intentonly';
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/execution-intents`,
      headers: { 'x-api-key': secret },
      payload: {
        requestId: 'req_failed_bypass',
        routeId: 'rte_veridian_usd_krw',
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '1500.00',
        paymentIntentId: FAILED_PAYMENT_INTENT_ID,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<ApiError>().error.code).toBe('POLICY_DENIED');
  });
});
