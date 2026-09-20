import { describe, expect, it } from 'vitest';
import { defaultProfileForRail } from '../domain/provider-catalog.js';
import {
  NO_PRICING_SHAPES_ACTIVE,
  simulationPricingShapeAdmission,
  type PricingShape,
} from '../domain/pricing-shape.js';
import { AssetAmount } from '../money/asset-amount.js';
import { Dec } from '../money/index.js';
import { buildNormalizedQuote, buildProviderDescriptor } from '../testing/index.js';
import {
  MultiRailCostEngine,
  NO_ROUTING_PLATFORM_CHARGE,
  flatDecisionFee,
  gatePlatformChargeByShape,
} from './routing-cost.js';
import type { RoutingPlatformCharge } from './routing-types.js';

const engine = new MultiRailCostEngine();
const descriptor = buildProviderDescriptor();
const profile = defaultProfileForRail('bank_fx');

/** $2.50 per decision, the launch FLAT shape: a constant, never a rate. */
const FLAT_FEE_MINOR_UNITS = 250n;

function charge(overrides: Partial<RoutingPlatformCharge> = {}): RoutingPlatformCharge {
  return {
    ruleId: 'rule-launch',
    markupBps: new Dec(0),
    discountBps: new Dec(0),
    flatFee: AssetAmount.ofMinorUnits('USD', FLAT_FEE_MINOR_UNITS),
    surcharge: null,
    ...overrides,
  };
}

function admitted(...shapes: readonly PricingShape[]) {
  return simulationPricingShapeAdmission(shapes);
}

/** Platform fee the cost engine attributes for one decision on a notional of `amountMinorUnits`. */
function platformFeeFor(
  amountMinorUnits: string,
  platformCharge: RoutingPlatformCharge,
): AssetAmount {
  return engine.price(
    buildNormalizedQuote({
      amountMinorUnits,
      midMarketRate: '1300',
      indicatedRate: '1300',
    }),
    descriptor,
    profile,
    platformCharge,
  ).breakdown.platformFee;
}

describe('§18.2 FLAT per-decision pricing is size-independent', () => {
  it('charges the identical fee on a $10 and a $10,000,000 decision', () => {
    const tiny = platformFeeFor('1000', charge());
    const huge = platformFeeFor('1000000000', charge());

    // Both are valued in the destination asset at the same mid-market rate, so an identical fee
    // in the send asset must land on an identical delivered amount.
    expect(huge.minorUnits).toBe(tiny.minorUnits);
    expect(tiny.isZero()).toBe(false);
  });

  it('does not vary the fee across six orders of magnitude of notional', () => {
    const notionals = ['1000', '100000', '10000000', '1000000000', '100000000000'];
    const fees = notionals.map((notional) => platformFeeFor(notional, charge()).minorUnits);
    expect(new Set(fees).size).toBe(1);
  });

  it('resolves the fee from the configured constant and the target asset alone', () => {
    // The signature is the guard: `flatDecisionFee` cannot read a notional because it is never
    // given one. A future implementation that scales FLAT by size would have to change this
    // signature, which is the change CI is meant to catch.
    const configured = AssetAmount.ofMinorUnits('USD', FLAT_FEE_MINOR_UNITS);
    expect(flatDecisionFee(configured, 'USD')?.minorUnits).toBe(FLAT_FEE_MINOR_UNITS);
    expect(flatDecisionFee(configured, 'USDC')?.toDecimal().toFixed()).toBe(
      configured.toDecimal().toFixed(),
    );
    expect(flatDecisionFee(null, 'USD')).toBeNull();
    expect(flatDecisionFee(AssetAmount.ofMinorUnits('USD', 0n), 'USD')).toBeNull();
  });

  it('keeps FLAT constant while ad valorem scales, which is what separates the two shapes', () => {
    const adValorem = charge({ flatFee: null, markupBps: new Dec(10) });
    const smallMarkup = platformFeeFor('1000', adValorem);
    const largeMarkup = platformFeeFor('1000000000', adValorem);
    expect(largeMarkup.minorUnits).toBeGreaterThan(smallMarkup.minorUnits);

    const smallFlat = platformFeeFor('1000', charge());
    const largeFlat = platformFeeFor('1000000000', charge());
    expect(largeFlat.minorUnits).toBe(smallFlat.minorUnits);
  });
});

describe('§18.3 pricing-shape admission gates the customer charge', () => {
  const configured = charge({
    markupBps: new Dec(10),
    surcharge: {
      code: 'infrastructure_surcharge',
      label: 'Configured infrastructure surcharge',
      rateBps: new Dec(3),
    },
  });

  it('strips markup and surcharge when ad valorem is not admitted', () => {
    const gated = gatePlatformChargeByShape(configured, admitted('flat_txn'));
    expect(gated.markupBps.isZero()).toBe(true);
    expect(gated.surcharge).toBeNull();
    expect(gated.flatFee?.minorUnits).toBe(FLAT_FEE_MINOR_UNITS);
  });

  it('strips the flat fee when FLAT is not admitted', () => {
    const gated = gatePlatformChargeByShape(configured, admitted('ad_valorem'));
    expect(gated.flatFee).toBeNull();
    expect(gated.markupBps.toFixed()).toBe('10');
    expect(gated.surcharge?.rateBps.toFixed()).toBe('3');
  });

  it('passes the configured charge through untouched when both shapes are admitted', () => {
    const gated = gatePlatformChargeByShape(configured, admitted('flat_txn', 'ad_valorem'));
    expect(gated).toBe(configured);
  });

  it('charges nothing at all when no shape is admitted', () => {
    const gated = gatePlatformChargeByShape(configured, NO_PRICING_SHAPES_ACTIVE);
    expect(gated.markupBps.isZero()).toBe(true);
    expect(gated.surcharge).toBeNull();
    expect(gated.flatFee).toBeNull();
    expect(platformFeeFor('1000000000', gated).isZero()).toBe(true);
  });

  it('leaves the customer discount alone, since gating it would raise the price', () => {
    const discounted = charge({ discountBps: new Dec(5) });
    const gated = gatePlatformChargeByShape(discounted, NO_PRICING_SHAPES_ACTIVE);
    expect(gated.discountBps.toFixed()).toBe('5');
  });

  it('still charges exactly zero when no pricing rule applies', () => {
    // The pre-existing property §18.3 asks to preserve: absent a negotiated rule there is no
    // silent default take rate, whatever the shape flags say.
    const gated = gatePlatformChargeByShape(
      NO_ROUTING_PLATFORM_CHARGE,
      admitted('flat_txn', 'ad_valorem', 'tiered_txn', 'gain_share', 'tpv'),
    );
    expect(platformFeeFor('1000000000', gated).isZero()).toBe(true);
  });
});
