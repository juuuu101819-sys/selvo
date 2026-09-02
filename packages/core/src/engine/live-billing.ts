import {
  evaluateLiveBilling,
  type LiveBillingEvaluation,
  type LiveEnablementRecord,
} from '../domain/live-enablement.js';
import type { Invoice } from '../domain/billing.js';

/**
 * Live collection, subscription charging, and partner payouts.
 *
 * Gated by `BILLING_LIVE_ENABLED` (default false) and recorded legal sign-off.
 * See `GO_LIVE_CHECKLIST.md#billing-collection`. This module never writes `collected`,
 * never moves funds, and never creates a partner payable balance (custody).
 */

export interface LiveBillingGateInput {
  readonly nowIso: string;
  readonly billingLiveEnabled: boolean;
  readonly billingRecord: LiveEnablementRecord | null;
}

export interface CollectionAttemptResult extends LiveBillingEvaluation {
  readonly invoicesInspected: number;
  readonly invoicesCollected: 0;
  readonly module: 'collection';
}

export interface SubscriptionAttemptResult extends LiveBillingEvaluation {
  readonly subscriptionsCharged: 0;
  readonly module: 'subscription';
}

export interface PartnerPayoutAttemptResult extends LiveBillingEvaluation {
  readonly payoutsDisbursed: 0;
  readonly payableRowsCreated: 0;
  readonly module: 'partner_payout';
}

function closedBilling(input: LiveBillingGateInput, invoicesInspected: number): LiveBillingEvaluation & {
  readonly invoicesInspected: number;
  readonly invoicesCollected: 0;
} {
  const evaluation = evaluateLiveBilling(input);
  return {
    ...evaluation,
    invoicesInspected,
    invoicesCollected: 0,
  };
}

/**
 * Attempt to collect issued platform-fee invoices.
 *
 * Invoice rows stay `uncollected`. `realizedRevenue` stays false. No processor is called.
 */
export function attemptPlatformFeeCollection(
  input: LiveBillingGateInput & { readonly invoices?: readonly Invoice[] },
): CollectionAttemptResult {
  const evaluation = closedBilling(input, input.invoices?.length ?? 0);
  return { ...evaluation, module: 'collection' };
}

/**
 * Recurring subscription billing. No plan catalog exists; this never charges a card or wallet.
 */
export function attemptLiveSubscriptionBilling(input: LiveBillingGateInput): SubscriptionAttemptResult {
  const evaluation = evaluateLiveBilling(input);
  return {
    ...evaluation,
    subscriptionsCharged: 0,
    module: 'subscription',
  };
}

/**
 * Partner payout / AP disbursement. Attribution on snapshots is not payable.
 * Never creates a spendable partner balance (invariant ③).
 */
export function attemptPartnerPayouts(input: LiveBillingGateInput): PartnerPayoutAttemptResult {
  const evaluation = evaluateLiveBilling(input);
  return {
    ...evaluation,
    payoutsDisbursed: 0,
    payableRowsCreated: 0,
    module: 'partner_payout',
  };
}
