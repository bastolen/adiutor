/**
 * @file Running one recurring job: taking it under its lease, doing the
 * work, and recording how it went, so a failing job never stops the others.
 * A failure is recorded as an error with a reference (`recordJobError`),
 * and after several runs in a row the staff Admins are told
 * (`alertStaffAdmins`).
 */
import type { JobRunStatus, JobTrigger } from '@/db/schema';

import type { ServiceContext } from '../context';
import { ALERT_AFTER_FAILED_RUNS, alertStaffAdmins } from './alerts';
import type { JobOutcome, JobSummary, RecurringJob } from './define';
import recordJobError from './record-error';
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
  /** The reference of the error a failed run recorded, if it could. */
  errorReference: string | null;
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
 * throws failed, with nothing to count. Either way a failure is recorded as
 * an error, with the job's own words when it finished but reported one.
 *
 * @param ctx - Service context.
 * @param job - The job.
 * @param deadline - When it should stop starting new work.
 * @returns How it went, and the reference of the error a failure recorded.
 */
async function attempt(
  ctx: ServiceContext,
  job: RecurringJob,
  deadline: Date,
): Promise<{ status: JobRunStatus; outcome: JobOutcome; errorReference: string | null }> {
  try {
    const outcome = await job.run(ctx, { deadline });
    if (outcome.failure) {
      const errorReference = await recordJobError(ctx, job.name, new Error(outcome.failure));
      return { status: 'failed', outcome, errorReference };
    }
    return { status: 'succeeded', outcome, errorReference: null };
  } catch (error) {
    const errorReference = await recordJobError(ctx, job.name, error);
    return { status: 'failed', outcome: { summary: {} }, errorReference };
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
  const { status, outcome, errorReference } = await attempt(ctx, job, deadline);
  const { runId, consecutiveFailures } = await finishJobRun(ctx.db, {
    job: job.name,
    trigger,
    startedBy,
    startedAt,
    status,
    summary: outcome.summary,
    errorReference,
  });
  if (status === 'failed' && consecutiveFailures >= ALERT_AFTER_FAILED_RUNS) {
    await alertStaffAdmins(ctx, {
      job: job.name,
      failure: 'recurring',
      count: consecutiveFailures,
      reference: errorReference,
    });
  }
  return { job: job.name, status, summary: outcome.summary, runId, errorReference };
}
