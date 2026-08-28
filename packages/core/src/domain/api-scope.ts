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
 * `agent_policy:write` is a session capability for owner/admin. It is never stored on API keys.
 */
export const API_SCOPES = [
  'quote:read',
  'route:read',
  'transaction:create',
  'payment:create',
  'payment:quote',
  'payment:authorize',
  'agent_policy:write',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const ORGANIZATION_SESSION_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type OrganizationSessionRole = (typeof ORGANIZATION_SESSION_ROLES)[number];

const VIEWER_SESSION_SCOPES: readonly ApiScope[] = ['quote:read', 'route:read'];
const MEMBER_SESSION_SCOPES: readonly ApiScope[] = ['quote:read', 'route:read'];
const ADMIN_SESSION_SCOPES: readonly ApiScope[] = [
  'quote:read',
  'route:read',
  'agent_policy:write',
];
const OWNER_SESSION_SCOPES: readonly ApiScope[] = [
  'quote:read',
  'route:read',
  'agent_policy:write',
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
];

/** Issued by default on organization API keys. Payment scopes belong to agent credentials. */
export const DEFAULT_API_KEY_SCOPES: readonly ApiScope[] = ['quote:read', 'route:read'];

/** Issued to AI-agent credentials. Includes `quote:read` so agents consume the routing engine. */
export const DEFAULT_AGENT_SCOPES: readonly ApiScope[] = [
  'quote:read',
  'payment:create',
  'payment:quote',
  'payment:authorize',
];

/** Organization API keys may only be minted with these scopes — never payment or policy rights. */
export const ORGANIZATION_API_KEY_SCOPES: readonly ApiScope[] = [
  'quote:read',
  'route:read',
  'transaction:create',
];

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === 'string' && (API_SCOPES as readonly string[]).includes(value);
}

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

export function principalHasCapability(
  scopes: readonly ApiScope[],
  capability: ApiScope,
): boolean {
  return scopes.includes(capability);
}
