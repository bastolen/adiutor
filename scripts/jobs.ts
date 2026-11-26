/**
 * @file The background jobs from the command line (see docs/jobs.md).
 *
 * - `pnpm jobs:run`: one tick, running every job that's due. System cron
 *   (and the Docker image) runs it every 5 minutes, e.g.
 *   `*\/5 * * * * cd /srv/adiutor && pnpm jobs:run >> /var/log/adiutor-jobs.log 2>&1`.
 * - `pnpm jobs:run <name>`: runs one job now, whether it's due or not.
 * - `pnpm jobs:list`: every job with its schedule, state, last and next run,
 *   each kind of queued job with how many wait and failed, and the failed
 *   jobs' IDs.
 * - `pnpm jobs:retry <id>` or `pnpm jobs:retry --kind <name>`: puts failed
 *   queued jobs back in the queue, with a fresh count of attempts.
 * - `pnpm jobs:discard <id>` or `pnpm jobs:discard --kind <name>`: discards
 *   failed queued jobs.
 *
 * It exits with 1 when a run failed (after the other jobs ran), so cron's
 * mail or the monitoring notices; 2 for a mistake in the command.
 */
import { z } from 'zod';

import { db } from '../src/db';
import { sendEmail } from '../src/lib/email';
import { appUrl } from '../src/lib/env';
import {
  discardFailedQueuedJobs,
  type FailedJobsSelection,
  type JobRunResult,
  listFailedQueuedJobs,
  listJobs,
  listQueuedKinds,
  RECURRING_JOBS,
  retryFailedQueuedJobs,
  runJobNow,
  runTick,
} from '../src/server/jobs';
import { activeStorage } from '../src/server/storage';
import runScript from './run-script';

/** How long one tick from the command line may keep starting runs: less than cron's 5 minutes. */
const TICK_MINUTES = 4;

/** How long one job run by hand may take. */
const RUN_NOW_MINUTES = 10;

/**
 * The service context for the jobs: the database, email, the app's address
 * and the file storage, which a jobs container must reach like the app does
 * (the same volume, for local disk).
 */
const ctx = {
  db,
  sendEmail,
  baseUrl: appUrl,
  /**
   * The storage files go to now: the environment's, or Settings'.
   *
   * @returns The storage, or `null`.
   */
  storage: () => activeStorage(db),
};

/**
 * The moment some minutes from now.
 *
 * @param minutes - How many minutes.
 * @returns That moment.
 */
function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

/**
 * Describes a run on one line, e.g. `retention: succeeded (auditEvents 0, jobRuns 12)`.
 *
 * @param run - The run.
 * @returns The line.
 */
function describeRun(run: JobRunResult): string {
  const counts = Object.entries(run.summary)
    .map(([what, count]) => `${what} ${count}`)
    .join(', ');
  return `${run.job}: ${run.status}${counts ? ` (${counts})` : ''}`;
}

/**
 * Prints a line with the time in front.
 *
 * @param line - The line.
 */
function print(line: string): void {
  console.info(`[${new Date().toISOString()}] ${line}`);
}

/**
 * Runs one tick and prints what it did.
 *
 * @returns The exit code: 1 when a run failed.
 */
async function tick(): Promise<number> {
  const result = await runTick(ctx, { trigger: 'cli', deadline: minutesFromNow(TICK_MINUTES) });
  if (result.runs.length === 0) {
    print('Nothing was due.');
  }
  result.runs.forEach((run) => print(describeRun(run)));
  if (result.leftForNextTick.length > 0) {
    print(`Left for the next tick: ${result.leftForNextTick.join(', ')}.`);
  }
  return result.failed ? 1 : 0;
}

/**
 * Runs one job now and prints how it went.
 *
 * @param name - The job's name.
 * @returns The exit code: 1 when it failed, 2 for an unknown job.
 */
async function runOne(name: string): Promise<number> {
  if (!RECURRING_JOBS.some((job) => job.name === name)) {
    console.error(
      `There's no job called "${name}". The jobs: ${RECURRING_JOBS.map((job) => job.name).join(', ')}.`,
    );
    return 2;
  }
  const run = await runJobNow(ctx, name, {
    trigger: 'cli',
    deadline: minutesFromNow(RUN_NOW_MINUTES),
  });
  if (!run) {
    print(`${name} is running already; try again when it's done.`);
    return 1;
  }
  print(describeRun(run));
  return run.status === 'failed' ? 1 : 0;
}

/**
 * Formats a moment for the job list, or a dash for none.
 *
 * @param at - The moment.
 * @returns The text.
 */
function moment(at: Date | null): string {
  return at ? at.toISOString() : '-';
}

/**
 * Prints every job with its state.
 *
 * @returns The exit code: 0.
 */
async function list(): Promise<number> {
  const jobs = await listJobs(ctx);
  jobs.forEach((job) => {
    let state = 'waiting';
    if (job.paused) {
      state = 'paused';
    } else if (job.running) {
      state = 'running';
    }
    console.info(
      [
        job.name,
        `  schedule: ${job.schedule} (UTC), ${state}`,
        `  last run: ${moment(job.lastStartedAt)}, ${job.lastStatus ?? 'never ran'}${
          job.consecutiveFailures > 1 ? ` (${job.consecutiveFailures} failures in a row)` : ''
        }`,
        `  next run: ${moment(job.nextRunAt)}`,
      ].join('\n'),
    );
  });
  const [kinds, failed] = await Promise.all([listQueuedKinds(db), listFailedQueuedJobs(db)]);
  kinds.forEach((kind) => {
    const notes = [kind.paused ? 'paused' : null, kind.known ? null : 'not registered, never runs']
      .filter(Boolean)
      .join(', ');
    console.info(
      `${kind.name} (queued)${notes ? `, ${notes}` : ''}\n  waiting: ${kind.waiting}, failed: ${kind.failed}`,
    );
  });
  if (failed.length > 0) {
    console.info('Failed queued jobs (retry or discard them by ID):');
    failed.forEach((job) =>
      console.info(
        `  ${job.id}  ${job.kind}, ${job.attempts} attempts, given up ${moment(job.failedAt)}`,
      ),
    );
  }
  return 0;
}

/**
 * Reads which failed jobs a command names: an ID, or `--kind <name>`.
 *
 * @param args - The command's arguments after its name.
 * @returns The selection, or `null` when the arguments don't name one.
 */
function selectionFrom(args: readonly string[]): FailedJobsSelection | null {
  const [first, second] = args;
  if (first === '--kind') {
    return second ? { kind: second } : null;
  }
  return first && z.uuid().safeParse(first).success ? { id: first } : null;
}

/**
 * Retries or discards failed queued jobs and says how many.
 *
 * @param action - What to do.
 * @param args - The command's arguments after its name.
 * @returns The exit code: 2 when the arguments name no jobs.
 */
async function manage(action: 'retry' | 'discard', args: readonly string[]): Promise<number> {
  const selection = selectionFrom(args);
  if (!selection) {
    console.error(`Usage: pnpm jobs:${action} <id> | pnpm jobs:${action} --kind <name>`);
    return 2;
  }
  const { length: changed } =
    action === 'retry'
      ? await retryFailedQueuedJobs(db, selection)
      : await discardFailedQueuedJobs(db, selection);
  print(
    `${action === 'retry' ? 'Put back in the queue' : 'Discarded'}: ${changed} failed queued job${
      changed === 1 ? '' : 's'
    }.`,
  );
  return 0;
}

/**
 * Reads the command and does it.
 *
 * @returns The exit code.
 */
async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'run') {
    return args[0] ? runOne(args[0]) : tick();
  }
  if (command === 'list') {
    return list();
  }
  if (command === 'retry' || command === 'discard') {
    return manage(command, args);
  }
  console.error(
    'Usage: pnpm jobs:run [job] | pnpm jobs:list | pnpm jobs:retry <id> | pnpm jobs:discard <id>',
  );
  return 2;
}

runScript(main);
