/**
 * @file Authenticator-app codes for the end-to-end tests (RFC 6238 TOTP,
 * SHA-1, 6 digits, 30 seconds), computed like the user's app would.
 */
import { authenticatorCode } from '../../tests/auth/authenticator';

/** Characters of RFC 4648 base32, as used in setup keys. */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * The current code for a raw secret (`authenticatorCode`), as Better Auth
 * stores it: the seeded accounts' secrets are given this way.
 */
export const codeForSecret = authenticatorCode;

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
  return authenticatorCode(Buffer.from(bytes));
}
