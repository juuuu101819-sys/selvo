import { Decimal as DecimalJs } from 'decimal.js';

/**
 * A Decimal constructor configured for financial work.
 *
 * 34 significant digits matches IEEE 754-2008 decimal128, which comfortably covers cross-currency
 * rates (e.g. USD/VND around 25,000 combined with a four-decimal spread) without intermediate
 * precision loss. Every operation in this codebase that leaves the exact decimal domain passes an
 * explicit rounding mode, so the configured default is only a backstop.
 */
export const Dec = DecimalJs.clone({
  precision: 34,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 40,
  modulo: DecimalJs.ROUND_DOWN,
});

export type Decimal = DecimalJs;

/** Rounding modes, named for the intent they express on the money path. */
export const Rounding = {
  /** Round against the customer. Used for fees the customer is charged. */
  HALF_UP: DecimalJs.ROUND_HALF_UP,
  /** Truncate toward zero. Used for amounts delivered, so a payout is never over-promised. */
  DOWN: DecimalJs.ROUND_DOWN,
  /** Away from zero. Used where a conservative upper bound is required. */
  UP: DecimalJs.ROUND_UP,
  /** Banker's rounding. Available for jurisdictions that mandate it. */
  HALF_EVEN: DecimalJs.ROUND_HALF_EVEN,
} as const;

export type RoundingMode = (typeof Rounding)[keyof typeof Rounding];

/**
 * Inputs accepted where an exact decimal value is required.
 *
 * `number` is deliberately absent: accepting it would let a binary float such as `0.1 + 0.2` enter
 * the money path, which is the entire class of bug this module exists to prevent. Callers holding
 * a `number` must decide explicitly how to render it as a string first.
 */
export type DecimalInput = Decimal | string | bigint;

export const BPS_DIVISOR = new Dec(10_000);

/**
 * Parses a decimal value into the configured constructor.
 *
 * Values are always re-wrapped rather than passed through: a `Decimal` built by a differently
 * configured constructor would carry that constructor's precision into subsequent arithmetic.
 */
export function toDecimal(input: DecimalInput): Decimal {
  const parsed = typeof input === 'bigint' ? new Dec(input.toString()) : new Dec(input);
  if (!parsed.isFinite()) {
    throw new RangeError(`Not a finite decimal value: ${String(input)}`);
  }
  return parsed;
}

/** Converts a basis-point figure into a plain ratio (e.g. `"72"` -> `0.0072`). */
export function bpsToRatio(bps: DecimalInput): Decimal {
  return toDecimal(bps).div(BPS_DIVISOR);
}

/** Converts a plain ratio into basis points (e.g. `0.0072` -> `72`). */
export function ratioToBps(ratio: DecimalInput): Decimal {
  return toDecimal(ratio).times(BPS_DIVISOR);
}

/** Formats a decimal for transport: fixed notation, never exponential. */
export function formatDecimal(value: Decimal, decimalPlaces?: number): string {
  const normalised =
    decimalPlaces === undefined ? value : value.toDecimalPlaces(decimalPlaces, Rounding.HALF_UP);
  return normalised.toFixed();
}
