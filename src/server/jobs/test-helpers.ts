/**
 * @file Helpers the jobs' integration tests share: an hourly test job that
 * counts its runs, and a job's stored history.
 */
import { eq } from 'drizzle-orm';

import type { Database } from '@/db';
import { jobRun } from '@/db/schema';

import { defineRecurringJob, type JobOutcome, type RecurringJob } from './define';

/**
 * An hourly test job that counts its runs.
 *
 * @param name - Its name.
 * @param run - What it does; it counts one run by default.
 * @returns The job.
 */
export function hourlyJob(
  name: string,
  run: () => Promise<JobOutcome> = async () => ({ summary: { done: 1 } }),
): RecurringJob {
  return defineRecurringJob({ name, schedule: '0 * * * *', run });
}

/**
 * The stored history of a job.
 *
 * @param db - The test database.
 * @param name - The job's name.
 * @returns Its runs, oldest first.
 */
export async function history(db: Database, name: string) {
  return db
    .select({ status: jobRun.status, trigger: jobRun.trigger, summary: jobRun.summary })
    .from(jobRun)
    .where(eq(jobRun.job, name))
    .orderBy(jobRun.startedAt, jobRun.id);
}
