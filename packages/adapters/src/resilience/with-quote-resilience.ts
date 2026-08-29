import {
  ProviderError,
  type FinancialProvider,
  type NormalizedQuote,
  type NormalizedQuoteRequest,
  type ProviderContext,
  type ProviderHealth,
} from '@meridian/core';
import type { CircuitBreakerRegistry } from './circuit-breaker.js';
import type { ManualOverrideRegistry } from './manual-override.js';
import type { QuoteCache } from './quote-cache.js';

export interface QuoteResilienceOptions {
  readonly cache: QuoteCache;
  readonly breakers: CircuitBreakerRegistry;
  /** Operator kill switch. Same choke point as the breaker (`supportsNormalized === false`). */
  readonly manualOverrides?: ManualOverrideRegistry;
}

/**
 * Wraps a financial provider with a freshness-bounded quote cache and a per-provider circuit breaker.
 *
 * Implemented as a proxy so duck-typed fields on the inner adapter (`venueKind` on a DeFi venue,
 * extra catalog methods) remain visible. Ranking still happens only in MultiRailRouter. While the
 * breaker is open, `supportsNormalized` is false so the provider is omitted from the eligible set.
 */
export function wrapFinancialProvider(
  inner: FinancialProvider,
  options: QuoteResilienceOptions,
): FinancialProvider {
  options.breakers.forProvider(inner.descriptor.id);
  const inflight = new Map<string, Promise<NormalizedQuote>>();

  const getQuote = async (
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ): Promise<NormalizedQuote> => {
    if (options.manualOverrides?.isProviderExcluded(inner.descriptor.id, request) === true) {
      throw new ProviderError(inner.descriptor.id, 'manual_override');
    }
    const breaker = options.breakers.forProvider(inner.descriptor.id);
    const cacheKey = `${inner.descriptor.id}|${request.sourceAsset}|${request.targetAsset}|${request.amountMinorUnits}`;
    const cached = options.cache.get(inner, request);
    if (cached !== null) {
      return cached;
    }

    const pending = inflight.get(cacheKey);
    if (pending !== undefined) {
      return pending;
    }

    const admission = breaker.admit();
    if (admission === 'reject') {
      throw new ProviderError(inner.descriptor.id, 'circuit_open');
    }

    const load = (async () => {
      try {
        const quote = await inner.getQuote(request, context);
        breaker.recordSuccess();
        options.cache.set(inner, request, quote);
        return quote;
      } catch (error) {
        breaker.recordFailure();
        throw error;
      }
    })();
    inflight.set(cacheKey, load);
    try {
      return await load;
    } finally {
      inflight.delete(cacheKey);
    }
  };

  const probe = (context: ProviderContext): Promise<ProviderHealth> => {
    const snapshot = options.breakers.forProvider(inner.descriptor.id).snapshot();
    if (snapshot.state === 'open') {
      return Promise.resolve({
        providerId: inner.descriptor.id,
        state: 'down',
        checkedAt: context.clock.nowIso(),
        latencyMs: null,
        detail: 'circuit_open',
      });
    }
    if (inner.probe === undefined) {
      return Promise.resolve({
        providerId: inner.descriptor.id,
        state: snapshot.state === 'half_open' ? 'degraded' : 'up',
        checkedAt: context.clock.nowIso(),
        latencyMs: null,
        detail: snapshot.state === 'half_open' ? 'circuit_half_open' : null,
      });
    }
    return inner.probe(context);
  };

  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'supportsNormalized') {
        return (request: NormalizedQuoteRequest): boolean => {
          if (options.manualOverrides?.isProviderExcluded(target.descriptor.id, request) === true) {
            return false;
          }
          if (!options.breakers.forProvider(target.descriptor.id).allowsCandidates()) {
            return false;
          }
          return target.supportsNormalized(request);
        };
      }
      if (prop === 'getQuote') {
        return getQuote;
      }
      if (prop === 'getSettlementEstimate') {
        return async (request: NormalizedQuoteRequest, context: ProviderContext) =>
          (await getQuote(request, context)).settlement;
      }
      if (prop === 'getFees') {
        return async (request: NormalizedQuoteRequest, context: ProviderContext) =>
          (await getQuote(request, context)).fees;
      }
      if (prop === 'getLiquidityInfo') {
        return async (request: NormalizedQuoteRequest, context: ProviderContext) =>
          (await getQuote(request, context)).liquidity;
      }
      if (prop === 'probe') {
        return probe;
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(target);
      }
      return value;
    },
  });
}

export function wrapFinancialProvidersWithQuoteResilience(
  providers: readonly FinancialProvider[],
  options: QuoteResilienceOptions,
): readonly FinancialProvider[] {
  return providers.map((provider) => wrapFinancialProvider(provider, options));
}
