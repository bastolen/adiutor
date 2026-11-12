/**
 * @file Background jobs (decision 0018): the state of each job (paused or
 * not, who holds it, how its last run went), the history of its runs, kept
 * for 30 days, and the queue of jobs the app adds to run once.
 */
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, id, timestampTz } from './columns';

/** How a run of a job ended. */
export const JOB_RUN_STATUSES = ['succeeded', 'failed'] as const;

/** How a run of a job ended: it did its work, or it (partly) failed. */
export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number];

/** What started a run. */
export const JOB_TRIGGERS = ['tick', 'cli', 'page'] as const;

/**
 * What started a run: the tick from the endpoint (`tick`), the command line
 * (`cli`, also what system cron runs) or a staff Admin on the Jobs page
 * (`page`).
 */
export type JobTrigger = (typeof JOB_TRIGGERS)[number];

/**
 * One row per job, created the first time it runs. The lease
 * (`locked_until`) keeps two runs of the same job apart: a run takes the job
 * only while no other run holds it, and a run that dies frees it when the
 * lease runs out.
 */
export const jobState = pgTable(
  'job_state',
  {
    id: id(),
    /** The job's name, as its definition gives it (e.g. `retention`). */
    name: text('name').notNull(),
    /** When it was paused: the tick skips paused jobs. */
    pausedAt: timestampTz('paused_at'),
    /** Who paused it, while their account exists. */
    pausedBy: uuid('paused_by').references(() => user.id, { onDelete: 'set null' }),
    /** Until when a run holds the job; `null` while no run does. */
    lockedUntil: timestampTz('locked_until'),
    /** When its last run started: the tick compares it with the job's schedule. */
    lastStartedAt: timestampTz('last_started_at'),
    /** When its last run finished. */
    lastFinishedAt: timestampTz('last_finished_at'),
    /** How its last run ended. */
    lastStatus: text('last_status').$type<JobRunStatus>(),
    /** How many runs in a row failed; back to 0 after a run that succeeds. */
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  },
  (table) => [
    uniqueIndex('job_state_name_idx').on(table.name),
    index('job_state_paused_by_idx').on(table.pausedBy),
  ],
);

/**
 * The history of runs: one row per finished run, with what it did as counts
 * (never personal data).
 */
export const jobRun = pgTable(
  'job_run',
  {
    id: id(),
    /** The job's name. */
    job: text('job').notNull(),
    /** What started the run. */
    trigger: text('trigger').$type<JobTrigger>().notNull(),
    /** The staff Admin who started it from the Jobs page, while their account exists. */
    startedBy: uuid('started_by').references(() => user.id, { onDelete: 'set null' }),
    startedAt: timestampTz('started_at').notNull(),
    finishedAt: timestampTz('finished_at').defaultNow().notNull(),
    /** How it ended. */
    status: text('status').$type<JobRunStatus>().notNull(),
    /** What it did, as counts, e.g. `{ "sessions": 12 }`. */
    summary: jsonb('summary').$type<Record<string, number>>().notNull().default({}),
    /**
     * The reference of the error a failed run recorded (Logs → Errors, kept
     * 7 days), or of the last one when several of a kind's queued jobs failed.
     */
    errorReference: text('error_reference'),
  },
  (table) => [
    index('job_run_job_started_at_idx').on(table.job, table.startedAt),
    index('job_run_started_at_idx').on(table.startedAt),
    index('job_run_started_by_idx').on(table.startedBy),
  ],
);

/** Where a queued job is. */
export const QUEUED_JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'skipped',
  'failed',
  'discarded',
] as const;

/**
 * Where a queued job is: waiting (`queued`, also between attempts), being
 * run, done (`succeeded`, or `skipped` when what it was about is gone), given
 * up after its last attempt (`failed`) or `discarded` by a staff Admin.
 */
export type QueuedJobStatus = (typeof QUEUED_JOB_STATUSES)[number];

/**
 * Jobs the app adds to run once, at the next tick or later: the queue. Each
 * holds IDs and small settings only (its `payload`), never personal data; the
 * job reads what it needs when it runs. Finished jobs are kept for 30 days.
 */
export const queuedJob = pgTable(
  'queued_job',
  {
    id: id(),
    /** What kind of job it is, by the kind's name (e.g. `security-notice`). */
    kind: text('kind').notNull(),
    /** Its IDs and small settings, checked against the kind's schema when it's queued. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    /** Jobs with the same key run together, in one call of their batch's handler; `null` runs alone. */
    batchKey: text('batch_key'),
    /** Where it is. */
    status: text('status').$type<QueuedJobStatus>().notNull().default('queued'),
    /** When it may run: when it was queued, a later moment, or after a failed attempt. */
    runAt: timestampTz('run_at').defaultNow().notNull(),
    /** How many times a run took it. */
    attempts: integer('attempts').notNull().default(0),
    /** Until when the run that took it holds it; `null` while no run does. */
    lockedUntil: timestampTz('locked_until'),
    createdAt: createdAt(),
    /** When it was done, given up or discarded. */
    finishedAt: timestampTz('finished_at'),
    /** The reference of the error its last failed attempt recorded (Logs → Errors, kept 7 days). */
    lastErrorReference: text('last_error_reference'),
  },
  (table) => [
    // What the tick looks for: waiting jobs, oldest due first.
    index('queued_job_due_idx')
      .on(table.runAt, table.id)
      .where(sql`${table.status} = 'queued'`),
    index('queued_job_batch_key_idx')
      .on(table.batchKey)
      .where(sql`${table.status} = 'queued'`),
    index('queued_job_kind_status_idx').on(table.kind, table.status),
    index('queued_job_finished_at_idx').on(table.finishedAt),
  ],
);
