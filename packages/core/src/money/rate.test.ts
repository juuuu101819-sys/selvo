import { describe, expect, it } from 'vitest';
import { CurrencyMismatchError, ValidationError } from '../errors/index.js';
import { Rounding } from './decimal.js';
import { Money } from './money.js';
import { Rate } from './rate.js';

describe('Rate', () => {
  const usdKrw = Rate.of('USD', 'KRW', '1385.4200');

  it('converts an amount into the quote currency', () => {
    const sent = Money.fromDecimal('USD', '100000');
    expect(usdKrw.applyTo(sent).toJSON().minorUnits).toBe('138542000');
  });

  it('rounds a conversion down by default so a payout is never over-promised', () => {
    const rate = Rate.of('USD', 'KRW', '1385.999');
    const converted = rate.applyTo(Money.ofMinorUnits('USD', 100n));
    expect(converted.minorUnits).toBe(1385n);
  });

  it('honours an explicit rounding mode', () => {
    const rate = Rate.of('USD', 'KRW', '1385.999');
    const converted = rate.applyTo(Money.ofMinorUnits('USD', 100n), Rounding.HALF_UP);
    expect(converted.minorUnits).toBe(1386n);
  });

  it('refuses to convert an amount that is not in the base currency', () => {
    expect(() => usdKrw.applyTo(Money.fromDecimal('EUR', '1'))).toThrow(CurrencyMismatchError);
  });

  it('rejects a non-positive rate', () => {
    expect(() => Rate.of('USD', 'KRW', '0')).toThrow(ValidationError);
    expect(() => Rate.of('USD', 'KRW', '-1')).toThrow(ValidationError);
  });

  it('inverts a rate without precision loss on the round trip', () => {
    const inverted = usdKrw.invert();
    expect(inverted.base).toBe('KRW');
    expect(inverted.quote).toBe('USD');
    expect(inverted.invert().value.toFixed(4)).toBe('1385.4200');
  });

  it('scales a rate by a slippage retention ratio', () => {
    // 25 bps of slippage retains 99.75% of the offered rate.
    const adjusted = Rate.of('USD', 'KRW', '1400').scaleBy('0.9975');
    expect(adjusted.value.toFixed()).toBe('1396.5');
  });

  it('derives the realised all-in rate of a transfer', () => {
    const effective = Rate.effective(
      Money.fromDecimal('USD', '100000'),
      Money.fromDecimal('KRW', '138000000'),
    );
    expect(effective.pair).toBe('USD/KRW');
    expect(effective.value.toFixed()).toBe('1380');
  });

  it('refuses to derive an effective rate from a zero send amount', () => {
    expect(() => Rate.effective(Money.zero('USD'), Money.fromDecimal('KRW', '1'))).toThrow(
      ValidationError,
    );
  });

  it('preserves full precision in transport rather than rounding to the currency exponent', () => {
    expect(Rate.of('USD', 'KRW', '1385.42314159').toJSON().value).toBe('1385.42314159');
  });
});
