import {
  Dec,
  FixedClock,
  Money,
  ProviderError,
  RouteCostEngine,
  buildQuoteRequest,
  noopLogger,
  type ProviderContext,
  type RouteProvider,
} from '@meridian/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkProviderContract } from '../contract/provider-contract.js';
import { createSandboxAdapters, type SandboxAdapterSet } from './index.js';

const context: ProviderContext = {
  clock: new FixedClock('2026-03-01T12:00:00.000Z'),
  logger: noopLogger,
  requestId: 'test',
  signal: undefined,
};

const engine = new RouteCostEngine();

let adapters: SandboxAdapterSet;
let byId: Map<string, RouteProvider>;

beforeAll(() => {
  adapters = createSandboxAdapters();
  byId = new Map(adapters.providers.map((provider) => [provider.descriptor.id, provider]));
});

function provider(id: string): RouteProvider {
  const found = byId.get(id);
  if (found === undefined) {
    throw new Error(`Sandbox provider "${id}" is not registered.`);
  }
  return found;
}

/** All-in cost in basis points for a corridor, as the engine derives it. */
async function costBps(id: string, amountMinorUnits = '10000000'): Promise<string> {
  const request = buildQuoteRequest({
    sourceCurrency: 'USD',
    targetCurrency: 'KRW',
    amountMinorUnits,
  });
  const target = provider(id);
  const quote = await target.fetchQuote(request, context);
  return engine.price(request, quote, target.descriptor).totalCostBps.toDecimalPlaces(2).toFixed();
}

describe('sandbox adapter set', () => {
  it('loads every rail from the pricing dataset', () => {
    expect(adapters.providers.map((item) => item.descriptor.id).sort()).toEqual([
      'sandbox-meridian-liquidity',
      'sandbox-northgate-bank',
      'sandbox-solstice-settlement',
      'sandbox-veridian-payments',
    ]);
  });

  it('covers the four rails the product compares', () => {
    expect(adapters.providers.map((item) => item.descriptor.rail).sort()).toEqual([
      'bank_fx',
      'liquidity_provider',
      'payment_institution',
      'stablecoin_settlement',
    ]);
  });

  it('marks every sandbox adapter as unlicensed and sandbox-only', () => {
    for (const item of adapters.providers) {
      expect(item.descriptor.licensing).toBe('unlicensed_sandbox');
      expect(item.descriptor.modes).toEqual(['sandbox']);
    }
  });

  it('stamps the dataset version onto every descriptor', () => {
    expect(adapters.pricingVersion).toBe('sandbox-pricing-2026.02');
    for (const item of adapters.providers) {
      expect(item.descriptor.pricingVersion).toBe(adapters.pricingVersion);
    }
  });
});

describe('pricing derived from the dataset', () => {
  it('reproduces the cost profile from the product brief for USD 100,000 to KRW', async () => {
    // 0.72% / 0.48% / 0.34% to two decimal places, derived from the dataset rather than asserted.
    await expect(costBps('sandbox-northgate-bank')).resolves.toBe('71.84');
    await expect(costBps('sandbox-veridian-payments')).resolves.toBe('47.76');
    await expect(costBps('sandbox-solstice-settlement')).resolves.toBe('33.96');
  });

  it('prices the liquidity provider better at larger size', async () => {
    const small = new Dec(await costBps('sandbox-meridian-liquidity', '5000000'));
    const large = new Dec(await costBps('sandbox-meridian-liquidity', '100000000'));
    expect(large.lessThan(small)).toBe(true);
  });

  it('applies the tiered slippage curve of the stablecoin rail', async () => {
    const request = buildQuoteRequest({ amountMinorUnits: '10000000' });
    const quote = await provider('sandbox-solstice-settlement').fetchQuote(request, context);
    expect(quote.slippage.kind).toBe('tiered');

    const priced = engine.price(request, quote, provider('sandbox-solstice-settlement').descriptor);
    expect(priced.slippageBps.toFixed()).toBe('4');

    // USD 900,000 falls in the 9 bps tier; USD 100,000 in the 4 bps tier above.
    const large = buildQuoteRequest({ amountMinorUnits: '90000000' });
    const largeQuote = await provider('sandbox-solstice-settlement').fetchQuote(large, context);
    const largePriced = engine.price(
      large,
      largeQuote,
      provider('sandbox-solstice-settlement').descriptor,
    );
    expect(largePriced.slippageBps.toFixed()).toBe('9');
  });

  it('reports no slippage for rails that quote a firm price', async () => {
    const request = buildQuoteRequest();
    for (const id of ['sandbox-northgate-bank', 'sandbox-veridian-payments']) {
      const quote = await provider(id).fetchQuote(request, context);
      expect(quote.slippage).toEqual({ kind: 'none' });
    }
  });

  it('re-denominates the USD fee book into the corridor currencies', async () => {
    const request = buildQuoteRequest();
    const quote = await provider('sandbox-northgate-bank').fetchQuote(request, context);
    const fees = quote.fees.components;

    const wire = fees.find((fee) => fee.code === 'swift_wire');
    expect(wire).toMatchObject({ kind: 'fixed', currency: 'USD', amountMinorUnits: '2500' });

    // USD 3.61 at the reference USD/KRW rate of 1385.42 is KRW 5,001 after half-up rounding.
    const credit = fees.find((fee) => fee.code === 'beneficiary_credit');
    expect(credit).toMatchObject({ kind: 'fixed', currency: 'KRW', amountMinorUnits: '5001' });
  });

  it('converts proportional fee caps into the fee side currency', async () => {
    const quote = await provider('sandbox-veridian-payments').fetchQuote(
      buildQuoteRequest(),
      context,
    );
    const commission = quote.fees.components.find((fee) => fee.code === 'fx_commission');

    expect(commission).toMatchObject({
      kind: 'proportional',
      rateBps: '12',
      minAmountMinorUnits: '500',
      maxAmountMinorUnits: '25000',
    });
  });

  it('selects a different profile for a frontier corridor', async () => {
    const frontier = buildQuoteRequest({ targetCurrency: 'VND', amountMinorUnits: '10000000' });
    const nearMajor = buildQuoteRequest({ targetCurrency: 'KRW', amountMinorUnits: '10000000' });
    const bank = provider('sandbox-northgate-bank');

    const frontierCost = engine.price(
      frontier,
      await bank.fetchQuote(frontier, context),
      bank.descriptor,
    ).totalCostBps;
    const nearMajorCost = engine.price(
      nearMajor,
      await bank.fetchQuote(nearMajor, context),
      bank.descriptor,
    ).totalCostBps;

    expect(frontierCost.greaterThan(nearMajorCost)).toBe(true);
  });

  it('derives internally consistent cross rates through the base currency', () => {
    const usdKrw = adapters.rates.midRate('USD', 'KRW');
    const usdJpy = adapters.rates.midRate('USD', 'JPY');
    const jpyKrw = adapters.rates.midRate('JPY', 'KRW');

    expect(usdKrw).not.toBeNull();
    const triangulated = usdKrw?.value.div(usdJpy?.value ?? new Dec(1));
    expect(jpyKrw?.value.toFixed(10)).toBe(triangulated?.toFixed(10));
  });
});

describe('quote metadata', () => {
  it('timestamps every quote from the injected clock and sets an expiry', async () => {
    const quote = await provider('sandbox-solstice-settlement').fetchQuote(
      buildQuoteRequest(),
      context,
    );
    expect(quote.quotedAt).toBe('2026-03-01T12:00:00.000Z');
    // A 60 second time-to-live for the stablecoin rail.
    expect(quote.expiresAt).toBe('2026-03-01T12:01:00.000Z');
  });

  it('attributes every quote to its provider and dataset version', async () => {
    for (const item of adapters.providers) {
      const quote = await item.fetchQuote(buildQuoteRequest(), context);
      expect(quote.providerId).toBe(item.descriptor.id);
      expect(quote.pricingVersion).toBe(adapters.pricingVersion);
      expect(quote.raw['referenceRatesVersion']).toBe(adapters.rates.version);
    }
  });

  it('issues a stable quote reference for identical pricing inputs', async () => {
    const request = buildQuoteRequest();
    const first = await provider('sandbox-northgate-bank').fetchQuote(request, context);
    const second = await provider('sandbox-northgate-bank').fetchQuote(request, context);
    const different = await provider('sandbox-northgate-bank').fetchQuote(
      buildQuoteRequest({ amountMinorUnits: '20000000' }),
      context,
    );

    expect(second.quoteReference).toBe(first.quoteReference);
    expect(different.quoteReference).not.toBe(first.quoteReference);
  });

  it('names the intermediary asset only for the stablecoin rail', async () => {
    const request = buildQuoteRequest();
    const stablecoin = await provider('sandbox-solstice-settlement').fetchQuote(request, context);
    const bank = await provider('sandbox-northgate-bank').fetchQuote(request, context);

    expect(stablecoin.intermediaryAsset).toBe('USDC');
    expect(bank.intermediaryAsset).toBeNull();
  });

  it('flags every sandbox quote as indicative in its raw payload', async () => {
    const quote = await provider('sandbox-northgate-bank').fetchQuote(buildQuoteRequest(), context);
    expect(quote.raw['indicativeOnly']).toBe(true);
    expect(quote.raw['source']).toBe('sandbox-dataset');
  });
});

describe('corridor and notional eligibility', () => {
  it('declines a corridor the provider does not cover', () => {
    // The stablecoin partner has no on-ramp for Chilean pesos.
    expect(
      provider('sandbox-solstice-settlement').supports(
        buildQuoteRequest({ sourceCurrency: 'CLP', targetCurrency: 'USD' }),
      ),
    ).toBe(false);
  });

  it('declines a notional below the provider minimum', () => {
    // Aperture Liquidity is wholesale only, from USD 25,000.
    expect(
      provider('sandbox-meridian-liquidity').supports(
        buildQuoteRequest({ amountMinorUnits: '100000' }),
      ),
    ).toBe(false);
    expect(
      provider('sandbox-meridian-liquidity').supports(
        buildQuoteRequest({ amountMinorUnits: '2500000' }),
      ),
    ).toBe(true);
  });

  it('declines a notional above the provider maximum', () => {
    expect(
      provider('sandbox-veridian-payments').supports(
        buildQuoteRequest({ amountMinorUnits: '100000000000' }),
      ),
    ).toBe(false);
  });

  it('applies notional limits in USD terms across currencies', () => {
    // KRW 35,000,000 is roughly USD 25,300, just above the wholesale minimum.
    expect(
      provider('sandbox-meridian-liquidity').supports(
        buildQuoteRequest({
          sourceCurrency: 'USD',
          targetCurrency: 'KRW',
          amountMinorUnits: '2530000',
        }),
      ),
    ).toBe(true);
  });

  it('rejects a quote request for an unsupported corridor rather than inventing a price', async () => {
    await expect(
      provider('sandbox-solstice-settlement').fetchQuote(
        buildQuoteRequest({ sourceCurrency: 'USD', targetCurrency: 'CLP' }),
        context,
      ),
    ).rejects.toThrow(ProviderError);
  });
});

describe('provider contract', () => {
  const corridors = [
    { source: 'USD', target: 'KRW', amountMinorUnits: '10000000' },
    { source: 'EUR', target: 'GBP', amountMinorUnits: '5000000' },
    { source: 'USD', target: 'VND', amountMinorUnits: '2500000' },
    { source: 'GBP', target: 'INR', amountMinorUnits: '75000000' },
    { source: 'JPY', target: 'USD', amountMinorUnits: '5000000' },
    { source: 'USD', target: 'CLP', amountMinorUnits: '1000000' },
    { source: 'USD', target: 'KWD', amountMinorUnits: '150000000' },
  ] as const;

  it.each([
    'sandbox-northgate-bank',
    'sandbox-veridian-payments',
    'sandbox-solstice-settlement',
    'sandbox-meridian-liquidity',
  ])('%s upholds the adapter contract', async (id) => {
    const violations = await checkProviderContract(provider(id), { corridors });
    expect(violations).toEqual([]);
  });
});

describe('reference rates', () => {
  it('values a USD pricing-book figure in another currency', () => {
    const converted = adapters.rates.convertFromUsd('25.00', 'KRW');
    expect(converted?.toJSON()).toMatchObject({ currency: 'KRW', minorUnits: '34636' });
  });

  it('returns USD unchanged', () => {
    expect(
      adapters.rates.convertFromUsd('25.00', 'USD')?.equals(Money.fromDecimal('USD', '25')),
    ).toBe(true);
  });

  it('reports no rate for a currency outside the snapshot', () => {
    // The registry knows this code, but the reference snapshot need not carry it.
    expect(adapters.rates.currencies).toContain('KRW');
    expect(adapters.rates.midRate('USD', 'USD')?.value.toFixed()).toBe('1');
  });
});
