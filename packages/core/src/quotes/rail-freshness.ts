import type { RailType } from '../domain/rail.js';
import { DEFAULT_FRESHNESS_POLICY, type FreshnessPolicy } from './quote-freshness.js';

/**
 * Rail-appropriate quote freshness windows.
 *
 * Configured here, not per call: a DEX price that is still inside a bank-FX TTL is not comparable
 * to a live FX quote. The platform's max-age is independent of the provider's own `expiresAt`.
 */
export const RAIL_FRESHNESS_POLICY: Readonly<Record<RailType, FreshnessPolicy>> = {
  bank_fx: DEFAULT_FRESHNESS_POLICY,
  payment_institution: DEFAULT_FRESHNESS_POLICY,
  treasury_product: DEFAULT_FRESHNESS_POLICY,
  liquidity_provider: {
    maxAgeMs: 60_000,
    clockSkewToleranceMs: DEFAULT_FRESHNESS_POLICY.clockSkewToleranceMs,
    expiryGuardMs: DEFAULT_FRESHNESS_POLICY.expiryGuardMs,
  },
  stablecoin_settlement: {
    maxAgeMs: 45_000,
    clockSkewToleranceMs: DEFAULT_FRESHNESS_POLICY.clockSkewToleranceMs,
    expiryGuardMs: DEFAULT_FRESHNESS_POLICY.expiryGuardMs,
  },
  dex_liquidity: {
    maxAgeMs: 12_000,
    clockSkewToleranceMs: DEFAULT_FRESHNESS_POLICY.clockSkewToleranceMs,
    expiryGuardMs: DEFAULT_FRESHNESS_POLICY.expiryGuardMs,
  },
};

export function freshnessPolicyForRail(rail: RailType): FreshnessPolicy {
  return RAIL_FRESHNESS_POLICY[rail];
}
