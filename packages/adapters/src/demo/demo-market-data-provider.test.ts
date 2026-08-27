import {
  Dec,
  FixedClock,
  UnsupportedCorridorError,
  UnsupportedCurrencyError,
  ValidationError,
  noopLogger,
  type CurrencyCode,
  type ProviderContext,
} from '@meridian/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSandboxAdapters } from '../sandbox/index.js';
import { DemoMarketDataProvider } from './demo-market-data-provider.js';

let clock: FixedClock;
let context: ProviderContext;
let provider: DemoMarketDataProvider;

beforeEach(() => {
  clock = new FixedClock('2026-03-01T12:00:00.000Z');
  context = { clock, logger: noopLogger, requestId: 'req-1', signal: undefined };
  provider = new DemoMarketDataProvider({ rates: createSandboxAdapters().rates });
});

const CORRIDORS = [
  { base: 'USD', quote: 'KRW' },
  { base: 'USD', quote: 'EUR' },
  { base: 'EUR', quote: 'JPY' },
] as const;

describe('DemoMarketDataProvider', () => {
  it.each(CORRIDORS)('publishes a mid rate for $base/$quote', async ({ base, quote }) => {
    const rate = await provider.getMarketRate(
      { baseCurrency: base, quoteCurrency: quote },
      context,
    );

    expect(rate).toMatchObject({
      providerId: 'demo-market-data',
      baseCurrency: base,
      quoteCurrency: quote,
      timestamp: '2026-03-01T12:00:00.000Z',
    });
    expect(new Dec(rate.rate).greaterThan(0)).toBe(true);
  });

  it('stamps every observation with an expiry, since a mid rate goes off quickly', async () => {
    const rate = await provider.getMarketRate(
      { baseCurrency: 'USD', quoteCurrency: 'KRW' },
      context,
    );

    expect(rate.expiresAt).toBe('2026-03-01T12:00:30.000Z');
  });

  it('honours a configured time to live', async () => {
    const shortLived = new DemoMarketDataProvider({
      rates: createSandboxAdapters().rates,
      rateTtlSeconds: 5,
    });
    const rate = await shortLived.getMarketRate(
      { baseCurrency: 'USD', quoteCurrency: 'KRW' },
      context,
    );

    expect(rate.expiresAt).toBe('2026-03-01T12:00:05.000Z');
  });

  /**
   * Naming the dataset version on every observation is what lets a disputed cost figure be traced
   * back to the exact reference data that produced it.
   */
  it('names its provenance rather than returning a bare number', async () => {
    const rate = await provider.getMarketRate(
      { baseCurrency: 'USD', quoteCurrency: 'KRW' },
      context,
    );

    expect(rate.source).toContain('sandbox-reference-2026.02');
    expect(rate.metadata).toMatchObject({ indicativeOnly: true });
  });

  it('derives a two-sided price so consumers of bid and ask are exercised in demo mode', async () => {
    const rate = await provider.getMarketRate(
      { baseCurrency: 'USD', quoteCurrency: 'KRW' },
      context,
    );

    const mid = new Dec(rate.rate);
    expect(new Dec(rate.bid ?? '0').lessThan(mid)).toBe(true);
    expect(new Dec(rate.ask ?? '0').greaterThan(mid)).toBe(true);
  });

  it('derives cross rates consistently through the base currency', async () => {
    const usdKrw = await provider.getMarketRate(
      { baseCurrency: 'USD', quoteCurrency: 'KRW' },
      context,
    );
    const usdJpy = await provider.getMarketRate(
      { baseCurrency: 'USD', quoteCurrency: 'JPY' },
      context,
    );
    const jpyKrw = await provider.getMarketRate(
      { baseCurrency: 'JPY', quoteCurrency: 'KRW' },
      context,
    );

    const triangulated = new Dec(usdKrw.rate).div(new Dec(usdJpy.rate));
    expect(new Dec(jpyKrw.rate).toFixed(10)).toBe(triangulated.toFixed(10));
  });

  it('rejects a currency outside the registry', async () => {
    await expect(
      provider.getMarketRate(
        { baseCurrency: 'XXX' as CurrencyCode, quoteCurrency: 'KRW' },
        context,
      ),
    ).rejects.toThrow(UnsupportedCurrencyError);
  });

  it('rejects a same-currency pair', async () => {
    await expect(
      provider.getMarketRate({ baseCurrency: 'USD', quoteCurrency: 'USD' }, context),
    ).rejects.toThrow(ValidationError);
  });

  it('reports a corridor the snapshot does not cover', async () => {
    const empty = new DemoMarketDataProvider({
      rates: {
        version: 'empty',
        asOf: '2026-01-01T00:00:00.000Z',
        currencies: [],
        midRate: () => null,
        convertFromUsd: () => null,
      },
    });

    await expect(
      empty.getMarketRate({ baseCurrency: 'USD', quoteCurrency: 'KRW' }, context),
    ).rejects.toThrow(UnsupportedCorridorError);
  });

  it('declines rather than throwing when asked what it supports', () => {
    expect(provider.supports({ baseCurrency: 'USD', quoteCurrency: 'KRW' })).toBe(true);
    expect(provider.supports({ baseCurrency: 'USD', quoteCurrency: 'USD' })).toBe(false);
    expect(provider.supports({ baseCurrency: 'XXX' as CurrencyCode, quoteCurrency: 'KRW' })).toBe(
      false,
    );
  });

  it('reports coverage rather than pretending to check a network path', async () => {
    const health = await provider.probe?.(context);

    expect(health).toMatchObject({ providerId: 'demo-market-data', state: 'up', latencyMs: 0 });
    expect(health?.detail).toContain('currencies covered');
  });
});
