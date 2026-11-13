/**
 * @file Integration tests for the record of the last tick, against the test
 * database: every tick notes when it started, in one row, and the ticks
 * count as late when none ran yet or the last started over 45 minutes ago.
 */
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { jobTick } from '@/db/schema';

import { later, setupTestContext } from '../../../tests/integration/helpers';
import { runTick } from './tick';
import { isTickLate, readLastTick, TICK_LATE_MINUTES } from './tick-record';

const { ctx, db } = setupTestContext();

describe('the record of the last tick', () => {
  it('notes when each tick started, in one row', async () => {
    expect(await readLastTick(db)).toBeNull();

    await runTick(ctx, { trigger: 'tick', deadline: later, jobs: [], queuedJobs: [] });
    await db.update(jobTick).set({ lastStartedAt: sql`now() - interval '1 hour'` });
    await runTick(ctx, { trigger: 'cli', deadline: later, jobs: [], queuedJobs: [] });

    const rows = await db.select({ at: jobTick.lastStartedAt }).from(jobTick);
    expect(rows).toHaveLength(1);
    expect(isTickLate(rows[0]?.at ?? null)).toBe(false);
  });
});

describe('isTickLate', () => {
  it('is late without any tick, or once the last started more than 45 minutes ago', () => {
    const now = new Date('2026-11-13T12:00:00Z');
    /**
     * A moment some minutes before `now`.
     *
     * @param minutes - How many minutes.
     * @returns The moment.
     */
    const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

    expect(isTickLate(null, now)).toBe(true);
    expect(isTickLate(minutesAgo(TICK_LATE_MINUTES), now)).toBe(false);
    expect(isTickLate(minutesAgo(TICK_LATE_MINUTES + 1), now)).toBe(true);
  });
});
