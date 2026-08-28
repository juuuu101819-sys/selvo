import {
  DEMO_ORGANIZATION_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  hashSecret,
  priceMonetization,
} from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from './index.js';
import {
  createTestHarness,
  type ApiEnvelope,
  type TestHarness,
} from '../testing/harness.js';

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

interface RoutePayload {
  readonly routingId: string;
  readonly monetization: {
    readonly eventType: string;
    readonly stage: string;
    readonly realizedRevenue: boolean;
    readonly fundsMoved: boolean;
    readonly tpvMinorUnits: string;
    readonly providerCostMinorUnits: string;
    readonly platformFeeMinorUnits: string;
    readonly partnerCommissionMinorUnits: string;
    readonly grossMarginMinorUnits: string;
    readonly takeRateBps: string | null;
    readonly routeId: string;
  } | null;
  readonly recommendedRoute: { readonly routeId: string } | null;
}

interface RevenuePayload {
  readonly summary: {
    readonly realizedRevenueMinorUnits: string;
    readonly platformRevenueMinorUnits: string;
    readonly tpvMinorUnits: string;
  };
  readonly events: readonly {
    readonly id: string;
    readonly economicStage: string;
    readonly realizedRevenue: boolean;
    readonly fundsMoved: boolean;
  }[];
}

async function login(): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/auth/login`,
    payload: { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { token: string } }>().data.token;
}

describe('PA-H08 — /routes monetization is quoted, not realized', () => {
  it('returns deterministic monetization metadata on the recommended route (B, F)', async () => {
    const first = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes`,
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '100000.00' },
    });
    const second = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes`,
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '100000.00' },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const a = first.json<ApiEnvelope<RoutePayload>>().data;
    const b = second.json<ApiEnvelope<RoutePayload>>().data;
    expect(a.monetization).not.toBeNull();
    expect(a.monetization?.eventType).toBe('ROUTE_QUOTE');
    expect(a.monetization?.stage).toBe('route_quote');
    expect(a.monetization?.realizedRevenue).toBe(false);
    expect(a.monetization?.fundsMoved).toBe(false);
    expect(a.monetization?.tpvMinorUnits).toBe('10000000');
    expect(a.monetization?.takeRateBps === null || /^\d+(\.\d+)?$/.test(a.monetization.takeRateBps)).toBe(
      true,
    );
    expect(a.monetization).toMatchObject({
      tpvMinorUnits: b.monetization?.tpvMinorUnits,
      providerCostMinorUnits: b.monetization?.providerCostMinorUnits,
      platformFeeMinorUnits: b.monetization?.platformFeeMinorUnits,
      partnerCommissionMinorUnits: b.monetization?.partnerCommissionMinorUnits,
      grossMarginMinorUnits: b.monetization?.grossMarginMinorUnits,
      takeRateBps: b.monetization?.takeRateBps,
    });
    const partner = BigInt(a.monetization?.partnerCommissionMinorUnits ?? '0');
    const platform = BigInt(a.monetization?.platformFeeMinorUnits ?? '0');
    const margin = BigInt(a.monetization?.grossMarginMinorUnits ?? '0');
    expect(platform - partner).toBe(margin);

    const expected = priceMonetization({
      tpvMinorUnits: a.monetization?.tpvMinorUnits ?? '0',
      providerCostMinorUnits: a.monetization?.providerCostMinorUnits ?? '0',
      platformRevenueMinorUnits: a.monetization?.platformFeeMinorUnits ?? '0',
      partnerCommissionMinorUnits: a.monetization?.partnerCommissionMinorUnits ?? '0',
    });
    expect(a.monetization?.grossMarginMinorUnits).toBe(expected.grossProfitMinorUnits);
    expect(a.monetization?.takeRateBps).toBe(expected.takeRateBps);
    expect(a.monetization?.tpvMinorUnits).toBe(expected.tpvMinorUnits);
  });

  it('does not create realized revenue on route discovery, even when repeated (A, E, G)', async () => {
    const token = await login();
    const before = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/revenue`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json<ApiEnvelope<RevenuePayload>>().data;
    expect(beforeBody.summary.realizedRevenueMinorUnits).toBe('0');
    expect(beforeBody.events.every((event) => event.realizedRevenue === false)).toBe(true);

    await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '100000.00' },
    });
    await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '100000.00' },
    });

    const after = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/revenue`,
      headers: { authorization: `Bearer ${token}` },
    });
    const afterBody = after.json<ApiEnvelope<RevenuePayload>>().data;
    expect(afterBody.summary.realizedRevenueMinorUnits).toBe('0');
    expect(afterBody.events.every((event) => event.realizedRevenue === false)).toBe(true);
    expect(afterBody.events.every((event) => event.economicStage !== 'settled')).toBe(true);
    const routeQuotes = afterBody.events.filter((event) => event.economicStage === 'route_quote');
    expect(routeQuotes.length).toBeGreaterThanOrEqual(2);
  });

  it('has no route-selection HTTP surface, so no ROUTE_SELECTED snapshot is created (C)', async () => {
    const token = await login();
    const select = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes/sandbox-solstice-settlement:stablecoin_settlement/select`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(select.statusCode).toBeGreaterThanOrEqual(400);
    const revenue = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/revenue`,
      headers: { authorization: `Bearer ${token}` },
    });
    const events = revenue.json<ApiEnvelope<RevenuePayload>>().data.events;
    expect(events.every((event) => event.economicStage !== 'route_selected')).toBe(true);
  });

  it('does not treat an execution intent as realized revenue (D, E)', async () => {
    const secret = 'mk_txcreatekey123_h08intent';
    await harness.container.persistence.identity.createApiKey({
      id: 'key_tx_h08',
      organizationId: DEMO_ORGANIZATION_ID,
      keyPrefix: secret.slice(0, 16),
      secretHash: hashSecret(secret),
      label: 'h08',
      createdAt: harness.clock.nowIso(),
      scopes: ['transaction:create'],
      expiresAt: null,
    });

    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/execution-intents`,
      headers: { authorization: `Bearer ${secret}` },
      payload: {
        requestId: 'req_quote_demo',
        routeId: 'rte_veridian_usd_krw',
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '500.00',
        paymentIntentId: 'pay_demo_completed_500',
      },
    });
    expect(created.statusCode).toBe(201);

    const token = await login();
    const revenue = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/revenue`,
      headers: { authorization: `Bearer ${token}` },
    });
    const body = revenue.json<ApiEnvelope<RevenuePayload>>().data;
    expect(body.summary.realizedRevenueMinorUnits).toBe('0');
    const intentEvents = body.events.filter((event) => event.economicStage === 'execution_intent');
    expect(intentEvents.length).toBeGreaterThanOrEqual(1);
    expect(intentEvents.every((event) => event.realizedRevenue === false)).toBe(true);
    expect(intentEvents.every((event) => event.fundsMoved === false)).toBe(true);
  });
});
