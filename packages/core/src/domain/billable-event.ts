import { ValidationError } from '../errors/index.js';

/**
 * The charge classes SELVO bills under, and the map from orchestration action to class (§18.6).
 *
 * The point of naming the classes and the actions in one place is the no-double-charge property:
 * a customer-facing total stays `Provider Cost + Network Cost + SELVO Fee`, which is only true if
 * one logical action produces exactly one charge. The temptation this file exists to block is
 * charging an execution-intent generation as both an API call and a decision.
 */

export const BILLABLE_EVENT_CLASSES = [
  /** Monthly base for the org's subscription tier. One per org per period. */
  'SUBSCRIPTION_PERIOD',
  /** One API call beyond the tier's included quota. */
  'METERED_CALL',
  /** One size-independent routing decision (§18.2). */
  'FLAT_DECISION',
] as const;
export type BillableEventClass = (typeof BILLABLE_EVENT_CLASSES)[number];

export const BILLABLE_EVENT_CLASS_LABELS: Readonly<Record<BillableEventClass, string>> = {
  SUBSCRIPTION_PERIOD: 'Subscription',
  METERED_CALL: 'Metered API usage',
  FLAT_DECISION: 'Per-decision fee',
};

export const BILLABLE_EVENT_CLASS_DESCRIPTIONS: Readonly<Record<BillableEventClass, string>> = {
  SUBSCRIPTION_PERIOD: 'Monthly platform access fee for the subscribed tier.',
  METERED_CALL: 'API calls made beyond the quota included in the tier.',
  FLAT_DECISION:
    'A fixed fee per routing decision, identical regardless of the transaction value.',
};

/**
 * Every action that can produce a charge.
 *
 * Read-only reporting surfaces (dashboard, audit export, health) are deliberately absent: they are
 * not billable, and adding them here would be the way a hidden fee got introduced.
 */
export const BILLABLE_ACTIONS = [
  'quote.read',
  'route.search',
  'compliance.screen',
  'liquidity.inspect',
  'settlement.status',
  'reconciliation.report',
  'decision.execution_intent',
  'subscription.period',
] as const;
export type BillableAction = (typeof BILLABLE_ACTIONS)[number];

/**
 * The single class each action is billed under.
 *
 * `decision.execution_intent` is the one that matters. Generating an execution intent is also an
 * API call, so it could plausibly be metered *and* charged a per-decision fee. It is charged
 * `FLAT_DECISION` only, and {@link isMeteredAction} excludes it from the usage meter, so the
 * decision fee replaces the call charge instead of stacking on top of it.
 */
export const BILLABLE_CLASS_FOR_ACTION: Readonly<Record<BillableAction, BillableEventClass>> = {
  'quote.read': 'METERED_CALL',
  'route.search': 'METERED_CALL',
  'compliance.screen': 'METERED_CALL',
  'liquidity.inspect': 'METERED_CALL',
  'settlement.status': 'METERED_CALL',
  'reconciliation.report': 'METERED_CALL',
  'decision.execution_intent': 'FLAT_DECISION',
  'subscription.period': 'SUBSCRIPTION_PERIOD',
};

export function isBillableAction(value: unknown): value is BillableAction {
  return typeof value === 'string' && (BILLABLE_ACTIONS as readonly string[]).includes(value);
}

export function isBillableEventClass(value: unknown): value is BillableEventClass {
  return (
    typeof value === 'string' && (BILLABLE_EVENT_CLASSES as readonly string[]).includes(value)
  );
}

/** The one class this action is billed under. Total per action is always exactly one. */
export function billableClassForAction(action: BillableAction): BillableEventClass {
  return BILLABLE_CLASS_FOR_ACTION[action];
}

/** Whether this action increments the usage meter. False for actions billed another way. */
export function isMeteredAction(action: BillableAction): boolean {
  return billableClassForAction(action) === 'METERED_CALL';
}

/**
 * Reject a set of charges that bills one action under more than one class.
 *
 * Called when assembling an invoice so an overlapping taxonomy surfaces as a refused billing run
 * rather than as a customer noticing they paid twice for one request.
 */
export function assertNoDoubleCharge(
  charges: readonly { readonly action: BillableAction; readonly eventClass: BillableEventClass }[],
): void {
  const seen = new Map<BillableAction, Set<BillableEventClass>>();
  for (const charge of charges) {
    const expected = billableClassForAction(charge.action);
    if (charge.eventClass !== expected) {
      throw new ValidationError(
        `Action "${charge.action}" is billed as ${expected} and must not be charged as ${charge.eventClass}.`,
        { action: charge.action, charged: charge.eventClass, expected },
      );
    }
    const classes = seen.get(charge.action) ?? new Set<BillableEventClass>();
    classes.add(charge.eventClass);
    seen.set(charge.action, classes);
  }
  const overlapping = [...seen.entries()].filter(([, classes]) => classes.size > 1);
  if (overlapping.length > 0) {
    throw new ValidationError('One action must not be billed under more than one charge class.', {
      actions: overlapping.map(([action, classes]) => ({ action, classes: [...classes] })),
    });
  }
}
