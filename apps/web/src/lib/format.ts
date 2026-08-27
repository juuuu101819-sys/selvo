import type { MoneyJson } from './api/types';

/**
 * Presentation helpers.
 *
 * Amounts are formatted directly from their integer minor units. Routing them through `Number`
 * first would reintroduce, at the last possible moment, exactly the floating-point imprecision the
 * rest of the platform is built to avoid — and a KRW notional in the hundreds of millions of minor
 * units is well within the range where that starts to matter.
 */

export function formatMoney(money: MoneyJson): string {
  return `${formatMinorUnits(money.minorUnits, money.exponent)} ${money.currency}`;
}

export function formatAssetAmount(amount: {
  readonly asset: string;
  readonly minorUnits: string;
  readonly exponent: number;
}): string {
  return `${formatMinorUnits(amount.minorUnits, amount.exponent)} ${amount.asset}`;
}

/** Dashboard rows carry minor units and a currency code rather than a `MoneyJson` object. */
export function formatQuotedAmount(minorUnits: string, currency: string, exponent: number): string {
  return formatMoney({ minorUnits, currency, decimal: '', exponent });
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

export function formatAmountOnly(money: MoneyJson): string {
  return formatMinorUnits(money.minorUnits, money.exponent);
}

function formatMinorUnits(minorUnits: string, exponent: number): string {
  const negative = minorUnits.startsWith('-');
  const digits = (negative ? minorUnits.slice(1) : minorUnits).padStart(exponent + 1, '0');
  const whole = exponent === 0 ? digits : digits.slice(0, digits.length - exponent);
  const fraction = exponent === 0 ? '' : digits.slice(digits.length - exponent);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction === '' ? '' : `.${fraction}`}`;
}

/** Renders an all-in cost as a percentage, e.g. `"0.34%"`. */
export function formatPercent(percentString: string, decimals = 2): string {
  return `${Number(percentString).toFixed(decimals)}%`;
}

export function formatBps(bpsString: string, decimals = 1): string {
  return `${Number(bpsString).toFixed(decimals)} bps`;
}

/** Renders an exchange rate at a sensible precision for its magnitude. */
export function formatRate(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return value;
  }
  if (numeric >= 100) return numeric.toFixed(2);
  if (numeric >= 1) return numeric.toFixed(4);
  return numeric.toPrecision(6);
}

/**
 * Renders a settlement estimate the way a treasury team talks about it: minutes for instant rails,
 * business days for correspondent banking.
 */
export function formatSettlement(seconds: number, businessDaysOnly: boolean): string {
  if (seconds < 60) {
    return `${seconds} sec`;
  }
  if (seconds < 3_600) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} min`;
  }
  if (seconds < 86_400) {
    const hours = seconds / 3_600;
    const rendered = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
    return `${rendered} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.round(seconds / 86_400);
  const unit = businessDaysOnly ? 'business day' : 'day';
  return `${days} ${days === 1 ? unit : `${unit}s`}`;
}

export function formatReliability(score: string): string {
  return `${(Number(score) * 100).toFixed(1)}%`;
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC');
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
