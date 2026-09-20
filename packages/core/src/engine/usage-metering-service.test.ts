import { describe, expect, it } from 'vitest';
import { BILLABLE_ACTIONS, type BillableAction } from '../domain/billable-event.js';
import {
  DEFAULT_SUBSCRIPTION_TIERS,
  type OrganizationSubscription,
  type SubscriptionTier,
} from '../domain/subscription.js';
import type { MeteredEndpoint, UsageCounter } from '../domain/usage-metering.js';
import { FixedClock } from '../ports/clock.js';
import type { LogContext, Logger } from '../ports/logger.js';
import type { SubscriptionStore, UsageMeterStore } from '../ports/billing.js';
import { UsageMeteringService, billingPeriodStart } from './usage-metering-service.js';

const ORG = 'org_metering';
const MARCH = '2026-03-01T00:00:00.000Z';

class FakeUsageStore implements UsageMeterStore {
  readonly counters = new Map<string, UsageCounter>();
  failNext = false;

  increment(input: {
    readonly organizationId: string;
    readonly periodStart: string;
    readonly endpoint: MeteredEndpoint;
    readonly occurredAt: string;
  }): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('counter store unavailable'));
    }
    const key = `${input.organizationId}|${input.periodStart}|${input.endpoint}`;
    const existing = this.counters.get(key);
    this.counters.set(key, {
      organizationId: input.organizationId,
      periodStart: input.periodStart,
      endpoint: input.endpoint,
      callCount: existing === undefined ? '1' : (BigInt(existing.callCount) + 1n).toString(),
      firstCallAt: existing?.firstCallAt ?? input.occurredAt,
      lastCallAt: input.occurredAt,
    });
    return Promise.resolve();
  }

  listCounters(input: {
    readonly periodStart: string;
    readonly organizationId?: string;
  }): Promise<readonly UsageCounter[]> {
    return Promise.resolve(
      [...this.counters.values()].filter(
        (counter) =>
          counter.periodStart === input.periodStart &&
          (input.organizationId === undefined || counter.organizationId === input.organizationId),
      ),
    );
  }

  /** Seed a count directly, for arithmetic that would take too many calls to reach. */
  seed(endpoint: MeteredEndpoint, callCount: string, periodStart = MARCH): void {
    this.counters.set(`${ORG}|${periodStart}|${endpoint}`, {
      organizationId: ORG,
      periodStart,
      endpoint,
      callCount,
      firstCallAt: periodStart,
      lastCallAt: periodStart,
    });
  }
}

class FakeSubscriptionStore implements SubscriptionStore {
  private readonly rows = new Map<string, OrganizationSubscription>();

  findSubscription(organizationId: string): Promise<OrganizationSubscription | null> {
    return Promise.resolve(this.rows.get(organizationId) ?? null);
  }

  listSubscriptions(): Promise<readonly OrganizationSubscription[]> {
    return Promise.resolve([...this.rows.values()]);
  }

  upsertSubscription(input: OrganizationSubscription): Promise<OrganizationSubscription> {
    this.rows.set(input.organizationId, input);
    return Promise.resolve(input);
  }

  on(tier: SubscriptionTier): void {
    this.rows.set(ORG, {
      organizationId: ORG,
      tier,
      currency: DEFAULT_SUBSCRIPTION_TIERS[tier].currency,
      startedAt: MARCH,
      cancelledAt: null,
      flatDecisionFeeMinorUnits: null,
    });
  }
}

class RecordingLogger implements Logger {
  readonly warnings: { readonly message: string; readonly context: LogContext | undefined }[] = [];

  debug(): void {}
  info(): void {}
  warn(message: string, context?: LogContext): void {
    this.warnings.push({ message, context });
  }
  error(): void {}
  child(): Logger {
    return this;
  }
}

function service(overrides: { readonly subscriptions?: FakeSubscriptionStore } = {}) {
  const usage = new FakeUsageStore();
  const subscriptions = overrides.subscriptions ?? new FakeSubscriptionStore();
  const logger = new RecordingLogger();
  const clock = new FixedClock('2026-03-14T08:30:00.000Z');
  return {
    usage,
    subscriptions,
    logger,
    clock,
    metering: new UsageMeteringService({ usage, subscriptions, clock, logger }),
  };
}

describe('§18.1 metering counts the calls that are billed as calls', () => {
  it('derives a monthly period from the instant of the call', () => {
    expect(billingPeriodStart('2026-03-14T08:30:00.000Z')).toBe(MARCH);
    expect(billingPeriodStart('2026-12-31T23:59:59.999Z')).toBe('2026-12-01T00:00:00.000Z');
  });

  it('increments the endpoint counter for each metered call', async () => {
    const { metering, usage } = service();
    await metering.record({ organizationId: ORG, action: 'quote.read' });
    await metering.record({ organizationId: ORG, action: 'quote.read' });
    await metering.record({ organizationId: ORG, action: 'route.search' });

    const counters = await usage.listCounters({ periodStart: MARCH, organizationId: ORG });
    expect(
      counters.map((counter) => [counter.endpoint, counter.callCount]).sort(),
    ).toEqual([
      ['quote', '2'],
      ['route_search', '1'],
    ]);
  });

  it('does not meter an action billed under another class', async () => {
    // The double charge §18.6 forbids: an execution intent is an API call, and it is charged a
    // per-decision fee instead of a per-call one. Metering it would bill the same act twice.
    const { metering, usage } = service();
    await metering.record({ organizationId: ORG, action: 'decision.execution_intent' });
    await metering.record({ organizationId: ORG, action: 'subscription.period' });
    expect(await usage.listCounters({ periodStart: MARCH })).toEqual([]);
  });

  it('meters every action the taxonomy classes as a call, and only those', async () => {
    const { metering, usage } = service();
    for (const action of BILLABLE_ACTIONS) {
      await metering.record({ organizationId: ORG, action });
    }
    const counted = (await usage.listCounters({ periodStart: MARCH })).length;
    expect(counted).toBe(
      BILLABLE_ACTIONS.filter((action: BillableAction) =>
        ['quote.read', 'route.search', 'compliance.screen', 'liquidity.inspect', 'settlement.status', 'reconciliation.report'].includes(
          action,
        ),
      ).length,
    );
  });

  it('never fails the request when the counter store is down', async () => {
    // Metering runs after the customer already has their answer. Losing a count is a billing
    // shortfall in the customer's favour; throwing would lose the answer itself.
    const { metering, usage, logger } = service();
    usage.failNext = true;
    await expect(
      metering.record({ organizationId: ORG, action: 'quote.read' }),
    ).resolves.toBeUndefined();
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]?.context).toMatchObject({
      organizationId: ORG,
      endpoint: 'quote',
      reason: 'counter store unavailable',
    });
  });

  it('keeps each organization’s counters separate', async () => {
    const { metering, usage } = service();
    await metering.record({ organizationId: ORG, action: 'quote.read' });
    await metering.record({ organizationId: 'org_other', action: 'quote.read' });
    expect(await usage.listCounters({ periodStart: MARCH, organizationId: ORG })).toHaveLength(1);
    expect(await usage.listCounters({ periodStart: MARCH })).toHaveLength(2);
  });
});

describe('§18.1 usage snapshots charge only what exceeds the tier quota', () => {
  it('treats an organization with no subscription row as the free tier', async () => {
    const { metering } = service();
    await metering.record({ organizationId: ORG, action: 'quote.read' });
    const snapshot = await metering.snapshot({ organizationId: ORG });
    expect(snapshot.tier).toBe('free');
    expect(snapshot.rollup.totalCalls).toBe('1');
    expect(snapshot.includedCalls).toBe('0');
    expect(snapshot.billableCalls).toBe('1');
    // The free tier's overage price is zero, so usage is visible and unbilled.
    expect(snapshot.overageMinorUnits).toBe('0');
    expect(snapshot.eventClass).toBe('METERED_CALL');
  });

  it('charges nothing inside the included quota', async () => {
    const subscriptions = new FakeSubscriptionStore();
    subscriptions.on('starter');
    const { metering, usage } = service({ subscriptions });
    usage.seed('quote', DEFAULT_SUBSCRIPTION_TIERS.starter.includedCalls);

    const snapshot = await metering.snapshot({ organizationId: ORG });
    expect(snapshot.billableCalls).toBe('0');
    expect(snapshot.overageMinorUnits).toBe('0');
  });

  it('charges the overage price for calls beyond the quota', async () => {
    const subscriptions = new FakeSubscriptionStore();
    subscriptions.on('starter');
    const { metering, usage } = service({ subscriptions });
    usage.seed('quote', '10000');
    usage.seed('route_search', '500');

    const snapshot = await metering.snapshot({ organizationId: ORG });
    expect(snapshot.rollup.totalCalls).toBe('10500');
    expect(snapshot.includedCalls).toBe('10000');
    expect(snapshot.billableCalls).toBe('500');
    expect(snapshot.overageMinorUnits).toBe('500');
    expect(snapshot.currency).toBe('USD');
  });

  it('sums a call volume that overflows a double, without rounding', async () => {
    // PA-H07: revenue arithmetic stays exact past 2^53. A count near that boundary times a
    // per-call price is exactly where a float would silently round the invoice.
    const subscriptions = new FakeSubscriptionStore();
    subscriptions.on('pro');
    const { metering, usage } = service({ subscriptions });
    usage.seed('quote', '9007199254740993');
    usage.seed('route_search', '9007199254740993');

    const snapshot = await metering.snapshot({ organizationId: ORG });
    expect(snapshot.rollup.totalCalls).toBe('18014398509481986');
    expect(snapshot.billableCalls).toBe('18014398509381986');
    expect(snapshot.overageMinorUnits).toBe('18014398509381986');
    expect(Number(snapshot.rollup.totalCalls)).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
  });

  it('reports per-endpoint counts and omits surfaces with no calls', async () => {
    const { metering, usage } = service();
    usage.seed('quote', '3');
    usage.seed('reconciliation', '1');

    const snapshot = await metering.snapshot({ organizationId: ORG });
    expect(snapshot.rollup.byEndpoint).toEqual([
      { endpoint: 'quote', callCount: '3' },
      { endpoint: 'reconciliation', callCount: '1' },
    ]);
  });

  it('scopes a snapshot to the requested period', async () => {
    const { metering, usage } = service();
    usage.seed('quote', '7');
    usage.seed('quote', '99', '2026-02-01T00:00:00.000Z');

    const march = await metering.snapshot({ organizationId: ORG });
    expect(march.rollup.totalCalls).toBe('7');
    expect(march.rollup.periodEnd).toBe('2026-04-01T00:00:00.000Z');

    const february = await metering.snapshot({
      organizationId: ORG,
      periodStart: '2026-02-01T00:00:00.000Z',
    });
    expect(february.rollup.totalCalls).toBe('99');
  });
});
