import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_V1_PREFIX } from '../routes/index.js';
import { createTestHarness, type ApiError, type TestHarness } from '../testing/harness.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});

afterAll(async () => {
  await harness.close();
});

const COMPARISON = { sourceCurrency: 'USD', targetCurrency: 'KRW', amount: '100000.00' };

/**
 * Public routes stay anonymous. A credential that cannot be verified is rejected rather than
 * served as if it belonged to a tenant.
 */
describe('anonymous authentication', () => {
  it('serves a request that presents no credential', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/comparisons`,
      payload: COMPARISON,
    });

    expect(response.statusCode).toBe(201);
  });

  it('reports the scheme and that it does not enforce', async () => {
    const response = await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}/meta` });
    const auth = response.json<{
      data: { authentication: { scheme: string; enforcing: boolean; principalKind: string } };
    }>().data.authentication;

    expect(auth).toEqual({
      scheme: 'session+api_key',
      enforcing: true,
      principalKind: 'anonymous',
    });
  });

  describe('refusing to pretend', () => {
    /**
     * A client that sends a bearer token and gets a 200 would reasonably conclude it is
     * authenticated and its data scoped to its organization. Neither is true here, so a credential
     * this deployment cannot verify is rejected rather than quietly ignored.
     */
    it.each([
      ['authorization', 'Bearer some-jwt-token'],
      ['x-api-key', 'mk_live_abc123'],
    ])('rejects a request presenting %s', async (header, value) => {
      const response = await harness.app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/comparisons`,
        headers: { [header]: value },
        payload: COMPARISON,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json<ApiError>().error.code).toBe('UNAUTHENTICATED');
    });

    it('explains how to proceed rather than just refusing', async () => {
      const response = await harness.app.inject({
        method: 'GET',
        url: `${API_V1_PREFIX}/meta`,
        headers: { authorization: 'Bearer token' },
      });

      expect(response.json<ApiError>().error.message).toMatch(/could not be verified/);
      expect(response.json<ApiError>().error.details).toMatchObject({
        scheme: 'session+api_key',
        enforcing: true,
      });
    });

    it('never echoes the credential back', async () => {
      const secret = 'Bearer super-secret-value';
      const response = await harness.app.inject({
        method: 'GET',
        url: `${API_V1_PREFIX}/meta`,
        headers: { authorization: secret },
      });

      expect(response.body).not.toContain('super-secret-value');
    });

    it('applies to every route, including the execution guard', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/executions`,
        headers: { authorization: 'Bearer token' },
      });

      // Authentication runs before the handler, so this is a 401 rather than the usual 501.
      expect(response.statusCode).toBe(401);
    });

    it.each(['/health', '/ready'])(
      'does not apply to %s, so a probe cannot fail on an injected credential',
      async (url) => {
        const response = await harness.app.inject({
          method: 'GET',
          url,
          headers: { authorization: 'Bearer token' },
        });

        expect(response.statusCode).toBe(200);
      },
    );
  });

  describe('audit attribution', () => {
    it('records the declared actor when no credential is presented', async () => {
      const created = await harness.app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/comparisons`,
        headers: { 'x-meridian-actor': 'treasury-ops' },
        payload: COMPARISON,
      });
      const comparisonId = created.json<{ data: { comparisonId: string } }>().data.comparisonId;

      const events = await harness.container.persistence.auditLog.listByComparison(comparisonId);
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((event) => event.actor === 'treasury-ops')).toBe(true);
    });

    it('falls back to "anonymous" when no actor is declared', async () => {
      const created = await harness.app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/comparisons`,
        payload: COMPARISON,
      });
      const comparisonId = created.json<{ data: { comparisonId: string } }>().data.comparisonId;

      const events = await harness.container.persistence.auditLog.listByComparison(comparisonId);
      expect(events[0]?.actor).toBe('anonymous');
    });

    it('bounds the declared actor so an unverified header cannot bloat the audit log', async () => {
      const created = await harness.app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/comparisons`,
        headers: { 'x-meridian-actor': 'a'.repeat(500) },
        payload: COMPARISON,
      });
      const comparisonId = created.json<{ data: { comparisonId: string } }>().data.comparisonId;

      const events = await harness.container.persistence.auditLog.listByComparison(comparisonId);
      expect(events[0]?.actor).toHaveLength(128);
    });
  });
});
