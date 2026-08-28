import { PAYMENT_INTENT_STATUSES, type PaymentIntentStatus, type RoutePreference } from './agent-payments.js';

/**
 * Organization-scoped AI-agent financial dashboard.
 *
 * Quoted and simulated activity only. The platform never custodies an agent wallet, holds a key,
 * or moves funds. `fundsMoved` is always false.
 */

export interface AgentPolicyViolation {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly agentId: string;
  readonly rule: string;
  readonly message: string;
  readonly paymentIntentId: string | null;
}

export interface PreferredRouteRow {
  readonly providerId: string;
  readonly providerName: string;
  readonly rail: string;
  readonly intentCount: number;
}

export interface AgentSpendingSnapshot {
  readonly asset: string;
  readonly exponent: number;
  readonly dailyLimitMinorUnits: string;
  readonly dailySpentMinorUnits: string;
  readonly dailyRemainingMinorUnits: string;
  readonly maxTransactionMinorUnits: string;
  readonly preferredRoutePreference: RoutePreference | null;
}

export interface AgentDashboardSummary {
  readonly agentId: string;
  readonly name: string;
  readonly status: string;
  readonly createdAt: string;
  readonly transactionCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly quotedCount: number;
  readonly policyViolationCount: number;
  readonly paymentVolumeMinorUnits: string;
  readonly currency: string;
  readonly exponent: number;
  readonly averageFeeBps: string | null;
  readonly routeSuccessRatePercent: string | null;
  readonly preferredRoute: PreferredRouteRow | null;
  readonly dailySpentMinorUnits: string;
  readonly dailyLimitMinorUnits: string | null;
  readonly fundsMoved: false;
  readonly custody: false;
}

export interface AgentDashboardDetail {
  readonly summary: AgentDashboardSummary;
  readonly spending: AgentSpendingSnapshot | null;
  readonly preferredRoutes: readonly PreferredRouteRow[];
  readonly violations: readonly AgentPolicyViolation[];
  readonly fundsMoved: false;
  readonly custody: false;
  readonly walletsGenerated: false;
  readonly privateKeysHeld: false;
}

export const AGENT_DASHBOARD_VOLUME_STATUSES: readonly PaymentIntentStatus[] = PAYMENT_INTENT_STATUSES;
