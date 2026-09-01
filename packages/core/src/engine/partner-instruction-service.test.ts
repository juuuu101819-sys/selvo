import { describe, expect, it } from 'vitest';
import {
  ALWAYS_OPEN_HOURS,
  type ExecutionPartner,
  type PartnerDispatchResult,
  type PartnerExecutionContext,
  type SignedExecutionInstruction,
} from '../ports/execution-partner.js';
import {
  FixedClock,
  SequentialIdGenerator,
  noopLogger,
  type AuditEvent,
  type AuditEventInput,
  type AuditLogger,
} from '../ports/index.js';
import type { PartnerInstructionStore, StoredPartnerInstruction } from '../ports/execution-partner.js';
import { buildProviderDescriptor } from '../testing/index.js';
import { ExecutionPartnerRegistry } from './execution-partner-registry.js';
import { PartnerInstructionService } from './partner-instruction-service.js';
import {
  advanceSandboxSimulation,
  applySandboxWebhook,
  initialSandboxDispatch,
  type SandboxSimulationState,
} from './sandbox-partner-simulation.js';

class MemoryStore implements PartnerInstructionStore {
  private readonly byId = new Map<string, StoredPartnerInstruction>();

  save(row: StoredPartnerInstruction): Promise<StoredPartnerInstruction> {
    this.byId.set(row.id, row);
    return Promise.resolve(row);
  }

  update(row: StoredPartnerInstruction): Promise<StoredPartnerInstruction> {
    this.byId.set(row.id, row);
    return Promise.resolve(row);
  }

  findById(id: string, organizationId: string): Promise<StoredPartnerInstruction | null> {
    const found = this.byId.get(id);
    return Promise.resolve(found?.organizationId === organizationId ? found : null);
  }

  findByIdAnyTenant(id: string): Promise<StoredPartnerInstruction | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }
}

class RecordingAuditLogger implements AuditLogger {
  readonly events: AuditEvent[] = [];
  private sequence = 0;

  record(input: AuditEventInput): Promise<AuditEvent> {
    this.sequence += 1;
    const event: AuditEvent = {
      ...input,
      eventId: `evt_${this.sequence}`,
      occurredAt: '2026-03-01T09:00:00.000Z',
    };
    this.events.push(event);
    return Promise.resolve(event);
  }
}

class SimulatedPartner implements ExecutionPartner {
  readonly kind = 'sandbox_mock' as const;
  readonly descriptor;
  readonly capabilities;
  private readonly simulations = new Map<
    string,
    { instruction: SignedExecutionInstruction; state: SandboxSimulationState }
  >();

  constructor(
    partnerId: string,
    quotedProviderId: string,
    private readonly options: { readonly failDispatch?: boolean; readonly extraDelayPolls?: number } = {},
  ) {
    this.descriptor = buildProviderDescriptor({ id: partnerId, name: partnerId });
    this.capabilities = {
      partnerId,
      kind: 'sandbox_mock' as const,
      rail: 'bank_fx' as const,
      quotedProviderId,
      corridors: [{ source: 'USD', destination: 'KRW' }],
      currencies: ['USD', 'KRW'],
      minAmountMinorUnits: '0',
      maxAmountMinorUnits: '100000000000',
      maxAmountAsset: 'USD',
      operatingHours: ALWAYS_OPEN_HOURS,
      licenses: ['sandbox_mock'],
      sandbox: true,
      live: false,
    };
  }

  quote() {
    return Promise.reject(new Error('quote unused'));
  }

  dispatchInstruction(instruction: SignedExecutionInstruction, context: PartnerExecutionContext) {
    const state = initialSandboxDispatch({
      scenario: instruction.sandboxScenario,
      failDispatch: this.options.failDispatch === true,
      amountMinorUnits: instruction.amountMinorUnits,
    });
    this.simulations.set(context.executionRef, { instruction, state });
    return Promise.resolve(this.toResult(context.executionRef, state));
  }

  getExecutionStatus(ref: string) {
    const tracked = this.simulations.get(ref);
    if (tracked === undefined) {
      return Promise.resolve(
        this.toResult(ref, {
          status: 'failed',
          filledMinorUnits: '0',
          failureCode: 'unknown_execution_ref',
          polls: 0,
        }),
      );
    }
    tracked.state = advanceSandboxSimulation({
      state: tracked.state,
      scenario: tracked.instruction.sandboxScenario,
      extraDelayPolls: this.options.extraDelayPolls ?? 0,
      amountMinorUnits: tracked.instruction.amountMinorUnits,
    });
    return Promise.resolve(this.toResult(ref, tracked.state));
  }

  handleWebhook(event: { executionRef: string; status: 'settling' | 'partial' | 'settled' | 'failed'; filledMinorUnits: string | null; reasonCode: string | null }) {
    const tracked = this.simulations.get(event.executionRef);
    if (tracked === undefined) {
      return Promise.resolve(
        this.toResult(event.executionRef, {
          status: 'failed',
          filledMinorUnits: '0',
          failureCode: 'unknown_execution_ref',
          polls: 0,
        }),
      );
    }
    tracked.state = applySandboxWebhook({
      state: tracked.state,
      status: event.status,
      filledMinorUnits: event.filledMinorUnits,
      reasonCode: event.reasonCode,
      amountMinorUnits: tracked.instruction.amountMinorUnits,
    });
    return Promise.resolve(this.toResult(event.executionRef, tracked.state));
  }

  private toResult(executionRef: string, state: SandboxSimulationState): PartnerDispatchResult {
    return {
      executionRef,
      partnerId: this.capabilities.partnerId,
      status: state.status,
      filledMinorUnits: state.filledMinorUnits,
      failureCode: state.failureCode,
      fundsMoved: false,
      custody: false,
      meridianKeysUsed: false,
    };
  }
}

function instruction(scenario: SignedExecutionInstruction['sandboxScenario'] = 'settle'): SignedExecutionInstruction {
  return {
    quoteReference: 'q-1',
    sourceAsset: 'USD',
    destinationAsset: 'KRW',
    amountMinorUnits: '10000000',
    beneficiaryRef: 'merchant-x',
    signedAt: '2026-03-01T09:00:00.000Z',
    signature: 'caller-supplied-signature',
    sandboxScenario: scenario,
  };
}

describe('PartnerInstructionService', () => {
  it('walks dispatch → settling → settled and audits hashes without PII', async () => {
    const audit = new RecordingAuditLogger();
    const service = new PartnerInstructionService({
      registry: ExecutionPartnerRegistry.create(
        [new SimulatedPartner('sandbox-partner-psp-fx', 'sandbox-veridian-payments')],
        { liveEnabled: false },
      ),
      store: new MemoryStore(),
      clock: new FixedClock('2026-03-01T09:00:00.000Z'),
      ids: new SequentialIdGenerator(),
      auditLogger: audit,
      logger: noopLogger,
      liveEnabled: false,
      sandboxMode: true,
    });

    const dispatched = await service.dispatch({
      organizationId: 'org_demo',
      actor: 'tester',
      requestId: 'req_1',
      partnerId: 'sandbox-partner-psp-fx',
      instruction: instruction('settle'),
    });
    expect(dispatched).toMatchObject({
      status: 'accepted',
      fundsMoved: false,
      meridianKeysUsed: false,
      sandbox: true,
    });

    const settling = await service.status({
      id: dispatched.id,
      organizationId: 'org_demo',
      actor: 'tester',
      requestId: 'req_1',
    });
    expect(settling.status).toBe('settling');

    const settled = await service.status({
      id: dispatched.id,
      organizationId: 'org_demo',
      actor: 'tester',
      requestId: 'req_1',
    });
    expect(settled).toMatchObject({ status: 'settled', filledMinorUnits: '10000000' });

    expect(audit.events.map((event) => event.type)).toEqual([
      'partner.dispatched',
      'partner.status_changed',
      'partner.status_changed',
    ]);
    expect(audit.events[0]?.payload['instructionHash']).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(audit.events)).not.toContain('caller-supplied-signature');
    expect(JSON.stringify(audit.events)).not.toContain('merchant-x');
  });

  it('failovers to the next eligible partner when the first dispatch fails', async () => {
    const audit = new RecordingAuditLogger();
    const service = new PartnerInstructionService({
      registry: ExecutionPartnerRegistry.create(
        [
          new SimulatedPartner('down-partner', 'sandbox-northgate-bank', { failDispatch: true }),
          new SimulatedPartner('up-partner', 'sandbox-veridian-payments'),
        ],
        { liveEnabled: false },
      ),
      store: new MemoryStore(),
      clock: new FixedClock('2026-03-01T09:00:00.000Z'),
      ids: new SequentialIdGenerator(),
      auditLogger: audit,
      logger: noopLogger,
      liveEnabled: false,
      sandboxMode: true,
    });

    const dispatched = await service.dispatch({
      organizationId: 'org_demo',
      actor: 'tester',
      requestId: 'req_1',
      partnerId: null,
      instruction: instruction('settle'),
    });
    expect(dispatched.partnerId).toBe('up-partner');
    expect(dispatched.failoverFrom).toEqual(['down-partner']);
    expect(audit.events.map((event) => event.type)).toContain('partner.failed');
    expect(audit.events.map((event) => event.type)).toContain('partner.dispatched');
  });

  it('records a failed terminal status', async () => {
    const service = new PartnerInstructionService({
      registry: ExecutionPartnerRegistry.create(
        [new SimulatedPartner('sandbox-partner-psp-fx', 'sandbox-veridian-payments')],
        { liveEnabled: false },
      ),
      store: new MemoryStore(),
      clock: new FixedClock('2026-03-01T09:00:00.000Z'),
      ids: new SequentialIdGenerator(),
      auditLogger: new RecordingAuditLogger(),
      logger: noopLogger,
      liveEnabled: false,
      sandboxMode: true,
    });

    await expect(
      service.dispatch({
        organizationId: 'org_demo',
        actor: 'tester',
        requestId: 'req_1',
        partnerId: 'sandbox-partner-psp-fx',
        instruction: instruction('fail'),
      }),
    ).rejects.toThrow(/Every eligible execution partner rejected/);
  });
});
