import {
  serializeDefiCatalog,
  serializeDefiRouting,
  type DefiCatalogDto,
  type DefiRoutingDto,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { principalOf } from '../http/authentication.js';
import type { AppContainer } from '../container.js';
import { createDeFiRouteSchema, parseOrThrow, resolveRouteRequest } from '../http/validation.js';

interface ResponseEnvelope<TData> {
  readonly data: TData;
  readonly meta: {
    readonly mode: string;
    readonly disclaimer: string;
    readonly requestId: string;
  };
}

/**
 * DeFi liquidity routing layer.
 *
 * Quotes DEX, AMM and aggregator venues, and ranks a stablecoin or traditional FX quote on the
 * same pair when one exists. Meridian never submits a swap, connects a wallet, or holds a key.
 */
export function registerDefiRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): ResponseEnvelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  app.get('/defi-liquidity', (request, reply) => {
    return reply
      .status(200)
      .send(
        envelope<DefiCatalogDto>(
          request,
          serializeDefiCatalog(container.financialProviders.all()),
        ),
      );
  });

  app.post('/defi-routes', async (request, reply) => {
    const body = parseOrThrow(createDeFiRouteSchema, request.body, 'body');
    const resolved = resolveRouteRequest(body);
    const principal = principalOf(request);

    const routing = await container.defiRouting.evaluate({
      organizationId: principal.organizationId,
      sourceAsset: resolved.sourceAsset,
      destinationAsset: resolved.destinationAsset,
      amountMinorUnits: resolved.amountMinorUnits,
      actor: principal.actor,
      requestId: request.id,
    });

    return reply.status(201).send(envelope<DefiRoutingDto>(request, serializeDefiRouting(routing)));
  });
}
