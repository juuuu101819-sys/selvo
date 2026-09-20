import {
  DEMO_ORGANIZATION_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  buildMonetizationEvent,
  hashSecret,
  type BillableEventClass,
  type MonetizationReportDto,
} from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { meteredActionFor } from '../http/usage-metering.js';
import { API_V1_PREFIX } from './index.js';
import { createTestHarness, type ApiEnvelope, type TestHarness } from '../testing/harness.js';

/**
 * Spec §18.1 / §18.5 / §18.6 — the launch monetization state, end to end.
 *
 * What "shipped billing" means with `BILLING_LIVE_ENABLED=false`: subscription, metered usage and
 * per-decision fees all compute and produce a **recorded** invoice, and nothing is collected. The
 * assertions below are deliberately about the customer-visible artefacts — the usage page, the
 * invoice lines, the revenue summary — because those are what would be wrong if a charge leaked.
 */

const OPERATOR = 'unit-test-launch-billing-operator-secret';
const OPERATOR_HEADER = { 'x-onboarding-operator-key': OPERATOR };
const PREVIOUS_OPERATOR_SECRET = process.env['ONBOARDING_OPERATOR_SECRET'];
const PERIOD_START = '2026-03-01T00:00:00.000Z';

interface UsagePayload {
  readonly rollup: {
    readonly totalCalls: string;
    readonly periodStart: string;
    readonly byEndpoint: readonly { readonly endpoint: string; readonly callCount: string }[];
  };
  readonly tier: string;
  readonly tierLabel: string;
  readonly includedCalls: string;
  readonly billableCalls: string;
  readonly overageMinorUnits: string;
  readonly eventClass: BillableEventClass;
  readonly collectionMode: string;
  readonly collected: boolean;
  readonly pricesAreProvisional: boolean;
}

interface InvoiceLinePayload {
  readonly monetizationEventId: string | null;
  readonly eventClass: BillableEventClass;
  readonly description: string;
  readonly quantity: string;
  readonly platformRevenueMinorUnits: string;
}

interface InvoicePayload {
  readonly id: string;
  readonly organizationId: string;
  readonly collectionStatus: string;
  readonly collectionMode: string;
  readonly collectionReference: string | null;
  readonly collected: boolean;
  readonly realizedRevenue: boolean;
  readonly totalMinorUnits: string;
  readonly lines: readonly InvoiceLinePayload[];
}

describe('launch billing: metered usage, subscription, and per-decision fees', () => {
  let harness: TestHarness;
  let token: string;

  beforeAll(async () => {
    process.env['ONBOARDING_OPERATOR_SECRET'] = OPERATOR;
    harness = await createTestHarness({
      ONBOARDING_OPERATOR_SECRET: OPERATOR,
      EXECUTION_ENABLED: 'true',
      MANDATE_INGESTION_ENABLED: 'true',
    });
    await provisionDemoTenants({
      identity: harness.container.persistence.identity,
      dashboard: harness.container.persistence.dashboard,
      agentPayments: harness.container.persistence.agentPayments,
      auditLog: harness.container.persistence.auditLog,
    });
    const login = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/login`,
      payload: { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD },
    });
    expect(login.statusCode).toBe(201);
    token = login.json<{ data: { token: string } }>().data.token;

    // A decision made against the in-memory driver earns nothing: there are no customers and
    // therefore no negotiated pricing rule, and the platform charges zero rather than inventing a
    // default take rate. This snapshot stands in for a decision by an organization that does have
    // a rule, so the invoice below carries a FLAT_DECISION line to assert against.
    await harness.container.persistence.dashboard.recordMonetizationEvent(
      buildMonetizationEvent({
        id: 'mon_launch_decision',
        organizationId: DEMO_ORGANIZATION_ID,
        occurredAt: '2026-03-04T10:00:00.000Z',
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
        originEnv: 'SIMULATION',
        tpvMinorUnits: '10000000',
        providerCostMinorUnits: '30000',
        platformRevenueMinorUnits: '250',
        partnerCommissionMinorUnits: '0',
        gainShareActive: false,
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

  async function usage(): Promise<UsagePayload> {
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/usage?periodStart=${PERIOD_START}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    return response.json<ApiEnvelope<UsagePayload>>().data;
  }

  async function revenue(): Promise<MonetizationReportDto> {
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/revenue`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    return response.json<ApiEnvelope<MonetizationReportDto>>().data;
  }

  async function quote(): Promise<void> {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/comparisons`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceCurrency: 'USD', targetCurrency: 'KRW', amount: '1000.00' },
    });
    expect(response.statusCode).toBe(201);
  }

  it('maps only the routes someone priced, not every endpoint', () => {
    expect(meteredActionFor('POST', '/api/v1/comparisons')).toBe('quote.read');
    expect(meteredActionFor('POST', '/api/v1/routes')).toBe('route.search');
    expect(meteredActionFor('GET', '/api/v1/reconciliation/mismatches')).toBe(
      'reconciliation.report',
    );
    // Unpriced surfaces are unbilled, which is the direction that cannot surprise a customer.
    expect(meteredActionFor('GET', '/api/v1/dashboard/revenue')).toBeNull();
    expect(meteredActionFor('POST', '/api/v1/executions')).toBeNull();
    expect(meteredActionFor('GET', undefined)).toBeNull();
  });

  it('counts an authenticated metered call against the caller’s organization', async () => {
    const before = await usage();
    await quote();
    await quote();
    const after = await usage();

    expect(BigInt(after.rollup.totalCalls) - BigInt(before.rollup.totalCalls)).toBe(2n);
    expect(after.rollup.byEndpoint.some((row) => row.endpoint === 'quote')).toBe(true);
    expect(after.rollup.periodStart).toBe(PERIOD_START);
  });

  it('does not count an anonymous call, which has no organization to bill', async () => {
    const before = await usage();
    const anonymous = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/comparisons`,
      payload: { sourceCurrency: 'USD', targetCurrency: 'KRW', amount: '1000.00' },
    });
    expect(anonymous.statusCode).toBe(201);
    expect((await usage()).rollup.totalCalls).toBe(before.rollup.totalCalls);
  });

  it('does not count a rejected call', async () => {
    const before = await usage();
    const rejected = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/comparisons`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceCurrency: 'USD', amount: 'not-a-number' },
    });
    expect(rejected.statusCode).toBeGreaterThanOrEqual(400);
    expect((await usage()).rollup.totalCalls).toBe(before.rollup.totalCalls);
  });

  it('reports usage as provisional and uncollected', async () => {
    const snapshot = await usage();
    expect(snapshot.tier).toBe('free');
    expect(snapshot.tierLabel).toBe('Free');
    expect(snapshot.eventClass).toBe('METERED_CALL');
    expect(snapshot.collectionMode).toBe('RECORD_ONLY');
    expect(snapshot.collected).toBe(false);
    expect(snapshot.pricesAreProvisional).toBe(true);
  });

  it('bills an execution-intent decision as a decision, never also as a call', async () => {
    // §18.6's one real overlap risk. Generating an intent is an API call, so if it were metered
    // the same act would carry both a per-call charge and a per-decision fee.
    const secret = 'mk_launchbilling01_decisions';
    await harness.container.persistence.identity.createApiKey({
      id: 'key_launch_billing_tx',
      organizationId: DEMO_ORGANIZATION_ID,
      keyPrefix: secret.slice(0, 16),
      secretHash: hashSecret(secret),
      label: 'launch billing decisions',
      createdAt: harness.clock.nowIso(),
      scopes: ['transaction:create'],
      expiresAt: null,
    });

    const before = await usage();
    const recorded = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/execution-intents`,
      headers: { 'x-api-key': secret },
      payload: {
        requestId: 'req_launch_billing_decision',
        routeId: 'rte_veridian_usd_krw',
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '500.00',
        paymentIntentId: 'pay_demo_completed_500',
      },
    });
    expect(recorded.statusCode).toBe(201);

    // The decision produced a snapshot at the decision stage and no usage counter.
    expect((await usage()).rollup.totalCalls).toBe(before.rollup.totalCalls);
    const report = await revenue();
    expect(report.events.some((event) => event.economicStage === 'execution_intent')).toBe(true);
  });

  it('assigns a subscription tier without charging for it', async () => {
    const assigned = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/subscriptions`,
      headers: OPERATOR_HEADER,
      payload: {
        organizationId: DEMO_ORGANIZATION_ID,
        tier: 'starter',
        startedAt: PERIOD_START,
        flatDecisionFeeMinorUnits: '25',
      },
    });
    expect(assigned.statusCode).toBe(200);
    const body = assigned.json<
      ApiEnvelope<{
        readonly subscription: { readonly tier: string; readonly currency: string };
        readonly tierDefinition: { readonly monthlyBaseMinorUnits: string };
        readonly collectionMode: string;
        readonly pricesAreProvisional: boolean;
      }>
    >().data;
    expect(body.subscription.tier).toBe('starter');
    expect(body.subscription.currency).toBe('USD');
    expect(body.tierDefinition.monthlyBaseMinorUnits).toBe('9900');
    expect(body.collectionMode).toBe('RECORD_ONLY');
    expect(body.pricesAreProvisional).toBe(true);

    const snapshot = await usage();
    expect(snapshot.tier).toBe('starter');
    expect(snapshot.includedCalls).toBe('10000');
    // Well inside the quota, so the metered overage is zero rather than absent.
    expect(snapshot.billableCalls).toBe('0');
    expect(snapshot.overageMinorUnits).toBe('0');
  });

  it('rejects a flat decision fee expressed as a rate', async () => {
    // §18.2: the configured value is a constant in minor units. A percentage smuggled in here is
    // how a "flat fee" starts scaling with transaction size.
    for (const value of ['0.25', '25%', '25bps', '-25']) {
      const response = await harness.app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/ops/billing/subscriptions`,
        headers: OPERATOR_HEADER,
        payload: {
          organizationId: DEMO_ORGANIZATION_ID,
          tier: 'starter',
          flatDecisionFeeMinorUnits: value,
        },
      });
      expect(response.statusCode, value).toBe(400);
    }
  });

  it('refuses subscription assignment without the operator secret', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/subscriptions`,
      payload: { organizationId: DEMO_ORGANIZATION_ID, tier: 'pro' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('issues one recorded invoice carrying each charge class at most once', async () => {
    const run = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/invoices/run`,
      headers: OPERATOR_HEADER,
      payload: { periodStart: PERIOD_START, organizationId: DEMO_ORGANIZATION_ID },
    });
    expect(run.statusCode).toBe(200);
    const invoices = run.json<ApiEnvelope<{ readonly invoices: readonly InvoicePayload[] }>>().data
      .invoices;
    const invoice = invoices.find((row) => row.organizationId === DEMO_ORGANIZATION_ID);
    expect(invoice).toBeDefined();

    const classes = invoice!.lines.map((line) => line.eventClass);
    expect(classes).toContain('SUBSCRIPTION_PERIOD');
    expect(classes).toContain('FLAT_DECISION');
    expect(classes.filter((eventClass) => eventClass === 'SUBSCRIPTION_PERIOD')).toHaveLength(1);
    expect(classes.filter((eventClass) => eventClass === 'METERED_CALL').length).toBeLessThan(2);

    // Only per-decision lines point at a snapshot; the period lines bill a period.
    for (const line of invoice!.lines) {
      if (line.eventClass === 'FLAT_DECISION') {
        expect(line.monetizationEventId).not.toBeNull();
      } else {
        expect(line.monetizationEventId).toBeNull();
      }
      expect(line.description.length).toBeGreaterThan(0);
    }

    // A subscription base of 9900 is present, and the total is the sum of the lines.
    const subscriptionLine = invoice!.lines.find(
      (line) => line.eventClass === 'SUBSCRIPTION_PERIOD',
    );
    expect(subscriptionLine?.platformRevenueMinorUnits).toBe('9900');
    expect(subscriptionLine?.quantity).toBe('1');
    const summed = invoice!.lines.reduce(
      (total, line) => total + BigInt(line.platformRevenueMinorUnits),
      0n,
    );
    expect(invoice!.totalMinorUnits).toBe(summed.toString());

    expect(invoice!.collectionStatus).toBe('uncollected');
    expect(invoice!.collectionMode).toBe('RECORD_ONLY');
    expect(invoice!.collected).toBe(false);
    expect(invoice!.realizedRevenue).toBe(false);
  });

  it('records a collection attempt without collecting, and replays a retry', async () => {
    const listed = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/invoices`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listed.statusCode).toBe(200);
    const page = listed.json<{
      data: { invoices: readonly InvoicePayload[]; collectionStatus: string };
    }>().data;
    expect(page.collectionStatus).toBe('deferred');
    const invoiceId = page.invoices[0]?.id;
    expect(invoiceId).toBeDefined();

    const first = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/invoices/${invoiceId!}/collect`,
      headers: OPERATOR_HEADER,
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json<
      ApiEnvelope<{
        readonly mode: string;
        readonly collected: boolean;
        readonly replayed: boolean;
        readonly fundsMoved: boolean;
        readonly attempt: { readonly id: string; readonly status: string };
        readonly gate: { readonly collectionActive: boolean; readonly blockingReasons: string[] };
      }>
    >().data;
    expect(firstBody.mode).toBe('RECORD_ONLY');
    expect(firstBody.collected).toBe(false);
    expect(firstBody.fundsMoved).toBe(false);
    expect(firstBody.attempt.status).toBe('recorded');
    expect(firstBody.gate.collectionActive).toBe(false);
    expect(firstBody.gate.blockingReasons).toContain('BILLING_LIVE_ENABLED=false');

    const second = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/invoices/${invoiceId!}/collect`,
      headers: OPERATOR_HEADER,
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json<
      ApiEnvelope<{ readonly replayed: boolean; readonly attempt: { readonly id: string } }>
    >().data;
    expect(secondBody.replayed).toBe(true);
    expect(secondBody.attempt.id).toBe(firstBody.attempt.id);

    const detail = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/invoices/${invoiceId!}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detail.json<ApiEnvelope<InvoicePayload>>().data.collectionStatus).toBe('uncollected');
  });

  it('reports the collection gate and its checklist reference to operators', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/ops/billing/collection`,
      headers: OPERATOR_HEADER,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<
      ApiEnvelope<{
        readonly mode: string;
        readonly billingLiveEnabled: boolean;
        readonly checklistRef: string;
        readonly gate: {
          readonly collectionActive: boolean;
          readonly adapterImplemented: boolean;
          readonly legalEntityConfirmed: boolean;
          readonly blockingReasons: readonly string[];
        };
      }>
    >().data;
    expect(body.mode).toBe('RECORD_ONLY');
    expect(body.billingLiveEnabled).toBe(false);
    expect(body.checklistRef).toBe('GO_LIVE_CHECKLIST.md#billing-collection');
    expect(body.gate.collectionActive).toBe(false);
    expect(body.gate.adapterImplemented).toBe(false);
    expect(body.gate.legalEntityConfirmed).toBe(false);
  });

  it('keeps realized revenue at zero after the whole billing cycle', async () => {
    const report = await revenue();
    expect(report.summary.realizedRevenueMinorUnits).toBe('0');
    expect(report.summary.collectedRevenueMinorUnits).toBe('0');
    expect(report.events.every((event) => event.realizedRevenue === false)).toBe(true);
    expect(report.events.every((event) => event.lifecycleState !== 'REALIZED_REVENUE')).toBe(true);
  });

  it('excludes the gated shapes from customer-facing revenue reporting', async () => {
    const report = await revenue();
    expect(report.gainShareActive).toBe(false);
    expect(report.summary.partnerCommissionMinorUnits).toBe('0');
    expect(report.byRevenueSource.every((row) => row.key !== 'partner_referral_commission')).toBe(
      true,
    );
    expect(report.events.every((event) => event.partnerCommissionMinorUnits === '0')).toBe(true);
  });

  it('reconciles the period without claiming anything was collected', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/ops/billing/reconciliation?periodStart=${PERIOD_START}`,
      headers: OPERATOR_HEADER,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<
      ApiEnvelope<{
        readonly collectionStatus: string;
        readonly byCurrency: readonly {
          readonly currency: string;
          readonly collectedPlatformRevenueMinorUnits: string;
          readonly duplicateBilledSnapshotIds: readonly string[];
        }[];
      }>
    >().data;
    expect(body.collectionStatus).toBe('deferred');
    for (const row of body.byCurrency) {
      expect(row.collectedPlatformRevenueMinorUnits).toBe('0');
      expect(row.duplicateBilledSnapshotIds).toEqual([]);
    }
  });

  it('leaves no payment credential anywhere in the audit trail', async () => {
    const events = await harness.auditEvents();
    expect(events.some((event) => event.type === 'billing.subscription.assigned')).toBe(true);
    expect(events.some((event) => event.type === 'billing.collection.recorded')).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/card|cvv|iban|accountNumber|routingNumber/i);
  });
});
