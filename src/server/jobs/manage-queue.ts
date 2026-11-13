/**
 * @file Looking after the queue: how many jobs of each kind wait or failed,
 * which ones failed, and trying failed jobs again or discarding them. For
 * `pnpm jobs:list`, `jobs:retry` and `jobs:discard`, and the Jobs page.
 */
import { and, count, eq, inArray, sql } from 'drizzle-orm';

import type { Database, DatabaseOrTransaction } from '@/db';
import { queuedJob } from '@/db/schema';
import type { SortDirection } from '@/lib/tables/table-state';

import { orderTerms } from '../pagination';
import { findQueuedKind, QUEUED_JOBS } from './registry';
import { loadJobStates } from './state';

/** One kind of queued job in the overview. */
export interface QueuedKindListing {
  /** The kind's name. */
  name: string;
  /** Whether the registry lists it; jobs of a kind it doesn't list are never run. */
  known: boolean;
  /** Whether staff Admins may pause it: a kind the registry lists, unless it says otherwise. */
  pausable: boolean;
  /** Whether it's paused (only a kind that can be paused ever is). */
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
  const pausable = new Set(QUEUED_JOBS.filter((kind) => kind.pausable).map((kind) => kind.name));
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
      pausable: pausable.has(name),
      paused: pausable.has(name) && Boolean(states.get(name)?.pausedAt),
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
  /** Whether the registry still lists its kind; only then can it be retried, as no tick runs the others. */
  known: boolean;
  /** How many times it was tried. */
  attempts: number;
  /** When it was queued. */
  queuedAt: Date;
  /** When it was given up. */
  failedAt: Date | null;
  /** The reference of the error its last attempt recorded. */
  errorReference: string | null;
}

/**
 * Reads queued jobs that were given up, by when they were given up, without
 * their payloads (only IDs, which tell nobody anything; the error reference
 * says what went wrong). For the command line and the Jobs page.
 *
 * @param db - Database client.
 * @param page - Which jobs.
 * @param page.limit - How many at most.
 * @param page.offset - How many to skip.
 * @param page.dir - Latest first (`desc`) or oldest first.
 * @returns The jobs.
 */
export async function readFailedQueuedJobs(
  db: Database,
  { limit, offset = 0, dir = 'desc' }: { limit: number; offset?: number; dir?: SortDirection },
): Promise<FailedQueuedJob[]> {
  const rows = await db
    .select({
      id: queuedJob.id,
      kind: queuedJob.kind,
      attempts: queuedJob.attempts,
      queuedAt: queuedJob.createdAt,
      failedAt: queuedJob.finishedAt,
      errorReference: queuedJob.lastErrorReference,
    })
    .from(queuedJob)
    .where(eq(queuedJob.status, 'failed'))
    .orderBy(...orderTerms(dir, queuedJob.finishedAt, queuedJob.id))
    .limit(limit)
    .offset(offset);
  return rows.map((row) => ({ ...row, known: findQueuedKind(row.kind) !== undefined }));
}

/**
 * Lists the queued jobs that were given up, latest first.
 *
 * @param db - Database client.
 * @param limit - How many at most.
 * @returns The jobs.
 */
export async function listFailedQueuedJobs(db: Database, limit = 50): Promise<FailedQueuedJob[]> {
  return readFailedQueuedJobs(db, { limit });
}

/** Which failed jobs: one by ID, or every one of a kind. */
export type FailedJobsSelection = { id: string } | { kind: string };

/** A failed job that was put back or discarded. */
export interface ChangedQueuedJob {
  /** The job's ID. */
  id: string;
  /** Its kind's name. */
  kind: string;
}

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
 * @param db - Database client or transaction.
 * @param selection - Which failed jobs.
 * @returns The jobs that were put back.
 */
export async function retryFailedQueuedJobs(
  db: DatabaseOrTransaction,
  selection: FailedJobsSelection,
): Promise<ChangedQueuedJob[]> {
  return db
    .update(queuedJob)
    .set({ status: 'queued', attempts: 0, runAt: sql`now()`, finishedAt: null })
    .where(failedJobs(selection))
    .returning({ id: queuedJob.id, kind: queuedJob.kind });
}

/**
 * Discards failed jobs: they stay in the history as discarded and are
 * deleted with the other finished jobs after 30 days.
 *
 * @param db - Database client or transaction.
 * @param selection - Which failed jobs.
 * @returns The jobs that were discarded.
 */
export async function discardFailedQueuedJobs(
  db: DatabaseOrTransaction,
  selection: FailedJobsSelection,
): Promise<ChangedQueuedJob[]> {
  return db
    .update(queuedJob)
    .set({ status: 'discarded', finishedAt: sql`now()` })
    .where(failedJobs(selection))
    .returning({ id: queuedJob.id, kind: queuedJob.kind });
}
