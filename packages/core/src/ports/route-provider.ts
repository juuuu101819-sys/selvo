import type { ProviderDescriptor } from '../domain/provider.js';
import type { ProviderQuote, QuoteRequest } from '../domain/quote.js';
import type { Clock } from './clock.js';
import type { Logger } from './logger.js';

/** Ambient services handed to an adapter. Adapters never reach for globals. */
export interface ProviderContext {
  readonly clock: Clock;
  readonly logger: Logger;
  /** Correlation id for the originating request, for upstream tracing headers. */
  readonly requestId: string | null;
  /** Cooperative cancellation, wired to the per-provider quote timeout. */
  readonly signal: AbortSignal | undefined;
}

/**
 * The seam between the routing engine and the outside world.
 *
 * An adapter's only job is to answer "what are your pricing primitives for this transfer?".
 * It returns rates, fee schedules, settlement estimates and slippage parameters — never a
 * computed cost, ranking or recommendation. That keeps every route in a comparison measured by
 * one engine, and makes a bank, a payment institution and a stablecoin partner substitutable.
 */
export interface RouteProvider {
  readonly descriptor: ProviderDescriptor;
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
