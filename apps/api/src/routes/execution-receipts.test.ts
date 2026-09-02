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
  USD_KRW_SCOPE,
  type PublicMandate,
  type ReceiptVerificationResult,
  type VerifiableExecutionReceipt,
} from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from './index.js';
import {
  createTestHarness,
  type ApiEnvelope,
  type TestHarness,
} from '../testing/harness.js';

const AGENT = { 'x-api-key': DEMO_AGENT_SECRET };
const ALLOWED_PROVIDERS = new Set(['sandbox-veridian-payments', 'sandbox-solstice-settlement']);

async function login(harness: TestHarness, email: string, password: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/auth/login`,
    payload: { email, password },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { token: string } }>().data.token;
}

async function settledExecution(harness: TestHarness): Promise<string> {
  const keys = generateTestP256KeyPair();
  const mandate = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/mandates/verify`,
    headers: AGENT,
    payload: signedAp2VerifyBody(keys, { scope: USD_KRW_SCOPE }),
  });
  expect(mandate.statusCode).toBe(201);
  const mandateId = mandate.json<ApiEnvelope<PublicMandate>>().data.id;
  const quoted = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/routes`,
    headers: AGENT,
    payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '500.00' },
  });
  expect(quoted.statusCode).toBe(201);
  const routing = quoted.json<
    ApiEnvelope<{
      routingId: string;
      routes: readonly { readonly routeId: string; readonly provider: { readonly id: string } }[];
    }>
  >().data;
  const route = routing.routes.find((entry) => ALLOWED_PROVIDERS.has(entry.provider.id));
  expect(route).toBeDefined();
  const created = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/executions`,
    headers: AGENT,
    payload: {
      mandateId,
      routingId: routing.routingId,
      routeId: route!.routeId,
      beneficiaryRef: 'merchant-x',
    },
  });
  expect(created.statusCode).toBe(201);
  const execution = created.json<ApiEnvelope<{ id: string; status: string }>>().data;
  expect(execution.status).toBe('SETTLED');
  return execution.id;
}

describe('verifiable receipts, reconciliation, and audit export', () => {
  let harness: TestHarness;
  let demoToken: string;
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
    demoToken = await login(harness, DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    otherToken = await login(harness, OTHER_USER_EMAIL, OTHER_USER_PASSWORD);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('issues a receipt that verifies independently and fails after a one-bit signature flip', async () => {
    const id = await settledExecution(harness);
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/executions/${id}/receipt`,
      headers: AGENT,
    });
    expect(response.statusCode).toBe(200);
    const receipt = response.json<ApiEnvelope<VerifiableExecutionReceipt>>().data;
    expect(receipt.payload.fundsMoved).toBe(false);
    expect(receipt.verification.privateKeyExported).toBe(false);
    expect(JSON.stringify(receipt.payload)).not.toContain('merchant-x');
    expect(receipt.payload.route.bestExecutionRationale.length).toBeGreaterThan(20);
    expect(receipt.payload.route.bestExecutionRationale).toContain('Best execution among');
    expect(receipt.payload.route.bestExecutionAttestationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.payloadCanonical).not.toContain(receipt.verification.vaultKeyName + '_private');

    const verified = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/receipts/verify`,
      payload: {
        payload: receipt.payload,
        signature: receipt.signature,
        publicKeyPem: receipt.verification.publicKeyPem,
      },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json<ApiEnvelope<ReceiptVerificationResult>>().data).toMatchObject({
      valid: true,
      fundsMoved: false,
    });

    const bytes = Buffer.from(receipt.signature, 'base64url');
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const tampered = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/receipts/verify`,
      payload: {
        payload: receipt.payload,
        signature: bytes.toString('base64url'),
        publicKeyPem: receipt.verification.publicKeyPem,
      },
    });
    expect(tampered.statusCode).toBe(200);
    expect(tampered.json<ApiEnvelope<ReceiptVerificationResult>>().data.valid).toBe(false);

    const foreign = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/executions/${id}/receipt`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('flags an intentional instruction-hash mismatch on GET /reconciliation/mismatches', async () => {
    const id = await settledExecution(harness);
    const stored = await harness.container.persistence.orchestratedExecutions.findById(
      id,
      DEMO_ORGANIZATION_ID,
    );
    expect(stored?.partnerInstructionId).toBeTruthy();
    const partner = await harness.container.persistence.partnerInstructions.findById(
      stored!.partnerInstructionId!,
      DEMO_ORGANIZATION_ID,
    );
    expect(partner).not.toBeNull();
    await harness.container.persistence.partnerInstructions.update({
      ...partner!,
      instructionHash: 'f'.repeat(64),
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/reconciliation/mismatches`,
      headers: { authorization: `Bearer ${demoToken}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<
      ApiEnvelope<{
        mismatches: readonly { readonly executionId: string; readonly kind: string; readonly fundsMoved: boolean }[];
        fundsMoved: boolean;
      }>
    >().data;
    expect(body.fundsMoved).toBe(false);
    expect(
      body.mismatches.some(
        (row) => row.executionId === id && row.kind === 'instruction_hash_mismatch' && row.fundsMoved === false,
      ),
    ).toBe(true);

    const foreign = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/reconciliation/mismatches`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(foreign.statusCode).toBe(200);
    const otherBody = foreign.json<
      ApiEnvelope<{ mismatches: readonly { readonly executionId: string }[] }>
    >().data;
    expect(otherBody.mismatches.some((row) => row.executionId === id)).toBe(false);
  });

  it('exports only this tenant audit trail to owner/admin and hides it from agents and the other tenant', async () => {
    await settledExecution(harness);
    const exported = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/audit/export`,
      headers: { authorization: `Bearer ${demoToken}` },
    });
    expect(exported.statusCode).toBe(200);
    const body = exported.json<
      ApiEnvelope<{
        organizationId: string;
        eventCount: number;
        events: readonly { readonly organizationId: string | null; readonly type: string }[];
        fundsMoved: boolean;
      }>
    >().data;
    expect(body.organizationId).toBe(DEMO_ORGANIZATION_ID);
    expect(body.fundsMoved).toBe(false);
    expect(body.eventCount).toBeGreaterThan(0);
    expect(body.events.every((event) => event.organizationId === DEMO_ORGANIZATION_ID)).toBe(true);
    expect(JSON.stringify(body)).not.toContain(OTHER_ORGANIZATION_ID);
    expect(body.events.some((event) => event.type === 'receipt.issued')).toBe(true);

    const asAgent = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/audit/export`,
      headers: AGENT,
    });
    expect(asAgent.statusCode).toBe(403);

    const asOther = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/audit/export`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(asOther.statusCode).toBe(200);
    const otherExport = asOther.json<
      ApiEnvelope<{ organizationId: string; events: readonly { readonly organizationId: string | null }[] }>
    >().data;
    expect(otherExport.organizationId).toBe(OTHER_ORGANIZATION_ID);
    expect(otherExport.events.every((event) => event.organizationId !== DEMO_ORGANIZATION_ID)).toBe(true);
  });
});
