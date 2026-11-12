/**
 * @file Looking after the queue: how many jobs of each kind wait or failed,
 * which ones failed, and trying failed jobs again or discarding them. For
 * `pnpm jobs:list`, `jobs:retry` and `jobs:discard`.
 */
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from '@/db';
import { queuedJob } from '@/db/schema';

import { QUEUED_JOBS } from './registry';
import { loadJobStates } from './state';

/** One kind of queued job in the overview. */
export interface QueuedKindListing {
  /** The kind's name. */
  name: string;
  /** Whether the registry lists it; jobs of a kind it doesn't list are never run. */
  known: boolean;
  /** Whether it's paused. */
  paused: boolean;
  /** Jobs waiting or running. */
  waiting: number;
  /** Jobs given up after their last attempt. */
  failed: number;
}

/**
 * Lists every kind of queued job, with how many of its jobs wait and how
 * many failed; kinds the registry no longer lists are included when jobs of
 * them are still there.
 *
 * @param db - Database client.
 * @returns The kinds: the registered ones in order, then the others by name.
 */
export async function listQueuedKinds(db: Database): Promise<QueuedKindListing[]> {
  const [rows, states] = await Promise.all([
    db
      .select({ kind: queuedJob.kind, status: queuedJob.status, jobs: count() })
      .from(queuedJob)
      .where(inArray(queuedJob.status, ['queued', 'running', 'failed']))
      .groupBy(queuedJob.kind, queuedJob.status),
    loadJobStates(db),
  ]);
  const registered = QUEUED_JOBS.map((kind) => kind.name);
  const others = [...new Set(rows.map((row) => row.kind))]
    .filter((name) => !registered.includes(name))
    .sort();
  return [...registered, ...others].map((name) => {
    /**
     * Counts the kind's jobs in some statuses.
     *
     * @param statuses - The statuses.
     * @returns How many.
     */
    const of = (statuses: string[]) =>
      rows
        .filter((row) => row.kind === name && statuses.includes(row.status))
        .reduce((sum, row) => sum + row.jobs, 0);
    return {
      name,
      known: registered.includes(name),
      paused: Boolean(states.get(name)?.pausedAt),
      waiting: of(['queued', 'running']),
      failed: of(['failed']),
    };
  });
}

/** A queued job that was given up. */
export interface FailedQueuedJob {
  /** The job's ID. */
  id: string;
  /** Its kind's name. */
  kind: string;
  /** How many times it was tried. */
  attempts: number;
  /** When it was given up. */
  failedAt: Date | null;
}

/**
 * Lists the queued jobs that were given up, latest first.
 *
 * @param db - Database client.
 * @param limit - How many at most.
 * @returns The jobs.
 */
export async function listFailedQueuedJobs(db: Database, limit = 50): Promise<FailedQueuedJob[]> {
  return db
    .select({
      id: queuedJob.id,
      kind: queuedJob.kind,
      attempts: queuedJob.attempts,
      failedAt: queuedJob.finishedAt,
    })
    .from(queuedJob)
    .where(eq(queuedJob.status, 'failed'))
    .orderBy(desc(queuedJob.finishedAt), desc(queuedJob.id))
    .limit(limit);
}

/** Which failed jobs: one by ID, or every one of a kind. */
export type FailedJobsSelection = { id: string } | { kind: string };

/**
 * The condition for the failed jobs a selection names.
 *
 * @param selection - The selection.
 * @returns The SQL condition.
 */
function failedJobs(selection: FailedJobsSelection) {
  return and(
    eq(queuedJob.status, 'failed'),
    'id' in selection ? eq(queuedJob.id, selection.id) : eq(queuedJob.kind, selection.kind),
  );
}

/**
 * Puts failed jobs back in the queue for the next tick, with a fresh count
 * of attempts.
 *
 * @param db - Database client.
 * @param selection - Which failed jobs.
 * @returns How many were put back.
 */
export async function retryFailedQueuedJobs(
  db: Database,
  selection: FailedJobsSelection,
): Promise<number> {
  const retried = await db
    .update(queuedJob)
    .set({ status: 'queued', attempts: 0, runAt: sql`now()`, finishedAt: null })
    .where(failedJobs(selection))
    .returning({ id: queuedJob.id });
  return retried.length;
}

/**
 * Discards failed jobs: they stay in the history as discarded and are
 * deleted with the other finished jobs after 30 days.
 *
 * @param db - Database client.
 * @param selection - Which failed jobs.
 * @returns How many were discarded.
 */
export async function discardFailedQueuedJobs(
  db: Database,
  selection: FailedJobsSelection,
): Promise<number> {
  const discarded = await db
    .update(queuedJob)
    .set({ status: 'discarded', finishedAt: sql`now()` })
    .where(failedJobs(selection))
    .returning({ id: queuedJob.id });
  return discarded.length;
}
