import { describe, expect, it } from 'vitest';
import {
  displayBarPercent,
  displayBarPercentFromDecimal,
  maxMinorUnits,
} from './chart-display';

describe('chart-display', () => {
  it('computes bar width from bigint minor units past the IEEE integer boundary', () => {
    const huge = (2n ** 53n + 1n).toString();
    const half = (2n ** 53n / 2n).toString();
    expect(String(Number(huge))).not.toBe(huge);
    expect(maxMinorUnits([huge, '1'])).toBe(huge);
    expect(displayBarPercent(huge, huge)).toBe(100);
    expect(displayBarPercent(half, huge)).toBeGreaterThan(0);
    expect(displayBarPercent(half, huge)).toBeLessThan(100);
  });

  it('uses 4 d.p. integer scaling for bps bar width rather than Number(bps)', () => {
    expect(displayBarPercentFromDecimal('10', '20')).toBe(50);
    expect(displayBarPercentFromDecimal('34.1234', '34.1234')).toBe(100);
  });
});
