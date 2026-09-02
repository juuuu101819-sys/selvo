import { Dec, type Decimal } from '../money/index.js';
import type { RailType } from '../domain/rail.js';
import type { ProviderHealth, ProviderHealthState } from '../ports/provider-adapter.js';
import type { PricedMultiRailRoute } from './routing-types.js';

export const RAIL_HEALTH_STATES = ['up', 'degraded', 'down'] as const;
export type RailHealthState = (typeof RAIL_HEALTH_STATES)[number];

export const LIQUIDITY_STATES = ['ample', 'thin', 'dry', 'unknown'] as const;
export type LiquidityState = (typeof LIQUIDITY_STATES)[number];

export const RAIL_HEALTH_SOURCES = ['quote', 'probe', 'override'] as const;
export type RailHealthSource = (typeof RAIL_HEALTH_SOURCES)[number];

/** Reliability below this is treated as a down rail and excluded (failover). */
export const RAIL_DOWN_RELIABILITY = new Dec('0.90');
/** Reliability below this (but at or above the down floor) is degraded. */
export const RAIL_DEGRADED_RELIABILITY = new Dec('0.97');
/** Headroom below 1× notional is dry. */
export const RAIL_DRY_HEADROOM = new Dec(1);
/** Headroom below the comfort multiple is thin. */
export const RAIL_THIN_HEADROOM = new Dec(2);

export const DEGRADED_SCORE_MULTIPLIER = new Dec('0.55');
export const DRY_LIQUIDITY_SCORE_MULTIPLIER = new Dec('0.70');
export const THIN_LIQUIDITY_SCORE_MULTIPLIER = new Dec('0.85');

export interface RailHealthObservation {
  readonly providerId: string;
  readonly rail: RailType;
  readonly state: RailHealthState;
  readonly liquidityState: LiquidityState;
  readonly liquidityHeadroom: string | null;
  readonly reliabilityScore: string;
  readonly observedAt: string;
  readonly reason: string;
  readonly source: RailHealthSource;
  readonly deprioritized: boolean;
}

export interface RailHealthObserveInput {
  readonly priced: readonly PricedMultiRailRoute[];
  readonly probes?: readonly ProviderHealth[] | undefined;
  readonly nowIso: string;
}

export interface RailHealthMonitor {
  observe(input: RailHealthObserveInput): readonly RailHealthObservation[];
}

/**
 * Derives rail health from quoted reliability / depth and optional probe results.
 *
 * No live partner settlement call. Overrides exist so tests (and a future operator kill-switch)
 * can inject degraded or down rails without inventing quotes.
 */
export class MemoryRailHealthMonitor implements RailHealthMonitor {
  private readonly overrides = new Map<string, RailHealthState>();

  setState(providerId: string, state: RailHealthState): void {
    this.overrides.set(providerId, state);
  }

  clear(): void {
    this.overrides.clear();
  }

  observe(input: RailHealthObserveInput): readonly RailHealthObservation[] {
    const probes = new Map((input.probes ?? []).map((probe) => [probe.providerId, probe]));
    return input.priced.map((route) =>
      observeRoute(route, probes.get(route.provider.id) ?? null, this.overrides.get(route.provider.id), input.nowIso),
    );
  }
}

export function observeRoute(
  route: PricedMultiRailRoute,
  probe: ProviderHealth | null,
  override: RailHealthState | undefined,
  nowIso: string,
): RailHealthObservation {
  const liquidityState = liquidityStateOf(route.liquidityHeadroom);
  let state: RailHealthState = 'up';
  let reason = 'quote_healthy';
  let source: RailHealthSource = 'quote';

  if (route.reliabilityScore.lessThan(RAIL_DOWN_RELIABILITY)) {
    state = 'down';
    reason = 'reliability_below_down_threshold';
  } else if (
    route.reliabilityScore.lessThan(RAIL_DEGRADED_RELIABILITY) ||
    liquidityState === 'dry'
  ) {
    state = 'degraded';
    reason =
      liquidityState === 'dry' && !route.reliabilityScore.lessThan(RAIL_DEGRADED_RELIABILITY)
        ? 'liquidity_dry'
        : 'reliability_degraded';
  }

  if (probe !== null) {
    if (probe.state === 'down') {
      state = 'down';
      reason = probe.detail ?? 'probe_down';
      source = 'probe';
    } else if (probe.state === 'degraded' && state !== 'down') {
      state = 'degraded';
      reason = probe.detail ?? 'probe_degraded';
      source = 'probe';
    }
  }

  if (override !== undefined) {
    state = override;
    reason = 'operator_or_test_override';
    source = 'override';
  }

  return {
    providerId: route.provider.id,
    rail: route.rail,
    state,
    liquidityState,
    liquidityHeadroom: route.liquidityHeadroom === null ? null : route.liquidityHeadroom.toFixed(),
    reliabilityScore: route.reliabilityScore.toFixed(),
    observedAt: nowIso,
    reason,
    source,
    deprioritized: state === 'degraded' || liquidityState === 'dry' || liquidityState === 'thin',
  };
}

export function liquidityStateOf(headroom: Decimal | null): LiquidityState {
  if (headroom === null) {
    return 'unknown';
  }
  if (headroom.lessThan(RAIL_DRY_HEADROOM)) {
    return 'dry';
  }
  if (headroom.lessThan(RAIL_THIN_HEADROOM)) {
    return 'thin';
  }
  return 'ample';
}

export function healthMultiplier(observation: RailHealthObservation | undefined): Decimal {
  if (observation === undefined) {
    return new Dec(1);
  }
  let factor = new Dec(1);
  if (observation.state === 'degraded') {
    factor = factor.times(DEGRADED_SCORE_MULTIPLIER);
  }
  if (observation.liquidityState === 'dry') {
    factor = factor.times(DRY_LIQUIDITY_SCORE_MULTIPLIER);
  } else if (observation.liquidityState === 'thin') {
    factor = factor.times(THIN_LIQUIDITY_SCORE_MULTIPLIER);
  }
  return factor;
}

export function isDownObservation(observation: RailHealthObservation | undefined): boolean {
  return observation?.state === 'down';
}

export function healthByProvider(
  observations: readonly RailHealthObservation[],
): ReadonlyMap<string, RailHealthObservation> {
  return new Map(observations.map((item) => [item.providerId, item]));
}

export function probeStateOf(probe: ProviderHealth | null): ProviderHealthState | null {
  return probe?.state ?? null;
}
