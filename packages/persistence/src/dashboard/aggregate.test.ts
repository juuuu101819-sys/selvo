import { describe, expect, it } from 'vitest';
import { Dec, toDecimal } from '@meridian/core';
import {
  aggregateCostByDay,
  aggregateMetrics,
  aggregateProviderUsage,
  aggregateVolumeByDay,
} from './aggregate.js';
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

  it('aggregates a near-MAX_SAFE_INTEGER notional with Decimal/bigint, not Number()', () => {
    // 2^53 + 1 is the first integer IEEE Number cannot represent uniquely.
    const beyond = (2n ** 53n + 1n).toString();
    expect(beyond).toBe('9007199254740993');
    expect(String(Number(beyond))).not.toBe(beyond);

    const expensive = (2n ** 53n + 9n).toString();
    const metrics = aggregateMetrics(
      [
        quote({
          id: 'qte_huge',
          isRecommended: true,
          amountMinorUnits: beyond,
          totalCostMinorUnits: beyond,
          totalCostBps: '34.123456789',
        }),
        quote({
          id: 'qte_other',
          isRecommended: false,
          totalCostMinorUnits: expensive,
          totalCostBps: '10.876543211',
        }),
      ],
      [request({ amountMinorUnits: beyond })],
    );

    expect(metrics.totalQuotedVolume).toEqual([
      { currency: 'USD', exponent: 2, minorUnits: beyond, requestCount: 1 },
    ]);
    expect(metrics.averageRouteCostBps).toBe(
      toDecimal('34.123456789').toDecimalPlaces(4).toFixed(4),
    );
    expect(metrics.estimatedSavings).toEqual([
      { currency: 'KRW', exponent: 0, minorUnits: (BigInt(expensive) - BigInt(beyond)).toString() },
    ]);
  });

  it('averages recommended bps with Decimal so mixed high-precision values stay exact', () => {
    const metrics = aggregateMetrics(
      [
        quote({
          id: 'qte_a',
          isRecommended: true,
          totalCostBps: '12.3456789',
          transactionRequestId: 'txr_a',
        }),
        quote({
          id: 'qte_b',
          isRecommended: true,
          totalCostBps: '20.0000001',
          transactionRequestId: 'txr_b',
          quotedAt: '2026-03-02T09:00:00.000Z',
        }),
      ],
      [request({ id: 'txr_a' }), request({ id: 'txr_b', createdAt: '2026-03-02T09:00:00.000Z' })],
    );
    const expected = new Dec('12.3456789')
      .plus(toDecimal('20.0000001'))
      .div(2)
      .toDecimalPlaces(4)
      .toFixed(4);
    expect(metrics.averageRouteCostBps).toBe(expected);
  });
});

describe('aggregateCostByDay and aggregateProviderUsage', () => {
  it('uses Decimal means for cost-by-day and provider usage', () => {
    const now = Date.parse('2026-03-01T12:00:00.000Z');
    const points = aggregateCostByDay(
      [
        quote({ isRecommended: true, totalCostBps: '10.0000001', quotedAt: '2026-03-01T09:00:00.000Z' }),
        quote({
          id: 'qte_2',
          isRecommended: true,
          totalCostBps: '20.0000003',
          quotedAt: '2026-03-01T10:00:00.000Z',
        }),
      ],
      30,
      now,
    );
    expect(points).toEqual([
      {
        date: '2026-03-01',
        averageCostBps: new Dec('10.0000001').plus(toDecimal('20.0000003')).div(2).toDecimalPlaces(4).toFixed(4),
        quoteCount: 2,
      },
    ]);

    const usage = aggregateProviderUsage([
      quote({ isRecommended: true, totalCostBps: '15.2500001' }),
      quote({ id: 'qte_other', isRecommended: true, totalCostBps: '16.7500003' }),
    ]);
    expect(usage[0]?.averageCostBps).toBe(
      new Dec('15.2500001').plus(toDecimal('16.7500003')).div(2).toDecimalPlaces(4).toFixed(4),
    );
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
