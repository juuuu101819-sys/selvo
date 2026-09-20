import { ValidationError } from '../errors/index.js';
import type { EconomicStage, RevenueRecognitionStatus } from './monetization.js';
import type { PlatformMode } from './provider.js';

/**
 * The single source of truth for what state a revenue number is in.
 *
 * Before this module there were three disagreeing answers to "is this revenue realized?": a CHECK
 * constraint tying `realized_revenue` to `revenue_recognition = 'collected'`, a dashboard total
 * that summed `economicStage === 'settled'`, and a TypeScript literal pinning `realizedRevenue`
 * to false. The middle one was reachable by a sandbox mock partner, so a simulated run inflated a
 * field labelled "realized revenue". Every revenue read now derives its state from
 * {@link resolveRevenueLifecycle} so that cannot recur.
 *
 * Promotion to {@link REALIZED_REVENUE} requires four independent facts, all of them real:
 * a PRODUCTION origin, provider-confirmed settlement finality, `collected` recognition, and a
 * collection reference from the processor. Missing any one of them caps the record at
 * {@link ATTRIBUTED_REVENUE}.
 */
export const REVENUE_LIFECYCLE_STATES = [
  'QUOTED_REVENUE',
  'EXPECTED_REVENUE',
  'ATTRIBUTED_REVENUE',
  'REALIZED_REVENUE',
] as const;
export type RevenueLifecycleState = (typeof REVENUE_LIFECYCLE_STATES)[number];

/**
 * Which environment produced a revenue record.
 *
 * Stamped at write time from the running platform mode and the provider that produced the
 * economics. Only `PRODUCTION` may ever reach {@link REALIZED_REVENUE}: a demo dataset, a
 * deterministic simulation, and a partner sandbox are all incapable of confirming that cash
 * arrived, regardless of what status they report.
 */
export const REVENUE_ORIGIN_ENVS = [
  'DEMO',
  'SIMULATION',
  'PARTNER_SANDBOX',
  'PRODUCTION',
] as const;
export type RevenueOriginEnv = (typeof REVENUE_ORIGIN_ENVS)[number];

/**
 * Whether a settlement backing this revenue was confirmed final, and by whom.
 *
 * `simulated` is deliberately distinct from `provider_confirmed`: a sandbox partner reporting
 * `settled` produces `simulated`, which can never satisfy realization.
 */
export const SETTLEMENT_FINALITY_STATES = ['unsettled', 'simulated', 'provider_confirmed'] as const;
export type SettlementFinalityState = (typeof SETTLEMENT_FINALITY_STATES)[number];

/** Why a record could not be promoted past {@link ATTRIBUTED_REVENUE}. */
export const REVENUE_CAP_REASONS = [
  'non_production_origin',
  'settlement_not_provider_confirmed',
  'recognition_not_collected',
  'collection_reference_missing',
] as const;
export type RevenueCapReason = (typeof REVENUE_CAP_REASONS)[number];

export interface RevenueLifecycleInput {
  readonly economicStage: EconomicStage;
  readonly revenueRecognition: RevenueRecognitionStatus;
  readonly realizedRevenue: boolean;
  readonly originEnv: RevenueOriginEnv;
  readonly settlementFinality: SettlementFinalityState;
  readonly collectionReference: string | null | undefined;
}

export interface RevenueLifecycleResolution {
  readonly state: RevenueLifecycleState;
  /** True only for {@link REALIZED_REVENUE}. The only state that may be reported as cash. */
  readonly cashRecognizable: boolean;
  /**
   * The state this record would have reached had nothing blocked it, when that differs from
   * {@link state}. Null when no cap applied.
   */
  readonly cappedFrom: RevenueLifecycleState | null;
  /** Every unmet realization precondition, in a stable order. Empty when realized. */
  readonly capReasons: readonly RevenueCapReason[];
}

export function isRevenueLifecycleState(value: unknown): value is RevenueLifecycleState {
  return (
    typeof value === 'string' && (REVENUE_LIFECYCLE_STATES as readonly string[]).includes(value)
  );
}

export function isRevenueOriginEnv(value: unknown): value is RevenueOriginEnv {
  return typeof value === 'string' && (REVENUE_ORIGIN_ENVS as readonly string[]).includes(value);
}

export function isSettlementFinalityState(value: unknown): value is SettlementFinalityState {
  return (
    typeof value === 'string' && (SETTLEMENT_FINALITY_STATES as readonly string[]).includes(value)
  );
}

/** Origins that can never produce realized cash, however they are labelled downstream. */
export function isSimulatedOrigin(origin: RevenueOriginEnv): boolean {
  return origin !== 'PRODUCTION';
}

/**
 * Origin stamp for revenue produced by the running process.
 *
 * Derived from the platform mode so a caller cannot pass `PRODUCTION` from a sandbox process.
 * Seeded demo data overrides this with `DEMO` at its own write site, and anything produced by a
 * sandbox execution partner overrides it with `PARTNER_SANDBOX`.
 */
export function revenueOriginEnvForMode(mode: PlatformMode): RevenueOriginEnv {
  return mode === 'production' ? 'PRODUCTION' : 'SIMULATION';
}

/**
 * Funnel position implied by the record's own stage and recognition, ignoring realization.
 *
 * `invoiced` outranks the stage: once a snapshot has been copied onto an issued invoice it is
 * attributed to a billing period regardless of which stage produced it.
 */
function uncappedState(input: RevenueLifecycleInput): RevenueLifecycleState {
  if (input.revenueRecognition === 'collected') {
    return 'REALIZED_REVENUE';
  }
  if (input.revenueRecognition === 'invoiced') {
    return 'ATTRIBUTED_REVENUE';
  }
  switch (input.economicStage) {
    case 'route_quote':
      return 'QUOTED_REVENUE';
    case 'route_selected':
    case 'execution_intent':
      return 'EXPECTED_REVENUE';
    case 'settled':
      return 'ATTRIBUTED_REVENUE';
  }
}

/**
 * The canonical resolver. Every revenue read path must derive state from this function.
 *
 * Deliberately pure and synchronous so no caller can be tempted to reimplement it inline.
 */
export function resolveRevenueLifecycle(
  input: RevenueLifecycleInput,
): RevenueLifecycleResolution {
  const uncapped = uncappedState(input);
  const capReasons: RevenueCapReason[] = [];

  if (isSimulatedOrigin(input.originEnv)) {
    capReasons.push('non_production_origin');
  }
  if (input.settlementFinality !== 'provider_confirmed') {
    capReasons.push('settlement_not_provider_confirmed');
  }
  if (input.revenueRecognition !== 'collected') {
    capReasons.push('recognition_not_collected');
  }
  // Tolerates an absent field as well as null: a record that omits the reference has not proven
  // collection, which is the same answer as an empty one.
  if (
    input.collectionReference === null ||
    input.collectionReference === undefined ||
    input.collectionReference.trim() === ''
  ) {
    capReasons.push('collection_reference_missing');
  }

  const realizable = capReasons.length === 0 && input.realizedRevenue;
  if (realizable) {
    return {
      state: 'REALIZED_REVENUE',
      cashRecognizable: true,
      cappedFrom: null,
      capReasons: [],
    };
  }

  // Anything that claims realization without earning it is reported one rung down, never as cash.
  const capped: RevenueLifecycleState =
    uncapped === 'REALIZED_REVENUE' ? 'ATTRIBUTED_REVENUE' : uncapped;
  return {
    state: capped,
    cashRecognizable: false,
    cappedFrom: capped === uncapped ? null : uncapped,
    capReasons,
  };
}

/**
 * Refuse to construct a revenue record whose realization claim is not backed by its own fields.
 *
 * The database enforces the same rules (see the `monetization_events_realized_*` constraints), so
 * this is the application-layer half of that pair: it fails at the write site with a precise
 * message instead of surfacing as a constraint violation.
 */
export function assertRealizationClaimSupported(input: RevenueLifecycleInput): void {
  if (!input.realizedRevenue) {
    return;
  }
  const resolution = resolveRevenueLifecycle(input);
  if (resolution.cashRecognizable) {
    return;
  }
  throw new ValidationError(
    'realizedRevenue cannot be true without a production origin, provider-confirmed settlement ' +
      'finality, collected recognition, and a collection reference.',
    {
      capReasons: [...resolution.capReasons],
      originEnv: input.originEnv,
      settlementFinality: input.settlementFinality,
      revenueRecognition: input.revenueRecognition,
      hasCollectionReference: input.collectionReference !== null,
    },
  );
}

export const REVENUE_LIFECYCLE_LABELS: Readonly<Record<RevenueLifecycleState, string>> = {
  QUOTED_REVENUE: 'Quoted',
  EXPECTED_REVENUE: 'Expected',
  ATTRIBUTED_REVENUE: 'Attributed',
  REALIZED_REVENUE: 'Realized',
};

/**
 * Short explanation of what a state does and does not assert, for UI captions and API docs.
 * Keeps the "this is not cash" disclosure next to the number rather than in a separate legend.
 */
export const REVENUE_LIFECYCLE_DESCRIPTIONS: Readonly<Record<RevenueLifecycleState, string>> = {
  QUOTED_REVENUE: 'Attributed to a quote that was priced. No commitment, not cash.',
  EXPECTED_REVENUE: 'Attributed to a selected route or recorded execution intent. Not cash.',
  ATTRIBUTED_REVENUE: 'Attributed to a settlement or an issued invoice. Billed at most, not cash.',
  REALIZED_REVENUE: 'Collected against a provider-confirmed settlement. Recognizable as cash.',
};
