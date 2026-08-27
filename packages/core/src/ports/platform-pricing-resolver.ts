import type { PlatformPricingRule } from '../domain/platform-pricing.js';
import type { CurrencyCode } from '../money/currency.js';

export interface PricingRuleQuery {
  readonly organizationId: string;
  readonly sourceCurrency: CurrencyCode;
  readonly targetCurrency: CurrencyCode;
  /** Instant the terms are evaluated at. */
  readonly at: string;
}

/**
 * Source of an organization's negotiated commercial terms.
 *
 * Returns the *candidate* rules for a corridor rather than a single resolved answer, deliberately.
 * Which rule applies depends on the rail and the provider, so resolution has to happen per route —
 * and doing that in the store would mean one query per route. Fetching candidates once and selecting
 * in pure code keeps it to a single query and makes the selection replayable from a snapshot.
 */
export interface PlatformPricingResolver {
  rulesFor(query: PricingRuleQuery): Promise<readonly PlatformPricingRule[]>;
}

/** Applies no commercial terms. The default, so an unconfigured platform charges nothing. */
export const noPlatformPricingResolver: PlatformPricingResolver = {
  rulesFor: () => Promise.resolve([]),
};

/** Serves a fixed rule set. Used by tests, demos and single-tenant deployments. */
export class StaticPlatformPricingResolver implements PlatformPricingResolver {
  constructor(private readonly rules: readonly PlatformPricingRule[]) {}

  rulesFor(query: PricingRuleQuery): Promise<readonly PlatformPricingRule[]> {
    return Promise.resolve(
      this.rules.filter((rule) => rule.organizationId === query.organizationId),
    );
  }
}
