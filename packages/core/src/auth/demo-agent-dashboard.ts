import {
  DEMO_AGENT_ID,
  DEMO_MERCHANT_CODE,
  DEMO_ORGANIZATION_ID,
  OTHER_ORGANIZATION_ID,
} from './demo-tenant.js';
import { paymentIntentFingerprint, type PaymentIntent, type QuotedRouteOption } from '../domain/agent-payments.js';
import { SANDBOX_SIMULATION_RECEIPT } from '../engine/sandbox-simulator.js';

const OTHER_AGENT_ID = 'agt_other_secret';

function quoted(overrides: Partial<QuotedRouteOption> = {}): QuotedRouteOption {
  return {
    routeId: 'rte_veridian_usd_krw',
    rank: 1,
    recommended: true,
    providerId: 'sandbox-veridian-payments',
    providerName: 'Veridian Payments',
    rail: 'payment_institution',
    totalCostBps: '48.0000',
    expiresAt: '2026-08-27T18:00:00.000Z',
    routeScore: '82',
    slippageBps: '5',
    liquidityHeadroom: '4',
    chainId: null,
    jurisdictions: ['*'],
    platformFeeMinorUnits: '100',
    providerFeeMinorUnits: '400',
    ...overrides,
  };
}

function intent(input: {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly amountMinorUnits: string;
  readonly status: PaymentIntent['status'];
  readonly createdAt: string;
  readonly routePreference: PaymentIntent['routePreference'];
  readonly routes: readonly QuotedRouteOption[];
  readonly selectedRouteId: string | null;
  readonly failureReason: string | null;
  readonly authorizedAt: string | null;
  readonly simulatedAt: string | null;
}): PaymentIntent {
  const fingerprint = paymentIntentFingerprint({
    agentId: input.agentId,
    sourceAsset: 'USD',
    destinationAsset: 'KRW',
    amountMinorUnits: input.amountMinorUnits,
    recipient: DEMO_MERCHANT_CODE,
    purpose: 'invoice',
    routePreference: input.routePreference,
    maxFeeBps: '500',
    expiresAt: null,
  });
  return {
    id: input.id,
    organizationId: input.organizationId,
    agentId: input.agentId,
    sourceAsset: 'USD',
    destinationAsset: 'KRW',
    amountMinorUnits: input.amountMinorUnits,
    recipient: DEMO_MERCHANT_CODE,
    purpose: 'invoice',
    routePreference: input.routePreference,
    maxFeeBps: '500',
    expiresAt: '2026-12-31T00:00:00.000Z',
    status: input.status,
    idempotencyKey: input.id,
    payloadFingerprint: fingerprint,
    quotedRoutes: input.routes,
    quoteExpiresAt: input.routes.length === 0 ? null : '2026-12-31T00:00:00.000Z',
    selectedRouteId: input.selectedRouteId,
    authorizedAt: input.authorizedAt,
    simulatedAt: input.simulatedAt,
    simulation:
      input.simulatedAt === null
        ? null
        : {
            simulationId: `sim_${input.id}`,
            simulated: true,
            fundsMoved: false,
            custody: false,
            realExecution: false,
            providerId: input.routes[0]?.providerId ?? 'sandbox-veridian-payments',
            occurredAt: input.simulatedAt,
            receipt: SANDBOX_SIMULATION_RECEIPT,
          },
    failureReason: input.failureReason,
    fundsMoved: false,
    custody: false,
    realExecution: false,
    actor: 'provision',
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

/**
 * Sandbox payment history for the demo treasury agent.
 *
 * Totals: $4,250 TPV across five intents, three completed simulations, one policy denial.
 * Funds never moved.
 */
export function demoAgentPaymentIntents(nowIso: string): readonly PaymentIntent[] {
  const today = `${nowIso.slice(0, 10)}T09:00:00.000Z`;
  const earlier = new Date(Date.parse(nowIso) - 2 * 86_400_000).toISOString();

  const veridian = quoted();
  const solstice = quoted({
    routeId: 'rte_solstice_usd_krw',
    providerId: 'sandbox-solstice-settlement',
    providerName: 'Solstice Settlement',
    rail: 'stablecoin_settlement',
    totalCostBps: '34.0000',
    platformFeeMinorUnits: '80',
    providerFeeMinorUnits: '200',
  });

  return [
    intent({
      id: 'pay_demo_completed_500',
      organizationId: DEMO_ORGANIZATION_ID,
      agentId: DEMO_AGENT_ID,
      amountMinorUnits: '50000',
      status: 'COMPLETED',
      createdAt: today,
      routePreference: 'lowest_cost',
      routes: [veridian],
      selectedRouteId: veridian.routeId,
      failureReason: null,
      authorizedAt: today,
      simulatedAt: today,
    }),
    intent({
      id: 'pay_demo_completed_1000_fx',
      organizationId: DEMO_ORGANIZATION_ID,
      agentId: DEMO_AGENT_ID,
      amountMinorUnits: '100000',
      status: 'COMPLETED',
      createdAt: earlier,
      routePreference: 'lowest_cost',
      routes: [veridian],
      selectedRouteId: veridian.routeId,
      failureReason: null,
      authorizedAt: earlier,
      simulatedAt: earlier,
    }),
    intent({
      id: 'pay_demo_completed_1000_stable',
      organizationId: DEMO_ORGANIZATION_ID,
      agentId: DEMO_AGENT_ID,
      amountMinorUnits: '100000',
      status: 'COMPLETED',
      createdAt: earlier,
      routePreference: 'fastest',
      routes: [solstice],
      selectedRouteId: solstice.routeId,
      failureReason: null,
      authorizedAt: earlier,
      simulatedAt: earlier,
    }),
    intent({
      id: 'pay_demo_failed_policy',
      organizationId: DEMO_ORGANIZATION_ID,
      agentId: DEMO_AGENT_ID,
      amountMinorUnits: '150000',
      status: 'FAILED',
      createdAt: today,
      routePreference: 'lowest_cost',
      routes: [],
      selectedRouteId: null,
      failureReason: 'Amount exceeds the agent policy maximum transaction amount.',
      authorizedAt: null,
      simulatedAt: null,
    }),
    intent({
      id: 'pay_demo_quoted_open',
      organizationId: DEMO_ORGANIZATION_ID,
      agentId: DEMO_AGENT_ID,
      amountMinorUnits: '25000',
      status: 'QUOTED',
      createdAt: today,
      routePreference: 'lowest_cost',
      routes: [quoted({ totalCostBps: '40.0000' })],
      selectedRouteId: null,
      failureReason: null,
      authorizedAt: null,
      simulatedAt: null,
    }),
    intent({
      id: 'pay_other_secret',
      organizationId: OTHER_ORGANIZATION_ID,
      agentId: OTHER_AGENT_ID,
      amountMinorUnits: '99999900',
      status: 'COMPLETED',
      createdAt: today,
      routePreference: 'lowest_cost',
      routes: [veridian],
      selectedRouteId: veridian.routeId,
      failureReason: null,
      authorizedAt: today,
      simulatedAt: today,
    }),
  ];
}

export function demoAgentPolicyViolations(nowIso: string): readonly {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly rule: string;
  readonly message: string;
  readonly paymentIntentId: string | null;
}[] {
  return [
    {
      eventId: 'evt_demo_policy_max_amount',
      occurredAt: `${nowIso.slice(0, 10)}T09:05:00.000Z`,
      organizationId: DEMO_ORGANIZATION_ID,
      agentId: DEMO_AGENT_ID,
      rule: 'maximum_transaction_amount',
      message: 'Amount exceeds the agent policy maximum transaction amount.',
      paymentIntentId: 'pay_demo_failed_policy',
    },
    {
      eventId: 'evt_other_policy_secret',
      occurredAt: `${nowIso.slice(0, 10)}T09:05:00.000Z`,
      organizationId: OTHER_ORGANIZATION_ID,
      agentId: OTHER_AGENT_ID,
      rule: 'allowed_assets',
      message: 'Source asset "EUR" is not allowed by policy.',
      paymentIntentId: null,
    },
  ];
}

export { OTHER_AGENT_ID as DEMO_OTHER_AGENT_ID };
