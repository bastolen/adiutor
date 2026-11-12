/**
 * @file The tick: what the endpoint and `pnpm jobs:run` start every few
 * minutes. It runs every recurring job that's due, one after another, then
 * the queued jobs that are due, until its deadline; and running one job now,
 * whether it's due or not.
 */
import type { JobTrigger } from '@/db/schema';

import type { ServiceContext } from '../context';
import { notFoundError } from '../errors';
import type { QueuedJobRunner, RecurringJob } from './define';
import { hasDueQueuedJobs } from './queue';
import { findRecurringJob, JOB_BATCHES, QUEUED_JOBS, RECURRING_JOBS } from './registry';
import { type JobRunResult, runRecurringJob } from './run';
import { runnableKinds, runQueue } from './run-queue';
import { isDue, lastScheduledAt } from './schedule';
import { loadJobStates } from './state';

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
 * Whether the queue stopped at the deadline with jobs it could still run.
 * Before the deadline, the queue only stops once nothing is due.
 *
 * @param ctx - Service context.
 * @param deadline - The tick's deadline.
 * @param queuedJobs - The kinds that may run; all of them by default.
 * @returns Whether queued jobs are left.
 */
async function queueLeftAtDeadline(
  ctx: ServiceContext,
  deadline: Date,
  queuedJobs: readonly QueuedJobRunner[] = QUEUED_JOBS,
): Promise<boolean> {
  if (Date.now() < deadline.getTime()) {
    return false;
  }
  const states = await loadJobStates(ctx.db);
  const batchesByGroup = new Map(JOB_BATCHES.map((batch) => [batch.group, batch]));
  return hasDueQueuedJobs(
    ctx.db,
    runnableKinds(states, queuedJobs, batchesByGroup).map((kind) => kind.name),
  );
}

/**
 * Runs every recurring job that's due and not paused, then the queued jobs
 * that are due. The recurring jobs get at most the first half of the tick
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
  const states = await loadJobStates(ctx.db);
  const due = jobs.filter((job) => {
    const state = states.get(job.name);
    return !state?.pausedAt && isDue(job.schedule, state?.lastStartedAt ?? null, now);
  });
  const runs: JobRunResult[] = [];
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
  runs.push(
    ...(await runQueue(ctx, {
      trigger,
      deadline,
      startedAt: now,
      ...(queuedJobs ? { kinds: queuedJobs } : {}),
    })),
  );
  return {
    runs,
    leftForNextTick,
    moreDue: leftForNextTick.length > 0 || (await queueLeftAtDeadline(ctx, deadline, queuedJobs)),
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
