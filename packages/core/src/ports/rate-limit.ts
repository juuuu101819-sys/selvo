/**
 * Shared rate-limit counters.
 *
 * Identity for the bucket key is chosen by the HTTP layer (verified principal, then IP). This
 * port only stores and increments. PostgreSQL is the production backend so limits hold across
 * API replicas; the memory driver keeps an in-process map (single process by definition).
 */
export interface RateLimitConsumeInput {
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
  readonly nowMs: number;
}

export interface RateLimitConsumeResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
  readonly resetAtMs: number;
}

export interface RateLimitStore {
  consume(input: RateLimitConsumeInput): Promise<RateLimitConsumeResult>;
}
