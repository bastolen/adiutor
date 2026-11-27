/**
 * @file The job that draws the previews uploads didn't (decision 0057): of
 * files attached before previews existed, of uploads that found the server
 * busy drawing others, and of previews the storage couldn't keep then. It
 * takes sent files whose kind has a preview drawn from the file and that
 * have none yet, newest first, one at a time on one storage connection,
 * until its deadline. Each file is claimed first (marked `none`), so a file
 * that brings the process down is never tried again; it's marked `drawn`
 * once its preview is stored. A storage that fails, or a drawing library
 * that won't load, puts the file back and ends the run, with a failure that
 * says why, for the next run to try again. It does nothing while no storage
 * is chosen, or while it isn't set up.
 */
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { requestAttachment } from '@/db/schema';
import { ATTACHMENT_TYPES, attachmentTypeOf } from '@/lib/requests';

import { drawAndStorePreview, drawsFromFile } from '../../previews';
import { attachmentKey, type FileStorage, StorageError, type StoredFile } from '../../storage';
import { defineRecurringJob } from '../define';

/** How many rows are read at a time. */
const CHUNK_ROWS = 20;

/** The types of file whose preview is drawn from the file. */
const DRAWN_CONTENT_TYPES = [
  ...new Set(
    ATTACHMENT_TYPES.filter((type) => drawsFromFile(type.preview)).map((type) => type.contentType),
  ),
];

/** The rows of sent files that have no preview yet (`request_attachment_undrawn_idx`). */
const UNDRAWN = and(
  isNull(requestAttachment.preview),
  isNotNull(requestAttachment.requestId),
  isNull(requestAttachment.removedAt),
  inArray(requestAttachment.contentType, DRAWN_CONTENT_TYPES),
);

/**
 * Reads a stored file whole, never more than its row says it holds.
 *
 * @param file - The file, as the storage gives it.
 * @param size - Its size, from its row.
 * @returns Its bytes, or `null` when they aren't that size.
 */
async function readWhole(file: StoredFile, size: number): Promise<Uint8Array | null> {
  const bytes = new Uint8Array(size);
  let filled = 0;
  const reader = file.body.getReader();
  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- a stream is read a piece at a time
      const { done, value } = await reader.read();
      if (done) {
        return filled === size ? bytes : null;
      }
      if (filled + value.byteLength > size) {
        return null;
      }
      bytes.set(value, filled);
      filled += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Why a file was put back for the next run: no file's content, only the kind of failure. */
interface Retry {
  /** The failure, for the run's history. */
  retry: string;
}

/**
 * Draws one file's preview, once it's claimed.
 *
 * @param storage - The storage, in the job's session.
 * @param row - The file's row.
 * @param row.id - Its ID.
 * @param row.name - Its name.
 * @param row.size - Its size.
 * @returns `drawn`, `none`, or why it's to be tried again later.
 */
async function drawOne(
  storage: FileStorage,
  row: { id: string; name: string; size: number },
): Promise<'drawn' | 'none' | Retry> {
  const kind = attachmentTypeOf(row.name)?.preview ?? null;
  if (!drawsFromFile(kind)) {
    return 'none';
  }
  try {
    const file = await storage.get(attachmentKey(row.id));
    const bytes = file ? await readWhole(file, row.size) : null;
    if (!bytes) {
      // A file missing from the storage (or not its size) won't be drawn later either.
      return 'none';
    }
    const state = await drawAndStorePreview(storage, {
      id: row.id,
      kind,
      bytes,
      whenBusy: 'wait',
    });
    return state ?? { retry: 'A preview could not be drawn or stored; the next run tries again' };
  } catch (error) {
    if (error instanceof StorageError) {
      return { retry: `The storage failed (${error.failure}); the next run tries again` };
    }
    throw error;
  }
}

export default defineRecurringJob({
  name: 'attachment-previews',
  schedule: '*/5 * * * *',
  /**
   * Draws previews, newest file first, until there are none left to draw,
   * the deadline comes, or the storage or the drawing fails.
   *
   * @param ctx - Service context: the database and the storage.
   * @param options - The run's options.
   * @param options.deadline - When to stop starting new work.
   * @returns How many previews were drawn, how many files can't have one, and why the run
   *   stopped early, if it did.
   */
  run: async (ctx, { deadline }) => {
    const storage = ctx.storage ? await ctx.storage() : null;
    if (!storage) {
      return { summary: { previews: 0, withoutPreview: 0 } };
    }
    let failure: string | undefined;
    const counts = await storage.session(async (shared) => {
      const done = { previews: 0, withoutPreview: 0 };
      // A folder that isn't Adiutor's: its files aren't there to draw.
      if (!(await shared.isSetUp())) {
        return done;
      }
      while (Date.now() < deadline.getTime()) {
        // eslint-disable-next-line no-await-in-loop -- a chunk at a time, until the deadline
        const rows = await ctx.db
          .select({
            id: requestAttachment.id,
            name: requestAttachment.name,
            size: requestAttachment.size,
          })
          .from(requestAttachment)
          .where(UNDRAWN)
          .orderBy(desc(requestAttachment.createdAt), desc(requestAttachment.id))
          .limit(CHUNK_ROWS);
        if (rows.length === 0) {
          return done;
        }
        for (const row of rows) {
          if (Date.now() >= deadline.getTime()) {
            return done;
          }
          // Claimed as `none` first: a file that brings the process down stays that way.
          // eslint-disable-next-line no-await-in-loop -- one file at a time
          const claimed = await ctx.db
            .update(requestAttachment)
            .set({ preview: 'none' })
            .where(and(eq(requestAttachment.id, row.id), isNull(requestAttachment.preview)))
            .returning({ id: requestAttachment.id });
          if (claimed.length > 0) {
            // eslint-disable-next-line no-await-in-loop -- one file at a time, on one connection
            const state = await drawOne(shared, row);
            if (state === 'none') {
              done.withoutPreview += 1;
            } else {
              const retry = state !== 'drawn';
              // eslint-disable-next-line no-await-in-loop -- one row at a time, after its preview
              await ctx.db
                .update(requestAttachment)
                .set({ preview: retry ? null : 'drawn' })
                .where(eq(requestAttachment.id, row.id));
              if (retry) {
                // The storage failed, or nothing can be drawn now: the next run tries again.
                failure = state.retry;
                return done;
              }
              done.previews += 1;
            }
          }
        }
      }
      return done;
    });
    return { summary: counts, ...(failure && { failure }) };
  },
});
