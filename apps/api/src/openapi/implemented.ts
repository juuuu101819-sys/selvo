import type { FastifyInstance, RouteOptions } from 'fastify';

export interface ImplementedRoute {
  readonly method: string;
  readonly url: string;
}

const TRACKED_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);

function fullUrl(route: RouteOptions & { prefix?: string }): string {
  const url = route.url.startsWith('/') ? route.url : `/${route.url}`;
  const prefix = route.prefix ?? '';
  if (prefix !== '' && !url.startsWith(prefix)) {
    const joined = `${prefix}${url}`.replace(/\/{2,}/gu, '/');
    return joined === '' ? '/' : joined;
  }
  return url;
}

/**
 * Collects Fastify routes as they are registered. Must be hooked before `registerRoutes`.
 */
export function registerImplementedRouteCollector(app: FastifyInstance): () => ImplementedRoute[] {
  const collected: ImplementedRoute[] = [];
  app.addHook('onRoute', (route) => {
    const options = route as RouteOptions & { prefix?: string };
    const methods = Array.isArray(options.method) ? options.method : [options.method];
    const url = fullUrl(options);
    for (const method of methods) {
      const upper = method.toUpperCase();
      if (!TRACKED_METHODS.has(upper)) {
        continue;
      }
      collected.push({ method: upper, url });
    }
  });
  return () => collected;
}

export function canonicalApiV1Routes(
  implemented: readonly ImplementedRoute[],
): readonly ImplementedRoute[] {
  return implemented.filter(
    (route) => route.url === '/api/v1' || route.url.startsWith('/api/v1/'),
  );
}

export function implementedCatalogPath(url: string): string {
  let path = url.startsWith('/api/v1') ? url.slice('/api/v1'.length) : url;
  if (path === '') {
    path = '/';
  }
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return path;
}
