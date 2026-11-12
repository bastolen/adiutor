/**
 * @file Background jobs (docs/jobs.md, decision 0018): recurring jobs that
 * run on a schedule, started by a tick every few minutes. Each job holds a lease while
 * it runs, so two ticks never do the same job at once, and every run is kept
 * in the history.
 *
 * This is the module's public API: the scheduler, the jobs themselves (in
 * `recurring/`) and their registry live in the files next to it, and nothing
 * outside this folder imports them directly.
 */
export type { JobOutcome, JobSummary, RecurringJob } from './define';
export { RECURRING_JOBS } from './registry';
export type { JobRunResult } from './run';
export { runJobNow, runTick } from './tick';
export type { TickResult } from './tick';
