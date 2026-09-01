import { describe, expect, it } from 'vitest';
import {
  advanceSandboxSimulation,
  applySandboxWebhook,
  initialSandboxDispatch,
} from './sandbox-partner-simulation.js';

describe('sandbox partner simulation', () => {
  it('starts accepted and walks settle through settling to settled', () => {
    const accepted = initialSandboxDispatch({
      scenario: 'settle',
      failDispatch: false,
      amountMinorUnits: '100',
    });
    expect(accepted.status).toBe('accepted');
    const settling = advanceSandboxSimulation({
      state: accepted,
      scenario: 'settle',
      extraDelayPolls: 0,
      amountMinorUnits: '100',
    });
    expect(settling.status).toBe('settling');
    const settled = advanceSandboxSimulation({
      state: settling,
      scenario: 'settle',
      extraDelayPolls: 0,
      amountMinorUnits: '100',
    });
    expect(settled).toMatchObject({ status: 'settled', filledMinorUnits: '100', failureCode: null });
  });

  it('keeps bank-FX in settling for extra delay polls', () => {
    let state = initialSandboxDispatch({
      scenario: 'settle',
      failDispatch: false,
      amountMinorUnits: '100',
    });
    state = advanceSandboxSimulation({
      state,
      scenario: 'settle',
      extraDelayPolls: 1,
      amountMinorUnits: '100',
    });
    expect(state.status).toBe('settling');
    state = advanceSandboxSimulation({
      state,
      scenario: 'settle',
      extraDelayPolls: 1,
      amountMinorUnits: '100',
    });
    expect(state.status).toBe('settling');
    state = advanceSandboxSimulation({
      state,
      scenario: 'settle',
      extraDelayPolls: 1,
      amountMinorUnits: '100',
    });
    expect(state.status).toBe('settled');
  });

  it('simulates a partial fill', () => {
    let state = initialSandboxDispatch({
      scenario: 'partial',
      failDispatch: false,
      amountMinorUnits: '100',
    });
    state = advanceSandboxSimulation({
      state,
      scenario: 'partial',
      extraDelayPolls: 0,
      amountMinorUnits: '100',
    });
    state = advanceSandboxSimulation({
      state,
      scenario: 'partial',
      extraDelayPolls: 0,
      amountMinorUnits: '100',
    });
    expect(state).toMatchObject({ status: 'partial', filledMinorUnits: '50' });
  });

  it('fails immediately on the fail scenario', () => {
    expect(
      initialSandboxDispatch({
        scenario: 'fail',
        failDispatch: false,
        amountMinorUnits: '100',
      }).status,
    ).toBe('failed');
  });

  it('holds webhook scenarios in settling until a callback', () => {
    let state = initialSandboxDispatch({
      scenario: 'webhook',
      failDispatch: false,
      amountMinorUnits: '100',
    });
    state = advanceSandboxSimulation({
      state,
      scenario: 'webhook',
      extraDelayPolls: 0,
      amountMinorUnits: '100',
    });
    expect(state.status).toBe('settling');
    state = advanceSandboxSimulation({
      state,
      scenario: 'webhook',
      extraDelayPolls: 0,
      amountMinorUnits: '100',
    });
    expect(state.status).toBe('settling');
    const settled = applySandboxWebhook({
      state,
      status: 'settled',
      filledMinorUnits: '100',
      reasonCode: null,
      amountMinorUnits: '100',
    });
    expect(settled.status).toBe('settled');
  });
});
