import { describe, expect, it } from 'vitest';
import { conversionKindOf } from './conversion.js';
import { assetKind, isFiatAsset, toAssetMinorUnits } from './asset.js';
import { categoryOfRail, defaultProfileForRail } from './provider-catalog.js';

describe('assets', () => {
  it('keeps ISO currencies as fiat and names stablecoins and crypto separately', () => {
    expect(assetKind('USD')).toBe('fiat');
    expect(assetKind('USDC')).toBe('stablecoin');
    expect(assetKind('ETH')).toBe('crypto');
    expect(isFiatAsset('KRW')).toBe(true);
    expect(isFiatAsset('USDC')).toBe(false);
  });

  it('converts major units using the asset exponent, not ISO 4217', () => {
    expect(toAssetMinorUnits('USD', '100.00')).toBe('10000');
    expect(toAssetMinorUnits('USDC', '1.5')).toBe('1500000');
    expect(toAssetMinorUnits('ETH', '1')).toBe('1000000000000000000');
  });
});

describe('conversion kinds', () => {
  it('covers every pair the product must be able to quote', () => {
    expect(conversionKindOf('USD', 'KRW')).toBe('fiat_fiat');
    expect(conversionKindOf('USD', 'USDC')).toBe('fiat_stablecoin');
    expect(conversionKindOf('USDC', 'USD')).toBe('stablecoin_fiat');
    expect(conversionKindOf('USDC', 'USDT')).toBe('stablecoin_stablecoin');
    expect(conversionKindOf('USDC', 'ETH')).toBe('stablecoin_crypto');
    expect(conversionKindOf('ETH', 'USDC')).toBe('crypto_stablecoin');
    expect(conversionKindOf('ETH', 'USD')).toBe('crypto_fiat');
  });
});

describe('provider catalog profiles', () => {
  it('maps rails onto TRADITIONAL / STABLECOIN / DEFI with the advertised feature tags', () => {
    expect(categoryOfRail('bank_fx')).toBe('traditional');
    expect(defaultProfileForRail('bank_fx').features).toEqual(['traditional', 'fx', 'fiat']);
    expect(defaultProfileForRail('stablecoin_settlement').features).toEqual([
      'stablecoin',
      'settlement',
    ]);
    expect(defaultProfileForRail('dex_liquidity').features).toEqual([
      'defi',
      'swap',
      'on_chain',
      'stablecoin',
    ]);
  });
});
