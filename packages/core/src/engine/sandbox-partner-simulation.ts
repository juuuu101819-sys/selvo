import type {
  PartnerInstructionStatus,
  SandboxPartnerScenario,
} from '../ports/execution-partner.js';

export interface SandboxSimulationState {
  readonly status: PartnerInstructionStatus;
  readonly filledMinorUnits: string;
  readonly failureCode: string | null;
  readonly polls: number;
}

export function initialSandboxDispatch(input: {
  readonly scenario: SandboxPartnerScenario;
  readonly failDispatch: boolean;
  readonly amountMinorUnits: string;
}): SandboxSimulationState {
  if (input.failDispatch || input.scenario === 'fail') {
    return {
      status: 'failed',
      filledMinorUnits: '0',
      failureCode: input.failDispatch ? 'sandbox_partner_unavailable' : 'sandbox_simulated_failure',
      polls: 0,
    };
  }
  return {
    status: 'accepted',
    filledMinorUnits: '0',
    failureCode: null,
    polls: 0,
  };
}

/**
 * Deterministic sandbox clock: each status poll advances the mock partner's reported state.
 * Extra delay polls keep the instruction in `settling` (bank-FX settlement lag).
 */
export function advanceSandboxSimulation(input: {
  readonly state: SandboxSimulationState;
  readonly scenario: SandboxPartnerScenario;
  readonly extraDelayPolls: number;
  readonly amountMinorUnits: string;
}): SandboxSimulationState {
  const polls = input.state.polls + 1;
  if (input.state.status === 'failed' || input.state.status === 'settled') {
    return { ...input.state, polls };
  }
  if (input.state.status === 'partial') {
    return { ...input.state, polls };
  }
  if (input.scenario === 'webhook') {
    if (input.state.status === 'accepted') {
      return { status: 'settling', filledMinorUnits: '0', failureCode: null, polls };
    }
    return { ...input.state, polls };
  }
  if (input.state.status === 'accepted') {
    return { status: 'settling', filledMinorUnits: '0', failureCode: null, polls };
  }
  if (input.state.status === 'settling') {
    if (polls <= 1 + input.extraDelayPolls) {
      return { ...input.state, polls };
    }
    if (input.scenario === 'partial') {
      const half = halfMinorUnits(input.amountMinorUnits);
      return { status: 'partial', filledMinorUnits: half, failureCode: null, polls };
    }
    return {
      status: 'settled',
      filledMinorUnits: input.amountMinorUnits,
      failureCode: null,
      polls,
    };
  }
  return { ...input.state, polls };
}

export function applySandboxWebhook(input: {
  readonly state: SandboxSimulationState;
  readonly status: Extract<PartnerInstructionStatus, 'settling' | 'partial' | 'settled' | 'failed'>;
  readonly filledMinorUnits: string | null;
  readonly reasonCode: string | null;
  readonly amountMinorUnits: string;
}): SandboxSimulationState {
  const filled =
    input.filledMinorUnits ??
    (input.status === 'settled'
      ? input.amountMinorUnits
      : input.status === 'partial'
        ? halfMinorUnits(input.amountMinorUnits)
        : input.state.filledMinorUnits);
  return {
    status: input.status,
    filledMinorUnits: filled,
    failureCode: input.status === 'failed' ? (input.reasonCode ?? 'sandbox_webhook_failed') : null,
    polls: input.state.polls,
  };
}

function halfMinorUnits(amountMinorUnits: string): string {
  const asBig = BigInt(amountMinorUnits);
  return (asBig / 2n).toString();
}
