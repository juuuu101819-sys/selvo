import {
  ProviderError,
  assertCurrencyCode,
  type FXProvider,
  type FXQuote,
  type FXQuoteRequest,
  type FeeComponent,
  type MarketDataProvider,
  type ProviderContext,
  type ProviderDescriptor,
  type ProviderFee,
  type ProviderHealth,
  type ProviderQuote,
  type QuoteRequest,
  type RouteProvider,
} from '@meridian/core';

export interface FXRouteProviderOptions {
  readonly fx: FXProvider;
  /**
   * Benchmark source.
   *
   * Optional: some providers disclose the mid they priced against, and those can be trusted to a
   * point. Supplying an independent feed is strongly preferred, because a provider's own idea of mid
   * is exactly the number it has an incentive to shade.
   */
  readonly marketData?: MarketDataProvider;
  readonly descriptor?: Partial<ProviderDescriptor>;
}

/**
 * Presents a capability provider to the routing engine.
 *
 * This is the whole answer to "never put provider-specific logic in the core routing engine". The
 * engine consumes one contract, `RouteProvider`, expressed in its own vocabulary: a mid-market
 * benchmark, an offered rate, a fee schedule, a settlement estimate, a slippage model. Anything
 * peculiar to a given upstream — that it prices in the spread rather than charging a fee, that it
 * publishes bid and ask instead of a mid, that its fees are quoted on the destination leg — is
 * resolved here, on the far side of that contract.
 *
 * The engine therefore never learns which kind of counterparty produced a price, and adding a new
 * class of provider is a new adapter rather than a change to the cost model.
 */
export class FXRouteProvider implements RouteProvider {
  readonly capability = 'route' as const;
  readonly descriptor: ProviderDescriptor;
  private readonly fx: FXProvider;
  private readonly marketData: MarketDataProvider | undefined;

  constructor(options: FXRouteProviderOptions) {
    this.fx = options.fx;
    this.marketData = options.marketData;
    this.descriptor = { ...options.fx.descriptor, ...options.descriptor };
  }

  supports(request: QuoteRequest): boolean {
    return this.fx.supports(toFXRequest(request));
  }

  async fetchQuote(request: QuoteRequest, context: ProviderContext): Promise<ProviderQuote> {
    const fxRequest = toFXRequest(request);
    const quote = await this.fx.getFXQuote(fxRequest, context);

    const midMarketRate = await this.resolveMidMarketRate(quote, fxRequest, context);

    return {
      providerId: quote.providerId,
      rail: this.descriptor.rail,
      quotedAt: quote.timestamp,
      expiresAt: quote.expiresAt,
      quoteReference: quote.quoteReference,
      sourceCurrency: quote.baseCurrency,
      targetCurrency: quote.quoteCurrency,
      midMarketRate,
      offeredRate: quote.rate,
      fees: { components: toFeeComponents(quote) },
      settlement: quote.settlement,
      // An FX desk quotes a firm rate, so there is no execution slippage to model. A liquidity venue
      // bridge supplies one; that difference belongs here, not in the engine.
      slippage: { kind: 'none' },
      reliabilityScore: reliabilityOf(this.descriptor),
      intermediaryAsset: null,
      pricingVersion: this.descriptor.pricingVersion,
      raw: {
        source: 'fx-provider-bridge',
        fxProviderId: quote.providerId,
        marketDataProviderId: this.marketData?.descriptor.id ?? null,
        midMarketRateSource: this.marketData === undefined ? 'provider_disclosed' : 'market_data',
        ...quote.metadata,
      },
    };
  }

  probe(context: ProviderContext): Promise<ProviderHealth> {
    return this.fx.probe === undefined
      ? Promise.resolve({
          providerId: this.descriptor.id,
          state: 'up' as const,
          checkedAt: context.clock.nowIso(),
          latencyMs: null,
          detail: 'underlying FX provider exposes no probe',
        })
      : this.fx.probe(context);
  }

  /**
   * Establishes the benchmark every cost figure will be measured against.
   *
   * An independent feed wins where one is configured. Falling back to the provider's disclosed mid
   * is a deliberate second choice, and having no benchmark at all is a hard failure rather than a
   * silent substitution of the offered rate — that substitution would report every route as costing
   * nothing, which is the most dangerous wrong answer this system could give.
   */
  private async resolveMidMarketRate(
    quote: FXQuote,
    request: FXQuoteRequest,
    context: ProviderContext,
  ): Promise<string> {
    if (this.marketData !== undefined) {
      const rate = await this.marketData.getMarketRate(
        { baseCurrency: request.baseCurrency, quoteCurrency: request.quoteCurrency },
        context,
      );
      return rate.rate;
    }

    if (quote.midMarketRate !== null) {
      return quote.midMarketRate;
    }

    throw new ProviderError(
      quote.providerId,
      'no mid-market benchmark available: the provider disclosed none and no market data ' +
        'provider is configured, so its cost cannot be measured',
    );
  }
}

function toFXRequest(request: QuoteRequest): FXQuoteRequest {
  return {
    baseCurrency: request.sourceCurrency,
    quoteCurrency: request.targetCurrency,
    amountMinorUnits: request.amountMinorUnits,
  };
}

function toFeeComponents(quote: FXQuote): readonly FeeComponent[] {
  const fees = quote.providerFee === null ? [] : [quote.providerFee];
  return [...fees, ...quote.additionalFees].map(toFeeComponent);
}

/**
 * Maps a provider charge onto the engine's fee model.
 *
 * A provider that states a basis-point rate is modelled as proportional so the engine applies it to
 * the actual notional rather than trusting a precomputed amount; anything else is a fixed charge.
 */
function toFeeComponent(fee: ProviderFee): FeeComponent {
  if (fee.rateBps !== null) {
    return {
      kind: 'proportional',
      code: fee.code,
      label: fee.label,
      side: fee.side,
      rateBps: fee.rateBps,
      minAmountMinorUnits: null,
      maxAmountMinorUnits: null,
    };
  }
  return {
    kind: 'fixed',
    code: fee.code,
    label: fee.label,
    side: fee.side,
    // Validated rather than cast: a fee currency arrives as wire data from the provider, and an
    // unrecognised code must fail loudly here rather than reach the money model.
    currency: assertCurrencyCode(fee.currency),
    amountMinorUnits: fee.amountMinorUnits,
  };
}

/**
 * Reliability for scoring.
 *
 * A descriptor carries no reliability figure, and inventing an optimistic one would quietly favour
 * new integrations over providers with a measured record. A neutral value is the honest default until
 * observed settlement data exists to replace it.
 */
function reliabilityOf(_descriptor: ProviderDescriptor): string {
  return '0.95';
}
