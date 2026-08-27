import { ErrorCode, isAppError } from '@meridian/core';

export interface RetryPolicy {
  /** Total attempts, including the first. `1` disables retrying. */
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
  /**
   * Fraction of the computed delay to randomise, `0`..`1`.
   *
   * Without jitter, every caller that fails at the same moment retries at the same moment, and a
   * provider recovering from a blip is immediately knocked over again by the synchronised herd.
   */
  readonly jitter: number;
}

export interface ResiliencePolicy {
  /** Timeout for a single attempt. */
  readonly timeoutMs: number;
  readonly retry: RetryPolicy;
  /**
   * Ceiling on the whole operation, retries and backoff included.
   *
   * Needed because per-attempt timeouts multiply: three attempts at four seconds is twelve seconds
   * of waiting, which is far longer than a caller comparing routes is willing to wait. The budget is
   * what keeps a slow provider from setting the latency of the entire comparison.
   */
  readonly overallTimeoutMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 1_000,
  backoffMultiplier: 2,
  jitter: 0.2,
};

export const DEFAULT_RESILIENCE_POLICY: ResiliencePolicy = {
  timeoutMs: 3_000,
  retry: DEFAULT_RETRY_POLICY,
  overallTimeoutMs: 8_000,
};

/**
 * Error codes worth retrying.
 *
 * Only transport-shaped failures. A timeout or an upstream error may well succeed on a second ask;
 * a rejected currency, a malformed quote or a stale feed will return exactly the same answer, so
 * retrying those wastes the caller's latency budget and adds load to a provider that is already
 * telling us something definite.
 *
 * `QUOTE_EXPIRED` is retryable and `QUOTE_STALE` is not, which looks inconsistent but is the point:
 * an expired price means ask again, whereas a persistently stale feed will keep returning the same
 * lagging price however many times it is asked.
 */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  ErrorCode.PROVIDER_TIMEOUT,
  ErrorCode.PROVIDER_ERROR,
  ErrorCode.PERSISTENCE_ERROR,
  ErrorCode.QUOTE_EXPIRED,
]);

export function isRetryable(error: unknown): boolean {
  if (isAppError(error)) {
    return RETRYABLE_CODES.has(error.code);
  }
  // An unrecognised throw is most often a transport fault — a socket reset, a DNS failure — which is
  // exactly the case retrying exists for.
  return true;
}

/**
 * Delay before the next attempt: exponential backoff, capped, then jittered.
 *
 * `random` is injected rather than read from `Math.random` so a test can assert the schedule
 * exactly. Reproducibility is a platform-wide requirement, and an un-injectable source of
 * randomness in the retry path would make failure behaviour untestable.
 */
export function backoffDelayMs(attempt: number, policy: RetryPolicy, random: () => number): number {
  const exponential = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1);
  const capped = Math.min(exponential, policy.maxDelayMs);
  const jitterRange = capped * policy.jitter;
  // Centred on the capped delay so jitter neither systematically delays nor systematically hurries.
  const offset = (random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(capped + offset));
}
