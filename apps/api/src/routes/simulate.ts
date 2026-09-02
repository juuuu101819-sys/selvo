import {
  NoRoutesAvailableError,
  simulateRoute,
  type RouteSimulation,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { applyOptionalMandateToRouting } from '../http/mandate-context.js';
import { principalOf } from '../http/authentication.js';
import type { AppContainer } from '../container.js';
import { recordRouteQuoteMonetization } from '../monetization/record.js';
import {
  createSimulateSchema,
  parseOrThrow,
  resolveRouteRequest,
} from '../http/validation.js';

interface ResponseEnvelope<TData> {
  readonly data: TData;
  readonly meta: {
    readonly mode: string;
    readonly disclaimer: string;
    readonly requestId: string;
    readonly sandbox: true;
    readonly fundsMoved: false;
    readonly livePartnerCalled: false;
  };
}

/**
 * Pre-execution simulation.
 *
 * Ranks through MultiRailRouter (or replays a stored snapshot). Returns expected all-in cost,
 * slippage and settlement-time distributions. Mock / historical quotes only. Never executes.
 */
export function registerSimulateRoute(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): ResponseEnvelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
      sandbox: true,
      fundsMoved: false,
      livePartnerCalled: false,
    },
  });

  app.post('/simulate', async (request, reply) => {
    const body = parseOrThrow(createSimulateSchema, request.body, 'body');
    const principal = principalOf(request);
    const access = {
      organizationId: principal.verified ? principal.organizationId : null,
      allowPublic: true,
    };

    let routing;
    if (body.routingId !== undefined) {
      routing = await container.routingEvaluations.load(body.routingId, 'routes', access);
    } else {
      const resolved = resolveRouteRequest({
        sourceAsset: body.sourceAsset ?? '',
        destinationAsset: body.destinationAsset,
        targetAsset: body.targetAsset,
        amount: body.amount ?? '0',
      });
      routing = await container.routing.evaluate({
        organizationId: principal.organizationId,
        sourceAsset: resolved.sourceAsset,
        destinationAsset: resolved.destinationAsset,
        amountMinorUnits: resolved.amountMinorUnits,
        weights: body.preferences?.weights ?? null,
        actor: principal.actor,
        requestId: request.id,
      });
    }

    const attached = await applyOptionalMandateToRouting(
      container,
      request,
      body.mandateId,
      routing,
    );
    if (body.mandateId !== undefined && attached.routing.routes.length === 0) {
      throw new NoRoutesAvailableError('No priced route is inside the attached mandate scope.');
    }
    routing = attached.routing;

    if (body.routingId === undefined) {
      await container.routingEvaluations.persist(routing, null, 'routes');
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
    }

    await container.auditLogger.record({
      type: 'routing.simulated',
      actor: principal.actor,
      requestId: request.id,
      comparisonId: null,
      providerId: routing.recommendedRoute?.provider.id ?? null,
      payload: {
        routingId: routing.routingId,
        routeId: body.routeId ?? routing.recommendedRoute?.routeId ?? null,
        fundsMoved: false,
        livePartnerCalled: false,
        sandbox: true,
      },
    });

    const simulation = simulateRoute(routing, body.routeId);
    return reply.status(201).send(envelope<RouteSimulation>(request, simulation));
  });
}
