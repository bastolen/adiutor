/**
 * @file Uploading a file to attach to a request's text (decision 0044): one
 * file at a time, before the text is sent. The file's name, type and size
 * are checked, its bytes against its type, and the uploader's limits; then
 * its row is stored, the file is written to the storage, and the row is
 * marked uploaded, so no file is ever in storage without a row the cleanup
 * job can find. The upload is unsent until the text it's sent with claims it
 * (`claimAttachments`). Downloading one goes through the same checks as
 * reading its text (`loadAttachment`).
 */
import { and, eq, gt, isNotNull, isNull, not, or, sql } from 'drizzle-orm';

import { requestAttachment, requestEntry } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import {
  attachmentTypeOf,
  cleanAttachmentName,
  type RequestEntryKind,
  STAFF_ONLY_ENTRY_KINDS,
} from '@/lib/requests';
import { maxFileBytes } from '@/lib/storage';
import { idSchema } from '@/lib/validation';

import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { forbiddenError, ServiceError } from '../errors';
import { assertRateLimit, RATE_LIMITS } from '../rate-limit';
import { readSettings } from '../settings';
import { actingUserId, signedInAsWork } from '../signed-in-as';
import { attachmentKey, attachmentLimitMb, type FileStorage } from '../storage';
import { getRequestAccess } from './access';
import matchesAttachmentKind from './attachment-checks';
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
  /** Whether it's shown as a thumbnail. */
  thumbnail: boolean;
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
 * How much someone uploaded in the last 24 hours: what they uploaded
 * themselves, and what they uploaded while signed in as someone else
 * (counted for them, as every limit of request work is).
 *
 * @param ctx - Service context.
 * @param acting - The person who is really acting (`actingUserId`).
 * @returns The bytes.
 */
async function uploadedToday(ctx: ServiceContext, acting: string): Promise<number> {
  const [row] = await ctx.db
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
 * Uploads a file, for a text that will be sent with it. Allowed for whoever
 * may raise a request in some company (each text's service checks its own
 * permission when it claims the file), also while a staff member is signed
 * in as them, which the row records.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @param input - The file.
 * @param input.name - Its name, as the browser sent it.
 * @param input.bytes - Its bytes.
 * @returns The uploaded file.
 * @throws {ServiceError} `conflict` while attaching is off, `forbidden` for
 *   someone who can't write requests anywhere, `invalid` for a name, size
 *   or bytes that aren't allowed, `rate_limited` past the limits.
 * @throws {StorageError} When the storage fails; the row is taken back.
 */
export async function uploadAttachment(
  ctx: ServiceContext,
  actor: Actor,
  input: { name: string; bytes: Uint8Array<ArrayBuffer> },
): Promise<UploadedAttachment> {
  const on = await attachmentsOn(ctx);
  if (!on) {
    throw new ServiceError('conflict', 'errors.attachments.off');
  }
  const companies = await listRequestCompanies(ctx, actor);
  if (!companies.some((company) => company.canRaise)) {
    throw forbiddenError();
  }
  const name = cleanAttachmentName(input.name);
  const type = name ? attachmentTypeOf(name) : null;
  if (!name || !type) {
    throw new ServiceError('invalid', 'errors.attachments.typeNotAllowed');
  }
  const size = input.bytes.byteLength;
  if (size === 0) {
    throw new ServiceError('invalid', 'errors.attachments.empty');
  }
  if (size > maxFileBytes(on.maxFileMb)) {
    throw new ServiceError('invalid', 'errors.attachments.tooLarge', { maximum: on.maxFileMb });
  }
  if (!matchesAttachmentKind(type.check, input.bytes)) {
    throw new ServiceError('invalid', 'errors.attachments.notItsType');
  }
  const acting = actingUserId(actor);
  await assertRateLimit(
    ctx,
    `attachment-upload:user:${acting}`,
    RATE_LIMITS.attachmentUploadsPerUser,
  );
  if ((await uploadedToday(ctx, acting)) + size > DAILY_UPLOAD_BYTES) {
    throw new ServiceError('rate_limited', 'errors.attachments.dailyTotal');
  }

  const stored = firstRow(
    await ctx.db
      .insert(requestAttachment)
      .values({
        uploadedBy: actor.id,
        ...signedInAsWork(actor),
        name,
        contentType: type.contentType,
        size,
      })
      .returning({ id: requestAttachment.id }),
    'the attachment',
  );
  try {
    await on.storage.put(attachmentKey(stored.id), input.bytes, type.contentType);
  } catch (error) {
    // Nothing was kept, so neither is its row; the job purges it if this fails too.
    await ctx.db
      .delete(requestAttachment)
      .where(eq(requestAttachment.id, stored.id))
      .catch(() => {});
    throw error;
  }
  const uploaded = await ctx.db
    .update(requestAttachment)
    .set({ uploadedAt: sql`now()` })
    .where(and(eq(requestAttachment.id, stored.id), isNull(requestAttachment.uploadedAt)))
    .returning({ id: requestAttachment.id });
  if (uploaded.length === 0) {
    throw new ServiceError('conflict', 'errors.attachments.unavailable', { name });
  }
  return { id: stored.id, name, size, contentType: type.contentType, thumbnail: type.thumbnail };
}

/** A file to download, as its route serves it. */
export interface AttachmentToServe {
  /** Its name, for the download. */
  name: string;
  /** The type it's served as. */
  contentType: string;
  /** Its bytes, as they arrive from the storage. */
  body: ReadableStream<Uint8Array>;
}

/**
 * A file to download, for a reader who may read the text it's attached to:
 * the request's own access (`getRequestAccess`: the company's people while
 * it's active, and the staff), and for an internal note's file, the readers
 * of notes (`requests:view-internal`). An unsent file is nobody's to
 * download, a removed one is gone, and anything the reader may not read is
 * missing too, so nothing says it exists.
 *
 * @param ctx - Service context.
 * @param actor - The reader.
 * @param id - The attachment's ID, as the address gave it.
 * @returns The file, or `null` when there's none for this reader.
 * @throws {StorageError} When the storage fails (not when the file is merely missing).
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
  const storage = ctx.storage ? await ctx.storage() : null;
  const file = storage ? await storage.get(attachmentKey(parsed.data)) : null;
  if (!file) {
    // A row without its file: a storage that changed, or files not backed up with the database.
    // eslint-disable-next-line no-console -- The ID only: it names no one.
    console.warn('An attachment has no file in the storage:', parsed.data);
    return null;
  }
  return { name: row.name, contentType: row.contentType, body: file.body };
}
