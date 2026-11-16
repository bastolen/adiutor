/**
 * @file What staff Admins do with the background jobs on the Jobs page
 * (`jobs:manage`): pause and resume a recurring job or a kind of queued job,
 * run a recurring job now, and retry or discard queued jobs that were given
 * up. Each is refused while a staff member is signed in as someone, and
 * recorded in the audit log with the job's name (`details.job`).
 */
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { jobState } from '@/db/schema';

import { assertNotSignedInAs, assertPermission, getGlobalPermissions } from '../access';
import type { Actor } from '../actor';
import { recordEvent } from '../audit';
import type { ServiceContext } from '../context';
import { notFoundError, parseId, ServiceError } from '../errors';
import {
  type ChangedQueuedJob,
  discardFailedQueuedJobs,
  type FailedJobsSelection,
  retryFailedQueuedJobs,
} from './manage-queue';
import { findQueuedKind, findRecurringJob } from './registry';
import type { JobRunResult } from './run';
import { runJobNow } from './tick';

/**
 * How long a run started from the Jobs page may keep starting new work, so it
 * ends within the request's 60 seconds; what's left waits for the next tick.
 */
const PAGE_RUN_SECONDS = 45;

/**
 * Checks the actor may act on the jobs: a staff Admin, as themself.
 *
 * @param actor - The acting user.
 * @throws {ServiceError} `signed_in_as` while signed in as someone, `forbidden` without `jobs:manage`.
 */
function assertMayManageJobs(actor: Actor): void {
  assertNotSignedInAs(actor);
  assertPermission(getGlobalPermissions(actor), 'jobs:manage');
}

/**
 * Says whether staff Admins may pause a recurring job or a kind of queued job
 * the registry lists.
 *
 * @param name - The name.
 * @returns Whether it can be paused.
 * @throws {ServiceError} `not_found` for any other name.
 */
function isPausableJob(name: string): boolean {
  const job = findRecurringJob(name) ?? findQueuedKind(name);
  if (!job) {
    throw notFoundError();
  }
  return job.pausable !== false;
}

/**
 * Pauses or resumes a job: the tick skips a paused recurring job, and leaves
 * the jobs of a paused kind waiting.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @param name - The recurring job or kind of queued job.
 * @param paused - Whether to pause it (or resume it).
 * @throws {ServiceError} `conflict` when it's already paused (or isn't).
 */
async function setJobPaused(
  ctx: ServiceContext,
  actor: Actor,
  name: string,
  paused: boolean,
): Promise<void> {
  assertMayManageJobs(actor);
  // Resuming always works, so a pause from before a job became unpausable can be cleared.
  if (!isPausableJob(name) && paused) {
    throw new ServiceError('invalid', 'errors.jobs.notPausable');
  }
  await ctx.db.transaction(async (tx) => {
    const changed = paused
      ? await tx
          .insert(jobState)
          .values({ name, pausedAt: sql`now()`, pausedBy: actor.id })
          .onConflictDoUpdate({
            target: jobState.name,
            set: { pausedAt: sql`excluded.paused_at`, pausedBy: sql`excluded.paused_by` },
            setWhere: isNull(jobState.pausedAt),
          })
          .returning({ id: jobState.id })
      : await tx
          .update(jobState)
          .set({ pausedAt: null, pausedBy: null })
          .where(and(eq(jobState.name, name), isNotNull(jobState.pausedAt)))
          .returning({ id: jobState.id });
    if (changed.length === 0) {
      throw new ServiceError(
        'conflict',
        paused ? 'errors.jobs.alreadyPaused' : 'errors.jobs.notPaused',
      );
    }
    await recordEvent(
      ctx,
      {
        action: paused ? 'job_paused' : 'job_resumed',
        actorUserId: actor.id,
        details: { job: name },
      },
      tx,
    );
  });
}

/**
 * Pauses a recurring job or a kind of queued job until a staff Admin resumes
 * it. Running a recurring job now still works while it's paused. Jobs that
 * keep Adiutor secure can't be paused (`pausable: false`), so nobody, not
 * even a stolen staff Admin session, can silence security notices.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `jobs:manage`.
 * @param name - The recurring job or kind of queued job.
 * @throws {ServiceError} `not_found` for an unknown name, `invalid` for one that can't be paused, `conflict` when it's already paused.
 */
export async function pauseJob(ctx: ServiceContext, actor: Actor, name: string): Promise<void> {
  await setJobPaused(ctx, actor, name, true);
}

/**
 * Resumes a paused recurring job or kind of queued job: the next tick runs
 * it when it's due, and the kind's waiting jobs.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `jobs:manage`.
 * @param name - The recurring job or kind of queued job.
 * @throws {ServiceError} `not_found` for an unknown name, `conflict` when it isn't paused.
 */
export async function resumeJob(ctx: ServiceContext, actor: Actor, name: string): Promise<void> {
  await setJobPaused(ctx, actor, name, false);
}

/**
 * Runs a recurring job now, whether it's due or paused, for at most
 * {@link PAGE_RUN_SECONDS} seconds of new work. The run is kept in the
 * history with the staff Admin who started it, and recorded in the audit log
 * with how it ended.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `jobs:manage`.
 * @param name - The recurring job.
 * @returns How the run went (a failed run returns too, with its error's reference).
 * @throws {ServiceError} `not_found` for an unknown name, `conflict` while another run holds the job.
 */
export async function runJobFromPage(
  ctx: ServiceContext,
  actor: Actor,
  name: string,
): Promise<JobRunResult> {
  assertMayManageJobs(actor);
  // `runJobNow` refuses a name that isn't a recurring job (`not_found`).
  const result = await runJobNow(ctx, name, {
    trigger: 'page',
    deadline: new Date(Date.now() + PAGE_RUN_SECONDS * 1000),
    startedBy: actor.id,
  });
  if (!result) {
    throw new ServiceError('conflict', 'errors.jobs.running');
  }
  await recordEvent(ctx, {
    action: 'job_started',
    actorUserId: actor.id,
    details: { job: name, status: result.status },
  });
  return result;
}

/** The longest kind name accepted; the registered ones are far shorter. */
const MAX_KIND_LENGTH = 100;

/**
 * Reads which failed jobs a staff Admin picked: one by its ID, or every one
 * of a kind. Retrying needs a kind the registry lists, as no tick runs the
 * others (a job picked by ID is checked when it's put back:
 * `retryFailedQueuedJobs` leaves one of another kind failed); discarding also
 * takes a kind it no longer lists, to clear its leftover jobs.
 *
 * @param selection - The selection as given.
 * @param retry - Whether the jobs are to be retried.
 * @returns The selection, checked.
 * @throws {ServiceError} `not_found` for an ID that isn't one, or a kind that can't be.
 */
function parseSelection(selection: FailedJobsSelection, retry: boolean): FailedJobsSelection {
  if ('id' in selection) {
    return { id: parseId(selection.id) };
  }
  const { kind } = selection;
  const registered = findQueuedKind(kind) !== undefined;
  if ((retry && !registered) || !kind || kind.length > MAX_KIND_LENGTH) {
    throw notFoundError();
  }
  return { kind };
}

/**
 * Puts failed jobs back or discards them, and records it: with the kind
 * (`details.job`) and how many.
 *
 * @param ctx - Service context.
 * @param actor - The acting user.
 * @param selection - Which failed jobs.
 * @param retry - Whether to put them back (or discard them).
 * @returns How many changed.
 * @throws {ServiceError} `conflict` when none of them is still failed.
 */
async function changeFailedJobs(
  ctx: ServiceContext,
  actor: Actor,
  selection: FailedJobsSelection,
  retry: boolean,
): Promise<number> {
  assertMayManageJobs(actor);
  const checked = parseSelection(selection, retry);
  return ctx.db.transaction(async (tx) => {
    const changed: ChangedQueuedJob[] = retry
      ? await retryFailedQueuedJobs(tx, checked)
      : await discardFailedQueuedJobs(tx, checked);
    const [first] = changed;
    if (!first) {
      // Someone else retried or discarded them first, the ID was never a failed job, or it's a
      // job to retry of a kind the registry no longer lists.
      throw new ServiceError('conflict', 'errors.jobs.noFailedJobs');
    }
    await recordEvent(
      ctx,
      {
        action: retry ? 'queued_jobs_retried' : 'queued_jobs_discarded',
        actorUserId: actor.id,
        details: { job: first.kind, count: changed.length },
      },
      tx,
    );
    return changed.length;
  });
}

/**
 * Puts queued jobs that were given up back in the queue for the next tick,
 * with a fresh count of attempts: one by ID, or every one of a kind.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `jobs:manage`.
 * @param selection - Which failed jobs.
 * @returns How many were put back.
 * @throws {ServiceError} `not_found` for an unknown kind or a malformed ID, `conflict` when none is still failed.
 */
export async function retryFailedJobs(
  ctx: ServiceContext,
  actor: Actor,
  selection: FailedJobsSelection,
): Promise<number> {
  return changeFailedJobs(ctx, actor, selection, true);
}

/**
 * Discards queued jobs that were given up, so they're never run: one by ID,
 * or every one of a kind (also a kind the registry no longer lists). They
 * stay in the history as discarded for 30 days.
 *
 * @param ctx - Service context.
 * @param actor - The acting user; needs `jobs:manage`.
 * @param selection - Which failed jobs.
 * @returns How many were discarded.
 * @throws {ServiceError} `not_found` for an unknown kind or a malformed ID, `conflict` when none is still failed.
 */
export async function discardFailedJobs(
  ctx: ServiceContext,
  actor: Actor,
  selection: FailedJobsSelection,
): Promise<number> {
  return changeFailedJobs(ctx, actor, selection, false);
}
