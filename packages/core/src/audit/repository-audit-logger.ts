import type {
  AuditEvent,
  AuditEventInput,
  AuditLogRepository,
  AuditLogger,
  Clock,
  IdGenerator,
  Logger,
} from '../ports/index.js';

/**
 * Writes audit events to an append-only repository and mirrors them to the structured log.
 *
 * A failed audit write must never take down the request that triggered it — the event is reported
 * at error level and the operation continues. Losing an audit line is bad; losing the customer's
 * comparison because the audit table was briefly unavailable is worse, and the structured log
 * retains the event either way.
 */
export class RepositoryAuditLogger implements AuditLogger {
  constructor(
    private readonly deps: {
      readonly repository: AuditLogRepository;
      readonly clock: Clock;
      readonly ids: IdGenerator;
      readonly logger: Logger;
    },
  ) {}

  async record(input: AuditEventInput): Promise<AuditEvent> {
    const event: AuditEvent = {
      ...input,
      eventId: this.deps.ids.generate('evt'),
      occurredAt: this.deps.clock.nowIso(),
    };

    this.deps.logger.info('audit', {
      auditEvent: event.type,
      eventId: event.eventId,
      actor: event.actor,
      requestId: event.requestId,
      comparisonId: event.comparisonId,
      providerId: event.providerId,
      payload: event.payload,
    });

    try {
      await this.deps.repository.append(event);
    } catch (error) {
      this.deps.logger.error('Failed to persist audit event', {
        eventId: event.eventId,
        auditEvent: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return event;
  }
}
