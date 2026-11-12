/**
 * @file Every background job Adiutor has. A new job gets a file of its own
 * and a line here.
 */
import type { RecurringJob } from './define';

/** The recurring jobs, in the order the tick runs them when several are due. */
export const RECURRING_JOBS: readonly RecurringJob[] = [];

/**
 * Finds a recurring job by name.
 *
 * @param name - The job's name.
 * @returns The job, or `undefined` when there's none by that name.
 */
export function findRecurringJob(name: string): RecurringJob | undefined {
  return RECURRING_JOBS.find((job) => job.name === name);
}
