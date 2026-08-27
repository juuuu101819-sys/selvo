import type { ProviderQuote, QuoteRequest } from '../domain/quote.js';
import type { ProviderAdapter, ProviderContext } from './provider-adapter.js';

/**
 * The seam between the routing engine and the outside world.
 *
 * An adapter's only job is to answer "what are your pricing primitives for this transfer?". It
 * returns rates, fee schedules, settlement estimates and slippage parameters — never a computed
 * cost, ranking or recommendation. That keeps every route in a comparison measured by one engine,
 * and makes a bank, a payment institution and a stablecoin partner substitutable.
 *
 * This is the *engine-facing* contract. The capability interfaces — `FXProvider`,
 * `PaymentProvider`, `LiquidityProvider`, `MarketDataProvider` — are the *integration-facing* ones,
 * shaped like the upstream APIs they wrap. An adapter in packages/adapters composes one or more of
 * those into a `RouteProvider`, which is why no provider-specific concept ever reaches the engine.
 */
export interface RouteProvider extends ProviderAdapter {
  readonly capability: 'route';
  /** Cheap, synchronous eligibility check: corridor coverage, notional limits, rail filters. */
  supports(request: QuoteRequest): boolean;
  /** Fetches pricing primitives. May reject; the engine degrades the comparison accordingly. */
  fetchQuote(request: QuoteRequest, context: ProviderContext): Promise<ProviderQuote>;
}

/** Resolves a named secret. Backed by the environment today, by a vault later. */
export interface SecretResolver {
  /** Returns the secret, or `null` when it is not configured. Never logs the value. */
  get(name: string): string | null;
  require(name: string): string;
}

export type { ProviderContext };
