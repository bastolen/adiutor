/**
 * @file Each job's state in the database (`job_state`): taking a job for a
 * run under a lease, so two runs never do the same job at once, and
 * recording how the run went (`job_run`).
 */
import { and, isNull, lt, or, sql } from 'drizzle-orm';

import type { Database } from '@/db';
import { type JobRunStatus, type JobTrigger, jobRun, jobState } from '@/db/schema';
import { firstRow } from '@/lib/defined';

import type { JobSummary } from './define';

/**
 * How long a run holds its job, in minutes. A run that dies frees the job
 * when this runs out; every run's deadline is well before it.
 */
export const JOB_LEASE_MINUTES = 15;

/** A job's state, as the tick and the job list read it. */
export interface JobState {
  /** The job's name. */
  name: string;
  /** When it was paused, or `null`. */
  pausedAt: Date | null;
  /** Until when a run holds it, or `null`. */
  lockedUntil: Date | null;
  /** When its last run started, or `null` if it never ran. */
  lastStartedAt: Date | null;
  /** When its last run finished. */
  lastFinishedAt: Date | null;
  /** How its last run ended. */
  lastStatus: JobRunStatus | null;
  /** How many runs in a row failed. */
  consecutiveFailures: number;
}

/**
 * Reads the state of every job that has one (jobs that never ran have none).
 *
 * @param db - Database client.
 * @returns The states by job name.
 */
export async function loadJobStates(db: Database): Promise<Map<string, JobState>> {
  const rows = await db
    .select({
      name: jobState.name,
      pausedAt: jobState.pausedAt,
      lockedUntil: jobState.lockedUntil,
      lastStartedAt: jobState.lastStartedAt,
      lastFinishedAt: jobState.lastFinishedAt,
      lastStatus: jobState.lastStatus,
      consecutiveFailures: jobState.consecutiveFailures,
    })
    .from(jobState);
  return new Map(rows.map((row) => [row.name, row]));
}

/**
 * Takes a job for a run, unless another run holds it. With `slot` (the
 * tick), only while it isn't paused and hasn't started since that scheduled
 * moment: two ticks at once can't both run it for the same moment, even one
 * after the other.
 *
 * @param db - Database client.
 * @param name - The job's name.
 * @param claim - The claim.
 * @param claim.startedAt - When the run starts, stored as the job's last start.
 * @param claim.slot - The scheduled moment the tick runs it for, or `null` to run it now regardless.
 * @returns Whether the run may go ahead.
 */
export async function claimJob(
  db: Database,
  name: string,
  { startedAt, slot }: { startedAt: Date; slot: Date | null },
): Promise<boolean> {
  const free = or(isNull(jobState.lockedUntil), lt(jobState.lockedUntil, sql`now()`));
  const claimed = await db
    .insert(jobState)
    .values({
      name,
      lockedUntil: sql`now() + make_interval(mins => ${JOB_LEASE_MINUTES})`,
      lastStartedAt: startedAt,
    })
    .onConflictDoUpdate({
      target: jobState.name,
      set: {
        lockedUntil: sql`excluded.locked_until`,
        lastStartedAt: sql`excluded.last_started_at`,
      },
      setWhere: slot
        ? and(
            free,
            isNull(jobState.pausedAt),
            or(isNull(jobState.lastStartedAt), lt(jobState.lastStartedAt, slot)),
          )
        : free,
    })
    .returning({ id: jobState.id });
  return claimed.length > 0;
}

/** A finished run, to record. */
export interface FinishedRun {
  /** The job's name. */
  job: string;
  /** What started it. */
  trigger: JobTrigger;
  /** The staff Admin who started it, if one did. */
  startedBy: string | null;
  /** When it started. */
  startedAt: Date;
  /** How it ended. */
  status: JobRunStatus;
  /** What it did. */
  summary: JobSummary;
  /** The reference of the error a failed run recorded, if any. */
  errorReference?: string | null;
}

/**
 * Frees the job, notes how its run went and adds the run to the history. A
 * kind of queued job gets its state row the first time it runs.
 *
 * @param db - Database client.
 * @param run - The finished run.
 * @returns The history row's ID, and how many runs in a row have failed now.
 */
export async function finishJobRun(
  db: Database,
  run: FinishedRun,
): Promise<{ runId: string; consecutiveFailures: number }> {
  const failed = run.status === 'failed';
  return db.transaction(async (tx) => {
    const state = await tx
      .insert(jobState)
      .values({
        name: run.job,
        lastStartedAt: run.startedAt,
        lastFinishedAt: sql`now()`,
        lastStatus: run.status,
        consecutiveFailures: failed ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: jobState.name,
        set: {
          lockedUntil: null,
          lastStartedAt: run.startedAt,
          lastFinishedAt: sql`now()`,
          lastStatus: run.status,
          consecutiveFailures: failed ? sql`${jobState.consecutiveFailures} + 1` : 0,
        },
      })
      .returning({ consecutiveFailures: jobState.consecutiveFailures });
    const recorded = await tx
      .insert(jobRun)
      .values({
        job: run.job,
        trigger: run.trigger,
        startedBy: run.startedBy,
        startedAt: run.startedAt,
        status: run.status,
        summary: { ...run.summary },
        errorReference: run.errorReference ?? null,
      })
      .returning({ id: jobRun.id });
    return {
      runId: firstRow(recorded, 'the recorded run').id,
      consecutiveFailures: firstRow(state, 'the job state').consecutiveFailures,
    };
  });
}
