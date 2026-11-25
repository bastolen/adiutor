/**
 * @file Tests for parsing versioned auth secrets, the current one, and the
 * encryption key they make.
 */
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { describe, expect, it } from 'vitest';

import { currentSecret, encryptionKey, parseAuthSecrets } from './auth-secrets';

const NEW = 'n'.repeat(32);
const OLD = 'o'.repeat(32);
const LEGACY = 'l'.repeat(32);

describe('parseAuthSecrets', () => {
  it('is undefined when unset or empty', () => {
    expect(parseAuthSecrets(undefined)).toBeUndefined();
    expect(parseAuthSecrets('  ')).toBeUndefined();
  });

  it('parses versions newest first', () => {
    expect(parseAuthSecrets(`2:${NEW}, 1:${OLD}`)).toEqual([
      { version: 2, value: NEW },
      { version: 1, value: OLD },
    ]);
  });

  it('keeps colons inside the secret', () => {
    expect(parseAuthSecrets(`1:${NEW}:x`)).toEqual([{ version: 1, value: `${NEW}:x` }]);
  });

  it.each([NEW, `x:${NEW}`, '1:', `-1:${NEW}`])('rejects the malformed entry %s', (value) => {
    expect(() => parseAuthSecrets(value)).toThrow(/<version>:<secret>/);
  });

  it('rejects repeated versions', () => {
    expect(() => parseAuthSecrets(`1:${NEW},1:${OLD}`)).toThrow(/only appear once/);
  });

  it('rejects a short current secret', () => {
    expect(() => parseAuthSecrets(`2:short,1:${OLD}`)).toThrow(/at least 32/);
  });
});

describe('currentSecret', () => {
  it('is the plain secret without versions', () => {
    expect(currentSecret(LEGACY)).toBe(LEGACY);
    expect(currentSecret(LEGACY, parseAuthSecrets(undefined))).toBe(LEGACY);
  });

  it('is the newest version once there are versions, whatever older ones follow', () => {
    expect(currentSecret(LEGACY, parseAuthSecrets(`1:${OLD}`))).toBe(OLD);
    expect(currentSecret(LEGACY, parseAuthSecrets(`2:${NEW},1:${OLD}`))).toBe(NEW);
    expect(currentSecret(LEGACY, parseAuthSecrets(`2:${NEW}`))).toBe(NEW);
  });
});

describe('encryptionKey', () => {
  it('is the plain secret without versions', () => {
    expect(encryptionKey(LEGACY)).toBe(LEGACY);
  });

  it('decrypts data encrypted with an older version and the legacy secret', async () => {
    const before = await symmetricEncrypt({
      key: encryptionKey(LEGACY, parseAuthSecrets(`1:${OLD}`)),
      data: 'old',
    });
    const legacy = await symmetricEncrypt({ key: LEGACY, data: 'legacy' });
    const rotated = encryptionKey(LEGACY, parseAuthSecrets(`2:${NEW},1:${OLD}`));

    await expect(symmetricDecrypt({ key: rotated, data: before })).resolves.toBe('old');
    await expect(symmetricDecrypt({ key: rotated, data: legacy })).resolves.toBe('legacy');
  });
});
