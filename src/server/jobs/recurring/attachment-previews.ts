/**
 * @file The job that draws the previews uploads didn't (decision 0057): of
 * files attached before previews existed, of uploads that found the server
 * busy drawing others, and of previews the storage couldn't keep then. It
 * takes sent files that have no preview yet, newest first, one at a time on
 * one storage connection, until its deadline. Each file is claimed first
 * (marked `none`), so a file that brings the process down is never tried
 * again; a kind of file without a preview (a log, an archive, a video whose
 * frame never came) stays `none`, so no run looks at it again. A drawn
 * preview is marked `drawn` only while its file isn't removed, and deleted
 * when it is. A kind whose drawing library won't load is put back and left
 * for the next run while the others are drawn; a storage that fails puts
 * the file back and ends the run. Either is the run's failure. It does
 * nothing while no storage is chosen, or while it isn't set up.
 */
import { and, desc, eq, isNotNull, isNull, notInArray } from 'drizzle-orm';

import { requestAttachment } from '@/db/schema';
import { ATTACHMENT_TYPES, attachmentTypeOf } from '@/lib/requests';

import { drawAndStorePreview, drawsFromFile, type FilePreviewKind } from '../../previews';
import {
  attachmentKey,
  type FileStorage,
  pageKey,
  previewKey,
  StorageError,
  type StoredFile,
} from '../../storage';
import { defineRecurringJob } from '../define';

/** How many rows are read at a time. */
const CHUNK_ROWS = 20;

/** The rows of sent files that have no preview yet (`request_attachment_undrawn_idx`). */
const UNDRAWN = and(
  isNull(requestAttachment.preview),
  isNotNull(requestAttachment.requestId),
  isNull(requestAttachment.removedAt),
);

/**
 * The types of file of some kinds of preview.
 *
 * @param kinds - The kinds.
 * @returns Their types, as stored.
 */
function typesOf(kinds: ReadonlySet<FilePreviewKind>): string[] {
  return ATTACHMENT_TYPES.filter(
    (type) => drawsFromFile(type.preview) && kinds.has(type.preview),
  ).map((type) => type.contentType);
}

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

/** What drawing one file gave: final, or to be tried again by a later run. */
type DrawnOne =
  | 'drawn'
  | 'none'
  | {
      /** Why it's put back, for the run's history: no file's content, only the kind of failure. */
      retry: string;
      /** The kind whose drawing library won't load, or `null` when the storage failed. */
      kind: FilePreviewKind | null;
    };

/**
 * Draws one file's preview, once it's claimed.
 *
 * @param storage - The storage, in the job's session.
 * @param row - The file's row.
 * @param row.id - Its ID.
 * @param row.name - Its name.
 * @param row.size - Its size.
 * @returns How it went.
 */
async function drawOne(
  storage: FileStorage,
  row: { id: string; name: string; size: number },
): Promise<DrawnOne> {
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
    const outcome = await drawAndStorePreview(storage, {
      id: row.id,
      kind,
      bytes,
      whenBusy: 'wait',
    });
    if (outcome === 'skipped') {
      return {
        retry: `Previews of kind ${kind} could not be drawn; the next run tries again`,
        kind,
      };
    }
    if (outcome === 'unstored') {
      return { retry: 'The storage refused a preview; the next run tries again', kind: null };
    }
    return outcome;
  } catch (error) {
    if (error instanceof StorageError) {
      return {
        retry: `The storage failed (${error.failure}); the next run tries again`,
        kind: null,
      };
    }
    throw error;
  }
}

export default defineRecurringJob({
  name: 'attachment-previews',
  schedule: '*/5 * * * *',
  /**
   * Draws previews, newest file first, until there are none left to draw,
   * the deadline comes, or the storage fails.
   *
   * @param ctx - Service context: the database and the storage.
   * @param options - The run's options.
   * @param options.deadline - When to stop starting new work.
   * @returns How many previews were drawn, how many files can't have one, and what kept some
   *   from being drawn, if anything did.
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
      // The kinds whose drawing library won't load: left for the next run.
      const unavailable = new Set<FilePreviewKind>();
      while (Date.now() < deadline.getTime()) {
        const skippedTypes = typesOf(unavailable);
        // eslint-disable-next-line no-await-in-loop -- a chunk at a time, until the deadline
        const rows = await ctx.db
          .select({
            id: requestAttachment.id,
            name: requestAttachment.name,
            size: requestAttachment.size,
          })
          .from(requestAttachment)
          .where(
            skippedTypes.length > 0
              ? and(UNDRAWN, notInArray(requestAttachment.contentType, skippedTypes))
              : UNDRAWN,
          )
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
            .where(
              and(
                eq(requestAttachment.id, row.id),
                isNull(requestAttachment.preview),
                isNull(requestAttachment.removedAt),
              ),
            )
            .returning({ id: requestAttachment.id });
          if (claimed.length > 0) {
            // eslint-disable-next-line no-await-in-loop -- one file at a time, on one connection
            const drawn = await drawOne(shared, row);
            if (drawn === 'none') {
              done.withoutPreview += 1;
            } else if (drawn === 'drawn') {
              // Only while the file is there: one removed meanwhile loses the preview too.
              // eslint-disable-next-line no-await-in-loop -- one row at a time, after its preview
              const kept = await ctx.db
                .update(requestAttachment)
                .set({ preview: 'drawn' })
                .where(and(eq(requestAttachment.id, row.id), isNull(requestAttachment.removedAt)))
                .returning({ id: requestAttachment.id });
              if (kept.length > 0) {
                done.previews += 1;
              } else {
                // eslint-disable-next-line no-await-in-loop -- one file at a time, on one connection
                await shared.delete(previewKey(row.id));
                // eslint-disable-next-line no-await-in-loop -- one file at a time, on one connection
                await shared.delete(pageKey(row.id));
              }
            } else {
              // eslint-disable-next-line no-await-in-loop -- one row at a time
              await ctx.db
                .update(requestAttachment)
                .set({ preview: null })
                .where(eq(requestAttachment.id, row.id));
              failure = drawn.retry;
              if (drawn.kind === null) {
                // The storage failed: the next run tries again.
                return done;
              }
              unavailable.add(drawn.kind);
              // The rest of this chunk may hold that kind: read the next without it.
              break;
            }
          }
        }
      }
      return done;
    });
    return { summary: counts, ...(failure && { failure }) };
  },
});
