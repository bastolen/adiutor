/**
 * @file What staff see of the background jobs on the Jobs page (Logs → Jobs):
 * the recurring jobs and the kinds of queued job with their state, the runs
 * of the last 30 days and the queued jobs that were given up. Staff Admins
 * and Managers (`jobs:view`).
 */
import { count, desc, eq, inArray } from 'drizzle-orm';

import { jobRun, type JobRunStatus, type JobTrigger, queuedJob, user } from '@/db/schema';
import { type Paged, resolveTableState, type TableState } from '@/lib/tables/table-state';
import {
  FAILED_JOBS_TABLE,
  type FailedJobSort,
  JOB_RUNS_TABLE,
  type JobRunSort,
} from '@/lib/tables/tables';

import { assertPermission, getGlobalPermissions } from '../access';
import type { Actor } from '../actor';
import type { ServiceContext } from '../context';
import { orderTerms, paginate } from '../pagination';
import type { JobSummary } from './define';
import { type JobListing, listJobs } from './list';
import { listQueuedKinds, type QueuedKindListing } from './manage-queue';

/** A recurring job on the Jobs page. */
export interface RecurringJobOverview extends JobListing {
  /** The reference of the error its last finished run recorded, when that run failed. */
  lastErrorReference: string | null;
}

/** The jobs at a glance: every recurring job and every kind of queued job. */
export interface JobsOverview {
  /** The recurring jobs, in the order the tick runs them. */
  recurring: RecurringJobOverview[];
  /** The kinds of queued job, with how many of their jobs wait and failed. */
  queued: QueuedKindListing[];
}

/**
 * Loads every recurring job and every kind of queued job with its state,
 * and for a recurring job whose last run failed, that run's error reference.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `jobs:view`.
 * @returns The overview.
 * @throws {ServiceError} `forbidden` without `jobs:view`.
 */
export async function loadJobsOverview(ctx: ServiceContext, actor: Actor): Promise<JobsOverview> {
  assertPermission(getGlobalPermissions(actor), 'jobs:view');
  const [jobs, queued] = await Promise.all([listJobs(ctx), listQueuedKinds(ctx.db)]);
  // Each job's last finished run, for the error it recorded.
  const lastRuns = await ctx.db
    .selectDistinctOn([jobRun.job], { job: jobRun.job, errorReference: jobRun.errorReference })
    .from(jobRun)
    .where(
      inArray(
        jobRun.job,
        jobs.map((job) => job.name),
      ),
    )
    .orderBy(jobRun.job, desc(jobRun.startedAt), desc(jobRun.id));
  const lastErrors = new Map(lastRuns.map((run) => [run.job, run.errorReference]));
  return {
    recurring: jobs.map((job) => ({
      ...job,
      lastErrorReference: job.lastStatus === 'failed' ? (lastErrors.get(job.name) ?? null) : null,
    })),
    queued,
  };
}

/** One run in the history. */
export interface JobRunEntry {
  /** The run's ID. */
  id: string;
  /** The job's name, or the kind of queued job. */
  job: string;
  /** What started it. */
  trigger: JobTrigger;
  /** The staff Admin who started it from the Jobs page, while their account exists. */
  startedBy: { id: string; name: string; email: string } | null;
  /** When it started. */
  startedAt: Date;
  /** When it finished. */
  finishedAt: Date;
  /** How it ended. */
  status: JobRunStatus;
  /** What it did, as counts. */
  summary: JobSummary;
  /** The reference of the error it recorded, if it failed. */
  errorReference: string | null;
}

/**
 * Lists the runs of the last 30 days (older ones are deleted by the
 * `retention` job), a page at a time, newest first by default.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `jobs:view`.
 * @param table - The table's sort and page.
 * @returns One page of runs, and how many there are in all.
 * @throws {ServiceError} `forbidden` without `jobs:view`.
 */
export async function listJobRuns(
  ctx: ServiceContext,
  actor: Actor,
  table: Partial<TableState<JobRunSort>> = {},
): Promise<Paged<JobRunEntry>> {
  assertPermission(getGlobalPermissions(actor), 'jobs:view');
  const state = resolveTableState(JOB_RUNS_TABLE, table);
  return paginate(
    state,
    async () => (await ctx.db.select({ total: count() }).from(jobRun))[0]?.total ?? 0,
    async (limit, offset) => {
      const rows = await ctx.db
        .select({
          id: jobRun.id,
          job: jobRun.job,
          trigger: jobRun.trigger,
          startedAt: jobRun.startedAt,
          finishedAt: jobRun.finishedAt,
          status: jobRun.status,
          summary: jobRun.summary,
          errorReference: jobRun.errorReference,
          starterId: user.id,
          starterName: user.name,
          starterEmail: user.email,
        })
        .from(jobRun)
        .leftJoin(user, eq(user.id, jobRun.startedBy))
        .orderBy(...orderTerms(state.dir, jobRun.startedAt, jobRun.id))
        .limit(limit)
        .offset(offset);
      return rows.map(({ starterId, starterName, starterEmail, ...run }) => ({
        ...run,
        startedBy:
          starterId && starterEmail !== null
            ? { id: starterId, name: starterName ?? '', email: starterEmail }
            : null,
      }));
    },
  );
}

/** A queued job that was given up, as the Jobs page lists it. */
export interface FailedJobEntry {
  /** The job's ID. */
  id: string;
  /** Its kind's name. */
  kind: string;
  /** How many times it was tried. */
  attempts: number;
  /** When it was queued. */
  queuedAt: Date;
  /** When it was given up. */
  failedAt: Date | null;
  /** The reference of the error its last attempt recorded. */
  errorReference: string | null;
}

/**
 * Lists the queued jobs that were given up after their last attempt, a page
 * at a time, latest first by default. Their payloads stay out: they're only
 * IDs, which tell staff nothing, and the error reference says what went
 * wrong.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `jobs:view`.
 * @param table - The table's sort and page.
 * @returns One page of failed jobs, and how many there are in all.
 * @throws {ServiceError} `forbidden` without `jobs:view`.
 */
export async function listFailedJobs(
  ctx: ServiceContext,
  actor: Actor,
  table: Partial<TableState<FailedJobSort>> = {},
): Promise<Paged<FailedJobEntry>> {
  assertPermission(getGlobalPermissions(actor), 'jobs:view');
  const state = resolveTableState(FAILED_JOBS_TABLE, table);
  const failed = eq(queuedJob.status, 'failed');
  return paginate(
    state,
    async () =>
      (await ctx.db.select({ total: count() }).from(queuedJob).where(failed))[0]?.total ?? 0,
    (limit, offset) =>
      ctx.db
        .select({
          id: queuedJob.id,
          kind: queuedJob.kind,
          attempts: queuedJob.attempts,
          queuedAt: queuedJob.createdAt,
          failedAt: queuedJob.finishedAt,
          errorReference: queuedJob.lastErrorReference,
        })
        .from(queuedJob)
        .where(failed)
        .orderBy(...orderTerms(state.dir, queuedJob.finishedAt, queuedJob.id))
        .limit(limit)
        .offset(offset),
  );
}
