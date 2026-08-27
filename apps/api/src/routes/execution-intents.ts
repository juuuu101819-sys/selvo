import {
  QuoteExpiredError,
  serializeExecutionIntent,
  uuidIdGenerator,
  type ExecutionIntentDto,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContainer } from '../container.js';
import { requireScope } from '../http/require-organization.js';
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

  app.post('/execution-intents', async (request, reply) => {
    const principal = requireScope(request, 'transaction:create');
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
        executable: false,
        submitted: false,
      },
    });

    return reply
      .status(201)
      .send(envelope<ExecutionIntentDto>(request, serializeExecutionIntent(intent)));
  });

  app.get('/execution-intents', async (request) => {
    const principal = requireScope(request, 'transaction:create');
    const { limit } = parseOrThrow(listQuerySchema, request.query, 'query');
    const intents = await container.persistence.executionIntents.listByOrganization(
      principal.organizationId,
      { limit },
    );
    return envelope(request, { intents: intents.map(serializeExecutionIntent) });
  });
}
