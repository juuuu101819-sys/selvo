import { describe, expect, it } from 'vitest';
import type { Merchant } from './agent-payments.js';
import {
  interpretNaturalLanguagePayment,
  parsePayInstruction,
  resolveMerchant,
  toStructuredNlPaymentIntent,
} from './payment-instruction.js';
import {
  NL_DID_NOT_COMPUTE,
  NL_INTERPRETER,
  weightsForOptimizationPreference,
} from './optimization-preference.js';

const merchantX: Merchant = {
  id: 'mrc_1',
  organizationId: 'org_1',
  name: 'Merchant X',
  recipientCode: 'merchant-x',
  settlementAsset: 'KRW',
  status: 'active',
  createdAt: '2026-03-01T09:00:00.000Z',
};

const merchantY: Merchant = {
  ...merchantX,
  id: 'mrc_2',
  name: 'Merchant Y',
  recipientCode: 'merchant-y',
};

describe('natural language intent parser', () => {
  it('turns "Pay 1,000 USD to this merchant using the cheapest compliant route." into a structured intent', () => {
    const parsed = interpretNaturalLanguagePayment(
      'Pay 1,000 USD to this merchant using the cheapest compliant route.',
      [merchantX],
    );
    expect(parsed.sourceAsset).toBe('USD');
    expect(parsed.destinationAsset).toBe('KRW');
    expect(parsed.recipientCode).toBe('merchant-x');
    expect(parsed.amountMinorUnits).toBe('100000');
    expect(parsed.amountDecimal).toBe('1000.00');
    expect(parsed.optimizationPreference).toBe('LOWEST_COST');
    expect(parsed.interpreter).toBe(NL_INTERPRETER);
    expect(parsed.aiUsed).toBe(false);

    const structured = toStructuredNlPaymentIntent(
      'Pay 1,000 USD to this merchant using the cheapest compliant route.',
      parsed,
    );
    expect(structured).toMatchObject({
      amount: { asset: 'USD', minorUnits: '100000', decimal: '1000.00', exponent: 2 },
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      recipient: 'merchant-x',
      optimizationPreference: 'LOWEST_COST',
      interpreter: 'deterministic_parser',
      aiUsed: false,
      financialsComputedBy: null,
      didNotCompute: ['exchange_rates', 'fees', 'slippage', 'settlement_amounts'],
    });
    expect(structured).not.toHaveProperty('exchangeRate');
    expect(structured).not.toHaveProperty('fee');
    expect(structured).not.toHaveProperty('slippage');
    expect(structured).not.toHaveProperty('settlementAmount');
    expect(NL_DID_NOT_COMPUTE).toEqual([
      'exchange_rates',
      'fees',
      'slippage',
      'settlement_amounts',
    ]);
  });

  it('still parses the Phase 14 sandbox instruction without a preference', () => {
    const parsed = parsePayInstruction('Pay 500 USD to merchant X', [merchantX]);
    expect(parsed).toMatchObject({
      sourceAsset: 'USD',
      amountMinorUnits: '50000',
      recipientCode: 'merchant-x',
      destinationAsset: 'KRW',
      optimizationPreference: null,
      aiUsed: false,
    });
  });

  it('accepts grouped thousands in the amount', () => {
    const parsed = parsePayInstruction('Pay 1,000 USD to merchant-x', [merchantX]);
    expect(parsed.amountMinorUnits).toBe('100000');
  });

  it.each([
    ['Pay 500 USD to merchant X using the cheapest route', 'LOWEST_COST'],
    ['Pay 500 USD to merchant X via the fastest path', 'FASTEST'],
    ['Pay 500 USD to merchant X using a balanced route', 'BALANCED'],
    ['Pay 500 USD to merchant X with the lowest slippage', 'LOWEST_SLIPPAGE'],
    ['Pay 500 USD to merchant X using the highest liquidity route', 'HIGH_LIQUIDITY'],
    ['Pay 500 USD to merchant X as soon as possible', 'FASTEST'],
    ['Pay 500 USD to merchant X, using the most liquid route', 'HIGH_LIQUIDITY'],
  ] as const)('reads %s as %s', (instruction, preference) => {
    expect(parsePayInstruction(instruction, [merchantX]).optimizationPreference).toBe(preference);
  });

  it('resolves "this merchant" only when exactly one active merchant exists', () => {
    expect(resolveMerchant('this merchant', [merchantX])?.recipientCode).toBe('merchant-x');
    expect(() => resolveMerchant('this merchant', [merchantX, merchantY])).toThrow(
      /ambiguous/,
    );
  });

  it('rejects an unknown merchant', () => {
    expect(() => parsePayInstruction('Pay 500 USD to nobody', [merchantX])).toThrow(
      /Unknown recipient/,
    );
  });

  it('rejects an instruction that is not a payment', () => {
    expect(() => parsePayInstruction('What is the USD KRW rate?', [merchantX])).toThrow(
      /Instruction must look like/,
    );
  });

  it('does not put engine weights on the parsed intent', () => {
    const parsed = parsePayInstruction(
      'Pay 1,000 USD to this merchant using the cheapest compliant route.',
      [merchantX],
    );
    expect(parsed).not.toHaveProperty('weights');
    expect(parsed).not.toHaveProperty('totalCostBps');
    expect(weightsForOptimizationPreference(parsed.optimizationPreference)).toEqual({
      cost: '1',
      speed: '0',
      liquidity: '0',
      reliability: '0',
      settlementConfidence: '0',
    });
  });
});
