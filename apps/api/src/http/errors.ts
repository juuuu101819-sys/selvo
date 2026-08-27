import { ErrorCode, isAppError, RateLimitedError, type ErrorCodeValue } from '@meridian/core';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface ErrorResponseBody {
  readonly error: {
    readonly code: ErrorCodeValue;
    readonly message: string;
    readonly details: Readonly<Record<string, unknown>>;
    readonly requestId: string;
  };
}

/**
 * Single serialisation point for every failure the API returns.
 *
 * Operational errors (bad input, a corridor nobody prices, a dead provider) carry their own code,
 * status and safe details through to the client. Anything else is logged in full and answered with
 * an opaque `INTERNAL_ERROR`, so a stack trace or a connection string can never leak into a
 * response body.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;

    if (isAppError(error)) {
      if (error.operational) {
        request.log.info(
          { code: error.code, details: error.details, err: error },
          'Request failed with an operational error',
        );
      } else {
        request.log.error({ code: error.code, err: error }, 'Request failed with a defect');
      }

      if (error instanceof RateLimitedError) {
        const retryAfter = error.details['retryAfterSeconds'];
        if (typeof retryAfter === 'number') {
          reply.header('Retry-After', String(retryAfter));
        }
      }

      return reply.status(error.httpStatus).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId,
        },
      } satisfies ErrorResponseBody);
    }

    // Fastify's own failures: malformed JSON, payload too large, unsupported media type.
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      request.log.info({ err: error }, 'Malformed request rejected by the HTTP layer');
      return reply.status(error.statusCode).send({
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: error.message,
          details: {},
          requestId,
        },
      } satisfies ErrorResponseBody);
    }

    request.log.error({ err: error }, 'Unhandled error');
    return reply.status(500).send({
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'An unexpected error occurred.',
        details: {},
        requestId,
      },
    } satisfies ErrorResponseBody);
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
