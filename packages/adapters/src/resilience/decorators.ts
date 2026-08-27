import {
  DEFAULT_FRESHNESS_POLICY,
  assertQuoteUsable,
  type FXProvider,
  type FXQuote,
  type FXQuoteRequest,
  type FreshnessPolicy,
  type JsonObject,
  type MarketDataProvider,
  type MarketRate,
  type MarketRateRequest,
  type ProviderContext,
} from '@meridian/core';
import { executeProviderCall, type ResilienceDependencies } from './execute.js';
import { DEFAULT_RESILIENCE_POLICY, type ResiliencePolicy } from './policy.js';

export interface ResilienceOptions {
  readonly policy?: ResiliencePolicy;
  /**
   * Freshness bound applied to the returned quote.
   *
   * Checked here rather than left to the caller because a stale price is a correctness problem, not
   * a preference: the routing engine has no way to tell that the rate it was handed is ten minutes
   * old, and every figure it derives from it would be wrong in the same direction.
   */
  readonly freshness?: FreshnessPolicy;
}

/**
 * Wraps an FX provider with timeout, retry, recording and freshness checking.
 *
 * Returns an `FXProvider`, so the wrapping is invisible to callers and can be applied — or not — per
 * provider without any code depending on whether it was.
 */
export function withResilientFX(
  provider: FXProvider,
  deps: ResilienceDependencies,
  options: ResilienceOptions = {},
): FXProvider {
  const policy = options.policy ?? DEFAULT_RESILIENCE_POLICY;
  const freshness = options.freshness ?? DEFAULT_FRESHNESS_POLICY;

  return {
    descriptor: provider.descriptor,
    capability: 'fx',
    supports: (request) => provider.supports(request),
    ...(provider.probe === undefined
      ? {}
      : { probe: (context: ProviderContext) => provider.probe?.(context) as Promise<never> }),

    async getFXQuote(request: FXQuoteRequest, context: ProviderContext): Promise<FXQuote> {
      const { result } = await executeProviderCall<FXQuote>(
        {
          providerId: provider.descriptor.id,
          capability: 'fx',
          operation: 'getFXQuote',
          request: fxRequestRecord(request),
          policy,
          correlationId: context.requestId,
          execute: ({ signal }) => provider.getFXQuote(request, { ...context, signal }),
          toRecord: (quote) => fxQuoteRecord(quote),
        },
        deps,
      );

      // Checked after recording, so a quote that arrived but was unusable is still evidenced.
      assertQuoteUsable(result, deps.clock.nowMs(), freshness);
      return result;
    },
  };
}

/** Wraps a market data provider with the same guarantees. */
export function withResilientMarketData(
  provider: MarketDataProvider,
  deps: ResilienceDependencies,
  options: ResilienceOptions = {},
): MarketDataProvider {
  const policy = options.policy ?? DEFAULT_RESILIENCE_POLICY;
  const freshness = options.freshness ?? DEFAULT_FRESHNESS_POLICY;

  return {
    descriptor: provider.descriptor,
    capability: 'market_data',
    supports: (request) => provider.supports(request),
    ...(provider.probe === undefined
      ? {}
      : { probe: (context: ProviderContext) => provider.probe?.(context) as Promise<never> }),

    async getMarketRate(request: MarketRateRequest, context: ProviderContext): Promise<MarketRate> {
      const { result } = await executeProviderCall<MarketRate>(
        {
          providerId: provider.descriptor.id,
          capability: 'market_data',
          operation: 'getMarketRate',
          request: { ...request },
          policy,
          correlationId: context.requestId,
          execute: ({ signal }) => provider.getMarketRate(request, { ...context, signal }),
          toRecord: (rate) => ({
            baseCurrency: rate.baseCurrency,
            quoteCurrency: rate.quoteCurrency,
            rate: rate.rate,
            timestamp: rate.timestamp,
            expiresAt: rate.expiresAt,
            source: rate.source,
          }),
        },
        deps,
      );

      assertQuoteUsable(result, deps.clock.nowMs(), freshness);
      return result;
    },
  };
}

function fxRequestRecord(request: FXQuoteRequest): JsonObject {
  return {
    baseCurrency: request.baseCurrency,
    quoteCurrency: request.quoteCurrency,
    amountMinorUnits: request.amountMinorUnits,
  };
}

/**
 * Projects a quote into its recorded form.
 *
 * Explicit rather than a spread of the whole object: provider metadata can carry anything, and a
 * record is not the place to discover that an upstream payload contained something it should not.
 */
function fxQuoteRecord(quote: FXQuote): JsonObject {
  return {
    providerId: quote.providerId,
    baseCurrency: quote.baseCurrency,
    quoteCurrency: quote.quoteCurrency,
    rate: quote.rate,
    midMarketRate: quote.midMarketRate,
    amountMinorUnits: quote.amountMinorUnits,
    timestamp: quote.timestamp,
    expiresAt: quote.expiresAt,
    quoteReference: quote.quoteReference,
    providerFee:
      quote.providerFee === null
        ? null
        : {
            code: quote.providerFee.code,
            currency: quote.providerFee.currency,
            amountMinorUnits: quote.providerFee.amountMinorUnits,
            side: quote.providerFee.side,
          },
    additionalFeeCount: quote.additionalFees.length,
  };
}
