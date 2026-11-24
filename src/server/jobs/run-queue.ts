/**
 * @file Running the queue at a tick: due jobs one at a time, with the kinds
 * taking turns (each kind's oldest first), until the deadline or until
 * nothing is due. A job with a batch key runs with the rest of its batch, in
 * one call of its group's batch. A job that fails is tried again later, up to
 * its kind's `maxAttempts`, and each failure is recorded as an error with a
 * reference. A job that ran but couldn't be noted as done fails on its own,
 * without the rest of its batch (jobs run at least once). A run that dies
 * (its lease runs out) counts as an attempt too, and a job whose last attempt
 * died is given up. When jobs are given up, the staff Admins are told. Every
 * kind that ran jobs gets one run in the history, with how many were done,
 * skipped, retried and failed.
 */
import type { JobTrigger } from '@/db/schema';
import { defined } from '@/lib/defined';

import type { ServiceContext } from '../context';
import { alertStaffAdmins } from './alerts';
import type { JobBatch, QueuedJobResult, QueuedJobRunner, QueuedJob } from './define';
import {
  claimNextQueuedJobs,
  finishQueuedJob,
  hasDueQueuedJobs,
  retryQueuedJobLater,
} from './queue';
import recordJobError from './record-error';
import { JOB_BATCHES, QUEUED_JOBS } from './registry';
import type { JobRunResult } from './run';
import { finishJobRun, isPaused, loadJobStates } from './state';

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
  /** Its kind's name. */
  kind: string;
  /** How it ended. */
  ended: keyof KindCounts;
  /** The error's reference, when it failed and the error could be recorded. */
  errorReference: string | null;
}

/** What's recorded for a job whose runs never finished, once it's given up. */
const NEVER_FINISHED =
  "Its runs never finished: each was stopped before it was done, e.g. by the platform's time limit";

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
  jobs: readonly { job: QueuedJob; kind: QueuedJobRunner }[],
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
        return { kind: job.kind, ended: 'failed', errorReference };
      }
      await retryQueuedJobLater(ctx.db, job.id, job.attempts, errorReference);
      return { kind: job.kind, ended: 'retried', errorReference };
    }),
  );
}

/**
 * Notes that jobs were done or skipped. Every job's note is written on its
 * own and awaited, and only the jobs whose note couldn't be written fail: the
 * rest of a batch stays finished, instead of going back in the queue to run
 * a second time.
 *
 * @param ctx - Service context.
 * @param jobs - The jobs, each with its kind and how its run ended.
 * @returns How each ended: the jobs that were noted, then those that weren't.
 */
async function finish(
  ctx: ServiceContext,
  jobs: readonly { job: QueuedJob; kind: QueuedJobRunner; result: QueuedJobResult }[],
): Promise<Ending[]> {
  const notes = await Promise.allSettled(
    jobs.map(async ({ job, result }) =>
      finishQueuedJob(ctx.db, job.id, result === 'done' ? 'succeeded' : 'skipped'),
    ),
  );
  const noted = jobs.filter((_, index) => notes[index]?.status === 'fulfilled');
  const unnoted = jobs.filter((_, index) => notes[index]?.status === 'rejected');
  const failure = notes.find((note) => note.status === 'rejected');
  return [
    ...noted.map(({ job, result }) => ({ kind: job.kind, ended: result, errorReference: null })),
    ...(failure ? await fail(ctx, unnoted, failure.reason) : []),
  ];
}

/**
 * Runs what one claim took: a job on its own, or a batch through its group's
 * batch, with each job's payload checked by its own kind. When the run
 * throws, every job it took fails; when a job's ending can't be noted
 * afterwards, only that job does ({@link finish}).
 *
 * @param ctx - Service context.
 * @param claimed - The jobs, each with its kind.
 * @param batches - The batches by group.
 * @returns How each job ended.
 */
async function runClaimed(
  ctx: ServiceContext,
  claimed: readonly { job: QueuedJob; kind: QueuedJobRunner }[],
  batches: ReadonlyMap<string, JobBatch>,
): Promise<Ending[]> {
  let ran: { job: QueuedJob; kind: QueuedJobRunner; result: QueuedJobResult }[];
  try {
    const [first] = claimed;
    const solo = claimed.length === 1 && first?.kind.handle ? first : null;
    if (solo?.kind.handle) {
      ran = [{ ...solo, result: await solo.kind.handle(ctx, solo.job) }];
    } else {
      const group = defined(first?.kind.batchGroup, 'the batch group of the claimed jobs');
      const batch = defined(batches.get(group), `the batch of group ${group}`);
      const outcome = await batch.run(
        ctx,
        claimed.map(({ job, kind }) => ({
          id: job.id,
          kind: job.kind,
          attempts: job.attempts,
          queuedAt: job.queuedAt,
          payload: kind.check(job.payload),
        })),
      );
      const skipped = new Set(outcome.skipped ?? []);
      ran = claimed.map(({ job, kind }) => ({
        job,
        kind,
        result: skipped.has(job.id) ? 'skipped' : 'done',
      }));
    }
  } catch (error) {
    return fail(ctx, claimed, error);
  }
  return finish(ctx, ran);
}

/** What a run of the queue did. */
export interface QueueRun {
  /** One run per kind that ran jobs, in the order they first ran. */
  runs: JobRunResult[];
  /**
   * Whether jobs it could run are still due: it stopped at the deadline with
   * some left. Jobs waiting for a later attempt don't count.
   */
  moreDue: boolean;
}

/**
 * The kinds whose jobs a tick may take: those that aren't paused (a pause
 * only counts for a kind that can be paused) and can run, on their own (with
 * a handler) or through their group's batch.
 *
 * @param states - The jobs' states, for which kinds are paused.
 * @param kinds - The kinds.
 * @param batchesByGroup - The batches by group.
 * @returns The kinds that can run.
 */
function runnableKinds(
  states: Awaited<ReturnType<typeof loadJobStates>>,
  kinds: readonly QueuedJobRunner[],
  batchesByGroup: ReadonlyMap<string, JobBatch>,
): QueuedJobRunner[] {
  return kinds.filter(
    (kind) =>
      !isPaused(states.get(kind.name), kind.pausable) &&
      (kind.handle !== null || (kind.batchGroup !== null && batchesByGroup.has(kind.batchGroup))),
  );
}

/**
 * Runs the due queued jobs of every kind that isn't paused, until the
 * deadline or until nothing is due. The kinds take turns, one claim each
 * (each kind's oldest job first), so a kind with many jobs can't keep the
 * others waiting, and a kind on its own gets the whole tick; a kind with
 * nothing due sits out the rest of the tick. Only kinds that can run are
 * taken: those that run on their own, and batched kinds whose group has a
 * batch.
 *
 * @param ctx - Service context.
 * @param options - How to run.
 * @param options.trigger - What starts it.
 * @param options.deadline - When it should stop taking new jobs.
 * @param options.startedAt - When the tick started.
 * @param options.kinds - The kinds that may run.
 * @param options.batches - The batches of the batch groups.
 * @returns The runs, one per kind that ran jobs, and whether jobs are still due.
 */
export async function runQueue(
  ctx: ServiceContext,
  { trigger, deadline, startedAt, kinds = QUEUED_JOBS, batches = JOB_BATCHES }: QueueRunOptions,
): Promise<QueueRun> {
  const states = await loadJobStates(ctx.db);
  const batchesByGroup = new Map(batches.map((batch) => [batch.group, batch]));
  const runnable = runnableKinds(states, kinds, batchesByGroup);
  // Every kind that can run, for the rest of a batch, whichever kind's turn took its first job.
  const runnableNames = runnable.map((kind) => kind.name);
  const kindsByName = new Map(runnable.map((kind) => [kind.name, kind]));
  // The kinds that still take turns, and whose turn it is.
  let turns = [...runnable];
  let turn = 0;
  const counts = new Map<string, KindCounts>();
  // The last error each kind recorded this tick, for its run in the history.
  const lastErrors = new Map<string, string>();
  while (turns.length > 0 && Date.now() < deadline.getTime()) {
    const current = defined(turns[turn], 'the kind whose turn it is');
    // One claim at a time on purpose: jobs are taken only when they're about to run.
    // eslint-disable-next-line no-await-in-loop -- See above.
    const jobs = await claimNextQueuedJobs(ctx.db, runnableNames, current.name);
    if (jobs.length === 0) {
      // Nothing of this kind is due: it sits out the rest of the tick, and the next kind moves up.
      turns = turns.filter((kind) => kind !== current);
      turn = turn < turns.length ? turn : 0;
    } else {
      turn = (turn + 1) % turns.length;
      const claimed = jobs.map((job) => ({
        job,
        kind: defined(kindsByName.get(job.kind), `the kind of queued job ${job.id}`),
      }));
      // Taken once more than its kind allows: every attempt was used, and the last one died
      // (a run that's stopped never throws). It fails for good, rather than being taken forever.
      const spent = claimed.filter(({ job, kind }) => job.attempts > kind.maxAttempts);
      const toRun = claimed.filter(({ job, kind }) => job.attempts <= kind.maxAttempts);
      const endings = [
        // eslint-disable-next-line no-await-in-loop -- See above.
        ...(spent.length > 0 ? await fail(ctx, spent, new Error(NEVER_FINISHED)) : []),
        // eslint-disable-next-line no-await-in-loop -- See above.
        ...(toRun.length > 0 ? await runClaimed(ctx, toRun, batchesByGroup) : []),
      ];
      endings.forEach(({ kind, ended, errorReference }) => {
        const kindCounts = counts.get(kind) ?? { done: 0, skipped: 0, retried: 0, failed: 0 };
        kindCounts[ended] += 1;
        counts.set(kind, kindCounts);
        if (errorReference) {
          lastErrors.set(kind, errorReference);
        }
      });
    }
  }
  // Kinds still taking turns at the deadline may have jobs left; one lookup tells.
  const moreDue = turns.length > 0 && (await hasDueQueuedJobs(ctx.db, runnableNames));
  const runs: JobRunResult[] = await Promise.all(
    [...counts].map(async ([name, summary]) => {
      const status = summary.retried + summary.failed > 0 ? 'failed' : 'succeeded';
      const errorReference = lastErrors.get(name) ?? null;
      const { runId } = await finishJobRun(ctx.db, {
        job: name,
        trigger,
        startedBy: null,
        startedAt,
        status,
        summary: { ...summary },
        errorReference,
      });
      if (summary.failed > 0) {
        await alertStaffAdmins(ctx, {
          job: name,
          failure: 'queued',
          count: summary.failed,
          reference: errorReference,
        });
      }
      return { job: name, status, summary: { ...summary }, runId, errorReference };
    }),
  );
  return { runs, moreDue };
}
