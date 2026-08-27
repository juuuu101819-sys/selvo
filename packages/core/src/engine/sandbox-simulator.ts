import type { SimulatedExecutionReceipt } from '../domain/agent-payments.js';
import type { Clock, IdGenerator } from '../ports/index.js';

export const SANDBOX_SIMULATOR_PROVIDER_ID = 'sandbox-demo-simulator';

export const SANDBOX_SIMULATION_RECEIPT =
  'Sandbox simulation only. No funds moved. Meridian does not custody the agent wallet, hold keys, or execute as principal.';

/**
 * In-process demo provider. It never calls an external network, never submits a payment, and
 * always records `fundsMoved: false`.
 */
export function simulateSandboxExecution(input: {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly selectedProviderId: string;
}): SimulatedExecutionReceipt {
  return {
    simulationId: input.ids.generate('sim'),
    simulated: true,
    fundsMoved: false,
    custody: false,
    realExecution: false,
    providerId: input.selectedProviderId,
    occurredAt: input.clock.nowIso(),
    receipt: SANDBOX_SIMULATION_RECEIPT,
  };
}
