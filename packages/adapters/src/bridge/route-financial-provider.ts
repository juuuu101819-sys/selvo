import {
  SUPPORTED_CURRENCIES,
  UnsupportedCorridorError,
  conversionKindOf,
  defaultProfileForRail,
  isCurrencyCode,
  isFiatAsset,
  type AssetDefinition,
  type CurrencyCode,
  type FeeComponent,
  type FinancialProvider,
  type LiquidityInfo,
  type NormalizedFee,
  type NormalizedQuote,
  type NormalizedQuoteRequest,
  type ProviderCapabilityProfile,
  type ProviderContext,
  type ProviderDescriptor,
  type ProviderHealth,
  type ProviderQuote,
  type QuoteRequest,
  type RouteProvider,
  type SettlementEstimate,
  ASSET_REGISTRY,
} from '@meridian/core';

/**
 * Presents an existing {@link RouteProvider} through the multi-rail {@link FinancialProvider}
 * contract without changing how the comparison engine talks to it.
 *
 * Fiat → fiat only. Stablecoin and DeFi pairs belong on dedicated catalog adapters, not on a
 * bank FX desk that has never heard of ETH.
 */
export class RouteFinancialProvider implements FinancialProvider {
  readonly capability = 'financial' as const;
  readonly descriptor: ProviderDescriptor;
  private readonly route: RouteProvider;
  private readonly profile: ProviderCapabilityProfile;
  private currencyCache: readonly CurrencyCode[] | null = null;

  constructor(route: RouteProvider, profile?: ProviderCapabilityProfile) {
    this.route = route;
    this.descriptor = route.descriptor;
    const defaults = defaultProfileForRail(route.descriptor.rail);
    this.profile = profile ?? {
      ...defaults,
      conversionKinds: ['fiat_fiat'],
    };
  }

  getCapabilities(): ProviderCapabilityProfile {
    return this.profile;
  }

  getSupportedCurrencies(): readonly CurrencyCode[] {
    this.currencyCache ??= discoverFiatCoverage(this.route);
    return this.currencyCache;
  }

  getSupportedAssets(): readonly AssetDefinition[] {
    return this.getSupportedCurrencies()
      .map((code) => ASSET_REGISTRY[code])
      .filter((asset): asset is AssetDefinition => asset !== undefined);
  }

  supportsNormalized(request: NormalizedQuoteRequest): boolean {
    if (!isFiatAsset(request.sourceAsset) || !isFiatAsset(request.targetAsset)) {
      return false;
    }
    if (!isCurrencyCode(request.sourceAsset) || !isCurrencyCode(request.targetAsset)) {
      return false;
    }
    return this.route.supports(toQuoteRequest(request, request.sourceAsset, request.targetAsset));
  }

  async getQuote(
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ): Promise<NormalizedQuote> {
    const quote = await this.fetchEngineQuote(request, context);
    return toNormalizedQuote(quote, request);
  }

  async getSettlementEstimate(
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ): Promise<SettlementEstimate> {
    return (await this.fetchEngineQuote(request, context)).settlement;
  }

  async getFees(
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ): Promise<readonly NormalizedFee[]> {
    const quote = await this.fetchEngineQuote(request, context);
    return feesOf(quote, request.sourceAsset, request.targetAsset);
  }

  async getLiquidityInfo(
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ): Promise<LiquidityInfo> {
    const quote = await this.fetchEngineQuote(request, context);
    return {
      availableDepthMinorUnits: quote.liquidity?.availableDepthMinorUnits ?? null,
      venue: this.descriptor.name,
      chainId: null,
    };
  }

  probe(context: ProviderContext): Promise<ProviderHealth> {
    if (this.route.probe === undefined) {
      return Promise.resolve({
        providerId: this.descriptor.id,
        state: 'up',
        checkedAt: context.clock.nowIso(),
        latencyMs: 0,
        detail: 'static dataset',
      });
    }
    return this.route.probe(context);
  }

  private async fetchEngineQuote(
    request: NormalizedQuoteRequest,
    context: ProviderContext,
  ): Promise<ProviderQuote> {
    if (!this.supportsNormalized(request)) {
      throw new UnsupportedCorridorError(request.sourceAsset, request.targetAsset);
    }
    if (!isCurrencyCode(request.sourceAsset) || !isCurrencyCode(request.targetAsset)) {
      throw new UnsupportedCorridorError(request.sourceAsset, request.targetAsset);
    }
    return this.route.fetchQuote(
      toQuoteRequest(request, request.sourceAsset, request.targetAsset),
      context,
    );
  }
}

function toQuoteRequest(
  request: NormalizedQuoteRequest,
  source: CurrencyCode,
  target: CurrencyCode,
): QuoteRequest {
  return {
    sourceCurrency: source,
    targetCurrency: target,
    amountMinorUnits: request.amountMinorUnits,
    rails: null,
    requestedAt: request.requestedAt,
  };
}

function toNormalizedQuote(quote: ProviderQuote, request: NormalizedQuoteRequest): NormalizedQuote {
  return {
    providerId: quote.providerId,
    timestamp: quote.quotedAt,
    expiresAt: quote.expiresAt ?? quote.quotedAt,
    quoteReference: quote.quoteReference,
    conversionKind: conversionKindOf(request.sourceAsset, request.targetAsset),
    sourceAsset: request.sourceAsset,
    targetAsset: request.targetAsset,
    amountMinorUnits: request.amountMinorUnits,
    indicatedRate: quote.offeredRate,
    midMarketRate: quote.midMarketRate,
    fees: feesOf(quote, request.sourceAsset, request.targetAsset),
    settlement: quote.settlement,
    liquidity: {
      availableDepthMinorUnits: quote.liquidity?.availableDepthMinorUnits ?? null,
      venue: quote.providerId,
      chainId: null,
    },
    slippage: quote.slippage,
    reliabilityScore: quote.reliabilityScore,
    executable: false,
    chainId: null,
    metadata: {
      rail: quote.rail,
      intermediaryAsset: quote.intermediaryAsset,
      pricingVersion: quote.pricingVersion,
    },
  };
}

function feesOf(quote: ProviderQuote, source: string, target: string): readonly NormalizedFee[] {
  return quote.fees.components.map((component) => toNormalizedFee(component, source, target));
}

function toNormalizedFee(component: FeeComponent, source: string, target: string): NormalizedFee {
  if (component.kind === 'fixed') {
    return {
      code: component.code,
      label: component.label,
      side: component.side,
      kind: 'fixed',
      asset: component.currency,
      amountMinorUnits: component.amountMinorUnits,
      rateBps: null,
    };
  }
  return {
    code: component.code,
    label: component.label,
    side: component.side,
    kind: 'proportional',
    asset: component.side === 'source' ? source : target,
    amountMinorUnits: null,
    rateBps: component.rateBps,
  };
}

function discoverFiatCoverage(route: RouteProvider): readonly CurrencyCode[] {
  const covered = new Set<CurrencyCode>();
  const sample = '10000000';
  for (const source of SUPPORTED_CURRENCIES) {
    for (const target of SUPPORTED_CURRENCIES) {
      if (source === target) {
        continue;
      }
      if (
        route.supports({
          sourceCurrency: source,
          targetCurrency: target,
          amountMinorUnits: sample,
          rails: null,
          requestedAt: '2026-01-01T00:00:00.000Z',
        })
      ) {
        covered.add(source);
        covered.add(target);
      }
    }
  }
  return [...covered].sort((left, right) => left.localeCompare(right, 'en'));
}
