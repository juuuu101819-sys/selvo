import { describe, expect, it } from 'vitest';
import { CurrencyMismatchError, InvalidAmountError } from '../errors/index.js';
import { Dec, Rounding } from './decimal.js';
import { Money } from './money.js';

describe('Money', () => {
  describe('minor unit representation', () => {
    it('stores a two-decimal currency as an integer count of cents', () => {
      const amount = Money.fromDecimal('USD', '100000.00');
      expect(amount.minorUnits).toBe(10_000_000n);
      expect(amount.toDecimal().toFixed()).toBe('100000');
    });

    it('treats a zero-exponent currency as having no minor unit', () => {
      const amount = Money.fromDecimal('KRW', '130000000');
      expect(amount.minorUnits).toBe(130_000_000n);
      expect(amount.exponent).toBe(0);
      expect(amount.toString()).toBe('130000000 KRW');
    });

    it('handles a three-exponent currency', () => {
      const amount = Money.fromDecimal('KWD', '12.345');
      expect(amount.minorUnits).toBe(12_345n);
      expect(amount.toJSON().decimal).toBe('12.345');
    });

    it('rejects a non-integer minor unit string', () => {
      expect(() => Money.ofMinorUnits('USD', '100.5')).toThrow(InvalidAmountError);
      expect(() => Money.ofMinorUnits('USD', '1e5')).toThrow(InvalidAmountError);
      expect(() => Money.ofMinorUnits('USD', '')).toThrow(InvalidAmountError);
    });

    it('accepts a negative minor unit string, so a cost delta can be represented', () => {
      expect(Money.ofMinorUnits('USD', '-250').minorUnits).toBe(-250n);
    });
  });

  describe('exactness', () => {
    it('does not accumulate error over repeated addition, unlike binary floats', () => {
      const oneCent = Money.ofMinorUnits('USD', 1n);
      let total = Money.zero('USD');
      for (let index = 0; index < 1000; index += 1) {
        total = total.add(oneCent);
      }
      expect(total.minorUnits).toBe(1000n);
      expect(total.toDecimal().toFixed(2)).toBe('10.00');
    });

    it('is exact for values a float cannot represent', () => {
      const a = Money.fromDecimal('USD', '0.1');
      const b = Money.fromDecimal('USD', '0.2');
      expect(a.add(b).toDecimal().toFixed(2)).toBe('0.30');
      expect(a.add(b).minorUnits).toBe(30n);
    });

    it('survives amounts far beyond the safe integer range', () => {
      const huge = Money.ofMinorUnits('VND', '9007199254740993000');
      expect(huge.add(Money.ofMinorUnits('VND', 1n)).minorUnits).toBe(9_007_199_254_740_993_001n);
    });
  });

  describe('rounding', () => {
    it('rounds half up when charging the customer', () => {
      expect(Money.fromDecimal('USD', '1.005', Rounding.HALF_UP).minorUnits).toBe(101n);
      expect(Money.fromDecimal('USD', '1.004', Rounding.HALF_UP).minorUnits).toBe(100n);
    });

    it('truncates toward zero when paying the customer', () => {
      expect(Money.fromDecimal('USD', '1.009', Rounding.DOWN).minorUnits).toBe(100n);
      expect(Money.fromDecimal('USD', '-1.009', Rounding.DOWN).minorUnits).toBe(-100n);
    });

    it('applies banker\u2019s rounding when asked', () => {
      expect(Money.fromDecimal('USD', '1.005', Rounding.HALF_EVEN).minorUnits).toBe(100n);
      expect(Money.fromDecimal('USD', '1.015', Rounding.HALF_EVEN).minorUnits).toBe(102n);
    });

    it('rounds a proportional scaling with the mode it is given', () => {
      const amount = Money.ofMinorUnits('USD', 10_000_000n);
      // 12.5 bps of 100,000.00 = 125.00 exactly.
      expect(amount.multiplyByRatio('0.00125').minorUnits).toBe(12_500n);
      // 1 bps of 0.05 = 0.000005, which is half a minor unit at the boundary.
      expect(
        Money.ofMinorUnits('USD', 5n).multiplyByRatio('0.1', Rounding.HALF_UP).minorUnits,
      ).toBe(1n);
      expect(Money.ofMinorUnits('USD', 5n).multiplyByRatio('0.1', Rounding.DOWN).minorUnits).toBe(
        0n,
      );
    });
  });

  describe('currency safety', () => {
    it('refuses arithmetic across currencies', () => {
      const usd = Money.fromDecimal('USD', '1');
      const krw = Money.fromDecimal('KRW', '1');
      expect(() => usd.add(krw)).toThrow(CurrencyMismatchError);
      expect(() => usd.subtract(krw)).toThrow(CurrencyMismatchError);
      expect(() => usd.compareTo(krw)).toThrow(CurrencyMismatchError);
    });

    it('does not consider amounts of different currencies equal', () => {
      expect(Money.ofMinorUnits('USD', 1n).equals(Money.ofMinorUnits('KRW', 1n))).toBe(false);
    });
  });

  describe('clamping', () => {
    const amount = Money.ofMinorUnits('USD', 5_000n);

    it('raises a value to the floor', () => {
      expect(amount.clamp(Money.ofMinorUnits('USD', 7_500n), null).minorUnits).toBe(7_500n);
    });

    it('lowers a value to the cap', () => {
      expect(amount.clamp(null, Money.ofMinorUnits('USD', 2_500n)).minorUnits).toBe(2_500n);
    });

    it('leaves a value inside the bounds untouched', () => {
      const bounded = amount.clamp(
        Money.ofMinorUnits('USD', 1_000n),
        Money.ofMinorUnits('USD', 9_000n),
      );
      expect(bounded.equals(amount)).toBe(true);
    });
  });

  describe('serialization', () => {
    it('publishes minor units as the authoritative value', () => {
      expect(Money.fromDecimal('USD', '1234.56').toJSON()).toEqual({
        currency: 'USD',
        minorUnits: '123456',
        decimal: '1234.56',
        exponent: 2,
      });
    });

    it('formats a zero-exponent currency without a decimal point', () => {
      expect(Money.ofMinorUnits('JPY', 5_000n).toJSON().decimal).toBe('5000');
    });
  });

  it('sums an empty set to zero in the requested currency', () => {
    const total = Money.sum('USD', []);
    expect(total.isZero()).toBe(true);
    expect(total.currency).toBe('USD');
  });

  it('exposes an exact decimal derived from the integer value', () => {
    const amount = Money.ofMinorUnits('USD', 333n);
    expect(amount.toDecimal().equals(new Dec('3.33'))).toBe(true);
  });
});
