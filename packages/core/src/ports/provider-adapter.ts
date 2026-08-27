import type { ProviderDescriptor, ProviderId } from '../domain/provider.js';
import type { Clock } from './clock.js';
import type { Logger } from './logger.js';

/** Ambient services handed to an adapter. Adapters never reach for globals. */
export interface ProviderContext {
  readonly clock: Clock;
  readonly logger: Logger;
  /** Correlation id for the originating request, for upstream tracing headers. */
  readonly requestId: string | null;
  /** Cooperative cancellation, wired to the per-attempt timeout. */
  readonly signal: AbortSignal | undefined;
}

/**
 * What an adapter is able to price.
 *
 * Providers are not interchangeable in what they *do* — a market data feed publishes a mid rate, a
 * bank quotes a conversion, a payment institution quotes a payout, a wholesale desk quotes depth —
 * but they are interchangeable in how the platform *talks to them*. This discriminator is what lets
 * one resilience pipeline, one recorder and one registry serve all of them.
 */
export const PROVIDER_CAPABILITIES = [
  'market_data',
  'fx',
  'payment',
  'liquidity',
  'route',
] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

export type ProviderHealthState = 'up' | 'degraded' | 'down';

export interface ProviderHealth {
  readonly providerId: ProviderId;
  readonly state: ProviderHealthState;
  readonly checkedAt: string;
  readonly latencyMs: number | null;
  readonly detail: string | null;
}

/**
 * The contract every provider adapter satisfies, whatever it prices.
 *
 * Deliberately thin. It carries only what the platform needs in order to treat providers uniformly:
 * who the provider is, what it can price, and optionally whether it is reachable. Everything about
 * *how* a price is obtained belongs to the capability-specific interface, and nothing about a
 * specific provider ever reaches the routing engine.
 */
export interface ProviderAdapter {
  readonly descriptor: ProviderDescriptor;
  readonly capability: ProviderCapability;
  /**
   * Upstream liveness. Optional because a static dataset has nothing to probe, and forcing a
   * meaningless implementation on every adapter would make the result untrustworthy where it
   * matters.
   */
  probe?(context: ProviderContext): Promise<ProviderHealth>;
}

/**
 * Fields common to every quote any provider returns.
 *
 * `timestamp` and `expiresAt` are here rather than on each capability because freshness is checked
 * by one shared code path: a quote that cannot say when it was made, and when it stops being valid,
 * cannot safely be used for anything.
 */
export interface ProviderQuoteEnvelope {
  /** Rule 12: every quote names the provider that issued it. */
  readonly providerId: ProviderId;
  /** Rule 11: every quote is timestamped. ISO-8601 with a `Z` offset. */
  readonly timestamp: string;
  /** When the price stops being usable. Required: a quote without an expiry is a liability. */
  readonly expiresAt: string;
  /** The provider's own reference for this price, for reconciliation upstream. */
  readonly quoteReference: string | null;
}

/**
 * A charge levied by a provider, resolved to a concrete amount.
 *
 * Expressed in integer minor units as a string, like every other amount crossing an adapter
 * boundary: a provider response is wire data, and converting it into a domain `Money` is the
 * adapter's job, after validation.
 */
export interface ProviderFee {
  readonly code: string;
  readonly label: string;
  /** Which leg of the transfer the fee is deducted from. Changes the arithmetic. */
  readonly side: 'source' | 'destination';
  readonly currency: string;
  readonly amountMinorUnits: string;
  /** Populated when the charge is proportional, in basis points. */
  readonly rateBps: string | null;
}
