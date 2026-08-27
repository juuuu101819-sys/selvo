import { beforeEach, describe, expect, it } from 'vitest';
import type { ComparisonSnapshot } from '../domain/index.js';
import {
  ConfigurationError,
  NoRoutesAvailableError,
  NotFoundError,
  ProviderError,
  UnsupportedCorridorError,
  ValidationError,
} from '../errors/index.js';
import { fingerprint } from '../reproducibility/index.js';
import {
  FixedClock,
  SequentialIdGenerator,
  noopLogger,
  type AuditEvent,
  type AuditEventInput,
  type AuditLogger,
  type ComparisonRepository,
  type StoredComparison,
} from '../ports/index.js';
import { StubRouteProvider, buildProviderQuote } from '../testing/index.js';
import { RouteComparisonService, type ComparisonInput } from './comparison-service.js';
import { RouteCostEngine } from './cost-engine.js';
import { defaultScoringWeights } from './engine-config.js';
import { ProviderRegistry } from './provider-registry.js';

class FakeComparisonRepository implements ComparisonRepository {
  readonly saved: StoredComparison[] = [];

  save(comparison: StoredComparison): Promise<void> {
    this.saved.push(comparison);
    return Promise.resolve();
  }

  findById(comparisonId: string): Promise<StoredComparison | null> {
    return Promise.resolve(this.saved.find((item) => item.comparisonId === comparisonId) ?? null);
  }

  findByIdempotencyKey(key: string): Promise<StoredComparison | null> {
    return Promise.resolve(this.saved.find((item) => item.idempotencyKey === key) ?? null);
  }

  list(): Promise<readonly StoredComparison[]> {
    return Promise.resolve([...this.saved].reverse());
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
      occurredAt: '2026-01-01T00:00:00.000Z',
    };
    this.events.push(event);
    return Promise.resolve(event);
  }

  typesFor(type: AuditEvent['type']): readonly AuditEvent[] {
    return this.events.filter((event) => event.type === type);
  }
}

const BANK = new StubRouteProvider(
  { id: 'bank', name: 'Global Bank', rail: 'bank_fx' },
  {
    kind: 'quote',
    quote: buildProviderQuote({
      providerId: 'bank',
      rail: 'bank_fx',
      midMarketRate: '1300',
      offeredRate: '1290.64',
      settlement: { p50Seconds: 86_400, p95Seconds: 172_800, businessDaysOnly: true },
      reliabilityScore: '0.995',
    }),
  },
);

const FX_PROVIDER = new StubRouteProvider(
  { id: 'fx', name: 'FX Provider', rail: 'payment_institution' },
  {
    kind: 'quote',
    quote: buildProviderQuote({
      providerId: 'fx',
      rail: 'payment_institution',
      midMarketRate: '1300',
      offeredRate: '1293.76',
      settlement: { p50Seconds: 7_200, p95Seconds: 21_600 },
      reliabilityScore: '0.99',
    }),
  },
);

const STABLECOIN = new StubRouteProvider(
  { id: 'coin', name: 'Stablecoin Partner', rail: 'stablecoin_settlement' },
  {
    kind: 'quote',
    quote: buildProviderQuote({
      providerId: 'coin',
      rail: 'stablecoin_settlement',
      midMarketRate: '1300',
      offeredRate: '1295.58',
      settlement: { p50Seconds: 300, p95Seconds: 900 },
      reliabilityScore: '0.985',
      intermediaryAsset: 'USDC',
    }),
  },
);

function buildService(
  providers: readonly StubRouteProvider[],
  options: { providerTimeoutMs?: number } = {},
): {
  service: RouteComparisonService;
  repository: FakeComparisonRepository;
  audit: RecordingAuditLogger;
  clock: FixedClock;
} {
  const repository = new FakeComparisonRepository();
  const audit = new RecordingAuditLogger();
  const clock = new FixedClock('2026-03-01T09:00:00.000Z');

  const service = new RouteComparisonService({
    mode: 'sandbox',
    registry: ProviderRegistry.create('sandbox', providers),
    costEngine: new RouteCostEngine(),
    defaultWeights: defaultScoringWeights(),
    clock,
    ids: new SequentialIdGenerator(),
    auditLogger: audit,
    comparisons: repository,
    logger: noopLogger,
    providerTimeoutMs: options.providerTimeoutMs ?? 1_000,
  });

  return { service, repository, audit, clock };
}

function input(overrides: Partial<ComparisonInput> = {}): ComparisonInput {
  return {
    sourceCurrency: 'USD',
    targetCurrency: 'KRW',
    amountMinorUnits: '10000000',
    rails: null,
    weights: null,
    idempotencyKey: null,
    actor: 'test-user',
    requestId: 'req-1',
    ...overrides,
  };
}

describe('RouteComparisonService', () => {
  let harness: ReturnType<typeof buildService>;

  beforeEach(() => {
    harness = buildService([BANK, FX_PROVIDER, STABLECOIN]);
  });

  describe('comparing routes', () => {
    it('prices every provider and recommends the best route', async () => {
      const comparison = await harness.service.compare(input());

      expect(comparison.routes).toHaveLength(3);
      expect(comparison.recommendedRouteId).toBe('coin:stablecoin_settlement');
      expect(comparison.routes.map((route) => route.rank)).toEqual([1, 2, 3]);
      expect(comparison.providerFailures).toEqual([]);
      expect(comparison.mode).toBe('sandbox');
    });

    it('reproduces the cost figures from the product brief', async () => {
      const comparison = await harness.service.compare(input());
      const costs = Object.fromEntries(
        comparison.routes.map((route) => [
          route.provider.id,
          route.totalCostBps.dividedBy(100).toFixed(2),
        ]),
      );

      expect(costs).toEqual({ bank: '0.72', fx: '0.48', coin: '0.34' });
    });

    it('records the send amount and corridor on the comparison request', async () => {
      const comparison = await harness.service.compare(input());
      expect(comparison.request).toMatchObject({
        sourceCurrency: 'USD',
        targetCurrency: 'KRW',
        amountMinorUnits: '10000000',
        requestedAt: '2026-03-01T09:00:00.000Z',
      });
    });

    it('honours a rail filter', async () => {
      const comparison = await harness.service.compare(
        input({ rails: ['bank_fx', 'stablecoin_settlement'] }),
      );
      expect(comparison.routes.map((route) => route.rail)).toEqual([
        'stablecoin_settlement',
        'bank_fx',
      ]);
    });

    it('honours per-request scoring weights', async () => {
      const comparison = await harness.service.compare(
        input({ weights: { cost: '0', speed: '0', reliability: '1' } }),
      );
      expect(comparison.recommendedRouteId).toBe('bank:bank_fx');
    });

    it('rejects weights that do not sum to 1', async () => {
      await expect(
        harness.service.compare(input({ weights: { cost: '1', speed: '1', reliability: '1' } })),
      ).rejects.toThrow(ValidationError);
    });

    it('rejects a same-currency corridor', async () => {
      await expect(
        harness.service.compare(input({ sourceCurrency: 'USD', targetCurrency: 'USD' })),
      ).rejects.toThrow(ValidationError);
    });

    it('rejects a non-positive amount', async () => {
      await expect(harness.service.compare(input({ amountMinorUnits: '0' }))).rejects.toThrow(
        ValidationError,
      );
    });

    it('reports an unsupported corridor when no provider is eligible', async () => {
      const declining = new StubRouteProvider(
        { id: 'declines' },
        { kind: 'quote', quote: buildProviderQuote() },
        false,
      );
      const { service } = buildService([declining]);

      await expect(service.compare(input())).rejects.toThrow(UnsupportedCorridorError);
    });

    it('names the amount and rail filter in an ineligibility error, not just the corridor', async () => {
      const declining = new StubRouteProvider(
        { id: 'declines', rail: 'bank_fx' },
        { kind: 'quote', quote: buildProviderQuote() },
        false,
      );
      const { service } = buildService([declining]);

      await expect(service.compare(input({ rails: ['bank_fx'] }))).rejects.toThrowError(
        /removing the rail filter/,
      );
      await expect(service.compare(input())).rejects.toThrowError(
        /100000.00 USD.*outside every provider/s,
      );
    });
  });

  describe('insights', () => {
    it('quantifies the saving against the most expensive and the bank baseline', async () => {
      const comparison = await harness.service.compare(input());
      const insights = comparison.insights;

      expect(insights?.cheapestRouteId).toBe('coin:stablecoin_settlement');
      expect(insights?.fastestRouteId).toBe('coin:stablecoin_settlement');
      expect(insights?.mostExpensiveRouteId).toBe('bank:bank_fx');
      // Bank delivers KRW 129,064,000, stablecoin KRW 129,558,000.
      expect(insights?.savingsVsMostExpensive.toJSON().minorUnits).toBe('494000');
      expect(insights?.savingsVsBankFx?.toJSON().minorUnits).toBe('494000');
    });

    it('reports no bank baseline when no bank route was returned', async () => {
      const { service } = buildService([FX_PROVIDER, STABLECOIN]);
      const comparison = await service.compare(input());
      expect(comparison.insights?.savingsVsBankFx).toBeNull();
    });
  });

  describe('degrading gracefully', () => {
    it('returns the routes that answered and reports the provider that failed', async () => {
      const broken = new StubRouteProvider(
        { id: 'broken', rail: 'liquidity_provider' },
        { kind: 'reject', error: new ProviderError('broken', 'upstream 503') },
      );
      const { service } = buildService([BANK, broken]);

      const comparison = await service.compare(input());

      expect(comparison.routes.map((route) => route.provider.id)).toEqual(['bank']);
      expect(comparison.providerFailures).toEqual([
        {
          providerId: 'broken',
          rail: 'liquidity_provider',
          code: 'PROVIDER_ERROR',
          message: 'Provider "broken" failed: upstream 503',
          failedAt: '2026-03-01T09:00:00.000Z',
        },
      ]);
    });

    it('times out a provider that never responds', async () => {
      const hanging = new StubRouteProvider({ id: 'hanging' }, { kind: 'hang' });
      const { service } = buildService([BANK, hanging], { providerTimeoutMs: 20 });

      const comparison = await service.compare(input());

      expect(comparison.routes).toHaveLength(1);
      expect(comparison.providerFailures[0]).toMatchObject({
        providerId: 'hanging',
        code: 'PROVIDER_TIMEOUT',
      });
    });

    it('records a provider whose quote cannot be priced without failing the comparison', async () => {
      const inconsistent = new StubRouteProvider(
        { id: 'inconsistent' },
        {
          kind: 'quote',
          // Fees that exceed the send amount make this quote unpriceable.
          quote: buildProviderQuote({
            providerId: 'inconsistent',
            fees: {
              components: [
                {
                  kind: 'fixed',
                  code: 'absurd',
                  label: 'Absurd',
                  side: 'source',
                  currency: 'USD',
                  amountMinorUnits: '999999999',
                },
              ],
            },
          }),
        },
      );
      const { service } = buildService([BANK, inconsistent]);

      const comparison = await service.compare(input());

      expect(comparison.routes).toHaveLength(1);
      expect(comparison.providerFailures[0]).toMatchObject({
        providerId: 'inconsistent',
        code: 'INVALID_AMOUNT',
      });
    });

    it('fails the comparison when every provider fails', async () => {
      const broken = new StubRouteProvider(
        { id: 'broken' },
        { kind: 'reject', error: new ProviderError('broken', 'down') },
      );
      const { service } = buildService([broken]);

      await expect(service.compare(input())).rejects.toThrow(NoRoutesAvailableError);
    });
  });

  describe('reproducibility', () => {
    it('stores a snapshot that replays to the same fingerprint', async () => {
      const comparison = await harness.service.compare(input());
      const replay = await harness.service.replay(comparison.comparisonId, {
        actor: 'auditor',
        requestId: 'req-2',
      });

      expect(replay.reproducible).toBe(true);
      expect(replay.replayedFingerprint).toBe(comparison.fingerprint);
      expect(replay.comparison.routes.map((route) => route.routeId)).toEqual(
        comparison.routes.map((route) => route.routeId),
      );
      expect(replay.comparison.routes.map((route) => route.totalCost.toJSON().minorUnits)).toEqual(
        comparison.routes.map((route) => route.totalCost.toJSON().minorUnits),
      );
    });

    it('produces the same fingerprint for two identical requests', async () => {
      const first = await harness.service.compare(input());
      const second = await harness.service.compare(input());

      expect(second.fingerprint).toBe(first.fingerprint);
      expect(second.comparisonId).not.toBe(first.comparisonId);
    });

    it('produces a different fingerprint when the amount changes', async () => {
      const first = await harness.service.compare(input());
      const second = await harness.service.compare(input({ amountMinorUnits: '10000001' }));

      expect(second.fingerprint).not.toBe(first.fingerprint);
    });

    it('captures provider descriptors so a replay is self-contained', async () => {
      const comparison = await harness.service.compare(input());
      const snapshot: ComparisonSnapshot = comparison.snapshot;

      expect(snapshot.providers.map((provider) => provider.id)).toEqual(['bank', 'coin', 'fx']);
      expect(snapshot.quotes.map((quote) => quote.providerId)).toEqual(['bank', 'coin', 'fx']);
      expect(snapshot.snapshotVersion).toBe(1);
    });

    it('sorts snapshot quotes by provider id so response order cannot affect the hash', async () => {
      const forward = buildService([BANK, FX_PROVIDER, STABLECOIN]);
      const reversed = buildService([STABLECOIN, FX_PROVIDER, BANK]);

      const a = await forward.service.compare(input());
      const b = await reversed.service.compare(input());

      expect(b.fingerprint).toBe(a.fingerprint);
    });

    it('reports a missing comparison rather than inventing one', async () => {
      await expect(
        harness.service.replay('cmp_missing', { actor: 'auditor', requestId: null }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('idempotency', () => {
    it('returns the stored comparison for a repeated idempotency key', async () => {
      const first = await harness.service.compare(input({ idempotencyKey: 'key-1' }));
      const second = await harness.service.compare(input({ idempotencyKey: 'key-1' }));

      expect(second.comparisonId).toBe(first.comparisonId);
      expect(second.fingerprint).toBe(first.fingerprint);
      expect(harness.repository.saved).toHaveLength(1);
    });

    it('treats different keys as different comparisons', async () => {
      const first = await harness.service.compare(input({ idempotencyKey: 'key-1' }));
      const second = await harness.service.compare(input({ idempotencyKey: 'key-2' }));

      expect(second.comparisonId).not.toBe(first.comparisonId);
      expect(harness.repository.saved).toHaveLength(2);
    });
  });

  describe('audit trail', () => {
    it('records the request, each provider quote and the completion', async () => {
      const comparison = await harness.service.compare(input());
      const types = harness.audit.events.map((event) => event.type);

      expect(types).toContain('comparison.requested');
      expect(types).toContain('comparison.completed');
      expect(harness.audit.typesFor('provider.quote.received')).toHaveLength(3);
      expect(harness.audit.events.every((event) => event.actor === 'test-user')).toBe(true);
      expect(harness.audit.typesFor('comparison.completed')[0]?.payload['fingerprint']).toBe(
        comparison.fingerprint,
      );
    });

    it('correlates every provider quote to the comparison it was fetched for', async () => {
      const comparison = await harness.service.compare(input());
      const correlated = harness.audit.events.filter(
        (event) => event.comparisonId === comparison.comparisonId,
      );

      // Without a comparison id on the provider events, the per-comparison audit trail would show
      // the request and the result but not which provider quoted what.
      expect(correlated.filter((event) => event.type === 'provider.quote.received')).toHaveLength(
        3,
      );
      expect(correlated.map((event) => event.type)).toContain('comparison.requested');
      expect(correlated.map((event) => event.type)).toContain('comparison.completed');
      expect(harness.audit.events.every((event) => event.comparisonId !== null)).toBe(true);
    });

    it('records a provider failure against the comparison', async () => {
      const broken = new StubRouteProvider(
        { id: 'broken' },
        { kind: 'reject', error: new ProviderError('broken', 'down') },
      );
      const { service, audit } = buildService([BANK, broken]);
      const comparison = await service.compare(input());

      const failures = audit.typesFor('provider.quote.failed');
      expect(failures).toHaveLength(1);
      expect(failures[0]?.providerId).toBe('broken');
      expect(failures[0]?.comparisonId).toBe(comparison.comparisonId);
    });

    it('records a failed comparison', async () => {
      const broken = new StubRouteProvider(
        { id: 'broken' },
        { kind: 'reject', error: new ProviderError('broken', 'down') },
      );
      const { service, audit } = buildService([broken]);
      await expect(service.compare(input())).rejects.toThrow(NoRoutesAvailableError);

      expect(audit.typesFor('comparison.failed')).toHaveLength(1);
    });

    it('records a replay', async () => {
      const comparison = await harness.service.compare(input());
      await harness.service.replay(comparison.comparisonId, { actor: 'auditor', requestId: null });

      const replayEvents = harness.audit.typesFor('comparison.replayed');
      expect(replayEvents).toHaveLength(1);
      expect(replayEvents[0]?.payload['reproducible']).toBe(true);
      expect(replayEvents[0]?.actor).toBe('auditor');
    });
  });

  describe('persistence', () => {
    it('stores the snapshot and the serialised result together', async () => {
      const comparison = await harness.service.compare(input());
      const stored = harness.repository.saved[0];

      expect(stored).toMatchObject({
        comparisonId: comparison.comparisonId,
        fingerprint: comparison.fingerprint,
        sourceCurrency: 'USD',
        targetCurrency: 'KRW',
        amountMinorUnits: '10000000',
        mode: 'sandbox',
      });
      expect(stored?.snapshot).toBeDefined();
      expect(stored?.result).toBeDefined();
    });
  });

  it('cannot be constructed with a registry that has no providers', () => {
    expect(() => buildService([])).toThrow(ConfigurationError);
  });
});

describe('expired quotes at ingestion', () => {
  /** A provider whose quote is already dead on arrival — its TTL passed before the fan-out ended. */
  const deadOnArrival = new StubRouteProvider(
    { id: 'dead-on-arrival', rail: 'payment_institution' },
    {
      kind: 'quote',
      quote: buildProviderQuote({
        providerId: 'dead-on-arrival',
        rail: 'payment_institution',
        quotedAt: '2026-03-01T08:59:00.000Z',
        expiresAt: '2026-03-01T08:59:30.000Z',
      }),
    },
  );

  it('degrades the comparison rather than ranking a price nobody can transact on', async () => {
    const { service } = buildService([BANK, deadOnArrival]);
    const comparison = await service.compare(input());

    expect(comparison.routes.map((route) => route.provider.id)).toEqual(['bank']);
    expect(comparison.providerFailures[0]).toMatchObject({
      providerId: 'dead-on-arrival',
      code: 'QUOTE_EXPIRED',
    });
  });

  it('evidences the dead quote as received before rejecting it', async () => {
    const { service, audit } = buildService([deadOnArrival, BANK]);
    await service.compare(input());

    const received = audit
      .typesFor('provider.quote.received')
      .filter((event) => event.providerId === 'dead-on-arrival');
    const failed = audit
      .typesFor('provider.quote.failed')
      .filter((event) => event.providerId === 'dead-on-arrival');

    expect(received).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.payload['code']).toBe('QUOTE_EXPIRED');
  });

  it('rejects a quote timestamped implausibly far in the future as stale', async () => {
    const skewed = new StubRouteProvider(
      { id: 'skewed-clock' },
      {
        kind: 'quote',
        quote: buildProviderQuote({
          providerId: 'skewed-clock',
          quotedAt: '2026-03-01T10:00:00.000Z',
          expiresAt: '2026-03-01T11:00:00.000Z',
        }),
      },
    );
    const { service } = buildService([BANK, skewed]);
    const comparison = await service.compare(input());

    expect(comparison.providerFailures[0]).toMatchObject({
      providerId: 'skewed-clock',
      code: 'QUOTE_STALE',
    });
  });

  it('fails the whole comparison only when every quote arrives expired', async () => {
    const { service } = buildService([deadOnArrival]);

    await expect(service.compare(input())).rejects.toThrow(NoRoutesAvailableError);
  });

  it('exempts a quote that states no expiry, since there is nothing to assess', async () => {
    const openEnded = new StubRouteProvider(
      { id: 'open-ended' },
      {
        kind: 'quote',
        quote: buildProviderQuote({ providerId: 'open-ended', expiresAt: null }),
      },
    );
    const { service } = buildService([openEnded]);
    const comparison = await service.compare(input());

    expect(comparison.routes).toHaveLength(1);
  });

  /**
   * The check must never reach the snapshot path. A replay prices quotes that are weeks past their
   * expiry by design — that is the whole point of storing the snapshot.
   */
  it('still replays a snapshot whose quotes have long since expired', async () => {
    const harness = buildService([BANK, FX_PROVIDER, STABLECOIN]);
    const comparison = await harness.service.compare(input());

    // A month passes; every quote in the snapshot is now far beyond its TTL.
    harness.clock.advance(30 * 24 * 3_600 * 1_000);

    const replay = await harness.service.replay(comparison.comparisonId, {
      actor: 'auditor',
      requestId: null,
    });

    expect(replay.reproducible).toBe(true);
    expect(replay.comparison.routes).toHaveLength(3);
    expect(replay.comparison.providerFailures).toEqual([]);
  });
});

describe('replaying a snapshot from before platform pricing existed', () => {
  /**
   * Stored comparisons from engine 1.x have no organizationId and no pricingRules field at all —
   * not empty values, absent keys. A replay must treat that as "no terms applied", not crash, and
   * must report the engine change honestly rather than claiming reproduction.
   */
  it('tolerates the missing fields and reports the engine divergence', async () => {
    const harness = buildService([BANK, FX_PROVIDER, STABLECOIN]);
    const comparison = await harness.service.compare(input());
    const stored = harness.repository.saved.find(
      (item) => item.comparisonId === comparison.comparisonId,
    );
    expect(stored).toBeDefined();

    // Reshape the stored snapshot to the 1.x form: strip the fields that did not exist then.
    const legacySnapshot = { ...(stored?.snapshot as Record<string, unknown>) };
    delete legacySnapshot['organizationId'];
    delete legacySnapshot['pricingRules'];
    legacySnapshot['engineVersion'] = '1.0.0';
    legacySnapshot['snapshotVersion'] = 1;

    const legacyStored = {
      ...(stored as NonNullable<typeof stored>),
      comparisonId: 'cmp_legacy_v1',
      idempotencyKey: null,
      engineVersion: '1.0.0',
      snapshot: legacySnapshot,
      // A real 1.x row carries the hash of its own snapshot, so the fixture must too.
      fingerprint: fingerprint(legacySnapshot),
    };
    await harness.repository.save(legacyStored);

    const replay = await harness.service.replay('cmp_legacy_v1', {
      actor: 'auditor',
      requestId: null,
    });

    // The calculation must complete, price every route, and charge no platform fee.
    expect(replay.comparison.routes.length).toBeGreaterThan(0);
    for (const route of replay.comparison.routes) {
      expect(route.breakdown.platformFeeCost.isZero()).toBe(true);
      expect(route.platformPricing.ruleId).toBeNull();
    }

    // Honest reporting: the inputs hash identically, but a different engine computed the numbers.
    expect(replay.divergence).toBe('engine_version_changed');
    expect(replay.reproducible).toBe(false);
    expect(replay.originalEngineVersion).toBe('1.0.0');
  });
});
