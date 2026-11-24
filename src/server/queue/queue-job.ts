/**
 * @file Adding a job to the queue (`queued_job`) for the next tick or later.
 */
import { sql } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '@/db';
import { queuedJob } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import type { JobPayload, QueuedJobKind } from './define';

/** When a queued job may run. */
export interface QueueOptions {
  /** Not before this moment; the next tick by default. */
  runAt?: Date;
}

/**
 * Adds several jobs of one kind to the queue in one statement, in the order
 * given, as {@link queueJob} adds one. Every payload is checked before
 * anything is stored, so one that doesn't fit stores none. One statement
 * keeps a change's transaction short when it queues a job for each of many
 * people; their IDs ascend in the order given, as they would one after
 * another.
 *
 * @param db - Database client or the change's transaction.
 * @param kind - The kind of job.
 * @param payloads - Their IDs and small settings, each checked against the kind's schema.
 * @param options - When they may run.
 * @param options.runAt - Not before this moment.
 * @returns The queued jobs' IDs, in the order of `payloads`.
 * @throws {ZodError} When a payload doesn't fit the kind's schema.
 */
export async function queueJobs<P extends JobPayload>(
  db: DatabaseOrTransaction,
  kind: QueuedJobKind<P>,
  // Typed by the kind alone, so `role: 'client'` stays the role it is.
  payloads: readonly NoInfer<P>[],
  { runAt }: QueueOptions = {},
): Promise<string[]> {
  const rows = payloads.map((payload) => {
    const checked = kind.check(payload);
    return {
      kind: kind.name,
      payload: { ...checked },
      batchKey: kind.batchKey(checked),
      runAt: runAt ?? sql`now()`,
    };
  });
  if (rows.length === 0) {
    return [];
  }
  const queued = await db.insert(queuedJob).values(rows).returning({ id: queuedJob.id });
  return queued.map(({ id }) => id);
}

/**
 * Adds a job to the queue. Call it inside the transaction of the change it
 * belongs to where there is one (else right after the change), so the job
 * only exists if the change was saved. A job of a kind with `batch` gets its
 * batch key, so it runs with the others of that key.
 *
 * @param db - Database client or the change's transaction.
 * @param kind - The kind of job.
 * @param payload - Its IDs and small settings, checked against the kind's schema.
 * @param options - When it may run.
 * @returns The queued job's ID.
 * @throws {ZodError} When the payload doesn't fit the kind's schema.
 */
export async function queueJob<P extends JobPayload>(
  db: DatabaseOrTransaction,
  kind: QueuedJobKind<P>,
  // Typed by the kind alone, so `role: 'client'` stays the role it is.
  payload: NoInfer<P>,
  options: QueueOptions = {},
): Promise<string> {
  return firstRow(await queueJobs(db, kind, [payload], options), 'the queued job');
}
