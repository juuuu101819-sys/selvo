import {
  freshnessPolicyForRail,
  isQuoteUsable,
  type Clock,
  type FinancialProvider,
  type NormalizedQuote,
  type NormalizedQuoteRequest,
} from '@meridian/core';

export const DEFAULT_QUOTE_CACHE_MAX_ENTRIES = 256;

export interface QuoteCacheOptions {
  readonly clock: Clock;
  readonly maxEntries?: number;
}

interface CacheEntry {
  readonly quote: NormalizedQuote;
  readonly storedAtMs: number;
  readonly maxAgeMs: number;
}

/**
 * Short-lived quote cache keyed by provider and corridor.
 *
 * TTL is the PA-H09 rail freshness window and is never extended past it. A hit is only served when
 * the stored quote is still `fresh` under that same policy.
 */
export class QuoteCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxEntries: number;

  constructor(private readonly options: QuoteCacheOptions) {
    this.maxEntries = options.maxEntries ?? DEFAULT_QUOTE_CACHE_MAX_ENTRIES;
  }

  static key(providerId: string, request: NormalizedQuoteRequest): string {
    return `${providerId}|${request.sourceAsset}|${request.targetAsset}|${request.amountMinorUnits}`;
  }

  get(provider: FinancialProvider, request: NormalizedQuoteRequest): NormalizedQuote | null {
    const cacheKey = QuoteCache.key(provider.descriptor.id, request);
    const entry = this.entries.get(cacheKey);
    if (entry === undefined) {
      return null;
    }
    const nowMs = this.options.clock.nowMs();
    if (nowMs - entry.storedAtMs > entry.maxAgeMs) {
      this.entries.delete(cacheKey);
      return null;
    }
    const policy = freshnessPolicyForRail(provider.descriptor.rail);
    if (!isQuoteUsable(entry.quote, nowMs, policy)) {
      this.entries.delete(cacheKey);
      return null;
    }
    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, entry);
    return entry.quote;
  }

  set(provider: FinancialProvider, request: NormalizedQuoteRequest, quote: NormalizedQuote): void {
    const policy = freshnessPolicyForRail(provider.descriptor.rail);
    const nowMs = this.options.clock.nowMs();
    if (!isQuoteUsable(quote, nowMs, policy)) {
      return;
    }
    const cacheKey = QuoteCache.key(provider.descriptor.id, request);
    if (this.entries.has(cacheKey)) {
      this.entries.delete(cacheKey);
    } else if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
    this.entries.set(cacheKey, {
      quote,
      storedAtMs: nowMs,
      maxAgeMs: policy.maxAgeMs,
    });
  }
}
