/**
 * @file Integration tests for the record of the last tick, against the test
 * database: every tick notes when it started, in one setting
 * (`jobs.last_tick`), and the ticks count as late when none ran yet or the
 * last started over 45 minutes ago.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { setting } from '@/db/schema';

import { later, saveSettings, setupTestContext } from '../../../tests/integration/helpers';
import { runTick } from './tick';
import { isTickLate, readLastTick, TICK_LATE_MINUTES } from './tick-record';

const { ctx, db } = setupTestContext();

describe('the record of the last tick', () => {
  it('notes when each tick started, in one row', async () => {
    expect(await readLastTick(db)).toBeNull();

    await runTick(ctx, { trigger: 'tick', deadline: later, jobs: [], queuedJobs: [] });
    await saveSettings(db, { 'jobs.last_tick': new Date(Date.now() - 60 * 60_000) });
    await runTick(ctx, { trigger: 'cli', deadline: later, jobs: [], queuedJobs: [] });

    const rows = await db.select().from(setting).where(eq(setting.key, 'jobs.last_tick'));
    expect(rows).toHaveLength(1);
    expect(isTickLate(await readLastTick(db))).toBe(false);
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
