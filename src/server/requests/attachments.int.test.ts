/**
 * @file Integration tests for uploading a file to attach: off until a
 * storage is chosen and attaching is turned on, for whoever may write
 * requests somewhere, its name, size and bytes checked (nothing read before
 * the checks that don't need it), the limits per hour, per day and at once,
 * the row and the file kept together, and work done while signed in as
 * someone recorded.
 */
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { company as companyTable, requestAttachment } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import { UPLOADS_AT_ONCE } from '@/lib/requests';

import { simplePdf } from '../../../tests/files/pdfs';
import { zipOf } from '../../../tests/files/zips';
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
import { attachmentKey, type FileStorage, previewKey, StorageError } from '../storage';
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
 * Uploads a file as the route does: announced with its size, then read.
 *
 * @param context - Service context.
 * @param actor - Who uploads it.
 * @param name - Its name.
 * @param bytes - Its bytes.
 * @returns The uploaded file.
 */
function upload(
  context: ServiceContext,
  actor: Actor,
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
) {
  return uploadAttachment(context, actor, {
    name,
    size: bytes.byteLength,
    /**
     * Reads the file's bytes.
     *
     * @returns The bytes.
     */
    read: async () => bytes,
  });
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
    const uploaded = await upload(ctx, client, 'C:\\Users\\Ann\\Screenshot\u202E.png', PNG);

    expect(uploaded).toEqual({
      id: expect.any(String),
      name: 'Screenshot.png',
      size: PNG.byteLength,
      contentType: 'image/png',
      // A signature alone is no image to draw.
      preview: false,
    });
    const row = firstRow(
      await db.select().from(requestAttachment).where(eq(requestAttachment.id, uploaded.id)),
      'the row',
    );
    expect(row).toMatchObject({
      requestId: null,
      uploadedBy: client.id,
      signedInAs: false,
      preview: 'none',
    });
    expect(row.uploadedAt).toBeInstanceOf(Date);
    expect((await storage.get(attachmentKey(uploaded.id)))?.size).toBe(PNG.byteLength);
    expect(await storage.get(previewKey(uploaded.id))).toBeNull();
  });

  it('draws a small preview of an image and keeps it next to the file', async () => {
    const photo = new Uint8Array(
      await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#336699' } })
        .jpeg()
        .toBuffer(),
    );

    const uploaded = await upload(ctx, client, 'photo.jpg', photo);

    expect(uploaded.preview).toBe(true);
    const [row] = await db
      .select({ preview: requestAttachment.preview })
      .from(requestAttachment)
      .where(eq(requestAttachment.id, uploaded.id));
    expect(row?.preview).toBe('drawn');
    const stored = await storage.get(previewKey(uploaded.id));
    const preview = new Uint8Array(await new Response(stored?.body).arrayBuffer());
    expect(await sharp(preview).metadata()).toMatchObject({
      format: 'webp',
      width: 480,
      height: 360,
    });
  });

  it('draws a preview of a PDF’s first page', async () => {
    const uploaded = await upload(ctx, client, 'invoice.pdf', simplePdf());

    expect(uploaded.preview).toBe(true);
    const stored = await storage.get(previewKey(uploaded.id));
    const preview = new Uint8Array(await new Response(stored?.body).arrayBuffer());
    expect(await sharp(preview).metadata()).toMatchObject({ format: 'webp', height: 480 });
  });

  it('draws an OpenDocument file’s preview from the thumbnail it carries', async () => {
    const thumbnail = new Uint8Array(
      await sharp({ create: { width: 181, height: 256, channels: 3, background: '#f4f4f4' } })
        .png()
        .toBuffer(),
    );
    const odt = zipOf([
      { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' },
      { name: 'Thumbnails/thumbnail.png', data: thumbnail },
    ]);

    expect((await upload(ctx, client, 'plan.odt', odt)).preview).toBe(true);
    // One without a thumbnail keeps its icon.
    const bare = zipOf([{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' }]);
    expect((await upload(ctx, client, 'bare.odt', bare)).preview).toBe(false);
  });

  it('draws no preview for a kind of file that keeps its icon', async () => {
    const uploaded = await upload(ctx, client, 'printer.log', new TextEncoder().encode('offline'));
    const [row] = await db
      .select({ preview: requestAttachment.preview })
      .from(requestAttachment)
      .where(eq(requestAttachment.id, uploaded.id));
    expect(row?.preview).toBeNull();
    expect(uploaded.preview).toBe(false);
  });

  it('still uploads when the preview can’t be stored, leaving it for the previews job', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const refusingPreviews: FileStorage = {
      ...storage,
      /**
       * Stores files, and fails for previews.
       *
       * @param key - Where.
       * @param bytes - What.
       * @param contentType - Its type.
       */
      put: async (key, bytes, contentType) => {
        if (key.startsWith('previews/')) {
          throw new StorageError('timed_out');
        }
        await storage.put(key, bytes, contentType);
      },
    };
    const photo = new Uint8Array(
      await sharp({ create: { width: 40, height: 30, channels: 3, background: '#336699' } })
        .png()
        .toBuffer(),
    );

    const uploaded = await upload(withStorage(refusingPreviews), client, 'small.png', photo);

    const [row] = await db
      .select({ preview: requestAttachment.preview, uploadedAt: requestAttachment.uploadedAt })
      .from(requestAttachment)
      .where(eq(requestAttachment.id, uploaded.id));
    expect(row?.uploadedAt).toBeInstanceOf(Date);
    expect(row?.preview).toBeNull();
    expect(error).toHaveBeenCalledWith('A preview could not be stored yet:', 'timed_out');
    error.mockRestore();
  });

  it('is off until attaching is turned on and a storage is chosen', async () => {
    await saveSettings(db, { 'attachments.enabled': false });
    const off = await refusal(() => upload(ctx, client, 'a.png', PNG));
    expect(off).toMatchObject({ code: 'conflict', key: 'errors.attachments.off' });

    await saveSettings(db, { 'attachments.enabled': true });
    const withoutStorage = withStorage(null);
    expect((await refusal(() => upload(withoutStorage, client, 'a.png', PNG))).key).toBe(
      'errors.attachments.off',
    );
  });

  it('is for whoever may write requests somewhere, staff who work on them included', async () => {
    const company = await createCompany(db, { name: 'Adiutor Tests B' });
    const watcher = await memberActor(db, company.id, 'watcher');
    const finance = await staffActor(db, 'finance');
    const support = await staffActor(db, 'support');
    const refusals = await Promise.all(
      [watcher, finance].map((actor) => refusal(() => upload(ctx, actor, 'a.png', PNG))),
    );
    expect(refusals.map((error) => error.code)).toEqual(['forbidden', 'forbidden']);
    await expect(upload(ctx, support, 'a.png', PNG)).resolves.toMatchObject({
      name: 'a.png',
    });
  });

  it('lets the staff upload for their internal requests without a company to raise one in', async () => {
    // No company the staff could raise a request in, only their internal requests.
    await db.update(companyTable).set({ deactivatedAt: new Date() });
    const support = await staffActor(db, 'support');
    await expect(upload(ctx, support, 'a.png', PNG)).resolves.toBeTruthy();
    expect((await refusal(() => upload(ctx, client, 'a.png', PNG))).code).toBe('forbidden');
  });

  it('refuses a type off the list, an empty file, one too large and one that isn\u2019t its type', async () => {
    expect((await refusal(() => upload(ctx, client, 'setup.exe', PNG))).key).toBe(
      'errors.attachments.typeNotAllowed',
    );
    expect((await refusal(() => upload(ctx, client, 'a.png', new Uint8Array()))).key).toBe(
      'errors.attachments.empty',
    );

    await saveSettings(db, { 'attachments.max_file_mb': 1 });
    const large = new Uint8Array(1024 * 1024 + 1);
    large.set(PNG);
    const tooLarge = await refusal(() => upload(ctx, client, 'a.png', large));
    expect(tooLarge).toMatchObject({ key: 'errors.attachments.tooLarge', values: { maximum: 1 } });

    const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');
    expect((await refusal(() => upload(ctx, client, 'photo.png', html))).key).toBe(
      'errors.attachments.notItsType',
    );
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
    await expect(upload(ctx, client, 'a.png', PNG)).resolves.toBeTruthy();
    expect((await refusal(() => upload(ctx, staff, 'a.png', PNG))).key).toBe(
      'errors.attachments.dailyTotal',
    );

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
    expect((await refusal(() => upload(ctx, busy, 'a.png', PNG))).code).toBe('rate_limited');
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
    const { id } = await upload(ctx, signedInAs, 'a.png', PNG);
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

  it('keeps the row unfinished when the storage fails, for the cleanup job', async () => {
    const failing: FileStorage = {
      ...storage,
      /** Fails as an unreachable storage does. */
      put: async () => {
        throw new StorageError('unreachable');
      },
    };
    await expect(upload(withStorage(failing), client, 'a.png', PNG)).rejects.toMatchObject({
      failure: 'unreachable',
    });
    // The storage may have kept the file all the same: the job deletes it and the row after an hour.
    const rows = await db.select().from(requestAttachment);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.uploadedAt).toBeNull();
  });

  it('reads nothing of a file before the checks that don’t need it pass', async () => {
    const read = vi.fn(async () => PNG);
    await saveSettings(db, { 'attachments.enabled': false });
    await refusal(() =>
      uploadAttachment(ctx, client, { name: 'a.png', size: PNG.byteLength, read }),
    );
    await saveSettings(db, { 'attachments.enabled': true });
    await refusal(() =>
      uploadAttachment(ctx, client, { name: 'setup.exe', size: PNG.byteLength, read }),
    );
    await fillRateLimitBucket(
      db,
      `attachment-upload:user:${client.id}`,
      RATE_LIMITS.attachmentUploadsPerUser.limit,
    );
    await refusal(() =>
      uploadAttachment(ctx, client, { name: 'a.png', size: PNG.byteLength, read }),
    );
    expect(read).not.toHaveBeenCalled();
    expect(await db.select().from(requestAttachment)).toEqual([]);
  });

  it('counts a file refused for its bytes towards the hourly limit, and keeps no row', async () => {
    await fillRateLimitBucket(
      db,
      `attachment-upload:user:${client.id}`,
      RATE_LIMITS.attachmentUploadsPerUser.limit - 1,
    );
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    expect((await refusal(() => upload(ctx, client, 'photo.png', html))).key).toBe(
      'errors.attachments.notItsType',
    );
    expect(await db.select().from(requestAttachment)).toEqual([]);
    expect((await refusal(() => upload(ctx, client, 'a.png', PNG))).code).toBe('rate_limited');
  });

  it('refuses a file that comes shorter than it said, and keeps no row', async () => {
    const short = await refusal(() =>
      uploadAttachment(ctx, client, {
        name: 'a.png',
        size: PNG.byteLength + 5,
        /**
         * Reads fewer bytes than were announced.
         *
         * @returns The bytes.
         */
        read: async () => PNG,
      }),
    );
    expect(short.key).toBe('errors.attachments.incomplete');
    const stopped = await refusal(() =>
      uploadAttachment(ctx, client, {
        name: 'a.png',
        size: PNG.byteLength,
        /**
         * Reads a body the browser stopped sending.
         *
         * @returns Nothing.
         */
        read: async () => null,
      }),
    );
    expect(stopped.key).toBe('errors.attachments.incomplete');
    expect(await db.select().from(requestAttachment)).toEqual([]);
  });

  it(`holds at most ${UPLOADS_AT_ONCE} uploads at once per person`, async () => {
    /** Lets the files arrive. */
    let arrive: () => void = () => {};
    const arrived = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    /**
     * Reads the file once the test lets it arrive.
     *
     * @returns Its bytes.
     */
    const slowly = async () => {
      await arrived;
      return PNG;
    };
    const underWay = Array.from({ length: UPLOADS_AT_ONCE }, () =>
      uploadAttachment(ctx, client, { name: 'a.png', size: PNG.byteLength, read: slowly }),
    );
    // Each has reached its read once its row is there.
    await vi.waitFor(async () =>
      expect(await db.select().from(requestAttachment)).toHaveLength(UPLOADS_AT_ONCE),
    );

    const refused = await refusal(() => upload(ctx, client, 'a.png', PNG));
    expect(refused).toMatchObject({
      code: 'rate_limited',
      key: 'errors.attachments.tooManyAtOnce',
      values: { maximum: UPLOADS_AT_ONCE },
    });

    arrive();
    await Promise.all(underWay);
    await expect(upload(ctx, client, 'a.png', PNG)).resolves.toBeTruthy();
  });

  it('keeps to the day’s total with uploads side by side', async () => {
    // Room for one more file today, not two.
    await storeAttachment(db, storage, { uploadedBy: client.id, bytes: new Uint8Array(1) });
    await db
      .update(requestAttachment)
      .set({ size: DAILY_UPLOAD_BYTES - Math.floor(PNG.byteLength * 1.5) });

    const results = await Promise.allSettled([
      upload(ctx, client, 'a.png', PNG),
      upload(ctx, client, 'b.png', PNG),
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : null).toMatchObject({
      key: 'errors.attachments.dailyTotal',
    });
  });

  it('keeps text as it was written', async () => {
    const log = new TextEncoder().encode('2026-11-25 10:42 printer offline\n');
    const { id, contentType } = await upload(ctx, client, 'printer.log', log);
    expect(contentType).toBe('text/plain');
    expect(await storedText(id)).toBe('2026-11-25 10:42 printer offline\n');
  });
});
