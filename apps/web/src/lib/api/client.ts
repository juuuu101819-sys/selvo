import type {
  ApiErrorBody,
  ApiResult,
  AuthMeDto,
  ComparisonDto,
  DashboardMetricsPayload,
  DashboardProviderUsageDto,
  DashboardQuoteDto,
  DashboardSettingsDto,
  DashboardTransactionDto,
  Envelope,
  GraphSearchDto,
  LoginDto,
  MetaDto,
  MultiRailRoutingDto,
  ReplayResultDto,
  RouteGraphDto,
  StablecoinCatalogDto,
  StablecoinRoutingDto,
  DefiCatalogDto,
  DefiRoutingDto,
  ExecutionIntentDto,
  FinancialQuoteDto,
  IssuedApiKeyDto,
  RouteSearchDto,
  AssetCatalogEntryDto,
  CurrencyCatalogEntryDto,
} from './types';

/**
 * Server-side client for the Meridian API.
 *
 * Runs only on the server (server components and server actions), which keeps the API base URL out
 * of the browser bundle and means the browser never needs a CORS grant. Every call resolves to a
 * discriminated result rather than throwing, so the UI always has something concrete to render —
 * including when the API is simply not running.
 *
 * Organization-scoped routes take a session token and send it as `Authorization: Bearer`. The web
 * app and API sit on different ports, so the httpOnly cookie is never sent to the API directly.
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:47311';
const REQUEST_TIMEOUT_MS = 15_000;

function baseUrl(): string {
  return (process.env.API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
}

interface RequestOptions {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body?: unknown;
  readonly actor?: string;
  readonly authorization?: string | null;
  readonly cache?: RequestCache;
}

async function request<TData>(options: RequestOptions): Promise<ApiResult<TData>> {
  const url = `${baseUrl()}${options.path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method,
      headers: {
        // Only declared when there is something to describe: several endpoints take no body, and
        // announcing a JSON payload that is not there is simply untrue.
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        'x-meridian-actor': options.actor ?? 'web-app',
        ...(options.authorization ? { authorization: `Bearer ${options.authorization}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      cache: options.cache ?? 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      failure: {
        code: timedOut ? 'API_TIMEOUT' : 'API_UNREACHABLE',
        message: timedOut
          ? 'The routing API did not respond in time.'
          : `Could not reach the routing API at ${baseUrl()}. Start it with "npm run dev:api".`,
        details: {},
        requestId: null,
      },
    };
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    return {
      ok: false,
      failure: {
        code: body?.error.code ?? 'UNEXPECTED_RESPONSE',
        message: body?.error.message ?? `The routing API returned ${response.status}.`,
        details: body?.error.details ?? {},
        requestId: body?.error.requestId ?? null,
      },
    };
  }

  const envelope = payload as Envelope<TData> | null;
  if (envelope === null) {
    return {
      ok: false,
      failure: {
        code: 'UNEXPECTED_RESPONSE',
        message: 'The routing API returned a response the app could not read.',
        details: {},
        requestId: null,
      },
    };
  }

  return { ok: true, data: envelope.data, disclaimer: envelope.meta.disclaimer };
}

export function fetchMeta(authorization?: string | null): Promise<ApiResult<MetaDto>> {
  return request<MetaDto>({
    method: 'GET',
    path: '/api/v1/meta',
    ...(authorization ? { authorization } : {}),
  });
}

export interface CreateComparisonInput {
  readonly sourceCurrency: string;
  readonly targetCurrency: string;
  readonly amount: string;
  readonly rails?: readonly string[];
  readonly weights?: {
    readonly cost: string;
    readonly speed: string;
    readonly reliability: string;
  };
}

export function createComparison(
  input: CreateComparisonInput,
  extras: { readonly actor?: string; readonly authorization?: string | null } = {},
): Promise<ApiResult<ComparisonDto>> {
  return request<ComparisonDto>({
    method: 'POST',
    path: '/api/v1/comparisons',
    body: input,
    actor: extras.actor ?? 'web-app',
    ...(extras.authorization ? { authorization: extras.authorization } : {}),
  });
}

export function replayComparison(
  comparisonId: string,
  authorization?: string | null,
): Promise<ApiResult<ReplayResultDto>> {
  return request<ReplayResultDto>({
    method: 'POST',
    path: `/api/v1/comparisons/${encodeURIComponent(comparisonId)}/replay`,
    ...(authorization ? { authorization } : {}),
  });
}

export function login(email: string, password: string): Promise<ApiResult<LoginDto>> {
  return request<LoginDto>({
    method: 'POST',
    path: '/api/v1/auth/login',
    body: { email, password },
    actor: 'web-app',
  });
}

export function logout(authorization: string): Promise<ApiResult<{ signedOut: boolean }>> {
  return request<{ signedOut: boolean }>({
    method: 'POST',
    path: '/api/v1/auth/logout',
    authorization,
  });
}

export function fetchMe(authorization: string): Promise<ApiResult<AuthMeDto>> {
  return request<AuthMeDto>({ method: 'GET', path: '/api/v1/auth/me', authorization });
}

export function fetchDashboardMetrics(
  authorization: string,
): Promise<ApiResult<DashboardMetricsPayload>> {
  return request<DashboardMetricsPayload>({
    method: 'GET',
    path: '/api/v1/dashboard/metrics',
    authorization,
  });
}

export function fetchDashboardQuotes(
  authorization: string,
): Promise<ApiResult<{ quotes: readonly DashboardQuoteDto[] }>> {
  return request<{ quotes: readonly DashboardQuoteDto[] }>({
    method: 'GET',
    path: '/api/v1/dashboard/quotes',
    authorization,
  });
}

export function fetchDashboardTransactions(
  authorization: string,
): Promise<ApiResult<{ transactions: readonly DashboardTransactionDto[] }>> {
  return request<{ transactions: readonly DashboardTransactionDto[] }>({
    method: 'GET',
    path: '/api/v1/dashboard/transactions',
    authorization,
  });
}

export function fetchDashboardProviders(
  authorization: string,
): Promise<ApiResult<{ providers: readonly DashboardProviderUsageDto[] }>> {
  return request<{ providers: readonly DashboardProviderUsageDto[] }>({
    method: 'GET',
    path: '/api/v1/dashboard/providers',
    authorization,
  });
}

export function fetchDashboardSettings(
  authorization: string,
): Promise<ApiResult<DashboardSettingsDto>> {
  return request<DashboardSettingsDto>({
    method: 'GET',
    path: '/api/v1/dashboard/settings',
    authorization,
  });
}

export interface CreateRouteInput {
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amount: string;
  readonly preferences?: {
    readonly weights: {
      readonly cost: string;
      readonly speed: string;
      readonly liquidity: string;
      readonly reliability: string;
      readonly settlementConfidence: string;
    };
  };
}

export function createRoute(
  input: CreateRouteInput,
  extras: { readonly actor?: string; readonly authorization?: string | null } = {},
): Promise<ApiResult<MultiRailRoutingDto>> {
  return request<MultiRailRoutingDto>({
    method: 'POST',
    path: '/api/v1/routes',
    body: input,
    actor: extras.actor ?? 'web-app',
    ...(extras.authorization ? { authorization: extras.authorization } : {}),
  });
}

export function fetchRouteGraph(
  extras: { readonly authorization?: string | null } = {},
): Promise<ApiResult<RouteGraphDto>> {
  return request<RouteGraphDto>({
    method: 'GET',
    path: '/api/v1/route-graph',
    ...(extras.authorization ? { authorization: extras.authorization } : {}),
  });
}

export interface DiscoverGraphPathsInput {
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amount?: string;
  readonly constraints?: {
    readonly maxHops?: number;
    readonly maxExpectedCostBps?: string;
    readonly minLiquidity?: string;
    readonly supportedAssets?: readonly string[];
  };
}

export function discoverGraphPaths(
  input: DiscoverGraphPathsInput,
  extras: { readonly actor?: string; readonly authorization?: string | null } = {},
): Promise<ApiResult<GraphSearchDto>> {
  return request<GraphSearchDto>({
    method: 'POST',
    path: '/api/v1/route-graph/paths',
    body: input,
    actor: extras.actor ?? 'web-app',
    ...(extras.authorization ? { authorization: extras.authorization } : {}),
  });
}

export function fetchStablecoins(
  extras: { readonly authorization?: string | null } = {},
): Promise<ApiResult<StablecoinCatalogDto>> {
  return request<StablecoinCatalogDto>({
    method: 'GET',
    path: '/api/v1/stablecoins',
    ...(extras.authorization ? { authorization: extras.authorization } : {}),
  });
}

export interface CreateStablecoinRouteInput {
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amount: string;
}

export function createStablecoinRoute(
  input: CreateStablecoinRouteInput,
  extras: { readonly actor?: string; readonly authorization?: string | null } = {},
): Promise<ApiResult<StablecoinRoutingDto>> {
  return request<StablecoinRoutingDto>({
    method: 'POST',
    path: '/api/v1/stablecoin-routes',
    body: input,
    actor: extras.actor ?? 'web-app',
    ...(extras.authorization ? { authorization: extras.authorization } : {}),
  });
}

export function fetchDefiLiquidity(
  extras: { readonly authorization?: string | null } = {},
): Promise<ApiResult<DefiCatalogDto>> {
  return request<DefiCatalogDto>({
    method: 'GET',
    path: '/api/v1/defi-liquidity',
    ...(extras.authorization ? { authorization: extras.authorization } : {}),
  });
}

export interface CreateDeFiRouteInput {
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amount: string;
}

export function createDeFiRoute(
  input: CreateDeFiRouteInput,
  extras: { readonly actor?: string; readonly authorization?: string | null } = {},
): Promise<ApiResult<DefiRoutingDto>> {
  return request<DefiRoutingDto>({
    method: 'POST',
    path: '/api/v1/defi-routes',
    body: input,
    actor: extras.actor ?? 'web-app',
    ...(extras.authorization ? { authorization: extras.authorization } : {}),
  });
}

export function fetchAssets(): Promise<ApiResult<{ assets: readonly AssetCatalogEntryDto[] }>> {
  return request({ method: 'GET', path: '/api/v1/assets' });
}

export function fetchCurrencies(): Promise<
  ApiResult<{ currencies: readonly CurrencyCatalogEntryDto[] }>
> {
  return request({ method: 'GET', path: '/api/v1/currencies' });
}

export function createFinancialQuote(
  input: {
    readonly sourceAsset: string;
    readonly destinationAsset: string;
    readonly amount: string;
    readonly organizationId?: string;
  },
  extras: { readonly actor?: string; readonly authorization?: string | null } = {},
): Promise<ApiResult<FinancialQuoteDto>> {
  return request<FinancialQuoteDto>({
    method: 'POST',
    path: '/api/v1/quote',
    body: input,
    actor: extras.actor ?? 'web-app',
    ...(extras.authorization ? { authorization: extras.authorization } : {}),
  });
}

export function searchRoutes(
  input: { readonly sourceAsset: string; readonly destinationAsset: string },
  extras: { readonly actor?: string; readonly authorization?: string | null } = {},
): Promise<ApiResult<RouteSearchDto>> {
  return request<RouteSearchDto>({
    method: 'POST',
    path: '/api/v1/routes/search',
    body: input,
    actor: extras.actor ?? 'web-app',
    ...(extras.authorization ? { authorization: extras.authorization } : {}),
  });
}

export function createOrganizationApiKey(
  input: { readonly label: string; readonly scopes?: readonly string[] },
  authorization: string,
): Promise<ApiResult<IssuedApiKeyDto>> {
  return request<IssuedApiKeyDto>({
    method: 'POST',
    path: '/api/v1/api-keys',
    body: input,
    authorization,
  });
}

export function revokeOrganizationApiKey(
  id: string,
  authorization: string,
): Promise<ApiResult<{ id: string; revoked: true }>> {
  return request({
    method: 'POST',
    path: `/api/v1/api-keys/${encodeURIComponent(id)}/revoke`,
    authorization,
  });
}

export function createExecutionIntent(
  input: {
    readonly requestId: string;
    readonly routeId: string;
    readonly sourceAsset: string;
    readonly destinationAsset: string;
    readonly amount: string;
  },
  extras: { readonly authorization?: string | null } = {},
): Promise<ApiResult<ExecutionIntentDto>> {
  return request<ExecutionIntentDto>({
    method: 'POST',
    path: '/api/v1/execution-intents',
    body: input,
    ...(extras.authorization ? { authorization: extras.authorization } : {}),
  });
}
