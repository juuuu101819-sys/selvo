import { PolicyDeniedError } from '../errors/index.js';
import { Dec } from '../money/index.js';
import type { PaymentPolicy, PolicyRule, QuotedRouteOption } from './agent-payments.js';

export interface PolicyEvaluationInput {
  readonly amountMinorUnits: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly recipientCode: string;
  readonly maxFeeBps: string | null;
  readonly selectedProviderId: string | null;
  readonly selectedRouteCostBps: string | null;
  readonly dailySpentMinorUnits: string;
}

/**
 * Deterministic payment-policy engine. `aiUsed` is always false: no model decides whether a
 * payment may proceed.
 */
export function evaluatePaymentPolicy(
  policy: PaymentPolicy,
  input: PolicyEvaluationInput,
): { readonly allowed: true; readonly aiUsed: false } {
  assertMaxTransaction(policy, input);
  assertAllowedAssets(policy, input);
  assertAllowedRecipient(policy, input);
  assertDailySpending(policy, input);
  assertMaximumFee(policy, input);
  assertAllowedProvider(policy, input);
  return { allowed: true, aiUsed: false };
}

export function feeCapBps(policy: PaymentPolicy, intentMaxFeeBps: string | null): string {
  if (intentMaxFeeBps === null) {
    return policy.maxFeeBps;
  }
  const intent = new Dec(intentMaxFeeBps);
  const policyCap = new Dec(policy.maxFeeBps);
  return intent.lessThan(policyCap) ? intent.toFixed() : policyCap.toFixed();
}

export function filterRoutesByPolicy(
  policy: PaymentPolicy,
  intentMaxFeeBps: string | null,
  routes: readonly QuotedRouteOption[],
): readonly QuotedRouteOption[] {
  const cap = new Dec(feeCapBps(policy, intentMaxFeeBps));
  return routes.filter((route) => {
    if (policy.allowedProviderIds.length > 0 && !policy.allowedProviderIds.includes(route.providerId)) {
      return false;
    }
    return !new Dec(route.totalCostBps).greaterThan(cap);
  });
}

function deny(rule: PolicyRule, message: string, details: Record<string, unknown>): never {
  throw new PolicyDeniedError(rule, message, details);
}

function assertMaxTransaction(policy: PaymentPolicy, input: PolicyEvaluationInput): void {
  if (BigInt(input.amountMinorUnits) > BigInt(policy.maxTransactionAmountMinorUnits)) {
    deny(
      'maximum_transaction_amount',
      'Amount exceeds the agent policy maximum transaction amount.',
      {
        amountMinorUnits: input.amountMinorUnits,
        maxTransactionAmountMinorUnits: policy.maxTransactionAmountMinorUnits,
        asset: input.sourceAsset,
      },
    );
  }
}

function assertAllowedAssets(policy: PaymentPolicy, input: PolicyEvaluationInput): void {
  if (policy.allowedAssets.length === 0) {
    deny('allowed_assets', 'This agent policy allows no assets.', {
      sourceAsset: input.sourceAsset,
      destinationAsset: input.destinationAsset,
      allowedAssets: [],
    });
  }
  const allowed = new Set(policy.allowedAssets.map((asset) => asset.toUpperCase()));
  if (!allowed.has(input.sourceAsset.toUpperCase())) {
    deny('allowed_assets', `Source asset "${input.sourceAsset}" is not allowed by policy.`, {
      sourceAsset: input.sourceAsset,
      allowedAssets: [...policy.allowedAssets],
    });
  }
  if (!allowed.has(input.destinationAsset.toUpperCase())) {
    deny(
      'allowed_assets',
      `Destination asset "${input.destinationAsset}" is not allowed by policy.`,
      {
        destinationAsset: input.destinationAsset,
        allowedAssets: [...policy.allowedAssets],
      },
    );
  }
}

function assertAllowedRecipient(policy: PaymentPolicy, input: PolicyEvaluationInput): void {
  if (policy.allowedRecipientCodes.length === 0) {
    deny('allowed_recipients', 'This agent policy allows no recipients.', {
      recipient: input.recipientCode,
      allowedRecipientCodes: [],
    });
  }
  const allowed = policy.allowedRecipientCodes.map((code) => code.toLowerCase());
  if (!allowed.includes(input.recipientCode.toLowerCase())) {
    deny('allowed_recipients', `Recipient "${input.recipientCode}" is not allowed by policy.`, {
      recipient: input.recipientCode,
      allowedRecipientCodes: [...policy.allowedRecipientCodes],
    });
  }
}

function assertDailySpending(policy: PaymentPolicy, input: PolicyEvaluationInput): void {
  if (input.sourceAsset.toUpperCase() !== policy.dailySpendingAsset.toUpperCase()) {
    return;
  }
  const next = BigInt(input.dailySpentMinorUnits) + BigInt(input.amountMinorUnits);
  if (next > BigInt(policy.dailySpendingLimitMinorUnits)) {
    deny('daily_spending_limit', 'Amount would exceed the agent daily spending limit.', {
      dailySpentMinorUnits: input.dailySpentMinorUnits,
      amountMinorUnits: input.amountMinorUnits,
      dailySpendingLimitMinorUnits: policy.dailySpendingLimitMinorUnits,
      dailySpendingAsset: policy.dailySpendingAsset,
    });
  }
}

function assertMaximumFee(policy: PaymentPolicy, input: PolicyEvaluationInput): void {
  const cap = new Dec(feeCapBps(policy, input.maxFeeBps));
  if (input.selectedRouteCostBps === null) {
    return;
  }
  if (new Dec(input.selectedRouteCostBps).greaterThan(cap)) {
    deny('maximum_fee', 'Selected route fee exceeds the policy or intent maximum fee.', {
      selectedRouteCostBps: input.selectedRouteCostBps,
      maxFeeBps: cap.toFixed(),
    });
  }
}

function assertAllowedProvider(policy: PaymentPolicy, input: PolicyEvaluationInput): void {
  if (input.selectedProviderId === null || policy.allowedProviderIds.length === 0) {
    return;
  }
  if (!policy.allowedProviderIds.includes(input.selectedProviderId)) {
    deny('allowed_providers', `Provider "${input.selectedProviderId}" is not allowed by policy.`, {
      providerId: input.selectedProviderId,
      allowedProviderIds: [...policy.allowedProviderIds],
    });
  }
}
