import { DEMO_AGENT_SECRET } from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from './index.js';
import { createTestHarness, type ApiError, type ApiEnvelope, type TestHarness } from '../testing/harness.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
  await provisionDemoTenants({
    identity: harness.container.persistence.identity,
    dashboard: harness.container.persistence.dashboard,
    agentPayments: harness.container.persistence.agentPayments,
  });
});

afterAll(async () => {
  await harness.close();
});

const CANONICAL =
  'Pay 1,000 USD to this merchant using the cheapest compliant route.';

function agentHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return { 'x-api-key': DEMO_AGENT_SECRET, ...overrides };
}

interface Interpretation {
  readonly amount: { readonly decimal: string; readonly minorUnits: string; readonly asset: string };
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly recipient: string;
  readonly optimizationPreference: string | null;
  readonly interpreter: string;
  readonly aiUsed: boolean;
  readonly financialsComputedBy: string | null;
  readonly didNotCompute: readonly string[];
}

interface RouteBody {
  readonly interpretation: Interpretation;
  readonly paymentIntent: {
    readonly id: string;
    readonly status: string;
    readonly routePreference: string | null;
    readonly fundsMoved: boolean;
  };
  readonly selectedRoute: { readonly routeId: string; readonly recommended: boolean } | null;
  readonly executionIntent: {
    readonly status: string;
    readonly executable: boolean;
    readonly submitted: boolean;
  };
  readonly pipelineCompleted: readonly string[];
  readonly financialsComputedBy: string;
  readonly fundsMoved: boolean;
  readonly realExecution: boolean;
}

describe('AI agent natural language routing', () => {
  it('interprets the canonical instruction without computing financials', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/agent/interpret`,
      headers: agentHeaders(),
      payload: { instruction: CANONICAL },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<ApiEnvelope<{ interpretation: Interpretation; aiUsed: boolean }>>().data;
    expect(body.aiUsed).toBe(false);
    expect(body.interpretation).toMatchObject({
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      recipient: 'merchant-x',
      optimizationPreference: 'LOWEST_COST',
      interpreter: 'deterministic_parser',
      aiUsed: false,
      financialsComputedBy: null,
      didNotCompute: ['exchange_rates', 'fees', 'slippage', 'settlement_amounts'],
    });
    expect(body.interpretation.amount.decimal).toBe('1000.00');
    expect(body.interpretation.amount.minorUnits).toBe('100000');
    expect(JSON.stringify(body.interpretation)).not.toMatch(/exchangeRate|settlementAmount|"fee"|slippageBps/);
  });

  it('routes language through policy and the engine, then records a non-executable intent', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/agent/route`,
      headers: agentHeaders({ 'idempotency-key': 'nl-route-1000-usd-cheapest' }),
      payload: { instruction: CANONICAL },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<ApiEnvelope<RouteBody>>().data;
    expect(body.interpretation.optimizationPreference).toBe('LOWEST_COST');
    expect(body.paymentIntent.status).toBe('ROUTED');
    expect(body.paymentIntent.routePreference).toBe('lowest_cost');
    expect(body.selectedRoute).not.toBeNull();
    expect(body.executionIntent.status).toBe('recorded');
    expect(body.executionIntent.executable).toBe(false);
    expect(body.executionIntent.submitted).toBe(false);
    expect(body.financialsComputedBy).toBe('routing_engine');
    expect(body.fundsMoved).toBe(false);
    expect(body.realExecution).toBe(false);
    expect(body.pipelineCompleted).toEqual([
      'natural_language',
      'intent_parser',
      'structured_payment_intent',
      'policy_engine',
      'routing_engine',
      'provider_quote',
      'route_selection',
      'execution_intent',
    ]);
  });

  it('denies a policy-breaking NL route without executing', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/agent/route`,
      headers: agentHeaders({ 'idempotency-key': 'nl-route-too-large' }),
      payload: { instruction: 'Pay 20,000 USD to this merchant using the cheapest route' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<ApiError>().error.code).toBe('POLICY_DENIED');
  });

  it('rejects an anonymous NL interpret', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/agent/interpret`,
      payload: { instruction: CANONICAL },
    });
    expect(response.statusCode).toBe(401);
  });

  it('leaves POST /executions as the audited 501', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      headers: agentHeaders(),
      payload: { instruction: CANONICAL },
    });
    expect(response.statusCode).toBe(501);
  });
});
