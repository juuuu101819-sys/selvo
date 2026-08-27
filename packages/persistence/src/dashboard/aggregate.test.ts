import { describe, expect, it } from 'vitest';
import { aggregateMetrics, aggregateVolumeByDay } from './aggregate.js';
import type { DashboardQuote, DashboardTransaction } from '@meridian/core';

function quote(overrides: Partial<DashboardQuote> = {}): DashboardQuote {
  return {
    id: 'qte_1',
    organizationId: 'org_a',
    transactionRequestId: 'txr_1',
    providerId: 'bank',
    providerName: 'Northgate Bank',
    rail: 'bank_fx',
    status: 'active',
    sourceCurrency: 'USD',
    targetCurrency: 'KRW',
    amountMinorUnits: '10000000',
    totalCostMinorUnits: '1000000',
    totalCostBps: '72.0000',
    estimatedReceiveMinorUnits: '137000000',
    benchmarkReceiveMinorUnits: '138000000',
    settlementP50Seconds: 86_400,
    quotedAt: '2026-03-01T09:00:00.000Z',
    expiresAt: '2026-03-01T09:15:00.000Z',
    isRecommended: false,
    rank: 4,
    score: '80',
    ...overrides,
  };
}

function request(overrides: Partial<DashboardTransaction> = {}): DashboardTransaction {
  return {
    id: 'txr_1',
    organizationId: 'org_a',
    reference: 'PO-1',
    sourceCurrency: 'USD',
    targetCurrency: 'KRW',
    amountMinorUnits: '10000000',
    status: 'quote_selected',
    selectedQuoteId: 'qte_best',
    createdAt: '2026-03-01T09:00:00.000Z',
    quoteCount: 2,
    ...overrides,
  };
}

describe('aggregateMetrics', () => {
  it('sums request notional, not quote notional, so four quotes for one payment count once', () => {
    const metrics = aggregateMetrics(
      [
        quote({
          id: 'qte_best',
          isRecommended: true,
          totalCostMinorUnits: '470000',
          totalCostBps: '34',
        }),
        quote({ id: 'qte_bank', totalCostMinorUnits: '1000000', totalCostBps: '72' }),
      ],
      [request()],
    );

    expect(metrics.quoteCount).toBe(2);
    expect(metrics.successfulRouteRequests).toBe(1);
    expect(metrics.totalQuotedVolume).toEqual([
      { currency: 'USD', exponent: 2, minorUnits: '10000000', requestCount: 1 },
    ]);
    expect(metrics.estimatedSavings).toEqual([
      { currency: 'KRW', exponent: 0, minorUnits: '530000' },
    ]);
    expect(metrics.averageRouteCostBps).toBe('34.0000');
  });

  it('does not mix one organization into another because it never sees the other rows', () => {
    const orgA = aggregateMetrics(
      [quote({ organizationId: 'org_a', isRecommended: true, totalCostBps: '34' })],
      [request({ organizationId: 'org_a' })],
    );
    const orgB = aggregateMetrics([], []);
    expect(orgA.quoteCount).toBe(1);
    expect(orgB.quoteCount).toBe(0);
    expect(orgB.totalQuotedVolume).toEqual([]);
  });
});

describe('aggregateVolumeByDay', () => {
  it('drops requests older than the requested window', () => {
    const now = Date.parse('2026-08-27T12:00:00.000Z');
    const points = aggregateVolumeByDay(
      [
        request({ createdAt: '2026-08-20T09:00:00.000Z', amountMinorUnits: '10000000' }),
        request({
          id: 'txr_old',
          createdAt: '2026-06-01T09:00:00.000Z',
          amountMinorUnits: '99999999',
        }),
      ],
      30,
      now,
    );
    expect(points).toEqual([
      { date: '2026-08-20', currency: 'USD', minorUnits: '10000000', requestCount: 1 },
    ]);
  });
});
