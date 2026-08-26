import { describe, expect, it } from 'vitest';
import type { PricedRoute } from '../domain/index.js';
import { Dec } from '../money/index.js';
import {
  buildProviderDescriptor,
  buildProviderQuote,
  buildQuoteRequest,
} from '../testing/index.js';
import { RouteCostEngine } from './cost-engine.js';
import { defaultScoringWeights, parseScoringWeights } from './engine-config.js';
import { RouteScorer } from './route-scorer.js';

const engine = new RouteCostEngine();

interface Candidate {
  readonly providerId: string;
  readonly rail: 'bank_fx' | 'payment_institution' | 'stablecoin_settlement';
  readonly offeredRate: string;
  readonly p50Seconds: number;
  readonly reliability: string;
}

function priceCandidate(candidate: Candidate): PricedRoute {
  const request = buildQuoteRequest({ amountMinorUnits: '10000000' });
  return engine.price(
    request,
    buildProviderQuote({
      providerId: candidate.providerId,
      rail: candidate.rail,
      midMarketRate: '1300',
      offeredRate: candidate.offeredRate,
      reliabilityScore: candidate.reliability,
      settlement: { p50Seconds: candidate.p50Seconds, p95Seconds: candidate.p50Seconds * 2 },
    }),
    buildProviderDescriptor({ id: candidate.providerId, rail: candidate.rail }),
  );
}

/** The worked example from the product brief: 72 bps / 48 bps / 34 bps. */
const BRIEF_CANDIDATES: readonly Candidate[] = [
  {
    providerId: 'bank',
    rail: 'bank_fx',
    offeredRate: '1290.64',
    p50Seconds: 86_400,
    reliability: '0.995',
  },
  {
    providerId: 'fx-provider',
    rail: 'payment_institution',
    offeredRate: '1293.76',
    p50Seconds: 7_200,
    reliability: '0.99',
  },
  {
    providerId: 'stablecoin',
    rail: 'stablecoin_settlement',
    offeredRate: '1295.58',
    p50Seconds: 300,
    reliability: '0.985',
  },
];

describe('RouteScorer', () => {
  it('recommends the route that wins on the weighted objective', () => {
    const routes = BRIEF_CANDIDATES.map(priceCandidate);
    const scored = new RouteScorer(defaultScoringWeights()).score(routes);

    expect(scored.map((route) => route.provider.id)).toEqual(['stablecoin', 'fx-provider', 'bank']);
    expect(scored[0]?.recommended).toBe(true);
    expect(scored[0]?.rank).toBe(1);
    expect(scored.slice(1).every((route) => !route.recommended)).toBe(true);
  });

  it('scores the cheapest and fastest route at 100 when it wins every component', () => {
    const scored = new RouteScorer(defaultScoringWeights()).score(
      BRIEF_CANDIDATES.map(priceCandidate),
    );
    // The stablecoin route is cheapest and fastest but not the most reliable, so it cannot be 100.
    expect(Number(scored[0]?.score.toFixed())).toBeLessThan(100);
    expect(scored[0]?.scoreComponents.cost.toFixed()).toBe('1');
    expect(scored[0]?.scoreComponents.speed.toFixed()).toBe('1');
  });

  it('assigns 0 on a component to the worst route in the set', () => {
    const scored = new RouteScorer(defaultScoringWeights()).score(
      BRIEF_CANDIDATES.map(priceCandidate),
    );
    const bank = scored.find((route) => route.provider.id === 'bank');
    expect(bank?.scoreComponents.cost.isZero()).toBe(true);
    expect(bank?.scoreComponents.speed.isZero()).toBe(true);
  });

  it('produces the same ranking regardless of the order providers responded in', () => {
    const scorer = new RouteScorer(defaultScoringWeights());
    const forward = scorer.score(BRIEF_CANDIDATES.map(priceCandidate));
    const reversed = scorer.score([...BRIEF_CANDIDATES].reverse().map(priceCandidate));

    expect(reversed.map((route) => route.routeId)).toEqual(forward.map((route) => route.routeId));
    expect(reversed.map((route) => route.score.toFixed())).toEqual(
      forward.map((route) => route.score.toFixed()),
    );
  });

  it('follows the weights: pricing everything on cost picks the cheapest route', () => {
    const costOnly = parseScoringWeights({ cost: '1', speed: '0', reliability: '0' });
    const scored = new RouteScorer(costOnly).score(BRIEF_CANDIDATES.map(priceCandidate));

    expect(scored[0]?.provider.id).toBe('stablecoin');
    expect(scored[0]?.score.toFixed()).toBe('100');
  });

  it('follows the weights: pricing everything on reliability picks the most reliable route', () => {
    const reliabilityOnly = parseScoringWeights({ cost: '0', speed: '0', reliability: '1' });
    const scored = new RouteScorer(reliabilityOnly).score(BRIEF_CANDIDATES.map(priceCandidate));

    expect(scored[0]?.provider.id).toBe('bank');
    expect(scored[0]?.score.toFixed()).toBe('99.5');
  });

  it('follows the weights: pricing everything on speed picks the fastest route', () => {
    const speedOnly = parseScoringWeights({ cost: '0', speed: '1', reliability: '0' });
    const scored = new RouteScorer(speedOnly).score(BRIEF_CANDIDATES.map(priceCandidate));

    expect(scored[0]?.provider.id).toBe('stablecoin');
  });

  it('gives every route the neutral component value when the set ties', () => {
    const identical: readonly Candidate[] = [
      { providerId: 'a', rail: 'bank_fx', offeredRate: '1295', p50Seconds: 600, reliability: '1' },
      { providerId: 'b', rail: 'bank_fx', offeredRate: '1295', p50Seconds: 600, reliability: '1' },
    ];
    const scored = new RouteScorer(defaultScoringWeights()).score(identical.map(priceCandidate));

    expect(scored.map((route) => route.score.toFixed())).toEqual(['100', '100']);
    // A tie is broken deterministically by route id, never by response order.
    expect(scored.map((route) => route.routeId)).toEqual(['a:bank_fx', 'b:bank_fx']);
  });

  it('breaks a score tie by cost, then settlement time, then route id', () => {
    // Equal weighted scores by construction: one is cheaper, the other faster.
    const scorer = new RouteScorer(
      parseScoringWeights({ cost: '0.5', speed: '0.5', reliability: '0' }),
    );
    const scored = scorer.score(
      [
        {
          providerId: 'cheap',
          rail: 'bank_fx',
          offeredRate: '1299',
          p50Seconds: 86_400,
          reliability: '1',
        },
        {
          providerId: 'fast',
          rail: 'bank_fx',
          offeredRate: '1290',
          p50Seconds: 60,
          reliability: '1',
        },
      ].map((candidate) => priceCandidate(candidate as Candidate)),
    );

    expect(scored[0]?.score.equals(scored[1]?.score ?? new Dec(-1))).toBe(true);
    expect(scored[0]?.provider.id).toBe('cheap');
  });

  it('returns an empty ranking for an empty candidate set', () => {
    expect(new RouteScorer(defaultScoringWeights()).score([])).toEqual([]);
  });

  it('scores a single route at 100 because it is trivially the best available', () => {
    const scored = new RouteScorer(
      parseScoringWeights({ cost: '0.5', speed: '0.5', reliability: '0' }),
    ).score([priceCandidate(BRIEF_CANDIDATES[0] as Candidate)]);

    expect(scored).toHaveLength(1);
    expect(scored[0]?.score.toFixed()).toBe('100');
    expect(scored[0]?.recommended).toBe(true);
  });
});
