/**
 * @file The storage files go to now: the one the server's environment
 * chooses (`ATTACHMENTS_STORAGE`), or else the one saved on the Integrations
 * tab of Settings, or none. The driver is built once per set of settings and
 * kept, so a save takes effect with the next file, and the one it replaces
 * lets go of its connection once its calls are done.
 */
import type { Database, DatabaseTransaction } from '@/db';
import { env } from '@/lib/env';
import { type StorageConfig, type StorageEnvironment, storageFromEnvironment } from '@/lib/storage';
import { readSettings } from '@/server/settings';

import diskStorage from './local';
import bucketStorage from './s3';
import { openStorage } from './secrets';
import sftpStorage from './sftp';
import type { FileStorage } from './types';

/** The last driver built, with the settings (as kept) it was built from. */
let built: { fingerprint: string; storage: FileStorage } | null = null;

/**
 * Builds the driver for a storage's settings.
 *
 * @param config - The settings, with their secrets.
 * @returns The storage.
 */
export function storageFor(config: StorageConfig): FileStorage {
  switch (config.driver) {
    case 'local':
      return diskStorage(config.dir);
    case 's3':
      return bucketStorage(config);
    default:
      return sftpStorage(config);
  }
}

/**
 * The driver for a set of settings, built the first time and kept until the
 * settings change; the one it replaces is closed (`close`, which waits for
 * the calls still using it).
 *
 * @param fingerprint - The settings as kept (with secrets encrypted, from Settings).
 * @param build - Builds the driver when it's new.
 * @returns The storage.
 */
async function kept(fingerprint: string, build: () => Promise<FileStorage>): Promise<FileStorage> {
  if (built?.fingerprint !== fingerprint) {
    const storage = await build();
    const replaced = built;
    built = { fingerprint, storage };
    replaced?.storage.close();
  }
  return built.storage;
}

/**
 * The storage files go to now.
 *
 * @param db - Database client or transaction, to read Settings.
 * @param environment - The server's environment; the tests give one.
 * @returns The storage, or `null` when none is chosen (or the environment turned them off).
 */
export async function activeStorage(
  db: Database | DatabaseTransaction,
  environment: StorageEnvironment = env,
): Promise<FileStorage | null> {
  const fromEnvironment = storageFromEnvironment(environment);
  if (fromEnvironment.state === 'set') {
    const { config } = fromEnvironment;
    return kept(JSON.stringify(config), async () => storageFor(config));
  }
  if (fromEnvironment.state !== 'unset') {
    return null;
  }
  const { 'attachments.storage': stored } = await readSettings(db, ['attachments.storage']);
  if (!stored) {
    return null;
  }
  return kept(JSON.stringify(stored), async () => storageFor(await openStorage(stored)));
}
