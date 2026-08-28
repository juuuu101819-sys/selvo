import {
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
} from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from '../routes/index.js';
import { createTestHarness, type ApiError, type TestHarness } from '../testing/harness.js';
import { hashAttemptedIdentifier } from './auth-failure-audit.js';

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

const WRONG_PASSWORD = 'definitely-wrong-pass';
const ATTEMPTS = 5;

function assertNoRawSecrets(serialized: string, extras: readonly string[]): void {
  expect(serialized).not.toContain(WRONG_PASSWORD);
  expect(serialized).not.toContain(DEMO_USER_PASSWORD);
  expect(serialized).not.toContain(DEMO_USER_EMAIL);
  for (const extra of extras) {
    expect(serialized).not.toContain(extra);
  }
}

describe('PA-M15 failed authentication audit', () => {
  it('records one security event per failed login and never stores the credential', async () => {
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const response = await harness.app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/auth/login`,
        payload: { email: DEMO_USER_EMAIL, password: WRONG_PASSWORD },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json<ApiError>().error.code).toBe('UNAUTHENTICATED');
      expect(response.json<ApiError>().error.message).toBe('Email or password is incorrect.');
      assertNoRawSecrets(response.body, []);
    }

    const events = (await harness.auditEvents()).filter((event) => event.type === 'auth.login.failed');
    expect(events).toHaveLength(ATTEMPTS);
    const expectedHash = hashAttemptedIdentifier(DEMO_USER_EMAIL);
    for (const event of events) {
      expect(event.actor).toBe('anonymous');
      expect(event.payload['category']).toBe('login_failed');
      expect(event.payload['identifierKind']).toBe('email');
      expect(event.payload['identifierHash']).toBe(expectedHash);
      expect(event.payload['identifierHash']).not.toBe(DEMO_USER_EMAIL);
      assertNoRawSecrets(JSON.stringify(event), []);
    }
  });

  it('records an invalid API key without the raw secret', async () => {
    const secret = 'mk_notreal_secretvalueXXXXEXTRA';
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/meta`,
      headers: { 'x-api-key': secret },
    });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain(secret);

    const events = (await harness.auditEvents()).filter(
      (event) => event.type === 'auth.credential.failed',
    );
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1];
    expect(last?.payload['category']).toBe('invalid_api_key');
    expect(last?.payload['credentialPrefix']).toBe(secret.slice(0, 16));
    expect(JSON.stringify(last)).not.toContain(secret);
    expect(JSON.stringify(last)).not.toContain(secret.slice(16));
  });

  it('records an invalid session without any token characters', async () => {
    const token = `mds_${'Z'.repeat(43)}`;
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/auth/me`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain(token);

    const events = (await harness.auditEvents()).filter(
      (event) =>
        event.type === 'auth.credential.failed' && event.payload['category'] === 'invalid_session',
    );
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1];
    expect(last?.payload['identifierKind']).toBe('session');
    expect(last?.payload['credentialPrefix']).toBeUndefined();
    expect(JSON.stringify(last)).not.toContain(token);
    expect(JSON.stringify(last)).not.toContain('mds_');
  });

  it('does not record a security event for anonymous public requests', async () => {
    const before = (await harness.auditEvents()).filter(
      (event) => event.type === 'auth.credential.failed' || event.type === 'auth.login.failed',
    ).length;
    const response = await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}/meta` });
    expect(response.statusCode).toBe(200);
    const after = (await harness.auditEvents()).filter(
      (event) => event.type === 'auth.credential.failed' || event.type === 'auth.login.failed',
    ).length;
    expect(after).toBe(before);
  });
});

describe('hashAttemptedIdentifier', () => {
  it('is stable, truncated, and not the raw identifier', () => {
    const hash = hashAttemptedIdentifier(DEMO_USER_EMAIL);
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).toBe(hashAttemptedIdentifier(DEMO_USER_EMAIL.toUpperCase()));
    expect(hash).not.toContain('@');
    expect(hash).not.toBe(DEMO_USER_EMAIL);
  });
});
