import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;

export function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32(secret: string): Buffer {
  const normalized = secret.toUpperCase().replace(/=+$/u, '').replace(/\s+/gu, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Invalid base32 secret.');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160-bit TOTP shared secret, RFC 4648 base32, no padding. */
export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function totpAt(
  secret: string,
  unixSeconds: number,
  periodSeconds = TOTP_PERIOD_SECONDS,
  digits = TOTP_DIGITS,
): string {
  const counter = Math.floor(unixSeconds / periodSeconds);
  const key = decodeBase32(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const truncated =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  const otp = truncated % 10 ** digits;
  return otp.toString().padStart(digits, '0');
}

export function verifyTotp(
  secret: string,
  code: string,
  nowMs: number,
  window = TOTP_WINDOW,
): boolean {
  if (!/^\d{6}$/u.test(code)) {
    return false;
  }
  const presented = Buffer.from(code, 'utf8');
  const unix = Math.floor(nowMs / 1000);
  let matched = false;
  for (let step = -window; step <= window; step += 1) {
    const expected = Buffer.from(totpAt(secret, unix + step * TOTP_PERIOD_SECONDS), 'utf8');
    if (expected.length === presented.length && timingSafeEqual(expected, presented)) {
      matched = true;
    }
  }
  return matched;
}

export function otpauthUrl(
  email: string,
  secret: string,
  issuer = 'Meridian',
): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
    algorithm: 'SHA1',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
