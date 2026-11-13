/**
 * @file Integration tests for the tick and running a job now, against the
 * test database: due jobs run once per scheduled moment, paused ones don't,
 * a lease keeps two runs of a job apart, failures are counted without
 * stopping the others, the recurring jobs get at most half of the tick so
 * the queue always has time, and the deadline leaves the rest for the next
 * tick.
 * Also the registry and the job list.
 */
import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { appError, jobRun, jobState, queuedJob } from '@/db/schema';

import { later, setupTestContext, staffActor } from '../../../tests/integration/helpers';
import { ServiceError } from '../errors';
import { defineQueuedKind, queueJob } from '../queue';
import { defineRecurringJob, handleQueuedJob, type JobOutcome, type RecurringJob } from './define';
import { listJobs } from './list';
import { RECURRING_JOBS } from './registry';
import { runRecurringJob } from './run';
import { isValidSchedule } from './schedule';
import { runJobNow, runTick } from './tick';

const { ctx, db, sent } = setupTestContext();

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A moment on a day far from today, in UTC, for the tick's clock.
 *
 * @param time - The time of day, e.g. `'10:30'`.
 * @returns The moment.
 */
function at(time: string): Date {
  return new Date(`2030-01-15T${time}:00Z`);
}

/**
 * An hourly test job that counts its runs.
 *
 * @param name - Its name.
 * @param run - What it does; it counts one run by default.
 * @returns The job.
 */
function hourlyJob(
  name: string,
  run: () => Promise<JobOutcome> = async () => ({ summary: { done: 1 } }),
): RecurringJob {
  return defineRecurringJob({ name, schedule: '0 * * * *', run });
}

/**
 * The stored history of a job.
 *
 * @param name - The job's name.
 * @returns Its runs, oldest first.
 */
async function history(name: string) {
  return db
    .select({ status: jobRun.status, trigger: jobRun.trigger, summary: jobRun.summary })
    .from(jobRun)
    .where(eq(jobRun.job, name))
    .orderBy(jobRun.startedAt, jobRun.id);
}

/**
 * The stored state of a job.
 *
 * @param name - The job's name.
 * @returns Its state, if it has one.
 */
async function state(name: string) {
  const [found] = await db.select().from(jobState).where(eq(jobState.name, name));
  return found;
}

describe('the registry', () => {
  it('has unique names in kebab-case and valid schedules', () => {
    const names = RECURRING_JOBS.map((job) => job.name);
    expect(new Set(names).size).toBe(names.length);
    names.forEach((name) => expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/));
    RECURRING_JOBS.forEach((job) => expect(isValidSchedule(job.schedule)).toBe(true));
  });
});

describe('runTick', () => {
  it('runs a due job once per scheduled moment, and records each run', async () => {
    const job = hourlyJob('adiutor-tests-hourly');

    const first = await runTick(ctx, {
      trigger: 'tick',
      deadline: later,
      now: at('10:30'),
      jobs: [job],
    });
    expect(first).toMatchObject({ failed: false, leftForNextTick: [], moreDue: false });
    expect(first.runs).toEqual([
      expect.objectContaining({ job: job.name, status: 'succeeded', summary: { done: 1 } }),
    ]);
    // The same hour again: nothing to do.
    await runTick(ctx, { trigger: 'tick', deadline: later, now: at('10:55'), jobs: [job] });
    // The next hour: due again.
    await runTick(ctx, { trigger: 'cli', deadline: later, now: at('11:05'), jobs: [job] });

    expect(await history(job.name)).toEqual([
      { status: 'succeeded', trigger: 'tick', summary: { done: 1 } },
      { status: 'succeeded', trigger: 'cli', summary: { done: 1 } },
    ]);
    expect(await state(job.name)).toMatchObject({
      lastStartedAt: at('11:05'),
      lastStatus: 'succeeded',
      lockedUntil: null,
      consecutiveFailures: 0,
    });
  });

  it('leaves paused jobs alone', async () => {
    const job = hourlyJob('adiutor-tests-paused');
    await db.insert(jobState).values({ name: job.name, pausedAt: sql`now()` });

    const result = await runTick(ctx, {
      trigger: 'tick',
      deadline: later,
      now: at('10:30'),
      jobs: [job],
    });

    expect(result.runs).toEqual([]);
    expect(await history(job.name)).toEqual([]);
  });

  it('runs a job that can’t be paused, whatever pause is left in the database', async () => {
    const job = defineRecurringJob({
      name: 'adiutor-tests-vital',
      schedule: '0 * * * *',
      pausable: false,
      /**
       * Counts one run.
       *
       * @returns One done.
       */
      run: async () => ({ summary: { done: 1 } }),
    });
    await db.insert(jobState).values({ name: job.name, pausedAt: sql`now()` });

    const result = await runTick(ctx, {
      trigger: 'tick',
      deadline: later,
      now: at('10:30'),
      jobs: [job],
    });

    expect(result.runs.map((run) => [run.job, run.status])).toEqual([[job.name, 'succeeded']]);
  });

  it('never runs a job twice at once: a second tick leaves it to the run that holds it', async () => {
    /** Lets the slow job finish; set once its run has started. */
    let finish: () => void = () => {};
    const job = hourlyJob(
      'adiutor-tests-slow',
      () =>
        new Promise((resolve) => {
          /**
           * Finishes the run.
           *
           * @returns Nothing.
           */
          finish = () => resolve({ summary: { done: 1 } });
        }),
    );

    const first = runTick(ctx, { trigger: 'tick', deadline: later, now: at('10:30'), jobs: [job] });
    // Wait until the first tick holds the job.
    await expect.poll(async () => (await state(job.name))?.lockedUntil).not.toBeNull();
    const second = await runTick(ctx, {
      trigger: 'tick',
      deadline: later,
      now: at('10:30'),
      jobs: [job],
    });
    finish();

    expect(second.runs).toEqual([]);
    expect((await first).runs).toHaveLength(1);
    expect(await history(job.name)).toHaveLength(1);
  });

  it('takes over a job whose run died, once its lease ran out, recording the died run', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const job = hourlyJob('adiutor-tests-orphaned');
    await db.insert(jobState).values({
      name: job.name,
      lockedUntil: sql`now() - interval '1 minute'`,
      lastStartedAt: at('09:00'),
    });

    const result = await runTick(ctx, {
      trigger: 'tick',
      deadline: later,
      now: at('10:30'),
      jobs: [job],
    });

    expect(result.runs.map((run) => [run.job, run.status])).toEqual([
      [job.name, 'failed'],
      [job.name, 'succeeded'],
    ]);
  });

  it('counts failures in a row without stopping the other jobs', async () => {
    const broken = hourlyJob('adiutor-tests-broken', async () => {
      throw new Error('Adiutor Tests: the job broke');
    });
    const partly = hourlyJob('adiutor-tests-partly', async () => ({
      summary: { sent: 1, failed: 1 },
      failure: '1 email could not be sent',
    }));
    const fine = hourlyJob('adiutor-tests-fine');
    const jobs = [broken, partly, fine];

    const first = await runTick(ctx, { trigger: 'tick', deadline: later, now: at('10:30'), jobs });
    await runTick(ctx, { trigger: 'tick', deadline: later, now: at('11:30'), jobs });

    expect(first.failed).toBe(true);
    expect(first.runs.map((run) => [run.job, run.status])).toEqual([
      [broken.name, 'failed'],
      [partly.name, 'failed'],
      [fine.name, 'succeeded'],
    ]);
    expect(await history(broken.name)).toEqual([
      { status: 'failed', trigger: 'tick', summary: {} },
      { status: 'failed', trigger: 'tick', summary: {} },
    ]);
    expect(await state(broken.name)).toMatchObject({
      consecutiveFailures: 2,
      lastStatus: 'failed',
    });
    expect(await state(partly.name)).toMatchObject({ consecutiveFailures: 2 });
    expect(await history(partly.name)).toContainEqual({
      status: 'failed',
      trigger: 'tick',
      summary: { sent: 1, failed: 1 },
    });
    expect(await state(fine.name)).toMatchObject({ consecutiveFailures: 0 });
  });

  it('records each failure as a job error, whose reference the run keeps and the log names', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = hourlyJob('adiutor-tests-broken', async () => {
      throw new Error('Adiutor Tests: refused for jane@adiutor.test');
    });
    const partly = hourlyJob('adiutor-tests-partly', async () => ({
      summary: { sent: 1, failed: 1 },
      failure: 'Some emails could not be sent',
    }));

    const result = await runTick(ctx, {
      trigger: 'tick',
      deadline: later,
      now: at('10:30'),
      jobs: [broken, partly],
    });

    const errors = await db
      .select({
        reference: appError.reference,
        source: appError.source,
        routePath: appError.routePath,
        message: appError.message,
      })
      .from(appError);
    expect(errors).toEqual(
      expect.arrayContaining([
        {
          reference: expect.any(String),
          source: 'job',
          routePath: broken.name,
          message: 'Adiutor Tests: refused for jane@adiutor.test',
        },
        {
          reference: expect.any(String),
          source: 'job',
          routePath: partly.name,
          message: 'Some emails could not be sent',
        },
      ]),
    );
    const byJob = new Map(errors.map((error) => [error.routePath, error.reference]));
    expect(result.runs.map((run) => [run.job, run.errorReference])).toEqual([
      [broken.name, byJob.get(broken.name)],
      [partly.name, byJob.get(partly.name)],
    ]);
    expect(
      await db
        .select({ errorReference: jobRun.errorReference })
        .from(jobRun)
        .where(eq(jobRun.job, broken.name)),
    ).toEqual([{ errorReference: byJob.get(broken.name) }]);
    // The log names the job and the reference; the message (which can quote an address) stays out.
    expect(logged).toHaveBeenCalledWith(
      `Job ${broken.name} failed; see error ${byJob.get(broken.name)}`,
    );
    expect(JSON.stringify(logged.mock.calls)).not.toContain('jane@adiutor.test');
  });

  it('starts the count again after a run that succeeds', async () => {
    let broken = true;
    const job = hourlyJob('adiutor-tests-flaky', async () => {
      if (broken) {
        throw new Error('Adiutor Tests: the job broke');
      }
      return { summary: {} };
    });

    await runTick(ctx, { trigger: 'tick', deadline: later, now: at('10:30'), jobs: [job] });
    broken = false;
    await runTick(ctx, { trigger: 'tick', deadline: later, now: at('11:30'), jobs: [job] });

    expect(await state(job.name)).toMatchObject({
      consecutiveFailures: 0,
      lastStatus: 'succeeded',
    });
  });

  it('leaves due jobs for the next tick once the deadline has passed', async () => {
    const job = hourlyJob('adiutor-tests-late');

    const result = await runTick(ctx, {
      trigger: 'tick',
      deadline: new Date(Date.now() - 1),
      now: at('10:30'),
      jobs: [job],
    });

    expect(result).toEqual({
      runs: [],
      leftForNextTick: [job.name],
      moreDue: true,
      failed: false,
    });
    expect(await history(job.name)).toEqual([]);
  });

  it('gives the recurring jobs the first half of the tick, and the queue the rest', async () => {
    // A faked clock that only the slow job moves, so no real time window can flake.
    const start = new Date('2030-01-15T10:30:00Z');
    const deadline = new Date(start.getTime() + 600);
    const deadlines: Date[] = [];
    // A slow job that works until its own deadline, as invitation reminders can.
    const slow = defineRecurringJob({
      name: 'adiutor-tests-slow',
      schedule: '0 * * * *',
      /**
       * Notes the deadline it got, then works until it.
       *
       * @param _ctx - Service context (not used).
       * @param options - The run's options.
       * @param options.deadline - When to stop.
       * @returns One done.
       */
      run: async (_ctx, { deadline: own }) => {
        deadlines.push(own);
        vi.setSystemTime(own);
        return { summary: { done: 1 } };
      },
    });
    const ran: string[] = [];
    const note = handleQueuedJob(
      defineQueuedKind({ name: 'adiutor-tests-note', payload: z.object({ userId: z.uuid() }) }),
      /**
       * Notes that it ran.
       *
       * @returns Done.
       */
      async () => {
        ran.push('note');
        return 'done';
      },
    );
    await queueJob(db, note, { userId: randomUUID() });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(start);

    const result = await runTick(ctx, {
      trigger: 'tick',
      deadline,
      now: at('10:30'),
      jobs: [slow],
      queuedJobs: [note],
    }).finally(() => vi.useRealTimers());

    // Exactly halfway, as the clock stood still until the slow job moved it to its deadline.
    expect(deadlines).toEqual([new Date(start.getTime() + 300)]);
    // The queue still ran after the slow job used all its time.
    expect(ran).toEqual(['note']);
    expect(result.runs.map((run) => run.job)).toEqual(['adiutor-tests-slow', 'adiutor-tests-note']);
  });

  it('says work is left when the deadline came with queued jobs due, and not for retries', async () => {
    const slowNote = handleQueuedJob(
      defineQueuedKind({
        name: 'adiutor-tests-slow-note',
        payload: z.object({ userId: z.uuid() }),
      }),
      /**
       * Takes a moment, so the deadline comes first.
       *
       * @returns Done.
       */
      async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 30);
        });
        return 'done';
      },
    );
    await Promise.all(
      Array.from({ length: 5 }, async () => queueJob(db, slowNote, { userId: randomUUID() })),
    );

    const busy = await runTick(ctx, {
      trigger: 'tick',
      deadline: new Date(Date.now() + 50),
      now: at('10:30'),
      jobs: [],
      queuedJobs: [slowNote],
    });
    expect(busy).toMatchObject({ leftForNextTick: [], moreDue: true });

    // What's left only waits for a later attempt: nothing is due now.
    await db.update(queuedJob).set({ runAt: sql`now() + interval '5 minutes'` });
    const waiting = await runTick(ctx, {
      trigger: 'tick',
      deadline: new Date(Date.now() - 1),
      now: at('10:30'),
      jobs: [],
      queuedJobs: [slowNote],
    });
    expect(waiting).toMatchObject({ runs: [], moreDue: false });
  });
});

describe('runs that never finished', () => {
  /**
   * Stores a run that started at 10:20 on the tick's day and died: its lease
   * ran out a minute ago, and it never finished.
   *
   * @param name - The job's name.
   * @param consecutiveFailures - How many runs in a row had failed before it.
   */
  async function diedAt1020(name: string, consecutiveFailures = 0) {
    await db.insert(jobState).values({
      name,
      lastStartedAt: at('10:20'),
      lockedUntil: sql`now() - interval '1 minute'`,
      consecutiveFailures,
    });
  }

  it('records a run whose lease ran out as failed, once, even with two ticks at once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const job = hourlyJob('adiutor-tests-died');
    await diedAt1020(job.name);

    // At 10:30 it isn't due again (it last started at 10:20, after 10:00).
    const results = await Promise.all(
      [1, 2].map(async () =>
        runTick(ctx, { trigger: 'tick', deadline: later, now: at('10:30'), jobs: [job] }),
      ),
    );

    const recorded = await db
      .select({
        status: jobRun.status,
        startedAt: jobRun.startedAt,
        reference: jobRun.errorReference,
      })
      .from(jobRun)
      .where(eq(jobRun.job, job.name));
    expect(recorded).toEqual([
      { status: 'failed', startedAt: at('10:20'), reference: expect.any(String) },
    ]);
    expect(await db.select({ reference: appError.reference }).from(appError)).toEqual([
      { reference: recorded[0]?.reference },
    ]);
    // One of the two ticks reported it, as a failure.
    expect(results.map((result) => result.failed).sort()).toEqual([false, true]);
    // Its lease is free again, for its next scheduled moment.
    expect(await state(job.name)).toMatchObject({
      lockedUntil: null,
      lastStatus: 'failed',
      consecutiveFailures: 1,
    });
  });

  it('leaves a run alone while it holds its lease', async () => {
    const job = hourlyJob('adiutor-tests-busy');
    await db.insert(jobState).values({
      name: job.name,
      lastStartedAt: at('10:20'),
      lockedUntil: sql`now() + interval '10 minutes'`,
    });

    const result = await runTick(ctx, {
      trigger: 'tick',
      deadline: later,
      now: at('10:30'),
      jobs: [job],
    });

    expect(result.runs).toEqual([]);
    expect(await history(job.name)).toEqual([]);
  });

  it('tells the staff Admins once it is the third failure in a row', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await staffActor(db, 'platform_admin', 'alex@adiutor.test');
    const job = hourlyJob('adiutor-tests-hangs');
    await diedAt1020(job.name, 2);

    await runTick(ctx, { trigger: 'tick', deadline: later, now: at('10:30'), jobs: [job] });

    expect(sent.map(({ to, subject }) => ({ to, subject }))).toEqual([
      {
        to: 'alex@adiutor.test',
        subject: 'Background job adiutor-tests-hangs keeps failing on Adiutor',
      },
    ]);
  });
});

describe('running a job now', () => {
  it('runs a job whether it is due or paused', async () => {
    const job = hourlyJob('adiutor-tests-now');
    await db
      .insert(jobState)
      .values({ name: job.name, pausedAt: sql`now()`, lastStartedAt: sql`now()` });

    const run = await runRecurringJob(ctx, job, { trigger: 'cli', deadline: later });

    expect(run).toMatchObject({ job: job.name, status: 'succeeded', summary: { done: 1 } });
    expect(await history(job.name)).toHaveLength(1);
  });

  it('leaves a job another run holds alone', async () => {
    const job = hourlyJob('adiutor-tests-held');
    await db
      .insert(jobState)
      .values({ name: job.name, lockedUntil: sql`now() + interval '5 minutes'` });

    await expect(
      runRecurringJob(ctx, job, { trigger: 'cli', deadline: later }),
    ).resolves.toBeNull();
  });

  it('runs a registered job by name', async () => {
    await expect(
      runJobNow(ctx, 'expired-sign-in-data', { trigger: 'cli', deadline: later }),
    ).resolves.toMatchObject({ job: 'expired-sign-in-data', status: 'succeeded' });
  });

  it('refuses a job that does not exist', async () => {
    await expect(
      runJobNow(ctx, 'adiutor-tests-missing', { trigger: 'cli', deadline: later }),
    ).rejects.toThrow(ServiceError);
  });
});

describe('listJobs', () => {
  it('lists every job with its state and next run', async () => {
    const now = new Date();
    await runJobNow(ctx, 'retention', { trigger: 'cli', deadline: later });
    await db.insert(jobState).values({ name: 'expired-sign-in-data', pausedAt: sql`now()` });

    const jobs = await listJobs(ctx, now);

    expect(jobs.map((job) => job.name)).toEqual(RECURRING_JOBS.map((job) => job.name));
    const byName = new Map(jobs.map((job) => [job.name, job]));
    // It ran just now, so its next run is its next scheduled moment.
    expect(byName.get('retention')).toMatchObject({
      paused: false,
      running: false,
      lastStatus: 'succeeded',
      due: false,
    });
    expect(byName.get('retention')?.nextRunAt?.getTime()).toBeGreaterThan(now.getTime());
    expect(byName.get('expired-sign-in-data')).toMatchObject({
      paused: true,
      due: false,
      nextRunAt: null,
    });
    // Never ran: due at the next tick.
    expect(byName.get('invitation-reminders')).toMatchObject({
      lastStatus: null,
      due: true,
      nextRunAt: now,
    });
  });
});
