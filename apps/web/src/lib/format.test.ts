import { describe, expect, it } from 'vitest';
import {
  formatBps,
  formatMoney,
  formatPercent,
  formatRate,
  formatReliability,
  formatSettlement,
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
