/**
 * @file The tick: what the endpoint and `pnpm jobs:run` start every few
 * minutes. It notes that it started (`recordTick`), runs every recurring job
 * that's due, one after another, then the queued jobs that are due, until
 * its deadline; and running one job now, whether it's due or not.
 */
import type { JobTrigger } from '@/db/schema';
import { SEND_TIMEOUT_MS } from '@/lib/email-limits';

import type { ServiceContext } from '../context';
import { notFoundError } from '../errors';
import type { QueuedJobRunner, RecurringJob } from './define';
import { findRecurringJob, RECURRING_JOBS } from './registry';
import { type JobRunResult, recordUnfinishedRuns, runRecurringJob } from './run';
import { runQueue } from './run-queue';
import { isDue, lastScheduledAt } from './schedule';
import { isPaused, loadJobStates } from './state';
import { recordTick } from './tick-record';

/**
 * How long the platform lets the function behind a request run, in seconds:
 * the `maxDuration` of the tick's route (`src/app/api/jobs/route.ts`) and of
 * the Jobs page, which Next.js needs written out there.
 */
export const PLATFORM_LIMIT_SECONDS = 60;

/** The time kept for recording a run and answering once its work has ended, in seconds. */
export const WRAP_UP_SECONDS = 5;

/**
 * How long a run inside a request may keep starting new work, in seconds: the
 * endpoint's tick and a job started from the Jobs page. Work started just
 * before this deadline must still end, and be recorded, before the platform
 * stops the function. The longest such piece of work is one email (or one
 * group of emails sent together), which takes at most `SEND_TIMEOUT_MS`, 15
 * seconds (an attempt to deliver to a webhook takes at most 10,
 * `WEBHOOK_TIMEOUT_MS`); when it fails for good, the staff Admins' alert follows
 * (`alertStaffAdmins`, one group of emails sent together), up to another 15.
 * So: 60 − 15 − 15 − 5 = 25. The recurring jobs get the first half of it. A
 * run that the platform stops anyway stays `running` for its 15-minute lease
 * and loses an attempt, and an alert cut off mid-send would also have used up
 * the day's alert.
 */
export const REQUEST_RUN_SECONDS =
  PLATFORM_LIMIT_SECONDS - 2 * (SEND_TIMEOUT_MS / 1000) - WRAP_UP_SECONDS;

/** What a tick did. */
export interface TickResult {
  /** The runs it started, in order: recurring jobs, then one per kind of queued job that ran. */
  runs: JobRunResult[];
  /** Jobs that were due but left for the next tick, because the deadline came first. */
  leftForNextTick: string[];
  /**
   * Whether work is still due: recurring jobs were left for the next tick, or
   * the deadline came while queued jobs could still run. Jobs waiting for a
   * later attempt don't count.
   */
  moreDue: boolean;
  /** Whether any run failed. */
  failed: boolean;
}

/** How a tick runs. */
export interface TickOptions {
  /** What starts it: the endpoint (`tick`) or the command line (`cli`). */
  trigger: Extract<JobTrigger, 'tick' | 'cli'>;
  /** When it should stop starting new runs. */
  deadline: Date;
  /** The current moment; now by default (tests pass their own). */
  now?: Date;
  /** The recurring jobs to consider; all of them by default (tests pass their own). */
  jobs?: readonly RecurringJob[];
  /** The kinds of queued job that may run; all of them by default (tests pass their own). */
  queuedJobs?: readonly QueuedJobRunner[];
}

/**
 * Runs every recurring job that's due and not paused, then the queued jobs
 * that are due. First it records the runs that never finished since the last
 * tick (`recordUnfinishedRuns`). The recurring jobs get at most the first half of the tick
 * (they normally take milliseconds), so a slow one never leaves the queue
 * without time; the queue runs until the deadline. A job another run holds
 * is left alone (that run does it); a job that fails doesn't stop the
 * others. Work left at either deadline waits for the next tick.
 *
 * @param ctx - Service context.
 * @param options - How to run.
 * @param options.trigger - What starts it.
 * @param options.deadline - When it should stop starting new runs.
 * @param options.now - The current moment.
 * @param options.jobs - The recurring jobs to consider.
 * @param options.queuedJobs - The kinds of queued job that may run.
 * @returns What it did.
 */
export async function runTick(
  ctx: ServiceContext,
  { trigger, deadline, now = new Date(), jobs = RECURRING_JOBS, queuedJobs }: TickOptions,
): Promise<TickResult> {
  // First, so the Jobs page and the dashboard know the ticks are coming, whatever this one does.
  await recordTick(ctx.db);
  // Runs that died since the last tick (their lease ran out) are failures to report first.
  const runs: JobRunResult[] = await recordUnfinishedRuns(
    ctx,
    jobs.map((job) => job.name),
  );
  const states = await loadJobStates(ctx.db);
  const due = jobs.filter((job) => {
    const state = states.get(job.name);
    return (
      !isPaused(state, job.pausable !== false) &&
      isDue(job.schedule, state?.lastStartedAt ?? null, now)
    );
  });
  const leftForNextTick: string[] = [];
  // The recurring jobs' share: the first half of what's left of the tick.
  const recurringDeadline = new Date(Date.now() + Math.max(0, deadline.getTime() - Date.now()) / 2);
  for (const job of due) {
    if (Date.now() >= recurringDeadline.getTime()) {
      leftForNextTick.push(job.name);
    } else {
      // Sequential on purpose: one job at a time keeps the deadline and the database's load in hand.
      // eslint-disable-next-line no-await-in-loop -- See above.
      const result = await runRecurringJob(ctx, job, {
        trigger,
        deadline: recurringDeadline,
        startedAt: now,
        slot: lastScheduledAt(job.schedule, now),
      });
      if (result) {
        runs.push(result);
      }
    }
  }
  const queue = await runQueue(ctx, {
    trigger,
    deadline,
    startedAt: now,
    ...(queuedJobs ? { kinds: queuedJobs } : {}),
  });
  runs.push(...queue.runs);
  return {
    runs,
    leftForNextTick,
    moreDue: leftForNextTick.length > 0 || queue.moreDue,
    failed: runs.some((run) => run.status === 'failed'),
  };
}

/** How {@link runJobNow} runs a job. */
export interface RunNowOptions {
  /** What starts it: the command line or the Jobs page. */
  trigger: Extract<JobTrigger, 'cli' | 'page'>;
  /** When it should stop starting new work. */
  deadline: Date;
  /** The staff Admin who starts it, if one does. */
  startedBy?: string | null;
}

/**
 * Runs one recurring job now, whether it's due or paused.
 *
 * @param ctx - Service context.
 * @param name - The job's name.
 * @param options - How to run it.
 * @param options.trigger - What starts it.
 * @param options.deadline - When it should stop starting new work.
 * @param options.startedBy - The staff Admin who starts it, if one does.
 * @returns How it went, or `null` when another run holds the job right now.
 * @throws {ServiceError} `not_found` when there's no job by that name.
 */
export async function runJobNow(
  ctx: ServiceContext,
  name: string,
  { trigger, deadline, startedBy = null }: RunNowOptions,
): Promise<JobRunResult | null> {
  const job = findRecurringJob(name);
  if (!job) {
    throw notFoundError();
  }
  return runRecurringJob(ctx, job, { trigger, deadline, startedBy });
}
