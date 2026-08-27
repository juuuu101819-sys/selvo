import type {
  FeeSchedule,
  ProviderDescriptor,
  ProviderQuote,
  QuoteRequest,
  RailType,
  SettlementEstimate,
  SlippageModel,
} from '../domain/index.js';
import type { CurrencyCode } from '../money/index.js';
import type { ProviderContext, RouteProvider } from '../ports/index.js';

/**
 * Test builders. Shipped with the package so the API integration tests and future adapter
 * conformance suites construct quotes the same way the unit tests do, instead of each growing its
 * own subtly different fixture.
 */

export interface QuoteRequestOverrides {
  readonly sourceCurrency?: CurrencyCode;
  readonly targetCurrency?: CurrencyCode;
  readonly amountMinorUnits?: string;
  readonly rails?: readonly RailType[] | null;
  readonly requestedAt?: string;
}

export function buildQuoteRequest(overrides: QuoteRequestOverrides = {}): QuoteRequest {
  return {
    sourceCurrency: overrides.sourceCurrency ?? 'USD',
    targetCurrency: overrides.targetCurrency ?? 'KRW',
    amountMinorUnits: overrides.amountMinorUnits ?? '10000000',
    rails: overrides.rails ?? null,
    requestedAt: overrides.requestedAt ?? '2026-01-01T00:00:00.000Z',
  };
}

export interface ProviderQuoteOverrides {
  readonly providerId?: string;
  readonly rail?: RailType;
  readonly quotedAt?: string;
  readonly expiresAt?: string | null;
  readonly quoteReference?: string | null;
  readonly sourceCurrency?: CurrencyCode;
  readonly targetCurrency?: CurrencyCode;
  readonly midMarketRate?: string;
  readonly offeredRate?: string;
  readonly fees?: FeeSchedule;
  readonly settlement?: Partial<SettlementEstimate>;
  readonly slippage?: SlippageModel;
  readonly reliabilityScore?: string;
  readonly intermediaryAsset?: string | null;
  readonly pricingVersion?: string;
}

export function buildProviderQuote(overrides: ProviderQuoteOverrides = {}): ProviderQuote {
  return {
    providerId: overrides.providerId ?? 'test-provider',
    rail: overrides.rail ?? 'bank_fx',
    quotedAt: overrides.quotedAt ?? '2026-01-01T00:00:00.000Z',
    expiresAt: overrides.expiresAt ?? null,
    quoteReference: overrides.quoteReference ?? null,
    sourceCurrency: overrides.sourceCurrency ?? 'USD',
    targetCurrency: overrides.targetCurrency ?? 'KRW',
    midMarketRate: overrides.midMarketRate ?? '1300',
    offeredRate: overrides.offeredRate ?? '1300',
    fees: overrides.fees ?? { components: [] },
    settlement: {
      p50Seconds: 3600,
      p95Seconds: 7200,
      businessDaysOnly: false,
      cutoffUtc: null,
      notes: null,
      ...overrides.settlement,
    },
    slippage: overrides.slippage ?? { kind: 'none' },
    reliabilityScore: overrides.reliabilityScore ?? '0.99',
    intermediaryAsset: overrides.intermediaryAsset ?? null,
    pricingVersion: overrides.pricingVersion ?? 'test-1',
    raw: {},
  };
}

export function buildProviderDescriptor(
  overrides: Partial<ProviderDescriptor> = {},
): ProviderDescriptor {
  return {
    id: 'test-provider',
    name: 'Test Provider',
    rail: 'bank_fx',
    licensing: 'unlicensed_sandbox',
    modes: ['sandbox'],
    jurisdictions: ['*'],
    description: 'Test double.',
    pricingVersion: 'test-1',
    ...overrides,
  };
}

export type StubBehaviour =
  | { readonly kind: 'quote'; readonly quote: ProviderQuote }
  | { readonly kind: 'reject'; readonly error: Error }
  | { readonly kind: 'hang' };

/** A `RouteProvider` whose behaviour is scripted, for exercising the orchestration paths. */
export class StubRouteProvider implements RouteProvider {
  readonly capability = 'route' as const;
  readonly descriptor: ProviderDescriptor;
  calls = 0;

  constructor(
    descriptor: Partial<ProviderDescriptor>,
    private readonly behaviour: StubBehaviour,
    private readonly eligible: boolean = true,
  ) {
    this.descriptor = buildProviderDescriptor(descriptor);
  }

  supports(): boolean {
    return this.eligible;
  }

  async fetchQuote(_request: QuoteRequest, _context: ProviderContext): Promise<ProviderQuote> {
    this.calls += 1;
    switch (this.behaviour.kind) {
      case 'quote':
        return Promise.resolve(this.behaviour.quote);
      case 'reject':
        return Promise.reject(this.behaviour.error);
      case 'hang':
        return new Promise<ProviderQuote>(() => {
          // Never settles: exercises the per-provider quote timeout.
        });
    }
  }
}
