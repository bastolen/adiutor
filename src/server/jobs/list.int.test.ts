/**
 * @file Integration tests for the list of recurring jobs (`pnpm jobs:list`
 * and the Jobs page), against the test database: every job in the
 * registry's order, with whether it's paused, how its last run went and
 * when it runs next.
 */
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { jobState } from '@/db/schema';

import { later, setupTestContext } from '../../../tests/integration/helpers';
import { listJobs } from './list';
import { RECURRING_JOBS } from './registry';
import { runJobNow } from './tick';

const { ctx, db } = setupTestContext();

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
