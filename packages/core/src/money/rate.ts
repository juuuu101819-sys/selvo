import { CurrencyMismatchError, ValidationError } from '../errors/index.js';
import type { CurrencyCode } from './currency.js';
import {
  Dec,
  type Decimal,
  type DecimalInput,
  Rounding,
  type RoundingMode,
  toDecimal,
} from './decimal.js';
import { Money } from './money.js';

export interface RateJson {
  readonly base: CurrencyCode;
  readonly quote: CurrencyCode;
  /** Units of `quote` per one unit of `base`, as an exact decimal string. */
  readonly value: string;
  readonly pair: string;
}

/**
 * A cross-currency conversion factor: how many units of `quote` one unit of `base` buys.
 *
 * A rate is never rounded to minor units — only the {@link Money} produced by applying it is.
 * The base/quote pair is carried with the value so a rate cannot be applied to the wrong side of
 * a corridor without the runtime objecting.
 */
export class Rate {
  readonly base: CurrencyCode;
  readonly quote: CurrencyCode;
  readonly value: Decimal;

  private constructor(base: CurrencyCode, quote: CurrencyCode, value: Decimal) {
    this.base = base;
    this.quote = quote;
    this.value = value;
    Object.freeze(this);
  }

  static of(base: CurrencyCode, quote: CurrencyCode, value: DecimalInput): Rate {
    const decimal = toDecimal(value);
    if (!decimal.isFinite() || decimal.lessThanOrEqualTo(0)) {
      throw new ValidationError(`Exchange rate must be a positive finite decimal.`, {
        base,
        quote,
        value: decimal.toFixed(),
      });
    }
    return new Rate(base, quote, decimal);
  }

  /** Identity rate for a same-currency "conversion". */
  static identity(currency: CurrencyCode): Rate {
    return new Rate(currency, currency, new Dec(1));
  }

  get pair(): string {
    return `${this.base}/${this.quote}`;
  }

  /** Converts an amount in `base` into `quote`. Defaults to rounding down, never over-promising. */
  applyTo(amount: Money, rounding: RoundingMode = Rounding.DOWN): Money {
    if (amount.currency !== this.base) {
      throw new CurrencyMismatchError(amount.currency, this.base, `apply rate ${this.pair} to`);
    }
    return Money.fromDecimal(this.quote, amount.toDecimal().times(this.value), rounding);
  }

  /** Scales the rate by a dimensionless ratio. Used to apply a slippage haircut. */
  scaleBy(ratio: DecimalInput): Rate {
    return Rate.of(this.base, this.quote, this.value.times(toDecimal(ratio)));
  }

  invert(): Rate {
    return new Rate(this.quote, this.base, new Dec(1).div(this.value));
  }

  /**
   * The realised all-in rate of a transfer: what the beneficiary received per unit sent.
   * This is the number a treasury team compares against the mid-market rate.
   */
  static effective(sent: Money, received: Money): Rate {
    if (sent.isZero()) {
      throw new ValidationError('Cannot derive an effective rate from a zero send amount.', {
        currency: sent.currency,
      });
    }
    return Rate.of(sent.currency, received.currency, received.toDecimal().div(sent.toDecimal()));
  }

  isSamePair(other: Rate): boolean {
    return this.base === other.base && this.quote === other.quote;
  }

  toJSON(): RateJson {
    return { base: this.base, quote: this.quote, value: this.value.toFixed(), pair: this.pair };
  }

  toString(): string {
    return `${this.pair} @ ${this.value.toFixed()}`;
  }
}
