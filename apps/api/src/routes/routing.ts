import { serializeMultiRailRouting, type MultiRailRoutingDto, type RoutingReplayResult } from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { principalOf } from '../http/authentication.js';
import type { AppContainer } from '../container.js';
import { recordRouteQuoteMonetization } from '../monetization/record.js';
import { createRouteSchema, parseOrThrow, resolveRouteRequest, routingIdParamsSchema } from '../http/validation.js';

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
 * `POST /comparisons` ranks through this same MultiRailRouter. Figures are deterministic. No model
 * is used. Quotes are never executable. Discovery records a ROUTE_QUOTE economic snapshot, never
 * realized revenue.
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

    const persisted = await container.routingEvaluations.persist(routing, null, 'routes');

    await recordRouteQuoteMonetization({
      organizationId: principal.organizationId,
      routingId: routing.routingId,
      createdAt: routing.createdAt,
      route: routing.recommendedRoute,
      dashboard: container.persistence.dashboard,
      auditLogger: container.auditLogger,
      actor: principal.actor,
      requestId: request.id,
    });

    return reply
      .status(201)
      .send(
        envelope<MultiRailRoutingDto>(
          request,
          serializeMultiRailRouting(routing, { fingerprint: persisted.fingerprint }),
        ),
      );
  });

  app.post('/routes/:routingId/replay', async (request) => {
    const { routingId } = parseOrThrow(routingIdParamsSchema, request.params, 'params');
    const principal = principalOf(request);
    const result = await container.routingEvaluations.replay(
      routingId,
      'routes',
      { actor: principal.actor, requestId: request.id },
      {
        organizationId: principal.verified ? principal.organizationId : null,
        allowPublic: true,
      },
    );
    return envelope<RoutingReplayResult>(request, result);
  });
}
