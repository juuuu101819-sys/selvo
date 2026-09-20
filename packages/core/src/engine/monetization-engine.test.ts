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
      gainShareActive: true,
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
      gainShareActive: true,
    });
    expect(priced.grossProfitMinorUnits).toBe('15000');
  });

  it('zeroes partner commission while the gain-share shape is off', () => {
    // Gain share is the highest-risk shape. While its flag is false it must contribute nothing to
    // attribution, not merely go unpaid, so an explicit payout request is ignored outright.
    const priced = priceMonetization({
      tpvMinorUnits: '10000000',
      providerCostMinorUnits: '30000',
      platformRevenueMinorUnits: '20000',
      partnerCommissionMinorUnits: '5000',
    });
    expect(priced.partnerCommissionMinorUnits).toBe('0');
    expect(priced.grossProfitMinorUnits).toBe('20000');
  });

  it('zeroes a bps-derived partner commission while the gain-share shape is off', () => {
    const priced = priceMonetization({
      tpvMinorUnits: '10000000',
      providerCostMinorUnits: '30000',
      platformRevenueMinorUnits: '20000',
      partnerCommissionBps: DEFAULT_PARTNER_COMMISSION_BPS,
    });
    expect(priced.partnerCommissionMinorUnits).toBe('0');
    expect(priced.grossProfitMinorUnits).toBe('20000');
  });

  it('caps partner commission at platform revenue', () => {
    const priced = priceMonetization({
      tpvMinorUnits: '10000000',
      providerCostMinorUnits: '0',
      platformRevenueMinorUnits: '20000',
      partnerCommissionMinorUnits: '999999',
      gainShareActive: true,
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
      destMinorUnits: '277084',
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
      gainShareActive: true,
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
      routeId: null,
      quoteId: null,
      economicStage: 'route_quote',
      realizedRevenue: false,
      revenueRecognition: 'unrealized',
      originEnv: 'PRODUCTION',
      settlementFinality: 'unsettled',
      collectionReference: null,
      lifecycleState: 'QUOTED_REVENUE',
      invoiceId: null,
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
      { organizationId: 'org_demo_meridian', gainShareActive: true },
    );
    expect(report.summary.platformRevenueMinorUnits).toBe('20000');
    expect(report.summary.grossProfitMinorUnits).toBe('15000');
    expect(report.byOrganization).toHaveLength(1);
    expect(report.fundsMoved).toBe(false);
    expect(report.summary.realizedRevenueMinorUnits).toBe('0');
  });

  it('zeroes stored partner commission everywhere while gain share is off', () => {
    const stored = event({ id: 'mon_stored', partnerCommissionMinorUnits: '5000' });
    expect(stored.partnerCommissionMinorUnits).toBe('5000');

    const report = aggregateMonetization([stored]);
    expect(report.gainShareActive).toBe(false);
    expect(report.summary.partnerCommissionMinorUnits).toBe('0');
    // Profit rises to the full platform revenue: a commission that is not charged is not a cost.
    expect(report.summary.grossProfitMinorUnits).toBe('20000');
    expect(report.events[0]?.partnerCommissionMinorUnits).toBe('0');
    expect(report.byRail[0]?.partnerCommissionMinorUnits).toBe('0');
    expect(report.byRevenueSource.some((row) => row.key === 'partner_referral_commission')).toBe(
      false,
    );
    expect(report.workedExample.partnerCommissionMinorUnits).toBe('0');
  });

  it('reports partner commission once gain share is admitted', () => {
    const report = aggregateMonetization(
      [event({ id: 'mon_stored', partnerCommissionMinorUnits: '5000' })],
      { gainShareActive: true },
    );
    expect(report.gainShareActive).toBe(true);
    expect(report.summary.partnerCommissionMinorUnits).toBe('5000');
    expect(report.summary.grossProfitMinorUnits).toBe('15000');
    expect(report.byRevenueSource.some((row) => row.key === 'partner_referral_commission')).toBe(
      true,
    );
    expect(report.workedExample.partnerCommissionMinorUnits).toBe('5000');
  });

  it('maps each economic stage onto its lifecycle state without minting realized revenue', () => {
    const quoted = event({ id: 'mon_quote', economicStage: 'route_quote' });
    const intent = event({ id: 'mon_intent', economicStage: 'execution_intent' });
    const selected = event({ id: 'mon_selected', economicStage: 'route_selected' });
    const settled = event({ id: 'mon_settled', economicStage: 'settled' });

    const unrealized = aggregateMonetization([quoted, intent, selected]);
    expect(unrealized.summary.quotedRevenueMinorUnits).toBe('20000');
    expect(unrealized.summary.expectedRevenueMinorUnits).toBe('40000');
    expect(unrealized.summary.attributedRevenueMinorUnits).toBe('0');
    expect(unrealized.summary.realizedRevenueMinorUnits).toBe('0');
    expect(unrealized.summary.invoicedRevenueMinorUnits).toBe('0');
    expect(unrealized.summary.collectedRevenueMinorUnits).toBe('0');
    expect(unrealized.summary.platformRevenueMinorUnits).toBe('60000');

    // The `settled` stage is attribution against a settlement, not cash. Counting it as realized
    // was the defect this suite now guards: a mock partner could write the stage.
    const withSettlement = aggregateMonetization([quoted, intent, selected, settled]);
    expect(withSettlement.summary.attributedRevenueMinorUnits).toBe('20000');
    expect(withSettlement.summary.settledStageRevenueMinorUnits).toBe('20000');
    expect(withSettlement.summary.realizedRevenueMinorUnits).toBe('0');
    expect(withSettlement.events.every((row) => row.realizedRevenue === false)).toBe(true);
  });

  it('counts invoiced platform revenue as attributed, never as realized', () => {
    const quoted = event({ id: 'mon_quote', economicStage: 'route_quote' });
    const invoiced = event({
      id: 'mon_intent',
      economicStage: 'execution_intent',
      revenueRecognition: 'invoiced',
      invoiceId: 'inv_1',
    });
    const report = aggregateMonetization([quoted, invoiced]);
    expect(report.summary.attributedRevenueMinorUnits).toBe('20000');
    expect(report.summary.realizedRevenueMinorUnits).toBe('0');
    expect(report.summary.invoicedRevenueMinorUnits).toBe('20000');
    expect(report.summary.collectedRevenueMinorUnits).toBe('0');
    expect(report.events.every((row) => row.realizedRevenue === false)).toBe(true);
  });

  it('refuses to realize revenue from a non-production origin even when collected', () => {
    // The shape a sandbox partner would produce if it claimed a completed settlement.
    const sandboxCollected = event({
      id: 'mon_sandbox',
      economicStage: 'settled',
      revenueRecognition: 'collected',
      originEnv: 'PARTNER_SANDBOX',
      settlementFinality: 'provider_confirmed',
      collectionReference: 'proc_ref_1',
      realizedRevenue: true,
    });
    const report = aggregateMonetization([sandboxCollected]);
    expect(report.summary.realizedRevenueMinorUnits).toBe('0');
    expect(report.summary.attributedRevenueMinorUnits).toBe('20000');
    expect(report.summary.simulatedOriginRevenueMinorUnits).toBe('20000');
  });

  it('realizes revenue only when origin, finality, recognition and reference all hold', () => {
    const collected = event({
      id: 'mon_collected',
      economicStage: 'settled',
      revenueRecognition: 'collected',
      originEnv: 'PRODUCTION',
      settlementFinality: 'provider_confirmed',
      collectionReference: 'proc_ref_1',
      realizedRevenue: true,
    });
    const report = aggregateMonetization([collected]);
    expect(report.summary.realizedRevenueMinorUnits).toBe('20000');
    expect(report.summary.collectedRevenueMinorUnits).toBe('20000');
    expect(report.summary.simulatedOriginRevenueMinorUnits).toBe('0');
    expect(report.byLifecycleState.map((row) => row.key)).toEqual(['REALIZED_REVENUE']);
  });

  it('matches Decimal arithmetic exactly on a near-MAX_SAFE_INTEGER TPV', () => {
    const tpv = (2n ** 53n + 1n).toString();
    const platform = '20000';
    const priced = priceMonetization({
      tpvMinorUnits: tpv,
      providerCostMinorUnits: '30000',
      platformRevenueMinorUnits: platform,
    });
    const report = aggregateMonetization([
      event({
        id: 'mon_huge',
        tpvMinorUnits: priced.tpvMinorUnits,
        providerCostMinorUnits: priced.providerCostMinorUnits,
        platformRevenueMinorUnits: priced.platformRevenueMinorUnits,
        partnerCommissionMinorUnits: priced.partnerCommissionMinorUnits,
        grossProfitMinorUnits: priced.grossProfitMinorUnits,
        takeRateBps: priced.takeRateBps,
      }),
    ]);
    expect(report.summary.tpvMinorUnits).toBe(tpv);
    expect(String(Number(tpv))).not.toBe(tpv);
    expect(report.summary.partnerCommissionMinorUnits).toBe(priced.partnerCommissionMinorUnits);
    expect(report.summary.grossProfitMinorUnits).toBe(priced.grossProfitMinorUnits);
    expect(report.summary.takeRateBps).toBe(priced.takeRateBps);
    expect(report.summary.realizedRevenueMinorUnits).toBe('0');
  });

  it('breaks down by rail, provider, date and revenue source', () => {
    const report = aggregateMonetization(
      [
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
      ],
      { gainShareActive: true },
    );
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
    // Gain share is off at launch, so the demo tenant — a customer-facing surface — must show no
    // partner commission even though the worked example documents the identity (§18.3).
    expect(events[0]?.partnerCommissionMinorUnits).toBe('0');
    expect(events[0]?.grossProfitMinorUnits).toBe(
      MONETIZATION_WORKED_EXAMPLE.platformRevenueMinorUnits,
    );
    expect(events.every((event) => event.partnerCommissionMinorUnits === '0')).toBe(true);
    const sources = new Set(events.map((event) => event.revenueSource));
    expect(sources.has('partner_referral_commission')).toBe(false);
    expect(sources).toEqual(
      new Set(REVENUE_SOURCES.filter((source) => source !== 'partner_referral_commission')),
    );
    expect(events.every((event) => event.fundsMoved === false)).toBe(true);
  });
});
