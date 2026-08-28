/**
 * Canonical /api/v1 route table.
 *
 * OpenAPI, GET /meta `apiSurfaces`, and the coverage test all read this list. Adding an HTTP
 * handler without a row here fails the OpenAPI coverage test.
 *
 * Paths use Fastify colon params (`:id`). OpenAPI conversion happens in `document.ts`.
 */

export type ApiHttpMethod = 'GET' | 'POST' | 'PATCH';
export type ApiSurface = 'public' | 'authenticated';

export interface CatalogRoute {
  readonly method: ApiHttpMethod;
  readonly path: string;
  readonly surface: ApiSurface;
  readonly auth: string;
  readonly summary: string;
  readonly tags: readonly string[];
}

function r(
  method: ApiHttpMethod,
  path: string,
  surface: ApiSurface,
  auth: string,
  summary: string,
  tags: readonly string[],
): CatalogRoute {
  return { method, path, surface, auth, summary, tags };
}

/**
 * Public discovery vs authenticated billed quote — the PA-M05 contract.
 *
 * Public ranking still uses MultiRailRouter (PA-H05). Public `/routes` still returns quoted,
 * unrealized monetization (PA-H08). Anonymous callers cannot reach `/quote`.
 */
export const API_SURFACE_CONTRACT = {
  openapiPath: '/api/v1/openapi.json',
  publicDiscovery:
    'Indicative catalog discovery. No credential required. Rankings use MultiRailRouter with ' +
    'platform-default (or request) weights, not an organization payment policy. Provider names ' +
    'are the same public catalog as GET /providers. Monetization, when present, is a quoted ' +
    'ROUTE_QUOTE snapshot: realizedRevenue and fundsMoved are always false. Discovery does not ' +
    'persist a billed Quote row and does not return quoteExpiresAt as an auditable billed window.',
  authenticatedBilled:
    'Requires a verified principal. POST /quote requires quote:read, uses principal.organizationId ' +
    'for pricing, and returns quoteExpiresAt. Payment-intent quotes require mag_ payment:* scopes ' +
    'and apply the agent payment policy (allowlists and preferredRoutePreference) as ranking input ' +
    'to the same MultiRailRouter. Dashboard revenue is authenticated-only.',
  paH08:
    'Quoted monetization on public POST /routes is not realized revenue. Nothing in this API ' +
    'returns realizedRevenue: true. POST /executions remains 501.',
} as const;

export const API_V1_ROUTE_CATALOG: readonly CatalogRoute[] = [
  r('GET', '/health', 'public', 'none', 'Versioned liveness (fixed status/service/version).', [
    'System',
  ]),
  r('GET', '/meta', 'public', 'none', 'Product, capabilities, catalog, and API surface contract.', [
    'System',
  ]),
  r('GET', '/openapi.json', 'public', 'none', 'OpenAPI 3 document for every /api/v1 route.', [
    'System',
  ]),

  r('POST', '/auth/login', 'public', 'none', 'Issue a human session token (mds_).', ['Auth']),
  r('POST', '/auth/logout', 'authenticated', 'session', 'Revoke the current session.', ['Auth']),
  r('GET', '/auth/me', 'authenticated', 'session+api_key+agent', 'Current verified principal.', [
    'Auth',
  ]),

  r(
    'POST',
    '/comparisons',
    'public',
    'none',
    'Public indicative comparison. Same MultiRailRouter as POST /routes. Not the billed /quote surface.',
    ['Discovery'],
  ),
  r('GET', '/comparisons', 'public', 'none', 'List stored comparisons visible to this caller.', [
    'Discovery',
  ]),
  r('GET', '/comparisons/:comparisonId', 'public', 'none', 'Fetch one stored comparison.', [
    'Discovery',
  ]),
  r(
    'POST',
    '/comparisons/:comparisonId/replay',
    'public',
    'none',
    'Replay a stored comparison snapshot.',
    ['Discovery'],
  ),
  r(
    'GET',
    '/comparisons/:comparisonId/audit',
    'public',
    'none',
    'Audit events for one comparison.',
    ['Discovery'],
  ),

  r(
    'POST',
    '/routes',
    'public',
    'none',
    'Public multi-rail ranking. Indicative. Returns quoted (unrealized) monetization. Anonymous is 201.',
    ['Discovery'],
  ),
  r('GET', '/route-graph', 'public', 'none', 'Demo financial-route graph. Not a quote.', [
    'Discovery',
  ]),
  r(
    'POST',
    '/route-graph/paths',
    'public',
    'none',
    'Indicative multi-hop path discovery. Does not price and does not execute.',
    ['Discovery'],
  ),
  r('GET', '/stablecoins', 'public', 'none', 'Supported stablecoins and chain metadata.', [
    'Discovery',
  ]),
  r(
    'POST',
    '/stablecoin-routes',
    'public',
    'none',
    'Public stablecoin corridor ranking. Indicative; no custody.',
    ['Discovery'],
  ),
  r('GET', '/defi-liquidity', 'public', 'none', 'Read-only DeFi depth. No swap submission.', [
    'Discovery',
  ]),
  r(
    'POST',
    '/defi-routes',
    'public',
    'none',
    'Public DeFi venue ranking. Indicative; defiExecution stays false.',
    ['Discovery'],
  ),
  r('GET', '/assets', 'public', 'none', 'Public asset catalog.', ['Catalog']),
  r('GET', '/currencies', 'public', 'none', 'Public ISO currency catalog.', ['Catalog']),
  r('GET', '/providers', 'public', 'none', 'Public financial-provider catalog.', ['Catalog']),
  r('GET', '/providers/:providerId', 'public', 'none', 'One public catalog provider.', ['Catalog']),
  r(
    'POST',
    '/provider-quotes',
    'public',
    'none',
    'Indicative quote from one catalog provider. Never executable.',
    ['Discovery'],
  ),

  r(
    'POST',
    '/quote',
    'authenticated',
    'quote:read',
    'Org-scoped billed quote. Same MultiRailRouter. Returns quoteExpiresAt. Anonymous is 401.',
    ['Quotes'],
  ),
  r(
    'POST',
    '/routes/search',
    'authenticated',
    'route:read',
    'Authenticated graph discovery plus catalog providers. Not a second quote engine.',
    ['Quotes'],
  ),

  r('GET', '/api-keys', 'authenticated', 'organization', 'List organization API key prefixes.', [
    'Keys',
  ]),
  r(
    'POST',
    '/api-keys',
    'authenticated',
    'owner/admin session',
    'Mint an mk_ organization key. Secret returned once.',
    ['Keys'],
  ),
  r(
    'POST',
    '/api-keys/:id/revoke',
    'authenticated',
    'owner/admin session',
    'Revoke an organization API key.',
    ['Keys'],
  ),

  r('GET', '/agents/me', 'authenticated', 'agent', 'The authenticated mag_ agent and wallets.', [
    'Agents',
  ]),
  r('GET', '/agents', 'authenticated', 'organization', 'List agents for this organization.', [
    'Agents',
  ]),
  r(
    'POST',
    '/agents',
    'authenticated',
    'owner/admin session',
    'Issue a mag_ agent credential. Secret returned once. Scopes are DEFAULT_AGENT_SCOPES.',
    ['Agents'],
  ),
  r(
    'POST',
    '/agents/:id/revoke',
    'authenticated',
    'owner/admin session',
    'Retire an agent and revoke its credentials.',
    ['Agents'],
  ),
  r('GET', '/agents/:id/wallets', 'authenticated', 'organization', 'External wallet references.', [
    'Agents',
  ]),
  r('GET', '/merchants', 'authenticated', 'organization', 'Merchants this tenant may pay.', [
    'Agents',
  ]),
  r(
    'GET',
    '/payment-policies',
    'authenticated',
    'organization',
    'Agent payment policies for this tenant.',
    ['Agents'],
  ),
  r(
    'POST',
    '/payment-intents',
    'authenticated',
    'payment:create',
    'Create a non-custodial payment intent (mag_ only).',
    ['Agents'],
  ),
  r('GET', '/payment-intents', 'authenticated', 'organization', 'List payment intents.', ['Agents']),
  r('GET', '/payment-intents/:id', 'authenticated', 'organization', 'Fetch one payment intent.', [
    'Agents',
  ]),
  r(
    'POST',
    '/payment-intents/:id/quote',
    'authenticated',
    'payment:quote',
    'Rank through MultiRailRouter using policy preferredRoutePreference as ranking input.',
    ['Agents'],
  ),
  r(
    'POST',
    '/payment-intents/:id/select',
    'authenticated',
    'payment:authorize',
    'Select a quoted route. Policy preference locks to the recommended route when set.',
    ['Agents'],
  ),
  r(
    'POST',
    '/payment-intents/:id/authorize',
    'authenticated',
    'payment:authorize',
    'Policy-approve a selected route. Not a card authorization.',
    ['Agents'],
  ),
  r(
    'POST',
    '/payment-intents/:id/simulate',
    'authenticated',
    'payment:authorize',
    'Sandbox simulator. fundsMoved stays false.',
    ['Agents'],
  ),
  r(
    'POST',
    '/agent/interpret',
    'authenticated',
    'payment:create',
    'Deterministic NL parse. Does not compute financials.',
    ['Agents'],
  ),
  r(
    'POST',
    '/agent/route',
    'authenticated',
    'payment:create+quote+authorize',
    'Parse → policy → MultiRailRouter → recorded execution intent. Does not pay.',
    ['Agents'],
  ),

  r('GET', '/dashboard/metrics', 'authenticated', 'organization', 'Organization dashboard metrics.', [
    'Dashboard',
  ]),
  r('GET', '/dashboard/quotes', 'authenticated', 'organization', 'Stored dashboard quotes.', [
    'Dashboard',
  ]),
  r('GET', '/dashboard/quotes/:id', 'authenticated', 'organization', 'One dashboard quote.', [
    'Dashboard',
  ]),
  r(
    'GET',
    '/dashboard/transactions',
    'authenticated',
    'organization',
    'Dashboard transaction requests.',
    ['Dashboard'],
  ),
  r(
    'GET',
    '/dashboard/transactions/:id',
    'authenticated',
    'organization',
    'One dashboard transaction request.',
    ['Dashboard'],
  ),
  r('GET', '/dashboard/providers', 'authenticated', 'organization', 'Dashboard provider view.', [
    'Dashboard',
  ]),
  r(
    'GET',
    '/dashboard/revenue',
    'authenticated',
    'organization',
    'Quoted vs realized revenue. Realized totals stay 0.',
    ['Dashboard'],
  ),
  r('GET', '/dashboard/settings', 'authenticated', 'organization', 'Members and API key prefixes.', [
    'Dashboard',
  ]),
  r('GET', '/dashboard/agents', 'authenticated', 'organization', 'Agent financial summaries.', [
    'Dashboard',
  ]),
  r('GET', '/dashboard/agents/:id', 'authenticated', 'organization', 'One agent dashboard.', [
    'Dashboard',
  ]),
  r(
    'GET',
    '/dashboard/agents/:id/payments',
    'authenticated',
    'organization',
    'Agent payment history.',
    ['Dashboard'],
  ),
  r(
    'GET',
    '/dashboard/agents/:id/policies',
    'authenticated',
    'organization',
    'Agent policy controls.',
    ['Dashboard'],
  ),
  r(
    'PATCH',
    '/dashboard/agents/:id/policies',
    'authenticated',
    'agent_policy:write',
    'Patch allowlists and preferredRoutePreference. Owner/admin sessions only.',
    ['Dashboard'],
  ),

  r(
    'POST',
    '/execution-intents',
    'authenticated',
    'transaction:create',
    'Record a route choice. executable and submitted stay false.',
    ['Execution'],
  ),
  r(
    'GET',
    '/execution-intents',
    'authenticated',
    'transaction:create',
    'List recorded execution intents.',
    ['Execution'],
  ),
  r(
    'POST',
    '/executions',
    'public',
    'none',
    'Deliberate 501. The platform does not execute. Audited even when anonymous.',
    ['Execution'],
  ),
];

export function catalogRouteKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${normalizeCatalogPath(path)}`;
}

export function normalizeCatalogPath(path: string): string {
  const trimmed = path.replace(/\/+$/u, '');
  return trimmed === '' ? '/' : trimmed;
}

export function openApiPath(fastifyPath: string): string {
  return fastifyPath.replace(/:([A-Za-z0-9_]+)/gu, '{$1}');
}

export function catalogKeys(): readonly string[] {
  return API_V1_ROUTE_CATALOG.map((route) => catalogRouteKey(route.method, route.path));
}
