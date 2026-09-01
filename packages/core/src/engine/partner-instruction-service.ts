import { ForbiddenError, NotFoundError, ValidationError } from '../errors/index.js';
import type { AuditLogger, Clock, IdGenerator, Logger } from '../ports/index.js';
import type {
  ExecutionPartner,
  PartnerInstructionStore,
  PartnerWebhookEvent,
  SignedExecutionInstruction,
  StoredPartnerInstruction,
} from '../ports/execution-partner.js';
import { hashExecutionInstruction, partnerSupportsRequest } from './partner-capability.js';
import type { ExecutionPartnerRegistry } from './execution-partner-registry.js';

export interface PartnerInstructionServiceDependencies {
  readonly registry: ExecutionPartnerRegistry;
  readonly store: PartnerInstructionStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly auditLogger: AuditLogger;
  readonly logger: Logger;
  readonly liveEnabled: boolean;
  readonly sandboxMode: boolean;
}

export interface DispatchPartnerInstructionCommand {
  readonly organizationId: string;
  readonly actor: string;
  readonly requestId: string;
  readonly partnerId: string | null;
  readonly instruction: SignedExecutionInstruction;
}

export interface PartnerCatalogEntry {
  readonly partnerId: string;
  readonly name: string;
  readonly kind: ExecutionPartner['kind'];
  readonly rail: ExecutionPartner['capabilities']['rail'];
  readonly quotedProviderId: string;
  readonly corridors: readonly { readonly source: string; readonly destination: string }[];
  readonly currencies: readonly string[];
  readonly minAmountMinorUnits: string;
  readonly maxAmountMinorUnits: string;
  readonly maxAmountAsset: string;
  readonly operatingHours: {
    readonly timezone: 'UTC';
    readonly daysOfWeek: readonly number[];
    readonly startUtcMinutes: number;
    readonly endUtcMinutes: number;
  };
  readonly licenses: readonly string[];
  readonly sandbox: true;
  readonly live: false;
  readonly fundsMoved: false;
  readonly meridianKeysUsed: false;
}

export interface PartnerInstructionPublic {
  readonly id: string;
  readonly organizationId: string;
  readonly partnerId: string;
  readonly quotedProviderId: string;
  readonly status: StoredPartnerInstruction['status'];
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly filledMinorUnits: string;
  readonly instructionHash: string;
  readonly failureCode: string | null;
  readonly failoverFrom: readonly string[];
  readonly fundsMoved: false;
  readonly custody: false;
  readonly meridianKeysUsed: false;
  readonly sandbox: true;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class PartnerInstructionService {
  constructor(private readonly deps: PartnerInstructionServiceDependencies) {}

  catalog(): readonly PartnerCatalogEntry[] {
    return this.deps.registry.all().map((partner) => ({
      partnerId: partner.capabilities.partnerId,
      name: partner.descriptor.name,
      kind: partner.kind,
      rail: partner.capabilities.rail,
      quotedProviderId: partner.capabilities.quotedProviderId,
      corridors: partner.capabilities.corridors.map((corridor) => ({ ...corridor })),
      currencies: [...partner.capabilities.currencies],
      minAmountMinorUnits: partner.capabilities.minAmountMinorUnits,
      maxAmountMinorUnits: partner.capabilities.maxAmountMinorUnits,
      maxAmountAsset: partner.capabilities.maxAmountAsset,
      operatingHours: { ...partner.capabilities.operatingHours, daysOfWeek: [...partner.capabilities.operatingHours.daysOfWeek] },
      licenses: [...partner.capabilities.licenses],
      sandbox: true as const,
      live: false as const,
      fundsMoved: false as const,
      meridianKeysUsed: false as const,
    }));
  }

  async dispatch(command: DispatchPartnerInstructionCommand): Promise<PartnerInstructionPublic> {
    this.assertSandboxDispatch();
    const atIso = this.deps.clock.nowIso();
    const match = {
      sourceAsset: command.instruction.sourceAsset,
      destinationAsset: command.instruction.destinationAsset,
      amountMinorUnits: command.instruction.amountMinorUnits,
      atIso,
    };
    const hashes = hashExecutionInstruction(command.instruction);
    const attempted: string[] = [];

    const candidates = this.candidates(command.partnerId, match);
    if (candidates.length === 0) {
      await this.deps.auditLogger.record({
        type: 'partner.failed',
        actor: command.actor,
        requestId: command.requestId,
        comparisonId: null,
        providerId: command.partnerId,
        organizationId: command.organizationId,
        payload: {
          reason: 'no_eligible_partner',
          instructionHash: hashes.instructionHash,
          sandbox: true,
          fundsMoved: false,
          custody: false,
          meridianKeysUsed: false,
        },
      });
      throw new ValidationError('No execution partner is eligible for this instruction.', {
        failClosed: true,
        reason: 'no_eligible_partner',
      });
    }

    let lastFailure: string | null = null;
    for (const partner of candidates) {
      this.assertNotLive(partner);
      attempted.push(partner.capabilities.partnerId);
      const executionRef = this.deps.ids.generate('pex');
      const context = {
        clock: this.deps.clock,
        logger: this.deps.logger.child({ partnerId: partner.capabilities.partnerId }),
        requestId: command.requestId,
        signal: undefined,
        organizationId: command.organizationId,
        executionRef,
        actor: command.actor,
      };
      const result = await partner.dispatchInstruction(command.instruction, context);
      if (result.status === 'failed') {
        lastFailure = result.failureCode;
        await this.deps.auditLogger.record({
          type: 'partner.failed',
          actor: command.actor,
          requestId: command.requestId,
          comparisonId: null,
          providerId: partner.capabilities.partnerId,
          organizationId: command.organizationId,
          payload: {
            executionRef,
            partnerId: partner.capabilities.partnerId,
            failureCode: result.failureCode,
            instructionHash: hashes.instructionHash,
            sandbox: true,
            fundsMoved: false,
            custody: false,
            meridianKeysUsed: false,
          },
        });
        continue;
      }

      const failoverFrom = attempted.slice(0, -1);
      const stored = await this.deps.store.save({
        id: executionRef,
        organizationId: command.organizationId,
        partnerId: partner.capabilities.partnerId,
        quotedProviderId: partner.capabilities.quotedProviderId,
        status: result.status,
        sourceAsset: command.instruction.sourceAsset,
        destinationAsset: command.instruction.destinationAsset,
        amountMinorUnits: command.instruction.amountMinorUnits,
        filledMinorUnits: result.filledMinorUnits,
        instructionHash: hashes.instructionHash,
        signatureHash: hashes.signatureHash,
        failureCode: result.failureCode,
        sandboxScenario: command.instruction.sandboxScenario,
        failoverFrom,
        fundsMoved: false,
        custody: false,
        meridianKeysUsed: false,
        sandbox: true,
        createdAt: atIso,
        updatedAt: atIso,
        metadata: {},
      });
      await this.deps.auditLogger.record({
        type: 'partner.dispatched',
        actor: command.actor,
        requestId: command.requestId,
        comparisonId: null,
        providerId: partner.capabilities.partnerId,
        organizationId: command.organizationId,
        payload: {
          executionRef,
          partnerId: partner.capabilities.partnerId,
          status: stored.status,
          instructionHash: hashes.instructionHash,
          failoverFrom: [...failoverFrom],
          sandbox: true,
          fundsMoved: false,
          custody: false,
          meridianKeysUsed: false,
        },
      });
      return toPublic(stored);
    }

    throw new ValidationError('Every eligible execution partner rejected the instruction.', {
      failClosed: true,
      reason: 'all_partners_failed',
      lastFailure,
      attempted,
    });
  }

  async status(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly actor: string;
    readonly requestId: string;
  }): Promise<PartnerInstructionPublic> {
    const stored = await this.deps.store.findById(input.id, input.organizationId);
    if (stored === null) {
      throw new NotFoundError('PartnerInstruction', input.id);
    }
    const partner = this.deps.registry.get(stored.partnerId);
    if (partner === null) {
      throw new NotFoundError('PartnerInstruction', input.id);
    }
    this.assertNotLive(partner);
    const previous = stored.status;
    const result = await partner.getExecutionStatus(stored.id, {
      clock: this.deps.clock,
      logger: this.deps.logger.child({ partnerId: partner.capabilities.partnerId }),
      requestId: input.requestId,
      signal: undefined,
      organizationId: stored.organizationId,
      executionRef: stored.id,
      actor: input.actor,
    });
    const updated = await this.deps.store.update({
      ...stored,
      status: result.status,
      filledMinorUnits: result.filledMinorUnits,
      failureCode: result.failureCode,
      updatedAt: this.deps.clock.nowIso(),
    });
    if (updated.status !== previous) {
      await this.recordStatusChanged(input, updated, previous, partner.capabilities.partnerId);
    }
    return toPublic(updated);
  }

  async webhook(input: {
    readonly partnerId: string;
    readonly event: PartnerWebhookEvent;
    readonly actor: string;
    readonly requestId: string;
  }): Promise<PartnerInstructionPublic> {
    const partner = this.deps.registry.get(input.partnerId);
    if (partner === null) {
      throw new NotFoundError('ExecutionPartner', input.partnerId);
    }
    this.assertNotLive(partner);
    const stored = await this.deps.store.findByIdAnyTenant(input.event.executionRef);
    if (stored === null || stored.partnerId !== input.partnerId) {
      throw new NotFoundError('PartnerInstruction', input.event.executionRef);
    }
    const previous = stored.status;
    const result = await partner.handleWebhook(input.event, {
      clock: this.deps.clock,
      logger: this.deps.logger.child({ partnerId: partner.capabilities.partnerId }),
      requestId: input.requestId,
      signal: undefined,
      organizationId: stored.organizationId,
      executionRef: stored.id,
      actor: input.actor,
    });
    const updated = await this.deps.store.update({
      ...stored,
      status: result.status,
      filledMinorUnits: result.filledMinorUnits,
      failureCode: result.failureCode,
      updatedAt: this.deps.clock.nowIso(),
    });
    if (updated.status !== previous) {
      await this.recordStatusChanged(
        { actor: input.actor, requestId: input.requestId, organizationId: stored.organizationId },
        updated,
        previous,
        partner.capabilities.partnerId,
      );
    }
    if (updated.status === 'failed') {
      await this.deps.auditLogger.record({
        type: 'partner.failed',
        actor: input.actor,
        requestId: input.requestId,
        comparisonId: null,
        providerId: partner.capabilities.partnerId,
        organizationId: stored.organizationId,
        payload: {
          executionRef: stored.id,
          partnerId: partner.capabilities.partnerId,
          failureCode: updated.failureCode,
          instructionHash: stored.instructionHash,
          sandbox: true,
          fundsMoved: false,
          custody: false,
          meridianKeysUsed: false,
        },
      });
    }
    return toPublic(updated);
  }

  private candidates(
    partnerId: string | null,
    match: {
      readonly sourceAsset: string;
      readonly destinationAsset: string;
      readonly amountMinorUnits: string;
      readonly atIso: string;
    },
  ): readonly ExecutionPartner[] {
    if (partnerId !== null) {
      const partner = this.deps.registry.get(partnerId);
      if (partner === null) {
        return [];
      }
      this.assertNotLive(partner);
      return partnerSupportsRequest(partner.capabilities, match) ? [partner] : [];
    }
    return this.deps.registry.eligible(match);
  }

  private assertSandboxDispatch(): void {
    if (!this.deps.sandboxMode) {
      throw new ForbiddenError('Execution-partner dispatch is sandbox-only.', {
        failClosed: true,
        reason: 'production_dispatch_disabled',
        flag: 'PARTNER_LIVE_ENABLED',
      });
    }
  }

  private assertNotLive(partner: ExecutionPartner): void {
    if (partner.kind === 'live' || partner.capabilities.live || partner.capabilities.kind === 'live') {
      throw new ForbiddenError('Live execution partners are disabled.', {
        failClosed: true,
        reason: 'live_disabled',
        flag: 'PARTNER_LIVE_ENABLED',
        partnerLiveEnabled: this.deps.liveEnabled,
        partnerId: partner.capabilities.partnerId,
      });
    }
  }

  private async recordStatusChanged(
    input: { readonly actor: string; readonly requestId: string; readonly organizationId: string },
    updated: StoredPartnerInstruction,
    previous: StoredPartnerInstruction['status'],
    partnerId: string,
  ): Promise<void> {
    await this.deps.auditLogger.record({
      type: 'partner.status_changed',
      actor: input.actor,
      requestId: input.requestId,
      comparisonId: null,
      providerId: partnerId,
      organizationId: input.organizationId,
      payload: {
        executionRef: updated.id,
        partnerId,
        from: previous,
        to: updated.status,
        instructionHash: updated.instructionHash,
        sandbox: true,
        fundsMoved: false,
        custody: false,
        meridianKeysUsed: false,
      },
    });
  }
}

function toPublic(row: StoredPartnerInstruction): PartnerInstructionPublic {
  return {
    id: row.id,
    organizationId: row.organizationId,
    partnerId: row.partnerId,
    quotedProviderId: row.quotedProviderId,
    status: row.status,
    sourceAsset: row.sourceAsset,
    destinationAsset: row.destinationAsset,
    amountMinorUnits: row.amountMinorUnits,
    filledMinorUnits: row.filledMinorUnits,
    instructionHash: row.instructionHash,
    failureCode: row.failureCode,
    failoverFrom: [...row.failoverFrom],
    fundsMoved: false,
    custody: false,
    meridianKeysUsed: false,
    sandbox: true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
