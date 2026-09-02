import { Dec, Rounding } from '../money/index.js';
import type { AssetAmount } from '../money/asset-amount.js';
import type { BestExecutionAttestation, MultiRailRouting, ScoredMultiRailRoute } from './routing-types.js';
import { ROUTING_ENGINE_VERSION } from './routing-config.js';
import { NotFoundError, ValidationError } from '../errors/index.js';

export interface SimulationPercentiles {
  readonly p10: string;
  readonly p25: string;
  readonly p50: string;
  readonly p75: string;
  readonly p95: string;
  readonly p99: string;
  readonly unit: 'bps' | 'seconds';
  readonly model: 'point' | 'log_normal_from_p50_p95' | 'slippage_adverse';
}

export interface RouteSimulation {
  readonly routingId: string;
  readonly routeId: string;
  readonly routingEngineVersion: string;
  readonly sandbox: true;
  readonly fundsMoved: false;
  readonly custody: false;
  readonly executable: false;
  readonly livePartnerCalled: false;
  readonly source: 'mock_or_historical_quotes';
  readonly recommended: boolean;
  readonly allInCost: {
    readonly expectedBps: string;
    readonly expectedAmount: ReturnType<AssetAmount['toJSON']>;
    readonly distribution: SimulationPercentiles;
  };
  readonly slippage: {
    readonly expectedBps: string;
    readonly distribution: SimulationPercentiles;
  };
  readonly settlement: {
    readonly p50Seconds: number;
    readonly p95Seconds: number;
    readonly distribution: SimulationPercentiles;
  };
  readonly deliveredAmount: ReturnType<AssetAmount['toJSON']>;
  readonly bestExecution: BestExecutionAttestation;
  readonly competingRouteCount: number;
}

/**
 * Closed-form settlement-time percentiles from the quote's published p50 and p95.
 *
 * Assumes a log-normal whose median is p50 and whose 95th percentile is p95. No RNG.
 */
export function settlementTimeDistribution(p50Seconds: number, p95Seconds: number): SimulationPercentiles {
  const p50 = Math.max(p50Seconds, 1);
  const p95 = Math.max(p95Seconds, p50);
  if (p95 === p50) {
    const value = String(p50);
    return {
      p10: value,
      p25: value,
      p50: value,
      p75: value,
      p95: value,
      p99: value,
      unit: 'seconds',
      model: 'point',
    };
  }
  const sigma = (Math.log(p95) - Math.log(p50)) / 1.6448536269514722;
  const mu = Math.log(p50);
  const quantile = (z: number): string =>
    new Dec(Math.exp(mu + sigma * z)).toDecimalPlaces(0, Rounding.HALF_UP).toFixed();
  return {
    p10: quantile(-1.2815515655446004),
    p25: quantile(-0.6744897501960817),
    p50: String(p50),
    p75: quantile(0.6744897501960817),
    p95: String(p95),
    p99: quantile(2.3263478740408408),
    unit: 'seconds',
    model: 'log_normal_from_p50_p95',
  };
}

export function costDistribution(expectedBps: string, slippageBps: string): SimulationPercentiles {
  const expected = new Dec(expectedBps);
  const slip = new Dec(slippageBps);
  if (slip.isZero()) {
    const value = expected.toFixed();
    return {
      p10: value,
      p25: value,
      p50: value,
      p75: value,
      p95: value,
      p99: value,
      unit: 'bps',
      model: 'point',
    };
  }
  const adverse = expected.plus(slip.times('0.25'));
  const severe = expected.plus(slip.times('0.50'));
  return {
    p10: expected.toFixed(),
    p25: expected.toFixed(),
    p50: expected.toFixed(),
    p75: expected.plus(slip.times('0.10')).toFixed(),
    p95: adverse.toFixed(),
    p99: severe.toFixed(),
    unit: 'bps',
    model: 'slippage_adverse',
  };
}

export function slippageDistribution(slippageBps: string): SimulationPercentiles {
  const slip = new Dec(slippageBps);
  if (slip.isZero()) {
    return {
      p10: '0',
      p25: '0',
      p50: '0',
      p75: '0',
      p95: '0',
      p99: '0',
      unit: 'bps',
      model: 'point',
    };
  }
  return {
    p10: slip.times('0.25').toDecimalPlaces(4, Rounding.HALF_UP).toFixed(),
    p25: slip.times('0.50').toDecimalPlaces(4, Rounding.HALF_UP).toFixed(),
    p50: slip.toFixed(),
    p75: slip.toFixed(),
    p95: slip.toFixed(),
    p99: slip.toFixed(),
    unit: 'bps',
    model: 'point',
  };
}

export function simulateRoute(routing: MultiRailRouting, routeId?: string): RouteSimulation {
  const route = selectSimulatedRoute(routing, routeId);
  const expectedBps = route.totalCostBps.toFixed();
  const slipBps = route.slippageBps.toFixed();
  return {
    routingId: routing.routingId,
    routeId: route.routeId,
    routingEngineVersion: ROUTING_ENGINE_VERSION,
    sandbox: true,
    fundsMoved: false,
    custody: false,
    executable: false,
    livePartnerCalled: false,
    source: 'mock_or_historical_quotes',
    recommended: route.recommended,
    allInCost: {
      expectedBps,
      expectedAmount: route.totalCost.toJSON(),
      distribution: costDistribution(expectedBps, slipBps),
    },
    slippage: {
      expectedBps: slipBps,
      distribution: slippageDistribution(slipBps),
    },
    settlement: {
      p50Seconds: route.settlement.p50Seconds,
      p95Seconds: route.settlement.p95Seconds,
      distribution: settlementTimeDistribution(route.settlement.p50Seconds, route.settlement.p95Seconds),
    },
    deliveredAmount: route.deliveredAmount.toJSON(),
    bestExecution: route.bestExecution,
    competingRouteCount: routing.routes.length,
  };
}

function selectSimulatedRoute(
  routing: MultiRailRouting,
  routeId: string | undefined,
): ScoredMultiRailRoute {
  if (routeId !== undefined) {
    const match = routing.routes.find((route) => route.routeId === routeId);
    if (match === undefined) {
      throw new NotFoundError('Route', routeId);
    }
    return match;
  }
  if (routing.recommendedRoute === null) {
    throw new ValidationError('No recommended route is available to simulate.', {});
  }
  return routing.recommendedRoute;
}
