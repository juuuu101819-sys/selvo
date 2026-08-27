import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARTNER_COMMISSION_BPS,
  MONETIZATION_WORKED_EXAMPLE,
  REVENUE_SOURCES,
  type MonetizationEvent,
} from '../domain/monetization.js';
import { demoMonetizationEvents } from '../auth/demo-monetization.js';
import { InvalidAmountError } from '../errors/index.js';
import {
  aggregateMonetization,
  convertDestMinorToSource,
  priceMonetization,
} from './monetization-engine.js';

describe('priceMonetization', () => {
  it('matches the $100,000 worked example with Decimal arithmetic', () => {
    const priced = priceMonetization({
      tpvMinorUnits: MONETIZATION_WORKED_EXAMPLE.tpvMinorUnits,
      providerCostMinorUnits: MONETIZATION_WORKED_EXAMPLE.providerCostMinorUnits,
      platformRevenueMinorUnits: MONETIZATION_WORKED_EXAMPLE.platformRevenueMinorUnits,
      partnerCommissionBps: DEFAULT_PARTNER_COMMISSION_BPS,
    });
    expect(priced.aiUsed).toBe(false);
    expect(priced.tpvMinorUnits).toBe('10000000');
    expect(priced.providerCostMinorUnits).toBe('30000');
    expect(priced.grossRevenueMinorUnits).toBe('20000');
    expect(priced.platformRevenueMinorUnits).toBe('20000');
    expect(priced.partnerCommissionMinorUnits).toBe('5000');
    expect(priced.grossProfitMinorUnits).toBe('15000');
    expect(priced.takeRateBps).toBe('20.0000');
  });

  it('accepts an explicit partner payout', () => {
    const priced = priceMonetization({
      tpvMinorUnits: '10000000',
      providerCostMinorUnits: '30000',
      platformRevenueMinorUnits: '20000',
      partnerCommissionMinorUnits: '5000',
    });
    expect(priced.grossProfitMinorUnits).toBe('15000');
  });

  it('caps partner commission at platform revenue', () => {
    const priced = priceMonetization({
      tpvMinorUnits: '10000000',
      providerCostMinorUnits: '0',
      platformRevenueMinorUnits: '20000',
      partnerCommissionMinorUnits: '999999',
    });
    expect(priced.partnerCommissionMinorUnits).toBe('20000');
    expect(priced.grossProfitMinorUnits).toBe('0');
  });

  it('returns a null take rate for a zero-TPV subscription', () => {
    const priced = priceMonetization({
      tpvMinorUnits: '0',
      providerCostMinorUnits: '0',
      platformRevenueMinorUnits: '200000',
      partnerCommissionMinorUnits: '0',
    });
    expect(priced.takeRateBps).toBeNull();
    expect(priced.grossProfitMinorUnits).toBe('200000');
  });

  it('rejects a floating-point looking amount', () => {
    expect(() =>
      priceMonetization({
        tpvMinorUnits: '100000.5',
        providerCostMinorUnits: '0',
        platformRevenueMinorUnits: '0',
      }),
    ).toThrow(InvalidAmountError);
  });
});

describe('convertDestMinorToSource', () => {
  it('converts KRW back to USD at the mid-market rate without floats', () => {
    const usd = convertDestMinorToSource({
      destMinorUnits: '27708400',
      destAsset: 'KRW',
      sourceAsset: 'USD',
      midMarketRate: '1385.42',
    });
    expect(usd).toBe('20000');
  });

  it('is a no-op when the assets match', () => {
    expect(
      convertDestMinorToSource({
        destMinorUnits: '20000',
        destAsset: 'USD',
        sourceAsset: 'USD',
        midMarketRate: '1',
      }),
    ).toBe('20000');
  });
});

describe('aggregateMonetization', () => {
  const event = (overrides: Partial<MonetizationEvent> = {}): MonetizationEvent => {
    const priced = priceMonetization({
      tpvMinorUnits: overrides.tpvMinorUnits ?? '10000000',
      providerCostMinorUnits: overrides.providerCostMinorUnits ?? '30000',
      platformRevenueMinorUnits: overrides.platformRevenueMinorUnits ?? '20000',
      partnerCommissionMinorUnits: overrides.partnerCommissionMinorUnits,
    });
    return {
      id: 'mon_1',
      organizationId: 'org_demo_meridian',
      occurredAt: '2026-03-20T12:00:00.000Z',
      transactionType: 'fiat_comparison',
      revenueSource: 'traditional_fx_routing_fee',
      rail: 'bank_fx',
      providerId: 'sandbox-northgate-bank',
      providerName: 'Northgate Bank',
      currency: 'USD',
      asset: 'USD',
      destinationAsset: 'KRW',
      agentId: null,
      fundsMoved: false,
      custody: false,
      realExecution: false,
      ...priced,
      ...overrides,
    };
  };

  it('scopes totals to one organization', () => {
    const report = aggregateMonetization(
      [
        event({ id: 'mon_demo' }),
        event({
          id: 'mon_other',
          organizationId: 'org_acme_other',
          platformRevenueMinorUnits: '999999',
          partnerCommissionMinorUnits: '0',
        }),
      ],
      { organizationId: 'org_demo_meridian' },
    );
    expect(report.summary.platformRevenueMinorUnits).toBe('20000');
    expect(report.summary.grossProfitMinorUnits).toBe('15000');
    expect(report.byOrganization).toHaveLength(1);
    expect(report.fundsMoved).toBe(false);
  });

  it('breaks down by rail, provider, date and revenue source', () => {
    const report = aggregateMonetization([
      event(),
      event({
        id: 'mon_2',
        rail: 'stablecoin_settlement',
        revenueSource: 'stablecoin_routing_fee',
        providerId: 'sandbox-solstice-settlement',
        providerName: 'Solstice Settlement',
        platformRevenueMinorUnits: '8000',
        partnerCommissionMinorUnits: '2000',
      }),
    ]);
    expect(report.byRail.map((row) => row.key)).toEqual(['bank_fx', 'stablecoin_settlement']);
    expect(report.byDate[0]?.key).toBe('2026-03-20');
    expect(report.byRevenueSource.some((row) => row.key === 'partner_referral_commission')).toBe(
      true,
    );
  });
});

describe('demoMonetizationEvents', () => {
  it('covers every customer-facing revenue source with the $100k identity first', () => {
    const events = demoMonetizationEvents(Date.parse('2026-03-20T12:00:00.000Z'));
    expect(events[0]?.id).toBe('mon_demo_fx_100k');
    expect(events[0]?.tpvMinorUnits).toBe(MONETIZATION_WORKED_EXAMPLE.tpvMinorUnits);
    expect(events[0]?.platformRevenueMinorUnits).toBe(
      MONETIZATION_WORKED_EXAMPLE.platformRevenueMinorUnits,
    );
    expect(events[0]?.partnerCommissionMinorUnits).toBe(
      MONETIZATION_WORKED_EXAMPLE.partnerCommissionMinorUnits,
    );
    expect(events[0]?.grossProfitMinorUnits).toBe(MONETIZATION_WORKED_EXAMPLE.grossProfitMinorUnits);
    const sources = new Set(events.map((event) => event.revenueSource));
    expect(sources.has('partner_referral_commission')).toBe(false);
    expect(sources).toEqual(
      new Set(REVENUE_SOURCES.filter((source) => source !== 'partner_referral_commission')),
    );
    expect(events.every((event) => event.fundsMoved === false)).toBe(true);
  });
});
