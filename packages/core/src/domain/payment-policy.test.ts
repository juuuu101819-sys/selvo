import { describe, expect, it } from 'vitest';
import { PolicyDeniedError } from '../errors/index.js';
import { parsePayInstruction, resolveMerchant } from './payment-instruction.js';
import { evaluatePaymentPolicy, filterRoutesByPolicy } from './payment-policy.js';
import type { Merchant, PaymentPolicy, QuotedRouteOption } from './agent-payments.js';

const merchant: Merchant = {
  id: 'mrc_1',
  organizationId: 'org_1',
  name: 'Merchant X',
  recipientCode: 'merchant-x',
  settlementAsset: 'KRW',
  status: 'active',
  createdAt: '2026-03-01T09:00:00.000Z',
};

const policy: PaymentPolicy = {
  id: 'pol_1',
  organizationId: 'org_1',
  agentId: 'agt_1',
  maxTransactionAmountMinorUnits: '1000000',
  allowedAssets: ['USD', 'KRW'],
  allowedRecipientCodes: ['merchant-x'],
  allowedProviderIds: [],
  maxFeeBps: '50',
  dailySpendingLimitMinorUnits: '2000000',
  dailySpendingAsset: 'USD',
  createdAt: '2026-03-01T09:00:00.000Z',
  updatedAt: '2026-03-01T09:00:00.000Z',
};

function deniedRule(run: () => void): string {
  try {
    run();
  } catch (error) {
    if (error instanceof PolicyDeniedError) {
      const rule = error.details['rule'];
      return typeof rule === 'string' ? rule : '';
    }
    throw error;
  }
  throw new Error('expected POLICY_DENIED');
}

function input(overrides: Partial<Parameters<typeof evaluatePaymentPolicy>[1]> = {}) {
  return {
    amountMinorUnits: '50000',
    sourceAsset: 'USD',
    destinationAsset: 'KRW',
    recipientCode: 'merchant-x',
    maxFeeBps: null,
    selectedProviderId: null,
    selectedRouteCostBps: null,
    dailySpentMinorUnits: '0',
    ...overrides,
  };
}

describe('parsePayInstruction', () => {
  it('turns "Pay 500 USD to merchant X" into a structured intent', () => {
    const parsed = parsePayInstruction('Pay 500 USD to merchant X', [merchant]);
    expect(parsed).toMatchObject({
      sourceAsset: 'USD',
      amountMinorUnits: '50000',
      recipientCode: 'merchant-x',
      destinationAsset: 'KRW',
    });
  });

  it('resolves a recipient code case-insensitively', () => {
    expect(resolveMerchant('MERCHANT-X', [merchant])?.recipientCode).toBe('merchant-x');
  });

  it('rejects an unknown merchant', () => {
    expect(() => parsePayInstruction('Pay 500 USD to nobody', [merchant])).toThrow(
      /Unknown recipient/,
    );
  });
});

describe('evaluatePaymentPolicy', () => {
  it('allows a payment inside every limit', () => {
    expect(evaluatePaymentPolicy(policy, input()).aiUsed).toBe(false);
  });

  it('denies an amount above the maximum transaction', () => {
    expect(deniedRule(() => evaluatePaymentPolicy(policy, input({ amountMinorUnits: '1000001' })))).toBe(
      'maximum_transaction_amount',
    );
  });

  it('denies a disallowed asset', () => {
    expect(deniedRule(() => evaluatePaymentPolicy(policy, input({ sourceAsset: 'EUR' })))).toBe(
      'allowed_assets',
    );
  });

  it('denies a disallowed recipient', () => {
    expect(deniedRule(() => evaluatePaymentPolicy(policy, input({ recipientCode: 'merchant-y' })))).toBe(
      'allowed_recipients',
    );
  });

  it('denies a disallowed provider', () => {
    const restricted = { ...policy, allowedProviderIds: ['sandbox-northgate-bank'] };
    expect(
      deniedRule(() =>
        evaluatePaymentPolicy(restricted, input({ selectedProviderId: 'sandbox-veridian-payments' })),
      ),
    ).toBe('allowed_providers');
  });

  it('denies a route fee above the cap', () => {
    expect(deniedRule(() => evaluatePaymentPolicy(policy, input({ selectedRouteCostBps: '80' })))).toBe(
      'maximum_fee',
    );
  });

  it('denies a payment that would exceed the daily spending limit', () => {
    expect(
      deniedRule(() =>
        evaluatePaymentPolicy(policy, input({ dailySpentMinorUnits: '1990000', amountMinorUnits: '20000' })),
      ),
    ).toBe('daily_spending_limit');
  });

  it('treats an empty allowed-asset list as none, not all', () => {
    expect(deniedRule(() => evaluatePaymentPolicy({ ...policy, allowedAssets: [] }, input()))).toBe(
      'allowed_assets',
    );
  });
});

describe('filterRoutesByPolicy', () => {
  const routes: readonly QuotedRouteOption[] = [
    {
      routeId: 'r1',
      rank: 1,
      recommended: true,
      providerId: 'cheap',
      providerName: 'Cheap',
      rail: 'bank_fx',
      totalCostBps: '20',
      expiresAt: '2026-03-01T10:00:00.000Z',
    },
    {
      routeId: 'r2',
      rank: 2,
      recommended: false,
      providerId: 'pricey',
      providerName: 'Pricey',
      rail: 'bank_fx',
      totalCostBps: '80',
      expiresAt: '2026-03-01T10:00:00.000Z',
    },
  ];

  it('drops routes above the fee cap', () => {
    expect(filterRoutesByPolicy(policy, null, routes).map((route) => route.routeId)).toEqual(['r1']);
  });
});
