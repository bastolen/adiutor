/**
 * @file Running the queue at a tick: due jobs one at a time, oldest first,
 * until the deadline, each kind up to its `perTick`. A job with a batch key
 * runs with the rest of its batch, in one call of its group's batch. A job
 * that fails is tried again later, up to its kind's `maxAttempts`, and each
 * failure is recorded as an error with a reference. Every kind that ran jobs
 * gets one run in the history, with how many were done, skipped, retried and
 * failed.
 */
import type { JobTrigger } from '@/db/schema';
import { defined } from '@/lib/defined';

import type { ServiceContext } from '../context';
import type { JobBatch, QueuedJobResult, QueuedJobRunner, StoredQueuedJob } from './define';
import { claimNextQueuedJobs, finishQueuedJob, retryQueuedJobLater } from './queue';
import recordJobError from './record-error';
import { JOB_BATCHES, QUEUED_JOBS } from './registry';
import type { JobRunResult } from './run';
import { finishJobRun, loadJobStates } from './state';

/** What one kind's jobs did during a tick. */
interface KindCounts {
  /** Jobs done. */
  done: number;
  /** Jobs skipped, because what they were about is gone. */
  skipped: number;
  /** Jobs that failed and will be tried again. */
  retried: number;
  /** Jobs that failed their last attempt and were given up. */
  failed: number;
}

/** How one job ended during a tick, with the reference of the error a failure recorded. */
interface Ending {
  /** How it ended. */
  ended: keyof KindCounts;
  /** The error's reference, when it failed and the error could be recorded. */
  errorReference: string | null;
}

/** How the queue runs. */
export interface QueueRunOptions {
  /** What starts it. */
  trigger: JobTrigger;
  /** When it should stop taking new jobs. */
  deadline: Date;
  /** When the tick started, for the history. */
  startedAt: Date;
  /** The kinds that may run; all of them by default (tests pass their own). */
  kinds?: readonly QueuedJobRunner[];
  /** The batches of the batch groups; all of them by default (tests pass their own). */
  batches?: readonly JobBatch[];
}

/**
 * Notes that jobs were done or skipped.
 *
 * @param ctx - Service context.
 * @param jobs - The jobs, each with how its run ended.
 * @returns How each ended.
 */
async function finish(
  ctx: ServiceContext,
  jobs: readonly { job: StoredQueuedJob; result: QueuedJobResult }[],
): Promise<Ending[]> {
  return Promise.all(
    jobs.map(async ({ job, result }) => {
      await finishQueuedJob(ctx.db, job.id, result === 'done' ? 'succeeded' : 'skipped');
      return { ended: result, errorReference: null };
    }),
  );
}

/**
 * Notes that jobs failed: the error is recorded once (with a reference each
 * job keeps), and each job is tried again later, or given up after its
 * kind's last attempt. The log gets the jobs' IDs and attempts, never their
 * payloads.
 *
 * @param ctx - Service context.
 * @param jobs - The jobs, each with its kind.
 * @param error - What went wrong.
 * @returns How each ended.
 */
async function fail(
  ctx: ServiceContext,
  jobs: readonly { job: StoredQueuedJob; kind: QueuedJobRunner }[],
  error: unknown,
): Promise<Ending[]> {
  const errorReference = await recordJobError(
    ctx,
    [...new Set(jobs.map(({ job }) => job.kind))].join(', '),
    error,
  );
  // eslint-disable-next-line no-console -- A job has no caller to report to but the log.
  console.error(
    `Queued jobs failed: ${jobs
      .map(
        ({ job, kind }) =>
          `${job.id} (${job.kind}, attempt ${job.attempts} of ${kind.maxAttempts})`,
      )
      .join(', ')}; given up after the last attempt, else tried again later`,
  );
  return Promise.all(
    jobs.map(async ({ job, kind }) => {
      if (job.attempts >= kind.maxAttempts) {
        await finishQueuedJob(ctx.db, job.id, 'failed', errorReference);
        return { ended: 'failed', errorReference };
      }
      await retryQueuedJobLater(ctx.db, job.id, job.attempts, errorReference);
      return { ended: 'retried', errorReference };
    }),
  );
}

/**
 * Runs what one claim took: a job on its own, or a batch through its group's
 * batch, with each job's payload checked by its own kind.
 *
 * @param ctx - Service context.
 * @param claimed - The jobs, each with its kind.
 * @param batches - The batches by group.
 * @returns How each job ended, in the same order.
 */
async function runClaimed(
  ctx: ServiceContext,
  claimed: readonly { job: StoredQueuedJob; kind: QueuedJobRunner }[],
  batches: ReadonlyMap<string, JobBatch>,
): Promise<Ending[]> {
  try {
    const [first] = claimed;
    const solo = claimed.length === 1 && first?.kind.handle ? first : null;
    if (solo?.kind.handle) {
      const result = await solo.kind.handle(ctx, solo.job);
      return await finish(ctx, [{ job: solo.job, result }]);
    }
    const group = defined(first?.kind.batchGroup, 'the batch group of the claimed jobs');
    const batch = defined(batches.get(group), `the batch of group ${group}`);
    const outcome = await batch.run(
      ctx,
      claimed.map(({ job, kind }) => ({
        id: job.id,
        kind: job.kind,
        attempts: job.attempts,
        payload: kind.check(job.payload),
      })),
    );
    const skipped = new Set(outcome.skipped ?? []);
    return await finish(
      ctx,
      claimed.map(({ job }) => ({ job, result: skipped.has(job.id) ? 'skipped' : 'done' })),
    );
  } catch (error) {
    return fail(ctx, claimed, error);
  }
}

/**
 * Runs the due queued jobs of every kind that isn't paused, oldest first,
 * until the deadline or until each kind reached its `perTick`. Only kinds
 * that can run are taken: those that run on their own, and batched kinds
 * whose group has a batch.
 *
 * @param ctx - Service context.
 * @param options - How to run.
 * @param options.trigger - What starts it.
 * @param options.deadline - When it should stop taking new jobs.
 * @param options.startedAt - When the tick started.
 * @param options.kinds - The kinds that may run.
 * @param options.batches - The batches of the batch groups.
 * @returns One run per kind that ran jobs, in the order they first ran.
 */
export async function runQueue(
  ctx: ServiceContext,
  { trigger, deadline, startedAt, kinds = QUEUED_JOBS, batches = JOB_BATCHES }: QueueRunOptions,
): Promise<JobRunResult[]> {
  const states = await loadJobStates(ctx.db);
  const batchesByGroup = new Map(batches.map((batch) => [batch.group, batch]));
  let open = kinds.filter(
    (kind) =>
      !states.get(kind.name)?.pausedAt &&
      (kind.handle !== null || (kind.batchGroup !== null && batchesByGroup.has(kind.batchGroup))),
  );
  const counts = new Map<string, KindCounts>();
  // The last error each kind recorded this tick, for its run in the history.
  const lastErrors = new Map<string, string>();
  while (open.length > 0 && Date.now() < deadline.getTime()) {
    // One claim at a time on purpose: jobs are taken only when they're about to run.
    // eslint-disable-next-line no-await-in-loop -- See above.
    const jobs = await claimNextQueuedJobs(
      ctx.db,
      open.map((kind) => kind.name),
    );
    if (jobs.length === 0) {
      break;
    }
    const kindsByName = new Map(open.map((kind) => [kind.name, kind]));
    const claimed = jobs.map((job) => ({
      job,
      kind: defined(kindsByName.get(job.kind), `the kind of queued job ${job.id}`),
    }));
    // eslint-disable-next-line no-await-in-loop -- See above.
    const endings = await runClaimed(ctx, claimed, batchesByGroup);
    claimed.forEach(({ kind }, index) => {
      const { ended, errorReference } = defined(endings[index], 'how the job ended');
      const kindCounts = counts.get(kind.name) ?? { done: 0, skipped: 0, retried: 0, failed: 0 };
      kindCounts[ended] += 1;
      counts.set(kind.name, kindCounts);
      if (errorReference) {
        lastErrors.set(kind.name, errorReference);
      }
    });
    open = open.filter((kind) => {
      const kindCounts = counts.get(kind.name);
      const handled = kindCounts
        ? kindCounts.done + kindCounts.skipped + kindCounts.retried + kindCounts.failed
        : 0;
      return handled < kind.perTick;
    });
  }
  return Promise.all(
    [...counts].map(async ([name, summary]) => {
      const status = summary.retried + summary.failed > 0 ? 'failed' : 'succeeded';
      const errorReference = lastErrors.get(name) ?? null;
      const runId = await finishJobRun(ctx.db, {
        job: name,
        trigger,
        startedBy: null,
        startedAt,
        status,
        summary: { ...summary },
        errorReference,
      });
      return { job: name, status, summary: { ...summary }, runId, errorReference };
    }),
  );
}
