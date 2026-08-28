import {
  ErrorCode,
  isAppError,
  type AppError,
  type ErrorCodeValue,
} from '@meridian/core';
import type { FastifyError } from 'fastify';

export interface ErrorResponseBody {
  readonly error: {
    readonly code: ErrorCodeValue | string;
    readonly message: string;
    readonly details: Readonly<Record<string, unknown>>;
    readonly requestId: string;
  };
}

const GENERIC_INTERNAL = 'An unexpected error occurred.';
const GENERIC_VALIDATION = 'Request could not be completed.';
const GENERIC_UPSTREAM = 'An upstream provider failed. Retry later.';
const GENERIC_PERSISTENCE = 'The data store is temporarily unavailable.';

const UNSAFE_TEXT =
  /prisma|postgres|sqlstate|\bP\d{4}\b|select\s+|insert\s+into|update\s+|delete\s+from|relation\s+"|column\s+"|at\s+\S+\s+\(|node_modules|ECONNREFUSED|authorization:\s*bearer|stack trace|clientversion|meta\.target|query\s+engine|datasource|password=|secret=|BEGIN [A-Z ]+PRIVATE KEY/i;

const UNSAFE_DETAIL_KEY =
  /^(stack|stacktrace|cause|exception|query|sql|prisma|meta|clientversion|response|config|env|headers|authorization|token|secret|password|credential)$/i;

function isUnsafeText(value: string): boolean {
  return UNSAFE_TEXT.test(value) || value.includes('\n    at ');
}

function looksLikePrisma(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const record = error as { code?: unknown; clientVersion?: unknown; meta?: unknown; name?: unknown };
  if (typeof record.code === 'string' && /^P\d{4}$/.test(record.code)) {
    return true;
  }
  if (typeof record.clientVersion === 'string') {
    return true;
  }
  if (typeof record.name === 'string' && record.name.startsWith('Prisma')) {
    return true;
  }
  return false;
}

function looksLikeProviderPayload(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const record = error as { response?: unknown; providerPayload?: unknown };
  return record.response !== undefined || record.providerPayload !== undefined;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return isUnsafeText(value) ? undefined : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue).filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    return sanitizeDetails(value as Record<string, unknown>);
  }
  return undefined;
}

function sanitizeDetails(
  details: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  if (details === undefined) {
    return {};
  }
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (UNSAFE_DETAIL_KEY.test(key)) {
      continue;
    }
    const sanitized = sanitizeValue(value);
    if (sanitized !== undefined) {
      safe[key] = sanitized;
    }
  }
  return safe;
}

function publicAppError(error: AppError, requestId: string): ErrorResponseBody {
  if (!error.operational) {
    return {
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: GENERIC_INTERNAL,
        details: {},
        requestId,
      },
    };
  }

  if (error.code === ErrorCode.PROVIDER_ERROR || error.code === ErrorCode.INVALID_PROVIDER_QUOTE) {
    const providerId = error.details['providerId'];
    return {
      error: {
        code: error.code,
        message: GENERIC_UPSTREAM,
        details: typeof providerId === 'string' ? { providerId } : {},
        requestId,
      },
    };
  }

  if (error.code === ErrorCode.PERSISTENCE_ERROR) {
    return {
      error: {
        code: error.code,
        message: GENERIC_PERSISTENCE,
        details: {},
        requestId,
      },
    };
  }

  const message = isUnsafeText(error.message) ? GENERIC_VALIDATION : error.message;
  return {
    error: {
      code: error.code,
      message,
      details: sanitizeDetails(error.details),
      requestId,
    },
  };
}

/**
 * Maps any thrown value to the canonical client error DTO.
 *
 * Stack traces, Prisma/SQL, and upstream provider payloads stay in the server log (correlated by
 * `requestId`) and must never appear in this object.
 */
export function toPublicErrorResponse(error: unknown, requestId: string): {
  readonly status: number;
  readonly body: ErrorResponseBody;
  readonly retryAfterSeconds?: number;
} {
  if (isAppError(error)) {
    const retryAfter = error.details['retryAfterSeconds'];
    return {
      status: error.operational ? error.httpStatus : 500,
      body: publicAppError(error, requestId),
      ...(typeof retryAfter === 'number' ? { retryAfterSeconds: retryAfter } : {}),
    };
  }

  if (looksLikePrisma(error) || looksLikeProviderPayload(error)) {
    return {
      status: 500,
      body: {
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message: GENERIC_INTERNAL,
          details: {},
          requestId,
        },
      },
    };
  }

  const fastifyError = error as FastifyError;
  if (
    typeof fastifyError.statusCode === 'number' &&
    fastifyError.statusCode >= 400 &&
    fastifyError.statusCode < 500
  ) {
    return {
      status: fastifyError.statusCode,
      body: {
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: GENERIC_VALIDATION,
          details: {},
          requestId,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: GENERIC_INTERNAL,
        details: {},
        requestId,
      },
    },
  };
}

export function errorLooksUnsafeForClient(text: string): boolean {
  return isUnsafeText(text);
}
