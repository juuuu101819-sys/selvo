/**
 * Display-only chart geometry.
 *
 * Bar widths are CSS percentages. Arithmetic uses bigint so a volume near 2^53+1 minor units is
 * not rounded by IEEE `Number` before the ratio is taken. The `number` returned here is a 0–100
 * percentage for `style.width` and is never fed back into a financial calculation.
 */

export function displayBarPercent(valueMinorUnits: string, maxMinorUnits: string): number {
  const value = parseUnsignedMinor(valueMinorUnits);
  const max = parseUnsignedMinor(maxMinorUnits);
  if (max <= 0n || value <= 0n) {
    return 0;
  }
  const scaled = (value * 10_000n) / max;
  // Display-only conversion: scaled is 0…10000 (hundredths of a percent), always a safe integer.
  const percent = Number(scaled) / 100;
  return Math.max(percent, 2);
}

export function maxMinorUnits(values: readonly string[]): string {
  let max = 0n;
  for (const value of values) {
    const parsed = parseUnsignedMinor(value);
    if (parsed > max) {
      max = parsed;
    }
  }
  return max.toString();
}

export function maxDecimal(values: readonly string[]): string {
  let best = '0';
  let bestScaled = 0n;
  for (const value of values) {
    const scaled = BigInt(toFourDpMinor(value));
    if (scaled > bestScaled) {
      bestScaled = scaled;
      best = value;
    }
  }
  return best;
}

/**
 * Scales a decimal string (bps, etc.) to a 4-decimal integer so bar width does not use `Number()`
 * on the raw financial figure.
 */
export function displayBarPercentFromDecimal(value: string, max: string): number {
  return displayBarPercent(toFourDpMinor(value), toFourDpMinor(max));
}

function toFourDpMinor(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const negative = whole.startsWith('-');
  const digits = `${negative ? whole.slice(1) : whole}${fraction.padEnd(4, '0').slice(0, 4)}`;
  const normalised = digits.replace(/^0+(?=\d)/, '') || '0';
  return negative && normalised !== '0' ? `-${normalised}` : normalised;
}

function parseUnsignedMinor(raw: string): bigint {
  if (!/^\d+$/.test(raw.trim())) {
    return 0n;
  }
  return BigInt(raw.trim());
}
