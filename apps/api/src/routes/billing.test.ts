import {
  DEMO_ORGANIZATION_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  OTHER_ORGANIZATION_ID,
  buildMonetizationEvent,
} from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from './index.js';
import { createTestHarness, type TestHarness } from '../testing/harness.js';

const OPERATOR = 'unit-test-billing-operator-secret-ok';
const OPERATOR_HEADER = { 'x-onboarding-operator-key': OPERATOR };
const PREVIOUS_OPERATOR_SECRET = process.env['ONBOARDING_OPERATOR_SECRET'];

describe('PHASE 32 — platform-fee invoicing', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    process.env['ONBOARDING_OPERATOR_SECRET'] = OPERATOR;
    harness = await createTestHarness({ ONBOARDING_OPERATOR_SECRET: OPERATOR });
    await provisionDemoTenants({
      identity: harness.container.persistence.identity,
      dashboard: harness.container.persistence.dashboard,
    });
    await harness.container.persistence.dashboard.recordMonetizationEvent(
      buildMonetizationEvent({
        id: 'mon_bill_intent',
        organizationId: DEMO_ORGANIZATION_ID,
        occurredAt: '2026-03-12T10:00:00.000Z',
        transactionType: 'multi_rail_quote',
        revenueSource: 'traditional_fx_routing_fee',
        rail: 'bank_fx',
        providerId: 'sandbox-northgate-bank',
        providerName: 'Northgate Bank',
        currency: 'USD',
        asset: 'USD',
        destinationAsset: 'KRW',
        agentId: null,
        economicStage: 'execution_intent',
        tpvMinorUnits: '10000000',
        providerCostMinorUnits: '30000',
        platformRevenueMinorUnits: '20000',
        partnerCommissionMinorUnits: '5000',
      }),
    );
    await harness.container.persistence.dashboard.recordMonetizationEvent(
      buildMonetizationEvent({
        id: 'mon_bill_quote',
        organizationId: DEMO_ORGANIZATION_ID,
        occurredAt: '2026-03-12T11:00:00.000Z',
        transactionType: 'multi_rail_quote',
        revenueSource: 'traditional_fx_routing_fee',
        rail: 'bank_fx',
        providerId: 'sandbox-northgate-bank',
        providerName: 'Northgate Bank',
        currency: 'USD',
        asset: 'USD',
        destinationAsset: 'KRW',
        agentId: null,
        economicStage: 'route_quote',
        tpvMinorUnits: '10000000',
        providerCostMinorUnits: '30000',
        platformRevenueMinorUnits: '20000',
      }),
    );
    await harness.container.persistence.dashboard.recordMonetizationEvent(
      buildMonetizationEvent({
        id: 'mon_bill_sub',
        organizationId: DEMO_ORGANIZATION_ID,
        occurredAt: '2026-03-20T00:00:00.000Z',
        transactionType: 'enterprise_subscription',
        revenueSource: 'enterprise_api_subscription',
        rail: null,
        providerId: null,
        providerName: null,
        currency: 'USD',
        asset: 'USD',
        destinationAsset: null,
        agentId: null,
        tpvMinorUnits: '0',
        providerCostMinorUnits: '0',
        platformRevenueMinorUnits: '200000',
        partnerCommissionMinorUnits: '0',
      }),
    );
    await harness.container.persistence.dashboard.recordMonetizationEvent(
      buildMonetizationEvent({
        id: 'mon_bill_other',
        organizationId: OTHER_ORGANIZATION_ID,
        occurredAt: '2026-03-18T00:00:00.000Z',
        transactionType: 'multi_rail_quote',
        revenueSource: 'payment_routing_fee',
        rail: 'payment_institution',
        providerId: 'sandbox-veridian-payments',
        providerName: 'Veridian Payments',
        currency: 'USD',
        asset: 'USD',
        destinationAsset: 'EUR',
        agentId: null,
        economicStage: 'execution_intent',
        tpvMinorUnits: '5000000',
        providerCostMinorUnits: '10000',
        platformRevenueMinorUnits: '8000',
      }),
    );
  });

  afterAll(async () => {
    await harness.close();
    if (PREVIOUS_OPERATOR_SECRET === undefined) {
      delete process.env['ONBOARDING_OPERATOR_SECRET'];
    } else {
      process.env['ONBOARDING_OPERATOR_SECRET'] = PREVIOUS_OPERATOR_SECRET;
    }
  });

  async function login(): Promise<string> {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/login`,
      payload: { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ data: { token: string } }>().data.token;
  }

  it('rejects billing runs without the operator secret', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/invoices/run`,
      payload: { periodStart: '2026-03-01T00:00:00.000Z' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('issues invoices from snapshots, traces line items, and is idempotent', async () => {
    const first = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/invoices/run`,
      headers: OPERATOR_HEADER,
      payload: { periodStart: '2026-03-01T00:00:00.000Z' },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json<{
      data: {
        createdInvoiceIds: string[];
        reusedInvoiceIds: string[];
        invoices: readonly {
          id: string;
          organizationId: string;
          totalMinorUnits: string;
          taxMinorUnits: string;
          collectionStatus: string;
          realizedRevenue: boolean;
          collected: boolean;
          lines: readonly { monetizationEventId: string; platformRevenueMinorUnits: string }[];
        }[];
      };
    }>().data;
    expect(firstBody.createdInvoiceIds).toHaveLength(2);
    expect(firstBody.reusedInvoiceIds).toHaveLength(0);
    const demoInvoice = firstBody.invoices.find(
      (invoice) => invoice.organizationId === DEMO_ORGANIZATION_ID,
    );
    expect(demoInvoice).toBeDefined();
    if (demoInvoice === undefined) {
      throw new Error('expected demo invoice');
    }
    expect(demoInvoice.lines.map((line) => line.monetizationEventId).sort()).toEqual([
      'mon_bill_intent',
      'mon_bill_sub',
    ]);
    expect(demoInvoice.totalMinorUnits).toBe('220000');
    expect(demoInvoice.taxMinorUnits).toBe('0');
    expect(demoInvoice.collectionStatus).toBe('uncollected');
    expect(demoInvoice.realizedRevenue).toBe(false);
    expect(demoInvoice.collected).toBe(false);
    expect(demoInvoice.lines.some((line) => line.monetizationEventId === 'mon_bill_quote')).toBe(
      false,
    );

    const second = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/invoices/run`,
      headers: OPERATOR_HEADER,
      payload: { periodStart: '2026-03-01T00:00:00.000Z' },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json<{
      data: { createdInvoiceIds: string[]; reusedInvoiceIds: string[]; invoices: unknown[] };
    }>().data;
    expect(secondBody.createdInvoiceIds).toHaveLength(0);
    expect(secondBody.reusedInvoiceIds.sort()).toEqual(firstBody.createdInvoiceIds.sort());
    expect(secondBody.invoices).toHaveLength(2);

    const token = await login();
    const listed = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/invoices`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listed.statusCode).toBe(200);
    const listedBody = listed.json<{
      data: { invoices: readonly { id: string; organizationId: string }[]; collectionStatus: string };
    }>().data;
    expect(listedBody.collectionStatus).toBe('deferred');
    expect(listedBody.invoices).toHaveLength(1);
    expect(listedBody.invoices[0]?.organizationId).toBe(DEMO_ORGANIZATION_ID);

    const detail = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/invoices/${demoInvoice.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(
      detail.json<{ data: { lines: readonly { monetizationEventId: string }[] } }>().data.lines,
    ).toHaveLength(2);

    const revenue = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/revenue`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(revenue.statusCode).toBe(200);
    const revenueBody = revenue.json<{
      data: {
        summary: {
          realizedRevenueMinorUnits: string;
          invoicedRevenueMinorUnits: string;
          collectedRevenueMinorUnits: string;
        };
        events: readonly {
          id: string;
          realizedRevenue: boolean;
          revenueRecognition: string;
          invoiceId: string | null;
        }[];
      };
    }>().data;
    expect(revenueBody.summary.realizedRevenueMinorUnits).toBe('0');
    expect(revenueBody.summary.collectedRevenueMinorUnits).toBe('0');
    expect(BigInt(revenueBody.summary.invoicedRevenueMinorUnits)).toBeGreaterThanOrEqual(220000n);
    const billed = revenueBody.events.filter((event) =>
      ['mon_bill_intent', 'mon_bill_sub'].includes(event.id),
    );
    expect(billed.every((event) => event.realizedRevenue === false)).toBe(true);
    expect(billed.every((event) => event.revenueRecognition === 'invoiced')).toBe(true);
    expect(billed.every((event) => event.invoiceId === demoInvoice.id)).toBe(true);
    const quote = revenueBody.events.find((event) => event.id === 'mon_bill_quote');
    expect(quote?.revenueRecognition).toBe('unrealized');
    expect(quote?.realizedRevenue).toBe(false);

    const recon = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/ops/billing/reconciliation?periodStart=2026-03-01T00:00:00.000Z`,
      headers: OPERATOR_HEADER,
    });
    expect(recon.statusCode).toBe(200);
    const reconBody = recon.json<{
      data: {
        collectionStatus: string;
        billedSnapshotIds: string[];
        byCurrency: readonly {
          currency: string;
          invoicedPlatformRevenueMinorUnits: string;
          collectedPlatformRevenueMinorUnits: string;
          duplicateBilledSnapshotIds: string[];
        }[];
      };
    }>().data;
    expect(reconBody.collectionStatus).toBe('deferred');
    expect(reconBody.billedSnapshotIds.sort()).toEqual([
      'mon_bill_intent',
      'mon_bill_other',
      'mon_bill_sub',
    ]);
    const usd = reconBody.byCurrency.find((row) => row.currency === 'USD');
    expect(usd?.invoicedPlatformRevenueMinorUnits).toBe('228000');
    expect(usd?.collectedPlatformRevenueMinorUnits).toBe('0');
    expect(usd?.duplicateBilledSnapshotIds).toEqual([]);

    const executions = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      payload: { routeId: 'route_1' },
    });
    expect(executions.statusCode).toBe(501);

    const audits = await harness.auditEvents();
    expect(audits.some((event) => event.type === 'billing.invoice.issued')).toBe(true);
    expect(audits.some((event) => event.type === 'billing.revenue.recognized')).toBe(true);
    expect(JSON.stringify(audits)).not.toMatch(/card|iban|accountNumber|cvv/i);
  });
});
