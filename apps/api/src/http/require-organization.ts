import {
  ForbiddenError,
  UnauthenticatedError,
  principalHasCapability,
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
 * Same tenant check, plus the named capability/scope.
 *
 * Session users receive the scopes of their membership role at issuance. Organization API keys
 * receive only the scopes stored on the key. Agent credentials receive `payment:*`. Anonymous
 * callers have none. This is the enforcement point for every protected mutation.
 */
export function requireCapability(
  request: FastifyRequest,
  capability: ApiScope,
): Principal & { organizationId: string } {
  const principal = requireOrganization(request);
  if (!principalHasCapability(principal.scopes, capability)) {
    throw new ForbiddenError('This credential does not include the required capability.', {
      requiredCapability: capability,
    });
  }
  return principal;
}

/** @see requireCapability */
export function requireScope(
  request: FastifyRequest,
  scope: ApiScope,
): Principal & { organizationId: string } {
  return requireCapability(request, scope);
}

/**
 * Fastify preHandler: reject before the route body runs when the capability is missing.
 *
 * Handlers still call {@link requireCapability} (or {@link requireScope}) to read the principal.
 */
export function capabilityPreHandler(capability: ApiScope) {
  return async (request: FastifyRequest): Promise<void> => {
    requireCapability(request, capability);
  };
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
