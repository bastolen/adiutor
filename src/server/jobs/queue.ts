/**
 * @file The queue (`queued_job`): adding a job for the next tick or later,
 * taking the next due job under a lease, noting how it ended, and trying a
 * failed one again after a growing wait.
 */
import { and, asc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { type QueuedJobStatus, queuedJob } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import type { JobPayload, QueuedJobKind, StoredQueuedJob } from './define';
import { JOB_LEASE_MINUTES } from './state';

/**
 * How long a failed job waits before it's tried again, in minutes: after the
 * first failed attempt, the second, and so on; the last wait repeats.
 */
export const RETRY_MINUTES = [5, 15, 60, 360] as const;

/**
 * How long a job waits after a failed attempt.
 *
 * @param attempts - How many times it was tried so far.
 * @returns The wait, in minutes.
 */
export function retryWaitMinutes(attempts: number): number {
  return RETRY_MINUTES[Math.min(Math.max(attempts, 1), RETRY_MINUTES.length) - 1] ?? 5;
}

/** When a queued job may run. */
export interface QueueOptions {
  /** Not before this moment; the next tick by default. */
  runAt?: Date;
}

/**
 * Adds a job to the queue. Call it inside the transaction of the change it
 * belongs to, so the job only exists if the change was saved.
 *
 * @param db - Database client or the change's transaction.
 * @param kind - The kind of job.
 * @param payload - Its IDs and small settings, checked against the kind's schema.
 * @param options - When it may run.
 * @param options.runAt - Not before this moment.
 * @returns The queued job's ID.
 * @throws {ZodError} When the payload doesn't fit the kind's schema.
 */
export async function queueJob<P extends JobPayload>(
  db: DatabaseOrTransaction,
  kind: QueuedJobKind<P>,
  payload: P,
  { runAt }: QueueOptions = {},
): Promise<string> {
  const checked = kind.payload.parse(payload);
  const queued = await db
    .insert(queuedJob)
    .values({ kind: kind.name, payload: { ...checked }, runAt: runAt ?? sql`now()` })
    .returning({ id: queuedJob.id });
  return firstRow(queued, 'the queued job').id;
}

/**
 * Takes the oldest due job of one of the given kinds, under a lease: a
 * waiting job whose time has come, or one whose run died (its lease ran
 * out). Jobs another run is taking at the same moment are skipped
 * (`SKIP LOCKED`), so two ticks never take the same job.
 *
 * @param db - Database client.
 * @param kinds - The names of the kinds that may run now.
 * @returns The job, or `null` when none is due.
 */
export async function claimNextQueuedJob(
  db: DatabaseOrTransaction,
  kinds: readonly string[],
): Promise<StoredQueuedJob | null> {
  if (kinds.length === 0) {
    return null;
  }
  const next = db
    .select({ id: queuedJob.id })
    .from(queuedJob)
    .where(
      and(
        inArray(queuedJob.kind, [...kinds]),
        or(
          and(eq(queuedJob.status, 'queued'), lte(queuedJob.runAt, sql`now()`)),
          and(eq(queuedJob.status, 'running'), lt(queuedJob.lockedUntil, sql`now()`)),
        ),
      ),
    )
    .orderBy(asc(queuedJob.runAt), asc(queuedJob.id))
    .limit(1)
    .for('update', { skipLocked: true });
  const [claimed] = await db
    .update(queuedJob)
    .set({
      status: 'running',
      attempts: sql`${queuedJob.attempts} + 1`,
      lockedUntil: sql`now() + make_interval(mins => ${JOB_LEASE_MINUTES})`,
    })
    .where(inArray(queuedJob.id, next))
    .returning({
      id: queuedJob.id,
      kind: queuedJob.kind,
      payload: queuedJob.payload,
      attempts: queuedJob.attempts,
    });
  return claimed ?? null;
}

/**
 * Notes how a job ended and frees it.
 *
 * @param db - Database client.
 * @param id - The job.
 * @param status - How it ended.
 */
export async function finishQueuedJob(
  db: DatabaseOrTransaction,
  id: string,
  status: Extract<QueuedJobStatus, 'succeeded' | 'skipped' | 'failed'>,
): Promise<void> {
  await db
    .update(queuedJob)
    .set({ status, lockedUntil: null, finishedAt: sql`now()` })
    .where(eq(queuedJob.id, id));
}

/**
 * Puts a job that failed back in the queue, to be tried again after a wait
 * that grows with each attempt (`RETRY_MINUTES`).
 *
 * @param db - Database client.
 * @param id - The job.
 * @param attempts - How many times it was tried so far.
 */
export async function retryQueuedJobLater(
  db: DatabaseOrTransaction,
  id: string,
  attempts: number,
): Promise<void> {
  await db
    .update(queuedJob)
    .set({
      status: 'queued',
      lockedUntil: null,
      runAt: sql`now() + make_interval(mins => ${retryWaitMinutes(attempts)})`,
    })
    .where(eq(queuedJob.id, id));
}
