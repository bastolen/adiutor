/**
 * @file The hourly job that keeps the attachments' storage to what's used
 * (decision 0044): it purges the files uploaded but never sent with a text
 * (after 25 hours, an hour past the day a text may still claim them, or as
 * soon as the uploader's account is gone) and uploads that never finished
 * (after an hour), and deletes the files of removed attachments that
 * couldn't be deleted when they were removed. Each file is deleted before
 * its row is (or is marked deleted), so a run that stops halfway leaves
 * nothing a later run can't find. It does nothing while no storage is
 * chosen, or while it isn't set up (a folder without its marker: a server
 * started without its volume); turning attachments off in Settings doesn't
 * stop it.
 */
import { and, asc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import { requestAttachment } from '@/db/schema';

import { attachmentKey, type FileStorage, pageKey, previewKey } from '../../storage';
import { defineRecurringJob } from '../define';

/** How many rows are read at a time. */
const CHUNK_ROWS = 100;

/** Unsent files past this are purged: an hour past the day a text may claim them. */
const UNSENT = sql`now() - interval '25 hours'`;

/** Uploads still unfinished past this are purged. */
const UNFINISHED = sql`now() - interval '1 hour'`;

/** The rows of unsent files to purge. */
const PURGEABLE = and(
  isNull(requestAttachment.requestId),
  or(
    lt(requestAttachment.createdAt, UNSENT),
    isNull(requestAttachment.uploadedBy),
    and(isNull(requestAttachment.uploadedAt), lt(requestAttachment.createdAt, UNFINISHED)),
  ),
);

/** The rows of removed files whose bytes are still in storage. */
const REMOVED_KEPT = and(
  isNotNull(requestAttachment.removedAt),
  isNull(requestAttachment.fileDeletedAt),
);

/**
 * Deletes a file, its preview and a PDF's large page, on the job's connection.
 *
 * @param storage - The storage, in the job's session.
 * @param id - The attachment.
 */
async function deleteFiles(storage: FileStorage, id: string): Promise<void> {
  await storage.delete(attachmentKey(id));
  await storage.delete(previewKey(id));
  await storage.delete(pageKey(id));
}

export default defineRecurringJob({
  name: 'attachment-files',
  schedule: '25 * * * *',
  /**
   * Purges the unsent and unfinished uploads, then deletes removed files
   * still in storage, until there are none left or the deadline comes, on
   * one storage connection.
   *
   * @param ctx - Service context: the database and the storage.
   * @param options - The run's options.
   * @param options.deadline - When to stop starting new work.
   * @returns How many uploads were purged, and how many removed files deleted.
   */
  run: async (ctx, { deadline }) => {
    const storage = ctx.storage ? await ctx.storage() : null;
    if (!storage) {
      return { summary: { unsentFiles: 0, removedFiles: 0 } };
    }
    const { purged, removedFiles } = await storage.session(async (shared) => {
      // A folder that isn't Adiutor's: not a place to delete files from, or to mark them deleted.
      if (!(await shared.isSetUp())) {
        return { purged: 0, removedFiles: 0 };
      }
      let count = 0;
      let full = true;
      while (full && Date.now() < deadline.getTime()) {
        // eslint-disable-next-line no-await-in-loop -- a chunk at a time, until the deadline
        const rows = await ctx.db
          .select({ id: requestAttachment.id })
          .from(requestAttachment)
          .where(PURGEABLE)
          .orderBy(asc(requestAttachment.createdAt))
          .limit(CHUNK_ROWS);
        full = rows.length === CHUNK_ROWS;
        for (const row of rows) {
          if (Date.now() >= deadline.getTime()) {
            break;
          }
          // The file first: a row left behind is found again; a file without one never is.
          // eslint-disable-next-line no-await-in-loop -- one connection, one file at a time
          await deleteFiles(shared, row.id);
          // Checked again: a text may have claimed it just now (it can't once it's purgeable).
          // eslint-disable-next-line no-await-in-loop -- one row at a time, after its file
          const deleted = await ctx.db
            .delete(requestAttachment)
            .where(and(eq(requestAttachment.id, row.id), isNull(requestAttachment.requestId)))
            .returning({ id: requestAttachment.id });
          count += deleted.length;
        }
      }
      let removedCount = 0;
      full = true;
      while (full && Date.now() < deadline.getTime()) {
        // eslint-disable-next-line no-await-in-loop -- a chunk at a time, until the deadline
        const rows = await ctx.db
          .select({ id: requestAttachment.id })
          .from(requestAttachment)
          .where(REMOVED_KEPT)
          .orderBy(asc(requestAttachment.removedAt))
          .limit(CHUNK_ROWS);
        full = rows.length === CHUNK_ROWS;
        for (const row of rows) {
          if (Date.now() >= deadline.getTime()) {
            break;
          }
          // eslint-disable-next-line no-await-in-loop -- one connection, one file at a time
          await deleteFiles(shared, row.id);
          // eslint-disable-next-line no-await-in-loop -- one row at a time, after its file
          await ctx.db
            .update(requestAttachment)
            .set({ fileDeletedAt: sql`now()` })
            .where(eq(requestAttachment.id, row.id));
          removedCount += 1;
        }
      }
      return { purged: count, removedFiles: removedCount };
    });
    return { summary: { unsentFiles: purged, removedFiles } };
  },
});
