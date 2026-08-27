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
  'nl.intent.interpreted',
  'nl.route.completed',
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
