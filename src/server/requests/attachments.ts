/**
 * @file Uploading a file to attach to a request's text (decision 0044): one
 * file at a time, before the text is sent. The file's name, type and size
 * and the uploader's limits are checked before it's read, its bytes against
 * its type after; its row is stored first, the file is written to the
 * storage, and the row is marked uploaded, so no file is ever in storage
 * without a row the cleanup job can find. A small preview is drawn from the
 * bytes the upload holds and kept next to the file (decision 0057). The
 * upload is unsent until the text it's sent with claims it
 * (`claimAttachments`). Downloading one, or its preview, goes through the
 * same checks as reading its text (`loadAttachment`). The staff who work on
 * requests remove one (`removeAttachment`): its row stays, as the mark of who
 * removed it, and its file is deleted, with its preview.
 */
import { and, eq, gt, isNotNull, isNull, not, or, sql } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { requestAttachment, requestEntry } from '@/db/schema';
import { getInternalRequestPermissions } from '@/lib/authz/permissions';
import { firstRow } from '@/lib/defined';
import type { RangeRequest } from '@/lib/request/byte-range';
import {
  type AttachmentPreviewKind,
  type AttachmentPreviewState,
  attachmentTypeOf,
  cleanAttachmentName,
  matchesAttachmentKind,
  type RequestEntryKind,
  STAFF_ONLY_ENTRY_KINDS,
  UPLOADS_AT_ONCE,
} from '@/lib/requests';
import { maxFileBytes } from '@/lib/storage';
import { idSchema } from '@/lib/validation';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { forbiddenError, notFoundError, ServiceError } from '../errors';
import { drawAndStorePreview, drawsFromFile } from '../previews';
import { assertRateLimit, RATE_LIMITS } from '../rate-limit';
import { readSettings } from '../settings';
import { actingUserId, signedInAsWork } from '../signed-in-as';
import {
  attachmentKey,
  attachmentLimitMb,
  type FileStorage,
  previewKey,
  StorageError,
  type StoredFile,
  type StoredPart,
} from '../storage';
import { getRequestAccess } from './access';
import { assertChangeLimit, CHANGE_MOMENT, changeRequest, requestToChange } from './change';
import { listRequestCompanies } from './list';

/**
 * The most one person may upload in 24 hours, sent or not, in bytes: room
 * for twenty screen recordings at the largest size, few enough that one
 * account can't fill the storage.
 */
export const DAILY_UPLOAD_BYTES = 1000 * 1000 * 1000;

/** What attaching needs now: a storage, and the largest file. */
export interface AttachmentsOn {
  /** The storage files go to. */
  storage: FileStorage;
  /** The largest file, in megabytes. */
  maxFileMb: number;
}

/** A file that was uploaded, for the picker and the text it's sent with. */
export interface UploadedAttachment {
  /** Its ID, which the form sends with the text. */
  id: string;
  /** Its name, cleaned. */
  name: string;
  /** Its size in bytes. */
  size: number;
  /** The type it's stored and served as. */
  contentType: string;
  /** Whether its preview was drawn. */
  preview: boolean;
}

/**
 * Whether people can attach files now: "People can attach files" is on in
 * Settings, and a storage is chosen (by Settings or the server's
 * environment, which can also turn attachments off).
 *
 * @param ctx - Service context.
 * @returns The storage and the largest file, or `null` while attaching is off.
 */
export async function attachmentsOn(ctx: ServiceContext): Promise<AttachmentsOn | null> {
  const [storage, settings] = await Promise.all([
    ctx.storage ? ctx.storage() : null,
    readSettings(ctx.db, ['attachments.enabled']),
  ]);
  if (!storage || !settings['attachments.enabled']) {
    return null;
  }
  return { storage, maxFileMb: await attachmentLimitMb(ctx.db) };
}

/**
 * The uploads under way on this server, by the person who is really acting:
 * with each holding its whole file in memory, one person can't hold many.
 */
const uploadsUnderWay = new Map<string, number>();

/**
 * How much someone uploaded in the last 24 hours: what they uploaded
 * themselves, and what they uploaded while signed in as someone else
 * (counted for them, as every limit of request work is). Uploads still under
 * way count with the size they said.
 *
 * @param db - Database client or transaction.
 * @param acting - The person who is really acting (`actingUserId`).
 * @returns The bytes.
 */
async function uploadedToday(db: DatabaseOrTransaction, acting: string): Promise<number> {
  const [row] = await db
    .select({ bytes: sql<string>`coalesce(sum(${requestAttachment.size}), 0)` })
    .from(requestAttachment)
    .where(
      and(
        gt(requestAttachment.createdAt, sql`now() - interval '24 hours'`),
        or(
          eq(requestAttachment.signedInAsStaffId, acting),
          and(eq(requestAttachment.uploadedBy, acting), not(requestAttachment.signedInAs)),
        ),
      ),
    );
  return Number(row?.bytes ?? 0);
}

/**
 * Stores the row of an upload that's starting, once the day's total allows
 * its size. One person's uploads take turns at this (a lock on them for the
 * transaction), so uploads side by side can't pass the total together.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @param file - The file as it was announced.
 * @param file.name - Its name, cleaned.
 * @param file.contentType - The type it's stored as.
 * @param file.size - Its size in bytes, as the browser said.
 * @returns The row's ID.
 * @throws {ServiceError} `rate_limited` past `DAILY_UPLOAD_BYTES`.
 */
async function startUpload(
  ctx: ServiceContext,
  actor: Actor,
  file: { name: string; contentType: string; size: number },
): Promise<string> {
  const acting = actingUserId(actor);
  return ctx.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`attachment-upload:${acting}`}, 0))`,
    );
    if ((await uploadedToday(tx, acting)) + file.size > DAILY_UPLOAD_BYTES) {
      throw new ServiceError('rate_limited', 'errors.attachments.dailyTotal');
    }
    return firstRow(
      await tx
        .insert(requestAttachment)
        .values({ uploadedBy: actor.id, ...signedInAsWork(actor), ...file })
        .returning({ id: requestAttachment.id }),
      'the attachment',
    ).id;
  });
}

/**
 * Takes back the row of an upload whose file was never stored.
 *
 * @param ctx - Service context.
 * @param id - The row.
 */
async function abandonUpload(ctx: ServiceContext, id: string): Promise<void> {
  // If this fails too, the job purges the unfinished row after an hour.
  await ctx.db
    .delete(requestAttachment)
    .where(eq(requestAttachment.id, id))
    .catch(() => {});
}

/**
 * Draws an upload's preview from the bytes it holds, and says where it
 * stands for its row.
 *
 * @param storage - Where the file is kept.
 * @param file - The upload.
 * @param file.id - Its row's ID.
 * @param file.kind - The kind of preview its type has.
 * @param file.bytes - The file.
 * @returns `drawn`; `none` for a file that can't be drawn or a kind that keeps its icon; `null`
 *   for a video (its frame comes from the browser) and for a preview that wasn't drawn or stored
 *   (the previews job draws it later).
 */
async function previewAtUpload(
  storage: FileStorage,
  file: { id: string; kind: AttachmentPreviewKind | null; bytes: Uint8Array },
): Promise<AttachmentPreviewState | null> {
  if (file.kind === null) {
    return 'none';
  }
  if (!drawsFromFile(file.kind)) {
    return null;
  }
  const outcome = await drawAndStorePreview(storage, {
    id: file.id,
    kind: file.kind,
    bytes: file.bytes,
    whenBusy: 'skip',
  });
  return outcome === 'drawn' || outcome === 'none' ? outcome : null;
}

/**
 * Uploads a file, for a text that will be sent with it. Allowed for whoever
 * may raise a request in some company, or write the staff's internal
 * requests (each text's service checks its own permission when it claims
 * the file), also while a staff member is signed in as them, which the row
 * records.
 *
 * Everything that can be refused cheaply is, before a byte of the file is
 * read: attaching off, someone who can't write requests, a name, type or
 * size that isn't allowed, the hourly limit (which every such attempt counts
 * towards), more than `UPLOADS_AT_ONCE` at once, and the day's total. Only
 * then is the file read (`read`) and checked against its type. Its row is
 * stored before the file, and marked uploaded after, so no file is ever in
 * storage without a row; a storage that fails leaves the row unfinished for
 * the cleanup job, which deletes whatever the storage may have kept. Between
 * the two, the file's preview is drawn and stored, when its kind has one
 * drawn from the file; one that can't be drawn or stored, or that finds this
 * server busy drawing others, never fails the upload.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @param input - The upload.
 * @param input.name - The file's name, as the browser sent it.
 * @param input.size - Its size in bytes, as the browser announced it.
 * @param input.read - Reads the file: its bytes, or `null` when they didn't all arrive.
 * @returns The uploaded file.
 * @throws {ServiceError} `conflict` while attaching is off, `forbidden` for
 *   someone who can't write requests anywhere, `invalid` for a name, size
 *   or bytes that aren't allowed or a file that came incomplete,
 *   `rate_limited` past the limits.
 * @throws {StorageError} When the storage fails; the row stays unfinished.
 */
export async function uploadAttachment(
  ctx: ServiceContext,
  actor: Actor,
  input: { name: string; size: number; read: () => Promise<Uint8Array<ArrayBuffer> | null> },
): Promise<UploadedAttachment> {
  const on = await attachmentsOn(ctx);
  if (!on) {
    throw new ServiceError('conflict', 'errors.attachments.off');
  }
  // Someone who may write requests somewhere: in a company, or the staff's internal requests.
  if (
    !getInternalRequestPermissions(actor).has('requests:contribute') &&
    !(await listRequestCompanies(ctx, actor)).some((company) => company.canRaise)
  ) {
    throw forbiddenError();
  }
  const name = cleanAttachmentName(input.name);
  const type = name ? attachmentTypeOf(name) : null;
  if (!name || !type) {
    throw new ServiceError('invalid', 'errors.attachments.typeNotAllowed');
  }
  const { size } = input;
  if (size === 0) {
    throw new ServiceError('invalid', 'errors.attachments.empty');
  }
  if (size > maxFileBytes(on.maxFileMb)) {
    throw new ServiceError('invalid', 'errors.attachments.tooLarge', { maximum: on.maxFileMb });
  }
  const acting = actingUserId(actor);
  await assertRateLimit(
    ctx,
    `attachment-upload:user:${acting}`,
    RATE_LIMITS.attachmentUploadsPerUser,
  );
  const underWay = uploadsUnderWay.get(acting) ?? 0;
  if (underWay >= UPLOADS_AT_ONCE) {
    throw new ServiceError('rate_limited', 'errors.attachments.tooManyAtOnce', {
      maximum: UPLOADS_AT_ONCE,
    });
  }
  uploadsUnderWay.set(acting, underWay + 1);
  try {
    const id = await startUpload(ctx, actor, { name, contentType: type.contentType, size });
    const bytes = await input.read();
    if (!bytes || bytes.byteLength !== size) {
      await abandonUpload(ctx, id);
      throw new ServiceError('invalid', 'errors.attachments.incomplete');
    }
    if (!matchesAttachmentKind(type.check, bytes)) {
      await abandonUpload(ctx, id);
      throw new ServiceError('invalid', 'errors.attachments.notItsType');
    }
    // A storage that fails may still have kept the file (a timeout after it stored it): the row
    // stays unfinished, and the cleanup job deletes both after an hour.
    await on.storage.put(attachmentKey(id), bytes, type.contentType);
    const preview = await previewAtUpload(on.storage, { id, kind: type.preview, bytes });
    const uploaded = await ctx.db
      .update(requestAttachment)
      .set({ uploadedAt: sql`now()`, preview })
      .where(and(eq(requestAttachment.id, id), isNull(requestAttachment.uploadedAt)))
      .returning({ id: requestAttachment.id });
    if (uploaded.length === 0) {
      throw new ServiceError('conflict', 'errors.attachments.unavailable', { name });
    }
    return { id, name, size, contentType: type.contentType, preview: preview === 'drawn' };
  } finally {
    const left = (uploadsUnderWay.get(acting) ?? 1) - 1;
    if (left > 0) {
      uploadsUnderWay.set(acting, left);
    } else {
      uploadsUnderWay.delete(acting);
    }
  }
}

/** A file a reader may download, as its route serves it. */
export interface AttachmentToServe {
  /** Its name, for the download. */
  name: string;
  /** The type it's served as. */
  contentType: string;
  /**
   * Reads its bytes from the storage, only once they're needed: a browser
   * whose copy is still the file needs only the checks.
   *
   * @returns The file, or `null` when the storage has none under its key.
   * @throws {StorageError} When the storage fails (not when the file is merely missing).
   */
  readFile(): Promise<StoredFile | null>;
  /**
   * Reads a part of its bytes, as a video that's played asks for one.
   *
   * @param range - The part.
   * @returns The part, or `null` when the storage has none under its key.
   * @throws {StorageError} When the storage fails.
   */
  readFilePart(range: RangeRequest): Promise<StoredPart | null>;
  /** Whether it has a preview (decision 0057). */
  hasPreview: boolean;
  /**
   * Reads its preview from the storage, only once it's needed.
   *
   * @returns The preview, or `null` when the storage has none under its key.
   * @throws {StorageError} When the storage fails (not when the preview is merely missing).
   */
  readPreview(): Promise<StoredFile | null>;
}

/**
 * A file to download, for a reader who may read the text it's attached to:
 * the request's own access (`getRequestAccess`: the company's people while
 * it's active, and the staff), and for an internal note's file, the readers
 * of notes (`requests:view-internal`). An unsent file is nobody's to
 * download, a removed one is gone, and anything the reader may not read is
 * missing too, so nothing says it exists. The checks come first, and the
 * storage is read only when the file's bytes are (`readFile`), or its
 * preview's (`readPreview`): a preview is read by whoever may read its file.
 *
 * @param ctx - Service context.
 * @param actor - The reader.
 * @param id - The attachment's ID, as the address gave it.
 * @returns The file, or `null` when there's none for this reader.
 */
export async function loadAttachment(
  ctx: ServiceContext,
  actor: Actor,
  id: string,
): Promise<AttachmentToServe | null> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return null;
  }
  const [row] = await ctx.db
    .select({
      requestId: requestAttachment.requestId,
      name: requestAttachment.name,
      contentType: requestAttachment.contentType,
      preview: requestAttachment.preview,
      entryKind: requestEntry.kind,
    })
    .from(requestAttachment)
    .leftJoin(requestEntry, eq(requestAttachment.entryId, requestEntry.id))
    .where(
      and(
        eq(requestAttachment.id, parsed.data),
        isNotNull(requestAttachment.requestId),
        isNull(requestAttachment.removedAt),
      ),
    );
  if (!row?.requestId) {
    return null;
  }
  const access = await getRequestAccess(ctx.db, actor, row.requestId).catch((error: unknown) => {
    if (error instanceof ServiceError && error.code === 'not_found') {
      return null;
    }
    throw error;
  });
  const staffOnly =
    row.entryKind !== null &&
    (STAFF_ONLY_ENTRY_KINDS as readonly RequestEntryKind[]).includes(row.entryKind);
  if (!access || (staffOnly && !access.permissions.has('requests:view-internal'))) {
    return null;
  }
  /**
   * Reads one of the file's keys from the storage.
   *
   * @param key - The file's key, or its preview's.
   * @param missing - What the log says when the storage has nothing there.
   * @returns What's stored there, or `null` when nothing is (or no storage is chosen).
   */
  const read = async (key: string, missing: string): Promise<StoredFile | null> => {
    const storage = ctx.storage ? await ctx.storage() : null;
    const file = storage ? await storage.get(key) : null;
    if (!file) {
      // A row without its file: a storage that changed, or files not backed up with the database.
      // eslint-disable-next-line no-console -- The ID only: it names no one.
      console.warn(missing, parsed.data);
    }
    return file;
  };
  return {
    name: row.name,
    contentType: row.contentType,
    hasPreview: row.preview === 'drawn',
    /**
     * Reads the file's bytes from the storage.
     *
     * @returns The file, or `null` when the storage has none.
     */
    readFile: () => read(attachmentKey(parsed.data), 'An attachment has no file in the storage:'),
    /**
     * Reads a part of the file's bytes from the storage.
     *
     * @param range - The part.
     * @returns The part, or `null` when the storage has none (or none is chosen).
     */
    readFilePart: async (range) => {
      const storage = ctx.storage ? await ctx.storage() : null;
      return storage ? storage.getPart(attachmentKey(parsed.data), range) : null;
    },
    /**
     * Reads the preview's bytes from the storage.
     *
     * @returns The preview, or `null` when the storage has none.
     */
    readPreview: () =>
      read(previewKey(parsed.data), 'An attachment’s preview has no file in the storage:'),
  };
}

/**
 * Deletes a removed file's bytes and its preview, and notes that they're
 * gone. A storage that fails leaves them for the `attachment-files` job,
 * which tries again.
 *
 * @param ctx - Service context.
 * @param id - The removed file.
 */
async function deleteRemovedFile(ctx: ServiceContext, id: string): Promise<void> {
  try {
    const storage = ctx.storage ? await ctx.storage() : null;
    if (!storage) {
      return;
    }
    await storage.session(async (shared) => {
      await shared.delete(attachmentKey(id));
      await shared.delete(previewKey(id));
    });
    await ctx.db
      .update(requestAttachment)
      .set({ fileDeletedAt: sql`now()` })
      .where(eq(requestAttachment.id, id));
  } catch (error) {
    // The kind only, as the storage's own reply may say more than it should.
    // eslint-disable-next-line no-console -- The job tries again; the log says why it had to.
    console.error(
      "A removed attachment's file could not be deleted yet:",
      error instanceof StorageError ? error.failure : 'failed',
    );
  }
}

/**
 * Removes a file attached to a request's text: only the staff who work on
 * requests (`mayRemoveAttachment`), at any time, on any text they can read,
 * a note's too. Its row stays as the mark that says who removed it and when
 * (with the staff member signed in as them, if one was: request work,
 * decision 0028), and its file is deleted once that's saved. Nobody is told,
 * and the request's last activity doesn't move: it tidies what's there.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `requests:manage` in the request's company.
 * @param input - Form input.
 * @param input.request - The request's number or ID.
 * @param input.attachment - The file's ID.
 * @returns The removed file's name.
 * @throws {ServiceError} `signed_in_as` when the sign-in as the actor ended meanwhile,
 *   `not_found` when the actor may not see the request or the file isn't one of its own that
 *   isn't removed yet, `forbidden` without `requests:manage`, `invalid` when the company is
 *   deactivated, `rate_limited` past `RATE_LIMITS.requestChangesPerUser`.
 */
export async function removeAttachment(
  ctx: ServiceContext,
  actor: Actor,
  input: { request: string; attachment: string },
): Promise<{ name: string }> {
  const access = await requestToChange(ctx, actor, input.request, 'requests:manage');
  const id = idSchema.safeParse(input.attachment);
  if (!id.success) {
    throw notFoundError();
  }
  await assertChangeLimit(ctx, actor);
  const work = signedInAsWork(actor);
  const removed = await changeRequest(ctx, actor, access, 'requests:manage', async (tx, locked) => {
    const [row] = await tx
      .update(requestAttachment)
      .set({
        removedAt: CHANGE_MOMENT,
        removedBy: actor.id,
        removedSignedInAs: work.signedInAs,
        removedSignedInAsStaffId: work.signedInAsStaffId,
      })
      .where(
        and(
          eq(requestAttachment.id, id.data),
          eq(requestAttachment.requestId, locked.id),
          isNull(requestAttachment.removedAt),
        ),
      )
      .returning({ id: requestAttachment.id, name: requestAttachment.name });
    if (!row) {
      throw notFoundError();
    }
    return row;
  });
  // Once the removal is saved, so a file is never gone while its tile still links to it.
  await deleteRemovedFile(ctx, removed.id);
  return { name: removed.name };
}
