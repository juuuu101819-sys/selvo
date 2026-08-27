import { describe, expect, it } from 'vitest';
import { comparisonErrorTitle } from './error-title';

describe('comparisonErrorTitle', () => {
  it('does not blame the corridor when the amount is the problem', () => {
    expect(
      comparisonErrorTitle({
        code: 'UNSUPPORTED_CORRIDOR',
        details: { sourceCurrency: 'USD', targetCurrency: 'KRW', amount: '1.00 USD', rails: null },
      }),
    ).toBe('No provider will price this');
  });

  it('points at the rail filter when that is what excluded every provider', () => {
    expect(
      comparisonErrorTitle({
        code: 'UNSUPPORTED_CORRIDOR',
        details: { rails: ['stablecoin_settlement'] },
      }),
    ).toBe('No quote on the selected rails');
  });

  it('names an unreachable API as a server problem, not a bad request', () => {
    expect(comparisonErrorTitle({ code: 'API_UNREACHABLE', details: {} })).toBe(
      'Routing API unavailable',
    );
  });

  it('falls back without inventing a diagnosis', () => {
    expect(comparisonErrorTitle({ code: 'INTERNAL_ERROR', details: {} })).toBe('Comparison failed');
  });
});
