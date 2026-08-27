import {
  ForbiddenError,
  UnauthenticatedError,
  type ApiScope,
  type Principal,
} from '@meridian/core';
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

/**
 * Same tenant check, plus the named API scope.
 *
 * Session users receive every scope. Organization API keys receive only the scopes stored on the
 * key. Anonymous callers have none.
 */
export function requireScope(
  request: FastifyRequest,
  scope: ApiScope,
): Principal & { organizationId: string } {
  const principal = requireOrganization(request);
  if (!principal.scopes.includes(scope)) {
    throw new ForbiddenError('This credential does not include the required scope.', {
      requiredScope: scope,
    });
  }
  return principal;
}

/**
 * Optional `organizationId` on a body is a claim, never the source of truth.
 *
 * Missing claim: ignored. Present claim without a verified org: 401. Present claim that does not
 * match the principal: 403.
 */
export function assertClaimedOrganization(
  request: FastifyRequest,
  claimed: string | undefined,
): void {
  if (claimed === undefined) {
    return;
  }
  const principal = principalOf(request);
  if (!principal.verified || principal.organizationId === null) {
    throw new UnauthenticatedError(
      'Sign in or present an API key before claiming an organization.',
      { scheme: 'session+api_key', enforcing: true },
    );
  }
  if (claimed !== principal.organizationId) {
    throw new ForbiddenError('organizationId does not match the authenticated organization.', {});
  }
}

/** Owner or admin session only. Service keys cannot mint or revoke organization API keys. */
export function requireKeyManager(
  request: FastifyRequest,
): Principal & { organizationId: string } {
  const principal = requireOrganization(request);
  const role = principal.roles[0];
  if (principal.kind !== 'user' || (role !== 'owner' && role !== 'admin')) {
    throw new ForbiddenError('Only an organization owner or admin can manage API keys.', {
      requiredRoles: ['owner', 'admin'],
    });
  }
  return principal;
}
