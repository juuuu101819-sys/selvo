import {
  DEMO_AGENT_SECRET,
  DEMO_ORGANIZATION_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  USD_KRW_SCOPE,
  generateTestP256KeyPair,
  signedAp2VerifyBody,
  type MonetizationReportDto,
  type PublicMandate,
} from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from './index.js';
import { createTestHarness, type ApiEnvelope, type TestHarness } from '../testing/harness.js';

/**
 * Spec §18.2 / phase 8-A regression suite.
 *
 * The defect: `realizedRevenueMinorUnits` was summed from `economicStage === 'settled'`, and
 * sandbox orchestration writes that stage when a *mock* partner reports settlement. A sandbox run
 * therefore inflated a dashboard figure labelled "realized revenue". These tests drive the real
 * orchestration endpoint to SETTLED and assert the dashboard still reports zero realized revenue.
 */

const AGENT = { 'x-api-key': DEMO_AGENT_SECRET };
const ALLOWED_PROVIDERS = new Set(['sandbox-veridian-payments', 'sandbox-solstice-settlement']);

interface RoutingBody {
  readonly routingId: string;
  readonly routes: readonly { readonly routeId: string; readonly provider: { readonly id: string } }[];
}

interface ExecutionBody {
  readonly status: string;
  readonly monetizationEventId: string | null;
}

async function login(harness: TestHarness): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/auth/login`,
    payload: { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { token: string } }>().data.token;
}

async function revenueReport(harness: TestHarness, token: string): Promise<MonetizationReportDto> {
  const response = await harness.app.inject({
    method: 'GET',
    url: `${API_V1_PREFIX}/dashboard/revenue`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.statusCode).toBe(200);
  return response.json<ApiEnvelope<MonetizationReportDto>>().data;
}

describe('revenue lifecycle: a sandbox settlement never becomes realized revenue', () => {
  let harness: TestHarness;
  let token: string;

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
    token = await login(harness);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('reports zero realized revenue after a full sandbox orchestration reaches SETTLED', async () => {
    const before = await revenueReport(harness, token);
    expect(before.summary.realizedRevenueMinorUnits).toBe('0');

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
    const routing = quoted.json<ApiEnvelope<RoutingBody>>().data;
    const route = routing.routes.find((entry) => ALLOWED_PROVIDERS.has(entry.provider.id));
    expect(route).toBeDefined();

    const executed = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      headers: { ...AGENT, 'idempotency-key': 'rev-lifecycle-settle-01' },
      payload: {
        mandateId,
        routingId: routing.routingId,
        routeId: route!.routeId,
        beneficiaryRef: 'merchant-x',
      },
    });
    expect(executed.statusCode).toBe(201);
    const execution = executed.json<ApiEnvelope<ExecutionBody>>().data;

    // The mock partner did settle, and the monetization event was written.
    expect(execution.status).toBe('SETTLED');
    expect(execution.monetizationEventId).toBeTruthy();

    const after = await revenueReport(harness, token);

    // The settlement is visible in the ledger as attribution...
    const settled = after.events.filter((event) => event.economicStage === 'settled');
    expect(settled.length).toBeGreaterThan(0);
    expect(settled.every((event) => event.lifecycleState === 'ATTRIBUTED_REVENUE')).toBe(true);

    // ...but it is not cash, and no part of the report claims otherwise.
    expect(after.summary.realizedRevenueMinorUnits).toBe('0');
    expect(after.summary.collectedRevenueMinorUnits).toBe('0');
    expect(after.byLifecycleState.every((row) => row.key !== 'REALIZED_REVENUE')).toBe(true);
    expect(after.byLifecycleState.every((row) => row.realizedRevenueMinorUnits === '0')).toBe(true);
  });

  it('stamps the settled event as partner-sandbox origin with simulated finality', async () => {
    const report = await revenueReport(harness, token);
    const settled = report.events.filter((event) => event.economicStage === 'settled');
    expect(settled.length).toBeGreaterThan(0);
    for (const event of settled) {
      expect(event.originEnv).toBe('PARTNER_SANDBOX');
      expect(event.settlementFinality).toBe('simulated');
      expect(event.realizedRevenue).toBe(false);
      expect(event.lifecycleState).toBe('ATTRIBUTED_REVENUE');
    }
  });

  it('never reports a realized figure for any event in the ledger', async () => {
    const report = await revenueReport(harness, token);
    expect(report.events.length).toBeGreaterThan(0);
    for (const event of report.events) {
      expect(event.realizedRevenue).toBe(false);
      expect(event.lifecycleState).not.toBe('REALIZED_REVENUE');
    }
    // Every breakdown dimension carries its own cash figure, and all of them are zero.
    for (const rows of [
      report.byRail,
      report.byProvider,
      report.byCurrency,
      report.byRevenueSource,
      report.byOriginEnv,
      report.byLifecycleState,
    ]) {
      for (const row of rows) {
        expect(row.realizedRevenueMinorUnits).toBe('0');
      }
    }
  });

  it('caps a sandbox row that claims collected realization with non-zero revenue', async () => {
    // Written straight to the repository, bypassing the builder's realization guard, to stand in
    // for a row created by an older revision or edited out of band. The resolver on the read path
    // is the backstop, so a row that claims cash must still not be counted as cash.
    await harness.container.persistence.dashboard.recordMonetizationEvent({
      id: 'mon_forged_sandbox_realized',
      organizationId: DEMO_ORGANIZATION_ID,
      occurredAt: new Date().toISOString(),
      transactionType: 'multi_rail_quote',
      revenueSource: 'payment_routing_fee',
      rail: 'payment_institution',
      providerId: 'sandbox-veridian-payments',
      providerName: 'Veridian Payments',
      currency: 'USD',
      asset: 'USD',
      destinationAsset: 'KRW',
      agentId: null,
      tpvMinorUnits: '50000000',
      providerCostMinorUnits: '0',
      platformRevenueMinorUnits: '123456',
      partnerCommissionMinorUnits: '0',
      grossProfitMinorUnits: '123456',
      takeRateBps: '24.6912',
      fundsMoved: false,
      custody: false,
      realExecution: false,
      routeId: null,
      quoteId: null,
      economicStage: 'settled',
      realizedRevenue: true,
      revenueRecognition: 'collected',
      originEnv: 'PARTNER_SANDBOX',
      settlementFinality: 'provider_confirmed',
      collectionReference: 'forged_ref',
      lifecycleState: 'REALIZED_REVENUE',
      invoiceId: null,
    });

    const report = await revenueReport(harness, token);
    const forged = report.events.find((event) => event.id === 'mon_forged_sandbox_realized');
    expect(forged).toBeDefined();

    // Non-zero revenue, so a leak would show up rather than being masked by a zero platform fee.
    expect(forged!.platformRevenueMinorUnits).toBe('123456');
    expect(forged!.lifecycleState).toBe('ATTRIBUTED_REVENUE');
    expect(forged!.realizedRevenue).toBe(false);
    expect(report.summary.realizedRevenueMinorUnits).toBe('0');
    expect(BigInt(report.summary.simulatedOriginRevenueMinorUnits)).toBeGreaterThanOrEqual(123456n);
  });
});
