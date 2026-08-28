import { describe, expect, it } from 'vitest';
import { QuoteExpiredError } from '../errors/index.js';
import { assertSelectionQuoteFresh } from './quote-selection.js';

describe('assertSelectionQuoteFresh', () => {
  const now = '2026-03-01T12:00:00.000Z';

  it('rejects an expired selected quote with requoteRequired', () => {
    expect(() =>
      assertSelectionQuoteFresh({
        nowIso: now,
        quoteExpiresAt: '2026-03-01T11:59:59.000Z',
        selectedExpiresAt: '2026-03-01T11:59:59.000Z',
        routeId: 'dex:dex_liquidity',
      }),
    ).toThrow(QuoteExpiredError);

    try {
      assertSelectionQuoteFresh({
        nowIso: now,
        quoteExpiresAt: '2026-03-01T11:59:59.000Z',
        selectedExpiresAt: '2026-03-01T11:59:59.000Z',
        routeId: 'dex:dex_liquidity',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(QuoteExpiredError);
      expect((error as QuoteExpiredError).details).toMatchObject({
        requoteRequired: true,
        routeId: 'dex:dex_liquidity',
      });
    }
  });

  it('rejects a missing expiry fail-closed', () => {
    expect(() =>
      assertSelectionQuoteFresh({
        nowIso: now,
        quoteExpiresAt: null,
        routeId: 'bank:bank_fx',
      }),
    ).toThrow(QuoteExpiredError);
  });

  it('accepts a still-valid selected quote', () => {
    expect(() =>
      assertSelectionQuoteFresh({
        nowIso: now,
        quoteExpiresAt: '2026-03-01T12:02:00.000Z',
        selectedExpiresAt: '2026-03-01T12:01:00.000Z',
        routeId: 'bank:bank_fx',
      }),
    ).not.toThrow();
  });
});
