/**
 * @file Secrets Adiutor keeps in its settings (a storage's keys and
 * passwords, and any other credential a setting holds): encrypted with
 * Better Auth's `symmetricEncrypt` and the versioned auth secrets, as Better
 * Auth keeps authenticator secrets, so "Rotating the auth secret" in
 * `docs/deploying.md` holds for them (keep an old version until they've been
 * saved again). Also the rule for a form's secret field, which never shows
 * a saved secret: left empty, it keeps the saved one, but only for the place
 * that secret was saved for. Free of `server-only`, since the jobs' command
 * reads such settings.
 */
import { type SecretConfig, symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';

import { env } from '@/lib/env';
import { encryptionKey, parseAuthSecrets } from '@/lib/sign-in/auth-secrets';

/** A key to encrypt with: the versioned auth secrets, or the auth secret alone. */
export type EncryptionKey = string | SecretConfig;

/**
 * The key the server encrypts with now (the newest auth secret), which also
 * decrypts what older ones encrypted while they're kept.
 *
 * @returns The key.
 */
export function currentEncryptionKey(): EncryptionKey {
  return encryptionKey(env.BETTER_AUTH_SECRET, parseAuthSecrets(env.BETTER_AUTH_SECRETS));
}

/**
 * Encrypts a secret, to keep in a setting.
 *
 * @param secret - The secret as typed.
 * @param key - The key; the server's own unless a test gives one.
 * @returns The encrypted text.
 */
export function sealSecret(
  secret: string,
  key: EncryptionKey = currentEncryptionKey(),
): Promise<string> {
  return symmetricEncrypt({ key, data: secret });
}

/**
 * Decrypts a secret kept in a setting.
 *
 * @param sealed - The encrypted text.
 * @param key - The key; the server's own unless a test gives one.
 * @returns The secret.
 */
export function openSecret(
  sealed: string,
  key: EncryptionKey = currentEncryptionKey(),
): Promise<string> {
  return symmetricDecrypt({ key, data: sealed });
}

/**
 * The secret to save from a form's secret field: what was typed, or, when
 * the field was left empty, the saved one, but only while the place it was
 * saved for stays the same (the same S3 service and access key, the same
 * server, port and user). A changed place must be given its secret again,
 * so whoever changes a host can't have a saved password sent to their own.
 *
 * @param field - The field.
 * @param field.typed - What was typed, or `undefined` when it was left empty.
 * @param field.saved - The saved secret (decrypted), if there is one.
 * @param field.samePlace - Whether the form keeps the place the saved secret was saved for.
 * @returns The secret to save, or `undefined` when there's none to keep.
 */
export function secretToSave(field: {
  typed: string | undefined;
  saved: string | undefined;
  samePlace: boolean;
}): string | undefined {
  return field.typed ?? (field.samePlace ? field.saved : undefined);
}
