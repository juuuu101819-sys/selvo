import {
  BILLING_LIVE_SCOPE_KEY,
  DEMO_ORGANIZATION_ID,
  requiredChecklistRef,
  type LiveEnablementRecord,
} from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from './index.js';
import { createTestHarness, type ApiEnvelope, type ApiError, type TestHarness } from '../testing/harness.js';

const OPERATOR = 'unit-test-billing-wire-operator-secret';
const OPERATOR_HEADER = { 'x-onboarding-operator-key': OPERATOR };
const PERIOD_START = '2026-03-01T00:00:00.000Z';

function billingDetermination(): LiveEnablementRecord {
  return {
    id: 'lve_billing_wire',
    scope: 'billing',
    scopeKey: BILLING_LIVE_SCOPE_KEY,
    region: 'US',
    enabled: true,
    signOff: {
      approvedBy: 'counsel@selvo.example',
      licenseBasis: 'Entity, tax handling, and wire collection confirmed — determination 2026-03',
      approvedAt: '2026-03-01T00:00:00.000Z',
      expiresAt: '2027-03-01T00:00:00.000Z',
      checklistRef: requiredChecklistRef('billing', BILLING_LIVE_SCOPE_KEY),
    },
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    disabledAt: null,
    disabledReason: null,
  };
}

describe('wire manual collection ops route', () => {
  let harness: TestHarness;
  let invoiceId: string;

  beforeAll(async () => {
    process.env['ONBOARDING_OPERATOR_SECRET'] = OPERATOR;
    harness = await createTestHarness({
      ONBOARDING_OPERATOR_SECRET: OPERATOR,
      BILLING_LIVE_ENABLED: 'true',
      BILLING_LEGAL_OPINION_ID: 'OPN-BILLING-WIRE-TEST',
      BILLING_JURISDICTION: 'US',
      WIRE_MANUAL_COLLECTION_ENABLED: 'true',
    });
    await provisionDemoTenants({
      identity: harness.container.persistence.identity,
      dashboard: harness.container.persistence.dashboard,
    });
    await harness.container.persistence.liveEnablement.upsert(billingDetermination());

    await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/subscriptions`,
      headers: OPERATOR_HEADER,
      payload: {
        organizationId: DEMO_ORGANIZATION_ID,
        tier: 'starter',
        startedAt: PERIOD_START,
      },
    });

    const run = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/invoices/run`,
      headers: OPERATOR_HEADER,
      payload: { periodStart: PERIOD_START, organizationId: DEMO_ORGANIZATION_ID },
    });
    expect(run.statusCode).toBe(200);
    const invoices = run.json<ApiEnvelope<{ readonly invoices: readonly { readonly id: string }[] }>>()
      .data.invoices;
    invoiceId = invoices[0]!.id;
  });

  afterAll(async () => {
    await harness.close();
  });

  it('confirms wire payment for one invoice without opening bulk collection', async () => {
    const confirm = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/invoices/${invoiceId}/confirm-wire`,
      headers: OPERATOR_HEADER,
      payload: { wireReference: 'wire:treasury-20260405-demo' },
    });
    expect(confirm.statusCode).toBe(200);
    const body = confirm.json<
      ApiEnvelope<{
        readonly collected: boolean;
        readonly fundsMoved: boolean;
        readonly customerSettlementFundsMoved: boolean;
        readonly attempt: { readonly confirmationSource: string; readonly processorReference: string };
      }>
    >().data;
    expect(body.collected).toBe(true);
    expect(body.fundsMoved).toBe(false);
    expect(body.customerSettlementFundsMoved).toBe(false);
    expect(body.attempt.confirmationSource).toBe('operator_manual');
    expect(body.attempt.processorReference).toBe('wire:treasury-20260405-demo');

    const bulk = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/collect`,
      headers: OPERATOR_HEADER,
      payload: {},
    });
    expect(bulk.statusCode).toBe(403);
  });

  it('rejects IBAN-shaped wire references at the API boundary', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/invoices/${invoiceId}/confirm-wire`,
      headers: OPERATOR_HEADER,
      payload: { wireReference: 'wire:GB82WEST12345698765432' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('does not enable execution when wire collection is configured', async () => {
    expect(harness.config.executionEnabled).toBe(false);
    const execution = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      payload: {},
    });
    expect(execution.statusCode).toBe(501);
  });
});

describe('wire confirmation fail-closed in RECORD_ONLY mode', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    process.env['ONBOARDING_OPERATOR_SECRET'] = OPERATOR;
    harness = await createTestHarness({
      ONBOARDING_OPERATOR_SECRET: OPERATOR,
      BILLING_LIVE_ENABLED: 'false',
      WIRE_MANUAL_COLLECTION_ENABLED: 'true',
    });
    await provisionDemoTenants({
      identity: harness.container.persistence.identity,
      dashboard: harness.container.persistence.dashboard,
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('refuses confirm-wire when live billing is disabled', async () => {
    await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/subscriptions`,
      headers: OPERATOR_HEADER,
      payload: {
        organizationId: DEMO_ORGANIZATION_ID,
        tier: 'starter',
        startedAt: PERIOD_START,
      },
    });

    const run = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/invoices/run`,
      headers: OPERATOR_HEADER,
      payload: { periodStart: PERIOD_START, organizationId: DEMO_ORGANIZATION_ID },
    });
    expect(run.statusCode).toBe(200);
    const invoiceId = run.json<ApiEnvelope<{ readonly invoices: readonly { readonly id: string }[] }>>()
      .data.invoices[0]!.id;

    const confirm = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/invoices/${invoiceId}/confirm-wire`,
      headers: OPERATOR_HEADER,
      payload: { wireReference: 'wire:treasury-blocked' },
    });
    expect(confirm.statusCode).toBe(403);
    const error = confirm.json<ApiError>().error.details;
    expect(error['collected']).toBe(false);
  });
});
