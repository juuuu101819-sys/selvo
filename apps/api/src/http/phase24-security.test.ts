import { randomUUID } from 'node:crypto';
import {
  DEMO_ORGANIZATION_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_ID,
  DEMO_USER_PASSWORD,
  hashSecret,
  hashSessionToken,
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

async function login(): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/auth/login`,
    payload: { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { token: string } }>().data.token;
}

describe('PA-M01 API key hashing at the HTTP boundary', () => {
  it('returns the raw secret once, stores salted scrypt, and never echoes the hash', async () => {
    const token = await login();
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/api-keys`,
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'PA-M01 issuance' },
    });
    expect(created.statusCode).toBe(201);
    const issued = created.json<{
      data: { id: string; secret: string; keyPrefix: string };
    }>().data;
    expect(issued.secret.startsWith('mk_')).toBe(true);
    expect(created.body).not.toContain('secretHash');
    expect(JSON.stringify(created.json())).not.toContain(hashSecret(issued.secret));

    const stored = await harness.container.persistence.identity.findApiKeyByPrefix(issued.keyPrefix);
    expect(stored?.secretHash.startsWith('scrypt$')).toBe(true);
    expect(stored?.secretHash).not.toBe(issued.secret);
    expect(stored?.secretHash).not.toBe(hashSecret(issued.secret));
    expect(stored?.secretHash).not.toContain(issued.secret);

    const listed = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/api-keys`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listed.body).not.toContain(issued.secret);
    expect(listed.body).not.toContain('secretHash');
    const keys = listed.json<{ data: { apiKeys: { id: string; secret?: string }[] } }>().data.apiKeys;
    expect(keys.find((key) => key.id === issued.id)?.secret).toBeUndefined();
  });

  it('upgrades a legacy SHA-256 API key on first successful use', async () => {
    const secret = `mk_legacy${randomUUID().replaceAll('-', '')}`.slice(0, 48);
    const prefix = secret.slice(0, 16);
    await harness.container.persistence.identity.createApiKey({
      id: `key_legacy_${prefix}`,
      organizationId: DEMO_ORGANIZATION_ID,
      keyPrefix: prefix,
      secretHash: hashSecret(secret),
      label: 'legacy sha256',
      createdAt: '2026-03-01T09:00:00.000Z',
      scopes: ['quote:read'],
      expiresAt: null,
    });

    const quoted = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      headers: { 'x-api-key': secret },
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '1000.00' },
    });
    expect(quoted.statusCode).toBe(201);

    const stored = await harness.container.persistence.identity.findApiKeyByPrefix(prefix);
    expect(stored?.secretHash.startsWith('scrypt$')).toBe(true);
    expect(stored?.secretHash).not.toBe(hashSecret(secret));
  });

  it('upgrades a legacy SHA-256 session token to HMAC-SHA-256 on first use', async () => {
    const token = `mds_legacy${randomUUID().replaceAll('-', '')}`;
    await harness.container.persistence.identity.createSession({
      id: `ses_legacy_${token.slice(4, 12)}`,
      userId: DEMO_USER_ID,
      organizationId: DEMO_ORGANIZATION_ID,
      tokenHash: hashSecret(token),
      expiresAt: '2026-03-02T09:00:00.000Z',
    });

    const me = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/auth/me`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);

    const pepper = harness.config.sessionTokenPepper;
    const hmac = hashSessionToken(token, pepper);
    const upgraded = await harness.container.persistence.identity.findValidSessionByTokenHash(
      hmac,
      harness.clock.nowIso(),
    );
    expect(upgraded).not.toBeNull();
    const leftover = await harness.container.persistence.identity.findValidSessionByTokenHash(
      hashSecret(token),
      harness.clock.nowIso(),
    );
    expect(leftover).toBeNull();
  });
});

describe('PA-M04 audit actor spoofing', () => {
  it('records the authenticated session actor even when X-Meridian-Actor is spoofed', async () => {
    const token = await login();
    const issued = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/comparisons`,
      headers: {
        authorization: `Bearer ${token}`,
        'x-meridian-actor': 'spoofed-header-actor',
      },
      payload: {
        sourceCurrency: 'USD',
        targetCurrency: 'KRW',
        amount: '1000.00',
      },
    });
    expect(issued.statusCode).toBe(201);
    const comparisonId = issued.json<{ data: { comparisonId: string } }>().data.comparisonId;
    const events = await harness.container.persistence.auditLog.listByComparison(comparisonId);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.actor === DEMO_USER_EMAIL)).toBe(true);
    expect(events.some((event) => event.actor === 'spoofed-header-actor')).toBe(false);
  });

  it('rejects a client-supplied actorId in the body instead of trusting it for audit', async () => {
    const token = await login();
    const rejected = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/comparisons`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        sourceCurrency: 'USD',
        targetCurrency: 'KRW',
        amount: '1000.00',
        actorId: 'spoofed-body-actor',
        performedBy: 'attacker',
      },
    });
    expect(rejected.statusCode).toBe(400);
    const events = await harness.auditEvents();
    expect(events.some((event) => event.actor === 'spoofed-body-actor')).toBe(false);
    expect(events.some((event) => event.actor === 'attacker')).toBe(false);
  });
});
