import {
  FinancialProviderRegistry,
  FixedClock,
  MultiRailCostEngine,
  MultiRailRouter,
  SequentialIdGenerator,
  UnsupportedCorridorError,
  buildNormalizedQuote,
  buildProviderDescriptor,
  defaultProfileForRail,
  defaultRoutingWeights,
  freshnessPolicyForRail,
  noopLogger,
  type AuditEvent,
  type AuditEventInput,
  type AuditLogger,
  type FinancialProvider,
  type LogContext,
  type Logger,
  type NormalizedQuote,
  type NormalizedQuoteRequest,
  type ProviderContext,
  type ProviderHealth,
} from '@meridian/core';
import { describe, expect, it } from 'vitest';
import { CircuitBreakerRegistry } from './circuit-breaker.js';
import { QuoteCache } from './quote-cache.js';
import { wrapFinancialProvidersWithQuoteResilience } from './with-quote-resilience.js';

class RecordingLogger implements Logger {
  readonly warnings: { readonly message: string; readonly context: LogContext }[] = [];
  readonly infos: { readonly message: string; readonly context: LogContext }[] = [];

  debug(): void {
    return undefined;
  }
  info(message: string, context: LogContext = {}): void {
    this.infos.push({ message, context });
  }
  warn(message: string, context: LogContext = {}): void {
    this.warnings.push({ message, context });
  }
  error(): void {
    return undefined;
  }
  child(): Logger {
    return this;
  }
}

class RecordingAuditLogger implements AuditLogger {
  readonly events: AuditEvent[] = [];
  private sequence = 0;

  record(input: AuditEventInput): Promise<AuditEvent> {
    this.sequence += 1;
    const event: AuditEvent = {
      ...input,
      eventId: `evt_${this.sequence}`,
      occurredAt: '2026-03-01T09:00:00.000Z',
    };
    this.events.push(event);
    return Promise.resolve(event);
  }
}

class CountingProvider implements FinancialProvider {
  readonly capability = 'financial' as const;
  readonly descriptor;
  quoteCalls = 0;
  behaviour: 'quote' | 'fail';

  constructor(
    descriptor: Parameters<typeof buildProviderDescriptor>[0],
    private readonly source: string,
    private readonly target: string,
    behaviour: 'quote' | 'fail',
    private readonly indicatedRate = '1290',
  ) {
    this.behaviour = behaviour;
    this.descriptor = buildProviderDescriptor(descriptor);
  }

  getCapabilities() {
    return defaultProfileForRail(this.descriptor.rail);
  }

  getSupportedAssets() {
    return [];
  }

  getSupportedCurrencies() {
    return [];
  }

  supportsNormalized(request: NormalizedQuoteRequest): boolean {
    return request.sourceAsset === this.source && request.targetAsset === this.target;
  }

  async getQuote(request: NormalizedQuoteRequest, context: ProviderContext): Promise<NormalizedQuote> {
    this.quoteCalls += 1;
    await Promise.resolve();
    if (this.behaviour === 'fail' || !this.supportsNormalized(request)) {
      throw new Error('upstream unavailable');
    }
    return {
      ...buildNormalizedQuote({
        providerId: this.descriptor.id,
        sourceAsset: this.source,
        targetAsset: this.target,
        amountMinorUnits: request.amountMinorUnits,
        indicatedRate: this.indicatedRate,
        timestamp: context.clock.nowIso(),
        expiresAt: new Date(context.clock.nowMs() + 120_000).toISOString(),
      }),
    };
  }

  async getSettlementEstimate(request: NormalizedQuoteRequest, context: ProviderContext) {
    return (await this.getQuote(request, context)).settlement;
  }

  async getFees(request: NormalizedQuoteRequest, context: ProviderContext) {
    return (await this.getQuote(request, context)).fees;
  }

  async getLiquidityInfo(request: NormalizedQuoteRequest, context: ProviderContext) {
    return (await this.getQuote(request, context)).liquidity;
  }

  probe(context: ProviderContext): Promise<ProviderHealth> {
    return Promise.resolve({
      providerId: this.descriptor.id,
      state: 'up',
      checkedAt: context.clock.nowIso(),
      latencyMs: 0,
      detail: 'stub',
    });
  }
}

const REQUEST: NormalizedQuoteRequest = {
  sourceAsset: 'USD',
  targetAsset: 'KRW',
  amountMinorUnits: '10000000',
  requestedAt: '2026-03-01T09:00:00.000Z',
};

function contextFor(clock: FixedClock) {
  return {
    clock,
    logger: noopLogger,
    requestId: 'req_test',
    signal: undefined,
  };
}

describe('PA-L04 quote cache', () => {
  it('serves an identical request within the rail freshness window from cache', async () => {
    const clock = new FixedClock('2026-03-01T09:00:00.000Z');
    const inner = new CountingProvider({ id: 'bank', rail: 'bank_fx' }, 'USD', 'KRW', 'quote');
    const breakers = new CircuitBreakerRegistry({ clock, logger: noopLogger });
    const [wrapped] = wrapFinancialProvidersWithQuoteResilience([inner], {
      cache: new QuoteCache({ clock }),
      breakers,
    });
    if (wrapped === undefined) {
      throw new Error('expected wrapper');
    }

    const first = await wrapped.getQuote(REQUEST, contextFor(clock));
    const second = await wrapped.getQuote(REQUEST, contextFor(clock));

    expect(inner.quoteCalls).toBe(1);
    expect(second).toEqual(first);
    expect(freshnessPolicyForRail('bank_fx').maxAgeMs).toBe(120_000);
  });

  it('bypasses cache once the rail freshness window has elapsed', async () => {
    const clock = new FixedClock('2026-03-01T09:00:00.000Z');
    const inner = new CountingProvider({ id: 'bank', rail: 'bank_fx' }, 'USD', 'KRW', 'quote');
    const [wrapped] = wrapFinancialProvidersWithQuoteResilience([inner], {
      cache: new QuoteCache({ clock }),
      breakers: new CircuitBreakerRegistry({ clock, logger: noopLogger }),
    });
    if (wrapped === undefined) {
      throw new Error('expected wrapper');
    }

    await wrapped.getQuote(REQUEST, contextFor(clock));
    clock.advance(freshnessPolicyForRail('bank_fx').maxAgeMs + 1);
    await wrapped.getQuote(
      { ...REQUEST, requestedAt: clock.nowIso() },
      contextFor(clock),
    );

    expect(inner.quoteCalls).toBe(2);
  });
});

describe('PA-L04 circuit breaker', () => {
  it('excludes a provider that exceeds the failure threshold from ranking and is observable', async () => {
    const clock = new FixedClock('2026-03-01T09:00:00.000Z');
    const logger = new RecordingLogger();
    const breakers = new CircuitBreakerRegistry({
      clock,
      logger,
      failureThreshold: 3,
      cooldownMs: 30_000,
    });
    const cache = new QuoteCache({ clock });
    const failing = new CountingProvider({ id: 'broken', rail: 'bank_fx' }, 'USD', 'KRW', 'fail');
    const healthy = new CountingProvider(
      { id: 'healthy', name: 'Healthy', rail: 'payment_institution' },
      'USD',
      'KRW',
      'quote',
      '1294',
    );
    const [brokenWrapped, healthyWrapped] = wrapFinancialProvidersWithQuoteResilience(
      [failing, healthy],
      { cache, breakers },
    );
    if (brokenWrapped === undefined || healthyWrapped === undefined) {
      throw new Error('expected wrappers');
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(brokenWrapped.getQuote(REQUEST, contextFor(clock))).rejects.toThrow(
        /upstream unavailable/,
      );
    }

    expect(failing.quoteCalls).toBe(3);
    expect(brokenWrapped.supportsNormalized(REQUEST)).toBe(false);
    expect(healthyWrapped.supportsNormalized(REQUEST)).toBe(true);

    const snapshot = breakers.snapshot();
    expect(snapshot.find((row) => row.providerId === 'broken')).toMatchObject({
      state: 'open',
      consecutiveFailures: 3,
    });
    expect(logger.warnings.some((entry) => entry.message === 'Quote circuit breaker opened')).toBe(
      true,
    );

    const registry = FinancialProviderRegistry.create('sandbox', [brokenWrapped, healthyWrapped]);
    expect(registry.eligible(REQUEST).map((provider) => provider.descriptor.id)).toEqual(['healthy']);

    const routing = new MultiRailRouter({
      mode: 'sandbox',
      registry,
      costEngine: new MultiRailCostEngine(),
      defaultWeights: defaultRoutingWeights(),
      clock,
      ids: new SequentialIdGenerator(),
      auditLogger: new RecordingAuditLogger(),
      logger: noopLogger,
      providerTimeoutMs: 1_000,
    });
    const result = await routing.evaluate({
      organizationId: null,
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amountMinorUnits: '10000000',
      weights: null,
      actor: 'test',
      requestId: 'req_1',
    });
    expect(result.routes.map((route) => route.provider.id)).toEqual(['healthy']);
    expect(result.providerFailures.map((failure) => failure.providerId)).not.toContain('broken');
    expect(healthy.quoteCalls).toBe(1);
    expect(failing.quoteCalls).toBe(3);
  });

  it('resets after the cooldown and admits the provider again', async () => {
    const clock = new FixedClock('2026-03-01T09:00:00.000Z');
    const logger = new RecordingLogger();
    const breakers = new CircuitBreakerRegistry({
      clock,
      logger,
      failureThreshold: 3,
      cooldownMs: 30_000,
    });
    const inner = new CountingProvider({ id: 'flaky', rail: 'bank_fx' }, 'USD', 'KRW', 'fail');
    const [wrapped] = wrapFinancialProvidersWithQuoteResilience([inner], {
      cache: new QuoteCache({ clock }),
      breakers,
    });
    if (wrapped === undefined) {
      throw new Error('expected wrapper');
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(wrapped.getQuote(REQUEST, contextFor(clock))).rejects.toThrow();
    }
    expect(wrapped.supportsNormalized(REQUEST)).toBe(false);
    expect(breakers.snapshot()[0]?.state).toBe('open');

    clock.advance(30_000);
    expect(wrapped.supportsNormalized(REQUEST)).toBe(true);
    expect(breakers.snapshot()[0]?.state).toBe('half_open');
    expect(logger.infos.some((entry) => entry.message === 'Quote circuit breaker half-open')).toBe(
      true,
    );

    inner.behaviour = 'quote';
    const recovered = await wrapped.getQuote(REQUEST, contextFor(clock));
    expect(recovered.providerId).toBe('flaky');
    expect(breakers.snapshot()[0]?.state).toBe('closed');
    expect(wrapped.supportsNormalized(REQUEST)).toBe(true);
    expect(logger.infos.some((entry) => entry.message === 'Quote circuit breaker closed')).toBe(
      true,
    );
  });

  it('does not fail the whole comparison when one provider is open', async () => {
    const clock = new FixedClock('2026-03-01T09:00:00.000Z');
    const breakers = new CircuitBreakerRegistry({
      clock,
      logger: noopLogger,
      failureThreshold: 1,
      cooldownMs: 30_000,
    });
    const failing = new CountingProvider({ id: 'broken', rail: 'bank_fx' }, 'USD', 'KRW', 'fail');
    const healthy = new CountingProvider(
      { id: 'healthy', rail: 'payment_institution' },
      'USD',
      'KRW',
      'quote',
    );
    const wrapped = wrapFinancialProvidersWithQuoteResilience([failing, healthy], {
      cache: new QuoteCache({ clock }),
      breakers,
    });
    await expect(wrapped[0]?.getQuote(REQUEST, contextFor(clock))).rejects.toThrow();

    const routing = new MultiRailRouter({
      mode: 'sandbox',
      registry: FinancialProviderRegistry.create('sandbox', wrapped),
      costEngine: new MultiRailCostEngine(),
      defaultWeights: defaultRoutingWeights(),
      clock,
      ids: new SequentialIdGenerator(),
      auditLogger: new RecordingAuditLogger(),
      logger: noopLogger,
      providerTimeoutMs: 1_000,
    });
    await expect(
      routing.evaluate({
        organizationId: null,
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amountMinorUnits: '10000000',
        weights: null,
        actor: 'test',
        requestId: 'req_1',
      }),
    ).resolves.toMatchObject({ routes: [expect.objectContaining({ provider: expect.objectContaining({ id: 'healthy' }) })] });
  });

  it('still fails the corridor when every eligible provider is open', async () => {
    const clock = new FixedClock('2026-03-01T09:00:00.000Z');
    const breakers = new CircuitBreakerRegistry({
      clock,
      logger: noopLogger,
      failureThreshold: 1,
      cooldownMs: 30_000,
    });
    const failing = new CountingProvider({ id: 'broken', rail: 'bank_fx' }, 'USD', 'KRW', 'fail');
    const [wrapped] = wrapFinancialProvidersWithQuoteResilience([failing], {
      cache: new QuoteCache({ clock }),
      breakers,
    });
    await expect(wrapped?.getQuote(REQUEST, contextFor(clock))).rejects.toThrow();

    const routing = new MultiRailRouter({
      mode: 'sandbox',
      registry: FinancialProviderRegistry.create('sandbox', wrapped === undefined ? [] : [wrapped]),
      costEngine: new MultiRailCostEngine(),
      defaultWeights: defaultRoutingWeights(),
      clock,
      ids: new SequentialIdGenerator(),
      auditLogger: new RecordingAuditLogger(),
      logger: noopLogger,
      providerTimeoutMs: 1_000,
    });
    await expect(
      routing.evaluate({
        organizationId: null,
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amountMinorUnits: '10000000',
        weights: null,
        actor: 'test',
        requestId: 'req_1',
      }),
    ).rejects.toBeInstanceOf(UnsupportedCorridorError);
  });
});
