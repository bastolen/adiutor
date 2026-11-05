/**
 * @file Secret tokens for invitation, invite and welcome links, and how
 * sign-in link tokens are stored.
 *
 * Only a token's SHA-256 hash is stored, so a database leak doesn't expose
 * usable links. The token itself appears only in the link.
 */
import { createHash, randomBytes } from 'node:crypto';

/**
 * Creates a new random token: 32 bytes (256 bits), URL-safe.
 *
 * @returns The token, to put in a link.
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Hashes a token for storage and lookup.
 *
 * @param token - The token from a link.
 * @returns Its SHA-256 hash, hex-encoded.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Hashes the identifier of a Better Auth verification row the way Better
 * Auth does with `verification.storeIdentifier: 'hashed'` (SHA-256,
 * base64url without padding), for rows the app writes itself, such as the
 * `reset-password:<token>` row of a welcome link.
 *
 * @param identifier - The identifier, e.g. `reset-password:<token>`.
 * @returns The stored form.
 */
export function hashVerificationIdentifier(identifier: string): string {
  return createHash('sha256').update(identifier).digest('base64url');
}

/**
 * Hashes a sign-in link's token the way Better Auth's magic-link plugin
 * stores it (`storeToken` in `src/lib/auth.ts` uses this): SHA-256, base64url
 * without padding, the same as its built-in `'hashed'`.
 *
 * @param token - The token from the link.
 * @returns The stored form.
 */
export function hashEmailLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/**
 * The stored identifier of a sign-in link's verification row: Better Auth
 * names it `magic-link:<hashed token>` and then hashes that as well
 * (`verification.storeIdentifier`). For looking a link up without using it.
 *
 * @param token - The token from the link.
 * @returns The identifier as stored.
 */
export function emailLinkVerificationIdentifier(token: string): string {
  return hashVerificationIdentifier(`magic-link:${hashEmailLinkToken(token)}`);
}
