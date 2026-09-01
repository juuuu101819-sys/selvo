import {
  PersistenceError,
  isPartnerInstructionStatus,
  isSandboxPartnerScenario,
  type PartnerInstructionStore,
  type StoredPartnerInstruction,
} from '@meridian/core';
import { Prisma, type PrismaClient } from '@prisma/client';

export class PrismaPartnerInstructionStore implements PartnerInstructionStore {
  constructor(private readonly client: PrismaClient) {}

  async save(row: StoredPartnerInstruction): Promise<StoredPartnerInstruction> {
    try {
      const stored = await this.client.partnerInstruction.create({ data: toData(row) });
      return fromRow(stored);
    } catch (error) {
      throw new PersistenceError('Failed to store partner instruction.', {}, { cause: error });
    }
  }

  async update(row: StoredPartnerInstruction): Promise<StoredPartnerInstruction> {
    try {
      const stored = await this.client.partnerInstruction.update({
        where: { id: row.id },
        data: {
          status: row.status,
          filledMinorUnits: new Prisma.Decimal(row.filledMinorUnits),
          failureCode: row.failureCode,
          failoverFrom: [...row.failoverFrom],
        },
      });
      return fromRow(stored);
    } catch (error) {
      throw new PersistenceError('Failed to update partner instruction.', {}, { cause: error });
    }
  }

  async findById(id: string, organizationId: string): Promise<StoredPartnerInstruction | null> {
    try {
      const row = await this.client.partnerInstruction.findFirst({ where: { id, organizationId } });
      return row === null ? null : fromRow(row);
    } catch (error) {
      throw new PersistenceError('Failed to load partner instruction.', {}, { cause: error });
    }
  }

  async findByIdAnyTenant(id: string): Promise<StoredPartnerInstruction | null> {
    try {
      const row = await this.client.partnerInstruction.findUnique({ where: { id } });
      return row === null ? null : fromRow(row);
    } catch (error) {
      throw new PersistenceError('Failed to load partner instruction.', {}, { cause: error });
    }
  }
}

function toData(row: StoredPartnerInstruction): Prisma.PartnerInstructionUncheckedCreateInput {
  return {
    id: row.id,
    organizationId: row.organizationId,
    partnerId: row.partnerId,
    quotedProviderId: row.quotedProviderId,
    status: row.status,
    sourceAsset: row.sourceAsset,
    destinationAsset: row.destinationAsset,
    amountMinorUnits: new Prisma.Decimal(row.amountMinorUnits),
    filledMinorUnits: new Prisma.Decimal(row.filledMinorUnits),
    instructionHash: row.instructionHash,
    signatureHash: row.signatureHash,
    failureCode: row.failureCode,
    sandboxScenario: row.sandboxScenario,
    failoverFrom: [...row.failoverFrom],
    createdAt: new Date(row.createdAt),
  };
}

function fromRow(row: {
  readonly id: string;
  readonly organizationId: string;
  readonly partnerId: string;
  readonly quotedProviderId: string;
  readonly status: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: Prisma.Decimal;
  readonly filledMinorUnits: Prisma.Decimal;
  readonly instructionHash: string;
  readonly signatureHash: string;
  readonly failureCode: string | null;
  readonly sandboxScenario: string;
  readonly failoverFrom: string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}): StoredPartnerInstruction {
  if (!isPartnerInstructionStatus(row.status) || !isSandboxPartnerScenario(row.sandboxScenario)) {
    throw new PersistenceError('Stored partner instruction has an unknown status or scenario.', {
      status: row.status,
      sandboxScenario: row.sandboxScenario,
    });
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    partnerId: row.partnerId,
    quotedProviderId: row.quotedProviderId,
    status: row.status,
    sourceAsset: row.sourceAsset,
    destinationAsset: row.destinationAsset,
    amountMinorUnits: row.amountMinorUnits.toFixed(0),
    filledMinorUnits: row.filledMinorUnits.toFixed(0),
    instructionHash: row.instructionHash,
    signatureHash: row.signatureHash,
    failureCode: row.failureCode,
    sandboxScenario: row.sandboxScenario,
    failoverFrom: row.failoverFrom,
    fundsMoved: false,
    custody: false,
    meridianKeysUsed: false,
    sandbox: true,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    metadata: {},
  };
}
