import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness, type ApiError, type TestHarness } from '../testing/harness.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});

afterAll(async () => {
  await harness.close();
});

/**
 * These tests make the non-custodial boundary a tested property rather than a promise in a
 * document. If execution is ever implemented without going through the compliance gate in
 * docs/COMPLIANCE.md, they fail.
 */
describe('POST /v1/executions', () => {
  it('refuses to execute a transaction', async () => {
    const response = await harness.app.inject({ method: 'POST', url: '/v1/executions' });

    expect(response.statusCode).toBe(501);
    expect(response.json<ApiError>().error.code).toBe('EXECUTION_NOT_IMPLEMENTED');
  });

  it('explains that the platform is non-custodial', async () => {
    const response = await harness.app.inject({ method: 'POST', url: '/v1/executions' });
    const body = response.json<ApiError>();

    expect(body.error.message).toMatch(/non-custodial/);
    expect(body.error.details).toMatchObject({
      nonCustodial: true,
      operateAsPrincipal: false,
      holdPrivateKeys: false,
      delegateExecution: false,
      documentation: 'docs/COMPLIANCE.md',
    });
    expect(body.error.message).toMatch(/delegated/);
  });

  it('refuses a bodyless request that declares a JSON content type', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(501);
    expect(response.json<ApiError>().error.code).toBe('EXECUTION_NOT_IMPLEMENTED');
  });

  it('refuses regardless of what the caller sends', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/executions',
      payload: { comparisonId: 'cmp_1', routeId: 'sandbox-northgate-bank:bank_fx', confirm: true },
    });

    expect(response.statusCode).toBe(501);
  });

  it('audits the rejected attempt', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/v1/executions',
      headers: { 'x-meridian-actor': 'over-eager-integrator' },
    });

    const events = await harness.auditEvents();
    const rejection = events.find((event) => event.type === 'execution.rejected');

    expect(rejection).toBeDefined();
    expect(rejection?.actor).toBe('over-eager-integrator');
    expect(rejection?.payload['reason']).toMatch(/delegated settlement is not implemented/);
  });
});

describe('non-custodial guarantees', () => {
  it('exposes no endpoint that could move funds', async () => {
    const forbidden = [
      '/v1/payments',
      '/v1/transfers',
      '/v1/wallets',
      '/v1/balances',
      '/v1/withdrawals',
      '/v1/custody',
    ];

    for (const url of forbidden) {
      const response = await harness.app.inject({ method: 'POST', url });
      expect(response.statusCode).toBe(404);
    }
  });
});
