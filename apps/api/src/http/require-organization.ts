import { UnauthenticatedError, type Principal } from '@meridian/core';
import type { FastifyRequest } from 'fastify';
import { principalOf } from './authentication.js';

/**
 * The tenant for a dashboard request.
 *
 * Taken from the verified principal, never from the URL or body. A caller cannot ask to see
 * another organization's quotes by putting that id in the path.
 */
export function requireOrganization(
  request: FastifyRequest,
): Principal & { organizationId: string } {
  const principal = principalOf(request);
  if (!principal.verified || principal.organizationId === null) {
    throw new UnauthenticatedError('Sign in to access the organization dashboard.', {
      scheme: 'session+api_key',
      enforcing: true,
    });
  }
  return principal as Principal & { organizationId: string };
}
