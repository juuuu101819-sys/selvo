import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireOrganization } from '../http/require-organization.js';
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
 * Settlement reconciliation: dispatched instruction ↔ partner confirmation ↔ fee attribution.
 *
 * Fail-closed behind EXECUTION_ENABLED. Flags mismatches; never moves funds.
 */
export function registerReconciliationRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): ResponseEnvelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
      sandbox: true,
    },
  });

  app.get('/reconciliation/mismatches', async (request) => {
    const principal = requireOrganization(request);
    const mismatches = await container.reconciliation.listMismatches({
      organizationId: principal.organizationId,
      actor: principal.actor,
      requestId: request.id,
    });
    return envelope(request, { mismatches, fundsMoved: false, custody: false, sandbox: true as const });
  });
}
