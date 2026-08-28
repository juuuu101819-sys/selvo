import { PersistenceError, type RateLimitConsumeInput, type RateLimitConsumeResult, type RateLimitStore } from '@meridian/core';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

interface BucketRow {
  readonly hit_count: number;
  readonly window_started_at: Date;
}

/**
 * Shared rate-limit counters in PostgreSQL.
 *
 * Chosen over Redis because this stack already requires postgres in production (PA-C03) and has
 * no Redis (or other shared cache) dependency. A second rate-limit backend would be unrelated
 * infrastructure. The atomic `INSERT … ON CONFLICT` keeps the window consistent across replicas
 * and across process restarts.
 */
export class PrismaRateLimitStore implements RateLimitStore {
  constructor(private readonly client: PrismaClient) {}

  async consume(input: RateLimitConsumeInput): Promise<RateLimitConsumeResult> {
    const now = new Date(input.nowMs);
    const windowStartThreshold = new Date(input.nowMs - input.windowMs);
    const id = randomUUID();

    try {
      const rows = await this.client.$queryRaw<BucketRow[]>`
        INSERT INTO rate_limit_buckets (id, bucket_key, window_started_at, hit_count, updated_at)
        VALUES (${id}, ${input.key}, ${now}, 1, ${now})
        ON CONFLICT (bucket_key) DO UPDATE
        SET
          hit_count = CASE
            WHEN rate_limit_buckets.window_started_at <= ${windowStartThreshold} THEN 1
            ELSE rate_limit_buckets.hit_count + 1
          END,
          window_started_at = CASE
            WHEN rate_limit_buckets.window_started_at <= ${windowStartThreshold} THEN ${now}
            ELSE rate_limit_buckets.window_started_at
          END,
          updated_at = ${now}
        RETURNING hit_count, window_started_at
      `;
      const row = rows[0];
      if (row === undefined) {
        throw new PersistenceError('Rate-limit increment returned no row.');
      }
      const windowStartedMs = row.window_started_at.getTime();
      const resetAtMs = windowStartedMs + input.windowMs;
      if (row.hit_count > input.limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - input.nowMs) / 1000)),
          resetAtMs,
        };
      }
      return {
        allowed: true,
        remaining: Math.max(0, input.limit - row.hit_count),
        retryAfterSeconds: 0,
        resetAtMs,
      };
    } catch (error) {
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError('Failed to consume a rate-limit token.', {}, { cause: error });
    }
  }
}
