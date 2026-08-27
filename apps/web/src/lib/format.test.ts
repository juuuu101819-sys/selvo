import { describe, expect, it } from 'vitest';
import {
  formatBps,
  formatMoney,
  formatPercent,
  formatQuotedAmount,
  formatRate,
  formatReliability,
  formatSettlement,
  formatTakeRate,
  majorToMinorUnits,
  minorToMajorUnits,
  sharePercent,
} from './format';

/**
 * The formatting contract for every financial figure the UI shows.
 *
 * Pinned as tests because "formatted consistently" is a requirement, not a style preference: two
 * renderings of the same amount that group digits differently read as two different numbers to a
 * treasury operator scanning a page.
 */
describe('formatMoney', () => {
  it('formats from integer minor units with the currency code', () => {
    expect(formatMoney({ currency: 'USD', minorUnits: '10000000', decimal: '', exponent: 2 })).toBe(
      '100,000.00 USD',
    );
  });

  it('respects a zero-exponent currency', () => {
    expect(
      formatMoney({ currency: 'KRW', minorUnits: '138071533', decimal: '', exponent: 0 }),
    ).toBe('138,071,533 KRW');
  });

  it('respects a three-exponent currency', () => {
    expect(formatMoney({ currency: 'KWD', minorUnits: '12345', decimal: '', exponent: 3 })).toBe(
      '12.345 KWD',
    );
  });

  it('handles negative amounts, which a subsidised cost can produce', () => {
    expect(formatMoney({ currency: 'KRW', minorUnits: '-195000', decimal: '', exponent: 0 })).toBe(
      '-195,000 KRW',
    );
  });

  it('is exact beyond the float-safe range', () => {
    expect(
      formatMoney({ currency: 'KRW', minorUnits: '9007199254740993', decimal: '', exponent: 0 }),
    ).toBe('9,007,199,254,740,993 KRW');
  });
});

describe('formatQuotedAmount', () => {
  it('formats dashboard rows the same way as MoneyJson', () => {
    expect(formatQuotedAmount('10000000', 'USD', 2)).toBe('100,000.00 USD');
    expect(formatQuotedAmount('138071533', 'KRW', 0)).toBe('138,071,533 KRW');
  });
});

describe('sharePercent', () => {
  it('computes a bar width from integer minor units without floats', () => {
    expect(sharePercent('15000', '20000')).toBe('75.00');
    expect(sharePercent('1', '3')).toBe('33.33');
    expect(sharePercent('0', '20000')).toBe('0.00');
    expect(sharePercent('50', '0')).toBe('0.00');
  });
});

describe('formatTakeRate', () => {
  it('renders a null take rate for zero-TPV subscriptions', () => {
    expect(formatTakeRate(null)).toBe('—');
    expect(formatTakeRate('20.0000')).toBe('20 bps');
    expect(formatTakeRate('42.1546')).toBe('42.1546 bps');
  });
});

describe('formatPercent and formatBps', () => {
  it('renders an all-in cost to two decimal places', () => {
    expect(formatPercent('0.3396')).toBe('0.34%');
    expect(formatPercent('0.7184')).toBe('0.72%');
  });

  it('renders basis points with one decimal place by default', () => {
    expect(formatBps('33.9584')).toBe('34.0 bps');
  });
});

describe('formatRate', () => {
  it('scales precision to the magnitude of the rate', () => {
    expect(formatRate('1384.03458')).toBe('1384.03');
    expect(formatRate('1.087345')).toBe('1.0873');
    expect(formatRate('0.00074123')).toBe('0.000741230');
  });
});

describe('formatSettlement', () => {
  it('speaks the way a treasury team does', () => {
    expect(formatSettlement(300, false)).toBe('5 min');
    expect(formatSettlement(7200, false)).toBe('2 hours');
    expect(formatSettlement(86400, true)).toBe('1 business day');
    expect(formatSettlement(172800, true)).toBe('2 business days');
  });
});

describe('formatReliability', () => {
  it('renders a settlement record as a percentage', () => {
    expect(formatReliability('0.985')).toBe('98.5%');
  });
});

describe('majorToMinorUnits and minorToMajorUnits', () => {
  it('round-trips USD amounts without floating point', () => {
    expect(majorToMinorUnits('1000', 2)).toBe('100000');
    expect(majorToMinorUnits('1000.50', 2)).toBe('100050');
    expect(majorToMinorUnits('0.50', 2)).toBe('50');
    expect(majorToMinorUnits('10.5', 2)).toBe('1050');
    expect(majorToMinorUnits('1000.123', 2)).toBeNull();
    expect(minorToMajorUnits('100000', 2)).toBe('1000');
    expect(minorToMajorUnits('100050', 2)).toBe('1000.5');
    expect(minorToMajorUnits('50', 2)).toBe('0.5');
  });
});
