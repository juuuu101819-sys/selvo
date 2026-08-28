import type { RateLimitConsumeInput, RateLimitConsumeResult, RateLimitStore } from '@meridian/core';
import { consumeFixedWindow } from './fixed-window.js';

/**
 * In-process counters. Correct for the memory persistence driver (one process by definition).
 * Production uses {@link PrismaRateLimitStore} so replicas share the same windows.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; windowStartMs: number }>();

  consume(input: RateLimitConsumeInput): Promise<RateLimitConsumeResult> {
    const { bucket, result } = consumeFixedWindow(this.buckets.get(input.key), input);
    this.buckets.set(input.key, bucket);
    return Promise.resolve(result);
  }
}
