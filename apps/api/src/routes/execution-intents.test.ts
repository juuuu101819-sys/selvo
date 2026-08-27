import {
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  hashSecret,
  DEMO_ORGANIZATION_ID,
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

async function login(): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/auth/login`,
    payload: { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { token: string } }>().data.token;
}

describe('POST /api/v1/execution-intents', () => {
  it('records an intent that is never executable or submitted', async () => {
    const token = await login();
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/execution-intents`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        requestId: 'req_quote_demo',
        routeId: 'rte_northgate',
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '100000.00',
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
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listed.statusCode).toBe(200);
    expect(
      listed.json<{ data: { intents: { status: string; executable: boolean }[] } }>().data.intents
        .length,
    ).toBeGreaterThan(0);
  });

  it('does not execute when a key has transaction:create', async () => {
    const secret = 'mk_txcreatekey123_intentonly';
    await harness.container.persistence.identity.createApiKey({
      id: 'key_tx_create',
      organizationId: DEMO_ORGANIZATION_ID,
      keyPrefix: secret.slice(0, 16),
      secretHash: hashSecret(secret),
      label: 'intents',
      createdAt: harness.clock.nowIso(),
      scopes: ['transaction:create'],
      expiresAt: null,
    });

    const intent = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/execution-intents`,
      headers: { 'x-api-key': secret },
      payload: {
        requestId: 'req_key',
        routeId: 'rte_demo',
        sourceAsset: 'USDC',
        destinationAsset: 'USDT',
        amount: '1000.00',
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
      },
    });
    expect(response.statusCode).toBe(403);
  });
});
