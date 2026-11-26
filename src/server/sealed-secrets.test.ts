/**
 * @file Tests for secrets kept in settings: encrypted and decrypted with the
 * versioned auth secrets, readable after a rotation, and the rule that an
 * empty field keeps a saved secret only for the same place.
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';

import { openSecret, sealSecret, secretToSave } from './sealed-secrets';

// The server's own key isn't used here: every call is given one.
vi.mock('@/lib/env', () => ({ env: { BETTER_AUTH_SECRET: 'unused-in-these-tests-0123456789ab' } }));

describe('sealSecret and openSecret', () => {
  it('keep a secret unreadable, and read it back with the same key', async () => {
    const key = 'k'.repeat(32);
    const sealed = await sealSecret('adiutor-mail-password', key);
    expect(sealed).not.toContain('adiutor-mail-password');
    expect(await openSecret(sealed, key)).toBe('adiutor-mail-password');
  });

  it('read a secret sealed before a rotation while the old secret is kept, and seal with the new one', async () => {
    const old = 'o'.repeat(32);
    const sealed = await sealSecret('adiutor-mail-password', old);
    const rotated = {
      keys: new Map([[1, 'n'.repeat(32)]]),
      currentVersion: 1,
      legacySecret: old,
    };
    expect(await openSecret(sealed, rotated)).toBe('adiutor-mail-password');
    const resealed = await sealSecret('adiutor-mail-password', rotated);
    expect(await openSecret(resealed, { ...rotated, legacySecret: 'x'.repeat(32) })).toBe(
      'adiutor-mail-password',
    );
  });
});

describe('secretToSave', () => {
  it('takes what was typed', () => {
    expect(secretToSave({ typed: 'new', saved: 'old', samePlace: false })).toBe('new');
  });

  it('keeps the saved secret for an empty field, but only for the same place', () => {
    expect(secretToSave({ typed: undefined, saved: 'old', samePlace: true })).toBe('old');
    expect(secretToSave({ typed: undefined, saved: 'old', samePlace: false })).toBeUndefined();
    expect(secretToSave({ typed: undefined, saved: undefined, samePlace: true })).toBeUndefined();
  });
});
