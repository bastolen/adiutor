/**
 * @file Keeps a storage's secrets (the S3 secret key, the SFTP password or
 * private key) encrypted in Settings, with the shared helpers for secrets in
 * settings (`src/server/sealed-secrets.ts`): the versioned auth secrets, as
 * Better Auth keeps authenticator secrets.
 */
import type { StorageConfig } from '@/lib/storage';

import {
  currentEncryptionKey,
  type EncryptionKey,
  openSecret,
  sealSecret,
} from '../sealed-secrets';

/**
 * Applies a change to each secret a storage's settings hold.
 *
 * @param config - The settings.
 * @param change - What to do with a secret.
 * @returns The settings with each secret changed.
 */
async function withSecrets(
  config: StorageConfig,
  change: (secret: string) => Promise<string>,
): Promise<StorageConfig> {
  if (config.driver === 's3') {
    return { ...config, secretAccessKey: await change(config.secretAccessKey) };
  }
  if (config.driver === 'sftp') {
    const { password, privateKey, ...rest } = config;
    return {
      ...rest,
      ...(password ? { password: await change(password) } : {}),
      ...(privateKey ? { privateKey: await change(privateKey) } : {}),
    };
  }
  return config;
}

/**
 * Encrypts a storage's secrets, for Settings.
 *
 * @param config - The settings, with their secrets as typed.
 * @param key - The key; the server's own unless a test gives one.
 * @returns The settings to keep.
 */
export function sealStorage(
  config: StorageConfig,
  key: EncryptionKey = currentEncryptionKey(),
): Promise<StorageConfig> {
  return withSecrets(config, (secret) => sealSecret(secret, key));
}

/**
 * Decrypts the secrets of a storage kept in Settings.
 *
 * @param stored - The settings as kept.
 * @param key - The key; the server's own unless a test gives one.
 * @returns The settings with their secrets.
 */
export function openStorage(
  stored: StorageConfig,
  key: EncryptionKey = currentEncryptionKey(),
): Promise<StorageConfig> {
  return withSecrets(stored, (secret) => openSecret(secret, key));
}
