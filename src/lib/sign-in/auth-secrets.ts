/**
 * @file Versioned Better Auth secrets (`BETTER_AUTH_SECRETS`), so the secret
 * can be rotated without losing encrypted data such as authenticator
 * secrets and backup codes.
 *
 * The format is `"<version>:<secret>,<version>:<secret>"` with the newest
 * first, e.g. `"2:new-secret,1:old-secret"`. New data is encrypted with the
 * first secret; older ones only decrypt. `BETTER_AUTH_SECRET` stays as the
 * fallback for data encrypted before versioned secrets were used. The first
 * secret is also the current one Better Auth signs with, and the one Adiutor
 * works out its own secrets from (`currentSecret`).
 *
 * Kept free of `server-only` so the seed scripts can encrypt the same way.
 */
import type { SecretConfig } from 'better-auth/crypto';

import { defined } from '@/lib/defined';

/** One version of the secret. */
export interface AuthSecret {
  /** Version number; higher is newer by convention. */
  version: number;
  /** The secret itself. */
  value: string;
}

/** Minimum length of the current secret. */
const MIN_LENGTH = 32;

/**
 * Parses `BETTER_AUTH_SECRETS`.
 *
 * @param value - The raw value, e.g. `"2:new-secret,1:old-secret"`.
 * @returns The secrets, newest first, or `undefined` when unset.
 * @throws {Error} When an entry is malformed, a version repeats or the
 *   current secret is shorter than 32 characters.
 */
export function parseAuthSecrets(value: string | undefined): AuthSecret[] | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const secrets = value.split(',').map((entry): AuthSecret => {
    const trimmed = entry.trim();
    const colon = trimmed.indexOf(':');
    const version = Number(trimmed.slice(0, colon));
    const secret = trimmed.slice(colon + 1).trim();
    if (colon < 1 || !Number.isInteger(version) || version < 0 || !secret) {
      throw new Error('Each entry must look like "<version>:<secret>", e.g. "2:new,1:old".');
    }
    return { version, value: secret };
  });
  if (new Set(secrets.map(({ version }) => version)).size !== secrets.length) {
    throw new Error('Each version may only appear once.');
  }
  const [current] = secrets;
  if (!current || current.value.length < MIN_LENGTH) {
    throw new Error(`The current (first) secret must be at least ${MIN_LENGTH} characters.`);
  }
  return secrets;
}

/**
 * The current secret, as Better Auth chooses it: the first versioned secret
 * when there are any, else `BETTER_AUTH_SECRET`. It's what Better Auth signs
 * with, so a rotation that changes it also changes what's worked out from it.
 *
 * @param secret - `BETTER_AUTH_SECRET`.
 * @param secrets - Parsed `BETTER_AUTH_SECRETS`, if set.
 * @returns The secret in use now.
 */
export function currentSecret(secret: string, secrets?: AuthSecret[]): string {
  return secrets?.[0]?.value ?? secret;
}

/**
 * The key Better Auth's `symmetricEncrypt` should use, matching how Better
 * Auth itself encrypts with the same environment.
 *
 * @param secret - `BETTER_AUTH_SECRET`.
 * @param secrets - Parsed `BETTER_AUTH_SECRETS`, if set.
 * @returns The plain secret, or the versioned configuration.
 */
export function encryptionKey(secret: string, secrets?: AuthSecret[]): string | SecretConfig {
  if (!secrets) {
    return secret;
  }
  return {
    keys: new Map(secrets.map(({ version, value }) => [version, value])),
    currentVersion: defined(secrets[0], 'the current secret').version,
    legacySecret: secret,
  };
}
