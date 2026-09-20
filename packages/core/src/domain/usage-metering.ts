import { InvalidAmountError, ValidationError } from '../errors/index.js';
import { isMeteredAction, type BillableAction } from './billable-event.js';

/**
 * Per-organization API usage counters (§18.1).
 *
 * Counts are stored as integer strings and summed with `bigint`, for the same reason revenue is:
 * an enterprise caller on a monthly window can exceed `Number.MAX_SAFE_INTEGER` when counts are
 * multiplied by a per-call price, and a silently-rounded invoice is worse than no invoice.
 */

/** Metered API surfaces. One counter row per org, per surface, per period. */
export const METERED_ENDPOINTS = [
  'quote',
  'route_search',
  'compliance',
  'liquidity',
  'settlement_status',
  'reconciliation',
] as const;
export type MeteredEndpoint = (typeof METERED_ENDPOINTS)[number];

export const METERED_ENDPOINT_LABELS: Readonly<Record<MeteredEndpoint, string>> = {
  quote: 'Quote',
  route_search: 'Route search',
  compliance: 'Compliance screening',
  liquidity: 'Liquidity inspection',
  settlement_status: 'Settlement status',
  reconciliation: 'Reconciliation',
};

/**
 * Metered surface each billable action lands on.
 *
 * `decision.execution_intent` and `subscription.period` map to `null`: they are billed under
 * another class, and metering them too would be the double charge §18.6 forbids.
 */
const ENDPOINT_FOR_ACTION: Readonly<Record<BillableAction, MeteredEndpoint | null>> = {
  'quote.read': 'quote',
  'route.search': 'route_search',
  'compliance.screen': 'compliance',
  'liquidity.inspect': 'liquidity',
  'settlement.status': 'settlement_status',
  'reconciliation.report': 'reconciliation',
  'decision.execution_intent': null,
  'subscription.period': null,
};

export function isMeteredEndpoint(value: unknown): value is MeteredEndpoint {
  return typeof value === 'string' && (METERED_ENDPOINTS as readonly string[]).includes(value);
}

/** The metered surface for an action, or null when the action is billed under another class. */
export function meteredEndpointForAction(action: BillableAction): MeteredEndpoint | null {
  const endpoint = ENDPOINT_FOR_ACTION[action];
  if (endpoint !== null && !isMeteredAction(action)) {
    throw new ValidationError(
      `Action "${action}" is not billed as METERED_CALL and must not increment a usage counter.`,
      { action },
    );
  }
  return endpoint;
}

/** A persisted counter. `callCount` is an integer string so it can exceed 2^53 safely. */
export interface UsageCounter {
  readonly organizationId: string;
  readonly periodStart: string;
  readonly endpoint: MeteredEndpoint;
  readonly callCount: string;
  readonly firstCallAt: string;
  readonly lastCallAt: string;
}

export interface UsageRollupRow {
  readonly endpoint: MeteredEndpoint;
  readonly callCount: string;
}

export interface UsageRollup {
  readonly organizationId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totalCalls: string;
  readonly byEndpoint: readonly UsageRollupRow[];
}

export function parseCallCount(raw: string, field = 'callCount'): bigint {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new InvalidAmountError(`Usage ${field} must be a non-negative integer string.`, {
      field,
      value: raw,
    });
  }
  return BigInt(trimmed);
}

/**
 * Collapse counters into one rollup per organization and period.
 *
 * Endpoints with no calls are omitted rather than reported as zero, so an invoice does not carry
 * lines for surfaces the customer never touched.
 */
export function rollupUsage(input: {
  readonly organizationId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly counters: readonly UsageCounter[];
}): UsageRollup {
  const byEndpoint = new Map<MeteredEndpoint, bigint>();
  for (const counter of input.counters) {
    if (counter.organizationId !== input.organizationId) {
      throw new ValidationError('Cannot roll up usage counters across organizations.', {
        expected: input.organizationId,
        found: counter.organizationId,
      });
    }
    if (counter.periodStart !== input.periodStart) {
      continue;
    }
    byEndpoint.set(
      counter.endpoint,
      (byEndpoint.get(counter.endpoint) ?? 0n) + parseCallCount(counter.callCount),
    );
  }
  let total = 0n;
  const rows: UsageRollupRow[] = [];
  for (const endpoint of METERED_ENDPOINTS) {
    const count = byEndpoint.get(endpoint);
    if (count === undefined || count === 0n) {
      continue;
    }
    total += count;
    rows.push({ endpoint, callCount: count.toString() });
  }
  return {
    organizationId: input.organizationId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    totalCalls: total.toString(),
    byEndpoint: rows,
  };
}
