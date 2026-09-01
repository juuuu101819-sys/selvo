import { SERVICE_NAME, SERVICE_VERSION } from '../config/service.js';
import {
  API_SURFACE_CONTRACT,
  API_V1_ROUTE_CATALOG,
  openApiPath,
  type CatalogRoute,
} from './catalog.js';

export interface OpenApiDocument {
  readonly openapi: '3.0.3';
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description: string;
  };
  readonly servers: readonly { readonly url: string; readonly description: string }[];
  readonly tags: readonly { readonly name: string }[];
  readonly paths: Record<string, Record<string, OpenApiOperation>>;
  readonly components: {
    readonly securitySchemes: Record<string, unknown>;
    readonly schemas: Record<string, unknown>;
  };
}

export interface OpenApiOperation {
  readonly operationId: string;
  readonly tags: readonly string[];
  readonly summary: string;
  readonly description: string;
  readonly security: readonly Record<string, readonly string[]>[];
  readonly parameters?: readonly unknown[];
  readonly requestBody?: unknown;
  readonly responses: Record<string, unknown>;
  readonly 'x-meridian-surface': 'public' | 'authenticated';
  readonly 'x-meridian-auth': string;
}

function operationId(route: CatalogRoute): string {
  const name = route.path
    .replace(/^\//u, '')
    .replace(/[/:]/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/_$/u, '');
  return `${route.method.toLowerCase()}_${name === '' ? 'root' : name}`;
}

function pathParameters(path: string): readonly unknown[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/gu)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
}

function requestBody(route: CatalogRoute): unknown {
  if (route.method === 'GET') {
    return undefined;
  }
  return {
    required: route.method !== 'PATCH',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/JsonObject' },
      },
    },
  };
}

const PAGINATED_GET_PATHS = new Set([
  '/comparisons',
  '/execution-intents',
  '/payment-intents',
  '/dashboard/quotes',
  '/dashboard/transactions',
  '/dashboard/invoices',
]);

function responses(route: CatalogRoute): Record<string, unknown> {
  if (route.path === '/executions' && route.method === 'POST') {
    return {
      '501': {
        description: 'Execution is not implemented. Non-custodial refusal.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
      },
    };
  }
  const success =
    route.method === 'POST'
      ? { '201': { description: 'Created or accepted.' }, '200': { description: 'OK.' } }
      : {
          '200': {
            description: PAGINATED_GET_PATHS.has(route.path)
              ? 'OK. Envelope `meta` includes `limit` and opaque `nextCursor` (null when no further page).'
              : 'OK.',
          },
        };
  return {
    ...success,
    '400': {
      description: 'Validation error.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
    },
    '401': {
      description: 'Unauthenticated.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
    },
    '403': {
      description: 'Forbidden or policy denied.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
    },
  };
}

function security(route: CatalogRoute): readonly Record<string, readonly string[]>[] {
  if (route.surface === 'public') {
    return [];
  }
  return [{ SessionBearer: [] }, { ApiKey: [] }];
}

function paginationQueryParameters(): readonly unknown[] {
  return [
    {
      name: 'limit',
      in: 'query',
      required: false,
      description: 'Page size. Default 20 (dashboard lists 50). Minimum 1, maximum 100. Excess is 400.',
      schema: { type: 'integer', minimum: 1, maximum: 100 },
    },
    {
      name: 'cursor',
      in: 'query',
      required: false,
      description:
        'Opaque keyset cursor from the previous page `meta.nextCursor`. Invalid or foreign cursors are 400.',
      schema: { type: 'string', maxLength: 512 },
    },
  ];
}

function operation(route: CatalogRoute): OpenApiOperation {
  const parameters = [
    ...pathParameters(route.path),
    ...(route.method === 'GET' && PAGINATED_GET_PATHS.has(route.path)
      ? paginationQueryParameters()
      : []),
  ];
  const body = requestBody(route);
  return {
    operationId: operationId(route),
    tags: route.tags,
    summary: route.summary,
    description: `${route.summary} Surface: ${route.surface}. Auth: ${route.auth}.`,
    security: [...security(route)],
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(body === undefined ? {} : { requestBody: body }),
    responses: responses(route),
    'x-meridian-surface': route.surface,
    'x-meridian-auth': route.auth,
  };
}

export function buildOpenApiDocument(): OpenApiDocument {
  const paths: Record<string, Record<string, OpenApiOperation>> = {};
  const tags = new Set<string>();
  for (const route of API_V1_ROUTE_CATALOG) {
    const path = openApiPath(route.path);
    const existing = paths[path] ?? {};
    existing[route.method.toLowerCase()] = operation(route);
    paths[path] = existing;
    for (const tag of route.tags) {
      tags.add(tag);
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: SERVICE_NAME,
      version: SERVICE_VERSION,
      description: [
        'Meridian HTTP API. Non-custodial financial routing hub.',
        API_SURFACE_CONTRACT.publicDiscovery,
        API_SURFACE_CONTRACT.authenticatedBilled,
        API_SURFACE_CONTRACT.paH08,
        'List endpoints use an opaque keyset cursor (`cursor` query + `limit` 1–100; `meta.nextCursor`). Offset paging is rejected. Invalid or foreign cursors are 400.',
        'Agent credentials are documented in docs/AGENTS.md.',
      ].join('\n\n'),
    },
    servers: [
      { url: '/api/v1', description: 'Canonical versioned prefix' },
      { url: '/v1', description: 'Deprecated duplicate prefix' },
    ],
    tags: [...tags].sort().map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        SessionBearer: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'mds session token',
          description: 'Human session from POST /auth/login or OIDC/MFA verify. Never holds payment:* scopes.',
        },
        ApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Api-Key',
          description:
            'Organization key (mk_) or agent credential (mag_). Unverifiable credentials are 401.',
        },
      },
      schemas: {
        JsonObject: {
          type: 'object',
          additionalProperties: true,
          description: 'Request body. Strict Zod schemas reject execute, privateKey, and wallet.',
        },
        ErrorEnvelope: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message', 'details', 'requestId'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: { type: 'object', additionalProperties: true },
                requestId: { type: 'string' },
              },
            },
          },
        },
        FinancialQuote: {
          type: 'object',
          description: 'Authenticated POST /quote DTO. No monetization field. Includes quoteExpiresAt.',
          required: ['requestId', 'routes', 'recommendedRoute', 'quoteExpiresAt', 'fingerprint', 'routingId'],
          properties: {
            requestId: { type: 'string' },
            routes: { type: 'array', items: { type: 'object' } },
            recommendedRoute: { type: ['object', 'null'] },
            quoteExpiresAt: { type: ['string', 'null'], format: 'date-time' },
            fingerprint: { type: 'string', description: 'SHA-256 of the ranking snapshot. Snapshot JSON is not returned.' },
            routingId: { type: 'string' },
          },
        },
        RouteMonetization: {
          type: 'object',
          description:
            'Quoted economics on public POST /routes. realizedRevenue and fundsMoved are always false.',
          required: ['eventType', 'stage', 'realizedRevenue', 'fundsMoved'],
          properties: {
            eventType: { type: 'string', enum: ['ROUTE_QUOTE'] },
            stage: { type: 'string', enum: ['route_quote'] },
            realizedRevenue: { type: 'boolean', enum: [false] },
            fundsMoved: { type: 'boolean', enum: [false] },
          },
        },
        PartnerInstruction: {
          type: 'object',
          description:
            'Sandbox record of a signed instruction forwarded to an execution partner. The partner settles. fundsMoved and meridianKeysUsed are always false.',
          required: [
            'id',
            'partnerId',
            'status',
            'instructionHash',
            'fundsMoved',
            'custody',
            'meridianKeysUsed',
            'sandbox',
          ],
          properties: {
            id: { type: 'string' },
            partnerId: { type: 'string' },
            status: {
              type: 'string',
              enum: ['accepted', 'settling', 'partial', 'settled', 'failed'],
            },
            instructionHash: { type: 'string' },
            fundsMoved: { type: 'boolean', enum: [false] },
            custody: { type: 'boolean', enum: [false] },
            meridianKeysUsed: { type: 'boolean', enum: [false] },
            sandbox: { type: 'boolean', enum: [true] },
          },
        },
      },
    },
  };
}

export function isOpenApiV3(document: unknown): document is OpenApiDocument {
  if (typeof document !== 'object' || document === null) {
    return false;
  }
  const candidate = document as Record<string, unknown>;
  if (typeof candidate['openapi'] !== 'string' || !candidate['openapi'].startsWith('3.')) {
    return false;
  }
  if (typeof candidate['info'] !== 'object' || candidate['info'] === null) {
    return false;
  }
  const info = candidate['info'] as Record<string, unknown>;
  if (typeof info['title'] !== 'string' || typeof info['version'] !== 'string') {
    return false;
  }
  const paths = candidate['paths'];
  if (typeof paths !== 'object' || paths === null) {
    return false;
  }
  return Object.keys(paths).length > 0;
}
