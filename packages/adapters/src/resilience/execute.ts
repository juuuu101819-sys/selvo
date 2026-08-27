import {
  ProviderError,
  ProviderTimeoutError,
  noopQuoteRecorder,
  toAppError,
  type Clock,
  type JsonObject,
  type Logger,
  type ProviderCapability,
  type ProviderContext,
  type QuoteRecorder,
} from '@meridian/core';
import {
  DEFAULT_RESILIENCE_POLICY,
  backoffDelayMs,
  isRetryable,
  type ResiliencePolicy,
} from './policy.js';

export interface ResilienceDependencies {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly recorder?: QuoteRecorder;
  /** Injected so a test can assert the backoff schedule exactly. */
  readonly random?: () => number;
  /** Injected so a test need not wait out real backoff delays. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface ProviderCallOptions<TResult> {
  readonly providerId: string;
  readonly capability: ProviderCapability;
  /** The adapter method being called, recorded against every attempt. */
  readonly operation: string;
  /** The request, as recorded. Must contain no secret. */
  readonly request: JsonObject;
  readonly policy?: ResiliencePolicy;
  readonly correlationId?: string | null;
  /**
   * The call itself. Receives a per-attempt `AbortSignal`; an adapter that talks to the network
   * should pass it to `fetch` so a timed-out attempt stops consuming a socket.
   */
  execute(context: { readonly signal: AbortSignal; readonly attempt: number }): Promise<TResult>;
  /** Projects the result into the recorded form. Must contain no secret. */
  toRecord?(result: TResult): JsonObject;
}

export interface ProviderCallResult<TResult> {
  readonly result: TResult;
  readonly attempts: number;
  readonly latencyMs: number;
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    // Never hold the process open for a backoff delay.
    timer.unref?.();
  });

/**
 * Runs a provider call with a per-attempt timeout, bounded retries and recording.
 *
 * This exists once, here, rather than in each adapter. Every provider integration needs the same
 * behaviour, and duplicating it is how one adapter ends up quietly missing a timeout — the failure
 * mode that takes a comparison from "one route missing" to "the whole request hangs".
 *
 * Ordering matters and is deliberate:
 *
 *   1. The overall budget is checked before each attempt, so a slow provider cannot set the latency
 *      of the whole comparison however its per-attempt timeouts fall.
 *   2. A timed-out attempt is aborted, so the adapter can stop work rather than leaking a socket.
 *   3. Only transport-shaped failures are retried; a rejected currency returns the same answer
 *      however often it is asked.
 *   4. Every attempt is recorded, success or failure, before the error propagates.
 */
export async function executeProviderCall<TResult>(
  options: ProviderCallOptions<TResult>,
  deps: ResilienceDependencies,
): Promise<ProviderCallResult<TResult>> {
  const policy = options.policy ?? DEFAULT_RESILIENCE_POLICY;
  const recorder = deps.recorder ?? noopQuoteRecorder;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;

  const startedMs = deps.clock.nowMs();
  const requestedAt = deps.clock.nowIso();
  const deadlineMs = startedMs + policy.overallTimeoutMs;

  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.retry.maxAttempts; attempt += 1) {
    const remainingMs = deadlineMs - deps.clock.nowMs();
    if (remainingMs <= 0) {
      lastError = new ProviderTimeoutError(options.providerId, policy.overallTimeoutMs);
      break;
    }

    // The attempt gets whichever is shorter: its own timeout, or what is left of the budget.
    const attemptTimeoutMs = Math.min(policy.timeoutMs, remainingMs);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const pending = options.execute({ signal: controller.signal, attempt });
      // A late rejection after the timeout has won the race would otherwise surface as an unhandled
      // rejection; the race still observes the original outcome.
      void pending.catch(() => undefined);

      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ProviderTimeoutError(options.providerId, attemptTimeoutMs));
        }, attemptTimeoutMs);
      });

      const result = await Promise.race([pending, timeout]);
      const receivedAt = deps.clock.nowIso();

      await recorder.record({
        providerId: options.providerId,
        capability: options.capability,
        operation: options.operation,
        requestedAt,
        receivedAt,
        outcome: 'quoted',
        attempts: attempt,
        correlationId: options.correlationId ?? null,
        request: options.request,
        quote: options.toRecord?.(result) ?? null,
        error: null,
      });

      return {
        result,
        attempts: attempt,
        latencyMs: deps.clock.nowMs() - startedMs,
      };
    } catch (error) {
      lastError = error;
      const appError = toAppError(error);
      const retryable = isRetryable(error);
      const attemptsLeft = attempt < policy.retry.maxAttempts;

      await recorder.record({
        providerId: options.providerId,
        capability: options.capability,
        operation: options.operation,
        requestedAt,
        receivedAt: deps.clock.nowIso(),
        outcome: 'failed',
        attempts: attempt,
        correlationId: options.correlationId ?? null,
        request: options.request,
        quote: null,
        error: { code: appError.code, message: appError.message },
      });

      deps.logger.warn('Provider call failed', {
        providerId: options.providerId,
        operation: options.operation,
        attempt,
        code: appError.code,
        retryable,
        willRetry: retryable && attemptsLeft,
      });

      if (!retryable || !attemptsLeft) {
        break;
      }

      const delayMs = backoffDelayMs(attempt, policy.retry, random);
      const budgetLeftMs = deadlineMs - deps.clock.nowMs();
      if (delayMs >= budgetLeftMs) {
        // Sleeping would consume the whole remaining budget and leave no time to actually retry.
        break;
      }
      await sleep(delayMs);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  throw normaliseFailure(options.providerId, lastError);
}

function normaliseFailure(providerId: string, error: unknown): Error {
  const appError = toAppError(error);
  // A raw throw from an adapter becomes a ProviderError, so callers can classify it by code rather
  // than by inspecting whatever the upstream client happened to raise.
  if (appError.code === 'INTERNAL_ERROR') {
    return new ProviderError(providerId, appError.message, { cause: error });
  }
  return appError;
}

/** Derives a per-attempt provider context from an ambient one. */
export function attemptContext(context: ProviderContext, signal: AbortSignal): ProviderContext {
  return { ...context, signal };
}
