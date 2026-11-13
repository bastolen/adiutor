/**
 * @file How a background job is described: a recurring job's name, when it
 * runs and what it does, and what a kind of queued job (declared with
 * `defineQueuedKind` in `src/server/queue`) does with its jobs. Each lives
 * in a file of its own and is listed in `registry.ts` (see docs/jobs.md).
 */
import type { JobSummaryKey } from '@/lib/job-names';

import type { ServiceContext } from '../context';
import type { JobPayload, QueuedJobKind } from '../queue';

/**
 * What a run did, as counts, e.g. `{ sessions: 12 }`: numbers only, never
 * personal data. Each count is one of `JOB_SUMMARY_KEYS`
 * (`src/lib/job-names.ts`), which the Jobs page words.
 */
export type JobSummary = Readonly<Partial<Record<JobSummaryKey, number>>>;

/** What a run of a job returns. */
export interface JobOutcome {
  /** What it did, as counts. */
  summary: JobSummary;
  /**
   * Why the run counts as failed although it finished, e.g. some reminders
   * couldn't be sent; absent when everything went well. For the logs: in
   * English, without personal data.
   */
  failure?: string;
}

/** What a job's `run` gets besides the service context. */
export interface JobRunOptions {
  /**
   * When the run should stop starting new work, so the request or command
   * that runs it ends in time. Work left over waits for the next run.
   */
  deadline: Date;
}

/** A job that runs on a schedule. */
export interface RecurringJob {
  /** Stable name in kebab-case, stored with its state and history, e.g. `retention`. */
  name: string;
  /** When it runs: a cron expression in UTC, e.g. `0 * * * *` for every hour. */
  schedule: string;
  /**
   * Whether staff Admins may pause it; `false` for jobs that keep Adiutor
   * secure (clearing leftover tokens, ending sign-ins as a user), which run
   * even with a pause left in the database. Pausable by default.
   */
  pausable?: boolean;
  /**
   * Does the work. It must be safe to run again at any time, and it throws
   * when it can't do its work at all.
   */
  run: (ctx: ServiceContext, options: JobRunOptions) => Promise<JobOutcome>;
}

/**
 * Describes a recurring job; add it to `RECURRING_JOBS` in `registry.ts`.
 *
 * @param job - The job.
 * @returns The same job, typed.
 */
export function defineRecurringJob(job: RecurringJob): RecurringJob {
  return job;
}

/** A queued job as the runner reads it from the queue, before its payload is checked. */
export interface StoredQueuedJob {
  /** The job's ID. */
  id: string;
  /** Its kind's name. */
  kind: string;
  /** Its payload, as stored. */
  payload: unknown;
  /** How many times a run took it, this one included. */
  attempts: number;
  /** When it was queued: what happened most likely happened then. */
  queuedAt: Date;
}

/** A queued job as its kind's handler gets it: with its payload checked. */
export interface QueuedJob<P extends JobPayload> {
  /** The job's ID. */
  id: string;
  /** Its payload. */
  payload: P;
  /** How many times a run took it, this one included. */
  attempts: number;
  /** When it was queued: what happened most likely happened then. */
  queuedAt: Date;
}

/**
 * How a queued job's run ended: `done`, or `skipped` when what it was about
 * is gone (say, the user was deleted meanwhile). A job that can't do its work
 * throws instead.
 */
export type QueuedJobResult = 'done' | 'skipped';

/** A queued job as a batch gets it: with its kind, and its payload checked by that kind. */
export interface BatchedQueuedJob {
  /** The job's ID. */
  id: string;
  /** Its kind's name. */
  kind: string;
  /** Its payload; read it typed with the kind's `read`. */
  payload: JobPayload;
  /** How many times a run took it, this one included. */
  attempts: number;
  /** When it was queued: what happened most likely happened then. */
  queuedAt: Date;
}

/** What the runner needs of any kind of queued job, whatever its payload. */
export interface QueuedJobRunner {
  /** The kind's name. */
  name: string;
  /** Whether staff Admins may pause it (see `defineQueuedKind`). */
  pausable: boolean;
  /** How many times a job is tried before it's given up as failed. */
  maxAttempts: number;
  /** The batch group its jobs run in, or `null` when each runs on its own. */
  batchGroup: string | null;
  /** Checks a stored payload against the kind's schema. */
  check: (payload: unknown) => JobPayload;
  /** Runs one of its jobs, checking the payload first; `null` when its jobs run in batches. */
  handle: ((ctx: ServiceContext, job: StoredQueuedJob) => Promise<QueuedJobResult>) | null;
}

/**
 * Gives a kind of queued job whose jobs run on their own its handler, for
 * `QUEUED_JOBS` in `registry.ts`. The result is still the kind, so tests can
 * queue jobs of it too.
 *
 * @param kind - The kind, from `defineQueuedKind`.
 * @param run - What one job does: `done`, or `skipped` when what it was about
 *   is gone; it throws when it can't do its work.
 * @returns The kind with its handler.
 * @throws {Error} When the kind's jobs run in batches (give its group a batch instead).
 */
export function handleQueuedJob<P extends JobPayload>(
  kind: QueuedJobKind<P>,
  run: (ctx: ServiceContext, job: QueuedJob<P>) => Promise<QueuedJobResult>,
): QueuedJobKind<P> & QueuedJobRunner {
  if (kind.batchGroup !== null) {
    throw new Error(
      `The jobs of ${kind.name} run in batches: give group ${kind.batchGroup} a batch`,
    );
  }
  return {
    ...kind,
    /**
     * Checks the stored payload against the schema, then runs the job.
     *
     * @param ctx - Service context.
     * @param job - The job, as stored.
     * @returns How it ended.
     */
    handle: async (ctx, job) =>
      run(ctx, {
        id: job.id,
        attempts: job.attempts,
        queuedAt: job.queuedAt,
        payload: kind.check(job.payload),
      }),
  };
}

/**
 * Lists a kind of queued job whose jobs run in batches (it has `batch`), for
 * `QUEUED_JOBS` in `registry.ts`; its group's batch runs them.
 *
 * @param kind - The kind, from `defineQueuedKind`.
 * @returns The kind, for the runner.
 * @throws {Error} When the kind's jobs run on their own (give it a handler instead).
 */
export function batchedJobRunner<P extends JobPayload>(
  kind: QueuedJobKind<P>,
): QueuedJobKind<P> & QueuedJobRunner {
  if (kind.batchGroup === null) {
    throw new Error(`The jobs of ${kind.name} run on their own: give it a handler`);
  }
  return { ...kind, handle: null };
}

/** What a batch says about its jobs: those it skipped, because what they were about is gone. The rest are done. */
export interface BatchOutcome {
  /** The IDs of the jobs it skipped. */
  skipped?: readonly string[];
}

/** The handler of a batch group: it gets the jobs of one batch key at once. */
export interface JobBatch {
  /** The group, as its kinds name it in `batch.group`. */
  group: string;
  /**
   * Does the work for the batch's jobs, e.g. one email for all of them. When
   * it throws, every job in the batch is tried again later (with anything
   * queued for the key meanwhile), so it must be safe to run again.
   */
  run: (ctx: ServiceContext, jobs: readonly BatchedQueuedJob[]) => Promise<BatchOutcome>;
}

/**
 * Describes the handler of a batch group; add it to `JOB_BATCHES` in
 * `registry.ts`.
 *
 * @param batch - The handler.
 * @returns The same handler, typed.
 */
export function defineJobBatch(batch: JobBatch): JobBatch {
  return batch;
}
