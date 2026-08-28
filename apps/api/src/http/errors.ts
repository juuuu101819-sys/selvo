import { ErrorCode, isAppError } from '@meridian/core';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { toPublicErrorResponse, type ErrorResponseBody } from './public-error.js';

export type { ErrorResponseBody } from './public-error.js';

/**
 * Single serialisation point for every failure the API returns.
 *
 * Operational errors (bad input, a corridor nobody prices) carry a stable public code and a
 * safe message. Anything else — Prisma, provider payloads, stack traces, Fastify parser wording —
 * is logged in full under the same `requestId` and answered with an opaque DTO (PA-M03).
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;
    const mapped = toPublicErrorResponse(error, requestId);

    if (isAppError(error) && error.operational) {
      request.log.info(
        { code: error.code, details: error.details, err: error, requestId },
        'Request failed with an operational error',
      );
    } else {
      request.log.error({ err: error, requestId }, 'Request failed; details withheld from client');
    }

    if (mapped.retryAfterSeconds !== undefined) {
      reply.header('Retry-After', String(mapped.retryAfterSeconds));
    }

    return reply.status(mapped.status).send(mapped.body);
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) =>
    reply.status(404).send({
      error: {
        code: ErrorCode.NOT_FOUND,
        message: `Route ${request.method} ${request.url} does not exist.`,
        details: {},
        requestId: request.id,
      },
    } satisfies ErrorResponseBody),
  );
}
