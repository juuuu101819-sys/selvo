import {
  serializeGraphSearch,
  serializeRouteGraph,
  type GraphSearchDto,
  type RouteGraphDto,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { principalOf } from '../http/authentication.js';
import type { AppContainer } from '../container.js';
import {
  createGraphPathSchema,
  parseOrThrow,
  resolveGraphPathRequest,
} from '../http/validation.js';

interface ResponseEnvelope<TData> {
  readonly data: TData;
  readonly meta: {
    readonly mode: string;
    readonly disclaimer: string;
    readonly requestId: string;
  };
}

/**
 * Financial route graph: topology plus constrained multi-hop path discovery.
 *
 * Distinct from `POST /routes` (live quotes) and `POST /comparisons` (fiat scoring). Edges carry
 * indicative cost and liquidity. Paths are never executable. No chain is contacted.
 */
export function registerRouteGraphRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): ResponseEnvelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  app.get('/route-graph', (request, reply) => {
    return reply
      .status(200)
      .send(envelope<RouteGraphDto>(request, serializeRouteGraph(container.routeGraph.getGraph())));
  });

  app.post('/route-graph/paths', async (request, reply) => {
    const body = parseOrThrow(createGraphPathSchema, request.body, 'body');
    const resolved = resolveGraphPathRequest(body);
    const principal = principalOf(request);

    const search = await container.routeGraph.discover({
      organizationId: principal.organizationId,
      sourceAsset: resolved.sourceAsset,
      destinationAsset: resolved.destinationAsset,
      amountMinorUnits: resolved.amountMinorUnits,
      ...(resolved.maxHops === undefined ? {} : { maxHops: resolved.maxHops }),
      maxExpectedCostBps: resolved.maxExpectedCostBps,
      minLiquidityMinorUnits: resolved.minLiquidityMinorUnits,
      supportedAssets: resolved.supportedAssets,
      actor: principal.actor,
      requestId: request.id,
    });

    return reply.status(201).send(envelope<GraphSearchDto>(request, serializeGraphSearch(search)));
  });
}
