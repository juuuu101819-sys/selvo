import {
  isEconomicStage,
  isRevenueOriginEnv,
  isRevenueRecognitionStatus,
  isSettlementFinalityState,
  resolveRevenueLifecycle,
  type MonetizationEvent,
} from '@meridian/core';

export interface PersistedLifecycleColumns {
  readonly economicStage: string;
  readonly revenueRecognition?: string;
  readonly originEnv?: string;
  readonly settlementFinality?: string;
  readonly collectionReference?: string | null;
  readonly realizedRevenue?: boolean;
}

export type MonetizationLifecycleFields = Pick<
  MonetizationEvent,
  | 'economicStage'
  | 'revenueRecognition'
  | 'originEnv'
  | 'settlementFinality'
  | 'collectionReference'
  | 'realizedRevenue'
  | 'lifecycleState'
>;

/**
 * Lifecycle fields for a persisted monetization row, with the state re-derived rather than read.
 *
 * Shared by every row mapper so there is exactly one place that turns database columns into a
 * lifecycle state. An unrecognized `originEnv` or `settlementFinality` falls back to the value
 * that cannot realize, and `realizedRevenue` is taken from the resolver rather than the column,
 * so a row written by an older revision or edited out of band reads as simulated rather than as
 * cash.
 */
export function monetizationLifecycleFields(
  row: PersistedLifecycleColumns,
): MonetizationLifecycleFields {
  const resolved = {
    economicStage: isEconomicStage(row.economicStage) ? row.economicStage : 'route_quote',
    revenueRecognition: isRevenueRecognitionStatus(row.revenueRecognition)
      ? row.revenueRecognition
      : 'unrealized',
    originEnv: isRevenueOriginEnv(row.originEnv) ? row.originEnv : 'SIMULATION',
    settlementFinality: isSettlementFinalityState(row.settlementFinality)
      ? row.settlementFinality
      : 'unsettled',
    collectionReference: row.collectionReference ?? null,
    realizedRevenue: row.realizedRevenue ?? false,
  } as const;
  const resolution = resolveRevenueLifecycle(resolved);
  return {
    ...resolved,
    realizedRevenue: resolution.cashRecognizable,
    lifecycleState: resolution.state,
  };
}
