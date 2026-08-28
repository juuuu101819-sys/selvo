import { randomBytes } from 'node:crypto';

/** Unambiguous alphabet (no I/O/0/1). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/iu;

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): readonly string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const bytes = randomBytes(8);
    let raw = '';
    for (const byte of bytes) {
      raw += ALPHABET[byte % ALPHABET.length];
    }
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  const compact = code.trim().toUpperCase().replace(/[\s_]/gu, '');
  if (compact.length === 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4)}`;
  }
  return compact;
}

export function isRecoveryCodeShape(code: string): boolean {
  return RECOVERY_CODE_PATTERN.test(normalizeRecoveryCode(code));
}
