/**
 * @file The storage files go to now: the one the server's environment
 * chooses (`ATTACHMENTS_STORAGE`), or none. The driver is built once per
 * set of settings and kept.
 */
import { env } from '@/lib/env';
import { type StorageConfig, storageFromEnvironment } from '@/lib/storage';

import diskStorage from './local';
import bucketStorage from './s3';
import type { FileStorage } from './types';

/** The last driver built, with the settings it was built from. */
let built: { fingerprint: string; storage: FileStorage } | null = null;

/**
 * Builds the driver for a storage's settings.
 *
 * @param config - The settings.
 * @returns The storage.
 */
export function storageFor(config: StorageConfig): FileStorage {
  return config.driver === 'local' ? diskStorage(config.dir) : bucketStorage(config);
}

/**
 * The storage for a set of settings, built the first time and kept until
 * the settings change.
 *
 * @param config - The settings.
 * @returns The storage.
 */
function keptStorageFor(config: StorageConfig): FileStorage {
  const fingerprint = JSON.stringify(config);
  if (built?.fingerprint !== fingerprint) {
    built = { fingerprint, storage: storageFor(config) };
  }
  return built.storage;
}

/**
 * The storage files go to now.
 *
 * @returns The storage, or `null` when none is chosen.
 */
export async function activeStorage(): Promise<FileStorage | null> {
  const fromEnvironment = storageFromEnvironment(env);
  return fromEnvironment.state === 'set' ? keptStorageFor(fromEnvironment.config) : null;
}
