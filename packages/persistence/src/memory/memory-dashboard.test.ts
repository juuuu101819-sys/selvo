import { describe, expect, it } from 'vitest';
import { InMemoryDashboardRepository } from './memory-dashboard.js';
import type { DashboardQuote } from '@meridian/core';

function quote(organizationId: string, id: string): DashboardQuote {
  return {
    id,
    organizationId,
    transactionRequestId: 'txr_1',
    providerId: 'bank',
    providerName: 'Northgate Bank',
    rail: 'bank_fx',
    status: 'active',
    sourceCurrency: 'USD',
    targetCurrency: 'EUR',
    amountMinorUnits: '10000000',
    totalCostMinorUnits: '1000000',
    totalCostBps: '72',
    estimatedReceiveMinorUnits: '1',
    benchmarkReceiveMinorUnits: '1',
    settlementP50Seconds: 86_400,
    quotedAt: '2026-08-20T09:00:00.000Z',
    expiresAt: '2026-08-20T10:00:00.000Z',
    isRecommended: true,
    rank: 1,
    score: '90',
  };
}

describe('InMemoryDashboardRepository tenancy', () => {
  it('filters every read by organizationId, including get-by-id', async () => {
    const store = new InMemoryDashboardRepository();
    await store.recordQuote(quote('org_a', 'qte_a'));
    await store.recordQuote(quote('org_b', 'qte_secret'));

    const listed = await store.listQuotes('org_a');
    expect(listed.map((row) => row.id)).toEqual(['qte_a']);
    expect(await store.getQuote('org_a', 'qte_secret')).toBeNull();
    expect(await store.getQuote('org_b', 'qte_secret')).not.toBeNull();
    expect((await store.metrics('org_a')).quoteCount).toBe(1);
    expect((await store.metrics('org_b')).quoteCount).toBe(1);
  });

  it('aggregates monetization only for the requested organization', async () => {
    const store = new InMemoryDashboardRepository();
    await store.recordMonetizationEvent({
      id: 'mon_a',
      organizationId: 'org_a',
      occurredAt: '2026-03-20T12:00:00.000Z',
      transactionType: 'fiat_comparison',
      revenueSource: 'traditional_fx_routing_fee',
      rail: 'bank_fx',
      providerId: 'bank',
      providerName: 'Northgate Bank',
      currency: 'USD',
      asset: 'USD',
      destinationAsset: 'KRW',
      agentId: null,
      tpvMinorUnits: '10000000',
      providerCostMinorUnits: '30000',
      platformRevenueMinorUnits: '20000',
      partnerCommissionMinorUnits: '5000',
      grossProfitMinorUnits: '15000',
      takeRateBps: '20.0000',
      fundsMoved: false,
      custody: false,
      realExecution: false,
      routeId: null,
      quoteId: null,
      economicStage: 'route_quote',
      realizedRevenue: false,
      revenueRecognition: 'unrealized',
      invoiceId: null,
    });
    await store.recordMonetizationEvent({
      id: 'mon_secret',
      organizationId: 'org_b',
      occurredAt: '2026-03-20T12:00:00.000Z',
      transactionType: 'fiat_comparison',
      revenueSource: 'traditional_fx_routing_fee',
      rail: 'bank_fx',
      providerId: 'bank',
      providerName: 'Northgate Bank',
      currency: 'USD',
      asset: 'USD',
      destinationAsset: 'EUR',
      agentId: null,
      tpvMinorUnits: '99999900',
      providerCostMinorUnits: '1',
      platformRevenueMinorUnits: '888888',
      partnerCommissionMinorUnits: '0',
      grossProfitMinorUnits: '888888',
      takeRateBps: '88.9000',
      fundsMoved: false,
      custody: false,
      realExecution: false,
      routeId: null,
      quoteId: null,
      economicStage: 'route_quote',
      realizedRevenue: false,
      revenueRecognition: 'unrealized',
      invoiceId: null,
    });

    const report = await store.revenue('org_a');
    expect(report.summary.platformRevenueMinorUnits).toBe('20000');
    expect(report.summary.grossProfitMinorUnits).toBe('15000');
    expect(report.events.map((event) => event.id)).toEqual(['mon_a']);
    expect((await store.listMonetizationEvents('org_a')).map((event) => event.id)).toEqual([
      'mon_a',
    ]);
    expect(await store.revenue('org_b')).toMatchObject({
      summary: { platformRevenueMinorUnits: '888888' },
    });
  });
});
