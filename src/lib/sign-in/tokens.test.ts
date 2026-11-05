/**
 * @file Tests for link tokens and how sign-in link tokens are stored.
 */
import { describe, expect, it } from 'vitest';

import {
  emailLinkVerificationIdentifier,
  generateToken,
  hashEmailLinkToken,
  hashToken,
  hashVerificationIdentifier,
} from './tokens';

describe('tokens', () => {
  it('creates long, URL-safe, unique tokens', () => {
    const first = generateToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(first);
  });

  it('hashes deterministically without revealing the token', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });

  it('hashes verification identifiers like Better Auth (SHA-256, base64url)', () => {
    // The value Better Auth's own hasher gives for "reset-password:abc".
    expect(hashVerificationIdentifier('reset-password:abc')).toBe(
      'IMUqJ3lXuvod79AbI4EdsWmdAkZeIP5syfKs7-d5fQQ',
    );
  });

  it('stores sign-in link tokens like Better Auth, and finds their verification rows', () => {
    // The values Better Auth's own hashers give: the magic-link plugin's `storeToken: 'hashed'`,
    // then `verification.storeIdentifier: 'hashed'` for `magic-link:<that>`.
    expect(hashEmailLinkToken('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
    expect(emailLinkVerificationIdentifier('abc')).toBe(
      'nq56GZddbLPqnPgl2VAQF_GLEq1CtvvkQhlctDTRGR4',
    );
  });
});
