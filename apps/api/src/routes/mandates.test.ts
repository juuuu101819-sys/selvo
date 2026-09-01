import {
  DEMO_AGENT_SECRET,
  DEMO_ORGANIZATION_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  OTHER_ORGANIZATION_ID,
  OTHER_USER_EMAIL,
  OTHER_USER_PASSWORD,
  generateTestP256KeyPair,
  signedAp2VerifyBody,
  signedMppVerifyBody,
  signedX402Authorization,
  USD_EUR_SCOPE,
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

interface X402ChallengeDetails {
  readonly reason?: string;
  readonly challenge?: {
    readonly accepts?: readonly {
      readonly extra?: { readonly challengeId?: string; readonly nonce?: string };
    }[];
  };
}

function mandateOf(response: { json: () => ApiEnvelope<PublicMandate> }): PublicMandate {
  return response.json().data;
}

describe('mandate ingestion (flag default off)', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
    await provisionDemoTenants({
      identity: harness.container.persistence.identity,
      dashboard: harness.container.persistence.dashboard,
      agentPayments: harness.container.persistence.agentPayments,
      auditLog: harness.container.persistence.auditLog,
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('publishes mandateIngestionEnabled=false on GET /meta', async () => {
    const response = await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}/meta` });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      data: { mandateIngestionEnabled: boolean; capabilities: { mandateIngestion: boolean } };
    }>().data;
    expect(body.mandateIngestionEnabled).toBe(false);
    expect(body.capabilities.mandateIngestion).toBe(true);
  });

  it('fail-closes POST /mandates/verify when the flag is off', async () => {
    const keys = generateTestP256KeyPair();
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/mandates/verify`,
      headers: AGENT,
      payload: signedAp2VerifyBody(keys),
    });
    expect(response.statusCode).toBe(403);
    const error = response.json<ApiError>().error;
    expect(error.code).toBe('FORBIDDEN');
    expect(error.details['reason']).toBe('ingestion_disabled');
    expect(error.details['flag']).toBe('MANDATE_INGESTION_ENABLED');
  });
});

describe('mandate ingestion (flag on)', () => {
  let harness: TestHarness;
  let ownerToken: string;
  let otherToken: string;

  beforeAll(async () => {
    harness = await createTestHarness({ MANDATE_INGESTION_ENABLED: 'true' });
    await provisionDemoTenants({
      identity: harness.container.persistence.identity,
      dashboard: harness.container.persistence.dashboard,
      agentPayments: harness.container.persistence.agentPayments,
      auditLog: harness.container.persistence.auditLog,
    });
    ownerToken = await login(harness, DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    otherToken = await login(harness, OTHER_USER_EMAIL, OTHER_USER_PASSWORD);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('verifies an AP2 Intent Mandate, binds it to the mag_ agent, and audits', async () => {
    const keys = generateTestP256KeyPair();
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/mandates/verify`,
      headers: AGENT,
      payload: signedAp2VerifyBody(keys, { kind: 'intent' }),
    });
    expect(response.statusCode).toBe(201);
    const mandate = mandateOf(response);
    expect(mandate.id).toMatch(/^mdt_/);
    expect(mandate.format).toBe('ap2_intent');
    expect(mandate.status).toBe('verified');
    expect(mandate.organizationId).toBe(DEMO_ORGANIZATION_ID);
    expect(mandate.agentId).toBe('agt_demo_treasury');
    expect(mandate.fundsMoved).toBe(false);
    expect(mandate.custody).toBe(false);
    expect(mandate.sandbox).toBe(true);
    expect(response.json<{ meta: { sandbox: true } }>().meta.sandbox).toBe(true);

    const fetched = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/mandates/${mandate.id}`,
      headers: AGENT,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json<ApiEnvelope<PublicMandate>>().data.payloadHash).toBe(mandate.payloadHash);

    const events = await harness.auditEvents();
    expect(events.some((event) => event.type === 'mandate.verified' && event.payload['mandateId'] === mandate.id)).toBe(
      true,
    );
  });

  it('verifies an AP2 Cart Mandate', async () => {
    const keys = generateTestP256KeyPair();
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/mandates/verify`,
      headers: AGENT,
      payload: signedAp2VerifyBody(keys, { kind: 'cart' }),
    });
    expect(response.statusCode).toBe(201);
    expect(mandateOf(response).format).toBe('ap2_cart');
  });

  it('verifies an MPP session spend-cap lock without executing', async () => {
    const keys = generateTestP256KeyPair();
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/mandates/verify`,
      headers: AGENT,
      payload: signedMppVerifyBody(keys),
    });
    expect(response.statusCode).toBe(201);
    const mandate = mandateOf(response);
    expect(mandate.format).toBe('mpp');
    expect(mandate.fundsMoved).toBe(false);
  });

  it('issues an x402 402 challenge, then stores the signed authorization', async () => {
    const keys = generateTestP256KeyPair();
    const challengeResponse = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/mandates/verify`,
      headers: AGENT,
      payload: { format: 'x402', scope: USD_KRW_SCOPE },
    });
    expect(challengeResponse.statusCode).toBe(402);
    const error = challengeResponse.json<ApiError>().error;
    expect(error.code).toBe('X402_PAYMENT_REQUIRED');
    const extra = (error.details as X402ChallengeDetails).challenge?.accepts?.[0]?.extra;
    expect(extra?.challengeId).toMatch(/^x402_/);
    expect(extra?.nonce).toEqual(expect.any(String));

    const rejected = await harness.auditEvents();
    expect(rejected.filter((event) => event.type === 'mandate.rejected').length).toBeGreaterThanOrEqual(0);
    const rejectedForChallenge = rejected.filter(
      (event) => event.type === 'mandate.rejected' && event.payload['reason'] === 'challenge_required',
    );
    expect(rejectedForChallenge).toHaveLength(0);

    const stored = await harness.container.persistence.mandates.findChallenge(
      extra?.challengeId ?? '',
      DEMO_ORGANIZATION_ID,
    );
    expect(stored).not.toBeNull();
    if (stored === null) {
      throw new Error('expected persisted x402 challenge');
    }

    const authorize = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/mandates/verify`,
      headers: AGENT,
      payload: signedX402Authorization(keys, {
        id: stored.id,
        nonce: stored.nonce,
        organizationId: stored.organizationId,
        agentId: stored.agentId,
        scope: stored.scope,
      }),
    });
    expect(authorize.statusCode).toBe(201);
    expect(mandateOf(authorize).format).toBe('x402');
  });

  it('rejects an expired AP2 credential and audits mandate.rejected', async () => {
    const keys = generateTestP256KeyPair();
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/mandates/verify`,
      headers: AGENT,
      payload: signedAp2VerifyBody(keys, { validUntil: '2026-02-01T00:00:00.000Z' }),
    });
    expect(response.statusCode).toBe(422);
    const error = response.json<ApiError>().error;
    expect(error.code).toBe('MANDATE_REJECTED');
    expect(error.details['reason']).toBe('expired');
    const events = await harness.auditEvents();
    expect(events.some((event) => event.type === 'mandate.rejected' && event.payload['reason'] === 'expired')).toBe(
      true,
    );
  });

  it('rejects a forged signature', async () => {
    const keys = generateTestP256KeyPair();
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/mandates/verify`,
      headers: AGENT,
      payload: signedAp2VerifyBody(keys, { tamperSignature: true }),
    });
    expect(response.statusCode).toBe(422);
    expect(response.json<ApiError>().error.details['reason']).toBe('signature_invalid');
  });

  it('rejects an empty (unrestricted) scope fail-closed', async () => {
    const keys = generateTestP256KeyPair();
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/mandates/verify`,
      headers: AGENT,
      payload: signedAp2VerifyBody(keys, {
        scope: {
          spendCap: { amount: '1000.00', currency: 'USD' },
          allowedCorridors: [],
          allowedCurrencies: ['USD'],
          allowedBeneficiaries: ['merchant-x'],
        },
      }),
    });
    expect(response.statusCode).toBe(400);
    const events = await harness.auditEvents();
    expect(events.some((event) => event.type === 'mandate.rejected')).toBe(true);
  });

  it('returns 404, not 403, for another tenant\'s mandate id', async () => {
    const keys = generateTestP256KeyPair();
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/mandates/verify`,
      headers: AGENT,
      payload: signedAp2VerifyBody(keys),
    });
    expect(created.statusCode).toBe(201);
    const id = mandateOf(created).id;

    const otherGet = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/mandates/${id}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(otherGet.statusCode).toBe(404);
    expect(otherGet.body).not.toContain(DEMO_ORGANIZATION_ID);

    const ownerSeesOther = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/mandates/mdt_other_secret`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(ownerSeesOther.statusCode).toBe(404);
    expect(ownerSeesOther.body).not.toContain(OTHER_ORGANIZATION_ID);
  });

  it('lets owner/admin revoke; a revoked mandate cannot attach to a quote', async () => {
    const keys = generateTestP256KeyPair();
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/mandates/verify`,
      headers: AGENT,
      payload: signedAp2VerifyBody(keys),
    });
    const id = mandateOf(created).id;

    const agentRevoke = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/mandates/${id}/revoke`,
      headers: AGENT,
    });
    expect(agentRevoke.statusCode).toBe(403);

    const revoked = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/mandates/${id}/revoke`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(revoked.statusCode).toBe(200);
    expect(mandateOf(revoked).status).toBe('revoked');

    const quote = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      headers: AGENT,
      payload: {
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '100000.00',
        mandateId: id,
      },
    });
    expect(quote.statusCode).toBe(422);
    expect(quote.json<ApiError>().error.code).toBe('MANDATE_REJECTED');
    expect(quote.json<ApiError>().error.details['reason']).toBe('revoked');

    const events = await harness.auditEvents();
    expect(events.some((event) => event.type === 'mandate.revoked' && event.payload['mandateId'] === id)).toBe(true);
  });

  it('drops out-of-scope routes after ranking when mandateId is attached', async () => {
    const keys = generateTestP256KeyPair();
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/mandates/verify`,
      headers: AGENT,
      payload: signedAp2VerifyBody(keys, { scope: USD_EUR_SCOPE }),
    });
    expect(created.statusCode).toBe(201);
    const id = mandateOf(created).id;

    const unfiltered = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      headers: AGENT,
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '100000.00' },
    });
    expect(unfiltered.statusCode).toBe(201);
    const unfilteredRoutes = unfiltered.json<{ data: { routes: unknown[] } }>().data.routes;
    expect(unfilteredRoutes.length).toBeGreaterThan(0);

    const filtered = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      headers: AGENT,
      payload: {
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '100000.00',
        mandateId: id,
      },
    });
    expect(filtered.statusCode).toBe(422);
    expect(filtered.json<ApiError>().error.code).toBe('NO_ROUTES_AVAILABLE');
  });

  it('keeps in-scope USD→KRW routes when the mandate allows that corridor', async () => {
    const keys = generateTestP256KeyPair();
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/mandates/verify`,
      headers: AGENT,
      payload: signedAp2VerifyBody(keys, { scope: USD_KRW_SCOPE }),
    });
    const id = mandateOf(created).id;

    const quoted = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      headers: AGENT,
      payload: {
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '100000.00',
        mandateId: id,
      },
    });
    expect(quoted.statusCode).toBe(201);
    expect(quoted.json<{ data: { routes: unknown[] } }>().data.routes.length).toBeGreaterThan(0);
  });

  it('rejects an anonymous caller attaching mandateId', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/comparisons`,
      payload: {
        sourceCurrency: 'USD',
        targetCurrency: 'KRW',
        amount: '100000.00',
        mandateId: 'mdt_nope',
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a human session presenting a mandate for verify', async () => {
    const keys = generateTestP256KeyPair();
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/mandates/verify`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: signedAp2VerifyBody(keys),
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('mandate ingestion + policy (isolated harness)', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness({ MANDATE_INGESTION_ENABLED: 'true' });
    await provisionDemoTenants({
      identity: harness.container.persistence.identity,
      dashboard: harness.container.persistence.dashboard,
      agentPayments: harness.container.persistence.agentPayments,
      auditLog: harness.container.persistence.auditLog,
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('applies verified mandate scope as extra policy constraints', async () => {
    const keys = generateTestP256KeyPair();
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/mandates/verify`,
      headers: AGENT,
      payload: signedAp2VerifyBody(keys, {
        scope: {
          spendCap: { amount: '10.00', currency: 'USD' },
          allowedCorridors: [{ source: 'USD', destination: 'KRW' }],
          allowedCurrencies: ['USD', 'KRW'],
          allowedBeneficiaries: ['merchant-x'],
        },
      }),
    });
    expect(created.statusCode).toBe(201);

    const intent = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/payment-intents`,
      headers: { ...AGENT, 'idempotency-key': 'mandate-over-scope-intent' },
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '500.00', recipient: 'merchant-x' },
    });
    expect(intent.statusCode).toBe(403);
    expect(intent.json<ApiError>().error.code).toBe('POLICY_DENIED');
    expect(intent.json<ApiError>().error.details['rule']).toBe('mandate_scope');
  });
});

async function login(harness: TestHarness, email: string, password: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/auth/login`,
    payload: { email, password },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { token: string } }>().data.token;
}
