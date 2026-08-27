import { describe, expect, it } from 'vitest';
import { SequentialIdGenerator } from '../ports/id-generator.js';
import { FixedClock } from '../ports/clock.js';
import { SANDBOX_SIMULATION_RECEIPT, simulateSandboxExecution } from '../engine/sandbox-simulator.js';
import { PLATFORM_CAPABILITIES } from './capabilities.js';
import { INTERACTION_MODELS } from './actor.js';
import { paymentIntentFingerprint } from './agent-payments.js';

describe('sandbox simulator', () => {
  it('records a simulated receipt and never claims funds moved', () => {
    const receipt = simulateSandboxExecution({
      clock: new FixedClock('2026-03-01T09:00:00.000Z'),
      ids: new SequentialIdGenerator(),
      selectedProviderId: 'sandbox-veridian-payments',
    });
    expect(receipt.simulated).toBe(true);
    expect(receipt.fundsMoved).toBe(false);
    expect(receipt.custody).toBe(false);
    expect(receipt.realExecution).toBe(false);
    expect(receipt.receipt).toBe(SANDBOX_SIMULATION_RECEIPT);
    expect(receipt.simulationId).toBe('sim_00000001');
  });
});

describe('payment intent fingerprint', () => {
  it('is stable for identical payloads', () => {
    const payload = {
      agentId: 'agt_1',
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amountMinorUnits: '50000',
      recipient: 'merchant-x',
      purpose: 'invoice',
      routePreference: 'lowest_cost' as const,
      maxFeeBps: '40',
      expiresAt: '2026-03-01T10:00:00.000Z',
    };
    expect(paymentIntentFingerprint(payload)).toBe(paymentIntentFingerprint(payload));
  });
});

describe('Phase 14 capabilities', () => {
  it('enables agent payment infrastructure without turning on real execution or custody', () => {
    expect(PLATFORM_CAPABILITIES.agentPayments).toBe(true);
    expect(PLATFORM_CAPABILITIES.agentPaymentSimulation).toBe(true);
    expect(PLATFORM_CAPABILITIES.executeTransactions).toBe(false);
    expect(PLATFORM_CAPABILITIES.custodyFunds).toBe(false);
    expect(PLATFORM_CAPABILITIES.holdPrivateKeys).toBe(false);
    expect(PLATFORM_CAPABILITIES.controlCustomerWallets).toBe(false);
    expect(PLATFORM_CAPABILITIES.operateAsPrincipal).toBe(false);
    expect(INTERACTION_MODELS.find((model) => model.id === 'agent_business')?.status).toBe(
      'available',
    );
  });
});
