import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  dataEncryptionKeyFromHex,
  decryptAtRest,
  deriveDataEncryptionKey,
  deriveDataEncryptionKeyHex,
  encryptAtRest,
} from './encryption.js';

describe('data-at-rest encryption', () => {
  it('round-trips plaintext and never embeds it in the envelope', () => {
    const key = deriveDataEncryptionKey('unit-test-production-auth-secret-ok', {
      productionLocked: true,
    });
    const secret = 'JBSWY3DPEHPK3PXP';
    const stored = encryptAtRest(secret, key);
    expect(stored.startsWith('v1$')).toBe(true);
    expect(stored).not.toContain(secret);
    expect(decryptAtRest(stored, key)).toBe(secret);
  });

  it('is domain-separated from AUTH_SECRET and from the session pepper material', () => {
    const hex = deriveDataEncryptionKeyHex('unit-test-production-auth-secret-ok', {
      productionLocked: true,
    });
    expect(hex).toHaveLength(64);
    expect(hex).not.toBe('unit-test-production-auth-secret-ok');
    expect(dataEncryptionKeyFromHex(hex).length).toBe(32);
  });

  it('fails closed when production is locked and AUTH_SECRET is missing', () => {
    expect(() => deriveDataEncryptionKey(undefined, { productionLocked: true })).toThrow(
      /AUTH_SECRET is required/,
    );
  });

  it('rejects a tampered tag', () => {
    const key = deriveDataEncryptionKey('unit-test-production-auth-secret-ok', {
      productionLocked: true,
    });
    const stored = encryptAtRest('totp-seed', key);
    const parts = stored.split('$');
    const tag = Buffer.from(parts[3] ?? '', 'base64url');
    tag[0] = (tag[0] ?? 0) ^ 0xff;
    parts[3] = tag.toString('base64url');
    expect(() => decryptAtRest(parts.join('$'), key)).toThrow();
    expect(createHash('sha256').update('totp-seed').digest('hex')).not.toBe(stored);
  });
});
