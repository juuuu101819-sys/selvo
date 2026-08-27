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
});
