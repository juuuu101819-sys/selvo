import {
  isMeteredAction,
  type BillableAction,
  type BillableEventClass,
} from '../domain/billable-event.js';
import {
  DEFAULT_SUBSCRIPTION_TIERS,
  type OrganizationSubscription,
  type SubscriptionTier,
  type SubscriptionTierCatalog,
} from '../domain/subscription.js';
import {
  meteredEndpointForAction,
  rollupUsage,
  type UsageRollup,
} from '../domain/usage-metering.js';
import type { Clock } from '../ports/clock.js';
import type { Logger } from '../ports/logger.js';
import type { SubscriptionStore, UsageMeterStore } from '../ports/billing.js';
import { meteredOverage } from './billing-lines.js';
import { utcMonthWindow } from './billing-engine.js';

/**
 * Records per-organization API usage (§18.1).
 *
 * Called from the request path, which drives two decisions. First, a metering failure must never
 * fail the request: a customer's quote is not worth losing over a counter, so {@link record}
 * swallows store errors and logs them. Second, only actions billed as `METERED_CALL` increment a
 * counter — an execution-intent generation is charged as a decision instead, and metering it too
 * would be the double charge §18.6 forbids.
 */

export interface UsageMeteringDependencies {
  readonly usage: UsageMeterStore;
  readonly subscriptions?: SubscriptionStore | undefined;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly tierCatalog?: SubscriptionTierCatalog | undefined;
}

export interface UsageSnapshot {
  readonly rollup: UsageRollup;
  readonly tier: SubscriptionTier;
  readonly includedCalls: string;
  readonly billableCalls: string;
  readonly overageMinorUnits: string;
  readonly currency: string;
  /** The charge class this usage would be billed under, if any. */
  readonly eventClass: BillableEventClass;
}

/** First instant of the UTC calendar month containing `iso`. Counters are monthly (§18.3). */
export function billingPeriodStart(iso: string): string {
  return `${iso.slice(0, 7)}-01T00:00:00.000Z`;
}

export class UsageMeteringService {
  constructor(private readonly deps: UsageMeteringDependencies) {}

  /**
   * Increment the counter for one metered call.
   *
   * A no-op for actions billed under another class. Never throws: the caller is a route handler
   * that has already done the customer's work.
   */
  async record(input: {
    readonly organizationId: string;
    readonly action: BillableAction;
  }): Promise<void> {
    if (!isMeteredAction(input.action)) {
      return;
    }
    const endpoint = meteredEndpointForAction(input.action);
    if (endpoint === null) {
      return;
    }
    const occurredAt = this.deps.clock.nowIso();
    try {
      await this.deps.usage.increment({
        organizationId: input.organizationId,
        periodStart: billingPeriodStart(occurredAt),
        endpoint,
        occurredAt,
      });
    } catch (error) {
      this.deps.logger.warn('Usage counter could not be incremented', {
        organizationId: input.organizationId,
        endpoint,
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  /**
   * Current-period usage for one organization, with the overage it would be billed.
   *
   * Uses the same {@link meteredOverage} arithmetic as the invoice, so what a customer sees on the
   * usage page cannot disagree with what they are charged.
   */
  async snapshot(input: {
    readonly organizationId: string;
    readonly periodStart?: string | undefined;
  }): Promise<UsageSnapshot> {
    const catalog = this.deps.tierCatalog ?? DEFAULT_SUBSCRIPTION_TIERS;
    const periodStart = input.periodStart ?? billingPeriodStart(this.deps.clock.nowIso());
    const { periodEnd } = utcMonthWindow(periodStart);
    const counters = await this.deps.usage.listCounters({
      periodStart,
      organizationId: input.organizationId,
    });
    const rollup = rollupUsage({
      organizationId: input.organizationId,
      periodStart,
      periodEnd,
      counters,
    });
    const subscription =
      (await this.deps.subscriptions?.findSubscription(input.organizationId)) ??
      freeSubscription(input.organizationId, catalog, periodStart);
    const overage = meteredOverage({ rollup, subscription, catalog });
    return {
      rollup,
      tier: subscription.tier,
      includedCalls: overage.includedCalls.toString(),
      billableCalls: overage.billableCalls.toString(),
      overageMinorUnits: overage.amountMinorUnits.toString(),
      currency: subscription.currency,
      eventClass: 'METERED_CALL',
    };
  }
}

/** An organization with no subscription row is on the free tier, not in an undefined state. */
function freeSubscription(
  organizationId: string,
  catalog: SubscriptionTierCatalog,
  periodStart: string,
): OrganizationSubscription {
  return {
    organizationId,
    tier: 'free',
    currency: catalog.free.currency,
    startedAt: periodStart,
    cancelledAt: null,
    flatDecisionFeeMinorUnits: null,
  };
}
