import { DEMO_USER_EMAIL, DEMO_USER_PASSWORD } from '@meridian/core';
import { describe, expect, it } from 'vitest';
import { API_V1_PREFIX } from './index.js';
import { createTestHarness, type ApiError } from '../testing/harness.js';

describe('rate limiting', () => {
  it('returns 429 once the window is exhausted', async () => {
    const harness = await createTestHarness({ RATE_LIMIT_MAX: '2', RATE_LIMIT_WINDOW_MS: '60000' });
    try {
      const first = await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}/assets` });
      const second = await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}/assets` });
      const third = await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}/assets` });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(third.statusCode).toBe(429);
      expect(third.json<ApiError>().error.code).toBe('RATE_LIMITED');
      expect(third.headers['retry-after']).toBeDefined();
    } finally {
      await harness.close();
    }
  });

  it('keys the limit by verified principal, not only IP (PA-M02)', async () => {
    const harness = await createTestHarness({
      RATE_LIMIT_MAX: '2',
      RATE_LIMIT_WINDOW_MS: '60000',
      SEED_DEMO_TENANTS: 'true',
    });
    try {
      const login = await harness.app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/auth/login`,
        payload: { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD },
      });
      expect(login.statusCode).toBe(201);
      const token = login.json<{ data: { token: string } }>().data.token;

      const issue = async (label: string) => {
        const created = await harness.app.inject({
          method: 'POST',
          url: `${API_V1_PREFIX}/api-keys`,
          headers: { authorization: `Bearer ${token}` },
          payload: { label },
        });
        expect(created.statusCode).toBe(201);
        return created.json<{ data: { secret: string } }>().data.secret;
      };

      const keyA = await issue('limit-a');
      const keyB = await issue('limit-b');

      const quote = (secret: string) =>
        harness.app.inject({
          method: 'GET',
          url: `${API_V1_PREFIX}/assets`,
          headers: { 'x-api-key': secret },
        });

      expect((await quote(keyA)).statusCode).toBe(200);
      expect((await quote(keyA)).statusCode).toBe(200);
      const exhausted = await quote(keyA);
      expect(exhausted.statusCode).toBe(429);
      expect(exhausted.json<ApiError>().error.code).toBe('RATE_LIMITED');
      expect(exhausted.headers['retry-after']).toBeDefined();

      const otherKey = await quote(keyB);
      expect(otherKey.statusCode).toBe(200);

      const anonymous = await harness.app.inject({
        method: 'GET',
        url: `${API_V1_PREFIX}/assets`,
      });
      expect(anonymous.statusCode).toBe(200);
    } finally {
      await harness.close();
    }
  });
});
