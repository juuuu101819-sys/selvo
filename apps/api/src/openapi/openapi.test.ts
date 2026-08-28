import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_V1_PREFIX } from '../routes/index.js';
import {
  API_V1_ROUTE_CATALOG,
  catalogRouteKey,
  openApiPath,
} from './catalog.js';
import { buildOpenApiDocument, isOpenApiV3 } from './document.js';
import {
  canonicalApiV1Routes,
  implementedCatalogPath,
} from './implemented.js';
import { createTestHarness, type TestHarness } from '../testing/harness.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});

afterAll(async () => {
  await harness.close();
});

describe('OpenAPI v3 contract', () => {
  it('serves a valid OpenAPI 3 document at GET /api/v1/openapi.json', async () => {
    const generated = buildOpenApiDocument();
    expect(isOpenApiV3(generated)).toBe(true);

    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/openapi.json`,
    });
    expect(response.statusCode).toBe(200);
    const body: unknown = response.json();
    expect(isOpenApiV3(body)).toBe(true);
    const document = body as { openapi: string; info: { title: string }; paths: Record<string, unknown> };
    expect(document.openapi.startsWith('3.')).toBe(true);
    expect(document.info.title).toBe('financial-router');
    expect(Object.keys(document.paths).length).toBeGreaterThan(0);
    expect(document.paths['/quote']).toBeDefined();
    expect(document.paths['/routes']).toBeDefined();
    expect(document.paths['/openapi.json']).toBeDefined();
  });

  it('lists every catalog route in the OpenAPI paths object', () => {
    const document = buildOpenApiDocument();
    for (const route of API_V1_ROUTE_CATALOG) {
      const path = openApiPath(route.path);
      const methods = document.paths[path];
      expect(methods, `missing OpenAPI path ${path}`).toBeDefined();
      expect(
        methods?.[route.method.toLowerCase()],
        `missing ${route.method} ${path}`,
      ).toBeDefined();
    }
  });

  it('covers every implemented /api/v1 route so the spec cannot drift', () => {
    const implemented = canonicalApiV1Routes(harness.implementedRoutes);
    const catalog = new Set(
      API_V1_ROUTE_CATALOG.map((route) => catalogRouteKey(route.method, route.path)),
    );
    const missingFromSpec: string[] = [];
    const seen = new Set<string>();
    for (const route of implemented) {
      const path = implementedCatalogPath(route.url);
      const key = catalogRouteKey(route.method, path);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (!catalog.has(key)) {
        missingFromSpec.push(key);
      }
    }
    expect(missingFromSpec, `implemented routes missing from OpenAPI catalog: ${missingFromSpec.join(', ')}`).toEqual(
      [],
    );

    const implementedKeys = new Set(seen);
    const extraInCatalog = API_V1_ROUTE_CATALOG.map((route) =>
      catalogRouteKey(route.method, route.path),
    ).filter((key) => !implementedKeys.has(key));
    expect(extraInCatalog, `catalog entries with no Fastify route: ${extraInCatalog.join(', ')}`).toEqual(
      [],
    );
  });
});
