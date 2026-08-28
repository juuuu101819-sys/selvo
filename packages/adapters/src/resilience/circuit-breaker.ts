import type { Clock, Logger, ProviderId } from '@meridian/core';

export const DEFAULT_QUOTE_CIRCUIT_FAILURE_THRESHOLD = 3;
export const DEFAULT_QUOTE_CIRCUIT_COOLDOWN_MS = 30_000;

export type CircuitBreakerState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerSnapshot {
  readonly providerId: ProviderId;
  readonly state: CircuitBreakerState;
  readonly consecutiveFailures: number;
  readonly openedAt: string | null;
  readonly cooldownMs: number;
  readonly failureThreshold: number;
}

export interface CircuitBreakerOptions {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly failureThreshold?: number;
  readonly cooldownMs?: number;
}

export type CircuitAdmission = 'allow' | 'reject';

/**
 * Per-provider circuit for quote adapters.
 *
 * Open means stop calling a known-broken upstream. The wrapper turns that into
 * `supportsNormalized === false` so {@link FinancialProviderRegistry.eligible} drops the provider
 * from MultiRailRouter's candidate set. The router itself is unchanged.
 */
export class ProviderCircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private consecutiveFailures = 0;
  private openedAtMs: number | null = null;
  private halfOpenInFlight = false;

  readonly failureThreshold: number;
  readonly cooldownMs: number;

  constructor(
    readonly providerId: ProviderId,
    private readonly clock: Clock,
    private readonly logger: Logger,
    failureThreshold: number,
    cooldownMs: number,
  ) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
  }

  admit(): CircuitAdmission {
    this.maybeEnterHalfOpen();
    if (this.state === 'open') {
      return 'reject';
    }
    if (this.state === 'half_open') {
      if (this.halfOpenInFlight) {
        return 'reject';
      }
      this.halfOpenInFlight = true;
      return 'allow';
    }
    return 'allow';
  }

  /** Whether the provider may appear in the ranking candidate set. */
  allowsCandidates(): boolean {
    this.maybeEnterHalfOpen();
    return this.state !== 'open';
  }

  recordSuccess(): void {
    const wasOpen = this.state !== 'closed';
    this.consecutiveFailures = 0;
    this.openedAtMs = null;
    this.halfOpenInFlight = false;
    this.state = 'closed';
    if (wasOpen) {
      this.logger.info('Quote circuit breaker closed', { providerId: this.providerId });
    }
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    this.halfOpenInFlight = false;
    if (this.state === 'half_open' || this.consecutiveFailures >= this.failureThreshold) {
      this.trip();
    }
  }

  snapshot(): CircuitBreakerSnapshot {
    this.maybeEnterHalfOpen();
    return {
      providerId: this.providerId,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAtMs === null ? null : new Date(this.openedAtMs).toISOString(),
      cooldownMs: this.cooldownMs,
      failureThreshold: this.failureThreshold,
    };
  }

  private trip(): void {
    const alreadyOpen = this.state === 'open';
    this.state = 'open';
    this.openedAtMs = this.clock.nowMs();
    if (!alreadyOpen) {
      this.logger.warn('Quote circuit breaker opened', {
        providerId: this.providerId,
        consecutiveFailures: this.consecutiveFailures,
        cooldownMs: this.cooldownMs,
      });
    }
  }

  private maybeEnterHalfOpen(): void {
    if (this.state !== 'open' || this.openedAtMs === null) {
      return;
    }
    if (this.clock.nowMs() - this.openedAtMs < this.cooldownMs) {
      return;
    }
    this.state = 'half_open';
    this.halfOpenInFlight = false;
    this.logger.info('Quote circuit breaker half-open', { providerId: this.providerId });
  }
}

export class CircuitBreakerRegistry {
  private readonly breakers = new Map<ProviderId, ProviderCircuitBreaker>();
  readonly failureThreshold: number;
  readonly cooldownMs: number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.failureThreshold =
      options.failureThreshold ?? DEFAULT_QUOTE_CIRCUIT_FAILURE_THRESHOLD;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_QUOTE_CIRCUIT_COOLDOWN_MS;
  }

  forProvider(providerId: ProviderId): ProviderCircuitBreaker {
    const existing = this.breakers.get(providerId);
    if (existing !== undefined) {
      return existing;
    }
    const created = new ProviderCircuitBreaker(
      providerId,
      this.options.clock,
      this.options.logger,
      this.failureThreshold,
      this.cooldownMs,
    );
    this.breakers.set(providerId, created);
    return created;
  }

  snapshot(): readonly CircuitBreakerSnapshot[] {
    return [...this.breakers.values()]
      .map((breaker) => breaker.snapshot())
      .sort((left, right) => left.providerId.localeCompare(right.providerId, 'en'));
  }
}
