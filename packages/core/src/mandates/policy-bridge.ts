import { MandateRejectedError, PolicyDeniedError } from '../errors/index.js';
import type { PaymentPolicy } from '../domain/agent-payments.js';
import type { PolicyEvaluationInput } from '../domain/payment-policy.js';
import type { MandateScope } from './types.js';
import {
  mandateAllowsAmount,
  mandateAllowsBeneficiary,
  mandateAllowsCorridor,
} from './scope.js';

/**
 * Intersect a stored payment policy with a verified mandate. The result is at least as strict
 * as either input. Empty intersections fail closed at evaluation time, not by inventing "all".
 */
export function constrainPolicyByMandate(policy: PaymentPolicy, mandate: MandateScope): PaymentPolicy {
  const allowedAssets = policy.allowedAssets.filter((asset) =>
    mandate.allowedCurrencies.includes(asset.toUpperCase()),
  );
  const allowedRecipientCodes = policy.allowedRecipientCodes.filter((code) =>
    mandate.allowedBeneficiaries.includes(code) ||
    mandate.allowedBeneficiaries.includes(code.toLowerCase()),
  );
  let maxTransactionAmountMinorUnits = policy.maxTransactionAmountMinorUnits;
  if (BigInt(mandate.spendCapMinorUnits) < BigInt(policy.maxTransactionAmountMinorUnits)) {
    maxTransactionAmountMinorUnits = mandate.spendCapMinorUnits;
  }
  return {
    ...policy,
    maxTransactionAmountMinorUnits,
    allowedAssets,
    allowedRecipientCodes,
  };
}

export function assertMandateConstraints(scope: MandateScope, input: PolicyEvaluationInput): void {
  if (!mandateAllowsCorridor(scope, input.sourceAsset, input.destinationAsset)) {
    throw new PolicyDeniedError(
      'mandate_scope',
      'Corridor is outside the verified mandate scope.',
      {
        failClosed: true,
        sourceAsset: input.sourceAsset,
        destinationAsset: input.destinationAsset,
        allowedCorridors: scope.allowedCorridors,
      },
    );
  }
  if (!mandateAllowsAmount(scope, input.amountMinorUnits, input.sourceAsset)) {
    throw new PolicyDeniedError(
      'mandate_scope',
      'Amount exceeds the verified mandate spend cap.',
      {
        failClosed: true,
        amountMinorUnits: input.amountMinorUnits,
        spendCapMinorUnits: scope.spendCapMinorUnits,
        spendCapAsset: scope.spendCapAsset,
      },
    );
  }
  if (!mandateAllowsBeneficiary(scope, input.recipientCode)) {
    throw new PolicyDeniedError(
      'mandate_scope',
      'Beneficiary is outside the verified mandate scope.',
      {
        failClosed: true,
        recipientCode: input.recipientCode,
        allowedBeneficiaries: scope.allowedBeneficiaries,
      },
    );
  }
}

export function requireUsableMandate(status: string, expiresAt: string, nowIso: string): void {
  if (status === 'revoked') {
    throw new MandateRejectedError('revoked', 'Mandate has been revoked.');
  }
  if (Date.parse(expiresAt) <= Date.parse(nowIso)) {
    throw new MandateRejectedError('expired', 'Mandate has expired.', { expiresAt });
  }
  if (status !== 'verified') {
    throw new MandateRejectedError('scope_invalid', 'Mandate is not in a usable verified state.', {
      status,
    });
  }
}
