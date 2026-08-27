import {
  UnsupportedCorridorError,
  UnsupportedCurrencyError,
  ValidationError,
  isCurrencyCode,
  type MarketDataProvider,
  type MarketRate,
  type MarketRateRequest,
  type ProviderContext,
  type ProviderDescriptor,
  type ProviderHealth,
} from '@meridian/core';
import type { ReferenceRateSource } from '../reference-rates.js';

export interface DemoMarketDataProviderOptions {
  readonly rates: ReferenceRateSource;
  /** How long an observation stays valid. Short, because a mid rate goes off quickly. */
  readonly rateTtlSeconds?: number;
  /**
   * Half-spread applied around the mid to publish an indicative bid and ask, in basis points.
   *
   * The dataset holds a single mid rate, so a bid and an ask have to be derived. Deriving them is
   * worth doing rather than returning nulls: a consumer that expects two-sided prices should be
   * exercised against them in demo mode, not only in production.
   */
  readonly indicativeHalfSpreadBps?: number;
  readonly providerId?: string;
}

const DEFAULT_TTL_SECONDS = 30;
const DEFAULT_HALF_SPREAD_BPS = 2;

/**
 * Mid-market reference rates for demo and sandbox use.
 *
 * Reads the versioned reference dataset and stamps each observation with its provenance: which feed,
 * as of when, valid until when. It is not a market data feed and must never be presented as one —
 * every observation carries `source` naming the dataset version so a figure can be traced back to
 * the file that produced it.
 */
export class DemoMarketDataProvider implements MarketDataProvider {
  readonly capability = 'market_data' as const;
  readonly descriptor: ProviderDescriptor;
  private readonly rates: ReferenceRateSource;
  private readonly ttlSeconds: number;
  private readonly halfSpreadBps: number;

  constructor(options: DemoMarketDataProviderOptions) {
    this.rates = options.rates;
    this.ttlSeconds = options.rateTtlSeconds ?? DEFAULT_TTL_SECONDS;
    this.halfSpreadBps = options.indicativeHalfSpreadBps ?? DEFAULT_HALF_SPREAD_BPS;

    this.descriptor = {
      id: options.providerId ?? 'demo-market-data',
      name: 'Demo Market Data',
      rail: 'bank_fx',
      licensing: 'unlicensed_sandbox',
      modes: ['sandbox'],
      jurisdictions: ['*'],
      description:
        'Mid-market reference rates from a versioned static snapshot. Demo data, not a market feed.',
      pricingVersion: this.rates.version,
    };
  }

  supports(request: MarketRateRequest): boolean {
    if (!isCurrencyCode(request.baseCurrency) || !isCurrencyCode(request.quoteCurrency)) {
      return false;
    }
    if (request.baseCurrency === request.quoteCurrency) {
      return false;
    }
    return this.rates.midRate(request.baseCurrency, request.quoteCurrency) !== null;
  }

  getMarketRate(request: MarketRateRequest, context: ProviderContext): Promise<MarketRate> {
    // Validated even though the type says CurrencyCode: a request that arrived over HTTP has only
    // been through whatever validation the caller applied, and an adapter is a trust boundary.
    for (const code of [request.baseCurrency, request.quoteCurrency]) {
      if (!isCurrencyCode(code)) {
        return Promise.reject(new UnsupportedCurrencyError(String(code), this.rates.currencies));
      }
    }

    if (request.baseCurrency === request.quoteCurrency) {
      return Promise.reject(
        new ValidationError('A market rate needs two different currencies.', {
          currency: request.baseCurrency,
        }),
      );
    }

    const mid = this.rates.midRate(request.baseCurrency, request.quoteCurrency);
    if (mid === null) {
      return Promise.reject(
        new UnsupportedCorridorError(request.baseCurrency, request.quoteCurrency, {
          rails: null,
        }),
      );
    }

    const halfSpread = this.halfSpreadBps / 10_000;
    const timestampMs = context.clock.nowMs();

    return Promise.resolve({
      providerId: this.descriptor.id,
      baseCurrency: request.baseCurrency,
      quoteCurrency: request.quoteCurrency,
      rate: mid.value.toFixed(),
      bid: mid.value.times(1 - halfSpread).toFixed(),
      ask: mid.value.times(1 + halfSpread).toFixed(),
      timestamp: new Date(timestampMs).toISOString(),
      expiresAt: new Date(timestampMs + this.ttlSeconds * 1_000).toISOString(),
      quoteReference: null,
      source: `${this.rates.version} (as of ${this.rates.asOf})`,
      metadata: {
        datasetVersion: this.rates.version,
        datasetAsOf: this.rates.asOf,
        indicativeHalfSpreadBps: this.halfSpreadBps,
        indicativeOnly: true,
      },
    });
  }

  probe(context: ProviderContext): Promise<ProviderHealth> {
    // A static dataset is reachable if it loaded, so this reports on coverage rather than pretending
    // to check a network path that does not exist.
    const covered = this.rates.currencies.length;
    return Promise.resolve({
      providerId: this.descriptor.id,
      state: covered > 1 ? 'up' : 'down',
      checkedAt: context.clock.nowIso(),
      latencyMs: 0,
      detail: `${covered} currencies covered by ${this.rates.version}`,
    });
  }
}
