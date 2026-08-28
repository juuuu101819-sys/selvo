import type { RateLimitConsumeInput, RateLimitConsumeResult } from '@meridian/core';

interface Bucket {
  count: number;
  windowStartMs: number;
}

/**
 * Fixed-window increment used by both the in-memory store and tests of the algorithm.
 *
 * The PostgreSQL store implements the same transitions atomically in SQL.
 */
export function consumeFixedWindow(
  existing: Bucket | undefined,
  input: RateLimitConsumeInput,
): { readonly bucket: Bucket; readonly result: RateLimitConsumeResult } {
  const { limit, windowMs, nowMs } = input;
  if (existing === undefined || nowMs - existing.windowStartMs >= windowMs) {
    const bucket = { count: 1, windowStartMs: nowMs };
    return {
      bucket,
      result: {
        allowed: true,
        remaining: Math.max(0, limit - 1),
        retryAfterSeconds: 0,
        resetAtMs: nowMs + windowMs,
      },
    };
  }
  const resetAtMs = existing.windowStartMs + windowMs;
  if (existing.count >= limit) {
    return {
      bucket: existing,
      result: {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000)),
        resetAtMs,
      },
    };
  }
  const bucket = { count: existing.count + 1, windowStartMs: existing.windowStartMs };
  return {
    bucket,
    result: {
      allowed: true,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterSeconds: 0,
      resetAtMs,
    },
  };
}
