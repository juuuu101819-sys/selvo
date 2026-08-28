/**
 * Post-deployment smoke checks for a production-locked staging API.
 *
 * Gated on STAGING_API_BASE_URL so `npm test` does not hit a live environment. After compose/local
 * staging is up: `STAGING_API_BASE_URL=http://127.0.0.1:47331 npm run test:staging-smoke`.
 *
 * Staging has no licensed adapters. A successful comparison/quote is the fail-closed 422
 * (UNSUPPORTED_CORRIDOR / NO_ROUTES_AVAILABLE), not a sandbox quote. Demo login must 401.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BASE = process.env['STAGING_API_BASE_URL'];
const describeStaging = BASE === undefined || BASE.trim() === '' ? describe.skip : describe;

const DEMO_EMAIL = 'treasury@demo-trading.example.invalid';
const DEMO_PASSWORD = 'MeridianDemo!2026';

interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string; readonly details?: unknown };
}

interface MetaBody {
  readonly data: {
    readonly mode: string;
    readonly persistenceDriver: string;
    readonly productionGates: { readonly routingAvailable: boolean; readonly executionAvailable: boolean };
    readonly execution: { readonly implemented: boolean; readonly statusCode: number };
    readonly deployment: { readonly environment: string; readonly imageTag: string | null };
    readonly providers: readonly unknown[];
    readonly providerCatalog: { readonly providers: readonly unknown[] };
    readonly capabilities: { readonly executeTransactions: boolean; readonly custodyFunds: boolean };
  };
}

describeStaging('staging smoke (PHASE 29)', () => {
  const base = (BASE ?? '').replace(/\/$/, '');
  let operatorToken: string | null = null;

  beforeAll(async () => {
    const email = process.env['STAGING_OPERATOR_EMAIL'];
    const password = process.env['STAGING_OPERATOR_PASSWORD'];
    if (email === undefined || password === undefined) {
      return;
    }
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(login.status).toBe(201);
    const body = (await login.json()) as { data: { token: string } };
    operatorToken = body.data.token;
  });

  afterAll(() => {
    operatorToken = null;
  });

  it('reports production-locked meta flags and postgres', async () => {
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', mode: 'production' });

    const ready = await fetch(`${base}/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      status: 'ready',
      persistenceDriver: 'postgres',
    });

    const meta = await fetch(`${base}/api/v1/meta`);
    expect(meta.status).toBe(200);
    const body = (await meta.json()) as MetaBody;
    expect(body.data.mode).toBe('production');
    expect(body.data.persistenceDriver).toBe('postgres');
    expect(body.data.deployment.environment).toBe('staging');
    expect(body.data.productionGates).toEqual({
      routingAvailable: false,
      executionAvailable: false,
    });
    expect(body.data.execution).toMatchObject({ implemented: false, statusCode: 501 });
    expect(body.data.providers).toEqual([]);
    expect(body.data.providerCatalog.providers).toEqual([]);
    expect(body.data.capabilities.executeTransactions).toBe(false);
    expect(body.data.capabilities.custodyFunds).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/AUTH_SECRET|MeridianDemo|mag_demo_agent01/i);
  });

  it('keeps POST /executions at 501', async () => {
    const response = await fetch(`${base}/api/v1/executions`, { method: 'POST' });
    expect(response.status).toBe(501);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe('EXECUTION_NOT_IMPLEMENTED');
  });

  it('rejects documented demo login (no accidental demo tenant)', async () => {
    const response = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('runs comparison/quote against staging postgres and does not invent licensed quotes', async () => {
    const comparison = await fetch(`${base}/api/v1/comparisons`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceCurrency: 'USD',
        targetCurrency: 'KRW',
        amount: '1000.00',
      }),
    });
    expect(comparison.status).toBe(422);
    const comparisonBody = (await comparison.json()) as ErrorBody;
    expect(['UNSUPPORTED_CORRIDOR', 'NO_ROUTES_AVAILABLE']).toContain(comparisonBody.error.code);

    const anonymousQuote = await fetch(`${base}/api/v1/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '1000.00',
      }),
    });
    expect(anonymousQuote.status).toBe(401);

    if (operatorToken === null) {
      return;
    }

    const me = await fetch(`${base}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as {
      data: { organization: { name: string; slug: string }; user: { email: string | null } };
    };
    expect(meBody.data.organization.slug).toBe('staging-synthetic');
    expect(meBody.data.organization.name).toMatch(/\[SYNTHETIC\]/);
    expect(meBody.data.organization.name).not.toMatch(/demo/i);
    expect(meBody.data.user.email).not.toMatch(/demo-trading/i);

    const quoted = await fetch(`${base}/api/v1/quote`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${operatorToken}`,
      },
      body: JSON.stringify({
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '1000.00',
      }),
    });
    expect(quoted.status).toBe(422);
    const quoteBody = (await quoted.json()) as ErrorBody;
    expect(['UNSUPPORTED_CORRIDOR', 'NO_ROUTES_AVAILABLE']).toContain(quoteBody.error.code);
  });
});
