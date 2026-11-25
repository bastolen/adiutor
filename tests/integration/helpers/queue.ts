/**
 * @file Running and storing queued jobs, and reading what waits in the queue.
 */
import { asc, eq, sql } from 'drizzle-orm';

import type { Database } from '@/db';
import { queuedJob, type QueuedJobStatus } from '@/db/schema';
import { firstRow } from '@/lib/defined';
import type { ServiceContext } from '@/server/context';
import { type JobRunResult, runQueue } from '@/server/jobs';

/**
 * A deadline far enough away that no test reaches it, for runs that may take
 * all the time they need.
 */
export const later = new Date(Date.now() + 60 * 60_000);

/**
 * Sends what waits in the queue, as the next tick would: security notices
 * and the other queued emails. Call it before checking for an email a
 * service queues.
 *
 * @param ctx - The service context, whose `sendEmail` gets the emails.
 * @param kinds - The kinds to run; every registered kind by default.
 * @returns The runs, one per kind that ran jobs.
 */
export async function sendQueuedEmails(
  ctx: ServiceContext,
  kinds?: Parameters<typeof runQueue>[1]['kinds'],
): Promise<JobRunResult[]> {
  const { runs } = await runQueue(ctx, {
    trigger: 'tick',
    deadline: later,
    startedAt: new Date(),
    ...(kinds ? { kinds } : {}),
  });
  return runs;
}

/**
 * Stores a queued job directly: waiting (never tried), or tried five times
 * and, when failed or succeeded, finished now.
 *
 * @param db - The test database.
 * @param kind - Its kind's name.
 * @param status - Where it is; given up after its last attempt by default.
 * @returns Its ID.
 */
export async function storeQueuedJob(
  db: Database,
  kind: string,
  status: QueuedJobStatus = 'failed',
): Promise<string> {
  const stored = firstRow(
    await db
      .insert(queuedJob)
      .values({
        kind,
        status,
        attempts: status === 'queued' ? 0 : 5,
        finishedAt: status === 'failed' || status === 'succeeded' ? sql`now()` : null,
      })
      .returning({ id: queuedJob.id }),
    'the queued job',
  );
  return stored.id;
}

/**
 * The kinds of the jobs waiting in the queue, oldest first. Services queue
 * most emails instead of sending them, so a check that nothing was sent also
 * checks this, or it would pass whatever the service queued.
 *
 * @param db - The test database.
 * @returns The kinds, e.g. `['security-notice']`; empty when nothing waits.
 */
export async function queuedJobKinds(db: Database): Promise<string[]> {
  const rows = await db
    .select({ kind: queuedJob.kind })
    .from(queuedJob)
    .where(eq(queuedJob.status, 'queued'))
    .orderBy(asc(queuedJob.runAt), asc(queuedJob.id));
  return rows.map(({ kind }) => kind);
}
