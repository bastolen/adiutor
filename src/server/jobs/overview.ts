/**
 * @file What staff see of the background jobs on the Jobs page (Logs → Jobs):
 * the recurring jobs and the kinds of queued job with their state, when the
 * last tick started, the runs of the last 30 days and the queued jobs that
 * were given up; and the warning on the dashboard when the ticks stopped.
 * Staff Admins and Managers (`jobs:view`).
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
import {
  type FailedQueuedJob,
  listQueuedKinds,
  type QueuedKindListing,
  readFailedQueuedJobs,
} from './manage-queue';
import { isTickLate, readLastTick } from './tick-record';

/** A recurring job on the Jobs page. */
export interface RecurringJobOverview extends JobListing {
  /** The reference of the error its last finished run recorded, when that run failed. */
  lastErrorReference: string | null;
}

/** The jobs at a glance: every recurring job and every kind of queued job, and the ticks. */
export interface JobsOverview {
  /** The recurring jobs, in the order the tick runs them. */
  recurring: RecurringJobOverview[];
  /** The kinds of queued job, with how many of their jobs wait and failed. */
  queued: QueuedKindListing[];
  /** When the last tick started, or `null` when none ran yet. */
  lastTickAt: Date | null;
  /** Whether the ticks look stopped (`isTickLate`), so no job runs. */
  tickLate: boolean;
}

/**
 * Loads every recurring job and every kind of queued job with its state,
 * for a recurring job whose last run failed, that run's error reference, and
 * when the last tick started.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `jobs:view`.
 * @returns The overview.
 * @throws {ServiceError} `forbidden` without `jobs:view`.
 */
export async function loadJobsOverview(ctx: ServiceContext, actor: Actor): Promise<JobsOverview> {
  assertPermission(getGlobalPermissions(actor), 'jobs:view');
  const [jobs, queued, lastTickAt] = await Promise.all([
    listJobs(ctx),
    listQueuedKinds(ctx.db),
    readLastTick(ctx.db),
  ]);
  // The last run's error, only for jobs whose last run failed (usually none, so no query at all).
  const failing = jobs.filter((job) => job.lastStatus === 'failed').map((job) => job.name);
  const lastRuns =
    failing.length === 0
      ? []
      : await ctx.db
          .selectDistinctOn([jobRun.job], {
            job: jobRun.job,
            errorReference: jobRun.errorReference,
          })
          .from(jobRun)
          .where(inArray(jobRun.job, failing))
          .orderBy(jobRun.job, desc(jobRun.startedAt), desc(jobRun.id));
  const lastErrors = new Map(lastRuns.map((run) => [run.job, run.errorReference]));
  return {
    recurring: jobs.map((job) => ({
      ...job,
      lastErrorReference: job.lastStatus === 'failed' ? (lastErrors.get(job.name) ?? null) : null,
    })),
    queued,
    lastTickAt,
    tickLate: isTickLate(lastTickAt),
  };
}

/** Why the dashboard warns that background jobs aren't running. */
export interface TickWarning {
  /** When the last tick started, or `null` when none ran yet. */
  lastTickAt: Date | null;
}

/**
 * Whether to warn on the dashboard that background jobs aren't running: for
 * staff who see the jobs (`jobs:view`), when the ticks look stopped.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @returns The warning, or `null` when the ticks are on time or the actor doesn't see the jobs.
 */
export async function getTickWarning(
  ctx: ServiceContext,
  actor: Actor,
): Promise<TickWarning | null> {
  if (!getGlobalPermissions(actor).has('jobs:view')) {
    return null;
  }
  const lastTickAt = await readLastTick(ctx.db);
  return isTickLate(lastTickAt) ? { lastTickAt } : null;
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
export type FailedJobEntry = FailedQueuedJob;

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
    (limit, offset) => readFailedQueuedJobs(ctx.db, { limit, offset, dir: state.dir }),
  );
}
