import {
  NotFoundError,
  type ComparisonDto,
  type Principal,
  type ReplayResultDto,
  type StoredComparison,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { principalOf } from '../http/authentication.js';
import type { AppContainer } from '../container.js';
import { recordComparisonMonetization } from '../monetization/record.js';
import {
  comparisonIdParamsSchema,
  createComparisonSchema,
  idempotencyKeySchema,
  listQuerySchema,
  parseOrThrow,
  resolveRequestedRails,
  resolveTargetCurrency,
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
      // Taken from the authenticated principal, never from the request body: a caller must not be
      // able to select which organization's negotiated pricing they are quoted on.
      organizationId: principalOf(request).organizationId,
      sourceCurrency: body.sourceCurrency,
      targetCurrency: resolveTargetCurrency(body),
      amountMinorUnits: toMinorUnits(
        body.sourceCurrency,
        body.amount,
        container.config.maxAmountMinorUnits,
      ),
      rails: resolveRequestedRails(body),
      weights: body.weights ?? null,
      idempotencyKey,
      actor: principalOf(request).actor,
      requestId: request.id,
    });

    await recordComparisonMonetization({
      comparisonId: comparison.comparisonId,
      organizationId: comparison.organizationId,
      createdAt: comparison.createdAt,
      routingId: comparison.routing.routingId,
      route: comparison.routing.recommendedRoute,
      dashboard: container.persistence.dashboard,
      auditLogger: container.auditLogger,
      actor: principalOf(request).actor,
      requestId: request.id,
    });

    return reply.status(201).send(envelope<ComparisonDto>(request, comparison.dto));
  });

  app.get('/comparisons', async (request) => {
    const { limit } = parseOrThrow(listQuerySchema, request.query, 'query');
    const principal = principalOf(request);
    const stored = await container.persistence.comparisons.listByOrganization(
      principal.verified ? principal.organizationId : null,
      { limit },
    );

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
    const stored = await loadAccessibleComparison(request, container, comparisonId);
    // The stored result is the exact document produced when the comparison was made. Returning it
    // verbatim means a client re-reading a comparison sees the prices as quoted, not as they are
    // now — which is the whole point of persisting it.
    return envelope(request, stored.result);
  });

  app.post('/comparisons/:comparisonId/replay', async (request) => {
    const { comparisonId } = parseOrThrow(comparisonIdParamsSchema, request.params, 'params');
    await loadAccessibleComparison(request, container, comparisonId);
    const result = await container.comparisons.replay(comparisonId, {
      actor: principalOf(request).actor,
      requestId: request.id,
    });
    return envelope<ReplayResultDto>(request, result);
  });

  app.get('/comparisons/:comparisonId/audit', async (request) => {
    const { comparisonId } = parseOrThrow(comparisonIdParamsSchema, request.params, 'params');
    await loadAccessibleComparison(request, container, comparisonId);
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

async function loadAccessibleComparison(
  request: FastifyRequest,
  container: AppContainer,
  comparisonId: string,
): Promise<StoredComparison> {
  const stored = await container.persistence.comparisons.findById(comparisonId);
  if (
    stored === null ||
    !canAccessComparison(principalOf(request), stored.organizationId ?? null)
  ) {
    throw new NotFoundError('Comparison', comparisonId);
  }
  return stored;
}

/**
 * A public (unauthenticated) comparison is readable by anyone who has its id.
 * An organization-owned comparison is readable only by a verified principal of that tenant.
 * Missing rows and other tenants both 404, so the endpoint cannot be used to enumerate ids.
 */
function canAccessComparison(principal: Principal, organizationId: string | null): boolean {
  if (organizationId === null) {
    return true;
  }
  return principal.verified && principal.organizationId === organizationId;
}
