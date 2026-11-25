/**
 * @file The hourly job that keeps the attachments' storage to what's used
 * (decision 0044): it purges the files uploaded but never sent with a text
 * (after 25 hours, an hour past the day a text may still claim them, or as
 * soon as the uploader's account is gone) and uploads that never finished
 * (after an hour). Each file is deleted before its row, so a run that stops
 * halfway leaves nothing a later run can't find. It does nothing while no
 * storage is chosen; turning attachments off in Settings doesn't stop it.
 */
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { requestAttachment } from '@/db/schema';

import { attachmentKey } from '../../storage';
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

export default defineRecurringJob({
  name: 'attachment-files',
  schedule: '25 * * * *',
  /**
   * Purges the unsent and unfinished uploads, until there are none left or
   * the deadline comes, on one storage connection.
   *
   * @param ctx - Service context: the database and the storage.
   * @param options - The run's options.
   * @param options.deadline - When to stop starting new work.
   * @returns How many uploads were purged.
   */
  run: async (ctx, { deadline }) => {
    const storage = ctx.storage ? await ctx.storage() : null;
    if (!storage) {
      return { summary: { unsentFiles: 0 } };
    }
    const purged = await storage.session(async (shared) => {
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
          await shared.delete(attachmentKey(row.id));
          // Checked again: a text may have claimed it just now (it can't once it's purgeable).
          // eslint-disable-next-line no-await-in-loop -- one row at a time, after its file
          const deleted = await ctx.db
            .delete(requestAttachment)
            .where(and(eq(requestAttachment.id, row.id), isNull(requestAttachment.requestId)))
            .returning({ id: requestAttachment.id });
          count += deleted.length;
        }
      }
      return count;
    });
    return { summary: { unsentFiles: purged } };
  },
});
