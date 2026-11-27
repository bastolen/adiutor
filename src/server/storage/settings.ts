/**
 * @file The attachment cards of Settings (decision 0044): where attached
 * files are kept and the largest file anyone may attach, which staff Admins
 * choose unless the server's environment does. A storage is tried before
 * it's saved, its secrets are encrypted (`sealStorage`) and never shown
 * again, and a saved secret only goes back to the place it was saved for.
 */
import { needsRecentConfirmation } from '@/lib/authz/mfa';
import { env } from '@/lib/env';
import {
  maxFileMbCeiling,
  type StorageConfig,
  type StorageEnvironment,
  storageFromEnvironment,
  storageProblems,
  type StorageView,
  storageView,
} from '@/lib/storage';
import { maxFileMbSchema, type StorageFormInput, storageFormSchema } from '@/lib/validation';

import { assertNotSignedInAs, assertPermission, getGlobalPermissions } from '../access';
import type { Actor } from '../actor';
import { recordEvent } from '../audit';
import checkBeforeSaving from '../check-before-save';
import type { ServiceContext } from '../context';
import { ServiceError } from '../errors';
import { assertRateLimit, RATE_LIMITS } from '../rate-limit';
import { secretToSave } from '../sealed-secrets';
import { readSettings, writeSettings } from '../settings';
import { activeStorage, storageFor } from './active';
import checkStorage from './check';
import { StorageError } from './errors';
import { openStorage, sealStorage } from './secrets';

/** The server's environment, as these settings read it; the tests give their own. */
export interface AttachmentEnvironment extends StorageEnvironment {
  /** The largest file, when the environment chooses it. */
  ATTACHMENTS_MAX_FILE_MB?: number;
  /** `1` on Vercel. */
  VERCEL?: string;
  /** `production` on a production server. */
  NODE_ENV?: string;
}

/** What the attachment cards show. */
export interface AttachmentSettings {
  /**
   * Where files are kept, without any secret: chosen by the server's
   * environment (`null` when it turned attachments off), which the tab only
   * shows, or by Settings (`null` until one is chosen).
   */
  storage:
    | { source: 'environment'; view: StorageView | null }
    | { source: 'settings'; view: StorageView | null };
  /** The largest file, in megabytes: its value, the most it may be, and whether the environment chose it. */
  maxFileMb: { value: number; ceiling: number; fromEnvironment: boolean };
  /**
   * Whether the storage files go to now is set up as Adiutor's (a folder
   * with its marker; a bucket always is), or `null` without a storage or
   * when it couldn't be reached to tell.
   */
  storageSetUp: boolean | null;
  /**
   * "People can attach files": whether it's on, whether the environment
   * turned attachments off (`ATTACHMENTS_STORAGE=off`, which locks it off),
   * and whether a storage is chosen, which turning it on needs.
   */
  enabled: { value: boolean; offByEnvironment: boolean; storageChosen: boolean };
  /** Whether Adiutor runs on Vercel, where a folder on its disk can't be chosen. */
  vercel: boolean;
}

/**
 * The largest file anyone may attach now, in megabytes: the environment's
 * choice, else Settings', never more than where it runs allows.
 *
 * @param db - Database client, to read Settings.
 * @param environment - The server's environment.
 * @returns The limit.
 */
export async function attachmentLimitMb(
  db: ServiceContext['db'],
  environment: AttachmentEnvironment = env,
): Promise<number> {
  const ceiling = maxFileMbCeiling(environment.VERCEL === '1');
  const chosen =
    environment.ATTACHMENTS_MAX_FILE_MB ??
    (await readSettings(db, ['attachments.max_file_mb']))['attachments.max_file_mb'];
  return Math.min(chosen, ceiling);
}

/**
 * Reads the attachment cards' settings.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param environment - The server's environment.
 * @returns What the tab shows.
 */
export async function getAttachmentSettings(
  ctx: ServiceContext,
  actor: Actor,
  environment: AttachmentEnvironment = env,
): Promise<AttachmentSettings> {
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  const vercel = environment.VERCEL === '1';
  const fromEnvironment = storageFromEnvironment(environment);
  const { 'attachments.storage': stored, 'attachments.enabled': enabled } = await readSettings(
    ctx.db,
    ['attachments.storage', 'attachments.enabled'],
  );
  let storage: AttachmentSettings['storage'];
  if (fromEnvironment.state === 'set') {
    storage = { source: 'environment', view: storageView(fromEnvironment.config) };
  } else if (fromEnvironment.state === 'unset') {
    // Seen without its secrets, so they aren't decrypted.
    storage = { source: 'settings', view: stored ? storageView(stored) : null };
  } else {
    storage = { source: 'environment', view: null };
  }
  // Asked of the storage itself: a folder without its marker is one a server started without.
  const active =
    storage.view === null ? null : await activeStorage(ctx.db, environment).catch(() => null);
  const storageSetUp = active ? await active.isSetUp().catch(() => null) : null;
  return {
    storage,
    storageSetUp,
    maxFileMb: {
      value: await attachmentLimitMb(ctx.db, environment),
      ceiling: maxFileMbCeiling(vercel),
      fromEnvironment: environment.ATTACHMENTS_MAX_FILE_MB !== undefined,
    },
    enabled: {
      value: enabled && storage.view !== null,
      offByEnvironment: fromEnvironment.state === 'off',
      storageChosen: storage.view !== null,
    },
    vercel,
  };
}

/**
 * Fills in the secrets a form left empty, from the saved storage, but only
 * for the place they were saved for: the same S3 service and access key, or
 * the same SFTP server, port and user. A changed place must be given them
 * again, so it can't receive a saved password.
 *
 * @param input - The form, its empty secrets `undefined`.
 * @param saved - The saved storage, with its secrets.
 * @returns The storage to try and save.
 * @throws {ServiceError} `invalid` when a secret is needed and can't be kept.
 */
function withSavedSecrets(input: StorageFormInput, saved: StorageConfig | null): StorageConfig {
  if (input.driver === 's3') {
    const savedBucket = saved?.driver === 's3' ? saved : null;
    const secretAccessKey = secretToSave({
      typed: input.secretAccessKey,
      saved: savedBucket?.secretAccessKey,
      samePlace:
        savedBucket?.endpoint === input.endpoint && savedBucket.accessKeyId === input.accessKeyId,
    });
    if (!secretAccessKey) {
      throw new ServiceError('invalid', 'errors.attachments.secretNeeded.s3');
    }
    return { ...input, secretAccessKey };
  }
  if (input.driver === 'sftp') {
    const { password: typedPassword, privateKey: typedKey, ...place } = input;
    const savedServer = saved?.driver === 'sftp' ? saved : null;
    // Typing either replaces both: the server is then signed in to with what was typed.
    const typedAny = typedPassword !== undefined || typedKey !== undefined;
    const samePlace =
      !typedAny &&
      savedServer?.host === place.host &&
      savedServer.port === place.port &&
      savedServer.username === place.username &&
      savedServer.hostKey === place.hostKey;
    const password = secretToSave({
      typed: typedPassword,
      saved: savedServer?.password,
      samePlace,
    });
    const privateKey = secretToSave({ typed: typedKey, saved: savedServer?.privateKey, samePlace });
    if (!password && !privateKey) {
      throw new ServiceError('invalid', 'errors.attachments.secretNeeded.sftp');
    }
    return { ...place, ...(password ? { password } : {}), ...(privateKey ? { privateKey } : {}) };
  }
  return input;
}

/**
 * Where a storage keeps files, for the audit log: never a secret.
 *
 * @param config - The storage.
 * @returns Its folder, its bucket and service, or its server and folder.
 */
function placeOf(config: StorageConfig): string {
  if (config.driver === 's3') {
    return `${config.bucket} at ${new URL(config.endpoint).host}`;
  }
  if (config.driver === 'sftp') {
    return `${config.host}:${config.port}${config.dir}`;
  }
  return config.dir;
}

/**
 * Saves where attached files are kept, once it has been tried: a small file
 * is written, read back and deleted there. Staff Admins only, with their
 * second step from the last 15 minutes (it decides where every company's
 * files go, and holds credentials), while the environment doesn't choose
 * one. Recorded in the audit log, without the secrets.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param input - The form, as sent.
 * @param environment - The server's environment.
 * @throws {ServiceError} `conflict` when the environment chooses the storage,
 *   `confirmation_required` without a recent confirmation, `rate_limited`,
 *   or `invalid` for settings that don't hold or a storage that fails its test.
 * @throws {ZodError} When the form doesn't pass its schema.
 */
export async function saveAttachmentStorage(
  ctx: ServiceContext,
  actor: Actor,
  input: unknown,
  environment: AttachmentEnvironment = env,
): Promise<void> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  if (storageFromEnvironment(environment).state !== 'unset') {
    throw new ServiceError('conflict', 'errors.attachments.storageFromEnvironment');
  }
  if (needsRecentConfirmation(actor)) {
    throw new ServiceError('confirmation_required', 'errors.attachments.confirmationRequired');
  }
  const form = storageFormSchema.parse(input);
  await assertRateLimit(ctx, `storage-check:user:${actor.id}`, RATE_LIMITS.storageChecksPerUser);
  const { 'attachments.storage': stored } = await readSettings(ctx.db, ['attachments.storage']);
  const config = withSavedSecrets(form, stored ? await openStorage(stored) : null);
  const surroundings = {
    production: environment.NODE_ENV === 'production',
    vercel: environment.VERCEL === '1',
  };
  const [problem] = storageProblems(config, surroundings);
  if (problem) {
    throw new ServiceError('invalid', `errors.attachments.storageProblem.${problem}`);
  }
  await checkBeforeSaving(
    'A storage',
    () => checkStorage(storageFor(config)),
    (error) => (error instanceof StorageError ? error.failure : null),
    (failure) => `errors.attachments.storageCheck.${failure}`,
  );
  const sealed = await sealStorage(config);
  await ctx.db.transaction(async (tx) => {
    await writeSettings(tx, { 'attachments.storage': sealed });
    await recordEvent(
      ctx,
      {
        action: 'attachment_storage_changed',
        actorUserId: actor.id,
        details: { staff: true, driver: config.driver, place: placeOf(config) },
      },
      tx,
    );
  });
}

/**
 * Saves the largest file anyone may attach, while the environment doesn't
 * choose it. Not a security change, like the other staff settings.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param input - The megabytes, as the form sent them.
 * @param environment - The server's environment.
 * @returns The saved limit.
 * @throws {ServiceError} `conflict` when the environment chooses it.
 * @throws {ZodError} When it isn't a whole number from 1 to the ceiling.
 */
export async function saveAttachmentLimit(
  ctx: ServiceContext,
  actor: Actor,
  input: unknown,
  environment: AttachmentEnvironment = env,
): Promise<number> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  if (environment.ATTACHMENTS_MAX_FILE_MB !== undefined) {
    throw new ServiceError('conflict', 'errors.attachments.limitFromEnvironment');
  }
  const maxFileMb = maxFileMbSchema(maxFileMbCeiling(environment.VERCEL === '1')).parse(input);
  await ctx.db.transaction((tx) => writeSettings(tx, { 'attachments.max_file_mb': maxFileMb }));
  return maxFileMb;
}

/**
 * Turns "People can attach files" on or off. Off hides every Attach button
 * and refuses uploads; files already attached stay where they are and can
 * still be downloaded. Turning it on needs a storage (chosen here or by the
 * server's environment), and is refused while the environment turned
 * attachments off. Staff Admins only, like the tab's other settings, without
 * a confirmation or an audit event: it gives nobody a way in.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param on - Whether people can attach files.
 * @param environment - The server's environment.
 * @throws {ServiceError} `conflict` while the environment turned attachments
 *   off, or when turning it on without a storage.
 */
export async function saveAttachmentsEnabled(
  ctx: ServiceContext,
  actor: Actor,
  on: boolean,
  environment: AttachmentEnvironment = env,
): Promise<void> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  const fromEnvironment = storageFromEnvironment(environment);
  if (fromEnvironment.state === 'off') {
    throw new ServiceError('conflict', 'errors.attachments.offByEnvironment');
  }
  await ctx.db.transaction(async (tx) => {
    if (on && fromEnvironment.state !== 'set') {
      const { 'attachments.storage': stored } = await readSettings(tx, ['attachments.storage']);
      if (!stored) {
        throw new ServiceError('conflict', 'errors.attachments.storageFirst');
      }
    }
    await writeSettings(tx, { 'attachments.enabled': on });
  });
}

/**
 * Sets up the storage files go to now as Adiutor's, on purpose: for a
 * folder (local disk or SFTP), writes its marker, after trying it as a save
 * would. It's how a staff Admin sets up a storage the server's environment
 * chooses, which no save in Settings tries (one chosen here is set up when
 * it's saved). Only for the place the environment or Settings chose, with
 * the staff Admin's second step from the last 15 minutes, and recorded in
 * the audit log.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `staff:manage`.
 * @param environment - The server's environment.
 * @throws {ServiceError} `conflict` without a storage, `confirmation_required`
 *   without a recent confirmation, `rate_limited`, or `invalid` for a
 *   storage that fails its test.
 */
export async function setUpStorage(
  ctx: ServiceContext,
  actor: Actor,
  environment: AttachmentEnvironment = env,
): Promise<void> {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'staff:manage');
  if (needsRecentConfirmation(actor)) {
    throw new ServiceError('confirmation_required', 'errors.attachments.confirmationRequired');
  }
  await assertRateLimit(ctx, `storage-check:user:${actor.id}`, RATE_LIMITS.storageChecksPerUser);
  const fromEnvironment = storageFromEnvironment(environment);
  let config: StorageConfig | null = null;
  if (fromEnvironment.state === 'set') {
    ({ config } = fromEnvironment);
  } else if (fromEnvironment.state === 'unset') {
    const { 'attachments.storage': stored } = await readSettings(ctx.db, ['attachments.storage']);
    config = stored ? await openStorage(stored) : null;
  }
  if (!config) {
    throw new ServiceError('conflict', 'errors.attachments.storageFirst');
  }
  const chosen = config;
  await checkBeforeSaving(
    'A storage',
    () => checkStorage(storageFor(chosen)),
    (error) => (error instanceof StorageError ? error.failure : null),
    (failure) => `errors.attachments.storageCheck.${failure}`,
  );
  await recordEvent(ctx, {
    action: 'attachment_storage_set_up',
    actorUserId: actor.id,
    details: { staff: true, driver: chosen.driver, place: placeOf(chosen) },
  });
}
