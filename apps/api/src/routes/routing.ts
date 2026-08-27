import { serializeMultiRailRouting, type MultiRailRoutingDto } from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { principalOf } from '../http/authentication.js';
import type { AppContainer } from '../container.js';
import { createRouteSchema, parseOrThrow, resolveRouteRequest } from '../http/validation.js';

interface ResponseEnvelope<TData> {
  readonly data: TData;
  readonly meta: {
    readonly mode: string;
    readonly disclaimer: string;
    readonly requestId: string;
  };
}

/**
 * Multi-rail routing engine.
 *
 * Distinct from `POST /comparisons`: this endpoint evaluates tradfi, stablecoin and DeFi quotes
 * with one scorer. Figures are deterministic. No model is used. Quotes are never executable.
 */
export function registerRoutingRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): ResponseEnvelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  app.post('/routes', async (request, reply) => {
    const body = parseOrThrow(createRouteSchema, request.body, 'body');
    const resolved = resolveRouteRequest(body);
    const principal = principalOf(request);

    const routing = await container.routing.evaluate({
      organizationId: principal.organizationId,
      sourceAsset: resolved.sourceAsset,
      destinationAsset: resolved.destinationAsset,
      amountMinorUnits: resolved.amountMinorUnits,
      weights: body.preferences?.weights ?? null,
      actor: principal.actor,
      requestId: request.id,
    });

    return reply
      .status(201)
      .send(envelope<MultiRailRoutingDto>(request, serializeMultiRailRouting(routing)));
  });
}
