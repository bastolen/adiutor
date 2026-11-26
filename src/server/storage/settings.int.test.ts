/**
 * @file Integration tests for the Attachments tab of Settings: choosing
 * where files are kept (tried first, secrets encrypted, kept only for their
 * place, refused while the environment chooses, with a confirmation, a limit
 * and an audit event), the largest file, and the storage files go to.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { setting } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import {
  auditEvents,
  createStaffSettings,
  fillRateLimitBucket,
  memberActor,
  createCompany,
  setupTestContext,
  staffActor,
  TEST_BUCKET,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import { ServiceError } from '../errors';
import { RATE_LIMITS } from '../rate-limit';
import { activeStorage } from './active';
import { openStorage, sealStorage } from './secrets';
import {
  attachmentLimitMb,
  getAttachmentSettings,
  saveAttachmentLimit,
  saveAttachmentsEnabled,
  saveAttachmentStorage,
} from './settings';

const { ctx, db } = setupTestContext();

/** An environment that chooses nothing, so Settings decides. */
const SETTINGS_DECIDE = {};

/** A folder of the test's own. */
let folder: string;

/** A staff Admin without a second step, so nothing needs a recent confirmation. */
let admin: Actor;

beforeEach(async () => {
  await createStaffSettings(db);
  admin = await staffActor(db, 'platform_admin');
  folder = await mkdtemp(join(tmpdir(), 'adiutor-settings-'));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

/**
 * The storage as Settings keeps it.
 *
 * @returns Its stored value.
 */
async function storedStorage(): Promise<unknown> {
  const row = await db.select().from(setting).where(eq(setting.key, 'attachments.storage'));
  return row[0]?.value ?? null;
}

/**
 * The service error a call fails with.
 *
 * @param work - The call.
 * @returns The error.
 */
async function refusal(work: () => Promise<unknown>): Promise<ServiceError> {
  const error = await work().then(
    () => null,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof ServiceError)) {
    throw new Error(`Expected a service error, got ${String(error)}.`);
  }
  return error;
}

describe('saveAttachmentStorage', () => {
  it('tries a folder, saves it and records it in the audit log', async () => {
    await saveAttachmentStorage(ctx, admin, { driver: 'local', dir: folder }, SETTINGS_DECIDE);

    expect(await storedStorage()).toEqual({ driver: 'local', dir: folder });
    const event = firstRow(
      await auditEvents(db, { action: 'attachment_storage_changed' }),
      'the event',
    );
    expect(event.actorUserId).toBe(admin.id);
    expect(event.details).toEqual({ staff: true, driver: 'local', place: folder });
    // The storage files go to now is that folder.
    expect((await activeStorage(db, SETTINGS_DECIDE))?.driver).toBe('local');
  });

  it('keeps a bucket’s secret encrypted, and never in the audit log', async () => {
    await saveAttachmentStorage(ctx, admin, TEST_BUCKET, SETTINGS_DECIDE);

    const stored = (await storedStorage()) as typeof TEST_BUCKET;
    expect(stored.secretAccessKey).not.toContain(TEST_BUCKET.secretAccessKey);
    expect(await openStorage(stored)).toEqual(TEST_BUCKET);
    const [event] = await auditEvents(db, { action: 'attachment_storage_changed' });
    expect(JSON.stringify(event?.details)).not.toContain(TEST_BUCKET.secretAccessKey);
  });

  it('keeps a saved secret for the same service and key only', async () => {
    await saveAttachmentStorage(ctx, admin, TEST_BUCKET, SETTINGS_DECIDE);
    const kept = { ...TEST_BUCKET, secretAccessKey: '' };

    // Another bucket on the same service, with the same key: the secret stays.
    await saveAttachmentStorage(ctx, admin, { ...kept, bucket: 'adiutor' }, SETTINGS_DECIDE);
    expect(await openStorage((await storedStorage()) as typeof TEST_BUCKET)).toMatchObject({
      bucket: 'adiutor',
      secretAccessKey: TEST_BUCKET.secretAccessKey,
    });

    // Another service, or another key, must be given its secret.
    const elsewhere = await refusal(() =>
      saveAttachmentStorage(
        ctx,
        admin,
        { ...kept, endpoint: 'http://localhost:8333' },
        SETTINGS_DECIDE,
      ),
    );
    expect(elsewhere.key).toBe('errors.attachments.secretNeeded.s3');
    const otherKey = await refusal(() =>
      saveAttachmentStorage(ctx, admin, { ...kept, accessKeyId: 'someone-else' }, SETTINGS_DECIDE),
    );
    expect(otherKey.key).toBe('errors.attachments.secretNeeded.s3');
  });

  it('refuses a storage that fails its test, naming only the kind of failure', async () => {
    const wrongSecret = await refusal(() =>
      saveAttachmentStorage(
        ctx,
        admin,
        { ...TEST_BUCKET, secretAccessKey: 'not-the-secret' },
        SETTINGS_DECIDE,
      ),
    );
    expect(wrongSecret).toMatchObject({
      code: 'invalid',
      key: 'errors.attachments.storageCheck.refused',
    });

    const missing = await refusal(() =>
      saveAttachmentStorage(
        ctx,
        admin,
        { driver: 'local', dir: join(folder, 'missing') },
        SETTINGS_DECIDE,
      ),
    );
    expect(missing.key).toBe('errors.attachments.storageCheck.not_found');
    expect(await storedStorage()).toBeNull();
  });

  it('refuses what can’t run where Adiutor runs', async () => {
    const relative = await refusal(() =>
      saveAttachmentStorage(ctx, admin, { driver: 'local', dir: 'attachments' }, SETTINGS_DECIDE),
    );
    expect(relative.key).toBe('errors.attachments.storageProblem.relative_folder');
    const onVercel = await refusal(() =>
      saveAttachmentStorage(ctx, admin, { driver: 'local', dir: folder }, { VERCEL: '1' }),
    );
    expect(onVercel.key).toBe('errors.attachments.storageProblem.local_on_vercel');
    const plain = await refusal(() =>
      saveAttachmentStorage(
        ctx,
        admin,
        { ...TEST_BUCKET, endpoint: 'http://files.adiutor.test' },
        { NODE_ENV: 'production' },
      ),
    );
    expect(plain.key).toBe('errors.attachments.storageProblem.insecure_endpoint');
  });

  it('can’t change a storage the environment chooses, or turned off', async () => {
    const chosen = await refusal(() =>
      saveAttachmentStorage(
        ctx,
        admin,
        { driver: 'local', dir: folder },
        {
          ATTACHMENTS_STORAGE: 'local',
          ATTACHMENTS_DIR: folder,
        },
      ),
    );
    expect(chosen).toMatchObject({
      code: 'conflict',
      key: 'errors.attachments.storageFromEnvironment',
    });
    const off = await refusal(() =>
      saveAttachmentStorage(
        ctx,
        admin,
        { driver: 'local', dir: folder },
        { ATTACHMENTS_STORAGE: 'off' },
      ),
    );
    expect(off.code).toBe('conflict');
  });

  it('needs a recent confirmation once the staff Admin has a second step', async () => {
    const unconfirmed = { ...admin, canConfirmSessions: true, mfaConfirmedUntil: null };
    const error = await refusal(() =>
      saveAttachmentStorage(ctx, unconfirmed, { driver: 'local', dir: folder }, SETTINGS_DECIDE),
    );
    expect(error).toMatchObject({
      code: 'confirmation_required',
      key: 'errors.attachments.confirmationRequired',
    });

    const confirmed = { ...unconfirmed, mfaConfirmedUntil: new Date(Date.now() + 60_000) };
    await saveAttachmentStorage(ctx, confirmed, { driver: 'local', dir: folder }, SETTINGS_DECIDE);
    expect(await storedStorage()).toEqual({ driver: 'local', dir: folder });
  });

  it('limits how often a staff Admin tries storages', async () => {
    await fillRateLimitBucket(
      db,
      `storage-check:user:${admin.id}`,
      RATE_LIMITS.storageChecksPerUser.limit,
    );
    const error = await refusal(() =>
      saveAttachmentStorage(ctx, admin, { driver: 'local', dir: folder }, SETTINGS_DECIDE),
    );
    expect(error.code).toBe('rate_limited');
  });

  it('is for staff Admins only, and refuses a form that doesn’t hold', async () => {
    const company = await createCompany(db);
    const companyAdmin = await memberActor(db, company.id, 'admin');
    const manager = await staffActor(db, 'manager');
    const refusals = await Promise.all(
      [companyAdmin, manager].map((actor) =>
        refusal(() => saveAttachmentStorage(ctx, actor, {}, SETTINGS_DECIDE)),
      ),
    );
    expect(refusals.map((error) => error.code)).toEqual(['forbidden', 'forbidden']);
    await expect(
      saveAttachmentStorage(ctx, admin, { driver: 'ftp', dir: folder }, SETTINGS_DECIDE),
    ).rejects.toBeInstanceOf(ZodError);
  });
});

describe('getAttachmentSettings', () => {
  it('shows the saved storage without its secret, or nothing yet', async () => {
    expect(await getAttachmentSettings(ctx, admin, SETTINGS_DECIDE)).toEqual({
      storage: { source: 'settings', view: null },
      maxFileMb: { value: 10, ceiling: 50, fromEnvironment: false },
      enabled: { value: false, offByEnvironment: false, storageChosen: false },
      vercel: false,
    });

    await saveAttachmentStorage(ctx, admin, TEST_BUCKET, SETTINGS_DECIDE);
    const { storage } = await getAttachmentSettings(ctx, admin, SETTINGS_DECIDE);
    expect(storage).toEqual({
      source: 'settings',
      view: { ...TEST_BUCKET, secretAccessKey: undefined },
    });
    expect(JSON.stringify(storage)).not.toContain('secretAccessKey');
  });

  it('shows what the environment chose, or that it turned attachments off', async () => {
    const { storage, maxFileMb } = await getAttachmentSettings(ctx, admin, {
      ATTACHMENTS_STORAGE: 'local',
      ATTACHMENTS_DIR: folder,
      ATTACHMENTS_MAX_FILE_MB: 25,
    });
    expect(storage).toEqual({ source: 'environment', view: { driver: 'local', dir: folder } });
    expect(maxFileMb).toEqual({ value: 25, ceiling: 50, fromEnvironment: true });
    expect(
      (await getAttachmentSettings(ctx, admin, { ATTACHMENTS_STORAGE: 'off' })).storage,
    ).toEqual({ source: 'environment', view: null });
  });
});

describe('saveAttachmentsEnabled', () => {
  it('turns attaching on once a storage is chosen, and off again', async () => {
    const before = await refusal(() => saveAttachmentsEnabled(ctx, admin, true, SETTINGS_DECIDE));
    expect(before).toMatchObject({ code: 'conflict', key: 'errors.attachments.storageFirst' });

    await saveAttachmentStorage(ctx, admin, { driver: 'local', dir: folder }, SETTINGS_DECIDE);
    await saveAttachmentsEnabled(ctx, admin, true, SETTINGS_DECIDE);
    expect((await getAttachmentSettings(ctx, admin, SETTINGS_DECIDE)).enabled).toEqual({
      value: true,
      offByEnvironment: false,
      storageChosen: true,
    });

    await saveAttachmentsEnabled(ctx, admin, false, SETTINGS_DECIDE);
    expect((await getAttachmentSettings(ctx, admin, SETTINGS_DECIDE)).enabled.value).toBe(false);
  });

  it('takes a storage the environment chooses, and can’t turn on what it turned off', async () => {
    const environment = { ATTACHMENTS_STORAGE: 'local', ATTACHMENTS_DIR: folder } as const;
    await saveAttachmentsEnabled(ctx, admin, true, environment);
    expect((await getAttachmentSettings(ctx, admin, environment)).enabled.value).toBe(true);

    const off = { ATTACHMENTS_STORAGE: 'off' } as const;
    const error = await refusal(() => saveAttachmentsEnabled(ctx, admin, true, off));
    expect(error).toMatchObject({ code: 'conflict', key: 'errors.attachments.offByEnvironment' });
    // Saved on, and still off while the environment says so.
    expect((await getAttachmentSettings(ctx, admin, off)).enabled).toEqual({
      value: false,
      offByEnvironment: true,
      storageChosen: false,
    });
  });

  it('is for staff Admins only', async () => {
    const manager = await staffActor(db, 'manager');
    const error = await refusal(() => saveAttachmentsEnabled(ctx, manager, false, SETTINGS_DECIDE));
    expect(error.code).toBe('forbidden');
  });
});

describe('saveAttachmentLimit', () => {
  it('saves a whole number of megabytes, up to 4 on Vercel', async () => {
    expect(await saveAttachmentLimit(ctx, admin, '25', SETTINGS_DECIDE)).toBe(25);
    expect(await attachmentLimitMb(db, SETTINGS_DECIDE)).toBe(25);
    // Whatever is saved, Vercel's ceiling holds.
    expect(await attachmentLimitMb(db, { VERCEL: '1' })).toBe(4);
    await expect(saveAttachmentLimit(ctx, admin, '5', { VERCEL: '1' })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(saveAttachmentLimit(ctx, admin, '2.5', SETTINGS_DECIDE)).rejects.toBeInstanceOf(
      ZodError,
    );
  });

  it('can’t change a limit the environment chooses', async () => {
    const error = await refusal(() =>
      saveAttachmentLimit(ctx, admin, '25', { ATTACHMENTS_MAX_FILE_MB: 10 }),
    );
    expect(error).toMatchObject({
      code: 'conflict',
      key: 'errors.attachments.limitFromEnvironment',
    });
  });
});

describe('activeStorage', () => {
  it('takes the environment’s storage over the saved one, and none when it’s off', async () => {
    await saveAttachmentStorage(ctx, admin, { driver: 'local', dir: folder }, SETTINGS_DECIDE);
    const fromEnvironment = await activeStorage(db, {
      ATTACHMENTS_STORAGE: 's3',
      ATTACHMENTS_S3_ENDPOINT: TEST_BUCKET.endpoint,
      ATTACHMENTS_S3_BUCKET: TEST_BUCKET.bucket,
      ATTACHMENTS_S3_ACCESS_KEY_ID: TEST_BUCKET.accessKeyId,
      ATTACHMENTS_S3_SECRET_ACCESS_KEY: TEST_BUCKET.secretAccessKey,
      ATTACHMENTS_S3_FORCE_PATH_STYLE: 'true',
    });
    expect(fromEnvironment?.driver).toBe('s3');
    expect(await activeStorage(db, { ATTACHMENTS_STORAGE: 'off' })).toBeNull();
    expect((await activeStorage(db, SETTINGS_DECIDE))?.driver).toBe('local');
  });
});

describe('the secrets', () => {
  it('still decrypt after the auth secret is rotated, as long as the old one is kept', async () => {
    const old = 'o'.repeat(32);
    const sealed = await sealStorage(TEST_BUCKET, old);
    const rotated = {
      keys: new Map([
        [2, 'n'.repeat(32)],
        [1, 'v'.repeat(32)],
      ]),
      currentVersion: 2,
      legacySecret: old,
    };
    expect(await openStorage(sealed, rotated)).toEqual(TEST_BUCKET);
    // Sealed again, it's under the newest secret.
    const resealed = await sealStorage(TEST_BUCKET, rotated);
    expect(await openStorage(resealed, { ...rotated, legacySecret: 'x'.repeat(32) })).toEqual(
      TEST_BUCKET,
    );
  });
});
