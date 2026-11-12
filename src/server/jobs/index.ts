/**
 * @file Background jobs (docs/jobs.md, decision 0018): recurring jobs that
 * run on a schedule, and queued jobs the app adds (`queueJob`) to run once,
 * both started by a tick every few minutes from the endpoint
 * (`answerTickRequest`) or `pnpm jobs:run`. Each job holds a lease while
 * it runs, so two ticks never do the same job at once, and every run is kept
 * in the history.
 *
 * This is the module's public API: the scheduler, the queue, the jobs
 * themselves (in `recurring/`, and `queued/` for kinds of queued job) and
 * their registry live in the files next to it, and nothing outside this
 * folder imports them directly.
 */
export type {
  JobOutcome,
  JobPayload,
  JobSummary,
  QueuedJob,
  QueuedJobKind,
  QueuedJobResult,
  RecurringJob,
} from './define';
export { answerTickRequest } from './endpoint';
export type { TickResponse } from './endpoint';
export { listJobs } from './list';
export type { JobListing } from './list';
export {
  discardFailedQueuedJobs,
  listFailedQueuedJobs,
  listQueuedKinds,
  retryFailedQueuedJobs,
} from './manage-queue';
export type { FailedJobsSelection, FailedQueuedJob, QueuedKindListing } from './manage-queue';
export { queueJob } from './queue';
export type { QueueOptions } from './queue';
export { RECURRING_JOBS } from './registry';
export type { JobRunResult } from './run';
export { runJobNow, runTick } from './tick';
export type { TickResult } from './tick';
