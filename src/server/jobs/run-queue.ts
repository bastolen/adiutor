/**
 * @file Running the queue at a tick: due jobs one at a time, oldest first,
 * until the deadline, each kind up to its `perTick`. A job that fails is
 * tried again later, up to its kind's `maxAttempts`. Every kind that ran
 * jobs gets one run in the history, with how many were done, skipped,
 * retried and failed.
 */
import type { JobTrigger } from '@/db/schema';
import { defined } from '@/lib/defined';

import type { ServiceContext } from '../context';
import type { QueuedJobRunner, StoredQueuedJob } from './define';
import { claimNextQueuedJob, finishQueuedJob, retryQueuedJobLater } from './queue';
import { QUEUED_JOBS } from './registry';
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
}

/**
 * Runs one job and notes how it ended. A job that throws is tried again
 * later, or given up after its kind's last attempt; its error goes to the
 * log, without its payload.
 *
 * @param ctx - Service context.
 * @param kind - The job's kind.
 * @param job - The job.
 * @returns How it ended.
 */
async function runOne(
  ctx: ServiceContext,
  kind: QueuedJobRunner,
  job: StoredQueuedJob,
): Promise<keyof KindCounts> {
  try {
    const result = await kind.handle(ctx, job);
    await finishQueuedJob(ctx.db, job.id, result === 'done' ? 'succeeded' : 'skipped');
    return result === 'done' ? 'done' : 'skipped';
  } catch (error) {
    const givenUp = job.attempts >= kind.maxAttempts;
    // eslint-disable-next-line no-console -- A job has no caller to report to but the log.
    console.error(
      `Queued job ${job.id} (${job.kind}) failed attempt ${job.attempts} of ${kind.maxAttempts}${
        givenUp ? '; given up' : '; it will be tried again'
      }`,
      error,
    );
    if (givenUp) {
      await finishQueuedJob(ctx.db, job.id, 'failed');
      return 'failed';
    }
    await retryQueuedJobLater(ctx.db, job.id, job.attempts);
    return 'retried';
  }
}

/**
 * Runs the due queued jobs of every kind that isn't paused, oldest first,
 * until the deadline or until each kind reached its `perTick`.
 *
 * @param ctx - Service context.
 * @param options - How to run.
 * @param options.trigger - What starts it.
 * @param options.deadline - When it should stop taking new jobs.
 * @param options.startedAt - When the tick started.
 * @param options.kinds - The kinds that may run.
 * @returns One run per kind that ran jobs, in the order they first ran.
 */
export async function runQueue(
  ctx: ServiceContext,
  { trigger, deadline, startedAt, kinds = QUEUED_JOBS }: QueueRunOptions,
): Promise<JobRunResult[]> {
  const states = await loadJobStates(ctx.db);
  let open = kinds.filter((kind) => !states.get(kind.name)?.pausedAt);
  const counts = new Map<string, KindCounts>();
  while (open.length > 0 && Date.now() < deadline.getTime()) {
    // One at a time on purpose: each job is taken only when it's about to run.
    // eslint-disable-next-line no-await-in-loop -- See above.
    const job = await claimNextQueuedJob(
      ctx.db,
      open.map((kind) => kind.name),
    );
    if (!job) {
      break;
    }
    const kind = defined(
      open.find((candidate) => candidate.name === job.kind),
      `the kind of queued job ${job.id}`,
    );
    // eslint-disable-next-line no-await-in-loop -- See above.
    const ended = await runOne(ctx, kind, job);
    const kindCounts = counts.get(kind.name) ?? { done: 0, skipped: 0, retried: 0, failed: 0 };
    kindCounts[ended] += 1;
    counts.set(kind.name, kindCounts);
    const handled = kindCounts.done + kindCounts.skipped + kindCounts.retried + kindCounts.failed;
    if (handled >= kind.perTick) {
      open = open.filter((candidate) => candidate !== kind);
    }
  }
  return Promise.all(
    [...counts].map(async ([name, summary]) => {
      const status = summary.retried + summary.failed > 0 ? 'failed' : 'succeeded';
      const runId = await finishJobRun(ctx.db, {
        job: name,
        trigger,
        startedBy: null,
        startedAt,
        status,
        summary: { ...summary },
      });
      return { job: name, status, summary: { ...summary }, runId };
    }),
  );
}
