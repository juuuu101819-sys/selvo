import { ExecutionNotImplementedError } from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContainer } from '../container.js';

/**
 * The execution boundary.
 *
 * This endpoint exists specifically so the platform's refusal to move money is visible in the API
 * surface, audited when someone attempts it, and covered by a test. An absent route would answer
 * 404 and explain nothing; this answers 501 with the reason. Nothing here initiates a payment, and
 * there is no code path in the repository that could.
 *
 * See docs/COMPLIANCE.md for what must exist before this is ever implemented.
 */
export function registerExecutionRoutes(app: FastifyInstance, container: AppContainer): void {
  app.post('/v1/executions', async (request) => {
    const actor = resolveActor(request);

    // An attempt to execute is a financially meaningful event even when it is refused: it is
    // exactly the kind of thing an auditor or a regulator would ask to see.
    await container.auditLogger.record({
      type: 'execution.rejected',
      actor,
      requestId: request.id,
      comparisonId: null,
      providerId: null,
      payload: {
        reason: 'platform is non-custodial and does not execute transactions',
        mode: container.config.mode,
      },
    });

    request.log.warn({ actor }, 'Execution attempt rejected: the platform is non-custodial');
    throw new ExecutionNotImplementedError();
  });
}

function resolveActor(request: FastifyRequest): string {
  const header = request.headers['x-meridian-actor'];
  const value = Array.isArray(header) ? header[0] : header;
  return value === undefined || value.trim() === '' ? 'anonymous' : value.trim().slice(0, 128);
}
