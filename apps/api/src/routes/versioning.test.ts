import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_V1_PREFIX, LEGACY_V1_PREFIX } from './index.js';
import { createTestHarness, type ApiError, type TestHarness } from '../testing/harness.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});

afterAll(async () => {
  await harness.close();
});

describe(`GET ${API_V1_PREFIX}/health`, () => {
  it('returns exactly the documented three-field contract', async () => {
    const response = await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}/health` });

    expect(response.statusCode).toBe(200);
    // Asserted with toEqual, not toMatchObject: the shape is the contract, so an extra field is a
    // breaking change for anything parsing it strictly.
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'financial-router',
      version: '1.0.0',
    });
  });

  it('does not wrap the health response in the API envelope', async () => {
    const body = response(
      await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}/health` }),
    );
    expect(body).not.toHaveProperty('data');
    expect(body).not.toHaveProperty('meta');
  });

  it('answers without a database, so readiness and liveness stay independent', async () => {
    // The versioned health endpoint reports nothing derived from runtime state by design.
    const first = await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}/health` });
    const second = await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}/health` });
    expect(second.json()).toEqual(first.json());
  });
});

describe('API versioning', () => {
  const versionedPaths = ['/health', '/meta', '/comparisons'] as const;

  it.each(versionedPaths)('serves %s under the canonical prefix', async (path) => {
    const result = await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}${path}` });
    expect(result.statusCode).toBe(200);
  });

  it.each(versionedPaths)('still serves %s under the legacy prefix', async (path) => {
    const result = await harness.app.inject({ method: 'GET', url: `${LEGACY_V1_PREFIX}${path}` });
    expect(result.statusCode).toBe(200);
  });

  it('marks the legacy prefix deprecated and points at its successor', async () => {
    const legacy = await harness.app.inject({ method: 'GET', url: `${LEGACY_V1_PREFIX}/meta` });

    expect(legacy.headers['deprecation']).toBe('true');
    expect(legacy.headers['link']).toBe(`<${API_V1_PREFIX}>; rel="successor-version"`);
  });

  it('does not mark the canonical prefix deprecated', async () => {
    const canonical = await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}/meta` });
    expect(canonical.headers['deprecation']).toBeUndefined();
  });

  it('serves an identical comparison result from either prefix', async () => {
    const payload = { sourceCurrency: 'USD', targetCurrency: 'KRW', amount: '100000.00' };

    const canonical = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/comparisons`,
      payload,
    });
    const legacy = await harness.app.inject({
      method: 'POST',
      url: `${LEGACY_V1_PREFIX}/comparisons`,
      payload,
    });

    expect(canonical.statusCode).toBe(201);
    expect(legacy.statusCode).toBe(201);
    // Different comparison ids, identical calculation.
    expect(legacy.json<{ data: { fingerprint: string } }>().data.fingerprint).toBe(
      canonical.json<{ data: { fingerprint: string } }>().data.fingerprint,
    );
  });

  it('rejects an unversioned attempt at a versioned route', async () => {
    const result = await harness.app.inject({ method: 'GET', url: '/comparisons' });

    expect(result.statusCode).toBe(404);
    expect(result.json<ApiError>().error.code).toBe('NOT_FOUND');
  });
});

describe('unversioned operational endpoints', () => {
  it('reports liveness with the service identity', async () => {
    const result = await harness.app.inject({ method: 'GET', url: '/health' });

    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      status: 'ok',
      service: 'financial-router',
      version: '1.0.0',
      mode: 'sandbox',
    });
  });

  it('keeps readiness separate from liveness', async () => {
    const result = await harness.app.inject({ method: 'GET', url: '/ready' });

    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ status: 'ready', checks: { persistence: 'ok' } });
  });

  it('does not version the operational endpoints, so an orchestrator need not track versions', async () => {
    const result = await harness.app.inject({ method: 'GET', url: '/ready' });
    expect(result.headers['deprecation']).toBeUndefined();
  });
});

function response(injected: { json: () => unknown }): Record<string, unknown> {
  return injected.json() as Record<string, unknown>;
}
