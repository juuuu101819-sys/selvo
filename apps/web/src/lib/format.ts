import type { MoneyJson } from './api/types';
import { parseDisplayDecimal } from './display-decimal';

/**
 * Presentation helpers.
 *
 * Amounts are formatted from integer minor units. The integer part is grouped with `Intl` so
 * separators follow the locale; the currency code and the numeric value are never converted.
 */

export function formatMoney(money: MoneyJson, locale = 'en'): string {
  return `${formatMinorUnits(money.minorUnits, money.exponent, locale)} ${money.currency}`;
}

export function formatAssetAmount(
  amount: {
    readonly asset: string;
    readonly minorUnits: string;
    readonly exponent: number;
  },
  locale = 'en',
): string {
  return `${formatMinorUnits(amount.minorUnits, amount.exponent, locale)} ${amount.asset}`;
}

/** Dashboard rows carry minor units and a currency code rather than a `MoneyJson` object. */
export function formatQuotedAmount(
  minorUnits: string,
  currency: string,
  exponent: number,
  locale = 'en',
): string {
  return formatMoney({ minorUnits, currency, decimal: '', exponent }, locale);
}

/** Integer share of `part` in `total`, as a percentage with two decimal places. Truncates. */
export function sharePercent(partMinorUnits: string, totalMinorUnits: string): string {
  const part = BigInt(partMinorUnits);
  const total = BigInt(totalMinorUnits);
  if (total === 0n) {
    return '0.00';
  }
  const negative = part < 0n;
  const absPart = part < 0n ? -part : part;
  const scaled = (absPart * 10000n) / total;
  const whole = scaled / 100n;
  const fraction = (scaled % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

export function formatTakeRate(bps: string | null): string {
  if (bps === null) {
    return '—';
  }
  const [whole = '0', fraction = ''] = bps.split('.');
  const trimmedFraction = fraction.replace(/0+$/, '');
  return trimmedFraction === '' ? `${whole} bps` : `${whole}.${trimmedFraction} bps`;
}

export function formatAmountOnly(money: MoneyJson, locale = 'en'): string {
  return formatMinorUnits(money.minorUnits, money.exponent, locale);
}

function decimalSeparator(locale: string): string {
  return (
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')
      ?.value ?? '.'
  );
}

function formatMinorUnits(minorUnits: string, exponent: number, locale: string): string {
  const negative = minorUnits.startsWith('-');
  const digits = (negative ? minorUnits.slice(1) : minorUnits).padStart(exponent + 1, '0');
  const whole = exponent === 0 ? digits : digits.slice(0, digits.length - exponent);
  const fraction = exponent === 0 ? '' : digits.slice(digits.length - exponent);
  const grouped = new Intl.NumberFormat(locale, {
    useGrouping: true,
    maximumFractionDigits: 0,
  }).format(BigInt(whole === '' ? '0' : whole));
  const sep = decimalSeparator(locale);
  return `${negative ? '-' : ''}${grouped}${fraction === '' ? '' : `${sep}${fraction}`}`;
}

/** Renders an all-in cost as a percentage, e.g. `"0.34%"`. */
export function formatPercent(percentString: string, decimals = 2, locale = 'en'): string {
  const parsed = parseDisplayDecimal(percentString);
  if (parsed === null) {
    return percentString;
  }
  const rendered = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(parsed.toFixed(decimals)));
  return `${rendered}%`;
}

export function formatBps(bpsString: string, decimals = 1, locale = 'en'): string {
  const parsed = parseDisplayDecimal(bpsString);
  if (parsed === null) {
    return bpsString;
  }
  const rendered = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(parsed.toFixed(decimals)));
  return `${rendered} bps`;
}

/** Renders an exchange rate at a sensible precision for its magnitude. */
export function formatRate(value: string): string {
  const parsed = parseDisplayDecimal(value);
  if (parsed === null) {
    return value;
  }
  if (parsed.abs().gte(100)) return parsed.toFixed(2);
  if (parsed.abs().gte(1)) return parsed.toFixed(4);
  return parsed.toPrecision(6);
}

export type SettlementUnit = 'seconds' | 'minutes' | 'hours' | 'days' | 'businessDays';

export function settlementParts(
  seconds: number,
  businessDaysOnly: boolean,
): { readonly count: number; readonly unit: SettlementUnit } {
  if (seconds < 60) {
    return { count: seconds, unit: 'seconds' };
  }
  if (seconds < 3_600) {
    return { count: Math.round(seconds / 60), unit: 'minutes' };
  }
  if (seconds < 86_400) {
    const hours = seconds / 3_600;
    const count = Number.isInteger(hours) ? hours : Number(hours.toFixed(1));
    return { count, unit: 'hours' };
  }
  return {
    count: Math.round(seconds / 86_400),
    unit: businessDaysOnly ? 'businessDays' : 'days',
  };
}

/**
 * Renders a settlement estimate the way a treasury team talks about it: minutes for instant rails,
 * business days for correspondent banking.
 */
export function formatSettlement(seconds: number, businessDaysOnly: boolean): string {
  const { count, unit } = settlementParts(seconds, businessDaysOnly);
  switch (unit) {
    case 'seconds':
      return `${count} sec`;
    case 'minutes':
      return `${count} min`;
    case 'hours':
      return `${count} ${count === 1 ? 'hour' : 'hours'}`;
    case 'businessDays':
      return `${count} ${count === 1 ? 'business day' : 'business days'}`;
    default:
      return `${count} ${count === 1 ? 'day' : 'days'}`;
  }
}

export function formatReliability(score: string, locale = 'en'): string {
  const parsed = parseDisplayDecimal(score);
  if (parsed === null) {
    return score;
  }
  const rendered = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(parsed.times(100).toFixed(1)));
  return `${rendered}%`;
}

export function formatTimestamp(iso: string, locale = 'en'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
    hourCycle: 'h23',
  }).format(date)} UTC`;
}

export function shortFingerprint(fingerprint: string): string {
  return `${fingerprint.slice(0, 8)}…${fingerprint.slice(-8)}`;
}

/**
 * A placeholder amount that reads naturally for the currency: something on the order of a real
 * B2B payment rather than "0.00".
 */
export function amountPlaceholder(exponent: number): string {
  return exponent === 0 ? '100000000' : `100000.${'0'.repeat(exponent)}`;
}

/**
 * Converts a major-unit decimal string to integer minor units without `Number`.
 * `"1000.50"` at exponent 2 becomes `"100050"`. Extra fractional digits are rejected.
 */
export function majorToMinorUnits(major: string, exponent: number): string | null {
  const trimmed = major.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const [wholeRaw, fractionRaw = ''] = trimmed.split('.');
  if (fractionRaw.length > exponent) {
    return null;
  }
  const fraction = fractionRaw.padEnd(exponent, '0');
  const combined = `${wholeRaw}${fraction}`.replace(/^0+(?=\d)/, '');
  return combined === '' ? '0' : combined;
}

/** Inverse of {@link majorToMinorUnits} for form fields. Trailing zeros in the fraction are dropped. */
export function minorToMajorUnits(minorUnits: string, exponent: number): string {
  if (!/^\d+$/.test(minorUnits)) {
    return '0';
  }
  if (exponent === 0) {
    return minorUnits.replace(/^0+(?=\d)/, '') || '0';
  }
  const digits = minorUnits.padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent).replace(/^0+(?=\d)/, '') || '0';
  const fraction = digits.slice(digits.length - exponent).replace(/0+$/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

/** Presentation-only floor for very low engine scores so "0.00 / 100" is not read as broken. */
export function routeScoreForDisplay(score: string): {
  readonly display: string;
  readonly exact: string;
  readonly floored: boolean;
} {
  const numeric = Number(score);
  if (Number.isFinite(numeric) && numeric >= 0 && numeric < 1) {
    return { display: '<1', exact: score, floored: true };
  }
  return { display: score, exact: score, floored: false };
}
