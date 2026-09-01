import {
  IdempotencyConflictError,
  PersistenceError,
  isOrchestratedExecutionStatus,
  type OrchestratedExecution,
  type OrchestratedExecutionStatus,
  type OrchestratedExecutionStore,
} from '@meridian/core';
import { Prisma, type PrismaClient } from '@prisma/client';

export class PrismaOrchestratedExecutionStore implements OrchestratedExecutionStore {
  constructor(private readonly client: PrismaClient) {}

  async save(row: OrchestratedExecution): Promise<OrchestratedExecution> {
    try {
      const stored = await this.client.orchestratedExecution.create({ data: toData(row) });
      return fromRow(stored);
    } catch (error) {
      if (isUniqueViolation(error, 'organization_id', 'idempotency_key') && row.idempotencyKey !== null) {
        throw new IdempotencyConflictError(row.idempotencyKey);
      }
      throw new PersistenceError('Failed to store orchestrated execution.', {}, { cause: error });
    }
  }

  async update(row: OrchestratedExecution): Promise<OrchestratedExecution> {
    try {
      const stored = await this.client.orchestratedExecution.update({
        where: { id: row.id },
        data: {
          partnerId: row.partnerId,
          partnerInstructionId: row.partnerInstructionId,
          status: row.status,
          filledMinorUnits: new Prisma.Decimal(row.filledMinorUnits),
          failureCode: row.failureCode,
          blockedReason: row.blockedReason,
          dailyLimitReserved: row.dailyLimitReserved,
          instructionHash: row.instructionHash,
          signatureHash: row.signatureHash,
          instructionSignatureKind: row.instructionSignatureKind,
          failoverFrom: [...row.failoverFrom],
          monetizationEventId: row.monetizationEventId,
          quotedAt: row.quotedAt === null ? null : new Date(row.quotedAt),
          dispatchedAt: row.dispatchedAt === null ? null : new Date(row.dispatchedAt),
          settledAt: row.settledAt === null ? null : new Date(row.settledAt),
          receiptId: row.receiptId,
        },
      });
      return fromRow(stored);
    } catch (error) {
      throw new PersistenceError('Failed to update orchestrated execution.', {}, { cause: error });
    }
  }

  async findById(id: string, organizationId: string): Promise<OrchestratedExecution | null> {
    try {
      const row = await this.client.orchestratedExecution.findFirst({ where: { id, organizationId } });
      return row === null ? null : fromRow(row);
    } catch (error) {
      throw new PersistenceError('Failed to load orchestrated execution.', {}, { cause: error });
    }
  }

  async findByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<OrchestratedExecution | null> {
    try {
      const row = await this.client.orchestratedExecution.findFirst({
        where: { organizationId, idempotencyKey },
      });
      return row === null ? null : fromRow(row);
    } catch (error) {
      throw new PersistenceError('Failed to load orchestrated execution by idempotency key.', {}, {
        cause: error,
      });
    }
  }

  async listByOrganization(organizationId: string): Promise<readonly OrchestratedExecution[]> {
    try {
      const rows = await this.client.orchestratedExecution.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(fromRow);
    } catch (error) {
      throw new PersistenceError('Failed to list orchestrated executions.', {}, { cause: error });
    }
  }

  async sumReservedDaily(query: {
    readonly organizationId: string;
    readonly agentId: string;
    readonly asset: string;
    readonly fromInclusive: string;
    readonly toExclusive: string;
    readonly statuses: readonly OrchestratedExecutionStatus[];
    readonly excludeId?: string;
  }): Promise<string> {
    try {
      const aggregate = await this.client.orchestratedExecution.aggregate({
        where: {
          organizationId: query.organizationId,
          agentId: query.agentId,
          sourceAsset: query.asset,
          dailyLimitReserved: true,
          status: { in: [...query.statuses] },
          createdAt: {
            gte: new Date(query.fromInclusive),
            lt: new Date(query.toExclusive),
          },
          ...(query.excludeId === undefined ? {} : { id: { not: query.excludeId } }),
        },
        _sum: { amountMinorUnits: true },
      });
      return aggregate._sum.amountMinorUnits?.toFixed(0) ?? '0';
    } catch (error) {
      throw new PersistenceError('Failed to sum reserved orchestrated executions.', {}, { cause: error });
    }
  }
}

function toData(row: OrchestratedExecution): Prisma.OrchestratedExecutionUncheckedCreateInput {
  return {
    id: row.id,
    organizationId: row.organizationId,
    agentId: row.agentId,
    mandateId: row.mandateId,
    routingId: row.routingId,
    routeId: row.routeId,
    partnerId: row.partnerId,
    partnerInstructionId: row.partnerInstructionId,
    status: row.status,
    sourceAsset: row.sourceAsset,
    destinationAsset: row.destinationAsset,
    amountMinorUnits: new Prisma.Decimal(row.amountMinorUnits),
    filledMinorUnits: new Prisma.Decimal(row.filledMinorUnits),
    quoteExpiresAt: row.quoteExpiresAt === null ? null : new Date(row.quoteExpiresAt),
    quotedAt: row.quotedAt === null ? null : new Date(row.quotedAt),
    dispatchedAt: row.dispatchedAt === null ? null : new Date(row.dispatchedAt),
    settledAt: row.settledAt === null ? null : new Date(row.settledAt),
    receiptId: row.receiptId,
    beneficiaryRef: row.beneficiaryRef,
    idempotencyKey: row.idempotencyKey,
    payloadFingerprint: row.payloadFingerprint,
    failureCode: row.failureCode,
    blockedReason: row.blockedReason,
    dailyLimitReserved: row.dailyLimitReserved,
    instructionHash: row.instructionHash,
    signatureHash: row.signatureHash,
    instructionSignatureKind: row.instructionSignatureKind,
    transferSigned: false,
    fundsMoved: false,
    custody: false,
    meridianKeysUsed: false,
    sandbox: true,
    failoverFrom: [...row.failoverFrom],
    monetizationEventId: row.monetizationEventId,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function fromRow(row: {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly mandateId: string;
  readonly routingId: string;
  readonly routeId: string;
  readonly partnerId: string | null;
  readonly partnerInstructionId: string | null;
  readonly status: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: Prisma.Decimal;
  readonly filledMinorUnits: Prisma.Decimal;
  readonly quoteExpiresAt: Date | null;
  readonly quotedAt: Date | null;
  readonly dispatchedAt: Date | null;
  readonly settledAt: Date | null;
  readonly receiptId: string | null;
  readonly beneficiaryRef: string;
  readonly idempotencyKey: string | null;
  readonly payloadFingerprint: string;
  readonly failureCode: string | null;
  readonly blockedReason: string | null;
  readonly dailyLimitReserved: boolean;
  readonly instructionHash: string | null;
  readonly signatureHash: string | null;
  readonly instructionSignatureKind: string | null;
  readonly transferSigned: boolean;
  readonly fundsMoved: boolean;
  readonly custody: boolean;
  readonly meridianKeysUsed: boolean;
  readonly sandbox: boolean;
  readonly failoverFrom: readonly string[];
  readonly monetizationEventId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}): OrchestratedExecution {
  if (!isOrchestratedExecutionStatus(row.status)) {
    throw new PersistenceError('Unknown orchestrated execution status.', { status: row.status });
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    agentId: row.agentId,
    mandateId: row.mandateId,
    routingId: row.routingId,
    routeId: row.routeId,
    partnerId: row.partnerId,
    partnerInstructionId: row.partnerInstructionId,
    status: row.status,
    sourceAsset: row.sourceAsset,
    destinationAsset: row.destinationAsset,
    amountMinorUnits: row.amountMinorUnits.toFixed(0),
    filledMinorUnits: row.filledMinorUnits.toFixed(0),
    quoteExpiresAt: row.quoteExpiresAt?.toISOString() ?? null,
    quotedAt: row.quotedAt?.toISOString() ?? null,
    dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
    settledAt: row.settledAt?.toISOString() ?? null,
    receiptId: row.receiptId,
    beneficiaryRef: row.beneficiaryRef,
    idempotencyKey: row.idempotencyKey,
    payloadFingerprint: row.payloadFingerprint,
    failureCode: row.failureCode,
    blockedReason: row.blockedReason,
    dailyLimitReserved: row.dailyLimitReserved,
    instructionHash: row.instructionHash,
    signatureHash: row.signatureHash,
    instructionSignatureKind:
      row.instructionSignatureKind === 'partner_credential_hmac' ? 'partner_credential_hmac' : null,
    transferSigned: false,
    fundsMoved: false,
    custody: false,
    meridianKeysUsed: false,
    sandbox: true,
    failoverFrom: [...row.failoverFrom],
    monetizationEventId: row.monetizationEventId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown, ...fields: string[]): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const prismaError = error as { code?: string; meta?: { target?: string[] } };
  if (prismaError.code !== 'P2002') {
    return false;
  }
  const target = prismaError.meta?.target ?? [];
  return fields.every((field) => target.includes(field));
}
