import {
  INSTRUCTION_VERIFICATION_STEPS,
  NotFoundError,
  PersistenceError,
  SETTLEMENT_INSTRUCTION_CANONICALIZATION,
  SETTLEMENT_INSTRUCTION_SIGNATURE_ALGORITHM,
  isBoundaryMode,
  isCustomerSignatureAlgorithm,
  type CustomerCounterSignature,
  type InstructionVenue,
  type ListCursor,
  type SettlementInstructionPayload,
  type SettlementInstructionStore,
  type SignedSettlementInstruction,
} from '@meridian/core';
import type { Prisma, PrismaClient } from '@prisma/client';

type Row = Prisma.SettlementInstructionGetPayload<Record<string, never>>;

const DEFAULT_LIST_LIMIT = 50;

/**
 * PostgreSQL settlement instructions.
 *
 * The canonical payload is stored as the exact bytes that were signed and re-parsed on read rather
 * than rebuilt from columns. Rebuilding would let a schema change silently alter what a stored
 * signature covers, so an artifact issued last month would stop verifying for reasons that have
 * nothing to do with tampering. The columns alongside it exist for querying, not for reconstruction.
 */
export class PrismaSettlementInstructionStore implements SettlementInstructionStore {
  constructor(
    private readonly client: PrismaClient,
    private readonly jwksUri: string,
  ) {}

  async create(instruction: SignedSettlementInstruction): Promise<SignedSettlementInstruction> {
    try {
      const row = await this.client.settlementInstruction.create({
        data: {
          id: instruction.id,
          organizationId: instruction.organizationId,
          executionIntentId: instruction.executionIntentId,
          routingId: instruction.payload.route.routingId,
          routeId: instruction.payload.route.routeId,
          boundaryMode: instruction.payload.boundaryMode,
          originEnv: instruction.payload.originEnv,
          payloadCanonical: instruction.payloadCanonical,
          payloadHash: instruction.payloadHash,
          signature: instruction.signature,
          signingKeyId: instruction.verification.keyId,
          expiresAt: new Date(instruction.expiresAt),
          createdAt: new Date(instruction.createdAt),
        },
      });
      return this.fromRow(row, instruction.verification.publicKeyPem, instruction.eligibleVenues);
    } catch (error) {
      throw new PersistenceError(
        'Failed to store the settlement instruction.',
        { instructionId: instruction.id },
        { cause: error },
      );
    }
  }

  async findById(id: string, organizationId: string): Promise<SignedSettlementInstruction | null> {
    try {
      const row = await this.client.settlementInstruction.findFirst({
        where: { id, organizationId },
      });
      return row === null ? null : this.fromRow(row, null, []);
    } catch (error) {
      throw new PersistenceError(
        'Failed to load the settlement instruction.',
        { instructionId: id },
        { cause: error },
      );
    }
  }

  async listByOrganization(
    organizationId: string,
    options: { readonly limit?: number; readonly after?: ListCursor } = {},
  ): Promise<readonly SignedSettlementInstruction[]> {
    const limit = options.limit ?? DEFAULT_LIST_LIMIT;
    try {
      const rows = await this.client.settlementInstruction.findMany({
        where: {
          organizationId,
          ...(options.after === undefined
            ? {}
            : {
                OR: [
                  { createdAt: { lt: new Date(options.after.sortAt) } },
                  {
                    createdAt: new Date(options.after.sortAt),
                    id: { lt: options.after.id },
                  },
                ],
              }),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      return rows.map((row) => this.fromRow(row, null, []));
    } catch (error) {
      throw new PersistenceError(
        'Failed to list settlement instructions.',
        { organizationId },
        { cause: error },
      );
    }
  }

  /**
   * Attach the customer's counter-signature.
   *
   * Writes four columns and nothing else. The `updateMany` guard means a row that already carries a
   * signature is not overwritten: a second signature would leave no record of which one the
   * customer actually applied.
   */
  async attachCustomerSignature(
    id: string,
    organizationId: string,
    signature: CustomerCounterSignature,
  ): Promise<SignedSettlementInstruction> {
    try {
      const updated = await this.client.settlementInstruction.updateMany({
        where: { id, organizationId, customerSignature: null },
        data: {
          customerSignature: signature.signature,
          customerSignatureAlgorithm: signature.algorithm,
          customerKeyId: signature.keyId,
          customerSignedAt: new Date(signature.signedAt),
        },
      });
      if (updated.count === 0) {
        throw new NotFoundError('SettlementInstruction', id);
      }
      const row = await this.client.settlementInstruction.findFirst({
        where: { id, organizationId },
      });
      if (row === null) {
        throw new NotFoundError('SettlementInstruction', id);
      }
      return this.fromRow(row, null, []);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw new PersistenceError(
        'Failed to attach the customer signature.',
        { instructionId: id },
        { cause: error },
      );
    }
  }

  private fromRow(
    row: Row,
    publicKeyPem: string | null,
    eligibleVenues: readonly InstructionVenue[],
  ): SignedSettlementInstruction {
    return {
      id: row.id,
      organizationId: row.organizationId,
      executionIntentId: row.executionIntentId,
      payload: parsePayload(row),
      payloadCanonical: row.payloadCanonical,
      payloadHash: row.payloadHash,
      signature: row.signature,
      verification: {
        algorithm: SETTLEMENT_INSTRUCTION_SIGNATURE_ALGORITHM,
        canonicalization: SETTLEMENT_INSTRUCTION_CANONICALIZATION,
        keyId: row.signingKeyId,
        // Absent on a read path: the caller resolves the key from the published JWKS by `keyId`,
        // which is the same lookup an external verifier performs.
        publicKeyPem: publicKeyPem ?? '',
        jwksUri: this.jwksUri,
        privateKeyExported: false,
      },
      customerSignature: customerSignatureFrom(row),
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      eligibleVenues,
      nextSteps: [...INSTRUCTION_VERIFICATION_STEPS],
    };
  }
}

function customerSignatureFrom(row: Row): CustomerCounterSignature | null {
  if (
    row.customerSignature === null ||
    row.customerSignatureAlgorithm === null ||
    row.customerKeyId === null ||
    row.customerSignedAt === null
  ) {
    return null;
  }
  if (!isCustomerSignatureAlgorithm(row.customerSignatureAlgorithm)) {
    throw new PersistenceError('Stored customer signature names an unknown algorithm.', {
      instructionId: row.id,
      algorithm: row.customerSignatureAlgorithm,
    });
  }
  return {
    algorithm: row.customerSignatureAlgorithm,
    signature: row.customerSignature,
    keyId: row.customerKeyId,
    signedAt: row.customerSignedAt.toISOString(),
    triggeredDispatch: false,
  };
}

/**
 * Re-read the signed bytes.
 *
 * Parsed from `payload_canonical`, never rebuilt from the sibling columns, so what a verifier is
 * handed is exactly what was signed. The boundary-mode check is a storage-level assertion: the
 * CHECK constraint already refuses anything else, so a failure here means the row was written by
 * something that bypassed both.
 */
function parsePayload(row: Row): SettlementInstructionPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payloadCanonical);
  } catch (error) {
    throw new PersistenceError(
      'Stored settlement instruction payload is not valid JSON.',
      { instructionId: row.id },
      { cause: error },
    );
  }
  const payload = parsed as SettlementInstructionPayload;
  if (!isBoundaryMode(payload.boundaryMode)) {
    throw new PersistenceError('Stored settlement instruction has an unknown boundary mode.', {
      instructionId: row.id,
      boundaryMode: String(payload.boundaryMode),
    });
  }
  return payload;
}
