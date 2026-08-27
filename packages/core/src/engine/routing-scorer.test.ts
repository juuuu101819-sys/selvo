import { describe, expect, it } from 'vitest';
import { defaultProfileForRail } from '../domain/provider-catalog.js';
import { buildNormalizedQuote, buildProviderDescriptor } from '../testing/index.js';
import { parseRoutingWeights } from './routing-config.js';
import { MultiRailCostEngine } from './routing-cost.js';
import { MultiRailScorer } from './routing-scorer.js';

const costEngine = new MultiRailCostEngine();

function price(input: {
  readonly id: string;
  readonly rail: 'bank_fx' | 'payment_institution' | 'stablecoin_settlement' | 'dex_liquidity';
  readonly indicatedRate: string;
  readonly p50Seconds: number;
  readonly reliability: string;
  readonly depth?: string | null;
}): ReturnType<MultiRailCostEngine['price']> {
  return costEngine.price(
    buildNormalizedQuote({
      providerId: input.id,
      indicatedRate: input.indicatedRate,
      midMarketRate: '1300',
      reliabilityScore: input.reliability,
      settlement: { p50Seconds: input.p50Seconds, p95Seconds: input.p50Seconds * 2 },
      ...(input.depth === undefined ? {} : { liquidityDepth: input.depth }),
    }),
    buildProviderDescriptor({ id: input.id, name: input.id, rail: input.rail }),
    defaultProfileForRail(input.rail),
  );
}

const CANDIDATES = [
  {
    id: 'bank',
    rail: 'bank_fx' as const,
    indicatedRate: '1290',
    p50Seconds: 86_400,
    reliability: '0.995',
  },
  {
    id: 'fx',
    rail: 'payment_institution' as const,
    indicatedRate: '1293',
    p50Seconds: 7_200,
    reliability: '0.99',
  },
  {
    id: 'stablecoin',
    rail: 'stablecoin_settlement' as const,
    indicatedRate: '1296',
    p50Seconds: 300,
    reliability: '0.985',
  },
];

describe('MultiRailScorer', () => {
  it('does not assume a traditional rail is always better', () => {
    const scored = new MultiRailScorer(parseRoutingWeights({
      cost: '0.45',
      speed: '0.20',
      liquidity: '0.15',
      reliability: '0.10',
      settlementConfidence: '0.10',
    })).score(CANDIDATES.map(price));

    expect(scored[0]?.provider.id).toBe('stablecoin');
    expect(scored[0]?.recommended).toBe(true);
    expect(scored.map((route) => route.provider.id)).not.toEqual(['bank', 'fx', 'stablecoin']);
  });

  it('is deterministic regardless of arrival order', () => {
    const scorer = new MultiRailScorer(
      parseRoutingWeights({
        cost: '0.45',
        speed: '0.20',
        liquidity: '0.15',
        reliability: '0.10',
        settlementConfidence: '0.10',
      }),
    );
    const forward = scorer.score(CANDIDATES.map(price));
    const reversed = scorer.score([...CANDIDATES].reverse().map(price));
    expect(reversed.map((route) => route.routeId)).toEqual(forward.map((route) => route.routeId));
    expect(reversed.map((route) => route.routeScore.toFixed())).toEqual(
      forward.map((route) => route.routeScore.toFixed()),
    );
  });

  it('follows configurable weights: speed-only picks the fastest route', () => {
    const scored = new MultiRailScorer(
      parseRoutingWeights({
        cost: '0',
        speed: '1',
        liquidity: '0',
        reliability: '0',
        settlementConfidence: '0',
      }),
    ).score(CANDIDATES.map(price));

    expect(scored[0]?.provider.id).toBe('stablecoin');
    expect(scored[0]?.scoreComponents.speed.toFixed()).toBe('1');
  });

  it('explains the score without claiming a model produced it', () => {
    const scored = new MultiRailScorer(
      parseRoutingWeights({
        cost: '0.45',
        speed: '0.20',
        liquidity: '0.15',
        reliability: '0.10',
        settlementConfidence: '0.10',
      }),
    ).score(CANDIDATES.map(price));

    expect(scored[0]?.routeExplanation).toContain('using weights cost 45%');
    expect(scored[0]?.routeExplanation).toContain('No model is used');
    expect(scored[0]?.routeExplanation).toContain('Recommended because the weighted score is highest');
  });
});
