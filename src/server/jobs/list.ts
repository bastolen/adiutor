/**
 * @file The overview of every recurring job: its schedule, whether it's
 * paused or running, how its last run went and when it runs next. For
 * `pnpm jobs:list`.
 */
import type { JobRunStatus } from '@/db/schema';

import type { ServiceContext } from '../context';
import { RECURRING_JOBS } from './registry';
import { isDue, nextScheduledAt } from './schedule';
import { loadJobStates } from './state';

/** One job in the overview. */
export interface JobListing {
  /** The job's name. */
  name: string;
  /** Its schedule, a cron expression in UTC. */
  schedule: string;
  /** Whether staff Admins may pause it. */
  pausable: boolean;
  /** Whether it's paused (only a job that can be paused ever is). */
  paused: boolean;
  /** Whether a run holds it right now. */
  running: boolean;
  /** When its last run started, or `null` if it never ran. */
  lastStartedAt: Date | null;
  /** When its last run finished. */
  lastFinishedAt: Date | null;
  /** How its last run ended. */
  lastStatus: JobRunStatus | null;
  /** How many runs in a row failed. */
  consecutiveFailures: number;
  /** Whether the next tick runs it: it isn't paused and a scheduled moment passed since its last start. */
  due: boolean;
  /** When the tick runs it next: the next tick when it's due, else its next scheduled moment; `null` while paused. */
  nextRunAt: Date | null;
}

/**
 * Lists every recurring job with its state.
 *
 * @param ctx - Service context (only the database is used).
 * @param now - The current moment; now by default.
 * @returns The jobs, in the order the tick runs them.
 */
export async function listJobs(
  ctx: Pick<ServiceContext, 'db'>,
  now: Date = new Date(),
): Promise<JobListing[]> {
  const states = await loadJobStates(ctx.db);
  return RECURRING_JOBS.map((job) => {
    const state = states.get(job.name);
    const lastStartedAt = state?.lastStartedAt ?? null;
    const pausable = job.pausable !== false;
    const paused = pausable && Boolean(state?.pausedAt);
    const due = !paused && isDue(job.schedule, lastStartedAt, now);
    let nextRunAt: Date | null = null;
    if (!paused) {
      nextRunAt = due ? now : nextScheduledAt(job.schedule, now);
    }
    return {
      name: job.name,
      schedule: job.schedule,
      pausable,
      paused,
      running: Boolean(state?.lockedUntil && state.lockedUntil > now),
      lastStartedAt,
      lastFinishedAt: state?.lastFinishedAt ?? null,
      lastStatus: state?.lastStatus ?? null,
      consecutiveFailures: state?.consecutiveFailures ?? 0,
      due,
      nextRunAt,
    };
  });
}
