/**
 * @file Integration tests for the queue, against the test database: queuing
 * a job with a checked payload, running due jobs at the tick (oldest first,
 * once each, even with two ticks at once), skipped jobs, failed jobs tried
 * again after growing waits and then given up, runs that died, paused
 * kinds, each kind's cap per tick, the deadline, and coupled jobs that run
 * together in batches.
 */
import { randomUUID } from 'node:crypto';

import { asc, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z, ZodError } from 'zod';

import { jobRun, jobState, queuedJob } from '@/db/schema';

import { setupTestContext } from '../../../tests/integration/helpers';
import {
  type BatchedQueuedJob,
  defineJobBatch,
  defineQueuedJob,
  type JobBatch,
  type QueuedJobKind,
} from './define';
import { queueJob, retryWaitMinutes } from './queue';
import { runQueue } from './run-queue';
import { runTick } from './tick';

const { ctx, db } = setupTestContext();

/** Far enough away that no test reaches it. */
const later = new Date(Date.now() + 60 * 60_000);

/** The notes of the jobs the test kinds ran, in order. */
let ran: string[] = [];

beforeEach(() => {
  ran = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The payload of the test kinds: a user's ID and a note, as a small setting. */
const payload = z.object({ userId: z.uuid(), note: z.string() });

/**
 * A test kind that notes each job it runs.
 *
 * @param name - Its name.
 * @param options - How it behaves.
 * @param options.perTick - How many of its jobs one tick runs at most.
 * @param options.result - What each run returns: done by default.
 * @returns The kind.
 */
function noteKind(
  name: string,
  {
    perTick,
    result = async () => 'done',
  }: {
    perTick?: number;
    result?: (note: string) => Promise<'done' | 'skipped'>;
  } = {},
): QueuedJobKind<z.infer<typeof payload>> {
  return defineQueuedJob({
    name,
    payload,
    ...(perTick ? { perTick } : {}),
    /**
     * Notes the job, then ends as the test asks.
     *
     * @param _ctx - Service context (not used).
     * @param job - The job.
     * @returns How it ended.
     */
    run: async (_ctx, job) => {
      ran.push(job.payload.note);
      return result(job.payload.note);
    },
  });
}

/**
 * Queues a job of a kind.
 *
 * @param kind - The kind.
 * @param note - Its note.
 * @param runAt - When it may run; now by default.
 * @returns The job's ID.
 */
async function add(kind: QueuedJobKind<z.infer<typeof payload>>, note: string, runAt?: Date) {
  return queueJob(db, kind, { userId: randomUUID(), note }, runAt ? { runAt } : {});
}

/**
 * The stored jobs, oldest first.
 *
 * @returns Each job's note, status and attempts.
 */
async function stored() {
  const rows = await db
    .select({ payload: queuedJob.payload, status: queuedJob.status, attempts: queuedJob.attempts })
    .from(queuedJob)
    .orderBy(asc(queuedJob.runAt), asc(queuedJob.id));
  return rows.map((row) => ({
    note: row.payload.note,
    status: row.status,
    attempts: row.attempts,
  }));
}

describe('queueJob', () => {
  it('stores a job with its kind and checked payload', async () => {
    const kind = noteKind('adiutor-tests-note');
    const userId = randomUUID();

    const id = await queueJob(db, kind, { userId, note: 'hello' });

    expect(await db.select().from(queuedJob).where(eq(queuedJob.id, id))).toEqual([
      expect.objectContaining({
        kind: 'adiutor-tests-note',
        payload: { userId, note: 'hello' },
        status: 'queued',
        attempts: 0,
        batchKey: null,
      }),
    ]);
  });

  it('refuses a payload that does not fit, and stores nothing', async () => {
    const kind = noteKind('adiutor-tests-note');

    await expect(queueJob(db, kind, { userId: 'not-an-id', note: 'hello' })).rejects.toThrow(
      ZodError,
    );
    expect(await db.select().from(queuedJob)).toEqual([]);
  });
});

describe('running the queue', () => {
  it('runs due jobs at the tick, oldest first, and records one run for the kind', async () => {
    const kind = noteKind('adiutor-tests-note');
    await add(kind, 'second', new Date(Date.now() - 60_000));
    await add(kind, 'first', new Date(Date.now() - 120_000));
    await add(kind, 'tomorrow', new Date(Date.now() + 24 * 60 * 60_000));

    const result = await runTick(ctx, {
      trigger: 'tick',
      deadline: later,
      jobs: [],
      queuedJobs: [kind],
    });

    expect(ran).toEqual(['first', 'second']);
    expect(result.runs).toEqual([
      expect.objectContaining({
        job: kind.name,
        status: 'succeeded',
        summary: { done: 2, skipped: 0, retried: 0, failed: 0 },
      }),
    ]);
    expect(await stored()).toEqual([
      { note: 'first', status: 'succeeded', attempts: 1 },
      { note: 'second', status: 'succeeded', attempts: 1 },
      { note: 'tomorrow', status: 'queued', attempts: 0 },
    ]);
    expect(await db.select({ trigger: jobRun.trigger }).from(jobRun)).toEqual([
      { trigger: 'tick' },
    ]);
    // A job that's done doesn't run again.
    ran = [];
    await runQueue(ctx, { trigger: 'tick', deadline: later, startedAt: new Date(), kinds: [kind] });
    expect(ran).toEqual([]);
  });

  it('marks a job skipped when what it was about is gone', async () => {
    const kind = noteKind('adiutor-tests-note', {
      /**
       * What it was about is gone.
       *
       * @returns Skipped.
       */
      result: async () => 'skipped',
    });
    await add(kind, 'gone');

    const runs = await runQueue(ctx, {
      trigger: 'tick',
      deadline: later,
      startedAt: new Date(),
      kinds: [kind],
    });

    expect(runs).toEqual([
      expect.objectContaining({
        status: 'succeeded',
        summary: { done: 0, skipped: 1, retried: 0, failed: 0 },
      }),
    ]);
    expect(await stored()).toEqual([{ note: 'gone', status: 'skipped', attempts: 1 }]);
  });

  it('tries a failed job again later without stopping the others, and counts the failed run', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const kind = noteKind('adiutor-tests-note', {
      /**
       * Breaks for one note, does the rest.
       *
       * @param note - The job's note.
       * @returns Done, unless it throws.
       */
      result: async (note) => {
        if (note === 'broken') {
          throw new Error('Adiutor Tests: the job broke');
        }
        return 'done';
      },
    });
    await add(kind, 'broken', new Date(Date.now() - 60_000));
    await add(kind, 'fine');

    const runs = await runQueue(ctx, {
      trigger: 'tick',
      deadline: later,
      startedAt: new Date(),
      kinds: [kind],
    });

    expect(runs).toEqual([
      expect.objectContaining({
        status: 'failed',
        summary: { done: 1, skipped: 0, retried: 1, failed: 0 },
      }),
    ]);
    expect(await stored()).toEqual([
      { note: 'fine', status: 'succeeded', attempts: 1 },
      // Back in the queue, 5 minutes from now: after the job that's done.
      { note: 'broken', status: 'queued', attempts: 1 },
    ]);
    expect(
      await db
        .select({ consecutiveFailures: jobState.consecutiveFailures })
        .from(jobState)
        .where(eq(jobState.name, kind.name)),
    ).toEqual([{ consecutiveFailures: 1 }]);
  });

  it('leaves the jobs of a paused kind, and of kinds it does not know, waiting', async () => {
    const paused = noteKind('adiutor-tests-paused');
    const unknown = noteKind('adiutor-tests-unknown');
    await db.insert(jobState).values({ name: paused.name, pausedAt: sql`now()` });
    await add(paused, 'paused');
    await add(unknown, 'unknown');

    const runs = await runQueue(ctx, {
      trigger: 'tick',
      deadline: later,
      startedAt: new Date(),
      kinds: [paused],
    });

    expect(runs).toEqual([]);
    expect((await stored()).map(({ status }) => status)).toEqual(['queued', 'queued']);
  });

  it('runs at most its cap of one kind per tick, and the rest at the next', async () => {
    const kind = noteKind('adiutor-tests-note', { perTick: 2 });
    await Promise.all(['a', 'b', 'c'].map(async (note) => add(kind, note)));

    await runQueue(ctx, { trigger: 'tick', deadline: later, startedAt: new Date(), kinds: [kind] });
    expect(ran).toHaveLength(2);
    await runQueue(ctx, { trigger: 'tick', deadline: later, startedAt: new Date(), kinds: [kind] });
    expect(ran).toHaveLength(3);
  });

  it('takes no new jobs once the deadline has passed', async () => {
    const kind = noteKind('adiutor-tests-note');
    await add(kind, 'late');

    const runs = await runQueue(ctx, {
      trigger: 'tick',
      deadline: new Date(Date.now() - 1),
      startedAt: new Date(),
      kinds: [kind],
    });

    expect(runs).toEqual([]);
    expect(await stored()).toEqual([{ note: 'late', status: 'queued', attempts: 0 }]);
  });

  it('runs each job once when two ticks run the queue at the same time', async () => {
    const slow = defineQueuedJob({
      name: 'adiutor-tests-slow',
      payload,
      /**
       * Notes the job and takes a moment, so two ticks overlap.
       *
       * @param _ctx - Service context (not used).
       * @param job - The job.
       * @returns Done.
       */
      run: async (_ctx, job) => {
        ran.push(job.payload.note);
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
        return 'done';
      },
    });
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e', 'f'].map(async (note) =>
        queueJob(db, slow, { userId: randomUUID(), note }),
      ),
    );

    const options = { trigger: 'tick' as const, deadline: later, kinds: [slow] };
    await Promise.all([
      runQueue(ctx, { ...options, startedAt: new Date() }),
      runQueue(ctx, { ...options, startedAt: new Date() }),
    ]);

    expect([...ran].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect((await stored()).every(({ attempts }) => attempts === 1)).toBe(true);
  });

  it('waits longer after each failed attempt, and gives up after the last', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = defineQueuedJob({
      name: 'adiutor-tests-broken',
      payload,
      maxAttempts: 3,
      /**
       * Always fails.
       *
       * @returns Never.
       */
      run: async () => {
        throw new Error('Adiutor Tests: the job broke');
      },
    });
    const id = await queueJob(db, broken, { userId: randomUUID(), note: 'broken' });
    /**
     * Runs the queue as if the job's wait were over.
     *
     * @returns When the job may run next, in minutes from now (rounded), and its status.
     */
    async function attempt() {
      await db
        .update(queuedJob)
        .set({ runAt: sql`now()` })
        .where(eq(queuedJob.id, id));
      await runQueue(ctx, {
        trigger: 'tick',
        deadline: later,
        startedAt: new Date(),
        kinds: [broken],
      });
      const [job] = await db
        .select({
          status: queuedJob.status,
          wait: sql<number>`round(extract(epoch from ${queuedJob.runAt} - now()) / 60)::int`,
          finished: sql<boolean>`${queuedJob.finishedAt} is not null`,
        })
        .from(queuedJob)
        .where(eq(queuedJob.id, id));
      return job;
    }

    await expect(attempt()).resolves.toEqual({ status: 'queued', wait: 5, finished: false });
    await expect(attempt()).resolves.toEqual({ status: 'queued', wait: 15, finished: false });
    await expect(attempt()).resolves.toMatchObject({ status: 'failed', finished: true });
  });

  it('takes a job again once the lease of the run that died runs out', async () => {
    const kind = noteKind('adiutor-tests-note');
    const id = await add(kind, 'orphaned');
    await db
      .update(queuedJob)
      .set({ status: 'running', attempts: 1, lockedUntil: sql`now() - interval '1 minute'` })
      .where(eq(queuedJob.id, id));

    await runQueue(ctx, { trigger: 'tick', deadline: later, startedAt: new Date(), kinds: [kind] });

    expect(await stored()).toEqual([{ note: 'orphaned', status: 'succeeded', attempts: 2 }]);
  });

  it('waits 5 minutes, 15, an hour, then 6 hours each time', () => {
    expect([1, 2, 3, 4, 5, 9].map(retryWaitMinutes)).toEqual([5, 15, 60, 360, 360, 360]);
  });
});

describe('batches', () => {
  /** The payload of the coupled test kinds: a ticket and the person to tell. */
  const ticketPayload = z.object({ ticketId: z.uuid(), userId: z.uuid() });

  /** Jobs about the same ticket for the same person go together. */
  const batching = {
    group: 'adiutor-tests-ticket-email',
    /**
     * The key: the ticket and the person.
     *
     * @param about - The job's payload.
     * @returns The key.
     */
    key: (about: z.infer<typeof ticketPayload>) => `${about.ticketId}:${about.userId}`,
  };

  /** A status update, coupled with comments. */
  const statusChanged = defineQueuedJob({
    name: 'adiutor-tests-status-changed',
    payload: ticketPayload,
    batch: batching,
  });

  /** A comment, coupled with status updates. */
  const commented = defineQueuedJob({
    name: 'adiutor-tests-commented',
    payload: ticketPayload,
    batch: batching,
  });

  /** The jobs of each call of the batch, as `<kind>:<ticket>:<person>`. */
  let calls: string[][] = [];

  beforeEach(() => {
    calls = [];
  });

  /**
   * The batch: notes the jobs of each call.
   *
   * @param outcome - What it does after noting them: nothing by default.
   * @returns The batch.
   */
  function emailBatch(
    outcome: (
      jobs: readonly BatchedQueuedJob[],
    ) => Promise<{ skipped?: string[] }> = async () => ({}),
  ): JobBatch {
    return defineJobBatch({
      group: batching.group,
      /**
       * Notes the jobs, reading each payload with its own kind.
       *
       * @param _ctx - Service context (not used).
       * @param jobs - The jobs of one key.
       * @returns What the test asks.
       */
      run: async (_ctx, jobs) => {
        calls.push(
          jobs.map((job) => {
            const about = statusChanged.read(job) ?? commented.read(job);
            return `${job.kind}:${about?.ticketId}:${about?.userId}`;
          }),
        );
        return outcome(jobs);
      },
    });
  }

  /** Two tickets and two people. */
  const [ticket1, ticket2, jane, john] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

  /**
   * Runs the queue with the coupled kinds.
   *
   * @param batch - The batch.
   * @returns The runs.
   */
  async function run(batch: JobBatch = emailBatch()) {
    return runQueue(ctx, {
      trigger: 'tick',
      deadline: later,
      startedAt: new Date(),
      kinds: [statusChanged, commented],
      batches: [batch],
    });
  }

  it('runs the jobs of one key together, whatever their kind, and each job once', async () => {
    await queueJob(db, statusChanged, { ticketId: ticket1, userId: jane });
    await queueJob(db, commented, { ticketId: ticket1, userId: jane });
    await queueJob(db, commented, { ticketId: ticket1, userId: john });
    await queueJob(db, commented, { ticketId: ticket2, userId: jane });

    const runs = await run();

    expect(calls).toEqual([
      [`${statusChanged.name}:${ticket1}:${jane}`, `${commented.name}:${ticket1}:${jane}`],
      [`${commented.name}:${ticket1}:${john}`],
      [`${commented.name}:${ticket2}:${jane}`],
    ]);
    expect(runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          job: commented.name,
          summary: { done: 3, skipped: 0, retried: 0, failed: 0 },
        }),
        expect.objectContaining({
          job: statusChanged.name,
          summary: { done: 1, skipped: 0, retried: 0, failed: 0 },
        }),
      ]),
    );
    // A job that was in one batch never comes back in the next.
    calls = [];
    await queueJob(db, commented, { ticketId: ticket1, userId: jane });
    await run();
    expect(calls).toEqual([[`${commented.name}:${ticket1}:${jane}`]]);
  });

  it('stores the key with each job', async () => {
    const id = await queueJob(db, commented, { ticketId: ticket1, userId: jane });

    expect(
      await db.select({ batchKey: queuedJob.batchKey }).from(queuedJob).where(eq(queuedJob.id, id)),
    ).toEqual([{ batchKey: `${batching.group}:${ticket1}:${jane}` }]);
  });

  it('tries a failed batch again together with the jobs of its key queued since', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await queueJob(db, statusChanged, { ticketId: ticket1, userId: jane });
    await queueJob(db, commented, { ticketId: ticket1, userId: jane });

    const failed = await run(
      emailBatch(async () => {
        throw new Error('Adiutor Tests: the mail server is down');
      }),
    );
    expect(failed).toEqual(
      expect.arrayContaining([expect.objectContaining({ job: commented.name, status: 'failed' })]),
    );
    expect((await stored()).map(({ status }) => status)).toEqual(['queued', 'queued']);

    // Another comment arrives, and the wait is over.
    await queueJob(db, commented, { ticketId: ticket1, userId: jane });
    await db.update(queuedJob).set({ runAt: sql`now() - interval '1 second'` });
    calls = [];
    await run();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(3);
    expect((await stored()).map(({ status }) => status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
  });

  it('marks the jobs the batch skipped, and the rest done', async () => {
    const gone = await queueJob(db, statusChanged, { ticketId: ticket1, userId: jane });
    await queueJob(db, commented, { ticketId: ticket1, userId: jane });

    await run(emailBatch(async () => ({ skipped: [gone] })));

    expect(
      await db
        .select({ kind: queuedJob.kind, status: queuedJob.status })
        .from(queuedJob)
        .orderBy(queuedJob.kind),
    ).toEqual([
      { kind: commented.name, status: 'succeeded' },
      { kind: statusChanged.name, status: 'skipped' },
    ]);
  });

  it('leaves batched jobs waiting while their group has no batch', async () => {
    await queueJob(db, commented, { ticketId: ticket1, userId: jane });

    const runs = await runQueue(ctx, {
      trigger: 'tick',
      deadline: later,
      startedAt: new Date(),
      kinds: [statusChanged, commented],
      batches: [],
    });

    expect(runs).toEqual([]);
    expect((await stored()).map(({ status }) => status)).toEqual(['queued']);
  });
});
