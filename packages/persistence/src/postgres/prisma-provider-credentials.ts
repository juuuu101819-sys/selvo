import { PersistenceError, type ProviderCredentialStore, type StoredProviderCredential } from '@meridian/core';
import type { PrismaClient } from '@prisma/client';

export class PrismaProviderCredentialStore implements ProviderCredentialStore {
  constructor(private readonly client: PrismaClient) {}

  async put(input: {
    readonly id: string;
    readonly providerId: string;
    readonly keyName: string;
    readonly ciphertext: string;
    readonly nowIso: string;
  }): Promise<StoredProviderCredential> {
    try {
      const row = await this.client.providerCredential.upsert({
        where: {
          providerId_keyName: { providerId: input.providerId, keyName: input.keyName },
        },
        create: {
          id: input.id,
          providerId: input.providerId,
          keyName: input.keyName,
          ciphertext: input.ciphertext,
          createdAt: new Date(input.nowIso),
          updatedAt: new Date(input.nowIso),
        },
        update: {
          ciphertext: input.ciphertext,
          updatedAt: new Date(input.nowIso),
        },
      });
      return toStored(row);
    } catch (error) {
      throw new PersistenceError('Failed to store provider credential ciphertext.', {}, { cause: error });
    }
  }

  async getCiphertext(providerId: string, keyName: string): Promise<string | null> {
    try {
      const row = await this.client.providerCredential.findUnique({
        where: { providerId_keyName: { providerId, keyName } },
        select: { ciphertext: true },
      });
      return row?.ciphertext ?? null;
    } catch (error) {
      throw new PersistenceError('Failed to read provider credential ciphertext.', {}, { cause: error });
    }
  }

  async listKeyNames(providerId: string): Promise<readonly string[]> {
    try {
      const rows = await this.client.providerCredential.findMany({
        where: { providerId },
        select: { keyName: true },
        orderBy: { keyName: 'asc' },
      });
      return rows.map((row) => row.keyName);
    } catch (error) {
      throw new PersistenceError('Failed to list provider credential keys.', {}, { cause: error });
    }
  }
}

function toStored(row: {
  id: string;
  providerId: string;
  keyName: string;
  ciphertext: string;
  createdAt: Date;
  updatedAt: Date;
}): StoredProviderCredential {
  return {
    id: row.id,
    providerId: row.providerId,
    keyName: row.keyName,
    ciphertext: row.ciphertext,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
