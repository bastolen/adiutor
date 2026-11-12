/**
 * @file How a background job is described: its name, when it runs and what
 * it does. Each job lives in a file of its own and is listed in
 * `registry.ts` (see docs/jobs.md).
 */
import type { ServiceContext } from '../context';

/** What a run did, as counts, e.g. `{ sessions: 12 }`: numbers only, never personal data. */
export type JobSummary = Readonly<Record<string, number>>;

/** What a run of a job returns. */
export interface JobOutcome {
  /** What it did, as counts. */
  summary: JobSummary;
  /**
   * Why the run counts as failed although it finished, e.g. some reminders
   * couldn't be sent; absent when everything went well. For the logs: in
   * English, without personal data.
   */
  failure?: string;
}

/** What a job's `run` gets besides the service context. */
export interface JobRunOptions {
  /**
   * When the run should stop starting new work, so the request or command
   * that runs it ends in time. Work left over waits for the next run.
   */
  deadline: Date;
}

/** A job that runs on a schedule. */
export interface RecurringJob {
  /** Stable name in kebab-case, stored with its state and history, e.g. `retention`. */
  name: string;
  /** When it runs: a cron expression in UTC, e.g. `0 * * * *` for every hour. */
  schedule: string;
  /**
   * Does the work. It must be safe to run again at any time, and it throws
   * when it can't do its work at all.
   */
  run: (ctx: ServiceContext, options: JobRunOptions) => Promise<JobOutcome>;
}

/**
 * Describes a recurring job; add it to `RECURRING_JOBS` in `registry.ts`.
 *
 * @param job - The job.
 * @returns The same job, typed.
 */
export function defineRecurringJob(job: RecurringJob): RecurringJob {
  return job;
}
