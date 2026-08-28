import { FixedClock, FinancialProviderRegistry, noopLogger } from '@meridian/core';
import { describe, expect, it } from 'vitest';
import { createFinancialCatalog, createSandboxAdapters } from '../index.js';
import { DemoAmmProvider } from './demo-amm-provider.js';
import { DemoDexAggregatorProvider } from './demo-dex-aggregator.js';
import { DemoDexProvider } from './demo-dex-provider.js';
import { DemoStablecoinRampProvider } from './demo-stablecoin-ramp.js';

const clock = new FixedClock('2026-03-01T09:00:00.000Z');
const context = {
  clock,
  logger: noopLogger,
  requestId: 'test',
  signal: undefined,
};

describe('financial provider catalog', () => {
  const sandbox = createSandboxAdapters();
  const catalog = FinancialProviderRegistry.create(
    'sandbox',
    createFinancialCatalog(sandbox.providers),
  );

  it('omits ramp and DeFi demo adapters when includeDemoAdapters is false', () => {
    const productionCatalog = FinancialProviderRegistry.create(
      'production',
      createFinancialCatalog([], { includeDemoAdapters: false }),
    );
    expect(productionCatalog.all()).toEqual([]);
  });

  it('wraps the four comparison-engine rails and adds ramp plus three DeFi demos', () => {
    expect(sandbox.providers).toHaveLength(4);
    expect(catalog.all()).toHaveLength(8);
    expect(catalog.byCategory('traditional').length).toBeGreaterThanOrEqual(3);
    expect(catalog.byCategory('stablecoin').map((provider) => provider.descriptor.id)).toEqual(
      expect.arrayContaining(['sandbox-solstice-settlement', 'demo-helios-ramp']),
    );
    expect(catalog.byCategory('defi').map((provider) => provider.descriptor.id).sort()).toEqual([
      'demo-horizon-aggregator',
      'demo-meridian-pool',
      'demo-ridgeline-dex',
    ]);
  });

  it('advertises the example capability tags', () => {
    const fx = catalog.get('sandbox-northgate-bank');
    expect(fx?.getCapabilities().features).toEqual(['traditional', 'fx', 'fiat']);

    const ramp = catalog.get('demo-helios-ramp');
    expect(ramp?.getCapabilities().features).toEqual([
      'stablecoin',
      'settlement',
      'on_off_ramp',
    ]);

    const dex = catalog.get('demo-meridian-pool');
    expect(dex?.getCapabilities().features).toEqual([
      'defi',
      'swap',
      'on_chain',
      'stablecoin',
      'amm',
    ]);
  });

  it('still quotes fiat → fiat on a wrapped bank without changing the engine contract', async () => {
    const bank = catalog.get('sandbox-northgate-bank');
    expect(bank).not.toBeNull();
    const quote = await bank!.getQuote(
      {
        sourceAsset: 'USD',
        targetAsset: 'KRW',
        amountMinorUnits: '10000000',
        requestedAt: clock.nowIso(),
      },
      context,
    );
    expect(quote.conversionKind).toBe('fiat_fiat');
    expect(quote.executable).toBe(false);
    expect(quote.indicatedRate).toMatch(/^\d/);
  });
});

describe('Helios Ramp', () => {
  const ramp = new DemoStablecoinRampProvider();

  it('quotes USD → USDC and USDC → USD', async () => {
    const onRamp = await ramp.getQuote(
      {
        sourceAsset: 'USD',
        targetAsset: 'USDC',
        amountMinorUnits: '10000000',
        requestedAt: clock.nowIso(),
      },
      context,
    );
    expect(onRamp.conversionKind).toBe('fiat_stablecoin');
    expect(onRamp.executable).toBe(false);
    expect(onRamp.metadata['mintOrBurn']).toBe(false);

    const offRamp = await ramp.getQuote(
      {
        sourceAsset: 'USDC',
        targetAsset: 'USD',
        amountMinorUnits: '1000000',
        requestedAt: clock.nowIso(),
      },
      context,
    );
    expect(offRamp.conversionKind).toBe('stablecoin_fiat');
  });

  it('quotes USD → USDT from the same rate table, not a second code path', async () => {
    const quote = await ramp.getQuote(
      {
        sourceAsset: 'USD',
        targetAsset: 'USDT',
        amountMinorUnits: '10000000',
        requestedAt: clock.nowIso(),
      },
      context,
    );
    expect(quote.conversionKind).toBe('fiat_stablecoin');
    expect(quote.executable).toBe(false);
    expect(quote.indicatedRate).toBe('0.9992');
  });

  it('quotes USDC → KRW as a demo off-ramp', async () => {
    const quote = await ramp.getQuote(
      {
        sourceAsset: 'USDC',
        targetAsset: 'KRW',
        amountMinorUnits: '1000000000',
        requestedAt: clock.nowIso(),
      },
      context,
    );
    expect(quote.conversionKind).toBe('stablecoin_fiat');
    expect(quote.executable).toBe(false);
    expect(quote.indicatedRate).toBe('1374.2');
    expect(quote.midMarketRate).toBe('1380');
  });

  it('does not price USDT → KRW — that corridor stays adapter data, not an engine special case', () => {
    expect(
      ramp.supportsNormalized({
        sourceAsset: 'USDT',
        targetAsset: 'KRW',
        amountMinorUnits: '1000000',
        requestedAt: clock.nowIso(),
      }),
    ).toBe(false);
  });
});

describe('Meridian Pool AMM', () => {
  const amm = new DemoAmmProvider();

  it('quotes USDC → ETH as read-only depth, never as an executable swap', async () => {
    const quote = await amm.getQuote(
      {
        sourceAsset: 'USDC',
        targetAsset: 'ETH',
        amountMinorUnits: '10000000000',
        requestedAt: clock.nowIso(),
      },
      context,
    );
    expect(quote.conversionKind).toBe('stablecoin_crypto');
    expect(quote.executable).toBe(false);
    expect(quote.metadata['holdPrivateKeys']).toBe(false);
    expect(quote.metadata['submitTransaction']).toBe(false);
    expect(Object.keys(amm)).not.toContain('privateKey');
  });

  it('exposes getDepth for the DexLiquidityProvider shape', async () => {
    const depth = await amm.getDepth(
      {
        baseAsset: 'ETH',
        quoteAsset: 'USDC',
        amountMinorUnits: '1000000000000000000',
        chainId: 'eip155:1',
      },
      context,
    );
    expect(depth.indicatedRate).toBe('3492');
    expect(depth.venue).toBe('Meridian Pool');
  });
});

describe('Horizon Aggregator', () => {
  const aggregator = new DemoDexAggregatorProvider();

  it('can represent crypto → fiat as an indicative composite quote', async () => {
    const quote = await aggregator.getQuote(
      {
        sourceAsset: 'ETH',
        targetAsset: 'USD',
        amountMinorUnits: '1000000000000000000',
        requestedAt: clock.nowIso(),
      },
      context,
    );
    expect(quote.conversionKind).toBe('crypto_fiat');
    expect(quote.executable).toBe(false);
    expect(quote.metadata['composite']).toBe(true);
  });
});

describe('Ridgeline DEX', () => {
  const dex = new DemoDexProvider();

  it('exposes the normalised DeFi liquidity methods without keys, wallets or swaps', async () => {
    expect(dex.venueKind).toBe('dex');
    expect(dex.getSupportedTokens().map((asset) => asset.code).sort()).toEqual([
      'ETH',
      'USDC',
      'USDT',
    ]);
    expect(dex.getSupportedChains().every((chain) => chain.connected === false)).toBe(true);
    expect(dex.getSupportedChains().some((chain) => chain.namespace === 'solana')).toBe(true);

    const request = {
      sourceAsset: 'USDC',
      targetAsset: 'USDT',
      amountMinorUnits: '10000000',
      requestedAt: clock.nowIso(),
    };
    const quote = await dex.getQuote(request, context);
    const liquidity = await dex.getLiquidity(request, context);
    const swapFee = await dex.getSwapFee(request, context);
    const slippage = await dex.getEstimatedSlippage(request, context);
    const networkFee = await dex.getNetworkFee(request, context);

    expect(quote.executable).toBe(false);
    expect(quote.conversionKind).toBe('stablecoin_stablecoin');
    expect(quote.metadata['connectWallet']).toBe(false);
    expect(liquidity.venue).toBe('Ridgeline DEX');
    expect(swapFee.code).toBe('dex_fee');
    expect(slippage.kind).toBe('none');
    expect(networkFee.code).toBe('gas');
    expect(Object.keys(dex)).not.toContain('privateKey');
  });
});
