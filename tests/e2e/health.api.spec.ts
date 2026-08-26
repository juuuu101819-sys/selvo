import { expect, test } from '@playwright/test';
import {
  jsonBody,
  type ComparisonBody,
  type ErrorBody,
  type HealthBody,
  type ReadyBody,
  type ReplayBody,
} from './support/api.js';

/**
 * Contract tests against a real HTTP server.
 *
 * These complement the Fastify `inject` integration tests rather than repeating them: they exercise
 * the process as deployed — real sockets, real JSON serialisation, real header defaults — which is
 * where a body parser behaves differently from the in-process harness. The empty-body defect fixed
 * earlier in this project was exactly that class of bug.
 */
test.describe('GET /api/v1/health', () => {
  test('returns the documented service contract', async ({ request }) => {
    const response = await request.get('/api/v1/health');

    expect(response.status()).toBe(200);
    // Asserted with toEqual: the shape is the contract, so an added field is a breaking change for
    // anything parsing it strictly.
    expect(await jsonBody<HealthBody>(response)).toEqual({
      status: 'ok',
      service: 'financial-router',
      version: '1.0.0',
    });
  });

  test('is served over the legacy prefix with a deprecation header', async ({ request }) => {
    const response = await request.get('/v1/health');

    expect(response.status()).toBe(200);
    expect(response.headers()['deprecation']).toBe('true');
  });

  test('reports liveness unversioned, for orchestrators', async ({ request }) => {
    const response = await request.get('/health');

    expect(response.status()).toBe(200);
    expect(await jsonBody<HealthBody>(response)).toMatchObject({
      status: 'ok',
      service: 'financial-router',
    });
  });

  test('reports readiness including the persistence check', async ({ request }) => {
    const response = await request.get('/ready');

    expect(response.status()).toBe(200);
    expect(await jsonBody<ReadyBody>(response)).toMatchObject({
      status: 'ready',
      checks: { persistence: 'ok' },
    });
  });
});

test.describe('route comparison over the wire', () => {
  test('prices the corridor and returns a reproducible comparison', async ({ request }) => {
    const created = await request.post('/api/v1/comparisons', {
      data: { sourceCurrency: 'USD', targetCurrency: 'KRW', amount: '100000.00' },
    });

    expect(created.status()).toBe(201);
    const body = await jsonBody<ComparisonBody>(created);

    expect(body.data.routes.length).toBeGreaterThan(0);
    expect(body.data.recommendedRouteId).toBe(body.data.routes[0]?.routeId);
    expect(body.meta.mode).toBe('sandbox');

    // Amounts cross the wire as integer minor-unit strings, never as JSON numbers.
    for (const route of body.data.routes) {
      expect(typeof route.deliveredAmount.minorUnits).toBe('string');
      expect(route.deliveredAmount.minorUnits).toMatch(/^\d+$/);
    }

    const replayed = await request.post(`/api/v1/comparisons/${body.data.comparisonId}/replay`, {
      // Deliberately sends the JSON content type with no body: the shape most HTTP clients produce.
      headers: { 'content-type': 'application/json' },
    });

    expect(replayed.status()).toBe(200);
    const replay = await jsonBody<ReplayBody>(replayed);
    expect(replay.data.reproducible).toBe(true);
    expect(replay.data.replayedFingerprint).toBe(body.data.fingerprint);
  });

  test('refuses to execute a transaction', async ({ request }) => {
    const response = await request.post('/api/v1/executions', {
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status()).toBe(501);
    const body = await jsonBody<ErrorBody>(response);
    expect(body.error.code).toBe('EXECUTION_NOT_IMPLEMENTED');
    expect(body.error.details['nonCustodial']).toBe(true);
  });

  test('rejects an amount more precise than the currency allows', async ({ request }) => {
    const response = await request.post('/api/v1/comparisons', {
      data: { sourceCurrency: 'KRW', targetCurrency: 'USD', amount: '1000.50' },
    });

    expect(response.status()).toBe(400);
    expect((await jsonBody<ErrorBody>(response)).error.code).toBe('VALIDATION_ERROR');
  });

  test('rejects a credential it cannot verify rather than serving anonymously', async ({
    request,
  }) => {
    const response = await request.get('/api/v1/meta', {
      headers: { authorization: 'Bearer not-a-real-token' },
    });

    expect(response.status()).toBe(401);
    expect((await jsonBody<ErrorBody>(response)).error.code).toBe('UNAUTHENTICATED');
  });
});
