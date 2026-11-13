/**
 * @file The daily job that deletes what Adiutor keeps only for a while:
 * audit events after a year, sign-in errors and other recorded errors after
 * 7 days, and the history of job runs and the queued jobs that are done
 * (or given up, or discarded) after 30 days. It deletes in chunks until its
 * deadline, so a large backlog is cleared over several runs.
 */
import { and, lt, ne, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

import type { Database } from '@/db';
import { appError, auditEvent, jobRun, queuedJob, signInError } from '@/db/schema';

import { APP_ERROR_RETENTION_DAYS } from '../../app-errors';
import { SIGN_IN_ERROR_RETENTION_DAYS } from '../../auth/sign-in-errors';
import { defineRecurringJob } from '../define';

/** How long audit events are kept, in days. */
export const AUDIT_RETENTION_DAYS = 365;

/** How long the history of job runs, and queued jobs that are done, are kept, in days. */
export const JOB_HISTORY_RETENTION_DAYS = 30;

/**
 * How many rows one statement deletes at most, so a large backlog never
 * holds its locks, or the database, for long.
 */
export const RETENTION_CHUNK_ROWS = 10_000;

/**
 * The moment a number of days ago, in the database's clock.
 *
 * @param days - How many days.
 * @returns The SQL for it.
 */
function daysAgo(days: number) {
  return sql`now() - make_interval(days => ${days})`;
}

/**
 * Deletes a table's rows that are past their time, a chunk at a time: one
 * chunk at least, so every table makes progress, and more until none are
 * left or the deadline has passed. The rest goes at the next run.
 *
 * @param db - Database client.
 * @param table - The table.
 * @param id - Its ID column.
 * @param expired - Which rows are past their time.
 * @param deadline - When to stop starting new chunks.
 * @returns How many rows were deleted.
 */
async function deleteInChunks(
  db: Database,
  table: PgTable,
  id: AnyPgColumn,
  expired: SQL | undefined,
  deadline: Date,
): Promise<number> {
  let deleted = 0;
  let more = true;
  while (more) {
    // One chunk at a time on purpose: each is a short statement of its own.
    // eslint-disable-next-line no-await-in-loop -- See above.
    const { rowCount } = await db.execute(
      sql`delete from ${table} where ${id} in (select ${id} from ${table} where ${expired} limit ${RETENTION_CHUNK_ROWS})`,
    );
    deleted += rowCount ?? 0;
    more = rowCount === RETENTION_CHUNK_ROWS && Date.now() < deadline.getTime();
  }
  return deleted;
}

export default defineRecurringJob({
  name: 'retention',
  schedule: '15 3 * * *',
  /**
   * Deletes what's older than it may be kept, one table after another.
   *
   * @param ctx - Service context (only the database is used).
   * @param options - How to run.
   * @param options.deadline - When to stop starting new chunks.
   * @returns How many rows were deleted per kind.
   */
  run: async (ctx, { deadline }) => {
    /**
     * Deletes one table's expired rows.
     *
     * @param table - The table.
     * @param id - Its ID column.
     * @param expired - Which rows are past their time.
     * @returns How many were deleted.
     */
    const clean = (table: PgTable, id: AnyPgColumn, expired: SQL | undefined) =>
      deleteInChunks(ctx.db, table, id, expired, deadline);
    const auditEvents = await clean(
      auditEvent,
      auditEvent.id,
      lt(auditEvent.at, daysAgo(AUDIT_RETENTION_DAYS)),
    );
    const signInErrors = await clean(
      signInError,
      signInError.id,
      lt(signInError.createdAt, daysAgo(SIGN_IN_ERROR_RETENTION_DAYS)),
    );
    const appErrors = await clean(
      appError,
      appError.id,
      lt(appError.createdAt, daysAgo(APP_ERROR_RETENTION_DAYS)),
    );
    const jobRuns = await clean(
      jobRun,
      jobRun.id,
      lt(jobRun.startedAt, daysAgo(JOB_HISTORY_RETENTION_DAYS)),
    );
    // Waiting and running jobs have no `finished_at`; only what's over goes.
    const queuedJobs = await clean(
      queuedJob,
      queuedJob.id,
      and(
        ne(queuedJob.status, 'queued'),
        ne(queuedJob.status, 'running'),
        lt(queuedJob.finishedAt, daysAgo(JOB_HISTORY_RETENTION_DAYS)),
      ),
    );
    return { summary: { auditEvents, signInErrors, appErrors, jobRuns, queuedJobs } };
  },
});
