import {
  serializeStablecoinCatalog,
  serializeStablecoinRouting,
  type StablecoinCatalogDto,
  type StablecoinRoutingDto,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { principalOf } from '../http/authentication.js';
import type { AppContainer } from '../container.js';
import {
  createStablecoinRouteSchema,
  parseOrThrow,
  resolveRouteRequest,
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
 * Stablecoin routing layer.
 *
 * Distinct from `POST /routes` (every rail) and `POST /comparisons` (fiat). Quotes fiat ↔
 * stablecoin and stablecoin ↔ stablecoin only. Meridian never holds the token, opens an RPC,
 * or creates a wallet. Settlement is not executed here.
 */
export function registerStablecoinRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): ResponseEnvelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  app.get('/stablecoins', (request, reply) => {
    return reply
      .status(200)
      .send(envelope<StablecoinCatalogDto>(request, serializeStablecoinCatalog()));
  });

  app.post('/stablecoin-routes', async (request, reply) => {
    const body = parseOrThrow(createStablecoinRouteSchema, request.body, 'body');
    const resolved = resolveRouteRequest(body);
    const principal = principalOf(request);

    const routing = await container.stablecoinRouting.evaluate({
      organizationId: principal.organizationId,
      sourceAsset: resolved.sourceAsset,
      destinationAsset: resolved.destinationAsset,
      amountMinorUnits: resolved.amountMinorUnits,
      actor: principal.actor,
      requestId: request.id,
    });

    return reply
      .status(201)
      .send(envelope<StablecoinRoutingDto>(request, serializeStablecoinRouting(routing)));
  });
}
