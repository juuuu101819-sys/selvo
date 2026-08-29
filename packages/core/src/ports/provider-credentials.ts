/**
 * Encrypted-at-rest adapter secrets (PHASE 38 vault readiness).
 *
 * Separate from the `providers` catalog table, which must never grow a plaintext credential
 * column. Ciphertext uses the same AES-256-GCM envelope as TOTP and OIDC secrets.
 *
 * PHASE 30 should store licensed-partner secrets here rather than inventing a second mechanism.
 * The only HTTP write path is operator-only. No read API returns plaintext.
 */

/** Clearly not a real licensed partner. Used in tests only. */
export const SYNTHETIC_PLACEHOLDER_PROVIDER_ID = 'synthetic_placeholder_provider';

export interface StoredProviderCredential {
  readonly id: string;
  readonly providerId: string;
  readonly keyName: string;
  /** AES-256-GCM envelope `v1$iv$ciphertext$tag`. Never plaintext. */
  readonly ciphertext: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProviderCredentialStore {
  put(input: {
    readonly id: string;
    readonly providerId: string;
    readonly keyName: string;
    readonly ciphertext: string;
    readonly nowIso: string;
  }): Promise<StoredProviderCredential>;
  getCiphertext(providerId: string, keyName: string): Promise<string | null>;
  listKeyNames(providerId: string): Promise<readonly string[]>;
}
