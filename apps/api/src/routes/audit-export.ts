import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requirePrivilegedSession } from '../http/require-organization.js';
import { auditExportQuerySchema, parseOrThrow } from '../http/validation.js';
import type { AppContainer } from '../container.js';

interface ResponseEnvelope<TData> {
  readonly data: TData;
  readonly meta: {
    readonly mode: string;
    readonly disclaimer: string;
    readonly requestId: string;
    readonly sandbox: true;
  };
}

/**
 * Tenant-scoped audit trail export for owner/admin sessions.
 *
 * Filters in the query by principal.organizationId. Another tenant's events are never selected.
 */
export function registerAuditExportRoute(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): ResponseEnvelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
      sandbox: true,
    },
  });

  app.get('/audit/export', async (request) => {
    const principal = requirePrivilegedSession(request, 'export the audit trail');
    const query = parseOrThrow(auditExportQuerySchema, request.query, 'query');
    const limit = query.limit ?? 500;
    const events = await container.persistence.auditLog.listByOrganization(principal.organizationId, {
      limit,
    });
    const filtered = events.filter((event) => {
      if (event.organizationId !== principal.organizationId) {
        return false;
      }
      if (query.from !== undefined && event.occurredAt < query.from) {
        return false;
      }
      if (query.to !== undefined && event.occurredAt > query.to) {
        return false;
      }
      return true;
    });
    await container.auditLogger.record({
      type: 'audit.exported',
      actor: principal.actor,
      requestId: request.id,
      comparisonId: null,
      providerId: null,
      organizationId: principal.organizationId,
      payload: {
        eventCount: filtered.length,
        fundsMoved: false,
        custody: false,
        sandbox: true,
      },
    });
    return envelope(request, {
      organizationId: principal.organizationId,
      exportedAt: container.clock.nowIso(),
      eventCount: filtered.length,
      events: filtered.map((event) => ({
        eventId: event.eventId,
        type: event.type,
        occurredAt: event.occurredAt,
        actor: event.actor,
        requestId: event.requestId,
        comparisonId: event.comparisonId,
        providerId: event.providerId,
        organizationId: event.organizationId ?? principal.organizationId,
        payload: event.payload,
      })),
      fundsMoved: false,
      custody: false,
      sandbox: true as const,
    });
  });
}
