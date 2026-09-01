import {
  PersistenceError,
  type ExecutionReceiptPayload,
  type VerifiableExecutionReceipt,
  type ExecutionReceiptStore,
  RECEIPT_CANONICALIZATION,
  RECEIPT_SIGNATURE_ALGORITHM,
  RECEIPT_VAULT_KEY_NAME,
  RECEIPT_VAULT_PROVIDER_ID,
} from '@meridian/core';
import type { PrismaClient } from '@prisma/client';

export class PrismaExecutionReceiptStore implements ExecutionReceiptStore {
  constructor(private readonly client: PrismaClient) {}

  async save(row: VerifiableExecutionReceipt): Promise<VerifiableExecutionReceipt> {
    try {
      const stored = await this.client.executionReceipt.create({
        data: {
          id: row.id,
          organizationId: row.organizationId,
          executionId: row.executionId,
          payloadCanonical: row.payloadCanonical,
          payloadHash: row.payloadHash,
          signature: row.signature,
          publicKeyPem: row.verification.publicKeyPem,
          publicKeyFingerprint: row.verification.publicKeyFingerprint,
          fundsMoved: false,
          custody: false,
          meridianKeysUsed: false,
          sandbox: true,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.createdAt),
        },
      });
      return fromRow(stored);
    } catch (error) {
      throw new PersistenceError('Failed to store execution receipt.', {}, { cause: error });
    }
  }

  async findById(id: string, organizationId: string): Promise<VerifiableExecutionReceipt | null> {
    try {
      const row = await this.client.executionReceipt.findFirst({ where: { id, organizationId } });
      return row === null ? null : fromRow(row);
    } catch (error) {
      throw new PersistenceError('Failed to load execution receipt.', {}, { cause: error });
    }
  }

  async findByExecutionId(
    executionId: string,
    organizationId: string,
  ): Promise<VerifiableExecutionReceipt | null> {
    try {
      const row = await this.client.executionReceipt.findFirst({
        where: { executionId, organizationId },
      });
      return row === null ? null : fromRow(row);
    } catch (error) {
      throw new PersistenceError('Failed to load execution receipt by execution id.', {}, {
        cause: error,
      });
    }
  }
}

function fromRow(row: {
  readonly id: string;
  readonly organizationId: string;
  readonly executionId: string;
  readonly payloadCanonical: string;
  readonly payloadHash: string;
  readonly signature: string;
  readonly publicKeyPem: string;
  readonly publicKeyFingerprint: string;
  readonly createdAt: Date;
}): VerifiableExecutionReceipt {
  const parsed = JSON.parse(row.payloadCanonical) as ExecutionReceiptPayload;
  return {
    id: row.id,
    organizationId: row.organizationId,
    executionId: row.executionId,
    payload: parsed,
    payloadCanonical: row.payloadCanonical,
    payloadHash: row.payloadHash,
    signature: row.signature,
    verification: {
      method: RECEIPT_SIGNATURE_ALGORITHM,
      canonicalization: RECEIPT_CANONICALIZATION,
      publicKeyPem: row.publicKeyPem,
      publicKeyFingerprint: row.publicKeyFingerprint,
      vaultProviderId: RECEIPT_VAULT_PROVIDER_ID,
      vaultKeyName: RECEIPT_VAULT_KEY_NAME,
      privateKeyExported: false,
    },
    fundsMoved: false,
    custody: false,
    meridianKeysUsed: false,
    sandbox: true,
    createdAt: row.createdAt.toISOString(),
  };
}
