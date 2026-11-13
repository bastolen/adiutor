/**
 * @file Integration tests for running a recurring job now (from the command
 * line or the Jobs page), against the test database: it runs whether it's
 * due or paused, is always kept in the history, leaves a job another run
 * holds alone, and refuses a name the registry doesn't list.
 */
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { jobState } from '@/db/schema';

import { later, setupTestContext } from '../../../tests/integration/helpers';
import { ServiceError } from '../errors';
import { runRecurringJob } from './run';
import { history, hourlyJob } from './test-helpers';
import { runJobNow } from './tick';

const { ctx, db } = setupTestContext();

describe('running a job now', () => {
  it('runs a job whether it is due or paused', async () => {
    const job = hourlyJob('adiutor-tests-now');
    await db
      .insert(jobState)
      .values({ name: job.name, pausedAt: sql`now()`, lastStartedAt: sql`now()` });

    const run = await runRecurringJob(ctx, job, { trigger: 'cli', deadline: later });

    expect(run).toMatchObject({ job: job.name, status: 'succeeded', summary: { done: 1 } });
    expect(await history(db, job.name)).toHaveLength(1);
  });

  it('keeps a run started by hand in the history, even when it did nothing', async () => {
    const job = hourlyJob('adiutor-tests-idle', async () => ({ summary: {} }));

    const run = await runRecurringJob(ctx, job, { trigger: 'page', deadline: later });

    expect(run?.runId).toEqual(expect.any(String));
    expect(await history(db, job.name)).toEqual([
      { status: 'succeeded', trigger: 'page', summary: {} },
    ]);
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
