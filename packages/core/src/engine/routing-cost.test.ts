import { describe, expect, it } from 'vitest';
import { AssetAmount } from '../money/asset-amount.js';
import { Dec } from '../money/index.js';
import { defaultProfileForRail } from '../domain/provider-catalog.js';
import { buildNormalizedQuote, buildProviderDescriptor } from '../testing/index.js';
import { MultiRailCostEngine, settlementConfidenceOf } from './routing-cost.js';

const engine = new MultiRailCostEngine();
const descriptor = buildProviderDescriptor();
const profile = defaultProfileForRail('bank_fx');

describe('MultiRailCostEngine', () => {
  it('measures cost against the mid-market benchmark, not the indicated rate', () => {
    const route = engine.price(
      buildNormalizedQuote({
        midMarketRate: '1300',
        indicatedRate: '1290',
        amountMinorUnits: '10000000',
      }),
      descriptor,
      profile,
    );

    expect(route.benchmarkAmount.toString()).toBe('130000000 KRW');
    expect(route.deliveredAmount.toString()).toBe('129000000 KRW');
    expect(route.totalCost.toString()).toBe('1000000 KRW');
    const attributed = AssetAmount.sum('KRW', [
      route.breakdown.providerFee,
      route.breakdown.platformFee,
      route.breakdown.networkFee,
      route.breakdown.gasFee,
      route.breakdown.spreadCost,
      route.breakdown.slippageCost,
      route.breakdown.roundingAdjustment,
    ]);
    expect(attributed.minorUnits).toBe(route.totalCost.minorUnits);
  });

  it('applies a source-side proportional provider fee before conversion', () => {
    const route = engine.price(
      buildNormalizedQuote({
        midMarketRate: '1300',
        indicatedRate: '1300',
        fees: [
          {
            code: 'provider_fee',
            label: 'Provider fee',
            side: 'source',
            kind: 'proportional',
            asset: 'USD',
            amountMinorUnits: null,
            rateBps: '100',
          },
        ],
      }),
      descriptor,
      profile,
    );

    // 1% of USD 100,000 = USD 1,000; converted at 1300 → KRW 1,300,000 of cost.
    expect(route.deliveredAmount.toString()).toBe('128700000 KRW');
    expect(route.breakdown.providerFee.isPositive()).toBe(true);
  });

  it('applies destination-side gas separately from the provider fee', () => {
    const route = engine.price(
      buildNormalizedQuote({
        sourceAsset: 'USDC',
        targetAsset: 'USDT',
        conversionKind: 'stablecoin_stablecoin',
        amountMinorUnits: '1000000000',
        indicatedRate: '0.9996',
        midMarketRate: '1',
        fees: [
          {
            code: 'gas',
            label: 'Estimated network gas',
            side: 'destination',
            kind: 'fixed',
            asset: 'USDT',
            amountMinorUnits: '50000',
            rateBps: null,
          },
        ],
      }),
      buildProviderDescriptor({ id: 'amm', name: 'Pool', rail: 'dex_liquidity' }),
      defaultProfileForRail('dex_liquidity'),
    );

    expect(route.breakdown.gasFee.toString()).toBe('0.050000 USDT');
    expect(route.breakdown.providerFee.isZero()).toBe(true);
  });

  it('labels a stablecoin-intermediated fiat path as USD → provider → USDC → KRW', () => {
    const route = engine.price(
      buildNormalizedQuote({
        intermediaryAsset: 'USDC',
      }),
      buildProviderDescriptor({ name: 'Solstice Settlement', rail: 'stablecoin_settlement' }),
      defaultProfileForRail('stablecoin_settlement'),
    );

    expect(route.hops).toEqual(['USD', 'Solstice Settlement', 'USDC', 'KRW']);
  });

  it('prices ETH → USDC when slippage is notionally USD', () => {
    const route = engine.price(
      buildNormalizedQuote({
        sourceAsset: 'ETH',
        targetAsset: 'USDC',
        conversionKind: 'crypto_stablecoin',
        amountMinorUnits: '1000000000000000000',
        indicatedRate: '3492',
        midMarketRate: '3500',
        slippage: {
          kind: 'tiered',
          notionalCurrency: 'USD',
          tiers: [
            { upToNotionalMinorUnits: '10000000', bps: '4' },
            { upToNotionalMinorUnits: null, bps: '18' },
          ],
        },
      }),
      buildProviderDescriptor({ id: 'amm', name: 'Pool', rail: 'dex_liquidity' }),
      defaultProfileForRail('dex_liquidity'),
    );

    expect(route.deliveredAmount.asset).toBe('USDC');
    expect(route.deliveredAmount.isPositive()).toBe(true);
    expect(route.breakdown.slippageCost.isPositive()).toBe(true);
  });
});

describe('settlementConfidenceOf', () => {
  it('scores a tight on-chain window higher than a wide business-day window', () => {
    const dex = settlementConfidenceOf({
      p50Seconds: 12,
      p95Seconds: 60,
      businessDaysOnly: false,
      cutoffUtc: null,
      notes: null,
    });
    const bank = settlementConfidenceOf({
      p50Seconds: 86_400,
      p95Seconds: 172_800,
      businessDaysOnly: true,
      cutoffUtc: '15:00',
      notes: null,
    });
    expect(dex.greaterThan(bank)).toBe(true);
    expect(dex.lessThanOrEqualTo(new Dec(1))).toBe(true);
  });
});
