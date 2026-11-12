/**
 * @file How a background job is described: a recurring job's name, when it
 * runs and what it does, and a queued job's kind: its name, the IDs and
 * settings it carries and what it does with them. Each lives in a file of
 * its own and is listed in `registry.ts` (see docs/jobs.md).
 */
import type { z } from 'zod';

import type { ServiceContext } from '../context';

/** What a run did, as counts, e.g. `{ sessions: 12 }`: numbers only, never personal data. */
export type JobSummary = Readonly<Record<string, number>>;

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

/**
 * One value in a queued job's payload: an ID, a small setting, or a list of
 * IDs. Never personal data such as names or addresses: the job reads those
 * when it runs.
 */
export type JobPayloadValue = string | number | boolean | null | readonly string[];

/** A queued job's payload: named IDs and small settings, e.g. `{ userId, kind: 'password_changed' }`. */
export type JobPayload = Readonly<Record<string, JobPayloadValue>>;

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
}

/** A queued job as its kind's `run` gets it: with its payload checked. */
export interface QueuedJob<P extends JobPayload> {
  /** The job's ID. */
  id: string;
  /** Its payload. */
  payload: P;
  /** How many times a run took it, this one included. */
  attempts: number;
}

/**
 * How a queued job's run ended: `done`, or `skipped` when what it was about
 * is gone (say, the user was deleted meanwhile). A job that can't do its work
 * throws instead.
 */
export type QueuedJobResult = 'done' | 'skipped';

/** How a kind of queued job is described. */
export interface QueuedJobDefinition<P extends JobPayload> {
  /** Stable name in kebab-case, stored with each job, e.g. `security-notice`. */
  name: string;
  /** The payload's schema: IDs, enums, numbers and booleans (see {@link JobPayloadValue}). */
  payload: z.ZodType<P>;
  /** How many of its jobs one tick runs at most, so a large batch can't push the others out. */
  perTick?: number;
  /** How many times a job is tried before it's given up as failed. */
  maxAttempts?: number;
  /** Does one job's work; throws when it can't. */
  run: (ctx: ServiceContext, job: QueuedJob<P>) => Promise<QueuedJobResult>;
}

/** What the runner needs of any kind of queued job, whatever its payload. */
export interface QueuedJobRunner {
  /** The kind's name. */
  name: string;
  /** How many of its jobs one tick runs at most. */
  perTick: number;
  /** How many times a job is tried before it's given up as failed. */
  maxAttempts: number;
  /** Runs a job from the queue, checking its payload first. */
  handle: (ctx: ServiceContext, job: StoredQueuedJob) => Promise<QueuedJobResult>;
}

/** A kind of queued job: what the runner needs, and the schema `queueJob` checks payloads with. */
export interface QueuedJobKind<P extends JobPayload> extends QueuedJobRunner {
  /** The payload's schema. */
  payload: z.ZodType<P>;
}

/** How many jobs of one kind a tick runs at most, unless the kind says otherwise. */
export const DEFAULT_PER_TICK = 50;

/**
 * How many times a job is tried before it's given up, unless its kind says
 * otherwise: with the waits in `RETRY_MINUTES`, about 7½ hours in all.
 */
export const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Describes a kind of queued job; add it to `QUEUED_JOBS` in `registry.ts`,
 * and queue jobs of it with `queueJob`.
 *
 * @param definition - The kind.
 * @param definition.name - Its name.
 * @param definition.payload - The payload's schema.
 * @param definition.perTick - How many of its jobs one tick runs at most.
 * @param definition.maxAttempts - How many times a job is tried.
 * @param definition.run - What one job does.
 * @returns The kind.
 */
export function defineQueuedJob<P extends JobPayload>({
  name,
  payload,
  perTick = DEFAULT_PER_TICK,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  run,
}: QueuedJobDefinition<P>): QueuedJobKind<P> {
  return {
    name,
    payload,
    perTick,
    maxAttempts,
    /**
     * Checks the stored payload against the schema, then runs the job.
     *
     * @param ctx - Service context.
     * @param job - The job, as stored.
     * @returns How it ended.
     */
    handle: async (ctx, job) =>
      run(ctx, { id: job.id, attempts: job.attempts, payload: payload.parse(job.payload) }),
  };
}
