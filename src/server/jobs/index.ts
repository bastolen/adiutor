/**
 * @file Background jobs (docs/jobs.md, decision 0018): recurring jobs that
 * run on a schedule, and queued jobs the app adds (`queueJob` in
 * `src/server/queue`) to run once,
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
export type { JobOutcome, JobSummary, QueuedJob, QueuedJobResult, RecurringJob } from './define';
export {
  discardFailedJobs,
  PAGE_RUN_SECONDS,
  pauseJob,
  resumeJob,
  retryFailedJobs,
  runJobFromPage,
} from './controls';
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
export type {
  ChangedQueuedJob,
  FailedJobsSelection,
  FailedQueuedJob,
  QueuedKindListing,
} from './manage-queue';
export { listFailedJobs, listJobRuns, loadJobsOverview } from './overview';
export type { FailedJobEntry, JobRunEntry, JobsOverview, RecurringJobOverview } from './overview';
export { RECURRING_JOBS } from './registry';
export { runQueue } from './run-queue';
export type { JobRunResult } from './run';
export { runJobNow, runTick } from './tick';
export type { TickResult } from './tick';
