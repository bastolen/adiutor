/**
 * @file When the last tick started (`job_tick`), and whether that's late: no
 * job runs between ticks, and none can tell anyone that the ticks stopped, so
 * the Jobs page and the dashboard warn staff instead
 * (`getTickWarning` in `overview.ts`).
 */
import { sql } from 'drizzle-orm';

import type { Database } from '@/db';
import { jobTick } from '@/db/schema';

/**
 * How long after the last tick started it counts as late, in minutes: on
 * Vercel's Hobby plan its 15-minute schedule can fire up to about 30
 * minutes apart, which mustn't count as stopped.
 */
export const TICK_LATE_MINUTES = 45;

/**
 * Notes that a tick starts now, in the database's clock.
 *
 * @param db - Database client.
 */
export async function recordTick(db: Database): Promise<void> {
  await db
    .insert(jobTick)
    .values({ lastStartedAt: sql`now()` })
    .onConflictDoUpdate({ target: jobTick.singleton, set: { lastStartedAt: sql`now()` } });
}

/**
 * Reads when the last tick started.
 *
 * @param db - Database client.
 * @returns The moment, or `null` when no tick ever ran.
 */
export async function readLastTick(db: Database): Promise<Date | null> {
  const [row] = await db.select({ at: jobTick.lastStartedAt }).from(jobTick).limit(1);
  return row?.at ?? null;
}

/**
 * Whether the ticks look stopped: none ran yet, or the last one started more
 * than {@link TICK_LATE_MINUTES} ago.
 *
 * @param lastTickAt - When the last tick started, if one did.
 * @param now - The moment to compare with.
 * @returns Whether it's late.
 */
export function isTickLate(lastTickAt: Date | null, now = new Date()): boolean {
  return lastTickAt === null || now.getTime() - lastTickAt.getTime() > TICK_LATE_MINUTES * 60_000;
}
