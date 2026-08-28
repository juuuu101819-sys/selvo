import {
  ProviderError,
  type AssetDefinition,
  type CurrencyCode,
  type FinancialProvider,
  type LiquidityInfo,
  type NormalizedFee,
  type NormalizedQuote,
  type NormalizedQuoteRequest,
  type ProviderCapabilityProfile,
  type ProviderContext,
  type ProviderDescriptor,
  type ProviderHealth,
  type SettlementEstimate,
} from '@meridian/core';
import type { CircuitBreakerRegistry } from './circuit-breaker.js';
import type { QuoteCache } from './quote-cache.js';

export interface QuoteResilienceOptions {
  readonly cache: QuoteCache;
  readonly breakers: CircuitBreakerRegistry;
}

/**
 * Wraps a financial provider with a freshness-bounded quote cache and a per-provider circuit breaker.
 *
 * Ranking still happens only in MultiRailRouter. While the breaker is open, `supportsNormalized`
 * is false so the provider is omitted from the eligible candidate set.
 */
export class ResilientFinancialProvider implements FinancialProvider {
  readonly capability = 'financial' as const;
  readonly descriptor: ProviderDescriptor;
  private readonly inflight = new Map<string, Promise<NormalizedQuote>>();

  constructor(
    private readonly inner: FinancialProvider,
    private readonly options: QuoteResilienceOptions,
  ) {
    this.descriptor = inner.descriptor;
    options.breakers.forProvider(inner.descriptor.id);
  }

  getCapabilities(): ProviderCapabilityProfile {
    return this.inner.getCapabilities();
  }

  getSupportedAssets(): readonly AssetDefinition[] {
    return this.inner.getSupportedAssets();
  }

  getSupportedCurrencies(): readonly CurrencyCode[] {
    return this.inner.getSupportedCurrencies();
  }

  supportsNormalized(request: NormalizedQuoteRequest): boolean {
    if (!this.options.breakers.forProvider(this.descriptor.id).allowsCandidates()) {
      return false;
    }
    return this.inner.supportsNormalized(request);
  }

  async getQuote(request: NormalizedQuoteRequest, context: ProviderContext): Promise<NormalizedQuote> {
    const breaker = this.options.breakers.forProvider(this.descriptor.id);
    const cacheKey = `${this.descriptor.id}|${request.sourceAsset}|${request.targetAsset}|${request.amountMinorUnits}`;
    const cached = this.options.cache.get(this.inner, request);
    if (cached !== null) {
      return cached;
    }

    const pending = this.inflight.get(cacheKey);
    if (pending !== undefined) {
      return pending;
    }

    const admission = breaker.admit();
    if (admission === 'reject') {
      throw new ProviderError(this.descriptor.id, 'circuit_open');
    }

    const load = this.fetchAndCache(request, context);
    this.inflight.set(cacheKey, load);
    try {
      return await load;
    } finally {
      this.inflight.delete(cacheKey);
    }
  }

  async getSettlementEstimate(
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ): Promise<SettlementEstimate> {
    return (await this.getQuote(request, context)).settlement;
  }

  async getFees(
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ): Promise<readonly NormalizedFee[]> {
    return (await this.getQuote(request, context)).fees;
  }

  async getLiquidityInfo(
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ): Promise<LiquidityInfo> {
    return (await this.getQuote(request, context)).liquidity;
  }

  probe(context: ProviderContext): Promise<ProviderHealth> {
    const snapshot = this.options.breakers.forProvider(this.descriptor.id).snapshot();
    if (snapshot.state === 'open') {
      return Promise.resolve({
        providerId: this.descriptor.id,
        state: 'down',
        checkedAt: context.clock.nowIso(),
        latencyMs: null,
        detail: 'circuit_open',
      });
    }
    if (this.inner.probe === undefined) {
      return Promise.resolve({
        providerId: this.descriptor.id,
        state: snapshot.state === 'half_open' ? 'degraded' : 'up',
        checkedAt: context.clock.nowIso(),
        latencyMs: null,
        detail: snapshot.state === 'half_open' ? 'circuit_half_open' : null,
      });
    }
    return this.inner.probe(context);
  }

  private async fetchAndCache(
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ): Promise<NormalizedQuote> {
    const breaker = this.options.breakers.forProvider(this.descriptor.id);
    try {
      const quote = await this.inner.getQuote(request, context);
      breaker.recordSuccess();
      this.options.cache.set(this.inner, request, quote);
      return quote;
    } catch (error) {
      breaker.recordFailure();
      throw error;
    }
  }
}

export function wrapFinancialProvidersWithQuoteResilience(
  providers: readonly FinancialProvider[],
  options: QuoteResilienceOptions,
): readonly FinancialProvider[] {
  return providers.map((provider) => new ResilientFinancialProvider(provider, options));
}
