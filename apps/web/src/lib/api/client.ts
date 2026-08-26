import type {
  ApiErrorBody,
  ApiResult,
  ComparisonDto,
  Envelope,
  MetaDto,
  ReplayResultDto,
} from './types';

/**
 * Server-side client for the Meridian API.
 *
 * Runs only on the server (server components and server actions), which keeps the API base URL out
 * of the browser bundle and means the browser never needs a CORS grant. Every call resolves to a
 * discriminated result rather than throwing, so the UI always has something concrete to render —
 * including when the API is simply not running.
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

export function fetchMeta(): Promise<ApiResult<MetaDto>> {
  return request<MetaDto>({ method: 'GET', path: '/v1/meta' });
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
  actor?: string,
): Promise<ApiResult<ComparisonDto>> {
  return request<ComparisonDto>({
    method: 'POST',
    path: '/v1/comparisons',
    body: input,
    ...(actor === undefined ? {} : { actor }),
  });
}

export function replayComparison(comparisonId: string): Promise<ApiResult<ReplayResultDto>> {
  return request<ReplayResultDto>({
    method: 'POST',
    path: `/v1/comparisons/${encodeURIComponent(comparisonId)}/replay`,
  });
}
