/**
 * @file The runner's side of the queue (`queued_job`): taking the next due
 * job under a lease, noting how it ended, and trying a failed one again after
 * a growing wait. Jobs are added with `queueJob` (`src/server/queue`).
 */
import { and, asc, eq, inArray, lt, lte, ne, sql } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { type QueuedJobStatus, queuedJob } from '@/db/schema';

import type { QueuedJob } from './define';
import { JOB_LEASE_MINUTES } from './state';

/**
 * How long a failed job waits before it's tried again, in minutes: after the
 * first failed attempt, the second, and so on; the last wait repeats.
 */
const RETRY_MINUTES = [5, 15, 60, 360] as const;

/**
 * How long a job waits after a failed attempt.
 *
 * @param attempts - How many times it was tried so far.
 * @returns The wait, in minutes.
 */
export function retryWaitMinutes(attempts: number): number {
  return RETRY_MINUTES[Math.min(Math.max(attempts, 1), RETRY_MINUTES.length) - 1] ?? 5;
}

/**
 * The condition for waiting jobs whose time has come.
 *
 * @returns The SQL condition.
 */
function waiting() {
  return and(eq(queuedJob.status, 'queued'), lte(queuedJob.runAt, sql`now()`));
}

/**
 * The condition for jobs whose run died: still `running`, but their lease ran out.
 *
 * @returns The SQL condition.
 */
function died() {
  return and(eq(queuedJob.status, 'running'), lt(queuedJob.lockedUntil, sql`now()`));
}

/**
 * Whether any job of the given kinds could run now. Jobs waiting for a later
 * attempt don't count, so a failing job never makes it look like work is left.
 * Each check is a lookup in an index (`queued_job_due_idx`,
 * `queued_job_status_kind_idx`).
 *
 * @param db - Database client.
 * @param kinds - The names of the kinds that may run.
 * @returns Whether one is due.
 */
export async function hasDueQueuedJobs(
  db: DatabaseOrTransaction,
  kinds: readonly string[],
): Promise<boolean> {
  if (kinds.length === 0) {
    return false;
  }
  const ofKinds = inArray(queuedJob.kind, [...kinds]);
  const found = await Promise.all(
    [waiting(), died()].map(async (condition) =>
      db.select({ id: queuedJob.id }).from(queuedJob).where(and(ofKinds, condition)).limit(1),
    ),
  );
  return found.some((rows) => rows.length > 0);
}

/**
 * Takes the oldest job of one kind that meets a condition, under a lease,
 * with every other waiting, due job of its batch key among the given kinds.
 * The jobs are updated by their IDs in one list (`UNION ALL`), so the update
 * finds them by primary key instead of reading the whole table.
 *
 * @param db - Database client.
 * @param kinds - The names of the kinds that may run now, for the rest of a batch.
 * @param first - The kind to take the job from.
 * @param condition - Which of its jobs: waiting ones, or ones whose run died.
 * @returns The jobs taken, as the update returned them.
 */
async function claimWhere(
  db: DatabaseOrTransaction,
  kinds: readonly string[],
  first: string,
  condition: ReturnType<typeof waiting>,
) {
  const next = db.$with('next').as(
    db
      .select({ id: queuedJob.id, batchKey: queuedJob.batchKey })
      .from(queuedJob)
      .where(and(eq(queuedJob.kind, first), condition))
      .orderBy(asc(queuedJob.runAt), asc(queuedJob.id))
      .limit(1)
      .for('update', { skipLocked: true }),
  );
  const members = db.$with('members').as(
    db
      .select({ id: queuedJob.id })
      .from(queuedJob)
      .innerJoin(next, eq(queuedJob.batchKey, next.batchKey))
      .where(and(inArray(queuedJob.kind, [...kinds]), ne(queuedJob.id, next.id), waiting()))
      .for('update', { of: queuedJob, skipLocked: true }),
  );
  return db
    .with(next, members)
    .update(queuedJob)
    .set({
      status: 'running',
      attempts: sql`${queuedJob.attempts} + 1`,
      lockedUntil: sql`now() + make_interval(mins => ${JOB_LEASE_MINUTES})`,
    })
    .where(
      inArray(
        queuedJob.id,
        db
          .select({ id: next.id })
          .from(next)
          .unionAll(db.select({ id: members.id }).from(members)),
      ),
    )
    .returning({
      id: queuedJob.id,
      kind: queuedJob.kind,
      payload: queuedJob.payload,
      attempts: queuedJob.attempts,
      runAt: queuedJob.runAt,
      queuedAt: queuedJob.createdAt,
    });
}

/**
 * Takes the oldest due job of one kind, under a lease: a waiting job whose
 * time has come (served by `queued_job_due_idx`), or, when none waits, one
 * whose run died (its lease ran out). A job with a batch key comes with every
 * other waiting, due job of that key among the given kinds, so they run
 * together, whatever their kind. Jobs another run is taking at the same
 * moment are skipped (`SKIP LOCKED`), so two ticks never take the same job;
 * at worst, two ticks split one key's jobs between them.
 *
 * @param db - Database client.
 * @param kinds - The names of the kinds that may run now.
 * @param first - The kind to take the job from, whose turn it is.
 * @returns The job and the rest of its batch, oldest first; empty when none is due.
 */
export async function claimNextQueuedJobs(
  db: DatabaseOrTransaction,
  kinds: readonly string[],
  first: string,
): Promise<QueuedJob[]> {
  const taken = await claimWhere(db, kinds, first, waiting());
  const claimed = taken.length > 0 ? taken : await claimWhere(db, kinds, first, died());
  return claimed
    .sort((a, b) => a.runAt.getTime() - b.runAt.getTime() || a.id.localeCompare(b.id))
    .map(({ id, kind, payload, attempts, queuedAt }) => ({
      id,
      kind,
      payload,
      attempts,
      queuedAt,
    }));
}

/**
 * Notes how a job ended and frees it.
 *
 * @param db - Database client.
 * @param id - The job.
 * @param status - How it ended.
 * @param errorReference - The reference of the error its last attempt recorded, when it failed.
 */
export async function finishQueuedJob(
  db: DatabaseOrTransaction,
  id: string,
  status: Extract<QueuedJobStatus, 'succeeded' | 'skipped' | 'failed'>,
  errorReference?: string | null,
): Promise<void> {
  await db
    .update(queuedJob)
    .set({
      status,
      lockedUntil: null,
      finishedAt: sql`now()`,
      ...(errorReference ? { lastErrorReference: errorReference } : {}),
    })
    .where(eq(queuedJob.id, id));
}

/**
 * Puts a job that failed back in the queue, to be tried again after a wait
 * that grows with each attempt (`RETRY_MINUTES`).
 *
 * @param db - Database client.
 * @param id - The job.
 * @param attempts - How many times it was tried so far.
 * @param errorReference - The reference of the error this attempt recorded, if any.
 */
export async function retryQueuedJobLater(
  db: DatabaseOrTransaction,
  id: string,
  attempts: number,
  errorReference: string | null,
): Promise<void> {
  await db
    .update(queuedJob)
    .set({
      status: 'queued',
      lockedUntil: null,
      runAt: sql`now() + make_interval(mins => ${retryWaitMinutes(attempts)})`,
      ...(errorReference ? { lastErrorReference: errorReference } : {}),
    })
    .where(eq(queuedJob.id, id));
}
