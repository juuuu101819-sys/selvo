import { dataEncryptionKeyFromHex, decryptAtRest, encryptAtRest } from './encryption.js';
import type { ProviderCredentialStore } from '../ports/provider-credentials.js';
import { uuidIdGenerator } from '../ports/id-generator.js';

/**
 * Internal retrieval path for adapter-calling code. Never mounted as a GET handler.
 */
export class ProviderCredentialVault {
  constructor(
    private readonly store: ProviderCredentialStore,
    private readonly dataEncryptionKeyHex: string,
  ) {}

  async putPlaintext(providerId: string, keyName: string, plaintext: string, nowIso: string): Promise<void> {
    const ciphertext = encryptAtRest(plaintext, dataEncryptionKeyFromHex(this.dataEncryptionKeyHex));
    await this.store.put({
      id: uuidIdGenerator.generate('pcr'),
      providerId,
      keyName,
      ciphertext,
      nowIso,
    });
  }

  /** Adapter-calling code only. Do not serialize onto any HTTP DTO. */
  async getPlaintext(providerId: string, keyName: string): Promise<string | null> {
    const ciphertext = await this.store.getCiphertext(providerId, keyName);
    if (ciphertext === null) {
      return null;
    }
    return decryptAtRest(ciphertext, dataEncryptionKeyFromHex(this.dataEncryptionKeyHex));
  }
}
