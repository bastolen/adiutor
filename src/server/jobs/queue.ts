/**
 * @file The queue (`queued_job`): adding a job for the next tick or later,
 * taking the next due job under a lease, noting how it ended, and trying a
 * failed one again after a growing wait.
 */
import { and, asc, eq, inArray, lt, lte, ne, or, sql } from 'drizzle-orm';

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
 * belongs to, so the job only exists if the change was saved. A job of a
 * kind with `batch` gets its batch key, so it runs with the others of that
 * key.
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
    .values({
      kind: kind.name,
      payload: { ...checked },
      batchKey: kind.batchKey(checked),
      runAt: runAt ?? sql`now()`,
    })
    .returning({ id: queuedJob.id });
  return firstRow(queued, 'the queued job').id;
}

/**
 * Takes the oldest due job of one of the given kinds, under a lease: a
 * waiting job whose time has come, or one whose run died (its lease ran
 * out). A job with a batch key comes with every other waiting, due job of
 * that key, so they run together. Jobs another run is taking at the same
 * moment are skipped (`SKIP LOCKED`), so two ticks never take the same job;
 * at worst, two ticks split one key's jobs between them.
 *
 * @param db - Database client.
 * @param kinds - The names of the kinds that may run now.
 * @returns The job and the rest of its batch, oldest first; empty when none is due.
 */
export async function claimNextQueuedJobs(
  db: DatabaseOrTransaction,
  kinds: readonly string[],
): Promise<StoredQueuedJob[]> {
  if (kinds.length === 0) {
    return [];
  }
  const ofKinds = inArray(queuedJob.kind, [...kinds]);
  const next = db.$with('next').as(
    db
      .select({ id: queuedJob.id, batchKey: queuedJob.batchKey })
      .from(queuedJob)
      .where(
        and(
          ofKinds,
          or(
            and(eq(queuedJob.status, 'queued'), lte(queuedJob.runAt, sql`now()`)),
            and(eq(queuedJob.status, 'running'), lt(queuedJob.lockedUntil, sql`now()`)),
          ),
        ),
      )
      .orderBy(asc(queuedJob.runAt), asc(queuedJob.id))
      .limit(1)
      .for('update', { skipLocked: true }),
  );
  const members = db.$with('members').as(
    db
      .select({ id: queuedJob.id })
      .from(queuedJob)
      .innerJoin(next, eq(queuedJob.batchKey, next.batchKey))
      .where(
        and(
          ofKinds,
          ne(queuedJob.id, next.id),
          eq(queuedJob.status, 'queued'),
          lte(queuedJob.runAt, sql`now()`),
        ),
      )
      .for('update', { of: queuedJob, skipLocked: true }),
  );
  const claimed = await db
    .with(next, members)
    .update(queuedJob)
    .set({
      status: 'running',
      attempts: sql`${queuedJob.attempts} + 1`,
      lockedUntil: sql`now() + make_interval(mins => ${JOB_LEASE_MINUTES})`,
    })
    .where(
      or(
        inArray(queuedJob.id, db.select({ id: next.id }).from(next)),
        inArray(queuedJob.id, db.select({ id: members.id }).from(members)),
      ),
    )
    .returning({
      id: queuedJob.id,
      kind: queuedJob.kind,
      payload: queuedJob.payload,
      attempts: queuedJob.attempts,
      runAt: queuedJob.runAt,
    });
  return claimed
    .sort((a, b) => a.runAt.getTime() - b.runAt.getTime() || a.id.localeCompare(b.id))
    .map(({ id, kind, payload, attempts }) => ({ id, kind, payload, attempts }));
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
