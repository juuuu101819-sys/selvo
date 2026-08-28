import type { FastifyInstance } from 'fastify';
import { buildOpenApiDocument } from '../openapi/document.js';

/**
 * Machine-readable API contract. Public, like GET /meta.
 */
export function registerOpenApiRoute(app: FastifyInstance): void {
  const document = buildOpenApiDocument();
  app.get('/openapi.json', (_request, reply) => {
    return reply.type('application/json').send(document);
  });
}
