import {
  PolicyDeniedError,
  QuoteExpiredError,
  serializeExecutionIntent,
  uuidIdGenerator,
  type ExecutionIntentDto,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContainer } from '../container.js';
import { capabilityPreHandler, requireCapability } from '../http/require-organization.js';
import { recordExecutionIntentMonetization } from '../monetization/record.js';
import {
  createExecutionIntentSchema,
  listQuerySchema,
  parseOrThrow,
  resolveRouteRequest,
} from '../http/validation.js';

interface Envelope<TData> {
  readonly data: TData;
  readonly meta: { readonly mode: string; readonly disclaimer: string; readonly requestId: string };
}

/**
 * Execution intents.
 *
 * `transaction:create` records a route choice. Status is always `recorded`. `executable` and
 * `submitted` are always false. `POST /executions` remains the audited 501.
 *
 * Policy Engine evaluation is mandatory: a payment intent that has already passed the gate must
 * be supplied. Quote expiry is checked first so an expired quote is never recorded even when the
 * policy payload is missing.
 */
export function registerExecutionIntentRoutes(
  app: FastifyInstance,
  container: AppContainer,
): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): Envelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  app.post(
    '/execution-intents',
    { preHandler: [capabilityPreHandler('transaction:create')] },
    async (request, reply) => {
      const principal = requireCapability(request, 'transaction:create');
      const body = parseOrThrow(createExecutionIntentSchema, request.body, 'body');
      const resolved = resolveRouteRequest(body);
      const createdAt = container.clock.nowIso();
      if (body.quoteExpiresAt !== undefined && body.quoteExpiresAt <= createdAt) {
        await container.auditLogger.record({
          type: 'execution.intent.rejected',
          actor: principal.actor,
          requestId: request.id,
          comparisonId: null,
          providerId: null,
          payload: {
            reason: 'QUOTE_EXPIRED',
            routeId: body.routeId,
            quoteExpiresAt: body.quoteExpiresAt,
            executable: false,
            submitted: false,
            fundsMoved: false,
          },
        });
        throw new QuoteExpiredError(
          'The quote has expired. Record a new execution intent after requoting.',
          {
            quoteExpiresAt: body.quoteExpiresAt,
            routeId: body.routeId,
          },
        );
      }

      if (body.paymentIntentId === undefined) {
        await container.auditLogger.record({
          type: 'execution.intent.rejected',
          actor: principal.actor,
          requestId: request.id,
          comparisonId: null,
          providerId: null,
          payload: {
            reason: 'POLICY_REQUIRED',
            routeId: body.routeId,
            failClosed: true,
            executable: false,
            submitted: false,
            fundsMoved: false,
          },
        });
        throw new PolicyDeniedError(
          'policy_required',
          'Execution intents require a payment intent that has already passed Policy Engine evaluation.',
          { failClosed: true },
        );
      }

      await container.agentPayments.gateExecutionIntent({
        organizationId: principal.organizationId,
        agentId: principal.kind === 'agent' ? principal.subjectId : null,
        paymentIntentId: body.paymentIntentId,
        actor: principal.actor,
        requestId: request.id,
      });

      const intent = await container.persistence.executionIntents.create({
        id: uuidIdGenerator.generate('eit'),
        organizationId: principal.organizationId,
        requestId: body.requestId,
        routeId: body.routeId,
        sourceAsset: resolved.sourceAsset,
        destinationAsset: resolved.destinationAsset,
        amountMinorUnits: resolved.amountMinorUnits,
        status: 'recorded',
        executable: false,
        submitted: false,
        quoteExpiresAt: body.quoteExpiresAt ?? null,
        actor: principal.actor,
        createdAt,
      });

      await container.auditLogger.record({
        type: 'execution.intent.recorded',
        actor: principal.actor,
        requestId: request.id,
        comparisonId: null,
        providerId: null,
        payload: {
          intentId: intent.id,
          routeId: intent.routeId,
          sourceAsset: intent.sourceAsset,
          destinationAsset: intent.destinationAsset,
          paymentIntentId: body.paymentIntentId,
          executable: false,
          submitted: false,
        },
      });

      await recordExecutionIntentMonetization({
        organizationId: principal.organizationId,
        intentId: intent.id,
        routeId: intent.routeId,
        createdAt: intent.createdAt,
        sourceAsset: intent.sourceAsset,
        destinationAsset: intent.destinationAsset,
        amountMinorUnits: intent.amountMinorUnits,
        route: null,
        dashboard: container.persistence.dashboard,
        auditLogger: container.auditLogger,
        actor: principal.actor,
        requestId: request.id,
      });

      return reply
        .status(201)
        .send(envelope<ExecutionIntentDto>(request, serializeExecutionIntent(intent)));
    },
  );

  app.get(
    '/execution-intents',
    { preHandler: [capabilityPreHandler('transaction:create')] },
    async (request) => {
      const principal = requireCapability(request, 'transaction:create');
      const { limit } = parseOrThrow(listQuerySchema, request.query, 'query');
      const intents = await container.persistence.executionIntents.listByOrganization(
        principal.organizationId,
        { limit },
      );
      return envelope(request, { intents: intents.map(serializeExecutionIntent) });
    },
  );
}
