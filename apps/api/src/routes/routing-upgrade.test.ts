import {
  DEMO_AGENT_SECRET,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  generateTestP256KeyPair,
  signedAp2VerifyBody,
  USD_KRW_SCOPE,
  type PublicMandate,
  type RouteSimulation,
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

interface RouteRow {
  readonly routeId: string;
  readonly recommended: boolean;
  readonly provider: { readonly id: string };
  readonly totalCostBps: string;
  readonly slippageBps: string;
  readonly estimatedSettlementTime: { readonly p50Seconds: number };
  readonly bestExecution: { readonly rationale: string; readonly rationaleHash: string };
}

interface RoutingBody {
  readonly routingId: string;
  readonly routingEngineVersion: string;
  readonly routes: readonly RouteRow[];
  readonly recommendedRoute: RouteRow | null;
}

describe('routing engine 2.0 (health, objectives, simulate, attestation)', () => {
  let harness: TestHarness;

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
    const login = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/login`,
      payload: { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD },
    });
    expect(login.statusCode).toBe(201);
  });

  afterAll(async () => {
    harness.container.railHealth.clear();
    await harness.close();
  });

  it('changes rank when the recommended rail is marked degraded', async () => {
    const baseline = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes`,
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '100000.00' },
    });
    expect(baseline.statusCode).toBe(201);
    const first = baseline.json<ApiEnvelope<RoutingBody>>().data;
    expect(first.routingEngineVersion).toBe('2.0.0');
    const winner = first.recommendedRoute?.provider.id;
    expect(winner).toBeTruthy();

    harness.container.railHealth.setState(winner!, 'degraded');
    try {
      const degraded = await harness.app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/routes`,
        payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '100000.00' },
      });
      expect(degraded.statusCode).toBe(201);
      const second = degraded.json<ApiEnvelope<RoutingBody>>().data;
      expect(second.recommendedRoute?.provider.id).not.toBe(winner);
    } finally {
      harness.container.railHealth.clear();
    }
  });

  it('selects a different path when the caller changes objective weights', async () => {
    const costOnly = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes`,
      payload: {
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '100000.00',
        preferences: {
          weights: {
            cost: '1',
            speed: '0',
            finality: '0',
            fxRate: '0',
            slippage: '0',
            liquidity: '0',
            compliance: '0',
          },
        },
      },
    });
    const speedOnly = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes`,
      payload: {
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '100000.00',
        preferences: {
          weights: {
            cost: '0',
            speed: '1',
            finality: '0',
            fxRate: '0',
            slippage: '0',
            liquidity: '0',
            compliance: '0',
          },
        },
      },
    });
    expect(costOnly.statusCode).toBe(201);
    expect(speedOnly.statusCode).toBe(201);
    const cheap = costOnly.json<ApiEnvelope<RoutingBody>>().data;
    const fast = speedOnly.json<ApiEnvelope<RoutingBody>>().data;
    const cheapestId = [...cheap.routes].sort((a, b) =>
      a.totalCostBps.localeCompare(b.totalCostBps, 'en', { numeric: true }),
    )[0]?.routeId;
    const fastestId = [...fast.routes].sort(
      (a, b) => a.estimatedSettlementTime.p50Seconds - b.estimatedSettlementTime.p50Seconds,
    )[0]?.routeId;
    expect(cheap.recommendedRoute?.routeId).toBe(cheapestId);
    expect(fast.recommendedRoute?.routeId).toBe(fastestId);
    expect(cheap.recommendedRoute?.bestExecution.rationale).toContain('Best execution among');
  });

  it('returns identical distributions for two identical simulate requests', async () => {
    const payload = { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '500.00' };
    const first = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/simulate`,
      payload,
    });
    const second = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/simulate`,
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const a = first.json<ApiEnvelope<RouteSimulation>>().data;
    const b = second.json<ApiEnvelope<RouteSimulation>>().data;
    expect(a.fundsMoved).toBe(false);
    expect(a.livePartnerCalled).toBe(false);
    expect(a.allInCost).toEqual(b.allInCost);
    expect(a.slippage).toEqual(b.slippage);
    expect(a.settlement).toEqual(b.settlement);
    expect(a.bestExecution.rationaleHash).toBe(b.bestExecution.rationaleHash);
  });

  it('returns a deterministic simulation that matches sandbox execution within tolerance', async () => {
    const quoted = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes`,
      headers: AGENT,
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '500.00' },
    });
    expect(quoted.statusCode).toBe(201);
    const routing = quoted.json<ApiEnvelope<RoutingBody>>().data;
    const executable = routing.routes.find((route) =>
      ['sandbox-veridian-payments', 'sandbox-solstice-settlement'].includes(route.provider.id),
    );
    expect(executable).toBeDefined();

    const payload = {
      routingId: routing.routingId,
      routeId: executable!.routeId,
    };
    const first = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/simulate`,
      headers: AGENT,
      payload,
    });
    const second = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/simulate`,
      headers: AGENT,
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const a = first.json<ApiEnvelope<RouteSimulation>>().data;
    const b = second.json<ApiEnvelope<RouteSimulation>>().data;
    expect(a.fundsMoved).toBe(false);
    expect(a.livePartnerCalled).toBe(false);
    expect(a.executable).toBe(false);
    expect(a.routingEngineVersion).toBe('2.0.0');
    expect(b.allInCost).toEqual(a.allInCost);
    expect(b.slippage).toEqual(a.slippage);
    expect(b.settlement).toEqual(a.settlement);
    expect(b.bestExecution.rationaleHash).toBe(a.bestExecution.rationaleHash);
    expect(a.routeId).toBe(executable!.routeId);

    const keys = generateTestP256KeyPair();
    const mandate = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/mandates/verify`,
      headers: AGENT,
      payload: signedAp2VerifyBody(keys, { scope: USD_KRW_SCOPE }),
    });
    expect(mandate.statusCode).toBe(201);
    const mandateId = mandate.json<ApiEnvelope<PublicMandate>>().data.id;

    const executed = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      headers: AGENT,
      payload: {
        mandateId,
        routingId: routing.routingId,
        routeId: executable!.routeId,
        beneficiaryRef: 'merchant-x',
      },
    });
    expect(executed.statusCode).toBe(201);
    const execution = executed.json<ApiEnvelope<{ id: string; status: string }>>().data;
    expect(execution.status).toBe('SETTLED');

    const receipt = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/executions/${execution.id}/receipt`,
      headers: AGENT,
    });
    expect(receipt.statusCode).toBe(200);
    const issued = receipt.json<ApiEnvelope<VerifiableExecutionReceipt>>().data;
    const simulatedBps = Number(a.allInCost.expectedBps);
    const receiptBps = Number(issued.payload.route.totalCostBps);
    expect(Math.abs(simulatedBps - receiptBps)).toBeLessThanOrEqual(0.0001);
    expect(issued.payload.route.bestExecutionRationale).toContain('Best execution among');
    expect(issued.payload.route.bestExecutionAttestationHash).toBe(a.bestExecution.rationaleHash);
  });
});
