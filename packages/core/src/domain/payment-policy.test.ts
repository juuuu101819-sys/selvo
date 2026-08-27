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
  maxTransactionAmountMinorUnits: '100000',
  allowedAssets: ['USD', 'USDC', 'KRW'],
  allowedRecipientCodes: ['merchant-x'],
  allowedProviderIds: ['sandbox-veridian-payments', 'sandbox-solstice-settlement'],
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

function quoted(overrides: Partial<QuotedRouteOption> = {}): QuotedRouteOption {
  return {
    routeId: 'r1',
    rank: 1,
    recommended: true,
    providerId: 'sandbox-veridian-payments',
    providerName: 'Veridian Payments',
    rail: 'payment_institution',
    totalCostBps: '20',
    expiresAt: '2026-03-01T10:00:00.000Z',
    routeScore: '80',
    slippageBps: '5',
    liquidityHeadroom: '4',
    chainId: null,
    jurisdictions: ['*'],
    platformFeeMinorUnits: '100',
    providerFeeMinorUnits: '400',
    ...overrides,
  };
}

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
    selectedRoute: null,
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
    const decision = evaluatePaymentPolicy(policy, input({ selectedRoute: quoted() }));
    expect(decision.aiUsed).toBe(false);
    expect(decision.failClosed).toBe(true);
  });

  it('allows a payment equal to the $1,000 maximum', () => {
    expect(evaluatePaymentPolicy(policy, input({ amountMinorUnits: '100000' })).allowed).toBe(true);
  });

  it('denies an amount above the maximum transaction', () => {
    expect(deniedRule(() => evaluatePaymentPolicy(policy, input({ amountMinorUnits: '100001' })))).toBe(
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
    expect(
      deniedRule(() =>
        evaluatePaymentPolicy(
          policy,
          input({ selectedProviderId: 'sandbox-northgate-bank', selectedRoute: quoted({ providerId: 'sandbox-northgate-bank' }) }),
        ),
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
        evaluatePaymentPolicy(policy, input({ dailySpentMinorUnits: '990000', amountMinorUnits: '20000' })),
      ),
    ).toBe('daily_spending_limit');
  });

  it('treats an empty allowed-asset list as none, not all', () => {
    expect(deniedRule(() => evaluatePaymentPolicy({ ...policy, allowedAssets: [] }, input()))).toBe(
      'allowed_assets',
    );
  });

  it('treats an empty provider list as none — fail closed', () => {
    expect(
      deniedRule(() =>
        evaluatePaymentPolicy({ ...policy, allowedProviderIds: [] }, input({ selectedRoute: quoted() })),
      ),
    ).toBe('allowed_providers');
  });

  it('denies an unknown chain', () => {
    expect(
      deniedRule(() =>
        evaluatePaymentPolicy(policy, input({ selectedRoute: quoted({ chainId: 'eip155:137' }) })),
      ),
    ).toBe('allowed_chains');
  });

  it('denies an empty country allow-list', () => {
    expect(
      deniedRule(() =>
        evaluatePaymentPolicy(
          { ...policy, allowedCountryCodes: [] },
          input({ selectedRoute: quoted() }),
        ),
      ),
    ).toBe('allowed_countries');
  });

  it('denies slippage above 0.5%', () => {
    expect(
      deniedRule(() =>
        evaluatePaymentPolicy(policy, input({ selectedRoute: quoted({ slippageBps: '51' }) })),
      ),
    ).toBe('maximum_slippage');
  });

  it('denies a missing slippage value — fail closed', () => {
    expect(
      deniedRule(() =>
        evaluatePaymentPolicy(policy, input({ selectedRoute: quoted({ slippageBps: null }) })),
      ),
    ).toBe('maximum_slippage');
  });

  it('denies a route score below the minimum', () => {
    expect(
      deniedRule(() =>
        evaluatePaymentPolicy(policy, input({ selectedRoute: quoted({ routeScore: '9' }) })),
      ),
    ).toBe('minimum_route_score');
  });

  it('denies unknown liquidity when a minimum is set', () => {
    expect(
      deniedRule(() =>
        evaluatePaymentPolicy(
          { ...policy, minLiquidityHeadroom: '1' },
          input({ selectedRoute: quoted({ liquidityHeadroom: null }) }),
        ),
      ),
    ).toBe('minimum_liquidity');
  });

  it('allows unknown liquidity when the minimum is zero', () => {
    expect(
      evaluatePaymentPolicy(policy, input({ selectedRoute: quoted({ liquidityHeadroom: null }) }))
        .allowed,
    ).toBe(true);
  });

  it('allows a fiat route when the chain allow-list is empty', () => {
    expect(
      evaluatePaymentPolicy(
        { ...policy, allowedChainIds: [] },
        input({ selectedRoute: quoted({ chainId: null }) }),
      ).allowed,
    ).toBe(true);
  });

  it('matches a wildcard jurisdiction against a specific country list', () => {
    expect(
      evaluatePaymentPolicy(
        { ...policy, allowedCountryCodes: ['US', 'KR'] },
        input({ selectedRoute: quoted({ jurisdictions: ['*'] }) }),
      ).allowed,
    ).toBe(true);
  });
});

describe('filterRoutesByPolicy', () => {
  const routes: readonly QuotedRouteOption[] = [
    quoted({ routeId: 'r1', totalCostBps: '20', providerId: 'sandbox-veridian-payments' }),
    quoted({
      routeId: 'r2',
      rank: 2,
      recommended: false,
      providerId: 'sandbox-veridian-payments',
      providerName: 'Veridian Payments',
      totalCostBps: '80',
    }),
  ];

  it('drops routes above the fee cap', () => {
    expect(filterRoutesByPolicy(policy, null, routes).map((route) => route.routeId)).toEqual(['r1']);
  });

  it('drops on-chain routes outside the allowed chains', () => {
    const mixed = [
      quoted({ routeId: 'fiat', chainId: null }),
      quoted({ routeId: 'polygon', chainId: 'eip155:137' }),
    ];
    expect(filterRoutesByPolicy(policy, null, mixed).map((route) => route.routeId)).toEqual(['fiat']);
  });
});
