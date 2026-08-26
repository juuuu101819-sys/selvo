/**
 * Machine-readable error codes. Stable contract — clients may branch on these, so a code is
 * never repurposed. Each maps to exactly one HTTP status at the API boundary.
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNSUPPORTED_CURRENCY: 'UNSUPPORTED_CURRENCY',
  UNSUPPORTED_CORRIDOR: 'UNSUPPORTED_CORRIDOR',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  NO_ROUTES_AVAILABLE: 'NO_ROUTES_AVAILABLE',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  INVALID_PROVIDER_QUOTE: 'INVALID_PROVIDER_QUOTE',
  NOT_FOUND: 'NOT_FOUND',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  REPRODUCIBILITY_MISMATCH: 'REPRODUCIBILITY_MISMATCH',
  EXECUTION_NOT_IMPLEMENTED: 'EXECUTION_NOT_IMPLEMENTED',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  PERSISTENCE_ERROR: 'PERSISTENCE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export type ErrorDetails = Readonly<Record<string, unknown>>;

/**
 * Base class for every error the platform raises deliberately.
 *
 * `operational` distinguishes an expected condition (bad input, dead provider) from a defect.
 * Operational errors are safe to surface to the caller; non-operational ones are logged in full
 * and reported to the caller as an opaque internal error.
 */
export abstract class AppError extends Error {
  abstract readonly code: ErrorCodeValue;
  abstract readonly httpStatus: number;
  readonly operational: boolean = true;
  readonly details: ErrorDetails;

  constructor(message: string, details: ErrorDetails = {}, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }

  toJSON(): { code: ErrorCodeValue; message: string; details: ErrorDetails } {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export class ValidationError extends AppError {
  readonly code = ErrorCode.VALIDATION_ERROR;
  readonly httpStatus = 400;
}

export class UnsupportedCurrencyError extends AppError {
  readonly code = ErrorCode.UNSUPPORTED_CURRENCY;
  readonly httpStatus = 400;

  constructor(currency: string, supported: readonly string[]) {
    super(`Currency "${currency}" is not supported.`, { currency, supported });
  }
}

export class UnsupportedCorridorError extends AppError {
  readonly code = ErrorCode.UNSUPPORTED_CORRIDOR;
  readonly httpStatus = 422;

  constructor(sourceCurrency: string, targetCurrency: string) {
    super(
      `No provider prices the ${sourceCurrency} to ${targetCurrency} corridor in this mode.`,
      { sourceCurrency, targetCurrency },
    );
  }
}

export class InvalidAmountError extends AppError {
  readonly code = ErrorCode.INVALID_AMOUNT;
  readonly httpStatus = 400;
}

/**
 * Raised when arithmetic is attempted across two different currencies. This is a defect rather
 * than a user error: the caller passed mismatched money into a calculation.
 */
export class CurrencyMismatchError extends AppError {
  readonly code = ErrorCode.CURRENCY_MISMATCH;
  readonly httpStatus = 500;
  override readonly operational = false;

  constructor(left: string, right: string, operation: string) {
    super(`Cannot ${operation} across currencies: ${left} and ${right}.`, {
      left,
      right,
      operation,
    });
  }
}

export class NoRoutesAvailableError extends AppError {
  readonly code = ErrorCode.NO_ROUTES_AVAILABLE;
  readonly httpStatus = 422;
}

export class ProviderTimeoutError extends AppError {
  readonly code = ErrorCode.PROVIDER_TIMEOUT;
  readonly httpStatus = 504;

  constructor(providerId: string, timeoutMs: number) {
    super(`Provider "${providerId}" did not respond within ${timeoutMs}ms.`, {
      providerId,
      timeoutMs,
    });
  }
}

export class ProviderError extends AppError {
  readonly code = ErrorCode.PROVIDER_ERROR;
  readonly httpStatus = 502;

  constructor(providerId: string, message: string, options?: { cause?: unknown }) {
    super(`Provider "${providerId}" failed: ${message}`, { providerId }, options);
  }
}

/** A provider returned a payload that violates the {@link ProviderQuote} contract. */
export class InvalidProviderQuoteError extends AppError {
  readonly code = ErrorCode.INVALID_PROVIDER_QUOTE;
  readonly httpStatus = 502;

  constructor(providerId: string, reason: string, details: ErrorDetails = {}) {
    super(`Provider "${providerId}" returned an invalid quote: ${reason}`, {
      providerId,
      reason,
      ...details,
    });
  }
}

export class NotFoundError extends AppError {
  readonly code = ErrorCode.NOT_FOUND;
  readonly httpStatus = 404;

  constructor(resource: string, id: string) {
    super(`${resource} "${id}" was not found.`, { resource, id });
  }
}

export class IdempotencyConflictError extends AppError {
  readonly code = ErrorCode.IDEMPOTENCY_CONFLICT;
  readonly httpStatus = 409;

  constructor(idempotencyKey: string) {
    super(
      `Idempotency key "${idempotencyKey}" was already used with a different request payload.`,
      { idempotencyKey },
    );
  }
}

/**
 * A replay of a stored comparison snapshot did not reproduce the original result. This means the
 * engine is no longer deterministic for that input and is treated as a defect.
 */
export class ReproducibilityMismatchError extends AppError {
  readonly code = ErrorCode.REPRODUCIBILITY_MISMATCH;
  readonly httpStatus = 500;
  override readonly operational = false;

  constructor(comparisonId: string, expected: string, actual: string) {
    super(`Replay of comparison "${comparisonId}" produced a different fingerprint.`, {
      comparisonId,
      expectedFingerprint: expected,
      actualFingerprint: actual,
    });
  }
}

/**
 * Deliberate refusal to execute a transaction. The MVP is non-custodial and does not move money;
 * see docs/COMPLIANCE.md.
 */
export class ExecutionNotImplementedError extends AppError {
  readonly code = ErrorCode.EXECUTION_NOT_IMPLEMENTED;
  readonly httpStatus = 501;

  constructor() {
    super(
      'Meridian does not execute transactions. The platform is non-custodial and provides ' +
        'indicative route comparisons only. Execution requires a licensed partner of record and ' +
        'is not implemented.',
      { nonCustodial: true, documentation: 'docs/COMPLIANCE.md' },
    );
  }
}

export class ConfigurationError extends AppError {
  readonly code = ErrorCode.CONFIGURATION_ERROR;
  readonly httpStatus = 500;
  override readonly operational = false;
}

export class PersistenceError extends AppError {
  readonly code = ErrorCode.PERSISTENCE_ERROR;
  readonly httpStatus = 503;
}

export class InternalError extends AppError {
  readonly code = ErrorCode.INTERNAL_ERROR;
  readonly httpStatus = 500;
  override readonly operational = false;
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Normalises anything thrown into an {@link AppError}, preserving the original as `cause`. */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new InternalError(message, {}, { cause: error });
}
