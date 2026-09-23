import { describe, expect, it } from 'vitest';
import type { ComparisonDto, RouteDto } from '@/lib/api/types';
import {
  explainRouteFacts,
  factorContributions,
  formatRouteExplanation,
  topContributingFactors,
} from './explainRoute';

const weightsBalanced: ComparisonDto['scoringWeights'] = {
  cost: '0.6',
  speed: '0.3',
  reliability: '0',
  settlementConfidence: '0.1',
};

const weightsCostOnly: ComparisonDto['scoringWeights'] = {
  cost: '1',
  speed: '0',
  reliability: '0',
};

const weightsSpeedOnly: ComparisonDto['scoringWeights'] = {
  cost: '0',
  speed: '1',
  reliability: '0',
};

const weightsTied: ComparisonDto['scoringWeights'] = {
  cost: '0.5',
  speed: '0.5',
  reliability: '0',
};

function route(overrides: Partial<RouteDto> & Pick<RouteDto, 'scoreComponents'>): RouteDto {
  return {
    routeId: 'route_a',
    rank: 1,
    recommended: true,
    provider: {
      id: 'p1',
      name: 'Demo Provider',
      rail: 'bank_fx',
      railLabel: 'Bank FX',
      licensing: 'unlicensed_sandbox',
      pricingVersion: 'sandbox-pricing-2026.02',
    },
    quote: {
      providerId: 'p1',
      quotedAt: '2026-03-01T12:00:00.000Z',
      expiresAt: '2026-03-01T12:02:00.000Z',
      quoteReference: null,
      pricingVersion: 'sandbox-pricing-2026.02',
      intermediaryAsset: null,
      freshness: null,
    },
    sendAmount: { minorUnits: '10000000', currency: 'USD', decimal: '', exponent: 2 },
    deliveredAmount: { minorUnits: '13800000000', currency: 'KRW', decimal: '', exponent: 0 },
    benchmarkAmount: { minorUnits: '10000000', currency: 'USD', decimal: '', exponent: 2 },
    midMarketRate: { base: 'USD', quote: 'KRW', value: '1380', pair: 'USD/KRW' },
    offeredRate: { base: 'USD', quote: 'KRW', value: '1375', pair: 'USD/KRW' },
    slippageAdjustedRate: { base: 'USD', quote: 'KRW', value: '1375', pair: 'USD/KRW' },
    effectiveRate: { base: 'USD', quote: 'KRW', value: '1375', pair: 'USD/KRW' },
    totalCost: { minorUnits: '44000', currency: 'USD', decimal: '', exponent: 2 },
    totalCostBps: '44.00',
    totalCostPercent: '0.44',
    slippageBps: '0',
    reliabilityScore: '0.995',
    settlement: {
      p50Seconds: 900,
      p95Seconds: 3600,
      businessDaysOnly: false,
      cutoffUtc: null,
      notes: null,
    },
    breakdown: {
      appliedFees: [],
      sourceFeeCost: { minorUnits: '0', currency: 'USD', decimal: '', exponent: 2 },
      platformFeeCost: { minorUnits: '0', currency: 'USD', decimal: '', exponent: 2 },
      destinationFeeCost: { minorUnits: '0', currency: 'USD', decimal: '', exponent: 2 },
      fxSpreadCost: { minorUnits: '44000', currency: 'USD', decimal: '', exponent: 2 },
      slippageCost: { minorUnits: '0', currency: 'USD', decimal: '', exponent: 2 },
      roundingAdjustment: { minorUnits: '0', currency: 'USD', decimal: '', exponent: 2 },
      totalCost: { minorUnits: '44000', currency: 'USD', decimal: '', exponent: 2 },
    },
    score: '87.50',
    scoreComponents: {
      cost: '1',
      speed: '0.5',
      reliability: '0',
      settlementConfidence: '0.8',
    },
    ...overrides,
  };
}

const insights: NonNullable<ComparisonDto['insights']> = {
  cheapestRouteId: 'route_a',
  fastestRouteId: 'route_b',
  mostExpensiveRouteId: 'route_c',
  savingsVsMostExpensive: { minorUnits: '10000', currency: 'USD', decimal: '', exponent: 2 },
  savingsVsMostExpensiveBps: '10',
  savingsVsBankFx: null,
};

describe('topContributingFactors', () => {
  it('picks cost when cost contribution dominates', () => {
    const factors = topContributingFactors(
      { cost: '1', speed: '0.2', reliability: '0', settlementConfidence: '0.5' },
      weightsCostOnly,
    );
    expect(factors).toEqual(['cost']);
    expect(factorContributions(
      { cost: '1', speed: '0.2', reliability: '0' },
      weightsCostOnly,
    )[0]).toMatchObject({ factor: 'cost', contribution: 1 });
  });

  it('picks speed when speed contribution dominates', () => {
    const factors = topContributingFactors(
      { cost: '0.2', speed: '1', reliability: '0' },
      weightsSpeedOnly,
    );
    expect(factors).toEqual(['speed']);
  });

  it('returns both factors on a tie at the top', () => {
    const factors = topContributingFactors(
      { cost: '1', speed: '1', reliability: '0' },
      weightsTied,
    );
    expect(factors).toEqual(['cost', 'speed']);
  });
});

describe('explainRouteFacts', () => {
  it('marks cheapest dimension leader from insights', () => {
    const facts = explainRouteFacts({
      route: route({ routeId: 'route_a' }),
      scoringWeights: weightsBalanced,
      insights,
    });
    expect(facts.dimensionLeaders).toEqual(['cheapest']);
    expect(facts.topFactors[0]).toBe('cost');
  });

  it('ignores legacy reliability component', () => {
    const contributions = factorContributions(
      { cost: '0.5', speed: '0.5', reliability: '1' },
      { cost: '0.5', speed: '0.5', reliability: '1' },
    );
    expect(contributions.some((entry) => entry.factor === 'cost')).toBe(true);
    expect(contributions).toHaveLength(2);
  });
});

describe('formatRouteExplanation', () => {
  const messages = {
    rankLead: 'Ranked #1: ',
    cheapestLeader: 'lowest all-in cost (0.44%)',
    fastestLeader: 'fastest settlement',
    and: ' and ',
    droveResult: ' drove the result',
    factorLabel: (factor: string) => factor,
    carriesMostWeight: (factor: string) => `${factor} carries the most weight`,
    carriesWeightWith: (first: string, second: string) => `${first} and ${second} carry the most weight`,
    footer: (settlement: string, reliability: string) =>
      `Settlement in ${settlement}, reliability ${reliability}.`,
  };

  it('composes leader and factor sentences with formatted values', () => {
    const facts = explainRouteFacts({
      route: route({ routeId: 'route_a' }),
      scoringWeights: weightsCostOnly,
      insights,
    });
    const text = formatRouteExplanation(
      facts,
      { cost: '0.44%', settlement: '15 min', reliability: '99.5%' },
      messages,
    );
    expect(text).toBe(
      'Ranked #1: lowest all-in cost (0.44%) drove the result — cost carries the most weight. Settlement in 15 min, reliability 99.5%.',
    );
  });
});
