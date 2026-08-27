/**
 * Organization API key scopes.
 *
 * A key is a credential for a machine caller acting *for* an organization. Scopes are the only
 * rights the key has. Session users receive every scope; anonymous callers receive none.
 *
 * `transaction:create` records an execution *intent*. It does not submit a payment, swap, or
 * payout — `executeTransactions` stays false.
 */
export const API_SCOPES = ['quote:read', 'route:read', 'transaction:create'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const SESSION_API_SCOPES: readonly ApiScope[] = API_SCOPES;

/** Issued by default. `transaction:create` is opt-in — it still only records an intent. */
export const DEFAULT_API_KEY_SCOPES: readonly ApiScope[] = ['quote:read', 'route:read'];

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
