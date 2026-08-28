import { Decimal as DecimalJs } from 'decimal.js';

/**
 * Display-only Decimal, matching `@meridian/core` `Dec` settings.
 *
 * Used to render percent, bps, rate, and reliability strings without IEEE `Number()`.
 * Never fed back into quote engines or dashboard aggregates (PA-H07).
 */
const Dec = DecimalJs.clone({
  precision: 34,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 40,
  modulo: DecimalJs.ROUND_DOWN,
});

export function parseDisplayDecimal(value: string): DecimalJs | null {
  try {
    const parsed = new Dec(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}
