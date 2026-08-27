import { describe, expect, it } from 'vitest';
import type { PlatformPricingRule, PricingCriteria } from '../domain/platform-pricing.js';
import { InvalidAmountError } from '../errors/index.js';
import { Dec, Rate } from '../money/index.js';
import {
  NO_PLATFORM_PRICING,
  effectiveSpreadBps,
  selectPricingRule,
  spreadBpsOf,
  toPlatformPricing,
} from './platform-pricing.js';

function rule(overrides: Partial<PlatformPricingRule> = {}): PlatformPricingRule {
  return {
    id: 'rule-1',
    organizationId: 'org-1',
    sourceCurrency: null,
    targetCurrency: null,
    rail: null,
    providerId: null,
    markupBps: '8',
    discountBps: '0',
    platformFeeMinorUnits: '0',
    feeCurrency: null,
    priority: 0,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    ...overrides,
  };
}

const criteria: PricingCriteria = {
  organizationId: 'org-1',
  sourceCurrency: 'USD',
  targetCurrency: 'KRW',
  rail: 'bank_fx',
  providerId: 'northgate',
  at: '2026-03-01T12:00:00.000Z',
};

const midMarketRate = Rate.of('USD', 'KRW', '1385.42');
const context = { sourceCurrency: 'USD' as const, midMarketRate };

describe('selectPricingRule', () => {
  it('returns null when the organization has no terms', () => {
    expect(selectPricingRule([], criteria)).toBeNull();
  });

  it('ignores another organization’s terms', () => {
    expect(selectPricingRule([rule({ organizationId: 'org-2' })], criteria)).toBeNull();
  });

  it('matches a blanket rule with every narrowing field null', () => {
    expect(selectPricingRule([rule()], criteria)?.id).toBe('rule-1');
  });

  describe('narrowing', () => {
    it('matches a corridor-specific rule', () => {
      const scoped = rule({ id: 'corridor', sourceCurrency: 'USD', targetCurrency: 'KRW' });
      expect(selectPricingRule([scoped], criteria)?.id).toBe('corridor');
    });

    it('excludes a rule for a different corridor', () => {
      const other = rule({ sourceCurrency: 'EUR', targetCurrency: 'JPY' });
      expect(selectPricingRule([other], criteria)).toBeNull();
    });

    it('excludes a rule for a different rail', () => {
      expect(selectPricingRule([rule({ rail: 'stablecoin_settlement' })], criteria)).toBeNull();
    });

    it('excludes a rule for a different provider', () => {
      expect(selectPricingRule([rule({ providerId: 'someone-else' })], criteria)).toBeNull();
    });
  });

  describe('effective dating', () => {
    it('excludes a rule that has not started', () => {
      const future = rule({ effectiveFrom: '2026-06-01T00:00:00.000Z' });
      expect(selectPricingRule([future], criteria)).toBeNull();
    });

    it('excludes a rule that has ended', () => {
      const past = rule({ effectiveTo: '2026-02-01T00:00:00.000Z' });
      expect(selectPricingRule([past], criteria)).toBeNull();
    });

    it('includes a rule whose window contains the instant', () => {
      const current = rule({
        effectiveFrom: '2026-02-01T00:00:00.000Z',
        effectiveTo: '2026-04-01T00:00:00.000Z',
      });
      expect(selectPricingRule([current], criteria)?.id).toBe('rule-1');
    });

    /**
     * A repricing is an insert, not an update, so the old and new terms coexist. Resolving at the
     * instant of the original quote is what lets a historical price be explained by the terms that
     * applied then.
     */
    it('resolves historical terms when asked about a past instant', () => {
      const rules = [
        rule({ id: 'old', markupBps: '20', effectiveTo: '2026-02-01T00:00:00.000Z' }),
        rule({ id: 'new', markupBps: '8', effectiveFrom: '2026-02-01T00:00:00.000Z' }),
      ];

      expect(selectPricingRule(rules, { ...criteria, at: '2026-01-15T00:00:00.000Z' })?.id).toBe(
        'old',
      );
      expect(selectPricingRule(rules, criteria)?.id).toBe('new');
    });
  });

  describe('precedence', () => {
    it('prefers the higher priority', () => {
      const rules = [rule({ id: 'low', priority: 0 }), rule({ id: 'high', priority: 100 })];
      expect(selectPricingRule(rules, criteria)?.id).toBe('high');
    });

    /**
     * Without specificity as a tiebreak, whichever row happened to sort first would win — which is
     * not a commercial decision anybody made.
     */
    it('prefers the more specific rule at equal priority', () => {
      const rules = [
        rule({ id: 'blanket' }),
        rule({ id: 'corridor', sourceCurrency: 'USD', targetCurrency: 'KRW' }),
      ];
      expect(selectPricingRule(rules, criteria)?.id).toBe('corridor');
    });

    it('prefers a provider-specific rule over a corridor-specific one', () => {
      const rules = [
        rule({ id: 'corridor', sourceCurrency: 'USD', targetCurrency: 'KRW' }),
        rule({
          id: 'provider',
          sourceCurrency: 'USD',
          targetCurrency: 'KRW',
          providerId: 'northgate',
        }),
      ];
      expect(selectPricingRule(rules, criteria)?.id).toBe('provider');
    });

    it('lets an explicit priority beat greater specificity', () => {
      const rules = [
        rule({ id: 'specific', sourceCurrency: 'USD', targetCurrency: 'KRW', priority: 0 }),
        rule({ id: 'blanket-override', priority: 500 }),
      ];
      expect(selectPricingRule(rules, criteria)?.id).toBe('blanket-override');
    });

    it('prefers the most recently effective at equal priority and specificity', () => {
      const rules = [
        rule({ id: 'older', effectiveFrom: '2026-01-01T00:00:00.000Z' }),
        rule({ id: 'newer', effectiveFrom: '2026-02-01T00:00:00.000Z' }),
      ];
      expect(selectPricingRule(rules, criteria)?.id).toBe('newer');
    });

    it('is a total order, so the result never depends on input order', () => {
      const rules = [rule({ id: 'b' }), rule({ id: 'a' }), rule({ id: 'c' })];

      expect(selectPricingRule(rules, criteria)?.id).toBe('a');
      expect(selectPricingRule([...rules].reverse(), criteria)?.id).toBe('a');
    });
  });
});

describe('toPlatformPricing', () => {
  it('applies no terms when no rule matched', () => {
    const pricing = toPlatformPricing(null, context);

    expect(pricing).toBe(NO_PLATFORM_PRICING);
    expect(pricing.markupBps.isZero()).toBe(true);
    expect(pricing.flatFee).toBeNull();
  });

  it('carries the markup, the discount and the rule that produced them', () => {
    const pricing = toPlatformPricing(rule({ markupBps: '12', discountBps: '3' }), context);

    expect(pricing.ruleId).toBe('rule-1');
    expect(pricing.markupBps.toFixed()).toBe('12');
    expect(pricing.discountBps.toFixed()).toBe('3');
  });

  it('treats a zero flat fee as no fee at all', () => {
    expect(toPlatformPricing(rule({ platformFeeMinorUnits: '0' }), context).flatFee).toBeNull();
  });

  it('takes a flat fee in the source currency directly', () => {
    const pricing = toPlatformPricing(
      rule({ platformFeeMinorUnits: '2500', feeCurrency: 'USD' }),
      context,
    );

    expect(pricing.flatFee?.toJSON()).toMatchObject({ currency: 'USD', minorUnits: '2500' });
  });

  it('defaults an unspecified fee currency to the source leg', () => {
    const pricing = toPlatformPricing(
      rule({ platformFeeMinorUnits: '2500', feeCurrency: null }),
      context,
    );

    expect(pricing.flatFee?.currency).toBe('USD');
  });

  /**
   * Valued at mid-market on purpose: converting the platform's own fee at the provider's offered
   * rate would hide a second spread inside it.
   */
  it('values a destination-currency fee at the mid-market rate', () => {
    const pricing = toPlatformPricing(
      rule({ platformFeeMinorUnits: '13854', feeCurrency: 'KRW' }),
      context,
    );

    // KRW 13,854 at 1385.42 is USD 10.00.
    expect(pricing.flatFee?.toJSON()).toMatchObject({ currency: 'USD', minorUnits: '1000' });
  });

  it('refuses a fee denominated outside the corridor rather than guessing a rate', () => {
    expect(() =>
      toPlatformPricing(rule({ platformFeeMinorUnits: '1000', feeCurrency: 'JPY' }), context),
    ).toThrow(InvalidAmountError);
  });

  it('rejects a negative markup or discount', () => {
    expect(() => toPlatformPricing(rule({ markupBps: '-5' }), context)).toThrow(InvalidAmountError);
    expect(() => toPlatformPricing(rule({ discountBps: '-5' }), context)).toThrow(
      InvalidAmountError,
    );
  });
});

describe('spread arithmetic', () => {
  it('derives spread in basis points from a mid and an offered rate', () => {
    // 1385.42 offered at 1380.88 is 32.77 bps of spread.
    expect(spreadBpsOf(new Dec('1385.42'), new Dec('1380.88')).toDecimalPlaces(2).toFixed()).toBe(
      '32.77',
    );
  });

  it('reports zero spread when the offered rate is the mid', () => {
    expect(spreadBpsOf(new Dec('1385.42'), new Dec('1385.42')).isZero()).toBe(true);
  });

  it('reports a negative spread when a provider quotes above mid', () => {
    expect(spreadBpsOf(new Dec('1385.42'), new Dec('1390')).isNegative()).toBe(true);
  });

  it('guards a zero mid rather than dividing by it', () => {
    expect(spreadBpsOf(new Dec(0), new Dec('1380')).isZero()).toBe(true);
  });

  it('narrows the spread by the discount', () => {
    expect(effectiveSpreadBps(new Dec('35'), new Dec('5')).toFixed()).toBe('30');
  });

  /**
   * A discount can only improve a rate. A provider quoting above mid keeps that advantage and the
   * discount is added on top, rather than being clamped away at zero.
   */
  it('preserves a favourable spread and improves it further', () => {
    expect(effectiveSpreadBps(new Dec('-10'), new Dec('5')).toFixed()).toBe('-15');
  });

  it('can bring a spread to zero but is never applied in reverse', () => {
    expect(effectiveSpreadBps(new Dec('35'), new Dec('35')).isZero()).toBe(true);
    expect(effectiveSpreadBps(new Dec('35'), new Dec('40')).isNegative()).toBe(true);
  });
});
