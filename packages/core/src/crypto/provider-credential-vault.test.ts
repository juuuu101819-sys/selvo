import { describe, expect, it } from 'vitest';
import { deriveDataEncryptionKeyHex } from './encryption.js';
import { ProviderCredentialVault } from './provider-credential-vault.js';
import {
  SYNTHETIC_PLACEHOLDER_PROVIDER_ID,
  type ProviderCredentialStore,
  type StoredProviderCredential,
} from '../ports/provider-credentials.js';

class MemoryCredentialStore implements ProviderCredentialStore {
  readonly rows = new Map<string, StoredProviderCredential>();

  put(input: {
    readonly id: string;
    readonly providerId: string;
    readonly keyName: string;
    readonly ciphertext: string;
    readonly nowIso: string;
  }): Promise<StoredProviderCredential> {
    const stored: StoredProviderCredential = {
      id: input.id,
      providerId: input.providerId,
      keyName: input.keyName,
      ciphertext: input.ciphertext,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
    };
    this.rows.set(`${input.providerId}:${input.keyName}`, stored);
    return Promise.resolve(stored);
  }

  getCiphertext(providerId: string, keyName: string): Promise<string | null> {
    return Promise.resolve(this.rows.get(`${providerId}:${keyName}`)?.ciphertext ?? null);
  }

  listKeyNames(providerId: string): Promise<readonly string[]> {
    return Promise.resolve(
      [...this.rows.values()].filter((row) => row.providerId === providerId).map((row) => row.keyName),
    );
  }
}

describe('ProviderCredentialVault', () => {
  it('encrypts at rest and decrypts only on the internal path', async () => {
    const store = new MemoryCredentialStore();
    const keyHex = deriveDataEncryptionKeyHex('unit-test-auth-secret-not-for-production-use', {
      productionLocked: false,
    });
    const vault = new ProviderCredentialVault(store, keyHex);
    const plaintext = 'synthetic-placeholder-secret-value';

    await vault.putPlaintext(
      SYNTHETIC_PLACEHOLDER_PROVIDER_ID,
      'API_TOKEN',
      plaintext,
      '2026-03-01T09:00:00.000Z',
    );

    const stored = store.rows.get(`${SYNTHETIC_PLACEHOLDER_PROVIDER_ID}:API_TOKEN`);
    expect(stored).toBeDefined();
    expect(stored?.ciphertext).not.toContain(plaintext);
    expect(stored?.ciphertext.startsWith('v1$')).toBe(true);
    expect(await vault.getPlaintext(SYNTHETIC_PLACEHOLDER_PROVIDER_ID, 'API_TOKEN')).toBe(plaintext);
    expect(SYNTHETIC_PLACEHOLDER_PROVIDER_ID).toBe('synthetic_placeholder_provider');
  });
});
