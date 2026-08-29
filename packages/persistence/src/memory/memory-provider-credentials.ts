import type {
  ProviderCredentialStore,
  StoredProviderCredential,
} from '@meridian/core';

/**
 * In-process encrypted-credential rows. Ciphertext only — plaintext never enters this map.
 */
export class InMemoryProviderCredentialStore implements ProviderCredentialStore {
  private readonly byPair = new Map<string, StoredProviderCredential>();

  put(input: {
    readonly id: string;
    readonly providerId: string;
    readonly keyName: string;
    readonly ciphertext: string;
    readonly nowIso: string;
  }): Promise<StoredProviderCredential> {
    const pair = `${input.providerId}\0${input.keyName}`;
    const existing = this.byPair.get(pair);
    const stored: StoredProviderCredential = {
      id: existing?.id ?? input.id,
      providerId: input.providerId,
      keyName: input.keyName,
      ciphertext: input.ciphertext,
      createdAt: existing?.createdAt ?? input.nowIso,
      updatedAt: input.nowIso,
    };
    this.byPair.set(pair, stored);
    return Promise.resolve(structuredClone(stored));
  }

  getCiphertext(providerId: string, keyName: string): Promise<string | null> {
    const stored = this.byPair.get(`${providerId}\0${keyName}`);
    return Promise.resolve(stored === undefined ? null : stored.ciphertext);
  }

  listKeyNames(providerId: string): Promise<readonly string[]> {
    const names: string[] = [];
    for (const row of this.byPair.values()) {
      if (row.providerId === providerId) {
        names.push(row.keyName);
      }
    }
    return Promise.resolve(names.sort((left, right) => left.localeCompare(right, 'en')));
  }
}
