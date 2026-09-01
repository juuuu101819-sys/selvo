import { describe, expect, it } from 'vitest';
import { MandateRejectedError, PolicyDeniedError } from '../errors/index.js';
import type { PaymentPolicy } from '../domain/agent-payments.js';
import type { PolicyEvaluationInput } from '../domain/payment-policy.js';
import { evaluatePaymentPolicy } from '../domain/payment-policy.js';
import { assertMandateConstraints, constrainPolicyByMandate, requireUsableMandate } from './policy-bridge.js';
import type { MandateScope } from './types.js';

const policy: PaymentPolicy = {
  id: 'pol_1',
  organizationId: 'org_1',
  agentId: 'agt_1',
  maxTransactionAmountMinorUnits: '100000',
  allowedAssets: ['USD', 'USDC', 'KRW'],
  allowedRecipientCodes: ['merchant-x', 'merchant-y'],
  allowedProviderIds: ['sandbox-veridian-payments'],
  allowedChainIds: ['eip155:1'],
  allowedCountryCodes: ['*'],
  maxFeeBps: '50',
  maxSlippageBps: '50',
  minRouteScore: '10',
  minLiquidityHeadroom: '0',
  dailySpendingLimitMinorUnits: '1000000',
  dailySpendingAsset: 'USD',
  preferredRoutePreference: 'lowest_cost',
  createdAt: '2026-03-01T09:00:00.000Z',
  updatedAt: '2026-03-01T09:00:00.000Z',
};

const mandate: MandateScope = {
  spendCapMinorUnits: '50000',
  spendCapAsset: 'USD',
  allowedCorridors: [{ source: 'USD', destination: 'KRW' }],
  allowedCurrencies: ['USD', 'KRW'],
  allowedBeneficiaries: ['merchant-x'],
};

const input: PolicyEvaluationInput = {
  amountMinorUnits: '40000',
  sourceAsset: 'USD',
  destinationAsset: 'KRW',
  recipientCode: 'merchant-x',
  maxFeeBps: null,
  selectedProviderId: null,
  selectedRouteCostBps: null,
  selectedRoute: null,
  dailySpentMinorUnits: '0',
};

describe('constrainPolicyByMandate', () => {
  it('intersects allowlists and takes the tighter spend cap', () => {
    const constrained = constrainPolicyByMandate(policy, mandate);
    expect(constrained.maxTransactionAmountMinorUnits).toBe('50000');
    expect(constrained.allowedAssets).toEqual(['USD', 'KRW']);
    expect(constrained.allowedRecipientCodes).toEqual(['merchant-x']);
  });
});

describe('assertMandateConstraints', () => {
  it('allows an in-scope payment', () => {
    expect(() => assertMandateConstraints(mandate, input)).not.toThrow();
    expect(evaluatePaymentPolicy(policy, { ...input, mandate }).allowed).toBe(true);
  });

  it('denies an out-of-scope corridor as mandate_scope', () => {
    try {
      assertMandateConstraints(mandate, { ...input, destinationAsset: 'EUR' });
      throw new Error('expected deny');
    } catch (error) {
      expect(error).toBeInstanceOf(PolicyDeniedError);
      expect((error as PolicyDeniedError).details['rule']).toBe('mandate_scope');
    }
  });

  it('denies an amount above the mandate spend cap', () => {
    try {
      assertMandateConstraints(mandate, { ...input, amountMinorUnits: '50001' });
      throw new Error('expected deny');
    } catch (error) {
      expect(error).toBeInstanceOf(PolicyDeniedError);
      expect((error as PolicyDeniedError).details['rule']).toBe('mandate_scope');
    }
  });

  it('leaves existing policy evaluation unchanged when no mandate is attached', () => {
    expect(evaluatePaymentPolicy(policy, input).allowed).toBe(true);
  });
});

describe('requireUsableMandate', () => {
  it('rejects revoked and expired mandates', () => {
    try {
      requireUsableMandate('revoked', '2026-12-01T00:00:00.000Z', '2026-03-01T09:00:00.000Z');
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(MandateRejectedError);
      expect((error as MandateRejectedError).details['reason']).toBe('revoked');
    }
    try {
      requireUsableMandate('verified', '2026-02-01T00:00:00.000Z', '2026-03-01T09:00:00.000Z');
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(MandateRejectedError);
      expect((error as MandateRejectedError).details['reason']).toBe('expired');
    }
  });
});
