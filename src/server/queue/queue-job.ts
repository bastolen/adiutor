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
 * Adds a job to the queue. Call it inside the transaction of the change it
 * belongs to where there is one (else right after the change), so the job
 * only exists if the change was saved. A job of a kind with `batch` gets its
 * batch key, so it runs with the others of that key.
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
  // Typed by the kind alone, so `role: 'client'` stays the role it is.
  payload: NoInfer<P>,
  { runAt }: QueueOptions = {},
): Promise<string> {
  const checked = kind.check(payload);
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
