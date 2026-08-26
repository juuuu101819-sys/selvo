import { describe, expect, it } from 'vitest';
import type { FeeComponent, PricedRoute } from '../domain/index.js';
import { InvalidAmountError, InvalidProviderQuoteError } from '../errors/index.js';
import { Money } from '../money/index.js';
import { buildProviderDescriptor, buildProviderQuote, buildQuoteRequest } from '../testing/index.js';
import { RouteCostEngine } from './cost-engine.js';

const engine = new RouteCostEngine();
const descriptor = buildProviderDescriptor();

/** USD 100,000 -> KRW, the worked example from the product brief. */
const HUNDRED_THOUSAND_USD = '10000000';

function price(
  quoteOverrides: Parameters<typeof buildProviderQuote>[0],
  requestOverrides: Parameters<typeof buildQuoteRequest>[0] = {},
): PricedRoute {
  const request = buildQuoteRequest({
    amountMinorUnits: HUNDRED_THOUSAND_USD,
    ...requestOverrides,
  });
  return engine.price(request, buildProviderQuote(quoteOverrides), descriptor);
}

/** The breakdown is a decomposition, not an estimate: it must always sum to the total. */
function expectBreakdownToReconcile(route: PricedRoute): void {
  const { breakdown } = route;
  const attributed = Money.sum(route.totalCost.currency, [
    breakdown.sourceFeeCost,
    breakdown.destinationFeeCost,
    breakdown.fxSpreadCost,
    breakdown.slippageCost,
    breakdown.roundingAdjustment,
  ]);
  expect(attributed.minorUnits).toBe(route.totalCost.minorUnits);
  expect(breakdown.totalCost.equals(route.totalCost)).toBe(true);
}

describe('RouteCostEngine', () => {
  describe('cost measured against the mid-market benchmark', () => {
    it('prices a pure-spread quote with no explicit fees', () => {
      const route = price({ midMarketRate: '1300', offeredRate: '1290.64' });

      expect(route.benchmarkAmount.toJSON().minorUnits).toBe('130000000');
      expect(route.deliveredAmount.toJSON().minorUnits).toBe('129064000');
      expect(route.totalCost.toJSON().minorUnits).toBe('936000');
      expect(route.totalCostBps.toFixed()).toBe('72');
      expect(route.breakdown.fxSpreadCost.toJSON().minorUnits).toBe('936000');
      expect(route.breakdown.sourceFeeCost.isZero()).toBe(true);
      expectBreakdownToReconcile(route);
    });

    it('prices an explicit-fee quote at the mid-market rate', () => {
      const fees: readonly FeeComponent[] = [
        {
          kind: 'fixed',
          code: 'wire',
          label: 'Outbound wire',
          side: 'source',
          currency: 'USD',
          amountMinorUnits: '2500',
        },
        {
          kind: 'proportional',
          code: 'commission',
          label: 'FX commission',
          side: 'source',
          rateBps: '20',
        },
      ];
      const route = price({ midMarketRate: '1300', offeredRate: '1300', fees: { components: fees } });

      // USD 225.00 of fees on a USD 100,000 transfer is 22.5 bps all-in.
      expect(route.deliveredAmount.toJSON().minorUnits).toBe('129707500');
      expect(route.totalCost.toJSON().minorUnits).toBe('292500');
      expect(route.totalCostBps.toFixed()).toBe('22.5');
      expect(route.breakdown.sourceFeeCost.toJSON().minorUnits).toBe('292500');
      expect(route.breakdown.fxSpreadCost.isZero()).toBe(true);
      expectBreakdownToReconcile(route);
    });

    it('ranks a zero-fee wide-spread quote as more expensive than a fee-bearing near-mid quote', () => {
      const wideSpread = price({ midMarketRate: '1300', offeredRate: '1290.64' });
      const explicitFee = price({
        midMarketRate: '1300',
        offeredRate: '1300',
        fees: {
          components: [
            {
              kind: 'proportional',
              code: 'commission',
              label: 'FX commission',
              side: 'source',
              rateBps: '20',
            },
          ],
        },
      });

      expect(wideSpread.breakdown.appliedFees).toHaveLength(0);
      expect(wideSpread.totalCost.greaterThan(explicitFee.totalCost)).toBe(true);
    });
  });

  describe('fees', () => {
    it('charges a destination-side fixed fee out of the converted amount', () => {
      const route = price({
        midMarketRate: '1300',
        offeredRate: '1300',
        fees: {
          components: [
            {
              kind: 'fixed',
              code: 'local_credit',
              label: 'Local beneficiary credit',
              side: 'destination',
              currency: 'KRW',
              amountMinorUnits: '5000',
            },
          ],
        },
      });

      expect(route.deliveredAmount.toJSON().minorUnits).toBe('129995000');
      expect(route.breakdown.destinationFeeCost.toJSON().minorUnits).toBe('5000');
      expect(route.totalCost.toJSON().minorUnits).toBe('5000');
      expectBreakdownToReconcile(route);
    });

    it('values a source-side fee billed in the destination currency at the mid rate', () => {
      const route = price({
        midMarketRate: '1300',
        offeredRate: '1300',
        fees: {
          components: [
            {
              kind: 'fixed',
              code: 'correspondent',
              label: 'Correspondent charge',
              side: 'source',
              currency: 'KRW',
              amountMinorUnits: '13000',
            },
          ],
        },
      });

      // KRW 13,000 at 1300 is USD 10.00, deducted before conversion.
      const appliedFee = route.breakdown.appliedFees[0];
      expect(appliedFee?.amount.toJSON()).toMatchObject({ currency: 'USD', minorUnits: '1000' });
      expect(route.totalCost.toJSON().minorUnits).toBe('13000');
      expectBreakdownToReconcile(route);
    });

    it('applies a cap to a proportional fee and reports that it bound', () => {
      const route = price({
        midMarketRate: '1300',
        offeredRate: '1300',
        fees: {
          components: [
            {
              kind: 'proportional',
              code: 'commission',
              label: 'FX commission',
              side: 'source',
              rateBps: '100',
              maxAmountMinorUnits: '5000',
            },
          ],
        },
      });

      const fee = route.breakdown.appliedFees[0];
      expect(fee?.amount.toJSON().minorUnits).toBe('5000');
      expect(fee?.capped).toBe(true);
    });

    it('applies a floor to a proportional fee', () => {
      const route = price(
        {
          midMarketRate: '1300',
          offeredRate: '1300',
          fees: {
            components: [
              {
                kind: 'proportional',
                code: 'commission',
                label: 'FX commission',
                side: 'source',
                rateBps: '1',
                minAmountMinorUnits: '2500',
              },
            ],
          },
        },
        { amountMinorUnits: '100000' },
      );

      const fee = route.breakdown.appliedFees[0];
      expect(fee?.amount.toJSON().minorUnits).toBe('2500');
      expect(fee?.capped).toBe(true);
    });

    it('rejects a route whose fees consume the entire send amount', () => {
      expect(() =>
        price({
          fees: {
            components: [
              {
                kind: 'fixed',
                code: 'absurd',
                label: 'Absurd fee',
                side: 'source',
                currency: 'USD',
                amountMinorUnits: HUNDRED_THOUSAND_USD,
              },
            ],
          },
        }),
      ).toThrow(InvalidAmountError);
    });

    it('rejects a fee denominated outside the corridor', () => {
      expect(() =>
        price({
          fees: {
            components: [
              {
                kind: 'fixed',
                code: 'offshore',
                label: 'Offshore charge',
                side: 'source',
                currency: 'EUR',
                amountMinorUnits: '1000',
              },
            ],
          },
        }),
      ).toThrow(InvalidProviderQuoteError);
    });
  });

  describe('slippage', () => {
    const tiered = {
      kind: 'tiered' as const,
      notionalCurrency: 'USD' as const,
      tiers: [
        { upToNotionalMinorUnits: '5000000', bps: '5' },
        { upToNotionalMinorUnits: '25000000', bps: '10' },
        { upToNotionalMinorUnits: null, bps: '25' },
      ],
    };

    it('selects the tier covering the requested notional', () => {
      const route = price({ midMarketRate: '1300', offeredRate: '1299', slippage: tiered });

      expect(route.slippageBps.toFixed()).toBe('10');
      expect(route.slippageAdjustedRate.value.toFixed()).toBe('1297.701');
      expect(route.deliveredAmount.toJSON().minorUnits).toBe('129770100');
      expect(route.breakdown.fxSpreadCost.toJSON().minorUnits).toBe('100000');
      expect(route.breakdown.slippageCost.toJSON().minorUnits).toBe('129900');
      expectBreakdownToReconcile(route);
    });

    it('selects the first tier for a small notional', () => {
      const route = price(
        { slippage: tiered },
        { amountMinorUnits: '1000000' },
      );
      expect(route.slippageBps.toFixed()).toBe('5');
    });

    it('selects the unbounded tier above the highest threshold', () => {
      const route = price({ slippage: tiered }, { amountMinorUnits: '100000000' });
      expect(route.slippageBps.toFixed()).toBe('25');
    });

    it('treats a tier threshold as inclusive', () => {
      const route = price({ slippage: tiered }, { amountMinorUnits: '5000000' });
      expect(route.slippageBps.toFixed()).toBe('5');
    });

    it('converts the notional into the tier currency at the mid rate', () => {
      const route = price(
        {
          midMarketRate: '1300',
          offeredRate: '1300',
          slippage: {
            kind: 'tiered',
            notionalCurrency: 'KRW',
            tiers: [
              { upToNotionalMinorUnits: '100000000', bps: '3' },
              { upToNotionalMinorUnits: null, bps: '30' },
            ],
          },
        },
        { amountMinorUnits: HUNDRED_THOUSAND_USD },
      );

      // USD 100,000 is KRW 130,000,000, above the first tier.
      expect(route.slippageBps.toFixed()).toBe('30');
    });

    it('reports zero slippage for a firm principal quote', () => {
      const route = price({ slippage: { kind: 'none' } });
      expect(route.slippageBps.isZero()).toBe(true);
      expect(route.breakdown.slippageCost.isZero()).toBe(true);
      expect(route.slippageAdjustedRate.value.equals(route.offeredRate.value)).toBe(true);
    });

    it('rejects slippage that would consume the whole notional', () => {
      expect(() =>
        price({
          slippage: {
            kind: 'tiered',
            notionalCurrency: 'USD',
            tiers: [{ upToNotionalMinorUnits: null, bps: '10000' }],
          },
        }),
      ).toThrow(InvalidProviderQuoteError);
    });
  });

  describe('rounding and reconciliation', () => {
    const awkward = [
      { mid: '1385.4237', offered: '1379.115', amount: '333337' },
      { mid: '0.00007123', offered: '0.00007001', amount: '999999999' },
      { mid: '1234.5678', offered: '1234.5670', amount: '250' },
      { mid: '25123.77', offered: '24999.01', amount: '77777777' },
    ];

    it.each(awkward)(
      'reconciles the breakdown at mid=$mid offered=$offered amount=$amount',
      ({ mid, offered, amount }) => {
        const route = price(
          {
            midMarketRate: mid,
            offeredRate: offered,
            fees: {
              components: [
                {
                  kind: 'fixed',
                  code: 'wire',
                  label: 'Wire',
                  side: 'source',
                  currency: 'USD',
                  amountMinorUnits: '1',
                },
                {
                  kind: 'proportional',
                  code: 'commission',
                  label: 'Commission',
                  side: 'source',
                  rateBps: '13.7',
                },
                {
                  kind: 'proportional',
                  code: 'credit',
                  label: 'Credit fee',
                  side: 'destination',
                  rateBps: '7.3',
                },
              ],
            },
            slippage: {
              kind: 'tiered',
              notionalCurrency: 'USD',
              tiers: [{ upToNotionalMinorUnits: null, bps: '3.5' }],
            },
          },
          { amountMinorUnits: amount },
        );

        expectBreakdownToReconcile(route);
        // The residue is sub-minor-unit rounding on four independently rounded components.
        expect(Number(route.breakdown.roundingAdjustment.abs().minorUnits)).toBeLessThanOrEqual(4);
      },
    );

    it('prices a zero-exponent source currency into a two-exponent target', () => {
      const route = price(
        { sourceCurrency: 'KRW', targetCurrency: 'USD', midMarketRate: '0.00074', offeredRate: '0.00073' },
        { sourceCurrency: 'KRW', targetCurrency: 'USD', amountMinorUnits: '130000000' },
      );

      expect(route.benchmarkAmount.toJSON()).toMatchObject({ currency: 'USD', minorUnits: '9620000' });
      expect(route.deliveredAmount.toJSON().minorUnits).toBe('9490000');
      expectBreakdownToReconcile(route);
    });

    it('rejects an amount too small to produce a non-zero benchmark', () => {
      expect(() =>
        price(
          { sourceCurrency: 'KRW', targetCurrency: 'USD', midMarketRate: '0.00074', offeredRate: '0.00073' },
          { sourceCurrency: 'KRW', targetCurrency: 'USD', amountMinorUnits: '1' },
        ),
      ).toThrow(InvalidAmountError);
    });
  });

  describe('derived figures', () => {
    it('reports the realised all-in rate', () => {
      const route = price({ midMarketRate: '1300', offeredRate: '1290.64' });
      expect(route.effectiveRate.value.toFixed()).toBe('1290.64');
      expect(route.effectiveRate.pair).toBe('USD/KRW');
    });

    it('builds a deterministic route id from the provider and rail', () => {
      const route = price({ providerId: 'sandbox-global-bank', rail: 'bank_fx' });
      expect(route.routeId).toBe('sandbox-global-bank:bank_fx');
    });

    it('carries the provider quote through untouched for audit', () => {
      const route = price({ quoteReference: 'q-123', quotedAt: '2026-02-03T04:05:06.000Z' });
      expect(route.quote.quoteReference).toBe('q-123');
      expect(route.quote.quotedAt).toBe('2026-02-03T04:05:06.000Z');
    });
  });

  describe('input guards', () => {
    it('rejects a zero send amount', () => {
      expect(() => price({}, { amountMinorUnits: '0' })).toThrow(InvalidAmountError);
    });

    it('rejects a negative send amount', () => {
      expect(() => price({}, { amountMinorUnits: '-100' })).toThrow(InvalidAmountError);
    });

    it('rejects a quote for the wrong corridor', () => {
      expect(() => price({ targetCurrency: 'JPY' })).toThrow(InvalidProviderQuoteError);
    });

    it('rejects a non-positive offered rate', () => {
      expect(() => price({ offeredRate: '0' })).toThrow(InvalidProviderQuoteError);
    });

    it('rejects a reliability score outside 0..1', () => {
      expect(() => price({ reliabilityScore: '1.5' })).toThrow(InvalidProviderQuoteError);
    });

    it('rejects a malformed quote timestamp', () => {
      expect(() => price({ quotedAt: 'yesterday' })).toThrow(InvalidProviderQuoteError);
    });

    it('rejects a settlement estimate whose p95 is below its p50', () => {
      expect(() => price({ settlement: { p50Seconds: 600, p95Seconds: 60 } })).toThrow(
        InvalidProviderQuoteError,
      );
    });

    it('rejects unsorted slippage tiers', () => {
      expect(() =>
        price({
          slippage: {
            kind: 'tiered',
            notionalCurrency: 'USD',
            tiers: [
              { upToNotionalMinorUnits: '25000000', bps: '10' },
              { upToNotionalMinorUnits: '5000000', bps: '5' },
              { upToNotionalMinorUnits: null, bps: '25' },
            ],
          },
        }),
      ).toThrow(InvalidProviderQuoteError);
    });

    it('rejects a negative fee rate', () => {
      expect(() =>
        price({
          fees: {
            components: [
              {
                kind: 'proportional',
                code: 'rebate',
                label: 'Rebate',
                side: 'source',
                rateBps: '-10',
              },
            ],
          },
        }),
      ).toThrow(InvalidProviderQuoteError);
    });
  });
});
