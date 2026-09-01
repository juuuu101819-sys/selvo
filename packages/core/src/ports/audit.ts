import type { JsonObject } from '../domain/json.js';

/**
 * Financially meaningful events. Closed set: adding an event type is a deliberate decision so the
 * audit trail stays interpretable, and consumers can exhaustively switch on it.
 */
export const AUDIT_EVENT_TYPES = [
  'comparison.requested',
  'comparison.completed',
  'comparison.failed',
  'comparison.replayed',
  'routing.requested',
  'routing.completed',
  'routing.failed',
  'routing.replayed',
  'routing.graph.requested',
  'routing.graph.completed',
  'routing.graph.failed',
  'routing.stablecoin.requested',
  'routing.stablecoin.completed',
  'routing.stablecoin.failed',
  'routing.defi.requested',
  'routing.defi.completed',
  'routing.defi.failed',
  'provider.quote.received',
  'provider.quote.failed',
  'execution.rejected',
  'execution.intent.recorded',
  'execution.intent.rejected',
  'apikey.issued',
  'apikey.revoked',
  'agent.issued',
  'agent.revoked',
  'payment.intent.created',
  'payment.intent.quoted',
  'payment.intent.selected',
  'payment.intent.authorized',
  'payment.intent.simulated',
  'payment.intent.failed',
  'payment.intent.expired',
  'payment.policy.denied',
  'payment.policy.evaluated',
  'nl.intent.interpreted',
  'nl.route.completed',
  'monetization.recorded',
  'payment.policy.updated',
  'auth.login.failed',
  'auth.credential.failed',
  'auth.mfa.failed',
  'auth.mfa.enrolled',
  'auth.sso.failed',
  'onboarding.organization.created',
  'onboarding.invite.issued',
  'onboarding.invite.accepted',
  'onboarding.kyb.submitted',
  'onboarding.kyb.reviewed',
  'onboarding.pricing.configured',
  'billing.invoice.issued',
  'billing.revenue.recognized',
  'routing.override.engaged',
  'routing.override.released',
  'provider.credential.stored',
  'organization.execution_authorization.updated',
  'agent.execution_authorization.updated',
  'mandate.verified',
  'mandate.rejected',
  'mandate.revoked',
  'partner.dispatched',
  'partner.status_changed',
  'partner.failed',
  'execution.created',
  'execution.routed',
  'execution.compliance_passed',
  'execution.compliance_review',
  'execution.blocked',
  'execution.expired',
  'execution.dispatched',
  'execution.settling',
  'execution.settled',
  'execution.failed',
  'receipt.issued',
  'reconciliation.listed',
  'audit.exported',
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export interface AuditEvent {
  readonly eventId: string;
  readonly type: AuditEventType;
  /** ISO-8601 UTC, from the injected clock. */
  readonly occurredAt: string;
  /** Who or what triggered the event. `"system"` for platform-initiated work. */
  readonly actor: string;
  /** Correlates every event emitted while handling one request. */
  readonly requestId: string | null;
  /** The comparison the event belongs to, when applicable. */
  readonly comparisonId: string | null;
  readonly providerId: string | null;
  /** Tenant that owns the event, when the actor was authenticated. */
  readonly organizationId?: string | null;
  readonly payload: JsonObject;
}

export type AuditEventInput = Omit<AuditEvent, 'eventId' | 'occurredAt'>;

/**
 * Append-only audit sink. There is intentionally no update or delete operation: an audit record,
 * once written, is immutable.
 */
export interface AuditLogger {
  record(event: AuditEventInput): Promise<AuditEvent>;
}
