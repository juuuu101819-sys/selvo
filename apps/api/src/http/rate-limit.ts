import { RateLimitedError, type RateLimitStore } from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { principalOf } from './authentication.js';

export interface RateLimitSettings {
  readonly enabled: boolean;
  readonly windowMs: number;
  readonly max: number;
}

export interface RateLimitRegistration {
  readonly settings: RateLimitSettings;
  readonly store: RateLimitStore;
  readonly nowMs: () => number;
}

/**
 * Shared-backend rate limiter (PA-M02, Option B).
 *
 * Counters live on the persistence driver: PostgreSQL in production so every replica shares the
 * same windows (and a restart does not reset the distributed limit); an in-process map when the
 * memory driver is in use (a single process by definition). There is no Redis in this stack; this
 * is the roadmap's "Redis-based rate limit" item implemented on the existing shared store.
 *
 * Identity precedence: verified API-key/agent/user principal, then IP for anonymous callers.
 * Request body `userId`/`actorId` and `X-Meridian-Actor` are never used.
 */
export function registerRateLimiting(app: FastifyInstance, registration: RateLimitRegistration): void {
  if (!registration.settings.enabled) {
    return;
  }

  const { settings, store, nowMs } = registration;

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const consumed = await store.consume({
      key: rateLimitIdentity(request),
      limit: settings.max,
      windowMs: settings.windowMs,
      nowMs: nowMs(),
    });
    if (!consumed.allowed) {
      throw new RateLimitedError(consumed.retryAfterSeconds);
    }
  });
}

export function rateLimitIdentity(request: FastifyRequest): string {
  const principal = principalOf(request);
  if (
    principal.kind !== 'anonymous' &&
    principal.verified &&
    principal.subjectId !== null &&
    principal.subjectId !== ''
  ) {
    return `principal:${principal.kind}:${principal.subjectId}`;
  }
  return `ip:${request.ip}`;
}
