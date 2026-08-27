import {
  monetizationFromQuotedAgentRoute,
  monetizationFromRecommendedFiatRoute,
  type AuditLogger,
  type DashboardRepository,
  type PaymentIntent,
  type RouteComparison,
} from '@meridian/core';

/**
 * Persist attributed (never settled) platform revenue for a priced comparison or agent quote.
 *
 * Failures here surface: silently dropping a revenue event would make the dashboard lie.
 */

export async function recordComparisonMonetization(input: {
  readonly comparison: RouteComparison;
  readonly dashboard: DashboardRepository;
  readonly auditLogger: AuditLogger;
  readonly actor: string;
  readonly requestId: string;
}): Promise<void> {
  const organizationId = input.comparison.snapshot.organizationId;
  if (organizationId === null) {
    return;
  }
  const route =
    input.comparison.routes.find((candidate) => candidate.recommended) ??
    input.comparison.routes.find(
      (candidate) => candidate.routeId === input.comparison.recommendedRouteId,
    );
  if (route === undefined) {
    return;
  }

  const event = monetizationFromRecommendedFiatRoute({
    comparisonId: input.comparison.comparisonId,
    organizationId,
    occurredAt: input.comparison.createdAt,
    route,
    destinationAsset: input.comparison.request.targetCurrency,
  });
  await input.dashboard.recordMonetizationEvent(event);
  await input.auditLogger.record({
    type: 'monetization.recorded',
    actor: input.actor,
    requestId: input.requestId,
    comparisonId: input.comparison.comparisonId,
    providerId: event.providerId,
    payload: {
      eventId: event.id,
      revenueSource: event.revenueSource,
      tpvMinorUnits: event.tpvMinorUnits,
      platformRevenueMinorUnits: event.platformRevenueMinorUnits,
      partnerCommissionMinorUnits: event.partnerCommissionMinorUnits,
      grossProfitMinorUnits: event.grossProfitMinorUnits,
      fundsMoved: false,
      custody: false,
      realExecution: false,
    },
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
  await input.dashboard.recordMonetizationEvent(event);
  await input.auditLogger.record({
    type: 'monetization.recorded',
    actor: input.actor,
    requestId: input.requestId,
    comparisonId: null,
    providerId: event.providerId,
    payload: {
      eventId: event.id,
      paymentIntentId: input.intent.id,
      agentId: input.intent.agentId,
      revenueSource: event.revenueSource,
      tpvMinorUnits: event.tpvMinorUnits,
      platformRevenueMinorUnits: event.platformRevenueMinorUnits,
      partnerCommissionMinorUnits: event.partnerCommissionMinorUnits,
      grossProfitMinorUnits: event.grossProfitMinorUnits,
      fundsMoved: false,
      custody: false,
      realExecution: false,
    },
  });
}
