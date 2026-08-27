import { RateLimitedError } from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { principalOf } from './authentication.js';

export interface RateLimitSettings {
  readonly enabled: boolean;
  readonly windowMs: number;
  readonly max: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-process sliding-window counter.
 *
 * Sufficient for a single API process. Disabled in tests unless `RATE_LIMIT_MAX` is set, so the
 * comparison suite's many injects are not 429s.
 */
export function registerRateLimiting(app: FastifyInstance, settings: RateLimitSettings): void {
  if (!settings.enabled) {
    return;
  }

  const buckets = new Map<string, Bucket>();

  app.addHook('onRequest', (request: FastifyRequest) => {
    const now = Date.now();
    const key = rateLimitKey(request);
    const existing = buckets.get(key);
    if (existing === undefined || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + settings.windowMs });
      return;
    }
    if (existing.count >= settings.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      throw new RateLimitedError(retryAfterSeconds);
    }
    existing.count += 1;
  });
}

function rateLimitKey(request: FastifyRequest): string {
  const principal = principalOf(request);
  if (principal.organizationId !== null) {
    return `org:${principal.organizationId}`;
  }
  return `ip:${request.ip}`;
}
