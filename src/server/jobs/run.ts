/**
 * @file Running one recurring job: taking it under its lease, doing the
 * work, and recording how it went, so a failing job never stops the others.
 */
import type { JobRunStatus, JobTrigger } from '@/db/schema';

import type { ServiceContext } from '../context';
import type { JobOutcome, JobSummary, RecurringJob } from './define';
import { claimJob, finishJobRun } from './state';

/** How a run went. */
export interface JobRunResult {
  /** The job's name. */
  job: string;
  /** How it ended. */
  status: JobRunStatus;
  /** What it did. */
  summary: JobSummary;
  /** The run's row in the history. */
  runId: string;
}

/** How a recurring job is run. */
export interface RunOptions {
  /** What starts the run. */
  trigger: JobTrigger;
  /** When the run should stop starting new work. */
  deadline: Date;
  /** When the run starts (the tick's moment); now by default. */
  startedAt?: Date;
  /** The staff Admin who starts it, if one does. */
  startedBy?: string | null;
  /** The scheduled moment the tick runs it for; `null` (the default) runs it regardless. */
  slot?: Date | null;
}

/**
 * Does the job's work and turns what happens into an outcome: a job that
 * throws failed, with nothing to count.
 *
 * @param ctx - Service context.
 * @param job - The job.
 * @param deadline - When it should stop starting new work.
 * @returns How it went.
 */
async function attempt(
  ctx: ServiceContext,
  job: RecurringJob,
  deadline: Date,
): Promise<{ status: JobRunStatus; outcome: JobOutcome }> {
  try {
    const outcome = await job.run(ctx, { deadline });
    if (outcome.failure) {
      // eslint-disable-next-line no-console -- A job has no caller to report to but the log.
      console.error(`Job ${job.name} failed: ${outcome.failure}`);
      return { status: 'failed', outcome };
    }
    return { status: 'succeeded', outcome };
  } catch (error) {
    // eslint-disable-next-line no-console -- A job has no caller to report to but the log.
    console.error(`Job ${job.name} failed`, error);
    return { status: 'failed', outcome: { summary: {} } };
  }
}

/**
 * Runs a recurring job under its lease and adds the run to its history.
 *
 * @param ctx - Service context.
 * @param job - The job.
 * @param options - How to run it.
 * @param options.trigger - What starts the run.
 * @param options.deadline - When it should stop starting new work.
 * @param options.startedAt - When it starts.
 * @param options.startedBy - The staff Admin who starts it, if one does.
 * @param options.slot - The scheduled moment the tick runs it for.
 * @returns How it went, or `null` when another run holds the job (or, for
 *   the tick, it's paused or already ran for this moment).
 */
export async function runRecurringJob(
  ctx: ServiceContext,
  job: RecurringJob,
  { trigger, deadline, startedAt = new Date(), startedBy = null, slot = null }: RunOptions,
): Promise<JobRunResult | null> {
  if (!(await claimJob(ctx.db, job.name, { startedAt, slot }))) {
    return null;
  }
  const { status, outcome } = await attempt(ctx, job, deadline);
  const runId = await finishJobRun(ctx.db, {
    job: job.name,
    trigger,
    startedBy,
    startedAt,
    status,
    summary: outcome.summary,
  });
  return { job: job.name, status, summary: outcome.summary, runId };
}
