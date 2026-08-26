import { CurrencyMismatchError, InvalidAmountError } from '../errors/index.js';
import { type CurrencyCode, currencyExponent } from './currency.js';
import {
  Dec,
  type Decimal,
  type DecimalInput,
  Rounding,
  type RoundingMode,
  toDecimal,
} from './decimal.js';

export interface MoneyJson {
  readonly currency: CurrencyCode;
  /** Authoritative value: an exact integer count of the currency's minor units, as a string. */
  readonly minorUnits: string;
  /** Display convenience, derived from `minorUnits`. Never used as an input to arithmetic. */
  readonly decimal: string;
  readonly exponent: number;
}

/**
 * An exact monetary amount.
 *
 * The value is stored as a `bigint` count of the currency's minor units, so it cannot drift the
 * way a binary float would. Every operation that converts out of the integer domain takes an
 * explicit rounding mode; there is no implicit rounding anywhere in this class.
 *
 * Instances are immutable and every operation returns a new instance.
 */
export class Money {
  readonly currency: CurrencyCode;
  readonly minorUnits: bigint;

  private constructor(currency: CurrencyCode, minorUnits: bigint) {
    this.currency = currency;
    this.minorUnits = minorUnits;
    Object.freeze(this);
  }

  static ofMinorUnits(currency: CurrencyCode, minorUnits: bigint | string): Money {
    const value = typeof minorUnits === 'bigint' ? minorUnits : Money.parseMinorUnits(minorUnits);
    return new Money(currency, value);
  }

  static zero(currency: CurrencyCode): Money {
    return new Money(currency, 0n);
  }

  /**
   * Builds an amount from a major-unit decimal value, e.g. `("USD", "100000.005")`.
   *
   * A value with more precision than the currency supports is rounded with the supplied mode
   * rather than silently truncated, so the caller always states the intent.
   */
  static fromDecimal(
    currency: CurrencyCode,
    value: DecimalInput,
    rounding: RoundingMode = Rounding.HALF_UP,
  ): Money {
    const exponent = currencyExponent(currency);
    const scaled = toDecimal(value).times(new Dec(10).pow(exponent));
    const integral = scaled.toDecimalPlaces(0, rounding);
    return new Money(currency, BigInt(integral.toFixed(0)));
  }

  private static parseMinorUnits(raw: string): bigint {
    if (!/^-?\d+$/.test(raw.trim())) {
      throw new InvalidAmountError(`Minor units must be an integer string, received "${raw}".`, {
        value: raw,
      });
    }
    return BigInt(raw.trim());
  }

  get exponent(): number {
    return currencyExponent(this.currency);
  }

  /** The amount as an exact decimal in major units. Safe: derived from the integer value. */
  toDecimal(): Decimal {
    return new Dec(this.minorUnits.toString()).div(new Dec(10).pow(this.exponent));
  }

  add(other: Money): Money {
    this.assertSameCurrency(other, 'add');
    return new Money(this.currency, this.minorUnits + other.minorUnits);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other, 'subtract');
    return new Money(this.currency, this.minorUnits - other.minorUnits);
  }

  negate(): Money {
    return new Money(this.currency, -this.minorUnits);
  }

  abs(): Money {
    return new Money(this.currency, this.minorUnits < 0n ? -this.minorUnits : this.minorUnits);
  }

  /**
   * Scales the amount by a dimensionless ratio, staying in the same currency. Used for
   * proportional fees and slippage haircuts.
   */
  multiplyByRatio(ratio: DecimalInput, rounding: RoundingMode = Rounding.HALF_UP): Money {
    const product = new Dec(this.minorUnits.toString()).times(toDecimal(ratio));
    return new Money(this.currency, BigInt(product.toDecimalPlaces(0, rounding).toFixed(0)));
  }

  /** Clamps the amount into `[min, max]`. Either bound may be omitted. */
  clamp(min: Money | null, max: Money | null): Money {
    let minorUnits = this.minorUnits;
    if (min !== null) {
      this.assertSameCurrency(min, 'clamp');
      if (minorUnits < min.minorUnits) {
        minorUnits = min.minorUnits;
      }
    }
    if (max !== null) {
      this.assertSameCurrency(max, 'clamp');
      if (minorUnits > max.minorUnits) {
        minorUnits = max.minorUnits;
      }
    }
    return new Money(this.currency, minorUnits);
  }

  isZero(): boolean {
    return this.minorUnits === 0n;
  }

  isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  compareTo(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other, 'compare');
    if (this.minorUnits < other.minorUnits) return -1;
    if (this.minorUnits > other.minorUnits) return 1;
    return 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minorUnits === other.minorUnits;
  }

  lessThan(other: Money): boolean {
    return this.compareTo(other) < 0;
  }

  greaterThan(other: Money): boolean {
    return this.compareTo(other) > 0;
  }

  static sum(currency: CurrencyCode, amounts: readonly Money[]): Money {
    return amounts.reduce<Money>((total, amount) => total.add(amount), Money.zero(currency));
  }

  private assertSameCurrency(other: Money, operation: string): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency, operation);
    }
  }

  toJSON(): MoneyJson {
    return {
      currency: this.currency,
      minorUnits: this.minorUnits.toString(),
      decimal: this.toDecimal().toFixed(this.exponent),
      exponent: this.exponent,
    };
  }

  toString(): string {
    return `${this.toDecimal().toFixed(this.exponent)} ${this.currency}`;
  }
}
