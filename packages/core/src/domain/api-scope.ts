/**
 * Organization API key scopes.
 *
 * A key is a credential for a machine caller acting *for* an organization. Scopes are the only
 * rights the key has. Session users receive every scope; anonymous callers receive none.
 *
 * `transaction:create` records an execution *intent*. It does not submit a payment, swap, or
 * payout — `executeTransactions` stays false.
 *
 * `payment:*` scopes drive the AI-agent payment infrastructure (intent, quote, authorize,
 * sandbox simulate). They never grant real execution.
 */
export const API_SCOPES = [
  'quote:read',
  'route:read',
  'transaction:create',
  'payment:create',
  'payment:quote',
  'payment:authorize',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const SESSION_API_SCOPES: readonly ApiScope[] = API_SCOPES;

/** Issued by default on organization API keys. Payment scopes belong to agent credentials. */
export const DEFAULT_API_KEY_SCOPES: readonly ApiScope[] = ['quote:read', 'route:read'];

/** Issued to AI-agent credentials. Includes `quote:read` so agents consume the routing engine. */
export const DEFAULT_AGENT_SCOPES: readonly ApiScope[] = [
  'quote:read',
  'payment:create',
  'payment:quote',
  'payment:authorize',
];

/** Organization API keys may only be minted with these scopes — never payment rights. */
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
