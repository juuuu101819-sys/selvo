import {
  DEMO_AGENT_SECRET,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  OTHER_USER_EMAIL,
  OTHER_USER_PASSWORD,
  generateTestP256KeyPair,
  signedAp2VerifyBody,
  USD_KRW_SCOPE,
  type PublicMandate,
} from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from './index.js';
import {
  createTestHarness,
  type ApiEnvelope,
  type ApiError,
  type TestHarness,
} from '../testing/harness.js';

const AGENT = { 'x-api-key': DEMO_AGENT_SECRET };
const ALLOWED_PROVIDERS = new Set(['sandbox-veridian-payments', 'sandbox-solstice-settlement']);

interface RoutingBody {
  readonly routingId: string;
  readonly routes: readonly {
    readonly routeId: string;
    readonly provider: { readonly id: string };
  }[];
}

interface ExecutionBody {
  readonly id: string;
  readonly status: string;
  readonly fundsMoved: boolean;
  readonly custody: boolean;
  readonly transferSigned: boolean;
  readonly meridianKeysUsed: boolean;
  readonly sandbox: boolean;
  readonly blockedReason: string | null;
  readonly failureCode: string | null;
  readonly monetizationEventId: string | null;
  readonly instructionHash: string | null;
}

async function login(harness: TestHarness, email: string, password: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/auth/login`,
    payload: { email, password },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { token: string } }>().data.token;
}

async function verifyMandate(
  harness: TestHarness,
  scope = USD_KRW_SCOPE,
): Promise<string> {
  const keys = generateTestP256KeyPair();
  const response = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/mandates/verify`,
    headers: AGENT,
    payload: signedAp2VerifyBody(keys, { scope }),
  });
  expect(response.statusCode).toBe(201);
  return response.json<ApiEnvelope<PublicMandate>>().data.id;
}

async function quoteRoute(harness: TestHarness, amount = '500.00'): Promise<{
  readonly routingId: string;
  readonly routeId: string;
}> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/routes`,
    headers: AGENT,
    payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount },
  });
  expect(response.statusCode).toBe(201);
  const data = response.json<ApiEnvelope<RoutingBody>>().data;
  const route = data.routes.find((entry) => ALLOWED_PROVIDERS.has(entry.provider.id));
  expect(route).toBeDefined();
  return { routingId: data.routingId, routeId: route!.routeId };
}

function assertNoCustody(execution: ExecutionBody): void {
  expect(execution.fundsMoved).toBe(false);
  expect(execution.custody).toBe(false);
  expect(execution.transferSigned).toBe(false);
  expect(execution.meridianKeysUsed).toBe(false);
  expect(execution.sandbox).toBe(true);
}

describe('POST /executions (EXECUTION_ENABLED default off)', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('stays 501 and never 201', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      payload: {
        mandateId: 'mdt_x',
        routingId: 'rte_x',
        routeId: 'route_x',
        beneficiaryRef: 'merchant-x',
      },
    });
    expect(response.statusCode).toBe(501);
    expect(response.json<ApiError>().error.code).toBe('EXECUTION_NOT_IMPLEMENTED');
  });
});

describe('sandbox execution orchestration (EXECUTION_ENABLED=true)', () => {
  let harness: TestHarness;
  let otherToken: string;

  beforeAll(async () => {
    harness = await createTestHarness({
      EXECUTION_ENABLED: 'true',
      MANDATE_INGESTION_ENABLED: 'true',
    });
    await provisionDemoTenants({
      identity: harness.container.persistence.identity,
      dashboard: harness.container.persistence.dashboard,
      agentPayments: harness.container.persistence.agentPayments,
      auditLog: harness.container.persistence.auditLog,
    });
    otherToken = await login(harness, OTHER_USER_EMAIL, OTHER_USER_PASSWORD);
    await login(harness, DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('walks mandate + route to SETTLED against a mock partner without custody', async () => {
    const mandateId = await verifyMandate(harness);
    const quoted = await quoteRoute(harness);
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      headers: { ...AGENT, 'idempotency-key': 'exec-happy-psp-settle-01' },
      payload: {
        mandateId,
        routingId: quoted.routingId,
        routeId: quoted.routeId,
        beneficiaryRef: 'merchant-x',
      },
    });
    expect(created.statusCode).toBe(201);
    const execution = created.json<ApiEnvelope<ExecutionBody>>().data;
    expect(execution.status).toBe('SETTLED');
    expect(execution.monetizationEventId).toBeTruthy();
    expect(execution.instructionHash).toMatch(/^[a-f0-9]{64}$/);
    assertNoCustody(execution);

    const events = await harness.auditEvents();
    const types = events.filter((event) => event.type.startsWith('execution.')).map((event) => event.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'execution.created',
        'execution.routed',
        'execution.compliance_passed',
        'execution.dispatched',
        'execution.settled',
      ]),
    );
    expect(JSON.stringify(events.filter((event) => event.type.startsWith('execution.')))).not.toContain(
      'sandbox-instruction-hmac',
    );
  });

  it('blocks when sandbox compliance denies', async () => {
    const mandateId = await verifyMandate(harness);
    const quoted = await quoteRoute(harness);
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      headers: AGENT,
      payload: {
        mandateId,
        routingId: quoted.routingId,
        routeId: quoted.routeId,
        beneficiaryRef: 'merchant-x',
        complianceOutcome: 'deny',
      },
    });
    expect(response.statusCode).toBe(201);
    const execution = response.json<ApiEnvelope<ExecutionBody>>().data;
    expect(execution.status).toBe('BLOCKED');
    expect(execution.blockedReason).toBe('compliance_denied');
    assertNoCustody(execution);
  });

  it('blocks when the mandate spend cap is exceeded', async () => {
    const mandateId = await verifyMandate(harness, {
      ...USD_KRW_SCOPE,
      spendCap: { amount: '10.00', currency: 'USD' },
    });
    const quoted = await quoteRoute(harness, '500.00');
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      headers: AGENT,
      payload: {
        mandateId,
        routingId: quoted.routingId,
        routeId: quoted.routeId,
        beneficiaryRef: 'merchant-x',
      },
    });
    expect(response.statusCode).toBe(201);
    const execution = response.json<ApiEnvelope<ExecutionBody>>().data;
    expect(execution.status).toBe('BLOCKED');
    expect(execution.blockedReason).toBe('mandate_scope_exceeded');
    assertNoCustody(execution);
  });

  it('expires when the locked quote is past its expiresAt', async () => {
    const mandateId = await verifyMandate(harness);
    const quoted = await quoteRoute(harness);
    harness.clock.advance(10 * 60 * 1000);
    try {
      const response = await harness.app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/executions`,
        headers: AGENT,
        payload: {
          mandateId,
          routingId: quoted.routingId,
          routeId: quoted.routeId,
          beneficiaryRef: 'merchant-x',
        },
      });
      expect(response.statusCode).toBe(201);
      const execution = response.json<ApiEnvelope<ExecutionBody>>().data;
      expect(execution.status).toBe('EXPIRED');
      expect(execution.failureCode).toBe('quote_expired');
      assertNoCustody(execution);
    } finally {
      harness.clock.advance(-10 * 60 * 1000);
    }
  });

  it('records FAILED after every mock partner rejects the fail scenario', async () => {
    const mandateId = await verifyMandate(harness);
    const quoted = await quoteRoute(harness);
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      headers: AGENT,
      payload: {
        mandateId,
        routingId: quoted.routingId,
        routeId: quoted.routeId,
        beneficiaryRef: 'merchant-x',
        sandboxScenario: 'fail',
      },
    });
    expect(response.statusCode).toBe(201);
    const execution = response.json<ApiEnvelope<ExecutionBody>>().data;
    expect(execution.status).toBe('FAILED');
    expect(execution.failureCode).toBe('all_partners_failed');
    assertNoCustody(execution);
  });

  it('replays an idempotent POST once and conflicts on a different payload', async () => {
    const mandateId = await verifyMandate(harness);
    const quoted = await quoteRoute(harness);
    const payload = {
      mandateId,
      routingId: quoted.routingId,
      routeId: quoted.routeId,
      beneficiaryRef: 'merchant-x',
    };
    const first = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      headers: { ...AGENT, 'idempotency-key': 'exec-idempotent-once-01' },
      payload,
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json<ApiEnvelope<ExecutionBody>>().data;
    const second = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      headers: { ...AGENT, 'idempotency-key': 'exec-idempotent-once-01' },
      payload,
    });
    expect(second.statusCode).toBe(201);
    expect(second.json<ApiEnvelope<ExecutionBody>>().data.id).toBe(firstBody.id);

    const conflict = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      headers: { ...AGENT, 'idempotency-key': 'exec-idempotent-once-01' },
      payload: { ...payload, beneficiaryRef: 'merchant-y' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<ApiError>().error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('returns 404 to another tenant', async () => {
    const mandateId = await verifyMandate(harness);
    const quoted = await quoteRoute(harness);
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      headers: AGENT,
      payload: {
        mandateId,
        routingId: quoted.routingId,
        routeId: quoted.routeId,
        beneficiaryRef: 'merchant-x',
      },
    });
    const id = created.json<ApiEnvelope<ExecutionBody>>().data.id;
    const foreign = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/executions/${id}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(foreign.statusCode).toBe(404);
  });
});
