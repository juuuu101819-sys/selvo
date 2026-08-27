import { createHash } from 'node:crypto';
import {
  Dec,
  InvalidAmountError,
  Money,
  ProviderError,
  Rounding,
  SUPPORTED_CURRENCIES,
  UnsupportedCorridorError,
  UnsupportedCurrencyError,
  ValidationError,
  isCurrencyCode,
  type CurrencyCode,
  type FXProvider,
  type FXQuote,
  type FXQuoteRequest,
  type MarketDataProvider,
  type ProviderContext,
  type ProviderDescriptor,
  type ProviderFee,
  type ProviderHealth,
  type SettlementEstimate,
} from '@meridian/core';

export interface DemoFXProviderOptions {
  /** Where the mid-market benchmark comes from. Never the provider's own rate. */
  readonly marketData: MarketDataProvider;
  readonly providerId?: string;
  readonly providerName?: string;
  /** Spread charged over mid-market, in basis points. */
  readonly spreadBps?: string;
  /** Flat charge per conversion, in the base currency's major units. */
  readonly flatFeeBase?: string;
  /** Proportional commission on the notional, in basis points. */
  readonly commissionBps?: string;
  /** How long a quote stays firm. */
  readonly quoteTtlSeconds?: number;
  readonly settlement?: SettlementEstimate;
  /** Notional bounds in the base currency's major units. */
  readonly minAmount?: string;
  readonly maxAmount?: string;
}

const DEFAULTS = {
  spreadBps: '35',
  flatFeeBase: '8.00',
  commissionBps: '12',
  quoteTtlSeconds: 120,
  minAmount: '100',
  maxAmount: '10000000',
} as const;

const DEFAULT_SETTLEMENT: SettlementEstimate = {
  p50Seconds: 7_200,
  p95Seconds: 28_800,
  businessDaysOnly: false,
  cutoffUtc: '21:00',
  notes: 'Local rails payout, typically within two hours. Demo estimate.',
};

/**
 * A demo FX counterparty.
 *
 * Prices by taking a mid-market benchmark from an injected {@link MarketDataProvider} and applying
 * its own spread and fees. That composition is the point: the provider does not own a view of the
 * market, so its price can always be measured against an independent benchmark. A provider that
 * supplied both its own rate and its own idea of mid could make any spread look like zero.
 *
 * The quote it returns carries a rate, a charge, a timestamp and an expiry — and deliberately no
 * total cost, ranking or recommendation. Those are the routing engine's to derive.
 */
export class DemoFXProvider implements FXProvider {
  readonly capability = 'fx' as const;
  readonly descriptor: ProviderDescriptor;
  private readonly marketData: MarketDataProvider;
  private readonly spreadBps: string;
  private readonly flatFeeBase: string;
  private readonly commissionBps: string;
  private readonly ttlSeconds: number;
  private readonly settlement: SettlementEstimate;
  private readonly minAmount: string;
  private readonly maxAmount: string;

  constructor(options: DemoFXProviderOptions) {
    this.marketData = options.marketData;
    this.spreadBps = options.spreadBps ?? DEFAULTS.spreadBps;
    this.flatFeeBase = options.flatFeeBase ?? DEFAULTS.flatFeeBase;
    this.commissionBps = options.commissionBps ?? DEFAULTS.commissionBps;
    this.ttlSeconds = options.quoteTtlSeconds ?? DEFAULTS.quoteTtlSeconds;
    this.settlement = options.settlement ?? DEFAULT_SETTLEMENT;
    this.minAmount = options.minAmount ?? DEFAULTS.minAmount;
    this.maxAmount = options.maxAmount ?? DEFAULTS.maxAmount;

    this.descriptor = {
      id: options.providerId ?? 'demo-fx-provider',
      name: options.providerName ?? 'Demo FX Provider',
      rail: 'payment_institution',
      licensing: 'unlicensed_sandbox',
      modes: ['sandbox'],
      jurisdictions: ['*'],
      description:
        'Demo FX counterparty pricing a spread and fees over an independent mid-market benchmark.',
      pricingVersion: 'demo-fx-1',
    };
  }

  supports(request: FXQuoteRequest): boolean {
    if (!isCurrencyCode(request.baseCurrency) || !isCurrencyCode(request.quoteCurrency)) {
      return false;
    }
    if (request.baseCurrency === request.quoteCurrency) {
      return false;
    }
    if (!this.marketData.supports(request)) {
      return false;
    }
    return this.withinLimits(request);
  }

  async getFXQuote(request: FXQuoteRequest, context: ProviderContext): Promise<FXQuote> {
    this.assertValidRequest(request);

    const marketRate = await this.marketData.getMarketRate(
      { baseCurrency: request.baseCurrency, quoteCurrency: request.quoteCurrency },
      context,
    );

    const mid = new Dec(marketRate.rate);
    if (!mid.isFinite() || mid.lessThanOrEqualTo(0)) {
      return Promise.reject(
        new ProviderError(
          this.descriptor.id,
          `market data returned an unusable mid rate of "${marketRate.rate}"`,
        ),
      );
    }

    // The offered rate is mid less the spread. This is the only place a price is formed.
    const offered = mid.times(new Dec(1).minus(new Dec(this.spreadBps).div(10_000)));
    if (offered.lessThanOrEqualTo(0)) {
      return Promise.reject(
        new ProviderError(this.descriptor.id, 'configured spread consumes the entire rate'),
      );
    }

    const timestampMs = context.clock.nowMs();
    const sendAmount = Money.ofMinorUnits(request.baseCurrency, request.amountMinorUnits);

    return {
      providerId: this.descriptor.id,
      baseCurrency: request.baseCurrency,
      quoteCurrency: request.quoteCurrency,
      rate: offered.toFixed(),
      // Passed through from the benchmark, so a consumer can see the spread rather than infer it.
      midMarketRate: mid.toFixed(),
      providerFee: this.flatFee(request.baseCurrency),
      additionalFees: this.commission(sendAmount),
      amountMinorUnits: request.amountMinorUnits,
      timestamp: new Date(timestampMs).toISOString(),
      expiresAt: new Date(timestampMs + this.ttlSeconds * 1_000).toISOString(),
      quoteReference: this.quoteReference(request, offered.toFixed()),
      settlement: { ...this.settlement },
      metadata: {
        spreadBps: this.spreadBps,
        marketDataProviderId: marketRate.providerId,
        marketDataSource: marketRate.source,
        marketDataTimestamp: marketRate.timestamp,
        indicativeOnly: true,
      },
    };
  }

  probe(context: ProviderContext): Promise<ProviderHealth> {
    // The provider is only as available as the benchmark it prices against, so its health is the
    // market data feed's health. Reporting itself up while its benchmark is down would be useless.
    return this.marketData.probe === undefined
      ? Promise.resolve({
          providerId: this.descriptor.id,
          state: 'up' as const,
          checkedAt: context.clock.nowIso(),
          latencyMs: 0,
          detail: 'market data provider exposes no probe',
        })
      : this.marketData.probe(context).then((health) => ({
          providerId: this.descriptor.id,
          state: health.state,
          checkedAt: health.checkedAt,
          latencyMs: health.latencyMs,
          detail: `market data: ${health.detail ?? 'no detail'}`,
        }));
  }

  private assertValidRequest(request: FXQuoteRequest): void {
    for (const code of [request.baseCurrency, request.quoteCurrency]) {
      if (!isCurrencyCode(code)) {
        throw new UnsupportedCurrencyError(String(code), SUPPORTED_CURRENCIES);
      }
    }
    if (request.baseCurrency === request.quoteCurrency) {
      throw new ValidationError('An FX quote needs two different currencies.', {
        currency: request.baseCurrency,
      });
    }
    if (!/^\d+$/.test(request.amountMinorUnits)) {
      throw new InvalidAmountError('Amount must be an integer minor-unit string.', {
        amountMinorUnits: request.amountMinorUnits,
      });
    }

    const amount = Money.ofMinorUnits(request.baseCurrency, request.amountMinorUnits);
    if (!amount.isPositive()) {
      throw new InvalidAmountError('Amount must be greater than zero.', {
        amountMinorUnits: request.amountMinorUnits,
      });
    }
    if (!this.withinLimits(request)) {
      throw new UnsupportedCorridorError(request.baseCurrency, request.quoteCurrency, {
        amount: amount.toString(),
        rails: null,
      });
    }
  }

  private withinLimits(request: FXQuoteRequest): boolean {
    if (!/^\d+$/.test(request.amountMinorUnits)) {
      return false;
    }
    const amount = Money.ofMinorUnits(request.baseCurrency, request.amountMinorUnits);
    const min = Money.fromDecimal(request.baseCurrency, this.minAmount, Rounding.HALF_UP);
    const max = Money.fromDecimal(request.baseCurrency, this.maxAmount, Rounding.HALF_UP);
    return !amount.lessThan(min) && !amount.greaterThan(max);
  }

  private flatFee(currency: CurrencyCode): ProviderFee | null {
    const fee = Money.fromDecimal(currency, this.flatFeeBase, Rounding.HALF_UP);
    if (fee.isZero()) {
      return null;
    }
    return {
      code: 'fx_transfer_fee',
      label: 'Transfer fee',
      side: 'source',
      currency,
      amountMinorUnits: fee.minorUnits.toString(),
      rateBps: null,
    };
  }

  private commission(sendAmount: Money): readonly ProviderFee[] {
    const bps = new Dec(this.commissionBps);
    if (bps.isZero()) {
      return [];
    }
    const amount = sendAmount.multiplyByRatio(bps.div(10_000), Rounding.HALF_UP);
    return [
      {
        code: 'fx_commission',
        label: 'FX commission',
        side: 'source',
        currency: sendAmount.currency,
        amountMinorUnits: amount.minorUnits.toString(),
        rateBps: this.commissionBps,
      },
    ];
  }

  /**
   * A stable reference for this exact price.
   *
   * Real providers return an opaque id. Deriving it from the pricing inputs means the same corridor,
   * size and rate always yields the same reference, which makes a demo or a regression fixture
   * diffable while still giving operations something to quote upstream.
   */
  private quoteReference(request: FXQuoteRequest, rate: string): string {
    const digest = createHash('sha256')
      .update(
        [
          this.descriptor.id,
          request.baseCurrency,
          request.quoteCurrency,
          request.amountMinorUnits,
          rate,
        ].join('|'),
        'utf8',
      )
      .digest('hex');
    return `demofx-${digest.slice(0, 12)}`;
  }
}
