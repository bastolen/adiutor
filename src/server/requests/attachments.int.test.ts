/**
 * @file Integration tests for uploading a file to attach: off until a
 * storage is chosen and attaching is turned on, for whoever may write
 * requests somewhere, its name, size and bytes checked, the limits per hour
 * and per day, the row and the file kept together, and work done while
 * signed in as someone recorded.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { requestAttachment } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import {
  createCompany,
  createStaffSettings,
  fillRateLimitBucket,
  memberActor,
  saveSettings,
  setupTestContext,
  staffActor,
  storeAttachment,
} from '../../../tests/integration/helpers';
import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { ServiceError } from '../errors';
import { RATE_LIMITS } from '../rate-limit';
import { attachmentKey, type FileStorage, StorageError } from '../storage';
import { DAILY_UPLOAD_BYTES, uploadAttachment } from './attachments';

const { ctx, db, storage } = setupTestContext();

/** A PNG's signature and a little more, as a screenshot starts. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

/** Someone at a company who may raise requests. */
let client: Actor;

beforeEach(async () => {
  await createStaffSettings(db);
  await saveSettings(db, { 'attachments.enabled': true });
  const company = await createCompany(db);
  client = await memberActor(db, company.id, 'client');
});

/**
 * The test's context with another storage.
 *
 * @param chosen - The storage, or `null` for none chosen.
 * @returns The context.
 */
function withStorage(chosen: FileStorage | null): ServiceContext {
  return {
    ...ctx,
    /**
     * The storage this test chose.
     *
     * @returns It.
     */
    storage: async () => chosen,
  };
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

/**
 * The text of a stored file.
 *
 * @param id - The attachment's ID.
 * @returns Its text, or `null` when it isn't stored.
 */
async function storedText(id: string): Promise<string | null> {
  const file = await storage.get(attachmentKey(id));
  return file ? new Response(file.body).text() : null;
}

describe('uploadAttachment', () => {
  it('stores a file and its row, unsent, with its cleaned name and type', async () => {
    const uploaded = await uploadAttachment(ctx, client, {
      name: 'C:\\Users\\Ann\\Screenshot\u202E.png',
      bytes: PNG,
    });

    expect(uploaded).toEqual({
      id: expect.any(String),
      name: 'Screenshot.png',
      size: PNG.byteLength,
      contentType: 'image/png',
      thumbnail: true,
    });
    const row = firstRow(
      await db.select().from(requestAttachment).where(eq(requestAttachment.id, uploaded.id)),
      'the row',
    );
    expect(row).toMatchObject({ requestId: null, uploadedBy: client.id, signedInAs: false });
    expect(row.uploadedAt).toBeInstanceOf(Date);
    expect((await storage.get(attachmentKey(uploaded.id)))?.size).toBe(PNG.byteLength);
  });

  it('is off until attaching is turned on and a storage is chosen', async () => {
    await saveSettings(db, { 'attachments.enabled': false });
    const off = await refusal(() => uploadAttachment(ctx, client, { name: 'a.png', bytes: PNG }));
    expect(off).toMatchObject({ code: 'conflict', key: 'errors.attachments.off' });

    await saveSettings(db, { 'attachments.enabled': true });
    const withoutStorage = withStorage(null);
    expect(
      (await refusal(() => uploadAttachment(withoutStorage, client, { name: 'a.png', bytes: PNG })))
        .key,
    ).toBe('errors.attachments.off');
  });

  it('is for whoever may write requests somewhere, staff who work on them included', async () => {
    const company = await createCompany(db, { name: 'Adiutor Tests B' });
    const watcher = await memberActor(db, company.id, 'watcher');
    const finance = await staffActor(db, 'finance');
    const support = await staffActor(db, 'support');
    const refusals = await Promise.all(
      [watcher, finance].map((actor) =>
        refusal(() => uploadAttachment(ctx, actor, { name: 'a.png', bytes: PNG })),
      ),
    );
    expect(refusals.map((error) => error.code)).toEqual(['forbidden', 'forbidden']);
    await expect(
      uploadAttachment(ctx, support, { name: 'a.png', bytes: PNG }),
    ).resolves.toMatchObject({
      name: 'a.png',
    });
  });

  it('refuses a type off the list, an empty file, one too large and one that isn\u2019t its type', async () => {
    expect(
      (await refusal(() => uploadAttachment(ctx, client, { name: 'setup.exe', bytes: PNG }))).key,
    ).toBe('errors.attachments.typeNotAllowed');
    expect(
      (
        await refusal(() =>
          uploadAttachment(ctx, client, { name: 'a.png', bytes: new Uint8Array() }),
        )
      ).key,
    ).toBe('errors.attachments.empty');

    await saveSettings(db, { 'attachments.max_file_mb': 1 });
    const large = new Uint8Array(1024 * 1024 + 1);
    large.set(PNG);
    const tooLarge = await refusal(() =>
      uploadAttachment(ctx, client, { name: 'a.png', bytes: large }),
    );
    expect(tooLarge).toMatchObject({ key: 'errors.attachments.tooLarge', values: { maximum: 1 } });

    const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');
    expect(
      (await refusal(() => uploadAttachment(ctx, client, { name: 'photo.png', bytes: html }))).key,
    ).toBe('errors.attachments.notItsType');
    expect(await db.select().from(requestAttachment)).toEqual([]);
  });

  it('limits uploads per hour and bytes per day, counted for whoever really acts', async () => {
    const staff = await staffActor(db, 'support');
    // A day's worth, uploaded by the staff member while signed in as the client.
    await storeAttachment(db, storage, {
      uploadedBy: client.id,
      signedInAsStaffId: staff.id,
      bytes: new Uint8Array(1),
    });
    await db.update(requestAttachment).set({ size: DAILY_UPLOAD_BYTES });

    // The client's own allowance is untouched; the staff member's is used up.
    await expect(
      uploadAttachment(ctx, client, { name: 'a.png', bytes: PNG }),
    ).resolves.toBeTruthy();
    expect(
      (await refusal(() => uploadAttachment(ctx, staff, { name: 'a.png', bytes: PNG }))).key,
    ).toBe('errors.attachments.dailyTotal');

    const busy = await memberActor(
      db,
      (await createCompany(db, { name: 'Adiutor Tests C' })).id,
      'client',
    );
    await fillRateLimitBucket(
      db,
      `attachment-upload:user:${busy.id}`,
      RATE_LIMITS.attachmentUploadsPerUser.limit,
    );
    expect(
      (await refusal(() => uploadAttachment(ctx, busy, { name: 'a.png', bytes: PNG }))).code,
    ).toBe('rate_limited');
  });

  it('records the staff member when they upload while signed in as the user', async () => {
    const staff = await staffActor(db, 'support');
    const signedInAs = {
      ...client,
      signedInAs: {
        staffId: staff.id,
        staffName: 'Sam Support',
        endsAt: new Date(Date.now() + 60_000),
        returnTo: '/dashboard',
        staffPermissions: [],
      },
    };
    const { id } = await uploadAttachment(ctx, signedInAs, { name: 'a.png', bytes: PNG });
    const row = firstRow(
      await db.select().from(requestAttachment).where(eq(requestAttachment.id, id)),
      'the row',
    );
    expect(row).toMatchObject({
      uploadedBy: client.id,
      signedInAs: true,
      signedInAsStaffId: staff.id,
    });
  });

  it('keeps no row when the storage fails', async () => {
    const failing: FileStorage = {
      ...storage,
      /** Fails as an unreachable storage does. */
      put: async () => {
        throw new StorageError('unreachable');
      },
    };
    await expect(
      uploadAttachment(withStorage(failing), client, {
        name: 'a.png',
        bytes: PNG,
      }),
    ).rejects.toMatchObject({ failure: 'unreachable' });
    expect(await db.select().from(requestAttachment)).toEqual([]);
  });

  it('keeps text as it was written', async () => {
    const log = new TextEncoder().encode('2026-11-25 10:42 printer offline\n');
    const { id, contentType } = await uploadAttachment(ctx, client, {
      name: 'printer.log',
      bytes: log,
    });
    expect(contentType).toBe('text/plain');
    expect(await storedText(id)).toBe('2026-11-25 10:42 printer offline\n');
  });
});
