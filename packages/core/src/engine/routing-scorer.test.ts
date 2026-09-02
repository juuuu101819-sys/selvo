import { describe, expect, it } from 'vitest';
import { defaultProfileForRail } from '../domain/provider-catalog.js';
import { buildNormalizedQuote, buildProviderDescriptor } from '../testing/index.js';
import { parseRoutingWeights, zeroedRoutingWeights } from './routing-config.js';
import { MultiRailCostEngine } from './routing-cost.js';
import { MultiRailScorer } from './routing-scorer.js';
import { MemoryRailHealthMonitor } from './rail-health.js';

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
      cost: '0.30',
      speed: '0.15',
      finality: '0.10',
      fxRate: '0.15',
      slippage: '0.10',
      liquidity: '0.10',
      compliance: '0.10',
    })).score(CANDIDATES.map(price));

    expect(scored[0]?.provider.id).toBe('stablecoin');
    expect(scored[0]?.recommended).toBe(true);
    expect(scored.map((route) => route.provider.id)).not.toEqual(['bank', 'fx', 'stablecoin']);
  });

  it('is deterministic regardless of arrival order', () => {
    const scorer = new MultiRailScorer(
      parseRoutingWeights({
        cost: '0.30',
        speed: '0.15',
        finality: '0.10',
        fxRate: '0.15',
        slippage: '0.10',
        liquidity: '0.10',
        compliance: '0.10',
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
      parseRoutingWeights(zeroedRoutingWeights({ speed: '1' })),
    ).score(CANDIDATES.map(price));

    expect(scored[0]?.provider.id).toBe('stablecoin');
    expect(scored[0]?.scoreComponents.speed.toFixed()).toBe('1');
  });

  it('picks a different path when the objective is cost-only versus speed-only', () => {
    const priced = CANDIDATES.map(price);
    const byCost = new MultiRailScorer(parseRoutingWeights(zeroedRoutingWeights({ cost: '1' }))).score(
      priced,
    );
    const bySpeed = new MultiRailScorer(
      parseRoutingWeights(zeroedRoutingWeights({ speed: '1' })),
    ).score(priced);
    expect(byCost[0]?.provider.id).toBe('stablecoin');
    expect(bySpeed[0]?.provider.id).toBe('stablecoin');
    const byFx = new MultiRailScorer(
      parseRoutingWeights(zeroedRoutingWeights({ fxRate: '1' })),
    ).score(priced);
    expect(byFx[0]?.provider.id).toBe('stablecoin');
    const slowCheap = [
      price({
        id: 'bank-cheap',
        rail: 'bank_fx',
        indicatedRate: '1299',
        p50Seconds: 86_400,
        reliability: '0.995',
      }),
      price({
        id: 'fast-rich',
        rail: 'stablecoin_settlement',
        indicatedRate: '1200',
        p50Seconds: 30,
        reliability: '0.99',
      }),
    ];
    expect(
      new MultiRailScorer(parseRoutingWeights(zeroedRoutingWeights({ cost: '1' }))).score(slowCheap)[0]
        ?.provider.id,
    ).toBe('bank-cheap');
    expect(
      new MultiRailScorer(parseRoutingWeights(zeroedRoutingWeights({ speed: '1' }))).score(slowCheap)[0]
        ?.provider.id,
    ).toBe('fast-rich');
  });

  it('deprioritizes a degraded rail so a healthy alternative wins', () => {
    const cheap = price({
      id: 'cheap-degraded',
      rail: 'bank_fx',
      indicatedRate: '1299',
      p50Seconds: 3_600,
      reliability: '0.995',
    });
    const healthy = price({
      id: 'healthy-dearer',
      rail: 'payment_institution',
      indicatedRate: '1280',
      p50Seconds: 3_600,
      reliability: '0.995',
    });
    const baseline = new MultiRailScorer(
      parseRoutingWeights(zeroedRoutingWeights({ cost: '1' })),
    ).score([cheap, healthy]);
    expect(baseline[0]?.provider.id).toBe('cheap-degraded');

    const monitor = new MemoryRailHealthMonitor();
    monitor.setState('cheap-degraded', 'degraded');
    const health = monitor.observe({
      priced: [cheap, healthy],
      nowIso: '2026-03-01T09:00:00.000Z',
    });
    const after = new MultiRailScorer(parseRoutingWeights(zeroedRoutingWeights({ cost: '1' }))).score(
      [cheap, healthy],
      { health, observedAt: '2026-03-01T09:00:00.000Z' },
    );
    expect(after[0]?.provider.id).toBe('healthy-dearer');
    expect(after.find((route) => route.provider.id === 'cheap-degraded')?.railHealth.deprioritized).toBe(
      true,
    );
  });

  it('fails over a down rail instead of recommending it', () => {
    const down = price({
      id: 'down-rail',
      rail: 'bank_fx',
      indicatedRate: '1299',
      p50Seconds: 60,
      reliability: '0.995',
    });
    const up = price({
      id: 'up-rail',
      rail: 'payment_institution',
      indicatedRate: '1200',
      p50Seconds: 86_400,
      reliability: '0.995',
    });
    const monitor = new MemoryRailHealthMonitor();
    monitor.setState('down-rail', 'down');
    const scored = new MultiRailScorer(parseRoutingWeights(zeroedRoutingWeights({ cost: '1' }))).score(
      [down, up],
      {
        health: monitor.observe({ priced: [down, up], nowIso: '2026-03-01T09:00:00.000Z' }),
      },
    );
    expect(scored.map((route) => route.provider.id)).toEqual(['up-rail']);
  });

  it('attaches a best-execution attestation that names the competing set', () => {
    const scored = new MultiRailScorer(
      parseRoutingWeights({
        cost: '0.30',
        speed: '0.15',
        finality: '0.10',
        fxRate: '0.15',
        slippage: '0.10',
        liquidity: '0.10',
        compliance: '0.10',
      }),
    ).score(CANDIDATES.map(price));

    expect(scored[0]?.bestExecution.selected).toBe(true);
    expect(scored[0]?.bestExecution.competingRouteCount).toBe(3);
    expect(scored[0]?.bestExecution.rationale).toContain('Best execution among 3 admitted paths');
    expect(scored[0]?.bestExecution.rationale).toContain('No model is used');
    expect(scored[0]?.bestExecution.rationaleHash).toMatch(/^[a-f0-9]{64}$/);
    expect(scored[0]?.routeExplanation).toBe(scored[0]?.bestExecution.rationale);
  });
});
