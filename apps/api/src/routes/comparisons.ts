import {
  NotFoundError,
  serializeComparison,
  serializeReplayResult,
  type ComparisonDto,
  type ReplayResultDto,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { principalOf } from '../http/authentication.js';
import type { AppContainer } from '../container.js';
import {
  comparisonIdParamsSchema,
  createComparisonSchema,
  idempotencyKeySchema,
  listQuerySchema,
  parseOrThrow,
  toMinorUnits,
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
 * Route comparison endpoints.
 *
 * Every response is wrapped in an envelope carrying the platform mode and the non-binding-quote
 * disclaimer, so a client cannot render a sandbox estimate as an executable price without actively
 * discarding the warning it was given.
 */
export function registerComparisonRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): ResponseEnvelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  app.post('/comparisons', async (request, reply) => {
    const body = parseOrThrow(createComparisonSchema, request.body, 'body');
    const idempotencyKey =
      parseOrThrow(idempotencyKeySchema, request.headers['idempotency-key'], 'headers') ?? null;

    const comparison = await container.comparisons.compare({
      sourceCurrency: body.sourceCurrency,
      targetCurrency: body.targetCurrency,
      amountMinorUnits: toMinorUnits(
        body.sourceCurrency,
        body.amount,
        container.config.maxAmountMinorUnits,
      ),
      rails: body.rails ?? null,
      weights: body.weights ?? null,
      idempotencyKey,
      actor: principalOf(request).actor,
      requestId: request.id,
    });

    return reply
      .status(201)
      .send(envelope<ComparisonDto>(request, serializeComparison(comparison)));
  });

  app.get('/comparisons', async (request) => {
    const { limit } = parseOrThrow(listQuerySchema, request.query, 'query');
    const stored = await container.persistence.comparisons.list({ limit });

    return {
      data: stored.map((item) => ({
        comparisonId: item.comparisonId,
        createdAt: item.createdAt,
        mode: item.mode,
        engineVersion: item.engineVersion,
        fingerprint: item.fingerprint,
        sourceCurrency: item.sourceCurrency,
        targetCurrency: item.targetCurrency,
        amountMinorUnits: item.amountMinorUnits,
      })),
      meta: {
        mode: container.config.mode,
        disclaimer: container.disclaimer,
        requestId: request.id,
        count: stored.length,
        limit,
      },
    };
  });

  app.get('/comparisons/:comparisonId', async (request) => {
    const { comparisonId } = parseOrThrow(comparisonIdParamsSchema, request.params, 'params');
    const stored = await container.persistence.comparisons.findById(comparisonId);
    if (stored === null) {
      throw new NotFoundError('Comparison', comparisonId);
    }
    // The stored result is the exact document produced when the comparison was made. Returning it
    // verbatim means a client re-reading a comparison sees the prices as quoted, not as they are
    // now — which is the whole point of persisting it.
    return envelope(request, stored.result);
  });

  app.post('/comparisons/:comparisonId/replay', async (request) => {
    const { comparisonId } = parseOrThrow(comparisonIdParamsSchema, request.params, 'params');
    const result = await container.comparisons.replay(comparisonId, {
      actor: principalOf(request).actor,
      requestId: request.id,
    });
    return envelope<ReplayResultDto>(request, serializeReplayResult(result));
  });

  app.get('/comparisons/:comparisonId/audit', async (request) => {
    const { comparisonId } = parseOrThrow(comparisonIdParamsSchema, request.params, 'params');
    const stored = await container.persistence.comparisons.findById(comparisonId);
    if (stored === null) {
      throw new NotFoundError('Comparison', comparisonId);
    }
    const events = await container.persistence.auditLog.listByComparison(comparisonId);

    return {
      data: { comparisonId, events },
      meta: {
        mode: container.config.mode,
        disclaimer: container.disclaimer,
        requestId: request.id,
        count: events.length,
      },
    };
  });
}
