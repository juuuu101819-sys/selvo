import {
  buildMonetizationEvent,
  monetizationFromMultiRailRoute,
  monetizationFromQuotedAgentRoute,
  type AuditLogger,
  type DashboardRepository,
  type MonetizationEvent,
  type PaymentIntent,
  type ScoredMultiRailRoute,
} from '@meridian/core';

/**
 * Persist attributed (never settled) economics for a priced comparison, route quote, agent quote,
 * or execution intent. Failures surface: dropping a ledger event would make the dashboard lie.
 *
 * ROUTE_QUOTE ≠ ROUTE_SELECTED ≠ EXECUTION_INTENT ≠ SETTLEMENT ≠ REALIZED_REVENUE.
 * Nothing in this module writes realized revenue.
 */

export async function recordComparisonMonetization(input: {
  readonly comparisonId: string;
  readonly organizationId: string | null;
  readonly createdAt: string;
  readonly routingId: string;
  readonly route: ScoredMultiRailRoute | null;
  readonly dashboard: DashboardRepository;
  readonly auditLogger: AuditLogger;
  readonly actor: string;
  readonly requestId: string;
}): Promise<void> {
  if (input.organizationId === null || input.route === null) {
    return;
  }
  const event = monetizationFromMultiRailRoute({
    organizationId: input.organizationId,
    occurredAt: input.createdAt,
    routingId: input.routingId,
    route: input.route,
    economicStage: 'route_quote',
    eventId: `mon_cmp_${input.comparisonId}`,
    quoteId: input.comparisonId,
  });
  await persistMonetization(input.dashboard, input.auditLogger, event, {
    actor: input.actor,
    requestId: input.requestId,
    comparisonId: input.comparisonId,
  });
}

export async function recordRouteQuoteMonetization(input: {
  readonly organizationId: string | null;
  readonly routingId: string;
  readonly createdAt: string;
  readonly route: ScoredMultiRailRoute | null;
  readonly dashboard: DashboardRepository;
  readonly auditLogger: AuditLogger;
  readonly actor: string;
  readonly requestId: string;
}): Promise<void> {
  if (input.organizationId === null || input.route === null) {
    return;
  }
  const event = monetizationFromMultiRailRoute({
    organizationId: input.organizationId,
    occurredAt: input.createdAt,
    routingId: input.routingId,
    route: input.route,
    economicStage: 'route_quote',
    eventId: `mon_rte_${input.routingId}`,
    quoteId: input.routingId,
  });
  await persistMonetization(input.dashboard, input.auditLogger, event, {
    actor: input.actor,
    requestId: input.requestId,
    comparisonId: null,
  });
}

export async function recordExecutionIntentMonetization(input: {
  readonly organizationId: string;
  readonly intentId: string;
  readonly routeId: string;
  readonly createdAt: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly route: ScoredMultiRailRoute | null;
  readonly dashboard: DashboardRepository;
  readonly auditLogger: AuditLogger;
  readonly actor: string;
  readonly requestId: string;
}): Promise<void> {
  const event =
    input.route === null
      ? buildMonetizationEvent({
          id: `mon_eit_${input.intentId}`,
          organizationId: input.organizationId,
          occurredAt: input.createdAt,
          transactionType: 'multi_rail_quote',
          revenueSource: 'payment_routing_fee',
          rail: null,
          providerId: null,
          providerName: null,
          currency: input.sourceAsset,
          asset: input.sourceAsset,
          destinationAsset: input.destinationAsset,
          agentId: null,
          routeId: input.routeId,
          quoteId: input.intentId,
          economicStage: 'execution_intent',
          tpvMinorUnits: input.amountMinorUnits,
          providerCostMinorUnits: '0',
          platformRevenueMinorUnits: '0',
        })
      : monetizationFromMultiRailRoute({
          organizationId: input.organizationId,
          occurredAt: input.createdAt,
          routingId: input.intentId,
          route: input.route,
          economicStage: 'execution_intent',
          eventId: `mon_eit_${input.intentId}`,
          quoteId: input.intentId,
        });
  await persistMonetization(input.dashboard, input.auditLogger, event, {
    actor: input.actor,
    requestId: input.requestId,
    comparisonId: null,
  });
}

export async function recordAgentQuoteMonetization(input: {
  readonly intent: PaymentIntent;
  readonly dashboard: DashboardRepository;
  readonly auditLogger: AuditLogger;
  readonly actor: string;
  readonly requestId: string;
}): Promise<void> {
  const route =
    input.intent.quotedRoutes.find((candidate) => candidate.recommended) ??
    input.intent.quotedRoutes[0];
  if (route === undefined) {
    return;
  }

  const event = monetizationFromQuotedAgentRoute({
    paymentIntentId: input.intent.id,
    organizationId: input.intent.organizationId,
    occurredAt: input.intent.updatedAt,
    agentId: input.intent.agentId,
    sourceAsset: input.intent.sourceAsset,
    destinationAsset: input.intent.destinationAsset,
    amountMinorUnits: input.intent.amountMinorUnits,
    route,
  });
  await persistMonetization(input.dashboard, input.auditLogger, event, {
    actor: input.actor,
    requestId: input.requestId,
    comparisonId: null,
    extra: { paymentIntentId: input.intent.id, agentId: input.intent.agentId },
  });
}

async function persistMonetization(
  dashboard: DashboardRepository,
  auditLogger: AuditLogger,
  event: MonetizationEvent,
  meta: {
    readonly actor: string;
    readonly requestId: string;
    readonly comparisonId: string | null;
    readonly extra?: Record<string, string>;
  },
): Promise<void> {
  await dashboard.recordMonetizationEvent(event);
  await auditLogger.record({
    type: 'monetization.recorded',
    actor: meta.actor,
    requestId: meta.requestId,
    comparisonId: meta.comparisonId,
    providerId: event.providerId,
    payload: {
      eventId: event.id,
      eventType: event.economicStage === 'execution_intent' ? 'EXECUTION_INTENT' : 'ROUTE_QUOTE',
      economicStage: event.economicStage,
      realizedRevenue: false,
      routeId: event.routeId,
      quoteId: event.quoteId,
      revenueSource: event.revenueSource,
      tpvMinorUnits: event.tpvMinorUnits,
      platformRevenueMinorUnits: event.platformRevenueMinorUnits,
      partnerCommissionMinorUnits: event.partnerCommissionMinorUnits,
      grossProfitMinorUnits: event.grossProfitMinorUnits,
      fundsMoved: false,
      custody: false,
      realExecution: false,
      ...(meta.extra ?? {}),
    },
  });
}
