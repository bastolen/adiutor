/**
 * @file Authenticator-app codes for the end-to-end tests (RFC 6238 TOTP,
 * SHA-1, 6 digits, 30 seconds), computed like the user's app would.
 */
import { createHmac } from 'node:crypto';

/** Characters of RFC 4648 base32, as used in setup keys. */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Computes the current code for a secret.
 *
 * @param key - The secret's bytes.
 * @returns The 6-digit code.
 */
function totp(key: Buffer): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  // Dynamic truncation: the low 4 bits pick an offset, the top bit of the 31-bit value is dropped.
  const offset = hmac.readUInt8(hmac.length - 1) % 16;
  const value = hmac.readUInt32BE(offset) % 2 ** 31;
  return (value % 1_000_000).toString().padStart(6, '0');
}

/**
 * The current code for a raw secret, as Better Auth stores it (the seeded
 * Admin's secret).
 *
 * @param secret - The raw secret.
 * @returns The 6-digit code.
 */
export function codeForSecret(secret: string): string {
  return totp(Buffer.from(secret, 'utf8'));
}

/**
 * The current code for a setup key shown on the Security page (base32,
 * possibly grouped with spaces).
 *
 * @param setupKey - The setup key.
 * @returns The 6-digit code.
 */
export function codeForSetupKey(setupKey: string): string {
  const bits = setupKey
    .replace(/[\s=]/g, '')
    .toUpperCase()
    .split('')
    .map((char) => BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, '0'))
    .join('');
  const bytes = bits.match(/.{8}/g)?.map((byte) => parseInt(byte, 2)) ?? [];
  return totp(Buffer.from(bytes));
}
