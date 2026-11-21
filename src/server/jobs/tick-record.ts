/**
 * @file When the last tick started (the `jobs.last_tick` setting), and
 * whether that's late: no job runs between ticks, and none can tell anyone
 * that the ticks stopped, so the Jobs page and the dashboard warn staff
 * instead (`getTickWarning` in `overview.ts`).
 */
import type { Database } from '@/db';

import { readSettings, writeSettings } from '../settings';

/**
 * How long after the last tick started it counts as late, in minutes: on
 * Vercel's Hobby plan its 15-minute schedule can fire up to about 30
 * minutes apart, which mustn't count as stopped.
 */
export const TICK_LATE_MINUTES = 45;

/**
 * Notes that a tick starts now, by the app's clock, which {@link isTickLate}
 * compares with.
 *
 * @param db - Database client.
 */
export async function recordTick(db: Database): Promise<void> {
  await db.transaction((tx) => writeSettings(tx, { 'jobs.last_tick': new Date() }));
}

/**
 * Reads when the last tick started.
 *
 * @param db - Database client.
 * @returns The moment, or `null` when no tick ever ran.
 */
export async function readLastTick(db: Database): Promise<Date | null> {
  const settings = await readSettings(db, ['jobs.last_tick']);
  return settings['jobs.last_tick'];
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
