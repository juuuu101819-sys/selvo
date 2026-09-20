import { ValidationError } from '../errors/index.js';

/**
 * Organization API key and session scopes.
 *
 * A key is a credential for a machine caller acting *for* an organization. Scopes are the only
 * rights the key has. Session users receive the scopes of their membership role — never a default
 * "all scopes" set. Anonymous callers receive none.
 *
 * `transaction:create` records an execution *intent*. It does not submit a payment, swap, or
 * payout — `executeTransactions` stays false. It is issued on explicitly minted organization keys,
 * never on human sessions.
 *
 * `payment:*` scopes drive the AI-agent payment infrastructure (intent, quote, authorize,
 * sandbox simulate). They never grant real execution. They belong to `mag_` credentials.
 *
 * `mandate:verify` lets a mag_ credential submit a signed AP2/x402/MPP mandate.
 * `mandate:revoke` is a session capability for owner/admin. Neither moves funds.
 */
export const API_SCOPES = [
  'quote:read',
  'route:read',
  'transaction:create',
  'payment:create',
  'payment:quote',
  'payment:authorize',
  'agent_policy:write',
  'mandate:verify',
  'mandate:revoke',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const ORGANIZATION_SESSION_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type OrganizationSessionRole = (typeof ORGANIZATION_SESSION_ROLES)[number];

/** PA-H01 privileged roles. MFA org enforcement applies only to these. */
export const PRIVILEGED_ORGANIZATION_ROLES = ['owner', 'admin'] as const;
export type PrivilegedOrganizationRole = (typeof PRIVILEGED_ORGANIZATION_ROLES)[number];

export function isPrivilegedOrganizationRole(role: string): role is PrivilegedOrganizationRole {
  return role === 'owner' || role === 'admin';
}

const VIEWER_SESSION_SCOPES: readonly ApiScope[] = ['quote:read', 'route:read'];
const MEMBER_SESSION_SCOPES: readonly ApiScope[] = ['quote:read', 'route:read'];
const ADMIN_SESSION_SCOPES: readonly ApiScope[] = [
  'quote:read',
  'route:read',
  'agent_policy:write',
  'mandate:revoke',
];
const OWNER_SESSION_SCOPES: readonly ApiScope[] = [
  'quote:read',
  'route:read',
  'agent_policy:write',
  'mandate:revoke',
];

/**
 * Exact session scope set issued at login for each organization role.
 *
 * Never includes `payment:*` or `transaction:create`. Adding a scope here is a deliberate
 * privilege expansion and must fail `api-scope.test.ts`.
 */
export const SESSION_SCOPES_BY_ROLE: Readonly<Record<OrganizationSessionRole, readonly ApiScope[]>> =
  {
    viewer: VIEWER_SESSION_SCOPES,
    member: MEMBER_SESSION_SCOPES,
    admin: ADMIN_SESSION_SCOPES,
    owner: OWNER_SESSION_SCOPES,
  };

export function isOrganizationSessionRole(value: string): value is OrganizationSessionRole {
  return (ORGANIZATION_SESSION_ROLES as readonly string[]).includes(value);
}

export function sessionScopesForRole(role: string): readonly ApiScope[] {
  if (!isOrganizationSessionRole(role)) {
    return VIEWER_SESSION_SCOPES;
  }
  return SESSION_SCOPES_BY_ROLE[role];
}

/** Union of scopes a human session may ever hold. Not assigned as a blob. */
export const SESSION_API_SCOPES: readonly ApiScope[] = [
  'quote:read',
  'route:read',
  'agent_policy:write',
  'mandate:revoke',
];

/** Issued by default on organization API keys. Payment scopes belong to agent credentials. */
export const DEFAULT_API_KEY_SCOPES: readonly ApiScope[] = ['quote:read', 'route:read'];

/** Issued to AI-agent credentials. Includes `quote:read` so agents consume the routing engine. */
export const DEFAULT_AGENT_SCOPES: readonly ApiScope[] = [
  'quote:read',
  'payment:create',
  'payment:quote',
  'payment:authorize',
  'mandate:verify',
];

/** Organization API keys may only be minted with these scopes — never payment or policy rights. */
export const ORGANIZATION_API_KEY_SCOPES: readonly ApiScope[] = [
  'quote:read',
  'route:read',
  'transaction:create',
];

/**
 * Every scope a `mag_` agent credential may ever hold.
 *
 * Issuance stores exactly {@link DEFAULT_AGENT_SCOPES}; this is the wider set the storage-layer
 * CHECK constraint admits, so an operator-narrowed credential is still storable. It deliberately
 * excludes `agent_policy:write` and `mandate:revoke`: an agent must not be able to widen its own
 * policy or cancel the mandate authorizing it. Keep this in lockstep with
 * `agent_credentials_scopes_known` — `api-scope.test.ts` fails if they diverge.
 */
export const AGENT_CREDENTIAL_SCOPES: readonly ApiScope[] = [
  'quote:read',
  'route:read',
  'transaction:create',
  'payment:create',
  'payment:quote',
  'payment:authorize',
  'mandate:verify',
];

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === 'string' && (API_SCOPES as readonly string[]).includes(value);
}

/**
 * Hydrates scopes from a stored row. Unknown strings are skipped so a leftover value cannot
 * crash authentication. Do not use this on issuance — use {@link parseApiScopesStrict}.
 */
export function parseApiScopes(values: readonly string[]): readonly ApiScope[] {
  const unique: ApiScope[] = [];
  for (const value of values) {
    if (!isApiScope(value)) {
      continue;
    }
    if (!unique.includes(value)) {
      unique.push(value);
    }
  }
  return unique;
}

/**
 * Issuance parser. Unknown names are rejected rather than dropped (PA-M16).
 */
export function parseApiScopesStrict(values: readonly string[]): readonly ApiScope[] {
  const unknown = values.filter((value) => !isApiScope(value));
  if (unknown.length > 0) {
    throw new ValidationError('Unknown API scope.', { scopes: [...new Set(unknown)] });
  }
  return parseApiScopes(values);
}

export function principalHasCapability(
  scopes: readonly ApiScope[],
  capability: ApiScope,
): boolean {
  return scopes.includes(capability);
}
