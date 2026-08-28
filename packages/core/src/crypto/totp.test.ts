import { describe, expect, it } from 'vitest';
import { generateTotpSecret, otpauthUrl, totpAt, verifyTotp } from './totp.js';

function integerDivide(numerator: number, denominator: number): number {
  return (numerator - (numerator % denominator)) / denominator;
}

describe('TOTP', () => {
  it('accepts the current code and rejects a wrong one', () => {
    const secret = generateTotpSecret();
    const now = Date.parse('2026-03-01T09:00:00.000Z');
    const code = totpAt(secret, integerDivide(now, 1000));
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, now)).toBe(true);
    expect(verifyTotp(secret, '000000', now)).toBe(false);
    expect(otpauthUrl('treasury@demo-trading.example.invalid', secret)).toContain(secret);
    expect(otpauthUrl('treasury@demo-trading.example.invalid', secret)).toContain('otpauth://totp/');
  });
});
