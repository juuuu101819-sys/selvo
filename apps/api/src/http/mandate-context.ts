import {
  UnauthenticatedError,
  filterRoutingByMandate,
  type MandateScope,
  type MultiRailRouting,
  type Principal,
} from '@meridian/core';
import type { FastifyRequest } from 'fastify';
import { principalOf } from './authentication.js';
import type { AppContainer } from '../container.js';

/**
 * Optional mandateId on quote/routing/comparison. Fail-closed: anonymous callers cannot attach
 * a mandate (would skip org binding). Wrong-tenant ids 404 via MandateService.requireAttached.
 */
export async function applyOptionalMandateToRouting(
  container: AppContainer,
  request: FastifyRequest,
  mandateId: string | undefined,
  routing: MultiRailRouting,
): Promise<{ readonly routing: MultiRailRouting; readonly mandateScope: MandateScope | null }> {
  if (mandateId === undefined) {
    return { routing, mandateScope: null };
  }
  const principal = principalOf(request);
  if (!principal.verified || principal.organizationId === null) {
    throw new UnauthenticatedError('A mandate context requires a verified organization principal.', {
      failClosed: true,
    });
  }
  const row = await container.mandates.requireAttached({
    mandateId,
    organizationId: principal.organizationId,
    agentId: principal.kind === 'agent' ? principal.subjectId : null,
  });
  return {
    routing: filterRoutingByMandate(routing, row.scope),
    mandateScope: row.scope,
  };
}

export function principalCredentialPrefix(principal: Principal): string | null {
  if (principal.kind !== 'agent') {
    return null;
  }
  const actor = principal.actor;
  return actor.startsWith('agent:') ? actor.slice('agent:'.length) : null;
}
