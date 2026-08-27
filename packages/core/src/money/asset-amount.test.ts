import { describe, expect, it } from 'vitest';
import { AssetAmount } from '../money/asset-amount.js';

describe('AssetAmount', () => {
  it('stores USDC with six decimal places as integer minor units', () => {
    const amount = AssetAmount.fromDecimal('USDC', '100000');
    expect(amount.minorUnits).toBe(100_000_000_000n);
    expect(amount.toJSON()).toEqual({
      asset: 'USDC',
      minorUnits: '100000000000',
      decimal: '100000.000000',
      exponent: 6,
    });
  });

  it('rejects arithmetic across assets', () => {
    expect(() => AssetAmount.fromDecimal('USD', '1').add(AssetAmount.fromDecimal('USDC', '1'))).toThrow(
      /USD and USDC/,
    );
  });
});
