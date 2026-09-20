import { InvalidAmountError, ValidationError } from '../errors/index.js';

/**
 * Subscription tiers (§18.1) — the primary monetization model: platform access plus metered usage.
 *
 * **The numbers below are placeholders.** They are shaped correctly (a monthly base, an included
 * call quota, a per-call overage, a per-decision flat fee) but none of them has been validated
 * commercially, and no organization is being charged them. They exist so the billing pipeline can
 * be built and tested before pricing is decided; a real price list replaces them via
 * {@link SubscriptionTierCatalog} without touching the engine.
 */

export const SUBSCRIPTION_TIERS = ['free', 'starter', 'pro', 'enterprise'] as const;
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];

export const SUBSCRIPTION_TIER_LABELS: Readonly<Record<SubscriptionTier, string>> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

export interface SubscriptionTierDefinition {
  readonly tier: SubscriptionTier;
  /** Billing currency for every amount on this tier. */
  readonly currency: string;
  /** Monthly platform access fee, in minor units. */
  readonly monthlyBaseMinorUnits: string;
  /** API calls included in the base fee, as an integer string. */
  readonly includedCalls: string;
  /** Price per call beyond {@link includedCalls}, in minor units. */
  readonly overagePerCallMinorUnits: string;
  /**
   * Default flat fee per routing decision, in minor units.
   *
   * A constant, never a rate — see §18.2. An organization with a negotiated `CustomerPricing` row
   * overrides this value, but the override is also a constant.
   */
  readonly flatDecisionFeeMinorUnits: string;
}

export type SubscriptionTierCatalog = Readonly<
  Record<SubscriptionTier, SubscriptionTierDefinition>
>;

/**
 * Placeholder price list. Not commercially validated; see the module comment.
 *
 * `free` exists so an unsubscribed org has a defined tier rather than an undefined one: it has no
 * base fee and no included calls, so its usage is charged per call from the first request.
 */
export const DEFAULT_SUBSCRIPTION_TIERS: SubscriptionTierCatalog = {
  free: {
    tier: 'free',
    currency: 'USD',
    monthlyBaseMinorUnits: '0',
    includedCalls: '0',
    overagePerCallMinorUnits: '0',
    flatDecisionFeeMinorUnits: '0',
  },
  starter: {
    tier: 'starter',
    currency: 'USD',
    monthlyBaseMinorUnits: '9900',
    includedCalls: '10000',
    overagePerCallMinorUnits: '1',
    flatDecisionFeeMinorUnits: '25',
  },
  pro: {
    tier: 'pro',
    currency: 'USD',
    monthlyBaseMinorUnits: '49900',
    includedCalls: '100000',
    overagePerCallMinorUnits: '1',
    flatDecisionFeeMinorUnits: '20',
  },
  enterprise: {
    tier: 'enterprise',
    currency: 'USD',
    monthlyBaseMinorUnits: '249900',
    includedCalls: '1000000',
    overagePerCallMinorUnits: '1',
    flatDecisionFeeMinorUnits: '10',
  },
};

/** An organization's subscription. Absent means {@link DEFAULT_SUBSCRIPTION_TIERS.free}. */
export interface OrganizationSubscription {
  readonly organizationId: string;
  readonly tier: SubscriptionTier;
  readonly currency: string;
  /** First period this tier applies to, as a UTC month start. */
  readonly startedAt: string;
  readonly cancelledAt: string | null;
  /**
   * Per-org flat decision fee in minor units, when negotiated. Null falls back to the tier
   * default. A constant in both cases.
   */
  readonly flatDecisionFeeMinorUnits: string | null;
}

export function isSubscriptionTier(value: unknown): value is SubscriptionTier {
  return typeof value === 'string' && (SUBSCRIPTION_TIERS as readonly string[]).includes(value);
}

export function parseTierAmount(raw: string, field: string): bigint {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new InvalidAmountError(`Subscription ${field} must be a non-negative integer string.`, {
      field,
      value: raw,
    });
  }
  return BigInt(trimmed);
}

export function tierDefinition(
  catalog: SubscriptionTierCatalog,
  tier: SubscriptionTier,
): SubscriptionTierDefinition {
  const definition = catalog[tier];
  if (definition === undefined) {
    throw new ValidationError(`No definition for subscription tier "${tier}".`, { tier });
  }
  return definition;
}

/**
 * The flat per-decision fee for a subscription, in minor units.
 *
 * Takes the subscription and the catalog and nothing else. No amount, no asset, no notional — the
 * signature is what makes it impossible to scale this fee by transaction size (§18.2).
 */
export function flatDecisionFeeMinorUnitsFor(
  subscription: OrganizationSubscription | null,
  catalog: SubscriptionTierCatalog = DEFAULT_SUBSCRIPTION_TIERS,
): bigint {
  if (subscription === null) {
    return parseTierAmount(
      tierDefinition(catalog, 'free').flatDecisionFeeMinorUnits,
      'flatDecisionFeeMinorUnits',
    );
  }
  if (subscription.flatDecisionFeeMinorUnits !== null) {
    return parseTierAmount(
      subscription.flatDecisionFeeMinorUnits,
      'subscription.flatDecisionFeeMinorUnits',
    );
  }
  return parseTierAmount(
    tierDefinition(catalog, subscription.tier).flatDecisionFeeMinorUnits,
    'flatDecisionFeeMinorUnits',
  );
}
