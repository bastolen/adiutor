/**
 * @file How a kind of queued job is declared: its name, the IDs and settings
 * its jobs carry, how often it may run, and whether its jobs run together
 * with others (batches). What a job does is the job runner's business
 * (`handleQueuedJob` in `src/server/jobs`), so code that queues jobs never
 * imports the code that runs them.
 */
import type { z } from 'zod';

/**
 * One value in a queued job's payload: an ID, a small setting, or a list of
 * IDs. Never personal data such as names or addresses: the job reads those
 * when it runs.
 */
export type JobPayloadValue = string | number | boolean | null | readonly string[];

/** A queued job's payload: named IDs and small settings, e.g. `{ userId, kind: 'password_changed' }`. */
export type JobPayload = Readonly<Record<string, JobPayloadValue>>;

/**
 * How a kind's jobs are coupled: kinds with the same `group` run together,
 * through that group's batch (`defineJobBatch` in `src/server/jobs`), and
 * jobs with the same key go into one call of it; say, a status update and a
 * comment for the same person on the same ticket, so they get one email.
 */
export interface JobBatching<P extends JobPayload> {
  /** The batch group. */
  group: string;
  /** Which jobs go together, from a job's payload; e.g. the ticket's and the person's IDs. */
  key: (payload: P) => string;
}

/** How a kind of queued job is declared. */
export interface QueuedKindDefinition<P extends JobPayload> {
  /** Stable name in kebab-case, stored with each job, e.g. `security-notice`. */
  name: string;
  /** The payload's schema: IDs, enums, numbers and booleans (see {@link JobPayloadValue}). */
  payload: z.ZodType<P>;
  /** How many times a job is tried before it's given up as failed. */
  maxAttempts?: number;
  /**
   * Whether staff Admins may pause it; `false` for kinds that keep people
   * informed about their security (security notices, new staff Admins), so
   * nobody can silence them. Pausable by default.
   */
  pausable?: boolean;
  /** How its jobs are coupled with others, if they are. */
  batch?: JobBatching<P>;
}

/** A kind of queued job, as `queueJob` and the job runner use it. */
export interface QueuedJobKind<P extends JobPayload> {
  /** The kind's name. */
  name: string;
  /** The payload's schema. */
  payload: z.ZodType<P>;
  /** How many times a job is tried before it's given up as failed. */
  maxAttempts: number;
  /** Whether staff Admins may pause it. */
  pausable: boolean;
  /** The batch group its jobs run in, or `null` when each runs on its own. */
  batchGroup: string | null;
  /** Checks a payload, as stored or as given, against the schema. */
  check: (payload: unknown) => P;
  /** The batch key a job with this payload is queued with, or `null` when it runs on its own. */
  batchKey: (payload: P) => string | null;
  /** A job's payload, typed, when the job is of this kind; `null` otherwise. */
  read: (job: { kind: string; payload: unknown }) => P | null;
}

/**
 * How many times a job is tried before it's given up, unless its kind says
 * otherwise: with the runner's waits between attempts, about 7½ hours in all.
 */
const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Declares a kind of queued job. Queue jobs of it with `queueJob`, and give
 * it a handler in the job runner's registry.
 *
 * @param definition - The kind.
 * @param definition.name - Its name.
 * @param definition.payload - The payload's schema.
 * @param definition.maxAttempts - How many times a job is tried.
 * @param definition.pausable - Whether staff Admins may pause it.
 * @param definition.batch - How its jobs are coupled with others.
 * @returns The kind.
 */
export function defineQueuedKind<P extends JobPayload>({
  name,
  payload,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  pausable = true,
  batch,
}: QueuedKindDefinition<P>): QueuedJobKind<P> {
  return {
    name,
    payload,
    maxAttempts,
    pausable,
    batchGroup: batch?.group ?? null,
    /**
     * Checks a payload.
     *
     * @param value - The payload.
     * @returns It, checked.
     */
    check: (value) => payload.parse(value),
    /**
     * The batch key for a payload.
     *
     * @param value - The payload.
     * @returns `<group>:<key>`, or `null` when the kind's jobs run on their own.
     */
    batchKey: (value) => (batch ? `${batch.group}:${batch.key(value)}` : null),
    /**
     * Reads a job's payload when it's of this kind.
     *
     * @param job - The job.
     * @returns The payload, typed, or `null`.
     */
    read: (job) => (job.kind === name ? payload.parse(job.payload) : null),
  };
}
