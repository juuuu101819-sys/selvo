import {
  serializeNlInterpretation,
  serializeNlRouteResult,
  type NlRouteResultDto,
  type StructuredNlPaymentIntentDto,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContainer } from '../container.js';
import { requireScope } from '../http/require-organization.js';
import {
  idempotencyKeySchema,
  nlAgentInstructionSchema,
  parseOrThrow,
} from '../http/validation.js';

interface Envelope<TData> {
  readonly data: TData;
  readonly meta: { readonly mode: string; readonly disclaimer: string; readonly requestId: string };
}

/**
 * AI-facing natural-language routing.
 *
 * `POST /agent/interpret` turns language into a structured payment intent. It does not quote.
 * `POST /agent/route` runs parser → policy → routing engine → provider quotes → route selection →
 * a recorded execution intent. Neither endpoint executes a payment. `POST /executions` stays 501.
 */
export function registerNlRoutingRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): Envelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  app.post('/agent/interpret', async (request) => {
    const principal = requireScope(request, 'payment:create');
    const body = parseOrThrow(nlAgentInstructionSchema, request.body, 'body');
    const interpretation = await container.nlRouting.interpret({
      organizationId: principal.organizationId,
      actorAgentId: principal.kind === 'agent' ? principal.subjectId : null,
      bodyAgentId: body.agentId,
      instruction: body.instruction,
      actor: principal.actor,
      requestId: request.id,
    });
    return envelope<{
      interpretation: StructuredNlPaymentIntentDto;
      pipelineCompleted: readonly string[];
      aiUsed: false;
    }>(request, {
      interpretation: serializeNlInterpretation(interpretation, null),
      pipelineCompleted: ['natural_language', 'intent_parser'],
      aiUsed: false,
    });
  });

  app.post('/agent/route', async (request, reply) => {
    const principal = requireScope(request, 'payment:create');
    requireScope(request, 'payment:quote');
    requireScope(request, 'payment:authorize');
    const body = parseOrThrow(nlAgentInstructionSchema, request.body, 'body');
    const idempotencyHeader = request.headers['idempotency-key'];
    const rawKey = Array.isArray(idempotencyHeader) ? idempotencyHeader[0] : idempotencyHeader;
    const idempotencyKey =
      rawKey === undefined ? null : (parseOrThrow(idempotencyKeySchema, rawKey, 'headers') ?? null);

    const result = await container.nlRouting.route({
      organizationId: principal.organizationId,
      actorAgentId: principal.kind === 'agent' ? principal.subjectId : null,
      bodyAgentId: body.agentId,
      instruction: body.instruction,
      idempotencyKey,
      actor: principal.actor,
      requestId: request.id,
    });

    return reply.status(201).send(envelope<NlRouteResultDto>(request, serializeNlRouteResult(result)));
  });
}
