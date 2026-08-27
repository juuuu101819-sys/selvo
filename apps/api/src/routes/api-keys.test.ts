import {
  DEMO_ORGANIZATION_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  OTHER_USER_EMAIL,
  OTHER_USER_PASSWORD,
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

describe('organization API keys', () => {
  it('issues a secret once, stores only a hash, and lists prefixes', async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/api-keys`,
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Treasury automation' },
    });
    expect(created.statusCode).toBe(201);
    const issued = created.json<{
      data: {
        id: string;
        secret: string;
        keyPrefix: string;
        scopes: string[];
        expiresAt: string | null;
      };
    }>().data;
    expect(issued.secret.startsWith('mk_')).toBe(true);
    expect(issued.keyPrefix).toBe(issued.secret.slice(0, 16));
    expect(issued.scopes).toEqual(['quote:read', 'route:read']);
    expect(created.body).not.toContain('secretHash');
    expect(JSON.stringify(created.json())).not.toContain(hashSecret(issued.secret));

    const listed = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/api-keys`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.body).not.toContain(issued.secret);
    expect(listed.body).not.toContain('secretHash');
    const keys = listed.json<{
      data: { apiKeys: { id: string; keyPrefix: string; secret?: string }[] };
    }>().data.apiKeys;
    expect(keys.some((key) => key.id === issued.id && key.keyPrefix === issued.keyPrefix)).toBe(
      true,
    );
    expect(keys.every((key) => key.secret === undefined)).toBe(true);

    const quoted = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      headers: { 'x-api-key': issued.secret },
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '1000.00' },
    });
    expect(quoted.statusCode).toBe(201);
  });

  it('revokes a key so it can no longer authenticate', async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/api-keys`,
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'To revoke', scopes: ['quote:read'] },
    });
    const issued = created.json<{ data: { id: string; secret: string } }>().data;

    const revoked = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/api-keys/${issued.id}/revoke`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(revoked.statusCode).toBe(200);

    const denied = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      headers: { 'x-api-key': issued.secret },
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '1000.00' },
    });
    expect(denied.statusCode).toBe(401);
  });

  it('rejects an expired key', async () => {
    const secret = 'mk_expiredkey1234_neverstore';
    await harness.container.persistence.identity.createApiKey({
      id: 'key_expired',
      organizationId: DEMO_ORGANIZATION_ID,
      keyPrefix: secret.slice(0, 16),
      secretHash: hashSecret(secret),
      label: 'expired',
      createdAt: '2026-01-01T00:00:00.000Z',
      scopes: ['quote:read'],
      expiresAt: '2026-02-01T00:00:00.000Z',
    });
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/metrics`,
      headers: { 'x-api-key': secret },
    });
    expect(response.statusCode).toBe(401);
  });

  it('does not let a service key mint another key', async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/api-keys`,
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Machine', scopes: ['quote:read', 'route:read'] },
    });
    const secret = created.json<{ data: { secret: string } }>().data.secret;
    const denied = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/api-keys`,
      headers: { 'x-api-key': secret },
      payload: { label: 'nested' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json<ApiError>().error.code).toBe('FORBIDDEN');
  });

  it('does not list another organization\'s keys', async () => {
    const demo = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/api-keys`,
      headers: { authorization: `Bearer ${demo}` },
      payload: { label: 'Demo only' },
    });
    const other = await login(OTHER_USER_EMAIL, OTHER_USER_PASSWORD);
    const listed = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/api-keys`,
      headers: { authorization: `Bearer ${other}` },
    });
    const labels = listed
      .json<{ data: { apiKeys: { label: string }[] } }>()
      .data.apiKeys.map((key) => key.label);
    expect(labels).not.toContain('Demo only');
  });
});
